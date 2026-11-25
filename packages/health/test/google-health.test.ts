import { describe, expect, test } from 'bun:test'
import { createGoogleHealthDriver, GOOGLE_HEALTH_SCOPES } from '../src'

const range = { startDate: '2026-11-01', endDate: '2026-11-01' }
const civil = (day: number) => ({ date: { year: 2026, month: 11, day } })
const bounds = { startTime: '2026-11-01T06:30:00Z', endTime: '2026-11-01T16:00:00Z', civilStartTime: civil(1), civilEndTime: civil(1) }
function fake(handle: (url: URL, input?: RequestInit) => Response): typeof fetch {
  return Object.assign((request: string | URL | Request, input?: RequestInit) => Promise.resolve(handle(new URL(request instanceof Request ? request.url : request), input)), { preconnect: fetch.preconnect })
}

describe('Google Health', () => {
  test('validates account identity and honors the granted scope subset', async () => {
    const driver = createGoogleHealthDriver('test', { scopes: GOOGLE_HEALTH_SCOPES.sleep, fetch: fake((url, input) => {
      expect(url.pathname).toBe('/v4/users/me/identity')
      expect(new Headers(input?.headers).get('authorization')).toBe('Bearer test')
      return Response.json({ healthUserId: 'health-user', legacyUserId: 'FIT123' })
    }) })
    expect(await driver.getIdentity()).toEqual({ healthUserId: 'health-user', legacyUserId: 'FIT123' })
    expect([...driver.supportedMetrics]).toEqual(['sleep'])
  })

  test('reads every exercise page and converts physical quantities and the provider date', async () => {
    const pages: string[] = []
    const driver = createGoogleHealthDriver('test', { fetch: fake(url => {
      expect(url.pathname).toBe('/v4/users/me/dataTypes/exercise/dataPoints:reconcile')
      expect(url.searchParams.get('filter')).toBe('exercise.interval.civil_start_time >= "2026-11-01" AND exercise.interval.civil_start_time < "2026-11-02"')
      expect(url.searchParams.get('pageSize')).toBe('25')
      const cursor = url.searchParams.get('pageToken') || ''
      pages.push(cursor)
      return Response.json({
        dataPoints: [{ dataPointName: `users/u/dataTypes/exercise/dataPoints/${cursor || 'first'}`, exercise: { interval: bounds, exerciseType: 'TRAIL_RUN', activeDuration: '1200s', metricsSummary: { distanceMillimeters: 5200000, elevationGainMillimeters: 129000, averageHeartRateBeatsPerMinute: '143' } } }],
        ...(cursor ? {} : { nextPageToken: 'second' }),
      })
    }) })
    const rows = await driver.getWorkouts(range)
    expect(pages).toEqual(['', 'second'])
    expect(rows.map(row => row.id)).toEqual(['first', 'second'])
    expect(rows[0]).toMatchObject({ day: '2026-11-01', distance: 5200, averageHeartRate: 143, details: { elevationGainMeters: 129, activeDurationSeconds: 1200 } })
  })

  test('queries sleep by wake date and preserves main sleep, naps, and stages', async () => {
    const driver = createGoogleHealthDriver('test', { fetch: fake(url => {
      expect(url.searchParams.get('filter')).toContain('sleep.interval.civil_end_time')
      return Response.json({ dataPoints: [
        { sleep: { interval: bounds, summary: { minutesAsleep: '465', minutesAwake: '40', stagesSummary: [{ type: 'REM', minutes: '70' }] }, metadata: { mainSleep: true } } },
        { sleep: { interval: bounds, summary: { minutesAsleep: '20' }, metadata: { nap: true } } },
      ] })
    }) })
    const rows = await driver.getSleep(range)
    expect(rows[0]).toMatchObject({ day: '2026-11-01', type: 'long_sleep', totalSleepDuration: 27900, awakeTime: 2400, remSleepDuration: 4200 })
    expect(rows[1]?.type).toBe('nap')
  })

  test('uses daily server rollups and splits total calorie ranges at the API limit', async () => {
    const calorieRanges: unknown[] = []
    const driver = createGoogleHealthDriver('test', { fetch: fake((url, input) => {
      const body = JSON.parse(String(input?.body))
      expect(body.windowSizeDays).toBe(1)
      const type = url.pathname.split('/')[5]
      if (type === 'total-calories') calorieRanges.push(body.range)
      return Response.json({ rollupDataPoints: [{
        civilStartTime: civil(1),
        ...(type === 'steps' ? { steps: { countSum: '10122' } } : {}),
        ...(type === 'active-energy-burned' ? { activeEnergyBurned: { kcalSum: 375 } } : {}),
        ...(type === 'total-calories' ? { totalCalories: { kcalSum: 2400 } } : {}),
        ...(type === 'distance' ? { distance: { millimetersSum: '6500000' } } : {}),
      }] })
    }) })
    expect(await driver.getDailyActivity({ ...range, endDate: '2026-11-15' })).toMatchObject([
      { day: '2026-11-01', steps: 10122, activeCalories: 375, totalCalories: 2400, equivalentWalkingDistance: 6500 },
    ])
    expect(calorieRanges).toEqual([{ start: civil(1), end: civil(15) }, { start: civil(15), end: civil(16) }])
  })

  test('exposes provider deadlines and actionable identity errors', async () => {
    const throttled = createGoogleHealthDriver('test', { fetch: fake(() => new Response(null, { status: 429, headers: { 'Retry-After': '120' } })) })
    await expect(throttled.getWorkouts(range)).rejects.toMatchObject({ status: 429, retryAfterSeconds: 120 })
    const unlinked = createGoogleHealthDriver('test', { fetch: fake(() => Response.json({ error: { details: [{ reason: 'ACCOUNT_NOT_LINKED' }] } }, { status: 400 })) })
    await expect(unlinked.getIdentity()).rejects.toMatchObject({ status: 400, reason: 'ACCOUNT_NOT_LINKED' })
  })
})
