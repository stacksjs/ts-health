/* eslint-disable ts/no-top-level-await */
import { dts } from 'bun-plugin-dtsx'

await Bun.build({
  entrypoints: [
    'src/index.ts',
    'src/drivers/index.ts',
    'src/analysis/index.ts',
    'bin/cli.ts',
  ],
  outdir: './dist',
  target: 'node',
  format: 'esm',
  splitting: true,
  minify: true,
  plugins: [dts()],
})

// Ensure the CLI bin file has a shebang for executability
const cliPath = './dist/bin/cli.js'
const cliFile = Bun.file(cliPath)
const cliContent = await cliFile.text()
if (!cliContent.startsWith('#!')) {
  await Bun.write(cliPath, `#!/usr/bin/env node
${cliContent}`)
}
