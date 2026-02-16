# Training Readiness

The `ReadinessAnalyzer` combines data from sleep, HRV, heart rate, readiness scores, and activity to calculate a training readiness score with actionable recommendations.

## Basic Usage

```typescript
import { createOuraDriver, createReadinessAnalyzer } from 'ts-health'

const oura = createOuraDriver('your-token')
const analyzer = createReadinessAnalyzer()
const range = { startDate: '2025-01-01', endDate: '2025-01-14' }

const [sleep, readiness, hrv, activity] = await Promise.all([
  oura.getSleep(range),
  oura.getReadiness(range),
  oura.getHRV(range),
  oura.getDailyActivity(range),
])

const result = analyzer.calculateTrainingReadiness({
  sleep,
  readiness,
  hrv,
  activity,
})

console.log(`Training Readiness: ${result.score}/100`)
console.log(`Recommendation: ${result.recommendation}`)
console.log(result.details)
```

## Score Factors

The readiness score is calculated from six weighted factors:

| Factor | Weight | What it evaluates |
|--------|--------|-------------------|
| HRV Status | 25% | Recent HRV compared to your baseline |
| Sleep Quality | 25% | Last night's duration, efficiency, and deep sleep |
| Recovery Level | 15% | Platform readiness score (if available) |
| Resting Heart Rate | 15% | Current resting HR relative to your norm |
| Activity Balance | 10% | Recent training load relative to capacity |
| Sleep Debt | 10% | Accumulated sleep deficit over recent nights |

```typescript
console.log('Factor Breakdown:')
console.log(`  HRV Status:       ${result.factors.hrvStatus}/100`)
console.log(`  Sleep Quality:    ${result.factors.sleepQuality}/100`)
console.log(`  Recovery Level:   ${result.factors.recoveryLevel}/100`)
console.log(`  Resting HR:       ${result.factors.restingHeartRate}/100`)
console.log(`  Activity Balance: ${result.factors.activityBalance}/100`)
console.log(`  Sleep Debt:       ${result.factors.sleepDebt}/100`)
```

## Recommendations

Based on the overall score, the analyzer provides one of four training recommendations:

| Score | Recommendation | Meaning |
|-------|---------------|---------|
| 80-100 | `go_hard` | Body is recovered. High-intensity training is appropriate. |
| 60-79 | `moderate` | Moderate readiness. Steady-state or technique work recommended. |
| 40-59 | `easy_day` | Below average. Light activity or active recovery advised. |
| 0-39 | `rest` | Low readiness. Rest day recommended. |

## HRV Scoring Details

The HRV factor compares your recent values to your baseline:

- **7+ days of data**: Compares last 3 values against the 7-day running average
- **Less than 7 days**: Scores based on absolute HRV value

| HRV vs Baseline | Score |
|----------------|-------|
| +5% or higher | 95 |
| Within ±5% | 80 |
| -5% to -15% | 60 |
| -15% to -25% | 40 |
| Below -25% | 25 |

## Partial Data

The analyzer gracefully handles missing data. You can provide any combination of inputs:

```typescript
// Only sleep data available
const result = analyzer.calculateTrainingReadiness({ sleep })

// Sleep + HRV
const result2 = analyzer.calculateTrainingReadiness({ sleep, hrv })

// Everything
const result3 = analyzer.calculateTrainingReadiness({
  sleep,
  readiness,
  hrv,
  heartRate,
  activity,
})
```

Missing factors default to a neutral score of 50/100.

## Cross-Platform

Works with data from any driver:

```typescript
import { createWhoopDriver, createReadinessAnalyzer } from 'ts-health'

const whoop = createWhoopDriver('whoop-token')
const analyzer = createReadinessAnalyzer()
const range = { startDate: '2025-01-01' }

const [sleep, recovery, hrv, activity] = await Promise.all([
  whoop.getSleep(range),
  whoop.getReadiness(range),
  whoop.getHRV(range),
  whoop.getDailyActivity(range),
])

const result = analyzer.calculateTrainingReadiness({
  sleep,
  readiness: recovery,
  hrv,
  activity,
})
```
