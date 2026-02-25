import { readFileSync, existsSync } from 'node:fs'
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

interface AppleHealthRecord {
  type: string
  sourceName: string
  unit: string
  creationDate: string
  startDate: string
  endDate: string
  value: string
}

interface AppleHealthWorkoutRecord {
  workoutActivityType: string
  duration: string
  durationUnit: string
  totalDistance: string
  totalDistanceUnit: string
  totalEnergyBurned: string
  totalEnergyBurnedUnit: string
  sourceName: string
  creationDate: string
  startDate: string
  endDate: string
}

export class AppleHealthDriver implements HealthDriver {
  readonly name = 'Apple Health'
  readonly type = 'apple_health' as const

  private exportPath: string
  private records: AppleHealthRecord[] = []
  private workoutRecords: AppleHealthWorkoutRecord[] = []
  private loaded = false

  constructor(exportPath: string) {
    this.exportPath = exportPath
  }

  isAuthenticated(): boolean {
    return existsSync(this.exportPath)
  }

  private ensureLoaded(): void {
    if (this.loaded) return

    if (!existsSync(this.exportPath)) {
      throw new Error(`Apple Health export not found: ${this.exportPath}`)
    }

    const content = readFileSync(this.exportPath, 'utf8')
    this.records = this.parseHealthRecords(content)
    this.workoutRecords = this.parseWorkoutRecords(content)
    this.loaded = true
  }

  private parseHealthRecords(xml: string): AppleHealthRecord[] {
    const records: AppleHealthRecord[] = []
    const recordRegex = /<Record\s+([^>]+)\/>/g
    let match: RegExpExecArray | null

    while ((match = recordRegex.exec(xml)) !== null) {
      const attrs = match[1]
      records.push({
        type: this.extractAttr(attrs, 'type'),
        sourceName: this.extractAttr(attrs, 'sourceName'),
        unit: this.extractAttr(attrs, 'unit'),
        creationDate: this.extractAttr(attrs, 'creationDate'),
        startDate: this.extractAttr(attrs, 'startDate'),
        endDate: this.extractAttr(attrs, 'endDate'),
        value: this.extractAttr(attrs, 'value'),
      })
    }

    return records
  }

  private parseWorkoutRecords(xml: string): AppleHealthWorkoutRecord[] {
    const records: AppleHealthWorkoutRecord[] = []
    const workoutRegex = /<Workout\s+([^>]+?)(?:\/>|>)/g
    let match: RegExpExecArray | null

    while ((match = workoutRegex.exec(xml)) !== null) {
      const attrs = match[1]
      records.push({
        workoutActivityType: this.extractAttr(attrs, 'workoutActivityType'),
        duration: this.extractAttr(attrs, 'duration'),
        durationUnit: this.extractAttr(attrs, 'durationUnit'),
        totalDistance: this.extractAttr(attrs, 'totalDistance'),
        totalDistanceUnit: this.extractAttr(attrs, 'totalDistanceUnit'),
        totalEnergyBurned: this.extractAttr(attrs, 'totalEnergyBurned'),
        totalEnergyBurnedUnit: this.extractAttr(attrs, 'totalEnergyBurnedUnit'),
        sourceName: this.extractAttr(attrs, 'sourceName'),
        creationDate: this.extractAttr(attrs, 'creationDate'),
        startDate: this.extractAttr(attrs, 'startDate'),
        endDate: this.extractAttr(attrs, 'endDate'),
      })
    }

    return records
  }

  private extractAttr(attrs: string, name: string): string {
    const regex = new RegExp(`${name}="([^"]*)"`)
    const match = attrs.match(regex)
    return match ? match[1] : ''
  }

  private filterByDate(startDate: string, options?: DateRangeOptions): boolean {
    if (!options) return true
    const day = startDate.slice(0, 10)
    if (options.startDate && day < options.startDate) return false
    if (options.endDate && day > options.endDate) return false
    return true
  }

  private getRecordsByType(type: string, options?: DateRangeOptions): AppleHealthRecord[] {
    this.ensureLoaded()
    return this.records.filter(r =>
      r.type === type && this.filterByDate(r.startDate, options),
    )
  }

  // ===========================================================================
  // Sleep
  // ===========================================================================

  async getSleep(options?: DateRangeOptions): Promise<SleepSession[]> {
    const sleepRecords = this.getRecordsByType('HKCategoryTypeIdentifierSleepAnalysis', options)

    // Group by day
    const byDay = new Map<string, AppleHealthRecord[]>()
    for (const record of sleepRecords) {
      const day = record.startDate.slice(0, 10)
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day)!.push(record)
    }

    const sessions: SleepSession[] = []

