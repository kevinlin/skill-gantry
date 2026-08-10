import { mkdir, mkdtemp, readFile, readlink, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GitSkillSpec } from '../../src/core/tools/catalogue.js'
import type { Exec } from '../../src/core/tools/exec.js'
import {
  detectSkillDirs,
  gitSkillInstall,
  gitSkillUninstall,
  verifyGitSkill,
} from '../../src/core/tools/git-skill.js'
import {
  skillhoneSettings,
  skillhoneSettingsPath,
  writeSkillhoneSettings,
} from '../../src/core/tools/skillhone-settings.js'

const SPEC: GitSkillSpec & { id: string } = {
  id: 'skillhone',
  kind: 'git-skill',
  repo: 'Tencent/SkillHone',
  pin: 'a'.repeat(40),
  skills: ['skillhone', 'skillhone-optimization'],
  requirements: 'skills/skillhone/assets/requirements.txt',
}

/** Records argv and stands in for git and uv; materialises what a clone would. */
const fakeExec = (repoDir: string, calls: string[][]): Exec => {
  return async (bin, argv) => {
    calls.push([bin, ...argv])
    if (bin === 'git' && argv[0] === 'clone') {
      for (const name of SPEC.skills) await mkdir(join(repoDir, 'skills', name), { recursive: true })
      await mkdir(join(repoDir, 'skills', 'skillhone', 'assets'), { recursive: true })
      await writeFile(
        join(repoDir, 'skills', 'skillhone', 'assets', 'requirements.txt'),
        'PyYAML\n',
      )
      for (const name of SPEC.skills) {
        await writeFile(join(repoDir, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`)
      }
    }
    if (bin === 'git' && argv.includes('rev-parse')) return { stdout: `${SPEC.pin}\n`, stderr: '' }
    return { stdout: '', stderr: '' }
  }
}

describe('detectSkillDirs', () => {
  it('reports per directory, so one holding the bundle does not skip the others', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    await mkdir(join(home, '.claude', 'skills', 'skillhone'), { recursive: true })
    await writeFile(join(home, '.claude', 'skills', 'skillhone', 'SKILL.md'), '---\n---\n')
    await mkdir(join(home, '.agents', 'skills'), { recursive: true })

    const found = await detectSkillDirs(home, SPEC)

    expect(found).toEqual([
      { dir: join(home, '.claude', 'skills'), holds: true },
      { dir: join(home, '.agents', 'skills'), holds: false },
    ])
  })
})

describe('gitSkillInstall', () => {
  it('clones at the pin, links each skill, and builds the venv under the tool root', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    await mkdir(join(home, '.agents', 'skills'), { recursive: true })
    const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))
    const calls: string[][] = []

    const out = await gitSkillInstall(dir, SPEC, fakeExec(join(dir, 'repo'), calls), home)

    expect(calls[0]).toEqual([
      'git',
      'clone',
      'https://github.com/Tencent/SkillHone.git',
      join(dir, 'repo'),
    ])
    expect(calls[1]).toEqual(['git', '-C', join(dir, 'repo'), 'checkout', SPEC.pin])
    // R3.1: uv builds the venv under the tool root, never the user's global
    // interpreter — upstream's own install does the latter.
    expect(calls).toContainEqual(['uv', 'venv', join(dir, '.venv')])
    expect(out.bin).toBe(join(dir, '.venv', 'bin', 'python'))
    expect(out.sha).toBe(SPEC.pin)

    const link = join(home, '.agents', 'skills', 'skillhone-optimization')
    expect(out.links).toContain(link)
    expect(await readlink(link)).toBe(join(dir, 'repo', 'skills', 'skillhone-optimization'))
  })

  it('refuses an existing entry that is not our symlink, rather than clobbering it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    await mkdir(join(home, '.agents', 'skills', 'skillhone-optimization'), { recursive: true })
    const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))

    await expect(gitSkillInstall(dir, SPEC, fakeExec(join(dir, 'repo'), []), home)).rejects.toThrow(
      /skillhone-optimization already exists/,
    )
  })
})

describe('verifyGitSkill', () => {
  it('fails when a recorded link has gone dangling', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))
    await mkdir(join(home, 'skills'), { recursive: true })
    const link = join(home, 'skills', 'skillhone')
    await symlink(join(dir, 'repo', 'skills', 'skillhone'), link)

    const exec: Exec = async () => ({ stdout: `${SPEC.pin}\n`, stderr: '' })

    await expect(verifyGitSkill(dir, [link], SPEC.pin, exec)).rejects.toThrow(/does not resolve/)
  })

  it('fails when HEAD has moved off the pin', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))
    const exec: Exec = async () => ({ stdout: `${'b'.repeat(40)}\n`, stderr: '' })

    await expect(verifyGitSkill(dir, [], SPEC.pin, exec)).rejects.toThrow(/HEAD is/)
  })
})

describe('gitSkillUninstall', () => {
  it('removes every recorded link, because a dangling one breaks every agent scanning that directory', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))
    await mkdir(join(home, 'skills'), { recursive: true })
    const link = join(home, 'skills', 'skillhone')
    await symlink(join(dir, 'repo', 'skills', 'skillhone'), link)

    await gitSkillUninstall(dir, [link])

    await expect(readlink(link)).rejects.toThrow()
  })

  it('removes the settings file it wrote — R3.10 applying R3.1 to a second out-of-root write', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))
    const written = await writeSkillhoneSettings(
      home,
      skillhoneSettings({
        ANTHROPIC_BASE_URL: 'https://gateway.test/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'sk-0123456789abcdef',
        ANTHROPIC_MODEL: 'a-model',
      })!,
    )
    if (written.kind !== 'written') throw new Error('expected a write')

    await gitSkillUninstall(dir, [], { path: written.path, sha256: written.sha256 })

    await expect(stat(written.path)).rejects.toThrow()
  })

  it('leaves a settings file edited since it was written', async () => {
    // The file holds the user's credential and may have been retuned against a
    // gateway this build knows nothing about, so the recheck guards the delete.
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))
    await mkdir(join(home, '.skillhone'), { recursive: true })
    const path = skillhoneSettingsPath(home)
    await writeFile(path, '{"hand":"edited"}\n')

    await gitSkillUninstall(dir, [], { path, sha256: 'a'.repeat(64) })

    expect(await readFile(path, 'utf8')).toBe('{"hand":"edited"}\n')
  })
})
