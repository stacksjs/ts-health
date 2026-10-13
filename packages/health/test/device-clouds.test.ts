import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createHmac } from 'node:crypto'
import {
  CorosCloudDriver,
  createPolarWebhook,
  DEVICE_OAUTH,
  DeviceCloudAuthError,
  DeviceCloudRateLimitError,
  deviceAuthorizeUrl,
  deviceWebhookReply,
  exchangeDeviceCode,
  getPolarWebhooks,
  isoDurationSeconds,
  parseDeviceWebhook,
  PolarAccessLinkDriver,
  refreshDeviceToken,
  retryAfterSeconds,
  SuuntoCloudDriver,
  verifyDeviceWebhook,
  WahooCloudDriver,
} from '../src/device-clouds'
import { CLIENT, COROS_OPEN_ID, FIT_BYTES, type FakeClouds, startFakeClouds, SUUNTO_KEY, TOKENS } from './fakes/device-clouds'

let fake: FakeClouds
beforeAll(() => { fake = startFakeClouds() })
afterAll(() => fake.stop())

const RANGE = { startDate: '2026-10-01', endDate: '2026-10-14' }

describe('OAuth dialects', () => {
  it('builds each authorize link, leaving out a scope the provider does not take', () => {
    const polar = new URL(deviceAuthorizeUrl('polar', CLIENT, 's1'))
    expect(polar.origin + polar.pathname).toBe('https://flow.polar.com/oauth2/authorization')
    expect(polar.searchParams.get('scope')).toBe('accesslink.read_all')
    expect(polar.searchParams.get('state')).toBe('s1')
    const coros = new URL(deviceAuthorizeUrl('coros', CLIENT, 's2'))
    expect(coros.searchParams.has('scope')).toBe(false)
    expect(coros.searchParams.get('response_type')).toBe('code')
    expect(new URL(deviceAuthorizeUrl('wahoo', CLIENT, 's3')).searchParams.get('scope')).toBe('user_read workouts_read offline_data')
  })

  it('trades a Polar code with HTTP Basic, and keeps Polar\'s user id', async () => {
    const tokens = await exchangeDeviceCode('polar', { ...CLIENT, tokenUrl: `${fake.url}/polar-oauth/v2/oauth2/token` }, 'polar-code', Date.UTC(2026, 9, 10))
    expect(tokens).toMatchObject({ accessToken: TOKENS.polar, providerUserId: '4751' })
    expect(tokens.refreshToken).toBeUndefined()
    const call = fake.calls.at(-1)!
    expect(call.headers.authorization).toBe(`Basic ${btoa(`${CLIENT.clientId}:${CLIENT.clientSecret}`)}`)
    expect(new URLSearchParams(call.body).get('client_secret')).toBeNull()
  })

  it('refuses to refresh a Polar token, which has no refresh token', async () => {
    expect(refreshDeviceToken('polar', CLIENT, 'x')).rejects.toThrow('cannot be refreshed')
  })

  it('trades and refreshes a Suunto token, with the username as the user', async () => {
    const client = { ...CLIENT, tokenUrl: `${fake.url}/suunto-oauth/oauth/token` }
    expect(await exchangeDeviceCode('suunto', client, 'suunto-code')).toMatchObject({ accessToken: TOKENS.suunto, refreshToken: 'suunto-refresh', providerUserId: 'suunto-user' })
    expect(await refreshDeviceToken('suunto', client, 'suunto-refresh')).toMatchObject({ accessToken: 'suunto-token-2', refreshToken: 'suunto-refresh-2' })
  })

  it('takes COROS\' openId from the token, and extends the same token on refresh', async () => {
    const client = { ...CLIENT, tokenUrl: `${fake.url}/coros/oauth2/accesstoken`, refreshUrl: `${fake.url}/coros/oauth2/refresh-token` }
    const now = Date.UTC(2026, 9, 10)
    const tokens = await exchangeDeviceCode('coros', client, 'coros-code', now)
    expect(tokens).toMatchObject({ accessToken: TOKENS.coros, refreshToken: 'coros-refresh', providerUserId: COROS_OPEN_ID })
    expect(new URLSearchParams(fake.calls.at(-1)!.body).get('client_secret')).toBe(CLIENT.clientSecret)
    const later = Date.UTC(2026, 10, 1)
    expect(await refreshDeviceToken('coros', client, 'coros-refresh', TOKENS.coros, later)).toEqual({ accessToken: TOKENS.coros, refreshToken: 'coros-refresh', expiresAt: new Date(later + 30 * 86_400_000).toISOString() })
  })

  it('reads COROS\' refusal from the result code it sends with a 200', async () => {
    const client = { ...CLIENT, tokenUrl: `${fake.url}/coros/oauth2/accesstoken` }
    expect(exchangeDeviceCode('coros', client, 'wrong-code')).rejects.toThrow('result 5001')
  })

  it('trades and refreshes a Wahoo token with the credentials in the body', async () => {
    const client = { ...CLIENT, tokenUrl: `${fake.url}/wahoo/oauth/token` }
    const tokens = await exchangeDeviceCode('wahoo', client, 'wahoo-code', Date.UTC(2026, 9, 10))
    expect(tokens).toEqual({ accessToken: TOKENS.wahoo, refreshToken: 'wahoo-refresh', expiresAt: new Date(Date.UTC(2026, 9, 10) + 7_200_000).toISOString() })
    expect((await refreshDeviceToken('wahoo', client, 'wahoo-refresh')).accessToken).toBe('wahoo-token-2')
  })

  it('names every provider', () => {
    expect(Object.keys(DEVICE_OAUTH).sort()).toEqual(['coros', 'polar', 'suunto', 'wahoo'])
  })
})

