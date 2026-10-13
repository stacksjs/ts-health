/**
 * Stand-ins for the four watch makers' clouds, written from their published
 * references (Polar AccessLink v3, Suunto's API Zone, COROS' partner reference
 * as public integrations use it, Wahoo's Cloud API): the same paths, the same
 * authentication each insists on, the same answer shapes, and the same ways
 * of saying no. One Bun server answers all of them under a prefix each:
 * /polar, /polar-oauth, /suunto, /suunto-oauth, /coros, /wahoo, /files.
 *
 * Tests read `calls` to see what a driver asked for and set `rateLimited` to
 * make the next API call answer 429.
 */

export const FIT_BYTES: Uint8Array = new Uint8Array([14, 16, 0x6C, 0x08, 0, 0, 0, 0, 0x2E, 0x46, 0x49, 0x54, 0, 0])

export interface FakeCall {
  method: string
  path: string
  query: Record<string, string>
  headers: Record<string, string>
  body: string
}

export interface FakeClouds {
  url: string
  calls: FakeCall[]
  /** Answer the next API call (not OAuth, not a file) with 429 and these headers. */
  rateLimited: Record<string, string> | null
  stop: () => void
  /** Polar users registered (member-id → user id). */
  polarUsers: Map<string, number>
  wahooPages: number
}

export const CLIENT = { clientId: 'hq-client', clientSecret: 'hq-secret', redirectUri: 'https://hq.example/api/connections/x/callback' }
export const TOKENS = { polar: 'polar-token', suunto: 'suunto-token', coros: 'coros-token', wahoo: 'wahoo-token' }
export const SUUNTO_KEY = 'suunto-subscription'
export const COROS_OPEN_ID = 'coros-open-id'

const day = (offset: number): number => Date.UTC(2026, 9, 10, 6, 30) + offset * 86_400_000

function basic(request: Request): [string, string] | null {
  const value = request.headers.get('authorization') || ''
  if (!value.startsWith('Basic '))
    return null
  const [id, secret] = atob(value.slice(6)).split(':')
  return [id || '', secret || '']
}

