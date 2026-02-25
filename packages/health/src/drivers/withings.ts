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
  WithingsMeasureGroup,
} from '../types'

const WITHINGS_API_BASE = 'https://wbsapi.withings.net'

// Withings measure type constants
const MEASURE_TYPE = {
  WEIGHT: 1,
  HEIGHT: 4,
  FAT_FREE_MASS: 5,
  FAT_RATIO: 6,
  FAT_MASS_WEIGHT: 8,
  DIASTOLIC_BP: 9,
  SYSTOLIC_BP: 10,
  HEART_PULSE: 11,
  TEMPERATURE: 12,
  SP02: 54,
  BODY_TEMPERATURE: 71,
  SKIN_TEMPERATURE: 73,
  MUSCLE_MASS: 76,
  WATER_MASS: 77,
  BONE_MASS: 88,
  PULSE_WAVE_VELOCITY: 91,
  VO2MAX: 123,
  VISCERAL_FAT: 170,
  NERVE_HEALTH_FEET: 174,
  EXTRACELLULAR_WATER: 168,
  INTRACELLULAR_WATER: 169,
  BMI: 175,
  BASAL_METABOLIC_RATE: 176,
} as const

export class WithingsDriver implements HealthDriver {
  readonly name = 'Withings'
  readonly type = 'withings' as const

  private accessToken: string
  private baseUrl: string

  constructor(accessToken: string, baseUrl?: string) {
    this.accessToken = accessToken
    this.baseUrl = baseUrl ?? WITHINGS_API_BASE
  }

  isAuthenticated(): boolean {
    return this.accessToken.length > 0
  }

  // ===========================================================================
  // Private API helpers
  // ===========================================================================

  private async request<T>(endpoint: string, params?: Record<string, string | number>): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`

    const body = new URLSearchParams()
    body.set('action', 'getmeas')

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          body.set(key, String(value))
        }
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Withings API error ${response.status}: ${text}`)
    }

    const json = await response.json() as {
      status: number
      body: T
      error?: string
    }

    if (json.status !== 0) {
      throw new Error(`Withings API error status ${json.status}: ${json.error ?? 'Unknown error'}`)
    }

    return json.body
  }

  private buildDateParams(options?: DateRangeOptions): Record<string, string | number> {
    const params: Record<string, string | number> = {}

    if (options?.startDate) {
      params.startdate = Math.floor(new Date(options.startDate).getTime() / 1000)
    }

    if (options?.endDate) {
      params.enddate = Math.floor(new Date(options.endDate).getTime() / 1000) + 86400
    }

    return params
  }

  // ===========================================================================
  // Body Composition (primary feature for scales)
  // ===========================================================================

  async getBodyComposition(options?: DateRangeOptions): Promise<BodyComposition[]> {
    const params = this.buildDateParams(options)

    const data = await this.request<{ measuregrps: WithingsMeasureGroup[] }>('/measure', {
      action: 'getmeas',
      ...params,
      category: 1, // real measurements only (not user objectives)
    })

    return (data.measuregrps ?? []).map((grp) => {
      const measures = this.extractMeasures(grp)
      const timestamp = new Date(grp.date * 1000).toISOString()
      const day = timestamp.slice(0, 10)

      return {
        id: String(grp.grpid),
        day,
        timestamp,
        weight: measures[MEASURE_TYPE.WEIGHT] ?? 0,
        bmi: measures[MEASURE_TYPE.BMI],
        bodyFatPercentage: measures[MEASURE_TYPE.FAT_RATIO],
        fatMassWeight: measures[MEASURE_TYPE.FAT_MASS_WEIGHT],
        leanMass: measures[MEASURE_TYPE.FAT_FREE_MASS],
        muscleMass: measures[MEASURE_TYPE.MUSCLE_MASS],
        boneMass: measures[MEASURE_TYPE.BONE_MASS],
        waterPercentage: measures[MEASURE_TYPE.WATER_MASS],
        visceralFat: measures[MEASURE_TYPE.VISCERAL_FAT],
        basalMetabolicRate: measures[MEASURE_TYPE.BASAL_METABOLIC_RATE],
        heartRate: measures[MEASURE_TYPE.HEART_PULSE],
        source: 'withings' as const,
      }
    })
  }

  async getWeightMeasurements(options?: DateRangeOptions): Promise<WeightMeasurement[]> {
    const params = this.buildDateParams(options)

    const data = await this.request<{ measuregrps: WithingsMeasureGroup[] }>('/measure', {
      action: 'getmeas',
      ...params,
      meastype: MEASURE_TYPE.WEIGHT,
      category: 1,
    })

    const results: WeightMeasurement[] = []

    for (const grp of data.measuregrps ?? []) {
      const measures = this.extractMeasures(grp)
      const weight = measures[MEASURE_TYPE.WEIGHT]
      if (weight === undefined) continue

      const timestamp = new Date(grp.date * 1000).toISOString()
      results.push({
        id: String(grp.grpid),
        day: timestamp.slice(0, 10),
        timestamp,
        weight,
        bmi: measures[MEASURE_TYPE.BMI],
        source: 'withings' as const,
      })
    }

    return results
  }

  // ===========================================================================
  // Heart Rate (Withings scales with HR sensor)
  // ===========================================================================

  async getHeartRate(options?: DateRangeOptions): Promise<HeartRateSample[]> {
    const params = this.buildDateParams(options)

    const data = await this.request<{ measuregrps: WithingsMeasureGroup[] }>('/measure', {
      action: 'getmeas',
      ...params,
      meastype: MEASURE_TYPE.HEART_PULSE,
      category: 1,
    })

    const results: HeartRateSample[] = []

    for (const grp of data.measuregrps ?? []) {
      const measures = this.extractMeasures(grp)
      const bpm = measures[MEASURE_TYPE.HEART_PULSE]
      if (bpm === undefined) continue

      results.push({
        timestamp: new Date(grp.date * 1000).toISOString(),
        bpm,
        source: 'scale',
      })
    }

    return results
  }

  // ===========================================================================
  // Personal Info
  // ===========================================================================

  async getPersonalInfo(): Promise<PersonalInfo | null> {
    const data = await this.request<{
      users: Array<{
        userid: number
        email?: string
        birthdate?: number
        gender?: number
      }>
    }>('/v2/user', { action: 'getdevice' })

    const user = data.users?.[0]
    if (!user) return null

    return {
      id: String(user.userid),
      email: user.email,
      biologicalSex: user.gender === 0 ? 'male' : user.gender === 1 ? 'female' : undefined,
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
  async getHRV(): Promise<HRVSample[]> { return [] }
  async getSpO2(): Promise<DailySpO2[]> { return [] }
  async getStress(): Promise<DailyStress[]> { return [] }
  async getBodyTemperature(): Promise<BodyTemperature[]> { return [] }
  async getVO2Max(): Promise<VO2MaxReading[]> { return [] }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private extractMeasures(grp: WithingsMeasureGroup): Record<number, number> {
    const result: Record<number, number> = {}

    for (const measure of grp.measures) {
      result[measure.type] = measure.value * 10 ** measure.unit
    }

    return result
  }
}

export function createWithingsDriver(accessToken: string, baseUrl?: string): WithingsDriver {
  return new WithingsDriver(accessToken, baseUrl)
}
