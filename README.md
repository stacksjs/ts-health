<p align="center"><img src=".github/art/cover.jpg" alt="Social Card of this repo"></p>

[![npm version][npm-version-src]][npm-version-href]
[![GitHub Actions][github-actions-src]][github-actions-href]
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
<!-- [![npm downloads][npm-downloads-src]][npm-downloads-href] -->
<!-- [![Codecov][codecov-src]][codecov-href] -->

# ts-health

A comprehensive TypeScript library for health, fitness, and smartwatch data. Unified access to Oura Ring, WHOOP, Apple Health, Fitbit, Withings, Renpho, Garmin, Polar, Suunto, Coros, and Wahoo — with smart scale body composition, FIT file parsing, training metrics, data export, and more. Built for training apps.

## Features

### Health Platform APIs

- **Oura Ring** - Full API v2 support: sleep, readiness, activity, heart rate, HRV, SpO2, stress, body temperature, VO2 max, sessions, tags, rest mode
- **WHOOP** - Recovery, strain, sleep, workouts, HRV, SpO2, skin temperature
- **Apple Health** - XML export parsing for sleep stages, heart rate, HRV, steps, workouts, SpO2, VO2 max, body composition
- **Fitbit** - Sleep stages, activity summaries, intraday heart rate, HRV, SpO2, skin temperature, cardio score, Aria scale data

### Smart Scales & Body Composition

- **Withings** - Full API support for Body, Body+, Body Cardio, Body Comp, Body Scan: weight, body fat %, muscle mass, bone mass, water %, visceral fat, BMR, heart rate
- **Renpho** - Weight, body fat %, muscle mass, bone mass, water %, visceral fat, BMR, protein %, subcutaneous fat, skeletal muscle
- **Fitbit Aria** - Weight and body fat via the Fitbit driver
- **Apple Health** - Weight, BMI, body fat %, lean body mass from synced scale data

### Smartwatch & Device Support

- **Garmin** - USB download, device detection, FIT file parsing, Garmin Connect API
- **Polar** - Device data download and parsing
- **Suunto** - Device data download and parsing
- **Coros** - Device data download and parsing
- **Wahoo** - Device data download and parsing
- **Apple Watch** - Activity and health data from device exports

### FIT File Parsing

- Binary FIT protocol parser for activity files from any device
- Full support for activity records, laps, sessions, GPS tracks
- Monitoring data: daily HR, steps, stress, sleep, body battery
- Sport type and sub-sport type classification

### Training Analysis

- **Training Load** - TSS (Training Stress Score), NP (Normalized Power), IF (Intensity Factor)
- **Training Readiness** - HRV trends, sleep quality, recovery, resting HR, activity balance, sleep debt
- **Recovery Analysis** - Sleep-based, HRV trend, resting HR trend, strain balance scoring
- **Zone Calculator** - HR and power zones based on thresholds
- **Race Predictor** - Race time predictions from performance data
- **CTL/ATL/TSB** - Chronic Training Load, Acute Training Load, Training Stress Balance

### Health Monitoring

- **Sleep** - Duration, stages (deep, light, REM, awake), efficiency, latency, quality scoring, debt tracking
- **Readiness** - Daily readiness scores with contributor breakdowns
- **Heart Rate** - Continuous monitoring, resting HR, intraday data
- **HRV** - Heart rate variability (RMSSD, SDNN) from sleep and throughout the day
- **Activity** - Steps, calories, active minutes, movement metrics, strain
- **SpO2** - Blood oxygen saturation
- **Stress** - Stress levels and recovery periods
- **Body Temperature** - Skin temperature deviations and trends
- **VO2 Max** - Cardio fitness estimates
- **Workouts** - Activity type, duration, calories, distance, heart rate, GPS tracks
- **Body Composition** - Weight, body fat %, muscle mass, bone mass, water %, visceral fat, BMR, metabolic age
- **Weight Tracking** - Weight measurements with BMI from smart scales

### Data Export

- **GPX** - GPS Exchange Format for route/track sharing
- **TCX** - Training Center XML for workout uploads
- **CSV** - Spreadsheet-compatible data export
- **GeoJSON** - Geographic data for mapping applications

### Real-time Sensors

- **ANT+** - Connect to ANT+ heart rate monitors, power meters, speed/cadence sensors
- **BLE** - Bluetooth Low Energy sensor connectivity
- **Live Tracking** - Real-time data streaming from connected sensors

