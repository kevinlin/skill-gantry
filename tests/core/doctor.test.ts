import { describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RULE_CLASS_MAP_VERSION } from '../../src/core/adapters/rule-classes.js'
import { saveToolLock } from '../../src/core/config/config.js'
import type { ToolLockEntry } from '../../src/core/config/schema.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { CATALOGUE, SKILLHONE_TOOL_ID, SKILL_UPPER_TOOL_ID } from '../../src/core/tools/catalogue.js'
import { doctor } from '../../src/core/tools/doctor.js'
import type { Exec } from '../../src/core/tools/exec.js'
import { toolRoot } from '../../src/core/tools/install.js'
import { runtimesFor } from '../../src/core/tools/runtimes.js'
import {
  skillhoneSettings,
  skillhoneSettingsPath,
  writeSkillhoneSettings,
} from '../../src/core/tools/skillhone-settings.js'
import { makeRepo, SKILL_MD } from '../helpers/tmp-repo.js'

const entry = (over: Partial<ToolLockEntry> = {}): ToolLockEntry => ({
  installKind: 'uv-tool',
  requestedPin: 'v1.0.0',
  resolvedVersion: '1.0.0',
  bin: '/nonexistent/bin',
  integrity: 'n/a',
  installedAt: '2026-08-01T00:00:00Z',
  verifiedAt: '2026-08-01T00:00:00Z',
  ...over,
})

async function fakeBin(dir: string, name: string, body: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const path = join(dir, name)
  await writeFile(path, `#!/bin/sh\n${body}\n`)
  await chmod(path, 0o755)
  return path
}

