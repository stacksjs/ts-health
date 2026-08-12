/* eslint-disable ts/no-top-level-await */
import { dts } from 'bun-plugin-dtsx'

const entrypoints = [
  'src/index.ts',
  'src/drivers/index.ts',
  'src/analysis/index.ts',
  'bin/cli.ts',
]

const result = await Bun.build({
  entrypoints,
  outdir: './dist',
  target: 'node',
  format: 'esm',
  splitting: true,
  minify: true,
  plugins: [dts({
    root: '.',
    outdir: './dist',
    tsconfigPath: '../../tsconfig.json',
    entrypoints,
    keepComments: true,
  })],
})

if (!result.success)
  throw new Error(`ts-health build failed: ${result.logs.map(log => log.message).join('; ')}`)

// Ensure the CLI bin file has a shebang for executability
const cliPath = './dist/bin/cli.js'
const cliFile = Bun.file(cliPath)
const cliContent = await cliFile.text()
if (!cliContent.startsWith('#!')) {
  await Bun.write(cliPath, `#!/usr/bin/env node
${cliContent}`)
}

await Bun.$`bun scripts/verify-package.ts`
