import type { DailyHydration, DateRangeOptions, HealthPlatformType, HydrationSample, WaterIntakeInput } from './types'

/** LARQ's app writes dietary-water samples; other apps' water is not bottle intake. */
export function isLarqSource(sourceName: string): boolean {
  return /^larq(?:\b|$)/i.test(sourceName.trim())
}

/** HealthKit exports use mL, L or US fluid ounces. Unknown units stay unknown. */
export function waterVolumeMl(value: number | string, unit: string): number | null {
  if (typeof value === 'string' && !value.trim()) return null
  const amount = Number(value)
  const factor = { ml: 1, l: 1000, fl_oz_us: 29.5735295625, fl_oz: 29.5735295625 }[unit.toLowerCase()] as number | undefined
  if (!factor || !Number.isFinite(amount) || amount <= 0) return null
  return Math.round(amount * factor * 1000) / 1000
}

/** Source filtering, date filtering and stable identities shared by importers. */
export function normalizeWaterIntake(inputs: readonly WaterIntakeInput[], options?: DateRangeOptions, source: HealthPlatformType = 'apple_health'): HydrationSample[] {
  const seen = new Set<string>()
  const out: HydrationSample[] = []
  for (const input of inputs) {
    if (source === 'larq' && !isLarqSource(input.sourceName)) continue
    const volumeMl = waterVolumeMl(input.value, input.unit)
    const day = input.startDate.slice(0, 10)
    const instant = Date.parse(input.startDate)
    if (volumeMl === null || !Number.isFinite(instant) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
    if (options?.startDate && day < options.startDate) continue
    if (options?.endDate && day > options.endDate) continue
    const timestamp = new Date(instant).toISOString()
    const id = input.id || JSON.stringify([timestamp, input.sourceName, volumeMl])
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, day, timestamp, volumeMl, source, sourceName: input.sourceName })
  }
  return out.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

export function dailyHydration(samples: readonly HydrationSample[]): DailyHydration[] {
  const days = new Map<string, DailyHydration>()
  for (const sample of samples) {
    const key = `${sample.source}:${sample.day}`
    const day = days.get(key) || { day: sample.day, volumeMl: 0, samples: 0, source: sample.source }
    day.volumeMl += sample.volumeMl
    day.samples++
    days.set(key, day)
  }
  return [...days.values()].map(day => ({ ...day, volumeMl: Math.round(day.volumeMl * 1000) / 1000 })).sort((a, b) => a.day.localeCompare(b.day))
}
