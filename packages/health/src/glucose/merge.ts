import type { CarbEntry, GlucoseReading, GlucoseSourceType, InsulinDose } from './types'

/**
 * The same sensor or pump often reaches an app twice: Dexcom's API and the
 * Dexcom app's writes to Apple Health, or Loop's Nightscout uploads and its
 * Apple Health writes. Counting both doubles insulin totals and skews time in
 * range, so overlapping sources are merged, the most direct one winning.
 */

/** Most direct first: a manufacturer's own API, then hubs, then the phone's health store, then hand entry. */
export const GLUCOSE_SOURCE_PRIORITY: readonly GlucoseSourceType[] = ['dexcom', 'libre', 'nightscout', 'tidepool', 'apple_health', 'health_connect', 'manual']

function rank(source: GlucoseSourceType, priority: readonly GlucoseSourceType[]): number {
  const index = priority.indexOf(source)
  return index === -1 ? priority.length : index
}

const ms = (iso: string): number => Date.parse(iso)

/**
 * CGM readings from several sources as one series: a reading is dropped when
 * a more direct source has one within `windowMs` (default 2.5 minutes, half a
 * five-minute sensor interval). Fingersticks are all kept: two meters never
 * report the same drop of blood.
 */
export function mergeGlucoseReadings(readings: GlucoseReading[], options: { windowMs?: number, priority?: readonly GlucoseSourceType[] } = {}): GlucoseReading[] {
  const windowMs = options.windowMs ?? 150_000
  const priority = options.priority ?? GLUCOSE_SOURCE_PRIORITY
  const cgm = readings.filter(r => r.kind === 'cgm').sort((a, b) => rank(a.source, priority) - rank(b.source, priority) || ms(a.timestamp) - ms(b.timestamp))
  const kept: GlucoseReading[] = []
  const taken: number[] = []
  for (const reading of cgm) {
    const t = ms(reading.timestamp)
    // Binary search the kept instants for a neighbour inside the window.
    let lo = 0
    let hi = taken.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (taken[mid]! < t) lo = mid + 1
      else hi = mid
    }
    const near = (lo < taken.length && taken[lo]! - t <= windowMs) || (lo > 0 && t - taken[lo - 1]! <= windowMs)
    if (near) continue
    kept.push(reading)
    taken.splice(lo, 0, t)
  }
  return [...kept, ...readings.filter(r => r.kind !== 'cgm')].sort((a, b) => ms(a.timestamp) - ms(b.timestamp))
}

/**
 * Insulin doses from several sources as one list: a bolus is the same dose
 * as another source's bolus within `windowMs` (default 2 minutes) of nearly
 * the same size; a basal segment the same as another's starting within the
 * window. The more direct source's copy stays.
 */
export function mergeInsulinDoses(doses: InsulinDose[], options: { windowMs?: number, priority?: readonly GlucoseSourceType[] } = {}): InsulinDose[] {
  const windowMs = options.windowMs ?? 120_000
  const priority = options.priority ?? GLUCOSE_SOURCE_PRIORITY
  const ordered = [...doses].sort((a, b) => rank(a.source, priority) - rank(b.source, priority))
  const kept: InsulinDose[] = []
  for (const dose of ordered) {
    const duplicate = kept.some(other => other.source !== dose.source
      && other.kind === dose.kind
      && Math.abs(ms(other.timestamp) - ms(dose.timestamp)) <= windowMs
      && (dose.kind === 'basal' || Math.abs(other.units - dose.units) <= Math.max(0.05, other.units * 0.02)))
    if (!duplicate) kept.push(dose)
  }
  return kept.sort((a, b) => ms(a.timestamp) - ms(b.timestamp))
}

/** Carb entries from several sources as one list: the same grams within `windowMs` (default 5 minutes) is one meal. */
export function mergeCarbEntries(entries: CarbEntry[], options: { windowMs?: number, priority?: readonly GlucoseSourceType[] } = {}): CarbEntry[] {
  const windowMs = options.windowMs ?? 300_000
  const priority = options.priority ?? GLUCOSE_SOURCE_PRIORITY
  const ordered = [...entries].sort((a, b) => rank(a.source, priority) - rank(b.source, priority))
  const kept: CarbEntry[] = []
  for (const entry of ordered) {
    const duplicate = kept.some(other => other.source !== entry.source && other.grams === entry.grams && Math.abs(ms(other.timestamp) - ms(entry.timestamp)) <= windowMs)
    if (!duplicate) kept.push(entry)
  }
  return kept.sort((a, b) => ms(a.timestamp) - ms(b.timestamp))
}
