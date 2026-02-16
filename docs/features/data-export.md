# Data Export

ts-health supports exporting activity data to multiple standard formats. Convert FIT file data or device downloads to GPX, TCX, CSV, and GeoJSON for sharing, uploading to platforms, or further analysis.

## GPX (GPS Exchange Format)

Export GPS tracks for route sharing and mapping applications:

```typescript
import { parseFITFile, exportToGPX } from 'ts-health'

const activity = await parseFITFile('/path/to/run.fit')
await exportToGPX(activity, '/path/to/output.gpx')
```

GPX files include:
- GPS coordinates (latitude, longitude, elevation)
- Timestamps for each trackpoint
- Heart rate, cadence, and power extensions
- Activity metadata (name, sport type)

## TCX (Training Center XML)

Export for uploading to training platforms like Garmin Connect, Strava, or TrainingPeaks:

```typescript
import { parseFITFile, exportToTCX } from 'ts-health'

const activity = await parseFITFile('/path/to/ride.fit')
await exportToTCX(activity, '/path/to/output.tcx')
```

TCX files include:
- Lap-by-lap breakdown
- Distance, time, calories per lap
- Heart rate, cadence, power per trackpoint
- GPS coordinates
- Sport type classification

## CSV (Comma-Separated Values)

Export record-by-record data for spreadsheet analysis:

```typescript
import { parseFITFile, exportToCSV } from 'ts-health'

const activity = await parseFITFile('/path/to/activity.fit')
await exportToCSV(activity, '/path/to/output.csv')
```

CSV columns include:
- timestamp, latitude, longitude, altitude
- heart_rate, cadence, power, speed
- distance, temperature
- Any additional fields from the FIT file

## GeoJSON

Export geographic data for web mapping (Mapbox, Leaflet, Google Maps):

```typescript
import { parseFITFile, exportToGeoJSON } from 'ts-health'

const activity = await parseFITFile('/path/to/hike.fit')
await exportToGeoJSON(activity, '/path/to/output.geojson')
```

GeoJSON files include:
- LineString geometry with GPS coordinates
- Properties: sport type, distance, duration, elevation gain
- Compatible with any GeoJSON-capable mapping library

## Batch Export

Export multiple activities at once:

```typescript
import { createGarminDriver, exportToGPX, exportToCSV } from 'ts-health'

const garmin = createGarminDriver()
const devices = await garmin.detectDevices()
const data = await garmin.downloadData(devices[0], { includeActivities: true })

for (const activity of data.activities) {
  const date = activity.startTime.toISOString().slice(0, 10)
  const sport = activity.sport

  await exportToGPX(activity, `./exports/${date}-${sport}.gpx`)
  await exportToCSV(activity, `./exports/${date}-${sport}.csv`)
}

console.log(`Exported ${data.activities.length} activities`)
```

## Cloud Upload

Upload exported data to cloud platforms:

```typescript
import { parseFITFile, createStravaClient } from 'ts-health'

// Upload a FIT file directly to Strava
const strava = createStravaClient({ accessToken: 'your-strava-token' })
await strava.uploadActivity('/path/to/activity.fit')
```
