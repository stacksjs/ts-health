# Real-time sensors

The protocol helpers come from `ts-watches`, which `ts-health` reexports from its main entrypoint. Import the browser-safe `ts-watches` entrypoint directly when receiving Bluetooth heart-rate broadcasts in a browser or a native shell:

```typescript
import { BLE_SERVICES, BLE_CHARACTERISTICS, parseHeartRateMeasurement } from 'ts-watches/bluetooth'

// The host supplies a DataView from Heart Rate Measurement notifications.
function onMeasurement(value: DataView) {
  try {
    const reading = parseHeartRateMeasurement(value)
    if (reading.heartRate > 0 && reading.contactDetected !== false)
      console.log(`${reading.heartRate} bpm`, reading.rrIntervals)
  }
  catch (error) {
    // An incomplete notification is not a live reading. Wait for the next one.
  }
}

console.log(BLE_SERVICES.HEART_RATE, BLE_CHARACTERISTICS.HEART_RATE_MEASUREMENT)
```

Garmin watches with Bluetooth heart-rate broadcasting use the standard Heart Rate Service, just like a chest strap. Enable **Broadcast Heart Rate** on the watch before pairing. A watch that broadcasts only over ANT+ needs an ANT+ receiver; a Bluetooth connection to Garmin Connect does not prove that the watch can broadcast its heart rate over Bluetooth. See [Garmin broadcast compatibility](https://support.garmin.com/en-US/?faq=Zj1947s6pqAHzBCAhLhrC9).

The decoder handles 8-bit and 16-bit BPM, optional skin contact, energy expended, and RR intervals converted from 1/1024 seconds to milliseconds. It rejects incomplete fields with a `RangeError`. Zero BPM and failed skin contact should be treated as unavailable by the application. Clear old readings when notifications stop.

## Host transport

This entrypoint has no Node filesystem or device-driver imports. It decodes notifications; it does not grant Bluetooth permissions or connect a radio. Use the host's native Bluetooth service in an iPhone or Android app. In a browser that supports Web Bluetooth, request the standard heart-rate service from a user gesture, connect its measurement characteristic, and subscribe to notifications. Browser support and background behavior differ from native apps.

`createBleScanner()` and `createAntPlusScanner()` currently return mock scanners. They are test fixtures, not production hardware transports. The library does not export `createBLEClient` or `createANTClient`.
