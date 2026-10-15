import type { EightSleepAlarm, EightSleepCommand, EightSleepConfig, EightSleepDashboard, EightSleepHistoryOptions, EightSleepNight, EightSleepSession, EightSleepSide, EightSleepTemperature } from './types'
import { eightInstant, eightNumber, normalizeEightSleepNight } from './normalize'
import { EIGHT_SLEEP_PUBLIC_CLIENT_ID, EIGHT_SLEEP_PUBLIC_CLIENT_SECRET } from './public-client'

const HOSTS = { auth: 'https://auth-api.8slp.net/v1', client: 'https://client-api.8slp.net/v1', app: 'https://app-api.8slp.net' }
const STAGES = ['bedTimeLevel', 'initialSleepLevel', 'finalSleepLevel'] as const
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const

function pillowForSide(devices: any[], side: EightSleepSide | null): any {
  const pillows = devices.filter(entry => entry?.device?.specialization === 'pillow')
  const mine = side === 'solo' ? 'left' : side
  return pillows.find(entry => mine && entry.device.side === mine) ?? (pillows.length === 1 && !pillows[0].device.side ? pillows[0] : null)
}

/** Sanitized errors: provider bodies can contain account details or bearer tokens. */
export class EightSleepError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterSeconds: number | null = null) {
    super(message)
    this.name = 'EightSleepError'
  }
}
export class EightSleepInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EightSleepInputError'
  }
}
function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new EightSleepInputError(`${label} must be an integer from ${min} to ${max}`)
  return value
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new EightSleepInputError('A true or false setting is required')
  return value
}
function oneOf<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) throw new EightSleepInputError('Unsupported Eight Sleep setting')
  return value as T
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9_:-]{1,160}$/i.test(value)) throw new EightSleepInputError('Invalid Eight Sleep identifier')
  return value
}
function alarmTime(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) throw new EightSleepInputError('Use an alarm time in HH:MM format')
  return value.length === 5 ? `${value}:00` : value
}

/** Runtime validation shared by direct SDK consumers and server endpoints. Unknown actions never reach the Pod. */
export function validateEightSleepCommand(input: unknown): EightSleepCommand {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new EightSleepInputError('An Eight Sleep command is required')
  const command = input as Record<string, unknown>
  const action = command.action
  switch (action) {
    case 'power': case 'away': case 'pillow-power': return { action, enabled: boolean(command.enabled) }
    case 'temperature': return { action, level: integer(command.level, -100, 100, 'Temperature level'), ...(command.durationSeconds === undefined ? {} : { durationSeconds: integer(command.durationSeconds, 0, 28800, 'Duration') }) }
    case 'schedule': return { action, stage: oneOf(command.stage, STAGES), level: integer(command.level, -100, 100, 'Temperature level') }
    case 'side': return { action, side: oneOf(command.side, ['left', 'right', 'solo']) }
    case 'prime': return { action }
    case 'led': return { action, level: integer(command.level, 0, 100, 'Brightness') }
    case 'base-preset': return { action, preset: oneOf(command.preset, ['sleep', 'relaxing', 'reading']) }
    case 'base-angle': return { action, headAngle: integer(command.headAngle, 0, 45, 'Head angle'), feetAngle: integer(command.feetAngle, 0, 20, 'Feet angle') }
    case 'pillow-temperature': return { action, level: integer(command.level, -100, 100, 'Pillow level') }
    case 'audio-state': return { action, state: oneOf(command.state, ['Playing', 'Paused']) }
    case 'audio-volume': return { action, volume: integer(command.volume, 0, 100, 'Volume') }
    case 'audio-track': return { action, trackId: identifier(command.trackId) }
    case 'alarm-toggle': return { action, alarmId: identifier(command.alarmId), enabled: boolean(command.enabled) }
    case 'alarm-time': return { action, alarmId: identifier(command.alarmId), time: alarmTime(command.time) }
    case 'alarm-repeat':
      if (!Array.isArray(command.days) || command.days.length > 7) throw new EightSleepInputError('Choose up to seven weekdays')
      return { action, alarmId: identifier(command.alarmId), days: [...new Set(command.days.map(day => oneOf(day, WEEKDAYS)))] }
    case 'alarm-snooze': return { action, alarmId: identifier(command.alarmId), minutes: integer(command.minutes, 5, 30, 'Snooze minutes') }
    case 'alarm-dismiss': return { action, alarmId: identifier(command.alarmId) }
    case 'alarm-create': {
      const vibrationLevel = integer(command.vibrationLevel, 20, 100, 'Vibration level')
      if (![20, 50, 100].includes(vibrationLevel)) throw new EightSleepInputError('Choose vibration level 20, 50 or 100')
      return { action, time: alarmTime(command.time), enabled: boolean(command.enabled), vibration: boolean(command.vibration), vibrationLevel: vibrationLevel as 20 | 50 | 100,
        vibrationPattern: oneOf(command.vibrationPattern, ['RISE', 'intense']), thermal: boolean(command.thermal), thermalLevel: integer(command.thermalLevel, -100, 100, 'Thermal alarm level') }
    }
    default: throw new EightSleepInputError('Unsupported Eight Sleep command')
  }
}

