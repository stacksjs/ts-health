# FIT File Parsing

ts-health includes a binary FIT (Flexible and Interoperable Data Transfer) protocol parser for reading activity files from any fitness device. FIT is the standard format used by Garmin, Wahoo, Stages, and many other manufacturers.

## Basic Usage

```typescript
import { parseFITFile, parseFIT } from 'ts-health'

// Parse a FIT file from disk
const activity = await parseFITFile('/path/to/activity.fit')
console.log(`Sport: ${activity.sport}`)
console.log(`Duration: ${activity.totalTimerTime}s`)
console.log(`Distance: ${(activity.totalDistance / 1000).toFixed(2)}km`)

// Or parse from a Buffer/ArrayBuffer
const buffer = await Bun.file('/path/to/activity.fit').arrayBuffer()
const result = parseFIT(buffer)
```

## Activity Data

FIT activity files contain rich data about workouts:

```typescript
const activity = await parseFITFile('/path/to/ride.fit')

// Session summary
console.log(`Sport: ${activity.sport} / ${activity.subSport}`)
console.log(`Total time: ${activity.totalTimerTime}s`)
console.log(`Distance: ${activity.totalDistance}m`)
console.log(`Calories: ${activity.totalCalories}`)
console.log(`Avg HR: ${activity.avgHeartRate}bpm`)
console.log(`Max HR: ${activity.maxHeartRate}bpm`)
console.log(`Avg Power: ${activity.avgPower}W`)

// Laps
for (const lap of activity.laps) {
  console.log(`Lap ${lap.lapNumber}: ${lap.totalDistance}m in ${lap.totalTimerTime}s`)
}

// Individual records (second-by-second data)
for (const record of activity.records) {
  console.log(`${record.timestamp}: HR=${record.heartRate} Power=${record.power} Speed=${record.speed}`)
}
```

## GPS Tracks

Access GPS coordinates from activities:

```typescript
const activity = await parseFITFile('/path/to/run.fit')

for (const record of activity.records) {
  if (record.positionLat && record.positionLong) {
    console.log(`${record.positionLat}, ${record.positionLong} | alt: ${record.altitude}m`)
  }
}
```

## Monitoring Data

FIT monitoring files contain daily health data from wearable devices:

```typescript
const monitoring = await parseFITFile('/path/to/monitoring.fit')

// Heart rate throughout the day
for (const hr of monitoring.heartRate ?? []) {
  console.log(`${hr.timestamp}: ${hr.value}bpm`)
}

// Steps
for (const steps of monitoring.steps ?? []) {
  console.log(`${steps.timestamp}: ${steps.value} steps`)
}

// Stress levels
for (const stress of monitoring.stress ?? []) {
  console.log(`${stress.timestamp}: stress level ${stress.value}`)
}
```

## Sport Types

FIT files encode sport types using standardized enumerations:

```typescript
import type { SportType, SubSportType } from 'ts-health'

// Common sport types
// running, cycling, swimming, walking, hiking, trail_running,
// strength_training, yoga, rowing, skiing, ...

// Sub-sport types provide specifics
// road, trail, track, indoor, mountain, gravel, ...
```

## Supported File Types

The FIT parser handles all standard FIT file types:

- **Activity** - Workout recordings with records, laps, sessions
- **Monitoring** - Daily health monitoring (HR, steps, stress)
- **Sleep** - Sleep stage data from devices
- **Course** - Route/course files for navigation
- **Workout** - Structured workout definitions
- **Settings** - Device configuration files

## Export Parsed Data

After parsing, export to other formats:

```typescript
import { parseFITFile, exportToGPX, exportToTCX, exportToCSV } from 'ts-health'

const activity = await parseFITFile('/path/to/activity.fit')

// Export to various formats
await exportToGPX(activity, '/path/to/output.gpx')
await exportToTCX(activity, '/path/to/output.tcx')
await exportToCSV(activity, '/path/to/output.csv')
```

## Training Metrics from FIT Data

Calculate training metrics from parsed activities:

```typescript
import { parseFITFile, calculateTSS, calculateNormalizedPower, calculateIntensityFactor } from 'ts-health'

const activity = await parseFITFile('/path/to/ride.fit')

const np = calculateNormalizedPower(activity)
const iif = calculateIntensityFactor(activity, { ftp: 250 })
const tss = calculateTSS(activity, { ftp: 250 })

console.log(`NP: ${np}W | IF: ${iif.toFixed(2)} | TSS: ${tss.toFixed(0)}`)
```
