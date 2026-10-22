import type { CarbEntry, GlucoseDriver, GlucoseFetch, GlucoseRange, GlucoseReading, GlucoseTrend, InsulinDose, PumpStatus } from './types'
import { createHash } from 'node:crypto'
import { GlucoseSourceError } from './types'
import { inRange, plausibleMgdl, rangeMs, requestJson, toIso, uniqueById } from './units'

export interface LibreLinkUpConfig {
  /** The LibreLinkUp (follower) account, not the LibreLink sensor account itself. */
  email: string
  password: string
  /** Regional host; sign-in answers with a redirect to the right one when this is wrong. */
  region?: string
  fetch?: GlucoseFetch
}

const REGIONS = new Set(['us', 'eu', 'eu2', 'de', 'fr', 'jp', 'ap', 'au', 'ae', 'ca', 'la'])

// LibreLinkUp refuses clients older than its current app version.
const CLIENT_HEADERS = { 'product': 'llu.android', 'version': '4.12.0', 'Content-Type': 'application/json', 'Accept': 'application/json' }

const TRENDS: Record<number, GlucoseTrend> = { 1: 'singleDown', 2: 'fortyFiveDown', 3: 'flat', 4: 'fortyFiveUp', 5: 'singleUp' }

function host(region: string | undefined): string {
  return region && REGIONS.has(region) ? `https://api-${region}.libreview.io` : 'https://api.libreview.io'
}

/** LibreView's "FactoryTimestamp" is UTC in US notation: 10/21/2026 6:30:00 AM. */
export function libreTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ([AP]M)$/i.exec(value.trim())
  if (!match) return toIso(value)
  const [, month, day, year, hour, minute, second, half] = match
  let h = Number(hour) % 12
  if (half!.toUpperCase() === 'PM') h += 12
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), h, Number(minute), Number(second))).toISOString()
}

/**
 * FreeStyle Libre 2/3 glucose through LibreLinkUp, Abbott's follower app.
 * Unofficial: it is the same API the LibreLinkUp app uses. The person invites
 * their own LibreLinkUp account from the LibreLink app and signs in with that.
 * The graph covers the last 12 hours, so syncing at least hourly keeps a full day.
 */
export class LibreLinkUpDriver implements GlucoseDriver {
  readonly name: string = 'FreeStyle Libre'
  readonly type: 'libre' = 'libre'
  private session: { token: string, accountId: string, expiresAt: number, region?: string } | null = null

  constructor(private config: LibreLinkUpConfig) {}

  /** The region the account answered from, so the caller can store it and skip the redirect next time. */
  get region(): string | undefined {
    return this.session?.region ?? this.config.region
  }

  async authenticate(): Promise<void> {
    if (this.session && this.session.expiresAt > Date.now()) return
    if (!this.config.email.trim() || !this.config.password) throw new GlucoseSourceError('LibreLinkUp email and password are required')
    let region = this.config.region
    for (let attempt = 0; attempt < 2; attempt++) {
      const { body } = await requestJson(this.config.fetch, 'LibreLinkUp', `${host(region)}/llu/auth/login`, {
        method: 'POST',
        headers: CLIENT_HEADERS,
        body: JSON.stringify({ email: this.config.email.trim(), password: this.config.password }),
      })
      if (body?.data?.redirect === true && typeof body.data.region === 'string' && REGIONS.has(body.data.region) && body.data.region !== region) {
        region = body.data.region
        continue
      }
      if (body?.status === 4) throw new GlucoseSourceError('Accept LibreView\'s terms in the LibreLinkUp app, then connect again')
      const token = body?.data?.authTicket?.token
      const userId = body?.data?.user?.id
      if (typeof token !== 'string' || typeof userId !== 'string')
        throw new GlucoseSourceError('LibreLinkUp refused the sign-in; check the email and password of your LibreLinkUp account')
      const expires = Number(body.data.authTicket.expires)
      this.session = {
        token,
        accountId: createHash('sha256').update(userId).digest('hex'),
        expiresAt: Number.isFinite(expires) ? expires * 1000 - 60_000 : Date.now() + 3_600_000,
        region,
      }
      return
    }
    throw new GlucoseSourceError('LibreLinkUp kept redirecting the sign-in')
  }

  private async get(path: string): Promise<any> {
    await this.authenticate()
    const { body } = await requestJson(this.config.fetch, 'LibreLinkUp', `${host(this.region)}${path}`, {
      headers: { ...CLIENT_HEADERS, 'Authorization': `Bearer ${this.session!.token}`, 'account-id': this.session!.accountId },
    })
    return body?.data
  }

  /** The first sensor wearer who shared with this follower account (normally the person themselves). */
  private async patientId(): Promise<string> {
    const connections = await this.get('/llu/connections')
    const id = Array.isArray(connections) ? connections[0]?.patientId : null
    if (typeof id !== 'string') throw new GlucoseSourceError('No one shares glucose with this LibreLinkUp account yet. In the LibreLink app, add it under Connected apps → LibreLinkUp.')
    return id
  }

  async getGlucose(range: GlucoseRange): Promise<GlucoseReading[]> {
    const ms = rangeMs(range)
    const graph = await this.get(`/llu/connections/${encodeURIComponent(await this.patientId())}/graph`)
    const rows = [...(Array.isArray(graph?.graphData) ? graph.graphData : []), graph?.connection?.glucoseMeasurement].filter(Boolean)
    const sensor = graph?.connection?.sensor?.pt === 4 ? 'FreeStyle Libre 3' : 'FreeStyle Libre'
    const readings: GlucoseReading[] = []
    for (const row of rows) {
      const timestamp = libreTimestamp(row.FactoryTimestamp)
      const value = Number(row.ValueInMgPerDl ?? row.Value)
      if (!timestamp || !plausibleMgdl(value) || !inRange(timestamp, ms)) continue
      readings.push({
        id: `libre-${Date.parse(timestamp)}`,
        timestamp,
        mgdl: Math.round(value),
        trend: TRENDS[Number(row.TrendArrow)] ?? 'unknown',
        kind: 'cgm',
        device: sensor,
        source: 'libre',
      })
    }
    return uniqueById(readings)
  }

  async getInsulin(): Promise<InsulinDose[]> { return [] }
  async getCarbs(): Promise<CarbEntry[]> { return [] }
  async getPumpStatus(): Promise<PumpStatus | null> { return null }
}

export function createLibreLinkUpDriver(config: LibreLinkUpConfig): LibreLinkUpDriver {
  return new LibreLinkUpDriver(config)
}
