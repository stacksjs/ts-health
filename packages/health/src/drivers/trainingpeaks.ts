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
} from '../types'

interface TPConfig {
  username: string
  password: string
  cookiePath?: string
  headless?: boolean
}

export class TrainingPeaksHealthDriver implements HealthDriver {
  readonly name = 'TrainingPeaks'
  readonly type = 'trainingpeaks' as const
  readonly supportedMetrics: ReadonlySet<HealthMetric> = new Set<HealthMetric>([
    'dailySleep', 'dailyActivity', 'workouts', 'readiness',
    'heartRate', 'hrv', 'stress',
    'weightMeasurements', 'personalInfo',
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null
  private config: TPConfig
  private authenticated = false

  constructor(config: TPConfig) {
    this.config = config
  }

  isAuthenticated(): boolean {
    return this.authenticated
  }

  private async ensureAuth(): Promise<void> {
    if (this.authenticated) return

    const { TrainingPeaks } = await import('ts-watches')
    this.client = new TrainingPeaks({
      username: this.config.username,
      password: this.config.password,
      cookiePath: this.config.cookiePath,
      headless: this.config.headless ?? true,
    })
    await this.client.login()
    this.authenticated = true
  }

  private getDateRange(options?: DateRangeOptions): { start: Date, end: Date } {
    const end = options?.endDate ? new Date(options.endDate) : new Date()
    const start = options?.startDate
      ? new Date(options.startDate)
      : new Date(end.getTime() - 7 * 86400000)
    return { start, end }
  }

  // ===========================================================================
  // Sleep (from TPMetrics)
  // ===========================================================================

  async getSleep(): Promise<SleepSession[]> {
    // TrainingPeaks only has daily sleep summary, not detailed sessions
    return []
  }

  async getDailySleep(options?: DateRangeOptions): Promise<DailySleepSummary[]> {
    await this.ensureAuth()
    const { start, end } = this.getDateRange(options)
    const metrics = await this.client.getMetrics(start, end)

    return metrics
      .filter((m: { SleepHours?: number }) => m.SleepHours != null)
      .map((m: { Date: string, SleepHours?: number, SleepQuality?: number }) => ({
        day: m.Date,
        score: m.SleepQuality != null ? Math.round(m.SleepQuality * 20) : undefined,
        contributors: {
          totalSleep: m.SleepHours,
        },
        source: 'trainingpeaks' as const,
      }))
  }

  // ===========================================================================
  // Activity (from TPWorkout actuals)
  // ===========================================================================

  async getDailyActivity(options?: DateRangeOptions): Promise<DailyActivity[]> {
    await this.ensureAuth()
    const { start, end } = this.getDateRange(options)
    const workouts = await this.client.getWorkouts(start, end)

    // Group workouts by day and aggregate
    const byDay = new Map<string, { calories: number, distance: number, duration: number }>()

    for (const w of workouts) {
      if (!w.completed) continue
      const day = w.workoutDay?.slice(0, 10)
      if (!day) continue

      const existing = byDay.get(day) || { calories: 0, distance: 0, duration: 0 }
      existing.calories += w.calories ?? 0
      existing.distance += w.distance ?? 0
      existing.duration += w.totalTime ?? 0
      byDay.set(day, existing)
    }

    return Array.from(byDay.entries()).map(([day, data]) => ({
      day,
      score: 0,
      activeCalories: Math.round(data.calories),
      totalCalories: Math.round(data.calories),
      contributors: {},
      source: 'trainingpeaks' as const,
    }))
  }

  // ===========================================================================
  // Workouts
  // ===========================================================================

  async getWorkouts(options?: DateRangeOptions): Promise<Workout[]> {
    await this.ensureAuth()
    const { start, end } = this.getDateRange(options)
    const { getWorkoutTypeName } = await import('ts-watches')
    const raw = await this.client.getWorkouts(start, end)

    return raw.map((w: {
      workoutId: number
      workoutDay: string
      title: string
      workoutTypeValueId: number
      totalTime?: number
      totalTimePlanned?: number
      calories?: number
      distance?: number
      heartRateAverage?: number
      heartRateMaximum?: number
      powerAverage?: number
      normalizedPowerActual?: number
      tssActual?: number
      if?: number
      startTime?: string | null
      completed?: boolean | null
    }) => {
      const durationSec = w.totalTime ?? w.totalTimePlanned ?? 0
      const day = w.workoutDay?.slice(0, 10)
      const startTime = w.startTime ?? `${day}T00:00:00`

      return {
        id: w.workoutId.toString(),
        activity: getWorkoutTypeName(w.workoutTypeValueId),
        day,
        startDatetime: startTime,
        endDatetime: new Date(new Date(startTime).getTime() + durationSec * 1000).toISOString(),
        calories: w.calories || undefined,
        distance: w.distance ? w.distance * 1000 : undefined,
        averageHeartRate: w.heartRateAverage,
        maxHeartRate: w.heartRateMaximum,
        source: 'trainingpeaks' as const,
      }
    })
  }

  // ===========================================================================
  // Readiness (from PMC — Training Stress Balance)
  // ===========================================================================

  async getReadiness(options?: DateRangeOptions): Promise<DailyReadiness[]> {
    await this.ensureAuth()
    const { start, end } = this.getDateRange(options)
    const pmc = await this.client.getPerformanceChart(start, end)

    if (!pmc?.Tsb?.length) return []

    const startDate = new Date(pmc.StartDate)
    return pmc.Tsb.map((tsb: number, i: number) => {
      const day = new Date(startDate.getTime() + i * 86400000).toISOString().slice(0, 10)
      // TSB typically ranges from -30 to +30. Normalize to 0-100 score
      const score = Math.max(0, Math.min(100, Math.round(50 + tsb * 1.67)))

      return {
        day,
        score,
        contributors: {
          trainingLoad: pmc.Tss?.[i],
          fitness: pmc.Ctl?.[i],
          fatigue: pmc.Atl?.[i],
          form: tsb,
        },
        source: 'trainingpeaks' as const,
      }
    })
  }

  // ===========================================================================
  // Heart Rate (from TPMetrics resting HR)
  // ===========================================================================

  async getHeartRate(options?: DateRangeOptions): Promise<HeartRateSample[]> {
    await this.ensureAuth()
    const { start, end } = this.getDateRange(options)
    const metrics = await this.client.getMetrics(start, end)

    return metrics
      .filter((m: { RestingHeartRate?: number }) => m.RestingHeartRate != null)
      .map((m: { Date: string, RestingHeartRate: number }) => ({
        timestamp: `${m.Date}T07:00:00`,
        bpm: m.RestingHeartRate,
        source: 'resting',
      }))
  }

  // ===========================================================================
  // HRV (from TPMetrics)
  // ===========================================================================

  async getHRV(options?: DateRangeOptions): Promise<HRVSample[]> {
    await this.ensureAuth()
    const { start, end } = this.getDateRange(options)
    const metrics = await this.client.getMetrics(start, end)

    return metrics
      .filter((m: { HrvRmssd?: number }) => m.HrvRmssd != null)
      .map((m: { Date: string, HrvRmssd: number }) => ({
        timestamp: `${m.Date}T07:00:00`,
        hrv: m.HrvRmssd,
      }))
  }

  // ===========================================================================
  // Stress (from TPMetrics)
  // ===========================================================================

  async getStress(options?: DateRangeOptions): Promise<DailyStress[]> {
    await this.ensureAuth()
    const { start, end } = this.getDateRange(options)
    const metrics = await this.client.getMetrics(start, end)

    return metrics
      .filter((m: { Stress?: number }) => m.Stress != null)
      .map((m: { Date: string, Stress?: number, Fatigue?: number }) => ({
        day: m.Date,
        stressHigh: m.Stress,
        recoveryHigh: m.Fatigue != null ? Math.max(0, 5 - m.Fatigue) : undefined,
        source: 'trainingpeaks' as const,
      }))
  }

  // ===========================================================================
  // Weight (from TPMetrics)
  // ===========================================================================

  async getWeightMeasurements(options?: DateRangeOptions): Promise<WeightMeasurement[]> {
    await this.ensureAuth()
    const { start, end } = this.getDateRange(options)
    const metrics = await this.client.getMetrics(start, end)

    return metrics
      .filter((m: { Weight?: number }) => m.Weight != null)
      .map((m: { Date: string, Weight: number }) => ({
        id: `tp_weight_${m.Date}`,
        day: m.Date,
        timestamp: `${m.Date}T07:00:00`,
        weight: m.Weight,
        source: 'trainingpeaks' as const,
      }))
  }

  // ===========================================================================
  // Personal Info
  // ===========================================================================

  async getPersonalInfo(): Promise<PersonalInfo | null> {
    await this.ensureAuth()

    try {
      const athlete = await this.client.getAthlete()
      return {
        id: athlete.Id?.toString(),
        email: athlete.Email,
        weight: athlete.Weight,
        biologicalSex: athlete.Gender === 'Male' ? 'male'
          : athlete.Gender === 'Female' ? 'female'
            : undefined,
      }
    }
    catch {
      return null
    }
  }

  // ===========================================================================
  // Unsupported
  // ===========================================================================

  async getSpO2(): Promise<DailySpO2[]> { return [] }
  async getBodyTemperature(): Promise<BodyTemperature[]> { return [] }
  async getVO2Max(): Promise<VO2MaxReading[]> { return [] }
  async getBodyComposition(): Promise<BodyComposition[]> { return [] }
}

export function createTrainingPeaksHealthDriver(config: TPConfig): TrainingPeaksHealthDriver {
  return new TrainingPeaksHealthDriver(config)
}
