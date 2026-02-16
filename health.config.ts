import type { HealthConfig } from './packages/health/src/types'

const config: HealthConfig = {
  verbose: true,
  outputDir: './health-data',
  drivers: ['oura'],
  oura: {
    personalAccessToken: '',
  },
}

export default config
