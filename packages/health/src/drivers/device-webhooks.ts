import type { DeviceCloudProvider } from './device-cloud'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The notifications each maker sends when something new arrives, so an app
 * can sync the moment a watch uploads instead of on the next timer.
 *
 * Each proves it came from the provider its own way:
 * - Polar: `Polar-Webhook-Signature`, hex HMAC-SHA256 of the body with the
 *   `signature_secret_key` returned once when the webhook was created.
 * - Suunto: `X-HMAC-SHA256-Signature`, hex HMAC-SHA256 of the body with the
 *   notification secret set in Suunto's partner settings.
 * - COROS: the app's own client id and secret in the `Client` and `Secret`
 *   headers.
 * - Wahoo: the `webhook_token` chosen in Wahoo's developer portal, in the body.
 *
 * `verifyDeviceWebhook` checks that; `parseDeviceWebhook` says who it is
 * about (the provider's user ids, to find the connections) and what kind of
 * thing arrived.
 */

export interface DeviceWebhookSecrets {
  /** Polar's signature_secret_key, Suunto's notification secret. */
  signatureSecret?: string
  /** Wahoo's webhook_token. */
  token?: string
  /** COROS: the app's client id and secret, which it sends back as headers. */
  clientId?: string
  clientSecret?: string
}

export type DeviceWebhookKind = 'activity' | 'sleep' | 'daily' | 'ping' | 'other'

export interface DeviceWebhookEvent {
  provider: DeviceCloudProvider
  kind: DeviceWebhookKind
  /** The provider's own name for the event (EXERCISE, WORKOUT_CREATED, workout_summary…). */
  type: string
  /** Who it is about: Polar user ids, Suunto usernames, COROS openIds, Wahoo user ids. */
  providerUserIds: string[]
  /** The activity it announces, when it names one. */
  entityIds: string[]
}

function sameText(actual: string, expected: string): boolean {
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function sameHmac(rawBody: string, signature: string | null | undefined, secret: string | undefined): boolean {
  const given = String(signature || '').trim().toLowerCase()
  if (!secret || !/^[a-f0-9]{64}$/.test(given))
    return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  return sameText(given, expected)
}

function header(headers: Headers | Record<string, string | undefined>, name: string): string | null {
  if (typeof (headers as Headers).get === 'function')
    return (headers as Headers).get(name)
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers))
    if (key.toLowerCase() === wanted) return value ?? null
  return null
}

function json(rawBody: string): any {
  try {
    return JSON.parse(rawBody)
  }
  catch {
    return null
  }
}

/** Whether the request really came from the provider. A provider with no secret configured never verifies. */
export function verifyDeviceWebhook(provider: DeviceCloudProvider, rawBody: string, headers: Headers | Record<string, string | undefined>, secrets: DeviceWebhookSecrets): boolean {
  switch (provider) {
    case 'polar':
      return sameHmac(rawBody, header(headers, 'polar-webhook-signature'), secrets.signatureSecret)
    case 'suunto':
      return sameHmac(rawBody, header(headers, 'x-hmac-sha256-signature'), secrets.signatureSecret)
    case 'coros': {
      const client = header(headers, 'client')
      const secret = header(headers, 'secret')
      return !!secrets.clientId && !!secrets.clientSecret && !!client && !!secret
        && sameText(client, secrets.clientId) && sameText(secret, secrets.clientSecret)
    }
    case 'wahoo': {
      const token = json(rawBody)?.webhook_token
      return !!secrets.token && typeof token === 'string' && sameText(token, secrets.token)
    }
  }
}

const ids = (values: unknown[]): string[] => [...new Set(values.filter(value => value !== null && value !== undefined && String(value).trim()).map(value => String(value).trim()))]

/** What a (verified) notification says, or null when it is not one this provider sends. */
export function parseDeviceWebhook(provider: DeviceCloudProvider, rawBody: string): DeviceWebhookEvent | null {
  const body = json(rawBody)
  if (!body || typeof body !== 'object')
    return null
  switch (provider) {
    case 'polar': {
      const type = String(body.event || '')
      if (!type)
        return null
      const kind: DeviceWebhookKind = type === 'PING' ? 'ping' : type === 'EXERCISE' ? 'activity' : type === 'SLEEP' ? 'sleep' : ['ACTIVITY_SUMMARY', 'CONTINUOUS_HEART_RATE'].includes(type) ? 'daily' : 'other'
      return { provider, kind, type, providerUserIds: ids([body.user_id]), entityIds: ids([body.entity_id]) }
    }
    case 'suunto': {
      // The current notification ({ type, username, workout }) and the older
      // one, which was only { username, workoutid }.
      const type = String(body.type || (body.workoutid ? 'WORKOUT_CREATED' : ''))
      if (!type)
        return null
      const kind: DeviceWebhookKind = type === 'WORKOUT_CREATED' ? 'activity' : type === 'SUUNTO_247_SLEEP_CREATED' ? 'sleep' : type.startsWith('SUUNTO_247_') ? 'daily' : 'other'
      return { provider, kind, type, providerUserIds: ids([body.username]), entityIds: ids([body.workout?.workoutKey ?? body.workoutid]) }
    }
    case 'coros': {
      const list = Array.isArray(body.sportDataList) ? body.sportDataList : null
      if (!list)
        return null
      return { provider, kind: 'activity', type: 'sportDataList', providerUserIds: ids(list.map((item: any) => item?.openId)), entityIds: ids(list.map((item: any) => item?.labelId)) }
    }
    case 'wahoo': {
      const type = String(body.event_type || '')
      if (!type)
        return null
      const summary = body.workout_summary || {}
      return { provider, kind: type === 'workout_summary' ? 'activity' : 'other', type, providerUserIds: ids([body.user?.id]), entityIds: ids([summary.workout?.id]) }
    }
  }
}

/**
 * The answer a provider expects back. COROS reads a result code from the
 * body; the others only need a 200.
 */
export function deviceWebhookReply(provider: DeviceCloudProvider, ok: boolean): { status: number, body: Record<string, string> } {
  if (provider === 'coros')
    return ok ? { status: 200, body: { message: 'ok', result: '0000' } } : { status: 401, body: { message: 'authentication failed', result: '1001' } }
  return ok ? { status: 200, body: { ok: 'true' } } : { status: 401, body: { error: 'invalid signature' } }
}
