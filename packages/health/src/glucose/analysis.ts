import type { GlucoseReading, GlucoseTrend, InsulinDose } from './types'
import { trendRate } from './units'

/**
 * CGM metrics from the international consensus on time in range
 * (Battelino et al., Diabetes Care 2019): the five ranges, mean glucose,
 * the glucose management indicator (GMI) and the coefficient of variation.
 */

export interface GlucoseTargets {
  /** Lower bound of the target range, mg/dL. Consensus: 70. */
  low: number
  /** Upper bound of the target range, mg/dL. Consensus: 180. */
  high: number
}

export const CONSENSUS_TARGETS: Readonly<GlucoseTargets> = { low: 70, high: 180 }

/** Consensus goals for most adults with type 1 or type 2 diabetes. */
export const CONSENSUS_GOALS: Readonly<{ inRange: number, below: number, veryLow: number, above: number, veryHigh: number, cv: number }> = {
  inRange: 70,
  below: 4,
  veryLow: 1,
  above: 25,
  veryHigh: 5,
  cv: 36,
}

export interface GlucoseStats {
  readings: number
  /** Share of the period the sensor reported, 0-100, against its own cadence. */
  coveragePercent: number
  meanMgdl: number | null
  sdMgdl: number | null
  /** Coefficient of variation; 36% or lower counts as stable. */
  cvPercent: number | null
  /** Glucose management indicator, an A1c estimate from mean glucose: 3.31 + 0.02392 × mean. */
  gmiPercent: number | null
  /** Percent of readings: below 54, 54 to below low, low-high, above high to 250, above 250. */
  ranges: { veryLow: number, low: number, inRange: number, high: number, veryHigh: number }
  /** 70-140 mg/dL, the tighter range newer studies report. */
  tightRangePercent: number | null
  minMgdl: number | null
  maxMgdl: number | null
}

const round1 = (value: number): number => Math.round(value * 10) / 10

/** Typical sensor cadence in minutes (5 for Dexcom, 1 for Libre 3, 15 for Libre 2 history). */
export function sensorCadenceMinutes(readings: GlucoseReading[]): number {
  const times = readings.filter(r => r.kind === 'cgm').map(r => Date.parse(r.timestamp)).sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < times.length; i++) {
    const gap = (times[i]! - times[i - 1]!) / 60_000
    if (gap > 0.5 && gap < 30) gaps.push(gap)
  }
  if (!gaps.length) return 5
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]!
}

export function glucoseStats(readings: GlucoseReading[], targets: GlucoseTargets = CONSENSUS_TARGETS, periodMinutes?: number): GlucoseStats {
  const cgm = readings.filter(r => r.kind === 'cgm')
  const values = cgm.map(r => r.mgdl)
  const n = values.length
  const empty = { veryLow: 0, low: 0, inRange: 0, high: 0, veryHigh: 0 }
  if (!n)
    return { readings: 0, coveragePercent: 0, meanMgdl: null, sdMgdl: null, cvPercent: null, gmiPercent: null, ranges: empty, tightRangePercent: null, minMgdl: null, maxMgdl: null }

  const mean = values.reduce((sum, v) => sum + v, 0) / n
  const sd = n > 1 ? Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1)) : 0
  const counts = { ...empty }
  let tight = 0
  for (const v of values) {
    if (v < 54) counts.veryLow++
    else if (v < targets.low) counts.low++
    else if (v <= targets.high) counts.inRange++
    else if (v <= 250) counts.high++
    else counts.veryHigh++
    if (v >= 70 && v <= 140) tight++
  }
  const pct = (count: number): number => round1(count / n * 100)
  const times = cgm.map(r => Date.parse(r.timestamp))
  const span = periodMinutes ?? (Math.max(...times) - Math.min(...times)) / 60_000 + sensorCadenceMinutes(cgm)
  const expected = Math.max(1, span / sensorCadenceMinutes(cgm))
  return {
    readings: n,
    coveragePercent: Math.min(100, round1(n / expected * 100)),
    meanMgdl: Math.round(mean),
    sdMgdl: Math.round(sd),
    cvPercent: mean ? round1(sd / mean * 100) : null,
    gmiPercent: round1(3.31 + 0.02392 * mean),
    ranges: { veryLow: pct(counts.veryLow), low: pct(counts.low), inRange: pct(counts.inRange), high: pct(counts.high), veryHigh: pct(counts.veryHigh) },
    tightRangePercent: pct(tight),
    minMgdl: Math.min(...values),
    maxMgdl: Math.max(...values),
  }
}

