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
  WhoopCycle,
  WhoopRecovery,
  WhoopSleep,
  WhoopWorkout,
  WhoopBodyMeasurement,
} from '../types'

const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer'

interface WhoopListResponse<T> {
  records: T[]
  next_token: string | null
}

export class WhoopDriver implements HealthDriver {
  readonly name = 'WHOOP'
  readonly type = 'whoop' as const

  private accessToken: string
  private baseUrl: string

  constructor(accessToken: string, baseUrl?: string) {
    this.accessToken = accessToken
    this.baseUrl = baseUrl ?? WHOOP_API_BASE
  }

  isAuthenticated(): boolean {
    return this.accessToken.length > 0
  }

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
      throw new Error(`WHOOP API error ${response.status}: ${body}`)
    }

    return response.json() as Promise<T>
  }

  private async fetchAllPages<T>(endpoint: string, params?: Record<string, string>): Promise<T[]> {
    const allData: T[] = []
    let nextToken: string | null = null

    do {
      const queryParams = { ...params }
      if (nextToken) {
        queryParams.nextToken = nextToken
      }

      const response = await this.request<WhoopListResponse<T>>(endpoint, queryParams)
      allData.push(...response.records)
      nextToken = response.next_token
    } while (nextToken)

    return allData
  }

  private buildDateParams(options?: DateRangeOptions): Record<string, string> {
    const params: Record<string, string> = {}
    if (options?.startDate) params.start = `${options.startDate}T00:00:00.000Z`
    if (options?.endDate) params.end = `${options.endDate}T23:59:59.999Z`
    return params
  }

  // ===========================================================================
  // Sleep
  // ===========================================================================

  async getSleep(options?: DateRangeOptions): Promise<SleepSession[]> {
    const params = this.buildDateParams(options)
    const raw = await this.fetchAllPages<WhoopSleep>('/v1/activity/sleep', params)

    return raw.map(s => this.mapSleepSession(s))
  }

  async getDailySleep(options?: DateRangeOptions): Promise<DailySleepSummary[]> {
    const sleepSessions = await this.getSleep(options)

    return sleepSessions.map(s => ({
      day: s.day,
      score: s.efficiency,
      contributors: {
        efficiency: s.efficiency,
        deepSleep: s.deepSleepDuration > 0 ? Math.min(100, Math.round((s.deepSleepDuration / s.totalSleepDuration) * 200)) : undefined,
        remSleep: s.remSleepDuration > 0 ? Math.min(100, Math.round((s.remSleepDuration / s.totalSleepDuration) * 200)) : undefined,
      },
      source: 'whoop' as const,
    }))
  }

  // ===========================================================================
  // Activity (Cycles / Strain)
  // ===========================================================================

  async getDailyActivity(options?: DateRangeOptions): Promise<DailyActivity[]> {
    const params = this.buildDateParams(options)
    const raw = await this.fetchAllPages<WhoopCycle>('/v1/cycle', params)

    return raw
      .filter(c => c.score !== null)
      .map(c => ({
        day: c.start.slice(0, 10),
        score: Math.round((c.score!.strain / 21) * 100),
        activeCalories: Math.round(c.score!.kilojoule * 0.239),
        totalCalories: Math.round(c.score!.kilojoule * 0.239),
        steps: 0,
        equivalentWalkingDistance: 0,
        highActivityTime: 0,
        mediumActivityTime: 0,
        lowActivityTime: 0,
        sedentaryTime: 0,
        restingTime: 0,
        nonWearTime: 0,
        inactivityAlerts: 0,
        targetCalories: 0,
        targetMeters: 0,
        metersToTarget: 0,
        averageMetLevel: 0,
        contributors: {},
        timestamp: c.start,
        source: 'whoop' as const,
      }))
  }

  // ===========================================================================
  // Workouts
  // ===========================================================================

  async getWorkouts(options?: DateRangeOptions): Promise<Workout[]> {
    const params = this.buildDateParams(options)
    const raw = await this.fetchAllPages<WhoopWorkout>('/v1/activity/workout', params)

    return raw.map(w => ({
      id: w.id.toString(),
      activity: `sport_${w.sport_id}`,
      day: w.start.slice(0, 10),
      startDatetime: w.start,
      endDatetime: w.end,
      calories: w.score ? Math.round(w.score.kilojoule * 0.239) : undefined,
      distance: w.score?.distance_meter ?? undefined,
      averageHeartRate: w.score?.average_heart_rate,
      maxHeartRate: w.score?.max_heart_rate,
      source: 'whoop' as const,
    }))
  }

  // ===========================================================================
  // Readiness (Recovery)
  // ===========================================================================

  async getReadiness(options?: DateRangeOptions): Promise<DailyReadiness[]> {
    const params = this.buildDateParams(options)
    const raw = await this.fetchAllPages<WhoopRecovery>('/v1/recovery', params)

    return raw
      .filter(r => r.score !== null)
      .map(r => ({
        day: r.created_at.slice(0, 10),
        score: r.score!.recovery_score,
        contributors: {
          restingHeartRate: r.score!.resting_heart_rate,
          hrvBalance: Math.round(r.score!.hrv_rmssd_milli),
        },
        timestamp: r.created_at,
        source: 'whoop' as const,
      }))
  }

  // ===========================================================================
  // Heart Rate
  // ===========================================================================

  async getHeartRate(_options?: DateRangeOptions): Promise<HeartRateSample[]> {
    // WHOOP doesn't expose raw HR samples via API; derive from cycles
    const cycles = await this.getDailyActivity(_options)

    return cycles
      .filter(c => c.timestamp)
      .map(c => ({
        timestamp: c.timestamp!,
        bpm: 0,
        source: 'cycle_average',
      }))
  }

  // ===========================================================================
  // HRV
  // ===========================================================================

  async getHRV(options?: DateRangeOptions): Promise<HRVSample[]> {
    const recoveries = await this.getReadiness(options)

    return recoveries
      .filter(r => r.contributors.hrvBalance !== undefined)
      .map(r => ({
        timestamp: r.timestamp ?? `${r.day}T00:00:00Z`,
        hrv: r.contributors.hrvBalance!,
      }))
  }

  // ===========================================================================
  // SpO2
  // ===========================================================================

  async getSpO2(options?: DateRangeOptions): Promise<DailySpO2[]> {
    const params = this.buildDateParams(options)
    const raw = await this.fetchAllPages<WhoopRecovery>('/v1/recovery', params)

    return raw
      .filter(r => r.score?.spo2_percentage != null)
      .map(r => ({
        day: r.created_at.slice(0, 10),
        averageSpO2: r.score!.spo2_percentage!,
        source: 'whoop' as const,
      }))
  }

  // ===========================================================================
  // Stress (via strain)
  // ===========================================================================

  async getStress(options?: DateRangeOptions): Promise<DailyStress[]> {
    const cycles = await this.getDailyActivity(options)

    return cycles.map(c => ({
      day: c.day,
      stressHigh: c.score,
      source: 'whoop' as const,
    }))
  }

  // ===========================================================================
  // Body Temperature
  // ===========================================================================

  async getBodyTemperature(options?: DateRangeOptions): Promise<BodyTemperature[]> {
    const params = this.buildDateParams(options)
    const raw = await this.fetchAllPages<WhoopRecovery>('/v1/recovery', params)

    return raw
      .filter(r => r.score?.skin_temp_celsius != null)
      .map(r => ({
        day: r.created_at.slice(0, 10),
        deviation: r.score!.skin_temp_celsius!,
        source: 'whoop' as const,
      }))
  }

  // ===========================================================================
  // VO2 Max (not available via WHOOP API)
  // ===========================================================================

  async getVO2Max(_options?: DateRangeOptions): Promise<VO2MaxReading[]> {
    return []
  }

  // ===========================================================================
  // Body Composition (not supported by WHOOP)
  // ===========================================================================

  async getBodyComposition(): Promise<BodyComposition[]> { return [] }
  async getWeightMeasurements(): Promise<WeightMeasurement[]> { return [] }

  // ===========================================================================
  // Personal Info
  // ===========================================================================

  async getPersonalInfo(): Promise<PersonalInfo | null> {
    try {
      const body = await this.request<WhoopBodyMeasurement>('/v1/user/measurement/body')
      return {
        weight: body.weight_kilogram,
        height: body.height_meter,
      }
    }
    catch {
      return null
    }
  }

  // ===========================================================================
  // Mapping helpers
  // ===========================================================================

  private mapSleepSession(raw: WhoopSleep): SleepSession {
    const score = raw.score
    const day = raw.start.slice(0, 10)

    return {
      id: raw.id.toString(),
      day,
      bedtimeStart: raw.start,
      bedtimeEnd: raw.end,
      type: raw.nap ? 'nap' : 'long_sleep',
      totalSleepDuration: score ? Math.round(
        (score.stage_summary.total_light_sleep_time_milli
          + score.stage_summary.total_slow_wave_sleep_time_milli
          + score.stage_summary.total_rem_sleep_time_milli) / 1000
      ) : 0,
      deepSleepDuration: score ? Math.round(score.stage_summary.total_slow_wave_sleep_time_milli / 1000) : 0,
      lightSleepDuration: score ? Math.round(score.stage_summary.total_light_sleep_time_milli / 1000) : 0,
      remSleepDuration: score ? Math.round(score.stage_summary.total_rem_sleep_time_milli / 1000) : 0,
      awakeTime: score ? Math.round(score.stage_summary.total_awake_time_milli / 1000) : 0,
      timeInBed: score ? Math.round(score.stage_summary.total_in_bed_time_milli / 1000) : 0,
      latency: 0,
      efficiency: score?.sleep_efficiency_percentage ?? 0,
      averageBreath: score?.respiratory_rate ?? undefined,
      restlessPeriods: score?.stage_summary.disturbance_count,
      stages: [],
      source: 'whoop' as const,
    }
  }
}

export function createWhoopDriver(accessToken: string, baseUrl?: string): WhoopDriver {
  return new WhoopDriver(accessToken, baseUrl)
}