describe('Polar AccessLink', () => {
  const polar = (): PolarAccessLinkDriver => new PolarAccessLinkDriver(TOKENS.polar, { baseUrl: `${fake.url}/polar`, userId: '4751' })

  it('registers the user once, and takes a second registration as done', async () => {
    expect(await polar().registerUser('hq-user-9')).toEqual({ userId: '4751', registered: true })
    expect(JSON.parse(fake.calls.at(-1)!.body)).toEqual({ 'member-id': 'hq-user-9' })
    expect(await polar().registerUser('hq-user-9')).toEqual({ userId: '4751', registered: false })
  })

  it('lists exercises with the start in UTC from the local time and its offset', async () => {
    const [run, ...rest] = await polar().listActivities(RANGE)
    expect(rest).toHaveLength(0)
    expect(run).toMatchObject({ id: '2AC312F', provider: 'polar', sport: 'running_road', startTime: '2026-10-12T06:40:02.000Z', utcOffsetMinutes: 120, durationSeconds: 3723, distanceMeters: 12034.5, averageHeartRate: 148, maxHeartRate: 171, calories: 640, hasFile: true })
  })

  it('downloads the original .fit', async () => {
    const [run] = await polar().listActivities(RANGE)
    const file = await polar().downloadActivityFile(run!)
    expect(file).toMatchObject({ filename: 'polar-2AC312F.fit', format: 'fit' })
    expect([...file!.bytes]).toEqual([...FIT_BYTES])
  })

  it('reads sleep with Polar\'s own score, the night\'s HRV and a day\'s steps', async () => {
    const [night] = await polar().getSleep(RANGE)
    expect(night).toMatchObject({ day: '2026-10-12', totalSleepDuration: 26100, deepSleepDuration: 5400, remSleepDuration: 6300, timeInBed: 28800, efficiency: 91, score: 82, lowestHeartRate: 48, awakeTime: 2700, source: 'polar' })
    expect(await polar().getHRV(RANGE)).toEqual([{ timestamp: '2026-10-12', hrv: 61 }])
    const [today] = await polar().getDailyActivity(RANGE)
    expect(today).toMatchObject({ day: '2026-10-12', steps: 12450, activeCalories: 820, totalCalories: 2650 })
    const hr = await polar().getHeartRate(RANGE)
    expect(hr[0]).toEqual({ timestamp: '2026-10-12T00:02:08', bpm: 61, source: 'polar' })
  })

  it('maps the normalized workouts from the same list', async () => {
    const [workout] = await polar().getWorkouts(RANGE)
    expect(workout).toMatchObject({ id: '2AC312F', day: '2026-10-12', startDatetime: '2026-10-12T06:40:02.000Z', endDatetime: '2026-10-12T07:42:05.000Z', distance: 12034.5, source: 'polar' })
  })

  it('stops on a rate limit and says when it lifts', async () => {
    fake.rateLimited = { 'RateLimit-Usage': '501, 1200', 'RateLimit-Limit': '500, 5000', 'RateLimit-Reset': '420, 50000' }
    const error = await polar().listActivities(RANGE).catch(e => e)
    expect(error).toBeInstanceOf(DeviceCloudRateLimitError)
    expect(error.retryAfterSeconds).toBe(420)
  })

  it('reads a revoked token as a sign-in to redo', async () => {
    const error = await new PolarAccessLinkDriver('revoked', { baseUrl: `${fake.url}/polar` }).listActivities(RANGE).catch(e => e)
    expect(error).toBeInstanceOf(DeviceCloudAuthError)
  })

  it('creates the client\'s webhook with Basic auth and keeps the secret Polar shows once', async () => {
    const hook = await createPolarWebhook({ ...CLIENT, baseUrl: `${fake.url}/polar` }, 'https://hq.example/api/connections/polar/webhook')
    expect(hook).toEqual({ id: 'abdf33', events: ['EXERCISE', 'SLEEP'], url: 'https://hq.example/api/connections/polar/webhook', signatureSecretKey: 'polar-signing-secret' })
    expect(fake.calls.at(-1)!.headers.authorization).toStartWith('Basic ')
    expect(await getPolarWebhooks({ ...CLIENT, baseUrl: `${fake.url}/polar` })).toMatchObject([{ id: 'abdf33', active: true }])
  })

  it('reads ISO 8601 durations', () => {
    expect(isoDurationSeconds('PT2H44M')).toBe(9840)
    expect(isoDurationSeconds('PT1H2M3.5S')).toBe(3723.5)
    expect(isoDurationSeconds('P1DT1S')).toBe(86401)
    expect(isoDurationSeconds('PT')).toBeNull()
    expect(isoDurationSeconds('soon')).toBeNull()
  })
})

