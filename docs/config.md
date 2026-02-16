# Configuration

ts-health can be configured using a `health.config.ts` _(or `health.config.js`)_ file and it will be automatically loaded when using the library or CLI.

```typescript
// health.config.ts
import type { HealthConfig } from 'ts-health'

const config: HealthConfig = {
  /**
   * Enable verbose logging.
   * Default: false
   */
  verbose: true,

  /**
   * Output directory for synced health data.
   * Default: './health-data'
   */
  outputDir: './health-data',

  /**
   * Which health platform drivers to use.
   * Default: ['oura']
   */
  drivers: ['oura'],

  /**
   * Oura Ring configuration.
   * Requires a Personal Access Token from https://cloud.ouraring.com/personal-access-tokens
   */
  oura: {
    personalAccessToken: 'your-oura-pat',
  },

  /**
   * WHOOP configuration.
   * Requires OAuth credentials from https://developer.whoop.com/
   */
  // whoop: {
  //   clientId: 'your-client-id',
  //   clientSecret: 'your-client-secret',
  //   accessToken: 'your-access-token',
  // },

  /**
   * Apple Health configuration.
   * Requires an exported XML file from the Health app.
   */
  // appleHealth: {
  //   exportPath: '/path/to/export.xml',
  // },

  /**
   * Fitbit configuration.
   * Requires OAuth credentials from https://dev.fitbit.com/
   */
  // fitbit: {
  //   clientId: 'your-client-id',
  //   clientSecret: 'your-client-secret',
  //   accessToken: 'your-access-token',
  // },

  /**
   * Withings smart scale configuration.
   * Requires OAuth credentials from https://developer.withings.com/
   */
  // withings: {
  //   clientId: 'your-client-id',
  //   clientSecret: 'your-client-secret',
  //   accessToken: 'your-access-token',
  // },

  /**
   * Renpho smart scale configuration.
   * Uses email/password authentication with your Renpho account.
   */
  // renpho: {
  //   email: 'your-email@example.com',
  //   password: 'your-password',
  // },
}

export default config
```

## Configuration Options

### `verbose`

- **Type:** `boolean`
- **Default:** `false`

Enable verbose logging for debugging.

### `outputDir`

- **Type:** `string`
- **Default:** `'./health-data'`

Directory where synced health data will be stored.

### `drivers`

- **Type:** `HealthPlatformType[]`
- **Default:** `['oura']`
- **Options:** `'oura'`, `'whoop'`, `'apple_health'`, `'fitbit'`, `'garmin'`, `'withings'`, `'renpho'`

Which health platform drivers to enable.

### `oura`

Oura Ring API v2 configuration.

| Option | Type | Description |
|--------|------|-------------|
| `personalAccessToken` | `string` | Personal Access Token from Oura Developer Portal |
| `baseUrl` | `string?` | Custom API base URL (for testing) |

### `whoop`

WHOOP API configuration.

| Option | Type | Description |
|--------|------|-------------|
| `clientId` | `string` | OAuth client ID |
| `clientSecret` | `string` | OAuth client secret |
| `accessToken` | `string?` | Pre-obtained access token |
| `refreshToken` | `string?` | Refresh token for token renewal |
| `baseUrl` | `string?` | Custom API base URL |

### `appleHealth`

Apple Health export configuration.

| Option | Type | Description |
|--------|------|-------------|
| `exportPath` | `string` | Path to the exported `export.xml` file |

### `fitbit`

Fitbit Web API configuration.

| Option | Type | Description |
|--------|------|-------------|
| `clientId` | `string` | OAuth client ID |
| `clientSecret` | `string` | OAuth client secret |
| `accessToken` | `string?` | Pre-obtained access token |
| `refreshToken` | `string?` | Refresh token for token renewal |
| `baseUrl` | `string?` | Custom API base URL |

### `withings`

Withings smart scale API configuration.

| Option | Type | Description |
|--------|------|-------------|
| `clientId` | `string` | OAuth client ID |
| `clientSecret` | `string` | OAuth client secret |
| `accessToken` | `string?` | Pre-obtained access token |
| `refreshToken` | `string?` | Refresh token for token renewal |
| `baseUrl` | `string?` | Custom API base URL |

### `renpho`

Renpho smart scale configuration.

| Option | Type | Description |
|--------|------|-------------|
| `email` | `string` | Renpho account email |
| `password` | `string` | Renpho account password |
| `accessToken` | `string?` | Pre-obtained session key |
| `baseUrl` | `string?` | Custom API base URL |

## Environment Variables

You can also set tokens via environment variables to avoid hardcoding secrets:

```bash
export OURA_ACCESS_TOKEN=your-oura-pat
export WHOOP_ACCESS_TOKEN=your-whoop-token
export FITBIT_ACCESS_TOKEN=your-fitbit-token
export WITHINGS_ACCESS_TOKEN=your-withings-token
export RENPHO_EMAIL=your-renpho-email
export RENPHO_PASSWORD=your-renpho-password
```

Then reference them in your config:

```typescript
const config: HealthConfig = {
  verbose: false,
  outputDir: './health-data',
  drivers: ['oura'],
  oura: {
    personalAccessToken: process.env.OURA_ACCESS_TOKEN ?? '',
  },
}
```
