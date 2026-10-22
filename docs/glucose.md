# Diabetes & Glucose

`ts-health/glucose` reads CGM glucose, pump and pen insulin, carbs and the
pump's own state, normalized to mg/dL and ISO-8601 UTC instants, so a reading
from any source compares directly. It also computes the consensus CGM metrics
and what glucose did around a workout.

| Source | What it reads | How it signs in |
|---|---|---|
| Dexcom (`createDexcomDriver`) | G6, G7, ONE and Stelo glucose with trend arrows; carbs and insulin logged in the Dexcom app | OAuth 2 (`dexcomAuthorizeUrl`, `exchangeDexcomCode`, `refreshDexcomToken`), per region |
| FreeStyle Libre (`createLibreLinkUpDriver`) | Libre 2 and 3 glucose, the last 12 hours | A LibreLinkUp follower account (unofficial API) |
| Nightscout (`createNightscoutDriver`) | Glucose, boluses, temp basals, carbs, and pump/loop status (reservoir, battery, IOB, COB) from Loop, Trio, AndroidAPS, OpenAPS, xDrip+ | Site URL plus an access token or API secret |
| Tidepool (`createTidepoolDriver`) | Tandem, Omnipod and Medtronic uploads: boluses, automated, scheduled and suspended basal, bolus-calculator carbs | Email and password |
| Apple Health / Health Connect (`fromPhoneSamples`) | Whatever a CGM, pump, loop or meter app writes to the phone | The phone's own health permission |
| Apple Health export (`createAppleHealthGlucoseDriver`) | Glucose, insulin with its basal/bolus reason, and carbs from export.xml | A file |

Every driver implements the same interface:

```ts
import { createNightscoutDriver } from 'ts-health/glucose'

const ns = createNightscoutDriver({ url: 'https://my-site.example.com', token: 'readable-abc123' })
const range = { start: '2026-10-20T00:00:00Z', end: '2026-10-21T00:00:00Z' }

const readings = await ns.getGlucose(range) // { id, timestamp, mgdl, trend, kind: 'cgm' | 'meter', device, source }
const insulin = await ns.getInsulin(range) // { id, timestamp, units, kind: 'bolus' | 'basal', subtype, rateUnitsPerHour, automatic }
const carbs = await ns.getCarbs(range) // { id, timestamp, grams }
const pump = await ns.getPumpStatus() // { reservoirUnits, batteryPercent, insulinOnBoard, carbsOnBoard, suspended, mode }
```

Each item carries the source's own id, so storing on `(source, id)` makes a
re-sync overwrite rather than duplicate.

## The phone's health store

Dexcom's and Libre's own apps, Loop, Trio, Omnipod 5 and many meters write to
Apple Health, and some apps write glucose to Android's Health Connect. Read the
samples on the phone (with Craft: `health.getSamples('bloodGlucose' |
'insulinDelivery' | 'dietaryCarbohydrates')`) and hand them to
`fromPhoneSamples`:

```ts
import { fromPhoneSamples } from 'ts-health/glucose'

const { readings, doses, carbs } = fromPhoneSamples({ glucose, insulin, carbs: meals }, 'apple_health')
```

- **Glucose** comes back in mg/dL whatever unit the source used. A source that
  writes every few minutes is a CGM (`kind: 'cgm'`), anything sparser a
  fingerstick meter. Health stores no trend arrow.
- **Insulin** uses HealthKit's reason to tell basal from bolus. A basal sample
  spans its segment, so its rate is units over that time; basal written by a
  closed loop or automated pump counts as `automatic`. Health Connect has no
  insulin type.
- **Own writes** (`ownApp: true`, such as meals the reading app logged itself)
  are left out unless `includeOwnApp` is set.

## Apple Health export

```ts
import { createAppleHealthGlucoseDriver } from 'ts-health/glucose'

const exported = createAppleHealthGlucoseDriver('/path/to/export.xml') // or { xml }
const readings = await exported.getGlucose({ start: '2026-01-01T00:00:00Z', end: new Date() })
```

An export has no sample UUIDs, so each id is a hash of the record's type,
source, times and value: the same record in a later export keeps its id.

## Metrics

```ts
import { exerciseGlucose, glucoseStats, insulinTotals, preExerciseCheck } from 'ts-health/glucose'

glucoseStats(readings, { low: 70, high: 180 }) // five ranges, mean, GMI, CV, coverage (Battelino et al. 2019)
exerciseGlucose(readings, workoutStart, workoutEnd) // start/end/min/max, change, rate, lows in the hour after
preExerciseCheck(112, 'fortyFiveDown') // { band: 'below_target', carbsGrams: 15, projectedMgdl: 67 } (Riddell et al. 2017)
insulinTotals(doses) // bolus, basal, total and the share a loop gave on its own
```

These are guidance for training, not dosing advice: a person's own care plan
comes first.
