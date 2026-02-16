# Using with ts-watches

ts-health is designed to complement [`ts-watches`](https://github.com/stacksjs/ts-watches). Together they cover the full spectrum of fitness data: ts-watches handles device-level hardware data while ts-health handles cloud platform APIs.

## What Each Library Does

| Capability | ts-watches | ts-health |
|-----------|-----------|-----------|
| FIT file parsing | Binary FIT protocol parser | - |
| USB device download | Garmin, Polar, Suunto, Coros, Wahoo | - |
| Cloud APIs | Garmin Connect, Strava | Oura, WHOOP, Fitbit |
| Apple Health | XML export (activity focus) | XML export (health focus) |
| GPS/Activity data | Full GPS tracks, laps, records | Workout summaries |
| Training metrics | TSS, NP, IF, CTL, ATL, TSB | Readiness, recovery scoring |
| Health monitoring | HR, sleep, stress from FIT files | Sleep, HRV, readiness from APIs |
| Sleep analysis | Basic stage data from devices | Quality scoring, debt tracking |
| Real-time sensors | ANT+, BLE | - |
| Export formats | GPX, TCX, CSV, GeoJSON | JSON |

## Installation

Since ts-watches is not yet published to npm, link it locally:

```bash
# In the ts-watches directory
cd ~/Code/Libraries/ts-watches/packages/ts-watches
bun link

# In the ts-health directory
cd ~/Code/Libraries/ts-health/packages/health
bun link ts-watches
```

## Combined Usage

### Device Data + Cloud Health Data

Download activity data from a Garmin watch and combine it with readiness data from Oura:

```typescript
import { createGarminDriver } from 'ts-watches'
import { createOuraDriver, createReadinessAnalyzer } from 'ts-health'

// Get device data
const garmin = createGarminDriver()
const devices = await garmin.detectDevices()

if (devices.length > 0) {
  const result = await garmin.downloadData(devices[0], {
    includeActivities: true,
    includeMonitoring: true,
  })

  console.log(`Downloaded ${result.activities.length} activities`)

  // Get Oura readiness
  const oura = createOuraDriver('oura-token')
  const readiness = await oura.getReadiness({
    startDate: '2025-01-01',
    endDate: '2025-01-14',
  })

  // Correlate: did high readiness predict good workouts?
  for (const activity of result.activities) {
    const day = activity.startTime.toISOString().slice(0, 10)
    const dayReadiness = readiness.find(r => r.day === day)

    if (dayReadiness) {
      console.log(`${day}: readiness ${dayReadiness.score} -> ${activity.sport} ${(activity.totalDistance / 1000).toFixed(1)}km`)
    }
  }
}
```

### Training Load + Recovery

Use ts-watches for training load calculations and ts-health for recovery monitoring:

```typescript
import { calculateTSS, ZoneCalculator } from 'ts-watches'
import { createOuraDriver, createRecoveryAnalyzer } from 'ts-health'

// Calculate training stress from watch data
const zones = new ZoneCalculator({ maxHR: 185, restingHR: 50, ftp: 250 })
const tss = calculateTSS(activity, { ftp: 250 })
console.log(`Today's TSS: ${tss}`)

// Check recovery status from Oura
const oura = createOuraDriver('oura-token')
const recovery = createRecoveryAnalyzer()
const range = { startDate: '2025-01-01', endDate: '2025-01-14' }

const [sleep, hrv] = await Promise.all([
  oura.getSleep(range),
  oura.getHRV(range),
])

const status = recovery.calculateRecovery({ sleep, hrv })
console.log(`Recovery: ${status.status} (${status.score}/100)`)

// Decision logic
if (tss > 100 && status.status !== 'fully_recovered') {
  console.log('High training load with incomplete recovery - consider an easy day')
}
```

### Race Predictions with Health Context

```typescript
import { RacePredictor } from 'ts-watches'
import { createOuraDriver, createReadinessAnalyzer } from 'ts-health'

const predictor = new RacePredictor()
const predictions = predictor.predictFromPerformance(5000, 20 * 60) // 5K in 20min
console.log(`Predicted marathon: ${Math.floor(predictions.marathon / 60)}:${(predictions.marathon % 60).toFixed(0).padStart(2, '0')}`)

// Adjust expectations based on readiness
const oura = createOuraDriver('oura-token')
const analyzer = createReadinessAnalyzer()
const readiness = analyzer.calculateTrainingReadiness({
  sleep: await oura.getSleep({ startDate: '2025-01-01' }),
  hrv: await oura.getHRV({ startDate: '2025-01-01' }),
})

if (readiness.recommendation === 'rest' || readiness.recommendation === 'easy_day') {
  console.log('Note: Current readiness is low - race-day performance may be impacted')
}
```

## Data Type Compatibility

ts-watches and ts-health share similar health monitoring types (both have sleep, HR, HRV data). However, they use different type definitions since they serve different purposes:

- **ts-watches types**: Designed around FIT file records (timestamps as `Date`, values from binary parsing)
- **ts-health types**: Designed around API responses (timestamps as ISO strings, values from JSON)

When combining data, map between the two as needed:

```typescript
import type { SleepData } from 'ts-watches'
import type { SleepSession } from 'ts-health'

// Convert ts-watches sleep to ts-health format
function mapWatchSleep(watchSleep: SleepData): Partial<SleepSession> {
  return {
    day: watchSleep.date.toISOString().slice(0, 10),
    totalSleepDuration: watchSleep.totalSleepTime * 60, // minutes to seconds
    deepSleepDuration: watchSleep.deepSleepTime * 60,
    lightSleepDuration: watchSleep.lightSleepTime * 60,
    remSleepDuration: watchSleep.remSleepTime * 60,
    awakeTime: watchSleep.awakeTime * 60,
    source: 'garmin',
  }
}
```
