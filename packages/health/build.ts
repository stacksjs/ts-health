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
