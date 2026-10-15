import type { BodyComposition, BodyTemperature, DailyActivity, DailyReadiness, DailySleepSummary, DailySpO2, DailyStress, DateRangeOptions, HealthDriver, HealthMetric, HeartRateSample, HRVSample, PersonalInfo, SleepSession, VO2MaxReading, WeightMeasurement, Workout } from '../types'
import type { EightSleepConfig, EightSleepNight } from './types'
import { EightSleepClient } from './client'

/** The normalized HealthDriver and the full Pod API, from the same authenticated sleeper. */
export class EightSleepDriver extends EightSleepClient implements HealthDriver {
  readonly name: string = 'Eight Sleep'
  readonly type: 'eight_sleep' = 'eight_sleep'
  readonly supportedMetrics: ReadonlySet<HealthMetric> = new Set<HealthMetric>(['sleep', 'dailySleep', 'heartRate', 'hrv'])
  private readonly histories: Map<string, Promise<EightSleepNight[]>> = new Map()

  override getNights(options: DateRangeOptions = {}): Promise<EightSleepNight[]> {
    const key = JSON.stringify([options.startDate, options.endDate])
    let history = this.histories.get(key)
    if (!history) {
      history = super.getNights(options).catch((cause) => {
        this.histories.delete(key)
        throw cause
      })
      this.histories.set(key, history)
    }
    return history
  }

  async getSleep(options?: DateRangeOptions): Promise<SleepSession[]> {
    return (await this.getNights(options)).filter(night => night.bedtime && night.wakeTime && night.sleepSeconds !== null).map(night => ({
      id: `eight-sleep:${night.day}`, day: night.day, bedtimeStart: night.bedtime!, bedtimeEnd: night.wakeTime!, type: 'long_sleep',
      totalSleepDuration: night.sleepSeconds!, timeInBed: night.bedSeconds ?? 0, deepSleepDuration: night.deepSeconds ?? 0, lightSleepDuration: night.lightSeconds ?? 0,
      remSleepDuration: night.remSeconds ?? 0, awakeTime: night.awakeSeconds ?? 0, latency: night.latencySeconds ?? 0, efficiency: night.efficiency ?? 0,
      ...(night.score === null ? {} : { score: night.score }), ...(night.heartRate === null ? {} : { averageHeartRate: night.heartRate }),
      ...(night.restingHeartRate === null ? {} : { lowestHeartRate: night.restingHeartRate }), ...(night.hrv === null ? {} : { averageHRV: night.hrv }),
      ...(night.respiratoryRate === null ? {} : { averageBreath: night.respiratoryRate }),
      heartRateSamples: night.series.heartRate.map(point => ({ timestamp: point.timestamp, bpm: point.value })),
      hrvSamples: night.series.hrv.map(point => ({ timestamp: point.timestamp, hrv: point.value })), stages: night.stages, source: 'eight_sleep',
    }))
  }
  async getDailySleep(options?: DateRangeOptions): Promise<DailySleepSummary[]> {
    return (await this.getNights(options)).map(night => ({ day: night.day, ...(night.score === null ? {} : { score: night.score }),
      contributors: { ...(night.sleepSeconds === null ? {} : { totalSleep: night.sleepSeconds / 3600 }), ...(night.efficiency === null ? {} : { efficiency: night.efficiency }),
        ...(night.latencySeconds === null ? {} : { latency: night.latencySeconds }) }, source: 'eight_sleep' }))
  }
  async getHeartRate(options?: DateRangeOptions): Promise<HeartRateSample[]> {
    return (await this.getNights(options)).flatMap(night => night.series.heartRate.map(point => ({ timestamp: point.timestamp, bpm: point.value, source: 'eight_sleep' })))
  }
  async getHRV(options?: DateRangeOptions): Promise<HRVSample[]> {
    return (await this.getNights(options)).flatMap(night => night.series.hrv.length ? night.series.hrv.map(point => ({ timestamp: point.timestamp, hrv: point.value }))
      : night.hrv !== null && night.wakeTime ? [{ timestamp: night.wakeTime, hrv: night.hrv }] : [])
  }
  async getDailyActivity(): Promise<DailyActivity[]> { return [] }
  async getWorkouts(): Promise<Workout[]> { return [] }
  async getReadiness(): Promise<DailyReadiness[]> { return [] }
  async getSpO2(): Promise<DailySpO2[]> { return [] }
  async getStress(): Promise<DailyStress[]> { return [] }
  async getBodyTemperature(): Promise<BodyTemperature[]> { return [] }
  async getVO2Max(): Promise<VO2MaxReading[]> { return [] }
  async getBodyComposition(): Promise<BodyComposition[]> { return [] }
  async getWeightMeasurements(): Promise<WeightMeasurement[]> { return [] }
  async getPersonalInfo(): Promise<PersonalInfo | null> { return null }
}

export function createEightSleepDriver(config: EightSleepConfig): EightSleepDriver { return new EightSleepDriver(config) }
