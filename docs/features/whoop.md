# WHOOP

ts-health provides support for the [WHOOP Developer API](https://developer.whoop.com/), mapping WHOOP's strain/recovery model to the unified `HealthDriver` interface.

## Setup

1. Register at the [WHOOP Developer Portal](https://developer.whoop.com/)
2. Create an OAuth 2.0 application
3. Complete the OAuth flow to obtain an access token
4. Use the token to create a driver

```typescript
import { createWhoopDriver } from 'ts-health'

const whoop = createWhoopDriver('your-access-token')
```

## Recovery (Readiness)

WHOOP's recovery scores map to the readiness interface. Recovery is calculated each morning based on HRV, resting heart rate, and SpO2:

```typescript
const recovery = await whoop.getReadiness({
  startDate: '2025-01-01',
  endDate: '2025-01-14',
})

for (const r of recovery) {
  console.log(`${r.day}: recovery ${r.score}%`)
  console.log(`  Resting HR: ${r.contributors.restingHeartRate} bpm`)
  console.log(`  HRV: ${r.contributors.hrvBalance}ms`)
}
```

::: tip
WHOOP recovery scores range from 0-100%, where green (67-100%) means you're recovered, yellow (34-66%) is moderate, and red (0-33%) means you need rest.
:::

## Sleep

Sleep data includes stage breakdowns, sleep need calculations, and performance metrics:

```typescript
const sleep = await whoop.getSleep({
  startDate: '2025-01-01',
  endDate: '2025-01-07',
})

for (const session of sleep) {
  console.log(`${session.day}: ${session.type}`)
  console.log(`  Total sleep: ${Math.floor(session.totalSleepDuration / 3600)}h ${Math.floor((session.totalSleepDuration % 3600) / 60)}m`)
  console.log(`  Deep (SWS): ${Math.round(session.deepSleepDuration / 60)}m`)
  console.log(`  Light: ${Math.round(session.lightSleepDuration / 60)}m`)
  console.log(`  REM: ${Math.round(session.remSleepDuration / 60)}m`)
  console.log(`  Awake: ${Math.round(session.awakeTime / 60)}m`)
  console.log(`  Efficiency: ${session.efficiency}%`)
  console.log(`  Respiratory rate: ${session.averageBreath} rpm`)
  console.log(`  Disturbances: ${session.restlessPeriods}`)
}
```

## Strain (Activity)

WHOOP cycles represent daily strain. Strain is measured on a 0-21 scale based on cardiovascular load:

```typescript
const activity = await whoop.getDailyActivity({
  startDate: '2025-01-01',
  endDate: '2025-01-07',
})

for (const a of activity) {
  console.log(`${a.day}: strain score ${a.score}`)
  console.log(`  Calories: ${a.activeCalories}`)
}
```

## Workouts

Individual workout data with strain, heart rate zones, and distance:

```typescript
const workouts = await whoop.getWorkouts({
  startDate: '2025-01-01',
  endDate: '2025-01-14',
})

for (const w of workouts) {
  console.log(`${w.day}: ${w.activity}`)
  console.log(`  Calories: ${w.calories}`)
  console.log(`  Avg HR: ${w.averageHeartRate} bpm`)
  console.log(`  Max HR: ${w.maxHeartRate} bpm`)
  console.log(`  Distance: ${w.distance}m`)
}
```

## HRV

HRV data is derived from morning recovery measurements:

```typescript
const hrv = await whoop.getHRV({
  startDate: '2025-01-01',
  endDate: '2025-01-14',
})

for (const sample of hrv) {
  console.log(`${sample.timestamp}: ${sample.hrv}ms RMSSD`)
}
```

## SpO2 & Body Temperature

```typescript
// Blood oxygen from recovery data
const spo2 = await whoop.getSpO2({ startDate: '2025-01-01' })

// Skin temperature from recovery data
const temp = await whoop.getBodyTemperature({ startDate: '2025-01-01' })
```

## Personal Info

```typescript
const profile = await whoop.getPersonalInfo()
console.log(`Height: ${profile?.height}m, Weight: ${profile?.weight}kg`)
```

## WHOOP-Specific Notes

- **Heart Rate**: WHOOP does not expose raw continuous heart rate data via their API. Heart rate data is available per-workout (average and max).
- **VO2 Max**: Not available through the WHOOP API.
- **Stress**: Mapped from daily strain scores rather than a dedicated stress metric.
- **Readiness**: Maps to WHOOP's recovery score, which is their equivalent concept.
