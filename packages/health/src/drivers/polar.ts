import type { DailyActivity, DateRangeOptions, HealthMetric, HeartRateSample, HRVSample, SleepSession } from '../types'
import type { CloudActivity, CloudActivityFile } from './device-cloud'
import { BaseDeviceCloudDriver, DeviceCloudError, deviceCloudFailure, fileBytes, numeric, positive, rangeOf, sportKey, ymdUtc } from './device-cloud'

/**
 * Polar AccessLink v3 (https://www.polar.com/accesslink-api/): Polar Flow's
 * open API, available to any registered client.
 *
 * - Exercises through the non-transactional endpoints: `GET /v3/exercises`
 *   (everything uploaded in the last 30 days) and `GET /v3/exercises/{id}/fit`.
 * - Sleep (`/v3/users/sleep`), Nightly Recharge (`/v3/users/nightly-recharge`,
 *   whose `heart_rate_variability_avg` is the night's HRV) and daily activity
 *   (`/v3/users/activities`, at most 28 days a request), each the last 28
 *   days at most.
 * - A user must be registered once after connecting (`registerUser`), or
 *   every data call answers 403/404; deregistering revokes the token.
 *
 * Rate limits are per client: 500 + 20 × users requests per 15 minutes and
 * 5000 + 100 × users per day; a 429 becomes a DeviceCloudRateLimitError.
 */

const POLAR_API_BASE = 'https://www.polaraccesslink.com'

/** The fields of an AccessLink exercise this reads. */
interface PolarExercise {
  id: string
  start_time?: string
  start_time_utc_offset?: number
  duration?: string
  calories?: number
  distance?: number
  heart_rate?: { average?: number, maximum?: number }
  sport?: string
  detailed_sport_info?: string
  has_route?: boolean
  training_load?: number
}

interface PolarSleep {
  date: string
  sleep_start_time?: string
  sleep_end_time?: string
  light_sleep?: number
  deep_sleep?: number
  rem_sleep?: number
  unrecognized_sleep_stage?: number
  sleep_score?: number
  total_interruption_duration?: number
  heart_rate_samples?: Record<string, number>
}

interface PolarRecharge {
  date: string
  heart_rate_avg?: number
  beat_to_beat_avg?: number
  heart_rate_variability_avg?: number
  breathing_rate_avg?: number
}

interface PolarActivity {
  start_time?: string
  end_time?: string
  calories?: number
  active_calories?: number
  steps?: number
  distance_from_steps?: number
}

/** ISO 8601 duration ("PT2H44M", "PT1H2M3.5S", "P1DT2H") in seconds. */
export function isoDurationSeconds(value: unknown): number | null {
  const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(value ?? '').trim())
  if (!match || match[0] === 'P' || match[0] === 'PT')
    return null
  const [, d = '0', h = '0', m = '0', s = '0'] = match
  return Math.round((Number(d) * 86400 + Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000) / 1000
}

/** A local "2008-10-13T10:40:02" and its offset east of UTC (minutes) as an instant. */
function localToUtc(local: string, offsetMinutes: number): number {
  const wall = Date.parse(`${local.replace(/\.\d+$/, '').replace(/Z$/, '')}Z`)
  return wall - offsetMinutes * 60_000
}

export interface PolarDriverOptions {
  baseUrl?: string
  /** Polar's user id (the token's x_user_id), for `deregisterUser`. */
  userId?: string
}

export class PolarAccessLinkDriver extends BaseDeviceCloudDriver {
  readonly name = 'Polar'
  readonly provider = 'polar' as const
  readonly supportedMetrics: ReadonlySet<HealthMetric> = new Set<HealthMetric>(['workouts', 'sleep', 'hrv', 'heartRate', 'dailyActivity'])
  private readonly baseUrl: string
  private readonly userId: string | undefined

  constructor(accessToken: string, options: PolarDriverOptions = {}) {
    super(accessToken)
    this.baseUrl = (options.baseUrl || POLAR_API_BASE).replace(/\/$/, '')
    this.userId = options.userId
  }

