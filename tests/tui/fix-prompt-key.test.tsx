import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createQueue, fixPromptPathFor } from '../../src/core/index.js'
import type { RawFinding, SkillRef, StageResult } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeRun, type FakeRun } from '../helpers/fake-run.js'
import { fakeViews } from '../helpers/fake-views.js'
import { renderInk } from '../helpers/render-ink.js'

const FINDING: RawFinding = {
  ruleClass: 'excessive-permission',
  nativeRuleId: 'LP3',
  severity: 'medium',
  path: 'declawed/SKILL.md',
  line: 1,
  message: 'no declared permissions',
}

const skill = (id: string): SkillRef => ({
  id,
  name: id,
  version: '1.0.0',
  dir: `/repo/${id}`,
  relPath: id,
  repo: { id: 'fx', path: '/repo', name: 'fx', isGit: false },
  rootSkill: false,
  workspacePath: `/repo/${id}-workspace`,
  deprecated: false,
  supersededBy: null,
})

const stageResult = (findings: RawFinding[]): StageResult => ({
  stage: 'security',
  outcome: findings.length > 0 ? 'failed' : 'passed',
  verdict: findings.length > 0 ? 'failed' : 'passed',
  toolRuns: [
    {
      toolId: 'skillspector',
      toolVersion: '2.5.1',
      outcome: findings.length > 0 ? 'failed' : 'passed',
      exitCode: 0,
      durationMs: 1,
      errorKind: null,
      artefactDir: '/tmp/x',
      findings,
      metrics: {},
      summary: 'x',
    },
  ],
})

/** The rail starts on Validate, so `l` twice lands on Security. */
const toSecurity = async (ui: { stdin: { send(s: string): void }; settle(): Promise<void> }) => {
  ui.stdin.send('l')
  ui.stdin.send('l')
  await ui.settle()
}

async function harness({
  findings,
  body,
  size,
}: {
  findings: RawFinding[]
  body: string | null
  size?: { columns: number; rows: number }
}) {
  const runDir = await mkdtemp(join(tmpdir(), 'sg-run-'))
  if (body !== null) {
    const path = fixPromptPathFor(runDir, 'security')
    await mkdir(join(runDir, '03-security'), { recursive: true })
    await writeFile(path, body)
  }

  const runs = new Map<string, FakeRun>()
  const queue = createQueue({
    concurrency: 1,
    startRun: (job) => {
      const run = fakeRun(`run-${job.skillId}`)
      runs.set(job.jobId, run)
      return run.handle
    },
  })
  const ui = renderInk(
    <App
      skills={[skill('declawed')]}
      queue={queue}
      stages={['security']}
      concurrency={1}
      views={fakeViews()}
      intervalMs={20}
    />,
    size,
  )
  await ui.settle()

  return { runDir, queue, runs, ui, findings, body }
}

/** Enqueues a run and drives it to `stage:done` with the given findings. */
async function driveRun(
  h: Awaited<ReturnType<typeof harness>>,
  runDir: string | null,
  findings: RawFinding[],
) {
  h.ui.stdin.send('r')
  await h.ui.settle()
  const run = [...h.runs.values()][0] as FakeRun
  run.events.push({
    type: 'run:start',
    runId: 'run-declawed',
    skillId: 'declawed',
    stages: ['security'],
    runDir: runDir ?? '',
  })
  await h.ui.settle()
  const result = stageResult(findings)
  run.events.push({
    type: 'stage:done',
    runId: 'run-declawed',
    stage: 'security',
    outcome: result.outcome,
    result,
  })
  await h.ui.settle()
  return run
}

const rowsOf = (frame: string): number => frame.split('\n').length

describe('R11.9 the y binding', () => {
  it('emits the base64 of the file and names the path, without changing the row count', async () => {
    const body = '# Fix the security findings on declawed\n'
    const h = await harness({ findings: [FINDING], body })
    const run = await driveRun(h, h.runDir, [FINDING])
    await toSecurity(h.ui)

    const before = rowsOf(h.ui.lastFrame())
    h.ui.stdin.send('y')
    await h.ui.settle()

    const emitted = h.ui.frames.join('')
    expect(emitted).toContain(']52;c;')
    expect(emitted).toContain(Buffer.from(body, 'utf8').toString('base64'))
    // The path is shown whether or not the terminal honoured the escape.
    expect(h.ui.lastFrame()).toContain('copied')
    expect(h.ui.lastFrame()).toContain('fix-prompt.md')
    // §14.1: the flash takes the footer's row rather than adding one.
    expect(rowsOf(h.ui.lastFrame())).toBe(before)

    run.finish()
    h.ui.unmount()
    h.queue.close()
  })

  it('names the CLI fallback and emits nothing when no run started this session', async () => {
    const h = await harness({ findings: [], body: null })
    await toSecurity(h.ui)

    h.ui.stdin.send('y')
    await h.ui.settle()

    expect(h.ui.lastFrame()).toContain('skillgantry fix declawed --stage security')
    expect(h.ui.frames.join('')).not.toContain(']52;c;')

    h.ui.unmount()
    h.queue.close()
  })

  it('says the stage found nothing, and emits nothing, for a zero-finding stage', async () => {
    const h = await harness({ findings: [], body: null })
    const run = await driveRun(h, h.runDir, [])
    await toSecurity(h.ui)

    h.ui.stdin.send('y')
    await h.ui.settle()

    expect(h.ui.lastFrame()).toContain('security found nothing')
    expect(h.ui.frames.join('')).not.toContain(']52;c;')

    run.finish()
    h.ui.unmount()
    h.queue.close()
  })

  it('reports a missing file as not written yet rather than as a copy', async () => {
    const h = await harness({ findings: [FINDING], body: null })
    const run = await driveRun(h, h.runDir, [FINDING])
    await toSecurity(h.ui)

    h.ui.stdin.send('y')
    await h.ui.settle()

    expect(h.ui.lastFrame()).toContain('not written yet')
    expect(h.ui.lastFrame()).toContain('fix-prompt.md')
    expect(h.ui.frames.join('')).not.toContain(']52;c;')

    run.finish()
    h.ui.unmount()
    h.queue.close()
  })

  it('costs no row at 50x14 either, where the budget is already tight', async () => {
    const h = await harness({
      findings: [FINDING],
      body: '# prompt\n',
      size: { columns: 50, rows: 14 },
    })
    const run = await driveRun(h, h.runDir, [FINDING])
    await toSecurity(h.ui)

    const before = rowsOf(h.ui.lastFrame())
    h.ui.stdin.send('y')
    await h.ui.settle()

    expect(h.ui.lastFrame()).toContain('copied')
    expect(rowsOf(h.ui.lastFrame())).toBe(before)

    run.finish()
    h.ui.unmount()
    h.queue.close()
  })

  it('clears the flash on the next keypress, with no timer', async () => {
    const h = await harness({ findings: [FINDING], body: '# prompt\n' })
    const run = await driveRun(h, h.runDir, [FINDING])
    await toSecurity(h.ui)

    h.ui.stdin.send('y')
    await h.ui.settle()
    expect(h.ui.lastFrame()).toContain('copied')

    h.ui.stdin.send('j')
    await h.ui.settle()
    expect(h.ui.lastFrame()).not.toContain('copied')
    expect(h.ui.lastFrame()).toContain('? help')

    run.finish()
    h.ui.unmount()
    h.queue.close()
  })
})
