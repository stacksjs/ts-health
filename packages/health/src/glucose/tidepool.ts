import type { CarbEntry, GlucoseDriver, GlucoseFetch, GlucoseRange, GlucoseReading, InsulinDose, InsulinSubtype, PumpStatus } from './types'
import { GlucoseSourceError } from './types'
import { MGDL_PER_MMOL, plausibleMgdl, rangeMs, requestJson, toIso, uniqueById } from './units'

export interface TidepoolConfig {
  email: string
  password: string
  /** https://api.tidepool.org, or a test server. */
  baseUrl?: string
  fetch?: GlucoseFetch
}

const TYPES = 'cbg,smbg,bolus,basal,food,wizard,pumpSettings'

/** Tidepool keeps glucose in mmol/L at full precision; it converts with 18.01559. */
function tidepoolMgdl(value: unknown, units: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const mgdl = String(units).toLowerCase().startsWith('mg') ? n : n * MGDL_PER_MMOL
  return plausibleMgdl(mgdl) ? Math.round(mgdl) : null
}

function deviceName(row: any): string | undefined {
  const id = typeof row?.deviceId === 'string' ? row.deviceId : ''
  if (/tandem|tslim|t:slim/i.test(id)) return 'Tandem t:slim X2'
  if (/insulet|omnipod/i.test(id)) return 'Omnipod'
  if (/medtronic|minimed/i.test(id)) return 'Medtronic MiniMed'
  if (/dexcom/i.test(id)) return 'Dexcom'
  if (/abbott|libre/i.test(id)) return 'FreeStyle Libre'
  if (/loop|tidepoolloop/i.test(id)) return 'Tidepool Loop'
  return id ? id.split('_')[0] : undefined
}

/**
 * Tidepool: a nonprofit diabetes data hub that uploads Tandem, Omnipod,
 * Medtronic, Dexcom, Libre and meter data in one schema. It is the broadest
 * single route to commercial pump data (boluses, automated and scheduled
 * basal, suspends, bolus-calculator carbs, pump settings).
 */
export class TidepoolDriver implements GlucoseDriver {
  readonly name: string = 'Tidepool'
  readonly type: 'tidepool' = 'tidepool'
  private session: { token: string, userId: string } | null = null
  private cache = new Map<string, Promise<any[]>>()

  constructor(private config: TidepoolConfig) {}

  private get base(): string {
    return (this.config.baseUrl ?? 'https://api.tidepool.org').replace(/\/+$/, '')
  }

