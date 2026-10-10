import { describe, expect, it } from 'bun:test'
import type { TrainingPeaksSessionClient } from '../src/drivers/trainingpeaks'
import { TrainingPeaksHealthDriver } from '../src/drivers/trainingpeaks'

function session(workouts: any[] = []): TrainingPeaksSessionClient {
  return {
    getWorkouts: async () => workouts,
    getMetrics: async () => [{ Date: '2010-02-03', SleepHours: 7.5, RestingHeartRate: 51, HrvRmssd: 67, Weight: 68 }],
    getPerformanceChart: async () => ({ StartDate: '2010-02-03', Tss: [], Ctl: [], Atl: [], Tsb: [] }),
    getAthlete: async () => ({}),
  }
}

describe('TrainingPeaks driver', () => {
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
