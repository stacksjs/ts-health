import { CAC } from 'cac'
import { version } from '../package.json'

const cli = new CAC('health')

interface SyncOptions {
  driver: string
  token: string
  start?: string
  end?: string
  output?: string
  verbose?: boolean
}

interface AnalyzeOptions {
  driver: string
  token: string
  start?: string
  end?: string
  verbose?: boolean
}

cli
  .command('sync', 'Sync health data from a platform')
  .option('--driver <driver>', 'Health platform driver (oura, whoop, fitbit, apple-health)')
  .option('--token <token>', 'API access token / personal access token')
  .option('--start <date>', 'Start date (YYYY-MM-DD)')
  .option('--end <date>', 'End date (YYYY-MM-DD)')
  .option('--output <dir>', 'Output directory')
  .option('--verbose', 'Enable verbose logging')
  .example('health sync --driver oura --token YOUR_TOKEN --start 2025-01-01')
  .action(async (options?: SyncOptions) => {
    if (!options?.driver) {
      console.error('Missing --driver option. Use: oura, whoop, fitbit, apple-health')
      return
    }

    if (!options.token && options.driver !== 'apple-health') {
      console.error('Missing --token option')
      return
    }

    const { createOuraDriver } = await import('../src/drivers/oura')
    const { createWhoopDriver } = await import('../src/drivers/whoop')
    const { createFitbitDriver } = await import('../src/drivers/fitbit')
    const { createAppleHealthDriver } = await import('../src/drivers/apple-health')

    const dateRange = {
      startDate: options.start,
      endDate: options.end,
    }

    let driver
    switch (options.driver) {
      case 'oura':
        driver = createOuraDriver(options.token)
        break
      case 'whoop':
        driver = createWhoopDriver(options.token)
        break
      case 'fitbit':
        driver = createFitbitDriver(options.token)
        break
      case 'apple-health':
        driver = createAppleHealthDriver(options.token || './export.xml')
        break
      default:
        console.error(`Unknown driver: ${options.driver}`)
        return
    }

    if (options.verbose) {
      console.log(`Syncing from ${options.driver}...`)
    }

    try {
      const [sleep, activity, readiness, hrv] = await Promise.all([
        driver.getDailySleep(dateRange),
        driver.getDailyActivity(dateRange),
        driver.getReadiness(dateRange),
        driver.getHRV(dateRange),
      ])

      console.log(`Sleep records: ${sleep.length}`)
      console.log(`Activity records: ${activity.length}`)
      console.log(`Readiness records: ${readiness.length}`)
      console.log(`HRV samples: ${hrv.length}`)

      if (options.output) {
        const data = { sleep, activity, readiness, hrv, syncedAt: new Date().toISOString() }
        const fs = await import('fs')
        fs.mkdirSync(options.output, { recursive: true })
        const outPath = `${options.output}/health-data-${new Date().toISOString().slice(0, 10)}.json`
        fs.writeFileSync(outPath, JSON.stringify(data, null, 2))
        console.log(`Data saved to ${outPath}`)
      }
    }
    catch (err) {
      console.error('Sync failed:', err instanceof Error ? err.message : err)
    }
  })

cli
  .command('sleep [date]', 'Get sleep data for a specific date or date range')
  .option('--driver <driver>', 'Health platform driver (oura, whoop, fitbit, apple-health)')
  .option('--token <token>', 'API access token')
  .option('--start <date>', 'Start date (YYYY-MM-DD)')
  .option('--end <date>', 'End date (YYYY-MM-DD)')
  .option('--verbose', 'Enable verbose logging')
  .action(async (date?: string, options?: AnalyzeOptions) => {
    const driver = options?.driver || 'oura'
    const token = options?.token || ''

    if (!token && driver !== 'apple-health') {
      console.error('Missing --token option')
      return
    }

    const { createOuraDriver } = await import('../src/drivers/oura')
    const driverInstance = createOuraDriver(token)

    const dateRange = {
      startDate: options?.start || date || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
      endDate: options?.end || date || new Date().toISOString().slice(0, 10),
    }

    try {
      const sleep = await driverInstance.getSleep(dateRange)
      for (const session of sleep) {
        const hours = Math.floor(session.totalSleepDuration / 3600)
        const mins = Math.floor((session.totalSleepDuration % 3600) / 60)
        console.log(`${session.day}: ${hours}h ${mins}m sleep | efficiency: ${session.efficiency}% | deep: ${Math.round(session.deepSleepDuration / 60)}m | REM: ${Math.round(session.remSleepDuration / 60)}m | HRV: ${session.averageHRV ?? 'N/A'}`)
      }
    }
    catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
    }
  })

cli
  .command('readiness [date]', 'Get training readiness for a date')
  .option('--driver <driver>', 'Health platform driver')
  .option('--token <token>', 'API access token')
  .option('--start <date>', 'Start date (YYYY-MM-DD)')
  .option('--end <date>', 'End date (YYYY-MM-DD)')
  .option('--verbose', 'Enable verbose logging')
  .action(async (date?: string, options?: AnalyzeOptions) => {
    const token = options?.token || ''

    if (!token) {
      console.error('Missing --token option')
      return
    }

    const { createOuraDriver } = await import('../src/drivers/oura')
    const driver = createOuraDriver(token)

    const dateRange = {
      startDate: options?.start || date || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
      endDate: options?.end || date || new Date().toISOString().slice(0, 10),
    }

    try {
      const readiness = await driver.getReadiness(dateRange)
      for (const r of readiness) {
        console.log(`${r.day}: score ${r.score} | temp: ${r.temperatureDeviation ?? 'N/A'}°C | HRV balance: ${r.contributors.hrvBalance ?? 'N/A'} | sleep balance: ${r.contributors.sleepBalance ?? 'N/A'}`)
      }
    }
    catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
    }
  })

cli
  .command('analyze', 'Analyze training readiness from recent health data')
  .option('--driver <driver>', 'Health platform driver')
  .option('--token <token>', 'API access token')
  .option('--days <days>', 'Number of days to analyze', { default: 14 })
  .option('--verbose', 'Enable verbose logging')
  .action(async (options?: AnalyzeOptions & { days?: number }) => {
    const token = options?.token || ''

    if (!token) {
      console.error('Missing --token option')
      return
    }

    const { createOuraDriver } = await import('../src/drivers/oura')
    const { createReadinessAnalyzer } = await import('../src/analysis/readiness')

    const driver = createOuraDriver(token)
    const analyzer = createReadinessAnalyzer()

    const days = (options as { days?: number })?.days ?? 14
    const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
    const endDate = new Date().toISOString().slice(0, 10)
    const dateRange = { startDate, endDate }

    try {
      const [sleep, readiness, hrv, activity] = await Promise.all([
        driver.getSleep(dateRange),
        driver.getReadiness(dateRange),
        driver.getHRV(dateRange),
        driver.getDailyActivity(dateRange),
      ])

      const result = analyzer.calculateTrainingReadiness({
        sleep,
        readiness,
        hrv,
        activity,
      })

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
    }
    catch (err) {
      console.error('Analysis failed:', err instanceof Error ? err.message : err)
    }
  })

cli.command('version', 'Show the version of the CLI').action(() => {
  console.log(version)
})

cli.version(version)
cli.help()
cli.parse()
