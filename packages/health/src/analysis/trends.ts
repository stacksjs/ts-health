import type { HealthTrend } from '../types'

export class TrendAnalyzer {
  analyzeTrend(
    metric: string,
    dataPoints: Array<{
      day: string
      value: number
    }>,
    periodDays: number = 14,
  ): HealthTrend {
    if (dataPoints.length === 0) {
      return {
        metric,
        period: periodDays,
        direction: 'stable',
        currentAverage: 0,
        previousAverage: 0,
        percentChange: 0,
        dataPoints: [],
      }
    }

    const sorted = [...dataPoints].sort((a, b) => a.day.localeCompare(b.day))
    const mid = Math.floor(sorted.length / 2)

    const recentHalf = sorted.slice(mid)
    const previousHalf = sorted.slice(0, mid)

    const currentAverage = recentHalf.length > 0
      ? recentHalf.reduce((sum, p) => sum + p.value, 0) / recentHalf.length
      : 0

    const previousAverage = previousHalf.length > 0
      ? previousHalf.reduce((sum, p) => sum + p.value, 0) / previousHalf.length
      : currentAverage

    const percentChange = previousAverage !== 0
      ? ((currentAverage - previousAverage) / previousAverage) * 100
      : 0

    const direction = this.getDirection(percentChange)

    return {
      metric,
      period: periodDays,
      direction,
      currentAverage: Math.round(currentAverage * 100) / 100,
      previousAverage: Math.round(previousAverage * 100) / 100,
      percentChange: Math.round(percentChange * 100) / 100,
      dataPoints: sorted,
    }
  }

  analyzeMultipleMetrics(
    metrics: Array<{
      name: string
      dataPoints: Array<{
        day: string
        value: number
      }>
    }>,
    periodDays: number = 14,
  ): HealthTrend[] {
    return metrics.map(m => this.analyzeTrend(m.name, m.dataPoints, periodDays))
  }

  calculateMovingAverage(
    dataPoints: Array<{
      day: string
      value: number
    }>,
    windowSize: number = 7,
  ): Array<{
    day: string
    value: number
  }> {
    const sorted = [...dataPoints].sort((a, b) => a.day.localeCompare(b.day))
    const result: Array<{
      day: string
      value: number
    }> = []

    for (let i = 0; i < sorted.length; i++) {
      const windowStart = Math.max(0, i - windowSize + 1)
      const window = sorted.slice(windowStart, i + 1)
      const avg = window.reduce((sum, p) => sum + p.value, 0) / window.length

      result.push({
        day: sorted[i].day,
        value: Math.round(avg * 100) / 100,
      })
    }

    return result
  }

  detectAnomalies(
    dataPoints: Array<{
      day: string
      value: number
    }>,
    stdDevThreshold: number = 2,
  ): Array<{
    day: string
    value: number
    deviation: number
  }> {
    if (dataPoints.length < 5) return []

    const values = dataPoints.map(p => p.value)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const stdDev = Math.sqrt(
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length,
    )

    if (stdDev === 0) return []

    return dataPoints
      .map(p => ({
        day: p.day,
        value: p.value,
        deviation: (p.value - mean) / stdDev,
      }))
      .filter(p => Math.abs(p.deviation) >= stdDevThreshold)
  }

  private getDirection(percentChange: number): HealthTrend['direction'] {
    if (percentChange >= 5) return 'improving'
    if (percentChange <= -5) return 'declining'
    return 'stable'
  }
}

export function createTrendAnalyzer(): TrendAnalyzer {
  return new TrendAnalyzer()
}
