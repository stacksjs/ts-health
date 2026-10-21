import type { DailyActivity, DailySleepSummary, DateRangeOptions, HealthMetric, HeartRateSample, HRVSample } from '../types'
import type { CloudActivity, CloudActivityFile } from './device-cloud'
import { BaseDeviceCloudDriver, DeviceCloudAuthError, DeviceCloudError, DeviceCloudRateLimitError, retryAfterSeconds } from './device-cloud'

export type CorosMcpRegion = 'us' | 'eu'
export const COROS_MCP_SCOPES = 'openid mcp.tools offline_access'
export const corosMcpOrigin = (region: CorosMcpRegion): string => region === 'eu' ? 'https://mcpeu.coros.com' : 'https://mcpus.coros.com'

function failure(message: string, status = 0): DeviceCloudError {
  return new DeviceCloudError(`COROS MCP ${message}`, { provider: 'coros', status })
}

async function checked(response: Response): Promise<void> {
  // Provider bodies can contain tokens, health data or instructions. Never
  // include them in exceptions, which applications commonly log or display.
  if (response.status === 401 || response.status === 403)
    throw new DeviceCloudAuthError('COROS MCP sign-in expired', { provider: 'coros', status: response.status })
  if (response.status === 429)
    throw new DeviceCloudRateLimitError('COROS MCP request limit reached', { provider: 'coros', status: 429, retryAfterSeconds: retryAfterSeconds(response.headers) })
  if (!response.ok) throw failure(`request failed (${response.status})`, response.status)
}

export interface CorosMcpTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: string
  subject: string
}

