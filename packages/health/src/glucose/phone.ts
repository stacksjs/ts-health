import type { CarbEntry, GlucoseReading, InsulinDose } from './types'
import { plausibleMgdl, uniqueById } from './units'

/**
 * Glucose, insulin and carbs from the phone's own health store: Apple Health
 * (HealthKit) or Android's Health Connect, as Craft's `health.getSamples()`
 * answers them, or as an Apple Health export holds them. Dexcom, Libre, Loop,
 * Trio, Omnipod 5 and many meters write here, so it reaches people whose CGM
 * or pump has no cloud API of its own.
 */

export type PhoneHealthSource = 'apple_health' | 'health_connect'

/** One sample as Craft's `health.getSamples()` answers it. Times are epoch milliseconds. */
export interface PhoneHealthSample {
  id: string
  value: number
  unit: string
  startDate: number
  endDate: number
  sourceName?: string
  sourceBundleId?: string
  /** True when the reading app wrote it itself (a meal it logged): left out by default. */
  ownApp?: boolean
  deviceName?: string
  insulinReason?: 'basal' | 'bolus'
  mealTime?: string
}

export interface PhoneHealthSamples {
  glucose?: PhoneHealthSample[]
  insulin?: PhoneHealthSample[]
  carbs?: PhoneHealthSample[]
}

export interface PhoneHealthOptions {
  /** Keep what the reading app wrote itself. Default false: an app that logs meals to Health should not read them back. */
  includeOwnApp?: boolean
}

/** Apps that deliver basal on their own: a closed loop or an automated pump. */
const LOOP_SOURCES = /\b(?:loop|trio|iaps|freeaps|openaps|androidaps|aaps|omnipod ?5|control-?iq|camaps|medtronic 780|minimed 780|tandem|t:slim|ilet)\b/i

/** A source writing glucose this often is a sensor, not a fingerstick meter. */
const CGM_MAX_GAP_MS = 20 * 60_000

const MGDL_PER_MMOL = 18.0182

/** mg/dL from any unit HealthKit or Health Connect spells: mg/dL, mmol/L or HealthKit's mmol<180.15…>/L. */
export function phoneGlucoseMgdl(value: number, unit: string): number | null {
  if (!Number.isFinite(value)) return null
  const mgdl = /mmol/i.test(unit) ? value * MGDL_PER_MMOL : value
  return plausibleMgdl(mgdl) ? Math.round(mgdl) : null
}

function iso(ms: number): string | null {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** The sources that write glucose at sensor cadence: their median gap is under 20 minutes. */
function sensorSources(samples: PhoneHealthSample[]): Set<string> {
  const bySource = new Map<string, number[]>()
  for (const sample of samples) {
    const key = sample.sourceBundleId || sample.sourceName || ''
    bySource.set(key, [...(bySource.get(key) ?? []), sample.startDate])
  }
  const sensors = new Set<string>()
  for (const [key, times] of bySource) {
    times.sort((a, b) => a - b)
    const gaps = times.slice(1).map((t, i) => t - times[i]!).filter(gap => gap > 0).sort((a, b) => a - b)
    if (gaps.length >= 2 && gaps[Math.floor(gaps.length / 2)]! <= CGM_MAX_GAP_MS) sensors.add(key)
  }
  return sensors
}

/**
 * Readings, doses and carbs from phone health samples, keyed on each
 * sample's own id so a re-sync overwrites rather than duplicates.
 *
 * - Glucose: mg/dL; a source writing every few minutes is a CGM, anything
 *   sparser a fingerstick meter. Health keeps no trend arrow.
 * - Insulin: HealthKit's reason says basal or bolus. A basal sample spans its
 *   segment, so its rate is units over that time; basal from a closed loop
 *   or automated pump counts as automatic. A dose with no reason is a bolus.
 * - Carbs: grams above zero.
 */
export function fromPhoneSamples(samples: PhoneHealthSamples, source: PhoneHealthSource, options: PhoneHealthOptions = {}): { readings: GlucoseReading[], doses: InsulinDose[], carbs: CarbEntry[] } {
  const keep = (sample: PhoneHealthSample) => !!sample && typeof sample.id === 'string' && !!sample.id && (options.includeOwnApp || sample.ownApp !== true)
  const glucose = (samples.glucose ?? []).filter(keep)
  const sensors = sensorSources(glucose)

  const readings: GlucoseReading[] = []
  for (const sample of glucose) {
    const timestamp = iso(sample.startDate)
    const mgdl = phoneGlucoseMgdl(Number(sample.value), String(sample.unit || 'mg/dL'))
    if (!timestamp || mgdl === null) continue
    const cgm = sensors.has(sample.sourceBundleId || sample.sourceName || '')
    readings.push({ id: sample.id, timestamp, mgdl, trend: 'unknown', kind: cgm ? 'cgm' : 'meter', device: sample.deviceName || sample.sourceName, source })
  }

  const doses: InsulinDose[] = []
  for (const sample of (samples.insulin ?? []).filter(keep)) {
    const timestamp = iso(sample.startDate)
    const units = Number(sample.value)
    if (!timestamp || !Number.isFinite(units) || units < 0 || units > 100) continue
    const device = sample.deviceName || sample.sourceName
    if (sample.insulinReason === 'basal') {
      const minutes = (sample.endDate - sample.startDate) / 60_000
      const automatic = LOOP_SOURCES.test(`${sample.sourceName ?? ''} ${sample.sourceBundleId ?? ''}`)
      doses.push({
        id: sample.id,
        timestamp,
        units: Math.round(units * 1000) / 1000,
        kind: 'basal',
        subtype: units === 0 ? 'suspend' : automatic ? 'temp' : minutes > 0 ? 'scheduled' : 'long_acting',
        ...(minutes > 0 ? { rateUnitsPerHour: Math.round(units / minutes * 60 * 1000) / 1000, durationMinutes: Math.round(minutes * 10) / 10 } : {}),
        automatic,
        device,
        source,
      })
      continue
    }
    if (units <= 0) continue
    doses.push({ id: sample.id, timestamp, units: Math.round(units * 100) / 100, kind: 'bolus', automatic: false, device, source })
  }

  const carbs: CarbEntry[] = []
  for (const sample of (samples.carbs ?? []).filter(keep)) {
    const timestamp = iso(sample.startDate)
    const grams = Number(sample.value)
    if (!timestamp || !Number.isFinite(grams) || grams <= 0 || grams > 1000) continue
    carbs.push({ id: sample.id, timestamp, grams: Math.round(grams), source })
  }

  return { readings: uniqueById(readings), doses: uniqueById(doses), carbs: uniqueById(carbs) }
}
