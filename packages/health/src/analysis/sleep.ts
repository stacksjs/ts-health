import type { SleepSession, SleepQualityScore, SleepDebtAnalysis } from '../types'

const IDEAL_SLEEP_DURATION = 8 * 3600 // 8 hours in seconds
const IDEAL_DEEP_PERCENT = 0.20
const IDEAL_REM_PERCENT = 0.25
const IDEAL_EFFICIENCY = 90
const IDEAL_LATENCY = 15 * 60 // 15 minutes in seconds

export class SleepAnalyzer {
  scoreSleepQuality(session: SleepSession): SleepQualityScore {
    const durationScore = this.scoreDuration(session.totalSleepDuration)
    const efficiencyScore = this.scoreEfficiency(session.efficiency)
    const deepSleepScore = this.scoreDeepSleep(session.deepSleepDuration, session.totalSleepDuration)
    const remSleepScore = this.scoreRemSleep(session.remSleepDuration, session.totalSleepDuration)
    const latencyScore = this.scoreLatency(session.latency)
    const consistencyScore = 50 // Requires multi-day data, placeholder

    const overall = Math.round(
      durationScore * 0.25
      + efficiencyScore * 0.20
      + deepSleepScore * 0.20
      + remSleepScore * 0.15
      + latencyScore * 0.10
      + consistencyScore * 0.10,
    )

    return {
      overall,
      durationScore,
      efficiencyScore,
      deepSleepScore,
      remSleepScore,
      latencyScore,
      consistencyScore,
      rating: this.getRating(overall),
    }
  }

  scoreSleepConsistency(sessions: SleepSession[]): number {
    if (sessions.length < 3) return 50

    const bedtimes = sessions.map(s => {
      const d = new Date(s.bedtimeStart)
      return d.getHours() * 60 + d.getMinutes()
    })

    const wakeTimes = sessions.map(s => {
      const d = new Date(s.bedtimeEnd)
      return d.getHours() * 60 + d.getMinutes()
    })

    const bedtimeStdDev = this.standardDeviation(bedtimes)
    const wakeTimeStdDev = this.standardDeviation(wakeTimes)

    // Lower std dev = higher consistency score
    // 0 min std dev = 100 score, 120 min std dev = 0 score
    const bedtimeConsistency = Math.max(0, Math.round(100 - (bedtimeStdDev / 120) * 100))
    const wakeConsistency = Math.max(0, Math.round(100 - (wakeTimeStdDev / 120) * 100))

    return Math.round((bedtimeConsistency + wakeConsistency) / 2)
  }

  analyzeSleepDebt(sessions: SleepSession[], targetMinutes: number = 480): SleepDebtAnalysis {
    if (sessions.length === 0) {
      return {
        currentDebtMinutes: 0,
        weeklyAverageMinutes: 0,
        targetMinutes,
        trend: 'stable',
        daysToRecover: 0,
      }
    }

    const targetSeconds = targetMinutes * 60
    let totalDebt = 0

    for (const session of sessions) {
      const deficit = targetSeconds - session.totalSleepDuration
      totalDebt += deficit
    }

    const currentDebtMinutes = Math.round(totalDebt / 60)
    const weeklyAverageMinutes = Math.round(
      sessions.reduce((sum, s) => sum + s.totalSleepDuration, 0) / sessions.length / 60,
    )

    // Determine trend from recent vs older sessions
    let trend: SleepDebtAnalysis['trend'] = 'stable'
    if (sessions.length >= 4) {
      const mid = Math.floor(sessions.length / 2)
      const recentAvg = sessions.slice(mid).reduce((s, x) => s + x.totalSleepDuration, 0) / (sessions.length - mid)
      const olderAvg = sessions.slice(0, mid).reduce((s, x) => s + x.totalSleepDuration, 0) / mid

      if (recentAvg > olderAvg + 600) trend = 'recovering'
      else if (recentAvg < olderAvg - 600) trend = 'accumulating'
    }

    // Estimate days to recover (assuming 30 min extra per night)
    const daysToRecover = currentDebtMinutes > 0 ? Math.ceil(currentDebtMinutes / 30) : 0

    return {
      currentDebtMinutes: Math.max(0, currentDebtMinutes),
      weeklyAverageMinutes,
      targetMinutes,
      trend,
      daysToRecover,
    }
  }

  // ===========================================================================
  // Private scoring methods
  // ===========================================================================

  private scoreDuration(durationSeconds: number): number {
    const ratio = durationSeconds / IDEAL_SLEEP_DURATION
    if (ratio >= 0.95 && ratio <= 1.1) return 100
    if (ratio >= 0.85 && ratio <= 1.2) return 80
    if (ratio >= 0.75) return 60
    if (ratio >= 0.60) return 40
    return 20
  }

  private scoreEfficiency(efficiency: number): number {
    if (efficiency >= IDEAL_EFFICIENCY) return 100
    if (efficiency >= 85) return 80
    if (efficiency >= 80) return 60
    if (efficiency >= 70) return 40
    return 20
  }

  private scoreDeepSleep(deepSeconds: number, totalSeconds: number): number {
    if (totalSeconds === 0) return 0
    const ratio = deepSeconds / totalSeconds
    if (ratio >= IDEAL_DEEP_PERCENT) return 100
    if (ratio >= 0.15) return 80
    if (ratio >= 0.10) return 60
    if (ratio >= 0.05) return 40
    return 20
  }

  private scoreRemSleep(remSeconds: number, totalSeconds: number): number {
    if (totalSeconds === 0) return 0
    const ratio = remSeconds / totalSeconds
    if (ratio >= IDEAL_REM_PERCENT) return 100
    if (ratio >= 0.20) return 80
    if (ratio >= 0.15) return 60
    if (ratio >= 0.10) return 40
    return 20
  }

  private scoreLatency(latencySeconds: number): number {
    if (latencySeconds <= IDEAL_LATENCY) return 100
    if (latencySeconds <= 30 * 60) return 80
    if (latencySeconds <= 45 * 60) return 60
    if (latencySeconds <= 60 * 60) return 40
    return 20
  }

  private getRating(score: number): SleepQualityScore['rating'] {
    if (score >= 85) return 'excellent'
    if (score >= 70) return 'good'
    if (score >= 50) return 'fair'
    return 'poor'
  }

  private standardDeviation(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const squaredDiffs = values.map(v => (v - mean) ** 2)
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length)
  }
}

export function createSleepAnalyzer(): SleepAnalyzer {
  return new SleepAnalyzer()
}
