/**
 * Diabetes data: CGM glucose, pump and pen insulin, carbs, and the pump's own
 * state. Every source is normalized to mg/dL and ISO-8601 UTC instants, so a
 * reading from Dexcom, a Libre via LibreLinkUp, a Nightscout site fed by Loop
 * or AndroidAPS, or a Tandem/Omnipod/Medtronic upload in Tidepool compares
 * directly.
 */

export type GlucoseSourceType = 'nightscout' | 'dexcom' | 'libre' | 'tidepool' | 'apple_health' | 'manual'

export type GlucoseTrend =
  | 'doubleUp'
  | 'singleUp'
  | 'fortyFiveUp'
  | 'flat'
  | 'fortyFiveDown'
  | 'singleDown'
  | 'doubleDown'
  | 'unknown'

export type GlucoseUnit = 'mg/dL' | 'mmol/L'

export interface GlucoseRange {
  /** ISO instant or Date; inclusive. */
  start: string | Date
  /** ISO instant or Date; inclusive. */
  end: string | Date
}

export interface GlucoseReading {
  /** Stable id from the source, so repeated syncs upsert rather than duplicate. */
  id: string
  /** ISO-8601 UTC instant. */
  timestamp: string
  mgdl: number
  trend: GlucoseTrend
  /** A sensor value or a fingerstick meter value. */
  kind: 'cgm' | 'meter'
  device?: string
  source: GlucoseSourceType
}

export type InsulinKind = 'bolus' | 'basal'

export type InsulinSubtype =
  | 'meal'
  | 'correction'
  | 'automatic'
  | 'extended'
  | 'scheduled'
  | 'temp'
  | 'suspend'
  | 'long_acting'

export interface InsulinDose {
  id: string
  timestamp: string
  /** Delivered units. For a basal segment, rate × duration. */
  units: number
  kind: InsulinKind
  subtype?: InsulinSubtype
  /** Basal segments only. */
  rateUnitsPerHour?: number
  durationMinutes?: number
  /** Given by a closed loop (Control-IQ, Omnipod 5, Loop, AAPS SMB) rather than the person. */
  automatic: boolean
  device?: string
  source: GlucoseSourceType
}

export interface CarbEntry {
  id: string
  timestamp: string
  grams: number
  source: GlucoseSourceType
}

/** The latest state a pump or loop app reported. Every field is optional: sources report different subsets. */
export interface PumpStatus {
  timestamp: string
  device?: string
  reservoirUnits?: number
  batteryPercent?: number
  insulinOnBoard?: number
  carbsOnBoard?: number
  suspended?: boolean
  /** Loop mode or pump status text, e.g. "closed loop", "normal", "suspended". */
  mode?: string
  source: GlucoseSourceType
}

export interface GlucoseDriver {
  readonly name: string
  readonly type: GlucoseSourceType
  getGlucose(range: GlucoseRange): Promise<GlucoseReading[]>
  getInsulin(range: GlucoseRange): Promise<InsulinDose[]>
  getCarbs(range: GlucoseRange): Promise<CarbEntry[]>
  getPumpStatus(): Promise<PumpStatus | null>
}

/** Network boundary every glucose driver takes, so tests can stand in for the provider. */
export type GlucoseFetch = (url: string, init?: RequestInit) => Promise<Response>

/** Sanitized errors: provider bodies can echo emails, tokens or patient details. */
export class GlucoseSourceError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message)
    this.name = 'GlucoseSourceError'
  }
}
