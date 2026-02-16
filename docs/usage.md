# Usage

There are two ways of using ts-health: _as a library or as a CLI._

## Library

### Health Platform APIs

#### Oura Ring

The Oura driver uses the Oura Ring API v2 with a Personal Access Token:

```typescript
import { createOuraDriver } from 'ts-health'

const oura = createOuraDriver('your-personal-access-token')
const range = { startDate: '2025-01-01', endDate: '2025-01-14' }

// Sleep - detailed sessions with HR and HRV time series
const sleep = await oura.getSleep(range)
for (const session of sleep) {
  console.log(`${session.day}: ${Math.floor(session.totalSleepDuration / 3600)}h sleep`)
  console.log(`  Efficiency: ${session.efficiency}%`)
  console.log(`  Deep: ${Math.round(session.deepSleepDuration / 60)}m`)
  console.log(`  REM: ${Math.round(session.remSleepDuration / 60)}m`)
  console.log(`  HRV: ${session.averageHRV ?? 'N/A'}ms`)
}

// Daily sleep scores with contributor breakdown
const dailySleep = await oura.getDailySleep(range)

// Training readiness
const readiness = await oura.getReadiness(range)

// Heart rate, HRV, SpO2, stress
const hr = await oura.getHeartRate(range)
const hrv = await oura.getHRV(range)
const spo2 = await oura.getSpO2(range)
const stress = await oura.getStress(range)

// Activity data
const activity = await oura.getDailyActivity(range)

// Workouts
const workouts = await oura.getWorkouts(range)

// Body temperature and VO2 max
const temp = await oura.getBodyTemperature(range)
const vo2 = await oura.getVO2Max(range)

// Ring configuration and personal info
const rings = await oura.getRingConfiguration()
const profile = await oura.getPersonalInfo()

// Oura-specific: sessions, tags, rest mode
const sessions = await oura.getSessions(range)
const tags = await oura.getTags(range)
const restMode = await oura.getRestModePeriods(range)
```

#### WHOOP

The WHOOP driver maps WHOOP's strain/recovery model to the unified health interface:

```typescript
import { createWhoopDriver } from 'ts-health'

const whoop = createWhoopDriver('your-access-token')
const range = { startDate: '2025-01-01' }

// Recovery (maps to readiness interface)
const recovery = await whoop.getReadiness(range)
for (const r of recovery) {
  console.log(`${r.day}: recovery ${r.score}%`)
}

// Sleep with stage breakdown
const sleep = await whoop.getSleep(range)

// Workouts with strain data
const workouts = await whoop.getWorkouts(range)

// HRV from recovery data
const hrv = await whoop.getHRV(range)

// SpO2 and skin temperature
const spo2 = await whoop.getSpO2(range)
const temp = await whoop.getBodyTemperature(range)
```

#### Apple Health

The Apple Health driver parses the XML export from the Health app:

```typescript
import { createAppleHealthDriver } from 'ts-health'

// Point to your exported XML file
const apple = createAppleHealthDriver('/path/to/apple_health_export/export.xml')

const sleep = await apple.getSleep({ startDate: '2025-01-01' })
const activity = await apple.getDailyActivity({ startDate: '2025-01-01' })
const heartRate = await apple.getHeartRate({ startDate: '2025-01-01' })
const hrv = await apple.getHRV({ startDate: '2025-01-01' })
const workouts = await apple.getWorkouts({ startDate: '2025-01-01' })
const spo2 = await apple.getSpO2({ startDate: '2025-01-01' })
const vo2 = await apple.getVO2Max({ startDate: '2025-01-01' })
const temp = await apple.getBodyTemperature({ startDate: '2025-01-01' })
```

#### Fitbit

The Fitbit driver uses the Fitbit Web API:

```typescript
import { createFitbitDriver } from 'ts-health'

const fitbit = createFitbitDriver('your-access-token')
const range = { startDate: '2025-01-01', endDate: '2025-01-07' }

const sleep = await fitbit.getSleep(range)
const activity = await fitbit.getDailyActivity(range)
const hr = await fitbit.getHeartRate(range)
const hrv = await fitbit.getHRV(range)
const spo2 = await fitbit.getSpO2(range)
const temp = await fitbit.getBodyTemperature(range)
const vo2 = await fitbit.getVO2Max(range)
const workouts = await fitbit.getWorkouts(range)
```

### Smartwatch & Device Data

#### Garmin USB Download

```typescript
import { createGarminDriver } from 'ts-health'

const garmin = createGarminDriver()

// Detect connected devices
const devices = await garmin.detectDevices()
console.log(`Found ${devices.length} device(s)`)

// Download activities and monitoring data
if (devices.length > 0) {
  const result = await garmin.downloadData(devices[0], {
    includeActivities: true,
    includeMonitoring: true,
  })

  for (const activity of result.activities) {
    console.log(`${activity.sport}: ${(activity.totalDistance / 1000).toFixed(1)}km`)
  }
}
```

#### FIT File Parsing

```typescript
import { parseFITFile } from 'ts-health'

const activity = await parseFITFile('/path/to/activity.fit')
console.log(`Sport: ${activity.sport}`)
console.log(`Distance: ${(activity.totalDistance / 1000).toFixed(2)}km`)
console.log(`Duration: ${activity.totalTimerTime}s`)
console.log(`Avg HR: ${activity.avgHeartRate}bpm`)

// GPS tracks
for (const record of activity.records) {
  if (record.positionLat && record.positionLong) {
    console.log(`${record.positionLat}, ${record.positionLong}`)
  }
}
```

