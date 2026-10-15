# Eight Sleep

`ts-health/eight-sleep` is a standalone cloud client and `HealthDriver` for the
signed-in sleeper. It needs internet access and an Eight Sleep account; it does
not require Apple Health, an iPhone, Bluetooth, Home Assistant or a separate
integration service. The API is unofficial and can change.

```ts
import { createEightSleepDriver } from 'ts-health/eight-sleep'

const pod = createEightSleepDriver({
  email: process.env.EIGHT_SLEEP_EMAIL!,
  password: process.env.EIGHT_SLEEP_PASSWORD!,
  timezone: 'America/Los_Angeles',
  onSession: session => encryptedStore.save(session),
})
const dashboard = await pod.getDashboard({ startDate: '2026-10-01', endDate: '2026-10-14' })
const nights = await pod.getNights({ startDate: '2026-10-01', endDate: '2026-10-14' })
await pod.execute({ action: 'temperature', level: -20, durationSeconds: 3600 })
```

The public companion-app OAuth client configuration is built in. `clientId` and
`clientSecret` override it. `session` restores a saved token; `onSession` saves a
new one. Pass the displayed Pod's ID as `expectedDeviceId` when executing a
control to refuse the action if the account has selected a different Pod.
Eight Sleep's observed authentication uses password sign-in again on
expiry, so server applications that reconnect automatically must retain the
account credentials securely. Never put passwords in a browser bundle or log
provider response bodies. `fetch` is injectable for tests.

## Supported surface

| Area | Reads and explicit controls |
| --- | --- |
| Sleep | Provider-day reports, sleep/fitness/quality/routine scores, sleep duration, efficiency, latency, light/deep/REM/awake durations, reported stage timeline, tosses and turns, processing status |
| Biometrics | Heart rate, HRV, respiratory rate and measured time series where reported |
| Environment | Bed and room temperature reports and time series; these are never mislabeled as body temperature |
| Pod climate | Power, current level, optional duration, bedtime/early/late smart-schedule levels |
| Alarms | Read alarms; create a vibration/thermal alarm; change time or repeating weekdays; enable/disable; snooze; dismiss/stop. Editing preserves other alarm settings |
| Adjustable base | Reported head/feet angles, sleep/relaxing/reading presets, active snore mitigation; explicit angle and preset controls |
| Pillow | Side-matched pillow power and temperature when attached to this Pod |
| Audio | Offered tracks, player state and volume; play/pause, choose track, change volume |
| Maintenance | Water/priming status, last prime, start priming, hub LED brightness |
| Account-side settings | Left/right/solo assignment and start/end away mode on the verified current Pod |

Check `dashboard.capabilities` before rendering a control. Hardware and account
entitlements differ; an unavailable optional API does not erase working sleep
or climate data. A 401 is a sign-in failure and a 429 carries
`EightSleepError.retryAfterSeconds`. Other provider errors are sanitized.

Temperature **levels run from -100 to 100** and are not Celsius or Fahrenheit.
The device's current level is a control value, not a measured bed temperature.
Use the separately reported `bedTemperatureC`/`roomTemperatureC` measurements for
temperature charts. Base ranges are head 0–45° and feet 0–20°.

History requests cover at most a year, in 30-day windows. Provider calendar days
remain unchanged; unknown values stay `null`. In-progress reports remain marked
as processing. Original per-day report fields are retained in `night.report`.
No partner's sleep report is fetched. Presence/stage data can lag the night;
do not present it as a reliable real-time occupancy sensor.

`getSleep`, `getDailySleep`, `getHeartRate` and `getHRV` also implement the usual
`HealthDriver` contract. Prefer `getNights` for nullable fields and the full
report. A sleep fitness score is not a recovery/readiness score. Missing stages
are not invented, and no SpO₂, medical diagnosis or body temperature is inferred.

## Features kept in the Eight Sleep app

HQ/client code does not reproduce Eight Sleep's proprietary Autopilot algorithms,
Sleep Agent, Health Check diagnostic alerts, pregnancy/hot-flash modes, snoring
mitigation algorithms, account subscriptions, warranty, firmware updates, Wi-Fi
setup or initial installation. Smart-schedule preferences and the base's
reported snore-mitigation state are exposed, rather than claiming access to
those underlying algorithms. The former routines API has been retired:
current/next bedtime schedules can be read, but bedtime routine editing is not
advertised. Use the Eight Sleep app for those features.

This implementation is based on the observed API documented in the
[MIT-licensed Eight Sleep integration](https://github.com/lukas-clarke/eight_sleep)
and Eight Sleep's own [Autopilot description](https://www.eightsleep.com/autopilot/).
Hardware-specific behavior, particularly Pod 5/6 accessories, still needs
validation against a physical Pod. No sponsorship or official partnership is
implied.
