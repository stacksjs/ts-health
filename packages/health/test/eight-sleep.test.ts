import { describe, expect, it } from 'bun:test'
import { createEightSleepClient, createEightSleepDriver, EightSleepError, normalizeEightSleepNight, validateEightSleepCommand } from '../src/eight-sleep'
import type { EightSleepCommand } from '../src/eight-sleep'

const report = {
  day: '2026-10-13', presenceStart: '2026-10-13T22:00:00Z', presenceEnd: '2026-10-14T06:00:00Z',
  presenceDuration: 28800, sleepDuration: 27000, deepDuration: 5400, remDuration: 7200, lightDuration: 14400, score: 92,
  sleepFitnessScore: { total: 90 }, sleepQualityScore: { total: 88, hrv: { current: 62 }, respiratoryRate: { average: 13.5 }, tempBedC: { average: 25 }, tempRoomC: { average: 19 } },
  sleepRoutineScore: { total: 94, latencyAsleepSeconds: { current: 600 } }, tnt: 8,
  sessions: [{ stages: [{ stage: 'deep', start: '2026-10-13T23:00:00Z', end: '2026-10-13T23:30:00Z' }], timeseries: {
    heartRate: [['2026-10-14T01:00:00Z', 50], ['2026-10-14T02:00:00Z', 54], ['invalid', 0]],
    tempBedC: [['2026-10-14T01:00:00Z', 24]], hrv: [['2026-10-14T01:00:00Z', 60]],
  } }],
}
function fixture(overrides: (url: URL, init?: RequestInit) => Response | undefined = () => undefined) {
  const calls: Array<{ url: URL, method: string, body: any }> = []
  const fetch = async (value: string, init?: RequestInit) => {
    const url = new URL(value)
    calls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
    const custom = overrides(url, init)
    if (custom) return custom
    const path = url.pathname
    if (path === '/v1/tokens') return Response.json({ access_token: 'private-fixture-token', userId: 'self', expires_in: 3600 })
    if (init?.method && init.method !== 'GET') return new Response(null, { status: 204 })
    if (url.hostname === 'client-api.8slp.net') {
      if (path === '/v1/users/self') return Response.json({ user: { userId: 'self', currentDevice: { id: 'pod', side: 'left' }, devices: ['pod'] } })
      if (path === '/v1/devices/pod') return Response.json({ result: { leftUserId: 'self', rightUserId: 'partner', deviceName: 'Bedroom', features: ['cooling', 'elevation'], hasWater: false, needsPriming: true, priming: false, ledBrightnessLevel: 20 } })
      if (path.endsWith('/trends')) return Response.json({ days: [report] })
    }
    if (path === '/v1/users/self/temperature') return Response.json({ currentState: { type: 'smart' }, currentLevel: -20, currentDeviceLevel: -10, smart: { bedTimeLevel: -10, initialSleepLevel: -30, finalSleepLevel: 10, otherSetting: true } })
    if (path === '/v2/users/self/alarms') return Response.json({ alarms: [{ id: 'alarm', time: '07:00:00', enabled: true, repeat: { enabled: true, weekDays: { monday: true } }, vibration: { level: 50 }, nextTimestamp: '2099-10-14T07:00:00Z', endTimestamp: '2099-10-14T07:30:00Z' }] })
    if (path.endsWith('/temperature/all')) return Response.json({ devices: [{ device: { specialization: 'pod', deviceId: 'pod' } }, { device: { specialization: 'pillow', side: 'left' }, currentLevel: -5, currentState: { type: 'smart' } }] })
    if (path.endsWith('/base')) return Response.json({ left: { torso: { currentAngle: 12 }, leg: { currentAngle: 4 }, inSnoreMitigation: true, preset: { name: 'sleep' } } })
    if (path.endsWith('/audio/player')) return Response.json({ state: 'Paused', volume: 20, currentTrack: { id: 'rain' } })
    if (path.endsWith('/audio/tracks')) return Response.json({ tracks: [{ id: 'rain', name: 'Rain' }] })
    return new Response(null, { status: 404 })
  }
  return { calls, fetch, client: createEightSleepClient({ email: 'self@example.test', password: 'private-fixture-password', timezone: 'America/Los_Angeles', fetch }) }
}
const range = { startDate: '2026-10-01', endDate: '2026-10-14' }

describe('Eight Sleep report normalization', () => {
  it('keeps the provider day, seconds, scores, hypnogram and measured biometrics', () => {
    const night = normalizeEightSleepNight(report)!
    expect(night.day).toBe('2026-10-13')
    expect(night.sleepSeconds).toBe(27000)
    expect(night.awakeSeconds).toBe(1800)
    expect(night.efficiency).toBe(93.75)
    expect(night.heartRate).toBe(52)
    expect(night.hrv).toBe(62)
    expect(night.stages[0]?.duration).toBe(1800)
    expect(night.report.sleepFitnessScore).toEqual({ total: 90 })
  })
  it('leaves missing measurements unknown and rejects impossible calendar days', () => {
    const night = normalizeEightSleepNight({ day: '2026-10-13', hrv: 'None', sessions: [{ timeseries: { heartRate: [['2026-10-14T01:00:00Z', 'None']] } }] })!
    expect(night.sleepSeconds).toBeNull()
    expect(night.score).toBeNull()
    expect(night.heartRate).toBeNull()
    expect(night.bedTemperatureC).toBeNull()
    expect(normalizeEightSleepNight({ day: '2026-02-30' })).toBeNull()
  })
})

