#!/usr/bin/env bun
/* eslint-disable no-console */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface ConditionalExport {
  import?: string
  types?: string
}

interface PackageManifest {
  bin?: Record<string, string>
  exports: Record<string, ConditionalExport>
  files: string[]
  module?: string
  types?: string
}

const packageRoot = resolve(import.meta.dir, '..')
const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as PackageManifest
const missing: string[] = []

function requireTarget(label: string, target: string | undefined): void {
  if (!target || target.includes('*'))
    return
  if (!existsSync(resolve(packageRoot, target)))
    missing.push(`${label}: ${target}`)
}

requireTarget('module', manifest.module)
requireTarget('types', manifest.types)
for (const [name, path] of Object.entries(manifest.bin ?? {}))
  requireTarget(`bin ${name}`, path)
for (const [specifier, target] of Object.entries(manifest.exports)) {
  requireTarget(`${specifier} import`, target.import)
  requireTarget(`${specifier} types`, target.types)
}
if (!manifest.files.includes('dist'))
  missing.push('files must include dist')

const declarationTargets = [
  manifest.types,
  './dist/src/drivers/index.d.ts',
].filter((target): target is string => Boolean(target))
const declarations = declarationTargets
  .filter(target => existsSync(resolve(packageRoot, target)))
  .map(target => readFileSync(resolve(packageRoot, target), 'utf8'))
  .join('\n')
for (const symbol of ['createAppleHealthDriver', 'createGarminDriver', 'createCorosDriver', 'FitParser']) {
  if (!new RegExp(`\\b${symbol}\\b`).test(declarations))
    missing.push(`declarations do not expose ${symbol}`)
}

if (missing.length) {
  for (const problem of missing)
    console.error(`[package] ${problem}`)
  process.exit(1)
}

console.log(`[package] verified ts-health exports, bin, and adapter declarations`)
