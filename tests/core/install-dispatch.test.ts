import { describe, expect, it } from 'vitest'
import { mkdtemp, chmod, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadToolLock } from '../../src/core/config/config.js'
import type { Exec } from '../../src/core/tools/exec.js'
import { type InstallableTool, installTool, toolRoot } from '../../src/core/tools/install.js'

const home = (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-dispatch-'))

const NPM_TOOL: InstallableTool = {
  id: 'skill-lint',
  install: { kind: 'npm-prefix', spec: 'skill-lint', pin: '0.100.0', binName: 'skill-lint' },
  versionArgv: ['--version'],
}

/** Stands in for npm: writes the shim the driver is about to resolve. */
const fakeNpm =
  (dir: () => string): Exec =>
  async (bin, argv) => {
    if (bin !== 'npm') throw new Error(`unexpected ${bin}`)
    const prefix = argv[argv.indexOf('--prefix') + 1] as string
    await mkdir(join(prefix, 'node_modules', '.bin'), { recursive: true })
    const shim = join(prefix, 'node_modules', '.bin', 'skill-lint')
    await writeFile(shim, '#!/bin/sh\necho "skill-lint 0.100.0"\n')
    await chmod(shim, 0o755)
    void dir
    return { stdout: '', stderr: '' }
  }

describe('installTool', () => {
  it('installs an npm-prefix tool under the tool root and locks it', async () => {
    const h = await home()
    const entry = await installTool(h, NPM_TOOL, { exec: fakeNpm(() => h) })

    expect(entry.installKind).toBe('npm-prefix')
    expect(entry.bin.startsWith(join(toolRoot(h), 'skill-lint'))).toBe(true)
    expect(entry.resolvedVersion).toBe('0.100.0')
    expect(entry.integrity).toBe('n/a')
    expect(entry.verifiedAt).not.toBeNull()

    const lock = await loadToolLock(h)
    expect(lock.tools['skill-lint']?.bin).toBe(entry.bin)
  })

  it('writes no lock entry when verification fails', async () => {
    const h = await home()
    const brokenNpm: Exec = async (bin, argv) => {
      if (bin !== 'npm') throw new Error(`unexpected ${bin}`)
      const prefix = argv[argv.indexOf('--prefix') + 1] as string
      await mkdir(join(prefix, 'node_modules', '.bin'), { recursive: true })
      return { stdout: '', stderr: '' }
    }
    await expect(installTool(h, NPM_TOOL, { exec: brokenNpm })).rejects.toThrow(
      /could not be invoked/,
    )
    expect((await loadToolLock(h)).tools['skill-lint']).toBeUndefined()
  })

  it('locks a git-skill install by its sha and records its links', async () => {
    const h = await home()
    const userHome = await mkdtemp(join(tmpdir(), 'sg-userhome-'))
    await mkdir(join(userHome, '.agents', 'skills'), { recursive: true })
    const sha = 'c'.repeat(40)
    const exec: Exec = async (bin, argv) => {
      if (bin === 'git' && argv[0] === 'clone') {
        const repoDir = argv[2] as string
        await mkdir(join(repoDir, 'skills', 'skillhone'), { recursive: true })
        await writeFile(join(repoDir, 'skills', 'skillhone', 'SKILL.md'), '---\n---\n')
      }
      if (argv.includes('rev-parse')) return { stdout: `${sha}\n`, stderr: '' }
      return { stdout: '', stderr: '' }
    }

    const entry = await installTool(
      h,
      {
        id: 'skillhone',
        install: {
          kind: 'git-skill',
          repo: 'Tencent/SkillHone',
          pin: sha,
          skills: ['skillhone'],
          requirements: 'skills/skillhone/assets/requirements.txt',
        },
        versionArgv: [],
      },
      { exec, userHome },
    )

    expect(entry.installKind).toBe('git-skill')
    // The sha, not a semver: `verifyTool` is bypassed entirely for this kind.
    expect(entry.resolvedVersion).toBe(sha)
    expect(entry.bin).toBe(join(toolRoot(h), 'skillhone', '.venv', 'bin', 'python'))
    expect(entry.integrity).toBe('n/a')
    expect(entry.links).toEqual([join(userHome, '.agents', 'skills', 'skillhone')])
  })
})
