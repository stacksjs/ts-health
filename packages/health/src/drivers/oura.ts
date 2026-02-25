import type {
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

const OURA_API_BASE = 'https://api.ouraring.com'

export class OuraDriver implements HealthDriver {
  readonly name = 'Oura Ring'
  readonly type = 'oura' as const

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

  async getHeartRate(options?: DateRangeOptions): Promise<HeartRateSample[]> {
    const params = this.buildDateParams(options)
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

export function createOuraDriver(accessToken: string, baseUrl?: string): OuraDriver {
  return new OuraDriver(accessToken, baseUrl)
}
