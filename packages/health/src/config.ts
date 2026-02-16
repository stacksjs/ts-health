import type { HealthConfig } from './types'
import { loadConfig } from 'bunfig'

export const defaultConfig: HealthConfig = {
  verbose: false,
  outputDir: './health-data',
  drivers: ['oura'],
}

let _config: HealthConfig | null = null

export async function getConfig(): Promise<HealthConfig> {
  if (!_config) {
    _config = await loadConfig({
      name: 'health',
      defaultConfig,
    })
  }

  return _config
}

export const config: HealthConfig = defaultConfig
