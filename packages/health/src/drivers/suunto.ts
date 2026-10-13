import type { DailyActivity, DateRangeOptions, HealthMetric, HRVSample, SleepSession } from '../types'
import type { CloudActivity, CloudActivityFile } from './device-cloud'
import { BaseDeviceCloudDriver, DeviceCloudError, deviceCloudFailure, fileBytes, numeric, positive, rangeOf } from './device-cloud'

/**
 * Suunto's Cloud API (https://apizone.suunto.com), open to companies in
 * Suunto's partner program. Every call carries the user's bearer token and
 * the app's API Management subscription key (`Ocp-Apim-Subscription-Key`).
 *
 * - Workouts: `GET /v3/workouts?since&until&limit` (epoch milliseconds,
 *   answered as `{ error, metadata, payload }`) and the original recording at
 *   `GET /v3/workouts/{workoutKey}/fit`. The FIT endpoint answers 500 to a
 *   FIT media type in Accept, so this asks for any.
 * - 24/7: sleep (`/247samples/sleep?from&to`, one sample a night with its
 *   stages, average HRV and quality score) and daily totals
 *   (`/247samples/daily-activity-statistics?startdate&enddate`, StepCount and
 *   EnergyConsumption in joules).
 *
 * The Developer tier is limited to 10 calls a minute and 200 a week;
 * production partners get more. A 429 becomes a DeviceCloudRateLimitError.
 */

const SUUNTO_API_BASE = 'https://cloudapi.suunto.com'

/** Suunto's activity ids (the FIT activity ids in Suunto's mapping), as sport keys. */
const ACTIVITIES: Record<number, string> = {
  0: 'walking',
  1: 'running',
  2: 'cycling',
  3: 'cross_country_skiing',
  10: 'mountain_biking',
  11: 'hiking',
  12: 'roller_skating',
  13: 'downhill_skiing',
  14: 'paddling',
  15: 'rowing',
  16: 'golf',
  17: 'indoor',
  20: 'outdoor_gym',
  21: 'pool_swimming',
  22: 'trail_running',
  23: 'gym',
  24: 'nordic_walking',
  29: 'climbing',
  30: 'snowboarding',
  31: 'ski_touring',
  32: 'fitness_class',
  51: 'yoga',
  52: 'indoor_cycling',
  53: 'treadmill_running',
  54: 'crossfit',
  55: 'elliptical',
  56: 'roller_skiing',
  57: 'indoor_rowing',
  58: 'stretching',
  59: 'track_running',
  60: 'orienteering',
  61: 'stand_up_paddling',
  63: 'kettlebell',
  64: 'dancing',
  65: 'snowshoeing',
  68: 'multisport',
  69: 'aerobics',
  70: 'trekking',
  72: 'kayaking',
  73: 'circuit_training',
  74: 'triathlon',
  77: 'boxing',
  82: 'canoeing',
  83: 'mountaineering',
  85: 'open_water_swimming',
  92: 'swimrun',
  93: 'duathlon',
  95: 'obstacle_racing',
}

interface SuuntoWorkout {
  workoutKey?: string
  workoutName?: string
  activityId?: number
  startTime?: number
  totalTime?: number
  totalDistance?: number
  totalAscent?: number
  timeOffsetInMinutes?: number
  energyConsumption?: number
  hrdata?: { workoutAvgHR?: number, workoutMaxHR?: number, avg?: number, max?: number }
}

interface SuuntoSample {
  timestamp?: string
  entryData?: Record<string, unknown>
}

export interface SuuntoDriverOptions {
  /** The app's subscription key from Suunto's API Zone profile. */
  subscriptionKey: string
  baseUrl?: string
}

function list<T>(data: any): T[] {
  if (Array.isArray(data))
    return data
  if (Array.isArray(data?.payload))
    return data.payload
  return []
}