### Developer Experience

- **TypeScript** - Fully typed APIs with comprehensive type exports
- **CLI Tool** - Sync, view, and analyze health data from the command line
- **Unified Interface** - Same `HealthDriver` interface across all health platforms
- **Single Package** - All device + platform support in one import

## Install

```bash
bun install ts-health
```

## Quick Start

### Health Platform Data (Oura, WHOOP, Fitbit)

```typescript
import { createOuraDriver } from 'ts-health'

const oura = createOuraDriver('your-personal-access-token')

// Get last week's sleep data
const sleep = await oura.getSleep({
  startDate: '2025-01-01',
  endDate: '2025-01-07',
})

for (const session of sleep) {
  const hours = Math.floor(session.totalSleepDuration / 3600)
  const mins = Math.floor((session.totalSleepDuration % 3600) / 60)
  console.log(`${session.day}: ${hours}h ${mins}m | efficiency: ${session.efficiency}%`)
}
```

### Smart Scale Data (Withings, Renpho)

```typescript
import { createWithingsDriver, createRenphoDriver } from 'ts-health'

// Withings (Body, Body+, Body Cardio, Body Comp, Body Scan)
const withings = createWithingsDriver('your-access-token')
const bodyComp = await withings.getBodyComposition({
  startDate: '2025-01-01',
  endDate: '2025-01-31',
})

for (const measurement of bodyComp) {
  console.log(`${measurement.day}: ${measurement.weight.toFixed(1)} kg`)
  console.log(`  Body fat: ${measurement.bodyFatPercentage?.toFixed(1)}%`)
  console.log(`  Muscle: ${measurement.muscleMass?.toFixed(1)} kg`)
}

// Renpho smart scales
const renpho = createRenphoDriver({ email: 'you@example.com', password: 'your-password' })
const weights = await renpho.getWeightMeasurements({ startDate: '2025-01-01' })
```

### Smartwatch Device Data (Garmin, Polar, Suunto, Coros, Wahoo)

```typescript
import { createGarminDriver, parseFITFile } from 'ts-health'

// Download directly from a connected Garmin device
const garmin = createGarminDriver()
const devices = await garmin.detectDevices()
if (devices.length > 0) {
  const result = await garmin.downloadData(devices[0], {
    includeActivities: true,
    includeMonitoring: true,
  })
  console.log(`Downloaded ${result.activities.length} activities`)
}

// Or parse any FIT file
const activity = await parseFITFile('/path/to/activity.fit')
console.log(`Sport: ${activity.sport} | Distance: ${(activity.totalDistance / 1000).toFixed(1)}km`)
```

### Training Load & Metrics

```typescript
import { calculateTSS, calculateNormalizedPower, ZoneCalculator } from 'ts-health'

// Calculate training metrics from activity data
const tss = calculateTSS(activity, { ftp: 250 })
const np = calculateNormalizedPower(activity)
console.log(`TSS: ${tss} | NP: ${np}W`)

// Power and HR zone calculations
const zones = new ZoneCalculator({ maxHR: 185, restingHR: 50, ftp: 250 })
```

### Data Export

```typescript
import { exportToGPX, exportToTCX, exportToCSV } from 'ts-health'

// Export activity to various formats
await exportToGPX(activity, '/path/to/output.gpx')
await exportToTCX(activity, '/path/to/output.tcx')
await exportToCSV(activity, '/path/to/output.csv')
```

### Cloud Integrations

```typescript
import { createGarminConnectClient, createStravaClient } from 'ts-health'

// Sync from Garmin Connect
const garminConnect = createGarminConnectClient({ username: '...', password: '...' })
const activities = await garminConnect.getActivities({ start: 0, limit: 10 })

// Upload to Strava
const strava = createStravaClient({ accessToken: '...' })
await strava.uploadActivity('/path/to/activity.fit')
```

## Usage Examples

### Oura Ring - Sleep & Readiness

