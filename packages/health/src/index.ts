// Core exports
export * from './config'
export * from './types'

// Device drivers
export * from './drivers'

// Analysis tools
export * from './analysis'

// Re-export commonly used types for convenience
export type {
  HealthConfig,
  HealthOptions,
  HealthDriver,
  HealthPlatformType,
  AuthConfig,
  AuthResult,
  DateRangeOptions,
  PersonalInfo,
  SleepSession,
  DailySleepSummary,
  SleepContributors,
  SleepStage,
  DailyActivity,
  ActivityContributors,
  Workout,
  DailyReadiness,
  ReadinessContributors,
  HeartRateSample,
  DailyHeartRateSummary,
  HRVSample,
  DailyHRVSummary,
  DailySpO2,
  DailyStress,
  BodyTemperature,
  VO2MaxReading,
  DeviceInfo,
  SleepQualityScore,
  TrainingReadiness,
  RecoveryScore,
  HealthTrend,
  SleepDebtAnalysis,
} from './types'