export class SuuntoCloudDriver extends BaseDeviceCloudDriver {
  readonly name = 'Suunto'
  readonly provider: 'suunto' = 'suunto'
  readonly supportedMetrics: ReadonlySet<HealthMetric> = new Set<HealthMetric>(['workouts', 'sleep', 'hrv', 'dailyActivity'])
  private readonly baseUrl: string
  private readonly subscriptionKey: string

  constructor(accessToken: string, options: SuuntoDriverOptions) {
    super(accessToken)
    if (!options?.subscriptionKey)
      throw new DeviceCloudError('Suunto needs the app\'s API subscription key', { provider: 'suunto', status: 0 })
    this.subscriptionKey = options.subscriptionKey
    this.baseUrl = (options.baseUrl || SUUNTO_API_BASE).replace(/\/$/, '')
  }

  private headers(accept = 'application/json'): Record<string, string> {
    return { 'Authorization': `Bearer ${this.accessToken}`, 'Ocp-Apim-Subscription-Key': this.subscriptionKey, 'Accept': accept }
  }

  private async json(path: string, what: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() })
    if (response.status === 204 || response.status === 404)
      return null
    if (!response.ok)
      throw await deviceCloudFailure('suunto', response, what)
    const data: any = await response.json()
    if (data?.error)
      throw new DeviceCloudError(`Suunto ${what} failed: ${typeof data.error === 'string' ? data.error : data.error.description || data.error.code}`, { provider: 'suunto', status: response.status, code: typeof data.error === 'object' ? data.error.code : undefined })
    return data
  }

  async listActivities(options?: DateRangeOptions): Promise<CloudActivity[]> {
    const { from, to } = rangeOf(options, 30)
    const data = await this.json(`/v3/workouts?since=${from}&until=${to}&limit=1000&filter-by-modification-time=false`, 'listing workouts')
    return list<SuuntoWorkout>(data)
      .map(workout => this.toActivity(workout))
      .filter((activity): activity is CloudActivity => !!activity)
      .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))
  }

  private toActivity(workout: SuuntoWorkout): CloudActivity | null {
    const start = numeric(workout?.startTime)
    if (!workout?.workoutKey || start === undefined)
      return null
    const activityId = numeric(workout.activityId)
    return {
      id: String(workout.workoutKey),
      provider: 'suunto',
      ...(workout.workoutName ? { name: String(workout.workoutName) } : {}),
      sport: activityId !== undefined ? ACTIVITIES[activityId] ?? `activity_${activityId}` : 'other',
      startTime: new Date(start).toISOString(),
      utcOffsetMinutes: numeric(workout.timeOffsetInMinutes) ?? null,
      durationSeconds: positive(workout.totalTime) ?? null,
      distanceMeters: positive(workout.totalDistance) ?? null,
      averageHeartRate: positive(workout.hrdata?.workoutAvgHR ?? workout.hrdata?.avg),
      maxHeartRate: positive(workout.hrdata?.workoutMaxHR ?? workout.hrdata?.max),
      calories: positive(workout.energyConsumption),
      ascentMeters: positive(workout.totalAscent),
      hasFile: true,
    }
  }

  async downloadActivityFile(activity: CloudActivity): Promise<CloudActivityFile | null> {
    const response = await fetch(`${this.baseUrl}/v3/workouts/${encodeURIComponent(activity.id)}/fit`, { headers: this.headers('*/*') })
    if (response.status === 204 || response.status === 404)
      return null
    return { bytes: await fileBytes('suunto', response, 'downloading the .fit'), filename: `suunto-${activity.id}.fit`, format: 'fit' }
  }

  /** One sample a night: its stages, heart rate, average HRV and quality score. */
  async getSleep(options?: DateRangeOptions): Promise<SleepSession[]> {
    const { from, to } = rangeOf(options, 30)
    const samples = list<SuuntoSample>(await this.json(`/247samples/sleep?from=${from}&to=${to}`, 'reading sleep'))
    const nights: SleepSession[] = []
    for (const sample of samples) {
      const entry = sample?.entryData || {}
      if (entry.IsNap === true)
        continue
      const start = String(entry.BedtimeStart || '')
      const end = String(entry.BedtimeEnd || '')
      const startMs = Date.parse(start)
      const endMs = Date.parse(end)
      const deep = numeric(entry.DeepSleepDuration) ?? 0
      const light = numeric(entry.LightSleepDuration) ?? 0
      const rem = numeric(entry.REMSleepDuration) ?? 0
      const inBed = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs ? Math.round((endMs - startMs) / 1000) : numeric(entry.Duration) ?? 0
      const total = deep + light + rem || numeric(entry.Duration) || 0
      // The morning it ended, in the wearer's own day: the date part of an
      // offset timestamp is local.
      const day = (end || start || String(sample?.timestamp || '')).slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !total)
        continue
      const score = positive(entry.SleepQualityScore)
      const hrv = positive(entry.AvgHRV)
      const average = positive(entry.HRAvg)
      const lowest = positive(entry.HRMin)
      nights.push({
        id: String(entry.SleepId ?? `suunto-${day}`),
        day,
        bedtimeStart: start,
        bedtimeEnd: end,
        type: 'long_sleep',
        totalSleepDuration: total,
        deepSleepDuration: deep,
        lightSleepDuration: light,
        remSleepDuration: rem,
        awakeTime: (numeric(entry.WakeAfterSleepOnsetDuration) ?? 0) + (numeric(entry.WakeBeforeOffBedDuration) ?? 0),
        timeInBed: inBed,
        latency: numeric(entry.SleepOnsetLatencyDuration) ?? 0,
        efficiency: inBed > 0 ? Math.round(total / inBed * 100) : 0,
        ...(score !== undefined ? { score } : {}),
        ...(hrv !== undefined ? { averageHRV: hrv } : {}),
        ...(average !== undefined ? { averageHeartRate: average } : {}),
        ...(lowest !== undefined ? { lowestHeartRate: lowest } : {}),
        stages: [],
        source: 'suunto',
      })
    }
    return nights
  }

  async getHRV(options?: DateRangeOptions): Promise<HRVSample[]> {
    return (await this.getSleep(options))
      .filter(night => night.averageHRV !== undefined)
      .map(night => ({ timestamp: night.day, hrv: night.averageHRV! }))
  }

  /** Steps and energy a day; Suunto reports energy in joules. */
  async getDailyActivity(options?: DateRangeOptions): Promise<DailyActivity[]> {
    const { from, to } = rangeOf(options, 30)
    const groups = list<any>(await this.json(`/247samples/daily-activity-statistics?startdate=${encodeURIComponent(new Date(from).toISOString())}&enddate=${encodeURIComponent(new Date(to).toISOString())}`, 'reading daily activity'))
    const days = new Map<string, { steps?: number, joules?: number }>()
    for (const group of groups) {
      const name = String(group?.Name || '').toLowerCase()
      if (name !== 'stepcount' && name !== 'energyconsumption')
        continue
      for (const source of Array.isArray(group.Sources) ? group.Sources : []) {
        for (const sample of Array.isArray(source?.Samples) ? source.Samples : []) {
          const day = String(sample?.TimeISO8601 || '').slice(0, 10)
          const value = numeric(sample?.Value)
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || value === undefined)
            continue
          const totals = days.get(day) || {}
          // Several sources (the watch and the phone) report the same day: the larger is the day's count.
          if (name === 'stepcount')
            totals.steps = Math.max(totals.steps ?? 0, value)
          else
            totals.joules = Math.max(totals.joules ?? 0, value)
          days.set(day, totals)
        }
      }
    }
    return [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, totals]) => ({
      day,
      score: 0,
      activeCalories: 0,
      totalCalories: totals.joules !== undefined ? Math.round(totals.joules / 4184) : 0,
      ...(totals.steps !== undefined ? { steps: Math.round(totals.steps) } : {}),
      contributors: {},
      source: 'suunto' as const,
    }))
  }
}

export function createSuuntoCloudDriver(accessToken: string, options: SuuntoDriverOptions): SuuntoCloudDriver {
  return new SuuntoCloudDriver(accessToken, options)
}
