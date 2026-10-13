# Cloud Integrations

ts-health includes cloud clients for syncing data with fitness platforms. Download activities, upload workouts, and sync training data without needing a physical device connection.

## Garmin Connect

Sync activities and health data from Garmin Connect:

```typescript
import { createGarminConnectClient } from 'ts-health'

const garminConnect = createGarminConnectClient({
  username: 'your-email@example.com',
  password: 'your-password',
})

// List recent activities
const activities = await garminConnect.getActivities({ start: 0, limit: 20 })
for (const activity of activities) {
  console.log(`${activity.activityName}: ${(activity.distance / 1000).toFixed(1)}km`)
}

// Download a FIT file
await garminConnect.downloadActivity(activityId, '/path/to/output.fit')

// Get daily summaries
const dailySummary = await garminConnect.getDailySummary('2025-01-15')
console.log(`Steps: ${dailySummary.totalSteps}`)
console.log(`Calories: ${dailySummary.totalKilocalories}`)
```

## Strava

Upload activities and retrieve data from Strava:

```typescript
import { createStravaClient } from 'ts-health'

const strava = createStravaClient({
  accessToken: 'your-strava-oauth-token',
})

// Upload a FIT file
await strava.uploadActivity('/path/to/activity.fit')

// Get athlete profile
const athlete = await strava.getAthlete()
console.log(`${athlete.firstname} ${athlete.lastname}`)

// List activities
const activities = await strava.getActivities({ page: 1, perPage: 30 })
for (const activity of activities) {
  console.log(`${activity.name}: ${(activity.distance / 1000).toFixed(1)}km`)
}
```

## TrainingPeaks

Sync with TrainingPeaks for structured training plans and workout analysis:

```typescript
import { createTrainingPeaksClient } from 'ts-health'

const tp = createTrainingPeaksClient({
  accessToken: 'your-trainingpeaks-token',
})

// Get planned workouts
const workouts = await tp.getWorkouts({ startDate: '2025-01-01', endDate: '2025-01-07' })
for (const workout of workouts) {
  console.log(`${workout.date}: ${workout.title} — ${workout.description}`)
}

// Upload a completed workout
await tp.uploadWorkout('/path/to/activity.fit')
```

## Combined Cloud + Device Workflow

Download from one platform, analyze, and upload to another:

```typescript
import {
  createGarminConnectClient,
  createStravaClient,
  parseFITFile,
  calculateTSS,
} from 'ts-health'

// Download from Garmin Connect
const garmin = createGarminConnectClient({ username: '...', password: '...' })
const activities = await garmin.getActivities({ start: 0, limit: 5 })

for (const activity of activities) {
  // Download FIT file
  const fitPath = `/tmp/${activity.activityId}.fit`
  await garmin.downloadActivity(activity.activityId, fitPath)

  // Analyze
  const parsed = await parseFITFile(fitPath)
  const tss = calculateTSS(parsed, { ftp: 250 })
  console.log(`${activity.activityName}: TSS ${tss.toFixed(0)}`)

  // Upload to Strava
  const strava = createStravaClient({ accessToken: '...' })
  await strava.uploadActivity(fitPath)
}
```

## Platform Setup

### Garmin Connect

Use your Garmin Connect account credentials. No API key required for personal use.

### Strava

1. Register at [Strava Developer Portal](https://developers.strava.com/)
2. Create an OAuth 2.0 application
3. Complete the OAuth flow to get an access token

### TrainingPeaks

1. Contact TrainingPeaks for API access
2. Complete the OAuth flow to get an access token

## Polar, Suunto, COROS and Wahoo

The watch makers' own clouds have a driver each, importable on their own from `ts-health/device-clouds` (no FIT parser or USB drivers come with it). Every driver lists recorded activities and downloads the original `.fit` behind each one, and reads the daily values the maker offers.

| Provider | Access | Activities | Daily values | Webhook proof |
|---|---|---|---|---|
| Polar AccessLink v3 | Any registered client at admin.polaraccesslink.com | Last 30 days (`/v3/exercises`) | Sleep with Polar's score, Nightly Recharge HRV, steps, continuous heart rate | `Polar-Webhook-Signature` (HMAC-SHA256) |
| Suunto Cloud API | Partner program, then an API Zone subscription key | `/v3/workouts` + `/v3/workouts/{key}/fit` | Sleep with score and HRV, steps, energy | `X-HMAC-SHA256-Signature` (HMAC-SHA256) |
| COROS Open API | Partner agreement with COROS | `/v2/coros/sport/list` + `fitUrl` | Steps, resting heart rate, HRV, sleep window | `Client` and `Secret` headers |
| Wahoo Cloud API | Approved app (sandbox, then production) | `/v1/workouts` + the summary's file URL | None | `webhook_token` in the body |

```typescript
import {
  createPolarAccessLinkDriver,
  deviceAuthorizeUrl,
  exchangeDeviceCode,
  parseDeviceWebhook,
  verifyDeviceWebhook,
} from 'ts-health/device-clouds'

const client = { clientId, clientSecret, redirectUri: 'https://example.com/polar/callback' }

// 1. Send the person to Polar, then trade the code from the redirect.
const url = deviceAuthorizeUrl('polar', client, state)
const tokens = await exchangeDeviceCode('polar', client, code)

// 2. Polar shares data only with registered users: once, after connecting.
const polar = createPolarAccessLinkDriver(tokens.accessToken, { userId: tokens.providerUserId })
await polar.registerUser('your-own-id-for-them')

// 3. Activities and their original recordings.
for (const activity of await polar.listActivities({ startDate: '2026-10-01' })) {
  const file = await polar.downloadActivityFile(activity) // { bytes, filename, format: 'fit' }
}

// 4. A webhook: check it came from Polar, then see whose data changed.
if (verifyDeviceWebhook('polar', rawBody, request.headers, { signatureSecret }))
  console.log(parseDeviceWebhook('polar', rawBody)?.providerUserIds)
```

`refreshDeviceToken` keeps Suunto, COROS and Wahoo tokens alive (Polar's do not expire). COROS extends the current token rather than issuing a new one, so pass it in. Errors are typed: `DeviceCloudRateLimitError` (with `retryAfterSeconds`) means stop and try later, `DeviceCloudAuthError` means the person has to connect again.
