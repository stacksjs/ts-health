import type {
  BodyComposition,
  BodyTemperature,
  DailyActivity,
  DailyReadiness,
  DailySleepSummary,
  DailySpO2,
  DailyStress,
  DateRangeOptions,
  HealthDriver,
  HealthMetric,
  HealthPlatformType,
  HeartRateSample,
  HRVSample,
  PersonalInfo,
  SleepSession,
  VO2MaxReading,
  WeightMeasurement,
  Workout,
} from '../types'

/**
 * The watch makers' own clouds: Polar AccessLink, Suunto's Cloud API, COROS'
 * Open API and Wahoo's Cloud API.
 *
 * All four hand back what the watch recorded as the original .fit, so the
 * drivers share one shape: a list of activities (a summary each, enough to
 * tell whether it is already known and whether it is the same outing as one
 * recorded elsewhere) and the file behind each one. Daily readings (sleep,
 * HRV, steps, resting heart rate) come through the usual HealthDriver methods
 * where the maker offers them.
 *
 * Errors are typed so a caller can tell a rate limit (stop, try later) from a
 * revoked sign-in (ask the person to reconnect) from anything else.
 */

export type DeviceCloudProvider = 'polar' | 'suunto' | 'coros' | 'wahoo'

export const DEVICE_CLOUD_PROVIDERS: readonly DeviceCloudProvider[] = ['polar', 'suunto', 'coros', 'wahoo']

/** One recorded activity as the provider's list describes it. */
export interface CloudActivity {
  /** Numeric sport discriminator required by COROS MCP's detail/FIT tools. */
  providerSportType?: number
  /** The provider's id: Polar's exercise id, Suunto's workoutKey, COROS' labelId, Wahoo's workout id. */
  id: string
  provider: DeviceCloudProvider
  /** What the athlete or the watch called it, when the provider says. */
  name?: string
  /** Partner workout id returned by COROS, for exact pairing with its plan. */
  plannedWorkoutId?: string
  /** The provider's sport, as a lower-case snake key ("running", "road_cycling", "pool_swimming"). */
  sport: string
  /** The start, as an ISO instant in UTC. */
  startTime: string
  /** Minutes east of UTC where it was recorded, or null when the provider does not say. */
  utcOffsetMinutes: number | null
  durationSeconds: number | null
  distanceMeters: number | null
  averageHeartRate?: number
  maxHeartRate?: number
  calories?: number
  ascentMeters?: number
  averagePower?: number
  /** Training stress, when the provider computes it (Wahoo's TSS). */
  trainingStress?: number
  /** Whether the original recording can be downloaded. */
  hasFile: boolean
  /** Where the file is, when the provider hands out a link (COROS, Wahoo). */
  fileUrl?: string
}

/** An original recording, in memory. */
export interface CloudActivityFile {
  bytes: Uint8Array
  filename: string
  format: 'fit'
}

/** A HealthDriver for a maker's cloud: daily readings plus recordings. */
export interface DeviceCloudDriver extends HealthDriver {
  readonly provider: DeviceCloudProvider
  /** Activities that started in the range (provider limits apply: Polar keeps 30 days). */
  listActivities: (options?: DateRangeOptions) => Promise<CloudActivity[]>
  /** The original recording, or null when the provider has none for it. */
  downloadActivityFile: (activity: CloudActivity) => Promise<CloudActivityFile | null>
}

export interface DeviceCloudErrorDetails {
  provider: DeviceCloudProvider
  status: number
  /** The provider's own answer, cut short. */
  body?: string
  /** The provider's error code, where it has one apart from the HTTP status (COROS' `result`). */
  code?: string
}

/** A request the provider refused or could not answer. */
export class DeviceCloudError extends Error {
  readonly provider: DeviceCloudProvider
  readonly status: number
  readonly body: string
  readonly code: string | undefined

  constructor(message: string, details: DeviceCloudErrorDetails) {
    super(message)
    this.name = 'DeviceCloudError'
    this.provider = details.provider
    this.status = details.status
    this.body = details.body ?? ''
    this.code = details.code
  }
}

