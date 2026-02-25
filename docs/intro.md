<p align="center"><img src="https://github.com/stacksjs/ts-health/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

# Introduction

> A comprehensive TypeScript library for health, fitness, and smartwatch data. Unified access to Oura Ring, WHOOP, Apple Health, Fitbit, Withings, Renpho, Garmin, Polar, Suunto, Coros, and Wahoo — with smart scale body composition, FIT file parsing, training metrics, data export, and more.

## Why ts-health

Building a training app that needs health and device data from multiple sources is painful. Each platform has its own API, authentication flow, data shapes, and quirks. Device data comes in binary FIT files with their own protocol. `ts-health` provides a single package that covers everything — cloud health APIs, smartwatch device drivers, FIT file parsing, training analysis, and data export — so you can focus on building your app.

## What it does

### Health Platform APIs

- **Oura Ring** - Sleep, readiness, activity, HRV, SpO2, stress, body temperature, VO2 max
- **WHOOP** - Recovery, strain, sleep, workouts, HRV, SpO2, skin temperature
- **Apple Health** - XML export parsing for sleep, heart rate, HRV, workouts, body composition, and more
- **Fitbit** - Sleep stages, activity summaries, intraday heart rate, HRV, SpO2, Aria scale data

### Smart Scales & Body Composition

- **Withings** - Body, Body+, Body Cardio, Body Comp, Body Scan: weight, body fat %, muscle mass, bone mass, water %, visceral fat, BMR, heart rate
- **Renpho** - Weight, body fat %, muscle mass, bone mass, water %, visceral fat, BMR, protein %, subcutaneous fat, skeletal muscle

### Smartwatch & Device Data

- **Garmin** - USB download, FIT file parsing, Garmin Connect cloud sync
- **Polar** - Device data download and parsing
- **Suunto** - Device data download and parsing
- **Coros** - Device data download and parsing
- **Wahoo** - Device data download and parsing
- **Apple Watch** - Activity and health data exports

### Training & Analysis

- **FIT Parsing** - Binary FIT protocol parser for activities, monitoring, GPS tracks
- **Training Metrics** - TSS, Normalized Power, Intensity Factor, CTL/ATL/TSB
- **Zone Calculator** - HR and power zones from thresholds
- **Race Predictor** - Race time predictions from performance data
- **Sleep Analysis** - Quality scoring, consistency tracking, sleep debt analysis
- **Training Readiness** - HRV-based readiness scoring with training recommendations
- **Recovery Tracking** - Multi-factor recovery analysis from sleep, HRV, and activity
- **Health Trends** - Moving averages, anomaly detection, trend direction analysis
- **Data Export** - GPX, TCX, CSV, GeoJSON

### Real-time Sensors

- **ANT+** - Heart rate monitors, power meters, speed/cadence sensors
- **BLE** - Bluetooth Low Energy sensor connectivity
- **Live Tracking** - Real-time data streaming

## How it works

Each health platform is implemented as a driver that conforms to the `HealthDriver` interface:

```typescript
import { createOuraDriver, createWhoopDriver } from 'ts-health'

// Same interface, different platforms
const oura = createOuraDriver('oura-token')
const whoop = createWhoopDriver('whoop-token')

// Both return the same SleepSession[] type
const ouraSleep = await oura.getSleep({ startDate: '2025-01-01' })
const whoopSleep = await whoop.getSleep({ startDate: '2025-01-01' })
```

Smart scales also use the unified interface:

```typescript
import { createWithingsDriver, createRenphoDriver } from 'ts-health'

const withings = createWithingsDriver('withings-token')
const body = await withings.getBodyComposition({ startDate: '2025-01-01' })
// => BodyComposition[] with weight, fat%, muscle, bone, water%, etc.

const renpho = createRenphoDriver({ email: '...', password: '...' })
const weights = await renpho.getWeightMeasurements({ startDate: '2025-01-01' })
```

Device data uses smartwatch drivers and FIT file parsing:

```typescript
import { createGarminDriver, parseFITFile, calculateTSS, exportToGPX } from 'ts-health'

// Download from connected Garmin watch
const garmin = createGarminDriver()
const devices = await garmin.detectDevices()
const data = await garmin.downloadData(devices[0])

// Or parse any FIT file directly
const activity = await parseFITFile('/path/to/activity.fit')
const tss = calculateTSS(activity, { ftp: 250 })
await exportToGPX(activity, '/path/to/output.gpx')
```

The analysis modules work with data from any source:

```typescript
import { createReadinessAnalyzer } from 'ts-health'

const analyzer = createReadinessAnalyzer()
const readiness = analyzer.calculateTrainingReadiness({ sleep, hrv, activity })
// => { score: 82, recommendation: 'go_hard', factors: { ... } }
```

## Changelog

Please see our [releases](https://github.com/stacksjs/ts-health/releases) page for more information on what has changed recently.

## Contributing

Please review the [Contributing Guide](https://github.com/stacksjs/contributing) for details.

## Community

For help, discussion about best practices, or any other conversation that would benefit from being searchable:

[Discussions on GitHub](https://github.com/stacksjs/ts-health/discussions)

For casual chit-chat with others using this package:

[Join the Stacks Discord Server](https://discord.gg/stacksjs)

## Postcardware

Two things are true: Stacks OSS will always stay open-source, and we do love to receive postcards from wherever Stacks is used! _We also publish them on our website._

Our address: Stacks.js, 12665 Village Ln #2306, Playa Vista, CA 90094

## Sponsors

We would like to extend our thanks to the following sponsors for funding Stacks development. If you are interested in becoming a sponsor, please reach out to us.

- [JetBrains](https://www.jetbrains.com/)
- [The Solana Foundation](https://solana.com/)

## Credits

- [Chris Breuer](https://github.com/chrisbbreuer)
- [All Contributors](https://github.com/stacksjs/ts-health/graphs/contributors)

## License

The MIT License (MIT). Please see [LICENSE](https://github.com/stacksjs/ts-health/tree/main/LICENSE.md) for more information.

Made with 💙
