import type { DeviceCloudProvider } from './drivers/device-cloud'

/**
 * OAuth 2 for the watch makers' clouds: where to send the person, how to
 * trade the code for a token, and how to keep it alive. Each provider speaks
 * its own dialect of the standard, written down here once:
 *
 * - Polar AccessLink: client credentials as HTTP Basic, one scope
 *   (`accesslink.read_all`), and a token that does not expire unless revoked
 *   (no refresh token). The token carries Polar's user id (`x_user_id`), and
 *   the user must then be registered (`POST /v3/users`, PolarAccessLinkDriver).
 * - Suunto: HTTP Basic, a refresh token, and the Suunto username in `user`.
 *   Every API call also needs the app's APIM subscription key.
 * - COROS: client credentials in the form body; the token answer carries the
 *   `openId` every API call needs. Refreshing does not issue a new token: it
 *   keeps the same one valid for another 30 days.
 * - Wahoo: credentials in the body, tokens for two hours, refresh with
 *   `offline_data`; the user id comes from `GET /v1/user`.
 *
 * Endpoints can be overridden per call (a sandbox, or a test's fake server).
 */

export interface DeviceOAuthSpec {
  provider: DeviceCloudProvider
  authorizeUrl: string
  tokenUrl: string
  /** Where a refresh goes, when it is not the token URL (COROS). */
  refreshUrl?: string
  /** Space-separated scopes; empty when the provider takes none. */
  scopes: string
  /** How the client authenticates at the token endpoint. */
  clientAuth: 'basic' | 'body'
  /** Whether the provider issues refresh tokens at all. */
  refreshable: boolean
}

export const DEVICE_OAUTH: Readonly<Record<DeviceCloudProvider, DeviceOAuthSpec>> = {
  polar: {
    provider: 'polar',
    authorizeUrl: 'https://flow.polar.com/oauth2/authorization',
    tokenUrl: 'https://polarremote.com/v2/oauth2/token',
    scopes: 'accesslink.read_all',
    clientAuth: 'basic',
    refreshable: false,
  },
  suunto: {
    provider: 'suunto',
    authorizeUrl: 'https://cloudapi-oauth.suunto.com/oauth/authorize',
    tokenUrl: 'https://cloudapi-oauth.suunto.com/oauth/token',
    scopes: '',
    clientAuth: 'basic',
    refreshable: true,
  },
  coros: {
    provider: 'coros',
    authorizeUrl: 'https://open.coros.com/oauth2/authorize',
    tokenUrl: 'https://open.coros.com/oauth2/accesstoken',
    refreshUrl: 'https://open.coros.com/oauth2/refresh-token',
    scopes: '',
    clientAuth: 'body',
    refreshable: true,
  },
  wahoo: {
    provider: 'wahoo',
    authorizeUrl: 'https://api.wahooligan.com/oauth/authorize',
    tokenUrl: 'https://api.wahooligan.com/oauth/token',
    // offline_data: refresh tokens and webhooks while the app is closed.
    scopes: 'user_read workouts_read offline_data',
    clientAuth: 'body',
    refreshable: true,
  },
}

/** COROS keeps a token valid for 30 days, and each refresh extends it by as much. */
export const COROS_TOKEN_LIFETIME_SECONDS: number = 30 * 86_400

export interface DeviceOAuthClient {
  clientId: string
  clientSecret: string
  redirectUri: string
  /** Endpoint overrides (sandbox, tests). */
  authorizeUrl?: string
  tokenUrl?: string
  refreshUrl?: string
  scopes?: string
}

export interface DeviceTokens {
  accessToken: string
  refreshToken?: string
  /** ISO instant the access token stops working, when the provider says. */
  expiresAt?: string
  /** Who this is at the provider: Polar's user id, Suunto's username, COROS' openId. */
  providerUserId?: string
}

export class DeviceOAuthError extends Error {
  readonly provider: DeviceCloudProvider
  readonly status: number

  constructor(provider: DeviceCloudProvider, status: number, message: string) {
    super(message)
    this.name = 'DeviceOAuthError'
    this.provider = provider
    this.status = status
  }
}

