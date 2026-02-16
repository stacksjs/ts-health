# Multi-Platform Aggregation

One of the key strengths of ts-health is the unified `HealthDriver` interface. All drivers return the same data types, making it straightforward to aggregate and compare data across platforms.

## Unified Interface

Every driver implements the same `HealthDriver` interface:

```typescript
interface HealthDriver {
  readonly name: string
  readonly type: HealthPlatformType

  isAuthenticated(): boolean
  getSleep(options?: DateRangeOptions): Promise<SleepSession[]>
  getDailySleep(options?: DateRangeOptions): Promise<DailySleepSummary[]>
  getDailyActivity(options?: DateRangeOptions): Promise<DailyActivity[]>
  getWorkouts(options?: DateRangeOptions): Promise<Workout[]>
  getReadiness(options?: DateRangeOptions): Promise<DailyReadiness[]>
  getHeartRate(options?: DateRangeOptions): Promise<HeartRateSample[]>
  getHRV(options?: DateRangeOptions): Promise<HRVSample[]>
  getSpO2(options?: DateRangeOptions): Promise<DailySpO2[]>
  getStress(options?: DateRangeOptions): Promise<DailyStress[]>
  getBodyTemperature(options?: DateRangeOptions): Promise<BodyTemperature[]>
  getVO2Max(options?: DateRangeOptions): Promise<VO2MaxReading[]>
  getPersonalInfo(): Promise<PersonalInfo | null>
}
```

## Aggregating from Multiple Sources

```typescript
import {
  createOuraDriver,
  createAppleHealthDriver,
  type HealthDriver,
  type SleepSession,
} from 'ts-health'

const drivers: HealthDriver[] = [
  createOuraDriver('oura-token'),
  createAppleHealthDriver('/path/to/export.xml'),
]

const range = { startDate: '2025-01-01', endDate: '2025-01-07' }

// Collect sleep from all platforms
const allSleep: SleepSession[] = []
for (const driver of drivers) {
  const sleep = await driver.getSleep(range)
  allSleep.push(...sleep)
}

// Group by day, prefer primary source
const byDay = new Map<string, SleepSession>()
for (const session of allSleep) {
  const existing = byDay.get(session.day)
  if (!existing || session.source === 'oura') {
    byDay.set(session.day, session)
  }
}

console.log(`Sleep data from ${byDay.size} nights`)
```

## Platform Priority

When multiple platforms have data for the same day, you'll want to pick the best source. Each record includes a `source` field:

```typescript
function pickBestSleepSource(sessions: SleepSession[]): SleepSession | undefined {
  // Priority order: oura > whoop > fitbit > apple_health
  const priority: Record<string, number> = {
    oura: 4,
    whoop: 3,
    fitbit: 2,
    apple_health: 1,
  }

  return sessions.sort((a, b) =>
    (priority[b.source] ?? 0) - (priority[a.source] ?? 0)
  )[0]
}
```

## Cross-Platform Comparison

Compare metrics across platforms for the same time period:

```typescript
import {
  createOuraDriver,
  createWhoopDriver,
  createTrendAnalyzer,
} from 'ts-health'

const oura = createOuraDriver('oura-token')
const whoop = createWhoopDriver('whoop-token')
const trends = createTrendAnalyzer()

const range = { startDate: '2025-01-01', endDate: '2025-01-14' }

const ouraHRV = await oura.getHRV(range)
const whoopHRV = await whoop.getHRV(range)

const ouraTrend = trends.analyzeTrend(
  'Oura HRV',
  ouraHRV.map(h => ({ day: h.timestamp.slice(0, 10), value: h.hrv })),
)

const whoopTrend = trends.analyzeTrend(
  'WHOOP HRV',
  whoopHRV.map(h => ({ day: h.timestamp.slice(0, 10), value: h.hrv })),
)

console.log(`Oura HRV: ${ouraTrend.direction} (avg: ${ouraTrend.currentAverage}ms)`)
console.log(`WHOOP HRV: ${whoopTrend.direction} (avg: ${whoopTrend.currentAverage}ms)`)
```

::: warning
HRV values differ between platforms due to different measurement methods (RMSSD vs SDNN) and timing (sleep vs morning). Compare trends rather than absolute values.
:::

## Building a Health Dashboard

```typescript
import {
  createOuraDriver,
  createSleepAnalyzer,
  createReadinessAnalyzer,
  createRecoveryAnalyzer,
  createTrendAnalyzer,
} from 'ts-health'

async function getDashboard(token: string) {
  const oura = createOuraDriver(token)
  const range = { startDate: '2025-01-01', endDate: '2025-01-14' }

  // Fetch all data in parallel
  const [sleep, dailySleep, readiness, hrv, activity, spo2, stress] = await Promise.all([
    oura.getSleep(range),
    oura.getDailySleep(range),
    oura.getReadiness(range),
    oura.getHRV(range),
    oura.getDailyActivity(range),
    oura.getSpO2(range),
    oura.getStress(range),
  ])

  // Run all analyses
  const sleepAnalyzer = createSleepAnalyzer()
  const readinessAnalyzer = createReadinessAnalyzer()
  const recoveryAnalyzer = createRecoveryAnalyzer()
  const trendAnalyzer = createTrendAnalyzer()

  const lastNightQuality = sleep.length > 0
    ? sleepAnalyzer.scoreSleepQuality(sleep[sleep.length - 1])
    : null

  const trainingReadiness = readinessAnalyzer.calculateTrainingReadiness({
    sleep, readiness, hrv, activity,
  })

  const recovery = recoveryAnalyzer.calculateRecovery({ sleep, hrv, activity })

  const hrvTrend = trendAnalyzer.analyzeTrend(
    'HRV',
    hrv.map(h => ({ day: h.timestamp.slice(0, 10), value: h.hrv })),
  )

  const sleepDebt = sleepAnalyzer.analyzeSleepDebt(sleep)

  return {
    lastNightQuality,
    trainingReadiness,
    recovery,
    hrvTrend,
    sleepDebt,
    latestReadiness: readiness[readiness.length - 1],
    latestActivity: activity[activity.length - 1],
    latestSpo2: spo2[spo2.length - 1],
    latestStress: stress[stress.length - 1],
  }
}
```

## Graceful Degradation

Not all platforms support all metrics. When a method isn't supported, drivers return empty arrays rather than throwing:

```typescript
// Apple Health doesn't have readiness scores
const apple = createAppleHealthDriver('/path/to/export.xml')
const readiness = await apple.getReadiness() // Returns []

// WHOOP doesn't expose VO2 max
const whoop = createWhoopDriver('token')
const vo2 = await whoop.getVO2Max() // Returns []
```

This means your aggregation code works without special-casing each platform.
