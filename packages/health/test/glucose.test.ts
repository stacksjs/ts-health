import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  createDexcomDriver,
  createLibreLinkUpDriver,
  createNightscoutDriver,
  createTidepoolDriver,
  dexcomAuthorizeUrl,
  exchangeDexcomCode,
  exerciseGlucose,
  glucoseIn,
  glucoseStats,
  insulinTotals,
  libreTimestamp,
  normalizeTrend,
  preExerciseCheck,
} from '../src/glucose'
import type { GlucoseReading } from '../src/glucose'

type Call = { url: string, init?: RequestInit }

function fakeFetch(route: (url: URL, init?: RequestInit) => Response | Promise<Response>, calls: Call[] = []) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return route(new URL(String(input)), init)
  }) as (url: string, init?: RequestInit) => Promise<Response>
}

const range = { start: '2026-10-21T00:00:00Z', end: '2026-10-21T23:59:59Z' }

function cgm(minute: number, mgdl: number): GlucoseReading {
  return { id: String(minute), timestamp: new Date(Date.parse('2026-10-21T08:00:00Z') + minute * 60_000).toISOString(), mgdl, trend: 'flat', kind: 'cgm', source: 'manual' }
}

describe('glucose units and trends', () => {
  it('converts to the person\'s unit and reads every arrow spelling', () => {
    expect(glucoseIn(180, 'mmol/L')).toBe(10)
    expect(glucoseIn(99.6, 'mg/dL')).toBe(100)
    expect(normalizeTrend('SingleUp')).toBe('singleUp')
    expect(normalizeTrend('fortyFiveDown')).toBe('fortyFiveDown')
    expect(normalizeTrend('NOT COMPUTABLE')).toBe('unknown')
    expect(libreTimestamp('10/21/2026 6:30:00 PM')).toBe('2026-10-21T18:30:00.000Z')
    expect(libreTimestamp('10/21/2026 12:05:00 AM')).toBe('2026-10-21T00:05:00.000Z')
  })
})

describe('consensus CGM metrics', () => {
  it('splits readings into the five ranges and computes GMI and CV', () => {
    const values = [50, 60, 100, 120, 150, 170, 200, 260, 110, 130]
    const stats = glucoseStats(values.map((v, i) => cgm(i * 5, v)))
    expect(stats.readings).toBe(10)
    expect(stats.ranges).toEqual({ veryLow: 10, low: 10, inRange: 60, high: 10, veryHigh: 10 })
    expect(stats.meanMgdl).toBe(135)
    expect(stats.gmiPercent).toBe(6.5)
    expect(stats.coveragePercent).toBe(100)
    expect(stats.tightRangePercent).toBe(40)
    expect(glucoseStats([]).meanMgdl).toBeNull()
  })

  it('reports partial sensor coverage against the period', () => {
    const stats = glucoseStats([cgm(0, 100), cgm(5, 110), cgm(10, 120)], undefined, 60)
    expect(stats.coveragePercent).toBe(25)
  })

  it('follows glucose across a workout and the hour after', () => {
    const readings = [cgm(-10, 160), cgm(0, 150), cgm(30, 120), cgm(60, 95), cgm(90, 66)]
    const session = exerciseGlucose(readings, '2026-10-21T08:00:00Z', '2026-10-21T09:00:00Z')
    expect(session.startMgdl).toBe(150)
    expect(session.endMgdl).toBe(95)
    expect(session.changeMgdl).toBe(-55)
    expect(session.ratePerHour).toBe(-55)
    expect(session.lowsDuringOrAfter).toBe(1)
  })

  it('places a starting reading in the consensus band, a falling arrow counting', () => {
    expect(preExerciseCheck(65).band).toBe('treat_low')
    expect(preExerciseCheck(110).band).toBe('borderline')
    expect(preExerciseCheck(140).band).toBe('ready')
    expect(preExerciseCheck(140, 'singleDown')).toMatchObject({ band: 'below_target', projectedMgdl: 80, carbsGrams: 15 })
    expect(preExerciseCheck(220).band).toBe('high')
    expect(preExerciseCheck(300).band).toBe('check_ketones')
  })

  it('totals insulin and the share a loop gave on its own', () => {
    expect(insulinTotals([
      { id: '1', timestamp: '', units: 4, kind: 'bolus', automatic: false, source: 'manual' },
      { id: '2', timestamp: '', units: 1, kind: 'bolus', automatic: true, source: 'manual' },
      { id: '3', timestamp: '', units: 5, kind: 'basal', automatic: true, source: 'manual' },
    ])).toEqual({ bolus: 5, basal: 5, total: 10, automaticPercent: 60 })
  })
})