export interface ExerciseGlucose {
  startMgdl: number | null
  endMgdl: number | null
  minMgdl: number | null
  maxMgdl: number | null
  /** End minus start. */
  changeMgdl: number | null
  /** Average rate across the session, mg/dL per hour. */
  ratePerHour: number | null
  /** Readings under 70 mg/dL during the session or the hour after it. */
  lowsDuringOrAfter: number
  readings: GlucoseReading[]
}

/**
 * Glucose across a workout: the reading nearest the start (within 15 min
 * before), the one nearest the end, the lowest and highest, and any lows in
 * the hour after, when exercise-driven lows usually begin.
 */
export function exerciseGlucose(readings: GlucoseReading[], start: string | Date, end: string | Date): ExerciseGlucose {
  const s = new Date(start).getTime()
  const e = new Date(end).getTime()
  const sorted = readings.filter(r => r.kind === 'cgm').map(r => ({ r, t: Date.parse(r.timestamp) })).sort((a, b) => a.t - b.t)
  const during = sorted.filter(x => x.t >= s - 15 * 60_000 && x.t <= e + 5 * 60_000)
  const startReading = [...during].filter(x => x.t <= s + 5 * 60_000).at(-1) ?? during[0]
  const endReading = during.filter(x => x.t <= e + 5 * 60_000).at(-1)
  const values = during.map(x => x.r.mgdl)
  const change = startReading && endReading ? endReading.r.mgdl - startReading.r.mgdl : null
  const hours = startReading && endReading ? (endReading.t - startReading.t) / 3_600_000 : 0
  return {
    startMgdl: startReading?.r.mgdl ?? null,
    endMgdl: endReading?.r.mgdl ?? null,
    minMgdl: values.length ? Math.min(...values) : null,
    maxMgdl: values.length ? Math.max(...values) : null,
    changeMgdl: change,
    ratePerHour: change !== null && hours > 0.15 ? Math.round(change / hours) : null,
    lowsDuringOrAfter: sorted.filter(x => x.t >= s && x.t <= e + 60 * 60_000 && x.r.mgdl < 70).length,
    readings: during.map(x => x.r),
  }
}

export type PreExerciseBand = 'treat_low' | 'below_target' | 'borderline' | 'ready' | 'high' | 'check_ketones'

export interface PreExerciseCheck {
  band: PreExerciseBand
  mgdl: number
  /** Where glucose is heading in 30 minutes at the current arrow, when there is one. */
  projectedMgdl: number | null
  /** Suggested fast-acting carbs before starting, grams; 0 when none. */
  carbsGrams: number
}

/**
 * Starting glucose bands from the type 1 diabetes exercise consensus
 * (Riddell et al., Lancet Diabetes & Endocrinology 2017):
 * under 90 mg/dL take 10-20 g glucose and wait; 90-124 take ~10 g before
 * aerobic exercise; 126-180 ready; 182-270 ready, aerobic may lower it;
 * over 270 check ketones first. A falling arrow moves a reading down a band.
 * Guidance only: a person's own care plan always comes first.
 */
export function preExerciseCheck(mgdl: number, trend: GlucoseTrend = 'unknown'): PreExerciseCheck {
  const rate = trendRate(trend)
  const projected = rate === null ? null : Math.round(mgdl + rate * 30)
  const basis = projected !== null && projected < mgdl ? projected : mgdl
  if (mgdl < 70) return { band: 'treat_low', mgdl, projectedMgdl: projected, carbsGrams: 15 }
  if (basis < 90) return { band: 'below_target', mgdl, projectedMgdl: projected, carbsGrams: 15 }
  if (basis < 126) return { band: 'borderline', mgdl, projectedMgdl: projected, carbsGrams: 10 }
  if (mgdl > 270) return { band: 'check_ketones', mgdl, projectedMgdl: projected, carbsGrams: 0 }
  if (mgdl > 180) return { band: 'high', mgdl, projectedMgdl: projected, carbsGrams: 0 }
  return { band: 'ready', mgdl, projectedMgdl: projected, carbsGrams: 0 }
}

/** Insulin totals for a day: bolus, basal and the share a closed loop delivered on its own. */
export function insulinTotals(doses: InsulinDose[]): { bolus: number, basal: number, total: number, automaticPercent: number | null } {
  let bolus = 0
  let basal = 0
  let automatic = 0
  for (const dose of doses) {
    if (dose.kind === 'bolus') bolus += dose.units
    else basal += dose.units
    if (dose.automatic) automatic += dose.units
  }
  const total = bolus + basal
  const r = (v: number): number => Math.round(v * 10) / 10
  return { bolus: r(bolus), basal: r(basal), total: r(total), automaticPercent: total > 0 ? Math.round(automatic / total * 100) : null }
}