  private async call(path: string, init: RequestInit = {}, what = path): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) },
    })
    if (response.status === 429)
      throw await deviceCloudFailure('polar', response, what)
    return response
  }

  private async json<T>(path: string, empty: T): Promise<T> {
    const response = await this.call(path)
    // 204: nothing there (no sleep last night, no exercises this month).
    if (response.status === 204 || response.status === 404)
      return empty
    if (!response.ok)
      throw await deviceCloudFailure('polar', response, `GET ${path.split('?')[0]}`)
    return response.json() as Promise<T>
  }

  /**
   * Register the connected person with this client, which AccessLink needs
   * once before it shares their data. `memberId` is this app's own id for
   * them. Already registered (409) is fine.
   */
  async registerUser(memberId: string): Promise<{ userId: string | null, registered: boolean }> {
    const response = await this.call('/v3/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'member-id': memberId }),
    }, 'POST /v3/users')
    if (response.status === 409)
      return { userId: this.userId ?? null, registered: false }
    if (!response.ok)
      throw await deviceCloudFailure('polar', response, 'registering the user')
    const user = await response.json().catch(() => ({})) as { 'polar-user-id'?: number | string }
    return { userId: user['polar-user-id'] !== undefined ? String(user['polar-user-id']) : this.userId ?? null, registered: true }
  }

  /** Remove the person from this client; Polar revokes the token with it. */
  async deregisterUser(userId: string | undefined = this.userId): Promise<void> {
    if (!userId)
      throw new DeviceCloudError('Polar deregistration needs the user id', { provider: 'polar', status: 0 })
    const response = await this.call(`/v3/users/${encodeURIComponent(userId)}`, { method: 'DELETE' }, 'deregistering the user')
    if (!response.ok && response.status !== 204 && response.status !== 404)
      throw await deviceCloudFailure('polar', response, 'deregistering the user')
  }

  async listActivities(options?: DateRangeOptions): Promise<CloudActivity[]> {
    const { from, to } = rangeOf(options, 30)
    const exercises = await this.json<PolarExercise[]>('/v3/exercises', [])
    return (Array.isArray(exercises) ? exercises : [])
      .map(exercise => this.toActivity(exercise))
      .filter((activity): activity is CloudActivity => !!activity && Date.parse(activity.startTime) >= from && Date.parse(activity.startTime) <= to)
      .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))
  }

  private toActivity(exercise: PolarExercise): CloudActivity | null {
    if (!exercise?.id || !exercise.start_time)
      return null
    const offset = numeric(exercise.start_time_utc_offset) ?? null
    const start = localToUtc(exercise.start_time, offset ?? 0)
    if (!Number.isFinite(start))
      return null
    return {
      id: String(exercise.id),
      provider: 'polar',
      sport: sportKey(exercise.detailed_sport_info || exercise.sport),
      startTime: new Date(start).toISOString(),
      utcOffsetMinutes: offset,
      durationSeconds: isoDurationSeconds(exercise.duration),
      distanceMeters: positive(exercise.distance) ?? null,
      averageHeartRate: positive(exercise.heart_rate?.average),
      maxHeartRate: positive(exercise.heart_rate?.maximum),
      calories: positive(exercise.calories),
      hasFile: true,
    }
  }

  async downloadActivityFile(activity: CloudActivity): Promise<CloudActivityFile | null> {
    const response = await this.call(`/v3/exercises/${encodeURIComponent(activity.id)}/fit`, { headers: { Accept: '*/*' } }, 'downloading the .fit')
    if (response.status === 204 || response.status === 404)
      return null
    return { bytes: await fileBytes('polar', response, 'downloading the .fit'), filename: `polar-${activity.id}.fit`, format: 'fit' }
  }

  private inRange(day: string, options?: DateRangeOptions): boolean {
    return (!options?.startDate || day >= options.startDate.slice(0, 10)) && (!options?.endDate || day <= options.endDate.slice(0, 10))
  }

  async getSleep(options?: DateRangeOptions): Promise<SleepSession[]> {
    const data = await this.json<{ nights?: PolarSleep[] }>('/v3/users/sleep', { nights: [] })
    return (data.nights || []).filter(night => night?.date && this.inRange(night.date, options)).map((night) => {
      const deep = numeric(night.deep_sleep) ?? 0
      const light = numeric(night.light_sleep) ?? 0
      const rem = numeric(night.rem_sleep) ?? 0
      const total = deep + light + rem
      const start = Date.parse(String(night.sleep_start_time))
      const end = Date.parse(String(night.sleep_end_time))
      const inBed = Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.round((end - start) / 1000) : total
      const beats = Object.values(night.heart_rate_samples || {}).map(Number).filter(bpm => bpm > 0)
      return {
        id: `polar-${night.date}`,
        day: night.date,
        bedtimeStart: String(night.sleep_start_time || ''),
        bedtimeEnd: String(night.sleep_end_time || ''),
        type: 'long_sleep',
        totalSleepDuration: total,
        deepSleepDuration: deep,
        lightSleepDuration: light,
        remSleepDuration: rem,
        awakeTime: numeric(night.total_interruption_duration) ?? Math.max(0, inBed - total),
        timeInBed: inBed,
        latency: 0,
        efficiency: inBed > 0 ? Math.round(total / inBed * 100) : 0,
        ...(positive(night.sleep_score) !== undefined ? { score: positive(night.sleep_score) } : {}),
        ...(beats.length ? { averageHeartRate: Math.round(beats.reduce((a, b) => a + b, 0) / beats.length), lowestHeartRate: Math.min(...beats) } : {}),
        stages: [],
        source: 'polar',
      }
    })
  }

  /** The night's average HRV (ms), from Nightly Recharge, dated by the morning it belongs to. */
  async getHRV(options?: DateRangeOptions): Promise<HRVSample[]> {
    const data = await this.json<{ recharges?: PolarRecharge[] }>('/v3/users/nightly-recharge', { recharges: [] })
    return (data.recharges || [])
      .filter(night => night?.date && this.inRange(night.date, options) && positive(night.heart_rate_variability_avg) !== undefined)
      .map(night => ({ timestamp: night.date, hrv: Number(night.heart_rate_variability_avg) }))
  }

  /** Five-minute readings through the day (continuous heart rate, at most 28 days a request). */
  async getHeartRate(options?: DateRangeOptions): Promise<HeartRateSample[]> {
    const { from, to } = rangeOf(options, 7)
    const start = ymdUtc(new Date(Math.max(from, to - 27 * 86_400_000)))
    const data = await this.json<any>(`/v3/users/continuous-heart-rate?from=${start}&to=${ymdUtc(new Date(to))}`, [])
    const days: any[] = Array.isArray(data) ? data : Array.isArray(data?.heart_rates) ? data.heart_rates : data?.date ? [data] : []
    return days.flatMap(day => (day?.heart_rate_samples || [])
      .filter((sample: any) => positive(sample?.heart_rate) !== undefined && sample?.sample_time)
      .map((sample: any) => ({ timestamp: `${day.date}T${sample.sample_time}`, bpm: Number(sample.heart_rate), source: 'polar' })))
  }

  /** Steps and calories a day (at most 28 days a request, none older than a year). */
  async getDailyActivity(options?: DateRangeOptions): Promise<DailyActivity[]> {
    const { from, to } = rangeOf(options, 28)
    const start = ymdUtc(new Date(Math.max(from, to - 27 * 86_400_000)))
    const data = await this.json<any>(`/v3/users/activities?from=${start}&to=${ymdUtc(new Date(to))}`, [])
    const days: PolarActivity[] = Array.isArray(data) ? data : Array.isArray(data?.activities) ? data.activities : []
    return days.filter(day => day?.start_time).map(day => ({
      day: String(day.start_time).slice(0, 10),
      score: 0,
      activeCalories: numeric(day.active_calories) ?? 0,
      totalCalories: numeric(day.calories) ?? 0,
      ...(numeric(day.steps) !== undefined ? { steps: numeric(day.steps) } : {}),
      ...(numeric(day.distance_from_steps) !== undefined ? { equivalentWalkingDistance: numeric(day.distance_from_steps) } : {}),
      contributors: {},
      source: 'polar' as const,
    }))
  }
}

