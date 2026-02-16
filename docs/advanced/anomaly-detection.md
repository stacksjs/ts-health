# Anomaly Detection

The `TrendAnalyzer` includes anomaly detection that identifies data points significantly outside your normal range. This is useful for catching unusual health patterns that might indicate illness, overtraining, or data quality issues.

## How It Works

Anomaly detection uses standard deviation from the mean. A data point is flagged as anomalous if it deviates by more than the specified threshold (default: 2 standard deviations).

```typescript
import { createTrendAnalyzer } from 'ts-health'

const trends = createTrendAnalyzer()

const dataPoints = [
  { day: '2025-01-01', value: 45 },
  { day: '2025-01-02', value: 48 },
  { day: '2025-01-03', value: 42 },
  { day: '2025-01-04', value: 47 },
  { day: '2025-01-05', value: 22 }, // anomaly - unusually low
  { day: '2025-01-06', value: 44 },
  { day: '2025-01-07', value: 46 },
  { day: '2025-01-08', value: 75 }, // anomaly - unusually high
  { day: '2025-01-09', value: 43 },
  { day: '2025-01-10', value: 49 },
]

const anomalies = trends.detectAnomalies(dataPoints, 2)

for (const a of anomalies) {
  const direction = a.deviation > 0 ? 'above' : 'below'
  console.log(`${a.day}: ${a.value} (${Math.abs(a.deviation).toFixed(1)} std devs ${direction} mean)`)
}
```

Output:
```
2025-01-05: 22 (2.4 std devs below mean)
2025-01-08: 75 (2.8 std devs above mean)
```

## Sensitivity Levels

The `stdDevThreshold` parameter controls how sensitive detection is:

| Threshold | Sensitivity | Catches |
|-----------|------------|---------|
| 1.0 | Very high | ~32% of values flagged |
| 1.5 | High | ~13% of values flagged |
| 2.0 | Medium (default) | ~5% of values flagged |
| 2.5 | Low | ~1.2% of values flagged |
| 3.0 | Very low | ~0.3% of values flagged |

```typescript
// High sensitivity - catches more
const highSensitivity = trends.detectAnomalies(dataPoints, 1.5)

// Low sensitivity - only extreme outliers
const lowSensitivity = trends.detectAnomalies(dataPoints, 3.0)
```

## Practical Applications

### HRV Drop Detection

A sudden HRV drop can indicate illness onset, overtraining, or excessive stress:

```typescript
import { createOuraDriver, createTrendAnalyzer } from 'ts-health'

const oura = createOuraDriver('your-token')
const trends = createTrendAnalyzer()

const hrv = await oura.getHRV({
  startDate: '2025-01-01',
  endDate: '2025-01-14',
})

const dataPoints = hrv.map(h => ({
  day: h.timestamp.slice(0, 10),
  value: h.hrv,
}))

const anomalies = trends.detectAnomalies(dataPoints, 1.5)

const drops = anomalies.filter(a => a.deviation < 0)
if (drops.length > 0) {
  console.log('Warning: Unusual HRV drops detected:')
  for (const drop of drops) {
    console.log(`  ${drop.day}: ${drop.value}ms (${Math.abs(drop.deviation).toFixed(1)} std devs below normal)`)
  }
}
```

### Resting Heart Rate Spikes

An elevated resting heart rate is an early sign of illness or overreaching:

```typescript
const sleep = await oura.getSleep({
  startDate: '2025-01-01',
  endDate: '2025-01-14',
})

const rhrPoints = sleep
  .filter(s => s.lowestHeartRate !== undefined)
  .map(s => ({ day: s.day, value: s.lowestHeartRate! }))

const spikes = trends.detectAnomalies(rhrPoints, 2.0)
  .filter(a => a.deviation > 0) // Only above-normal values

if (spikes.length > 0) {
  console.log('Elevated resting HR detected:')
  for (const spike of spikes) {
    console.log(`  ${spike.day}: ${spike.value} bpm (+${spike.deviation.toFixed(1)} std devs)`)
  }
}
```

### Sleep Duration Outliers

Catch nights with unusually short or long sleep:

```typescript
const sleepDuration = sleep.map(s => ({
  day: s.day,
  value: s.totalSleepDuration / 3600, // hours
}))

const outliers = trends.detectAnomalies(sleepDuration, 1.5)

for (const o of outliers) {
  const label = o.deviation < 0 ? 'SHORT' : 'LONG'
  console.log(`  ${o.day}: ${o.value.toFixed(1)}h [${label}]`)
}
```

## Combining with Trend Analysis

Use anomaly detection alongside trend analysis for a complete picture:

```typescript
const trend = trends.analyzeTrend('HRV', dataPoints, 14)
const anomalies = trends.detectAnomalies(dataPoints, 2.0)
const smoothed = trends.calculateMovingAverage(dataPoints, 7)

console.log(`Trend: ${trend.direction} (${trend.percentChange}%)`)
console.log(`Anomalies: ${anomalies.length} detected`)
console.log(`Latest 7-day avg: ${smoothed[smoothed.length - 1]?.value}`)
```

## Minimum Data Requirement

Anomaly detection requires at least 5 data points to establish a meaningful baseline. With fewer data points, the function returns an empty array.
