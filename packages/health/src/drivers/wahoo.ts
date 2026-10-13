import type { DateRangeOptions, HealthMetric } from '../types'
import type { CloudActivity, CloudActivityFile } from './device-cloud'
import { BaseDeviceCloudDriver, DeviceCloudError, deviceCloudFailure, fileBytes, numeric, positive, rangeOf } from './device-cloud'

/**
 * Wahoo's Cloud API (https://cloud-api.wahooligan.com), for apps Wahoo has
 * approved (a sandbox app first, then production).
 *
 * - `GET /v1/workouts?page&per_page`, newest first, each with its
 *   `workout_summary` (accumulated distance, active duration, heart rate,
 *   power, TSS, calories) and `workout_summary.file.url`, the original .fit on
 *   Wahoo's CDN. Downloading it is not an API call: no token, no rate limit.
 * - `GET /v1/user` for the person's id, which webhooks are addressed by.
 * - `DELETE /v1/permissions` takes the app's access away again.
 *
 * Numbers in a summary arrive as decimal strings. Rate limits: sandbox 25
 * requests per 5 minutes, 100 an hour, 250 a day; production 200, 1000 and
 * 5000. A 429 becomes a DeviceCloudRateLimitError.
 */

const WAHOO_API_BASE = 'https://api.wahooligan.com'

/** Wahoo's workout_type_id, as sport keys. */
const WORKOUT_TYPES: Record<number, string> = {
  0: 'cycling',
  1: 'running',
  2: 'fitness_equipment',
  3: 'track_running',
  4: 'trail_running',
  5: 'treadmill_running',
  6: 'walking',
  7: 'speed_walking',
  8: 'nordic_walking',
  9: 'hiking',
  10: 'mountaineering',
  11: 'cyclocross',
  12: 'indoor_cycling',
  13: 'mountain_biking',
  14: 'recumbent_cycling',
  15: 'road_cycling',
  16: 'track_cycling',
  17: 'motorcycling',
  18: 'fitness_equipment',
  19: 'treadmill_running',
  20: 'elliptical',
  21: 'indoor_cycling',
  22: 'indoor_rowing',
  23: 'stair_climbing',
  25: 'pool_swimming',
  26: 'open_water_swimming',
  27: 'snowboarding',
  28: 'skiing',
  29: 'downhill_skiing',
  30: 'cross_country_skiing',
  31: 'skating',
  32: 'ice_skating',
  33: 'inline_skating',
  34: 'longboarding',
  35: 'sailing',
  36: 'windsurfing',
  37: 'canoeing',
  38: 'kayaking',
  39: 'rowing',
  40: 'kiteboarding',
  41: 'stand_up_paddling',
  42: 'workout',
  43: 'cardio_class',
  44: 'stair_climbing',
  45: 'wheelchair',
  46: 'golf',
  47: 'other',
  49: 'indoor_cycling',
  56: 'treadmill_walking',
  61: 'indoor_cycling',
  62: 'multisport',
  63: 'transition',
  64: 'e_biking',
  66: 'yoga',
  67: 'running',
  68: 'virtual_ride',
  69: 'mental_strength',
  70: 'handcycling',
  71: 'virtual_run',
}

interface WahooSummary {
  ascent_accum?: string | number
  calories_accum?: string | number
  distance_accum?: string | number
  duration_active_accum?: string | number
  duration_total_accum?: string | number
  heart_rate_avg?: string | number
  power_avg?: string | number
  power_bike_tss_last?: string | number
  time_zone?: string
  file?: { url?: string }
}

interface WahooWorkout {
  id?: number | string
  name?: string
  starts?: string
  minutes?: number
  workout_type_id?: number
  workout_summary?: WahooSummary | null
}

/** Minutes east of UTC in an IANA zone at an instant, or null for a zone this runtime does not know. */
function zoneOffset(zone: string | undefined, at: number): number | null {
  if (!zone)
    return null
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(new Date(at)).find(part => part.type === 'timeZoneName')?.value
    if (name === 'GMT' || name === 'UTC')
      return 0
    const match = /([+-])(\d{2}):(\d{2})/.exec(name || '')
    if (!match)
      return null
    const minutes = Number(match[2]) * 60 + Number(match[3])
    return match[1] === '-' ? -minutes : minutes
  }
  catch {
    return null
  }
}

export interface WahooDriverOptions {
  baseUrl?: string
  /** Workouts asked for per page (Wahoo's default is 30). */
  pageSize?: number
}