/** Where to send the person to sign in and allow HQ in. */
export function deviceAuthorizeUrl(provider: DeviceCloudProvider, client: Pick<DeviceOAuthClient, 'clientId' | 'redirectUri' | 'authorizeUrl' | 'scopes'>, state: string): string {
  const spec = DEVICE_OAUTH[provider]
  const params = new URLSearchParams({ response_type: 'code', client_id: client.clientId, redirect_uri: client.redirectUri })
  const scopes = client.scopes ?? spec.scopes
  if (scopes)
    params.set('scope', scopes)
  params.set('state', state)
  return `${client.authorizeUrl || spec.authorizeUrl}?${params}`
}

function expiry(seconds: unknown, now: number): string | undefined {
  const value = Number(seconds)
  return Number.isFinite(value) && value > 0 ? new Date(now + value * 1000).toISOString() : undefined
}

async function post(provider: DeviceCloudProvider, url: string, client: DeviceOAuthClient, form: Record<string, string>): Promise<any> {
  const spec = DEVICE_OAUTH[provider]
  const body = new URLSearchParams(form)
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }
  if (spec.clientAuth === 'basic') {
    headers.Authorization = `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`
  }
  else {
    body.set('client_id', client.clientId)
    body.set('client_secret', client.clientSecret)
  }
  const response = await fetch(url, { method: 'POST', headers, body })
  const text = await response.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  }
  catch {}
  if (!response.ok)
    throw new DeviceOAuthError(provider, response.status, `${provider} token endpoint ${response.status}: ${text.slice(0, 200)}`)
  // COROS answers 200 with its own result code.
  if (provider === 'coros' && json && json.result !== undefined && !/^0+$/.test(String(json.result)))
    throw new DeviceOAuthError(provider, response.status, `coros token endpoint result ${json.result}: ${json.message || 'refused'}`)
  return json
}

/** Trade the code from the redirect for tokens. */
export async function exchangeDeviceCode(provider: DeviceCloudProvider, client: DeviceOAuthClient, code: string, now: number = Date.now()): Promise<DeviceTokens> {
  const spec = DEVICE_OAUTH[provider]
  const raw = await post(provider, client.tokenUrl || spec.tokenUrl, client, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: client.redirectUri,
  })
  if (!raw?.access_token)
    throw new DeviceOAuthError(provider, 200, `${provider} token answer carried no access_token: ${JSON.stringify(raw).slice(0, 200)}`)
  if (provider === 'coros' && (typeof raw.openId !== 'string' || !raw.openId.trim()))
    throw new DeviceOAuthError(provider, 200, 'coros token answer carried no openId')
  const tokens: DeviceTokens = { accessToken: String(raw.access_token) }
  if (raw.refresh_token)
    tokens.refreshToken = String(raw.refresh_token)
  const expiresAt = expiry(raw.expires_in ?? (provider === 'coros' ? COROS_TOKEN_LIFETIME_SECONDS : undefined), now)
  if (expiresAt)
    tokens.expiresAt = expiresAt
  const who = provider === 'polar' ? raw.x_user_id : provider === 'suunto' ? raw.user : provider === 'coros' ? raw.openId : undefined
  if (who !== undefined && who !== null && String(who))
    tokens.providerUserId = String(who)
  return tokens
}

/**
 * A fresh access token from the refresh token. COROS extends the current
 * token rather than issuing one, so it needs `accessToken` to hand back.
 */
export async function refreshDeviceToken(provider: DeviceCloudProvider, client: DeviceOAuthClient, refreshToken: string, accessToken?: string, now: number = Date.now()): Promise<DeviceTokens> {
  const spec = DEVICE_OAUTH[provider]
  if (!spec.refreshable)
    throw new DeviceOAuthError(provider, 0, `${provider} tokens cannot be refreshed`)
  const raw = await post(provider, client.refreshUrl || spec.refreshUrl || client.tokenUrl || spec.tokenUrl, client, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
  if (provider === 'coros') {
    if (!accessToken)
      throw new DeviceOAuthError(provider, 0, 'coros refresh extends the current token: pass it')
    return { accessToken, refreshToken, expiresAt: expiry(COROS_TOKEN_LIFETIME_SECONDS, now) }
  }
  if (!raw?.access_token)
    throw new DeviceOAuthError(provider, 200, `${provider} refresh answer carried no access_token`)
  const tokens: DeviceTokens = { accessToken: String(raw.access_token), refreshToken: raw.refresh_token ? String(raw.refresh_token) : refreshToken }
  const expiresAt = expiry(raw.expires_in, now)
  if (expiresAt)
    tokens.expiresAt = expiresAt
  return tokens
}
