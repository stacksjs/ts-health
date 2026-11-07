import { afterAll, describe, expect, test } from 'bun:test'
import { CorosMcpClient, CorosMcpDriver, corosMcpAuthorizeUrl, corosMcpDays, corosMcpScheduledId, corosMcpText, parseCorosMcpActivities, parseCorosFitness } from '../src/drivers/coros-mcp'

const calls: any[] = []
let failed = false
const server = Bun.serve({ port: 0, async fetch(request) {
  expect(request.headers.get('authorization')).toBe('Bearer test-token')
  const body = await request.json() as any
  calls.push(body)
  if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
  if (failed) return Response.json({ access_token: 'never-print-me' }, { status: 429, headers: { 'Retry-After': '42' } })
  const text = body.params?.name === 'queryDailyHealthData' ? 'Daily Health Data — Last 7 days | HRV Baseline: 42 ms\n\n--- 20261016 ---\nSteps: 0 | Calories: 0 kcal | Exercise: 0 min'
    : body.params?.name === 'querySleepOverview' ? 'Sleep Overview\n\n2026-10-15\nSleep Score: 91\nDaily Sleep: 7h 57min (incl. naps)'
      : body.params?.name === 'queryFitnessAssessmentOverview' ? 'Running Fitness: 82.5\nVO2max: 55.2 ml/kg/min'
        : body.params?.name === 'queryTrainingLoadAssessment' ? 'Base Fitness: 60\nTraining Load: 0'
          : body.params?.name === 'queryRecoveryStatus' ? 'Recovery: 80%'
      : 'No sport records found from 2000-01-01 to 2026-10-21.'
  const answer = { jsonrpc: '2.0', id: body.id, result: body.method === 'initialize' ? { protocolVersion: '2025-06-18' } : { content: [{ type: 'text', text: JSON.stringify(text) }], isError: false } }
  return new Response(`event: message\r\ndata: ${JSON.stringify(answer)}\r\n\r\n`, { headers: { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': 'test-session' } })
} })
afterAll(() => server.stop(true))

describe('COROS public MCP', () => {
  test('uses regional OAuth, resource binding and S256 PKCE without a client secret', () => {
    const url = new URL(corosMcpAuthorizeUrl({ region: 'eu', clientId: 'public-client', redirectUri: 'https://hq.training/api/connections/coros/callback', state: 'state', challenge: 'challenge' }))
    expect(url.origin).toBe('https://mcpeu.coros.com')
    expect(url.searchParams.get('resource')).toBe('https://mcpeu.coros.com/mcp')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.has('client_secret')).toBe(false)
  })
  test('unwraps real COROS text and keeps the baseline out of daily measurements', () => {
    expect(corosMcpText({ content: [{ type: 'text', text: '"hello\\nworld"' }] })).toBe('hello\nworld')
    expect(corosMcpDays('HRV Baseline: 42 ms\n--- 20261016 ---\nSteps: 0')).toEqual([{ day: '2026-10-16', text: 'Steps: 0' }])
    expect(corosMcpScheduledId('Workout created\nidInPlan: 9\nDone')).toBe('9')
  })
  test('initializes a session once, handles SSE and retains genuine zero daily values', async () => {
    const driver = new CorosMcpDriver('test-token', { region: 'us', endpoint: server.url.toString() })
    expect(driver.supportedMetrics.has('dailySleep')).toBe(true)
    expect(driver.supportedMetrics.has('sleep')).toBe(false)
    expect(await driver.listActivities()).toEqual([])
    expect(await driver.getDailyActivity()).toEqual([{ day: '2026-10-16', score: 0, steps: 0, activeCalories: 0, totalCalories: 0, contributors: {}, source: 'coros' }])
    expect((await driver.getDailySleep())[0]).toEqual({ day: '2026-10-15', score: 91, contributors: { totalSleep: 7.95 }, source: 'coros' })
    expect(calls.filter(call => call.method === 'initialize')).toHaveLength(1)
  })
  test('reads current assessments through the authenticated MCP transport', async () => {
    const driver = new CorosMcpDriver('test-token', { region: 'us', endpoint: server.url.toString() })
    expect(driver.supportedMetrics.has('fitness')).toBe(true)
    const metrics = await driver.getFitness({ endDate: '2026-11-07' })
    expect(metrics.map(row => row.value)).toEqual([82.5, 55.2, 60, 0, 80])
    expect(metrics.every(row => row.day === '2026-11-07' && row.observed)).toBe(true)
  })
  test('refuses incomplete activity metadata rather than losing or misdating history', () => {
    expect(() => parseCorosMcpActivities('Sport Records\n1. Running — 2026-10-21\nDuration: 1:00:00')).toThrow('missing a stable identifier')
    const rows = parseCorosMcpActivities('Sport Records\n1. Running — 2026-10-21\nlabelId: recorded-1\nsportType: 100\nstartTimestamp: 1792598400000\nDuration: 1:00:00\nDistance: 10.2 km')
    expect(rows[0]?.id).toBe('recorded-1')
    expect(rows[0]?.durationSeconds).toBe(3600)
    expect(rows[0]?.distanceMeters).toBe(10200)
  })
  test('never leaks provider response bodies and exposes retry timing', async () => {
    failed = true
    const client = new CorosMcpClient('test-token', { region: 'us', endpoint: server.url.toString() })
    try { await client.call('queryTrainingSchedule'); throw new Error('Expected rate limit') }
    catch (error: any) {
      expect(error.name).toBe('DeviceCloudRateLimitError')
      expect(error.retryAfterSeconds).toBe(42)
      expect(error.message).not.toContain('never-print-me')
    }
    finally { failed = false }
  })
})

test('fitness assessments retain original meanings and never copy profile identities', () => {
  const rows = parseCorosFitness('Running Fitness: 82.5\nBase Fitness: 60\nVO2max: 55.2 ml/kg/min\nTraining Load: 0\nRecovery: 80%\nUser ID: secret-account', '2026-11-07')
  expect(rows.map(row => [row.metric, row.value, row.kind])).toEqual([['running_fitness', 82.5, 'fitness'], ['base_fitness', 60, 'load'], ['vo2_max', 55.2, 'capacity'], ['training_load', 0, 'load'], ['recovery', 80, 'recovery']])
  expect(rows.every(row => row.observed && row.day === '2026-11-07')).toBe(true)
  expect(JSON.stringify(rows)).not.toContain('secret-account')
  expect(parseCorosFitness('- **Running Fitness**: 82.5\n- **Recovery**: 80%', '2026-11-07').map(row => row.value)).toEqual([82.5, 80])
  expect(parseCorosFitness('unrelated 88.5 and VO2max: not-a-number', '2026-11-07')).toEqual([])
})
