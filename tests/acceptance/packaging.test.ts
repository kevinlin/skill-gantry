import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, realpath } from 'node:fs/promises'
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

  // R3.13: `files` is an allowlist, so a directory it does not name is silently
  // absent from the tarball and the first sign is `skill install` failing on a
  // user's machine.
  it('carries the bundled agent skill, and the installed bin finds it', async () => {
    const staging = await mkdtemp(join(tmpdir(), 'sg-pack-skill-'))

    await withDistributionLock(async () => {
      await run('pnpm', ['build'], { cwd: process.cwd() })
      await run('pnpm', ['pack', '--pack-destination', staging], { cwd: process.cwd() })
    })

    const tarball = (await readdir(staging)).find((f) => f.endsWith('.tgz'))
    expect(tarball).toBeDefined()

    const prefix = await mkdtemp(join(tmpdir(), 'sg-prefix-skill-'))
    await run('npm', ['install', '--prefix', prefix, join(staging, tarball as string)])

    const packageRoot = join(prefix, 'node_modules', 'skillgantry')
    const skill = join(packageRoot, 'skills', 'skillgantry', 'SKILL.md')
    const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      version: string
    }
    expect(await readFile(skill, 'utf8')).toContain(`version: ${pkg.version}`)

    // From the installed prefix, where `import.meta.url` sits in `dist/`.
    const { stdout } = await run(join(prefix, 'node_modules/.bin/skillgantry'), ['skill', 'path'])
    expect(stdout.trim()).toBe(await realpath(join(packageRoot, 'skills', 'skillgantry')))
  }, 180_000)
})
