import { afterEach, describe, expect, it } from 'bun:test'
import { OuraDriver } from '../src/drivers/oura'
import { OURA_COLLECTIONS, OURA_OAUTH_SCOPES, OuraApiError } from '../src/drivers/oura-collections'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function mockOura(sleep: unknown[], scores: Record<string, unknown[]> = {}, failed = '') {
  const requests: URL[] = []
  globalThis.fetch = (async (input: string, init: RequestInit) => {
    const url = new URL(input)
    requests.push(url)
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-token')
    const endpoint = url.pathname.split('/').at(-1)!
    if (endpoint === failed) return Response.json({ detail: 'Denied' }, { status: 403 })
    return Response.json({ data: endpoint === 'sleep' ? sleep : scores[endpoint] || [], next_token: null })
  }) as typeof fetch
  return requests
}

const night = {
  id: 'night', day: '2026-10-10', type: 'long_sleep', total_sleep_duration: 27000,
  average_hrv: 62, lowest_heart_rate: 47, efficiency: 93,
  deep_sleep_duration: 5400, rem_sleep_duration: 7200, light_sleep_duration: 14400,
  awake_time: 1800, average_breath: 14,
}

describe('Oura daily recovery', () => {
  it('keeps the main sleep, reported day, true sleep score and measured resting HR', async () => {
    const requests = mockOura([night, { ...night, id: 'nap', type: 'late_nap', total_sleep_duration: 1800, average_hrv: 20, lowest_heart_rate: 65 }], {
      daily_sleep: [{ day: night.day, score: 81 }],
      daily_readiness: [{ day: night.day, score: 85, temperature_deviation: -0.2, contributors: { resting_heart_rate: 98 } }],
      daily_activity: [{ day: night.day, score: 75, steps: 0, active_calories: 0, total_calories: 2100 }],
    })
    const result = await new OuraDriver('test-token', 'https://test.oura.local').getDailyHealth({ startDate: '2026-10-09', endDate: '2026-10-11' })
    expect(result.errors).toEqual([])
    expect(result.days[0]).toMatchObject({ day: night.day, sleepHours: 7.5, sleepScore: 81, averageHRV: 62, restingHeartRate: 47, readiness: 85, steps: 0, activeCalories: 0 })
    expect(result.days[0]!.details).toContainEqual({ label: 'Readiness: resting heart rate (score)', value: 98 })
    expect(result.days[0]!.details).toContainEqual({ label: 'Deep sleep (hours)', value: 1.5 })
    expect(result.days[0]!.observations?.sleep).toHaveLength(2)
    expect(result.days[0]!.observations?.sleep?.[1]).toMatchObject({ id: 'nap', type: 'late_nap' })
    expect(requests.every(url => url.searchParams.get('start_date') === '2026-10-09' && url.searchParams.get('end_date') === '2026-10-12')).toBe(true)
  })
  it('includes the ending day through Oura’s exclusive sleep boundary and clips extra summaries', async () => {
    const finalNight = { ...night, day: '2026-12-31' }
    globalThis.fetch = (async (input: string) => {
      const url = new URL(input)
      expect(url.searchParams.get('end_date')).toBe('2027-01-01')
      const records = url.pathname.endsWith('/sleep')
        ? [finalNight]
        : [{ day: '2026-12-31', score: 81, contributors: {} }, { day: '2027-01-01', score: 90, contributors: {} }]
      return Response.json({ data: records, next_token: null })
    }) as typeof fetch
    const result = await new OuraDriver('test-token').getDailyHealth({ startDate: '2026-12-31', endDate: '2026-12-31' })
    expect(result.days).toHaveLength(1)
    expect(result.days[0]).toMatchObject({ day: '2026-12-31', sleepHours: 7.5, averageHRV: 62, restingHeartRate: 47 })
  })
  it('rejects malformed ending dates before making requests', async () => {
    for (const endDate of ['soon', '2026-02-30'])
      await expect(new OuraDriver('test-token').getDailyHealth({ endDate })).rejects.toThrow(RangeError)
  })
  it('preserves missing scores and keeps readings when one endpoint fails', async () => {
    mockOura([night], { daily_sleep: [{ day: night.day, score: null }], daily_readiness: [{ day: night.day, score: null, contributors: {} }] }, 'daily_activity')
    const result = await new OuraDriver('test-token').getDailyHealth()
    expect(result.days[0]!.sleepScore).toBeUndefined()
    expect(result.days[0]!.readiness).toBeUndefined()
    expect(result.days[0]!.averageHRV).toBe(62)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.endpoint).toBe('daily_activity')
  })
  it('follows pages and does not convert an unscored rest session into recovery', async () => {
    let calls = 0
    globalThis.fetch = (async (input: string) => {
      const url = new URL(input)
      if (!url.pathname.endsWith('/sleep')) return Response.json({ data: [], next_token: null })
      calls++
      return Response.json(url.searchParams.has('next_token')
        ? { data: [night], next_token: null }
        : { data: [{ ...night, day: '2026-10-09', type: 'rest' }], next_token: 'page-2' })
    }) as typeof fetch
    const result = await new OuraDriver('test-token').getDailyHealth()
    expect(calls).toBe(2)
    expect(result.days).toHaveLength(2)
    expect(result.days[0]!.observations?.sleep).toHaveLength(1)
    expect(result.days[0]!.sleepHours).toBeUndefined()
    expect(result.days[1]!.day).toBe(night.day)
  })
})

