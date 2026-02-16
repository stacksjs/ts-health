# CLI Reference

ts-health includes a comprehensive CLI tool with 22 commands for syncing, viewing, analyzing, and exporting health data from the command line.

## Installation

The CLI is available after installing the package:

```bash
bun install ts-health

# Or install globally
bun add --global ts-health
```

You can also download a standalone binary from the [releases page](https://github.com/stacksjs/ts-health/releases).

## Common Options

All data and analysis commands support these options:

| Option | Description |
|--------|-------------|
| `--driver <driver>` | Platform: `oura`, `whoop`, `fitbit`, `apple-health`, `withings`, `renpho` |
| `--token <token>` | API access token / personal access token |
| `--email <email>` | Email (for Renpho) |
| `--password <password>` | Password (for Renpho) |
| `--start <date>` | Start date (YYYY-MM-DD) |
| `--end <date>` | End date (YYYY-MM-DD) |
| `--days <days>` | Number of days to look back (default: 7) |
| `--format <format>` | Output format: `pretty` (default), `json` |
| `--output <file>` | Save output to file |
| `--verbose` | Enable verbose logging |

## Data Commands

### `health sync`

Sync all health data from a platform and save to disk:

```bash
health sync --driver oura --token YOUR_TOKEN --days 30 --output ./data
health sync --driver withings --token YOUR_TOKEN --days 60
health sync --driver renpho --email user@example.com --password pass123
```

Syncs sleep, activity, readiness, HRV, heart rate, SpO2, stress, body temperature, VO2 max, body composition, weight, and workouts. Outputs a summary and saves a JSON file.

**Output:**

```
Sync Summary (Oura Ring):
  Sleep records:          14
  Activity records:       14
  Readiness records:      14
  HRV samples:            847
  Heart rate samples:     12480
  SpO2 records:           14
  Stress records:         14
  Body temp records:      12
  VO2 max records:        2
  Body composition:       0
  Weight measurements:    0
  Workouts:               5

Data saved to ./data/health-data-oura-2025-01-14.json
```

### `health sleep`

View sleep sessions with detailed stage breakdowns:

```bash
health sleep --driver oura --token YOUR_TOKEN --days 7
health sleep 2025-01-15 --driver oura --token YOUR_TOKEN
health sleep --driver fitbit --token YOUR_TOKEN --start 2025-01-01 --end 2025-01-07
```

**Output:**

```
2025-01-01: 7h 32m sleep | efficiency: 92% | deep: 98m | REM: 112m | light: 230m | awake: 22m | HR: 58 bpm | HRV: 45
2025-01-02: 6h 45m sleep | efficiency: 88% | deep: 82m | REM: 95m | light: 190m | awake: 38m | HR: 61 bpm | HRV: 38
```

### `health activity`

View daily activity data — steps, calories, distance, active time:

```bash
health activity --driver oura --token YOUR_TOKEN --days 7
```

**Output:**

```
2025-01-01: score 82 | 8,432 steps | 312 active cal | 2,150 total cal | 6.2 km | high: 25m | med: 45m | low: 90m
```

### `health workouts`

View workout history:

```bash
health workouts --driver oura --token YOUR_TOKEN --days 30
```

**Output:**

```
2025-01-05: running | 45m | 520 cal | 8.2 km | intensity: moderate | avg HR: 155 bpm
2025-01-07: cycling | 90m | 780 cal | 35.1 km | intensity: hard | avg HR: 162 bpm
```

### `health hr`

View heart rate data with daily summary statistics:

```bash
health hr --driver oura --token YOUR_TOKEN --days 1
health hr --driver oura --token YOUR_TOKEN --days 7
```

**Output:**

```
Heart Rate Summary (12,480 samples):
  Average:  72 bpm
  Min:      48 bpm
  Max:      165 bpm

Daily breakdown:
  2025-01-01: avg 68 bpm | min 48 | max 145 | 1,820 samples
  2025-01-02: avg 72 bpm | min 50 | max 165 | 1,790 samples
```

### `health hrv`

View heart rate variability data:

```bash
health hrv --driver oura --token YOUR_TOKEN --days 14
```

**Output:**

```
HRV Summary (847 samples):
  Average:  42 ms
  Min:      18 ms
  Max:      85 ms

Daily breakdown:
  2025-01-01: avg 45 ms | max 82 ms | 62 samples
  2025-01-02: avg 38 ms | max 71 ms | 58 samples
```

### `health spo2`

View blood oxygen saturation data:

```bash
health spo2 --driver oura --token YOUR_TOKEN --days 7
```

**Output:**

```
2025-01-01: avg 97.5% | min: 95% | max: 99%
2025-01-02: avg 97.8% | min: 96% | max: 99%
```

### `health stress`

View daily stress levels:

```bash
health stress --driver oura --token YOUR_TOKEN --days 7
```

**Output:**

```
2025-01-01: stress: 42 | recovery: 58 | restored
2025-01-02: stress: 65 | recovery: 35 | strained
```

### `health body-temp`

View body temperature deviations from baseline:

```bash
health body-temp --driver oura --token YOUR_TOKEN --days 14
```

**Output:**

```
2025-01-01: deviation -0.15°C | trend: -0.08°C
2025-01-02: deviation +0.22°C | trend: +0.10°C
```

### `health vo2max`

View VO2 max estimates with trend:

```bash
health vo2max --driver oura --token YOUR_TOKEN --days 30
```

**Output:**

```
2025-01-01: 42.5 ml/kg/min
2025-01-15: 43.1 ml/kg/min

Trend: +0.6 ml/kg/min over 2 reading(s)
```

### `health weight`

View weight measurements from smart scales:

```bash
health weight --driver withings --token YOUR_TOKEN --days 30
health weight --driver renpho --email user@example.com --password pass123
health weight --driver fitbit --token YOUR_TOKEN --days 30
```

**Output:**

```
2025-01-01: 78.5 kg (173.1 lbs) | BMI: 24.2
2025-01-03: 78.2 kg (172.4 lbs) | BMI: 24.1
2025-01-07: 77.8 kg (171.5 lbs) | BMI: 24.0

Change: -0.7 kg over 3 measurement(s)
```

### `health body`

View full body composition data from smart scales:

```bash
health body --driver withings --token YOUR_TOKEN --days 30
health body --driver renpho --email user@example.com --password pass123 --format json
```

**Output:**

```
2025-01-01: 78.5 kg | fat: 18.2% | muscle: 35.1 kg | bone: 3.2 kg | water: 55.8% | BMI: 24.2 | visceral fat: 8 | BMR: 1,720 kcal
2025-01-07: 77.8 kg | fat: 17.8% | muscle: 35.3 kg | bone: 3.2 kg | water: 56.1% | BMI: 24.0 | visceral fat: 7 | BMR: 1,710 kcal

Changes over 2 measurement(s):
  Weight: -0.7 kg
  Body fat: -0.4%
  Muscle mass: +0.2 kg
```

### `health readiness`

View daily readiness scores:

```bash
health readiness --driver oura --token YOUR_TOKEN --days 7
```

**Output:**

```
2025-01-01: score 85 | temp: -0.2°C | HRV balance: 82 | sleep balance: 78 | resting HR: 88
```

### `health profile`

View personal profile information:

```bash
health profile --driver oura --token YOUR_TOKEN
health profile --driver withings --token YOUR_TOKEN
```

**Output:**

```
Profile (Oura Ring):
  ID:     abc123
  Email:  user@example.com
  Age:    32
  Weight: 78.5 kg
  Height: 1.80 m
  Sex:    male
```

## Analysis Commands

### `health analyze`

Full training readiness analysis combining sleep, HRV, readiness, heart rate, and activity data:

```bash
health analyze --driver oura --token YOUR_TOKEN --days 14
health analyze --driver whoop --token YOUR_TOKEN --days 30
```

**Output:**

```
Training Readiness: 78/100
Recommendation: MODERATE

Factors:
  HRV Status:        82/100
  Sleep Quality:     75/100
  Recovery Level:    80/100
  Resting HR:        72/100
  Activity Balance:  78/100
  Sleep Debt:        65/100

Moderate readiness. Steady-state or technique work recommended. Accumulated sleep debt detected.
```

### `health recovery`

Recovery score analysis based on sleep, HRV trends, resting HR, and strain balance:

```bash
health recovery --driver oura --token YOUR_TOKEN --days 14
```

**Output:**

```
Recovery Score: 72/100
Status: MOSTLY RECOVERED

Factors:
  Sleep Score:       78/100
  HRV Trend:         65/100
  Resting HR Trend:  75/100
  Strain Balance:    70/100
```

### `health sleep-quality`

Score sleep quality for individual sessions:

```bash
health sleep-quality --driver oura --token YOUR_TOKEN --days 7
health sleep-quality 2025-01-15 --driver oura --token YOUR_TOKEN
```

**Output:**

```
2025-01-01: 82/100 (good) | duration: 80 | efficiency: 100 | deep: 80 | REM: 80 | latency: 100
2025-01-02: 65/100 (fair) | duration: 60 | efficiency: 80 | deep: 60 | REM: 60 | latency: 80

Sleep consistency score: 75/100
Average quality: 74/100
```

### `health sleep-debt`

Analyze accumulated sleep debt:

```bash
health sleep-debt --driver oura --token YOUR_TOKEN --days 14
health sleep-debt --driver oura --token YOUR_TOKEN --days 14 --target 450
```

| Option | Description | Default |
|--------|-------------|---------|
| `--target <minutes>` | Target sleep per night in minutes | `480` (8h) |

**Output:**

```
Sleep Debt Analysis (last 14 days):
  Target:          8h 0m per night
  Weekly average:  7h 15m
  Current debt:    5h 15m
  Trend:           accumulating
  Days to recover: ~11 days (at +30m/night)
```

### `health trends`

Analyze trends across multiple health metrics with anomaly detection:

```bash
health trends --driver oura --token YOUR_TOKEN --days 30
health trends --driver withings --token YOUR_TOKEN --days 60 --metrics weight
health trends --driver oura --token YOUR_TOKEN --days 30 --metrics sleep,hrv,hr
```

| Option | Description | Default |
|--------|-------------|---------|
| `--metrics <list>` | Comma-separated: `weight`, `sleep`, `hrv`, `hr`, `steps`, `spo2` | All available |

**Output:**

```
Health Trends (last 30 days):
──────────────────────────────────────────────────────────────────────
  ↑ Sleep Duration (hours): 7.5 avg (+5.2%) — improving
  → Sleep Efficiency (%): 91 avg (+0.8%) — stable
  ↑ HRV (ms): 45 avg (+8.3%) — improving
  ↓ Resting Heart Rate (bpm): 52 avg (-3.1%) — improving
  → Steps: 8,432 avg (+1.2%) — stable
  ↓ Weight (kg): 77.8 avg (-1.5%) — declining

Anomalies detected:
  2025-01-12: Steps unusually high (18,432, 2.3 std dev)
  2025-01-18: HRV (ms) unusually low (22, -2.1 std dev)
```

### `health dashboard`

Quick overview of the most recent health metrics across all categories:

```bash
health dashboard --driver oura --token YOUR_TOKEN
```

**Output:**

```
╔══════════════════════════════════════════════════╗
║  Health Dashboard — Oura Ring
╚══════════════════════════════════════════════════╝

  Last Night's Sleep (2025-01-14):
    Duration:    7h 45m
    Efficiency:  93%
    Deep:        102m | REM: 115m
    HRV:         48 ms
    Avg HR:      56 bpm

  Readiness (2025-01-14):
    Score:       85/100

  Activity (2025-01-14):
    Steps:       9,234
    Calories:    420 active / 2,280 total

  HRV (7-day):
    Average:     44 ms

  SpO2 (2025-01-14):
    Average:     97.5%

  Stress (2025-01-14):
    Status:      restored
```

### `health compare`

Compare health metrics between two time periods:

```bash
# Compare last 7 days vs previous 7 days
health compare --driver oura --token YOUR_TOKEN --days 7

# Compare last 14 days vs previous 14 days
health compare --driver oura --token YOUR_TOKEN --days 14

# Compare specific date ranges
health compare --driver oura --token YOUR_TOKEN \
  --period1-start 2025-01-01 --period1-end 2025-01-14 \
  --period2-start 2025-01-15 --period2-end 2025-01-28
```

**Output:**

```
Comparison: Period 1 (2025-01-01 to 2025-01-07) vs Period 2 (2025-01-08 to 2025-01-14)
──────────────────────────────────────────────────────────────────────
  Sleep Duration          7.2h  →       7.6h  ↑ +0.4h
  Sleep Efficiency         89%  →        93%  ↑ +4%
  Daily Steps            7,850  →      9,120  ↑ +1270
  Active Calories          380  →        420  ↑ +40cal
  HRV                      38  →        45  ↑ +7ms
  Weight                  78.5  →      77.8  ↓ -0.7kg
```

## Export & Utility Commands

### `health export`

Export all health data from a platform to a single JSON file:

```bash
health export --driver oura --token YOUR_TOKEN --days 90 --output ./my-health-data.json
health export --driver withings --token YOUR_TOKEN --days 365 --output ./weight-history.json
```

Exports all available data types including personal info, sleep, activity, workouts, readiness, heart rate, HRV, SpO2, stress, body temperature, VO2 max, body composition, and weight measurements.

**Output:**

```
Exporting 90 days of data from Oura Ring...
Exported 15,432 records to ./my-health-data.json
  sleep: 88
  dailySleep: 88
  activity: 88
  workouts: 15
  readiness: 88
  heartRate: 12480
  hrv: 847
  spo2: 88
  stress: 88
```

### `health version`

Show the CLI version:

```bash
health version
```

### `health --help`

Show all available commands and options:

```bash
health --help
health sleep --help
health body --help
```

## Environment Variables

Instead of passing `--token` every time, you can set environment variables:

```bash
export OURA_ACCESS_TOKEN=your-oura-pat
export WHOOP_ACCESS_TOKEN=your-whoop-token
export FITBIT_ACCESS_TOKEN=your-fitbit-token
export WITHINGS_ACCESS_TOKEN=your-withings-token
export RENPHO_EMAIL=your-renpho-email
export RENPHO_PASSWORD=your-renpho-password
```

## Examples

```bash
# Quick morning check
health dashboard --driver oura --token $OURA_ACCESS_TOKEN

# Weekly sleep report
health sleep --driver oura --token $OURA_ACCESS_TOKEN --days 7

# Full analysis before a big training day
health analyze --driver oura --token $OURA_ACCESS_TOKEN --days 14

# Track weight loss progress
health weight --driver withings --token $WITHINGS_ACCESS_TOKEN --days 90
health body --driver withings --token $WITHINGS_ACCESS_TOKEN --days 90
health trends --driver withings --token $WITHINGS_ACCESS_TOKEN --days 90 --metrics weight

# Compare this week vs last week
health compare --driver oura --token $OURA_ACCESS_TOKEN --days 7

# Export everything for offline analysis
health export --driver oura --token $OURA_ACCESS_TOKEN --days 365 --output ./oura-annual.json

# JSON output for scripting
health sleep --driver oura --token $OURA_ACCESS_TOKEN --format json | jq '.[] | .efficiency'

# Sync and archive data
health sync --driver oura --token $OURA_ACCESS_TOKEN --days 30 --output ./health-archive
```
