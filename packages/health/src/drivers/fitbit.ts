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
} from '../types'

const FITBIT_API_BASE = 'https://api.fitbit.com'

// Fitbit API response types
interface FitbitSleepResponse {
  sleep: Array<{
    dateOfSleep: string
    duration: number
    efficiency: number
    endTime: string
    isMainSleep: boolean
    levels: {
      summary: {
        deep?: {
          count: number
          minutes: number
        }
        light?: {
          count: number
          minutes: number
        }
        rem?: {
          count: number
          minutes: number
        }
        wake?: {
          count: number
          minutes: number
        }
        asleep?: {
          count: number
          minutes: number
        }
        restless?: {
          count: number
          minutes: number
        }
        awake?: {
          count: number
          minutes: number
        }
      }
      data: Array<{
        dateTime: string
        level: string
        seconds: number
      }>
    }
    logId: number
    minutesAfterWakeup: number
    minutesAsleep: number
    minutesToFallAsleep: number
    startTime: string
    timeInBed: number
    type: 'stages' | 'classic'
  }>
  summary: {
    totalMinutesAsleep: number
    totalSleepRecords: number
    totalTimeInBed: number
  }
}

interface FitbitActivityResponse {
  summary: {
    activityCalories: number
    caloriesBMR: number
    caloriesOut: number
    distances: Array<{
      activity: string
      distance: number
    }>
    fairlyActiveMinutes: number
    lightlyActiveMinutes: number
    sedentaryMinutes: number
    steps: number
    veryActiveMinutes: number
  }
}

interface FitbitHeartRateResponse {
  'activities-heart': Array<{
    dateTime: string
    value: {
      customHeartRateZones: unknown[]
      heartRateZones: Array<{
        caloriesOut: number
        max: number
        min: number
        minutes: number
        name: string
      }>
      restingHeartRate?: number
    }
  }>
  'activities-heart-intraday'?: {
    dataset: Array<{
      time: string
      value: number
    }>
    datasetInterval: number
    datasetType: string
  }
}

interface FitbitHRVResponse {
  hrv: Array<{
    dateTime: string
    value: {
      dailyRmssd: number
      deepRmssd: number
    }
  }>
}

interface FitbitSpO2Response {
  dateTime: string
  value: {
    avg: number
    min: number
    max: number
  }
}

interface FitbitTempResponse {
  tempSkin: Array<{
    dateTime: string
    value: {
      nightlyRelative: number
    }
    logType: string
  }>
}

interface FitbitProfileResponse {
  user: {
    age: number
    avatar: string
    displayName: string
    encodedId: string
    gender: string
    height: number
    weight: number
  }
}

interface FitbitExerciseResponse {
  activities: Array<{
    activityId: number
    activityParentId: number
    activityParentName: string
    calories: number
    description: string
    distance?: number
    distanceUnit?: string
    duration: number
    hasActiveZoneMinutes: boolean
    logId: number
    logType: string
    name: string
    startDate: string
    startTime: string
    steps?: number
    averageHeartRate?: number
  }>
}

interface FitbitCardioScoreResponse {
  cardioScore: Array<{
    dateTime: string
    value: {
      vo2Max: string
    }
  }>
}

export class FitbitDriver implements HealthDriver {
  readonly name = 'Fitbit'
  readonly type = 'fitbit' as const

  private accessToken: string
  private baseUrl: string

  constructor(accessToken: string, baseUrl?: string) {
    this.accessToken = accessToken
    this.baseUrl = baseUrl ?? FITBIT_API_BASE
  }

  isAuthenticated(): boolean {
    return this.accessToken.length > 0
  }

