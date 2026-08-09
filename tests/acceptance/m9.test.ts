import { mkdir, mkdtemp, readdir, readlink, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runOptimise } from '../../src/cli/optimise-command.js'
import {
  SKILLHONE_TOOL_ID,
  catalogueEntry,
  type ToolSpec,
} from '../../src/core/tools/catalogue.js'
import { doctor } from '../../src/core/tools/doctor.js'
import type { Exec } from '../../src/core/tools/exec.js'
import { gitSkillUninstall } from '../../src/core/tools/git-skill.js'
import { installTool, toolRoot } from '../../src/core/tools/install.js'
import { makeCliFixture } from '../helpers/tmp-repo.js'

const SHA = 'c'.repeat(40)

/** The catalogued entry, repinned so nothing here depends on the live sha. */
const bundleSpec = (): ToolSpec => {
  const spec = catalogueEntry(SKILLHONE_TOOL_ID)
  if (spec === undefined) throw new Error('skillhone is not catalogued')
  return { ...spec, install: { ...spec.install, pin: SHA } }
}

const bundledSkills = (): readonly string[] => {
  const spec = bundleSpec()
  if (spec.install.kind !== 'git-skill') throw new Error('skillhone is not a git-skill entry')
  return spec.install.skills
}

/** Materialises what a clone would leave, so nothing here reaches the network. */
const bundleExec =
  (calls: string[][]): Exec =>
  async (bin, argv) => {
    calls.push([bin, ...argv])
    if (bin === 'git' && argv[0] === 'clone') {
      const repoDir = argv[2] as string
      for (const name of bundledSkills()) {
        await mkdir(join(repoDir, 'skills', name), { recursive: true })
        await writeFile(join(repoDir, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`)
      }
    }
    if (argv.includes('rev-parse')) return { stdout: `${SHA}\n`, stderr: '' }
    return { stdout: '', stderr: '' }
  }

const seedHome = async (): Promise<string> => {
  const home = await mkdtemp(join(tmpdir(), 'sg-m9-'))
  await mkdir(join(home, '.claude', 'skills'), { recursive: true })
  await mkdir(join(home, '.agents', 'skills'), { recursive: true })
  return home
}

describe('M9 exit criteria', () => {
  it('installs by clone, per-skill symlink and a managed venv, with nothing global', async () => {
    const userHome = await seedHome()
    const sgHome = await mkdtemp(join(tmpdir(), 'sg-root-'))
    const calls: string[][] = []

    const entry = await installTool(sgHome, bundleSpec(), {
      exec: bundleExec(calls),
      userHome,
    })

    const dir = join(toolRoot(sgHome), SKILLHONE_TOOL_ID)
    // R3.1: the venv is under the tool root, and no `pip install` ever ran
    // against an interpreter outside it — which is what upstream's own
    // documented install does.
    expect(entry.bin).toBe(join(dir, '.venv', 'bin', 'python'))
    expect(calls.filter(([bin]) => bin === 'pip')).toEqual([])
    for (const call of calls.filter(([bin, sub]) => bin === 'uv' && sub === 'pip')) {
      expect(call).toContain(join(dir, '.venv', 'bin', 'python'))
    }
    // Both runtimes, each link per skill, every target inside the tool root.
    expect(entry.links?.some((link) => link.includes('.claude'))).toBe(true)
    expect(entry.links?.some((link) => link.includes('.agents'))).toBe(true)
    expect(entry.links).toHaveLength(bundledSkills().length * 2)
    for (const link of entry.links ?? []) expect(await readlink(link)).toContain(dir)
  })

  it('uninstall leaves no dangling link', async () => {
    const userHome = await seedHome()
    const sgHome = await mkdtemp(join(tmpdir(), 'sg-root-'))
    const entry = await installTool(sgHome, bundleSpec(), {
      exec: bundleExec([]),
      userHome,
    })

    await gitSkillUninstall(join(toolRoot(sgHome), SKILLHONE_TOOL_ID), entry.links ?? [])

    // A dangling link breaks every agent that scans that directory, which is
    // the cost R3.1 exists to avoid.
    for (const link of entry.links ?? []) await expect(stat(link)).rejects.toThrow()
    expect(await readdir(join(userHome, '.claude', 'skills'))).toEqual([])
  })

  it('doctor names a missing claude CLI and does not fail the report', async () => {
    const userHome = await seedHome()
    const sgHome = await mkdtemp(join(tmpdir(), 'sg-root-'))
    await installTool(sgHome, bundleSpec(), { exec: bundleExec([]), userHome })

    const exec: Exec = async (bin, argv) => {
      if (bin === 'command' && argv[1] === 'claude') throw new Error('not found')
      if (argv.includes('rev-parse')) return { stdout: `${SHA}\n`, stderr: '' }
      return { stdout: '', stderr: '' }
    }
    const report = await doctor({
      home: sgHome,
      skills: [],
      ledgerLifecycle: new Map(),
      ruleMap: { applied: 1, current: 1 },
      exec,
    })

    expect(report.tools.find((row) => row.kind === 'claude-cli-missing')?.detail).toContain(
      '@anthropic-ai/claude-code',
    )
    // R3.7's rule: reported, never installed, and never a reason a tool cannot run.
    expect(report.failed).toBe(false)
  })

  it('skillgantry optimise prints the prompt, names each tool report, and writes not one byte', async () => {
    const fixture = await makeCliFixture({ seedRun: 'suppressed-and-actionable' })
    const before = await readdir(fixture.runsRoot)

    const code = await runOptimise(fixture.deps, 'declawed', {})
    const body = fixture.out.join('')

    expect(code).toBe(0)
    expect(body).toContain('# Optimise: declawed')
    // §9.4's rule, at this prompt too: name the report, do not restate it.
    expect(body).toContain(
      join(fixture.runsRoot, fixture.runId ?? '', '03-security', 'skillspector'),
    )
    // R6.11: never tell an agent to fix what the user has already ruled on.
    expect(body).toContain('1 suppressed finding')
    expect(body).not.toContain('alignment whitespace')
    // R11.10 and R12.6's shared constraint.
    expect(await readdir(fixture.runsRoot)).toEqual(before)
  })
})