describe('Oura SpO2', () => {
  it('keeps measured days across pages when other days have no oxygen measurement', async () => {
    const missing = { day: '2025-09-02', spo2_percentage: null, breathing_disturbance_index: null }
    let calls = 0
    globalThis.fetch = (async (input: string) => {
      const url = new URL(input)
      calls++
      return Response.json(url.searchParams.has('next_token')
        ? { data: [{ day: '2025-09-03', spo2_percentage: { average: 97.5 } }, { day: '2025-09-04', spo2_percentage: { average: null } }], next_token: null }
        : { data: [missing], next_token: 'page-2' })
    }) as typeof fetch
    const driver = new OuraDriver('test-token')
    expect(await driver.getSpO2({ startDate: '2025-09-02', endDate: '2025-09-04' })).toEqual([{ day: '2025-09-03', averageSpO2: 97.5, source: 'oura' }])
    expect(calls).toBe(2)
    expect((await driver.getCollectionPage('daily_spo2')).data).toEqual([missing])
  })
})

describe('Oura heart rate', () => {
  it('filters the heartrate collection by start_datetime and end_datetime', async () => {
    const requests = mockOura([], { heartrate: [{ timestamp: '2026-10-10T03:05:00+00:00', bpm: 48, source: 'sleep' }] })
    const samples = await new OuraDriver('test-token', 'https://test.oura.local').getHeartRate({ startDate: '2026-10-10T00:00:00.000Z', endDate: '2026-10-11T12:30:00.000Z' })
    expect(samples).toEqual([{ timestamp: '2026-10-10T03:05:00+00:00', bpm: 48, source: 'sleep' }])
    expect(requests).toHaveLength(1)
    expect(requests[0]!.pathname).toBe('/v2/usercollection/heartrate')
    expect(requests[0]!.searchParams.get('start_datetime')).toBe('2026-10-10T00:00:00.000Z')
    expect(requests[0]!.searchParams.get('end_datetime')).toBe('2026-10-11T12:30:00.000Z')
    // The day parameters this endpoint ignores are not sent at all.
    expect(requests[0]!.searchParams.has('start_date')).toBe(false)
    expect(requests[0]!.searchParams.has('end_date')).toBe(false)
  })
  it('reads calendar days whole, through the end of the ending day', async () => {
    const requests = mockOura([])
    await new OuraDriver('test-token').getHeartRate({ startDate: '2026-12-30', endDate: '2026-12-31' })
    expect(requests[0]!.searchParams.get('start_datetime')).toBe('2026-12-30T00:00:00.000Z')
    expect(requests[0]!.searchParams.get('end_datetime')).toBe('2027-01-01T00:00:00.000Z')
  })
  it('rejects dates it cannot read before making requests', async () => {
    const requests = mockOura([])
    for (const range of [{ startDate: 'yesterday' }, { endDate: '2026-02-30' }])
      await expect(new OuraDriver('test-token').getHeartRate(range)).rejects.toThrow(RangeError)
    expect(requests).toHaveLength(0)
  })
  it('follows next_token pages', async () => {
    let calls = 0
    globalThis.fetch = (async (input: string) => {
      const url = new URL(input)
      calls++
      expect(url.searchParams.get('start_datetime')).toBe('2026-10-10T00:00:00.000Z')
      return Response.json(url.searchParams.has('next_token')
        ? { data: [{ timestamp: '2026-10-10T00:10:00+00:00', bpm: 51, source: 'rest' }], next_token: null }
        : { data: [{ timestamp: '2026-10-10T00:05:00+00:00', bpm: 50, source: 'rest' }], next_token: 'page-2' })
    }) as typeof fetch
    const samples = await new OuraDriver('test-token').getHeartRate({ startDate: '2026-10-10' })
    expect(calls).toBe(2)
    expect(samples.map(sample => sample.bpm)).toEqual([50, 51])
  })
})