  async authenticate(): Promise<void> {
    if (this.session) return
    if (!this.config.email.trim() || !this.config.password) throw new GlucoseSourceError('Tidepool email and password are required')
    const basic = Buffer.from(`${this.config.email.trim()}:${this.config.password}`).toString('base64')
    const { body, headers } = await requestJson(this.config.fetch, 'Tidepool', `${this.base}/auth/login`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}` },
    })
    const token = headers.get('x-tidepool-session-token')
    if (!token || typeof body?.userid !== 'string') throw new GlucoseSourceError('Tidepool refused the sign-in; check the email and password')
    this.session = { token, userId: body.userid }
  }

  /** One read per range covers all four getters. */
  private data(range: GlucoseRange): Promise<any[]> {
    const ms = rangeMs(range)
    const key = `${ms.start}-${ms.end}`
    let pending = this.cache.get(key)
    if (!pending) {
      pending = (async () => {
        await this.authenticate()
        const url = new URL(`${this.base}/data/${encodeURIComponent(this.session!.userId)}`)
        url.searchParams.set('startDate', new Date(ms.start).toISOString())
        url.searchParams.set('endDate', new Date(ms.end).toISOString())
        url.searchParams.set('type', TYPES)
        const { body } = await requestJson(this.config.fetch, 'Tidepool', url.toString(), { headers: { 'x-tidepool-session-token': this.session!.token } })
        if (!Array.isArray(body)) throw new GlucoseSourceError('Tidepool returned invalid data')
        return body
      })()
      this.cache.set(key, pending)
      pending.catch(() => this.cache.delete(key))
    }
    return pending
  }

  async getGlucose(range: GlucoseRange): Promise<GlucoseReading[]> {
    const readings: GlucoseReading[] = []
    for (const row of await this.data(range)) {
      if (row?.type !== 'cbg' && row?.type !== 'smbg') continue
      const timestamp = toIso(row.time)
      const mgdl = tidepoolMgdl(row.value, row.units)
      if (!timestamp || mgdl === null) continue
      readings.push({ id: String(row.id ?? `${row.type}-${timestamp}`), timestamp, mgdl, trend: 'unknown', kind: row.type === 'cbg' ? 'cgm' : 'meter', device: deviceName(row), source: 'tidepool' })
    }
    return uniqueById(readings)
  }

  async getInsulin(range: GlucoseRange): Promise<InsulinDose[]> {
    const doses: InsulinDose[] = []
    for (const row of await this.data(range)) {
      const timestamp = toIso(row?.time)
      if (!timestamp) continue
      const id = String(row.id ?? `${row.type}-${timestamp}`)
      if (row.type === 'bolus') {
        const units = (Number(row.normal) || 0) + (Number(row.extended) || 0)
        if (!(units > 0)) continue
        const automatic = row.subType === 'automated'
        const subtype: InsulinSubtype | undefined = automatic ? 'automatic' : row.extended > 0 ? 'extended' : undefined
        doses.push({ id, timestamp, units: Math.round(units * 100) / 100, kind: 'bolus', subtype, automatic, device: deviceName(row), source: 'tidepool' })
      }
      else if (row.type === 'basal') {
        const rate = Number(row.rate) || 0
        const minutes = Number(row.duration) / 60_000
        if (!Number.isFinite(minutes) || minutes <= 0) continue
        const delivery = String(row.deliveryType)
        const subtype: InsulinSubtype = delivery === 'suspend' ? 'suspend' : delivery === 'temp' ? 'temp' : delivery === 'automated' ? 'automatic' : 'scheduled'
        doses.push({
          id,
          timestamp,
          units: Math.round(rate * minutes / 60 * 1000) / 1000,
          kind: 'basal',
          subtype,
          rateUnitsPerHour: delivery === 'suspend' ? 0 : rate,
          durationMinutes: Math.round(minutes * 10) / 10,
          automatic: delivery === 'automated',
          device: deviceName(row),
          source: 'tidepool',
        })
      }
    }
    return uniqueById(doses)
  }

  async getCarbs(range: GlucoseRange): Promise<CarbEntry[]> {
    const entries: CarbEntry[] = []
    for (const row of await this.data(range)) {
      const timestamp = toIso(row?.time)
      const grams = row?.type === 'wizard' ? Number(row.carbInput) : row?.type === 'food' ? Number(row.nutrition?.carbohydrate?.net) : Number.NaN
      if (!timestamp || !Number.isFinite(grams) || grams <= 0) continue
      entries.push({ id: String(row.id ?? `carbs-${timestamp}`), timestamp, grams: Math.round(grams), source: 'tidepool' })
    }
    return uniqueById(entries)
  }

  /** Tidepool holds uploads, not live pump state; the latest basal says whether the loop or a suspend was running. */
  async getPumpStatus(): Promise<PumpStatus | null> {
    const end = Date.now()
    const basals = (await this.getInsulin({ start: new Date(end - 86_400_000), end: new Date(end) })).filter(dose => dose.kind === 'basal')
    const last = basals.at(-1)
    if (!last) return null
    return {
      timestamp: last.timestamp,
      device: last.device,
      suspended: last.subtype === 'suspend',
      mode: last.subtype === 'automatic' ? 'automated' : last.subtype === 'suspend' ? 'suspended' : 'manual',
      source: 'tidepool',
    }
  }
}

export function createTidepoolDriver(config: TidepoolConfig): TidepoolDriver {
  return new TidepoolDriver(config)
}
