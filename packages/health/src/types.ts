// ============================================================================
// Configuration Types
// ============================================================================

export interface OuraConfig {
  personalAccessToken: string
  baseUrl?: string
}

export interface WhoopConfig {
  clientId: string
  clientSecret: string
  accessToken?: string
  refreshToken?: string
  baseUrl?: string
}

export interface AppleHealthConfig {
  exportPath: string
}

export interface FitbitConfig {
  clientId: string
  clientSecret: string
  accessToken?: string
  refreshToken?: string
  baseUrl?: string
}

export interface HealthConfig {
  verbose: boolean
  outputDir: string
  drivers: HealthPlatformType[]
  oura?: OuraConfig
  whoop?: WhoopConfig
  appleHealth?: AppleHealthConfig
  fitbit?: FitbitConfig
  withings?: WithingsConfig
  renpho?: RenphoConfig
}

export type HealthOptions = Partial<HealthConfig>

// ============================================================================
// Platform & Auth Types
// ============================================================================

export type HealthPlatformType = 'oura' | 'whoop' | 'apple_health' | 'fitbit' | 'garmin' | 'withings' | 'renpho'

export interface AuthConfig {
  accessToken?: string
  refreshToken?: string
  clientId?: string
  clientSecret?: string
  personalAccessToken?: string
}

export interface AuthResult {
  success: boolean
  accessToken?: string
  refreshToken?: string
  expiresAt?: Date
  error?: string
}

export interface DateRangeOptions {
  startDate?: string
  endDate?: string
}

// ============================================================================
// Driver Interface
// ============================================================================

export interface HealthDriver {
  readonly name: string
  readonly type: HealthPlatformType

  isAuthenticated(): boolean

  getSleep(options?: DateRangeOptions): Promise<SleepSession[]>
  getDailySleep(options?: DateRangeOptions): Promise<DailySleepSummary[]>
  getDailyActivity(options?: DateRangeOptions): Promise<DailyActivity[]>
  getWorkouts(options?: DateRangeOptions): Promise<Workout[]>
  getReadiness(options?: DateRangeOptions): Promise<DailyReadiness[]>
  getHeartRate(options?: DateRangeOptions): Promise<HeartRateSample[]>
  getHRV(options?: DateRangeOptions): Promise<HRVSample[]>
  getSpO2(options?: DateRangeOptions): Promise<DailySpO2[]>
  getStress(options?: DateRangeOptions): Promise<DailyStress[]>
  getBodyTemperature(options?: DateRangeOptions): Promise<BodyTemperature[]>
  getVO2Max(options?: DateRangeOptions): Promise<VO2MaxReading[]>
  getBodyComposition(options?: DateRangeOptions): Promise<BodyComposition[]>
  getWeightMeasurements(options?: DateRangeOptions): Promise<WeightMeasurement[]>
  getPersonalInfo(): Promise<PersonalInfo | null>
}

// ============================================================================
// Personal Info
// ============================================================================

export interface PersonalInfo {
  id?: string
  age?: number
  weight?: number
  height?: number
  biologicalSex?: 'male' | 'female' | 'other'
  email?: string
}

// ============================================================================
// Sleep Types
// ============================================================================

export type SleepStageType = 'awake' | 'light' | 'deep' | 'rem' | 'unknown'
export type SleepType = 'long_sleep' | 'short_sleep' | 'nap' | 'rest' | 'unknown'

export interface SleepStage {
  stage: SleepStageType
  startTime: string
  endTime: string
  duration: number
}

export interface SleepSession {
  id: string
  day: string
  bedtimeStart: string
  bedtimeEnd: string
  type: SleepType
  totalSleepDuration: number
  deepSleepDuration: number
  lightSleepDuration: number
  remSleepDuration: number
  awakeTime: number
  timeInBed: number
  latency: number
  efficiency: number
  averageHeartRate?: number
  lowestHeartRate?: number
  averageHRV?: number
  averageBreath?: number
  averageSpO2?: number
  restlessPeriods?: number
  heartRateSamples?: HeartRateSample[]
  hrvSamples?: HRVSample[]
  sleepPhases?: string
  stages: SleepStage[]
  readinessScore?: number
  source: HealthPlatformType
}

export interface DailySleepSummary {
  day: string
  score: number
  contributors: SleepContributors
  timestamp?: string
  source: HealthPlatformType
}

export interface SleepContributors {
  deepSleep?: number
  efficiency?: number
  latency?: number
  remSleep?: number
  restfulness?: number
  timing?: number
  totalSleep?: number
}

// ============================================================================
// Activity Types
// ============================================================================