describe('Oura complete collection reads', () => {
  it('preserves new and nullable collection fields and exposes the provider pagination cursor', async () => {
    const requests: URL[] = []
    globalThis.fetch = (async (input: string) => {
      requests.push(new URL(input))
      return Response.json({ data: [{ id: 'resilience-1', day: '2026-10-26', level: 'strong', contributors: { sleep_recovery: null }, future_field: [0, false] }], next_token: 'page-2' })
    }) as typeof fetch
    const page = await new OuraDriver('test-token').getCollectionPage('daily_resilience', { startDate: '2026-10-01', endDate: '2026-10-26' })
    expect(page).toEqual({ data: [{ id: 'resilience-1', day: '2026-10-26', level: 'strong', contributors: { sleep_recovery: null }, future_field: [0, false] }], nextToken: 'page-2' })
    expect(requests[0]!.pathname).toBe('/v2/usercollection/daily_resilience')
    expect(requests[0]!.searchParams.get('end_date')).toBe('2026-10-26')
  })
})

it('reports a collection scope denial separately from invalid credentials without exposing response bodies', async () => {
  globalThis.fetch = (async () => Response.json({ detail: 'Token is not authorized access ring_configuration scope.', access_token: 'must-not-leak' }, { status: 401 })) as unknown as typeof fetch
  try { await new OuraDriver('test-token').getRingConfiguration(); throw new Error('expected refusal') }
  catch (error) {
    expect(error).toBeInstanceOf(OuraApiError)
    expect(error).toMatchObject({ status: 401, requiredScope: 'ring_configuration', collection: 'ring_configuration' })
    expect(String(error)).not.toContain('must-not-leak')
  }
})
it('reads every published collection using its date dialect and retains single personal records', async () => {
  const requests: URL[] = []
  globalThis.fetch = (async (input: string) => {
    const url = new URL(input); requests.push(url)
    return Response.json(url.pathname.endsWith('/personal_info') ? { id: 'owner', email: 'owner@example.test', weight: 0, extra: null } : { data: [], next_token: null })
  }) as typeof fetch
  const driver = new OuraDriver('test-token')
  for (const collection of Object.keys(OURA_COLLECTIONS) as Array<keyof typeof OURA_COLLECTIONS>)
    await driver.getCollectionPage(collection, { startDate: '2026-12-31', endDate: '2026-12-31' })
  expect(requests).toHaveLength(19)
  for (const endpoint of ['daily_cardiovascular_age', 'daily_resilience', 'enhanced_tag', 'ring_battery_level', 'sleep_time'])
    expect(requests.some(url => url.pathname.endsWith(`/${endpoint}`))).toBe(true)
  const sleep = requests.find(url => url.pathname.endsWith('/sleep'))!
  expect(sleep.searchParams.get('end_date')).toBe('2027-01-01')
  const battery = requests.find(url => url.pathname.endsWith('/ring_battery_level'))!
  expect(battery.searchParams.get('end_datetime')).toBe('2027-01-01T00:00:00.000Z')
  expect((await driver.getCollectionPage('personal_info')).data).toEqual([{ id: 'owner', email: 'owner@example.test', weight: 0, extra: null }])
})
it('resumes with unchanged date filters and rejects malformed pages or repeating cursors', async () => {
  globalThis.fetch = (async (input: string) => {
    const url = new URL(input)
    expect(url.searchParams.get('next_token')).toBe('resume-me')
    expect(url.searchParams.get('start_date')).toBe('2026-10-01')
    return Response.json({ data: [], next_token: 'resume-me' })
  }) as typeof fetch
  const driver = new OuraDriver('test-token')
  await expect(driver.getCollectionPage('session', { startDate: '2026-10-01', nextToken: 'resume-me' })).rejects.toThrow('repeated')
  globalThis.fetch = (async () => Response.json({ data: [{ id: 'valid' }, null] })) as unknown as typeof fetch
  await expect(driver.getCollectionPage('tag')).rejects.toThrow('Malformed')
  await expect(driver.getCollectionPage('unknown' as never)).rejects.toThrow('Unknown')
  await expect(driver.getCollectionPage('tag', { startDate: '2026-02-30' })).rejects.toThrow(RangeError)
})

