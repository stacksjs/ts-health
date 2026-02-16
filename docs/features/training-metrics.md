# Training Metrics

ts-health provides comprehensive training load and performance analysis tools. Calculate TSS, Normalized Power, Intensity Factor, track long-term fitness trends with CTL/ATL/TSB, set up training zones, and predict race times.

## Training Stress Score (TSS)

TSS quantifies the training load of a workout relative to your threshold:

```typescript
import { calculateTSS } from 'ts-health'

// Calculate from a parsed FIT activity
const tss = calculateTSS(activity, { ftp: 250 })
console.log(`TSS: ${tss.toFixed(0)}`)
// ~100 TSS = 1 hour at threshold
```

## Normalized Power (NP)

NP accounts for the physiological cost of power variability:

```typescript
import { calculateNormalizedPower } from 'ts-health'

const np = calculateNormalizedPower(activity)
console.log(`NP: ${np}W`)
```

## Intensity Factor (IF)

IF is the ratio of Normalized Power to Functional Threshold Power:

```typescript
import { calculateIntensityFactor } from 'ts-health'

const iif = calculateIntensityFactor(activity, { ftp: 250 })
console.log(`IF: ${iif.toFixed(2)}`)
// 0.75 = endurance ride
// 1.00 = threshold effort
// 1.05+ = above threshold
```

## Training Load Tracking (CTL/ATL/TSB)

Track long-term fitness, short-term fatigue, and form:

```typescript
import { TrainingLoadCalculator } from 'ts-health'

const calculator = new TrainingLoadCalculator()

// Add daily TSS values
const dailyTSS = [
  { day: '2025-01-01', tss: 85 },
  { day: '2025-01-02', tss: 0 },
  { day: '2025-01-03', tss: 120 },
  { day: '2025-01-04', tss: 45 },
  // ...
]

const load = calculator.calculateTrainingLoad(dailyTSS)

console.log(`CTL (Fitness): ${load.ctl.toFixed(1)}`)   // Chronic Training Load - 42-day average
console.log(`ATL (Fatigue): ${load.atl.toFixed(1)}`)   // Acute Training Load - 7-day average
console.log(`TSB (Form):    ${load.tsb.toFixed(1)}`)   // Training Stress Balance (CTL - ATL)
// TSB > 0: Fresh, ready to race
// TSB < -20: Accumulated fatigue, risk of overtraining
```

## Zone Calculator

Calculate heart rate and power training zones:

```typescript
import { ZoneCalculator } from 'ts-health'

const zones = new ZoneCalculator({
  maxHR: 185,
  restingHR: 50,
  ftp: 250,
})

// Heart rate zones
const hrZones = zones.getHRZones()
for (const zone of hrZones) {
  console.log(`Zone ${zone.number} (${zone.name}): ${zone.low}-${zone.high} bpm`)
}
// Zone 1 (Recovery): 100-120 bpm
// Zone 2 (Aerobic): 120-140 bpm
// Zone 3 (Tempo): 140-155 bpm
// Zone 4 (Threshold): 155-170 bpm
// Zone 5 (VO2max): 170-185 bpm

// Power zones
const powerZones = zones.getPowerZones()
for (const zone of powerZones) {
  console.log(`Zone ${zone.number} (${zone.name}): ${zone.low}-${zone.high}W`)
}
```

## Race Predictor

Predict race times based on recent performances:

```typescript
import { RacePredictor } from 'ts-health'

const predictor = new RacePredictor()

// Predict from a known performance
const predictions = predictor.predictFromPerformance(5000, 20 * 60) // 5K in 20:00

console.log(`5K:       ${formatTime(predictions['5k'])}`)
console.log(`10K:      ${formatTime(predictions['10k'])}`)
console.log(`Half:     ${formatTime(predictions.halfMarathon)}`)
console.log(`Marathon: ${formatTime(predictions.marathon)}`)

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`
}
```

## Combining with Health Data

Use training metrics alongside health platform data for complete analysis:

```typescript
import {
  createOuraDriver,
  createReadinessAnalyzer,
  calculateTSS,
  parseFITFile,
} from 'ts-health'

// Training load from today's workout
const activity = await parseFITFile('/path/to/todays-ride.fit')
const tss = calculateTSS(activity, { ftp: 250 })

// Recovery status from Oura
const oura = createOuraDriver('your-token')
const analyzer = createReadinessAnalyzer()
const range = { startDate: '2025-01-01', endDate: '2025-01-14' }

const [sleep, readiness, hrv, dailyActivity] = await Promise.all([
  oura.getSleep(range),
  oura.getReadiness(range),
  oura.getHRV(range),
  oura.getDailyActivity(range),
])

const result = analyzer.calculateTrainingReadiness({
  sleep,
  readiness,
  hrv,
  activity: dailyActivity,
})

console.log(`Today's TSS: ${tss.toFixed(0)}`)
console.log(`Readiness: ${result.score}/100 — ${result.recommendation}`)
```

## Metrics Reference

| Metric | Formula | Description |
|--------|---------|-------------|
| **TSS** | (duration × NP × IF) / (FTP × 3600) × 100 | Training load per session |
| **NP** | 4th root of average of rolling 30s power^4 | Physiological cost of effort |
| **IF** | NP / FTP | Intensity relative to threshold |
| **CTL** | Exponentially weighted avg (42-day) of daily TSS | Long-term fitness |
| **ATL** | Exponentially weighted avg (7-day) of daily TSS | Short-term fatigue |
| **TSB** | CTL - ATL | Freshness / form |
