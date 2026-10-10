import { describe, expect, it } from 'bun:test'
import type { TrainingPeaksSessionClient } from '../src/drivers/trainingpeaks'
import { normalizeTrainingPeaksMetrics, TrainingPeaksHealthDriver } from '../src/drivers/trainingpeaks'

function session(workouts: any[] = []): TrainingPeaksSessionClient {
  return {
    getWorkouts: async () => workouts,
    getMetrics: async () => [{ Date: '2010-02-03', SleepHours: 7.5, RestingHeartRate: 51, HrvRmssd: 67, Weight: 68 }],
    getPerformanceChart: async () => ({ StartDate: '2010-02-03', Tss: [], Ctl: [], Atl: [], Tsb: [] }),
    getAthlete: async () => ({}),
  }
}

describe('TrainingPeaks driver', () => {
  it('leaves premium readiness absent without losing available daily metrics', async () => {
    const client = session()
    client.getPerformanceChart = async () => null
    const driver = new TrainingPeaksHealthDriver({ username: '', password: '', session: client })
    expect(await driver.getReadiness()).toEqual([])
    expect((await driver.getDailySleep())[0]?.contributors.totalSleep).toBe(7.5)
    client.getPerformanceChart = async () => { throw new Error('provider unavailable') }
    await expect(driver.getReadiness()).rejects.toThrow('provider unavailable')
  })

  it('reuses an explicit signed-in session for daily metrics', async () => {
    const driver = new TrainingPeaksHealthDriver({ username: '', password: '', session: session() })
    expect(driver.isAuthenticated()).toBe(true)
    expect(await driver.getHRV()).toEqual([{ timestamp: '2010-02-03T07:00:00', hrv: 67 }])
    expect((await driver.getDailySleep())[0]?.contributors.totalSleep).toBe(7.5)
    expect((await driver.getHeartRate())[0]?.bpm).toBe(51)
  })

  it('keeps metres, converts actual hours, and leaves planned sessions out', async () => {
    const base = { workoutDay: '2026-10-10', workoutTypeValueId: 3, title: 'Run' }
    const driver = new TrainingPeaksHealthDriver({ username: '', password: '', session: session([
      { ...base, workoutId: 1, completed: true, totalTime: 1.5, distance: 15000 },
      { ...base, workoutId: 2, completed: false, totalTimePlanned: 2 },
      { ...base, workoutId: 3, totalTimePlanned: 3 },
    ]) })
    const workouts = await driver.getWorkouts()
    expect(workouts).toHaveLength(1)
    expect(workouts[0]?.distance).toBe(15000)
    expect(Date.parse(workouts[0]!.endDatetime) - Date.parse(workouts[0]!.startDatetime)).toBe(90 * 60_000)
  })
})

 describe('web API daily metrics', () => {
  it('reads nested daily details, preserves zero and excludes charts and absent readings', async () => {
    const rows = [{ timeStamp: '2024-03-01T00:00:00', details: [
      { type: 60, value: 67 }, { type: 6, value: 7.5 }, { type: 5, value: 51 },
      { type: 9, value: 68 }, { type: 2, value: 18 }, { type: 8, value: 0 },
      { type: 58, value: 8000 }, { type: 10, value: 4 }, { type: 62, value: [1, 2] },
      { type: 3, value: null },
    ] }]
    const client = session()
    client.getMetrics = async () => rows
    const driver = new TrainingPeaksHealthDriver({ username: '', password: '', session: client })
    expect((await driver.getHRV())[0]?.hrv).toBe(67)
    expect((await driver.getDailySleep())[0]?.contributors.totalSleep).toBe(7.5)
    expect((await driver.getDailySleep())[0]?.score).toBe(80)
    expect((await driver.getHeartRate())[0]?.bpm).toBe(51)
    expect((await driver.getWeightMeasurements())[0]?.weight).toBe(68)
    expect((await driver.getWeightMeasurements())[0]?.bodyFatPercentage).toBe(18)
    expect((await driver.getDailyActivity())[0]?.steps).toBe(8000)
    expect((await driver.getStress())[0]?.stressHigh).toBe(0)
    expect(normalizeTrainingPeaksMetrics(rows)[0].Fatigue).toBeUndefined()
    expect(await driver.getDailyMetrics()).toEqual(rows)
  })
})