/** Public client registration; no shared client secret and no account password. */
export async function registerCorosMcpClient(region: CorosMcpRegion, redirectUris: string[], clientName = 'HQ.training'): Promise<string> {
  const response = await fetch(`${corosMcpOrigin(region)}/connect/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ client_name: clientName, redirect_uris: redirectUris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: COROS_MCP_SCOPES, token_endpoint_auth_method: 'none' }),
  })
  await checked(response)
  const data = await response.json() as any
  if (typeof data.client_id !== 'string' || !data.client_id) throw failure('registration returned no client identifier')
  return data.client_id
}

export function corosMcpAuthorizeUrl(input: { region: CorosMcpRegion, clientId: string, redirectUri: string, state: string, challenge: string }): string {
  const origin = corosMcpOrigin(input.region)
  return `${origin}/oauth2/authorize?${new URLSearchParams({ response_type: 'code', client_id: input.clientId, redirect_uri: input.redirectUri, scope: COROS_MCP_SCOPES, resource: `${origin}/mcp`, state: input.state, code_challenge: input.challenge, code_challenge_method: 'S256' })}`
}

/** Only decode a token received directly from COROS's TLS token endpoint. */
function subjectOf(token: string, region: CorosMcpRegion): string {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString())
    if (claims.iss !== corosMcpOrigin(region) || typeof claims.sub !== 'string' || !claims.sub) throw failure('token has no account subject')
    return `${region}:${claims.sub}`
  }
  catch { throw failure('token has no valid account subject') }
}

export async function corosMcpToken(input: { region: CorosMcpRegion, clientId: string, code?: string, redirectUri?: string, verifier?: string, refreshToken?: string }): Promise<CorosMcpTokens> {
  const origin = corosMcpOrigin(input.region)
  const form = new URLSearchParams({ client_id: input.clientId, resource: `${origin}/mcp` })
  if (input.refreshToken) {
    form.set('grant_type', 'refresh_token')
    form.set('refresh_token', input.refreshToken)
  }
  else {
    if (!input.code || !input.redirectUri || !input.verifier) throw failure('authorization code and PKCE verifier are required')
    form.set('grant_type', 'authorization_code')
    form.set('code', input.code)
    form.set('redirect_uri', input.redirectUri)
    form.set('code_verifier', input.verifier)
  }
  const response = await fetch(`${origin}/oauth2/token`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) })
  await checked(response)
  const data = await response.json() as any
  if (typeof data.access_token !== 'string' || !data.access_token) throw failure('token exchange returned no access token')
  return { accessToken: data.access_token, subject: subjectOf(data.access_token, input.region), ...(data.refresh_token ? { refreshToken: String(data.refresh_token) } : {}), ...(Number(data.expires_in) > 0 ? { expiresAt: new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() } : {}) }
}

export interface CorosMcpResult { content?: Array<{ type: string, text?: string }>, structuredContent?: unknown, isError?: boolean }

/** COROS currently wraps formatted text in a JSON string inside MCP content. */
export function corosMcpText(result: CorosMcpResult): string {
  if (result.isError) throw failure('tool refused the request')
  return (result.content || []).filter(item => item.type === 'text').map((item) => {
    let text = item.text || ''
    try {
      const value = JSON.parse(text)
      if (typeof value === 'string') text = value
    }
    catch { /* Some server versions return text directly. */ }
    return text
  }).join('\n')
}

export class CorosMcpClient {
  private sessionId = ''
  private sequence = 0
  private initialized: Promise<void> | null = null
  readonly endpoint: string

  constructor(private token: string, options: { region: CorosMcpRegion, endpoint?: string }) {
    this.endpoint = options.endpoint || `${corosMcpOrigin(options.region)}/mcp`
  }

  private async rpc(method: string, params: unknown, notification = false): Promise<any> {
    const id = ++this.sequence
    const response = await fetch(this.endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-06-18', ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(!notification ? { id } : {}), method, params }),
    })
    await checked(response)
    this.sessionId = response.headers.get('mcp-session-id') || this.sessionId
    if (notification) {
      await response.body?.cancel()
      return
    }
    const text = await response.text()
    let answer: any
    try {
      answer = text.trim().startsWith('{') ? JSON.parse(text) : text.split(/\r?\n\r?\n/).map(event => event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')).filter(Boolean).map(value => JSON.parse(value)).find(value => value.id === id)
    }
    catch { throw failure('returned an unreadable protocol response') }
    if (answer?.id !== id || answer?.jsonrpc !== '2.0' || answer.error || !('result' in answer)) throw failure('returned an invalid protocol response')
    return answer.result
  }

  private async initialize(): Promise<void> {
    await this.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ts-health', version: '1.0.0' } })
    await this.rpc('notifications/initialized', {}, true)
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<CorosMcpResult> {
    this.initialized ??= this.initialize().catch((error) => {
      this.initialized = null
      throw error
    })
    await this.initialized
    // Never retry writes at the transport layer: a lost response can mean
    // the workout was saved. Callers reconcile their own stable reference.
    const result = await this.rpc('tools/call', { name, arguments: args }) as CorosMcpResult
    if (result.isError) throw failure(`${name} was refused`)
    return result
  }

  async revoke(clientId: string): Promise<void> {
    const origin = new URL(this.endpoint).origin
    const response = await fetch(`${origin}/oauth2/revoke`, { method: 'POST', body: new URLSearchParams({ client_id: clientId, token: this.token, token_type_hint: 'access_token' }), signal: AbortSignal.timeout(30_000) })
    await checked(response)
  }
}

export interface CorosMcpSection {
  sectionType?: 1 | 2 | 3 | 4
  targetType?: 1 | 2 | 3 | 4
  targetValue?: number
  intensityType?: 1 | 2 | 4
  intensityValueStart?: number
  intensityValueEnd?: number
  intervalGroup?: boolean
  repeats?: number
  sets?: CorosMcpSection[]
}
export interface CorosMcpCourse { courseName: string, courseDescription: string, sportType: 1 | 2 | 5, sections: CorosMcpSection[] }

export function corosMcpScheduledId(text: string): string | null {
  return /(?:^|\n)idInPlan:\s*(\d+)\s*(?:\n|$)/.exec(text)?.[1] ?? null
}

/** Date-bounded text sections; do not mix an overview's HRV baseline into a daily reading. */
export function corosMcpDays(text: string): Array<{ day: string, text: string }> {
  const matches = [...text.matchAll(/(?:^|\n)(?:---\s*)?(\d{4})-?(\d{2})-?(\d{2})(?:\s*---)?[ \t]*(?:\n|$)/g)]
  return matches.map((match, index) => ({ day: `${match[1]}-${match[2]}-${match[3]}`, text: text.slice(match.index! + match[0].length, matches[index + 1]?.index ?? text.length) }))
}

/** A conservative parser: an unrecognized record must not silently vanish. */
export function parseCorosMcpActivities(text: string): CloudActivity[] {
  if (/^No sport records found\b/.test(text.trim())) return []
  const blocks = text.split(/\n(?=\d+\.\s)/).slice(1)
  if (!blocks.length) throw failure('activity list format changed; no data imported')
  const sports: Record<number, string> = { 100: 'running', 101: 'treadmill_running', 102: 'trail_running', 103: 'track_running', 104: 'hiking', 200: 'cycling', 201: 'indoor_cycling', 203: 'gravel_cycling', 204: 'mountain_biking', 300: 'pool_swimming', 301: 'open_water_swimming', 402: 'strength_training', 900: 'walking' }
  return blocks.map((block) => {
    const id = /\blabelId:\s*([A-Za-z0-9_-]+)/i.exec(block)?.[1]
    const timestamp = Number(/\bstartTimestamp:\s*(\d+)/i.exec(block)?.[1])
    const type = Number(/\bsportType:\s*(\d+)/i.exec(block)?.[1])
    if (!id || !timestamp || !Number.isFinite(type)) throw failure('activity list is missing a stable identifier or start time; no data imported')
    const start = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp)
    if (!Number.isFinite(start.getTime())) throw failure('activity start time is invalid')
    const duration = /Duration:\s*(\d+):(\d{2}):(\d{2})/.exec(block)
    const distance = /Distance:\s*([\d.]+)\s*km/.exec(block)
    return { id, provider: 'coros', providerSportType: type, sport: sports[type] || 'other', startTime: start.toISOString(), utcOffsetMinutes: null, durationSeconds: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : null, distanceMeters: distance ? Number(distance[1]) * 1000 : null, hasFile: true }
  })
}

export class CorosMcpDriver extends BaseDeviceCloudDriver {
  readonly name: string = 'COROS'
  readonly provider: 'coros' = 'coros'
  readonly supportedMetrics: ReadonlySet<HealthMetric> = new Set(['workouts', 'dailyActivity', 'heartRate', 'hrv', 'sleep'])
  readonly mcp: CorosMcpClient
  private daily: { at: number, text: Promise<string> } | null = null

  constructor(token: string, private options: { region: CorosMcpRegion, endpoint?: string, reserveFitDownload?: () => Promise<void> }) {
    super(token)
    this.mcp = new CorosMcpClient(token, options)
  }

  async listActivities(options?: DateRangeOptions): Promise<CloudActivity[]> {
    const read = async (from: string, to: string): Promise<CloudActivity[]> => {
      const text = corosMcpText(await this.mcp.call('querySportRecords', { startDate: from.replaceAll('-', ''), endDate: to.replaceAll('-', ''), sportTypeCodes: [65535], minDistanceKm: 0, maxDistanceKm: 0, minDurationMinutes: 0, maxDurationMinutes: 0, maxAveragePace: '', locationKeyword: '', limit: 1000 }))
      const records = parseCorosMcpActivities(text)
      if (records.length < 1000) return records
      if (from === to) throw failure('a single day reached the activity listing limit')
      const start = Date.parse(`${from}T00:00:00Z`)
      const end = Date.parse(`${to}T00:00:00Z`)
      const midpoint = start + Math.floor((end - start) / 86_400_000 / 2) * 86_400_000
      const middle = new Date(midpoint).toISOString().slice(0, 10)
      const next = new Date(midpoint + 86_400_000).toISOString().slice(0, 10)
      return [...await read(from, middle), ...await read(next, to)]
    }
    const records = await read(options?.startDate || '2000-01-01', options?.endDate || new Date().toISOString().slice(0, 10))
    return [...new Map(records.map(record => [record.id, record])).values()]
  }

  async downloadActivityFile(activity: CloudActivity): Promise<CloudActivityFile | null> {
    if (activity.providerSportType === undefined) throw failure('recording has no sport discriminator')
    await this.options.reserveFitDownload?.()
    const day = activity.startTime.slice(0, 10).replaceAll('-', '')
    const text = corosMcpText(await this.mcp.call('queryActivityFitFileDownloadUrls', { labelId: activity.id, sportType: activity.providerSportType, startDate: day, endDate: day, limit: 1 }))
    const link = /https:\/\/[^\s"<>]+/.exec(text)?.[0]
    if (!link) throw failure('recording download link was unavailable')
    const url = new URL(link)
    if (url.username || url.password || url.port || !['coros.com', 'coros.cloud', 'coros.net'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) throw failure('recording download host is not recognized')
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) })
    await checked(response)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length < 12 || String.fromCharCode(...bytes.slice(8, 12)) !== '.FIT') throw failure('recording was not a FIT file')
    return { bytes, filename: `coros-${activity.id}.fit`, format: 'fit' }
  }

  async getDailyActivity(): Promise<DailyActivity[]> {
    const text = await this.dailyText()
    return corosMcpDays(text).flatMap(({ day, text }) => {
      const steps = /Steps:\s*(\d+)/i.exec(text)
      const calories = /Calories:\s*([\d.]+)\s*kcal/i.exec(text)
      if (!steps && !calories) return []
      return [{ day, score: 0, steps: Number(steps?.[1] || 0), activeCalories: 0, totalCalories: Number(calories?.[1] || 0), contributors: {}, source: 'coros' as const }]
    })
  }

  private dailyText(): Promise<string> {
    if (!this.daily || Date.now() - this.daily.at > 60_000) {
      const text = this.mcp.call('queryDailyHealthData', { days: 30 }).then(corosMcpText).catch((error) => {
        this.daily = null
        throw error
      })
      this.daily = { at: Date.now(), text }
    }
    return this.daily.text
  }

  /** Preserve the provider's calorie label without reclassifying it as active calories. */
  async getDailyMetrics(): Promise<Array<{ Date: string, details: Array<{ label: string, value: number }> }>> {
    return corosMcpDays(await this.dailyText()).flatMap(({ day, text }) => {
      const calories = /Calories:\s*([\d.]+)\s*kcal/i.exec(text)
      return calories ? [{ Date: day, details: [{ label: 'Calories (COROS, kcal)', value: Number(calories[1]) }] }] : []
    })
  }

  async getHeartRate(): Promise<HeartRateSample[]> {
    const text = corosMcpText(await this.mcp.call('queryRestingHeartRate', { days: 30 }))
    return corosMcpDays(text).flatMap(({ day, text }) => {
      const bpm = /(?:Resting (?:Heart Rate|HR)):\s*([\d.]+)\s*bpm/i.exec(text)
      return bpm && Number(bpm[1]) > 0 ? [{ timestamp: `${day}T00:00:00Z`, bpm: Number(bpm[1]), source: 'resting' }] : []
    })
  }

  async getDailySleep(options?: DateRangeOptions): Promise<DailySleepSummary[]> {
    const text = corosMcpText(await this.mcp.call('querySleepOverview', { startDate: (options?.startDate || '').replaceAll('-', ''), endDate: (options?.endDate || '').replaceAll('-', ''), days: 30 }))
    return corosMcpDays(text).flatMap(({ day, text }) => {
      const duration = /(?:Daily Sleep|Main Sleep \(asleep\)):\s*(?:(\d+)h\s*)?(\d+)\s*min/i.exec(text)
      const score = /Sleep Score:\s*(\d+)/i.exec(text)
      return duration ? [{ day, ...(score ? { score: Number(score[1]) } : {}), contributors: { totalSleep: Number(duration[1] || 0) + Number(duration[2]) / 60 }, source: 'coros' as const }] : []
    })
  }

  async getHRV(options?: DateRangeOptions): Promise<HRVSample[]> {
    const text = corosMcpText(await this.mcp.call('querySleepHrv', { startDate: (options?.startDate || '').replaceAll('-', ''), endDate: (options?.endDate || '').replaceAll('-', ''), days: 7 }))
    return corosMcpDays(text).flatMap(({ day, text }) => {
      const hrv = /(?:Average HRV|HRV Average|HRV):\s*([\d.]+)\s*ms/i.exec(text)
      return hrv && Number(hrv[1]) > 0 ? [{ timestamp: `${day}T00:00:00Z`, hrv: Number(hrv[1]) }] : []
    })
  }
}
