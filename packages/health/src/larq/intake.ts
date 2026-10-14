import type { HydrationSample } from '../types'
import type { LarqTofReading } from './protocol'

export interface LarqCalibrationPoint { distanceMm: number, volumeMl: number }
export interface LarqBottleProfile {
  capacityMl: 680 | 1000
  /** Explicit measuring-cup calibration for this bottle/filter combination. */
  calibration?: readonly LarqCalibrationPoint[]
}

/** Published LARQ app curve parameters, not a promise of measurement accuracy. */
export function larqVolumeMl(distance: number, profile: LarqBottleProfile): number | null {
  if (!Number.isFinite(distance) || distance < 0 || distance >= 250) return null
  if (profile.capacityMl !== 680 && profile.capacityMl !== 1000) throw new Error('Choose the physical LARQ bottle size')
  let volume: number
  if (profile.calibration) {
    const points = [...profile.calibration].sort((a, b) => a.distanceMm - b.distanceMm)
    if (points.length < 2 || points.some((point, index) => !Number.isFinite(point.distanceMm) || !Number.isFinite(point.volumeMl) || point.distanceMm < 0 || point.distanceMm >= 250 || point.volumeMl < 0 || point.volumeMl > profile.capacityMl || (index > 0 && (point.distanceMm <= points[index - 1]!.distanceMm || point.volumeMl >= points[index - 1]!.volumeMl)))) throw new Error('Calibration must decrease from full to empty')
    if (distance <= points[0]!.distanceMm) return points[0]!.volumeMl
    if (distance >= points[points.length - 1]!.distanceMm) return points[points.length - 1]!.volumeMl
    const next = points.findIndex(point => point.distanceMm >= distance)
    const a = points[next - 1]!, b = points[next]!
    volume = a.volumeMl + (b.volumeMl - a.volumeMl) * (distance - a.distanceMm) / (b.distanceMm - a.distanceMm)
  }
  else {
    const c = profile.capacityMl === 680 ? [-1.19e-6, 5.0264e-4, -0.06522747, -0.81937241, 715.15212206] : [-1.1e-6, 5.5211e-4, -0.08516349, -0.2839113, 1026.71212239]
    volume = c.reduce((value, coefficient) => value * distance + coefficient, 0)
  }
  return Math.max(0, Math.min(profile.capacityMl, volume))
}

/**
 * Recompute from a retained, deduplicated sensor history. Small sips accumulate
 * against the last counted level; refills never count as drinks. Gaps caused
 * by unreadable sensor data start a new baseline rather than inventing intake.
 */
export function larqIntake(readings: readonly LarqTofReading[], profile: LarqBottleProfile, deviceId: string, timezone = 'UTC'): HydrationSample[] {
  let baseline: number | null = null
  let previous: number | null = null
  let previousAt: number | null = null
  const out: HydrationSample[] = []
  const byTime = new Map<number, LarqTofReading>()
  for (const reading of readings) {
    if (!Number.isSafeInteger(reading.timestamp) || reading.timestamp <= 0) throw new Error('Invalid LARQ measurement timestamp')
    const old = byTime.get(reading.timestamp)
    if (old && old.distanceMm !== reading.distanceMm) throw new Error('Conflicting LARQ measurements at the same timestamp')
    byTime.set(reading.timestamp, reading)
  }
  for (const reading of [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp)) {
    const volume = larqVolumeMl(reading.distanceMm, profile)
    if (volume === null || (previousAt !== null && reading.timestamp - previousAt > 12 * 3600)) baseline = null
    previousAt = reading.timestamp
    if (volume === null) {
      previous = null
      continue
    }
    if (baseline === null || previous === null || volume - previous > 100) {
      baseline = volume
      previous = volume
      continue
    }
    const consumed = baseline - volume
    if (consumed > 15) {
      const timestamp = new Date(reading.timestamp * 1000).toISOString()
      out.push({ id: `${deviceId}:${reading.timestamp}`, timestamp, day: new Date(timestamp).toLocaleDateString('en-CA', { timeZone: timezone }), volumeMl: Math.round(consumed * 1000) / 1000, source: 'larq', sourceName: 'LARQ Bluetooth' })
      baseline = volume
    }
    else if (volume > baseline + 15) baseline = volume
    previous = volume
  }
  return out
}
