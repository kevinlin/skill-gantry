import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GitSkillSpec } from '../../src/core/tools/catalogue.js'
import type { Exec } from '../../src/core/tools/exec.js'
import {
  detectSkillDirs,
  gitSkillInstall,
  gitSkillUninstall,
  linksInto,
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

/** skill-upper's shape: SKILL.md, templates and references, and no Python. */
const BARE_SPEC: GitSkillSpec & { id: string } = {
  id: 'skill-upper',
  kind: 'git-skill',
  repo: 'alibaba/skill-up',
  pin: 'v0.7.0',
  skills: ['skill-upper'],
}

/** Records argv and stands in for git and uv; materialises what a clone would. */
const fakeExec = (repoDir: string, calls: string[][], spec = SPEC): Exec => {
  return async (bin, argv) => {
    calls.push([bin, ...argv])
    if (bin === 'git' && argv[0] === 'clone') {
      for (const name of spec.skills) {
        await mkdir(join(repoDir, 'skills', name), { recursive: true })
        await writeFile(join(repoDir, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`)
      }
      if (spec.requirements !== undefined) {
        await mkdir(join(repoDir, 'skills', 'skillhone', 'assets'), { recursive: true })
        await writeFile(
          join(repoDir, 'skills', 'skillhone', 'assets', 'requirements.txt'),
          'PyYAML\n',
        )
      }
    }
    if (bin === 'git' && argv.includes('rev-parse')) return { stdout: `${spec.pin}\n`, stderr: '' }
    return { stdout: '', stderr: '' }
  }
}

/** A SKILL.md for each of `names` under `skillsDir`, as a runtime that holds the bundle has. */
async function holdSkills(skillsDir: string, names: readonly string[]): Promise<void> {
  for (const name of names) {
    await mkdir(join(skillsDir, name), { recursive: true })
    await writeFile(join(skillsDir, name, 'SKILL.md'), '---\n---\n')
  }
}

describe('detectSkillDirs', () => {
  it('reports per directory, so one holding the bundle does not skip the others', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    await holdSkills(join(home, '.claude', 'skills'), SPEC.skills)
    await mkdir(join(home, '.agents', 'skills'), { recursive: true })

    const found = await detectSkillDirs(home, SPEC)

    expect(found).toEqual([
      { dir: join(home, '.claude', 'skills'), holds: true },
      { dir: join(home, '.agents', 'skills'), holds: false },
    ])
  })

  it('holds only when every skill of the bundle is present, not the first alone', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    await holdSkills(join(home, '.claude', 'skills'), [SPEC.skills[0] as string])

    expect(await detectSkillDirs(home, SPEC)).toEqual([
      { dir: join(home, '.claude', 'skills'), holds: false },
    ])
  })
})

describe('linksInto', () => {
  const dir = '/tools/skillhone'
  const link = '/home/u/.claude/skills/skillhone'

  it.each([
    ['the directory itself', dir],
    ['a path under it', `${dir}/repo/skills/skillhone`],
    ['a path under it with a trailing slash', `${dir}/repo/`],
    ['a relative path that resolves under it', '../../../../tools/skillhone/repo'],
  ])('accepts %s', (_label, target) => {
    expect(linksInto(dir, link, target)).toBe(true)
  })

  it.each([
    // The case `startsWith(dir)` accepted, and a link recorded as ours is a link uninstall removes.
    ['a sibling sharing the directory name as a prefix', `${dir}-fork/repo`],
    ['the parent', '/tools'],
    ['a path that climbs out after descending in', `${dir}/repo/../../elsewhere`],
    ['a relative path that resolves beside it', '../../../../tools/skillhone-fork/repo'],
    ['a relative path read from the process directory rather than the link', 'tools/skillhone/repo'],
  ])('rejects %s', (_label, target) => {
    expect(linksInto(dir, link, target)).toBe(false)
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

  it('skips the venv entirely for a bundle with no requirements — R3.11', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    await mkdir(join(home, '.agents', 'skills'), { recursive: true })
    const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))
    const calls: string[][] = []

    const out = await gitSkillInstall(
      dir,
      BARE_SPEC,
      fakeExec(join(dir, 'repo'), calls, BARE_SPEC),
      home,
    )

    // Not one uv invocation reaches the injected Exec: building an empty venv
    // would install a runtime the tool never uses.
    expect(calls.filter((call) => call[0] === 'uv')).toEqual([])
    // The linked skill directory, which a verification can check and R6.13's
    // prompt can name — an interpreter that was never built can do neither.
    expect(out.bin).toBe(join(dir, 'repo', 'skills', 'skill-upper'))
    expect(out.links).toEqual([join(home, '.agents', 'skills', 'skill-upper')])
    expect(out.sha).toBe(BARE_SPEC.pin)
  })

  it('writes the same links on a reinstall after a pin bump, not only the ones it made this time', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    await mkdir(join(home, '.claude', 'skills'), { recursive: true })
    await mkdir(join(home, '.agents', 'skills'), { recursive: true })
    const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))
    const repoDir = join(dir, 'repo')

    const first = await gitSkillInstall(dir, SPEC, fakeExec(repoDir, []), home)
    const bumped = { ...SPEC, pin: 'b'.repeat(40) }
    const second = await gitSkillInstall(dir, bumped, fakeExec(repoDir, [], bumped), home)

    // Four, so that equal does not mean "both empty" — which is what the lock
    // recorded for the second install when the first skill read as present.
    expect(first.links).toHaveLength(4)
    expect(second.links).toEqual(first.links)
    expect(second.sha).toBe(bumped.pin)
  })

  it('links the skill a directory is missing when the first is already our own link', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    const skills = join(home, '.claude', 'skills')
    await mkdir(skills, { recursive: true })
    const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))
    for (const name of SPEC.skills) {
      await mkdir(join(dir, 'repo', 'skills', name), { recursive: true })
      await writeFile(join(dir, 'repo', 'skills', name, 'SKILL.md'), '---\n---\n')
    }
    await symlink(join(dir, 'repo', 'skills', 'skillhone'), join(skills, 'skillhone'))

    const out = await gitSkillInstall(dir, SPEC, fakeExec(join(dir, 'repo'), []), home)

    expect(out.links).toEqual([join(skills, 'skillhone'), join(skills, 'skillhone-optimization')])
    expect(await readlink(join(skills, 'skillhone-optimization'))).toBe(
      join(dir, 'repo', 'skills', 'skillhone-optimization'),
    )
  })

  describe('an entry that is not our link', () => {
    const foreign: [string, (link: string, dir: string, other: string) => Promise<void>][] = [
      [
        'a real directory',
        async (link) => {
          await mkdir(link, { recursive: true })
          await writeFile(join(link, 'SKILL.md'), 'the user\'s own\n')
        },
      ],
      [
        'a symlink elsewhere',
        async (link, _dir, other) => {
          await mkdir(other, { recursive: true })
          await symlink(other, link)
        },
      ],
      [
        // `<dir>-fork` shares `<dir>` as a string prefix, and recording it would
        // make uninstall remove a link into someone else's checkout.
        'a link into a sibling that shares the tool directory as a prefix',
        async (link, dir) => {
          await symlink(join(`${dir}-fork`, 'repo', 'skills', 'skillhone'), link)
        },
      ],
    ]

    it.each(foreign)(
      'skips %s and installs the rest, where it used to refuse the whole install',
      async (_label, make) => {
        const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
        const skills = join(home, '.agents', 'skills')
        await mkdir(skills, { recursive: true })
        const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))
        const other = await mkdtemp(join(tmpdir(), 'sg-elsewhere-'))
        const link = join(skills, 'skillhone')
        await make(link, dir, other)
        const before = {
          kind: (await lstat(link)).isSymbolicLink() ? 'link' : 'directory',
          target: await readlink(link).catch(() => null),
          entries: await readdir(link).catch(() => null),
        }

        const out = await gitSkillInstall(dir, SPEC, fakeExec(join(dir, 'repo'), []), home)

        expect(out.links).toEqual([join(skills, 'skillhone-optimization')])
        expect({
          kind: (await lstat(link)).isSymbolicLink() ? 'link' : 'directory',
          target: await readlink(link).catch(() => null),
          entries: await readdir(link).catch(() => null),
        }).toEqual(before)
      },
    )
  })

  it('re-points a dangling link of its own and records it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    const skills = join(home, '.claude', 'skills')
    await mkdir(skills, { recursive: true })
    const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))
    // Inside our directory and resolving to nothing: a clone since replaced.
    await symlink(join(dir, 'old-repo', 'skills', 'skillhone'), join(skills, 'skillhone'))

    const out = await gitSkillInstall(dir, SPEC, fakeExec(join(dir, 'repo'), []), home)

    expect(out.links).toContain(join(skills, 'skillhone'))
    expect(await readlink(join(skills, 'skillhone'))).toBe(join(dir, 'repo', 'skills', 'skillhone'))
  })

  it('re-points a relative link of its own and records it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    const skills = join(home, '.claude', 'skills')
    await mkdir(skills, { recursive: true })
    const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))
    // Resolved against the link's directory, not the process's: from the
    // process directory this lands nowhere near `dir`.
    const relativeTarget = relative(skills, join(dir, 'old-repo', 'skills', 'skillhone'))
    expect(relativeTarget.startsWith('..')).toBe(true)
    await symlink(relativeTarget, join(skills, 'skillhone'))

    const out = await gitSkillInstall(dir, SPEC, fakeExec(join(dir, 'repo'), []), home)

    expect(out.links).toContain(join(skills, 'skillhone'))
    expect(await readlink(join(skills, 'skillhone'))).toBe(join(dir, 'repo', 'skills', 'skillhone'))
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

  it('probes no interpreter for a bundle that declared no requirements — R3.11', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))
    await mkdir(join(dir, 'repo', 'skills', 'skill-upper'), { recursive: true })
    await mkdir(join(home, 'skills'), { recursive: true })
    const link = join(home, 'skills', 'skill-upper')
    await symlink(join(dir, 'repo', 'skills', 'skill-upper'), link)

    const calls: string[][] = []
    const exec: Exec = async (bin, argv) => {
      calls.push([bin, ...argv])
      return { stdout: `${BARE_SPEC.pin}\n`, stderr: '' }
    }

    expect(await verifyGitSkill(dir, [link], BARE_SPEC.pin, exec, false)).toBe(BARE_SPEC.pin)
    // Two facts, not three: probing a python that was never built would report
    // every such install `unverifiable`.
    expect(calls.map((call) => call[0])).toEqual(['git'])
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

  it('leaves no link behind for a bundle installed without a venv', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    await mkdir(join(home, '.agents', 'skills'), { recursive: true })
    const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))

    const out = await gitSkillInstall(
      dir,
      BARE_SPEC,
      fakeExec(join(dir, 'repo'), [], BARE_SPEC),
      home,
    )
    await gitSkillUninstall(dir, out.links)

    for (const link of out.links) await expect(readlink(link)).rejects.toThrow()
    await expect(stat(dir)).rejects.toThrow()
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
