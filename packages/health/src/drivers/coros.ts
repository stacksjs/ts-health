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
  93: 'e_biking',
  94: 'mountain_biking',
  95: 'e_mountain_biking',
  96: 'gravel_cycling',
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
  calorie?: number
  planWorkoutId?: string | number
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
  private readonly dailyCache = new Map<string, { at: number, promise: Promise<Array<CorosDay & { day: string }>> }>()

  constructor(accessToken: string, options: CorosDriverOptions) {
    super(accessToken)
    if (!options?.openId)
      throw new DeviceCloudError('COROS needs the openId from the token answer', { provider: 'coros', status: 0 })
    this.openId = options.openId
    this.baseUrl = (options.baseUrl || COROS_API_BASE).replace(/\/$/, '')
  }

  private async answer(response: Response, what: string): Promise<any> {
    if (!response.ok)
      throw await deviceCloudFailure('coros', response, what)
    const data: any = await response.json()
    const result = String(data?.result ?? '')
    if (!/^0+$/.test(result)) {
      const message = `COROS ${what} failed (result ${result || 'missing'})`
      if (AUTH_CODES.has(result))
        throw new DeviceCloudAuthError(message, { provider: 'coros', status: 401, code: result })
      throw new DeviceCloudError(message, { provider: 'coros', status: response.status, code: result })
    }
    return data.data
  }

  private async query(path: string, from: string, to: string, what: string): Promise<any> {
    const params = new URLSearchParams({ token: this.accessToken, openId: this.openId, startDate: compact(from), endDate: compact(to) })
    return this.answer(await fetch(`${this.baseUrl}${path}?${params}`, { headers: { Accept: 'application/json' } }), what)
  }

  private windows(options: DateRangeOptions | undefined, days: number): Array<{ from: string, to: string }> {
    const { from, to } = rangeOf(options, days)
    // The Partner API exposes three calendar months. Older requests fail,
    // including the start of a full-history sync, so clip before splitting.
    const today = new Date()
    const oldest = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, 1))
    oldest.setUTCDate(Math.min(today.getUTCDate(), new Date(Date.UTC(oldest.getUTCFullYear(), oldest.getUTCMonth() + 1, 0)).getUTCDate()))
    return dayWindows(ymdUtc(new Date(Math.max(from, oldest.getTime()))), ymdUtc(new Date(to)), 30)
  }

  private async post(path: string, form: Record<string, string>, what: string): Promise<any> {
    const body = new URLSearchParams({ token: this.accessToken, openId: this.openId, ...form })
    return this.answer(await fetch(`${this.baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }, body }), what)
  }

  /** One stable partner workout id survives edits, moves and retries. */
  async pushTrainingSchedule(schedule: CorosTrainingSchedule): Promise<void> {
    if (!Number.isSafeInteger(schedule.AthleteId) || schedule.AthleteId <= 0 || !schedule.Workouts.length || schedule.Workouts.length > 30)
      throw new DeviceCloudError('COROS needs an athlete id and 1–30 workouts per request', { provider: 'coros', status: 0 })
    const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day
    if (!validDay(schedule.StartDate) || !validDay(schedule.EndDate) || schedule.StartDate > schedule.EndDate || schedule.Workouts.some(workout => !Number.isSafeInteger(workout.Id) || workout.Id <= 0 || !validDay(workout.WorkoutDay) || workout.WorkoutDay < schedule.StartDate || workout.WorkoutDay > schedule.EndDate || !workout.Structure.length))
      throw new DeviceCloudError('COROS needs valid dates, workout ids and structured steps', { provider: 'coros', status: 0 })
    await this.post('/coros/tp/list/push', { data: JSON.stringify(schedule) }, 'sending planned workouts')
  }

  /** A successful HTTP/result response can still contain individual failures. */
  async deleteTrainingWorkouts(workoutIds: number[]): Promise<void> {
    if (!workoutIds.length) return
    if (workoutIds.some(id => !Number.isSafeInteger(id) || id <= 0))
      throw new DeviceCloudError('COROS workout ids must be positive safe integers', { provider: 'coros', status: 0 })
    const data = await this.post('/coros/tp/workout/deleteById', { workoutIds: JSON.stringify(workoutIds) }, 'removing planned workouts')
    const successes = new Set((data?.successIdList || []).map(String))
    if (data?.failIdList?.length || workoutIds.some(id => !successes.has(String(id))))
      throw new DeviceCloudError('COROS did not remove every planned workout', { provider: 'coros', status: 200 })
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
      const rows = await this.query('/v2/coros/sport/list', window.from, window.to, 'listing workouts')
      if (!Array.isArray(rows))
        throw new DeviceCloudError('COROS workout response carried no activity list', { provider: 'coros', status: 200 })
      for (const workout of rows) {
        const activity = this.toActivity(workout)
        if (activity && !out.some(known => known.id === activity.id))
          out.push(activity)
      }
    }
    return out.sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))
  }

  private toActivity(workout: CorosWorkout): CloudActivity | null {
    const start = numeric(workout?.startTime)
    if (workout?.labelId === undefined || workout.labelId === null || start === undefined || start <= 0 || !Number.isFinite(new Date(start * 1000).getTime()))
      return null
    const end = numeric(workout.endTime)
    const zone = numeric(workout.startTimezone)
    const sport = SPORTS[(numeric(workout.mode) ?? 0) * 10 + (numeric(workout.subMode) ?? 0)]
    return {
      id: String(workout.labelId),
      provider: 'coros',
      ...(workout.planWorkoutId != null ? { plannedWorkoutId: String(workout.planWorkoutId) } : {}),
      ...(positive(workout.calorie) !== undefined ? { calories: Number(workout.calorie) / 1000 } : {}),
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
    const windows = this.windows(options, 30)
    const key = JSON.stringify(windows)
    const cached = this.dailyCache.get(key)
    if (cached && Date.now() - cached.at < 60_000) return cached.promise
    this.dailyCache.delete(key)
    const pending = (async () => {
        const days = new Map<string, CorosDay & { day: string }>()
        for (const window of windows) {
          const data = await this.query('/coros/daily/query', window.from, window.to, 'reading daily data')
          // Current API wraps dailyList; retain the legacy array dialect.
          const rows = Array.isArray(data) ? data : data?.dailyList
          if (!Array.isArray(rows))
            throw new DeviceCloudError('COROS daily response carried no dailyList', { provider: 'coros', status: 200 })
          for (const row of rows) {
            const day = happenDay(row?.happenDay)
            if (day && day >= window.from && day <= window.to)
              days.set(day, { ...row, day })
          }
        }
        return [...days.values()]
      })()
    if (this.dailyCache.size >= 16) this.dailyCache.delete(this.dailyCache.keys().next().value!)
    this.dailyCache.set(key, { at: Date.now(), promise: pending })
    void pending.catch(() => {
      if (this.dailyCache.get(key)?.promise === pending) this.dailyCache.delete(key)
    })
    return pending
  }

  async getDailyActivity(options?: DateRangeOptions): Promise<DailyActivity[]> {
    return (await this.days(options)).filter(row => numeric(row.step) !== undefined).map(row => ({
      day: row.day,
      score: 0,
      activeCalories: 0,
      totalCalories: (positive(row.calorie) ?? 0) / 1000,
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

/** COROS Partner API training-plan wire types (case is significant). */
export interface CorosTrainingStep {
  Type: 'Step' | 'Repetition'
  Length: { Unit: 'Second' | 'Meter' | 'Reps' | 'EndManually' | 'Repetition', Value: number }
  IntensityClass?: 'WarmUp' | 'CoolDown' | 'Active' | 'Rest'
  Name?: string
  Description?: string
  Ftp?: number
  ThresholdHr?: number
  ThresholdSpeed?: number
  Rest?: { Unit: 'Second' | 'Bpm' | 'EndManually', Value: number }
  IntensityTarget?: { Unit: 'PercentOfFtp' | 'PercentOfThresholdHr' | 'PercentOfThresholdSpeed' | 'RangeOfFtp' | 'RangeOfCandence' | 'RangeOfThresholdHr' | 'RangeOfThresholdSpeed' | 'ValueOfEquipmentWeight' | 'ValueOfWeight' | 'ValueOfStroke', MinValue?: number, MaxValue?: number, Value?: number }
  Steps?: CorosTrainingStep[]
}

export interface CorosTrainingWorkout {
  Id: number
  Title: string
  Description?: string
  LastModifiedDate: string
  WorkoutDay: string
  WorkoutType: 'Run' | 'trailRun' | 'Bike' | 'Swim' | 'Strength'
  TotalTime?: number
  StartTime?: string
  Structure: CorosTrainingStep[]
}

export interface CorosTrainingSchedule {
  AthleteId: number
  StartDate: string
  EndDate: string
  Workouts: CorosTrainingWorkout[]
}
