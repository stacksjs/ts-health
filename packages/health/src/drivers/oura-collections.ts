/** Every public usercollection GET in Oura OpenAPI 1.42. Keep original fields. */
export const OURA_COLLECTIONS = {
  daily_activity: 'date', daily_cardiovascular_age: 'date', daily_readiness: 'date',
  daily_resilience: 'date', daily_sleep: 'date', daily_spo2: 'date', daily_stress: 'date',
  enhanced_tag: 'date', heartrate: 'datetime', personal_info: 'single', rest_mode_period: 'date',
  ring_battery_level: 'datetime', ring_configuration: 'all', session: 'date', sleep: 'sleep',
  sleep_time: 'date', tag: 'date', vO2_max: 'date', workout: 'date',
} as const
export type OuraCollection = keyof typeof OURA_COLLECTIONS
export interface OuraCollectionQuery {
  startDate?: string
  endDate?: string
  nextToken?: string
}
export interface OuraCollectionPage {
  data: Record<string, unknown>[]
  nextToken: string | null
}
/** Verified Oura consent scopes. ring_configuration also authorizes battery
 * history; Oura offers it in consent although OpenAPI 1.42 omits it. */
export const OURA_OAUTH_SCOPES = ['email', 'personal', 'daily', 'heartrate', 'workout', 'tag', 'session', 'spo2', 'heart_health', 'ring_configuration'] as const
export class OuraApiError extends Error {
  readonly requiredScope: string | null
  constructor(public readonly status: number, public readonly collection: string, detail: unknown) {
    const scope = typeof detail === 'string' ? /(?:access|requires?)\s+([a-z][a-z0-9_]*)\s+scope\b/i.exec(detail)?.[1] ?? null : null
    super(scope ? `Oura ${collection} requires ${scope} permission (HTTP ${status})` : `Oura ${collection} request failed (HTTP ${status})`)
    this.name = 'OuraApiError'
    this.requiredScope = scope
  }
}
