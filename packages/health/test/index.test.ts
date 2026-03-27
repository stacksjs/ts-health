import { describe, expect, it } from 'bun:test'
import { SleepAnalyzer } from '../src/analysis/sleep'
import { ReadinessAnalyzer } from '../src/analysis/readiness'
import { RecoveryAnalyzer } from '../src/analysis/recovery'
import { TrendAnalyzer } from '../src/analysis/trends'
import { OuraDriver } from '../src/drivers/oura'
import { WhoopDriver } from '../src/drivers/whoop'
import { FitbitDriver } from '../src/drivers/fitbit'
import { AppleHealthDriver } from '../src/drivers/apple-health'
import { WithingsDriver } from '../src/drivers/withings'
import { RenphoDriver } from '../src/drivers/renpho'
import type { SleepSession, HRVSample, HeartRateSample, DailyReadiness, DailyActivity } from '../src/types'

// ============================================================================
// Test helpers
// ============================================================================

function makeSleepSession(overrides: Partial<SleepSession> = {}): SleepSession {
  return {
    id: '1',
    day: '2025-01-15',
    bedtimeStart: '2025-01-14T22:30:00Z',
    bedtimeEnd: '2025-01-15T06:30:00Z',
    type: 'long_sleep',
    totalSleepDuration: 7.5 * 3600,
    deepSleepDuration: 1.5 * 3600,
    lightSleepDuration: 3.5 * 3600,
    remSleepDuration: 2 * 3600,
    awakeTime: 30 * 60,
    timeInBed: 8 * 3600,
    latency: 10 * 60,
    efficiency: 93,
    stages: [],
    source: 'oura',
    ...overrides,
  }
}

function makeHRVSamples(values: number[], startDay = '2025-01-10'): HRVSample[] {
  return values.map((hrv, i) => {
    const d = new Date(startDay)
    d.setDate(d.getDate() + i)
    return { timestamp: d.toISOString(), hrv }
  })
}

function makeHeartRateSamples(bpms: number[]): HeartRateSample[] {
  return bpms.map((bpm, i) => ({
    timestamp: `2025-01-15T${String(i).padStart(2, '0')}:00:00Z`,
    bpm,
  }))
}

// ============================================================================
// Driver supportedMetrics
// ============================================================================

describe('Driver supportedMetrics', () => {
  it('Oura supports wearable metrics but not body composition', () => {
    const driver = new OuraDriver('test-token')
    expect(driver.supportedMetrics.has('sleep')).toBe(true)
    expect(driver.supportedMetrics.has('heartRate')).toBe(true)
    expect(driver.supportedMetrics.has('hrv')).toBe(true)
    expect(driver.supportedMetrics.has('readiness')).toBe(true)
    expect(driver.supportedMetrics.has('bodyComposition')).toBe(false)
    expect(driver.supportedMetrics.has('weightMeasurements')).toBe(false)
  })

  it('WHOOP does not support heartRate or vo2Max', () => {
    const driver = new WhoopDriver('test-token')
    expect(driver.supportedMetrics.has('sleep')).toBe(true)
    expect(driver.supportedMetrics.has('readiness')).toBe(true)
    expect(driver.supportedMetrics.has('heartRate')).toBe(false)
    expect(driver.supportedMetrics.has('vo2Max')).toBe(false)
    expect(driver.supportedMetrics.has('bodyComposition')).toBe(false)
  })

  it('Fitbit supports most metrics except readiness and stress', () => {
    const driver = new FitbitDriver('test-token')
    expect(driver.supportedMetrics.has('sleep')).toBe(true)
    expect(driver.supportedMetrics.has('heartRate')).toBe(true)
    expect(driver.supportedMetrics.has('bodyComposition')).toBe(true)
    expect(driver.supportedMetrics.has('readiness')).toBe(false)
    expect(driver.supportedMetrics.has('stress')).toBe(false)
  })

  it('Apple Health supports most metrics except readiness and stress', () => {
    const driver = new AppleHealthDriver('./nonexistent.xml')
    expect(driver.supportedMetrics.has('sleep')).toBe(true)
    expect(driver.supportedMetrics.has('heartRate')).toBe(true)
    expect(driver.supportedMetrics.has('vo2Max')).toBe(true)
    expect(driver.supportedMetrics.has('readiness')).toBe(false)
    expect(driver.supportedMetrics.has('stress')).toBe(false)
  })

  it('Withings only supports scale metrics and heart rate', () => {
    const driver = new WithingsDriver('test-token')
    expect(driver.supportedMetrics.has('bodyComposition')).toBe(true)
    expect(driver.supportedMetrics.has('weightMeasurements')).toBe(true)
    expect(driver.supportedMetrics.has('heartRate')).toBe(true)
    expect(driver.supportedMetrics.has('personalInfo')).toBe(true)
    expect(driver.supportedMetrics.has('sleep')).toBe(false)
    expect(driver.supportedMetrics.has('hrv')).toBe(false)
    expect(driver.supportedMetrics.size).toBe(4)
  })

  it('Renpho only supports scale metrics', () => {
    const driver = new RenphoDriver({ email: 'test', password: 'test' })
    expect(driver.supportedMetrics.has('bodyComposition')).toBe(true)
    expect(driver.supportedMetrics.has('weightMeasurements')).toBe(true)
    expect(driver.supportedMetrics.has('personalInfo')).toBe(true)
    expect(driver.supportedMetrics.has('sleep')).toBe(false)
    expect(driver.supportedMetrics.has('heartRate')).toBe(false)
    expect(driver.supportedMetrics.size).toBe(3)
  })
})

