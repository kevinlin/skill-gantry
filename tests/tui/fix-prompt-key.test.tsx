import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createQueue, fixPromptPathFor } from '../../src/core/index.js'
import type { RawFinding, SkillRef, StageResult } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeRun, type FakeRun } from '../helpers/fake-run.js'
import { fakeViews } from '../helpers/fake-views.js'
import { renderInk, waitForFrame } from '../helpers/render-ink.js'
import { skillRef } from '../helpers/skill-ref.js'

const FINDING: RawFinding = {
  ruleClass: 'excessive-permission',
  nativeRuleId: 'LP3',
  severity: 'medium',
  path: 'declawed/SKILL.md',
  line: 1,
  message: 'no declared permissions',
}

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
  // The rail belongs to the work zone (R11.11), so `l` is inert until tab has
  // moved out of the skill list.
  ui.stdin.send('\t')
  await ui.settle()
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
      skills={[skillRef('declawed')]}
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

/**
 * A run whose `stage` produced one finding, with the rail left where it starts.
 * `driveRun` emits only `stage:done`, which fills the rail's cell but not
 * `SkillRow.findings` — and R11.9 as amended reads the *finding's* stage, so the
 * Findings pane has to actually hold a row.
 */
async function harnessWithFinding(stage: 'security') {
  const h = await harness({ findings: [FINDING], body: '# fix the security findings\n' })
  const run = await driveRun(h, h.runDir, [FINDING])
  run.events.push({
    type: 'tool:done',
    runId: 'run-declawed',
    stage,
    toolId: 'skillspector',
    result: stageResult([FINDING]).toolRuns[0]!,
  })
  await h.ui.settle()
  return { ...h, run }
}

