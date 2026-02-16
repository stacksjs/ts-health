# Sleep Debt Analysis

Sleep debt accumulates when you consistently sleep less than your body needs. The `SleepAnalyzer` tracks this deficit over time and estimates how long it will take to recover.

## How Sleep Debt Works

Sleep debt is the difference between how much sleep you need and how much you actually get. Research suggests most adults need 7-9 hours, and chronic sleep debt impacts cognitive function, recovery, and athletic performance.

ts-health tracks sleep debt by comparing actual sleep duration against a configurable target.

## Basic Usage

```typescript
import { createOuraDriver, createSleepAnalyzer } from 'ts-health'

const oura = createOuraDriver('your-token')
const analyzer = createSleepAnalyzer()

const sessions = await oura.getSleep({
  startDate: '2025-01-01',
  endDate: '2025-01-14',
})

// 480 minutes = 8-hour target
const debt = analyzer.analyzeSleepDebt(sessions, 480)

console.log(`Current debt: ${debt.currentDebtMinutes} minutes`)
console.log(`Weekly average: ${debt.weeklyAverageMinutes} min/night`)
console.log(`Target: ${debt.targetMinutes} min/night`)
console.log(`Trend: ${debt.trend}`)
console.log(`Days to recover: ${debt.daysToRecover}`)
```

## Understanding the Output

### Current Debt

The total accumulated sleep deficit across all sessions in the period. If you slept 7 hours instead of 8 hours for 7 nights, your debt would be 420 minutes (7 hours).

### Weekly Average

Your average nightly sleep duration across the analyzed period. Compare this to your target to see the average nightly deficit.

### Trend

| Trend | Meaning |
|-------|---------|
| `recovering` | Recent nights are significantly longer than earlier ones. You're paying back sleep debt. |
| `stable` | Sleep duration is consistent. Debt is neither growing nor shrinking. |
| `accumulating` | Recent nights are shorter than earlier ones. Debt is building up. |

Trend is determined by comparing the average sleep duration of the recent half of sessions against the earlier half. A difference of 10+ minutes triggers a trend change.

### Days to Recover

An estimate based on adding 30 minutes of extra sleep per night. This is a rough guideline - recovery is not strictly linear.

## Custom Sleep Targets

Different people need different amounts of sleep. Athletes typically need more:

```typescript
// Athlete targeting 9 hours
const athleteDebt = analyzer.analyzeSleepDebt(sessions, 540)

// Older adult targeting 7 hours
const elderDebt = analyzer.analyzeSleepDebt(sessions, 420)
```

## Combining with Training Readiness

Sleep debt is one of the six factors in the readiness analyzer. High sleep debt lowers your training readiness score:

```typescript
import { createReadinessAnalyzer } from 'ts-health'

const readinessAnalyzer = createReadinessAnalyzer()
const readiness = readinessAnalyzer.calculateTrainingReadiness({ sleep: sessions })

// Sleep debt contributes 10% of the overall score
console.log(`Sleep debt factor: ${readiness.factors.sleepDebt}/100`)
```

## Practical Guidelines

| Debt Level | Impact | Recommendation |
|-----------|--------|----------------|
| 0-60 min | Minimal | Normal training |
| 60-180 min | Moderate | Reduce intensity, prioritize sleep |
| 180-360 min | Significant | Easy days only, extend sleep by 30-60 min |
| 360+ min | Severe | Consider rest days, sleep hygiene overhaul |

## Tracking Over Time

For long-term tracking, analyze debt in rolling weekly windows:

```typescript
const weeks = []
for (let i = 0; i < sessions.length - 6; i += 7) {
  const weekSessions = sessions.slice(i, i + 7)
  const weekDebt = analyzer.analyzeSleepDebt(weekSessions, 480)
  weeks.push({
    startDay: weekSessions[0].day,
    debt: weekDebt.currentDebtMinutes,
    average: weekDebt.weeklyAverageMinutes,
    trend: weekDebt.trend,
  })
}

for (const week of weeks) {
  console.log(`Week of ${week.startDay}: ${week.debt}min debt, avg ${week.average}min/night (${week.trend})`)
}
```