export class EightSleepClient {
  private session: EightSleepSession | null
  private authentication: Promise<void> | null = null
  private context: Promise<{ userId: string, deviceId: string, side: EightSleepSide | null, device: any }> | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly config: EightSleepConfig) {
    this.session = config.session ?? null
    // Validate once, rather than silently date reports in the server's timezone.
    new Intl.DateTimeFormat('en', { timeZone: config.timezone || 'UTC' }).format()
  }
  isAuthenticated(): boolean { return Boolean(this.session && this.session.expiresAt > Date.now() + 60_000) }
  getSession(): EightSleepSession | null { return this.session ? { ...this.session } : null }

  async authenticate(force = false): Promise<void> {
    if (!force && this.isAuthenticated()) return
    if (this.authentication) return this.authentication
    this.authentication = (async () => {
      if (!this.config.email?.trim() || !this.config.password) throw new EightSleepError('Reconnect Eight Sleep with your email and password', 401)
      const data = await this.transport('auth', '/tokens', 'POST', {
        grant_type: 'password', username: this.config.email.trim(), password: this.config.password,
        client_id: this.config.clientId || EIGHT_SLEEP_PUBLIC_CLIENT_ID, client_secret: this.config.clientSecret || EIGHT_SLEEP_PUBLIC_CLIENT_SECRET,
      }, false)
      if (typeof data?.access_token !== 'string' || !data.access_token || typeof data?.userId !== 'string' || !data.userId || !(eightNumber(data.expires_in)! > 0))
        throw new EightSleepError('Eight Sleep returned an invalid sign-in session', 502)
      this.session = { accessToken: data.access_token, userId: data.userId, expiresAt: Date.now() + Number(data.expires_in) * 1000 }
      this.context = null
      await this.config.onSession?.({ ...this.session })
    })().finally(() => { this.authentication = null })
    return this.authentication
  }

  private async transport(host: keyof typeof HOSTS, path: string, method = 'GET', body?: unknown, authenticated = true): Promise<any> {
    let response: Response
    try {
      response = await (this.config.fetch ?? globalThis.fetch)(`${HOSTS[host]}${path}`, {
        method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${this.session!.accessToken}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(20_000),
      })
    }
    catch { throw new EightSleepError('Eight Sleep could not be reached. Try again shortly.', 0) }
    if (!response.ok) {
      const retry = response.headers.get('retry-after')
      const retryAfter = retry && Number.isFinite(Number(retry)) ? Math.max(0, Number(retry)) : null
      throw new EightSleepError(response.status === 401 ? 'Eight Sleep sign-in expired. Reconnect your account.'
        : response.status === 429 ? 'Eight Sleep is receiving too many requests. Try again later.'
          : response.status === 403 ? 'Eight Sleep has not granted access to this feature. Check your subscription and permissions.'
            : response.status === 404 ? 'This feature is unavailable on your Eight Sleep account or Pod.'
              : response.status === 409 ? 'The Pod cannot perform that action in its current state.'
                : `Eight Sleep could not complete the request (${response.status})`, response.status, retryAfter)
    }
    if (response.status === 204) return null
    const text = await response.text()
    if (!text.trim()) return null
    try { return JSON.parse(text) }
    catch { throw new EightSleepError('Eight Sleep returned an unreadable response', 502) }
  }

  private async request(host: 'client' | 'app', path: string, method = 'GET', body?: unknown): Promise<any> {
    await this.authenticate()
    try { return await this.transport(host, path, method, body) }
    catch (cause) {
      // Reads may retry once after re-authentication. Never replay a physical write.
      if (method === 'GET' && cause instanceof EightSleepError && cause.status === 401 && this.config.password) {
        await this.authenticate(true)
        return this.transport(host, path, method, body)
      }
      throw cause
    }
  }

  private async ownPod() {
    await this.authenticate()
    if (!this.context) {
      this.context = (async () => {
        const userId = this.session!.userId
        const profile = await this.request('client', `/users/${encodeURIComponent(userId)}`)
        const user = profile?.user
        if (!user || (user.userId && String(user.userId) !== userId)) throw new EightSleepError('Eight Sleep could not verify this sleeper', 502)
        const current = user.currentDevice ?? {}
        const deviceId = current.id ?? current.deviceId ?? user.devices?.[0]
        if (typeof deviceId !== 'string' || !deviceId) throw new EightSleepError('No Pod is linked to this Eight Sleep account', 404)
        const result = await this.request('client', `/devices/${encodeURIComponent(deviceId)}`)
        if (!result?.result || typeof result.result !== 'object') throw new EightSleepError('Eight Sleep returned an unreadable Pod', 502)
        const device = result.result
        const side = ['left', 'right', 'solo'].includes(current.side) ? current.side as EightSleepSide
          : device.leftUserId === userId || device.awaySides?.left === userId ? 'left' : device.rightUserId === userId || device.awaySides?.right === userId ? 'right' : null
        return { userId, deviceId, side, device }
      })().catch((cause) => {
        this.context = null
        throw cause
      })
    }
    return this.context
  }

  async getNights(options: EightSleepHistoryOptions = {}): Promise<EightSleepNight[]> {
    await this.authenticate()
    const today = new Date().toLocaleDateString('en-CA', { timeZone: this.config.timezone || 'UTC' })
    const endDate = options.endDate ?? today
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !Number.isFinite(Date.parse(`${endDate}T00:00:00Z`))) throw new EightSleepInputError('Use valid YYYY-MM-DD history dates')
    const startDate = options.startDate ?? new Date(Date.parse(`${endDate}T00:00:00Z`) - 30 * 86400_000).toISOString().slice(0, 10)
    for (const day of [startDate, endDate]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw new EightSleepInputError('Use valid YYYY-MM-DD history dates')
    }
    if (startDate > endDate || Date.parse(endDate) - Date.parse(startDate) > 366 * 86400_000) throw new EightSleepInputError('Read at most one year of sleep history at a time')
    const found = new Map<string, NonNullable<ReturnType<typeof normalizeEightSleepNight>>>()
    // Bounded windows avoid the provider silently truncating a long date range.
    for (let from = startDate; from <= endDate;) {
      const to = new Date(Math.min(Date.parse(`${endDate}T00:00:00Z`), Date.parse(`${from}T00:00:00Z`) + 29 * 86400_000)).toISOString().slice(0, 10)
      const query = new URLSearchParams({ tz: this.config.timezone || 'UTC', from, to, 'include-main': 'false', 'include-all-sessions': 'true', 'model-version': 'v2' })
      const data = await this.request('client', `/users/${encodeURIComponent(this.session!.userId)}/trends?${query}`)
      if (!Array.isArray(data?.days)) throw new EightSleepError('Eight Sleep returned an unreadable sleep history', 502)
      for (const report of data.days) {
        const night = normalizeEightSleepNight(report)
        if (night && night.day >= startDate && night.day <= endDate) found.set(night.day, night)
      }
      from = new Date(Date.parse(`${to}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10)
    }
    return [...found.values()].sort((a, b) => a.day.localeCompare(b.day))
  }

  async getDashboard(options: EightSleepHistoryOptions = {}): Promise<EightSleepDashboard> {
    this.context = null
    const { userId, deviceId, side, device } = await this.ownPod()
    const path = `/v1/users/${encodeURIComponent(userId)}`
    const unavailable: string[] = []
    const optional = async (name: string, task: () => Promise<any>) => {
      try { return await task() }
      catch (cause) {
        if (!(cause instanceof EightSleepError) || ![403, 404, 409].includes(cause.status)) throw cause
        unavailable.push(name)
        return null
      }
    }
    const features: string[] = Array.isArray(device.features) ? device.features.filter((feature: unknown) => typeof feature === 'string') : []
    const [temperature, nights, alarmData, baseData, accessories, player] = await Promise.all([
      optional('temperature', () => this.request('app', `${path}/temperature`)), this.getNights(options),
      optional('alarms', () => this.request('app', `/v2/users/${encodeURIComponent(userId)}/alarms`)),
      features.includes('elevation') ? optional('base', () => this.request('app', `${path}/base`)) : null,
      optional('pillow', () => this.request('app', `${path}/temperature/all`)),
      optional('audio', () => this.request('app', `${path}/audio/player`)),
    ])
    const tracks = player ? await optional('audio', () => this.request('app', `${path}/audio/tracks`)) : null
    const pillow = pillowForSide(Array.isArray(accessories?.devices) ? accessories.devices : [], side)
    // An accessory returned for a different Pod never appears on this Pod's dashboard.
    const hasPodMatch = Array.isArray(accessories?.devices) && accessories.devices.some((entry: any) => entry?.device?.deviceId === deviceId && entry.device.specialization === 'pod')
    const base = baseData?.[side === 'right' ? 'right' : 'left']
    const alarms: EightSleepAlarm[] = (Array.isArray(alarmData?.alarms) ? alarmData.alarms : []).filter((alarm: any) => typeof alarm?.id === 'string')
    const candidates = [...alarms, ...(alarmData?.recommendedAlarm?.id ? [alarmData.recommendedAlarm] : [])]
      .filter(alarm => alarm.enabled === true && eightInstant(alarm.nextTimestamp) && Date.parse(alarm.endTimestamp || alarm.nextTimestamp) >= Date.now())
      .sort((a, b) => Date.parse(a.nextTimestamp!) - Date.parse(b.nextTimestamp!))
    const smart: EightSleepTemperature['schedule'] = {}
    for (const stage of STAGES) {
      const value = eightNumber(temperature?.smart?.[stage])
      if (value !== null) smart[stage] = value
    }
    const schedules = [temperature?.currentSchedule, temperature?.nextSchedule].filter((schedule, index, all) => schedule && typeof schedule === 'object' && all.findIndex(candidate => candidate?.id === schedule.id) === index)
    return {
      fetchedAt: new Date().toISOString(),
      pod: { deviceId, name: typeof device.deviceName === 'string' ? device.deviceName : 'Eight Sleep Pod', side, features,
        hasWater: typeof device.hasWater === 'boolean' ? device.hasWater : null, needsPriming: typeof device.needsPriming === 'boolean' ? device.needsPriming : null,
        priming: typeof device.priming === 'boolean' ? device.priming : null, lastPrime: eightInstant(device.lastPrime), ledBrightness: eightNumber(device.ledBrightnessLevel) },
      temperature: { state: typeof temperature?.currentState?.type === 'string' ? temperature.currentState.type : null, level: eightNumber(temperature?.currentLevel), deviceLevel: eightNumber(temperature?.currentDeviceLevel), schedule: smart, bedtimeSchedules: schedules },
      nights, alarms, nextAlarm: candidates[0] ?? null,
      base: base ? { headAngle: eightNumber(base.torso?.currentAngle), feetAngle: eightNumber(base.leg?.currentAngle), preset: typeof base.preset?.name === 'string' ? base.preset.name : null, snoreMitigation: typeof base.inSnoreMitigation === 'boolean' ? base.inSnoreMitigation : null } : null,
      pillow: pillow && hasPodMatch ? { level: eightNumber(pillow.currentLevel), state: typeof pillow.currentState?.type === 'string' ? pillow.currentState.type : null } : null,
      audio: player && tracks ? { state: typeof player.state === 'string' ? player.state : null, volume: eightNumber(player.volume), currentTrack: player.currentTrack ?? null,
        tracks: (Array.isArray(tracks.tracks) ? tracks.tracks : []).filter((track: any) => typeof track.id === 'string').map((track: any) => ({ id: track.id, name: String(track.name || track.title || track.id) })) } : null,
      capabilities: { temperature: !!temperature, schedule: !!temperature && Object.keys(smart).length > 0, alarms: !!alarmData, base: !!base,
        pillow: !!pillow && hasPodMatch, audio: !!player && !!tracks, led: eightNumber(device.ledBrightnessLevel) !== null, priming: typeof device.needsPriming === 'boolean', away: !!side, side: !!side },
      unavailable: [...new Set(unavailable)].sort(),
    }
  }

  execute(input: EightSleepCommand | unknown): Promise<void> {
    const command = validateEightSleepCommand(input)
    const work = this.queue.catch(() => {}).then(() => this.perform(command))
    this.queue = work
    return work
  }

  private async perform(command: EightSleepCommand): Promise<void> {
    const { userId, deviceId, side, device } = await this.ownPod()
    const path = `/v1/users/${encodeURIComponent(userId)}`
    const temperature = `${path}/temperature`
    const put = (suffix: string, body: unknown) => this.request('app', suffix, 'PUT', body)
    const power = (enabled: boolean, suffix = '') => put(`${temperature}${suffix}`, { currentState: { type: enabled ? 'smart' : 'off' } })
    switch (command.action) {
      case 'power': await power(command.enabled)
        break
      case 'temperature':
        await power(true)
        await put(temperature, { currentLevel: command.level })
        await put(temperature, { timeBased: { level: command.level, durationSeconds: command.durationSeconds ?? 0 } })
        break
      case 'schedule': {
        const state = await this.request('app', temperature)
        if (!state?.smart || typeof state.smart !== 'object') throw new EightSleepError('This Pod does not report a temperature schedule', 404)
        await put(temperature, { smart: { ...state.smart, [command.stage]: command.level } })
        break
      }
      case 'side': await this.request('client', `/users/${encodeURIComponent(userId)}/current-device`, 'PUT', { id: deviceId, side: command.side })
        break
      case 'away':
        if (!side) throw new EightSleepError('Choose your bed side before setting away mode', 409)
        // A failed device selection must stop here, rather than change a different Pod.
        await this.request('client', `/users/${encodeURIComponent(userId)}/current-device`, 'PUT', { id: deviceId, side })
        await put(`${path}/away-mode`, { awayPeriod: { [command.enabled ? 'start' : 'end']: new Date(Date.now() - 86400_000).toISOString() } })
        break
      case 'prime': await this.request('app', `/v1/devices/${encodeURIComponent(deviceId)}/priming/tasks`, 'POST', { notifications: { users: [userId], meta: 'rePriming' } })
        break
      case 'led': await this.request('client', `/devices/${encodeURIComponent(deviceId)}`, 'PUT', { ledBrightnessLevel: command.level })
        break
      case 'base-angle': case 'base-preset':
        if (!Array.isArray(device.features) || !device.features.includes('elevation')) throw new EightSleepError('This Pod does not report an adjustable base', 404)
        await this.request('app', `${path}/base/angle?ignoreDeviceErrors=false`, 'POST', { deviceId, deviceOnline: true, enableOfflineMode: false,
          ...(command.action === 'base-angle' ? { legAngle: command.feetAngle, torsoAngle: command.headAngle } : { preset: command.preset }) })
        break
      case 'pillow-power': case 'pillow-temperature': {
        const current = await this.request('app', `${temperature}/all`)
        const devices = Array.isArray(current?.devices) ? current.devices : []
        if (!pillowForSide(devices, side) || !devices.some((entry: any) => entry?.device?.deviceId === deviceId && entry.device.specialization === 'pod')) throw new EightSleepError('No pillow is linked to your side of this Pod', 404)
        await power(command.action === 'pillow-power' ? command.enabled : true, '/pillow')
        if (command.action === 'pillow-temperature') await put(`${temperature}/pillow`, { currentLevel: command.level })
        break
      }
      case 'audio-state': await put(`${path}/audio/player/state`, { state: command.state })
        break
      case 'audio-volume': await put(`${path}/audio/player/volume`, { volume: command.volume })
        break
      case 'audio-track': {
        const data = await this.request('app', `${path}/audio/tracks`)
        if (!Array.isArray(data?.tracks) || !data.tracks.some((track: any) => track.id === command.trackId)) throw new EightSleepInputError('Choose an audio track offered by this Pod')
        await put(`${path}/audio/player/currentTrack`, { id: command.trackId, stopCriteria: 'ManualStop' })
        break
      }
      case 'alarm-create': await this.request('app', `${path}/alarms`, 'POST', { time: command.time, enabled: command.enabled,
        vibration: { enabled: command.vibration, powerLevel: command.vibrationLevel, pattern: command.vibrationPattern }, thermal: { enabled: command.thermal, level: command.thermalLevel } })
        break
      case 'alarm-toggle': case 'alarm-time': case 'alarm-repeat': case 'alarm-snooze': case 'alarm-dismiss': {
        const data = await this.request('app', `/v2/users/${encodeURIComponent(userId)}/alarms`)
        const alarm = [...(Array.isArray(data?.alarms) ? data.alarms : []), ...(data?.recommendedAlarm?.id ? [data.recommendedAlarm] : [])].find((candidate: any) => candidate?.id === command.alarmId)
        if (!alarm) throw new EightSleepInputError('This alarm is not linked to your Eight Sleep account')
        const alarmPath = `${path}/alarms/${encodeURIComponent(command.alarmId)}`
        if (command.action === 'alarm-dismiss') await put(`${alarmPath}/dismiss`, { ignoreDeviceErrors: false })
        else if (command.action === 'alarm-snooze') await put(`${alarmPath}/snooze`, { snoozeMinutes: command.minutes, ignoreDeviceErrors: false })
        else {
          const editable = { ...alarm, ...(command.action === 'alarm-toggle' ? { enabled: command.enabled }
            : command.action === 'alarm-time' ? { time: command.time }
              : { repeat: { ...(alarm.repeat || {}), enabled: command.days.length > 0, weekDays: Object.fromEntries(WEEKDAYS.map(day => [day, command.days.includes(day)])) } }) }
          for (const key of ['nextTimestamp', 'startTimestamp', 'endTimestamp', 'dismissedUntil', 'snoozedUntil']) delete editable[key]
          await put(alarmPath, editable)
        }
        break
      }
    }
    this.context = null
  }
}

export function createEightSleepClient(config: EightSleepConfig): EightSleepClient { return new EightSleepClient(config) }
