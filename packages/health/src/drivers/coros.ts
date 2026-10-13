import type { DailyActivity, DateRangeOptions, HealthMetric, HeartRateSample, HRVSample, SleepSession } from '../types'
import type { CloudActivity, CloudActivityFile } from './device-cloud'
import { BaseDeviceCloudDriver, DeviceCloudAuthError, DeviceCloudError, dayWindows, deviceCloudFailure, fileBytes, numeric, positive, rangeOf, ymdUtc } from './device-cloud'

/**
 * COROS' Open API (open.coros.com), for partners only: COROS sends its API
 * reference (V2.0.x) to an approved partner and publishes nothing. What this
 * reads is the part every public integration of it agrees on:
 *
 * - `GET /v2/coros/sport/list?token&openId&startDate&endDate` (dates as
 *   YYYYMMDD, at most 30 days a request), answered as
 *   `{ result: '0000', message, data: [...] }`. Each activity has `labelId`,
 *   `mode` and `subMode` (the sport), `startTime`/`endTime` (epoch seconds),
 *   `startTimezone` (in quarter hours), `distance`, and `fitUrl`, the original
 *   recording on COROS' file host.
 * - `GET /coros/daily/query?token&openId&startDate&endDate`: per day
 *   (`happenDay`, YYYYMMDD) the steps, resting heart rate (`rhr`), the night's
 *   HRV (`ppgHrv`) and the sleep window.
 *
 * Errors come back with HTTP 200 and a non-zero `result`; 5006 and 5010 mean
 * the token is no longer valid.
 */

const COROS_API_BASE = 'https://open.coros.com'

/** mode × 10 + subMode, as sport keys. */
const SPORTS: Record<number, string> = {
  81: 'running',
  82: 'treadmill_running',
  91: 'cycling',
  92: 'indoor_cycling',
  101: 'open_water_swimming',
  102: 'pool_swimming',
  131: 'triathlon',
  132: 'multisport',
  133: 'ski_touring',
  141: 'mountaineering',
  151: 'trail_running',
  161: 'hiking',
  181: 'gps_cardio',
  182: 'gym_cardio',
  191: 'cross_country_skiing',
  201: 'track_running',
  211: 'skiing',
  212: 'snowboarding',
  232: 'strength_training',
  241: 'rowing',
  242: 'indoor_rowing',
  251: 'whitewater',
  261: 'flatwater',
  271: 'windsurfing',
  281: 'speedsurfing',
  291: 'ski_touring',
  311: 'walking',
  332: 'climbing',
  342: 'jump_rope',
}

const AUTH_CODES = new Set(['5006', '5010'])

interface CorosWorkout {
  labelId?: string | number
  mode?: number
  subMode?: number
  startTime?: number
  endTime?: number
  startTimezone?: number
  distance?: number
  duration?: number
  fitUrl?: string
}

interface CorosDay {
  happenDay?: string | number
  step?: number
  calorie?: number
  rhr?: number
  ppgHrv?: number
  sleepAvgHr?: number
  sleepStartTime?: string | number
  sleepEndTime?: string | number
  startTimezone?: number
  endTimezone?: number
}

export interface CorosDriverOptions {
  /** COROS' id for the person, from the token answer. */
  openId: string
  baseUrl?: string
}

const compact = (ymd: string): string => ymd.replace(/-/g, '')

function happenDay(value: unknown): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value ?? '').trim())
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null
}

/** An instant from epoch seconds or milliseconds, or a local "YYYY-MM-DD HH:MM[:SS]" at `offsetMinutes`. */
function instant(value: unknown, offsetMinutes: number | null): number | null {
  const number = numeric(value)
  if (number !== undefined)
    return number < 1e12 ? number * 1000 : number
  const text = String(value ?? '').trim()
  if (!text)
    return null
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
    const parsed = Date.parse(text.replace(' ', 'T'))
    return Number.isFinite(parsed) ? parsed : null
  }
  const wall = Date.parse(`${text.replace(' ', 'T')}Z`)
  return Number.isFinite(wall) ? wall - (offsetMinutes ?? 0) * 60_000 : null
}