    for (const [day, dayRecords] of byDay) {
      const sorted = dayRecords.sort((a, b) => a.startDate.localeCompare(b.startDate))
      const first = sorted[0]
      const last = sorted[sorted.length - 1]

      let deepDuration = 0
      let remDuration = 0
      let lightDuration = 0 // core sleep
      let awakeDuration = 0
      let totalDuration = 0

      for (const r of sorted) {
        const start = new Date(r.startDate).getTime()
        const end = new Date(r.endDate).getTime()
        const durationSec = (end - start) / 1000

        switch (r.value) {
          case 'HKCategoryValueSleepAnalysisAsleepDeep':
            deepDuration += durationSec
            totalDuration += durationSec
            break
          case 'HKCategoryValueSleepAnalysisAsleepREM':
            remDuration += durationSec
            totalDuration += durationSec
            break
          case 'HKCategoryValueSleepAnalysisAsleepCore':
          case 'HKCategoryValueSleepAnalysisAsleep':
            lightDuration += durationSec
            totalDuration += durationSec
            break
          case 'HKCategoryValueSleepAnalysisAwake':
          case 'HKCategoryValueSleepAnalysisInBed':
            awakeDuration += durationSec
            break
        }
      }

      const bedStart = new Date(first.startDate).getTime()
      const bedEnd = new Date(last.endDate).getTime()
      const timeInBed = (bedEnd - bedStart) / 1000

      sessions.push({
        id: `apple_${day}`,
        day,
        bedtimeStart: first.startDate,
        bedtimeEnd: last.endDate,
        type: totalDuration > 3 * 3600 ? 'long_sleep' : 'nap',
        totalSleepDuration: Math.round(totalDuration),
        deepSleepDuration: Math.round(deepDuration),
        lightSleepDuration: Math.round(lightDuration),
        remSleepDuration: Math.round(remDuration),
        awakeTime: Math.round(awakeDuration),
        timeInBed: Math.round(timeInBed),
        latency: 0,
        efficiency: timeInBed > 0 ? Math.round((totalDuration / timeInBed) * 100) : 0,
        stages: [],
        source: 'apple_health' as const,
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
        deepSleep: s.totalSleepDuration > 0 ? Math.round((s.deepSleepDuration / s.totalSleepDuration) * 100) : undefined,
        remSleep: s.totalSleepDuration > 0 ? Math.round((s.remSleepDuration / s.totalSleepDuration) * 100) : undefined,
      },
      source: 'apple_health' as const,
    }))
  }

  // ===========================================================================
  // Activity
  // ===========================================================================

  async getDailyActivity(options?: DateRangeOptions): Promise<DailyActivity[]> {
    const stepRecords = this.getRecordsByType('HKQuantityTypeIdentifierStepCount', options)
    const calorieRecords = this.getRecordsByType('HKQuantityTypeIdentifierActiveEnergyBurned', options)
    const distanceRecords = this.getRecordsByType('HKQuantityTypeIdentifierDistanceWalkingRunning', options)

    // Group by day
    const byDay = new Map<string, {
      steps: number
      calories: number
      distance: number
    }>()

    for (const r of stepRecords) {
      const day = r.startDate.slice(0, 10)
      if (!byDay.has(day)) byDay.set(day, { steps: 0, calories: 0, distance: 0 })
      byDay.get(day)!.steps += Number.parseFloat(r.value) || 0
    }

    for (const r of calorieRecords) {
      const day = r.startDate.slice(0, 10)
      if (!byDay.has(day)) byDay.set(day, { steps: 0, calories: 0, distance: 0 })
      byDay.get(day)!.calories += Number.parseFloat(r.value) || 0
    }

    for (const r of distanceRecords) {
      const day = r.startDate.slice(0, 10)
      if (!byDay.has(day)) byDay.set(day, { steps: 0, calories: 0, distance: 0 })
      byDay.get(day)!.distance += Number.parseFloat(r.value) || 0
    }

    return Array.from(byDay.entries()).map(([day, data]) => ({
      day,
      score: 0,
      activeCalories: Math.round(data.calories),
      totalCalories: Math.round(data.calories),
      steps: Math.round(data.steps),
      equivalentWalkingDistance: Math.round(data.distance * 1000),
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
      source: 'apple_health' as const,
    }))
  }

  // ===========================================================================
  // Workouts
  // ===========================================================================

  async getWorkouts(options?: DateRangeOptions): Promise<Workout[]> {
    this.ensureLoaded()

    return this.workoutRecords
      .filter(w => this.filterByDate(w.startDate, options))
      .map((w, i) => ({
        id: `apple_workout_${i}`,
        activity: w.workoutActivityType.replace('HKWorkoutActivityType', ''),
        day: w.startDate.slice(0, 10),
        startDatetime: w.startDate,
        endDatetime: w.endDate,
        calories: Number.parseFloat(w.totalEnergyBurned) || undefined,
        distance: Number.parseFloat(w.totalDistance) ? Number.parseFloat(w.totalDistance) * 1000 : undefined,
        source: 'apple_health' as const,
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
    const records = this.getRecordsByType('HKQuantityTypeIdentifierHeartRate', options)

    return records.map(r => ({
      timestamp: r.startDate,
      bpm: Math.round(Number.parseFloat(r.value) || 0),
      source: r.sourceName,
    }))
  }

  // ===========================================================================
  // HRV
  // ===========================================================================

  async getHRV(options?: DateRangeOptions): Promise<HRVSample[]> {
    const records = this.getRecordsByType('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', options)

    return records.map(r => ({
      timestamp: r.startDate,
      hrv: Number.parseFloat(r.value) || 0,
    }))
  }

  // ===========================================================================
  // SpO2
  // ===========================================================================

  async getSpO2(options?: DateRangeOptions): Promise<DailySpO2[]> {
    const records = this.getRecordsByType('HKQuantityTypeIdentifierOxygenSaturation', options)

    // Group by day and average
    const byDay = new Map<string, number[]>()
    for (const r of records) {
      const day = r.startDate.slice(0, 10)
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day)!.push(Number.parseFloat(r.value) * 100)
    }

    return Array.from(byDay.entries()).map(([day, values]) => ({
      day,
      averageSpO2: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
      minSpO2: Math.round(Math.min(...values)),
      maxSpO2: Math.round(Math.max(...values)),
      source: 'apple_health' as const,
    }))
  }

  // ===========================================================================
  // Stress (not natively available)
  // ===========================================================================

  async getStress(_options?: DateRangeOptions): Promise<DailyStress[]> {
    return []
  }

  // ===========================================================================
  // Body Temperature
  // ===========================================================================

  async getBodyTemperature(options?: DateRangeOptions): Promise<BodyTemperature[]> {
    const records = this.getRecordsByType('HKQuantityTypeIdentifierAppleSleepingWristTemperature', options)

    return records.map(r => ({
      day: r.startDate.slice(0, 10),
      deviation: Number.parseFloat(r.value) || undefined,
      source: 'apple_health' as const,
    }))
  }

  // ===========================================================================
  // VO2 Max
  // ===========================================================================

  async getVO2Max(options?: DateRangeOptions): Promise<VO2MaxReading[]> {
    const records = this.getRecordsByType('HKQuantityTypeIdentifierVO2Max', options)

    return records.map(r => ({
      day: r.startDate.slice(0, 10),
      vo2Max: Number.parseFloat(r.value) || 0,
      source: 'apple_health' as const,
    }))
  }

  // ===========================================================================
  // Body Composition (Apple Health can store scale data)
  // ===========================================================================

  async getBodyComposition(options?: DateRangeOptions): Promise<BodyComposition[]> {
    const weightRecords = this.getRecordsByType('HKQuantityTypeIdentifierBodyMass', options)
    const fatRecords = this.getRecordsByType('HKQuantityTypeIdentifierBodyFatPercentage', options)
    const leanRecords = this.getRecordsByType('HKQuantityTypeIdentifierLeanBodyMass', options)
    const bmiRecords = this.getRecordsByType('HKQuantityTypeIdentifierBodyMassIndex', options)

    const fatByDay = new Map(fatRecords.map(r => [r.startDate.slice(0, 10), Number.parseFloat(r.value)]))
    const leanByDay = new Map(leanRecords.map(r => [r.startDate.slice(0, 10), Number.parseFloat(r.value)]))
    const bmiByDay = new Map(bmiRecords.map(r => [r.startDate.slice(0, 10), Number.parseFloat(r.value)]))

    return weightRecords.map((r, i) => {
      const day = r.startDate.slice(0, 10)
      return {
        id: `apple_health_bc_${i}`,
        day,
        timestamp: r.startDate,
        weight: Number.parseFloat(r.value),
        bmi: bmiByDay.get(day),
        bodyFatPercentage: fatByDay.get(day),
        leanMass: leanByDay.get(day),
        source: 'apple_health' as const,
      }
    })
  }

  async getWeightMeasurements(options?: DateRangeOptions): Promise<WeightMeasurement[]> {
    const records = this.getRecordsByType('HKQuantityTypeIdentifierBodyMass', options)
    const bmiRecords = this.getRecordsByType('HKQuantityTypeIdentifierBodyMassIndex', options)

    const bmiByDay = new Map(bmiRecords.map(r => [r.startDate.slice(0, 10), Number.parseFloat(r.value)]))

    return records.map((r, i) => {
      const day = r.startDate.slice(0, 10)
      return {
        id: `apple_health_wt_${i}`,
        day,
        timestamp: r.startDate,
        weight: Number.parseFloat(r.value),
        bmi: bmiByDay.get(day),
        source: 'apple_health' as const,
      }
    })
  }

  // ===========================================================================
  // Personal Info
  // ===========================================================================

  async getPersonalInfo(): Promise<PersonalInfo | null> {
    this.ensureLoaded()

    const heightRecords = this.records.filter(r => r.type === 'HKQuantityTypeIdentifierHeight')
    const weightRecords = this.records.filter(r => r.type === 'HKQuantityTypeIdentifierBodyMass')

    const latestHeight = heightRecords.length > 0 ? heightRecords[heightRecords.length - 1] : null
    const latestWeight = weightRecords.length > 0 ? weightRecords[weightRecords.length - 1] : null

    return {
      height: latestHeight ? Number.parseFloat(latestHeight.value) : undefined,
      weight: latestWeight ? Number.parseFloat(latestWeight.value) : undefined,
    }
  }
}

export function createAppleHealthDriver(exportPath: string): AppleHealthDriver {
  return new AppleHealthDriver(exportPath)
}