// ============================================================================
// Driver type and auth
// ============================================================================

describe('Driver type and authentication', () => {
  it('Oura has correct type and authenticates with token', () => {
    const driver = new OuraDriver('valid-token')
    expect(driver.type).toBe('oura')
    expect(driver.name).toBe('Oura Ring')
    expect(driver.isAuthenticated()).toBe(true)
  })

  it('Oura with empty token is not authenticated', () => {
    const driver = new OuraDriver('')
    expect(driver.isAuthenticated()).toBe(false)
  })

  it('WHOOP has correct type', () => {
    const driver = new WhoopDriver('valid-token')
    expect(driver.type).toBe('whoop')
    expect(driver.name).toBe('WHOOP')
    expect(driver.isAuthenticated()).toBe(true)
  })

  it('Fitbit has correct type', () => {
    const driver = new FitbitDriver('valid-token')
    expect(driver.type).toBe('fitbit')
    expect(driver.name).toBe('Fitbit')
  })

  it('Apple Health has correct type', () => {
    const driver = new AppleHealthDriver('./export.xml')
    expect(driver.type).toBe('apple_health')
    expect(driver.name).toBe('Apple Health')
  })

  it('Withings has correct type', () => {
    const driver = new WithingsDriver('valid-token')
    expect(driver.type).toBe('withings')
    expect(driver.name).toBe('Withings')
  })

  it('Renpho has correct type and is not authenticated before first call', () => {
    const driver = new RenphoDriver({ email: 'test@test.com', password: 'pass' })
    expect(driver.type).toBe('renpho')
    expect(driver.name).toBe('Renpho')
    expect(driver.isAuthenticated()).toBe(false)
  })
})

// ============================================================================
// Unsupported metrics return empty arrays
// ============================================================================

describe('Unsupported metrics return empty arrays', () => {
  it('WHOOP getHeartRate returns empty (not fake zeros)', async () => {
    const driver = new WhoopDriver('test-token')
    const result = await driver.getHeartRate()
    expect(result).toEqual([])
  })

  it('WHOOP getVO2Max returns empty', async () => {
    const driver = new WhoopDriver('test-token')
    const result = await driver.getVO2Max()
    expect(result).toEqual([])
  })

  it('WHOOP getBodyComposition returns empty', async () => {
    const driver = new WhoopDriver('test-token')
    const result = await driver.getBodyComposition()
    expect(result).toEqual([])
  })

  it('Renpho unsupported metrics all return empty', async () => {
    const driver = new RenphoDriver({ email: 'test', password: 'test' })
    expect(await driver.getSleep()).toEqual([])
    expect(await driver.getDailySleep()).toEqual([])
    expect(await driver.getDailyActivity()).toEqual([])
    expect(await driver.getWorkouts()).toEqual([])
    expect(await driver.getReadiness()).toEqual([])
    expect(await driver.getHeartRate()).toEqual([])
    expect(await driver.getHRV()).toEqual([])
    expect(await driver.getSpO2()).toEqual([])
    expect(await driver.getStress()).toEqual([])
    expect(await driver.getBodyTemperature()).toEqual([])
    expect(await driver.getVO2Max()).toEqual([])
  })

  it('Withings unsupported metrics all return empty', async () => {
    const driver = new WithingsDriver('test-token')
    expect(await driver.getSleep()).toEqual([])
    expect(await driver.getDailySleep()).toEqual([])
    expect(await driver.getDailyActivity()).toEqual([])
    expect(await driver.getWorkouts()).toEqual([])
    expect(await driver.getReadiness()).toEqual([])
    expect(await driver.getHRV()).toEqual([])
    expect(await driver.getSpO2()).toEqual([])
    expect(await driver.getStress()).toEqual([])
    expect(await driver.getBodyTemperature()).toEqual([])
    expect(await driver.getVO2Max()).toEqual([])
  })
})