export function createPolarAccessLinkDriver(accessToken: string, options: PolarDriverOptions = {}): PolarAccessLinkDriver {
  return new PolarAccessLinkDriver(accessToken, options)
}

export interface PolarClientCredentials {
  clientId: string
  clientSecret: string
  baseUrl?: string
}

export interface PolarWebhook {
  id: string
  events: string[]
  url: string
  active?: boolean
  /** Returned once, when the webhook is created: keep it to verify every delivery. */
  signatureSecretKey?: string
}

async function polarClientCall(client: PolarClientCredentials, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${(client.baseUrl || POLAR_API_BASE).replace(/\/$/, '')}${path}`, {
    ...init,
    headers: { 'Authorization': `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`, 'Accept': 'application/json', 'Content-Type': 'application/json' },
  })
}

/**
 * Create the client's webhook (Polar allows one per client). Polar pings the
 * URL first and needs a 200; the answer carries the signature secret, which
 * Polar never shows again.
 */
export async function createPolarWebhook(client: PolarClientCredentials, url: string, events: string[] = ['EXERCISE', 'SLEEP']): Promise<PolarWebhook> {
  const response = await polarClientCall(client, '/v3/webhooks', { method: 'POST', body: JSON.stringify({ events, url }) })
  if (!response.ok)
    throw await deviceCloudFailure('polar', response, 'creating the webhook')
  const data = (await response.json() as { data?: any }).data || {}
  return { id: String(data.id), events: data.events || events, url: data.url || url, signatureSecretKey: data.signature_secret_key }
}

/** The client's webhook, if it has one. */
export async function getPolarWebhooks(client: PolarClientCredentials): Promise<PolarWebhook[]> {
  const response = await polarClientCall(client, '/v3/webhooks')
  if (!response.ok)
    throw await deviceCloudFailure('polar', response, 'reading the webhook')
  const data = (await response.json() as { data?: any[] }).data || []
  return data.map(hook => ({ id: String(hook.id), events: hook.events || [], url: hook.url, active: hook.active }))
}