```typescript
import { createOuraDriver } from 'ts-health'

const oura = createOuraDriver('your-token')
const range = { startDate: '2025-01-01', endDate: '2025-01-14' }

// Detailed sleep sessions with HR and HRV time series
const sleep = await oura.getSleep(range)

// Daily sleep scores with contributor breakdown
const dailySleep = await oura.getDailySleep(range)

// Training readiness
const readiness = await oura.getReadiness(range)
for (const r of readiness) {
  console.log(`${r.day}: score ${r.score} | HRV balance: ${r.contributors.hrvBalance}`)
}

// Heart rate, HRV, SpO2, stress
const hr = await oura.getHeartRate(range)
const hrv = await oura.getHRV(range)
const spo2 = await oura.getSpO2(range)
const stress = await oura.getStress(range)

// Body temperature and VO2 max
const temp = await oura.getBodyTemperature(range)
const vo2 = await oura.getVO2Max(range)

// Ring configuration and personal info
const rings = await oura.getRingConfiguration()
const profile = await oura.getPersonalInfo()
```

### WHOOP - Recovery & Strain

```typescript
import { createWhoopDriver } from 'ts-health'

const whoop = createWhoopDriver('your-access-token')

// Recovery scores (maps to readiness interface)
const recovery = await whoop.getReadiness({ startDate: '2025-01-01' })
for (const r of recovery) {
  console.log(`${r.day}: recovery ${r.score}% | HRV: ${r.contributors.hrvBalance}ms`)
}

// Sleep data with stage breakdown
const sleep = await whoop.getSleep({ startDate: '2025-01-01' })

// Workout strain
const workouts = await whoop.getWorkouts({ startDate: '2025-01-01' })
```

### Apple Health - Export Parsing

```typescript
import { createAppleHealthDriver } from 'ts-health'

// Point to your Apple Health export XML file
const apple = createAppleHealthDriver('/path/to/export.xml')

const sleep = await apple.getSleep({ startDate: '2025-01-01' })
const activity = await apple.getDailyActivity({ startDate: '2025-01-01' })
const heartRate = await apple.getHeartRate({ startDate: '2025-01-01' })
const hrv = await apple.getHRV({ startDate: '2025-01-01' })
const vo2 = await apple.getVO2Max({ startDate: '2025-01-01' })
```

### Fitbit - Activity & Sleep

```typescript
import { createFitbitDriver } from 'ts-health'

const fitbit = createFitbitDriver('your-access-token')

const sleep = await fitbit.getSleep({ startDate: '2025-01-01', endDate: '2025-01-07' })
const activity = await fitbit.getDailyActivity({ startDate: '2025-01-01', endDate: '2025-01-07' })
const hrv = await fitbit.getHRV({ startDate: '2025-01-01', endDate: '2025-01-07' })
```

### Withings Smart Scale - Body Composition

```typescript
import { createWithingsDriver } from 'ts-health'

const withings = createWithingsDriver('your-access-token')
const range = { startDate: '2025-01-01', endDate: '2025-01-31' }

// Full body composition data
const body = await withings.getBodyComposition(range)
for (const m of body) {
  console.log(`${m.day}: ${m.weight.toFixed(1)} kg | fat: ${m.bodyFatPercentage?.toFixed(1)}%`)
  console.log(`  Muscle: ${m.muscleMass?.toFixed(1)} kg | Bone: ${m.boneMass?.toFixed(1)} kg`)
  console.log(`  Water: ${m.waterPercentage?.toFixed(1)}% | Visceral fat: ${m.visceralFat}`)
}

// Simple weight tracking
const weights = await withings.getWeightMeasurements(range)

// Heart rate from scales with HR sensor (Body Cardio, Body Comp)
const hr = await withings.getHeartRate(range)
```

### Renpho Smart Scale - Body Composition

```typescript
import { createRenphoDriver } from 'ts-health'

// Renpho uses email/password authentication
const renpho = createRenphoDriver({
  email: 'your-email@example.com',
  password: 'your-password',
})

const body = await renpho.getBodyComposition({ startDate: '2025-01-01' })
for (const m of body) {
  console.log(`${m.day}: ${m.weight.toFixed(1)} kg | fat: ${m.bodyFatPercentage?.toFixed(1)}%`)
  console.log(`  Protein: ${m.proteinPercentage?.toFixed(1)}% | Skeletal muscle: ${m.skeletalMuscle?.toFixed(1)}%`)
  console.log(`  BMR: ${m.basalMetabolicRate} kcal`)
}
```

### Training Readiness Analysis

