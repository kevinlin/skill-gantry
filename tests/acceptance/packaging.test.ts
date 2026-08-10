import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { withDistributionLock } from '../helpers/distribution-lock.js'

const run = promisify(execFile)

describe('M1 exit criterion 9: the packed artefact runs from a clean prefix', () => {
  it('builds, packs, installs and executes', async () => {
    const staging = await mkdtemp(join(tmpdir(), 'sg-pack-'))

    await withDistributionLock(async () => {
      await run('pnpm', ['build'], { cwd: process.cwd() })
      await run('pnpm', ['pack', '--pack-destination', staging], { cwd: process.cwd() })
    })

    const tarball = (await readdir(staging)).find((f) => f.endsWith('.tgz'))
    expect(tarball).toBeDefined()

    const prefix = await mkdtemp(join(tmpdir(), 'sg-prefix-'))
    await run('npm', ['install', '--prefix', prefix, join(staging, tarball as string)])

    const { stdout } = await run(join(prefix, 'node_modules/.bin/skillgantry'), ['--version'])
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
  }, 180_000)
})
