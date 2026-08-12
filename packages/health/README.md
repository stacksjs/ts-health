# ts-health

Typed health, fitness, and smartwatch data for training applications. The package combines health-platform drivers with the device, FIT, export, and analysis capabilities provided by `ts-watches`.

## Install

```bash
bun add ts-health
```

## Health platforms

```ts
import { createAppleHealthDriver, createOuraDriver } from 'ts-health'

const apple = createAppleHealthDriver('/path/to/apple-health-export.xml')
const workouts = await apple.getWorkouts()

const oura = createOuraDriver('access-token')
const readiness = await oura.getReadiness({ startDate: '2026-08-01' })
```

## Watches and activity files

`ts-health` re-exports the watch adapters and FIT parser from `ts-watches`:

```ts
import { createCorosDriver, FitDecoder, FitParser } from 'ts-health'

const coros = createCorosDriver()
const devices = await coros.detectDevices()

const parsed = new FitParser(await Bun.file('activity.fit').arrayBuffer()).parse()
const activity = new FitDecoder(parsed).decodeActivity()
```

See the [repository documentation](https://github.com/stacksjs/ts-health#readme) for all providers, exports, and analysis tools.

## License

MIT