/** Too many requests: stop, and carry on after `retryAfterSeconds` (when the provider says). */
export class DeviceCloudRateLimitError extends DeviceCloudError {
  readonly retryAfterSeconds: number | null

  constructor(message: string, details: DeviceCloudErrorDetails & { retryAfterSeconds?: number | null }) {
    super(message, details)
    this.name = 'DeviceCloudRateLimitError'
    this.retryAfterSeconds = details.retryAfterSeconds ?? null
  }
}

/** The sign-in was revoked or has expired: the person has to connect again. */
export class DeviceCloudAuthError extends DeviceCloudError {
  constructor(message: string, details: DeviceCloudErrorDetails) {
    super(message, details)
    this.name = 'DeviceCloudAuthError'
  }
}

const NAMES: Record<DeviceCloudProvider, string> = { polar: 'Polar', suunto: 'Suunto', coros: 'COROS', wahoo: 'Wahoo' }

/** The provider as people write it. */
export function deviceCloudName(provider: DeviceCloudProvider): string {
  return NAMES[provider]
}

/**
 * Seconds until a rate limit lifts, from `Retry-After` (seconds or a date) or
 * Polar's `RateLimit-Reset` (the short and the long window, comma separated:
 * the short one is what to wait for).
 */
export function retryAfterSeconds(headers: Headers, now: number = Date.now()): number | null {
  const retry = headers.get('retry-after')
  if (retry) {
    const seconds = Number(retry)
    if (Number.isFinite(seconds) && seconds >= 0)
      return Math.round(seconds)
    const at = Date.parse(retry)
    if (Number.isFinite(at))
      return Math.max(0, Math.round((at - now) / 1000))
  }
  const reset = headers.get('ratelimit-reset')
  if (reset) {
    const first = Number(reset.split(',')[0]!.trim())
    if (Number.isFinite(first) && first >= 0)
      return Math.round(first)
  }
  return null
}

/** The typed error for a response that was not ok. */
export async function deviceCloudFailure(provider: DeviceCloudProvider, response: Response, what: string): Promise<DeviceCloudError> {
  const body = (await response.text().catch(() => '')).slice(0, 300)
  const message = `${NAMES[provider]} ${what} failed (${response.status})${body ? `: ${body}` : ''}`
  if (response.status === 429)
    return new DeviceCloudRateLimitError(message, { provider, status: 429, body, retryAfterSeconds: retryAfterSeconds(response.headers) })
  if (response.status === 401 || response.status === 403)
    return new DeviceCloudAuthError(message, { provider, status: response.status, body })
  return new DeviceCloudError(message, { provider, status: response.status, body })
}

/** The bytes of a file response, refusing an answer that is plainly not a file (JSON or HTML). */
export async function fileBytes(provider: DeviceCloudProvider, response: Response, what: string): Promise<Uint8Array> {
  if (!response.ok)
    throw await deviceCloudFailure(provider, response, what)
  const type = (response.headers.get('content-type') || '').toLowerCase()
  if (type.includes('json') || type.startsWith('text/html'))
    throw new DeviceCloudError(`${NAMES[provider]} ${what} answered ${type}, not a file`, { provider, status: response.status, body: (await response.text().catch(() => '')).slice(0, 300) })
  return new Uint8Array(await response.arrayBuffer())
}

/** A number the provider sent as a number or a numeric string, or undefined. */
export function numeric(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '')
    return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** A positive number, or undefined: providers send 0 for "not measured". */
export function positive(value: unknown): number | undefined {
  const parsed = numeric(value)
  return parsed !== undefined && parsed > 0 ? parsed : undefined
}

/** "Some Sport-Name" or "SOME_SPORT" as "some_sport_name". */
export function sportKey(value: unknown): string {
  return String(value ?? '').trim().replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'other'
}