export interface DailyActivity {
  day: string
  score: number
  activeCalories: number
  totalCalories: number
  steps: number
  equivalentWalkingDistance: number
  highActivityTime: number
  mediumActivityTime: number
  lowActivityTime: number
  sedentaryTime: number
  restingTime: number
  nonWearTime: number
  inactivityAlerts: number
  targetCalories: number
  targetMeters: number
  metersToTarget: number
  averageMetLevel: number
  contributors: ActivityContributors
  timestamp?: string
  source: HealthPlatformType
}

export interface ActivityContributors {
  meetDailyTargets?: number
  moveEveryHour?: number
  recoveryTime?: number
  stayActive?: number
  trainingFrequency?: number
  trainingVolume?: number
}

export interface Workout {
  id: string
  activity: string
  day: string
  startDatetime: string
  endDatetime: string
  calories?: number
  distance?: number
  intensity?: 'easy' | 'moderate' | 'hard' | 'rest'
  label?: string
  averageHeartRate?: number
  maxHeartRate?: number
  source: HealthPlatformType
}

// ============================================================================
// Readiness & Recovery Types
// ============================================================================

export interface DailyReadiness {
  day: string
  score: number
  temperatureDeviation?: number
  temperatureTrendDeviation?: number
  contributors: ReadinessContributors
  timestamp?: string
  source: HealthPlatformType
}

export interface ReadinessContributors {
  activityBalance?: number
  bodyTemperature?: number
  hrvBalance?: number
  previousDayActivity?: number
  previousNight?: number
  recoveryIndex?: number
  restingHeartRate?: number
  sleepBalance?: number
}

// ============================================================================
// Heart Rate Types
// ============================================================================

export interface HeartRateSample {
  timestamp: string
  bpm: number
  source?: string
}

export interface DailyHeartRateSummary {
  day: string
  restingHeartRate?: number
  averageHeartRate?: number
  minHeartRate?: number
  maxHeartRate?: number
  source: HealthPlatformType
}

// ============================================================================
// HRV Types
// ============================================================================

export interface HRVSample {
  timestamp: string
  hrv: number
}

export interface DailyHRVSummary {
  day: string
  averageHRV?: number
  maxHRV?: number
  minHRV?: number
  source: HealthPlatformType
}

// ============================================================================
// SpO2 Types
// ============================================================================

export interface DailySpO2 {
  day: string
  averageSpO2: number
  minSpO2?: number
  maxSpO2?: number
  source: HealthPlatformType
}

// ============================================================================
// Stress Types
// ============================================================================

export interface DailyStress {
  day: string
  stressHigh?: number
  recoveryHigh?: number
  daySummary?: 'restored' | 'normal' | 'strained'
  source: HealthPlatformType
}

// ============================================================================
// Body Temperature Types
// ============================================================================

export interface BodyTemperature {
  day: string
  deviation?: number
  trendDeviation?: number
  source: HealthPlatformType
}

// ============================================================================
// VO2 Max Types
// ============================================================================

export interface VO2MaxReading {
  day: string
  vo2Max: number
  source: HealthPlatformType
}

// ============================================================================
// Body Composition & Weight Types (Smart Scales)
// ============================================================================

export interface BodyComposition {
  id: string
  day: string
  timestamp: string
  weight: number // kg
  bmi?: number
  bodyFatPercentage?: number
  fatMassWeight?: number // kg
  leanMass?: number // kg (fat-free mass)
  muscleMass?: number // kg
  boneMass?: number // kg
  waterPercentage?: number
  visceralFat?: number // rating/level
  metabolicAge?: number
  basalMetabolicRate?: number // kcal
  proteinPercentage?: number
  subcutaneousFat?: number // percentage
  skeletalMuscle?: number // percentage
  heartRate?: number // some scales measure this
  source: HealthPlatformType
}

export interface WeightMeasurement {
  id: string
  day: string
  timestamp: string
  weight: number // kg
  bmi?: number
  source: HealthPlatformType
}

// ============================================================================
// Scale Configuration Types
// ============================================================================

export interface WithingsConfig {
  clientId: string
  clientSecret: string
  accessToken?: string
  refreshToken?: string
  baseUrl?: string
}

export interface RenphoConfig {
  email: string
  password: string
  accessToken?: string
  baseUrl?: string
}

// ============================================================================
// Ring / Device Info Types (Oura-specific but generalized)
// ============================================================================

export interface DeviceInfo {
  id: string
  type: HealthPlatformType
  model?: string
  firmwareVersion?: string
  hardwareType?: string
  color?: string
  size?: number
  setupAt?: string
}