describe('R11.9 the y binding', () => {
  it('emits the base64 of the file and names the path, without changing the row count', async () => {
    const body = '# Fix the security findings on declawed\n'
    const h = await harness({ findings: [FINDING], body })
    const run = await driveRun(h, h.runDir, [FINDING])
    await toSecurity(h.ui)

    const before = rowsOf(h.ui.lastFrame())
    h.ui.stdin.send('y')
    // The prompt is read off disk, so the flash is what says the read landed.
    await waitForFrame(h.ui, (frame) => /copied|no recorded run|found nothing|not written yet|too large/.test(frame))

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

  // R11.10 rehydrates a recorded run, so `runDir === null` now means the skill
  // has never run — where `skillgantry fix` would exit non-zero too.
  it('says no run has been recorded, and emits nothing, for a skill that never ran', async () => {
    const h = await harness({ findings: [], body: null })
    await toSecurity(h.ui)

    h.ui.stdin.send('y')
    // The prompt is read off disk, so the flash is what says the read landed.
    await waitForFrame(h.ui, (frame) => /copied|no recorded run|found nothing|not written yet|too large/.test(frame))

    expect(h.ui.lastFrame()).toContain('no recorded run for declawed')
    expect(h.ui.frames.join('')).not.toContain(']52;c;')

    h.ui.unmount()
    h.queue.close()
  })

  it('says the stage found nothing, and emits nothing, for a zero-finding stage', async () => {
    const h = await harness({ findings: [], body: null })
    const run = await driveRun(h, h.runDir, [])
    await toSecurity(h.ui)

    h.ui.stdin.send('y')
    // The prompt is read off disk, so the flash is what says the read landed.
    await waitForFrame(h.ui, (frame) => /copied|no recorded run|found nothing|not written yet|too large/.test(frame))

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
    // The prompt is read off disk, so the flash is what says the read landed.
    await waitForFrame(h.ui, (frame) => /copied|no recorded run|found nothing|not written yet|too large/.test(frame))

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
    // The prompt is read off disk, so the flash is what says the read landed.
    await waitForFrame(h.ui, (frame) => /copied|no recorded run|found nothing|not written yet|too large/.test(frame))

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
    // The prompt is read off disk, so the flash is what says the read landed.
    await waitForFrame(h.ui, (frame) => /copied|no recorded run|found nothing|not written yet|too large/.test(frame))
    expect(h.ui.lastFrame()).toContain('copied')

    h.ui.stdin.send('j')
    await h.ui.settle()
    expect(h.ui.lastFrame()).not.toContain('copied')
    expect(h.ui.lastFrame()).toContain('? help')

    run.finish()
    h.ui.unmount()
    h.queue.close()
  })

  it('copies the stage that produced the selected finding, whatever the rail points at — R11.9 as amended', async () => {
    // A run whose security stage found something while the rail sits on Validate.
    // Before the amendment this reported "validate found nothing — no prompt".
    const h = await harnessWithFinding('security')
    h.ui.stdin.send('\t') // focus the work zone
    await h.ui.settle()
    h.ui.stdin.send('2') // Findings tab
    await waitForFrame(h.ui, (frame) => frame.includes('excessive-permission'))
    // The rail has not moved: Validate is still its selection.
    expect(h.ui.lastFrame()).toContain('Validate')
    h.ui.stdin.send('y')
    await waitForFrame(h.ui, (frame) =>
      /copied|no recorded run|found nothing|not written yet|too large/.test(frame),
    )

    expect(h.ui.lastFrame()).toContain('copied')
    expect(h.ui.lastFrame()).toContain('fix-prompt.md')
    expect(h.ui.frames.join('')).toContain(
      Buffer.from('# fix the security findings\n', 'utf8').toString('base64'),
    )

    h.run.finish()
    h.ui.unmount()
    h.queue.close()
  })
})

describe('R11.10 the y binding over a rehydrated run', () => {
  /** A real sidecar: one finalised security run with a prompt beside it. */
  async function recordedSkill(): Promise<{ skill: SkillRef; body: string }> {
    const workspacePath = await mkdtemp(join(tmpdir(), 'sg-ws-'))
    const runDir = join(workspacePath, 'skillgantry', 'runs', 'run-b')
    const stageDir = join(runDir, '03-security')
    await mkdir(stageDir, { recursive: true })
    await writeFile(join(stageDir, 'stage.json'), JSON.stringify(stageResult([FINDING])))
    const body = '# Fix the security findings on declawed\n'
    await writeFile(fixPromptPathFor(runDir, 'security'), body)
    await mkdir(join(workspacePath, 'skillgantry', 'runs'), { recursive: true })
    await writeFile(
      join(workspacePath, 'skillgantry', 'runs', 'index.ndjson'),
      `${JSON.stringify({ runId: 'run-b', outcome: 'failed', endedAt: '2026-08-02T00:00:00Z' })}\n`,
    )
    return { skill: skillRef('declawed', { workspacePath }), body }
  }

  it('copies the recorded prompt with no run started this session', async () => {
    const { skill: recorded, body } = await recordedSkill()
    const queue = createQueue({ concurrency: 1, startRun: (job) => fakeRun(job.jobId).handle })
    const ui = renderInk(
      <App
        skills={[recorded]}
        queue={queue}
        stages={['security']}
        concurrency={1}
        views={fakeViews()}
        intervalMs={20}
      />,
    )
    // The rehydrating read is async; the rail is how it announces itself.
    await waitForFrame(ui, (frame) => frame.includes('failed'))
    await toSecurity(ui)

    const before = ui.lastFrame().split('\n').length
    ui.stdin.send('y')
    await waitForFrame(ui, (frame) => frame.includes('copied'))

    expect(ui.frames.join('')).toContain(Buffer.from(body, 'utf8').toString('base64'))
    expect(ui.lastFrame()).toContain('copied')
    // §14.1: still the footer's row, never one of its own.
    expect(ui.lastFrame().split('\n').length).toBe(before)

    ui.unmount()
    queue.close()
  })
})
