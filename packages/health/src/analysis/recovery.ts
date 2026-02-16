import type {
  DailyReadiness,
  SleepSession,
  HRVSample,
  DailyActivity,
  RecoveryScore,
} from '../types'

export class RecoveryAnalyzer {
  calculateRecovery(params: {
    readiness?: DailyReadiness[]
    sleep?: SleepSession[]
    hrv?: HRVSample[]
    activity?: DailyActivity[]
  }): RecoveryScore {
    const factors = {
      sleepScore: this.scoreSleep(params.sleep),
      hrvTrend: this.scoreHRVTrend(params.hrv),
      restingHRTrend: this.scoreRestingHRTrend(params.sleep),
      strainBalance: this.scoreStrainBalance(params.activity),
    }

    const score = Math.round(
      factors.sleepScore * 0.35
      + factors.hrvTrend * 0.30
      + factors.restingHRTrend * 0.20
      + factors.strainBalance * 0.15,
    )

    return {
      score,
      status: this.getStatus(score),
      factors,
    }
  }

  // ===========================================================================
  // Private scoring methods
  // ===========================================================================

  private scoreSleep(sessions?: SleepSession[]): number {
    if (!sessions || sessions.length === 0) return 50

    const sorted = [...sessions].sort((a, b) => a.day.localeCompare(b.day))
    const last = sorted[sorted.length - 1]

    const hoursSlept = last.totalSleepDuration / 3600
    const efficiency = last.efficiency
    const deepPercent = last.totalSleepDuration > 0
      ? last.deepSleepDuration / last.totalSleepDuration
      : 0

    let score = 0

    // Duration (0-40 points)
    if (hoursSlept >= 8) score += 40
    else if (hoursSlept >= 7) score += 35
    else if (hoursSlept >= 6) score += 25
    else if (hoursSlept >= 5) score += 15
    else score += 5

    // Efficiency (0-30 points)
    if (efficiency >= 92) score += 30
    else if (efficiency >= 87) score += 25
    else if (efficiency >= 82) score += 20
    else if (efficiency >= 75) score += 10
    else score += 5

    // Deep sleep proportion (0-30 points)
    if (deepPercent >= 0.22) score += 30
    else if (deepPercent >= 0.18) score += 25
    else if (deepPercent >= 0.13) score += 18
    else if (deepPercent >= 0.08) score += 10
    else score += 5

    return Math.min(100, score)
  }

  private scoreHRVTrend(samples?: HRVSample[]): number {
    if (!samples || samples.length < 3) return 50

    const sorted = [...samples].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    const values = sorted.map(s => s.hrv)

    if (values.length < 7) {
      const avg = values.reduce((a, b) => a + b, 0) / values.length
      // Score on absolute HRV
      if (avg >= 65) return 90
      if (avg >= 50) return 75
      if (avg >= 35) return 55
      if (avg >= 20) return 35
      return 20
    }

    // Compare 3-day rolling average to 14-day baseline
    const recentWindow = Math.min(3, values.length)
    const baselineWindow = Math.min(14, values.length)

    const recent = values.slice(-recentWindow).reduce((a, b) => a + b, 0) / recentWindow
    const baseline = values.slice(-baselineWindow).reduce((a, b) => a + b, 0) / baselineWindow

    const ratio = recent / baseline
    if (ratio >= 1.10) return 95
    if (ratio >= 1.0) return 80
    if (ratio >= 0.90) return 65
    if (ratio >= 0.80) return 45
    return 25
  }

  private scoreRestingHRTrend(sessions?: SleepSession[]): number {
    if (!sessions || sessions.length < 3) return 50

    const sorted = [...sessions].sort((a, b) => a.day.localeCompare(b.day))
    const restingHRs = sorted
      .filter(s => s.lowestHeartRate !== undefined)
      .map(s => s.lowestHeartRate!)

    if (restingHRs.length < 3) return 50

    // Compare recent to baseline - lower is better for recovery
    const recent = restingHRs.slice(-3).reduce((a, b) => a + b, 0) / 3
    const baseline = restingHRs.reduce((a, b) => a + b, 0) / restingHRs.length

    const diff = baseline - recent // Positive = improving (HR going down)

    if (diff >= 3) return 90
    if (diff >= 1) return 75
    if (diff >= -1) return 60
    if (diff >= -3) return 40
    return 25
  }

  private scoreStrainBalance(activity?: DailyActivity[]): number {
    if (!activity || activity.length < 3) return 50

    const sorted = [...activity].sort((a, b) => a.day.localeCompare(b.day))
    const scores = sorted.map(a => a.score)

    // Calculate strain trend - are we tapering or building?
    const recent = scores.slice(-3).reduce((a, b) => a + b, 0) / 3
    const previous = scores.slice(-7, -3)

    if (previous.length === 0) return 50

    const previousAvg = previous.reduce((a, b) => a + b, 0) / previous.length

    // Lower recent strain relative to previous = better recovery
    if (recent < previousAvg * 0.7) return 90
    if (recent < previousAvg * 0.85) return 75
    if (recent < previousAvg * 1.0) return 60
    if (recent < previousAvg * 1.15) return 45
    return 30
  }

  private getStatus(score: number): RecoveryScore['status'] {
    if (score >= 80) return 'fully_recovered'
    if (score >= 60) return 'mostly_recovered'
    if (score >= 40) return 'partially_recovered'
    return 'not_recovered'
  }
}

export function createRecoveryAnalyzer(): RecoveryAnalyzer {
  return new RecoveryAnalyzer()
}