export class WahooCloudDriver extends BaseDeviceCloudDriver {
  readonly name = 'Wahoo'
  readonly provider: 'wahoo' = 'wahoo'
  readonly supportedMetrics: ReadonlySet<HealthMetric> = new Set<HealthMetric>(['workouts'])
  private readonly baseUrl: string
  private readonly pageSize: number

  constructor(accessToken: string, options: WahooDriverOptions = {}) {
    super(accessToken)
    this.baseUrl = (options.baseUrl || WAHOO_API_BASE).replace(/\/$/, '')
    this.pageSize = options.pageSize ?? 50
  }

  private async call(path: string, init: RequestInit = {}, what = path): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json' } })
    if (!response.ok)
      throw await deviceCloudFailure('wahoo', response, what)
    return response
  }

  /** The person's Wahoo user id: what webhooks are addressed by. */
  async getUserId(): Promise<string> {
    const user = await (await this.call('/v1/user', {}, 'reading the user')).json() as { id?: number | string }
    if (user?.id === undefined || user.id === null)
      throw new DeviceCloudError('Wahoo answered no user id', { provider: 'wahoo', status: 200 })
    return String(user.id)
  }

  /** Take the app's access away (disconnecting). */
  async revokeAccess(): Promise<void> {
    await this.call('/v1/permissions', { method: 'DELETE' }, 'revoking access')
  }

  /** Newest first, page by page, until a workout older than the range. Capped at 40 pages. */
  async listActivities(options?: DateRangeOptions): Promise<CloudActivity[]> {
    const { from, to } = rangeOf(options, 30)
    const out: CloudActivity[] = []
    for (let page = 1; page <= 40; page++) {
      const data = await (await this.call(`/v1/workouts?page=${page}&per_page=${this.pageSize}`, {}, 'listing workouts')).json() as { workouts?: WahooWorkout[], total?: number }
      const workouts = Array.isArray(data?.workouts) ? data.workouts : []
      let older = false
      for (const workout of workouts) {
        const activity = this.toActivity(workout)
        if (!activity)
          continue
        const start = Date.parse(activity.startTime)
        if (start < from) {
          older = true
          continue
        }
        if (start <= to)
          out.push(activity)
      }
      const total = numeric(data?.total)
      if (older || workouts.length < this.pageSize || (total !== undefined && page * this.pageSize >= total))
        break
    }
    return out
  }

  private toActivity(workout: WahooWorkout): CloudActivity | null {
    const start = Date.parse(String(workout?.starts || ''))
    if (workout?.id === undefined || workout.id === null || !Number.isFinite(start))
      return null
    const summary = workout.workout_summary || {}
    const url = typeof summary.file?.url === 'string' && summary.file.url.trim() ? summary.file.url.trim() : undefined
    const typeId = numeric(workout.workout_type_id)
    return {
      id: String(workout.id),
      provider: 'wahoo',
      ...(workout.name ? { name: String(workout.name) } : {}),
      sport: typeId !== undefined ? WORKOUT_TYPES[typeId] ?? 'other' : 'other',
      startTime: new Date(start).toISOString(),
      utcOffsetMinutes: zoneOffset(summary.time_zone, start),
      durationSeconds: positive(summary.duration_active_accum) ?? positive(summary.duration_total_accum) ?? (positive(workout.minutes) !== undefined ? Number(workout.minutes) * 60 : null),
      distanceMeters: positive(summary.distance_accum) ?? null,
      averageHeartRate: positive(summary.heart_rate_avg),
      calories: positive(summary.calories_accum),
      ascentMeters: positive(summary.ascent_accum),
      averagePower: positive(summary.power_avg),
      trainingStress: positive(summary.power_bike_tss_last),
      hasFile: !!url,
      ...(url ? { fileUrl: url } : {}),
    }
  }

  /** The .fit from Wahoo's CDN: a plain download, which does not count against the API limits. */
  async downloadActivityFile(activity: CloudActivity): Promise<CloudActivityFile | null> {
    if (!activity.fileUrl)
      return null
    const url = new URL(activity.fileUrl)
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1')
      throw new DeviceCloudError('Wahoo file links must be https', { provider: 'wahoo', status: 0 })
    const response = await fetch(url, { headers: { Accept: 'application/octet-stream' } })
    return { bytes: await fileBytes('wahoo', response, 'downloading the .fit'), filename: `wahoo-${activity.id}.fit`, format: 'fit' }
  }
}

export function createWahooCloudDriver(accessToken: string, options: WahooDriverOptions = {}): WahooCloudDriver {
  return new WahooCloudDriver(accessToken, options)
}