describe('Suunto', () => {
  const suunto = (): SuuntoCloudDriver => new SuuntoCloudDriver(TOKENS.suunto, { subscriptionKey: SUUNTO_KEY, baseUrl: `${fake.url}/suunto` })

  it('needs the subscription key', () => {
    expect(() => new SuuntoCloudDriver('x', { subscriptionKey: '' })).toThrow('subscription key')
  })

  it('lists the range\'s workouts with the key and the token on every call', async () => {
    const workouts = await suunto().listActivities(RANGE)
    expect(workouts.map(w => w.id)).toEqual(['5f3a-run'])
    expect(workouts[0]).toMatchObject({ name: 'Lunch run', sport: 'running', startTime: '2026-10-12T06:30:00.000Z', utcOffsetMinutes: 180, durationSeconds: 3012.4, distanceMeters: 10023, averageHeartRate: 151, maxHeartRate: 176, calories: 702, ascentMeters: 88 })
    const call = fake.calls.at(-1)!
    expect(call.headers['ocp-apim-subscription-key']).toBe(SUUNTO_KEY)
    expect(call.query).toMatchObject({ 'since': String(Date.UTC(2026, 9, 1)), 'filter-by-modification-time': 'false' })
  })

  it('downloads the .fit asking for any type, which is all Suunto\'s FIT endpoint answers', async () => {
    const [run] = await suunto().listActivities(RANGE)
    const file = await suunto().downloadActivityFile(run!)
    expect(file?.filename).toBe('suunto-5f3a-run.fit')
    expect(fake.calls.at(-1)!.headers.accept).toBe('*/*')
  })

  it('reads the night, not the nap, on the morning it ended, with its score and HRV', async () => {
    const nights = await suunto().getSleep(RANGE)
    expect(nights).toHaveLength(1)
    expect(nights[0]).toMatchObject({ day: '2026-10-12', totalSleepDuration: 25500, timeInBed: 27900, score: 79, averageHRV: 58, lowestHeartRate: 47, source: 'suunto' })
    expect(await suunto().getHRV(RANGE)).toEqual([{ timestamp: '2026-10-12', hrv: 58 }])
  })

  it('takes the larger step count of the watch and the phone, and energy from joules', async () => {
    const [today] = await suunto().getDailyActivity(RANGE)
    expect(today).toMatchObject({ day: '2026-10-12', steps: 11200, totalCalories: 2500 })
  })
})

