import { describe, expect, it } from 'bun:test'
import { decodeLarqResponse, larqClockRequest, larqDeviceId, larqLiveDistance, larqLogRequest, larqRequest, larqTofLog } from '../src/larq/protocol'
import { LarqBleClient } from '../src/larq/client'
import { larqIntake, larqVolumeMl } from '../src/larq/intake'

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'))
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex')
const logs = '0d0300000010011a5e0a28747970652e676f6f676c65617069732e636f6d2f526573706f6e7365476574436170546f664c6f6712320a1708e4f7c4d50610021d7800000025641900002d00421c460a1708c8f8c4d50610011d8700000025d41700002d00191c46'

describe('PureVis 2 Bluetooth interoperability', () => {
  it('encodes documented wire requests without dependencies or framing', () => {
    expect(hex(larqRequest(1, 'RequestGetCapUiState'))).toBe('0d01000000122a0a28747970652e676f6f676c65617069732e636f6d2f5265717565737447657443617055695374617465')
    expect(hex(larqClockRequest(7, 1790000000000))).toBe('0d07000000123a0a2d747970652e676f6f676c65617069732e636f6d2f5265717565737453657443617054696d6553657474696e677312090a070880d8c1a28c34')
    expect(hex(larqLogRequest(3, 1789999999))).toBe('0d0300000012380a27747970652e676f6f676c65617069732e636f6d2f52657175657374476574436170546f664c6f67120d0a0b08fff6c4d5061505000000')
  })
  it('decodes real wire structures, empty history and unsupported firmware', () => {
    expect(larqTofLog(decodeLarqResponse(bytes(logs)))).toEqual([
      { timestamp: 1790000100, trigger: 2, distanceMm: 120, signal: 6500 },
      { timestamp: 1790000200, trigger: 1, distanceMm: 135, signal: 6100 },
    ])
    expect(larqLiveDistance(decodeLarqResponse(bytes('0d0600000010011a3a0a2a747970652e676f6f676c65617069732e636f6d2f526573706f6e7365476574436170546f665374617465120c0a0a0d2a00000015e02e0000')))).toBe(42)
    expect(larqTofLog(decodeLarqResponse(bytes('0d010000001001')))).toEqual([])
    expect(() => larqTofLog(decodeLarqResponse(bytes('0d090000001002')))).toThrow('firmware')
  })
  it('rejects every truncated prefix of a packet and oversized/malformed messages', () => {
    const packet = bytes(logs)
    for (let i = 0; i < packet.length; i++) {
      if (i == 7) continue // Valid SUCCESS envelope with no body: end of history.
      // Complete envelope prefixes are valid protobuf, but never a log page.
      expect(() => larqTofLog(decodeLarqResponse(packet.slice(0, i)))).toThrow()
    }
    expect(() => decodeLarqResponse(new Uint8Array(4097))).toThrow('Oversized')
    expect(() => larqLogRequest(1, 0, 7)).toThrow()
    expect(larqDeviceId('LARQ_00000000001')).toBe('0000000000000001')
    expect(() => larqDeviceId('other bottle')).toThrow()
  })
  it('serialises requests, recovers after failure, and checks echoed ids', async () => {
    let active = 0, peak = 0
    const client = new LarqBleClient({ async exchange(request) {
      active++; peak = Math.max(peak, active)
      await Bun.sleep(1)
      active--
      return Uint8Array.from([...request.slice(0, 5), 16, request[1] === 1 ? 2 : 1])
    } })
    const result = await Promise.allSettled([client.setClock(), client.readLogs(0)])
    expect(result[0]!.status).toBe('rejected')
    expect(result[1]).toEqual({ status: 'fulfilled', value: [] })
    expect(peak).toBe(1)
    await expect(new LarqBleClient({ exchange: async () => bytes('0dff0000001001') }).setClock()).rejects.toThrow('another request')
  })
  it('persists each page before moving the history cursor and rejects backward pages', async () => {
    const saved: number[] = []
    const client = new LarqBleClient({ exchange: async request => {
      const value = bytes(logs); value.set(request.slice(1, 5), 1); return value
    } })
    expect((await client.readLogs(1789999999, async page => { saved.push(page.length) })).length).toBe(2)
    expect(saved).toEqual([2])
    await expect(client.readLogs(1790000100)).rejects.toThrow('non-advancing')
    await expect(client.readLogs(0, async () => { throw new Error('disk full') })).rejects.toThrow('disk full')
  })
})

const profile = { capacityMl: 680 as const, calibration: [{ distanceMm: 20, volumeMl: 680 }, { distanceMm: 190, volumeMl: 0 }] }
const reading = (timestamp: number, distanceMm: number) => ({ timestamp, distanceMm, trigger: 2, signal: 6500 })
const start = 1790000000
it('accumulates small sips, deduplicates retries and never counts refills or unreadable gaps', () => {
  const history = [reading(start, 20), reading(start + 10, 22), reading(start + 20, 24), reading(start + 20, 24), reading(start + 30, 20), reading(start + 40, 30), reading(start + 50, 255), reading(start + 60, 50), reading(start + 70, 55)]
  expect(larqIntake(history, profile, 'cap').map(item => item.volumeMl)).toEqual([16, 40, 20])
  expect(larqIntake([reading(start, 20), reading(start + 13 * 3600, 100)], profile, 'cap')).toEqual([])
  expect(() => larqIntake([reading(start, 20), reading(start, 30)], profile, 'cap')).toThrow('Conflicting')
  expect(larqVolumeMl(105, profile)).toBe(340)
  expect(larqVolumeMl(250, profile)).toBeNull()
  expect(() => larqVolumeMl(100, { capacityMl: 680, calibration: [{ distanceMm: 20, volumeMl: 0 }, { distanceMm: 100, volumeMl: 680 }] })).toThrow('decrease')
})
