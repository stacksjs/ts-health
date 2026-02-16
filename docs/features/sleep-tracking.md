# Sleep Tracking

ts-health provides a `SleepAnalyzer` that works with sleep data from any platform to score sleep quality, track consistency, and monitor sleep debt.

## Sleep Quality Scoring

The `SleepAnalyzer` evaluates individual sleep sessions across six dimensions:

```typescript
import { createOuraDriver, createSleepAnalyzer } from 'ts-health'

const oura = createOuraDriver('your-token')
const analyzer = createSleepAnalyzer()

const sessions = await oura.getSleep({
  startDate: '2025-01-01',
  endDate: '2025-01-14',
})

for (const session of sessions) {
  const quality = analyzer.scoreSleepQuality(session)

  console.log(`${session.day}: ${quality.overall}/100 (${quality.rating})`)
  console.log(`  Duration:    ${quality.durationScore}/100`)
  console.log(`  Efficiency:  ${quality.efficiencyScore}/100`)
  console.log(`  Deep sleep:  ${quality.deepSleepScore}/100`)
  console.log(`  REM sleep:   ${quality.remSleepScore}/100`)
  console.log(`  Latency:     ${quality.latencyScore}/100`)
  console.log(`  Consistency: ${quality.consistencyScore}/100`)
}
```

### Scoring Breakdown

| Component | Weight | What it measures |
|-----------|--------|-----------------|
| Duration | 25% | Total sleep time relative to 8-hour ideal |
| Efficiency | 20% | Percentage of time in bed spent sleeping |
| Deep Sleep | 20% | Deep sleep as proportion of total (ideal: 20%+) |
| REM Sleep | 15% | REM sleep as proportion of total (ideal: 25%+) |
| Latency | 10% | Time to fall asleep (ideal: under 15 minutes) |
| Consistency | 10% | Regularity of bedtime and wake time |

### Rating Scale

| Score | Rating |
|-------|--------|
| 85-100 | Excellent |
| 70-84 | Good |
| 50-69 | Fair |
| 0-49 | Poor |

## Sleep Consistency

Track how regular your sleep schedule is across multiple nights:

```typescript
const consistency = analyzer.scoreSleepConsistency(sessions)
console.log(`Sleep consistency: ${consistency}/100`)
```

Consistency is calculated from the standard deviation of bedtimes and wake times. Lower variation means higher consistency.

- **90-100**: Very consistent schedule
- **70-89**: Mostly consistent
- **50-69**: Moderate variation
- **Below 50**: Irregular schedule

## Sleep Debt Analysis

Track accumulated sleep debt and recovery trends:

```typescript
const debt = analyzer.analyzeSleepDebt(sessions, 480) // 480 minutes = 8 hours target

console.log(`Current debt: ${debt.currentDebtMinutes} minutes`)
console.log(`Weekly average: ${debt.weeklyAverageMinutes} minutes/night`)
console.log(`Target: ${debt.targetMinutes} minutes/night`)
console.log(`Trend: ${debt.trend}`)
console.log(`Days to recover: ${debt.daysToRecover}`)
```

### Debt Trends

| Trend | Meaning |
|-------|---------|
| `recovering` | Recent nights are longer than earlier ones |
| `stable` | Sleep duration is consistent |
| `accumulating` | Recent nights are shorter - debt is growing |

The `daysToRecover` estimate assumes you can add ~30 minutes of extra sleep per night. For example, 3 hours of debt would take about 6 days to recover from.

## Cross-Platform Usage

The analyzer works with sleep data from any driver:

```typescript
import { createWhoopDriver, createAppleHealthDriver, createSleepAnalyzer } from 'ts-health'

const analyzer = createSleepAnalyzer()

// Works with WHOOP data
const whoop = createWhoopDriver('whoop-token')
const whoopSleep = await whoop.getSleep({ startDate: '2025-01-01' })
const whoopQuality = analyzer.scoreSleepQuality(whoopSleep[0])

// Works with Apple Health data
const apple = createAppleHealthDriver('/path/to/export.xml')
const appleSleep = await apple.getSleep({ startDate: '2025-01-01' })
const appleQuality = analyzer.scoreSleepQuality(appleSleep[0])
```
