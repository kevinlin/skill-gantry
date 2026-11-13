import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createGantryViews } from '../../src/cli/gantry-views.js'
import { buildSetupDriver } from '../../src/cli/setup-command.js'
import { loadConfig, loadToolLock, saveConfig, saveToolLock } from '../../src/core/config/config.js'
import type { ToolLockEntry } from '../../src/core/config/config.js'
import { PRESETS, expandSelection } from '../../src/core/tools/catalogue.js'
import { createQueue } from '../../src/core/index.js'
import type { SetupDriver } from '../../src/core/tools/setup.js'
import { App } from '../../src/tui/app.js'
import { makeFakeTool } from '../helpers/fake-tool.js'
import { type Headless, makeHeadless } from '../helpers/headless.js'
import { renderInk, waitForFrame } from '../helpers/render-ink.js'
import { SKILL_MD_FULL } from '../helpers/tmp-repo.js'

const run = promisify(execFile)

/**
 * M11's exit criterion, driven the way M10's is: through `main()`, with no
 * terminal, reading the two streams and the exit code. Each case is one of the
 * things that needed a screen in 1.0.0 — a sweep, triage, a toolchain, a target
 * checked before the write — and the first is the screen itself agreeing with
 * the command.
 */

const EVAL_REPORT = join(process.cwd(), 'tests/fixtures/skill-up/declawed-iteration-3.report.json')

const sarif = (results: unknown[]): string =>
  JSON.stringify({
    version: '2.1.0',
    runs: [{ tool: { driver: { name: 'skillspector', version: '2.11.2' } }, results }],
  })

const FINDING = {
  ruleId: 'MP2',
  message: { text: 'Context Window Stuffing' },
  level: 'error',
  locations: [
    { physicalLocation: { artifactLocation: { uri: 'scripts/scan.py' }, region: { startLine: 3 } } },
  ],
}

/**
 * `$2` is the skill directory and `$7` the SARIF path the adapter names. A
 * skill fails exactly while it carries `scripts/scan.py`, so "one failing skill
 * among passing ones" is a fact about the tree and a later pass is an edit to it.
 */
const SKILLSPECTOR = `
if [ -f "$2/scripts/scan.py" ]; then
  printf '%s' '${sarif([FINDING])}' > "$7"
else
  printf '%s' '${sarif([])}' > "$7"
fi
`

const SKILL_LINT = `printf '%s' '{"tool":"skill-lint","schemaVersion":1,"skill":{"files":[]},"findings":[]}'`

/** argv is `run <suite> --format json --output-dir <dir> --iteration 1`. */
const SKILL_UP = `mkdir -p "$6/iteration-1" && cp "${EVAL_REPORT}" "$6/iteration-1/report.json"`

const locked = (installKind: ToolLockEntry['installKind'], version: string, bin: string): ToolLockEntry => ({
  installKind,
  requestedPin: version,
  resolvedVersion: version,
  bin,
  integrity: 'n/a',
  installedAt: '2026-08-01T00:00:00Z',
  verifiedAt: '2026-08-01T00:00:00Z',
})

async function harness(files: Record<string, string>): Promise<Headless> {
  const h = await makeHeadless({ git: true, releaseTool: true, repos: [files] })
  const lock = await loadToolLock(h.home)
  await saveToolLock(h.home, {
    ...lock,
    tools: {
      ...lock.tools,
      'skill-lint': locked('npm-prefix', '0.2.0', await makeFakeTool('skill-lint', SKILL_LINT)),
      'skill-up': locked('gh-release', '0.11.0', await makeFakeTool('skill-up', SKILL_UP)),
      skillspector: locked('uv-tool', '2.11.2', await makeFakeTool('skillspector', SKILLSPECTOR)),
    },
  })
  const config = await loadConfig(h.home)
  await saveConfig(h.home, {
    ...config,
    stageTools: { ...config.stageTools, validate: ['skill-lint'], evaluate: ['skill-up'], security: ['skillspector'] },
  })
  return h
}

const skill = (name: string): Record<string, string> => ({
  [`${name}/SKILL.md`]: SKILL_MD_FULL(name),
  [`${name}/evals/eval.yaml`]: 'schema_version: v1alpha1\n',
})

interface Status {
  skill: { id: string; version: string | null }
  gates: Array<{ stage: string; outcome: string | null; runId: string | null; current: boolean }>
  issues: { open: number; items: Array<{ fingerprint: string; state: string }> }
  release: {
    ready: boolean
    blockers: Array<{ code: string; message: string }>
    dirty: string[]
    unchecked: string[]
    target?: { requested: string; resolved: string | null }
  }
  next: Array<{ command: string | null; why: string }>
}

