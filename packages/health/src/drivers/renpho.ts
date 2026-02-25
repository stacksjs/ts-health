import type {
  HealthDriver,
  DateRangeOptions,
  SleepSession,
  DailySleepSummary,
  DailyActivity,
  Workout,
  DailyReadiness,
  HeartRateSample,
  HRVSample,
  DailySpO2,
  DailyStress,
  BodyTemperature,
  VO2MaxReading,
  BodyComposition,
  WeightMeasurement,
  PersonalInfo,
  RenphoMeasurement,
  RenphoAuthResponse,
} from '../types'

const RENPHO_API_BASE = 'https://renpho.qnclouds.com/api'

export class RenphoDriver implements HealthDriver {
  readonly name = 'Renpho'
  readonly type = 'renpho' as const

  private email: string
  private password: string
  private sessionKey: string | null
  private baseUrl: string

  constructor(config: {
    email: string
    password: string
    accessToken?: string
    baseUrl?: string
  }) {
    this.email = config.email
    this.password = config.password
    this.sessionKey = config.accessToken ?? null
    this.baseUrl = config.baseUrl ?? RENPHO_API_BASE
  }

  isAuthenticated(): boolean {
    return this.sessionKey !== null
  }

  // ===========================================================================
  // Private API helpers
  // ===========================================================================

  private async authenticate(): Promise<void> {
    if (this.sessionKey) return

    const response = await fetch(`${this.baseUrl}/v3/users/sign_in.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: this.email,
        password: this.password,
        terminal_user_session_key: '',
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Renpho auth error ${response.status}: ${text}`)
    }

    const data = await response.json() as RenphoAuthResponse

    if (data.status_code !== '20000') {
      throw new Error(`Renpho auth failed: ${data.status_code}`)
    }

    this.sessionKey = data.terminal_user_session_key
  }

  private async request<T>(endpoint: string, params?: Record<string, string | number>): Promise<T> {
    await this.authenticate()

    const url = new URL(`${this.baseUrl}${endpoint}`)
    url.searchParams.set('terminal_user_session_key', this.sessionKey!)

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Renpho API error ${response.status}: ${text}`)
    }

    return response.json() as Promise<T>
  }

  // ===========================================================================
  // Body Composition (primary feature for scales)
  // ===========================================================================

  async getBodyComposition(options?: DateRangeOptions): Promise<BodyComposition[]> {
    const params: Record<string, string | number> = {}

    if (options?.startDate) {
      params.date_from = options.startDate
    }
    if (options?.endDate) {
      params.date_to = options.endDate
    }

    const data = await this.request<{
      last_at: number
      measurements: RenphoMeasurement[]
    }>(
      '/v2/measurements/list.json',
      params,
    )

    return (data.measurements ?? []).map((m) => {
      const timestamp = new Date(m.time_stamp * 1000).toISOString()

      return {
        id: m.id,
        day: timestamp.slice(0, 10),
        timestamp,
        weight: m.weight,
        bmi: m.bmi,
        bodyFatPercentage: m.bodyfat,
        muscleMass: m.muscle,
        boneMass: m.bone,
        waterPercentage: m.water,
        visceralFat: m.vfal,
        basalMetabolicRate: m.bmr,
        proteinPercentage: m.protein,
        subcutaneousFat: m.subfat,
        skeletalMuscle: m.skeletal_muscle,
        source: 'renpho' as const,
      }
    })
  }

  async getWeightMeasurements(options?: DateRangeOptions): Promise<WeightMeasurement[]> {
    const compositions = await this.getBodyComposition(options)

    return compositions.map(c => ({
      id: c.id,
      day: c.day,
      timestamp: c.timestamp,
      weight: c.weight,
      bmi: c.bmi,
      source: 'renpho' as const,
    }))
  }

  // ===========================================================================
  // Personal Info
  // ===========================================================================

  async getPersonalInfo(): Promise<PersonalInfo | null> {
    const data = await this.request<{
      status_code: string
      email?: string
      height?: number
      birthday?: string
      sex?: number
    }>('/v2/users/profile.json')

    return {
      email: data.email,
      height: data.height,
      biologicalSex: data.sex === 1 ? 'male' : data.sex === 2 ? 'female' : undefined,
    }
  }

  // ===========================================================================
  // Unsupported methods (scales don't track these)
  // ===========================================================================

  async getSleep(): Promise<SleepSession[]> { return [] }
  async getDailySleep(): Promise<DailySleepSummary[]> { return [] }
  async getDailyActivity(): Promise<DailyActivity[]> { return [] }
  async getWorkouts(): Promise<Workout[]> { return [] }
  async getReadiness(): Promise<DailyReadiness[]> { return [] }
  async getHeartRate(): Promise<HeartRateSample[]> { return [] }
  async getHRV(): Promise<HRVSample[]> { return [] }
  async getSpO2(): Promise<DailySpO2[]> { return [] }
  async getStress(): Promise<DailyStress[]> { return [] }
  async getBodyTemperature(): Promise<BodyTemperature[]> { return [] }
  async getVO2Max(): Promise<VO2MaxReading[]> { return [] }
}

export function createRenphoDriver(config: {
  email: string
  password: string
  accessToken?: string
  baseUrl?: string
}): RenphoDriver {
  return new RenphoDriver(config)
}
