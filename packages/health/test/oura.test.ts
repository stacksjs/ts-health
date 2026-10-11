import { afterEach, describe, expect, it } from 'bun:test'
import { OuraDriver } from '../src/drivers/oura'

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
    expect(result.days).toHaveLength(1)
    expect(result.days[0]!.day).toBe(night.day)
  })
})
