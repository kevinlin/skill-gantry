import { mkdir, mkdtemp, readFile, readdir, readlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runEvals } from '../../src/cli/evals-command.js'
import { saveToolLock } from '../../src/core/config/config.js'
import {
  SKILL_UPPER_TOOL_ID,
  SKILL_UP_TOOL_ID,
  catalogueEntry,
  type ToolSpec,
} from '../../src/core/tools/catalogue.js'
import { doctor } from '../../src/core/tools/doctor.js'
import type { Exec } from '../../src/core/tools/exec.js'
import { installTool, toolRoot } from '../../src/core/tools/install.js'
import { App } from '../../src/tui/app.js'
import type { GantryViews } from '../../src/tui/views.js'
import { fakeViews } from '../helpers/fake-views.js'
import { recordingQueue } from '../helpers/fake-run.js'
import { renderInk } from '../helpers/render-ink.js'
import { skillRef } from '../helpers/skill-ref.js'
import { makeCliFixture } from '../helpers/tmp-repo.js'
import type { QueueHandle, SkillRef } from '../../src/core/index.js'

const PIN = 'v0.7.0'

/** The catalogued entry, so nothing here can drift from what ships. */
const bundleSpec = (): ToolSpec => {
  const spec = catalogueEntry(SKILL_UPPER_TOOL_ID)
  if (spec === undefined) throw new Error('skill-upper is not catalogued')
  return spec
}

/** Materialises what a clone would leave, so nothing here reaches the network. */
const bundleExec =
  (calls: string[][]): Exec =>
  async (bin, argv) => {
    calls.push([bin, ...argv])
    if (bin === 'git' && argv[0] === 'clone') {
      const repoDir = argv[2] as string
      const dir = join(repoDir, 'skills', SKILL_UPPER_TOOL_ID)
      await mkdir(join(dir, 'assets'), { recursive: true })
      await writeFile(join(dir, 'SKILL.md'), '---\nname: skill-upper\n---\n')
      await writeFile(join(dir, 'assets', 'eval.yaml.tmpl'), '# template\n')
    }
    if (argv.includes('rev-parse')) return { stdout: `${PIN}\n`, stderr: '' }
    return { stdout: '', stderr: '' }
  }

const SKILLS: readonly SkillRef[] = [
  skillRef('declawed', { version: '1.0.1', isGit: true }),
  skillRef('spec-lint', { version: '1.0.1', isGit: true }),
]

/** The state R11.22 exists for: skill-up is ready, the skill carries no suite. */
const noSuite = (): GantryViews =>
  fakeViews(
    {
      planEvals: async (skillId) => {
        const found = SKILLS.find((candidate) => candidate.id === skillId)
        if (found === undefined) throw new Error(`no skill ${skillId}`)
        return {
          skill: found,
          prompt: `# Author the eval suite for ${found.name}\n\n- Skill directory: \`${found.dir}\`\n`,
          hasSuite: false,
          missing: [],
        }
      },
    },
    SKILLS,
  )

const render = (queue: QueueHandle, views: GantryViews) =>
  renderInk(
    <App
      skills={SKILLS}
      queue={queue}
      stages={['validate', 'evaluate', 'security']}
      concurrency={2}
      views={views}
      optimiseReady
      intervalMs={20}
    />,
    { columns: 100, rows: 30 },
  )

/** Focus the work zone, walk one column to Evaluate, and mark it. */
const markEvaluate = async (ui: ReturnType<typeof render>): Promise<void> => {
  ui.stdin.send('\t')
  await ui.settle()
  ui.stdin.send('l')
  await ui.settle()
  ui.stdin.send(' ')
  await ui.settle()
}