// ============================================================================
// Oura API Response Types (raw API shapes)
// ============================================================================

export interface OuraListResponse<T> {
  data: T[]
  next_token: string | null
}

export interface OuraSleepResponse {
  id: string
  average_breath: number | null
  average_heart_rate: number | null
  average_hrv: number | null
  awake_time: number
  bedtime_end: string
  bedtime_start: string
  day: string
  deep_sleep_duration: number
  efficiency: number
  heart_rate: OuraTimeSeriesData | null
  hrv: OuraTimeSeriesData | null
  latency: number
  light_sleep_duration: number
  low_battery_alert: boolean
  lowest_heart_rate: number | null
  movement_30_sec: string | null
  period: number
  readiness: OuraReadinessData | null
  readiness_score_delta: number | null
  rem_sleep_duration: number
  restless_periods: number | null
  sleep_phase_5_min: string | null
  sleep_score_delta: number | null
  time_in_bed: number
  total_sleep_duration: number
  type: 'deleted' | 'sleep' | 'long_sleep' | 'late_nap' | 'rest'
}

export interface OuraTimeSeriesData {
  interval: number
  items: Array<number | null>
  timestamp: string
}

export interface OuraReadinessData {
  contributors: {
    activity_balance: number | null
    body_temperature: number | null
    hrv_balance: number | null
    previous_day_activity: number | null
    previous_night: number | null
    recovery_index: number | null
    resting_heart_rate: number | null
    sleep_balance: number | null
  }
  score: number | null
  temperature_deviation: number | null
  temperature_trend_deviation: number | null
}

export interface OuraDailySleepResponse {
  day: string
  score: number | null
  timestamp: string
  contributors: {
    deep_sleep: number | null
    efficiency: number | null
    latency: number | null
    rem_sleep: number | null
    restfulness: number | null
    timing: number | null
    total_sleep: number | null
  }
}

export interface OuraDailyActivityResponse {
  day: string
  score: number | null
  active_calories: number
  average_met_level: number
  contributors: {
    meet_daily_targets: number | null
    move_every_hour: number | null
    recovery_time: number | null
    stay_active: number | null
    training_frequency: number | null
    training_volume: number | null
  }
  equivalent_walking_distance: number
  high_activity_met_minutes: number
  high_activity_time: number
  inactivity_alerts: number
  low_activity_met_minutes: number
  low_activity_time: number
  medium_activity_met_minutes: number
  medium_activity_time: number
  meters_to_target: number
  non_wear_time: number
  resting_time: number
  sedentary_met_minutes: number
  sedentary_time: number
  steps: number
  target_calories: number
  target_meters: number
  total_calories: number
  timestamp: string
}

export interface OuraDailyReadinessResponse {
  day: string
  score: number | null
  temperature_deviation: number | null
  temperature_trend_deviation: number | null
  contributors: {
    activity_balance: number | null
    body_temperature: number | null
    hrv_balance: number | null
    previous_day_activity: number | null
    previous_night: number | null
    recovery_index: number | null
    resting_heart_rate: number | null
    sleep_balance: number | null
  }
  timestamp: string
}

export interface OuraHeartRateResponse {
  bpm: number
  source: string
  timestamp: string
}

export interface OuraWorkoutResponse {
  id: string
  activity: string
  calories: number | null
  day: string
  distance: number | null
  end_datetime: string
  intensity: string
  label: string | null
  source: string
  start_datetime: string
}

export interface OuraDailySpO2Response {
  day: string
  spo2_percentage: {
    average: number
  }
}

export interface OuraDailyStressResponse {
  day: string
  stress_high: number | null
  recovery_high: number | null
  day_summary: 'restored' | 'normal' | 'strained' | null
}

export interface OuraVO2MaxResponse {
  day: string
  vo2_max: number
}

export interface OuraPersonalInfoResponse {
  id: string
  age: number | null
  weight: number | null
  height: number | null
  biological_sex: string | null
  email: string | null
}

export interface OuraRingConfigurationResponse {
  id: string
  color: string | null
  design: string | null
  firmware_version: string | null
  hardware_type: string | null
  set_up_at: string | null
  size: number | null
}

// ============================================================================
// Whoop API Response Types
// ============================================================================

export interface WhoopCycle {
  id: number
  user_id: number
  created_at: string
  updated_at: string
  start: string
  end: string | null
  timezone_offset: string
  score_state: string
  score: {
    strain: number
    kilojoule: number
    average_heart_rate: number
    max_heart_rate: number
  } | null
}

