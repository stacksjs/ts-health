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

## LARQ Bottle PureVis 2 hydration

Connect with the email and password used in the LARQ companion app. This
unofficial, read-only integration uses the same Firebase account backend as
OpenLARQ. It works independently of Apple Health, so an Android user can also
connect. The LARQ app must sync the bottle before new intake appears in the
cloud. Apple/Google social sign-in is not supported by password authentication.

```ts
import { createLarqDriver } from 'ts-health'

const bottle = createLarqDriver({
  email: process.env.LARQ_EMAIL!,
  password: process.env.LARQ_PASSWORD!,
  timezone: 'America/Los_Angeles',
})
const days = await bottle.getDailyHydration() // volumeMl, samples, day
```

As an alternative, enable water sharing in the LARQ app, export Apple Health's
`export.xml`, and call `createLarqDriver('/path/to/export.xml')`. Only dietary-water
records whose source name is LARQ are included. Upload another export to get
new readings. `createAppleHealthDriver(path)` also supports water from all apps.
Both drivers expose `getHydration()` and `getDailyHydration()` and accept an
inclusive `{ startDate, endDate }` range. Water is canonical millilitres; days
preserve the export's local dates, or use the configured zone for cloud data.

Cloud events retain their Firebase identity. Deleted events, coffee, tea and
invalid volumes are excluded. Unknown export units are not guessed. Authentication
and permission errors are reported without credentials or provider response bodies.
The unofficial API can change; real-account compatibility must be verified with
the user's LARQ account. Direct Bluetooth hydration decoding is not implemented.

Protocol references: [OpenLARQ](https://github.com/lavyyy/openlarq),
[LARQ Apple Health compatibility](https://support.livelarq.com/hc/en-us/articles/37061029850011-Apple-Health-compatibility).

Oura OAuth also accepts `ring_configuration`, which is omitted from OpenAPI 1.42’s scope list. Include it (or use `OURA_OAUTH_SCOPES`) to read ring configuration **and ring battery history**. The consent screen calls it “Ring configuration settings”; existing tokens need a new grant. A missing collection scope is reported as `OuraApiError.requiredScope`, even when Oura returns HTTP 401.

The `daily_resilience` collection separately requires the consent scope `stress`, even though `daily_stress` works with the `daily` grant. `OURA_OAUTH_SCOPES` includes both independently required device and stress scopes. Check every collection after authorization; success of one daily endpoint does not establish access to the others.