describe('COROS', () => {
  const coros = (): CorosCloudDriver => new CorosCloudDriver(TOKENS.coros, { openId: COROS_OPEN_ID, baseUrl: `${fake.url}/coros` })

  it('asks in windows of at most 30 days, with the token and openId in the query', async () => {
    fake.calls.length = 0
    const rides = await coros().listActivities({ startDate: '2026-08-01', endDate: '2026-10-14' })
    const lists = fake.calls.filter(call => call.path === '/coros/v2/coros/sport/list')
    expect(lists.map(call => [call.query.startDate, call.query.endDate])).toEqual([['20260801', '20260830'], ['20260831', '20260929'], ['20260930', '20261014']])
    expect(lists.every(call => call.query.token === TOKENS.coros && call.query.openId === COROS_OPEN_ID)).toBe(true)
    expect(rides.map(r => r.id)).toEqual(['466877262305574912', '466877262305574999'])
    expect(rides[0]).toMatchObject({ sport: 'cycling', startTime: '2026-10-11T06:30:00.000Z', utcOffsetMinutes: 120, durationSeconds: 5400, distanceMeters: 45100.2, hasFile: true })
    expect(rides[1]).toMatchObject({ sport: 'triathlon', hasFile: false, durationSeconds: 7200 })
  })

  it('downloads the recording from its file link, without the token', async () => {
    const [ride] = await coros().listActivities(RANGE)
    const file = await coros().downloadActivityFile(ride!)
    expect(file?.filename).toBe('coros-466877262305574912.fit')
    expect(fake.calls.at(-1)!.path).toBe('/files/coros/466877262305574912.fit')
    expect(fake.calls.at(-1)!.query.token).toBeUndefined()
  })

  it('reads steps, resting heart rate, HRV and the night\'s window in the athlete\'s zone', async () => {
    expect(await coros().getDailyActivity(RANGE)).toMatchObject([{ day: '2026-10-12', steps: 13400 }])
    expect(await coros().getHeartRate(RANGE)).toEqual([{ timestamp: '2026-10-12', bpm: 46, source: 'resting' }])
    expect(await coros().getHRV(RANGE)).toEqual([{ timestamp: '2026-10-12', hrv: 71 }])
    const [night] = await coros().getSleep(RANGE)
    expect(night).toMatchObject({ day: '2026-10-12', bedtimeStart: '2026-10-11T21:30:00.000Z', bedtimeEnd: '2026-10-12T04:45:00.000Z', totalSleepDuration: 26100, averageHeartRate: 50 })
  })

  it('deauthorizes with the token in the query', async () => {
    await coros().deauthorize()
    expect(fake.calls.at(-1)).toMatchObject({ method: 'POST', path: '/coros/oauth2/deauthorize', query: { token: TOKENS.coros } })
    expect(new CorosCloudDriver('stale', { openId: COROS_OPEN_ID, baseUrl: `${fake.url}/coros` }).deauthorize()).rejects.toThrow('result 5006')
  })

  it('reads result 5006 as a sign-in to redo', async () => {
    const error = await new CorosCloudDriver('stale', { openId: COROS_OPEN_ID, baseUrl: `${fake.url}/coros` }).listActivities(RANGE).catch(e => e)
    expect(error).toBeInstanceOf(DeviceCloudAuthError)
    expect(error.code).toBe('5006')
  })
})

