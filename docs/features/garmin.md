# Garmin Devices

ts-health includes full Garmin smartwatch support via the built-in [ts-watches](https://github.com/stacksjs/ts-watches) integration. Download data directly from connected Garmin devices via USB, parse FIT files, and sync with Garmin Connect.

## USB Device Download

Connect your Garmin watch and download activity and monitoring data:

```typescript
import { createGarminDriver } from 'ts-health'

const garmin = createGarminDriver()

// Detect connected Garmin devices
const devices = await garmin.detectDevices()
console.log(`Found ${devices.length} device(s)`)

for (const device of devices) {
  console.log(`${device.name} (${device.serial})`)
}

// Download data from the first device
if (devices.length > 0) {
  const result = await garmin.downloadData(devices[0], {
    includeActivities: true,
    includeMonitoring: true,
  })

  console.log(`Activities: ${result.activities.length}`)
  console.log(`Monitoring files: ${result.monitoring.length}`)

  for (const activity of result.activities) {
    console.log(`  ${activity.sport}: ${(activity.totalDistance / 1000).toFixed(1)}km`)
  }
}
```

## Garmin Connect Cloud Sync

Sync data from Garmin Connect without a USB connection:

```typescript
import { createGarminConnectClient } from 'ts-health'

const garminConnect = createGarminConnectClient({
  username: 'your-email@example.com',
  password: 'your-password',
})

// Get recent activities
const activities = await garminConnect.getActivities({ start: 0, limit: 20 })
for (const activity of activities) {
  console.log(`${activity.activityName}: ${activity.distance}m in ${activity.duration}s`)
}

// Download a specific activity FIT file
await garminConnect.downloadActivity(activityId, '/path/to/output.fit')
```

## Monitoring Data

Garmin devices collect continuous monitoring data throughout the day:

- **Heart Rate** - 24/7 wrist-based heart rate tracking
- **Steps** - Daily step counts with minute-by-minute granularity
- **Stress** - Stress level scores based on HRV
- **Sleep** - Sleep stages and duration
- **Body Battery** - Energy level throughout the day
- **SpO2** - Pulse oximetry readings
- **Respiration Rate** - Breathing rate data

```typescript
const result = await garmin.downloadData(device, {
  includeMonitoring: true,
})

for (const monitoring of result.monitoring) {
  console.log(`HR samples: ${monitoring.heartRate?.length ?? 0}`)
  console.log(`Steps: ${monitoring.steps?.length ?? 0}`)
  console.log(`Stress: ${monitoring.stress?.length ?? 0}`)
}
```

## Supported Garmin Devices

ts-health supports all Garmin devices that use the FIT file format, including:

- **Forerunner** series (55, 165, 255, 265, 965, etc.)
- **Fenix** series (6, 7, 8, etc.)
- **Enduro** series
- **Venu** series (2, 3, Sq 2, etc.)
- **Vivoactive** series
- **Instinct** series (2, 3, Crossover, etc.)
- **Edge** cycling computers
- **MARQ** series

## Combining Garmin + Health Platform Data

The real power comes from combining device data with health platform APIs:

```typescript
import { createGarminDriver, createOuraDriver, calculateTSS, createReadinessAnalyzer } from 'ts-health'

// Get training data from Garmin
const garmin = createGarminDriver()
const devices = await garmin.detectDevices()
const data = await garmin.downloadData(devices[0], { includeActivities: true })

// Calculate training stress
const todayActivity = data.activities[0]
const tss = calculateTSS(todayActivity, { ftp: 250 })

// Get readiness from Oura
const oura = createOuraDriver('oura-token')
const analyzer = createReadinessAnalyzer()
const range = { startDate: '2025-01-01', endDate: '2025-01-14' }

const [sleep, readiness, hrv, activity] = await Promise.all([
  oura.getSleep(range),
  oura.getReadiness(range),
  oura.getHRV(range),
  oura.getDailyActivity(range),
])

const result = analyzer.calculateTrainingReadiness({ sleep, readiness, hrv, activity })

console.log(`Today's TSS: ${tss}`)
console.log(`Readiness: ${result.score}/100 — ${result.recommendation}`)
```

## Other Device Brands

ts-health also includes drivers for other smartwatch brands:

```typescript
import {
  createPolarDriver,
  createSuuntoDriver,
  createCorosDriver,
  createWahooDriver,
  createAppleWatchDriver,
} from 'ts-health'

// All follow the same WatchDriver interface
const polar = createPolarDriver()
const suunto = createSuuntoDriver()
const coros = createCorosDriver()
const wahoo = createWahooDriver()
const appleWatch = createAppleWatchDriver()
```
