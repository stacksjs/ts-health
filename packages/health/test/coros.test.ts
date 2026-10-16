import { afterEach, expect, it, setSystemTime } from 'bun:test'
import { CorosCloudDriver, DeviceCloudAuthError, exchangeDeviceCode } from '../src/device-clouds'

afterEach(() => setSystemTime())

it('refreshes cached COROS daily readings and retries a failed daily request', async () => {
  let steps = 100
  let broken = false
  let calls = 0
  const server = Bun.serve({ port: 0, fetch: () => {
    calls++
    return Response.json({ result: '0000', data: broken ? {} : { dailyList: [{ happenDay: 20261016, step: steps }] } })
  } })
  try {
    setSystemTime(new Date('2026-10-16T12:00:00Z'))
    const driver = new CorosCloudDriver('token', { openId: 'user', baseUrl: server.url.toString() })
    const range = { startDate: '2026-10-16', endDate: '2026-10-16' }
    expect((await driver.getDailyActivity(range))[0]?.steps).toBe(100)
    steps = 200
    setSystemTime(new Date('2026-10-16T12:01:01Z'))
    expect((await driver.getDailyActivity(range))[0]?.steps).toBe(200)
    broken = true
    setSystemTime(new Date('2026-10-16T12:02:02Z'))
    await expect(driver.getDailyActivity(range)).rejects.toThrow('dailyList')
    broken = false
    expect((await driver.getDailyActivity(range))[0]?.steps).toBe(200)
    expect(calls).toBe(4)
  }
  finally { server.stop(true) }
})

it('refuses partial deletion, a missing result and invalid COROS credentials in successful HTTP responses', async () => {
  let reply: unknown = { result: '0000', data: { successIdList: [1], failIdList: [2] } }
  const server = Bun.serve({ port: 0, fetch: () => Response.json(reply) })
  try {
    const driver = new CorosCloudDriver('token', { openId: 'user', baseUrl: server.url.toString() })
    await expect(driver.deleteTrainingWorkouts([1, 2])).rejects.toThrow('did not remove every')
    reply = { data: { successIdList: [1, 2] } }
    await expect(driver.deleteTrainingWorkouts([1, 2])).rejects.toThrow('result missing')
    reply = { result: '5010' }
    await expect(driver.deleteTrainingWorkouts([1, 2])).rejects.toBeInstanceOf(DeviceCloudAuthError)
    reply = { access_token: 'token' }
    await expect(exchangeDeviceCode('coros', { clientId: 'client', clientSecret: 'secret', redirectUri: 'https://hq.example/callback', tokenUrl: server.url.toString() }, 'code')).rejects.toThrow('openId')
  }
  finally { server.stop(true) }
})