it('requests the verified ring configuration and battery authorization scope', () => {
  expect(OURA_OAUTH_SCOPES).toContain('ring_configuration')
  expect(OURA_OAUTH_SCOPES).toContain('stress')
  expect(new Set(OURA_OAUTH_SCOPES).size).toBe(11)
})

it('rejects collection pages wider than Oura’s 30-day instant limit before HTTP', async () => {
  let requests = 0
  globalThis.fetch = (async (input: string) => {
    expect(new URL(input).pathname).toEndWith('/heartrate')
    requests++
    return Response.json({ data: [], next_token: null })
  }) as typeof fetch
  const driver = new OuraDriver('test-token')
  for (const collection of ['heartrate', 'ring_battery_level'] as const)
    await expect(driver.getCollectionPage(collection, { startDate: '2026-09-26', endDate: '2026-10-26' })).rejects.toThrow('30 days')
  expect(requests).toBe(0)
  await driver.getCollectionPage('heartrate', { startDate: '2026-09-27', endDate: '2026-10-26' })
  expect(requests).toBe(1)
})
it('reads all heart-rate windows and pages without duplicating their shared boundary', async () => {
  const windows = new Set<string>()
  globalThis.fetch = (async (input: string) => {
    const url = new URL(input)
    const from = url.searchParams.get('start_datetime')!
    const to = url.searchParams.get('end_datetime')!
    expect(Date.parse(to) - Date.parse(from)).toBeLessThanOrEqual(30 * 86400000)
    windows.add(from)
    return Response.json({ data: [{ timestamp: url.searchParams.has('next_token') ? to : from, bpm: 60, source: 'awake' }], next_token: url.searchParams.has('next_token') ? null : 'next' })
  }) as typeof fetch
  const rows = await new OuraDriver('test-token').getHeartRate({ startDate: '2026-08-01', endDate: '2026-10-01' })
  expect(windows.size).toBe(3)
  expect(rows.map(row => row.timestamp)).toEqual(['2026-08-01T00:00:00.000Z', '2026-08-31T00:00:00.000Z', '2026-09-30T00:00:00.000Z'])
})