// ============================================================================
// Sleep Analysis
// ============================================================================

describe('SleepAnalyzer', () => {
  const analyzer = new SleepAnalyzer()

  describe('scoreSleepQuality', () => {
    it('scores excellent sleep highly', () => {
      const session = makeSleepSession({
        totalSleepDuration: 8 * 3600,
        deepSleepDuration: 1.8 * 3600,
        remSleepDuration: 2 * 3600,
        efficiency: 95,
        latency: 10 * 60,
      })
      const score = analyzer.scoreSleepQuality(session)
      expect(score.overall).toBeGreaterThanOrEqual(80)
      expect(score.rating).toBe('excellent')
    })

    it('scores poor sleep low', () => {
      const session = makeSleepSession({
        totalSleepDuration: 4 * 3600,
        deepSleepDuration: 15 * 60,
        remSleepDuration: 20 * 60,
        efficiency: 65,
        latency: 60 * 60,
      })
      const score = analyzer.scoreSleepQuality(session)
      expect(score.overall).toBeLessThanOrEqual(40)
      expect(score.rating).toBe('poor')
    })

    it('handles zero duration without crashing', () => {
      const session = makeSleepSession({
        totalSleepDuration: 0,
        deepSleepDuration: 0,
        remSleepDuration: 0,
      })
      const score = analyzer.scoreSleepQuality(session)
      expect(score.overall).toBeGreaterThanOrEqual(0)
      expect(score.deepSleepScore).toBe(0)
      expect(score.remSleepScore).toBe(0)
    })

    it('uses actual consistency when recentSessions provided', () => {
      const sessions = [
        makeSleepSession({ day: '2025-01-13', bedtimeStart: '2025-01-12T22:30:00Z', bedtimeEnd: '2025-01-13T06:30:00Z' }),
        makeSleepSession({ day: '2025-01-14', bedtimeStart: '2025-01-13T22:30:00Z', bedtimeEnd: '2025-01-14T06:30:00Z' }),
        makeSleepSession({ day: '2025-01-15', bedtimeStart: '2025-01-14T22:30:00Z', bedtimeEnd: '2025-01-15T06:30:00Z' }),
      ]
      // Consistent bedtimes should yield high consistency
      const scoreWith = analyzer.scoreSleepQuality(sessions[2], sessions)
      expect(scoreWith.consistencyScore).toBeGreaterThan(80)
    })

    it('falls back to 50 when less than 3 sessions', () => {
      const sessions = [makeSleepSession(), makeSleepSession({ day: '2025-01-16' })]
      const score = analyzer.scoreSleepQuality(sessions[0], sessions)
      expect(score.consistencyScore).toBe(50)
    })
  })

  describe('scoreSleepConsistency', () => {
    it('returns 50 when fewer than 3 sessions', () => {
      const sessions = [makeSleepSession(), makeSleepSession()]
      expect(analyzer.scoreSleepConsistency(sessions)).toBe(50)
    })

    it('scores consistent bedtimes highly', () => {
      const sessions = [
        makeSleepSession({ bedtimeStart: '2025-01-12T22:30:00Z', bedtimeEnd: '2025-01-13T06:30:00Z' }),
        makeSleepSession({ bedtimeStart: '2025-01-13T22:30:00Z', bedtimeEnd: '2025-01-14T06:30:00Z' }),
        makeSleepSession({ bedtimeStart: '2025-01-14T22:30:00Z', bedtimeEnd: '2025-01-15T06:30:00Z' }),
        makeSleepSession({ bedtimeStart: '2025-01-15T22:30:00Z', bedtimeEnd: '2025-01-16T06:30:00Z' }),
      ]
      const score = analyzer.scoreSleepConsistency(sessions)
      expect(score).toBeGreaterThanOrEqual(90)
    })

    it('scores inconsistent bedtimes low', () => {
      const sessions = [
        makeSleepSession({ bedtimeStart: '2025-01-12T21:00:00Z', bedtimeEnd: '2025-01-13T05:00:00Z' }),
        makeSleepSession({ bedtimeStart: '2025-01-14T01:00:00Z', bedtimeEnd: '2025-01-14T09:00:00Z' }),
        makeSleepSession({ bedtimeStart: '2025-01-14T23:00:00Z', bedtimeEnd: '2025-01-15T07:00:00Z' }),
        makeSleepSession({ bedtimeStart: '2025-01-16T03:00:00Z', bedtimeEnd: '2025-01-16T11:00:00Z' }),
      ]
      const score = analyzer.scoreSleepConsistency(sessions)
      expect(score).toBeLessThanOrEqual(60)
    })
  })

  describe('analyzeSleepDebt', () => {
    it('returns zero debt when no sessions', () => {
      const result = analyzer.analyzeSleepDebt([])
      expect(result.currentDebtMinutes).toBe(0)
      expect(result.trend).toBe('stable')
      expect(result.daysToRecover).toBe(0)
    })

    it('detects sleep debt when under target', () => {
      const sessions = [
        makeSleepSession({ totalSleepDuration: 6 * 3600 }),
        makeSleepSession({ totalSleepDuration: 5.5 * 3600 }),
        makeSleepSession({ totalSleepDuration: 6 * 3600 }),
      ]
      const result = analyzer.analyzeSleepDebt(sessions, 480) // 8h target
      expect(result.currentDebtMinutes).toBeGreaterThan(0)
      expect(result.weeklyAverageMinutes).toBeLessThan(480)
    })

    it('reports zero debt when exceeding target', () => {
      const sessions = [
        makeSleepSession({ totalSleepDuration: 9 * 3600 }),
        makeSleepSession({ totalSleepDuration: 8.5 * 3600 }),
      ]
      const result = analyzer.analyzeSleepDebt(sessions, 480)
      expect(result.currentDebtMinutes).toBe(0)
    })

    it('detects recovering trend', () => {
      const sessions = [
        makeSleepSession({ totalSleepDuration: 5 * 3600 }),
        makeSleepSession({ totalSleepDuration: 5 * 3600 }),
        makeSleepSession({ totalSleepDuration: 8 * 3600 }),
        makeSleepSession({ totalSleepDuration: 8.5 * 3600 }),
      ]
      const result = analyzer.analyzeSleepDebt(sessions, 480)
      expect(result.trend).toBe('recovering')
    })

    it('detects accumulating trend', () => {
      const sessions = [
        makeSleepSession({ totalSleepDuration: 8 * 3600 }),
        makeSleepSession({ totalSleepDuration: 8 * 3600 }),
        makeSleepSession({ totalSleepDuration: 5 * 3600 }),
        makeSleepSession({ totalSleepDuration: 4.5 * 3600 }),
      ]
      const result = analyzer.analyzeSleepDebt(sessions, 480)
      expect(result.trend).toBe('accumulating')
    })
  })
})

