# Recovery Analysis

The `RecoveryAnalyzer` provides a multi-factor recovery score that evaluates how well your body has recovered from recent training, based on sleep, HRV trends, resting heart rate, and strain balance.

## Basic Usage

```typescript
import { createOuraDriver, createRecoveryAnalyzer } from 'ts-health'

const oura = createOuraDriver('your-token')
const recovery = createRecoveryAnalyzer()
const range = { startDate: '2025-01-01', endDate: '2025-01-14' }

const [sleep, hrv, activity] = await Promise.all([
  oura.getSleep(range),
  oura.getHRV(range),
  oura.getDailyActivity(range),
])

const result = recovery.calculateRecovery({ sleep, hrv, activity })

console.log(`Recovery: ${result.score}/100`)
console.log(`Status: ${result.status}`)
```

## Recovery Status

| Score | Status | Meaning |
|-------|--------|---------|
| 80-100 | `fully_recovered` | Ready for hard training |
| 60-79 | `mostly_recovered` | Can handle moderate load |
| 40-59 | `partially_recovered` | Keep it light |
| 0-39 | `not_recovered` | Rest is needed |

## Score Factors

Four factors contribute to the recovery score:

| Factor | Weight | What it evaluates |
|--------|--------|-------------------|
| Sleep Score | 35% | Last night's duration, efficiency, and deep sleep proportion |
| HRV Trend | 30% | 3-day HRV average compared to 14-day baseline |
| Resting HR Trend | 20% | Recent resting HR compared to baseline (lower = better) |
| Strain Balance | 15% | Recent activity load vs prior period (lower recent = more recovered) |

```typescript
console.log('Recovery Factors:')
console.log(`  Sleep:      ${result.factors.sleepScore}/100`)
console.log(`  HRV Trend:  ${result.factors.hrvTrend}/100`)
console.log(`  RHR Trend:  ${result.factors.restingHRTrend}/100`)
console.log(`  Strain:     ${result.factors.strainBalance}/100`)
```

## Sleep Scoring Details

The sleep component evaluates three dimensions:

| Dimension | Points | Criteria |
|-----------|--------|----------|
| Duration | 0-40 | 8h+ = 40, 7h = 35, 6h = 25, 5h = 15 |
| Efficiency | 0-30 | 92%+ = 30, 87% = 25, 82% = 20, 75% = 10 |
| Deep Sleep % | 0-30 | 22%+ = 30, 18% = 25, 13% = 18, 8% = 10 |

## HRV Trend Scoring

Compares your recent 3-day HRV average against your 14-day baseline:

| Recent vs Baseline | Score |
|-------------------|-------|
| +10% or more | 95 |
| 0% to +10% | 80 |
| -10% to 0% | 65 |
| -20% to -10% | 45 |
| Below -20% | 25 |

## Resting HR Trend

Lower resting HR indicates better recovery. Compares recent 3-night lowest HR against the overall average:

| Change | Score |
|--------|-------|
| -3 bpm or more (improving) | 90 |
| -1 to -3 bpm | 75 |
| ±1 bpm (stable) | 60 |
| +1 to +3 bpm | 40 |
| +3 bpm or more (elevated) | 25 |

## Strain Balance

Compares the last 3 days of activity to the prior 4 days. Lower recent strain means more recovery time:

| Recent vs Previous | Score |
|-------------------|-------|
| Below 70% | 90 (well-rested) |
| 70-85% | 75 |
| 85-100% | 60 |
| 100-115% | 45 |
| Above 115% | 30 (overreaching) |

## Partial Data

Like the readiness analyzer, recovery analysis handles partial data gracefully:

```typescript
// Just sleep
const result = recovery.calculateRecovery({ sleep })

// Sleep + HRV (most common combo)
const result2 = recovery.calculateRecovery({ sleep, hrv })
```

Missing factors default to 50/100.
