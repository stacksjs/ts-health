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