#### Other Devices

```typescript
import {
  createPolarDriver,
  createSuuntoDriver,
  createCorosDriver,
  createWahooDriver,
} from 'ts-health'

const polar = createPolarDriver()
const suunto = createSuuntoDriver()
const coros = createCorosDriver()
const wahoo = createWahooDriver()
```

### Training Metrics

#### TSS, NP, IF

```typescript
import { calculateTSS, calculateNormalizedPower, calculateIntensityFactor } from 'ts-health'

const tss = calculateTSS(activity, { ftp: 250 })
const np = calculateNormalizedPower(activity)
const iif = calculateIntensityFactor(activity, { ftp: 250 })
console.log(`TSS: ${tss.toFixed(0)} | NP: ${np}W | IF: ${iif.toFixed(2)}`)
```

#### Zone Calculator

```typescript
import { ZoneCalculator } from 'ts-health'

const zones = new ZoneCalculator({ maxHR: 185, restingHR: 50, ftp: 250 })
const hrZones = zones.getHRZones()
const powerZones = zones.getPowerZones()
```

#### Race Predictions

```typescript
import { RacePredictor } from 'ts-health'

const predictor = new RacePredictor()
const predictions = predictor.predictFromPerformance(5000, 20 * 60) // 5K in 20min
console.log(`Marathon prediction: ${Math.floor(predictions.marathon / 60)}min`)
```

#### Training Load (CTL/ATL/TSB)

```typescript
import { TrainingLoadCalculator } from 'ts-health'

const calculator = new TrainingLoadCalculator()
const load = calculator.calculateTrainingLoad(dailyTSSValues)
console.log(`CTL: ${load.ctl.toFixed(1)} | ATL: ${load.atl.toFixed(1)} | TSB: ${load.tsb.toFixed(1)}`)
```

### Data Export

```typescript
import { exportToGPX, exportToTCX, exportToCSV, exportToGeoJSON } from 'ts-health'

await exportToGPX(activity, '/path/to/output.gpx')
await exportToTCX(activity, '/path/to/output.tcx')
await exportToCSV(activity, '/path/to/output.csv')
await exportToGeoJSON(activity, '/path/to/output.geojson')
```

### Cloud Integrations

```typescript
import { createGarminConnectClient, createStravaClient, createTrainingPeaksClient } from 'ts-health'

// Garmin Connect
const garminConnect = createGarminConnectClient({ username: '...', password: '...' })
const activities = await garminConnect.getActivities({ start: 0, limit: 10 })

// Strava
const strava = createStravaClient({ accessToken: '...' })
await strava.uploadActivity('/path/to/activity.fit')

// TrainingPeaks
const tp = createTrainingPeaksClient({ accessToken: '...' })
const workouts = await tp.getWorkouts({ startDate: '2025-01-01', endDate: '2025-01-07' })
```

### Training Readiness Analysis

Combine data from any driver to calculate training readiness:

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

console.log('Factors:')
console.log(`  HRV Status:       ${result.factors.hrvStatus}/100`)
console.log(`  Sleep Quality:    ${result.factors.sleepQuality}/100`)
console.log(`  Recovery Level:   ${result.factors.recoveryLevel}/100`)
console.log(`  Resting HR:       ${result.factors.restingHeartRate}/100`)
console.log(`  Activity Balance: ${result.factors.activityBalance}/100`)
console.log(`  Sleep Debt:       ${result.factors.sleepDebt}/100`)
```

### Sleep Quality Analysis

```typescript
import { createSleepAnalyzer } from 'ts-health'

const analyzer = createSleepAnalyzer()

// Score individual sessions
for (const session of sleepSessions) {
  const quality = analyzer.scoreSleepQuality(session)
  console.log(`${session.day}: ${quality.overall}/100 (${quality.rating})`)
}

// Multi-night consistency
const consistency = analyzer.scoreSleepConsistency(sleepSessions)

// Sleep debt tracking
const debt = analyzer.analyzeSleepDebt(sleepSessions, 480) // 8h target
console.log(`Debt: ${debt.currentDebtMinutes}min | Trend: ${debt.trend}`)
```

### Recovery Analysis

```typescript
import { createRecoveryAnalyzer } from 'ts-health'

const recovery = createRecoveryAnalyzer()
const result = recovery.calculateRecovery({ sleep, hrv, activity })

console.log(`${result.status}: ${result.score}/100`)
// => "fully_recovered" | "mostly_recovered" | "partially_recovered" | "not_recovered"
```

### Health Trends

```typescript
import { createTrendAnalyzer } from 'ts-health'

const trends = createTrendAnalyzer()

// Analyze direction over a period
const hrvTrend = trends.analyzeTrend('HRV', dataPoints, 14)
console.log(`${hrvTrend.direction}: ${hrvTrend.percentChange}%`)

// 7-day moving average
const smoothed = trends.calculateMovingAverage(dataPoints, 7)

// Detect anomalies (values > 2 std deviations from mean)
const anomalies = trends.detectAnomalies(dataPoints, 2)
```

## CLI

```bash
# Sync data from any supported platform
health sync --driver oura --token YOUR_TOKEN --start 2025-01-01 --output ./data

# View sleep data
health sleep --token YOUR_TOKEN --start 2025-01-01 --end 2025-01-07

# View readiness scores
health readiness --token YOUR_TOKEN --start 2025-01-01

# Full training readiness analysis
health analyze --token YOUR_TOKEN --days 14

# Show version
health version

# Show help
health --help
```

## Testing

```bash
bun test
```