const home = (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-doctor-'))

/** A ledger already on the shipped map version: no rule-map finding expected. */
const CURRENT = { applied: RULE_CLASS_MAP_VERSION, current: RULE_CLASS_MAP_VERSION }

describe('doctor', () => {
  it('reports a lock entry whose binary is gone as missing', async () => {
    const h = await home()
    await saveToolLock(h, { version: 1, tools: { alpha: entry() } })
    const report = await doctor({ home: h, skills: [], ledgerLifecycle: new Map(), ruleMap: CURRENT })
    expect(report.tools.find((t) => t.toolId === 'alpha')?.kind).toBe('missing')
    expect(report.failed).toBe(true)
  })

  it('reports a binary that will not run as unverifiable', async () => {
    const h = await home()
    const bin = await fakeBin(join(toolRoot(h), 'beta', 'bin'), 'beta', 'exit 1')
    await saveToolLock(h, { version: 1, tools: { beta: entry({ bin }) } })
    const report = await doctor({ home: h, skills: [], ledgerLifecycle: new Map(), ruleMap: CURRENT })
    expect(report.tools.find((t) => t.toolId === 'beta')?.kind).toBe('unverifiable')
  })

  it('reports a different reported version as version-drift', async () => {
    const h = await home()
    const bin = await fakeBin(join(toolRoot(h), 'gamma', 'bin'), 'gamma', 'echo "gamma 2.0.0"')
    await saveToolLock(h, { version: 1, tools: { gamma: entry({ bin }) } })
    const report = await doctor({ home: h, skills: [], ledgerLifecycle: new Map(), ruleMap: CURRENT })
    const found = report.tools.find((t) => t.toolId === 'gamma')
    expect(found).toMatchObject({
      kind: 'version-drift',
      expectedVersion: '1.0.0',
      actualVersion: '2.0.0',
    })
  })

  it('reports a directory under the tool root with no lock entry as unlocked', async () => {
    const h = await home()
    await mkdir(join(toolRoot(h), 'delta'), { recursive: true })
    await saveToolLock(h, { version: 1, tools: {} })
    const report = await doctor({ home: h, skills: [], ledgerLifecycle: new Map(), ruleMap: CURRENT })
    expect(report.tools.find((t) => t.toolId === 'delta')?.kind).toBe('unlocked')
  })

  it("surfaces integrity 'none' as a warning that does not fail the report — R3.2b", async () => {
    const h = await home()
    const bin = await fakeBin(join(toolRoot(h), 'epsilon', 'bin'), 'epsilon', 'echo "1.0.0"')
    await saveToolLock(h, {
      version: 1,
      tools: { epsilon: entry({ bin, installKind: 'gh-release', integrity: 'none' }) },
    })
    const report = await doctor({ home: h, skills: [], ledgerLifecycle: new Map(), ruleMap: CURRENT })
    expect(report.tools.find((t) => t.toolId === 'epsilon')?.kind).toBe('integrity-unverified')
    expect(report.failed).toBe(false)
  })

  it('reports lifecycle drift between frontmatter and the ledger cache', async () => {
    const h = await home()
    await saveToolLock(h, { version: 1, tools: {} })
    const root = await makeRepo({
      files: {
        'declawed/SKILL.md': `---\nname: declawed\nmetadata:\n  version: 1.0.0\n  deprecated: true\n---\n`,
        'gap/SKILL.md': SKILL_MD('gap'),
      },
    })
    const skills = await discoverSkills({ id: 'r', path: root, name: 'r', isGit: false })
    const report = await doctor({
      home: h,
      skills,
      ledgerLifecycle: new Map([
        ['r/declawed', 'active'],
        ['r/gap', 'active'],
      ]),
      ruleMap: CURRENT,
    })
    expect(report.lifecycle).toEqual([{ skillId: 'r/declawed', file: 'deprecated', ledger: 'active' }])
    // A cache the file disagrees with is drift to report, not an error — R1.6.
    expect(report.failed).toBe(false)
  })

  it('names a skill whose frontmatter would not parse, without failing', async () => {
    const h = await home()
    await saveToolLock(h, { version: 1, tools: {} })
    const root = await makeRepo({
      files: {
        // Unquoted `: ` inside a plain scalar: yaml reads a nested mapping and
        // throws, so the skill has no name and no version and said so nowhere.
        'slides/SKILL.md': '---\ndescription: use for work: creating a deck\n---\n',
        'gap/SKILL.md': SKILL_MD('gap'),
      },
    })
    const report = await doctor({
      home: h,
      skills: await discoverSkills({ id: 'r', path: root, name: 'r', isGit: false }),
      ledgerLifecycle: new Map(),
      ruleMap: CURRENT,
    })
    expect(report.skills).toEqual([
      {
        skillId: 'r/slides',
        kind: 'frontmatter-unreadable',
        detail: 'name and version unavailable',
      },
    ])
    // R3.7's probe-and-report rule: nothing here stops a tool running, and a
    // report that fails on a machine that is fine is a report nobody reads.
    expect(report.failed).toBe(false)
  })

  it('probes exactly the runtimes the catalogue needs', async () => {
    const h = await home()
    await saveToolLock(h, { version: 1, tools: {} })
    const report = await doctor({
      home: h,
      skills: [],
      ledgerLifecycle: new Map(),
      ruleMap: CURRENT,
      exec: async (bin) => ({ stdout: `${bin} 1.0.0`, stderr: '' }),
    })
    const expected = runtimesFor(CATALOGUE).filter((runtime) => runtime !== 'none')
    expect(report.runtimes.map((r) => r.runtime).sort()).toEqual([...expected].sort())
    expect(report.runtimes.every((r) => r.present)).toBe(true)
  })

  it('reports a ledger whose rule map trails the shipped one, without failing', async () => {
    const h = await home()
    await saveToolLock(h, { version: 1, tools: {} })
    const report = await doctor({
      home: h,
      skills: [],
      ledgerLifecycle: new Map(),
      ruleMap: { applied: 1, current: RULE_CLASS_MAP_VERSION },
    })
    expect(report.tools.find((t) => t.kind === 'rule-map-pending')).toBeDefined()
    // Like integrity-unverified and lifecycle-drift: a standing condition to
    // surface, not a reason a tool cannot run.
    expect(report.failed).toBe(false)
  })

  it('reports nothing when the ledger is current', async () => {
    const h = await home()
    await saveToolLock(h, { version: 1, tools: {} })
    const report = await doctor({ home: h, skills: [], ledgerLifecycle: new Map(), ruleMap: CURRENT })
    expect(report.tools.some((t) => t.kind === 'rule-map-pending')).toBe(false)
  })
})

describe('doctor on a git-skill bundle', () => {
  const SHA = 'c'.repeat(40)

  /** A locked bundle whose clone, link and interpreter all resolve. */
  const seedGitSkillLock = async (h: string): Promise<string> => {
    const dir = join(toolRoot(h), SKILLHONE_TOOL_ID)
    await mkdir(join(dir, 'repo'), { recursive: true })
    const link = join(dir, 'repo', 'skills', 'skillhone')
    await mkdir(link, { recursive: true })
    const bin = await fakeBin(join(dir, '.venv', 'bin'), 'python', 'echo "Python 3.13.0"')
    await saveToolLock(h, {
      version: 1,
      tools: {
        [SKILLHONE_TOOL_ID]: entry({
          installKind: 'git-skill',
          requestedPin: SHA,
          resolvedVersion: SHA,
          bin,
          links: [link],
        }),
      },
    })
    return bin
  }

  it('names a missing claude CLI without offering to install it', async () => {
    const h = await home()
    await seedGitSkillLock(h)
    const exec: Exec = async (bin, argv) => {
      if (bin === 'command' || bin === 'which') throw new Error('not found')
      if (argv.includes('rev-parse')) return { stdout: `${SHA}\n`, stderr: '' }
      return { stdout: '', stderr: '' }
    }

    const report = await doctor({
      home: h,
      skills: [],
      ledgerLifecycle: new Map(),
      ruleMap: CURRENT,
      exec,
    })

    const finding = report.tools.find((row) => row.kind === 'claude-cli-missing')
    expect(finding?.detail).toContain('npm install -g @anthropic-ai/claude-code')
    // R3.7's rule, applied to a tool's own runtime dependency: reported, never
    // installed, and never a reason the report fails.
    expect(report.failed).toBe(false)
  })

  it('reports a HEAD moved off the pin as version drift, not as missing', async () => {
    const h = await home()
    await seedGitSkillLock(h)
    const exec: Exec = async (_bin, argv) =>
      argv.includes('rev-parse')
        ? { stdout: `${'d'.repeat(40)}\n`, stderr: '' }
        : { stdout: '', stderr: '' }

    const report = await doctor({
      home: h,
      skills: [],
      ledgerLifecycle: new Map(),
      ruleMap: CURRENT,
      exec,
    })

    expect(report.tools.find((row) => row.toolId === SKILLHONE_TOOL_ID)?.kind).toBe('version-drift')
  })
})

describe('doctor on a skill link it did not create (R3.11)', () => {
  const PIN = 'v0.7.0'

  /** A user home with one runtime skills directory and nothing else in it. */
  const userHomeWith = async (
    make: (skillsDir: string, toolDir: string) => Promise<void>,
    h: string,
  ): Promise<string> => {
    const userHome = await mkdtemp(join(tmpdir(), 'sg-user-'))
    const skillsDir = join(userHome, '.claude', 'skills')
    await mkdir(skillsDir, { recursive: true })
    await make(skillsDir, join(toolRoot(h), SKILL_UPPER_TOOL_ID))
    return userHome
  }

  const run = (h: string, userHome: string): ReturnType<typeof doctor> =>
    doctor({
      home: h,
      skills: [],
      ledgerLifecycle: new Map(),
      ruleMap: CURRENT,
      userHome,
      exec: async () => ({ stdout: '', stderr: '' }),
    })

  it('reports a foreign copy without failing the report, and writes nothing', async () => {
    const h = await home()
    await saveToolLock(h, { version: 1, tools: {} })
    const userHome = await userHomeWith(async (skillsDir) => {
      await mkdir(join(skillsDir, SKILL_UPPER_TOOL_ID), { recursive: true })
      await writeFile(join(skillsDir, SKILL_UPPER_TOOL_ID, 'SKILL.md'), '---\n---\n')
    }, h)

    const report = await run(h, userHome)

    const finding = report.tools.find((row) => row.kind === 'skill-link-unmanaged')
    expect(finding?.toolId).toBe(SKILL_UPPER_TOOL_ID)
    expect(finding?.detail).toContain('skillgantry setup')
    // A foreign copy works — the agent has the skill, it is simply not ours.
    expect(report.failed).toBe(false)
    // Read-only: the copy it named is byte-identical afterwards.
    expect(await readFile(join(userHome, '.claude', 'skills', SKILL_UPPER_TOOL_ID, 'SKILL.md'), 'utf8')).toBe(
      '---\n---\n',
    )
  })

  it('says nothing about a link of its own', async () => {
    const h = await home()
    await saveToolLock(h, { version: 1, tools: {} })
    const userHome = await userHomeWith(async (skillsDir, toolDir) => {
      const target = join(toolDir, 'repo', 'skills', SKILL_UPPER_TOOL_ID)
      await mkdir(target, { recursive: true })
      await symlink(target, join(skillsDir, SKILL_UPPER_TOOL_ID))
    }, h)

    const report = await run(h, userHome)

    expect(report.tools.some((row) => row.kind === 'skill-link-unmanaged')).toBe(false)
  })

  it('leaves a dangling link of its own to verifyGitSkill, which fails the report', async () => {
    const h = await home()
    const toolDir = join(toolRoot(h), SKILL_UPPER_TOOL_ID)
    const userHome = await userHomeWith(async (skillsDir) => {
      // The clone is gone; the link into it survives, which is the state R3.11
      // calls dangling and §5.2's three-fact verification calls `missing`.
      await symlink(join(toolDir, 'repo', 'skills', SKILL_UPPER_TOOL_ID), join(skillsDir, SKILL_UPPER_TOOL_ID))
    }, h)
    await saveToolLock(h, {
      version: 1,
      tools: {
        [SKILL_UPPER_TOOL_ID]: entry({
          installKind: 'git-skill',
          requestedPin: PIN,
          resolvedVersion: PIN,
          bin: join(toolDir, 'repo', 'skills', SKILL_UPPER_TOOL_ID),
          links: [join(userHome, '.claude', 'skills', SKILL_UPPER_TOOL_ID)],
        }),
      },
    })

    const report = await doctor({
      home: h,
      skills: [],
      ledgerLifecycle: new Map(),
      ruleMap: CURRENT,
      userHome,
      exec: async (_bin, argv) =>
        argv.includes('rev-parse') ? { stdout: `${PIN}\n`, stderr: '' } : { stdout: '', stderr: '' },
    })

    expect(report.tools.find((row) => row.toolId === SKILL_UPPER_TOOL_ID)?.kind).toBe('missing')
    // Ours and broken, unlike the foreign copy above: that one fails nothing.
    expect(report.failed).toBe(true)
  })
})

describe('doctor on the SkillHone settings file (R3.10)', () => {
  const SHA = 'c'.repeat(40)
  const TOKEN = 'sk-0123456789abcdef0123456789abcdef'
  const ENV_VARS: Record<string, string> = {
    ANTHROPIC_BASE_URL: 'https://gateway.test/anthropic',
    ANTHROPIC_AUTH_TOKEN: TOKEN,
    ANTHROPIC_MODEL: 'a-model',
  }
  const envText = (vars: Record<string, string>): string =>
    `${Object.entries(vars)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`

  /** Everything else resolves, so the settings file is the only thing at issue. */
  const healthy: Exec = async (bin, argv) => {
    if (bin === 'command') return { stdout: '/usr/bin/claude\n', stderr: '' }
    if (argv.includes('rev-parse')) return { stdout: `${SHA}\n`, stderr: '' }
    return { stdout: '', stderr: '' }
  }

  const seed = async (
    h: string,
    config?: { path: string; sha256: string; writtenAt: string },
  ): Promise<void> => {
    const dir = join(toolRoot(h), SKILLHONE_TOOL_ID)
    const link = join(dir, 'repo', 'skills', 'skillhone')
    await mkdir(link, { recursive: true })
    const bin = await fakeBin(join(dir, '.venv', 'bin'), 'python', 'echo "Python 3.13.0"')
    await writeFile(join(h, '.env'), envText(ENV_VARS))
    await saveToolLock(h, {
      version: 1,
      tools: {
        [SKILLHONE_TOOL_ID]: entry({
          installKind: 'git-skill',
          requestedPin: SHA,
          resolvedVersion: SHA,
          bin,
          links: [link],
          ...(config ? { config } : {}),
        }),
      },
    })
  }

  const run = async (h: string, userHome: string) =>
    doctor({
      home: h,
      skills: [],
      ledgerLifecycle: new Map(),
      ruleMap: CURRENT,
      userHome,
      exec: healthy,
    })

  const kinds = (report: Awaited<ReturnType<typeof doctor>>): string[] =>
    report.tools.filter((row) => row.kind.startsWith('skillhone-config')).map((row) => row.kind)

  it('names an absent file, and does not fail the report for it', async () => {
    const h = await home()
    const u = await home()
    await seed(h)

    const report = await run(h, u)
    expect(kinds(report)).toEqual(['skillhone-config-missing'])
    // R3.7's rule, as for skillhone-deps beside it: reported, never written.
    expect(report.failed).toBe(false)
  })

  it('names a file it did not write rather than replacing it', async () => {
    const h = await home()
    const u = await home()
    await seed(h)
    await mkdir(join(u, '.skillhone'), { recursive: true })
    await writeFile(skillhoneSettingsPath(u), '{"hand":"written"}\n')

    const report = await run(h, u)
    expect(kinds(report)).toEqual(['skillhone-config-unmanaged'])
    expect(report.failed).toBe(false)
    expect(await readFile(skillhoneSettingsPath(u), 'utf8')).toBe('{"hand":"written"}\n')
  })

  it('names a file edited since it was written', async () => {
    const h = await home()
    const u = await home()
    const written = await writeSkillhoneSettings(u, skillhoneSettings(ENV_VARS)!)
    if (written.kind !== 'written') throw new Error('expected a write')
    await seed(h, { path: written.path, sha256: written.sha256, writtenAt: 'now' })
    await writeFile(written.path, '{"edited":true}\n')

    expect(kinds(await run(h, u))).toEqual(['skillhone-config-unmanaged'])
  })

  it('names its own file as stale once .env moves under it', async () => {
    const h = await home()
    const u = await home()
    const written = await writeSkillhoneSettings(u, skillhoneSettings(ENV_VARS)!)
    if (written.kind !== 'written') throw new Error('expected a write')
    await seed(h, { path: written.path, sha256: written.sha256, writtenAt: 'now' })
    // A rotated token: never-overwrite means nothing else would ever say so.
    await writeFile(join(h, '.env'), envText({ ...ENV_VARS, ANTHROPIC_AUTH_TOKEN: 'sk-ffffffffffffffffffffffffffffffff' }))

    const report = await run(h, u)
    expect(kinds(report)).toEqual(['skillhone-config-stale'])
    expect(report.failed).toBe(false)
  })

  it('says nothing about a file it wrote that still matches .env', async () => {
    const h = await home()
    const u = await home()
    const written = await writeSkillhoneSettings(u, skillhoneSettings(ENV_VARS)!)
    if (written.kind !== 'written') throw new Error('expected a write')
    await seed(h, { path: written.path, sha256: written.sha256, writtenAt: 'now' })

    expect(kinds(await run(h, u))).toEqual([])
  })

  it('never puts a credential in the report', async () => {
    const h = await home()
    const u = await home()
    await seed(h)
    await mkdir(join(u, '.skillhone'), { recursive: true })
    await writeFile(skillhoneSettingsPath(u), `{"api_key":"${TOKEN}"}\n`)

    const report = await run(h, u)
    expect(JSON.stringify(report)).not.toContain(TOKEN)
  })
})

describe('doctor and an available upgrade', () => {
  it('reports what the caller found without failing the report', async () => {
    const h = await home()
    const report = await doctor({
      home: h,
      skills: [],
      ledgerLifecycle: new Map(),
      ruleMap: CURRENT,
      upgradeAvailable: { current: '0.5.1', latest: '0.6.0' },
    })
    expect(report.upgrade).toEqual({ current: '0.5.1', latest: '0.6.0' })
    expect(report.failed).toBe(false)
  })

  it('reports null when the caller found nothing, and when it passed nothing', async () => {
    const h = await home()
    const base = { home: h, skills: [], ledgerLifecycle: new Map(), ruleMap: CURRENT }
    expect((await doctor(base)).upgrade).toBeNull()
    expect((await doctor({ ...base, upgradeAvailable: null })).upgrade).toBeNull()
  })
})
