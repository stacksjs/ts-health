# Device Data Integration

ts-health includes [`ts-watches`](https://github.com/stacksjs/ts-watches) as a built-in dependency, giving you full access to smartwatch device drivers, FIT file parsing, training metrics, data export, cloud integrations, and real-time sensor connectivity — all from a single `ts-health` import.

## What's Included

Everything from ts-watches is re-exported through ts-health:

| Module | What It Does |
|--------|-------------|
| **Device Drivers** | Garmin, Polar, Suunto, Coros, Wahoo, Apple Watch |
| **FIT Parsing** | Binary FIT protocol parser for any device |
| **Data Export** | GPX, TCX, CSV, GeoJSON |
| **Cloud** | Garmin Connect, Strava, TrainingPeaks |
| **Analysis** | TSS, NP, IF, CTL/ATL/TSB, zones, race predictions |
| **Workouts** | Workout builder, course files, training plans |
| **Real-time** | ANT+, BLE, live tracking |

## Single Import

You don't need to install ts-watches separately. Everything is available from `ts-health`:

```typescript
// Health platform APIs
import { createOuraDriver, createWhoopDriver, createFitbitDriver } from 'ts-health'

// Device drivers (from ts-watches)
import { createGarminDriver, createPolarDriver } from 'ts-health'

// FIT parsing (from ts-watches)
import { parseFITFile } from 'ts-health'

// Training metrics (from ts-watches)
import { calculateTSS, ZoneCalculator, RacePredictor } from 'ts-health'

// Data export (from ts-watches)
import { exportToGPX, exportToTCX } from 'ts-health'

// Cloud (from ts-watches)
import { createGarminConnectClient, createStravaClient } from 'ts-health'

// Real-time (from ts-watches)
import { createANTClient, createBLEClient } from 'ts-health'
```

## Health + Device Data

The real power of ts-health is combining health platform APIs with device-level data:

### Training Load + Recovery

```typescript
import {
  createGarminDriver,
  createOuraDriver,
  calculateTSS,
  createRecoveryAnalyzer,
} from 'ts-health'

// Training stress from Garmin watch
const garmin = createGarminDriver()
const devices = await garmin.detectDevices()
const data = await garmin.downloadData(devices[0], { includeActivities: true })
const tss = calculateTSS(data.activities[0], { ftp: 250 })

// Recovery from Oura Ring
const oura = createOuraDriver('oura-token')
const recovery = createRecoveryAnalyzer()
const range = { startDate: '2025-01-01', endDate: '2025-01-14' }
const [sleep, hrv] = await Promise.all([oura.getSleep(range), oura.getHRV(range)])
const status = recovery.calculateRecovery({ sleep, hrv })

console.log(`TSS: ${tss} | Recovery: ${status.status} (${status.score}/100)`)
```

### Race Prep with Readiness

```typescript
import { RacePredictor, createOuraDriver, createReadinessAnalyzer } from 'ts-health'

// Race time predictions
const predictor = new RacePredictor()
const predictions = predictor.predictFromPerformance(5000, 20 * 60)

// Check if you're ready to race
const oura = createOuraDriver('oura-token')
const analyzer = createReadinessAnalyzer()
const readiness = analyzer.calculateTrainingReadiness({
  sleep: await oura.getSleep({ startDate: '2025-01-01' }),
  hrv: await oura.getHRV({ startDate: '2025-01-01' }),
})

if (readiness.recommendation === 'go_hard') {
  console.log(`You're ready! Target marathon: ${formatTime(predictions.marathon)}`)
} else {
  console.log(`Hold off — readiness is ${readiness.score}/100`)
}
```

## Data Type Compatibility

Health platform types and device types serve different purposes:

- **Health types** (SleepSession, HRVSample, etc.) — Designed around API responses, ISO string timestamps, JSON values
- **Device types** (Activity, MonitoringData, etc.) — Designed around FIT file records, Date timestamps, binary-parsed values

When combining data, map between them as needed:

```typescript
import type { SleepData } from 'ts-health'  // Device sleep (from FIT)
import type { SleepSession } from 'ts-health'  // API sleep (from Oura/WHOOP/etc.)

// Convert device sleep to health format
function mapDeviceSleep(deviceSleep: SleepData): Partial<SleepSession> {
  return {
    day: deviceSleep.date.toISOString().slice(0, 10),
    totalSleepDuration: deviceSleep.totalSleepTime * 60,
    deepSleepDuration: deviceSleep.deepSleepTime * 60,
    lightSleepDuration: deviceSleep.lightSleepTime * 60,
    remSleepDuration: deviceSleep.remSleepTime * 60,
    awakeTime: deviceSleep.awakeTime * 60,
    source: 'garmin',
  }
}
```
