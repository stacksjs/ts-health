import type {
  HealthMetric,
  HealthDriver,
  DateRangeOptions,
  SleepSession,
  DailySleepSummary,
  DailyActivity,
  Workout,
  DailyReadiness,
  HeartRateSample,
  HRVSample,
  DailySpO2,
  DailyStress,
  BodyTemperature,
  VO2MaxReading,
  BodyComposition,
  WeightMeasurement,
  PersonalInfo,
  DeviceInfo,
  OuraListResponse,
  OuraSleepResponse,
  OuraDailySleepResponse,
  OuraDailyActivityResponse,
  OuraDailyReadinessResponse,
  OuraHeartRateResponse,
  OuraWorkoutResponse,
  OuraDailySpO2Response,
  OuraDailyStressResponse,
  OuraVO2MaxResponse,
  OuraPersonalInfoResponse,
  OuraRingConfigurationResponse,
} from '../types'

/** Daily values retain Oura's calendar day, units and nullable scores. */
export interface OuraDailyHealth {
  day: string
  sleepHours?: number
  sleepScore?: number
  averageHRV?: number
  restingHeartRate?: number
  readiness?: number
  steps?: number
  activeCalories?: number
  details: Array<{ label: string, value: number | string }>
}

export interface OuraDailyHealthResult {
  days: OuraDailyHealth[]
  errors: Array<{ endpoint: string, message: string }>
}

const OURA_API_BASE = 'https://api.ouraring.com'

export class OuraDriver implements HealthDriver {
  readonly name = 'Oura Ring'
  readonly type: 'oura' = 'oura'
  readonly supportedMetrics: ReadonlySet<HealthMetric> = new Set<HealthMetric>([
    'sleep', 'dailySleep', 'dailyActivity', 'workouts', 'readiness',
    'heartRate', 'hrv', 'spo2', 'stress', 'bodyTemperature', 'vo2Max', 'personalInfo',
  ])

  private accessToken: string
  private baseUrl: string

  constructor(accessToken: string, baseUrl?: string) {
    this.accessToken = accessToken
    this.baseUrl = baseUrl ?? OURA_API_BASE
  }

  isAuthenticated(): boolean {
    return this.accessToken.length > 0
  }

  // ===========================================================================
  // Private API helpers
  // ===========================================================================