describe('Nightscout', () => {
  it('reads entries, treatments and device status with a hashed secret', async () => {
    const calls: Call[] = []
    const fetch = fakeFetch((url) => {
      if (url.pathname.endsWith('/entries.json')) {
        return Response.json([
          { _id: 'a', type: 'sgv', sgv: 142, direction: 'FortyFiveDown', date: Date.parse('2026-10-21T08:00:00Z'), device: 'xDrip-DexcomG7' },
          { _id: 'b', type: 'mbg', mbg: 150, date: Date.parse('2026-10-21T08:02:00Z') },
          { _id: 'c', type: 'cal', date: Date.parse('2026-10-21T08:03:00Z') },
          { _id: 'd', type: 'sgv', sgv: 5, date: Date.parse('2026-10-21T08:05:00Z') },
        ])
      }
      if (url.pathname.endsWith('/treatments.json')) {
        return Response.json([
          { _id: 't1', eventType: 'Meal Bolus', insulin: 4.5, carbs: 40, created_at: '2026-10-21T12:00:00Z' },
          { _id: 't2', eventType: 'Correction Bolus', insulin: 0.4, isSMB: true, created_at: '2026-10-21T12:30:00Z' },
          { _id: 't3', eventType: 'Temp Basal', absolute: 0, duration: 30, created_at: '2026-10-21T13:00:00Z' },
          { _id: 't4', eventType: 'Carb Correction', carbs: 15, created_at: '2026-10-21T14:00:00Z' },
        ])
      }
      if (url.pathname.endsWith('/devicestatus.json')) {
        return Response.json([
          { created_at: '2026-10-21T15:00:00Z', device: 'xdripjs://phone', uploader: { battery: 80 } },
          { created_at: '2026-10-21T14:55:00Z', device: 'loop://iPhone', loop: { iob: { iob: 1.234 }, cob: { cob: 12.4 } }, pump: { reservoir: 120.5, battery: { percent: 75 }, status: { suspended: false } } },
        ])
      }
      return new Response('', { status: 404 })
    }, calls)
    const ns = createNightscoutDriver({ url: 'https://my-ns.example.com/', apiSecret: 'secret-secret', fetch })

    const glucose = await ns.getGlucose(range)
    expect(glucose.map(r => [r.mgdl, r.kind, r.trend])).toEqual([[142, 'cgm', 'fortyFiveDown'], [150, 'meter', 'unknown']])
    expect(calls[0]!.url).toContain('find%5Bdate%5D%5B%24gte%5D=')
    expect((calls[0]!.init!.headers as Record<string, string>)['api-secret']).toBe(createHash('sha1').update('secret-secret').digest('hex'))

    const insulin = await ns.getInsulin(range)
    expect(insulin.map(d => [d.kind, d.subtype, d.units, d.automatic])).toEqual([
      ['bolus', 'meal', 4.5, false],
      ['bolus', 'automatic', 0.4, true],
      ['basal', 'suspend', 0, true],
    ])
    expect((await ns.getCarbs(range)).map(c => c.grams)).toEqual([40, 15])
    expect(await ns.getPumpStatus()).toMatchObject({ device: 'iPhone', reservoirUnits: 120.5, batteryPercent: 75, insulinOnBoard: 1.23, carbsOnBoard: 12, mode: 'Loop', suspended: false })
  })

  it('refuses plain http and a malformed address', () => {
    expect(() => createNightscoutDriver({ url: 'http://ns.example.com' })).toThrow('https')
    expect(() => createNightscoutDriver({ url: 'not a url' })).toThrow('Nightscout')
  })

  it('never copies the provider body into errors', async () => {
    const ns = createNightscoutDriver({ url: 'https://ns.example.com', token: 'tok', fetch: fakeFetch(() => new Response('token tok is wrong for jane@example.com', { status: 401 })) })
    const error = await ns.getGlucose(range).then(() => null, (e: Error) => e)
    expect(error?.message).toBe('Nightscout refused access; reconnect it')
  })
})

