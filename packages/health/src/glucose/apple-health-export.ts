import type { PhoneHealthSample } from './phone'
import type { CarbEntry, GlucoseDriver, GlucoseRange, GlucoseReading, InsulinDose, PumpStatus } from './types'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fromPhoneSamples } from './phone'
import { GlucoseSourceError } from './types'
import { inRange, rangeMs } from './units'

const TYPES = {
  HKQuantityTypeIdentifierBloodGlucose: 'glucose',
  HKQuantityTypeIdentifierInsulinDelivery: 'insulin',
  HKQuantityTypeIdentifierDietaryCarbohydrates: 'carbs',
} as const

/** Only the three diabetes record types, self-closing or with their metadata entries. */
const RECORD = /<Record\s+([^>]*?type="(HKQuantityTypeIdentifier(?:BloodGlucose|InsulinDelivery|DietaryCarbohydrates))"[^>]*?)(?:\/>|>([\s\S]*?)<\/Record>)/g

function attr(attrs: string, name: string): string {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? ''
}

/** "2026-10-14 23:30:00 -0700", as an export writes it, in epoch milliseconds. */
export function appleExportTime(value: string): number {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(value.trim())
  return Date.parse(match ? `${match[1]}T${match[2]}${match[3]}:${match[4]}` : value)
}

/**
 * The glucose, insulin and carbs in an Apple Health export (export.xml), in
 * the same shape Craft's `health.getSamples()` answers. An export has no
 * sample UUIDs, so each id is a hash of the record's type, source, times and
 * value: the same record in a later export keeps its id.
 */
export function appleExportGlucoseSamples(xml: string): { glucose: PhoneHealthSample[], insulin: PhoneHealthSample[], carbs: PhoneHealthSample[] } {
  const out = { glucose: [] as PhoneHealthSample[], insulin: [] as PhoneHealthSample[], carbs: [] as PhoneHealthSample[] }
  for (const match of xml.matchAll(RECORD)) {
    const attrs = match[1]!
    const kind = TYPES[match[2] as keyof typeof TYPES]
    const startDate = appleExportTime(attr(attrs, 'startDate'))
    const endDate = appleExportTime(attr(attrs, 'endDate')) || startDate
    const value = Number(attr(attrs, 'value'))
    if (!Number.isFinite(startDate) || !Number.isFinite(value)) continue
    const sourceName = attr(attrs, 'sourceName')
    const reason = /key="HKInsulinDeliveryReason"\s+value="(\d)"/.exec(match[3] ?? '')?.[1]
    out[kind].push({
      id: createHash('sha1').update(`${match[2]}|${sourceName}|${startDate}|${endDate}|${value}`).digest('hex').slice(0, 32),
      value,
      unit: attr(attrs, 'unit'),
      startDate,
      endDate,
      sourceName,
      deviceName: /name:([^,>]+)/.exec(attr(attrs, 'device'))?.[1]?.trim() || undefined,
      ...(reason === '1' ? { insulinReason: 'basal' as const } : reason === '2' ? { insulinReason: 'bolus' as const } : {}),
    })
  }
  return out
}

/** Glucose, insulin and carbs from an Apple Health export: a `GlucoseDriver` over export.xml. */
export class AppleHealthGlucoseDriver implements GlucoseDriver {
  readonly name: string = 'Apple Health'
  readonly type: 'apple_health' = 'apple_health'
  private parsed: ReturnType<typeof fromPhoneSamples> | null = null

  /** A path to export.xml, or its contents as `{ xml }`. */
  constructor(private input: string | { xml: string }) {}

  private all(): ReturnType<typeof fromPhoneSamples> {
    if (!this.parsed) {
      let xml: string
      if (typeof this.input === 'string') {
        if (!existsSync(this.input)) throw new GlucoseSourceError(`Apple Health export not found: ${this.input}`)
        xml = readFileSync(this.input, 'utf8')
      }
      else xml = this.input.xml
      this.parsed = fromPhoneSamples(appleExportGlucoseSamples(xml), 'apple_health', { includeOwnApp: true })
    }
    return this.parsed
  }

  async getGlucose(range: GlucoseRange): Promise<GlucoseReading[]> {
    const ms = rangeMs(range)
    return this.all().readings.filter(r => inRange(r.timestamp, ms))
  }

  async getInsulin(range: GlucoseRange): Promise<InsulinDose[]> {
    const ms = rangeMs(range)
    return this.all().doses.filter(d => inRange(d.timestamp, ms))
  }

  async getCarbs(range: GlucoseRange): Promise<CarbEntry[]> {
    const ms = rangeMs(range)
    return this.all().carbs.filter(c => inRange(c.timestamp, ms))
  }

  /** An export holds what was delivered, not the pump's state. */
  async getPumpStatus(): Promise<PumpStatus | null> {
    return null
  }
}

export function createAppleHealthGlucoseDriver(input: string | { xml: string }): AppleHealthGlucoseDriver {
  return new AppleHealthGlucoseDriver(input)
}
