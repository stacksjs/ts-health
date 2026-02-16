# Fitbit

ts-health supports the [Fitbit Web API](https://dev.fitbit.com/build/reference/web-api/) for sleep stages, activity summaries, intraday heart rate, HRV, SpO2, skin temperature, and cardio score.

## Setup

1. Register at the [Fitbit Developer Portal](https://dev.fitbit.com/)
2. Create an OAuth 2.0 application (set type to "Personal")
3. Complete the OAuth authorization flow
4. Use the access token to create a driver

```typescript
import { createFitbitDriver } from 'ts-health'

const fitbit = createFitbitDriver('your-access-token')
```

::: tip
For personal projects, create a "Personal" app type which grants access to intraday heart rate data (1-minute resolution).
:::

## Sleep

Fitbit provides sleep data with stage breakdowns (for devices that support it) or classic sleep tracking:

```typescript
const sleep = await fitbit.getSleep({
  startDate: '2025-01-01',
  endDate: '2025-01-07',
})

for (const session of sleep) {
  console.log(`${session.day}: ${session.type}`)
  console.log(`  Duration: ${Math.floor(session.totalSleepDuration / 3600)}h ${Math.floor((session.totalSleepDuration % 3600) / 60)}m`)
  console.log(`  Deep: ${Math.round(session.deepSleepDuration / 60)}m`)
  console.log(`  Light: ${Math.round(session.lightSleepDuration / 60)}m`)
  console.log(`  REM: ${Math.round(session.remSleepDuration / 60)}m`)
  console.log(`  Awake: ${Math.round(session.awakeTime / 60)}m`)
  console.log(`  Efficiency: ${session.efficiency}%`)
  console.log(`  Time to fall asleep: ${Math.round(session.latency / 60)}m`)

  // Stage-by-stage breakdown
  for (const stage of session.stages) {
    console.log(`  ${stage.stage}: ${Math.round(stage.duration / 60)}m`)
  }
}
```

## Activity

Daily activity summaries with step counts, active minutes, and calorie breakdowns:

```typescript
const activity = await fitbit.getDailyActivity({
  startDate: '2025-01-01',
  endDate: '2025-01-07',
})

for (const a of activity) {
  console.log(`${a.day}:`)
  console.log(`  Steps: ${a.steps}`)
  console.log(`  Active calories: ${a.activeCalories}`)
  console.log(`  Total calories: ${a.totalCalories}`)
  console.log(`  Very active: ${Math.round(a.highActivityTime / 60)}m`)
  console.log(`  Fairly active: ${Math.round(a.mediumActivityTime / 60)}m`)
  console.log(`  Lightly active: ${Math.round(a.lowActivityTime / 60)}m`)
  console.log(`  Sedentary: ${Math.round(a.sedentaryTime / 60)}m`)
}
```

## Heart Rate

Intraday heart rate data at 1-minute resolution (requires Personal app type):

```typescript
const hr = await fitbit.getHeartRate({
  startDate: '2025-01-01',
  endDate: '2025-01-01',
})

for (const sample of hr) {
  console.log(`${sample.timestamp}: ${sample.bpm} bpm`)
}
```

## HRV

Daily HRV measurements including both daily and deep sleep RMSSD values:

```typescript
const hrv = await fitbit.getHRV({
  startDate: '2025-01-01',
  endDate: '2025-01-07',
})

for (const sample of hrv) {
  console.log(`${sample.timestamp}: ${sample.hrv}ms RMSSD`)
}
```

## SpO2

Daily blood oxygen levels:

```typescript
const spo2 = await fitbit.getSpO2({
  startDate: '2025-01-01',
  endDate: '2025-01-07',
})

for (const day of spo2) {
  console.log(`${day.day}: avg ${day.averageSpO2}% (min: ${day.minSpO2}%, max: ${day.maxSpO2}%)`)
}
```

## Body Temperature

Nightly relative skin temperature:

```typescript
const temp = await fitbit.getBodyTemperature({
  startDate: '2025-01-01',
  endDate: '2025-01-07',
})

for (const t of temp) {
  console.log(`${t.day}: ${t.deviation}°C relative`)
}
```

## VO2 Max (Cardio Score)

Fitbit's cardio fitness score based on estimated VO2 max:

```typescript
const vo2 = await fitbit.getVO2Max({
  startDate: '2025-01-01',
  endDate: '2025-01-14',
})

for (const reading of vo2) {
  console.log(`${reading.day}: VO2 max ${reading.vo2Max} mL/kg/min`)
}
```

## Workouts (Exercise Log)

```typescript
const workouts = await fitbit.getWorkouts({
  startDate: '2025-01-01',
  endDate: '2025-01-14',
})

for (const w of workouts) {
  console.log(`${w.day}: ${w.activity}`)
  console.log(`  Calories: ${w.calories}`)
  console.log(`  Distance: ${w.distance}m`)
  console.log(`  Avg HR: ${w.averageHeartRate} bpm`)
}
```

## Personal Info

```typescript
const profile = await fitbit.getPersonalInfo()
console.log(`Age: ${profile?.age}`)
console.log(`Height: ${profile?.height}cm, Weight: ${profile?.weight}kg`)
```

## Fitbit-Specific Notes

- **Readiness**: Fitbit's readiness score is not available through the standard Web API. Use the analysis modules with sleep and HRV data instead.
- **Stress**: Not available via the standard API. The Stress Management Score requires Fitbit Premium.
- **Rate Limits**: The Fitbit API has a rate limit of 150 requests per hour per user. Activity data requires one request per day.
- **Sleep Types**: Older Fitbit devices use "classic" sleep tracking (awake, restless, asleep) while newer ones use "stages" (wake, light, deep, REM).
