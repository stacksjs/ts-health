import type { LarqTofReading } from './protocol'
import { decodeLarqResponse, larqClockRequest, larqLiveDistance, larqLogRequest, larqRequest, larqTofLog } from './protocol'

export interface LarqBleTransport { exchange(request: Uint8Array): Promise<Uint8Array> }

/** One request at a time, checked against the echoed request id. No cloud APIs. */
export class LarqBleClient {
  private nextId = 1
  private tail: Promise<unknown> = Promise.resolve()
  private transport: LarqBleTransport

  constructor(transport: LarqBleTransport) { this.transport = transport }

  private request(make: (id: number) => Uint8Array) {
    const run = async () => {
      const id = this.nextId++
      if (this.nextId > 0xffffffff) this.nextId = 1
      const response = decodeLarqResponse(await this.transport.exchange(make(id)))
      if (response.id !== id) throw new Error('LARQ response belongs to another request')
      if (response.code !== 1) throw new Error(response.code === 2 ? 'LARQ firmware does not support this command' : 'LARQ refused this command')
      return response
    }
    const result = this.tail.then(run)
    this.tail = result.catch(() => {})
    return result
  }

  async setClock(nowMs: number = Date.now()): Promise<void> {
    await this.request(id => larqClockRequest(id, nowMs))
  }

  async measureDistance(): Promise<number> {
    return larqLiveDistance(await this.request(id => larqRequest(id, 'RequestGetCapTofState')))
  }

  async readLogs(since: number, onPage?: (page: LarqTofReading[]) => Promise<void>): Promise<LarqTofReading[]> {
    if (!Number.isSafeInteger(since) || since < 0) throw new Error('Invalid LARQ history cursor')
    const out: LarqTofReading[] = []
    let cursor = since
    for (let page = 0; page < 2000; page++) {
      const items = larqTofLog(await this.request(id => larqLogRequest(id, cursor, 5)))
      if (items.length > 5 || items.some((item, index) => item.timestamp <= cursor || (index > 0 && item.timestamp <= items[index - 1]!.timestamp))) throw new Error('LARQ returned unordered or non-advancing history')
      if (items.length) {
        await onPage?.(items)
        out.push(...items)
        cursor = items[items.length - 1]!.timestamp
      }
      if (items.length < 5) return out
    }
    throw new Error('LARQ history is too large for one sync; saved pages can be resumed')
  }
}