export class CorosCloudDriver extends BaseDeviceCloudDriver {
  readonly name = 'COROS'
  readonly provider: 'coros' = 'coros'
  readonly supportedMetrics: ReadonlySet<HealthMetric> = new Set<HealthMetric>(['workouts', 'sleep', 'hrv', 'heartRate', 'dailyActivity'])
  private readonly baseUrl: string
  private readonly openId: string

  constructor(accessToken: string, options: CorosDriverOptions) {
    super(accessToken)
    if (!options?.openId)
      throw new DeviceCloudError('COROS needs the openId from the token answer', { provider: 'coros', status: 0 })
    this.openId = options.openId
    this.baseUrl = (options.baseUrl || COROS_API_BASE).replace(/\/$/, '')
  }

  private async query<T>(path: string, from: string, to: string, what: string): Promise<T[]> {
    const params = new URLSearchParams({ token: this.accessToken, openId: this.openId, startDate: compact(from), endDate: compact(to) })
    const response = await fetch(`${this.baseUrl}${path}?${params}`, { headers: { Accept: 'application/json' } })
    if (!response.ok)
      throw await deviceCloudFailure('coros', response, what)
    const data: any = await response.json()
    const result = String(data?.result ?? '')
    if (!/^0+$/.test(result)) {
      const message = `COROS ${what} failed (result ${result || 'missing'})${data?.message ? `: ${data.message}` : ''}`
      if (AUTH_CODES.has(result))
        throw new DeviceCloudAuthError(message, { provider: 'coros', status: 401, code: result })
      throw new DeviceCloudError(message, { provider: 'coros', status: response.status, code: result })
    }
    return Array.isArray(data?.data) ? data.data : []
  }

  private windows(options: DateRangeOptions | undefined, days: number): Array<{ from: string, to: string }> {
    const { from, to } = rangeOf(options, days)
    return dayWindows(ymdUtc(new Date(from)), ymdUtc(new Date(to)), 30)
  }