  private async request<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`)

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, value)
        }
      }
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Oura API error ${response.status}: ${body}`)
    }

    return response.json() as Promise<T>
  }

  private async fetchAllPages<T>(endpoint: string, params?: Record<string, string>): Promise<T[]> {
    const allData: T[] = []
    let nextToken: string | null = null

    do {
      const queryParams = { ...params }
      if (nextToken) {
        queryParams.next_token = nextToken
      }

      const response = await this.request<OuraListResponse<T>>(endpoint, queryParams)
      allData.push(...response.data)
      nextToken = response.next_token
    } while (nextToken)

    return allData
  }

  /** `start_datetime`/`end_datetime` for the collections filtered by instant rather than by day. */
  private buildDatetimeParams(options?: DateRangeOptions): Record<string, string> {
    const params: Record<string, string> = {}
    if (options?.startDate)
      params.start_datetime = toOuraDatetime(options.startDate, 'startDate', false)
    if (options?.endDate)
      params.end_datetime = toOuraDatetime(options.endDate, 'endDate', true)
    return params
  }

  private buildDateParams(options?: DateRangeOptions): Record<string, string> {
    const params: Record<string, string> = {}

    if (options?.startDate) {
      params.start_date = options.startDate
    }

    if (options?.endDate) {
      params.end_date = options.endDate
    }

    return params
  }

  /**
   * A daily recovery feed. Sleep/HRV use the longest main sleep on Oura's
   * reported day, so a later nap cannot replace the night's recovery values.
   * Contributor scores stay in details; they are never treated as bpm/hours.
   * Calendar-day bounds are inclusive, including the final night's readings.
   * Independent endpoint failures retain the other readings and remain visible.
   */
  async getDailyHealth(options?: DateRangeOptions): Promise<OuraDailyHealthResult> {
    const params = this.buildDateParams(options)
    // Oura's detailed sleep window excludes end_date. Daily summaries can
    // include that day, so query through the following midnight and clip all
    // joined records to the caller's inclusive calendar-day range.
    if (options?.endDate) {
      const end = Date.parse(`${options.endDate}T00:00:00Z`)
      if (!Number.isFinite(end) || new Date(end).toISOString().slice(0, 10) !== options.endDate)
        throw new RangeError('endDate must be a valid yyyy-mm-dd calendar day')
      params.end_date = new Date(end + 86400000).toISOString().slice(0, 10)
    }
    const days = new Map<string, OuraDailyHealth>()
    const errors: OuraDailyHealthResult['errors'] = []
    const day = (date: string) => {
      const value = days.get(date) ?? { day: date, details: [] }
      days.set(date, value)
      return value
    }
    const detail = (target: OuraDailyHealth, label: string, value: unknown) => {
      if (typeof value === 'number' && Number.isFinite(value)) target.details.push({ label, value })
    }
    const read = async <T>(endpoint: string, map: (rows: T[]) => void) => {
      try { map(await this.fetchAllPages<T>(`/v2/usercollection/${endpoint}`, params)) }
      catch (cause) { errors.push({ endpoint, message: cause instanceof Error ? cause.message : String(cause) }) }
    }
    await read<OuraSleepResponse>('sleep', rows => {
      const nights = new Map<string, OuraSleepResponse>()
      for (const row of rows) {
        if (row.type !== 'long_sleep' && row.type !== 'sleep') continue
        const previous = nights.get(row.day)
        if (!previous || row.total_sleep_duration > previous.total_sleep_duration) nights.set(row.day, row)
      }
      for (const row of nights.values()) {
        const target = day(row.day)
        if (row.total_sleep_duration != null) target.sleepHours = row.total_sleep_duration / 3600
        if (row.average_hrv != null) target.averageHRV = row.average_hrv
        if (row.lowest_heart_rate != null) target.restingHeartRate = row.lowest_heart_rate
        detail(target, 'Deep sleep (hours)', row.deep_sleep_duration == null ? null : row.deep_sleep_duration / 3600)
        detail(target, 'REM sleep (hours)', row.rem_sleep_duration == null ? null : row.rem_sleep_duration / 3600)
        detail(target, 'Light sleep (hours)', row.light_sleep_duration == null ? null : row.light_sleep_duration / 3600)
        detail(target, 'Awake (minutes)', row.awake_time == null ? null : row.awake_time / 60)
        detail(target, 'Sleep efficiency (%)', row.efficiency)
        detail(target, 'Respiratory rate (breaths/min)', row.average_breath)
      }
    })
    await read<OuraDailySleepResponse>('daily_sleep', rows => {
      for (const row of rows) {
        const target = day(row.day)
        if (row.score != null) target.sleepScore = row.score
      }
    })
    await read<OuraDailyReadinessResponse>('daily_readiness', rows => {
      for (const row of rows) {
        const target = day(row.day)
        if (row.score != null) target.readiness = row.score
        detail(target, 'Temperature deviation (°C)', row.temperature_deviation)
        for (const [key, value] of Object.entries(row.contributors ?? {}))
          detail(target, `Readiness: ${key.replaceAll('_', ' ')} (score)`, value)
      }
    })
    await read<OuraDailyActivityResponse>('daily_activity', rows => {
      for (const row of rows) {
        const target = day(row.day)
        if (row.steps != null) target.steps = row.steps
        if (row.active_calories != null) target.activeCalories = row.active_calories
        detail(target, 'Activity score', row.score)
        detail(target, 'Total calories (kcal)', row.total_calories)
      }
    })
    return { days: [...days.values()].filter(value => (!options?.startDate || value.day >= options.startDate) && (!options?.endDate || value.day <= options.endDate)).sort((a, b) => a.day.localeCompare(b.day)), errors }
  }

  // ===========================================================================
  // Sleep
  // ===========================================================================

  async getSleep(options?: DateRangeOptions): Promise<SleepSession[]> {
    const params = this.buildDateParams(options)
    const raw = await this.fetchAllPages<OuraSleepResponse>('/v2/usercollection/sleep', params)

    return raw.map(s => this.mapSleepSession(s))
  }

  async getDailySleep(options?: DateRangeOptions): Promise<DailySleepSummary[]> {
    const params = this.buildDateParams(options)
    const raw = await this.fetchAllPages<OuraDailySleepResponse>('/v2/usercollection/daily_sleep', params)

    return raw.map(s => ({
      day: s.day,
      score: s.score ?? 0,
      contributors: {
        deepSleep: s.contributors.deep_sleep ?? undefined,
        efficiency: s.contributors.efficiency ?? undefined,
        latency: s.contributors.latency ?? undefined,
        remSleep: s.contributors.rem_sleep ?? undefined,
        restfulness: s.contributors.restfulness ?? undefined,
        timing: s.contributors.timing ?? undefined,
        totalSleep: s.contributors.total_sleep ?? undefined,
      },
      timestamp: s.timestamp,
      source: 'oura' as const,
    }))
  }

  // ===========================================================================
  // Activity
  // ===========================================================================

  async getDailyActivity(options?: DateRangeOptions): Promise<DailyActivity[]> {
    const params = this.buildDateParams(options)
    const raw = await this.fetchAllPages<OuraDailyActivityResponse>('/v2/usercollection/daily_activity', params)

    return raw.map(a => ({
      day: a.day,
      score: a.score ?? 0,
      activeCalories: a.active_calories,
      totalCalories: a.total_calories,
      steps: a.steps,
      equivalentWalkingDistance: a.equivalent_walking_distance,
      highActivityTime: a.high_activity_time,
      mediumActivityTime: a.medium_activity_time,
      lowActivityTime: a.low_activity_time,
      sedentaryTime: a.sedentary_time,
      restingTime: a.resting_time,
      nonWearTime: a.non_wear_time,
      inactivityAlerts: a.inactivity_alerts,
      targetCalories: a.target_calories,
      targetMeters: a.target_meters,
      metersToTarget: a.meters_to_target,
      averageMetLevel: a.average_met_level,
      contributors: {
        meetDailyTargets: a.contributors.meet_daily_targets ?? undefined,
        moveEveryHour: a.contributors.move_every_hour ?? undefined,
        recoveryTime: a.contributors.recovery_time ?? undefined,
        stayActive: a.contributors.stay_active ?? undefined,
        trainingFrequency: a.contributors.training_frequency ?? undefined,
        trainingVolume: a.contributors.training_volume ?? undefined,
      },
      timestamp: a.timestamp,
      source: 'oura' as const,
    }))
  }

  // ===========================================================================
  // Workouts
  // ===========================================================================

  async getWorkouts(options?: DateRangeOptions): Promise<Workout[]> {
    const params = this.buildDateParams(options)
    const raw = await this.fetchAllPages<OuraWorkoutResponse>('/v2/usercollection/workout', params)

    return raw.map(w => ({
      id: w.id,
      activity: w.activity,
      day: w.day,
      startDatetime: w.start_datetime,
      endDatetime: w.end_datetime,
      calories: w.calories ?? undefined,
      distance: w.distance ?? undefined,
      intensity: this.mapIntensity(w.intensity),
      label: w.label ?? undefined,
      source: 'oura' as const,
    }))
  }

  // ===========================================================================
  // Readiness
  // ===========================================================================

  async getReadiness(options?: DateRangeOptions): Promise<DailyReadiness[]> {
    const params = this.buildDateParams(options)
    const raw = await this.fetchAllPages<OuraDailyReadinessResponse>('/v2/usercollection/daily_readiness', params)

    return raw.map(r => ({
      day: r.day,
      score: r.score ?? 0,
      temperatureDeviation: r.temperature_deviation ?? undefined,
      temperatureTrendDeviation: r.temperature_trend_deviation ?? undefined,
      contributors: {
        activityBalance: r.contributors.activity_balance ?? undefined,
        bodyTemperature: r.contributors.body_temperature ?? undefined,
        hrvBalance: r.contributors.hrv_balance ?? undefined,
        previousDayActivity: r.contributors.previous_day_activity ?? undefined,
        previousNight: r.contributors.previous_night ?? undefined,
        recoveryIndex: r.contributors.recovery_index ?? undefined,
        restingHeartRate: r.contributors.resting_heart_rate ?? undefined,
        sleepBalance: r.contributors.sleep_balance ?? undefined,
      },
      timestamp: r.timestamp,
      source: 'oura' as const,
    }))
  }

  // ===========================================================================
  // Heart Rate
  // ===========================================================================

  /**
   * Oura's heart-rate readings (about every five minutes, plus workouts).
   * Unlike the daily collections, this one is filtered by `start_datetime`
   * and `end_datetime`; it ignores `start_date`/`end_date` and answers its
   * default window instead. A full ISO datetime is passed through; a calendar
   * day runs from its UTC midnight, and an ending day is included whole.
   */
  async getHeartRate(options?: DateRangeOptions): Promise<HeartRateSample[]> {
    const params = this.buildDatetimeParams(options)
    const raw = await this.fetchAllPages<OuraHeartRateResponse>('/v2/usercollection/heartrate', params)

    return raw.map(hr => ({
      timestamp: hr.timestamp,
      bpm: hr.bpm,
      source: hr.source,
    }))
  }

  // ===========================================================================
  // HRV
  // ===========================================================================

  async getHRV(options?: DateRangeOptions): Promise<HRVSample[]> {
    const sleepSessions = await this.getSleep(options)
    const samples: HRVSample[] = []

    for (const session of sleepSessions) {
      if (session.hrvSamples) {
        samples.push(...session.hrvSamples)
      }
    }

    return samples
  }

  // ===========================================================================
  // SpO2
  // ===========================================================================

  async getSpO2(options?: DateRangeOptions): Promise<DailySpO2[]> {
    const params = this.buildDateParams(options)
    const raw = await this.fetchAllPages<OuraDailySpO2Response>('/v2/usercollection/daily_spo2', params)

    return raw.map(s => ({
      day: s.day,
      averageSpO2: s.spo2_percentage.average,
      source: 'oura' as const,
    }))
  }

  // ===========================================================================
  // Stress
  // ===========================================================================

  async getStress(options?: DateRangeOptions): Promise<DailyStress[]> {
    const params = this.buildDateParams(options)
    const raw = await this.fetchAllPages<OuraDailyStressResponse>('/v2/usercollection/daily_stress', params)

    return raw.map(s => ({
      day: s.day,
      stressHigh: s.stress_high ?? undefined,
      recoveryHigh: s.recovery_high ?? undefined,
      daySummary: s.day_summary ?? undefined,
      source: 'oura' as const,
    }))
  }

  // ===========================================================================
  // Body Temperature
  // ===========================================================================

  async getBodyTemperature(options?: DateRangeOptions): Promise<BodyTemperature[]> {
    const readiness = await this.getReadiness(options)

    return readiness
      .filter(r => r.temperatureDeviation !== undefined)
      .map(r => ({
        day: r.day,
        deviation: r.temperatureDeviation,
        trendDeviation: r.temperatureTrendDeviation,
        source: 'oura' as const,
      }))
  }

  // ===========================================================================
  // VO2 Max
  // ===========================================================================

  async getVO2Max(options?: DateRangeOptions): Promise<VO2MaxReading[]> {
    const params = this.buildDateParams(options)
    const raw = await this.fetchAllPages<OuraVO2MaxResponse>('/v2/usercollection/vO2_max', params)

    return raw.map(v => ({
      day: v.day,
      vo2Max: v.vo2_max,
      source: 'oura' as const,
    }))
  }

  // ===========================================================================
  // Body Composition (not supported by Oura Ring)
  // ===========================================================================

  async getBodyComposition(): Promise<BodyComposition[]> { return [] }
  async getWeightMeasurements(): Promise<WeightMeasurement[]> { return [] }

  // ===========================================================================
  // Personal Info
  // ===========================================================================

  async getPersonalInfo(): Promise<PersonalInfo | null> {
    const raw = await this.request<OuraPersonalInfoResponse>('/v2/usercollection/personal_info')

    return {
      id: raw.id,
      age: raw.age ?? undefined,
      weight: raw.weight ?? undefined,
      height: raw.height ?? undefined,
      biologicalSex: this.mapBiologicalSex(raw.biological_sex),
      email: raw.email ?? undefined,
    }
  }

  // ===========================================================================
  // Ring Configuration
  // ===========================================================================

  async getRingConfiguration(): Promise<DeviceInfo[]> {
    const raw = await this.fetchAllPages<OuraRingConfigurationResponse>('/v2/usercollection/ring_configuration')

    return raw.map(r => ({
      id: r.id,
      type: 'oura' as const,
      model: r.design ?? undefined,
      firmwareVersion: r.firmware_version ?? undefined,
      hardwareType: r.hardware_type ?? undefined,
      color: r.color ?? undefined,
      size: r.size ?? undefined,
      setupAt: r.set_up_at ?? undefined,
    }))
  }

  // ===========================================================================
  // Oura-specific: Sessions & Tags
  // ===========================================================================

  async getSessions(options?: DateRangeOptions): Promise<OuraSessionResponse[]> {
    const params = this.buildDateParams(options)
    return this.fetchAllPages<OuraSessionResponse>('/v2/usercollection/session', params)
  }

  async getTags(options?: DateRangeOptions): Promise<OuraTagResponse[]> {
    const params = this.buildDateParams(options)
    return this.fetchAllPages<OuraTagResponse>('/v2/usercollection/tag', params)
  }

  async getRestModePeriods(options?: DateRangeOptions): Promise<OuraRestModeResponse[]> {
    const params = this.buildDateParams(options)
    return this.fetchAllPages<OuraRestModeResponse>('/v2/usercollection/rest_mode_period', params)
  }

  // ===========================================================================
  // Mapping helpers
  // ===========================================================================

  private mapSleepSession(raw: OuraSleepResponse): SleepSession {
    const hrvSamples: HRVSample[] = []
    const heartRateSamples: HeartRateSample[] = []

    if (raw.hrv) {
      const startTime = new Date(raw.hrv.timestamp).getTime()
      for (let i = 0; i < raw.hrv.items.length; i++) {
        const value = raw.hrv.items[i]
        if (value !== null) {
          hrvSamples.push({
            timestamp: new Date(startTime + i * raw.hrv.interval * 1000).toISOString(),
            hrv: value,
          })
        }
      }
    }

    if (raw.heart_rate) {
      const startTime = new Date(raw.heart_rate.timestamp).getTime()
      for (let i = 0; i < raw.heart_rate.items.length; i++) {
        const value = raw.heart_rate.items[i]
        if (value !== null) {
          heartRateSamples.push({
            timestamp: new Date(startTime + i * raw.heart_rate.interval * 1000).toISOString(),
            bpm: value,
          })
        }
      }
    }

    return {
      id: raw.id,
      day: raw.day,
      bedtimeStart: raw.bedtime_start,
      bedtimeEnd: raw.bedtime_end,
      type: this.mapSleepType(raw.type),
      totalSleepDuration: raw.total_sleep_duration,
      deepSleepDuration: raw.deep_sleep_duration,
      lightSleepDuration: raw.light_sleep_duration,
      remSleepDuration: raw.rem_sleep_duration,
      awakeTime: raw.awake_time,
      timeInBed: raw.time_in_bed,
      latency: raw.latency,
      efficiency: raw.efficiency,
      averageHeartRate: raw.average_heart_rate ?? undefined,
      lowestHeartRate: raw.lowest_heart_rate ?? undefined,
      averageHRV: raw.average_hrv ?? undefined,
      averageBreath: raw.average_breath ?? undefined,
      restlessPeriods: raw.restless_periods ?? undefined,
      heartRateSamples: heartRateSamples.length > 0 ? heartRateSamples : undefined,
      hrvSamples: hrvSamples.length > 0 ? hrvSamples : undefined,
      sleepPhases: raw.sleep_phase_5_min ?? undefined,
      stages: this.parseSleepPhases(raw.sleep_phase_5_min, raw.bedtime_start),
      readinessScore: raw.readiness?.score ?? undefined,
      source: 'oura' as const,
    }
  }

  private parseSleepPhases(phases: string | null, bedtimeStart: string): SleepSession['stages'] {
    if (!phases) return []

    const stageMap: Record<string, SleepSession['stages'][number]['stage']> = {
      '1': 'deep',
      '2': 'light',
      '3': 'rem',
      '4': 'awake',
    }

    const stages: SleepSession['stages'] = []
    const startTime = new Date(bedtimeStart).getTime()
    const intervalMs = 5 * 60 * 1000

    let currentStage: string | null = null
    let stageStart = 0

    for (let i = 0; i <= phases.length; i++) {
      const phase = i < phases.length ? phases[i] : null

      if (phase !== currentStage) {
        if (currentStage !== null && stageMap[currentStage]) {
          stages.push({
            stage: stageMap[currentStage],
            startTime: new Date(startTime + stageStart * intervalMs).toISOString(),
            endTime: new Date(startTime + i * intervalMs).toISOString(),
            duration: (i - stageStart) * 5 * 60,
          })
        }
        currentStage = phase
        stageStart = i
      }
    }

    return stages
  }

  private mapSleepType(type: OuraSleepResponse['type']): SleepSession['type'] {
    switch (type) {
      case 'long_sleep': return 'long_sleep'
      case 'sleep': return 'long_sleep'
      case 'late_nap': return 'nap'
      case 'rest': return 'rest'
      default: return 'unknown'
    }
  }

  private mapIntensity(intensity: string): Workout['intensity'] {
    switch (intensity.toLowerCase()) {
      case 'easy': return 'easy'
      case 'moderate': return 'moderate'
      case 'hard': return 'hard'
      case 'rest': return 'rest'
      default: return undefined
    }
  }

  private mapBiologicalSex(sex: string | null): PersonalInfo['biologicalSex'] {
    if (!sex) return undefined
    switch (sex.toLowerCase()) {
      case 'male': return 'male'
      case 'female': return 'female'
      default: return 'other'
    }
  }
}

