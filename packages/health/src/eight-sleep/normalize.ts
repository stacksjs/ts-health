import type { SleepStage, SleepStageType } from '../types'
import type { EightSleepNight, EightSleepPoint } from './types'

/** Missing values, including the provider's literal "None", stay unknown. */
export function eightNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean' || typeof value === 'object') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
export function eightInstant(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (value === '' || value === 'None') return null
  const date = new Date(typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}
function nonnegative(value: unknown): number | null {
  const number = eightNumber(value)
  return number !== null && number >= 0 ? number : null
}
function score(value: unknown): number | null {
  const number = eightNumber(value)
  return number !== null && number >= 0 && number <= 100 ? number : null
}
function positive(value: unknown): number | null {
  const number = eightNumber(value)
  return number !== null && number > 0 ? number : null
}
function average(points: EightSleepPoint[]): number | null {
  return points.length ? points.reduce((sum, point) => sum + point.value, 0) / points.length : null
}
function series(sessions: any[], key: string): EightSleepPoint[] {
  const points = new Map<string, number>()
  for (const session of sessions) {
    for (const tuple of Array.isArray(session?.timeseries?.[key]) ? session.timeseries[key] : []) {
      if (!Array.isArray(tuple)) continue
      const timestamp = eightInstant(tuple[0])
      const value = eightNumber(tuple[1])
      if (timestamp && value !== null && (!/heartRate|hrv|respiratoryRate/.test(key) || value > 0)) points.set(timestamp, value)
    }
  }
  return [...points].sort(([a], [b]) => a.localeCompare(b)).map(([timestamp, value]) => ({ timestamp, value }))
}

/** Preserve the provider's calendar day, stages, naps and biometrics without synthesizing readiness. */
export function normalizeEightSleepNight(report: any): EightSleepNight | null {
  if (!report || typeof report !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(String(report.day))) return null
  const dayDate = new Date(`${report.day}T00:00:00Z`)
  if (!Number.isFinite(dayDate.getTime()) || dayDate.toISOString().slice(0, 10) !== report.day) return null
  const sessions = Array.isArray(report.sessions) ? report.sessions : []
  const quality = report.sleepQualityScore ?? {}
  const routine = report.sleepRoutineScore ?? {}
  const samples = {
    heartRate: series(sessions, 'heartRate'), hrv: series(sessions, 'hrv'), respiratoryRate: series(sessions, 'respiratoryRate'),
    bedTemperatureC: series(sessions, 'tempBedC'), roomTemperatureC: series(sessions, 'tempRoomC'),
  }
  const stages: SleepStage[] = []
  const known = new Set(['awake', 'light', 'deep', 'rem'])
  for (const session of sessions) {
    for (const stage of Array.isArray(session?.stages) ? session.stages : []) {
      const startTime = eightInstant(stage.start ?? stage.startTime)
      const endTime = eightInstant(stage.end ?? stage.endTime)
      if (!startTime || !endTime || endTime <= startTime) continue
      const name = String(stage.stage ?? '').toLowerCase()
      stages.push({ stage: known.has(name) ? name as SleepStageType : 'unknown', startTime, endTime, duration: (Date.parse(endTime) - Date.parse(startTime)) / 1000 })
    }
  }
  stages.sort((a, b) => a.startTime.localeCompare(b.startTime))
  const sleepSeconds = nonnegative(report.sleepDuration)
  const bedSeconds = nonnegative(report.presenceDuration)
  return {
    day: report.day, processing: report.processing === true || sessions.some((session: any) => session?.processing === true),
    score: score(report.score), fitnessScore: score(report.sleepFitnessScore?.total), qualityScore: score(quality.total), routineScore: score(routine.total),
    sleepSeconds, bedSeconds, lightSeconds: nonnegative(report.lightDuration), deepSeconds: nonnegative(report.deepDuration), remSeconds: nonnegative(report.remDuration),
    awakeSeconds: nonnegative(report.awakeDuration) ?? (bedSeconds !== null && sleepSeconds !== null && bedSeconds >= sleepSeconds ? bedSeconds - sleepSeconds : null),
    latencySeconds: nonnegative(routine.latencyAsleepSeconds?.current ?? report.latencyAsleep),
    efficiency: bedSeconds !== null && bedSeconds > 0 && sleepSeconds !== null && sleepSeconds <= bedSeconds ? sleepSeconds / bedSeconds * 100 : null,
    bedtime: eightInstant(report.presenceStart) ?? eightInstant(sessions[0]?.presenceStart),
    wakeTime: eightInstant(report.presenceEnd) ?? eightInstant(sessions.at(-1)?.presenceEnd),
    heartRate: positive(quality.heartRate?.average) ?? average(samples.heartRate),
    restingHeartRate: positive(quality.heartRate?.min),
    hrv: positive(quality.hrv?.average ?? quality.hrv?.current) ?? average(samples.hrv),
    respiratoryRate: positive(quality.respiratoryRate?.average ?? quality.respiratoryRate?.current) ?? average(samples.respiratoryRate),
    bedTemperatureC: eightNumber(quality.tempBedC?.average) ?? average(samples.bedTemperatureC),
    roomTemperatureC: eightNumber(quality.tempRoomC?.average) ?? average(samples.roomTemperatureC),
    tossesAndTurns: nonnegative(report.tnt), stages, series: samples, report,
  }
}
