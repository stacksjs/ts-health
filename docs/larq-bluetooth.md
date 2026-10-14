# PureVis 2 Bluetooth intake

`ts-health/larq` is a dependency-free entry point for phone runtimes. It reads a
PureVis 2 cap directly through Nordic UART. Apple Health and LARQ's servers are
not involved. Provide a platform GATT transport; the library never scans or
requests operating-system permissions itself.

```ts
import { LarqBleClient, LARQ_BLE, larqIntake } from 'ts-health/larq'

// Subscribe to LARQ_BLE.notify before writing LARQ_BLE.write.
// Each exchange returns the complete notification whose first five bytes
// match the request (fixed32 request id). Android needs an MTU >= 185.
const cap = new LarqBleClient({ exchange: request => channel.exchange(request) })
await cap.setClock()
const readings = await cap.readLogs(savedCursor, async page => {
  await archive.persist(page) // Persist before advancing the cursor.
})
const samples = larqIntake(readings, { capacityMl: 680 }, deviceSerial, 'Europe/Berlin')
```

Retain and recompute from the merged raw archive, including the last level
before a day's boundary. Deduplicate timestamps; never sum overlapping imports.
`larqDeviceId(advertisedName)` decodes the stable cap serial. Rescan by that
identity because Bluetooth addresses can change.

Choose the physical **680 or 1000 mL** bottle explicitly. Firmware can report
1000 mL for a 680 mL bottle. Default polynomial curves are estimates; optional
monotonic measuring-cup calibration points improve the mapping for a particular
bottle and filter. Water poured out cannot be distinguished from drinking.
Drops of at most 15 mL accumulate; refills do not count. Unreadable distances
(>=250 mm) and gaps over 12 hours reset the baseline conservatively. Invalid or
future cap dates must be excluded by the importing application. Retention varies
by firmware; sync regularly and do not promise complete historical coverage.

The client serialises requests and checks their echoed ids and success codes.
It exposes sensor reads and clock sync only. No UV control, factory reset,
firmware flashing, bonding or vendor credentials. A SUCCESS without a body is
the cap's normal end-of-history response. Unknown/truncated messages fail.

The public wire format and field definitions were researched from
[OpenBottle's protocol documentation](https://github.com/ijustbuildit/openbottle/blob/main/docs/protocol/ble-protocol.md)
and [the Android bottle project's protocol investigation](https://github.com/albi005/bottle).
This implementation and calibration code are independently written; their
source code and private calibration data are not included. Firmware and actual
bottle measurements still require hardware validation.
