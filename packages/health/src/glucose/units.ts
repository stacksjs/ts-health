import type { GlucoseFetch, GlucoseRange, GlucoseTrend, GlucoseUnit } from './types'
import { GlucoseSourceError } from './types'

/** mg/dL per mmol/L for glucose (molar mass 180.16 g/mol). */
export const MGDL_PER_MMOL: number = 18.0182

export function mgdlToMmol(mgdl: number): number {
  return Math.round((mgdl / MGDL_PER_MMOL) * 10) / 10
}

export function mmolToMgdl(mmol: number): number {
  return Math.round(mmol * MGDL_PER_MMOL)
}

/** A reading in the person's unit: mg/dL as a whole number, mmol/L to one decimal. */
export function glucoseIn(mgdl: number, unit: GlucoseUnit): number {
  return unit === 'mmol/L' ? mgdlToMmol(mgdl) : Math.round(mgdl)
}

/** CGM sensors report 40-400 mg/dL; anything outside is a "LO"/"HI" or a fault. */
export function plausibleMgdl(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 20 && value <= 600
}

const TREND_ALIASES: Record<string, GlucoseTrend> = {
  doubleup: 'doubleUp',
  singleup: 'singleUp',
  fortyfiveup: 'fortyFiveUp',
  flat: 'flat',
  fortyfivedown: 'fortyFiveDown',
  singledown: 'singleDown',
  doubledown: 'doubleDown',
}

/** Dexcom (`singleUp`), Nightscout (`SingleUp`) and others spell the same seven arrows differently. */
export function normalizeTrend(value: unknown): GlucoseTrend {
  if (typeof value !== 'string') return 'unknown'
  return TREND_ALIASES[value.replace(/[\s_-]/g, '').toLowerCase()] ?? 'unknown'
}

const ARROWS: Record<GlucoseTrend, string> = {
  doubleUp: '⇈',
  singleUp: '↑',
  fortyFiveUp: '↗',
  flat: '→',
  fortyFiveDown: '↘',
  singleDown: '↓',
  doubleDown: '⇊',
  unknown: '',
}

export function trendArrow(trend: GlucoseTrend): string {
  return ARROWS[trend]
}

/** Approximate rate of change each arrow stands for, in mg/dL per minute (Dexcom's bands). */
export function trendRate(trend: GlucoseTrend): number | null {
  switch (trend) {
    case 'doubleUp': return 3
    case 'singleUp': return 2
    case 'fortyFiveUp': return 1.5
    case 'flat': return 0
    case 'fortyFiveDown': return -1.5
    case 'singleDown': return -2
    case 'doubleDown': return -3
    default: return null
  }
}

export function instant(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new GlucoseSourceError('Invalid date range')
  return date
}

export function rangeMs(range: GlucoseRange): { start: number, end: number } {
  const start = instant(range.start).getTime()
  const end = instant(range.end).getTime()
  if (end < start) throw new GlucoseSourceError('The range ends before it starts')
  return { start, end }
}

export function inRange(timestamp: string, range: { start: number, end: number }): boolean {
  const ms = Date.parse(timestamp)
  return ms >= range.start && ms <= range.end
}

export function toIso(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  if (typeof value !== 'string' || !value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** One request with a timeout, sanitized errors and no redirects to other hosts. */
export async function requestJson(
  fetcher: GlucoseFetch | undefined,
  provider: string,
  url: string,
  init: RequestInit = {},
): Promise<{ body: any, headers: Headers }> {
  let res: Response
  try {
    res = await (fetcher || globalThis.fetch)(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) })
  }
  catch {
    throw new GlucoseSourceError(`${provider} could not be reached; try again`)
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403)
      throw new GlucoseSourceError(`${provider} refused access; reconnect it`, res.status)
    if (res.status === 429) throw new GlucoseSourceError(`${provider} rate limit reached; try again later`, 429)
    throw new GlucoseSourceError(`${provider} request failed (${res.status})`, res.status)
  }
  try {
    const text = await res.text()
    return { body: text ? JSON.parse(text) : null, headers: res.headers }
  }
  catch {
    throw new GlucoseSourceError(`${provider} returned an unreadable response`)
  }
}

export function byTime<T extends { timestamp: string }>(a: T, b: T): number {
  return a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0
}

/** Last-seen wins per id, sorted by time. */
export function uniqueById<T extends { id: string, timestamp: string }>(items: T[]): T[] {
  return [...new Map(items.map(item => [item.id, item])).values()].sort(byTime)
}
