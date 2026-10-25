import { afterEach, expect, test } from 'bun:test'
import { GarminConnectClient } from 'ts-watches'
import { GarminHealthDriver } from '../src/drivers/garmin'
import { WhoopDriver } from '../src/drivers/whoop'
import { FitbitDriver } from '../src/drivers/fitbit'
import { PartialHealthReadError } from '../src/read-errors'
import { SleepAnalyzer } from '../src/analysis/sleep'

const original = globalThis.fetch
afterEach(() => { globalThis.fetch = original })
function garmin() {
  const client = new GarminConnectClient({ username: 'owner@example.com', password: 'unused' })
  ;(client as unknown as { isLoggedIn: boolean }).isLoggedIn = true
  return new GarminHealthDriver({ username: 'owner@example.com', password: 'unused', authenticatedClient: client })
}
test('Garmin retains all weigh-ins, converts grams to kg and preserves a genuine zero', async () => {
  globalThis.fetch = (async () => Response.json({ dateWeightList: [
    { samplePk: 1, weight: 73000, timestampGMT: Date.parse('2026-10-24T08:00:00Z'), bodyFatPercentage: 0, boneMass: 3000 },
    { samplePk: 2, weight: 73500, timestampGMT: Date.parse('2026-10-24T18:00:00Z'), muscleMass: 32000 },
  ] })) as unknown as typeof fetch
  const rows = await garmin().getBodyComposition({ startDate: '2026-10-24', endDate: '2026-10-24' })
  expect(rows).toHaveLength(2)
  expect(rows[0]).toMatchObject({ weight: 73, bodyFatPercentage: 0, boneMass: 3, details: { boneMass: 3000 }, timestamp: '2026-10-24T08:00:00.000Z' })
  expect(rows[1]).toMatchObject({ weight: 73.5, muscleMass: 32 })
})
test('a failed Garmin day retains the successful readings and remains a failure', async () => {
  globalThis.fetch = (async (url: any) => String(url).includes('2026-10-24')
    ? Response.json({}, { status: 500 })
    : Response.json({ hrvSummary: { lastNightAvg: 55 }, hrvReadings: [] })) as typeof fetch
  try {
    await garmin().getHRV({ startDate: '2026-10-23', endDate: '2026-10-24' })
    throw new Error('Expected a partial read')
  }
  catch (error) {
    expect(error).toBeInstanceOf(PartialHealthReadError)
    expect((error as PartialHealthReadError).readings).toMatchObject([{ hrv: 55 }])
  }
})
test('Garmin VO2 keeps running and cycling distinct, and hydration keeps original ml', async () => {
  globalThis.fetch = (async (url: any) => Response.json(String(url).includes('maxmet')
    ? [{ generic: { calendarDate: '2026-10-24', vo2MaxPreciseValue: 55.4 }, cycling: { calendarDate: '2026-10-24', vo2MaxValue: 59 } }]
    : { valueInML: 0 })) as typeof fetch
  const driver = garmin()
  expect(await driver.getVO2Max({ startDate: '2026-10-24', endDate: '2026-10-24' })).toEqual([
    { day: '2026-10-24', vo2Max: 55.4, activity: 'running', source: 'garmin' },
    { day: '2026-10-24', vo2Max: 59, activity: 'cycling', source: 'garmin' },
  ])
  expect((await driver.getDailyHydration({ startDate: '2026-10-24', endDate: '2026-10-24' }))[0]?.volumeMl).toBe(0)
})
test('WHOOP v2 preserves migration identity, original strain and absolute temperature with shared snapshot reads', async () => {
  const calls: string[] = []
  globalThis.fetch = (async (url: any) => {
    const path = new URL(url).pathname
    calls.push(path)
    if (path.endsWith('/workout')) return Response.json({ records: [{ id: 'uuid', activity_v1_id: 42, sport_id: 1, start: '2026-10-24T12:00:00Z', end: '2026-10-24T13:00:00Z', score: null }], next_token: null })
    if (path.endsWith('/cycle')) return Response.json({ records: [{ start: '2026-10-24T08:00:00Z', score: { strain: 12.7, kilojoule: 1000 } }], next_token: null })
    return Response.json({ records: [{ created_at: '2026-10-24T08:00:00Z', score: { skin_temp_celsius: 33.1, spo2_percentage: 98 } }], next_token: null })
  }) as typeof fetch
  const driver = new WhoopDriver('owner-token')
  expect((await driver.getWorkouts())[0]?.id).toBe('42')
  expect((await driver.getDailyActivity())[0]?.strain).toBe(12.7)
  expect((await driver.getStress())[0]).toMatchObject({ strain: 12.7 })
  expect((await driver.getBodyTemperature())[0]).toMatchObject({ celsius: 33.1 })
  expect((await driver.getSpO2())[0]?.averageSpO2).toBe(98)
  expect(calls.every(path => path.includes('/v2/'))).toBe(true)
  expect(calls.filter(path => path.endsWith('/cycle'))).toHaveLength(1)
  expect(calls.filter(path => path.endsWith('/recovery'))).toHaveLength(1)
})
test('Fitbit reads intraday one UTC day at a time, and reports denied optional permissions', async () => {
  const calls: URL[] = []
  globalThis.fetch = (async (url: any) => {
    const parsed = new URL(url)
    calls.push(parsed)
    if (parsed.pathname.includes('/spo2/')) return Response.json({}, { status: 403 })
    const date = /date\/(\d{4}-\d\d-\d\d)\//.exec(parsed.pathname)![1]
    return Response.json({ 'activities-heart': [{ dateTime: date, value: { restingHeartRate: 48 } }], 'activities-heart-intraday': { dataset: [{ time: '12:30:00', value: 130 }] } })
  }) as typeof fetch
  const driver = new FitbitDriver('owner-token')
  const readings = await driver.getHeartRate({ startDate: '2026-10-23', endDate: '2026-10-24' })
  expect(readings.filter(row => row.source !== 'resting').map(row => row.timestamp)).toEqual(['2026-10-23T12:30:00Z', '2026-10-24T12:30:00Z'])
  expect(calls.every(url => url.searchParams.get('timezone') === 'UTC')).toBe(true)
  await expect(driver.getSpO2()).rejects.toThrow('403')
})
test('unknown sleep latency remains unknown in an estimated quality score', () => {
  const score = new SleepAnalyzer().scoreSleepQuality({ id: 'night', day: '2026-10-24', bedtimeStart: '2026-10-24T00:00:00Z', bedtimeEnd: '2026-10-24T08:00:00Z', type: 'long_sleep', totalSleepDuration: 28800, deepSleepDuration: 6000, lightSleepDuration: 15000, remSleepDuration: 7800, awakeTime: 0, timeInBed: 28800, efficiency: 100, stages: [], source: 'garmin' })
  expect(score.latencyScore).toBeUndefined()
  expect(Number.isFinite(score.overall)).toBe(true)
})
test('a Fitbit VO2 range is preserved as a range, never presented as an exact lower bound', async () => {
  globalThis.fetch = (async () => Response.json({ cardioScore: [{ dateTime: '2026-10-24', value: { vo2Max: '45-49' } }] })) as unknown as typeof fetch
  expect(await new FitbitDriver('owner-token').getVO2Max()).toEqual([{ day: '2026-10-24', range: { min: 45, max: 49 }, source: 'fitbit' }])
})
test('Fitbit follows owner-scoped pagination, understands ISO starts and keeps distance units', async () => {
  let reads = 0
  globalThis.fetch = (async (url: any, init: RequestInit) => {
    reads++
    expect(new Headers(init.headers).get('Accept-Language')).toBe('en_GB')
    const second = new URL(url).searchParams.has('page')
    return Response.json({ activities: [{ logId: second ? 2 : 1, activityName: 'Run', startTime: `2026-10-24T${second ? '18' : '12'}:00:00-07:00`, duration: 3600000, distance: 1, distanceUnit: 'Mile' }], pagination: { next: second ? '' : 'https://api.fitbit.com/1/user/-/activities/list.json?page=2' } })
  }) as typeof fetch
  const rows = await new FitbitDriver('owner-token').getWorkouts({ startDate: '2026-10-24', endDate: '2026-10-24' })
  expect(reads).toBe(2)
  expect(rows.map(row => row.id)).toEqual(['1', '2'])
  expect(rows[0]).toMatchObject({ activity: 'Run', distance: 1609.344, startDatetime: '2026-10-24T12:00:00-07:00' })
  reads = 0
  globalThis.fetch = (async () => { reads++; return Response.json({ activities: [], pagination: { next: 'https://api.fitbit.com/1/user/SOMEONE_ELSE/activities/list.json' } }) }) as unknown as typeof fetch
  await expect(new FitbitDriver('owner-token').getWorkouts()).rejects.toThrow('own-account')
  expect(reads).toBe(1)
})

test('Garmin daily activity preserves measured distance and zero steps without inventing calories', async () => {
  globalThis.fetch = (async () => Response.json([{ calendarDate: '2026-10-24', totalSteps: 0, stepGoal: 15260, totalDistance: 0 }])) as unknown as typeof fetch
  const rows = await garmin().getDailyActivity({ startDate: '2026-10-24', endDate: '2026-10-24' })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ steps: 0, equivalentWalkingDistance: 0 })
  expect(rows[0]?.activeCalories).toBeUndefined()
  expect(rows[0]?.totalCalories).toBeUndefined()
})
