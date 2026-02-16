import type {
  DailyReadiness,
  SleepSession,
  HRVSample,
  HeartRateSample,
  DailyActivity,
  TrainingReadiness,
} from '../types'

export class ReadinessAnalyzer {
  calculateTrainingReadiness(params: {
    readiness?: DailyReadiness[]
    sleep?: SleepSession[]
    hrv?: HRVSample[]
    heartRate?: HeartRateSample[]
    activity?: DailyActivity[]
  }): TrainingReadiness {
    const factors = {
      hrvStatus: this.scoreHRV(params.hrv),
      sleepQuality: this.scoreSleep(params.sleep),
      recoveryLevel: this.scoreRecovery(params.readiness),
      restingHeartRate: this.scoreRestingHR(params.heartRate),
      activityBalance: this.scoreActivityBalance(params.activity),
      sleepDebt: this.scoreSleepDebt(params.sleep),
    }

    const weights = {
      hrvStatus: 0.25,
      sleepQuality: 0.25,
      recoveryLevel: 0.15,
      restingHeartRate: 0.15,
      activityBalance: 0.10,
      sleepDebt: 0.10,
    }

    const score = Math.round(
      factors.hrvStatus * weights.hrvStatus
      + factors.sleepQuality * weights.sleepQuality
      + factors.recoveryLevel * weights.recoveryLevel
      + factors.restingHeartRate * weights.restingHeartRate
      + factors.activityBalance * weights.activityBalance
      + factors.sleepDebt * weights.sleepDebt,
    )

    return {
      score,
      factors,
      recommendation: this.getRecommendation(score),
      details: this.getDetails(score, factors),
    }
  }

  // ===========================================================================
  // Private scoring methods
  // ===========================================================================

  private scoreHRV(samples?: HRVSample[]): number {
    if (!samples || samples.length === 0) return 50

    // Compare recent HRV to baseline
    const sorted = [...samples].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    const values = sorted.map(s => s.hrv)

    if (values.length < 7) {
      // Not enough data for trend, score based on absolute value
      const avg = values.reduce((a, b) => a + b, 0) / values.length
      if (avg >= 60) return 90
      if (avg >= 40) return 70
      if (avg >= 25) return 50
      return 30
    }

    // Compare last 3 values to 7-day average
    const baseline = values.slice(0, -3).reduce((a, b) => a + b, 0) / (values.length - 3)
    const recent = values.slice(-3).reduce((a, b) => a + b, 0) / 3

    const ratio = recent / baseline
    if (ratio >= 1.05) return 95
    if (ratio >= 0.95) return 80
    if (ratio >= 0.85) return 60
    if (ratio >= 0.75) return 40
    return 25
  }

  private scoreSleep(sessions?: SleepSession[]): number {
    if (!sessions || sessions.length === 0) return 50

    // Score last night's sleep
    const sorted = [...sessions].sort((a, b) => a.day.localeCompare(b.day))
    const lastNight = sorted[sorted.length - 1]

    const durationHours = lastNight.totalSleepDuration / 3600
    const efficiency = lastNight.efficiency

    let score = 50

    // Duration scoring
    if (durationHours >= 7.5) score += 20
    else if (durationHours >= 7) score += 15
    else if (durationHours >= 6) score += 5
    else score -= 15

    // Efficiency scoring
    if (efficiency >= 90) score += 20
    else if (efficiency >= 85) score += 15
    else if (efficiency >= 80) score += 5
    else score -= 10

    // Deep sleep scoring
    const deepPercent = lastNight.totalSleepDuration > 0
      ? lastNight.deepSleepDuration / lastNight.totalSleepDuration
      : 0

    if (deepPercent >= 0.20) score += 10
    else if (deepPercent >= 0.15) score += 5
    else score -= 5

    return Math.max(0, Math.min(100, score))
  }

  private scoreRecovery(readiness?: DailyReadiness[]): number {
    if (!readiness || readiness.length === 0) return 50

    // Use the most recent readiness score
    const sorted = [...readiness].sort((a, b) => a.day.localeCompare(b.day))
    return sorted[sorted.length - 1].score
  }

  private scoreRestingHR(samples?: HeartRateSample[]): number {
    if (!samples || samples.length === 0) return 50

    // Find lowest HR samples (likely resting)
    const sorted = [...samples].sort((a, b) => a.bpm - b.bpm)
    const restingEstimate = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.05)))
    const avgResting = restingEstimate.reduce((sum, s) => sum + s.bpm, 0) / restingEstimate.length

    // Lower resting HR = better score (for athletic population)
    if (avgResting <= 50) return 95
    if (avgResting <= 55) return 85
    if (avgResting <= 60) return 75
    if (avgResting <= 65) return 65
    if (avgResting <= 70) return 55
    return 40
  }

  private scoreActivityBalance(activity?: DailyActivity[]): number {
    if (!activity || activity.length < 3) return 50

    const sorted = [...activity].sort((a, b) => a.day.localeCompare(b.day))
    const recent = sorted.slice(-3)
    const avgScore = recent.reduce((sum, a) => sum + a.score, 0) / recent.length

    // Moderate activity is optimal - too much or too little is not ideal
    if (avgScore >= 70 && avgScore <= 85) return 90
    if (avgScore >= 60 && avgScore <= 90) return 75
    if (avgScore >= 50) return 60
    if (avgScore >= 40) return 45
    return 35
  }

  private scoreSleepDebt(sessions?: SleepSession[]): number {
    if (!sessions || sessions.length < 3) return 50

    const targetDuration = 8 * 3600 // 8 hours
    const sorted = [...sessions].sort((a, b) => a.day.localeCompare(b.day))
    const recent = sorted.slice(-7) // Last week

    let totalDebt = 0
    for (const session of recent) {
      totalDebt += Math.max(0, targetDuration - session.totalSleepDuration)
    }

    const avgDebtMinutes = totalDebt / recent.length / 60

    if (avgDebtMinutes <= 15) return 95
    if (avgDebtMinutes <= 30) return 80
    if (avgDebtMinutes <= 60) return 60
    if (avgDebtMinutes <= 90) return 40
    return 25
  }

  private getRecommendation(score: number): TrainingReadiness['recommendation'] {
    if (score >= 80) return 'go_hard'
    if (score >= 60) return 'moderate'
    if (score >= 40) return 'easy_day'
    return 'rest'
  }

  private getDetails(score: number, factors: TrainingReadiness['factors']): string {
    const parts: string[] = []

    if (score >= 80) {
      parts.push('Body is well recovered and ready for high-intensity training.')
    }
    else if (score >= 60) {
      parts.push('Moderate readiness. Steady-state or technique work recommended.')
    }
    else if (score >= 40) {
      parts.push('Below average readiness. Light activity or active recovery advised.')
    }
    else {
      parts.push('Low readiness. Rest day recommended to support recovery.')
    }

    if (factors.hrvStatus < 40) parts.push('HRV is below baseline.')
    if (factors.sleepQuality < 40) parts.push('Sleep quality was poor last night.')
    if (factors.sleepDebt < 40) parts.push('Accumulated sleep debt detected.')
    if (factors.restingHeartRate < 40) parts.push('Resting heart rate is elevated.')

    return parts.join(' ')
  }
}

export function createReadinessAnalyzer(): ReadinessAnalyzer {
  return new ReadinessAnalyzer()
}