```typescript
import { createOuraDriver, createReadinessAnalyzer } from 'ts-health'

const oura = createOuraDriver('your-token')
const analyzer = createReadinessAnalyzer()
const range = { startDate: '2025-01-01', endDate: '2025-01-14' }

const [sleep, readiness, hrv, activity] = await Promise.all([
  oura.getSleep(range),
  oura.getReadiness(range),
  oura.getHRV(range),
  oura.getDailyActivity(range),
])

const result = analyzer.calculateTrainingReadiness({
  sleep,
  readiness,
  hrv,
  activity,
})

console.log(`Readiness: ${result.score}/100`)
console.log(`Recommendation: ${result.recommendation}`)
// => "go_hard" | "moderate" | "easy_day" | "rest"
console.log(result.details)
```

### Combine Device + Platform Data

```typescript
import {
  createGarminDriver,
  createOuraDriver,
  createRecoveryAnalyzer,
  calculateTSS,
} from 'ts-health'

// Training stress from your Garmin watch
const garmin = createGarminDriver()
const devices = await garmin.detectDevices()
const data = await garmin.downloadData(devices[0], { includeActivities: true })
const tss = calculateTSS(data.activities[0], { ftp: 250 })

// Recovery status from Oura Ring
const oura = createOuraDriver('oura-token')
const recovery = createRecoveryAnalyzer()
const range = { startDate: '2025-01-01', endDate: '2025-01-14' }
const [sleep, hrv] = await Promise.all([oura.getSleep(range), oura.getHRV(range)])
const status = recovery.calculateRecovery({ sleep, hrv })

console.log(`TSS: ${tss} | Recovery: ${status.status} (${status.score}/100)`)
if (tss > 100 && status.status !== 'fully_recovered') {
  console.log('High training load + incomplete recovery — consider an easy day')
}
```

### Race Predictions

```typescript
import { RacePredictor } from 'ts-health'

const predictor = new RacePredictor()
const predictions = predictor.predictFromPerformance(5000, 20 * 60) // 5K in 20min
console.log(`Predicted marathon: ${Math.floor(predictions.marathon / 60)}:${(predictions.marathon % 60).toFixed(0).padStart(2, '0')}`)
```

### Sleep Quality Analysis

```typescript
import { createOuraDriver, createSleepAnalyzer } from 'ts-health'

const oura = createOuraDriver('your-token')
const analyzer = createSleepAnalyzer()

const sessions = await oura.getSleep({ startDate: '2025-01-01' })

for (const session of sessions) {
  const quality = analyzer.scoreSleepQuality(session)
  console.log(`${session.day}: ${quality.overall}/100 (${quality.rating})`)
  console.log(`  Duration: ${quality.durationScore} | Deep: ${quality.deepSleepScore} | REM: ${quality.remSleepScore}`)
}

// Sleep consistency across multiple nights
const consistency = analyzer.scoreSleepConsistency(sessions)
console.log(`Sleep consistency: ${consistency}/100`)

// Sleep debt analysis
const debt = analyzer.analyzeSleepDebt(sessions)
console.log(`Sleep debt: ${debt.currentDebtMinutes} minutes | Trend: ${debt.trend}`)
```

### Health Trends

```typescript
import { createTrendAnalyzer } from 'ts-health'

const trends = createTrendAnalyzer()

// Analyze HRV trend
const hrvTrend = trends.analyzeTrend('hrv', hrvData.map(h => ({
  day: h.timestamp.slice(0, 10),
  value: h.hrv,
})))

console.log(`HRV trend: ${hrvTrend.direction} (${hrvTrend.percentChange}%)`)

// Detect anomalies
const anomalies = trends.detectAnomalies(dataPoints, 2)

// Moving average
const smoothed = trends.calculateMovingAverage(dataPoints, 7)
```

## CLI

The CLI provides 22 commands for syncing, viewing, analyzing, and exporting health data from all supported platforms.

