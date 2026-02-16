<p align="center"><img src="https://github.com/stacksjs/ts-health/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

# Introduction

> A comprehensive TypeScript library for health and fitness data from Oura Ring, WHOOP, Apple Health, Fitbit, and more.

## Why ts-health?

Building a training app that needs health data from multiple platforms is painful. Each platform has its own API, authentication flow, data shapes, and quirks. `ts-health` provides a unified `HealthDriver` interface that works the same way across all platforms, so you can focus on building your app instead of wrestling with APIs.

## What it does

- **Unified health data** - Same interface for Oura Ring, WHOOP, Apple Health, and Fitbit
- **Sleep analysis** - Quality scoring, consistency tracking, sleep debt analysis
- **Training readiness** - HRV-based readiness scoring with training recommendations
- **Recovery tracking** - Multi-factor recovery analysis from sleep, HRV, and activity
- **Health trends** - Moving averages, anomaly detection, trend direction analysis

## How it works

Each platform is implemented as a driver that conforms to the `HealthDriver` interface:

```typescript
import { createOuraDriver, createWhoopDriver } from 'ts-health'

// Same interface, different platforms
const oura = createOuraDriver('oura-token')
const whoop = createWhoopDriver('whoop-token')

// Both return the same SleepSession[] type
const ouraSleep = await oura.getSleep({ startDate: '2025-01-01' })
const whoopSleep = await whoop.getSleep({ startDate: '2025-01-01' })
```

The analysis modules work with data from any driver:

```typescript
import { createReadinessAnalyzer } from 'ts-health'

const analyzer = createReadinessAnalyzer()
const readiness = analyzer.calculateTrainingReadiness({ sleep, hrv, activity })
// => { score: 82, recommendation: 'go_hard', factors: { ... } }
```

## Companion to ts-watches

`ts-health` complements [`ts-watches`](https://github.com/stacksjs/ts-watches), which handles device-level data (FIT file parsing, USB downloads, Garmin/Polar/Suunto/Coros hardware). Together they cover the full spectrum:

- **ts-watches** - Smartwatch hardware, FIT files, GPS data, training metrics (TSS, NP, IF)
- **ts-health** - Health platform APIs, sleep, readiness, recovery, HRV analysis

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
