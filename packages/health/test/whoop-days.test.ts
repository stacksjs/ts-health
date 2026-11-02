import { afterEach, describe, expect, it } from 'bun:test'
import { WhoopDriver, whoopLocalDay } from '../src/drivers/whoop'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function whoopApi(records: Record<string, unknown[]>) {
  globalThis.fetch = (async (url: any) => {
    const path = new URL(url).pathname
    const key = Object.keys(records).find(suffix => path.endsWith(suffix))
    return Response.json({ records: key ? records[key] : [], next_token: null })
  }) as typeof fetch
}

describe('WHOOP days are the wearer\'s', () => {
  it('reads the calendar day from WHOOP\'s own offset', () => {
    expect(whoopLocalDay('2026-11-03T02:00:00.000Z', '-08:00')).toBe('2026-11-02')
    expect(whoopLocalDay('2026-11-02T22:30:00.000Z', '+09:00')).toBe('2026-11-03')
    expect(whoopLocalDay('2026-11-02T23:30:00.000Z', '+05:30')).toBe('2026-11-03')
    expect(whoopLocalDay('2026-11-02T23:30:00.000Z', 'Z')).toBe('2026-11-02')
    expect(whoopLocalDay('2026-11-02T23:30:00.000Z', null)).toBe('2026-11-02')
  })

  it('dates an evening workout in California on its own day, not the next UTC day', async () => {
    // 6pm on 2 November in Los Angeles is 02:00 on 3 November in UTC.
    whoopApi({ '/workout': [{ id: 'w', sport_id: 0, start: '2026-11-03T02:00:00.000Z', end: '2026-11-03T03:00:00.000Z', timezone_offset: '-08:00', score: null }] })
    const [workout] = await new WhoopDriver('token').getWorkouts({ startDate: '2026-11-02', endDate: '2026-11-03' })
    expect(workout!.day).toBe('2026-11-02')
  })

  it('gives a night and its recovery the morning it ended where it was slept', async () => {
    // In Tokyo: asleep 23:00 on 2 November, awake 07:00 on 3 November (22:00Z on the 2nd).
    const sleep = { id: 's1', start: '2026-11-02T14:00:00.000Z', end: '2026-11-02T22:00:00.000Z', timezone_offset: '+09:00', nap: false, score: null }
    whoopApi({
      '/activity/sleep': [sleep],
      '/recovery': [{ cycle_id: 1, sleep_id: 's1', created_at: '2026-11-02T22:05:00.000Z', score: { recovery_score: 71, resting_heart_rate: 48, hrv_rmssd_milli: 62.4, spo2_percentage: 97, skin_temp_celsius: 33.4 } }],
    })
    const driver = new WhoopDriver('token')
    const range = { startDate: '2026-11-02', endDate: '2026-11-03' }
    expect((await driver.getSleep(range))[0]!.day).toBe('2026-11-03')
    expect((await driver.getReadiness(range))[0]!.day).toBe('2026-11-03')
    expect((await driver.getSpO2(range))[0]!.day).toBe('2026-11-03')
    expect((await driver.getBodyTemperature(range))[0]!.day).toBe('2026-11-03')
  })
})