describe('M4.2 exit criteria', () => {
  it('installs skill-upper by clone and per-skill symlink, with nothing global', async () => {
    const userHome = await mkdtemp(join(tmpdir(), 'sg-m4.2-user-'))
    await mkdir(join(userHome, '.claude', 'skills'), { recursive: true })
    await mkdir(join(userHome, '.agents', 'skills'), { recursive: true })
    const sgHome = await mkdtemp(join(tmpdir(), 'sg-m4.2-root-'))
    const calls: string[][] = []

    const entry = await installTool(sgHome, bundleSpec(), {
      exec: bundleExec(calls),
      userHome,
    })

    const dir = join(toolRoot(sgHome), SKILL_UPPER_TOOL_ID)
    // R3.11 with R3.5 as amended: no venv, so `uv` is never invoked at all.
    expect(calls.filter((call) => call[0] === 'uv')).toEqual([])
    expect(entry.bin).toBe(join(dir, 'repo', 'skills', SKILL_UPPER_TOOL_ID))
    // R3.1's carve-out: one link per detected runtime directory, recorded in
    // the lock, and nowhere else.
    expect(entry.links?.sort()).toEqual(
      [
        join(userHome, '.claude', 'skills', SKILL_UPPER_TOOL_ID),
        join(userHome, '.agents', 'skills', SKILL_UPPER_TOOL_ID),
      ].sort(),
    )
    for (const link of entry.links ?? []) {
      expect(await readlink(link)).toBe(join(dir, 'repo', 'skills', SKILL_UPPER_TOOL_ID))
    }
  })

  it('reports a skill link it did not create without failing and without touching it', async () => {
    const userHome = await mkdtemp(join(tmpdir(), 'sg-m4.2-user-'))
    const foreign = join(userHome, '.claude', 'skills', SKILL_UPPER_TOOL_ID)
    await mkdir(foreign, { recursive: true })
    await writeFile(join(foreign, 'SKILL.md'), '---\nname: theirs\n---\n')
    const sgHome = await mkdtemp(join(tmpdir(), 'sg-m4.2-root-'))
    await saveToolLock(sgHome, { version: 1, tools: {} })

    const report = await doctor({
      home: sgHome,
      skills: [],
      ledgerLifecycle: new Map(),
      ruleMap: { applied: 1, current: 1 },
      userHome,
      exec: async () => ({ stdout: '', stderr: '' }),
    })

    const finding = report.tools.find((row) => row.kind === 'skill-link-unmanaged')
    expect(finding?.toolId).toBe(SKILL_UPPER_TOOL_ID)
    expect(finding?.detail).toContain('skillgantry setup')
    // A foreign copy works — failing the report on a machine that is fine is
    // how a doctor report stops being read.
    expect(report.failed).toBe(false)
    expect(await readFile(join(foreign, 'SKILL.md'), 'utf8')).toBe('---\nname: theirs\n---\n')
    expect(await readdir(join(userHome, '.claude', 'skills'))).toEqual([SKILL_UPPER_TOOL_ID])
  })

  it('opens the surface on a lone evaluate mark and leaves the queue empty', async () => {
    const { queue, batches } = recordingQueue()
    const ui = render(queue, noSuite())
    await ui.settle()
    await markEvaluate(ui)

    ui.stdin.send('r')
    await ui.settle(40)

    expect(batches).toHaveLength(0)
    expect(ui.lastFrame()).toContain('# Author the eval suite')
    ui.unmount()
    queue.close()
  })

  it('refuses a mixed mark by name', async () => {
    const { queue, batches } = recordingQueue()
    const ui = render(queue, noSuite())
    await ui.settle()
    await markEvaluate(ui)
    ui.stdin.send('h')
    await ui.settle()
    ui.stdin.send(' ')
    await ui.settle()

    ui.stdin.send('r')
    await ui.settle(40)

    expect(ui.lastFrame()).toContain('has no eval suite')
    expect(batches).toHaveLength(0)
    ui.unmount()
    queue.close()
  })

  it('prints the same body headlessly and writes not one byte', async () => {
    const fixture = await makeCliFixture({
      lockTools: [SKILL_UP_TOOL_ID],
      runtimeSkills: [SKILL_UPPER_TOOL_ID],
    })
    const before = await readdir(fixture.runsRoot).catch(() => [])
    const repoBefore = await readdir(join(fixture.repo, 'declawed'))

    const code = await runEvals(fixture.deps, 'declawed', {}, fixture.userHome)

    expect(code).toBe(0)
    const body = fixture.out.join('\n')
    expect(body).toContain('# Author the eval suite for declawed')
    // Every clause R6.13 makes load-bearing, on one body.
    expect(body).toContain('skill-up run')
    expect(body).toContain('evals/eval.yaml` and nowhere else')
    expect(body).toContain('evals/cases/<case-id>.yaml')
    expect(body).toContain('`rule_based`')
    expect(body).toContain('`ANTHROPIC_API_KEY`')
    // R11.10's and R12.6's shared constraint, extended to the repo: the
    // pipeline stays the only writer under runs/, and this writes nowhere.
    expect(await readdir(fixture.runsRoot).catch(() => [])).toEqual(before)
    expect(await readdir(join(fixture.repo, 'declawed'))).toEqual(repoBefore)
  })
})