// ============================================================================
// Readiness Analysis
// ============================================================================

describe('ReadinessAnalyzer', () => {
  const analyzer = new ReadinessAnalyzer()

  it('returns a score between 0 and 100', () => {
    const result = analyzer.calculateTrainingReadiness({})
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
  })

  it('returns default 50 factors with no data', () => {
    const result = analyzer.calculateTrainingReadiness({})
    expect(result.score).toBe(50)
    expect(result.recommendation).toBe('easy_day')
  })

  it('recommends go_hard with excellent data', () => {
    const result = analyzer.calculateTrainingReadiness({
      hrv: makeHRVSamples([60, 62, 65, 68, 70, 72, 75]),
      sleep: [
        makeSleepSession({ totalSleepDuration: 8 * 3600, efficiency: 95, deepSleepDuration: 2 * 3600 }),
        makeSleepSession({ totalSleepDuration: 8 * 3600, efficiency: 94, deepSleepDuration: 1.8 * 3600 }),
      ],
      readiness: [
        { day: '2025-01-15', score: 90, contributors: {}, source: 'oura' },
      ],
      heartRate: makeHeartRateSamples([55, 54, 56, 55]),
    })
    expect(result.score).toBeGreaterThanOrEqual(70)
    expect(['go_hard', 'moderate']).toContain(result.recommendation)
  })

  it('recommends rest with poor data', () => {
    const result = analyzer.calculateTrainingReadiness({
      hrv: makeHRVSamples([40, 38, 35, 32, 30, 28, 25]),
      sleep: [
        makeSleepSession({ totalSleepDuration: 4 * 3600, efficiency: 60, deepSleepDuration: 0.5 * 3600 }),
      ],
      readiness: [
        { day: '2025-01-15', score: 30, contributors: {}, source: 'oura' },
      ],
    })
    expect(result.score).toBeLessThanOrEqual(45)
    expect(['rest', 'easy_day']).toContain(result.recommendation)
  })
})

