import { GarminConnectClient, isGarminNotFound } from 'ts-watches'
import type { GarminConnectConfig } from 'ts-watches'
import { PartialHealthReadError } from '../read-errors'
import type { BodyBatteryReading, BodyComposition, BodyTemperature, DailyActivity, DailyHydration, DailyReadiness, DailySleepSummary, DailySpO2, DailyStress, DateRangeOptions, HealthDriver, HealthMetric, HeartRateSample, HRVSample, PersonalInfo, SleepSession, VO2MaxReading, WeightMeasurement, Workout } from '../types'

export interface GarminHealthConfig extends GarminConnectConfig {
  /** An already authenticated client shared with an activity import. */
  authenticatedClient?: GarminConnectClient
}
const DAY = 86400000
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export class GarminHealthDriver implements HealthDriver {
  readonly name = 'Garmin'
  readonly type = 'garmin' as const
  readonly supportedMetrics: ReadonlySet<HealthMetric> = new Set<HealthMetric>([
    'sleep', 'dailySleep', 'dailyActivity', 'workouts', 'heartRate', 'hrv', 'stress', 'personalInfo',
    'bodyComposition', 'weightMeasurements', 'bodyBattery', 'dailyHydration', 'readiness', 'vo2Max',
  ])
  private client: GarminConnectClient
  private authenticated: boolean
  constructor(config: GarminHealthConfig) {
    this.client = config.authenticatedClient || new GarminConnectClient(config)
    this.authenticated = Boolean(config.authenticatedClient)
  }
  isAuthenticated(): boolean { return this.authenticated }
  private async ensureAuth(): Promise<void> {
    if (this.authenticated) return
    await this.client.login()
    this.authenticated = true
  }
  private range(options?: DateRangeOptions): { start: string, end: string } {
    const end = options?.endDate || new Date().toISOString().slice(0, 10)
    const start = options?.startDate || new Date(Date.parse(`${end}T00:00:00Z`) - 7 * DAY).toISOString().slice(0, 10)
    for (const day of [start, end])
      if (!/^\d{4}-\d\d-\d\d$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) throw new RangeError('Expected valid calendar dates')
    if (start > end) throw new RangeError('Start date must precede end date')
    return { start, end }
  }
  /** Four requests at a time; a batch failure remains visible alongside real readings. */
  private async readDays<T>(options: DateRangeOptions | undefined, read: (date: Date) => Promise<T>): Promise<PromiseSettledResult<T | undefined>[]> {
    await this.ensureAuth()
    const { start, end } = this.range(options)
    const dates: Date[] = []
    for (let at = Date.parse(`${start}T12:00:00Z`); at <= Date.parse(`${end}T12:00:00Z`); at += DAY) dates.push(new Date(at))
    const results: PromiseSettledResult<T | undefined>[] = []
    for (let i = 0; i < dates.length; i += 4) {
      const batch = await Promise.allSettled(dates.slice(i, i + 4).map(async (date) => {
        try { return await read(date) }
        catch (error) {
          if (isGarminNotFound(error)) return undefined
          throw error
        }
      }))
      results.push(...batch)
      if (batch.some(result => result.status === 'rejected' && /\b(?:401|403|429)\b/.test(String(result.reason?.message)))) break
    }
    return results
  }
  private complete<T>(readings: T[], results: PromiseSettledResult<unknown>[]): T[] {
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
    if (errors.length) throw new PartialHealthReadError(readings, errors)
    return readings
  }
  async getSleep(options?: DateRangeOptions): Promise<SleepSession[]> {
    const results = await this.readDays(options, date => this.client.getSleepData(date))
    const sessions: SleepSession[] = []
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue
      const s = result.value
      sessions.push({ id: `garmin_sleep_${s.date.toISOString().slice(0, 10)}`, day: s.date.toISOString().slice(0, 10),
        bedtimeStart: s.startTime.toISOString(), bedtimeEnd: s.endTime.toISOString(), type: 'long_sleep',
        totalSleepDuration: s.totalSleepTime * 60, deepSleepDuration: s.deepSleepTime * 60, lightSleepDuration: s.lightSleepTime * 60,
        remSleepDuration: s.remSleepTime * 60, awakeTime: s.awakeTime * 60, timeInBed: (s.totalSleepTime + s.awakeTime) * 60,
        latency: undefined, efficiency: s.totalSleepTime > 0 ? Math.round(s.totalSleepTime / (s.totalSleepTime + s.awakeTime) * 100) : 0,
        score: s.sleepScore, averageHeartRate: s.avgHeartRate, averageBreath: s.avgRespirationRate, averageSpO2: s.avgSpO2,
        stages: s.stages.map(stage => ({ stage: stage.stage, startTime: stage.startTime.toISOString(), endTime: stage.endTime.toISOString(), duration: (stage.endTime.getTime() - stage.startTime.getTime()) / 1000 })), source: 'garmin' })
    }
    return this.complete(sessions, results)
  }
  async getDailySleep(options?: DateRangeOptions): Promise<DailySleepSummary[]> {
    return (await this.getSleep(options)).map(s => ({ day: s.day, score: s.score, contributors: {}, source: 'garmin' }))
  }
  async getDailyActivity(options?: DateRangeOptions): Promise<DailyActivity[]> {
    const results = await this.readDays(options, async (date) => ({ date, data: await this.client.getStepsData(date) }))
    const days: DailyActivity[] = []
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value?.data) continue
      const { date, data } = result.value
      days.push({ day: date.toISOString().slice(0, 10), score: 0, activeCalories: data.calories, totalCalories: data.calories,
        steps: data.total, equivalentWalkingDistance: data.distance, contributors: {}, source: 'garmin' })
    }
    return this.complete(days, results)
  }
  async getWorkouts(options?: DateRangeOptions): Promise<Workout[]> {
    await this.ensureAuth()
    const { start, end } = this.range(options)
    const workouts: Workout[] = []
    const seen = new Set<string>()
    for (let page = 0; page < 100; page++) {
      const activities = await this.client.getActivities(page * 100, 100)
      let older = false
      for (const activity of activities) {
        const day = activity.startTimeLocal?.slice(0, 10)
        if (day && day < start) older = true
        if (!day || day < start || day > end) continue
        const id = String(activity.activityId)
        if (seen.has(id)) throw new Error('Garmin repeated an activity page')
        seen.add(id)
        workouts.push({ id, day, activity: activity.activityType?.typeKey || 'unknown', startDatetime: `${activity.startTimeGMT.replace(' ', 'T')}Z`,
          endDatetime: new Date(Date.parse(`${activity.startTimeGMT.replace(' ', 'T')}Z`) + activity.duration * 1000).toISOString(),
          calories: activity.calories, distance: activity.distance, averageHeartRate: activity.averageHR, maxHeartRate: activity.maxHR, source: 'garmin' })
      }
      if (older || activities.length < 100) return workouts
    }
    throw new PartialHealthReadError(workouts, [new Error('Garmin activity page budget exceeded; use smaller date windows')])
  }
  async getHeartRate(options?: DateRangeOptions): Promise<HeartRateSample[]> {
    const results = await this.readDays(options, date => this.client.getHeartRateData(date))
    const samples: HeartRateSample[] = []
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue
      const day = result.value
      if (finite(day.restingHeartRate)) samples.push({ timestamp: day.date.toISOString(), day: day.date.toISOString().slice(0, 10), bpm: day.restingHeartRate, source: 'resting' })
      for (const sample of day.samples || []) samples.push({ timestamp: sample.timestamp.toISOString(), bpm: sample.heartRate })
    }
    return this.complete(samples, results)
  }
  async getHRV(options?: DateRangeOptions): Promise<HRVSample[]> {
    const results = await this.readDays(options, date => this.client.getHrvData(date))
    const samples: HRVSample[] = []
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue
      const day = result.value
      if (day.samples.length) for (const sample of day.samples) samples.push({ timestamp: sample.timestamp.toISOString(), hrv: sample.hrv })
      else if (finite(day.lastNightAverage)) samples.push({ timestamp: day.date.toISOString(), hrv: day.lastNightAverage })
    }
    return this.complete(samples, results)
  }
  async getStress(options?: DateRangeOptions): Promise<DailyStress[]> {
    const results = await this.readDays(options, date => this.client.getStressData(date))
    const days: DailyStress[] = []
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue
      const s = result.value
      days.push({ day: s.date.toISOString().slice(0, 10), stressHigh: s.highStressDuration * 60, recoveryHigh: s.restStressDuration * 60,
        score: s.avgStressLevel, maxScore: s.maxStressLevel, samples: s.samples.map(sample => ({ timestamp: sample.timestamp.toISOString(), score: sample.stressLevel })), source: 'garmin' })
    }
    return this.complete(days, results)
  }
  async getBodyComposition(options?: DateRangeOptions): Promise<BodyComposition[]> {
    const results = await this.readDays(options, date => this.client.getWeightReadings(date))
    const readings: BodyComposition[] = []
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue
      for (const row of result.value) readings.push({ id: row.id || `garmin_weight_${row.date.toISOString()}`,
        day: row.date.toISOString().slice(0, 10), timestamp: row.timestamp?.toISOString() || row.date.toISOString(), weight: row.weight / 1000,
        bmi: row.bmi, bodyFatPercentage: row.bodyFatPercentage, waterPercentage: row.bodyWater,
        boneMass: row.boneMass == null ? undefined : row.boneMass / 1000, muscleMass: row.muscleMass == null ? undefined : row.muscleMass / 1000,
        visceralFat: row.visceralFat, metabolicAge: row.metabolicAge, source: 'garmin' })
    }
    return this.complete(readings, results)
  }
  async getWeightMeasurements(options?: DateRangeOptions): Promise<WeightMeasurement[]> { return this.getBodyComposition(options) }
  async getDailyHydration(options?: DateRangeOptions): Promise<DailyHydration[]> {
    const results = await this.readDays(options, async date => ({ date, data: await this.client.getHydrationData(date.toISOString().slice(0, 10)) }))
    const days: DailyHydration[] = []
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue
      const { date, data } = result.value
      const row = data as { valueInML?: number }
      if (finite(row?.valueInML) && row.valueInML >= 0) days.push({ day: date.toISOString().slice(0, 10), volumeMl: row.valueInML, samples: 0, source: 'garmin' })
    }
    return this.complete(days, results)
  }
  async getBodyBattery(options?: DateRangeOptions): Promise<BodyBatteryReading[]> {
    const results = await this.readDays(options, date => this.client.getBodyBatteryData(date))
    const days: BodyBatteryReading[] = []
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue
      const row = result.value
      days.push({ day: row.date.toISOString().slice(0, 10), startLevel: row.startLevel, endLevel: row.endLevel, charged: row.chargedValue, drained: row.drainedValue,
        samples: row.samples.map(sample => ({ timestamp: sample.timestamp.toISOString(), level: sample.level })), source: 'garmin' })
    }
    return this.complete(days, results)
  }
  async getReadiness(options?: DateRangeOptions): Promise<DailyReadiness[]> {
    const results = await this.readDays(options, date => this.client.getTrainingReadiness(date.toISOString().slice(0, 10)))
    const days: DailyReadiness[] = []
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue
      const rows = Array.isArray(result.value) ? result.value : [result.value]
      // Last applied is the primary device's latest snapshot.
      rows.sort((a: any, b: any) => Number(a.primaryTrainingDevice === true) - Number(b.primaryTrainingDevice === true) || String(a.timestamp || '').localeCompare(String(b.timestamp || '')))
      for (const row of rows) if (typeof row.calendarDate === 'string' && finite(row.score)) days.push({ day: row.calendarDate, score: row.score, timestamp: row.timestamp, id: `${row.calendarDate}:${row.deviceId || ''}:${row.timestamp || ''}`, details: row, contributors: {}, source: 'garmin' })
    }
    return this.complete(days, results)
  }
  async getVO2Max(options?: DateRangeOptions): Promise<VO2MaxReading[]> {
    await this.ensureAuth()
    const { start, end } = this.range(options)
    const response = await this.client.getMaxMetrics(start, end)
    const readings: VO2MaxReading[] = []
    for (const row of Array.isArray(response) ? response : [response]) {
      for (const [key, activity] of [['generic', 'running'], ['cycling', 'cycling']] as const) {
        const value = row?.[key]
        const vo2 = value?.vo2MaxPreciseValue ?? value?.vo2MaxValue
        if (typeof value?.calendarDate === 'string' && finite(vo2) && vo2 > 0) readings.push({ day: value.calendarDate, vo2Max: vo2, activity, source: 'garmin' })
      }
    }
    return readings
  }
  async getPersonalInfo(): Promise<PersonalInfo | null> {
    await this.ensureAuth()
    const profile = await this.client.getUserProfile()
    return { id: profile.profileId }
  }
  async getSpO2(): Promise<DailySpO2[]> { return [] }
  async getBodyTemperature(): Promise<BodyTemperature[]> { return [] }
}
export function createGarminHealthDriver(config: GarminHealthConfig): GarminHealthDriver { return new GarminHealthDriver(config) }
