import { GarminConnectClient } from 'ts-watches'
import type { GarminConnectConfig, GarminActivitySummary } from 'ts-watches'
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

export class GarminHealthDriver implements HealthDriver {
  readonly name = 'Garmin'
  readonly type = 'garmin' as const
  readonly supportedMetrics: ReadonlySet<HealthMetric> = new Set<HealthMetric>([
    'sleep', 'dailySleep', 'dailyActivity', 'workouts',
    'heartRate', 'hrv', 'stress', 'personalInfo',
  ])

  private client: GarminConnectClient
  private authenticated = false

  constructor(config: GarminConnectConfig) {
    this.client = new GarminConnectClient(config)
  }

  isAuthenticated(): boolean {
    return this.authenticated
  }

  private async ensureAuth(): Promise<void> {
    if (!this.authenticated) {
      await this.client.login()
      this.authenticated = true
    }
  }

  private getDateRange(options?: DateRangeOptions): { start: Date, end: Date } {
    const end = options?.endDate ? new Date(options.endDate) : new Date()
    const start = options?.startDate
      ? new Date(options.startDate)
      : new Date(end.getTime() - 7 * 86400000)
    return { start, end }
  }

  private generateDates(start: Date, end: Date): Date[] {
    const dates: Date[] = []
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(new Date(d))
    }
    return dates
  }

  private toDateString(date: Date): string {
    return date.toISOString().slice(0, 10)
  }

  // ===========================================================================
  // Sleep
  // ===========================================================================

  async getSleep(options?: DateRangeOptions): Promise<SleepSession[]> {
    await this.ensureAuth()
    const { start, end } = this.getDateRange(options)
    const dates = this.generateDates(start, end)

    const results = await Promise.allSettled(
      dates.map(date => this.client.getSleepData(date)),
    )

    const sessions: SleepSession[] = []
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status !== 'fulfilled' || !result.value) continue

      const s = result.value
      const day = this.toDateString(dates[i])

      sessions.push({
        id: `garmin_sleep_${day}`,
        day,
        bedtimeStart: s.startTime.toISOString(),
        bedtimeEnd: s.endTime.toISOString(),
        type: 'long_sleep',
        totalSleepDuration: s.totalSleepTime * 60,
        deepSleepDuration: s.deepSleepTime * 60,
        lightSleepDuration: s.lightSleepTime * 60,
        remSleepDuration: s.remSleepTime * 60,
        awakeTime: s.awakeTime * 60,
        timeInBed: (s.totalSleepTime + s.awakeTime) * 60,
        latency: 0,
        efficiency: s.totalSleepTime > 0
          ? Math.round((s.totalSleepTime / (s.totalSleepTime + s.awakeTime)) * 100)
          : 0,
        averageHeartRate: s.avgHeartRate,
        averageBreath: s.avgRespirationRate,
        stages: s.stages.map(st => ({
          stage: st.stage,
          startTime: st.startTime.toISOString(),
          endTime: st.endTime.toISOString(),
          duration: Math.round((st.endTime.getTime() - st.startTime.getTime()) / 1000),
        })),
        source: 'garmin' as const,
      })
    }

    return sessions
  }

  async getDailySleep(options?: DateRangeOptions): Promise<DailySleepSummary[]> {
    const sessions = await this.getSleep(options)

    return sessions.map(s => ({
      day: s.day,
      score: s.efficiency,
      contributors: {
        efficiency: s.efficiency,
        deepSleep: s.totalSleepDuration > 0
          ? Math.min(100, Math.round((s.deepSleepDuration / s.totalSleepDuration) * 200))
          : undefined,
        remSleep: s.totalSleepDuration > 0
          ? Math.min(100, Math.round((s.remSleepDuration / s.totalSleepDuration) * 200))
          : undefined,
      },
      source: 'garmin' as const,
    }))
  }

  // ===========================================================================
  // Activity
  // ===========================================================================

  async getDailyActivity(options?: DateRangeOptions): Promise<DailyActivity[]> {
    await this.ensureAuth()
    const { start, end } = this.getDateRange(options)
    const dates = this.generateDates(start, end)

    const results = await Promise.allSettled(
      dates.map(date => this.client.getStepsData(date)),
    )

    const activities: DailyActivity[] = []
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status !== 'fulfilled' || !result.value) continue

      const s = result.value
      const day = this.toDateString(dates[i])

      activities.push({
        day,
        score: 0,
        activeCalories: s.calories,
        totalCalories: s.calories,
        steps: s.total,
        equivalentWalkingDistance: s.distance,
        contributors: {},
        source: 'garmin' as const,
      })
    }

    return activities
  }

  // ===========================================================================
  // Workouts
  // ===========================================================================

  async getWorkouts(options?: DateRangeOptions): Promise<Workout[]> {
    await this.ensureAuth()
    const { start, end } = this.getDateRange(options)

    // Fetch a batch of activities and filter by date range
    const raw = await this.client.getActivities(0, 100)

    return raw
      .filter((a: GarminActivitySummary) => {
        const actDate = a.startTimeLocal?.slice(0, 10)
        if (!actDate) return false
        const startStr = this.toDateString(start)
        const endStr = this.toDateString(end)
        return actDate >= startStr && actDate <= endStr
      })
      .map((a: GarminActivitySummary) => ({
        id: a.activityId.toString(),
        activity: a.activityType?.typeKey ?? 'unknown',
        day: a.startTimeLocal.slice(0, 10),
        startDatetime: a.startTimeGMT,
        endDatetime: new Date(new Date(a.startTimeGMT).getTime() + a.duration * 1000).toISOString(),
        calories: a.calories || undefined,
        distance: a.distance || undefined,
        averageHeartRate: a.averageHR,
        maxHeartRate: a.maxHR,
        source: 'garmin' as const,
      }))
  }

  // ===========================================================================
  // Heart Rate
  // ===========================================================================

  async getHeartRate(options?: DateRangeOptions): Promise<HeartRateSample[]> {
    await this.ensureAuth()
    const { start, end } = this.getDateRange(options)
    const dates = this.generateDates(start, end)

    const results = await Promise.allSettled(
      dates.map(date => this.client.getHeartRateData(date)),
    )

    const samples: HeartRateSample[] = []
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue

      const hr = result.value
      if (hr.samples) {
        for (const s of hr.samples) {
          samples.push({
            timestamp: s.timestamp.toISOString(),
            bpm: s.heartRate,
          })
        }
      }
    }

    return samples
  }

  // ===========================================================================
  // HRV
  // ===========================================================================

  async getHRV(options?: DateRangeOptions): Promise<HRVSample[]> {
    await this.ensureAuth()
    const { start, end } = this.getDateRange(options)
    const dates = this.generateDates(start, end)

    const results = await Promise.allSettled(
      dates.map(date => this.client.getHrvData(date)),
    )

    const samples: HRVSample[] = []
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue

      const hrv = result.value
      if (hrv.samples.length > 0) {
        for (const s of hrv.samples) {
          samples.push({
            timestamp: s.timestamp.toISOString(),
            hrv: s.hrv,
          })
        }
      }
      else if (hrv.lastNightAverage != null) {
        samples.push({
          timestamp: hrv.date.toISOString(),
          hrv: hrv.lastNightAverage,
        })
      }
    }

    return samples
  }

  // ===========================================================================
  // Stress
  // ===========================================================================

  async getStress(options?: DateRangeOptions): Promise<DailyStress[]> {
    await this.ensureAuth()
    const { start, end } = this.getDateRange(options)
    const dates = this.generateDates(start, end)

    const results = await Promise.allSettled(
      dates.map(date => this.client.getStressData(date)),
    )

    const records: DailyStress[] = []
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status !== 'fulfilled' || !result.value) continue

      const s = result.value
      records.push({
        day: this.toDateString(dates[i]),
        stressHigh: s.highStressDuration,
        recoveryHigh: s.restStressDuration,
        source: 'garmin' as const,
      })
    }

    return records
  }

  // ===========================================================================
  // Body Composition / Weight (awaiting ts-watches getWeightData support)
  // ===========================================================================

  async getBodyComposition(): Promise<BodyComposition[]> { return [] }
  async getWeightMeasurements(): Promise<WeightMeasurement[]> { return [] }

  // ===========================================================================
  // Personal Info
  // ===========================================================================

  async getPersonalInfo(): Promise<PersonalInfo | null> {
    await this.ensureAuth()

    try {
      const profile = await this.client.getUserProfile()
      return {
        id: profile.profileId,
        email: profile.displayName,
      }
    }
    catch {
      return null
    }
  }

  // ===========================================================================
  // Unsupported (Garmin Connect API doesn't expose these directly)
  // ===========================================================================

  async getReadiness(): Promise<DailyReadiness[]> { return [] }
  async getSpO2(): Promise<DailySpO2[]> { return [] }
  async getBodyTemperature(): Promise<BodyTemperature[]> { return [] }
  async getVO2Max(): Promise<VO2MaxReading[]> { return [] }
}

export function createGarminHealthDriver(config: GarminConnectConfig): GarminHealthDriver {
  return new GarminHealthDriver(config)
}
