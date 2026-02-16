# Real-time Sensors

ts-health supports connecting to ANT+ and Bluetooth Low Energy (BLE) sensors for real-time data streaming. Use this for live tracking, recording custom workouts, or building training applications with real-time feedback.

## ANT+ Sensors

Connect to ANT+ heart rate monitors, power meters, and speed/cadence sensors:

```typescript
import { createANTClient } from 'ts-health'

const ant = createANTClient()

// Scan for nearby ANT+ devices
const devices = await ant.scan()
for (const device of devices) {
  console.log(`${device.type}: ${device.deviceId}`)
}

// Connect to a heart rate monitor
ant.onHeartRate((data) => {
  console.log(`HR: ${data.heartRate}bpm`)
})

// Connect to a power meter
ant.onPower((data) => {
  console.log(`Power: ${data.instantaneousPower}W | Cadence: ${data.cadence}rpm`)
})

// Connect to speed/cadence sensor
ant.onSpeedCadence((data) => {
  console.log(`Speed: ${data.speed}km/h | Cadence: ${data.cadence}rpm`)
})
```

## BLE Sensors

Connect to Bluetooth Low Energy fitness sensors:

```typescript
import { createBLEClient } from 'ts-health'

const ble = createBLEClient()

// Scan for BLE devices
const devices = await ble.scan({ timeout: 10000 })
for (const device of devices) {
  console.log(`${device.name}: ${device.id}`)
}

// Connect to a specific device
const hrMonitor = await ble.connect(devices[0])

// Stream heart rate data
hrMonitor.onData((data) => {
  console.log(`HR: ${data.heartRate}bpm`)
})
```

## Supported Sensor Types

| Sensor Type | ANT+ | BLE | Data |
|------------|-------|-----|------|
| Heart Rate Monitor | Yes | Yes | Heart rate (bpm), RR intervals |
| Power Meter | Yes | Yes | Power (W), cadence (rpm), torque |
| Speed Sensor | Yes | Yes | Speed (m/s), wheel revolutions |
| Cadence Sensor | Yes | Yes | Cadence (rpm), crank revolutions |
| Speed/Cadence Combo | Yes | Yes | Both speed and cadence |
| Foot Pod | Yes | Yes | Speed, cadence, stride length |
| Cycling Trainer | Yes | Yes | Power, speed, resistance |

## Use Cases

### Live Training Dashboard

```typescript
import { createANTClient, ZoneCalculator } from 'ts-health'

const ant = createANTClient()
const zones = new ZoneCalculator({ maxHR: 185, restingHR: 50, ftp: 250 })

ant.onHeartRate((data) => {
  const zone = zones.getHRZone(data.heartRate)
  console.log(`HR: ${data.heartRate}bpm — Zone ${zone.number} (${zone.name})`)
})

ant.onPower((data) => {
  const zone = zones.getPowerZone(data.instantaneousPower)
  console.log(`Power: ${data.instantaneousPower}W — Zone ${zone.number} (${zone.name})`)
})
```

### Recording Custom Workouts

```typescript
import { createBLEClient, WorkoutBuilder, exportToTCX } from 'ts-health'

const ble = createBLEClient()
const builder = new WorkoutBuilder()

// Start recording
builder.start()

const hrMonitor = await ble.connect(hrDevice)
hrMonitor.onData((data) => {
  builder.addRecord({
    timestamp: new Date(),
    heartRate: data.heartRate,
  })
})

// After workout
builder.stop()
const activity = builder.build()
await exportToTCX(activity, '/path/to/custom-workout.tcx')
```
