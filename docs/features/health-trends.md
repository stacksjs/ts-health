# Health Trends

The `TrendAnalyzer` helps you understand how health metrics are changing over time. It provides trend direction analysis, moving averages, and anomaly detection.

## Basic Trend Analysis

Analyze whether a metric is improving, stable, or declining:

```typescript
import { createTrendAnalyzer } from 'ts-health'

const trends = createTrendAnalyzer()

const hrvData = [
  { day: '2025-01-01', value: 42 },
  { day: '2025-01-02', value: 45 },
  { day: '2025-01-03', value: 38 },
  { day: '2025-01-04', value: 48 },
  { day: '2025-01-05', value: 50 },
  { day: '2025-01-06', value: 52 },
  { day: '2025-01-07', value: 55 },
]

const trend = trends.analyzeTrend('HRV', hrvData, 7)

console.log(`Metric: ${trend.metric}`)
console.log(`Direction: ${trend.direction}`)
console.log(`Current avg: ${trend.currentAverage}`)
console.log(`Previous avg: ${trend.previousAverage}`)
console.log(`Change: ${trend.percentChange}%`)
```

### Trend Directions

| Direction | Threshold |
|-----------|-----------|
| `improving` | +5% or more change |
| `stable` | Between -5% and +5% |
| `declining` | -5% or more change |

The trend is calculated by splitting the data in half and comparing the averages of the recent half vs the older half.

## Multi-Metric Analysis

Analyze multiple metrics at once:

```typescript
const allTrends = trends.analyzeMultipleMetrics([
  { name: 'HRV', dataPoints: hrvData },
  { name: 'Resting HR', dataPoints: restingHRData },
  { name: 'Sleep Duration', dataPoints: sleepDurationData },
  { name: 'Deep Sleep %', dataPoints: deepSleepData },
], 14)

for (const t of allTrends) {
  console.log(`${t.metric}: ${t.direction} (${t.percentChange > 0 ? '+' : ''}${t.percentChange}%)`)
}
```

## Moving Average

Smooth out day-to-day variation with a rolling average:

```typescript
const smoothed = trends.calculateMovingAverage(hrvData, 7) // 7-day window

for (const point of smoothed) {
  console.log(`${point.day}: ${point.value}`)
}
```

The moving average uses a trailing window. For the first few points (before the window is full), it averages all available prior data.

## Anomaly Detection

Find data points that deviate significantly from the norm:

```typescript
const anomalies = trends.detectAnomalies(hrvData, 2) // 2 standard deviations

for (const a of anomalies) {
  console.log(`${a.day}: ${a.value} (${a.deviation > 0 ? '+' : ''}${a.deviation.toFixed(1)} std devs)`)
}
```

The `stdDevThreshold` parameter controls sensitivity:

| Threshold | Sensitivity |
|-----------|------------|
| 1.0 | High - catches ~32% of values |
| 1.5 | Medium - catches ~13% of values |
| 2.0 | Low (default) - catches ~5% of values |
| 3.0 | Very low - catches ~0.3% of values |

## Practical Examples

### Track HRV Trend from Oura

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

const trend = trends.analyzeTrend('HRV', dataPoints, 14)
console.log(`HRV is ${trend.direction} (${trend.percentChange}% change)`)
```

### Monitor Resting Heart Rate

```typescript
const sleep = await oura.getSleep({ startDate: '2025-01-01', endDate: '2025-01-14' })

const rhrPoints = sleep
  .filter(s => s.lowestHeartRate !== undefined)
  .map(s => ({ day: s.day, value: s.lowestHeartRate! }))

const rhrTrend = trends.analyzeTrend('Resting HR', rhrPoints, 14)

// For resting HR, "declining" is actually good (lower HR = more fit)
if (rhrTrend.direction === 'declining') {
  console.log('Resting HR is dropping - fitness improving!')
}
```

### Weekly Sleep Quality Dashboard

```typescript
const sleepScores = dailySleep.map(s => ({
  day: s.day,
  value: s.score,
}))

const sleepTrend = trends.analyzeTrend('Sleep Score', sleepScores, 7)
const smoothed = trends.calculateMovingAverage(sleepScores, 7)
const anomalies = trends.detectAnomalies(sleepScores, 1.5)

console.log(`Sleep trend: ${sleepTrend.direction}`)
console.log(`7-day avg: ${smoothed[smoothed.length - 1]?.value}`)
if (anomalies.length > 0) {
  console.log(`Unusual nights: ${anomalies.map(a => a.day).join(', ')}`)
}
```
