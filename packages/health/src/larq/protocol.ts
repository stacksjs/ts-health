/** LARQ's published NUS/protobuf wire interface; independently implemented. */
export const LARQ_BLE = {
  informationService: '0000180a-0000-1000-8000-00805f9b34fb',
  service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  write: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  notify: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
} as const

export interface LarqTofReading {
  timestamp: number
  distanceMm: number
  trigger: number
  signal: number
}

type Field = { number: number, wire: number, value: number | Uint8Array }

function varint(value: number): number[] {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid protobuf integer')
  const out: number[] = []
  do {
    const byte = value % 128
    value = Math.floor(value / 128)
    out.push(byte | (value ? 128 : 0))
  } while (value)
  return out
}

function fixed32(value: number): number[] {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error('Invalid fixed32 integer')
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24]
}

function bytesField(number: number, value: readonly number[]): number[] {
  return [...varint(number * 8 + 2), ...varint(value.length), ...value]
}

function fields(bytes: Uint8Array): Field[] {
  if (bytes.length > 4096) throw new Error('Oversized LARQ response')
  let offset = 0
  const take = (count: number) => {
    if (offset + count > bytes.length) throw new Error('Truncated LARQ response')
    const value = bytes.slice(offset, offset + count)
    offset += count
    return value
  }
  const readVarint = () => {
    let value = 0
    let factor = 1
    for (let count = 0; count < 8; count++) {
      const byte = take(1)[0]!
      value += (byte & 127) * factor
      if (!Number.isSafeInteger(value)) throw new Error('Invalid LARQ integer')
      if (!(byte & 128)) return value
      factor *= 128
    }
    throw new Error('Invalid LARQ varint')
  }
  const out: Field[] = []
  while (offset < bytes.length) {
    const key = readVarint()
    const number = Math.floor(key / 8)
    const wire = key & 7
    if (!number) throw new Error('Invalid LARQ protobuf field')
    let value: number | Uint8Array
    if (wire === 0) value = readVarint()
    else if (wire === 2) value = take(readVarint())
    else if (wire === 5) {
      const b = take(4)
      value = (b[0]! + b[1]! * 256 + b[2]! * 65536 + b[3]! * 16777216)
    }
    else if (wire === 1) value = take(8)
    else throw new Error('Unsupported LARQ protobuf wire type')
    out.push({ number, wire, value })
  }
  return out
}

function scalar(values: Field[], number: number, wire: number, fallback = 0): number {
  const matches = values.filter(field => field.number === number)
  if (!matches.length) return fallback
  if (matches.length !== 1 || matches[0]!.wire !== wire || typeof matches[0]!.value !== 'number') throw new Error('Invalid LARQ scalar')
  return matches[0]!.value as number
}

function blob(values: Field[], number: number): Uint8Array | null {
  const matches = values.filter(field => field.number === number)
  if (!matches.length) return null
  if (matches.length !== 1 || matches[0]!.wire !== 2 || !(matches[0]!.value instanceof Uint8Array)) throw new Error('Invalid LARQ message')
  return matches[0]!.value as Uint8Array
}

export type LarqReadCommand = 'RequestGetCapTofLog' | 'RequestGetCapTofState' | 'RequestGetCapTofSettings' | 'RequestGetCapUiState'

/** Only intake-related reads and normal clock synchronisation are exposed. */
export function larqRequest(id: number, command: LarqReadCommand | 'RequestSetCapTimeSettings', payload: readonly number[] = []): Uint8Array {
  if (!['RequestGetCapTofLog', 'RequestGetCapTofState', 'RequestGetCapTofSettings', 'RequestGetCapUiState', 'RequestSetCapTimeSettings'].includes(command)) throw new Error('Unsupported LARQ command')
  const name = [...`type.googleapis.com/${command}`].map(char => char.charCodeAt(0))
  const any = [...bytesField(1, name), ...(payload.length ? bytesField(2, payload) : [])]
  return Uint8Array.from([13, ...fixed32(id), ...bytesField(2, any)])
}

export function larqLogRequest(id: number, since: number, limit = 5): Uint8Array {
  if (!Number.isInteger(limit) || limit < 1 || limit > 6) throw new Error('LARQ log page must have one to six entries')
  const query = [...(since ? [8, ...varint(since)] : []), 21, ...fixed32(limit)]
  return larqRequest(id, 'RequestGetCapTofLog', bytesField(1, query))
}

export function larqClockRequest(id: number, nowMs: number): Uint8Array {
  return larqRequest(id, 'RequestSetCapTimeSettings', bytesField(1, [8, ...varint(nowMs)]))
}

export interface LarqResponse { id: number, code: number, type: string | null, body: Uint8Array | null }

export function decodeLarqResponse(bytes: Uint8Array): LarqResponse {
  const envelope = fields(bytes)
  const id = scalar(envelope, 1, 5)
  const code = scalar(envelope, 2, 0)
  if (!id || ![0, 1, 2].includes(code)) throw new Error('Invalid LARQ response envelope')
  const anyBytes = blob(envelope, 3)
  if (!anyBytes) return { id, code, type: null, body: null }
  const any = fields(anyBytes)
  const name = blob(any, 1)
  if (!name || name.length > 128 || [...name].some(byte => byte < 32 || byte > 126)) throw new Error('Invalid LARQ response type')
  return { id, code, type: String.fromCharCode(...name), body: blob(any, 2) || new Uint8Array() }
}

export function larqTofLog(response: LarqResponse): LarqTofReading[] {
  // A success with no body is the cap's normal end of history.
  if (response.code !== 1) throw new Error(response.code === 2 ? 'LARQ firmware does not support this read' : 'LARQ refused the read')
  if (response.type === null && response.body === null) return []
  if (response.type !== 'type.googleapis.com/ResponseGetCapTofLog' || !response.body) throw new Error('Unexpected LARQ log response')
  const out: LarqTofReading[] = []
  for (const entry of fields(response.body)) {
    if (entry.number !== 1) continue
    if (entry.wire !== 2 || !(entry.value instanceof Uint8Array)) throw new Error('Invalid LARQ log entry')
    const value = fields(entry.value)
    out.push({ timestamp: scalar(value, 1, 0), trigger: scalar(value, 2, 0), distanceMm: scalar(value, 3, 5), signal: scalar(value, 4, 5) })
  }
  return out
}

export function larqLiveDistance(response: LarqResponse): number {
  if (response.code !== 1 || response.type !== 'type.googleapis.com/ResponseGetCapTofState' || !response.body) throw new Error('LARQ did not return a water measurement')
  const state = blob(fields(response.body), 1)
  if (!state) throw new Error('LARQ water measurement is absent')
  return scalar(fields(state), 1, 5)
}

/** Stable cap serial from its advertisement; never persist a changing BLE address. */
export function larqDeviceId(name: string): string {
  if (!/^LARQ_[0-9A-Za-z]{11}$/.test(name)) throw new Error('This device is not a LARQ cap')
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  let serial = 0n
  for (const char of name.slice(5)) serial = serial * 62n + BigInt(alphabet.indexOf(char))
  if (serial > 0xffffffffffffffffn) throw new Error('Invalid LARQ cap serial')
  return serial.toString(16).toUpperCase().padStart(16, '0')
}