  /** End HQ's access: COROS' reference has the token in the query (`POST /oauth2/deauthorize?token=`). */
  async deauthorize(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/oauth2/deauthorize?${new URLSearchParams({ token: this.accessToken })}`, { method: 'POST', headers: { Accept: 'application/json' } })
    if (!response.ok)
      throw await deviceCloudFailure('coros', response, 'deauthorizing')
    const data: any = await response.json().catch(() => null)
    const result = String(data?.result ?? '0000')
    if (!/^0+$/.test(result))
      throw new DeviceCloudError(`COROS deauthorizing failed (result ${result})`, { provider: 'coros', status: response.status, code: result })
  }

  async listActivities(options?: DateRangeOptions): Promise<CloudActivity[]> {
    const out: CloudActivity[] = []
    for (const window of this.windows(options, 30)) {
      for (const workout of await this.query<CorosWorkout>('/v2/coros/sport/list', window.from, window.to, 'listing workouts')) {
        const activity = this.toActivity(workout)
        if (activity && !out.some(known => known.id === activity.id))
          out.push(activity)
      }
    }
    return out.sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))
  }

  private toActivity(workout: CorosWorkout): CloudActivity | null {
    const start = numeric(workout?.startTime)
    if (workout?.labelId === undefined || workout.labelId === null || start === undefined)
      return null
    const end = numeric(workout.endTime)
    const zone = numeric(workout.startTimezone)
    const sport = SPORTS[(numeric(workout.mode) ?? 0) * 10 + (numeric(workout.subMode) ?? 0)]
    return {
      id: String(workout.labelId),
      provider: 'coros',
      sport: sport ?? `mode_${workout.mode}_${workout.subMode}`,
      startTime: new Date(start * 1000).toISOString(),
      utcOffsetMinutes: zone !== undefined ? zone * 15 : null,
      durationSeconds: positive(workout.duration) ?? (end !== undefined && end > start ? end - start : null),
      distanceMeters: positive(workout.distance) ?? null,
      hasFile: !!workout.fitUrl,
      ...(workout.fitUrl ? { fileUrl: String(workout.fitUrl) } : {}),
    }
  }

  /** The recording behind `fitUrl`, on COROS' file host: a plain download, no token. */
  async downloadActivityFile(activity: CloudActivity): Promise<CloudActivityFile | null> {
    if (!activity.fileUrl)
      return null
    const url = new URL(activity.fileUrl)
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1')
      throw new DeviceCloudError('COROS file links must be https', { provider: 'coros', status: 0 })
    const response = await fetch(url, { headers: { Accept: '*/*' } })
    return { bytes: await fileBytes('coros', response, 'downloading the .fit'), filename: `coros-${activity.id}.fit`, format: 'fit' }
  }

  private async days(options?: DateRangeOptions): Promise<Array<CorosDay & { day: string }>> {
    const out: Array<CorosDay & { day: string }> = []
    for (const window of this.windows(options, 30)) {
      for (const row of await this.query<CorosDay>('/coros/daily/query', window.from, window.to, 'reading daily data')) {
        const day = happenDay(row?.happenDay)
        if (day)
          out.push({ ...row, day })
      }
    }
    return out
  }

  async getDailyActivity(options?: DateRangeOptions): Promise<DailyActivity[]> {
    return (await this.days(options)).filter(row => numeric(row.step) !== undefined).map(row => ({
      day: row.day,
      score: 0,
      activeCalories: 0,
      totalCalories: 0,
      steps: Math.round(numeric(row.step)!),
      contributors: {},
      source: 'coros' as const,
    }))
  }

  /** The day's resting heart rate, as one reading marked `resting`. */
  async getHeartRate(options?: DateRangeOptions): Promise<HeartRateSample[]> {
    return (await this.days(options)).filter(row => positive(row.rhr) !== undefined).map(row => ({ timestamp: row.day, bpm: Number(row.rhr), source: 'resting' }))
  }

  async getHRV(options?: DateRangeOptions): Promise<HRVSample[]> {
    return (await this.days(options)).filter(row => positive(row.ppgHrv) !== undefined).map(row => ({ timestamp: row.day, hrv: Number(row.ppgHrv) }))
  }

  /** The night's window and its average heart rate; COROS sends no stages here. */
  async getSleep(options?: DateRangeOptions): Promise<SleepSession[]> {
    const nights: SleepSession[] = []
    for (const row of await this.days(options)) {
      const startZone = numeric(row.startTimezone)
      const endZone = numeric(row.endTimezone)
      const start = instant(row.sleepStartTime, startZone !== undefined ? startZone * 15 : endZone !== undefined ? endZone * 15 : null)
      const end = instant(row.sleepEndTime, endZone !== undefined ? endZone * 15 : startZone !== undefined ? startZone * 15 : null)
      if (start === null || end === null || end <= start || end - start > 86_400_000)
        continue
      const seconds = Math.round((end - start) / 1000)
      const average = positive(row.sleepAvgHr)
      const hrv = positive(row.ppgHrv)
      nights.push({
        id: `coros-${row.day}`,
        day: row.day,
        bedtimeStart: new Date(start).toISOString(),
        bedtimeEnd: new Date(end).toISOString(),
        type: 'long_sleep',
        totalSleepDuration: seconds,
        deepSleepDuration: 0,
        lightSleepDuration: 0,
        remSleepDuration: 0,
        awakeTime: 0,
        timeInBed: seconds,
        latency: 0,
        efficiency: 0,
        ...(average !== undefined ? { averageHeartRate: average } : {}),
        ...(hrv !== undefined ? { averageHRV: hrv } : {}),
        stages: [],
        source: 'coros',
      })
    }
    return nights
  }
}

export function createCorosCloudDriver(accessToken: string, options: CorosDriverOptions): CorosCloudDriver {
  return new CorosCloudDriver(accessToken, options)
}