describe('Dexcom', () => {
  it('builds the consent URL and exchanges the code', async () => {
    const url = new URL(dexcomAuthorizeUrl({ clientId: 'cid', redirectUri: 'https://hq.training/cb', region: 'eu' }, 'state1'))
    expect(url.origin).toBe('https://api.dexcom.eu')
    expect(url.searchParams.get('scope')).toBe('offline_access')
    const calls: Call[] = []
    const tokens = await exchangeDexcomCode({ clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://hq.training/cb', fetch: fakeFetch(() => Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 7200 }), calls) }, 'code1')
    expect(tokens.accessToken).toBe('a')
    expect(String(calls[0]!.init!.body)).toContain('grant_type=authorization_code')
  })

  it('reads EGVs and app events in 30-day windows', async () => {
    const calls: Call[] = []
    const fetch = fakeFetch((url) => {
      if (url.pathname.endsWith('/egvs'))
        return Response.json({ records: [{ recordId: 'e1', systemTime: '2026-10-21T08:00:00', value: 118, trend: 'flat', unit: 'mg/dL', displayDevice: 'iOS', transmitterGeneration: 'g7' }] })
      return Response.json({ records: [
        { recordId: 'v1', systemTime: '2026-10-21T08:00:00', eventType: 'insulin', eventSubType: 'fastActing', value: 3, eventStatus: 'created' },
        { recordId: 'v2', systemTime: '2026-10-21T22:00:00', eventType: 'insulin', eventSubType: 'longActing', value: 18, eventStatus: 'created' },
        { recordId: 'v3', systemTime: '2026-10-21T08:00:00', eventType: 'carbs', value: 45, eventStatus: 'created' },
        { recordId: 'v4', systemTime: '2026-10-21T09:00:00', eventType: 'carbs', value: 20, eventStatus: 'deleted' },
      ] })
    }, calls)
    const dexcom = createDexcomDriver({ accessToken: 'tok', fetch })
    expect(await dexcom.getGlucose({ start: '2026-08-01T00:00:00Z', end: '2026-10-21T00:00:00Z' })).toHaveLength(1)
    expect(calls).toHaveLength(3)
    expect(new URL(calls[0]!.url).searchParams.get('startDate')).toBe('2026-08-01T00:00:00')
    expect((await dexcom.getInsulin(range)).map(d => [d.kind, d.units])).toEqual([['bolus', 3], ['basal', 18]])
    expect((await dexcom.getCarbs(range)).map(c => c.grams)).toEqual([45])
  })
})

describe('LibreLinkUp', () => {
  it('follows the region redirect and sends the hashed account id', async () => {
    const calls: Call[] = []
    const fetch = fakeFetch((url) => {
      if (url.pathname === '/llu/auth/login' && url.hostname === 'api.libreview.io') return Response.json({ status: 0, data: { redirect: true, region: 'eu' } })
      if (url.pathname === '/llu/auth/login') return Response.json({ status: 0, data: { user: { id: 'user-1' }, authTicket: { token: 'jwt', expires: Math.floor(Date.now() / 1000) + 3600 } } })
      if (url.pathname === '/llu/connections') return Response.json({ data: [{ patientId: 'p1' }] })
      return Response.json({ data: {
        connection: { sensor: { pt: 4 }, glucoseMeasurement: { FactoryTimestamp: '10/21/2026 8:10:00 AM', ValueInMgPerDl: 101, TrendArrow: 4 } },
        graphData: [{ FactoryTimestamp: '10/21/2026 8:00:00 AM', ValueInMgPerDl: 95 }, { FactoryTimestamp: '10/20/2026 8:00:00 AM', ValueInMgPerDl: 95 }],
      } })
    }, calls)
    const libre = createLibreLinkUpDriver({ email: 'a@b.c', password: 'pw', fetch })
    const readings = await libre.getGlucose(range)
    expect(readings.map(r => [r.mgdl, r.trend, r.device])).toEqual([[95, 'unknown', 'FreeStyle Libre 3'], [101, 'fortyFiveUp', 'FreeStyle Libre 3']])
    expect(libre.region).toBe('eu')
    const graph = calls.at(-1)!
    expect(graph.url).toBe('https://api-eu.libreview.io/llu/connections/p1/graph')
    expect((graph.init!.headers as Record<string, string>)['account-id']).toBe(createHash('sha256').update('user-1').digest('hex'))
  })
})

describe('Tidepool', () => {
  it('reads a pump upload in one request: mmol/L, boluses, automated basal and carbs', async () => {
    const calls: Call[] = []
    const fetch = fakeFetch((url) => {
      if (url.pathname === '/auth/login') return Response.json({ userid: 'u1' }, { headers: { 'x-tidepool-session-token': 'sess' } })
      return Response.json([
        { id: 'g1', type: 'cbg', time: '2026-10-21T08:00:00Z', value: 6.66, units: 'mmol/L', deviceId: 'DexG7_123' },
        { id: 'b1', type: 'bolus', subType: 'normal', normal: 3.2, time: '2026-10-21T08:05:00Z', deviceId: 'tandem_1' },
        { id: 'b2', type: 'bolus', subType: 'automated', normal: 0.6, time: '2026-10-21T09:00:00Z', deviceId: 'tandem_1' },
        { id: 'a1', type: 'basal', deliveryType: 'automated', rate: 1.2, duration: 1_800_000, time: '2026-10-21T08:00:00Z', deviceId: 'tandem_1' },
        { id: 'a2', type: 'basal', deliveryType: 'suspend', duration: 600_000, time: '2026-10-21T08:30:00Z', deviceId: 'tandem_1' },
        { id: 'w1', type: 'wizard', carbInput: 35, time: '2026-10-21T08:05:00Z' },
      ])
    }, calls)
    const tidepool = createTidepoolDriver({ email: 'a@b.c', password: 'pw', fetch })
    expect((await tidepool.getGlucose(range)).map(r => r.mgdl)).toEqual([120])
    const insulin = await tidepool.getInsulin(range)
    expect(insulin.map(d => [d.kind, d.subtype, d.units, d.device])).toEqual([
      ['basal', 'automatic', 0.6, 'Tandem t:slim X2'],
      ['bolus', undefined, 3.2, 'Tandem t:slim X2'],
      ['basal', 'suspend', 0, 'Tandem t:slim X2'],
      ['bolus', 'automatic', 0.6, 'Tandem t:slim X2'],
    ])
    expect((await tidepool.getCarbs(range)).map(c => c.grams)).toEqual([35])
    expect(calls.filter(c => c.url.includes('/data/'))).toHaveLength(1)
    expect(calls[0]!.init!.headers).toEqual({ Authorization: `Basic ${Buffer.from('a@b.c:pw').toString('base64')}` })
  })
})
