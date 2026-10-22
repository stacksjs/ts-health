import type { CarbEntry, GlucoseDriver, GlucoseFetch, GlucoseRange, GlucoseReading, InsulinDose, PumpStatus } from './types'
import { GlucoseSourceError } from './types'
import { normalizeTrend, plausibleMgdl, rangeMs, requestJson, toIso, uniqueById } from './units'

/** Dexcom keeps separate clouds per region; an account lives in exactly one. */
export type DexcomRegion = 'us' | 'eu' | 'jp' | 'sandbox'

export const DEXCOM_HOSTS: Readonly<Record<DexcomRegion, string>> = {
  us: 'https://api.dexcom.com',
  eu: 'https://api.dexcom.eu',
  jp: 'https://api.dexcom.jp',
  sandbox: 'https://sandbox-api.dexcom.com',
}

export interface DexcomClient {
  clientId: string
  clientSecret: string
  redirectUri: string
  region?: DexcomRegion
  fetch?: GlucoseFetch
}

export interface DexcomTokens {
  accessToken: string
  refreshToken: string
  /** ISO instant. */
  expiresAt: string
}

export interface DexcomConfig {
  accessToken: string
  region?: DexcomRegion
  fetch?: GlucoseFetch
}

/** Dexcom answers at most 30 days per request. */
const WINDOW_MS = 30 * 86_400_000

/** Where to send the person to grant read access (Dexcom API v3, OAuth 2 authorization code). */
export function dexcomAuthorizeUrl(client: Pick<DexcomClient, 'clientId' | 'redirectUri' | 'region'>, state: string): string {
  const url = new URL(`${DEXCOM_HOSTS[client.region ?? 'us']}/v2/oauth2/login`)
  url.searchParams.set('client_id', client.clientId)
  url.searchParams.set('redirect_uri', client.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'offline_access')
  url.searchParams.set('state', state)
  return url.toString()
}

async function tokenRequest(client: DexcomClient, params: Record<string, string>): Promise<DexcomTokens> {
  const body = new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, ...params })
  const { body: json } = await requestJson(client.fetch, 'Dexcom', `${DEXCOM_HOSTS[client.region ?? 'us']}/v2/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (typeof json?.access_token !== 'string' || typeof json?.refresh_token !== 'string')
    throw new GlucoseSourceError('Dexcom returned an invalid token')
  const seconds = Number(json.expires_in) || 7200
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: new Date(Date.now() + seconds * 1000).toISOString() }
}

export function exchangeDexcomCode(client: DexcomClient, code: string): Promise<DexcomTokens> {
  return tokenRequest(client, { code, grant_type: 'authorization_code', redirect_uri: client.redirectUri })
}

/** Dexcom rotates the refresh token on every refresh; store the new one. */
export function refreshDexcomToken(client: DexcomClient, refreshToken: string): Promise<DexcomTokens> {
  return tokenRequest(client, { refresh_token: refreshToken, grant_type: 'refresh_token', redirect_uri: client.redirectUri })
}

/** Dexcom takes UTC wall time without an offset: 2026-10-21T06:30:00. */
function dexcomTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19)
}

/**
 * Dexcom's official API (v3): G6, G7, ONE and Stelo estimated glucose values
 * and the events logged in the Dexcom app (carbs, fast and long acting insulin).
 * Data reaches the API about an hour behind real time by Dexcom's design.
 */
export class DexcomDriver implements GlucoseDriver {
  readonly name: string = 'Dexcom'
  readonly type: 'dexcom' = 'dexcom'

  constructor(private config: DexcomConfig) {}

  private async records(path: string, range: GlucoseRange): Promise<any[]> {
    const ms = rangeMs(range)
    const all: any[] = []
    for (let from = ms.start; from <= ms.end; from += WINDOW_MS) {
      const to = Math.min(from + WINDOW_MS - 1000, ms.end)
      const url = new URL(`${DEXCOM_HOSTS[this.config.region ?? 'us']}/v3/users/self/${path}`)
      url.searchParams.set('startDate', dexcomTime(from))
      url.searchParams.set('endDate', dexcomTime(to))
      const { body } = await requestJson(this.config.fetch, 'Dexcom', url.toString(), {
        headers: { Authorization: `Bearer ${this.config.accessToken}`, Accept: 'application/json' },
      })
      if (!Array.isArray(body?.records)) throw new GlucoseSourceError('Dexcom returned invalid records')
      all.push(...body.records)
    }
    return all
  }

  async getGlucose(range: GlucoseRange): Promise<GlucoseReading[]> {
    const readings: GlucoseReading[] = []
    for (const row of await this.records('egvs', range)) {
      const timestamp = toIso(`${row?.systemTime}Z`)
      if (!timestamp || !plausibleMgdl(row.value) || (row.unit && row.unit !== 'mg/dL')) continue
      readings.push({
        id: String(row.recordId ?? `egv-${row.systemTime}`),
        timestamp,
        mgdl: Math.round(row.value),
        trend: normalizeTrend(row.trend),
        kind: 'cgm',
        device: typeof row.displayDevice === 'string' ? `Dexcom ${row.transmitterGeneration ?? ''}`.trim() : undefined,
        source: 'dexcom',
      })
    }
    return uniqueById(readings)
  }

  private async events(range: GlucoseRange): Promise<any[]> {
    return (await this.records('events', range)).filter(row => row?.eventStatus !== 'deleted')
  }

  async getInsulin(range: GlucoseRange): Promise<InsulinDose[]> {
    const doses: InsulinDose[] = []
    for (const row of await this.events(range)) {
      const timestamp = toIso(`${row.systemTime}Z`)
      const units = Number(row.value)
      if (row.eventType !== 'insulin' || !timestamp || !Number.isFinite(units) || units <= 0) continue
      const longActing = row.eventSubType === 'longActing'
      doses.push({
        id: String(row.recordId ?? `insulin-${row.systemTime}`),
        timestamp,
        units: Math.round(units * 100) / 100,
        kind: longActing ? 'basal' : 'bolus',
        subtype: longActing ? 'long_acting' : undefined,
        automatic: false,
        source: 'dexcom',
      })
    }
    return uniqueById(doses)
  }

  async getCarbs(range: GlucoseRange): Promise<CarbEntry[]> {
    const entries: CarbEntry[] = []
    for (const row of await this.events(range)) {
      const timestamp = toIso(`${row.systemTime}Z`)
      const grams = Number(row.value)
      if (row.eventType !== 'carbs' || !timestamp || !Number.isFinite(grams) || grams <= 0) continue
      entries.push({ id: String(row.recordId ?? `carbs-${row.systemTime}`), timestamp, grams: Math.round(grams), source: 'dexcom' })
    }
    return uniqueById(entries)
  }

  /** Dexcom is a CGM, not a pump: there is no pump state to report. */
  async getPumpStatus(): Promise<PumpStatus | null> {
    return null
  }
}

export function createDexcomDriver(config: DexcomConfig): DexcomDriver {
  return new DexcomDriver(config)
}