async function status(h: Headless, id: string, ...flags: string[]): Promise<Status> {
  h.out.length = 0
  expect(await h.run(['status', id, ...flags, '--json'])).toBe(0)
  return h.json<Status>()
}

const repoIdOf = async (h: Headless): Promise<string> =>
  ((await loadConfig(h.home)).repos[0] as { id: string }).id


/** The status row of the rail: the line under the one that names the stages. */
function railRow(frame: string): string {
  const lines = frame.split('\n')
  const at = lines.findIndex((line) => line.includes('Validate') && line.includes('Evaluate'))
  return at === -1 ? '' : (lines[at + 1] as string)
}

/**
 * The Work screen over the real port and the real ledger, with a queue that is
 * never asked to run anything: what is on trial is what the rail shows for
 * evidence the headless commands recorded.
 */
async function railOf(h: Headless, settled: (row: string) => boolean): Promise<string> {
  const queue = createQueue({
    concurrency: 1,
    startRun: () => {
      throw new Error('this screen runs nothing')
    },
  })
  const ui = renderInk(
    <App
      skills={await h.skills()}
      queue={queue}
      stages={['validate', 'evaluate', 'security']}
      concurrency={1}
      views={createGantryViews(h.deps)}
      setup={buildSetupDriver(h.home)}
      intervalMs={20}
    />,
    { columns: 110, rows: 30 },
  )
  try {
    // Gives up quietly when the row never settles, so the caller's assertion is
    // the one that reports the frame.
    await waitForFrame(ui, (frame) => settled(railRow(frame)), 200)
    return railRow(ui.lastFrame())
  } finally {
    ui.unmount()
    queue.close()
  }
}

/** The rail's cells in stage order: words and `·`, without the panel borders sharing the row. */
const words = (row: string): string[] => row.split(/\s+/).filter((word) => /^(~?[A-Za-z]+|·)$/.test(word))