describe('Eight Sleep authenticated cloud client', () => {
  it('returns a self-scoped, capability-aware dashboard without passwords or session tokens', async () => {
    const { client, calls } = fixture()
    const dashboard = await client.getDashboard(range)
    expect(dashboard.pod.name).toBe('Bedroom')
    expect(dashboard.pod.hasWater).toBe(false)
    expect(dashboard.base?.snoreMitigation).toBe(true)
    expect(dashboard.capabilities).toMatchObject({ alarms: true, pillow: true, base: true, audio: true })
    expect(dashboard.nights[0]?.sleepSeconds).toBe(27000)
    expect(JSON.stringify(dashboard)).not.toContain('private-fixture')
    expect(calls.filter(call => call.url.pathname === '/v1/tokens')).toHaveLength(1)
    expect(calls.some(call => /users\/partner/.test(call.url.pathname))).toBe(false)
    expect(calls.filter(call => call.method !== 'GET')).toHaveLength(1)
  })
  it('keeps sleep and temperature usable when the account cannot use alarms', async () => {
    const { client } = fixture(url => url.pathname.endsWith('/alarms') ? new Response('subscription and sensitive token', { status: 403 }) : undefined)
    const dashboard = await client.getDashboard(range)
    expect(dashboard.capabilities.alarms).toBe(false)
    expect(dashboard.capabilities.temperature).toBe(true)
    expect(dashboard.nights).toHaveLength(1)
    expect(dashboard.unavailable).toContain('alarms')
  })
  it('does not attach a partner’s pillow or a pillow belonging to another Pod', async () => {
    for (const devices of [
      [{ device: { specialization: 'pod', deviceId: 'pod' } }, { device: { specialization: 'pillow', side: 'right' } }],
      [{ device: { specialization: 'pod', deviceId: 'other-pod' } }, { device: { specialization: 'pillow', side: 'left' } }],
    ]) {
      const { client } = fixture(url => url.pathname.endsWith('/temperature/all') ? Response.json({ devices }) : undefined)
      expect((await client.getDashboard(range)).capabilities.pillow).toBe(false)
      await expect(client.execute({ action: 'pillow-power', enabled: true })).rejects.toThrow('No pillow')
    }
  })
  it('reports rate limits and never echoes provider response bodies', async () => {
    const { client } = fixture(url => url.pathname === '/v1/tokens' ? new Response('password=private token=private', { status: 429, headers: { 'retry-after': '90' } }) : undefined)
    try { await client.authenticate(); throw new Error('expected refusal') }
    catch (cause) {
      expect(cause).toBeInstanceOf(EightSleepError)
      expect((cause as EightSleepError).retryAfterSeconds).toBe(90)
      expect(String(cause)).not.toContain('password=')
    }
  })
  it('paginates long histories in bounded windows and memoizes HealthDriver reads', async () => {
    const { fetch, calls } = fixture()
    const driver = createEightSleepDriver({ email: 'self@example.test', password: 'private', fetch })
    const options = { startDate: '2026-08-01', endDate: '2026-10-14' }
    await driver.getDailySleep(options)
    await driver.getSleep(options)
    await driver.getHRV(options)
    expect(calls.filter(call => call.url.pathname.endsWith('/trends'))).toHaveLength(3)
    expect(driver.supportedMetrics.has('readiness')).toBe(false)
    expect(await driver.getReadiness()).toEqual([])
    expect(await driver.getBodyTemperature()).toEqual([])
  })
  it('powers on before a manual temperature and writes its timer using seconds', async () => {
    const { client, calls } = fixture()
    await client.execute({ action: 'temperature', level: -30, durationSeconds: 3600 })
    expect(calls.filter(call => call.method === 'PUT').map(call => call.body)).toEqual([
      { currentState: { type: 'smart' } }, { currentLevel: -30 }, { timeBased: { level: -30, durationSeconds: 3600 } },
    ])
  })
  it('edits a schedule without wiping the other Autopilot settings', async () => {
    const { client, calls } = fixture()
    await client.execute({ action: 'schedule', stage: 'initialSleepLevel', level: -40 })
    expect(calls.at(-1)?.body).toEqual({ smart: { bedTimeLevel: -10, initialSleepLevel: -40, finalSleepLevel: 10, otherSetting: true } })
  })
  it('preserves repeating alarms and never sends server-computed timestamps back', async () => {
    const { client, calls } = fixture()
    await client.execute({ action: 'alarm-time', alarmId: 'alarm', time: '06:45' })
    expect(calls.at(-1)?.body).toMatchObject({ time: '06:45:00', repeat: { enabled: true }, vibration: { level: 50 } })
    expect(calls.at(-1)?.body).not.toHaveProperty('nextTimestamp')
    await expect(client.execute({ action: 'alarm-dismiss', alarmId: 'partner-alarm' })).rejects.toThrow('not linked')
  })
  it('does not apply away mode to the wrong bed when selecting the current bed fails', async () => {
    const { client, calls } = fixture((url, init) => url.pathname.endsWith('/current-device') && init?.method === 'PUT' ? new Response(null, { status: 409 }) : undefined)
    await expect(client.execute({ action: 'away', enabled: true })).rejects.toThrow()
    expect(calls.some(call => call.url.pathname.endsWith('/away-mode'))).toBe(false)
  })
  it('does not replay a physical write after a provider failure', async () => {
    const { client, calls } = fixture((url, init) => url.pathname.endsWith('/temperature') && init?.method === 'PUT' ? new Response(null, { status: 401 }) : undefined)
    await expect(client.execute({ action: 'power', enabled: true })).rejects.toThrow('expired')
    expect(calls.filter(call => call.method === 'PUT')).toHaveLength(1)
  })
  it('uses the observed payloads for accessory, maintenance, repeating alarm and side controls', async () => {
    const commands: Array<[EightSleepCommand, string, Record<string, unknown>]> = [
      [{ action: 'side', side: 'solo' }, '/v1/users/self/current-device', { id: 'pod', side: 'solo' }],
      [{ action: 'led', level: 0 }, '/v1/devices/pod', { ledBrightnessLevel: 0 }],
      [{ action: 'prime' }, '/v1/devices/pod/priming/tasks', { notifications: { users: ['self'], meta: 'rePriming' } }],
      [{ action: 'base-angle', headAngle: 10, feetAngle: 5 }, '/v1/users/self/base/angle', { deviceId: 'pod', deviceOnline: true, enableOfflineMode: false, torsoAngle: 10, legAngle: 5 }],
      [{ action: 'base-preset', preset: 'reading' }, '/v1/users/self/base/angle', { preset: 'reading', enableOfflineMode: false }],
      [{ action: 'pillow-temperature', level: -10 }, '/v1/users/self/temperature/pillow', { currentLevel: -10 }],
      [{ action: 'pillow-power', enabled: false }, '/v1/users/self/temperature/pillow', { currentState: { type: 'off' } }],
      [{ action: 'audio-state', state: 'Playing' }, '/v1/users/self/audio/player/state', { state: 'Playing' }],
      [{ action: 'audio-volume', volume: 30 }, '/v1/users/self/audio/player/volume', { volume: 30 }],
      [{ action: 'audio-track', trackId: 'rain' }, '/v1/users/self/audio/player/currentTrack', { id: 'rain', stopCriteria: 'ManualStop' }],
      [{ action: 'alarm-toggle', alarmId: 'alarm', enabled: false }, '/v1/users/self/alarms/alarm', { enabled: false, time: '07:00:00' }],
      [{ action: 'alarm-repeat', alarmId: 'alarm', days: ['monday', 'friday'] }, '/v1/users/self/alarms/alarm', { repeat: { enabled: true, weekDays: { monday: true, tuesday: false, friday: true } } }],
      [{ action: 'alarm-snooze', alarmId: 'alarm', minutes: 9 }, '/v1/users/self/alarms/alarm/snooze', { snoozeMinutes: 9, ignoreDeviceErrors: false }],
      [{ action: 'alarm-dismiss', alarmId: 'alarm' }, '/v1/users/self/alarms/alarm/dismiss', { ignoreDeviceErrors: false }],
      [{ action: 'alarm-create', time: '06:45', enabled: true, vibration: true, vibrationLevel: 50, vibrationPattern: 'RISE', thermal: true, thermalLevel: 20 }, '/v1/users/self/alarms', { time: '06:45:00', vibration: { powerLevel: 50, pattern: 'RISE' }, thermal: { level: 20 } }],
    ]
    for (const [command, path, body] of commands) {
      const { client, calls } = fixture()
      await client.execute(command)
      expect(calls.at(-1)?.url.pathname).toBe(path)
      expect(calls.at(-1)?.body).toMatchObject(body)
    }
  })
  it('rejects malformed settings before authentication or hardware access', () => {
    const { client, calls } = fixture()
    for (const command of [{ action: 'temperature', level: 101 }, { action: 'base-angle', headAngle: 46, feetAngle: 0 }, { action: 'alarm-time', alarmId: '../partner', time: '25:00' }, { action: 'power', enabled: 'true' }, { action: 'firmware-reset' }]) {
      expect(() => client.execute(command)).toThrow()
    }
    expect(calls).toHaveLength(0)
    expect(validateEightSleepCommand({ action: 'alarm-time', alarmId: 'alarm', time: '06:45' })).toEqual({ action: 'alarm-time', alarmId: 'alarm', time: '06:45:00' })
  })
})
