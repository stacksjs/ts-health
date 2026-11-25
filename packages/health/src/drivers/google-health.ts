import type {
  BodyTemperature,
  DailyActivity,
  DailyHydration,
  DailySleepSummary,
  DailySpO2,
  DateRangeOptions,
  HealthDriver,
  HealthMetric,
  HeartRateSample,
  HRVSample,
  HydrationSample,
  SleepSession,
  SleepStage,
  VO2MaxReading,
  WeightMeasurement,
  Workout,
} from '../types'

const source = 'google_health'
const api = 'https://health.googleapis.com/v4'
export const GOOGLE_HEALTH_SCOPES = {
  activity: 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  sleep: 'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  metrics: 'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  nutrition: 'https://www.googleapis.com/auth/googlehealth.nutrition.readonly',
} as const

const families = {
  [GOOGLE_HEALTH_SCOPES.activity]: ['dailyActivity', 'workouts', 'vo2Max'],
  [GOOGLE_HEALTH_SCOPES.sleep]: ['sleep'],
  [GOOGLE_HEALTH_SCOPES.metrics]: ['heartRate', 'restingHeartRate', 'hrv', 'spo2', 'bodyTemperature', 'weightMeasurements', 'respiratoryRate'],
  [GOOGLE_HEALTH_SCOPES.nutrition]: ['hydration', 'dailyHydration'],
} satisfies Record<string, HealthMetric[]>

export interface GoogleHealthOptions {
  /** The scopes from Google's token response, which can be a subset of those requested. */
  scopes?: string
  baseUrl?: string
  fetch?: typeof globalThis.fetch
}

export interface GoogleHealthIdentity {
  healthUserId: string
  legacyUserId?: string
}

export class GoogleHealthError extends Error {
  readonly retryAt?: string
  readonly retryAfterSeconds?: number

  constructor(readonly status: number, readonly reason?: string, retry?: string | null) {
    super(`Google Health API HTTP ${status}${reason ? ` (${reason})` : ''}`)
    this.name = 'GoogleHealthError'
    if (retry && /^\d+$/.test(retry)) this.retryAfterSeconds = Number(retry)
    else if (retry) this.retryAt = retry
  }
}

interface CivilDate { year: number, month: number, day: number }
interface CivilDateTime { date?: CivilDate }
interface SessionInterval { startTime?: string, endTime?: string, civilStartTime?: CivilDateTime, civilEndTime?: CivilDateTime, startUtcOffset?: string, endUtcOffset?: string }
interface SampleTime { physicalTime?: string, civilTime?: CivilDateTime, utcOffset?: string }
interface RecordPage<T> { dataPoints?: T[], rollupDataPoints?: T[], nextPageToken?: string }
type CalendarField = 'date' | 'sample_time.civil_time' | 'interval.civil_start_time' | 'interval.civil_end_time'
type CalendarReading = { date?: CivilDate }

