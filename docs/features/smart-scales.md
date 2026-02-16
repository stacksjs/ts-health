# Smart Scales

ts-health supports smart scales from Withings and Renpho, providing body composition data through the unified `HealthDriver` interface. Body composition data from Fitbit Aria scales and Apple Health is also available through their respective drivers.

## Supported Scales

### Withings

All Withings smart scales are supported via the Withings Health API:

- **Body** - Weight, BMI
- **Body+** - Weight, BMI, body fat %, water %, muscle mass, bone mass
- **Body Cardio** - All Body+ metrics plus heart rate, pulse wave velocity
- **Body Comp** - All Body Cardio metrics plus visceral fat, nerve health
- **Body Scan** - Full body composition with segmental analysis

### Renpho

Renpho smart scales are supported via direct API authentication:

- Weight, BMI, body fat %, muscle mass, bone mass, water %
- Visceral fat, BMR, protein %, subcutaneous fat, skeletal muscle %

### Fitbit Aria

Fitbit Aria scales (Aria, Aria 2, Aria Air) are supported through the Fitbit driver:

- Weight, BMI, body fat %

### Apple Health

Any smart scale that syncs to Apple Health (via the manufacturer's app) can have its data read through the Apple Health driver:

- Weight, BMI, body fat %, lean body mass

## Body Composition Data

The `BodyComposition` interface provides a unified type for all scale measurements:

```typescript
interface BodyComposition {
  id: string
  day: string
  timestamp: string
  weight: number              // kg
  bmi?: number
  bodyFatPercentage?: number
  fatMassWeight?: number      // kg
  leanMass?: number           // kg (fat-free mass)
  muscleMass?: number         // kg
  boneMass?: number           // kg
  waterPercentage?: number
  visceralFat?: number        // rating/level
  metabolicAge?: number
  basalMetabolicRate?: number // kcal
  proteinPercentage?: number
  subcutaneousFat?: number    // percentage
  skeletalMuscle?: number     // percentage
  heartRate?: number          // some scales measure this
  source: HealthPlatformType
}
```

## Usage

### Withings

```typescript
import { createWithingsDriver } from 'ts-health'

const withings = createWithingsDriver('your-access-token')
const range = { startDate: '2025-01-01', endDate: '2025-01-31' }

// Full body composition
const body = await withings.getBodyComposition(range)
for (const m of body) {
  console.log(`${m.day}: ${m.weight.toFixed(1)} kg`)
  console.log(`  Body fat: ${m.bodyFatPercentage?.toFixed(1)}%`)
  console.log(`  Muscle: ${m.muscleMass?.toFixed(1)} kg`)
  console.log(`  Bone: ${m.boneMass?.toFixed(1)} kg`)
  console.log(`  Water: ${m.waterPercentage?.toFixed(1)}%`)
  console.log(`  Visceral fat: ${m.visceralFat}`)
  console.log(`  BMR: ${m.basalMetabolicRate} kcal`)
}

// Simple weight measurements
const weights = await withings.getWeightMeasurements(range)
for (const w of weights) {
  console.log(`${w.day}: ${w.weight.toFixed(1)} kg | BMI: ${w.bmi?.toFixed(1)}`)
}

// Heart rate (Body Cardio, Body Comp, Body Scan only)
const hr = await withings.getHeartRate(range)
```

### Renpho

```typescript
import { createRenphoDriver } from 'ts-health'

const renpho = createRenphoDriver({
  email: 'your-email@example.com',
  password: 'your-password',
})

const body = await renpho.getBodyComposition({ startDate: '2025-01-01' })
for (const m of body) {
  console.log(`${m.day}: ${m.weight.toFixed(1)} kg | BMI: ${m.bmi?.toFixed(1)}`)
  console.log(`  Body fat: ${m.bodyFatPercentage?.toFixed(1)}%`)
  console.log(`  Muscle: ${m.muscleMass?.toFixed(1)} kg`)
  console.log(`  Protein: ${m.proteinPercentage?.toFixed(1)}%`)
  console.log(`  Subcutaneous fat: ${m.subcutaneousFat?.toFixed(1)}%`)
  console.log(`  Skeletal muscle: ${m.skeletalMuscle?.toFixed(1)}%`)
  console.log(`  BMR: ${m.basalMetabolicRate} kcal`)
}
```

### Fitbit Aria

```typescript
import { createFitbitDriver } from 'ts-health'

const fitbit = createFitbitDriver('your-access-token')

// Aria scale data comes through the standard Fitbit driver
const body = await fitbit.getBodyComposition({
  startDate: '2025-01-01',
  endDate: '2025-01-31',
})

const weights = await fitbit.getWeightMeasurements({
  startDate: '2025-01-01',
  endDate: '2025-01-31',
})
```

### Apple Health

```typescript
import { createAppleHealthDriver } from 'ts-health'

const apple = createAppleHealthDriver('/path/to/export.xml')

// Reads weight, BMI, body fat %, lean body mass from Apple Health export
const body = await apple.getBodyComposition({ startDate: '2025-01-01' })
const weights = await apple.getWeightMeasurements({ startDate: '2025-01-01' })
```

## CLI

The CLI provides `weight` and `body` commands for viewing scale data:

```bash
# View weight history
health weight --driver withings --token YOUR_TOKEN --days 30
health weight --driver renpho --email user@example.com --password pass123

# View full body composition
health body --driver withings --token YOUR_TOKEN --days 30
health body --driver renpho --email user@example.com --password pass123

# Track weight trends over time
health trends --driver withings --token YOUR_TOKEN --days 90 --metrics weight

# Export body composition data as JSON
health body --driver withings --token YOUR_TOKEN --days 90 --format json --output ./body-data.json

# Compare this month vs last month
health compare --driver withings --token YOUR_TOKEN --days 30
```

## Platform Setup

### Withings

1. Create an account at [Withings Developer Portal](https://developer.withings.com/)
2. Register an application to get OAuth 2.0 credentials
3. Complete the OAuth flow to obtain an access token
4. Use with `createWithingsDriver(accessToken)`

### Renpho

1. Use your existing Renpho account credentials (the same email and password you use in the Renpho app)
2. Use with `createRenphoDriver({ email: '...', password: '...' })`

## Metrics Comparison

| Metric | Withings | Renpho | Fitbit Aria | Apple Health |
|--------|----------|--------|-------------|-------------|
| Weight | Yes | Yes | Yes | Yes |
| BMI | Yes | Yes | Yes | Yes |
| Body Fat % | Yes | Yes | Yes | Yes |
| Fat Mass | Yes | - | - | - |
| Lean Mass | Yes | - | - | Yes |
| Muscle Mass | Yes | Yes | - | - |
| Bone Mass | Yes | Yes | - | - |
| Water % | Yes | Yes | - | - |
| Visceral Fat | Yes | Yes | - | - |
| BMR | Yes | Yes | - | - |
| Protein % | - | Yes | - | - |
| Subcutaneous Fat | - | Yes | - | - |
| Skeletal Muscle % | - | Yes | - | - |
| Heart Rate | Yes* | - | - | - |

\* Body Cardio, Body Comp, and Body Scan models only.

## Combining Scale Data with Health Metrics

Smart scale data integrates naturally with the rest of ts-health:

```typescript
import {
  createOuraDriver,
  createWithingsDriver,
  createTrendAnalyzer,
} from 'ts-health'

const oura = createOuraDriver('oura-token')
const withings = createWithingsDriver('withings-token')
const trends = createTrendAnalyzer()

const range = { startDate: '2025-01-01', endDate: '2025-03-31' }

// Get health + weight data from different devices
const [sleep, activity, weights] = await Promise.all([
  oura.getSleep(range),
  oura.getDailyActivity(range),
  withings.getWeightMeasurements(range),
])

// Analyze weight trend alongside sleep and activity
const results = trends.analyzeMultipleMetrics([
  {
    name: 'Weight',
    dataPoints: weights.map(w => ({ day: w.day, value: w.weight })),
  },
  {
    name: 'Sleep Duration',
    dataPoints: sleep.map(s => ({
      day: s.day,
      value: s.totalSleepDuration / 3600,
    })),
  },
  {
    name: 'Steps',
    dataPoints: activity.map(a => ({ day: a.day, value: a.steps })),
  },
])

for (const trend of results) {
  console.log(`${trend.metric}: ${trend.direction} (${trend.percentChange}%)`)
}
```
