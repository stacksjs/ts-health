# Custom Drivers

You can create custom drivers that implement the `HealthDriver` interface to add support for platforms not included in ts-health, or to wrap your own data sources.

## The HealthDriver Interface

Every driver must implement this interface:

```typescript
import type {
  HealthDriver,
  HealthPlatformType,
  DateRangeOptions,
  SleepSession,
  DailySleepSummary,
  DailyActivity,
  Workout,
  DailyReadiness,
  HeartRateSample,
  HRVSample,
  DailySpO2,
  DailyStress,
  BodyTemperature,
  VO2MaxReading,
  PersonalInfo,
} from 'ts-health'

class MyCustomDriver implements HealthDriver {
  readonly name = 'My Platform'
  readonly type: HealthPlatformType = 'garmin' // or use a custom string

  isAuthenticated(): boolean {
    // Return true if the driver is configured and ready
    return true
  }

  async getSleep(options?: DateRangeOptions): Promise<SleepSession[]> {
    // Fetch and return sleep data
    return []
  }

  async getDailySleep(options?: DateRangeOptions): Promise<DailySleepSummary[]> {
    return []
  }

  async getDailyActivity(options?: DateRangeOptions): Promise<DailyActivity[]> {
    return []
  }

  async getWorkouts(options?: DateRangeOptions): Promise<Workout[]> {
    return []
  }

  async getReadiness(options?: DateRangeOptions): Promise<DailyReadiness[]> {
    return []
  }

  async getHeartRate(options?: DateRangeOptions): Promise<HeartRateSample[]> {
    return []
  }

  async getHRV(options?: DateRangeOptions): Promise<HRVSample[]> {
    return []
  }

  async getSpO2(options?: DateRangeOptions): Promise<DailySpO2[]> {
    return []
  }

  async getStress(options?: DateRangeOptions): Promise<DailyStress[]> {
    return []
  }

  async getBodyTemperature(options?: DateRangeOptions): Promise<BodyTemperature[]> {
    return []
  }

  async getVO2Max(options?: DateRangeOptions): Promise<VO2MaxReading[]> {
    return []
  }

  async getPersonalInfo(): Promise<PersonalInfo | null> {
    return null
  }
}
```

## Example: JSON File Driver

A driver that reads health data from local JSON files:

```typescript
import { readFileSync, existsSync } from 'node:fs'
import type {
  HealthDriver,
  DateRangeOptions,
  SleepSession,
  DailySleepSummary,
  DailyActivity,
  Workout,
  DailyReadiness,
  HeartRateSample,
  HRVSample,
  DailySpO2,
  DailyStress,
  BodyTemperature,
  VO2MaxReading,
  PersonalInfo,
} from 'ts-health'

interface HealthDataFile {
  sleep?: SleepSession[]
  activity?: DailyActivity[]
  readiness?: DailyReadiness[]
  hrv?: HRVSample[]
  workouts?: Workout[]
}

export class JsonFileDriver implements HealthDriver {
  readonly name = 'JSON File'
  readonly type = 'garmin' as const

  private data: HealthDataFile = {}

  constructor(filePath: string) {
    if (existsSync(filePath)) {
      this.data = JSON.parse(readFileSync(filePath, 'utf8'))
    }
  }

  isAuthenticated(): boolean {
    return Object.keys(this.data).length > 0
  }

  private filterByDate<T extends { day: string }>(items: T[], options?: DateRangeOptions): T[] {
    return items.filter(item => {
      if (options?.startDate && item.day < options.startDate) return false
      if (options?.endDate && item.day > options.endDate) return false
      return true
    })
  }

  async getSleep(options?: DateRangeOptions): Promise<SleepSession[]> {
    return this.filterByDate(this.data.sleep ?? [], options)
  }

  async getDailySleep(options?: DateRangeOptions): Promise<DailySleepSummary[]> {
    const sleep = await this.getSleep(options)
    return sleep.map(s => ({
      day: s.day,
      score: s.efficiency,
      contributors: {},
      source: this.type,
    }))
  }

  async getDailyActivity(options?: DateRangeOptions): Promise<DailyActivity[]> {
    return this.filterByDate(this.data.activity ?? [], options)
  }

  async getWorkouts(options?: DateRangeOptions): Promise<Workout[]> {
    return this.filterByDate(this.data.workouts ?? [], options)
  }

  async getReadiness(options?: DateRangeOptions): Promise<DailyReadiness[]> {
    return this.filterByDate(this.data.readiness ?? [], options)
  }

  async getHeartRate(_options?: DateRangeOptions): Promise<HeartRateSample[]> {
    return []
  }

  async getHRV(options?: DateRangeOptions): Promise<HRVSample[]> {
    if (!this.data.hrv) return []
    return this.data.hrv.filter(h => {
      const day = h.timestamp.slice(0, 10)
      if (options?.startDate && day < options.startDate) return false
      if (options?.endDate && day > options.endDate) return false
      return true
    })
  }

  async getSpO2(_options?: DateRangeOptions): Promise<DailySpO2[]> { return [] }
  async getStress(_options?: DateRangeOptions): Promise<DailyStress[]> { return [] }
  async getBodyTemperature(_options?: DateRangeOptions): Promise<BodyTemperature[]> { return [] }
  async getVO2Max(_options?: DateRangeOptions): Promise<VO2MaxReading[]> { return [] }
  async getPersonalInfo(): Promise<PersonalInfo | null> { return null }
}
```

## Using Custom Drivers with Analyzers

Custom drivers work seamlessly with all analysis modules:

```typescript
import { createSleepAnalyzer, createReadinessAnalyzer } from 'ts-health'

const driver = new JsonFileDriver('./health-data.json')
const sleep = await driver.getSleep({ startDate: '2025-01-01' })

const sleepAnalyzer = createSleepAnalyzer()
for (const session of sleep) {
  const quality = sleepAnalyzer.scoreSleepQuality(session)
  console.log(`${session.day}: ${quality.overall}/100`)
}

const readinessAnalyzer = createReadinessAnalyzer()
const readiness = readinessAnalyzer.calculateTrainingReadiness({
  sleep,
  hrv: await driver.getHRV({ startDate: '2025-01-01' }),
})
console.log(`Readiness: ${readiness.score}/100`)
```

## Partial Implementation

You don't need to implement every method. Return empty arrays for unsupported data types. The analysis modules handle missing data gracefully by falling back to neutral scores.

## Publishing Custom Drivers

If you build a driver for a platform others would find useful, consider contributing it back to ts-health via a pull request. Follow the patterns established by the existing drivers:

1. Place the driver in `src/drivers/`
2. Implement the `HealthDriver` interface
3. Export a factory function: `createXxxDriver()`
4. Add the driver to `src/drivers/index.ts`
5. Map API responses to the shared types in the constructor/methods