const number = (value: unknown): number | undefined => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return
  const result = Number(value)
  return Number.isFinite(result) ? result : undefined
}
const positive = (value: unknown) => {
  const result = number(value)
  return result !== undefined && result > 0 ? result : undefined
}
const calendarDate = (date?: CivilDate) => date
  ? `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
  : undefined
const dayAt = (timestamp: string, civil?: CivilDateTime, offset?: string) =>
  calendarDate(civil?.date) ?? new Date(Date.parse(timestamp) + (number(offset?.replace(/s$/, '')) ?? 0) * 1000).toISOString().slice(0, 10)
const isoDay = (date: Date) => date.toISOString().slice(0, 10)
const shiftDay = (date: string, days: number) => isoDay(new Date(Date.parse(date) + days * 86400000))

function civilDay(day: string): CivilDateTime {
  const [year, month, date] = day.split('-').map(Number)
  return { date: { year: year!, month: month!, day: date! } }
}

function range(options: DateRangeOptions = {}) {
  const end = options.endDate ?? isoDay(new Date())
  const start = options.startDate ?? shiftDay(end, -6)
  for (const day of [start, end]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || isoDay(new Date(day)) !== day)
      throw new RangeError('Google Health requires calendar dates (YYYY-MM-DD)')
  }
  if (end < start) throw new RangeError('Invalid Google Health date range')
  return { start, end: shiftDay(end, 1) }
}

function sampleDay(time?: SampleTime) {
  const timestamp = time?.physicalTime
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return
  return { timestamp, day: dayAt(timestamp, time.civilTime, time.utcOffset) }
}

function sessionDates(interval?: SessionInterval) {
  const start = interval?.startTime
  const end = interval?.endTime
  if (!start || !end || !(Date.parse(end) > Date.parse(start))) return
  return {
    start,
    end,
    startDay: dayAt(start, interval.civilStartTime, interval.startUtcOffset),
    endDay: dayAt(end, interval.civilEndTime, interval.endUtcOffset),
    duration: (Date.parse(end) - Date.parse(start)) / 1000,
  }
}

const stageTypes: Record<string, SleepStage['stage']> = {
  AWAKE: 'awake', RESTLESS: 'awake', LIGHT: 'light', DEEP: 'deep', REM: 'rem', ASLEEP: 'unknown',
}

export class GoogleHealthDriver implements HealthDriver {
  readonly name = 'Google Health'
  readonly type: 'google_health' = source
  readonly supportedMetrics: ReadonlySet<HealthMetric>
  private readonly granted: Set<string>
  private readonly baseUrl: string
  private readonly send: typeof globalThis.fetch

  constructor(private readonly accessToken: string, options: GoogleHealthOptions = {}) {
    this.baseUrl = (options.baseUrl ?? api).replace(/\/$/, '')
    this.send = options.fetch ?? globalThis.fetch
    this.granted = new Set((options.scopes ?? Object.values(GOOGLE_HEALTH_SCOPES).join(' ')).split(/\s+/))
    this.supportedMetrics = new Set(Object.entries(families).flatMap(([permission, metrics]) => this.granted.has(permission) ? metrics : []))
  }

  isAuthenticated(): boolean { return !!this.accessToken }

  private async request<T>(path: string, params?: URLSearchParams, body?: object): Promise<T> {
    const response = await this.send(`${this.baseUrl}/users/me/${path}${params ? `?${params}` : ''}`, {
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { details?: Array<{ reason?: string }> } } | null
      const reason = payload?.error?.details?.find(detail => /^[A-Z_]+$/.test(detail.reason ?? ''))?.reason
      throw new GoogleHealthError(response.status, reason, response.headers.get('retry-after'))
    }
    return response.json() as Promise<T>
  }

  async getIdentity(): Promise<GoogleHealthIdentity> {
    const identity = await this.request<GoogleHealthIdentity>('identity')
    if (typeof identity.healthUserId !== 'string' || !identity.healthUserId) throw new Error('Google Health did not return an account ID')
    return identity
  }

  private async pages<T>(load: (pageToken?: string) => Promise<RecordPage<T>>): Promise<T[]> {
    const rows: T[] = []
    const consumed = new Set<string>()
    let token: string | undefined
    do {
      const page = await load(token)
      for (const row of page.dataPoints ?? page.rollupDataPoints ?? []) rows.push(row)
      token = page.nextPageToken
      if (!token) break
      if (consumed.has(token)) throw new Error('Google Health repeated a page token')
      consumed.add(token)
    } while (token)
    return rows
  }

  private reconcile<T>(type: string, field: CalendarField, options?: DateRangeOptions): Promise<T[]> {
    const { start, end } = range(options)
    const property = `${type.replaceAll('-', '_')}.${field}`
    const filter = `${property} >= "${start}" AND ${property} < "${end}"`
    const pageSize = type === 'sleep' || type === 'exercise' ? '25' : type === 'heart-rate' ? '10000' : '1000'
    return this.pages(token => this.request<RecordPage<T>>(`dataTypes/${type}/dataPoints:reconcile`,
      new URLSearchParams({ filter, pageSize, ...(token ? { pageToken: token } : {}) })))
  }

  private async dailyRollup<T>(type: string, options?: DateRangeOptions): Promise<Array<T & { civilStartTime?: CivilDateTime }>> {
    const { start, end } = range(options)
    const limit = type === 'total-calories' ? 14 : 90
    const rows: Array<T & { civilStartTime?: CivilDateTime }> = []
    for (let from = start; from < end;) {
      const until = [end, shiftDay(from, limit)].sort()[0]!
      const batch = await this.pages<T & { civilStartTime?: CivilDateTime }>(token =>
        this.request(`dataTypes/${type}/dataPoints:dailyRollUp`, undefined, {
          range: { start: civilDay(from), end: civilDay(until) },
          windowSizeDays: 1,
          ...(token ? { pageToken: token } : {}),
        }))
      rows.push(...batch)
      from = until
    }
    return rows
  }

  async getSleep(options?: DateRangeOptions): Promise<SleepSession[]> {
    type Stage = { type: string, startTime?: string, endTime?: string }
    type Sleep = {
      interval?: SessionInterval
      metadata?: { mainSleep?: boolean, nap?: boolean, processed?: boolean }
      summary?: { minutesInSleepPeriod?: string, minutesAsleep?: string, minutesAwake?: string, minutesToFallAsleep?: string, stagesSummary?: Array<{ type: string, minutes: string }> }
      stages?: Stage[]
    }
    const rows = await this.reconcile<{ dataPointName?: string, sleep?: Sleep }>('sleep', 'interval.civil_end_time', options)
    return rows.flatMap(({ dataPointName, sleep }) => {
      const times = sessionDates(sleep?.interval)
      if (!sleep || !times) return []
      const summary = sleep.summary
      const stages: SleepStage[] = (sleep.stages ?? []).flatMap(stage => {
        const startTime = stage.startTime
        const endTime = stage.endTime
        if (!startTime || !endTime) return []
        const duration = (Date.parse(endTime) - Date.parse(startTime)) / 1000
        return duration > 0 ? [{ stage: stageTypes[stage.type] ?? 'unknown', startTime, endTime, duration }] : []
      })
      const seconds = (type: string) => {
        const minutes = number(summary?.stagesSummary?.find(stage => stage.type === type)?.minutes)
        return minutes === undefined
          ? stages.filter(stage => stage.stage === stageTypes[type]).reduce((sum, stage) => sum + stage.duration, 0)
          : minutes * 60
      }
      const awakeTime = (number(summary?.minutesAwake) ?? seconds('AWAKE') / 60) * 60
      const totalSleepDuration = (number(summary?.minutesAsleep) ?? Math.max(0, times.duration - awakeTime) / 60) * 60
      const latency = number(summary?.minutesToFallAsleep)
      return [{
        id: dataPointName?.split('/').at(-1) || times.start, day: times.endDay,
        bedtimeStart: times.start, bedtimeEnd: times.end,
        type: sleep.metadata?.nap ? 'nap' : sleep.metadata?.mainSleep === false ? 'short_sleep' : 'long_sleep',
        totalSleepDuration,
        deepSleepDuration: seconds('DEEP'), lightSleepDuration: seconds('LIGHT'), remSleepDuration: seconds('REM'),
        awakeTime, timeInBed: times.duration, efficiency: Math.min(100, 100 * totalSleepDuration / times.duration),
        ...(latency === undefined ? {} : { latency: latency * 60 }),
        ...(sleep.metadata?.processed === false && !summary ? { processing: true } : {}),
        stages, source,
      }]
    })
  }

  async getDailySleep(options?: DateRangeOptions): Promise<DailySleepSummary[]> {
    return (await this.getSleep(options)).filter(row => row.type === 'long_sleep' && !row.processing)
      .map(row => ({ day: row.day, contributors: { totalSleep: row.totalSleepDuration / 3600 }, source }))
  }

  async getWorkouts(options?: DateRangeOptions): Promise<Workout[]> {
    type Exercise = {
      interval?: SessionInterval
      exerciseType?: string
      displayName?: string
      activeDuration?: string
      exerciseMetadata?: { hasGps?: boolean }
      metricsSummary?: { caloriesKcal?: number, distanceMillimeters?: number, averageHeartRateBeatsPerMinute?: string, elevationGainMillimeters?: number }
    }
    const rows = await this.reconcile<{ dataPointName?: string, exercise?: Exercise }>('exercise', 'interval.civil_start_time', options)
    return rows.flatMap(({ dataPointName, exercise }) => {
      const times = sessionDates(exercise?.interval)
      if (!exercise || !times) return []
      const metrics = exercise.metricsSummary
      const distance = number(metrics?.distanceMillimeters)
      const elevation = number(metrics?.elevationGainMillimeters)
      const active = positive(exercise.activeDuration?.replace(/s$/, ''))
      return [{
        id: dataPointName?.split('/').at(-1) || times.start, activity: exercise.exerciseType?.toLowerCase() || 'workout',
        day: times.startDay, startDatetime: times.start, endDatetime: times.end, label: exercise.displayName,
        calories: number(metrics?.caloriesKcal), averageHeartRate: positive(metrics?.averageHeartRateBeatsPerMinute),
        ...(distance === undefined ? {} : { distance: distance / 1000 }),
        details: { ...metrics, ...(elevation === undefined ? {} : { elevationGainMeters: elevation / 1000 }), ...(active === undefined ? {} : { activeDurationSeconds: active }), hasGps: exercise.exerciseMetadata?.hasGps === true },
        source,
      }]
    })
  }

  async getDailyActivity(options?: DateRangeOptions): Promise<DailyActivity[]> {
    const steps = await this.dailyRollup<{ steps?: { countSum: string } }>('steps', options)
    const energy = await this.dailyRollup<{ activeEnergyBurned?: { kcalSum: number } }>('active-energy-burned', options)
    const total = await this.dailyRollup<{ totalCalories?: { kcalSum: number } }>('total-calories', options)
    const distance = await this.dailyRollup<{ distance?: { millimetersSum: string } }>('distance', options)
    const days = new Map<string, DailyActivity>()
    const merge = (civil: CivilDateTime | undefined, field: keyof Pick<DailyActivity, 'steps' | 'activeCalories' | 'totalCalories' | 'equivalentWalkingDistance'>, value?: number) => {
      const day = calendarDate(civil?.date)
      if (!day || value === undefined) return
      days.set(day, { ...(days.get(day) ?? { day, score: 0, contributors: {}, source }), [field]: value })
    }
    for (const row of steps) merge(row.civilStartTime, 'steps', number(row.steps?.countSum))
    for (const row of energy) merge(row.civilStartTime, 'activeCalories', number(row.activeEnergyBurned?.kcalSum))
    for (const row of total) merge(row.civilStartTime, 'totalCalories', number(row.totalCalories?.kcalSum))
    for (const row of distance) {
      const millimeters = number(row.distance?.millimetersSum)
      merge(row.civilStartTime, 'equivalentWalkingDistance', millimeters === undefined ? undefined : millimeters / 1000)
    }
    return [...days.values()]
  }

  async getHeartRate(options?: DateRangeOptions): Promise<HeartRateSample[]> {
    const rows = await this.reconcile<{ heartRate?: { sampleTime?: SampleTime, beatsPerMinute?: string } }>('heart-rate', 'sample_time.civil_time', options)
    return rows.flatMap(({ heartRate }) => {
      const time = sampleDay(heartRate?.sampleTime)
      const bpm = positive(heartRate?.beatsPerMinute)
      return time && bpm ? [{ ...time, bpm }] : []
    })
  }

  async getRestingHeartRate(options?: DateRangeOptions): Promise<HeartRateSample[]> {
    const rows = await this.reconcile<{ dailyRestingHeartRate?: CalendarReading & { beatsPerMinute?: string } }>('daily-resting-heart-rate', 'date', options)
    return rows.flatMap(({ dailyRestingHeartRate }) => {
      const day = calendarDate(dailyRestingHeartRate?.date)
      const bpm = positive(dailyRestingHeartRate?.beatsPerMinute)
      return day && bpm ? [{ day, timestamp: `${day}T12:00:00Z`, bpm, source: 'resting' }] : []
    })
  }

  async getHRV(options?: DateRangeOptions): Promise<HRVSample[]> {
    const rows = await this.reconcile<{ dailyHeartRateVariability?: CalendarReading & { averageHeartRateVariabilityMilliseconds?: number } }>('daily-heart-rate-variability', 'date', options)
    return rows.flatMap(({ dailyHeartRateVariability }) => {
      const day = calendarDate(dailyHeartRateVariability?.date)
      const hrv = positive(dailyHeartRateVariability?.averageHeartRateVariabilityMilliseconds)
      return day && hrv ? [{ timestamp: `${day}T12:00:00Z`, hrv }] : []
    })
  }

  async getSpO2(options?: DateRangeOptions): Promise<DailySpO2[]> {
    const rows = await this.reconcile<{ dailyOxygenSaturation?: CalendarReading & { averagePercentage?: number } }>('daily-oxygen-saturation', 'date', options)
    return rows.flatMap(({ dailyOxygenSaturation }) => {
      const day = calendarDate(dailyOxygenSaturation?.date)
      const averageSpO2 = positive(dailyOxygenSaturation?.averagePercentage)
      // Google's bounds are a confidence interval, not measured minima and maxima.
      return day && averageSpO2 ? [{ day, averageSpO2, source }] : []
    })
  }

  async getRespiratoryRate(options?: DateRangeOptions): Promise<Array<{ day: string, breathsPerMinute: number, source: typeof source }>> {
    const rows = await this.reconcile<{ dailyRespiratoryRate?: CalendarReading & { breathsPerMinute?: number } }>('daily-respiratory-rate', 'date', options)
    return rows.flatMap(({ dailyRespiratoryRate }) => {
      const day = calendarDate(dailyRespiratoryRate?.date)
      const breathsPerMinute = positive(dailyRespiratoryRate?.breathsPerMinute)
      return day && breathsPerMinute ? [{ day, breathsPerMinute, source }] : []
    })
  }

  async getBodyTemperature(options?: DateRangeOptions): Promise<BodyTemperature[]> {
    const rows = await this.reconcile<{ dailySleepTemperatureDerivations?: CalendarReading & { nightlyTemperatureCelsius?: number, baselineTemperatureCelsius?: number } }>('daily-sleep-temperature-derivations', 'date', options)
    return rows.flatMap(row => {
      const reading = row.dailySleepTemperatureDerivations
      const day = calendarDate(reading?.date)
      const celsius = number(reading?.nightlyTemperatureCelsius)
      const baseline = number(reading?.baselineTemperatureCelsius)
      return day && celsius !== undefined ? [{ day, celsius, ...(baseline === undefined ? {} : { deviation: celsius - baseline }), source }] : []
    })
  }

  async getVO2Max(options?: DateRangeOptions): Promise<VO2MaxReading[]> {
    const rows = await this.reconcile<{ dailyVo2Max?: CalendarReading & { vo2Max?: number } }>('daily-vo2-max', 'date', options)
    return rows.flatMap(({ dailyVo2Max }) => {
      const day = calendarDate(dailyVo2Max?.date)
      const vo2Max = positive(dailyVo2Max?.vo2Max)
      return day && vo2Max ? [{ day, vo2Max, source }] : []
    })
  }

  async getWeightMeasurements(options?: DateRangeOptions): Promise<WeightMeasurement[]> {
    const weights = await this.reconcile<{ dataPointName?: string, weight?: { sampleTime?: SampleTime, weightGrams?: number } }>('weight', 'sample_time.civil_time', options)
    const fat = await this.reconcile<{ bodyFat?: { sampleTime?: SampleTime, percentage?: number } }>('body-fat', 'sample_time.civil_time', options)
    const percentages = new Map<number, number>()
    for (const { bodyFat } of fat) {
      const time = sampleDay(bodyFat?.sampleTime)
      const percentage = positive(bodyFat?.percentage)
      if (time && percentage !== undefined) percentages.set(Date.parse(time.timestamp), percentage)
    }
    return weights.flatMap(({ dataPointName, weight }) => {
      const time = sampleDay(weight?.sampleTime)
      const grams = positive(weight?.weightGrams)
      if (!time || !grams) return []
      const percentage = percentages.get(Date.parse(time.timestamp))
      return [{ ...time, id: dataPointName?.split('/').at(-1) || time.timestamp, weight: grams / 1000, bodyFatPercentage: percentage, source }]
    })
  }

  async getHydration(options?: DateRangeOptions): Promise<HydrationSample[]> {
    const rows = await this.reconcile<{ dataPointName?: string, hydrationLog?: { interval?: SessionInterval, amountConsumed?: { milliliters?: number } } }>('hydration-log', 'interval.civil_start_time', options)
    return rows.flatMap(({ dataPointName, hydrationLog }) => {
      const interval = hydrationLog?.interval
      const timestamp = interval?.startTime
      const volumeMl = positive(hydrationLog?.amountConsumed?.milliliters)
      if (!interval || !timestamp || !Number.isFinite(Date.parse(timestamp)) || !volumeMl) return []
      return [{ id: dataPointName?.split('/').at(-1) || timestamp, day: dayAt(timestamp, interval.civilStartTime, interval.startUtcOffset), timestamp, volumeMl, source, sourceName: this.name }]
    })
  }

  async getDailyHydration(options?: DateRangeOptions): Promise<DailyHydration[]> {
    const days = new Map<string, DailyHydration>()
    for (const row of await this.getHydration(options)) {
      const previous = days.get(row.day)
      days.set(row.day, { day: row.day, volumeMl: (previous?.volumeMl ?? 0) + row.volumeMl, samples: (previous?.samples ?? 0) + 1, source })
    }
    return [...days.values()]
  }

  async getReadiness(): Promise<[]> { return [] }
  async getStress(): Promise<[]> { return [] }
  async getBodyComposition(): Promise<[]> { return [] }
  async getPersonalInfo(): Promise<null> { return null }
}

export function createGoogleHealthDriver(accessToken: string, options?: GoogleHealthOptions): GoogleHealthDriver {
  return new GoogleHealthDriver(accessToken, options)
}
