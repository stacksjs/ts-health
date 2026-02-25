/* eslint-disable no-console */
import { CLI } from '@stacksjs/clapp'
import { version } from '../package.json'
import type { HealthDriver, DateRangeOptions } from '../src/types'

const cli = new CLI('health')

const ALL_DRIVERS = 'oura, whoop, fitbit, apple-health, withings, renpho'

// ============================================================================
// Shared types & helpers
// ============================================================================

interface CommonOptions {
  driver: string
  token: string
  email?: string
  password?: string
  start?: string
  end?: string
  days?: number
  format?: string
  output?: string
  verbose?: boolean
}

async function resolveDriver(options: CommonOptions): Promise<HealthDriver | null> {
  const driverName = options.driver || 'oura'

  if (!options.token && driverName !== 'apple-health' && driverName !== 'renpho') {
    console.error('Missing --token option')
    return null
  }

  const { createOuraDriver } = await import('../src/drivers/oura')
  const { createWhoopDriver } = await import('../src/drivers/whoop')
  const { createFitbitDriver } = await import('../src/drivers/fitbit')
  const { createAppleHealthDriver } = await import('../src/drivers/apple-health')
  const { createWithingsDriver } = await import('../src/drivers/withings')
  const { createRenphoDriver } = await import('../src/drivers/renpho')

  switch (driverName) {
    case 'oura':
      return createOuraDriver(options.token)
    case 'whoop':
      return createWhoopDriver(options.token)
    case 'fitbit':
      return createFitbitDriver(options.token)
    case 'apple-health':
      return createAppleHealthDriver(options.token || './export.xml')
    case 'withings':
      return createWithingsDriver(options.token)
    case 'renpho':
      if (!options.email || !options.password) {
        console.error('Renpho requires --email and --password options')
        return null
      }
      return createRenphoDriver({ email: options.email, password: options.password, accessToken: options.token })
    default:
      console.error(`Unknown driver: ${driverName}. Available: ${ALL_DRIVERS}`)
      return null
  }
}

function resolveDateRange(options: CommonOptions, date?: string): DateRangeOptions {
  if (options.start || options.end) {
    return {
      startDate: options.start,
      endDate: options.end,
    }
  }

  if (date) {
    return { startDate: date, endDate: date }
  }

  const days = options.days ?? 7
  return {
    startDate: new Date(Date.now() - days * 86400000).toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
  }
}

