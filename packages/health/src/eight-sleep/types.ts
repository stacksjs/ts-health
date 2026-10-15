import type { DateRangeOptions, SleepStage } from '../types'

export interface EightSleepSession {
  accessToken: string
  userId: string
  expiresAt: number
}

export interface EightSleepConfig {
  email?: string
  password?: string
  /** Public companion-app OAuth client configuration; override for your own client. */
  clientId?: string
  clientSecret?: string
  session?: EightSleepSession
  timezone?: string
  /** Refuse controls/read state if the account has switched to a different Pod. Never selects a Pod implicitly. */
  expectedDeviceId?: string
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  onSession?: (session: EightSleepSession) => void | Promise<void>
}

export interface EightSleepPoint { timestamp: string, value: number }
export interface EightSleepNight {
  day: string
  processing: boolean
  score: number | null
  fitnessScore: number | null
  qualityScore: number | null
  routineScore: number | null
  sleepSeconds: number | null
  bedSeconds: number | null
  lightSeconds: number | null
  deepSeconds: number | null
  remSeconds: number | null
  awakeSeconds: number | null
  latencySeconds: number | null
  efficiency: number | null
  bedtime: string | null
  wakeTime: string | null
  heartRate: number | null
  restingHeartRate: number | null
  hrv: number | null
  respiratoryRate: number | null
  bedTemperatureC: number | null
  roomTemperatureC: number | null
  tossesAndTurns: number | null
  stages: SleepStage[]
  series: Record<'heartRate' | 'hrv' | 'respiratoryRate' | 'bedTemperatureC' | 'roomTemperatureC', EightSleepPoint[]>
  /** The signed-in sleeper's original report, including additional provider metrics. */
  report: Record<string, unknown>
}

export type EightSleepSide = 'left' | 'right' | 'solo'
export type EightSleepStage = 'bedTimeLevel' | 'initialSleepLevel' | 'finalSleepLevel'
export interface EightSleepAlarm {
  id: string
  time?: string
  enabled?: boolean
  repeat?: { enabled?: boolean, weekDays?: Record<string, boolean> }
  vibration?: { enabled?: boolean, level?: number, powerLevel?: number, pattern?: string, duration?: number }
  thermal?: { enabled?: boolean, temperature?: number, level?: number }
  snoozing?: boolean
  nextTimestamp?: string | null
  endTimestamp?: string | null
  [key: string]: unknown
}

export interface EightSleepPod {
  deviceId: string
  name: string
  side: EightSleepSide | null
  features: string[]
  hasWater: boolean | null
  needsPriming: boolean | null
  priming: boolean | null
  lastPrime: string | null
  ledBrightness: number | null
}
export interface EightSleepTemperature {
  state: string | null
  level: number | null
  deviceLevel: number | null
  schedule: Partial<Record<EightSleepStage, number>>
  /** Reported schedules, not a promise that the retired routines API can edit them. */
  bedtimeSchedules: Array<Record<string, unknown>>
}
export interface EightSleepDashboard {
  fetchedAt: string
  pod: EightSleepPod
  temperature: EightSleepTemperature
  nights: EightSleepNight[]
  alarms: EightSleepAlarm[]
  nextAlarm: EightSleepAlarm | null
  base: { headAngle: number | null, feetAngle: number | null, preset: string | null, snoreMitigation: boolean | null } | null
  pillow: { level: number | null, state: string | null } | null
  audio: { state: string | null, volume: number | null, currentTrack: unknown, tracks: Array<{ id: string, name: string }> } | null
  capabilities: Record<'temperature' | 'schedule' | 'alarms' | 'base' | 'pillow' | 'audio' | 'led' | 'priming' | 'away' | 'side', boolean>
  unavailable: string[]
}

/** Every write is explicit; reading a dashboard never switches a bed or changes a setting. */
export type EightSleepCommand =
  | { action: 'power', enabled: boolean }
  | { action: 'temperature', level: number, durationSeconds?: number }
  | { action: 'schedule', stage: EightSleepStage, level: number }
  | { action: 'side', side: EightSleepSide }
  | { action: 'away', enabled: boolean }
  | { action: 'prime' }
  | { action: 'led', level: number }
  | { action: 'base-preset', preset: 'sleep' | 'relaxing' | 'reading' }
  | { action: 'base-angle', headAngle: number, feetAngle: number }
  | { action: 'pillow-power', enabled: boolean }
  | { action: 'pillow-temperature', level: number }
  | { action: 'audio-state', state: 'Playing' | 'Paused' }
  | { action: 'audio-volume', volume: number }
  | { action: 'audio-track', trackId: string }
  | { action: 'alarm-toggle', alarmId: string, enabled: boolean }
  | { action: 'alarm-time', alarmId: string, time: string }
  | { action: 'alarm-repeat', alarmId: string, days: Array<'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'> }
  | { action: 'alarm-snooze', alarmId: string, minutes: number }
  | { action: 'alarm-dismiss', alarmId: string }
  | { action: 'alarm-create', time: string, enabled: boolean, vibration: boolean, vibrationLevel: 20 | 50 | 100, vibrationPattern: 'RISE' | 'intense', thermal: boolean, thermalLevel: number }

export type EightSleepHistoryOptions = DateRangeOptions