export function startFakeClouds(): FakeClouds {
  const state: FakeClouds = { url: '', calls: [], rateLimited: null, stop: () => {}, polarUsers: new Map(), wahooPages: 0 }

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const body = request.method === 'GET' ? '' : await request.text()
      state.calls.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(request.headers), body })
      const [, prefix, ...rest] = url.pathname.split('/')
      const path = `/${rest.join('/')}`
      const form = new URLSearchParams(body)

      // --- OAuth token endpoints ---------------------------------------
      if (prefix === 'polar-oauth' && path === '/v2/oauth2/token') {
        const creds = basic(request)
        if (!creds || creds[0] !== CLIENT.clientId || creds[1] !== CLIENT.clientSecret)
          return Response.json({ error: 'invalid_client' }, { status: 401 })
        if (form.get('grant_type') !== 'authorization_code' || form.get('code') !== 'polar-code')
          return Response.json({ error: 'invalid_grant' }, { status: 400 })
        return Response.json({ access_token: TOKENS.polar, token_type: 'bearer', expires_in: 315359999, x_user_id: 4751 })
      }
      if (prefix === 'suunto-oauth' && path === '/oauth/token') {
        const creds = basic(request)
        if (!creds || creds[0] !== CLIENT.clientId || creds[1] !== CLIENT.clientSecret)
          return Response.json({ error: 'unauthorized' }, { status: 401 })
        if (form.get('grant_type') === 'authorization_code' && form.get('code') === 'suunto-code')
          return Response.json({ access_token: TOKENS.suunto, token_type: 'bearer', refresh_token: 'suunto-refresh', expires_in: 86400, user: 'suunto-user' })
        if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'suunto-refresh')
          return Response.json({ access_token: 'suunto-token-2', token_type: 'bearer', refresh_token: 'suunto-refresh-2', expires_in: 86400 })
        return Response.json({ error: 'invalid_grant' }, { status: 400 })
      }
      if (prefix === 'coros' && path === '/oauth2/deauthorize' && request.method === 'POST')
        return Response.json(url.searchParams.get('token') === TOKENS.coros ? { result: '0000', message: 'OK' } : { result: '5006', message: 'access token invalid' })
      if (prefix === 'coros' && path.startsWith('/oauth2/')) {
        if (form.get('client_id') !== CLIENT.clientId || form.get('client_secret') !== CLIENT.clientSecret)
          return Response.json({ result: '1001', message: 'client authentication failed' })
        if (path === '/oauth2/accesstoken' && form.get('code') === 'coros-code')
          return Response.json({ access_token: TOKENS.coros, refresh_token: 'coros-refresh', openId: COROS_OPEN_ID, expires_in: 2592000 })
        if (path === '/oauth2/refresh-token' && form.get('refresh_token') === 'coros-refresh')
          return Response.json({ result: '0000', message: 'OK' })
        return Response.json({ result: '5001', message: 'invalid code' })
      }
      if (prefix === 'wahoo' && path === '/oauth/token') {
        if (form.get('client_id') !== CLIENT.clientId || form.get('client_secret') !== CLIENT.clientSecret)
          return Response.json({ error: 'invalid_client' }, { status: 401 })
        if (form.get('grant_type') === 'authorization_code' && form.get('code') === 'wahoo-code')
          return Response.json({ access_token: TOKENS.wahoo, token_type: 'Bearer', expires_in: 7200, refresh_token: 'wahoo-refresh', scope: 'user_read workouts_read offline_data' })
        if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'wahoo-refresh')
          return Response.json({ access_token: 'wahoo-token-2', token_type: 'Bearer', expires_in: 7200, refresh_token: 'wahoo-refresh-2' })
        return Response.json({ error: 'invalid_grant' }, { status: 400 })
      }

      // --- Files on the makers' CDNs: no token ------------------------
      if (prefix === 'files')
        return new Response(FIT_BYTES, { headers: { 'Content-Type': 'application/octet-stream' } })

      if (state.rateLimited) {
        const headers = state.rateLimited
        state.rateLimited = null
        return new Response('Too Many Requests', { status: 429, headers })
      }

      // --- Polar AccessLink ---------------------------------------------
      // Webhook management authenticates the client, not a user.
      if (prefix === 'polar' && path === '/v3/webhooks') {
        const creds = basic(request)
        if (!creds || creds[0] !== CLIENT.clientId || creds[1] !== CLIENT.clientSecret)
          return new Response(null, { status: 401 })
        if (request.method === 'POST') {
          const hook = JSON.parse(body || '{}')
          return Response.json({ data: { id: 'abdf33', events: hook.events, url: hook.url, signature_secret_key: 'polar-signing-secret' } }, { status: 201 })
        }
        return Response.json({ data: [{ id: 'abdf33', events: ['EXERCISE'], url: 'https://hq.example/api/connections/polar/webhook', active: true }] })
      }
      if (prefix === 'polar') {
        if (request.headers.get('authorization') !== `Bearer ${TOKENS.polar}`)
          return new Response(null, { status: 401 })
        if (path === '/v3/users' && request.method === 'POST') {
          const member = JSON.parse(body || '{}')['member-id']
          if (!member)
            return Response.json({ error: 'member-id missing' }, { status: 400 })
          if (state.polarUsers.has(member))
            return new Response(null, { status: 409 })
          state.polarUsers.set(member, 4751)
          return Response.json({ 'polar-user-id': 4751, 'member-id': member, 'registration-date': '2026-10-10T08:00:00.000Z' })
        }
        if (path === '/v3/users/4751' && request.method === 'DELETE')
          return new Response(null, { status: 204 })
        if (path === '/v3/exercises') {
          return Response.json([
            { id: '2AC312F', upload_time: '2026-10-12T07:40:02.000Z', polar_user: 'https://www.polaraccesslink.com/v3/users/4751', device: 'Polar Vantage V3', start_time: '2026-10-12T08:40:02', start_time_utc_offset: 120, duration: 'PT1H2M3S', calories: 640, distance: 12034.5, heart_rate: { average: 148, maximum: 171 }, training_load: 120.5, sport: 'RUNNING', has_route: true, detailed_sport_info: 'RUNNING_ROAD' },
            { id: 'OLD1', start_time: '2026-09-01T08:00:00', start_time_utc_offset: 120, duration: 'PT30M', sport: 'CYCLING', detailed_sport_info: 'ROAD_BIKING', has_route: false },
          ])
        }
        if (path === '/v3/exercises/2AC312F/fit')
          return new Response(FIT_BYTES, { headers: { 'Content-Type': 'application/vnd.ant.fit' } })
        if (path === '/v3/users/sleep')
          return Response.json({ nights: [{ polar_user: 'https://www.polaraccesslink.com/v3/users/4751', date: '2026-10-12', sleep_start_time: '2026-10-11T23:10:00+02:00', sleep_end_time: '2026-10-12T07:10:00+02:00', device_id: '1111AAAA', continuity: 2.1, continuity_class: 2, light_sleep: 14400, deep_sleep: 5400, rem_sleep: 6300, unrecognized_sleep_stage: 0, sleep_score: 82, total_interruption_duration: 2700, sleep_charge: 3, sleep_goal: 28800, sleep_rating: 3, heart_rate_samples: { '01:00': 52, '01:05': 48, '01:10': 50 } }] })
        if (path === '/v3/users/nightly-recharge')
          return Response.json({ recharges: [{ polar_user: 'https://www.polaraccesslink.com/v3/users/4751', date: '2026-10-12', heart_rate_avg: 55, beat_to_beat_avg: 1090, heart_rate_variability_avg: 61, breathing_rate_avg: 13.8, nightly_recharge_status: 4, ans_charge: 3.2, ans_charge_status: 4 }] })
        if (path === '/v3/users/activities')
          return Response.json([{ start_time: '2026-10-12T00:00:00', end_time: '2026-10-12T23:59:59', active_duration: 'PT2H', calories: 2650, active_calories: 820, steps: 12450, distance_from_steps: 9100 }])
        if (path === '/v3/users/continuous-heart-rate')
          return Response.json({ heart_rates: [{ polar_user: 'https://www.polaraccesslink.com/v3/users/4751', date: '2026-10-12', heart_rate_samples: [{ heart_rate: 61, sample_time: '00:02:08' }, { heart_rate: 58, sample_time: '00:07:08' }] }] })
        return new Response(null, { status: 404 })
      }

      // --- Suunto ---------------------------------------------------------
      if (prefix === 'suunto') {
        if (request.headers.get('ocp-apim-subscription-key') !== SUUNTO_KEY)
          return Response.json({ statusCode: 401, message: 'Access denied due to missing subscription key.' }, { status: 401 })
        if (request.headers.get('authorization') !== `Bearer ${TOKENS.suunto}`)
          return Response.json({ error: 'invalid_token' }, { status: 401 })
        if (path === '/v3/workouts') {
          const since = Number(url.searchParams.get('since'))
          const until = Number(url.searchParams.get('until'))
          const all = [
            { workoutId: 1, workoutKey: '5f3a-run', workoutName: 'Lunch run', activityId: 1, startTime: day(2), totalTime: 3012.4, totalDistance: 10023, totalAscent: 88, timeOffsetInMinutes: 180, energyConsumption: 702, hrdata: { workoutAvgHR: 151, workoutMaxHR: 176 } },
            { workoutId: 2, workoutKey: '5f3a-swim', activityId: 21, startTime: day(-40), totalTime: 1800, totalDistance: 1500, timeOffsetInMinutes: 180 },
          ]
          return Response.json({ error: null, metadata: { workoutcount: '2' }, payload: all.filter(w => w.startTime >= since && w.startTime <= until) })
        }
        if (path === '/v3/workouts/5f3a-run/fit') {
          if ((request.headers.get('accept') || '').includes('fit'))
            return new Response('Internal Server Error', { status: 500 })
          return new Response(FIT_BYTES, { headers: { 'Content-Type': 'application/octet-stream' } })
        }
        if (path === '/247samples/sleep')
          return Response.json([{ timestamp: '2026-10-12T07:05:00.000+03:00', entryData: { SleepId: 9001, BedtimeStart: '2026-10-11T23:20:00.000+03:00', BedtimeEnd: '2026-10-12T07:05:00.000+03:00', Duration: 27900, DeepSleepDuration: 5400, LightSleepDuration: 15000, REMSleepDuration: 5100, WakeAfterSleepOnsetDuration: 900, HRAvg: 54, HRMin: 47, AvgHRV: 58, SleepQualityScore: 79, IsNap: false } }, { timestamp: '2026-10-12T15:00:00.000+03:00', entryData: { BedtimeStart: '2026-10-12T14:30:00.000+03:00', BedtimeEnd: '2026-10-12T15:00:00.000+03:00', Duration: 1800, IsNap: true } }])
        if (path === '/247samples/daily-activity-statistics')
          return Response.json([{ Name: 'StepCount', Aggregation: 'sum', Sources: [{ Name: 'Suunto Race', Samples: [{ TimeISO8601: '2026-10-12T00:00:00.000+03:00', Value: 11200 }] }, { Name: 'Suunto app', Samples: [{ TimeISO8601: '2026-10-12T00:00:00.000+03:00', Value: 9800 }] }] }, { Name: 'EnergyConsumption', Aggregation: 'sum', Sources: [{ Name: 'Suunto Race', Samples: [{ TimeISO8601: '2026-10-12T00:00:00.000+03:00', Value: 10460000 }] }] }])
        return new Response(null, { status: 404 })
      }

      // --- COROS ------------------------------------------------------------
      if (prefix === 'coros') {
        if (url.searchParams.get('token') !== TOKENS.coros || url.searchParams.get('openId') !== COROS_OPEN_ID)
          return Response.json({ result: '5006', message: 'access token invalid' })
        const start = url.searchParams.get('startDate') || ''
        const end = url.searchParams.get('endDate') || ''
        const days = (Date.parse(`${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6)}`) - Date.parse(`${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6)}`)) / 86_400_000
        if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end) || days > 30)
          return Response.json({ result: '1019', message: 'date range invalid' })
        const within = (seconds: number) => {
          const ymd = new Date(seconds * 1000).toISOString().slice(0, 10).replace(/-/g, '')
          return ymd >= start && ymd <= end
        }
        if (path === '/v2/coros/sport/list') {
          const all = [
            { labelId: '466877262305574912', mode: 9, subMode: 1, startTime: day(1) / 1000, endTime: day(1) / 1000 + 5400, startTimezone: 8, endTimezone: 8, distance: 45100.2, duration: 5400, fitUrl: `${state.url}/files/coros/466877262305574912.fit` },
            { labelId: '466877262305574999', mode: 13, subMode: 1, startTime: day(-50) / 1000, endTime: day(-50) / 1000 + 7200, startTimezone: 8, endTimezone: 8 },
          ]
          return Response.json({ result: '0000', message: 'OK', data: all.filter(w => within(w.startTime)) })
        }
        if (path === '/coros/daily/query') {
          const rows = [{ happenDay: '20261012', step: 13400, calorie: 2300000, rhr: 46, ppgHrv: 71, sleepAvgHr: 50, sleepStartTime: '2026-10-11 23:30:00', sleepEndTime: '2026-10-12 06:45:00', startTimezone: 8, endTimezone: 8 }]
          return Response.json({ result: '0000', message: 'OK', data: rows.filter(row => row.happenDay >= start && row.happenDay <= end) })
        }
        return Response.json({ result: '1004', message: 'unknown path' })
      }

      // --- Wahoo ----------------------------------------------------------
      if (prefix === 'wahoo') {
        if (request.headers.get('authorization') !== `Bearer ${TOKENS.wahoo}`)
          return Response.json({ error: 'Not authorized' }, { status: 401 })
        if (path === '/v1/user')
          return Response.json({ id: 60462, height: '1.8288', weight: '79.3786', first: 'Wahoo', last: 'Fitness', email: 'athlete@example.com', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' })
        if (path === '/v1/permissions' && request.method === 'DELETE')
          return Response.json({ success: true })
        if (path === '/v1/workouts') {
          state.wahooPages++
          const page = Number(url.searchParams.get('page') || 1)
          const perPage = Number(url.searchParams.get('per_page') || 30)
          const workouts = Array.from({ length: 5 }, (_, i) => {
            const starts = new Date(day(3) - i * 3 * 86_400_000).toISOString()
            return {
              id: 1000 + i,
              starts,
              minutes: 60,
              name: `Ride ${i}`,
              plan_id: null,
              workout_token: `token-${i}`,
              workout_type_id: i === 0 ? 61 : 15,
              created_at: starts,
              updated_at: starts,
              workout_summary: {
                id: 2000 + i,
                ascent_accum: '412.0',
                cadence_avg: '88.0',
                calories_accum: '910.0',
                distance_accum: i === 0 ? '0.0' : '40250.3',
                duration_active_accum: '3540.0',
                duration_paused_accum: '60.0',
                duration_total_accum: '3600.0',
                heart_rate_avg: '142.0',
                power_bike_np_last: '231.0',
                power_bike_tss_last: '71.0',
                power_avg: '215.0',
                speed_avg: '11.4',
                work_accum: '761000.0',
                time_zone: 'Europe/Berlin',
                manual: false,
                edited: false,
                file: { url: `${state.url}/files/wahoo/${1000 + i}.fit` },
                created_at: starts,
                updated_at: starts,
              },
            }
          })
          const slice = workouts.slice((page - 1) * perPage, page * perPage)
          return Response.json({ workouts: slice, total: workouts.length, page, per_page: perPage, order: 'descending', sort: 'starts' })
        }
        return Response.json({ error: 'Not found' }, { status: 404 })
      }

      return new Response('no such provider', { status: 404 })
    },
  })

  state.url = `http://127.0.0.1:${server.port}`
  state.stop = () => server.stop(true)
  return state
}