describe('M11: what only a terminal could do', () => {
  it('shows on the rail what status reports, gate for gate', async () => {
    const h = await harness(skill('sk'))
    const repo = h.repos[0] as string
    const id = `${await repoIdOf(h)}/sk`

    // Three runs, one gate each: the newest run executed security alone.
    for (const stage of ['validate', 'evaluate', 'security']) {
      expect(await h.run(['run', id, '--stage', stage])).toBe(0)
    }
    let doc = await status(h, id)
    expect(doc.gates.map((g) => [g.outcome, g.current])).toEqual([
      ['passed', true],
      ['passed', true],
      ['passed', true],
    ])
    expect(new Set(doc.gates.map((g) => g.runId)).size).toBe(3)

    // 1.0.0 read `·  ·  passed` here: the newest run and nothing else.
    let row = await railOf(h, (line) => words(line).filter((word) => word === 'passed').length === 3)
    expect(words(row).slice(0, 3)).toEqual(['passed', 'passed', 'passed'])

    // One byte moves, and every verdict is about files that are gone.
    await writeFile(join(repo, 'sk/SKILL.md'), `${SKILL_MD_FULL('sk')}\nA new line.\n`)
    doc = await status(h, id)
    expect(doc.gates.map((g) => [g.outcome, g.current])).toEqual([
      ['passed', false],
      ['passed', false],
      ['passed', false],
    ])
    row = await railOf(h, (line) => words(line).filter((word) => word === '~passed').length === 3)
    expect(words(row).slice(0, 3)).toEqual(['~passed', '~passed', '~passed'])
  }, 120_000)
  it('sweeps a repo under one exit code, and triages what the sweep found', async () => {
    const h = await harness({
      ...skill('good'),
      ...skill('bad'),
      'bad/scripts/scan.py': 'import re\n',
    })
    const repo = h.repos[0] as string
    const repoId = await repoIdOf(h)
    const bad = `${repoId}/bad`

    // One failing skill among passing ones: exit 1, and the summary names it.
    expect(await h.run(['run', '--repo', repoId, '--json'])).toBe(1)
    const lines = h.out.map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(lines.at(-1)).toEqual({ summary: { skills: 2, passed: 1, notPassed: [bad] } })
    // Every other line is one run's event, tagged with the skill it belongs to.
    expect(new Set(lines.slice(0, -1).map((line) => line['skillId']))).toEqual(
      new Set([`${repoId}/good`, bad]),
    )

    // The sweep left the evidence a single `run` leaves: status reads it.
    let doc = await status(h, bad)
    expect(doc.gates.map((g) => [g.stage, g.outcome, g.current])).toEqual([
      ['validate', 'passed', true],
      ['evaluate', 'passed', true],
      ['security', 'failed', true],
    ])
    expect(doc.issues.open).toBe(1)
    const fingerprint = doc.issues.items[0]?.fingerprint as string

    // Triage with no Issues screen. Acknowledged is still open.
    h.out.length = 0
    expect(await h.run(['issue', fingerprint, 'acknowledge', '--json'])).toBe(0)
    expect(h.json()).toEqual({ fingerprint, state: 'acknowledged' })
    doc = await status(h, bad)
    expect(doc.issues).toMatchObject({ open: 1, items: [{ fingerprint, state: 'acknowledged' }] })

    // Not a legal move from here: it ran, and the answer was no.
    h.out.length = 0
    expect(await h.run(['issue', fingerprint, 'acknowledge', '--json'])).toBe(1)
    expect(h.json()).toEqual({ fingerprint, state: 'acknowledged' })

    expect(await h.run(['issue', fingerprint, 'wontfix'])).toBe(0)
    expect((await status(h, bad)).issues.open).toBe(0)
    expect(await h.run(['issue', fingerprint, 'reopen'])).toBe(0)
    expect((await status(h, bad)).issues.open).toBe(1)

    // Requests that cannot be carried out: one line, exit 2, nothing started.
    for (const args of [
      ['issue', 'no-such-fingerprint', 'reopen'],
      ['issue', fingerprint, 'delete'],
      ['run', '--repo', 'no-such-repo'],
      ['run', bad, '--repo', repoId],
      ['run'],
      ['run', '--repo', repoId, '--stage', 'release'],
    ]) {
      h.err.length = 0
      expect(await h.run(args), args.join(' ')).toBe(2)
      expect(h.err, args.join(' ')).toHaveLength(1)
    }

    // The same repo without the failing file: every run passes, exit 0.
    await rm(join(repo, 'bad/scripts'), { recursive: true })
    h.out.length = 0
    expect(await h.run(['run', '--repo', repoId])).toBe(0)
    expect(h.out.at(-1)).toBe('2 skills: 2 passed, 0 not passed')
  }, 120_000)

  it('checks a target before the write, releases, and names a commit that takes nothing else', async () => {
    const h = await harness(skill('sk'))
    const repo = h.repos[0] as string
    const id = `${await repoIdOf(h)}/sk`
    const git = (...args: string[]): Promise<{ stdout: string }> => run('git', args, { cwd: repo })

    expect(await h.run(['run', id])).toBe(0)

    // A target that does not resolve is a blocker, with nothing a command fixes.
    let doc = await status(h, id, '--version', '0.9.0')
    expect(doc.release).toMatchObject({
      ready: false,
      unchecked: ['sandbox'],
      target: { requested: '0.9.0', resolved: null },
    })
    expect(doc.release.blockers.map((b) => b.code)).toEqual(['target-invalid'])
    expect(doc.next).toEqual([{ command: null, why: doc.release.blockers[0]?.message }])

    // An archive of the target version already in the tree is uncommitted, not
    // a refusal: it is `--allow-dirty`'s call, as it is for release.
    await writeFile(join(repo, 'sk_1.0.1.zip'), 'left by an earlier attempt')
    doc = await status(h, id, '--version', 'patch')
    expect(doc.release).toMatchObject({
      ready: true,
      dirty: ['sk_1.0.1.zip'],
      unchecked: ['sandbox'],
      target: { requested: 'patch', resolved: '1.0.1' },
    })
    await rm(join(repo, 'sk_1.0.1.zip'))

    // Clear: ready, and `next` carries the version the bump resolved to.
    doc = await status(h, id, '--version', 'patch')
    expect(doc.release).toMatchObject({ ready: true, blockers: [], dirty: [] })
    expect(doc.next).toHaveLength(1)
    expect(doc.next[0]?.command).toBe(`skillgantry release ${id} --version 1.0.1 --yes`)

    // Someone else's work is staged. Release permits it: it is outside the scope.
    await writeFile(join(repo, 'notes.txt'), 'not part of any release\n')
    await git('add', 'notes.txt')

    h.out.length = 0
    expect(await h.run((doc.next[0]?.command as string).split(' ').slice(1))).toBe(0)
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('1.0.1')
    expect((await stat(join(repo, 'sk_1.0.1.zip'))).size).toBeGreaterThan(0)

    // R9.7: two commands, named and not run.
    const hint = h.out.filter((line) => line.startsWith('git -C '))
    expect(hint).toHaveLength(2)
    expect(hint[0]).toContain(' add -- ')
    expect(hint[1]).toContain("commit -m 'release(sk): 1.0.1' -- ")
    expect((await git('log', '--format=%s')).stdout.trim()).toBe('fixture')

    // Run exactly as printed, they commit the release and leave the rest staged.
    for (const line of hint) await run('sh', ['-c', line])
    const committed = (await git('show', '--name-only', '--format=%s', 'HEAD')).stdout.trim().split('\n')
    expect(committed[0]).toBe('release(sk): 1.0.1')
    expect(committed.slice(1).filter((line) => line.length > 0).sort()).toEqual(
      ['sk/CHANGELOG.md', 'sk/SKILL.md', 'sk_1.0.1.zip'].sort(),
    )
    expect((await git('diff', '--cached', '--name-only')).stdout.trim()).toBe('notes.txt')
    expect(h.err).toEqual([])
  }, 120_000)

  it('installs a preset with no terminal, and writes no selection when a tool fails', async () => {
    const h = await makeHeadless()
    const wanted = expandSelection(PRESETS.minimal)

    const driverOf = (failing: string | null): { driver: SetupDriver; saved: string[][]; installed: string[] } => {
      const saved: string[][] = []
      const installed: string[] = []
      const refuse = async (): Promise<never> => {
        throw new Error('headless setup touches no repo')
      }
      return {
        saved,
        installed,
        driver: {
          probe: async () => [
            { runtime: 'uv', present: true, version: '0.7.12', installCommand: 'install uv' },
            { runtime: 'npm', present: true, version: '11.0.0', installCommand: 'install npm' },
          ],
          install: async (toolId) => {
            if (toolId === failing) throw new Error(`could not fetch ${toolId}`)
            installed.push(toolId)
          },
          configure: async () => ({ kind: 'skipped' }),
          saveSelection: async (selected) => {
            saved.push([...selected])
          },
          credentialStatus: async () => ({ present: false, warnings: [] }),
          inspectRepo: refuse,
          registerRepo: refuse,
          updateRepo: refuse,
          installedTools: async () => [],
        },
      }
    }

    interface Doc {
      applied: boolean
      tools: Array<{ id: string; state: string; error?: string }>
      credentials: { present: boolean }
    }
    // Standard input is a pipe throughout: this is the path that needs no terminal.
    const setup = async (args: string[], driver: SetupDriver): Promise<[number, Doc]> => {
      h.out.length = 0
      const code = await h.run(['setup', ...args, '--json'], { stdinIsTTY: false, setupDriver: () => driver })
      return [code, h.json<Doc>()]
    }

    // Without --yes: the plan, and nothing done.
    const dry = driverOf(null)
    let [code, doc] = await setup(['--preset', 'minimal'], dry.driver)
    expect(code).toBe(1)
    expect(doc.applied).toBe(false)
    expect(doc.tools).toEqual(wanted.map((toolId) => ({ id: toolId, state: 'would-install' })))
    expect([dry.installed, dry.saved]).toEqual([[], []])

    // With it: everything installed, the selection written, the credential
    // file reported and not created.
    const ok = driverOf(null)
    ;[code, doc] = await setup(['--yes', '--preset', 'minimal'], ok.driver)
    expect(code).toBe(0)
    expect(doc).toMatchObject({ applied: true, credentials: { present: false } })
    expect(ok.installed).toEqual([...wanted])
    expect(ok.saved).toEqual([[...PRESETS.minimal]])

    // One tool fails: the rest are still attempted, and no selection is written.
    const broken = driverOf(wanted[0] as string)
    ;[code, doc] = await setup(['--yes', '--preset', 'minimal'], broken.driver)
    expect(code).toBe(1)
    expect(doc.applied).toBe(false)
    expect(doc.tools[0]).toMatchObject({ id: wanted[0], state: 'failed' })
    expect(broken.installed).toEqual(wanted.slice(1))
    expect(broken.saved).toEqual([])

    // The wizard still needs a terminal, and --yes still needs a preset.
    for (const args of [['setup'], ['setup', '--yes'], ['setup', '--yes', '--preset', 'most']]) {
      h.err.length = 0
      expect(await h.run(args, { stdinIsTTY: false, setupDriver: () => ok.driver })).toBe(2)
      expect(h.err).toHaveLength(1)
    }
  })
})
