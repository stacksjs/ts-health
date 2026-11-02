import type { CarbEntry, GlucoseDriver, GlucoseFetch, GlucoseRange, GlucoseReading, InsulinDose, PumpStatus } from './types'
import { createHash } from 'node:crypto'
import { GlucoseSourceError } from './types'
import { inRange, normalizeTrend, plausibleMgdl, rangeMs, requestJson, toIso, uniqueById } from './units'

export interface NightscoutConfig {
  /** The site, e.g. https://my-site.herokuapp.com */
  url: string
  /** A read-only access token from Admin Tools (preferred), e.g. "hq-1a2b3c4d5e6f7a8b". */
  token?: string
  /** The site's API_SECRET; sent only as its SHA-1 hash. */
  apiSecret?: string
  fetch?: GlucoseFetch
}

/**
 * Nightscout caps a page; a day of 5-minute CGM is 288 entries, a month
 * ~8,700, and a 1-minute sensor or a loop's temp basals far more. A range
 * holding more is read page by page (`pages`).
 */
const PAGE = 10_000

/** A runaway guard: a million rows is years of 1-minute data. */
const MAX_PAGES = 100

/**
 * Nightscout: the open CGM-in-the-cloud hub most DIY closed loops (Loop, Trio,
 * AndroidAPS, OpenAPS) and many uploaders (xDrip+, Spike, the Medtronic 600
 * series uploader, tconnectsync for Tandem) write to. Entries hold glucose,
 * treatments hold boluses, temp basals and carbs, and devicestatus holds the
 * pump's reservoir, battery and the loop's IOB/COB.
 */
export class NightscoutDriver implements GlucoseDriver {
  readonly name: string = 'Nightscout'
  readonly type: 'nightscout' = 'nightscout'
  private base: string