```bash
# Sync all health data from any platform
health sync --driver oura --token YOUR_TOKEN --days 30 --output ./data
health sync --driver withings --token YOUR_TOKEN --days 60

# View specific health metrics
health sleep --driver oura --token YOUR_TOKEN --days 7
health activity --driver oura --token YOUR_TOKEN --days 7
health workouts --driver oura --token YOUR_TOKEN --days 30
health hr --driver oura --token YOUR_TOKEN --days 1
health hrv --driver oura --token YOUR_TOKEN --days 14
health readiness --driver oura --token YOUR_TOKEN --days 7
health spo2 --driver oura --token YOUR_TOKEN --days 7
health stress --driver oura --token YOUR_TOKEN --days 7
health body-temp --driver oura --token YOUR_TOKEN --days 14
health vo2max --driver oura --token YOUR_TOKEN --days 30

# Smart scale data
health weight --driver withings --token YOUR_TOKEN --days 30
health body --driver withings --token YOUR_TOKEN --days 30
health body --driver renpho --email you@example.com --password pass123

# Analysis commands
health analyze --driver oura --token YOUR_TOKEN --days 14
health recovery --driver oura --token YOUR_TOKEN --days 14
health sleep-quality --driver oura --token YOUR_TOKEN --days 7
health sleep-debt --driver oura --token YOUR_TOKEN --days 14 --target 480
health trends --driver oura --token YOUR_TOKEN --days 30
health trends --driver withings --token YOUR_TOKEN --days 60 --metrics weight

# Overview & comparison
health dashboard --driver oura --token YOUR_TOKEN
health compare --driver oura --token YOUR_TOKEN --days 14

# Export & profile
health export --driver oura --token YOUR_TOKEN --days 90 --output ./export.json
health profile --driver oura --token YOUR_TOKEN

# JSON output for any command
health sleep --driver oura --token YOUR_TOKEN --format json
```

## Supported Platforms & Metrics

### Health Platform APIs

| Metric | Oura | WHOOP | Apple Health | Fitbit |
|--------|------|-------|-------------|--------|
| Sleep Stages | Deep, Light, REM, Awake | Deep, Light, REM, Awake | Deep, Core, REM, Awake | Deep, Light, REM, Wake |
| Sleep Score | Daily score + contributors | Efficiency % | Efficiency % | Efficiency + stages |
| Readiness | Score + 8 contributors | Recovery score | - | - |
| Heart Rate | Continuous | Via cycles | Continuous | Continuous + intraday |
| HRV | Sleep-based RMSSD | RMSSD | SDNN | Daily + deep RMSSD |
| SpO2 | Daily average | Via recovery | Spot checks | Daily avg/min/max |
| Stress | High/recovery/summary | Via strain | - | - |
| Body Temp | Deviation + trend | Skin temp | Wrist temp | Nightly relative |
| VO2 Max | Estimated | - | From workouts | Cardio score |
| Activity | Steps, calories, MET | Strain, kilojoules | Steps, calories, distance | Steps, calories, zones |
| Workouts | Type, duration, intensity | Type, strain, HR zones | Type, duration, distance | Type, duration, HR |
| Body Composition | - | - | Weight, fat %, lean mass | Weight, fat % (Aria) |

### Smart Scales

| Metric | Withings | Renpho |
|--------|----------|--------|
| Weight | Yes | Yes |
| BMI | Yes | Yes |
| Body Fat % | Yes | Yes |
| Muscle Mass | Yes | Yes |
| Bone Mass | Yes | Yes |
| Water % | Yes | Yes |
| Visceral Fat | Yes | Yes |
| BMR | Yes | Yes |
| Protein % | - | Yes |
| Subcutaneous Fat | - | Yes |
| Skeletal Muscle % | - | Yes |
| Heart Rate | Yes (Body Cardio/Comp) | - |

### Smartwatch Devices

| Capability | Garmin | Polar | Suunto | Coros | Wahoo | Apple Watch |
|-----------|--------|-------|--------|-------|-------|-------------|
| USB Download | Yes | Yes | Yes | Yes | Yes | - |
| FIT Parsing | Yes | Yes | Yes | Yes | Yes | - |
| GPS Tracks | Yes | Yes | Yes | Yes | Yes | Yes |
| HR Data | Yes | Yes | Yes | Yes | Yes | Yes |
| Cloud Sync | Garmin Connect | - | - | - | - | - |
| Activities | Full records + laps | Records + laps | Records + laps | Records + laps | Records + laps | Workout summaries |
| Monitoring | HR, stress, sleep, body battery | HR, sleep | HR, sleep | HR, sleep | HR | HR, sleep |
| Export | GPX, TCX, CSV, GeoJSON | GPX, TCX, CSV | GPX, TCX, CSV | GPX, TCX, CSV | GPX, TCX, CSV | - |

### Training Metrics

