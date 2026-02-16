# Oura Ring

ts-health provides full support for the [Oura Ring API v2](https://cloud.ouraring.com/v2/docs), giving you access to sleep, readiness, activity, heart rate, HRV, SpO2, stress, body temperature, VO2 max, and more.

## Setup

1. Go to the [Oura Developer Portal](https://cloud.ouraring.com/personal-access-tokens)
2. Create a Personal Access Token
3. Use the token to create a driver

```typescript
import { createOuraDriver } from 'ts-health'

const oura = createOuraDriver('your-personal-access-token')
```

You can also pass a custom base URL for testing:

```typescript
const oura = createOuraDriver('your-token', 'https://your-mock-server.com')
```

## Sleep Data

### Detailed Sleep Sessions

Returns full sleep sessions with heart rate and HRV time series data, sleep phase breakdowns, and readiness scores:

```typescript
const sleep = await oura.getSleep({
  startDate: '2025-01-01',
  endDate: '2025-01-14',
})

for (const session of sleep) {
  console.log(`${session.day}: ${session.type}`)
  console.log(`  Duration: ${Math.floor(session.totalSleepDuration / 3600)}h ${Math.floor((session.totalSleepDuration % 3600) / 60)}m`)
  console.log(`  Efficiency: ${session.efficiency}%`)
  console.log(`  Deep: ${Math.round(session.deepSleepDuration / 60)}m`)
  console.log(`  Light: ${Math.round(session.lightSleepDuration / 60)}m`)
  console.log(`  REM: ${Math.round(session.remSleepDuration / 60)}m`)
  console.log(`  Awake: ${Math.round(session.awakeTime / 60)}m`)
  console.log(`  Avg HR: ${session.averageHeartRate} bpm`)
  console.log(`  Lowest HR: ${session.lowestHeartRate} bpm`)
  console.log(`  Avg HRV: ${session.averageHRV}ms`)
  console.log(`  Avg Breath: ${session.averageBreath} rpm`)
  console.log(`  Latency: ${Math.round(session.latency / 60)}m`)

  // Access HR/HRV time series
  if (session.heartRateSamples) {
    console.log(`  HR samples: ${session.heartRateSamples.length}`)
  }
  if (session.hrvSamples) {
    console.log(`  HRV samples: ${session.hrvSamples.length}`)
  }

  // Sleep phase data (5-minute intervals)
  console.log(`  Sleep stages: ${session.stages.length} transitions`)
}
```

### Daily Sleep Scores

Returns daily sleep score summaries with contributor breakdowns:

```typescript
const dailySleep = await oura.getDailySleep({
  startDate: '2025-01-01',
  endDate: '2025-01-14',
})

for (const day of dailySleep) {
  console.log(`${day.day}: score ${day.score}`)
  console.log(`  Deep sleep: ${day.contributors.deepSleep}`)
  console.log(`  Efficiency: ${day.contributors.efficiency}`)
  console.log(`  Latency: ${day.contributors.latency}`)
  console.log(`  REM sleep: ${day.contributors.remSleep}`)
  console.log(`  Restfulness: ${day.contributors.restfulness}`)
  console.log(`  Timing: ${day.contributors.timing}`)
  console.log(`  Total sleep: ${day.contributors.totalSleep}`)
}
```

## Readiness Data

Readiness scores indicate how prepared your body is for the day, with contributor breakdowns:

```typescript
const readiness = await oura.getReadiness({
  startDate: '2025-01-01',
  endDate: '2025-01-14',
})

for (const r of readiness) {
  console.log(`${r.day}: score ${r.score}`)
  console.log(`  Temp deviation: ${r.temperatureDeviation}°C`)
  console.log(`  Activity balance: ${r.contributors.activityBalance}`)
  console.log(`  Body temperature: ${r.contributors.bodyTemperature}`)
  console.log(`  HRV balance: ${r.contributors.hrvBalance}`)
  console.log(`  Previous day activity: ${r.contributors.previousDayActivity}`)
  console.log(`  Previous night: ${r.contributors.previousNight}`)
  console.log(`  Recovery index: ${r.contributors.recoveryIndex}`)
  console.log(`  Resting heart rate: ${r.contributors.restingHeartRate}`)
  console.log(`  Sleep balance: ${r.contributors.sleepBalance}`)
}
```

## Activity Data

Daily activity summaries with step counts, calorie burn, and movement breakdowns:

```typescript
const activity = await oura.getDailyActivity({
  startDate: '2025-01-01',
  endDate: '2025-01-07',
})

for (const a of activity) {
  console.log(`${a.day}: score ${a.score}`)
  console.log(`  Steps: ${a.steps}`)
  console.log(`  Active calories: ${a.activeCalories}`)
  console.log(`  Total calories: ${a.totalCalories}`)
  console.log(`  High activity: ${Math.round(a.highActivityTime / 60)}m`)
  console.log(`  Medium activity: ${Math.round(a.mediumActivityTime / 60)}m`)
  console.log(`  Low activity: ${Math.round(a.lowActivityTime / 60)}m`)
}
```

## Heart Rate

Continuous heart rate samples throughout the day:

```typescript
const hr = await oura.getHeartRate({
  startDate: '2025-01-01',
  endDate: '2025-01-01',
})

for (const sample of hr) {
  console.log(`${sample.timestamp}: ${sample.bpm} bpm (${sample.source})`)
}
```

## HRV

Heart rate variability data derived from sleep sessions:

```typescript
const hrv = await oura.getHRV({
  startDate: '2025-01-01',
  endDate: '2025-01-07',
})

for (const sample of hrv) {
  console.log(`${sample.timestamp}: ${sample.hrv}ms`)
}
```

## SpO2, Stress, Body Temperature, VO2 Max

```typescript
const range = { startDate: '2025-01-01', endDate: '2025-01-14' }

// Blood oxygen saturation
const spo2 = await oura.getSpO2(range)
// => [{ day: '2025-01-01', averageSpO2: 97, source: 'oura' }]

// Stress levels
const stress = await oura.getStress(range)
// => [{ day: '2025-01-01', stressHigh: 230, recoveryHigh: 450, daySummary: 'restored' }]

// Body temperature (derived from readiness)
const temp = await oura.getBodyTemperature(range)
// => [{ day: '2025-01-01', deviation: -0.2, trendDeviation: 0.1 }]

// VO2 max estimates
const vo2 = await oura.getVO2Max(range)
// => [{ day: '2025-01-01', vo2Max: 45.2, source: 'oura' }]
```

## Workouts

```typescript
const workouts = await oura.getWorkouts({
  startDate: '2025-01-01',
  endDate: '2025-01-14',
})

for (const w of workouts) {
  console.log(`${w.day}: ${w.activity}`)
  console.log(`  ${w.startDatetime} - ${w.endDatetime}`)
  console.log(`  Calories: ${w.calories}`)
  console.log(`  Distance: ${w.distance}m`)
  console.log(`  Intensity: ${w.intensity}`)
}
```

## Oura-Specific Endpoints

These methods are unique to the Oura driver and not part of the shared `HealthDriver` interface:

### Ring Configuration

```typescript
const rings = await oura.getRingConfiguration()
for (const ring of rings) {
  console.log(`Ring: ${ring.model} (${ring.color}, size ${ring.size})`)
  console.log(`  Firmware: ${ring.firmwareVersion}`)
  console.log(`  Hardware: ${ring.hardwareType}`)
  console.log(`  Set up: ${ring.setupAt}`)
}
```

### Sessions

Guided breathing or meditation sessions:

```typescript
const sessions = await oura.getSessions({ startDate: '2025-01-01' })
```

### Tags

User-created tags for mood, symptoms, etc:

```typescript
const tags = await oura.getTags({ startDate: '2025-01-01' })
```

### Rest Mode Periods

```typescript
const restMode = await oura.getRestModePeriods({ startDate: '2025-01-01' })
```

### Personal Info

```typescript
const profile = await oura.getPersonalInfo()
console.log(`Age: ${profile?.age}, Weight: ${profile?.weight}kg`)
```
