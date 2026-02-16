# Apple Health

ts-health can parse Apple Health XML exports, giving you access to sleep, heart rate, HRV, steps, workouts, SpO2, VO2 max, and body temperature data collected by Apple Watch and iPhone.

## Setup

1. Open the **Health** app on your iPhone
2. Tap your profile picture in the top-right
3. Tap **Export All Health Data**
4. Wait for the export to complete (may take several minutes)
5. Extract the ZIP file
6. Point the driver at the `export.xml` file

```typescript
import { createAppleHealthDriver } from 'ts-health'

const apple = createAppleHealthDriver('/path/to/apple_health_export/export.xml')
```

::: warning
Apple Health exports can be very large (hundreds of MBs to several GBs). The first call will parse the entire XML file and cache the records in memory.
:::

## Sleep

Apple Health sleep data includes stage breakdowns when recorded by Apple Watch:

```typescript
const sleep = await apple.getSleep({
  startDate: '2025-01-01',
  endDate: '2025-01-14',
})

for (const session of sleep) {
  console.log(`${session.day}: ${session.type}`)
  console.log(`  Total: ${Math.floor(session.totalSleepDuration / 3600)}h ${Math.floor((session.totalSleepDuration % 3600) / 60)}m`)
  console.log(`  Deep: ${Math.round(session.deepSleepDuration / 60)}m`)
  console.log(`  Core (light): ${Math.round(session.lightSleepDuration / 60)}m`)
  console.log(`  REM: ${Math.round(session.remSleepDuration / 60)}m`)
  console.log(`  Awake: ${Math.round(session.awakeTime / 60)}m`)
  console.log(`  Efficiency: ${session.efficiency}%`)
}
```

::: tip
Apple Health uses "Core" sleep instead of "Light" sleep. ts-health maps Core to the `lightSleepDuration` field for consistency across platforms.
:::

## Activity

Daily activity data aggregated from all sources (Apple Watch, iPhone motion):

```typescript
const activity = await apple.getDailyActivity({
  startDate: '2025-01-01',
  endDate: '2025-01-07',
})

for (const a of activity) {
  console.log(`${a.day}:`)
  console.log(`  Steps: ${a.steps}`)
  console.log(`  Active calories: ${a.activeCalories}`)
  console.log(`  Walking distance: ${Math.round(a.equivalentWalkingDistance)}m`)
}
```

## Heart Rate

Continuous heart rate monitoring from Apple Watch:

```typescript
const hr = await apple.getHeartRate({
  startDate: '2025-01-01',
  endDate: '2025-01-01',
})

for (const sample of hr) {
  console.log(`${sample.timestamp}: ${sample.bpm} bpm (${sample.source})`)
}
```

## HRV

Heart rate variability (SDNN) measured by Apple Watch:

```typescript
const hrv = await apple.getHRV({
  startDate: '2025-01-01',
  endDate: '2025-01-07',
})

for (const sample of hrv) {
  console.log(`${sample.timestamp}: ${sample.hrv}ms SDNN`)
}
```

::: info
Apple Watch measures HRV using SDNN (standard deviation of NN intervals), while Oura and WHOOP use RMSSD. These are related but not directly comparable metrics.
:::

## Workouts

All workouts recorded in Apple Health from any source app:

```typescript
const workouts = await apple.getWorkouts({
  startDate: '2025-01-01',
  endDate: '2025-01-14',
})

for (const w of workouts) {
  console.log(`${w.day}: ${w.activity}`)
  console.log(`  Duration: ${w.startDatetime} - ${w.endDatetime}`)
  console.log(`  Calories: ${w.calories}`)
  console.log(`  Distance: ${w.distance}m`)
}
```

## SpO2

Blood oxygen spot checks from Apple Watch:

```typescript
const spo2 = await apple.getSpO2({
  startDate: '2025-01-01',
  endDate: '2025-01-07',
})

for (const day of spo2) {
  console.log(`${day.day}: avg ${day.averageSpO2}% (min: ${day.minSpO2}%, max: ${day.maxSpO2}%)`)
}
```

## VO2 Max

Cardio fitness estimates from Apple Watch:

```typescript
const vo2 = await apple.getVO2Max({
  startDate: '2025-01-01',
  endDate: '2025-01-14',
})

for (const reading of vo2) {
  console.log(`${reading.day}: VO2 max ${reading.vo2Max} mL/kg/min`)
}
```

## Body Temperature

Wrist temperature data from Apple Watch Ultra and Series 8+:

```typescript
const temp = await apple.getBodyTemperature({
  startDate: '2025-01-01',
  endDate: '2025-01-14',
})

for (const t of temp) {
  console.log(`${t.day}: deviation ${t.deviation}°C`)
}
```

## Personal Info

Height and weight from Apple Health records:

```typescript
const profile = await apple.getPersonalInfo()
console.log(`Height: ${profile?.height}cm, Weight: ${profile?.weight}kg`)
```

## Apple Health-Specific Notes

- **Readiness**: Apple Health does not have a readiness score. Use the analysis modules with sleep and HRV data to calculate your own.
- **Stress**: Not natively available. Consider using HRV data with the trend analyzer.
- **Data Sources**: Apple Health aggregates data from many apps. The `source` field on heart rate samples tells you which app recorded it.
- **Export Freshness**: The XML export is a snapshot in time. Re-export to get the latest data.
