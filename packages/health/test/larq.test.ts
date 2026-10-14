import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppleHealthDriver, createLarqDriver } from '../src/drivers'
import { dailyHydration, normalizeWaterIntake, waterVolumeMl } from '../src/hydration'

const water = (sourceName: string, value: string, unit = 'mL', startDate = '2026-10-14 23:30:00 -0700') => ({ sourceName, value, unit, startDate })

describe('LARQ PureVis 2 hydration', () => {
  it('normalizes units, preserves the local day, filters other apps and deduplicates', () => {
    const samples = normalizeWaterIntake([water('LARQ', '250'), water('LARQ', '250'), water('LARQ App', '0.5', 'L'), water('Other app', '900')], undefined, 'larq')
    expect(samples).toHaveLength(2)
    expect(samples[0]!.day).toBe('2026-10-14')
    expect(samples[0]!.timestamp).toBe('2026-10-15T06:30:00.000Z')
    expect(dailyHydration(samples)).toEqual([{ day: '2026-10-14', volumeMl: 750, samples: 2, source: 'larq' }])
    expect(normalizeWaterIntake([water('LARQ', '250')], { startDate: '2026-10-15' }, 'larq')).toEqual([])
  })

  it('refuses unknown units and invalid readings', () => {
    expect(waterVolumeMl(1, 'fl_oz_us')).toBeCloseTo(29.574, 3)
    for (const value of ['', 'no', '-1', '0', 'Infinity']) expect(waterVolumeMl(value, 'mL')).toBeNull()
    expect(waterVolumeMl(250, 'kg')).toBeNull()
    expect(normalizeWaterIntake([water('LARQ', '250', 'mL', 'bad date')])).toEqual([])
  })

  it('reads self-closing and metadata-bearing records from a real XML boundary', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'larq-test-'))
    const path = join(dir, 'export.xml')
    try {
      writeFileSync(path, `<HealthData>
        <Record type="HKQuantityTypeIdentifierDietaryWater" sourceName="LARQ" unit="mL" startDate="2026-10-14 09:00:00 -0700" value="250"/>
        <Record type="HKQuantityTypeIdentifierDietaryWater" sourceName="LARQ" unit="L" startDate="2026-10-14 10:00:00 -0700" value="0.5"><MetadataEntry key="a" value="b"/></Record>
        <Record type="HKQuantityTypeIdentifierDietaryWater" sourceName="Other app" unit="mL" startDate="2026-10-14 11:00:00 -0700" value="1000"/>
      </HealthData>`)
      const larq = createLarqDriver(path)
      expect(larq.isAuthenticated()).toBe(true)
      expect([...larq.supportedMetrics]).toEqual(['hydration', 'dailyHydration'])
      expect((await larq.getDailyHydration())[0]!.volumeMl).toBe(750)
      expect((await createAppleHealthDriver(path).getDailyHydration())[0]!.volumeMl).toBe(1750)
      expect(await larq.getDailyHydration({ endDate: '2026-10-13' })).toEqual([])
    }
    finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('LARQ account cloud', () => {
  it('reads only the signed-in user, converts litres and excludes deleted and non-water events', async () => {
    const calls: Array<{ url: string, init?: RequestInit }> = []
    const fake = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.includes('signInWithPassword')) return Response.json({ idToken: 'own-token', localId: 'own-user', expiresIn: '3600' })
      return Response.json({
        a: { time: '2026-10-15T06:30:00Z', volumeInLiter: 0.68, type: 'water' },
        b: { time: '2026-10-15T07:30:00Z', volumeInLiter: 0.25, type: 'WATER' },
        c: { time: '2026-10-15T07:30:00Z', volumeInLiter: 1, type: 'coffee' },
        d: { time: '2026-10-15T07:30:00Z', volumeInLiter: 1, type: 'water', updateState: 'deleted' },
        e: { time: '2026-10-15T07:30:00Z', volumeInLiter: 1, type: 'water', dateDeleted: '2026-10-16' },
      })
    }) as unknown as typeof fetch
    const driver = createLarqDriver({ email: 'test@example.com', password: 'test-password', timezone: 'America/Los_Angeles', fetch: fake })
    expect(driver.isAuthenticated()).toBe(false)
    expect(await driver.getDailyHydration()).toEqual([
      { day: '2026-10-14', volumeMl: 680, samples: 1, source: 'larq' },
      { day: '2026-10-15', volumeMl: 250, samples: 1, source: 'larq' },
    ])
    expect(driver.isAuthenticated()).toBe(true)
    expect(new URL(calls[1]!.url).pathname).toBe('/liquidIntake/own-user.json')
    expect(new URL(calls[1]!.url).searchParams.get('auth')).toBe('own-token')
    expect(await driver.getHydration({ endDate: '2026-10-14' })).toHaveLength(1)
    expect(calls.filter(call => call.url.includes('signInWithPassword'))).toHaveLength(1)
    expect(await driver.getSleep()).toEqual([])
  })

  it('does not leak upstream errors, passwords or tokens', async () => {
    const fake = (async () => Response.json({ error: { message: 'secret-password own-token' } }, { status: 400 })) as unknown as typeof fetch
    const driver = createLarqDriver({ email: 'test@example.com', password: 'secret-password', fetch: fake })
    await expect(driver.getHydration()).rejects.toThrow('LARQ refused access')
    expect(driver.isAuthenticated()).toBe(false)
  })

  it('rejects malformed snapshots so an importer cannot erase valid history', async () => {
    let count = 0
    const fake = (async () => ++count === 1 ? Response.json({ idToken: 'token', localId: 'uid' }) : Response.json({ a: { type: 'water', time: '2026-10-14', volumeInLiter: 'bad' } })) as unknown as typeof fetch
    await expect(createLarqDriver({ email: 'a@b.com', password: 'p', fetch: fake }).getHydration()).rejects.toThrow('invalid water reading')
  })
})