/** YYYY-MM-DD of a Date in UTC. */
export function ymdUtc(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** The range as two instants: from the start of `startDate` to the end of `endDate` (UTC), defaulting to the last `days` days. */
export function rangeOf(options: DateRangeOptions | undefined, days: number, now: number = Date.now()): { from: number, to: number } {
  const to = options?.endDate ? Date.parse(`${options.endDate.slice(0, 10)}T23:59:59.999Z`) : now
  const from = options?.startDate ? Date.parse(`${options.startDate.slice(0, 10)}T00:00:00.000Z`) : to - days * 86_400_000
  return { from: Number.isFinite(from) ? from : now - days * 86_400_000, to: Number.isFinite(to) ? to : now }
}

/** The days from `from` to `to` (YYYY-MM-DD) in windows of at most `size` days, oldest first. */
export function dayWindows(from: string, to: string, size: number): Array<{ from: string, to: string }> {
  const out: Array<{ from: string, to: string }> = []
  let start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end)
    return out
  while (start <= end) {
    const stop = Math.min(end, start + (size - 1) * 86_400_000)
    out.push({ from: ymdUtc(new Date(start)), to: ymdUtc(new Date(stop)) })
    start = stop + 86_400_000
  }
  return out
}

/**
 * What every maker's driver shares: the HealthDriver methods a provider does
 * not offer answer an empty list, and `getWorkouts` is the activity list in
 * the normalized shape.
 */
export abstract class BaseDeviceCloudDriver implements DeviceCloudDriver {
  abstract readonly name: string
  abstract readonly provider: DeviceCloudProvider
  abstract readonly supportedMetrics: ReadonlySet<HealthMetric>
  protected readonly accessToken: string

  constructor(accessToken: string) {
    this.accessToken = accessToken
  }

  get type(): HealthPlatformType {
    return this.provider
  }

  isAuthenticated(): boolean {
    return this.accessToken.length > 0
  }

  abstract listActivities(options?: DateRangeOptions): Promise<CloudActivity[]>
  abstract downloadActivityFile(activity: CloudActivity): Promise<CloudActivityFile | null>

  async getWorkouts(options?: DateRangeOptions): Promise<Workout[]> {
    return (await this.listActivities(options)).map(activity => cloudActivityToWorkout(activity))
  }

  async getSleep(_options?: DateRangeOptions): Promise<SleepSession[]> { return [] }
  async getDailySleep(_options?: DateRangeOptions): Promise<DailySleepSummary[]> { return [] }
  async getDailyActivity(_options?: DateRangeOptions): Promise<DailyActivity[]> { return [] }
  async getReadiness(_options?: DateRangeOptions): Promise<DailyReadiness[]> { return [] }
  async getHeartRate(_options?: DateRangeOptions): Promise<HeartRateSample[]> { return [] }
  async getHRV(_options?: DateRangeOptions): Promise<HRVSample[]> { return [] }
  async getSpO2(_options?: DateRangeOptions): Promise<DailySpO2[]> { return [] }
  async getStress(_options?: DateRangeOptions): Promise<DailyStress[]> { return [] }
  async getBodyTemperature(_options?: DateRangeOptions): Promise<BodyTemperature[]> { return [] }
  async getVO2Max(_options?: DateRangeOptions): Promise<VO2MaxReading[]> { return [] }
  async getBodyComposition(_options?: DateRangeOptions): Promise<BodyComposition[]> { return [] }
  async getWeightMeasurements(_options?: DateRangeOptions): Promise<WeightMeasurement[]> { return [] }
  async getPersonalInfo(): Promise<PersonalInfo | null> { return null }
}

/** A cloud activity in ts-health's normalized Workout shape. */
export function cloudActivityToWorkout(activity: CloudActivity): Workout {
  const start = Date.parse(activity.startTime)
  const local = new Date(start + (activity.utcOffsetMinutes ?? 0) * 60_000)
  return {
    id: activity.id,
    activity: activity.sport,
    day: ymdUtc(local),
    startDatetime: activity.startTime,
    endDatetime: new Date(start + (activity.durationSeconds ?? 0) * 1000).toISOString(),
    ...(activity.calories !== undefined ? { calories: activity.calories } : {}),
    ...(activity.distanceMeters !== null ? { distance: activity.distanceMeters } : {}),
    ...(activity.name ? { label: activity.name } : {}),
    ...(activity.averageHeartRate !== undefined ? { averageHeartRate: activity.averageHeartRate } : {}),
    ...(activity.maxHeartRate !== undefined ? { maxHeartRate: activity.maxHeartRate } : {}),
    source: activity.provider,
  }
}