  constructor(private config: NightscoutConfig) {
    let url: URL
    try { url = new URL(config.url.trim()) }
    catch { throw new GlucoseSourceError('Enter your Nightscout site address, e.g. https://my-site.example.com') }
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
      throw new GlucoseSourceError('Nightscout must be reached over https')
    this.base = `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  }

  private async get(path: string, params: Record<string, string>): Promise<any> {
    const url = new URL(`${this.base}${path}`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    if (this.config.token) url.searchParams.set('token', this.config.token)
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (this.config.apiSecret) headers['api-secret'] = createHash('sha1').update(this.config.apiSecret).digest('hex')
    return (await requestJson(this.config.fetch, 'Nightscout', url.toString(), { headers })).body
  }

  /**
   * Every row of a range, however many pages it takes. Nightscout answers a
   * find newest first and stops at `count`, so one request over 90 days of
   * CGM returned only the newest 10,000 readings and the older weeks were
   * never imported. Each next page asks for what is no newer than the oldest
   * row of the last one (inclusive, since rows can share a time; repeats are
   * dropped by id later), until a page comes back short.
   */
  private async pages(path: string, field: 'date' | 'created_at', range: { start: number, end: number }, what: string): Promise<any[]> {
    const bound = (value: number) => field === 'date' ? String(value) : new Date(value).toISOString()
    const rows: any[] = []
    let upper = bound(range.end)
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await this.get(path, {
        [`find[${field}][$gte]`]: bound(range.start),
        [`find[${field}][$lte]`]: upper,
        'count': String(PAGE),
      })
      if (!Array.isArray(batch)) throw new GlucoseSourceError(`Nightscout returned invalid ${what}`)
      rows.push(...batch)
      if (batch.length < PAGE) return rows
      const oldest = batch[batch.length - 1]?.[field]
      let next = oldest == null ? '' : String(oldest)
      // A whole page at one instant: step past it rather than ask again.
      if (next === upper && field === 'date') next = String(Number(next) - 1)
      if (!next || next === upper) throw new GlucoseSourceError(`Nightscout returned more ${what} than it can page through`)
      upper = next
    }
    throw new GlucoseSourceError(`Nightscout returned more ${what} than it can page through`)
  }

  /** Confirms the site answers and the token reads; the site's own name when it has one. */
  async verify(): Promise<{ name: string | null, units: 'mg/dL' | 'mmol/L' | null }> {
    const status = await this.get('/api/v1/status.json', {})
    if (!status || typeof status !== 'object') throw new GlucoseSourceError('That address is not a Nightscout site')
    const units = status.settings?.units === 'mmol' ? 'mmol/L' : status.settings?.units === 'mg/dl' ? 'mg/dL' : null
    return { name: typeof status.settings?.customTitle === 'string' ? status.settings.customTitle : null, units }
  }

  async getGlucose(range: GlucoseRange): Promise<GlucoseReading[]> {
    const ms = rangeMs(range)
    const rows = await this.pages('/api/v1/entries.json', 'date', ms, 'entries')
    const readings: GlucoseReading[] = []
    for (const row of rows) {
      const timestamp = toIso(row?.date ?? row?.dateString)
      if (!timestamp || !inRange(timestamp, ms)) continue
      const meter = row.type === 'mbg'
      const value = meter ? row.mbg : row.sgv
      if ((row.type !== 'sgv' && !meter) || !plausibleMgdl(value)) continue
      readings.push({
        id: String(row._id ?? `${row.type}-${row.date}`),
        timestamp,
        mgdl: Math.round(value),
        trend: meter ? 'unknown' : normalizeTrend(row.direction),
        kind: meter ? 'meter' : 'cgm',
        device: typeof row.device === 'string' ? row.device : undefined,
        source: 'nightscout',
      })
    }
    return uniqueById(readings)
  }

  private async treatments(range: GlucoseRange): Promise<any[]> {
    return this.pages('/api/v1/treatments.json', 'created_at', rangeMs(range), 'treatments')
  }

  async getInsulin(range: GlucoseRange): Promise<InsulinDose[]> {
    const doses: InsulinDose[] = []
    for (const row of await this.treatments(range)) {
      const timestamp = toIso(row?.created_at ?? row?.timestamp)
      if (!timestamp) continue
      const event = String(row.eventType ?? '').toLowerCase()
      const id = String(row._id ?? `${event}-${timestamp}`)
      const device = typeof row.enteredBy === 'string' ? row.enteredBy : undefined
      if (event === 'temp basal') {
        const rate = Number(row.absolute ?? row.rate)
        const duration = Number(row.duration)
        if (!Number.isFinite(rate) || rate < 0 || !Number.isFinite(duration) || duration <= 0) continue
        doses.push({ id, timestamp, units: round2(rate * duration / 60), kind: 'basal', subtype: rate === 0 ? 'suspend' : 'temp', rateUnitsPerHour: rate, durationMinutes: duration, automatic: true, device, source: 'nightscout' })
        continue
      }
      const units = Number(row.insulin)
      if (!Number.isFinite(units) || units <= 0) continue
      // Anything else carrying insulin is a bolus; Loop and AAPS log some under their own event names.
      const automatic = row.isSMB === true || row.automatic === true || event === 'smb'
      const subtype = automatic ? 'automatic' : event.includes('correction') ? 'correction' : Number(row.carbs) > 0 || event.includes('meal') || event.includes('snack') ? 'meal' : event === 'combo bolus' ? 'extended' : undefined
      doses.push({ id, timestamp, units: round2(units), kind: 'bolus', subtype, automatic, device, source: 'nightscout' })
    }
    return uniqueById(doses)
  }

  async getCarbs(range: GlucoseRange): Promise<CarbEntry[]> {
    const entries: CarbEntry[] = []
    for (const row of await this.treatments(range)) {
      const timestamp = toIso(row?.created_at ?? row?.timestamp)
      const grams = Number(row?.carbs)
      if (!timestamp || !Number.isFinite(grams) || grams <= 0) continue
      entries.push({ id: String(row._id ?? `carbs-${timestamp}`), timestamp, grams: Math.round(grams), source: 'nightscout' })
    }
    return uniqueById(entries)
  }

  async getPumpStatus(): Promise<PumpStatus | null> {
    const rows = await this.get('/api/v1/devicestatus.json', { count: '10' })
    if (!Array.isArray(rows)) return null
    // Uploaders interleave phone-only rows; the newest row that knows the pump or loop wins.
    for (const row of rows) {
      const timestamp = toIso(row?.created_at)
      if (!timestamp) continue
      const pump = row.pump ?? {}
      const iob = num(row.loop?.iob?.iob) ?? num(row.openaps?.iob?.iob) ?? num(row.openaps?.suggested?.IOB) ?? num(pump.iob?.iob) ?? num(pump.iob?.bolusiob)
      const cob = num(row.loop?.cob?.cob) ?? num(row.openaps?.suggested?.COB)
      const reservoir = num(pump.reservoir)
      const battery = num(pump.battery?.percent)
      if (iob === undefined && cob === undefined && reservoir === undefined && battery === undefined) continue
      const suspended = pump.status?.suspended === true || String(pump.status?.status ?? '').toLowerCase() === 'suspended'
      const mode = row.loop ? 'Loop' : row.openaps ? 'OpenAPS' : typeof pump.status?.status === 'string' ? pump.status.status : undefined
      return {
        timestamp,
        device: typeof row.device === 'string' ? row.device.replace(/^[a-z]+:\/\//i, '') : undefined,
        reservoirUnits: reservoir,
        batteryPercent: battery,
        insulinOnBoard: iob === undefined ? undefined : round2(iob),
        carbsOnBoard: cob === undefined ? undefined : Math.round(cob),
        suspended,
        mode,
        source: 'nightscout',
      }
    }
    return null
  }
}

function num(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function createNightscoutDriver(config: NightscoutConfig): NightscoutDriver {
  return new NightscoutDriver(config)
}