function outputData(data: unknown, options: CommonOptions, label?: string): void {
  if (options.format === 'json') {
    const json = JSON.stringify(data, null, 2)
    if (options.output) {
      const fs = require('node:fs') as typeof import('node:fs')
      fs.mkdirSync(require('node:path').dirname(options.output), { recursive: true })
      fs.writeFileSync(options.output, json)
      console.log(`Data saved to ${options.output}`)
    }
    else {
      console.log(json)
    }
    return
  }

  if (options.output) {
    const json = JSON.stringify(data, null, 2)
    const fs = require('node:fs') as typeof import('node:fs')
    fs.mkdirSync(require('node:path').dirname(options.output), { recursive: true })
    fs.writeFileSync(options.output, json)
    console.log(`${label ? `${label}: ` : ''}Data saved to ${options.output}`)
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

function addCommonOptions(command: ReturnType<typeof cli.command>) {
  return command
    .option('--driver <driver>', `Health platform driver (${ALL_DRIVERS})`)
    .option('--token <token>', 'API access token / personal access token')
    .option('--email <email>', 'Email (for Renpho)')
    .option('--password <password>', 'Password (for Renpho)')
    .option('--start <date>', 'Start date (YYYY-MM-DD)')
    .option('--end <date>', 'End date (YYYY-MM-DD)')
    .option('--days <days>', 'Number of days to look back (default: 7)')
    .option('--format <format>', 'Output format: pretty, json (default: pretty)')
    .option('--output <file>', 'Save output to file')
    .option('--verbose', 'Enable verbose logging')
}

// ============================================================================
// sync — Sync all health data from a platform
// ============================================================================

addCommonOptions(cli.command('sync', 'Sync all health data from a platform'))
  .example('health sync --driver oura --token YOUR_TOKEN --start 2025-01-01')
  .example('health sync --driver withings --token YOUR_TOKEN --days 30')
  .example('health sync --driver renpho --email user@example.com --password pass123')
  .action(async (options: CommonOptions) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const dateRange = resolveDateRange(options)

    if (options.verbose) {
      console.log(`Syncing from ${driver.name}...`)
      console.log(`Date range: ${dateRange.startDate ?? 'all'} to ${dateRange.endDate ?? 'now'}`)
    }

    try {
      const [sleep, activity, readiness, hrv, heartRate, spo2, stress, bodyTemp, vo2max, bodyComposition, weight, workouts] = await Promise.all([
        driver.getDailySleep(dateRange),
        driver.getDailyActivity(dateRange),
        driver.getReadiness(dateRange),
        driver.getHRV(dateRange),
        driver.getHeartRate(dateRange),
        driver.getSpO2(dateRange),
        driver.getStress(dateRange),
        driver.getBodyTemperature(dateRange),
        driver.getVO2Max(dateRange),
        driver.getBodyComposition(dateRange),
        driver.getWeightMeasurements(dateRange),
        driver.getWorkouts(dateRange),
      ])

      const data = {
        driver: driver.name,
        sleep,
        activity,
        readiness,
        hrv,
        heartRate,
        spo2,
        stress,
        bodyTemp,
        vo2max,
        bodyComposition,
        weight,
        workouts,
        syncedAt: new Date().toISOString(),
      }

      console.log(`\nSync Summary (${driver.name}):`)
      console.log(`  Sleep records:          ${sleep.length}`)
      console.log(`  Activity records:       ${activity.length}`)
      console.log(`  Readiness records:      ${readiness.length}`)
      console.log(`  HRV samples:            ${hrv.length}`)
      console.log(`  Heart rate samples:     ${heartRate.length}`)
      console.log(`  SpO2 records:           ${spo2.length}`)
      console.log(`  Stress records:         ${stress.length}`)
      console.log(`  Body temp records:      ${bodyTemp.length}`)
      console.log(`  VO2 max records:        ${vo2max.length}`)
      console.log(`  Body composition:       ${bodyComposition.length}`)
      console.log(`  Weight measurements:    ${weight.length}`)
      console.log(`  Workouts:               ${workouts.length}`)

      const outputDir = options.output || './health-data'
      const fs = await import('node:fs')
      fs.mkdirSync(outputDir, { recursive: true })
      const outPath = `${outputDir}/health-data-${driver.type}-${new Date().toISOString().slice(0, 10)}.json`
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2))
      console.log(`\nData saved to ${outPath}`)
    }
    catch (err) {
      console.error('Sync failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// sleep — View sleep sessions
// ============================================================================

addCommonOptions(cli.command('sleep [date]', 'View sleep sessions with detailed metrics'))
  .example('health sleep --driver oura --token YOUR_TOKEN')
  .example('health sleep 2025-01-15 --driver oura --token YOUR_TOKEN')
  .example('health sleep --days 14 --driver fitbit --token YOUR_TOKEN --format json')
  .action(async (date: string | undefined, options: CommonOptions) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const dateRange = resolveDateRange(options, date)

    try {
      const sleep = await driver.getSleep(dateRange)

      if (options.format === 'json') {
        outputData(sleep, options)
        return
      }

      if (sleep.length === 0) {
        console.log('No sleep data found for the given date range.')
        return
      }

      for (const session of sleep) {
        const deep = Math.round(session.deepSleepDuration / 60)
        const rem = Math.round(session.remSleepDuration / 60)
        const light = Math.round(session.lightSleepDuration / 60)
        const awake = Math.round(session.awakeTime / 60)

        console.log(`${session.day}: ${formatDuration(session.totalSleepDuration)} sleep | efficiency: ${session.efficiency}% | deep: ${deep}m | REM: ${rem}m | light: ${light}m | awake: ${awake}m | HR: ${session.averageHeartRate ?? 'N/A'} bpm | HRV: ${session.averageHRV ?? 'N/A'}`)
      }

      console.log(`\n${sleep.length} session(s) found`)
      outputData(sleep, options, 'Sleep')
    }
    catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// activity — View daily activity data
// ============================================================================

addCommonOptions(cli.command('activity [date]', 'View daily activity data (steps, calories, distance)'))
  .example('health activity --driver oura --token YOUR_TOKEN --days 7')
  .action(async (date: string | undefined, options: CommonOptions) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const dateRange = resolveDateRange(options, date)

    try {
      const activity = await driver.getDailyActivity(dateRange)

      if (options.format === 'json') {
        outputData(activity, options)
        return
      }

      if (activity.length === 0) {
        console.log('No activity data found for the given date range.')
        return
      }

      for (const a of activity) {
        const distKm = (a.equivalentWalkingDistance / 1000).toFixed(1)
        console.log(`${a.day}: score ${a.score} | ${a.steps.toLocaleString()} steps | ${a.activeCalories} active cal | ${a.totalCalories} total cal | ${distKm} km | high: ${Math.round(a.highActivityTime / 60)}m | med: ${Math.round(a.mediumActivityTime / 60)}m | low: ${Math.round(a.lowActivityTime / 60)}m`)
      }

      console.log(`\n${activity.length} day(s) found`)
      outputData(activity, options, 'Activity')
    }
    catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// workouts — View workout history
// ============================================================================

addCommonOptions(cli.command('workouts [date]', 'View workout history'))
  .example('health workouts --driver oura --token YOUR_TOKEN --days 30')
  .action(async (date: string | undefined, options: CommonOptions) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const dateRange = resolveDateRange(options, date)

    try {
      const workouts = await driver.getWorkouts(dateRange)

      if (options.format === 'json') {
        outputData(workouts, options)
        return
      }

      if (workouts.length === 0) {
        console.log('No workouts found for the given date range.')
        return
      }

      for (const w of workouts) {
        const start = new Date(w.startDatetime)
        const end = new Date(w.endDatetime)
        const durationMin = Math.round((end.getTime() - start.getTime()) / 60000)
        const dist = w.distance ? `${(w.distance / 1000).toFixed(1)} km` : 'N/A'
        console.log(`${w.day}: ${w.activity} | ${durationMin}m | ${w.calories ?? 'N/A'} cal | ${dist} | intensity: ${w.intensity ?? 'N/A'} | avg HR: ${w.averageHeartRate ?? 'N/A'} bpm`)
      }

      console.log(`\n${workouts.length} workout(s) found`)
      outputData(workouts, options, 'Workouts')
    }
    catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// hr — View heart rate data
// ============================================================================

addCommonOptions(cli.command('hr [date]', 'View heart rate data'))
  .example('health hr --driver oura --token YOUR_TOKEN --days 1')
  .action(async (date: string | undefined, options: CommonOptions) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const dateRange = resolveDateRange(options, date)

    try {
      const samples = await driver.getHeartRate(dateRange)

      if (options.format === 'json') {
        outputData(samples, options)
        return
      }

      if (samples.length === 0) {
        console.log('No heart rate data found for the given date range.')
        return
      }

      // Show summary stats instead of every sample
      const bpms = samples.map(s => s.bpm)
      const avg = Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length)
      const min = Math.min(...bpms)
      const max = Math.max(...bpms)

      console.log(`Heart Rate Summary (${samples.length} samples):`)
      console.log(`  Average:  ${avg} bpm`)
      console.log(`  Min:      ${min} bpm`)
      console.log(`  Max:      ${max} bpm`)

      // Group by day and show daily stats
      const byDay = new Map<string, number[]>()
      for (const s of samples) {
        const day = s.timestamp.slice(0, 10)
        const arr = byDay.get(day) || []
        arr.push(s.bpm)
        byDay.set(day, arr)
      }

      if (byDay.size > 1) {
        console.log(`\nDaily breakdown:`)
        for (const [day, values] of [...byDay.entries()].sort()) {
          const dayAvg = Math.round(values.reduce((a, b) => a + b, 0) / values.length)
          const dayMin = Math.min(...values)
          const dayMax = Math.max(...values)
          console.log(`  ${day}: avg ${dayAvg} bpm | min ${dayMin} | max ${dayMax} | ${values.length} samples`)
        }
      }

      outputData(samples, options, 'Heart rate')
    }
    catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// hrv — View HRV data
// ============================================================================

addCommonOptions(cli.command('hrv [date]', 'View heart rate variability data'))
  .example('health hrv --driver oura --token YOUR_TOKEN --days 14')
  .action(async (date: string | undefined, options: CommonOptions) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const dateRange = resolveDateRange(options, date)

    try {
      const samples = await driver.getHRV(dateRange)

      if (options.format === 'json') {
        outputData(samples, options)
        return
      }

      if (samples.length === 0) {
        console.log('No HRV data found for the given date range.')
        return
      }

      const values = samples.map(s => s.hrv)
      const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length)
      const min = Math.min(...values)
      const max = Math.max(...values)

      console.log(`HRV Summary (${samples.length} samples):`)
      console.log(`  Average:  ${avg} ms`)
      console.log(`  Min:      ${min} ms`)
      console.log(`  Max:      ${max} ms`)

      // Group by day
      const byDay = new Map<string, number[]>()
      for (const s of samples) {
        const day = s.timestamp.slice(0, 10)
        const arr = byDay.get(day) || []
        arr.push(s.hrv)
        byDay.set(day, arr)
      }

      if (byDay.size > 1) {
        console.log(`\nDaily breakdown:`)
        for (const [day, vals] of [...byDay.entries()].sort()) {
          const dayAvg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
          const dayMax = Math.max(...vals)
          console.log(`  ${day}: avg ${dayAvg} ms | max ${dayMax} ms | ${vals.length} samples`)
        }
      }

      outputData(samples, options, 'HRV')
    }
    catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// spo2 — View SpO2 data
// ============================================================================

addCommonOptions(cli.command('spo2 [date]', 'View blood oxygen saturation data'))
  .example('health spo2 --driver oura --token YOUR_TOKEN --days 7')
  .action(async (date: string | undefined, options: CommonOptions) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const dateRange = resolveDateRange(options, date)

    try {
      const records = await driver.getSpO2(dateRange)

      if (options.format === 'json') {
        outputData(records, options)
        return
      }

      if (records.length === 0) {
        console.log('No SpO2 data found for the given date range.')
        return
      }

      for (const r of records) {
        const min = r.minSpO2 !== undefined ? ` | min: ${r.minSpO2}%` : ''
        const max = r.maxSpO2 !== undefined ? ` | max: ${r.maxSpO2}%` : ''
        console.log(`${r.day}: avg ${r.averageSpO2}%${min}${max}`)
      }

      console.log(`\n${records.length} day(s) found`)
      outputData(records, options, 'SpO2')
    }
    catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// stress — View stress data
// ============================================================================

addCommonOptions(cli.command('stress [date]', 'View daily stress levels'))
  .example('health stress --driver oura --token YOUR_TOKEN --days 7')
  .action(async (date: string | undefined, options: CommonOptions) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const dateRange = resolveDateRange(options, date)

    try {
      const records = await driver.getStress(dateRange)

      if (options.format === 'json') {
        outputData(records, options)
        return
      }

      if (records.length === 0) {
        console.log('No stress data found for the given date range.')
        return
      }

      for (const r of records) {
        const high = r.stressHigh !== undefined ? `stress: ${r.stressHigh}` : ''
        const recovery = r.recoveryHigh !== undefined ? ` | recovery: ${r.recoveryHigh}` : ''
        const summary = r.daySummary ? ` | ${r.daySummary}` : ''
        console.log(`${r.day}: ${high}${recovery}${summary}`)
      }

      console.log(`\n${records.length} day(s) found`)
      outputData(records, options, 'Stress')
    }
    catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// body-temp — View body temperature data
// ============================================================================

addCommonOptions(cli.command('body-temp [date]', 'View body temperature deviations'))
  .example('health body-temp --driver oura --token YOUR_TOKEN --days 14')
  .action(async (date: string | undefined, options: CommonOptions) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const dateRange = resolveDateRange(options, date)

    try {
      const records = await driver.getBodyTemperature(dateRange)

      if (options.format === 'json') {
        outputData(records, options)
        return
      }

      if (records.length === 0) {
        console.log('No body temperature data found for the given date range.')
        return
      }

      for (const r of records) {
        const dev = r.deviation !== undefined ? `${r.deviation > 0 ? '+' : ''}${r.deviation.toFixed(2)}°C` : 'N/A'
        const trend = r.trendDeviation !== undefined ? ` | trend: ${r.trendDeviation > 0 ? '+' : ''}${r.trendDeviation.toFixed(2)}°C` : ''
        console.log(`${r.day}: deviation ${dev}${trend}`)
      }

      console.log(`\n${records.length} day(s) found`)
      outputData(records, options, 'Body temp')
    }
    catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// vo2max — View VO2 max readings
// ============================================================================

addCommonOptions(cli.command('vo2max [date]', 'View VO2 max estimates'))
  .example('health vo2max --driver oura --token YOUR_TOKEN --days 30')
  .action(async (date: string | undefined, options: CommonOptions) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const dateRange = resolveDateRange(options, date)

    try {
      const records = await driver.getVO2Max(dateRange)

      if (options.format === 'json') {
        outputData(records, options)
        return
      }

      if (records.length === 0) {
        console.log('No VO2 max data found for the given date range.')
        return
      }

      for (const r of records) {
        console.log(`${r.day}: ${r.vo2Max.toFixed(1)} ml/kg/min`)
      }

      if (records.length >= 2) {
        const first = records[0].vo2Max
        const last = records[records.length - 1].vo2Max
        const change = last - first
        console.log(`\nTrend: ${change > 0 ? '+' : ''}${change.toFixed(1)} ml/kg/min over ${records.length} reading(s)`)
      }

      console.log(`${records.length} reading(s) found`)
      outputData(records, options, 'VO2 max')
    }
    catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// weight — View weight measurements
// ============================================================================

addCommonOptions(cli.command('weight [date]', 'View weight measurements from smart scales'))
  .example('health weight --driver withings --token YOUR_TOKEN --days 30')
  .example('health weight --driver renpho --email user@example.com --password pass123')
  .action(async (date: string | undefined, options: CommonOptions) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const dateRange = resolveDateRange(options, date)

    try {
      const records = await driver.getWeightMeasurements(dateRange)

      if (options.format === 'json') {
        outputData(records, options)
        return
      }

      if (records.length === 0) {
        console.log('No weight data found for the given date range.')
        return
      }

      for (const r of records) {
        const bmi = r.bmi !== undefined ? ` | BMI: ${r.bmi.toFixed(1)}` : ''
        console.log(`${r.day}: ${r.weight.toFixed(1)} kg (${(r.weight * 2.205).toFixed(1)} lbs)${bmi}`)
      }

      if (records.length >= 2) {
        const first = records[0].weight
        const last = records[records.length - 1].weight
        const change = last - first
        console.log(`\nChange: ${change > 0 ? '+' : ''}${change.toFixed(1)} kg over ${records.length} measurement(s)`)
      }

      console.log(`${records.length} measurement(s) found`)
      outputData(records, options, 'Weight')
    }
    catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// body — View full body composition from smart scales
// ============================================================================

addCommonOptions(cli.command('body [date]', 'View body composition data from smart scales'))
  .example('health body --driver withings --token YOUR_TOKEN --days 30')
  .example('health body --driver renpho --email user@example.com --password pass123 --format json')
  .action(async (date: string | undefined, options: CommonOptions) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const dateRange = resolveDateRange(options, date)

    try {
      const records = await driver.getBodyComposition(dateRange)

      if (options.format === 'json') {
        outputData(records, options)
        return
      }

      if (records.length === 0) {
        console.log('No body composition data found for the given date range.')
        return
      }

      for (const r of records) {
        const parts = [`${r.weight.toFixed(1)} kg`]
        if (r.bodyFatPercentage !== undefined) parts.push(`fat: ${r.bodyFatPercentage.toFixed(1)}%`)
        if (r.muscleMass !== undefined) parts.push(`muscle: ${r.muscleMass.toFixed(1)} kg`)
        if (r.boneMass !== undefined) parts.push(`bone: ${r.boneMass.toFixed(1)} kg`)
        if (r.waterPercentage !== undefined) parts.push(`water: ${r.waterPercentage.toFixed(1)}%`)
        if (r.bmi !== undefined) parts.push(`BMI: ${r.bmi.toFixed(1)}`)
        if (r.visceralFat !== undefined) parts.push(`visceral fat: ${r.visceralFat}`)
        if (r.basalMetabolicRate !== undefined) parts.push(`BMR: ${r.basalMetabolicRate} kcal`)
        if (r.metabolicAge !== undefined) parts.push(`metabolic age: ${r.metabolicAge}`)
        console.log(`${r.day}: ${parts.join(' | ')}`)
      }

      if (records.length >= 2) {
        const first = records[0]
        const last = records[records.length - 1]
        console.log(`\nChanges over ${records.length} measurement(s):`)
        const weightChange = last.weight - first.weight
        console.log(`  Weight: ${weightChange > 0 ? '+' : ''}${weightChange.toFixed(1)} kg`)
        if (first.bodyFatPercentage !== undefined && last.bodyFatPercentage !== undefined) {
          const fatChange = last.bodyFatPercentage - first.bodyFatPercentage
          console.log(`  Body fat: ${fatChange > 0 ? '+' : ''}${fatChange.toFixed(1)}%`)
        }
        if (first.muscleMass !== undefined && last.muscleMass !== undefined) {
          const muscleChange = last.muscleMass - first.muscleMass
          console.log(`  Muscle mass: ${muscleChange > 0 ? '+' : ''}${muscleChange.toFixed(1)} kg`)
        }
      }

      outputData(records, options, 'Body composition')
    }
    catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// readiness — View readiness scores
// ============================================================================

addCommonOptions(cli.command('readiness [date]', 'View daily readiness scores'))
  .example('health readiness --driver oura --token YOUR_TOKEN --days 7')
  .action(async (date: string | undefined, options: CommonOptions) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const dateRange = resolveDateRange(options, date)

    try {
      const readiness = await driver.getReadiness(dateRange)

      if (options.format === 'json') {
        outputData(readiness, options)
        return
      }

      if (readiness.length === 0) {
        console.log('No readiness data found for the given date range.')
        return
      }

      for (const r of readiness) {
        const temp = r.temperatureDeviation !== undefined ? `temp: ${r.temperatureDeviation > 0 ? '+' : ''}${r.temperatureDeviation.toFixed(2)}°C` : 'temp: N/A'
        const hrv = r.contributors.hrvBalance !== undefined ? `HRV balance: ${r.contributors.hrvBalance}` : 'HRV: N/A'
        const sleepBal = r.contributors.sleepBalance !== undefined ? `sleep balance: ${r.contributors.sleepBalance}` : ''
        const rhr = r.contributors.restingHeartRate !== undefined ? `resting HR: ${r.contributors.restingHeartRate}` : ''
        const parts = [`score ${r.score}`, temp, hrv, sleepBal, rhr].filter(Boolean)
        console.log(`${r.day}: ${parts.join(' | ')}`)
      }

      console.log(`\n${readiness.length} day(s) found`)
      outputData(readiness, options, 'Readiness')
    }
    catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// profile — View personal info
// ============================================================================

addCommonOptions(cli.command('profile', 'View personal profile information'))
  .example('health profile --driver oura --token YOUR_TOKEN')
  .action(async (options: CommonOptions) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    try {
      const info = await driver.getPersonalInfo()

      if (options.format === 'json') {
        outputData(info, options)
        return
      }

      if (!info) {
        console.log('No profile data available.')
        return
      }

      console.log(`Profile (${driver.name}):`)
      if (info.id) console.log(`  ID:     ${info.id}`)
      if (info.email) console.log(`  Email:  ${info.email}`)
      if (info.age !== undefined) console.log(`  Age:    ${info.age}`)
      if (info.weight !== undefined) console.log(`  Weight: ${info.weight} kg`)
      if (info.height !== undefined) console.log(`  Height: ${info.height} m`)
      if (info.biologicalSex) console.log(`  Sex:    ${info.biologicalSex}`)

      outputData(info, options, 'Profile')
    }
    catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// analyze — Full training readiness analysis
// ============================================================================

addCommonOptions(cli.command('analyze', 'Analyze training readiness from recent health data'))
  .example('health analyze --driver oura --token YOUR_TOKEN')
  .example('health analyze --driver oura --token YOUR_TOKEN --days 30')
  .action(async (options: CommonOptions) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const { createReadinessAnalyzer } = await import('../src/analysis/readiness')
    const analyzer = createReadinessAnalyzer()

    const days = options.days ?? 14
    const dateRange = resolveDateRange({ ...options, days })

    if (options.verbose) {
      console.log(`Analyzing ${days} days of data from ${driver.name}...`)
    }

    try {
      const [sleep, readiness, hrv, heartRate, activity] = await Promise.all([
        driver.getSleep(dateRange),
        driver.getReadiness(dateRange),
        driver.getHRV(dateRange),
        driver.getHeartRate(dateRange),
        driver.getDailyActivity(dateRange),
      ])

      const result = analyzer.calculateTrainingReadiness({
        sleep,
        readiness,
        hrv,
        heartRate,
        activity,
      })

      if (options.format === 'json') {
        outputData(result, options)
        return
      }

      console.log(`\nTraining Readiness: ${result.score}/100`)
      console.log(`Recommendation: ${result.recommendation.replace(/_/g, ' ').toUpperCase()}`)
      console.log(`\nFactors:`)
      console.log(`  HRV Status:        ${result.factors.hrvStatus}/100`)
      console.log(`  Sleep Quality:     ${result.factors.sleepQuality}/100`)
      console.log(`  Recovery Level:    ${result.factors.recoveryLevel}/100`)
      console.log(`  Resting HR:        ${result.factors.restingHeartRate}/100`)
      console.log(`  Activity Balance:  ${result.factors.activityBalance}/100`)
      console.log(`  Sleep Debt:        ${result.factors.sleepDebt}/100`)
      console.log(`\n${result.details}`)

      outputData(result, options, 'Training readiness')
    }
    catch (err) {
      console.error('Analysis failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// recovery — Recovery score analysis
// ============================================================================

addCommonOptions(cli.command('recovery', 'Analyze recovery status'))
  .example('health recovery --driver oura --token YOUR_TOKEN --days 14')
  .action(async (options: CommonOptions) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const { createRecoveryAnalyzer } = await import('../src/analysis/recovery')
    const analyzer = createRecoveryAnalyzer()

    const days = options.days ?? 14
    const dateRange = resolveDateRange({ ...options, days })

    try {
      const [sleep, readiness, hrv, activity] = await Promise.all([
        driver.getSleep(dateRange),
        driver.getReadiness(dateRange),
        driver.getHRV(dateRange),
        driver.getDailyActivity(dateRange),
      ])

      const result = analyzer.calculateRecovery({
        sleep,
        readiness,
        hrv,
        activity,
      })

      if (options.format === 'json') {
        outputData(result, options)
        return
      }

      console.log(`\nRecovery Score: ${result.score}/100`)
      console.log(`Status: ${result.status.replace(/_/g, ' ').toUpperCase()}`)
      console.log(`\nFactors:`)
      console.log(`  Sleep Score:       ${result.factors.sleepScore}/100`)
      console.log(`  HRV Trend:         ${result.factors.hrvTrend}/100`)
      console.log(`  Resting HR Trend:  ${result.factors.restingHRTrend}/100`)
      console.log(`  Strain Balance:    ${result.factors.strainBalance}/100`)

      outputData(result, options, 'Recovery')
    }
    catch (err) {
      console.error('Analysis failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// sleep-quality — Sleep quality scoring for individual sessions
// ============================================================================

addCommonOptions(cli.command('sleep-quality [date]', 'Score sleep quality for recent sessions'))
  .example('health sleep-quality --driver oura --token YOUR_TOKEN')
  .example('health sleep-quality 2025-01-15 --driver oura --token YOUR_TOKEN')
  .action(async (date: string | undefined, options: CommonOptions) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const { createSleepAnalyzer } = await import('../src/analysis/sleep')
    const analyzer = createSleepAnalyzer()

    const dateRange = resolveDateRange(options, date)

    try {
      const sessions = await driver.getSleep(dateRange)

      if (sessions.length === 0) {
        console.log('No sleep data found for the given date range.')
        return
      }

      const scores = sessions.map(s => ({
        day: s.day,
        ...analyzer.scoreSleepQuality(s),
      }))

      if (options.format === 'json') {
        outputData(scores, options)
        return
      }

      for (const s of scores) {
        console.log(`${s.day}: ${s.overall}/100 (${s.rating}) | duration: ${s.durationScore} | efficiency: ${s.efficiencyScore} | deep: ${s.deepSleepScore} | REM: ${s.remSleepScore} | latency: ${s.latencyScore}`)
      }

      // Show consistency score if we have enough sessions
      if (sessions.length >= 3) {
        const consistency = analyzer.scoreSleepConsistency(sessions)
        console.log(`\nSleep consistency score: ${consistency}/100`)
      }

      const avgScore = Math.round(scores.reduce((sum, s) => sum + s.overall, 0) / scores.length)
      console.log(`Average quality: ${avgScore}/100`)
      console.log(`${scores.length} session(s) analyzed`)

      outputData(scores, options, 'Sleep quality')
    }
    catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// sleep-debt — Sleep debt analysis
// ============================================================================

addCommonOptions(cli.command('sleep-debt', 'Analyze accumulated sleep debt'))
  .option('--target <minutes>', 'Target sleep duration in minutes (default: 480 = 8h)')
  .example('health sleep-debt --driver oura --token YOUR_TOKEN --days 14')
  .example('health sleep-debt --driver oura --token YOUR_TOKEN --target 450')
  .action(async (options: CommonOptions & { target?: number }) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const { createSleepAnalyzer } = await import('../src/analysis/sleep')
    const analyzer = createSleepAnalyzer()

    const days = options.days ?? 14
    const dateRange = resolveDateRange({ ...options, days })

    try {
      const sessions = await driver.getSleep(dateRange)

      if (sessions.length === 0) {
        console.log('No sleep data found for the given date range.')
        return
      }

      const targetMinutes = options.target ?? 480
      const result = analyzer.analyzeSleepDebt(sessions, targetMinutes)

      if (options.format === 'json') {
        outputData(result, options)
        return
      }

      const targetH = Math.floor(targetMinutes / 60)
      const targetM = targetMinutes % 60

      console.log(`\nSleep Debt Analysis (last ${days} days):`)
      console.log(`  Target:          ${targetH}h ${targetM}m per night`)
      console.log(`  Weekly average:  ${Math.floor(result.weeklyAverageMinutes / 60)}h ${result.weeklyAverageMinutes % 60}m`)
      console.log(`  Current debt:    ${Math.floor(result.currentDebtMinutes / 60)}h ${result.currentDebtMinutes % 60}m`)
      console.log(`  Trend:           ${result.trend}`)
      if (result.daysToRecover > 0) {
        console.log(`  Days to recover: ~${result.daysToRecover} days (at +30m/night)`)
      }
      else {
        console.log(`  No sleep debt detected`)
      }

      outputData(result, options, 'Sleep debt')
    }
    catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// trends — Analyze health metric trends
// ============================================================================

addCommonOptions(cli.command('trends', 'Analyze trends across health metrics'))
  .option('--metrics <metrics>', 'Comma-separated metrics to track: weight,sleep,hrv,hr,steps,spo2 (default: all available)')
  .example('health trends --driver oura --token YOUR_TOKEN --days 30')
  .example('health trends --driver withings --token YOUR_TOKEN --days 60 --metrics weight')
  .action(async (options: CommonOptions & { metrics?: string }) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const { createTrendAnalyzer } = await import('../src/analysis/trends')
    const analyzer = createTrendAnalyzer()

    const days = options.days ?? 30
    const dateRange = resolveDateRange({ ...options, days })

    const requestedMetrics = options.metrics?.split(',').map(m => m.trim()) ?? []
    const trackAll = requestedMetrics.length === 0

    try {
      const metricsData: Array<{
        name: string
        dataPoints: Array<{ day: string
        value: number }>
      }> = []

      if (trackAll || requestedMetrics.includes('sleep')) {
        const sleep = await driver.getSleep(dateRange)
        if (sleep.length > 0) {
          metricsData.push({
            name: 'Sleep Duration (hours)',
            dataPoints: sleep.map(s => ({ day: s.day, value: Math.round(s.totalSleepDuration / 3600 * 10) / 10 })),
          })
          metricsData.push({
            name: 'Sleep Efficiency (%)',
            dataPoints: sleep.map(s => ({ day: s.day, value: s.efficiency })),
          })
        }
      }

      if (trackAll || requestedMetrics.includes('hrv')) {
        const hrv = await driver.getHRV(dateRange)
        if (hrv.length > 0) {
          // Group by day and average
          const byDay = new Map<string, number[]>()
          for (const s of hrv) {
            const day = s.timestamp.slice(0, 10)
            const arr = byDay.get(day) || []
            arr.push(s.hrv)
            byDay.set(day, arr)
          }
          metricsData.push({
            name: 'HRV (ms)',
            dataPoints: [...byDay.entries()].map(([day, vals]) => ({
              day,
              value: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
            })),
          })
        }
      }

      if (trackAll || requestedMetrics.includes('hr')) {
        const hr = await driver.getHeartRate(dateRange)
        if (hr.length > 0) {
          const byDay = new Map<string, number[]>()
          for (const s of hr) {
            const day = s.timestamp.slice(0, 10)
            const arr = byDay.get(day) || []
            arr.push(s.bpm)
            byDay.set(day, arr)
          }
          metricsData.push({
            name: 'Resting Heart Rate (bpm)',
            dataPoints: [...byDay.entries()].map(([day, vals]) => ({
              day,
              value: Math.min(...vals), // resting = min of day
            })),
          })
        }
      }

      if (trackAll || requestedMetrics.includes('steps')) {
        const activity = await driver.getDailyActivity(dateRange)
        if (activity.length > 0) {
          metricsData.push({
            name: 'Steps',
            dataPoints: activity.map(a => ({ day: a.day, value: a.steps })),
          })
          metricsData.push({
            name: 'Active Calories',
            dataPoints: activity.map(a => ({ day: a.day, value: a.activeCalories })),
          })
        }
      }

      if (trackAll || requestedMetrics.includes('spo2')) {
        const spo2 = await driver.getSpO2(dateRange)
        if (spo2.length > 0) {
          metricsData.push({
            name: 'SpO2 (%)',
            dataPoints: spo2.map(s => ({ day: s.day, value: s.averageSpO2 })),
          })
        }
      }

      if (trackAll || requestedMetrics.includes('weight')) {
        const weight = await driver.getWeightMeasurements(dateRange)
        if (weight.length > 0) {
          metricsData.push({
            name: 'Weight (kg)',
            dataPoints: weight.map(w => ({ day: w.day, value: w.weight })),
          })
        }
      }

      if (metricsData.length === 0) {
        console.log('No data found for trend analysis.')
        return
      }

      const trends = analyzer.analyzeMultipleMetrics(metricsData, days)

      if (options.format === 'json') {
        outputData(trends, options)
        return
      }

      console.log(`\nHealth Trends (last ${days} days):`)
      console.log('─'.repeat(70))

      for (const trend of trends) {
        const arrow = trend.direction === 'improving' ? '↑' : trend.direction === 'declining' ? '↓' : '→'
        const changeStr = trend.percentChange !== 0 ? ` (${trend.percentChange > 0 ? '+' : ''}${trend.percentChange.toFixed(1)}%)` : ''
        console.log(`  ${arrow} ${trend.metric}: ${trend.currentAverage} avg${changeStr} — ${trend.direction}`)
      }

      // Detect anomalies
      let hasAnomalies = false
      for (const m of metricsData) {
        const anomalies = analyzer.detectAnomalies(m.dataPoints)
        if (anomalies.length > 0) {
          if (!hasAnomalies) {
            console.log(`\nAnomalies detected:`)
            hasAnomalies = true
          }
          for (const a of anomalies) {
            const dir = a.deviation > 0 ? 'high' : 'low'
            console.log(`  ${a.day}: ${m.name} unusually ${dir} (${a.value}, ${Math.abs(a.deviation).toFixed(1)} std dev)`)
          }
        }
      }

      outputData(trends, options, 'Trends')
    }
    catch (err) {
      console.error('Analysis failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// dashboard — Quick overview of today's health data
// ============================================================================

addCommonOptions(cli.command('dashboard', 'Quick overview of recent health metrics'))
  .example('health dashboard --driver oura --token YOUR_TOKEN')
  .action(async (options: CommonOptions) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const today = new Date().toISOString().slice(0, 10)
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
    const recentRange = { startDate: weekAgo, endDate: today }

    try {
      const [sleep, activity, readiness, hrv, spo2, stress, bodyComp] = await Promise.all([
        driver.getSleep(recentRange),
        driver.getDailyActivity(recentRange),
        driver.getReadiness(recentRange),
        driver.getHRV(recentRange),
        driver.getSpO2(recentRange),
        driver.getStress(recentRange),
        driver.getBodyComposition(recentRange),
      ])

      if (options.format === 'json') {
        outputData({ sleep, activity, readiness, hrv, spo2, stress, bodyComp }, options)
        return
      }

      console.log(`\n╔══════════════════════════════════════════════════╗`)
      console.log(`║  Health Dashboard — ${driver.name}`)
      console.log(`╚══════════════════════════════════════════════════╝`)

      // Last night's sleep
      if (sleep.length > 0) {
        const lastSleep = sleep.sort((a, b) => b.day.localeCompare(a.day))[0]
        console.log(`\n  Last Night's Sleep (${lastSleep.day}):`)
        console.log(`    Duration:    ${formatDuration(lastSleep.totalSleepDuration)}`)
        console.log(`    Efficiency:  ${lastSleep.efficiency}%`)
        console.log(`    Deep:        ${Math.round(lastSleep.deepSleepDuration / 60)}m | REM: ${Math.round(lastSleep.remSleepDuration / 60)}m`)
        if (lastSleep.averageHRV) console.log(`    HRV:         ${lastSleep.averageHRV} ms`)
        if (lastSleep.averageHeartRate) console.log(`    Avg HR:      ${lastSleep.averageHeartRate} bpm`)
      }

      // Latest readiness
      if (readiness.length > 0) {
        const latest = readiness.sort((a, b) => b.day.localeCompare(a.day))[0]
        console.log(`\n  Readiness (${latest.day}):`)
        console.log(`    Score:       ${latest.score}/100`)
      }

      // Latest activity
      if (activity.length > 0) {
        const latest = activity.sort((a, b) => b.day.localeCompare(a.day))[0]
        console.log(`\n  Activity (${latest.day}):`)
        console.log(`    Steps:       ${latest.steps.toLocaleString()}`)
        console.log(`    Calories:    ${latest.activeCalories} active / ${latest.totalCalories} total`)
      }

      // HRV trend
      if (hrv.length > 0) {
        const values = hrv.map(s => s.hrv)
        const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length)
        console.log(`\n  HRV (7-day):`)
        console.log(`    Average:     ${avg} ms`)
      }

      // SpO2
      if (spo2.length > 0) {
        const latest = spo2.sort((a, b) => b.day.localeCompare(a.day))[0]
        console.log(`\n  SpO2 (${latest.day}):`)
        console.log(`    Average:     ${latest.averageSpO2}%`)
      }

      // Stress
      if (stress.length > 0) {
        const latest = stress.sort((a, b) => b.day.localeCompare(a.day))[0]
        if (latest.daySummary) {
          console.log(`\n  Stress (${latest.day}):`)
          console.log(`    Status:      ${latest.daySummary}`)
        }
      }

      // Body composition
      if (bodyComp.length > 0) {
        const latest = bodyComp.sort((a, b) => b.day.localeCompare(a.day))[0]
        console.log(`\n  Body (${latest.day}):`)
        console.log(`    Weight:      ${latest.weight.toFixed(1)} kg`)
        if (latest.bodyFatPercentage !== undefined) console.log(`    Body fat:    ${latest.bodyFatPercentage.toFixed(1)}%`)
        if (latest.muscleMass !== undefined) console.log(`    Muscle:      ${latest.muscleMass.toFixed(1)} kg`)
      }

      console.log('')
      outputData({ sleep, activity, readiness, hrv, spo2, stress, bodyComp }, options, 'Dashboard')
    }
    catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// compare — Compare data across two date ranges
// ============================================================================

cli
  .command('compare', 'Compare health metrics between two time periods')
  .option('--driver <driver>', `Health platform driver (${ALL_DRIVERS})`)
  .option('--token <token>', 'API access token / personal access token')
  .option('--email <email>', 'Email (for Renpho)')
  .option('--password <password>', 'Password (for Renpho)')
  .option('--period1-start <date>', 'Period 1 start date (YYYY-MM-DD)')
  .option('--period1-end <date>', 'Period 1 end date (YYYY-MM-DD)')
  .option('--period2-start <date>', 'Period 2 start date (YYYY-MM-DD)')
  .option('--period2-end <date>', 'Period 2 end date (YYYY-MM-DD)')
  .option('--days <days>', 'Compare last N days vs previous N days (default: 7)')
  .option('--format <format>', 'Output format: pretty, json')
  .option('--output <file>', 'Save output to file')
  .option('--verbose', 'Enable verbose logging')
  .example('health compare --driver oura --token YOUR_TOKEN --days 14')
  .example('health compare --driver oura --token YOUR_TOKEN --period1-start 2025-01-01 --period1-end 2025-01-14 --period2-start 2025-01-15 --period2-end 2025-01-28')
  .action(async (options: CommonOptions & {
    period1Start?: string
    period1End?: string
    period2Start?: string
    period2End?: string
  }) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const days = options.days ?? 7

    let period1: DateRangeOptions
    let period2: DateRangeOptions

    if (options.period1Start && options.period2Start) {
      period1 = { startDate: options.period1Start, endDate: options.period1End }
      period2 = { startDate: options.period2Start, endDate: options.period2End }
    }
    else {
      const now = Date.now()
      period2 = {
        startDate: new Date(now - days * 86400000).toISOString().slice(0, 10),
        endDate: new Date(now).toISOString().slice(0, 10),
      }
      period1 = {
        startDate: new Date(now - days * 2 * 86400000).toISOString().slice(0, 10),
        endDate: new Date(now - days * 86400000).toISOString().slice(0, 10),
      }
    }

    try {
      const [sleep1, sleep2, activity1, activity2, hrv1, hrv2, weight1, weight2] = await Promise.all([
        driver.getSleep(period1),
        driver.getSleep(period2),
        driver.getDailyActivity(period1),
        driver.getDailyActivity(period2),
        driver.getHRV(period1),
        driver.getHRV(period2),
        driver.getWeightMeasurements(period1),
        driver.getWeightMeasurements(period2),
      ])

      const comparison: Record<string, {
        period1: number
        period2: number
        change: number
        unit: string
      }> = {}

      if (sleep1.length > 0 && sleep2.length > 0) {
        const avg1 = sleep1.reduce((s, x) => s + x.totalSleepDuration, 0) / sleep1.length / 3600
        const avg2 = sleep2.reduce((s, x) => s + x.totalSleepDuration, 0) / sleep2.length / 3600
        comparison['Sleep Duration'] = { period1: Math.round(avg1 * 10) / 10, period2: Math.round(avg2 * 10) / 10, change: Math.round((avg2 - avg1) * 10) / 10, unit: 'h' }

        const eff1 = sleep1.reduce((s, x) => s + x.efficiency, 0) / sleep1.length
        const eff2 = sleep2.reduce((s, x) => s + x.efficiency, 0) / sleep2.length
        comparison['Sleep Efficiency'] = { period1: Math.round(eff1), period2: Math.round(eff2), change: Math.round(eff2 - eff1), unit: '%' }
      }

      if (activity1.length > 0 && activity2.length > 0) {
        const steps1 = activity1.reduce((s, x) => s + x.steps, 0) / activity1.length
        const steps2 = activity2.reduce((s, x) => s + x.steps, 0) / activity2.length
        comparison['Daily Steps'] = { period1: Math.round(steps1), period2: Math.round(steps2), change: Math.round(steps2 - steps1), unit: '' }

        const cal1 = activity1.reduce((s, x) => s + x.activeCalories, 0) / activity1.length
        const cal2 = activity2.reduce((s, x) => s + x.activeCalories, 0) / activity2.length
        comparison['Active Calories'] = { period1: Math.round(cal1), period2: Math.round(cal2), change: Math.round(cal2 - cal1), unit: 'cal' }
      }

      if (hrv1.length > 0 && hrv2.length > 0) {
        const hrvAvg1 = hrv1.reduce((s, x) => s + x.hrv, 0) / hrv1.length
        const hrvAvg2 = hrv2.reduce((s, x) => s + x.hrv, 0) / hrv2.length
        comparison['HRV'] = { period1: Math.round(hrvAvg1), period2: Math.round(hrvAvg2), change: Math.round(hrvAvg2 - hrvAvg1), unit: 'ms' }
      }

      if (weight1.length > 0 && weight2.length > 0) {
        const w1 = weight1.reduce((s, x) => s + x.weight, 0) / weight1.length
        const w2 = weight2.reduce((s, x) => s + x.weight, 0) / weight2.length
        comparison['Weight'] = { period1: Math.round(w1 * 10) / 10, period2: Math.round(w2 * 10) / 10, change: Math.round((w2 - w1) * 10) / 10, unit: 'kg' }
      }

      if (options.format === 'json') {
        outputData({ period1, period2, comparison }, options)
        return
      }

      console.log(`\nComparison: Period 1 (${period1.startDate} to ${period1.endDate}) vs Period 2 (${period2.startDate} to ${period2.endDate})`)
      console.log('─'.repeat(70))

      for (const [metric, data] of Object.entries(comparison)) {
        const arrow = data.change > 0 ? '↑' : data.change < 0 ? '↓' : '→'
        const sign = data.change > 0 ? '+' : ''
        console.log(`  ${metric.padEnd(20)} ${String(data.period1).padStart(8)}${data.unit}  →  ${String(data.period2).padStart(8)}${data.unit}  ${arrow} ${sign}${data.change}${data.unit}`)
      }

      if (Object.keys(comparison).length === 0) {
        console.log('  No comparable data found for both periods.')
      }

      outputData({ period1, period2, comparison }, options, 'Comparison')
    }
    catch (err) {
      console.error('Comparison failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// export — Export all data in a specific format
// ============================================================================

addCommonOptions(cli.command('export', 'Export all health data to JSON'))
  .example('health export --driver oura --token YOUR_TOKEN --days 90 --output ./my-health-data.json')
  .action(async (options: CommonOptions) => {
    const driver = await resolveDriver(options)
    if (!driver) return

    const days = options.days ?? 30
    const dateRange = resolveDateRange({ ...options, days })
    const outFile = options.output || `./health-export-${driver.type}-${new Date().toISOString().slice(0, 10)}.json`

    console.log(`Exporting ${days} days of data from ${driver.name}...`)

    try {
      const [sleep, dailySleep, activity, workouts, readiness, heartRate, hrv, spo2, stress, bodyTemp, vo2max, bodyComposition, weight, personalInfo] = await Promise.all([
        driver.getSleep(dateRange),
        driver.getDailySleep(dateRange),
        driver.getDailyActivity(dateRange),
        driver.getWorkouts(dateRange),
        driver.getReadiness(dateRange),
        driver.getHeartRate(dateRange),
        driver.getHRV(dateRange),
        driver.getSpO2(dateRange),
        driver.getStress(dateRange),
        driver.getBodyTemperature(dateRange),
        driver.getVO2Max(dateRange),
        driver.getBodyComposition(dateRange),
        driver.getWeightMeasurements(dateRange),
        driver.getPersonalInfo(),
      ])

      const data = {
        meta: {
          driver: driver.name,
          driverType: driver.type,
          exportedAt: new Date().toISOString(),
          dateRange,
        },
        personalInfo,
        sleep,
        dailySleep,
        activity,
        workouts,
        readiness,
        heartRate,
        hrv,
        spo2,
        stress,
        bodyTemp,
        vo2max,
        bodyComposition,
        weight,
      }

      const fs = await import('node:fs')
      const path = await import('node:path')
      fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true })
      fs.writeFileSync(outFile, JSON.stringify(data, null, 2))

      const stats = {
        sleep: sleep.length,
        dailySleep: dailySleep.length,
        activity: activity.length,
        workouts: workouts.length,
        readiness: readiness.length,
        heartRate: heartRate.length,
        hrv: hrv.length,
        spo2: spo2.length,
        stress: stress.length,
        bodyTemp: bodyTemp.length,
        vo2max: vo2max.length,
        bodyComposition: bodyComposition.length,
        weight: weight.length,
      }

      const totalRecords = Object.values(stats).reduce((a, b) => a + b, 0)
      console.log(`Exported ${totalRecords.toLocaleString()} records to ${outFile}`)

      for (const [key, count] of Object.entries(stats)) {
        if (count > 0) {
          console.log(`  ${key}: ${count}`)
        }
      }
    }
    catch (err) {
      console.error('Export failed:', err instanceof Error ? err.message : err)
    }
  })

// ============================================================================
// version
// ============================================================================

cli.command('version', 'Show the version of the CLI').action(() => {
  console.log(version)
})

cli.version(version)
cli.help()
cli.parse()