  private async request<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Fitbit API error ${response.status}: ${body}`)
    }

    return response.json() as Promise<T>
  }

  private formatDate(date: string): string {
    return date // already YYYY-MM-DD
  }

  private getDateRange(options?: DateRangeOptions): {
    start: string
    end: string
  } {
    const end = options?.endDate ?? new Date().toISOString().slice(0, 10)
    const start = options?.startDate ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    return { start: this.formatDate(start), end: this.formatDate(end) }
  }

  // ===========================================================================
  // Sleep
  // ===========================================================================

  async getSleep(options?: DateRangeOptions): Promise<SleepSession[]> {
    const { start, end } = this.getDateRange(options)
    const raw = await this.request<FitbitSleepResponse>(`/1.2/user/-/sleep/date/${start}/${end}.json`)

    return raw.sleep.map(s => {
      const deepMinutes = s.levels.summary.deep?.minutes ?? 0
      const lightMinutes = s.levels.summary.light?.minutes ?? (s.levels.summary.asleep?.minutes ?? 0)
      const remMinutes = s.levels.summary.rem?.minutes ?? 0
      const wakeMinutes = s.levels.summary.wake?.minutes ?? (s.levels.summary.awake?.minutes ?? 0) + (s.levels.summary.restless?.minutes ?? 0)

      return {
        id: s.logId.toString(),
        day: s.dateOfSleep,
        bedtimeStart: s.startTime,
        bedtimeEnd: s.endTime,
        type: s.isMainSleep ? 'long_sleep' as const : 'nap' as const,
        totalSleepDuration: s.minutesAsleep * 60,
        deepSleepDuration: deepMinutes * 60,
        lightSleepDuration: lightMinutes * 60,
        remSleepDuration: remMinutes * 60,
        awakeTime: wakeMinutes * 60,
        timeInBed: s.timeInBed * 60,
        latency: s.minutesToFallAsleep * 60,
        efficiency: s.efficiency,
        stages: s.levels.data.map(d => ({
          stage: this.mapSleepStage(d.level),
          startTime: d.dateTime,
          endTime: new Date(new Date(d.dateTime).getTime() + d.seconds * 1000).toISOString(),
          duration: d.seconds,
        })),
        source: 'fitbit' as const,
      }
    })
  }

  async getDailySleep(options?: DateRangeOptions): Promise<DailySleepSummary[]> {
    const sessions = await this.getSleep(options)

    // Group by day, take main sleep
    const mainSleeps = sessions.filter(s => s.type === 'long_sleep')

    return mainSleeps.map(s => ({
      day: s.day,
      score: s.efficiency,
      contributors: {
        efficiency: s.efficiency,
        deepSleep: s.totalSleepDuration > 0 ? Math.round((s.deepSleepDuration / s.totalSleepDuration) * 100) : undefined,
        remSleep: s.totalSleepDuration > 0 ? Math.round((s.remSleepDuration / s.totalSleepDuration) * 100) : undefined,
        latency: s.latency < 20 * 60 ? 100 : s.latency < 45 * 60 ? 50 : 0,
      },
      source: 'fitbit' as const,
    }))
  }

  // ===========================================================================
  // Activity
  // ===========================================================================

  async getDailyActivity(options?: DateRangeOptions): Promise<DailyActivity[]> {
    const { start, end } = this.getDateRange(options)
    const activities: DailyActivity[] = []

    // Fitbit requires per-day requests for activity summary
    const startDate = new Date(start)
    const endDate = new Date(end)

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10)

      try {
        const raw = await this.request<FitbitActivityResponse>(`/1/user/-/activities/date/${dateStr}.json`)

        activities.push({
          day: dateStr,
          score: 0,
          activeCalories: raw.summary.activityCalories,
          totalCalories: raw.summary.caloriesOut,
          steps: raw.summary.steps,
          equivalentWalkingDistance: (raw.summary.distances.find(d => d.activity === 'total')?.distance ?? 0) * 1000,
          highActivityTime: raw.summary.veryActiveMinutes * 60,
          mediumActivityTime: raw.summary.fairlyActiveMinutes * 60,
          lowActivityTime: raw.summary.lightlyActiveMinutes * 60,
          sedentaryTime: raw.summary.sedentaryMinutes * 60,
          restingTime: 0,
          nonWearTime: 0,
          inactivityAlerts: 0,
          targetCalories: 0,
          targetMeters: 0,
          metersToTarget: 0,
          averageMetLevel: 0,
          contributors: {},
          source: 'fitbit' as const,
        })
      }
      catch {
        // Skip days with errors
      }
    }

    return activities
  }

  // ===========================================================================
  // Workouts
  // ===========================================================================

  async getWorkouts(options?: DateRangeOptions): Promise<Workout[]> {
    const { start, end } = this.getDateRange(options)
    const raw = await this.request<FitbitExerciseResponse>(
      `/1/user/-/activities/list.json?afterDate=${start}&beforeDate=${end}&sort=asc&offset=0&limit=100`,
    )

    return raw.activities.map(a => ({
      id: a.logId.toString(),
      activity: a.activityParentName || a.name,
      day: a.startDate,
      startDatetime: `${a.startDate}T${a.startTime}`,
      endDatetime: new Date(new Date(`${a.startDate}T${a.startTime}`).getTime() + a.duration).toISOString(),
      calories: a.calories || undefined,
      distance: a.distance ? a.distance * 1000 : undefined,
      averageHeartRate: a.averageHeartRate,
      source: 'fitbit' as const,
    }))
  }

  // ===========================================================================
  // Readiness (not natively available)
  // ===========================================================================

  async getReadiness(_options?: DateRangeOptions): Promise<DailyReadiness[]> {
    return []
  }

  // ===========================================================================
  // Heart Rate
  // ===========================================================================

  async getHeartRate(options?: DateRangeOptions): Promise<HeartRateSample[]> {
    const { start, end } = this.getDateRange(options)
    const raw = await this.request<FitbitHeartRateResponse>(
      `/1/user/-/activities/heart/date/${start}/${end}/1min.json`,
    )

    const samples: HeartRateSample[] = []

    if (raw['activities-heart-intraday']?.dataset) {
      const date = raw['activities-heart'][0]?.dateTime ?? start
      for (const point of raw['activities-heart-intraday'].dataset) {
        samples.push({
          timestamp: `${date}T${point.time}`,
          bpm: point.value,
        })
      }
    }

    return samples
  }

  // ===========================================================================
  // HRV
  // ===========================================================================

  async getHRV(options?: DateRangeOptions): Promise<HRVSample[]> {
    const { start, end } = this.getDateRange(options)
    const raw = await this.request<FitbitHRVResponse>(`/1/user/-/hrv/date/${start}/${end}.json`)

    return raw.hrv.map(h => ({
      timestamp: `${h.dateTime}T00:00:00`,
      hrv: h.value.dailyRmssd,
    }))
  }

  // ===========================================================================
  // SpO2
  // ===========================================================================

  async getSpO2(options?: DateRangeOptions): Promise<DailySpO2[]> {
    const { start, end } = this.getDateRange(options)

    try {
      const raw = await this.request<FitbitSpO2Response[]>(`/1/user/-/spo2/date/${start}/${end}.json`)

      return raw.map(s => ({
        day: s.dateTime,
        averageSpO2: s.value.avg,
        minSpO2: s.value.min,
        maxSpO2: s.value.max,
        source: 'fitbit' as const,
      }))
    }
    catch {
      return []
    }
  }

  // ===========================================================================
  // Stress (not natively available via standard API)
  // ===========================================================================

  async getStress(_options?: DateRangeOptions): Promise<DailyStress[]> {
    return []
  }

  // ===========================================================================
  // Body Temperature
  // ===========================================================================

  async getBodyTemperature(options?: DateRangeOptions): Promise<BodyTemperature[]> {
    const { start, end } = this.getDateRange(options)

    try {
      const raw = await this.request<FitbitTempResponse>(`/1/user/-/temp/skin/date/${start}/${end}.json`)

      return raw.tempSkin.map(t => ({
        day: t.dateTime,
        deviation: t.value.nightlyRelative,
        source: 'fitbit' as const,
      }))
    }
    catch {
      return []
    }
  }

  // ===========================================================================
  // VO2 Max
  // ===========================================================================

  async getVO2Max(options?: DateRangeOptions): Promise<VO2MaxReading[]> {
    const { start, end } = this.getDateRange(options)

    try {
      const raw = await this.request<FitbitCardioScoreResponse>(
        `/1/user/-/cardioscore/date/${start}/${end}.json`,
      )

      return raw.cardioScore.map(c => ({
        day: c.dateTime,
        vo2Max: Number.parseFloat(c.value.vo2Max) || 0,
        source: 'fitbit' as const,
      }))
    }
    catch {
      return []
    }
  }

  // ===========================================================================
  // Body Composition (Fitbit Aria scales)
  // ===========================================================================

  async getBodyComposition(options?: DateRangeOptions): Promise<BodyComposition[]> {
    const { start, end } = this.getDateRange(options)

    try {
      const raw = await this.request<{
        weight: Array<{ logId: number
        date: string
        time: string
        weight: number
        bmi: number
        fat?: number }>
      }>(
        `/1/user/-/body/log/weight/date/${start}/${end}.json`,
      )

      return (raw.weight ?? []).map(w => ({
        id: String(w.logId),
        day: w.date,
        timestamp: `${w.date}T${w.time}`,
        weight: w.weight,
        bmi: w.bmi,
        bodyFatPercentage: w.fat,
        source: 'fitbit' as const,
      }))
    }
    catch {
      return []
    }
  }

  async getWeightMeasurements(options?: DateRangeOptions): Promise<WeightMeasurement[]> {
    const compositions = await this.getBodyComposition(options)

    return compositions.map(c => ({
      id: c.id,
      day: c.day,
      timestamp: c.timestamp,
      weight: c.weight,
      bmi: c.bmi,
      source: 'fitbit' as const,
    }))
  }

  // ===========================================================================
  // Personal Info
  // ===========================================================================

  async getPersonalInfo(): Promise<PersonalInfo | null> {
    try {
      const raw = await this.request<FitbitProfileResponse>('/1/user/-/profile.json')

      return {
        id: raw.user.encodedId,
        age: raw.user.age,
        weight: raw.user.weight,
        height: raw.user.height,
        biologicalSex: raw.user.gender === 'MALE' ? 'male' : raw.user.gender === 'FEMALE' ? 'female' : 'other',
      }
    }
    catch {
      return null
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private mapSleepStage(level: string): 'awake' | 'light' | 'deep' | 'rem' | 'unknown' {
    switch (level) {
      case 'wake': case 'awake': return 'awake'
      case 'light': case 'restless': case 'asleep': return 'light'
      case 'deep': return 'deep'
      case 'rem': return 'rem'
      default: return 'unknown'
    }
  }
}

export function createFitbitDriver(accessToken: string, baseUrl?: string): FitbitDriver {
  return new FitbitDriver(accessToken, baseUrl)
}
