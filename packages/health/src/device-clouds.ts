/**
 * The watch makers' clouds on their own: Polar, Suunto, COROS and Wahoo
 * drivers, their OAuth dialects and their webhooks, without the rest of
 * ts-health (no FIT parser, no USB drivers). `ts-health/device-clouds`.
 */
export * from './drivers/device-cloud'
export * from './drivers/device-webhooks'
export { createPolarAccessLinkDriver, createPolarWebhook, getPolarWebhooks, isoDurationSeconds, PolarAccessLinkDriver } from './drivers/polar'
export type { PolarClientCredentials, PolarDriverOptions, PolarWebhook } from './drivers/polar'
export { createSuuntoCloudDriver, SuuntoCloudDriver } from './drivers/suunto'
export type { SuuntoDriverOptions } from './drivers/suunto'
export { CorosCloudDriver, createCorosCloudDriver } from './drivers/coros'
export type { CorosDriverOptions } from './drivers/coros'
export { createWahooCloudDriver, WahooCloudDriver } from './drivers/wahoo'
export type { WahooDriverOptions } from './drivers/wahoo'
export * from './oauth'