// ============================================================================
// Recovery Analysis
// ============================================================================

describe('RecoveryAnalyzer', () => {
  const analyzer = new RecoveryAnalyzer()

  it('returns a score between 0 and 100', () => {
    const result = analyzer.calculateRecovery({})
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
  })

  it('returns default 50 with no data', () => {
    const result = analyzer.calculateRecovery({})
    expect(result.score).toBe(50)
    expect(result.status).toBe('partially_recovered')
  })

  it('reports fully recovered with good data', () => {
    const result = analyzer.calculateRecovery({
      sleep: [
        makeSleepSession({ totalSleepDuration: 8 * 3600, efficiency: 95, deepSleepDuration: 2 * 3600 }),
      ],
      hrv: makeHRVSamples([50, 55, 60, 65, 70, 72, 75]),
    })
    expect(result.score).toBeGreaterThanOrEqual(60)
    expect(['fully_recovered', 'mostly_recovered']).toContain(result.status)
  })
})

// ============================================================================
// Trend Analysis
// ============================================================================

describe('TrendAnalyzer', () => {
  const analyzer = new TrendAnalyzer()

  it('detects improving trend', () => {
    const dataPoints = Array.from({ length: 14 }, (_, i) => ({
      day: `2025-01-${String(i + 1).padStart(2, '0')}`,
      value: 50 + i * 2,
    }))
    const result = analyzer.analyzeTrend('HRV', dataPoints)
    expect(result.direction).toBe('improving')
    expect(result.percentChange).toBeGreaterThan(0)
  })

  it('detects declining trend', () => {
    const dataPoints = Array.from({ length: 14 }, (_, i) => ({
      day: `2025-01-${String(i + 1).padStart(2, '0')}`,
      value: 80 - i * 3,
    }))
    const result = analyzer.analyzeTrend('HRV', dataPoints)
    expect(result.direction).toBe('declining')
    expect(result.percentChange).toBeLessThan(0)
  })

  it('detects stable trend', () => {
    const dataPoints = Array.from({ length: 14 }, (_, i) => ({
      day: `2025-01-${String(i + 1).padStart(2, '0')}`,
      value: 60 + (i % 2 === 0 ? 1 : -1),
    }))
    const result = analyzer.analyzeTrend('HRV', dataPoints)
    expect(result.direction).toBe('stable')
  })

  it('handles empty data', () => {
    const result = analyzer.analyzeTrend('HRV', [])
    expect(result.direction).toBe('stable')
    expect(result.percentChange).toBe(0)
  })

  it('calculates moving average', () => {
    const dataPoints = [
      { day: '2025-01-01', value: 10 },
      { day: '2025-01-02', value: 20 },
      { day: '2025-01-03', value: 30 },
    ]
    const ma = analyzer.calculateMovingAverage(dataPoints, 3)
    expect(ma).toHaveLength(3)
    // Last entry should be the full-window average of [10, 20, 30]
    expect(ma[2].value).toBe(20)
  })

  it('detects anomalies beyond 2 std deviations', () => {
    const dataPoints = [
      ...Array.from({ length: 10 }, (_, i) => ({ day: `2025-01-${String(i + 1).padStart(2, '0')}`, value: 60 })),
      { day: '2025-01-11', value: 120 }, // outlier
    ]
    const anomalies = analyzer.detectAnomalies(dataPoints)
    expect(anomalies.length).toBeGreaterThanOrEqual(1)
    expect(anomalies.some(a => a.value === 120)).toBe(true)
  })

  it('analyzes multiple metrics', () => {
    const metrics = [
      {
        name: 'HRV',
        dataPoints: Array.from({ length: 7 }, (_, i) => ({
          day: `2025-01-${String(i + 1).padStart(2, '0')}`,
          value: 50 + i * 2,
        })),
      },
      {
        name: 'Sleep',
        dataPoints: Array.from({ length: 7 }, (_, i) => ({
          day: `2025-01-${String(i + 1).padStart(2, '0')}`,
          value: 7 + i * 0.1,
        })),
      },
    ]
    const results = analyzer.analyzeMultipleMetrics(metrics)
    expect(results).toHaveLength(2)
    expect(results[0].metric).toBe('HRV')
    expect(results[1].metric).toBe('Sleep')
  })
})
