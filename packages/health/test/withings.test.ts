import { afterEach, describe, expect, it } from 'bun:test'
import { WithingsDriver } from '../src/drivers/withings'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

/** A Withings API stub: answers getmeas from `pages`, one per request, and records each form. */
function stubWithings(pages: Array<Record<string, unknown>>): URLSearchParams[] {
  const forms: URLSearchParams[] = []
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const form = new URLSearchParams(String(init.body))
    forms.push(form)
    const body = pages[forms.length - 1] ?? { measuregrps: [] }
    return new Response(JSON.stringify({ status: 0, body }), { headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return forms
}

// 2024-03-01 21:30 UTC is the morning of 2 March in Sydney.
const EVENING_UTC = Date.UTC(2024, 2, 1, 21, 30) / 1000

function group(grpid: number, date: number, measures: Array<[type: number, value: number, unit: number]>) {
  return { grpid, attrib: 0, date, created: date, category: 1, deviceid: null, measures: measures.map(([type, value, unit]) => ({ type, value, unit })) }
}

describe('Withings driver', () => {
  it('follows `more` and `offset` until the whole history has arrived', async () => {
    const forms = stubWithings([
      { measuregrps: [group(1, EVENING_UTC, [[1, 80250, -3]])], more: 1, offset: 1, timezone: 'Australia/Sydney' },
      { measuregrps: [group(2, EVENING_UTC - 86400, [[1, 80900, -3]])], more: 1, offset: 2 },
      { measuregrps: [group(3, EVENING_UTC - 2 * 86400, [[1, 81000, -3]])], more: 0 },
    ])
    const weights = await new WithingsDriver('token').getWeightMeasurements({ startDate: '2008-01-01' })
    expect(weights.map(w => w.id)).toEqual(['1', '2', '3'])
    expect(forms.map(f => f.get('offset'))).toEqual([null, '1', '2'])
    expect(forms.every(f => f.get('action') === 'getmeas' && f.get('startdate') === String(Date.UTC(2008, 0, 1) / 1000))).toBe(true)
  })

  it('files a weigh-in under the account\'s own calendar day, with its body fat', async () => {
    const forms = stubWithings([{ measuregrps: [group(7, EVENING_UTC, [[1, 80250, -3], [6, 1523, -2]])], timezone: 'Australia/Sydney' }])
    const [weight] = await new WithingsDriver('token').getWeightMeasurements()
    expect(weight).toMatchObject({ day: '2024-03-02', weight: 80.25, bodyFatPercentage: 15.23, source: 'withings' })
    expect(weight!.timestamp).toBe('2024-03-01T21:30:00.000Z')
    expect(forms[0]!.get('meastypes')).toBe('1,6')
  })

  it('falls back to the UTC day without a time zone', async () => {
    stubWithings([{ measuregrps: [group(8, EVENING_UTC, [[1, 80250, -3]])] }])
    const [weight] = await new WithingsDriver('token').getWeightMeasurements()
    expect(weight!.day).toBe('2024-03-01')
  })

  it('reports body water as a share of weight, not the mass Withings sends', async () => {
    stubWithings([{ measuregrps: [group(9, EVENING_UTC, [[1, 80000, -3], [77, 4800, -2]])], timezone: 'UTC' }])
    const [body] = await new WithingsDriver('token').getBodyComposition()
    expect(body!.waterPercentage).toBe(60)
  })
})
