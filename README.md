<p align="center"><img src=".github/art/cover.jpg" alt="Social Card of this repo"></p>

[![npm version][npm-version-src]][npm-version-href]
[![GitHub Actions][github-actions-src]][github-actions-href]
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
<!-- [![npm downloads][npm-downloads-src]][npm-downloads-href] -->
<!-- [![Codecov][codecov-src]][codecov-href] -->

# ts-health

A comprehensive TypeScript library for health and fitness data from Oura Ring, WHOOP, Apple Health, Fitbit, and more. Built for training apps that need sleep, readiness, HRV, heart rate, and recovery data across platforms.

## Features

### Platform Support

- **Oura Ring** - Full API v2 support: sleep, readiness, activity, heart rate, HRV, SpO2, stress, body temperature, VO2 max, sessions, tags, rest mode
- **WHOOP** - Recovery, strain, sleep, workouts, HRV, SpO2, skin temperature
- **Apple Health** - XML export parsing for sleep stages, heart rate, HRV, steps, workouts, SpO2, VO2 max
- **Fitbit** - Sleep stages, activity summaries, intraday heart rate, HRV, SpO2, skin temperature, cardio score

### Health Data

- **Sleep** - Duration, stages (deep, light, REM, awake), efficiency, latency, sleep phases
- **Readiness** - Daily readiness scores with contributor breakdowns
- **Heart Rate** - Continuous monitoring, resting HR
- **HRV** - Heart rate variability from sleep and throughout the day
- **Activity** - Steps, calories, active minutes, movement metrics
- **SpO2** - Blood oxygen saturation
- **Stress** - Stress levels and recovery periods
- **Body Temperature** - Skin temperature deviations and trends
- **VO2 Max** - Cardio fitness estimates
- **Workouts** - Activity type, duration, calories, distance, heart rate

### Training Analysis

- **Sleep Quality Scoring** - Duration, efficiency, deep/REM proportions, latency, consistency
- **Training Readiness** - HRV trends, sleep quality, recovery, resting HR, activity balance, sleep debt
- **Recovery Analysis** - Sleep-based, HRV trend, resting HR trend, strain balance scoring
- **Health Trends** - Moving averages, anomaly detection, multi-metric trend analysis
- **Sleep Debt** - Accumulation tracking with recovery estimates

### Developer Experience

- **TypeScript** - Fully typed APIs with comprehensive type exports
- **CLI Tool** - Sync, view, and analyze health data from command line
- **Unified Interface** - Same `HealthDriver` interface across all platforms
- **Works with ts-watches** - Complements smartwatch device-level data

## Install

```bash
bun install ts-health
```

## Quick Start

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

### Recovery Analysis

```typescript
import { createRecoveryAnalyzer } from 'ts-health'

const recovery = createRecoveryAnalyzer()
const result = recovery.calculateRecovery({ sleep, hrv, activity })

console.log(`Recovery: ${result.score}/100 (${result.status})`)
// => "fully_recovered" | "mostly_recovered" | "partially_recovered" | "not_recovered"
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

```bash
# Sync health data from Oura
health sync --driver oura --token YOUR_TOKEN --start 2025-01-01 --output ./data

# View sleep data
health sleep --token YOUR_TOKEN --start 2025-01-01

# View readiness scores
health readiness --token YOUR_TOKEN --start 2025-01-01

# Full training readiness analysis
health analyze --token YOUR_TOKEN --days 14

# Show version
health version
```

## Supported Health Metrics

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

## Configuration

```typescript
// health.config.ts
import type { HealthConfig } from 'ts-health'

const config: HealthConfig = {
  verbose: true,
  outputDir: './health-data',
  drivers: ['oura'],
  oura: {
    personalAccessToken: 'your-token',
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

“Software that is free, but hopes for a postcard.” We love receiving postcards from around the world showing where Stacks is being used! We showcase them on our website too.

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