// Oura-specific response types for sessions, tags, rest mode
export interface OuraSessionResponse {
  id: string
  day: string
  start_datetime: string
  end_datetime: string
  type: string
  heart_rate: {
    interval: number
    items: Array<number | null>
    timestamp: string
  } | null
  hrv: {
    interval: number
    items: Array<number | null>
    timestamp: string
  } | null
  mood: string | null
  motion_count: {
    interval: number
    items: Array<number | null>
    timestamp: string
  } | null
}

export interface OuraTagResponse {
  id: string
  day: string
  text: string | null
  timestamp: string
  tags: string[]
}

export interface OuraRestModeResponse {
  id: string
  end_day: string | null
  end_date: string | null
  start_day: string
  start_date: string
  episodes: Array<{
    tags: string[]
    timestamp: string
  }>
}

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * A caller's date as the datetime Oura's heartrate collection takes. A
 * calendar day becomes its UTC midnight, or the next one for an inclusive
 * ending day; anything else must parse as an instant and is sent as given.
 */
function toOuraDatetime(value: string, name: string, inclusiveEnd: boolean): string {
  if (CALENDAR_DAY.test(value)) {
    const midnight = Date.parse(`${value}T00:00:00Z`)
    if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== value)
      throw new RangeError(`${name} must be a valid yyyy-mm-dd calendar day or an ISO datetime`)
    return new Date(inclusiveEnd ? midnight + 86400000 : midnight).toISOString()
  }
  if (!Number.isFinite(Date.parse(value)))
    throw new RangeError(`${name} must be a valid yyyy-mm-dd calendar day or an ISO datetime`)
  return value
}

export function createOuraDriver(accessToken: string, baseUrl?: string): OuraDriver {
  return new OuraDriver(accessToken, baseUrl)
}