export interface WhoopRecovery {
  cycle_id: number
  sleep_id: number
  user_id: number
  created_at: string
  updated_at: string
  score_state: string
  score: {
    user_calibrating: boolean
    recovery_score: number
    resting_heart_rate: number
    hrv_rmssd_milli: number
    spo2_percentage: number | null
    skin_temp_celsius: number | null
  } | null
}

export interface WhoopSleep {
  id: number
  user_id: number
  created_at: string
  updated_at: string
  start: string
  end: string
  timezone_offset: string
  nap: boolean
  score_state: string
  score: {
    stage_summary: {
      total_in_bed_time_milli: number
      total_awake_time_milli: number
      total_no_data_time_milli: number
      total_light_sleep_time_milli: number
      total_slow_wave_sleep_time_milli: number
      total_rem_sleep_time_milli: number
      sleep_cycle_count: number
      disturbance_count: number
    }
    sleep_needed: {
      baseline_milli: number
      need_from_sleep_debt_milli: number
      need_from_recent_strain_milli: number
      need_from_recent_nap_milli: number
    }
    respiratory_rate: number | null
    sleep_performance_percentage: number | null
    sleep_consistency_percentage: number | null
    sleep_efficiency_percentage: number | null
  } | null
}

export interface WhoopWorkout {
  id: number
  user_id: number
  created_at: string
  updated_at: string
  start: string
  end: string
  timezone_offset: string
  sport_id: number
  score_state: string
  score: {
    strain: number
    average_heart_rate: number
    max_heart_rate: number
    kilojoule: number
    percent_recorded: number
    distance_meter: number | null
    altitude_gain_meter: number | null
    altitude_change_meter: number | null
    zone_duration: {
      zone_zero_milli: number
      zone_one_milli: number
      zone_two_milli: number
      zone_three_milli: number
      zone_four_milli: number
      zone_five_milli: number
    }
  } | null
}

export interface WhoopBodyMeasurement {
  height_meter: number
  weight_kilogram: number
  max_heart_rate: number
}

// ============================================================================
// Withings API Response Types
// ============================================================================

export interface WithingsListResponse<T> {
  status: number
  body: {
    measuregrps?: T[]
    activities?: T[]
    series?: T[]
    more: boolean
    offset: number
  }
}

export interface WithingsMeasureGroup {
  grpid: number
  attrib: number
  date: number
  created: number
  category: number
  deviceid: string | null
  measures: WithingsMeasure[]
}

export interface WithingsMeasure {
  value: number
  type: number // 1=weight, 6=fat%, 5=fatFreeMass, 8=fatMassWeight, 76=muscleMass, 88=boneMass, 77=waterMass, 91=PWV
  unit: number // 10^unit multiplier
}

// ============================================================================
// Renpho API Response Types
// ============================================================================

export interface RenphoAuthResponse {
  status_code: string
  terminal_user_session_key: string
}

export interface RenphoMeasurement {
  id: string
  time_stamp: number
  weight: number
  bmi: number
  bodyfat: number
  water: number
  bone: number
  muscle: number
  vfal: number // visceral fat level
  bmr: number
  protein: number
  subfat: number // subcutaneous fat
  skeletal_muscle: number
}

export interface RenphoListResponse {
  status_code: string
  last_at: number
  measurements: RenphoMeasurement[]
}

// ============================================================================
// Analysis Types
// ============================================================================

export interface SleepQualityScore {
  overall: number
  durationScore: number
  efficiencyScore: number
  deepSleepScore: number
  remSleepScore: number
  latencyScore: number
  consistencyScore: number
  rating: 'excellent' | 'good' | 'fair' | 'poor'
}

export interface TrainingReadiness {
  score: number
  factors: {
    hrvStatus: number
    sleepQuality: number
    recoveryLevel: number
    restingHeartRate: number
    activityBalance: number
    sleepDebt: number
  }
  recommendation: 'go_hard' | 'moderate' | 'easy_day' | 'rest'
  details: string
}

export interface RecoveryScore {
  score: number
  status: 'fully_recovered' | 'mostly_recovered' | 'partially_recovered' | 'not_recovered'
  factors: {
    sleepScore: number
    hrvTrend: number
    restingHRTrend: number
    strainBalance: number
  }
}

export interface HealthTrend {
  metric: string
  period: number
  direction: 'improving' | 'stable' | 'declining'
  currentAverage: number
  previousAverage: number
  percentChange: number
  dataPoints: Array<{
    day: string
    value: number
  }>
}

export interface SleepDebtAnalysis {
  currentDebtMinutes: number
  weeklyAverageMinutes: number
  targetMinutes: number
  trend: 'accumulating' | 'stable' | 'recovering'
  daysToRecover: number
}
