import type { SleepSession, DailySleepSummary, DailyActivity, Workout, DailyReadiness, HeartRateSample, HRVSample, DailySpO2, DailyStress, BodyTemperature, VO2MaxReading, BodyComposition, WeightMeasurement, PersonalInfo, DateRangeOptions, DailyHydration, HealthMetric, HydrationSample, WaterIntakeInput } from '../types'
import { dailyHydration, normalizeWaterIntake } from '../hydration'
import { AppleHealthDriver } from './apple-health'

export interface LarqConfig {
  email: string
  password: string
  /** Account's local day for cloud events that carry a UTC timestamp. */
  timezone?: string
  /** Injectable network boundary for tests. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
}

// Public Firebase client configuration used by LARQ's companion app, as
// documented by OpenLARQ. This is an unofficial, read-only cloud integration.
// https://github.com/lavyyy/openlarq/tree/master/internal
const API_KEY = 'AIzaSyDHKFqlodeFaDa2sQqxxBAaW-A3JF5lXRU'
const DATABASE_URL = 'https://s-usc1b-nss-2136.firebaseio.com'
const NAMESPACE = 'ferrous-cogency-215410'

/** PureVis 2 intake from the LARQ account, or an Apple Health export fallback. */
export class LarqDriver extends AppleHealthDriver {
  override readonly name: string = 'LARQ Bottle PureVis 2'
  override readonly type: 'larq' = 'larq'
  override readonly supportedMetrics: ReadonlySet<HealthMetric> = new Set<HealthMetric>(['hydration', 'dailyHydration'])
  override async getSleep(): Promise<SleepSession[]> { return [] }
  override async getDailySleep(): Promise<DailySleepSummary[]> { return [] }
  override async getDailyActivity(): Promise<DailyActivity[]> { return [] }
  override async getWorkouts(): Promise<Workout[]> { return [] }
  override async getReadiness(): Promise<DailyReadiness[]> { return [] }
  override async getHeartRate(): Promise<HeartRateSample[]> { return [] }
  override async getHRV(): Promise<HRVSample[]> { return [] }
  override async getSpO2(): Promise<DailySpO2[]> { return [] }
  override async getStress(): Promise<DailyStress[]> { return [] }
  override async getBodyTemperature(): Promise<BodyTemperature[]> { return [] }
  override async getVO2Max(): Promise<VO2MaxReading[]> { return [] }
  override async getBodyComposition(): Promise<BodyComposition[]> { return [] }
  override async getWeightMeasurements(): Promise<WeightMeasurement[]> { return [] }
  override async getPersonalInfo(): Promise<PersonalInfo | null> { return null }

  private config: LarqConfig | null
  private session: { token: string, uid: string, expiresAt: number } | null = null

  constructor(config: LarqConfig | string) {
    super(typeof config === 'string' ? config : '')
    this.config = typeof config === 'string' ? null : config
  }

  override isAuthenticated(): boolean {
    return this.config ? !!this.session && this.session.expiresAt > Date.now() : super.isAuthenticated()
  }

  /** Verify the account before presenting it as connected. Never exposes provider tokens. */
  async authenticate(): Promise<void> {
    if (!this.config || this.isAuthenticated()) return
    if (!this.config.email.trim() || !this.config.password) throw new Error('LARQ email and password are required')
    const result = await this.request(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.config.email, password: this.config.password, returnSecureToken: true }),
    })
    if (typeof result?.idToken !== 'string' || !result.idToken || typeof result?.localId !== 'string' || !result.localId)
      throw new Error('LARQ sign-in returned an invalid session')
    this.session = { token: result.idToken, uid: result.localId, expiresAt: Date.now() + (Number(result.expiresIn) || 3600) * 1000 - 60000 }
  }

  private async request(url: string, init: RequestInit = {}): Promise<any> {
    let res: Response
    try {
      res = await (this.config?.fetch || globalThis.fetch)(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) })
    }
    catch { throw new Error('LARQ could not be reached; try again') }
    if (!res.ok) {
      // Do not copy upstream text, URLs, credentials or tokens into logs/UI.
      if (res.status === 400 || res.status === 401 || res.status === 403)
        throw new Error('LARQ refused access; check your email and password. Apple or Google sign-in accounts can use Apple Health export instead.')
      if (res.status === 429) throw new Error('LARQ rate limit reached; try again later')
      throw new Error(`LARQ request failed (${res.status})`)
    }
    try { return await res.json() }
    catch { throw new Error('LARQ returned an unreadable response') }
  }

  override async getHydration(options?: DateRangeOptions): Promise<HydrationSample[]> {
    if (!this.config) return super.getHydration(options)
    await this.authenticate()
    const url = new URL(`${DATABASE_URL}/liquidIntake/${encodeURIComponent(this.session!.uid)}.json`)
    url.searchParams.set('ns', NAMESPACE)
    url.searchParams.set('auth', this.session!.token)
    const entries = await this.request(url.toString())
    if (entries !== null && (typeof entries !== 'object' || Array.isArray(entries))) throw new Error('LARQ returned invalid intake data')
    const inputs: WaterIntakeInput[] = []
    for (const [id, entry] of Object.entries(entries || {}) as Array<[string, any]>) {
      if (!entry || typeof entry !== 'object') throw new Error('LARQ returned an invalid intake entry')
      if (entry.updateState === 'deleted' || entry.isDeleted === true || entry.dateDeleted) continue
      // LARQ also logs coffee and tea. Only actual water belongs in water intake.
      if (typeof entry.type !== 'string' || entry.type.toLowerCase() !== 'water') continue
      if (typeof entry.time !== 'string' || !Number.isFinite(Date.parse(entry.time)) || typeof entry.volumeInLiter !== 'number' || !Number.isFinite(entry.volumeInLiter) || entry.volumeInLiter < 0)
        throw new Error('LARQ returned an invalid water reading')
      inputs.push({ id, startDate: entry.time, value: entry.volumeInLiter, unit: 'L', sourceName: 'LARQ' })
    }
    const samples = normalizeWaterIntake(inputs, undefined, 'larq')
    if (this.config.timezone) {
      for (const sample of samples)
        sample.day = new Date(sample.timestamp).toLocaleDateString('en-CA', { timeZone: this.config.timezone })
    }
    return samples.filter(sample => (!options?.startDate || sample.day >= options.startDate) && (!options?.endDate || sample.day <= options.endDate))
  }

  override async getDailyHydration(options?: DateRangeOptions): Promise<DailyHydration[]> {
    return dailyHydration(await this.getHydration(options))
  }
}

export function createLarqDriver(config: LarqConfig | string): LarqDriver {
  return new LarqDriver(config)
}
