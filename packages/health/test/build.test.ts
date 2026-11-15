import { expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

test('a release rebuild excludes obsolete output from earlier source versions', async () => {
  const root = resolve(import.meta.dir, '..')
  const stale = resolve(root, 'dist/obsolete-release-fixture.js')
  await mkdir(resolve(root, 'dist'), { recursive: true })
  await writeFile(stale, 'throw new Error("obsolete release output")\n')
  try {
    const child = Bun.spawn([process.execPath, 'run', 'build'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    if (code !== 0) throw new Error(`Release build failed: ${stdout}\n${stderr}`)
    expect(await Bun.file(stale).exists()).toBe(false)
    expect(await Bun.file(resolve(root, 'dist/src/device-clouds.js')).exists()).toBe(true)
  }
  finally { await rm(stale, { force: true }) }
}, 30_000)