| Metric | Description |
|--------|------------|
| TSS | Training Stress Score — normalized training load per session |
| NP | Normalized Power — weighted average power accounting for variability |
| IF | Intensity Factor — ratio of NP to FTP |
| CTL | Chronic Training Load — long-term fitness trend |
| ATL | Acute Training Load — short-term fatigue |
| TSB | Training Stress Balance — freshness (CTL - ATL) |
| HR Zones | Heart rate training zones (5 or 7 zone models) |
| Power Zones | Power-based training zones from FTP |

## Platform Setup

### Oura Ring

1. Go to [Oura Developer Portal](https://cloud.ouraring.com/personal-access-tokens)
2. Create a Personal Access Token
3. Use the token with `createOuraDriver(token)`

### WHOOP

1. Register at [WHOOP Developer Portal](https://developer.whoop.com/)
2. Create an OAuth application
3. Complete the OAuth flow to get an access token
4. Use with `createWhoopDriver(accessToken)`

### Apple Health

1. Open Health app on iPhone
2. Tap profile > Export All Health Data
3. Extract the ZIP file
4. Use with `createAppleHealthDriver('/path/to/export.xml')`

### Fitbit

1. Register at [Fitbit Developer Portal](https://dev.fitbit.com/)
2. Create an OAuth 2.0 application
3. Complete the OAuth flow to get an access token
4. Use with `createFitbitDriver(accessToken)`

### Withings Smart Scales

1. Register at [Withings Developer Portal](https://developer.withings.com/)
2. Create an OAuth 2.0 application
3. Complete the OAuth flow to get an access token
4. Use with `createWithingsDriver(accessToken)`

### Renpho Smart Scales

1. Use your existing Renpho account credentials
2. Use with `createRenphoDriver({ email: '...', password: '...' })`

### Garmin (USB)

1. Connect your Garmin watch via USB
2. Use `createGarminDriver()` to detect and download

### Garmin Connect (Cloud)

1. Use your Garmin Connect credentials
2. Use `createGarminConnectClient({ username, password })`

### Strava

1. Register at [Strava Developer Portal](https://developers.strava.com/)
2. Create an OAuth application
3. Use `createStravaClient({ accessToken })`

## Configuration

```typescript
// health.config.ts
import type { HealthConfig } from 'ts-health'

const config: HealthConfig = {
  verbose: true,
  outputDir: './health-data',
  drivers: ['oura', 'withings'],
  oura: {
    personalAccessToken: 'your-token',
  },
  withings: {
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret',
    accessToken: 'your-access-token',
  },
  renpho: {
    email: 'your-email@example.com',
    password: 'your-password',
  },
}

export default config
```

## Testing

```bash
bun test
```

## Changelog

Please see our [releases](https://github.com/stacksjs/ts-health/releases) page for more information on what has changed recently.

## Contributing

Please see [CONTRIBUTING](.github/CONTRIBUTING.md) for details.

## Community

For help, discussion about best practices, or any other conversation that would benefit from being searchable:

[Discussions on GitHub](https://github.com/stacksjs/ts-health/discussions)

For casual chit-chat with others using this package:

[Join the Stacks Discord Server](https://discord.gg/stacksjs)

## Postcardware

"Software that is free, but hopes for a postcard." We love receiving postcards from around the world showing where Stacks is being used! We showcase them on our website too.

Our address: Stacks.js, 12665 Village Ln #2306, Playa Vista, CA 90094, United States

## Sponsors

We would like to extend our thanks to the following sponsors for funding Stacks development. If you are interested in becoming a sponsor, please reach out to us.

- [JetBrains](https://www.jetbrains.com/)
- [The Solana Foundation](https://solana.com/)

## License

The MIT License (MIT). Please see [LICENSE](LICENSE.md) for more information.

Made with 💙

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/ts-health?style=flat-square
[npm-version-href]: https://npmjs.com/package/ts-health
[github-actions-src]: https://img.shields.io/github/actions/workflow/status/stacksjs/ts-health/ci.yml?style=flat-square&branch=main
[github-actions-href]: https://github.com/stacksjs/ts-health/actions?query=workflow%3Aci

<!-- [codecov-src]: https://img.shields.io/codecov/c/gh/stacksjs/ts-health/main?style=flat-square
[codecov-href]: https://codecov.io/gh/stacksjs/ts-health -->