describe('Wahoo', () => {
  const wahoo = (pageSize = 2): WahooCloudDriver => new WahooCloudDriver(TOKENS.wahoo, { baseUrl: `${fake.url}/wahoo`, pageSize })

  it('reads the user id webhooks are addressed by', async () => {
    expect(await wahoo().getUserId()).toBe('60462')
  })

  it('pages back until a workout older than the range, and reads the summary\'s strings as numbers', async () => {
    fake.wahooPages = 0
    const rides = await wahoo().listActivities({ startDate: '2026-10-05', endDate: '2026-10-14' })
    expect(rides.map(r => r.id)).toEqual(['1000', '1001', '1002'])
    expect(fake.wahooPages).toBe(2)
    expect(rides[0]).toMatchObject({ sport: 'indoor_cycling', distanceMeters: null, durationSeconds: 3540, averageHeartRate: 142, averagePower: 215, trainingStress: 71, calories: 910, utcOffsetMinutes: 120, hasFile: true })
    expect(rides[1]).toMatchObject({ sport: 'road_cycling', distanceMeters: 40250.3, name: 'Ride 1' })
  })

  it('downloads the .fit from the CDN link', async () => {
    const [ride] = await wahoo().listActivities(RANGE)
    const file = await wahoo().downloadActivityFile(ride!)
    expect(file?.filename).toBe('wahoo-1000.fit')
    expect(fake.calls.at(-1)!.headers.authorization).toBeUndefined()
  })

  it('revokes its access', async () => {
    await wahoo().revokeAccess()
    expect(fake.calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/wahoo/v1/permissions' })
  })

  it('stops on a rate limit, reading Retry-After', async () => {
    fake.rateLimited = { 'Retry-After': '60' }
    const error = await wahoo().listActivities(RANGE).catch(e => e)
    expect(error).toBeInstanceOf(DeviceCloudRateLimitError)
    expect(error.retryAfterSeconds).toBe(60)
  })
})

describe('webhooks', () => {
  const sign = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest('hex')

  it('verifies Polar\'s signature and reads an exercise for its user', () => {
    const body = JSON.stringify({ event: 'EXERCISE', user_id: 4751, entity_id: 'aQlC83', timestamp: '2026-10-12T14:22:24Z', url: 'https://www.polaraccesslink.com/v3/exercises/aQlC83' })
    expect(verifyDeviceWebhook('polar', body, { 'Polar-Webhook-Signature': sign('polar-secret', body), 'Polar-Webhook-Event': 'EXERCISE' }, { signatureSecret: 'polar-secret' })).toBe(true)
    expect(verifyDeviceWebhook('polar', body, { 'Polar-Webhook-Signature': sign('other', body) }, { signatureSecret: 'polar-secret' })).toBe(false)
    expect(verifyDeviceWebhook('polar', body, { 'Polar-Webhook-Signature': sign('polar-secret', body) }, {})).toBe(false)
    expect(parseDeviceWebhook('polar', body)).toEqual({ provider: 'polar', kind: 'activity', type: 'EXERCISE', providerUserIds: ['4751'], entityIds: ['aQlC83'] })
    expect(parseDeviceWebhook('polar', JSON.stringify({ event: 'PING', timestamp: '2026-10-12T14:22:24Z' }))?.kind).toBe('ping')
  })

  it('verifies Suunto\'s signature over the raw body, for the current and the older payload', () => {
    const body = JSON.stringify({ type: 'WORKOUT_CREATED', username: 'suunto-user', workout: { workoutKey: '5f3a-run' } })
    const headers = new Headers({ 'X-HMAC-SHA256-Signature': sign('suunto-secret', body) })
    expect(verifyDeviceWebhook('suunto', body, headers, { signatureSecret: 'suunto-secret' })).toBe(true)
    expect(verifyDeviceWebhook('suunto', `${body} `, headers, { signatureSecret: 'suunto-secret' })).toBe(false)
    expect(parseDeviceWebhook('suunto', body)).toMatchObject({ kind: 'activity', providerUserIds: ['suunto-user'], entityIds: ['5f3a-run'] })
    expect(parseDeviceWebhook('suunto', JSON.stringify({ username: 'u', workoutid: 'w' }))).toMatchObject({ type: 'WORKOUT_CREATED', providerUserIds: ['u'] })
    expect(parseDeviceWebhook('suunto', JSON.stringify({ type: 'SUUNTO_247_SLEEP_CREATED', username: 'u' }))?.kind).toBe('sleep')
  })

  it('checks COROS\' client id and secret headers, and answers with its result code', () => {
    const body = JSON.stringify({ sportDataList: [{ openId: COROS_OPEN_ID, labelId: '1', mode: 8, subMode: 1 }, { openId: COROS_OPEN_ID, labelId: '2', mode: 9, subMode: 1 }] })
    expect(verifyDeviceWebhook('coros', body, { Client: CLIENT.clientId, Secret: CLIENT.clientSecret }, CLIENT)).toBe(true)
    expect(verifyDeviceWebhook('coros', body, { Client: CLIENT.clientId, Secret: 'nope' }, CLIENT)).toBe(false)
    expect(parseDeviceWebhook('coros', body)).toMatchObject({ providerUserIds: [COROS_OPEN_ID], entityIds: ['1', '2'] })
    expect(deviceWebhookReply('coros', true)).toEqual({ status: 200, body: { message: 'ok', result: '0000' } })
    expect(deviceWebhookReply('coros', false).body.result).toBe('1001')
  })

  it('checks Wahoo\'s webhook token in the body', () => {
    const body = JSON.stringify({ event_type: 'workout_summary', webhook_token: 'wahoo-hook', user: { id: 60462 }, workout_summary: { id: 2000, file: { url: 'https://cdn.wahooligan.com/x.fit' }, workout: { id: 1000 } } })
    expect(verifyDeviceWebhook('wahoo', body, {}, { token: 'wahoo-hook' })).toBe(true)
    expect(verifyDeviceWebhook('wahoo', body, {}, { token: 'other' })).toBe(false)
    expect(parseDeviceWebhook('wahoo', body)).toEqual({ provider: 'wahoo', kind: 'activity', type: 'workout_summary', providerUserIds: ['60462'], entityIds: ['1000'] })
  })

  it('reads nothing from a body that is not JSON', () => {
    expect(parseDeviceWebhook('polar', 'nope')).toBeNull()
    expect(verifyDeviceWebhook('wahoo', 'nope', {}, { token: 'x' })).toBe(false)
  })
})

describe('rate-limit headers', () => {
  it('reads seconds, an HTTP date and Polar\'s two windows', () => {
    const now = Date.UTC(2026, 9, 12, 12)
    expect(retryAfterSeconds(new Headers({ 'Retry-After': '30' }), now)).toBe(30)
    expect(retryAfterSeconds(new Headers({ 'Retry-After': new Date(now + 90_000).toUTCString() }), now)).toBe(90)
    expect(retryAfterSeconds(new Headers({ 'RateLimit-Reset': '120, 3000' }), now)).toBe(120)
    expect(retryAfterSeconds(new Headers(), now)).toBeNull()
  })
})
