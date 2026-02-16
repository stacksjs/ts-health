# CLI Reference

ts-health includes a CLI tool for syncing, viewing, and analyzing health data from the command line.

## Installation

The CLI is available after installing the package:

```bash
bun install ts-health

# Or install globally
bun add --global ts-health
```

You can also download a standalone binary from the [releases page](https://github.com/stacksjs/ts-health/releases).

## Commands

### `health sync`

Sync health data from a platform and optionally save to disk:

```bash
health sync --driver oura --token YOUR_TOKEN --start 2025-01-01 --output ./data
```

**Options:**

| Option | Description | Required |
|--------|-------------|----------|
| `--driver <driver>` | Platform: `oura`, `whoop`, `fitbit`, `apple-health` | Yes |
| `--token <token>` | API access token | Yes (except `apple-health`) |
| `--start <date>` | Start date (YYYY-MM-DD) | No |
| `--end <date>` | End date (YYYY-MM-DD) | No |
| `--output <dir>` | Directory to save JSON output | No |
| `--verbose` | Enable verbose logging | No |

**Output:**

```
Syncing from oura...
Sleep records: 14
Activity records: 14
Readiness records: 14
HRV samples: 847
Data saved to ./data/health-data-2025-01-14.json
```

When `--output` is specified, the data is saved as a JSON file with sleep, activity, readiness, and HRV data.

### `health sleep`

View sleep data for a date range:

```bash
# Last 7 days
health sleep --token YOUR_TOKEN

# Specific date
health sleep 2025-01-01 --token YOUR_TOKEN

# Date range
health sleep --token YOUR_TOKEN --start 2025-01-01 --end 2025-01-07
```

**Options:**

| Option | Description |
|--------|-------------|
| `[date]` | Single date (YYYY-MM-DD) |
| `--driver <driver>` | Platform (default: `oura`) |
| `--token <token>` | API access token |
| `--start <date>` | Start date |
| `--end <date>` | End date |
| `--verbose` | Verbose output |

**Output:**

```
2025-01-01: 7h 32m sleep | efficiency: 92% | deep: 98m | REM: 112m | HRV: 45
2025-01-02: 6h 45m sleep | efficiency: 88% | deep: 82m | REM: 95m | HRV: 38
2025-01-03: 8h 10m sleep | efficiency: 94% | deep: 105m | REM: 120m | HRV: 52
```

### `health readiness`

View training readiness scores:

```bash
# Last 7 days
health readiness --token YOUR_TOKEN

# Specific date
health readiness 2025-01-01 --token YOUR_TOKEN

# Date range
health readiness --token YOUR_TOKEN --start 2025-01-01 --end 2025-01-07
```

**Output:**

```
2025-01-01: score 85 | temp: -0.2°C | HRV balance: 82 | sleep balance: 78
2025-01-02: score 72 | temp: 0.1°C | HRV balance: 65 | sleep balance: 70
2025-01-03: score 91 | temp: -0.1°C | HRV balance: 88 | sleep balance: 85
```

### `health analyze`

Run a full training readiness analysis across the last N days:

```bash
health analyze --token YOUR_TOKEN --days 14
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--driver <driver>` | Platform | `oura` |
| `--token <token>` | API access token | - |
| `--days <days>` | Number of days to analyze | `14` |
| `--verbose` | Verbose output | `false` |

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

### `health version`

Show the CLI version:

```bash
health version
```

### `health --help`

Show all available commands and options:

```bash
health --help
```

## Environment Variables

Instead of passing `--token` every time, you can set environment variables:

```bash
export OURA_ACCESS_TOKEN=your-oura-pat
export WHOOP_ACCESS_TOKEN=your-whoop-token
export FITBIT_ACCESS_TOKEN=your-fitbit-token
```

## Examples

```bash
# Quick morning check - last 3 days of readiness
health readiness --token $OURA_ACCESS_TOKEN --start $(date -v-3d +%Y-%m-%d)

# Weekly sleep report
health sleep --token $OURA_ACCESS_TOKEN --start $(date -v-7d +%Y-%m-%d)

# Full analysis before a big training day
health analyze --token $OURA_ACCESS_TOKEN --days 14

# Sync and save data for offline analysis
health sync --driver oura --token $OURA_ACCESS_TOKEN --start 2025-01-01 --output ./health-archive
```
