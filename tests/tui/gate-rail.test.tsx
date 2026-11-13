import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createQueue, fixPromptPathFor } from '../../src/core/index.js'
import type { QueueHandle, RawFinding, SkillRef, Stage, StageResult } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import type { GantryViews, GateStatus } from '../../src/tui/views.js'
import { fakeRun, type FakeRun } from '../helpers/fake-run.js'
import { fakeViews } from '../helpers/fake-views.js'
import { renderInk, waitForFrame, type InkHarness } from '../helpers/render-ink.js'
import { skillRef } from '../helpers/skill-ref.js'

const gate = (stage: Stage, over: Partial<GateStatus> = {}): GateStatus => ({
  stage,
  outcome: 'passed',
  runId: `run-${stage}`,
  runDir: `/ledger/${stage}`,
  current: true,
  ...over,
})

const stageResult = (stage: Stage, outcome: StageResult['outcome'], findings: RawFinding[] = []): StageResult => ({
  stage,
  outcome,
  verdict: outcome === 'failed' ? 'failed' : 'passed',
  toolRuns: [
    {
      toolId: 'skillspector',
      toolVersion: '2.5.1',
      outcome,
      exitCode: 0,
      durationMs: 1,
      errorKind: null,
      artefactDir: '/tmp/x',
      findings,
      metrics: {},
      summary: `${findings.length} findings`,
    },
  ],
})

const FINDING: RawFinding = {
  ruleClass: 'unsafe-script',
  nativeRuleId: 'MP2',
  severity: 'medium',
  path: 'declawed/scripts/scan.py',
  message: 'alignment whitespace in a re.VERBOSE block',
}

/** The status row of the rail: the line under the one that names the stages. */
function railRow(frame: string): string {
  const lines = frame.split('\n')
  const at = lines.findIndex((line) => line.includes('Validate') && line.includes('Evaluate'))
  // Empty rather than thrown: a predicate asks this of frames the rail is not on.
  return at === -1 ? '' : (lines[at + 1] as string)
}

const STAGES = ['validate', 'evaluate', 'security'] as const

interface Mounted {
  ui: InkHarness
  queue: QueueHandle
  runs: Map<string, FakeRun>
}

function mount(
  views: GantryViews,
  skills: SkillRef[] = [skillRef('declawed')],
  size: { columns: number; rows: number } = { columns: 110, rows: 30 },
): Mounted {
  const runs = new Map<string, FakeRun>()
  let n = 0
  const queue = createQueue({
    concurrency: 1,
    startRun: (job) => {
      n += 1
      const run = fakeRun(`run-live-${n}`)
      runs.set(job.jobId, run)
      return run.handle
    },
  })
  const ui = renderInk(
    <App skills={skills} queue={queue} stages={[...STAGES]} concurrency={1} views={views} intervalMs={20} />,
    size,
  )
  return { ui, queue, runs }
}

/** Drives one live run through `stage` settling with `outcome`, and ends it. */
async function liveRun(
  m: Mounted,
  stage: Stage,
  outcome: StageResult['outcome'],
  { end = true, findings = [] }: { end?: boolean; findings?: RawFinding[] } = {},
): Promise<FakeRun> {
  const before = m.runs.size
  m.queue.enqueue([{ skill: skillRef('declawed'), stages: [stage] }])
  await waitForFrame(m.ui, () => m.runs.size > before)
  const run = [...m.runs.values()].at(-1) as FakeRun
  const runId = `run-live-${m.runs.size}`
  run.events.push({ type: 'run:start', runId, skillId: 'declawed', stages: [stage], runDir: `/runs/${runId}` })
  await m.ui.settle(30)
  run.events.push({ type: 'stage:start', runId, stage, toolIds: ['skillspector'] })
  const result = stageResult(stage, outcome, findings)
  for (const toolRun of result.toolRuns) {
    run.events.push({ type: 'tool:done', runId, stage, toolId: toolRun.toolId, result: toolRun })
  }
  run.events.push({ type: 'stage:done', runId, stage, outcome, result })
  await m.ui.settle(30)
  if (end) {
    run.events.push({ type: 'run:done', runId, outcome, opened: 0, closed: 0, reopened: 0 })
    run.finish({ runId, outcome })
    await m.ui.settle(60)
  }
  return run
}

/** A sidecar whose newest recorded run executed only evaluate, with a security prompt beside the evidence. */
async function recordedSkill(): Promise<{ skill: SkillRef; runDir: string }> {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sg-ws-'))
  const runDir = join(workspacePath, 'skillgantry', 'runs', 'run-newest')
  await mkdir(join(runDir, '02-evaluate'), { recursive: true })
  await writeFile(join(runDir, '02-evaluate', 'stage.json'), JSON.stringify(stageResult('evaluate', 'passed')))
  // The sentinel: a `y` that consulted this run would find a prompt here and copy it.
  await mkdir(join(runDir, '03-security'), { recursive: true })
  await writeFile(fixPromptPathFor(runDir, 'security'), '# the newest run’s prompt\n')
  await writeFile(
    join(workspacePath, 'skillgantry', 'runs', 'index.ndjson'),
    `${JSON.stringify({ runId: 'run-newest', outcome: 'passed', endedAt: '2026-08-02T00:00:00Z' })}\n`,
  )
  return { skill: skillRef('declawed', { workspacePath }), runDir }
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('R11.25 the rail shows each gate’s verdict, not only the newest run’s', () => {
  it('renders all three gates for a newest run that executed only evaluate', async () => {
    const { skill } = await recordedSkill()
    const views = fakeViews({
      gates: async () => [
        gate('validate', { runId: 'run-v' }),
        gate('evaluate', { runId: 'run-newest' }),
        gate('security', { runId: 'run-s', outcome: 'failed' }),
      ],
    })
    const m = mount(views, [skill])
    await waitForFrame(m.ui, (frame) => /passed\s+passed\s+failed/.test(railRow(frame)))
    // The fill is not a run the rail's neighbours show, and not a stale one.
    expect(railRow(m.ui.lastFrame())).toMatch(/passed\s+passed\s+failed/)
    expect(railRow(m.ui.lastFrame())).not.toContain('~')
    m.ui.unmount()
    m.queue.close()
  })

  it('reads after the recorded run has landed, so the run never overwrites a fill', async () => {
    // The ledger read is a microtask and the sidecar read is not; unsequenced,
    // `set-last-run` rebuilds the cells wholesale and erases what landed first.
    const { skill } = await recordedSkill()
    const reads: string[] = []
    const views = fakeViews({
      gates: async (skillId) => {
        reads.push(skillId)
        return [gate('security', { outcome: 'failed' })]
      },
    })
    const m = mount(views, [skill])
    await waitForFrame(m.ui, (frame) => railRow(frame).includes('failed'))
    await m.ui.settle(100)
    expect(railRow(m.ui.lastFrame())).toMatch(/passed\s+failed/)
    // Once: the recorded run's own landing must not send the selection back for a second read.
    expect(reads).toEqual(['declawed'])
    m.ui.unmount()
    m.queue.close()
  })

  it('marks a verdict recorded against other bytes, `~passed`', async () => {
    const views = fakeViews({
      gates: async () => [gate('validate', { current: false }), gate('evaluate')],
    })
    const m = mount(views)
    await waitForFrame(m.ui, (frame) => railRow(frame).includes('~passed'))
    expect(railRow(m.ui.lastFrame())).toMatch(/~passed\s+passed/)
    m.ui.unmount()
    m.queue.close()
  })

  for (const size of [
    { columns: 80, rows: 24 },
    { columns: 130, rows: 40 },
  ]) {
    it(`moves no row or column of the Work screen at ${size.columns}x${size.rows}`, async () => {
      const framesFor = async (current: boolean): Promise<string> => {
        const views = fakeViews({
          gates: async () => [
            gate('validate', { current }),
            gate('evaluate', { outcome: 'failed', current }),
            gate('security', { outcome: 'degraded', current }),
          ],
        })
        const m = mount(views, [skillRef('declawed')], size)
        await waitForFrame(m.ui, (frame) => railRow(frame).includes('degraded'))
        const frame = m.ui.lastFrame()
        m.ui.unmount()
        m.queue.close()
        return frame
      }
      const fresh = await framesFor(true)
      const stale = await framesFor(false)
      expect(stale).toContain('~passed')
      expect(stale).not.toBe(fresh)
      // The mark takes the cell's leading space: put back, the frames are one.
      expect(stale.replaceAll('~', ' ')).toBe(fresh.replaceAll('~', ' '))
      expect(stale.split('\n')).toHaveLength(fresh.split('\n').length)
    })
  }

  it('leaves a newer run’s `errored` as it is, unmarked, over an older ledger pass', async () => {
    const views = fakeViews({ gates: async () => [gate('security', { runId: 'run-older' })] })
    const m = mount(views)
    await m.ui.settle(60)
    await liveRun(m, 'security', 'errored')
    await m.ui.settle(60)
    const row = railRow(m.ui.lastFrame())
    expect(row).toContain('errored')
    expect(row).not.toContain('passed')
    expect(row).not.toContain('~')
    m.ui.unmount()
    m.queue.close()
  })

  it('drops a read that lands while a run is in flight, and reads again when the job settles', async () => {
    const first = deferred<GateStatus[]>()
    const reads: string[] = []
    const views = fakeViews({
      gates: (skillId) => {
        reads.push(skillId)
        return reads.length === 1 ? first.promise : Promise.resolve([gate('validate')])
      },
    })
    const m = mount(views)
    await waitForFrame(m.ui, () => reads.length === 1)

    // The run starts while the selection's read is still out.
    const run = await liveRun(m, 'security', 'passed', { end: false })
    first.resolve([gate('validate')])
    await m.ui.settle(60)
    // Validate is still empty: the late answer was refused, not applied.
    expect(railRow(m.ui.lastFrame())).toMatch(/·\s+·\s+passed\s+·\s+·/)
    expect(reads).toHaveLength(1)

    run.events.push({ type: 'run:done', runId: 'run-live-1', outcome: 'passed', opened: 0, closed: 0, reopened: 0 })
    run.finish({ runId: 'run-live-1', outcome: 'passed' })
    await waitForFrame(m.ui, (frame) => /passed\s+·\s+passed/.test(railRow(frame)))
    expect(reads).toHaveLength(2)
    expect(railRow(m.ui.lastFrame())).toMatch(/passed\s+·\s+passed\s+·\s+·/)
    m.ui.unmount()
    m.queue.close()
  })

  it('re-reads for the skill whose job settled, not the one selected', async () => {
    const views = fakeViews()
    const other = skillRef('other')
    const m = mount(views, [skillRef('declawed'), other])
    await m.ui.settle(60)
    const before = views.gateReads.length
    m.queue.enqueue([{ skill: other, stages: ['validate'] }])
    await waitForFrame(m.ui, () => m.runs.size === 1)
    const run = [...m.runs.values()][0] as FakeRun
    run.events.push({ type: 'run:start', runId: 'run-live-1', skillId: 'other', stages: ['validate'], runDir: '/r' })
    await m.ui.settle(30)
    run.events.push({ type: 'run:done', runId: 'run-live-1', outcome: 'passed', opened: 0, closed: 0, reopened: 0 })
    run.finish({ runId: 'run-live-1', outcome: 'passed' })
    await waitForFrame(m.ui, () => views.gateReads.length > before)
    expect(views.gateReads.slice(before)).toContain('other')
    m.ui.unmount()
    m.queue.close()
  })

  it('re-reads for a job that failed or was cancelled, not only one that passed', async () => {
    const views = fakeViews()
    const m = mount(views)
    await m.ui.settle(60)
    const before = views.gateReads.length
    m.queue.enqueue([{ skill: skillRef('declawed'), stages: ['validate'] }])
    await waitForFrame(m.ui, () => m.runs.size === 1)
    const run = [...m.runs.values()][0] as FakeRun
    run.fail('tool crashed')
    await waitForFrame(m.ui, () => views.gateReads.length > before)
    expect(views.gateReads.length).toBeGreaterThan(before)
    m.ui.unmount()
    m.queue.close()
  })

  it('names a failed read in the footer rather than leaving the rail unmarked in silence', async () => {
    const views = fakeViews({
      gates: async () => {
        throw new Error('ledger is locked')
      },
    })
    const m = mount(views)
    await waitForFrame(m.ui, (frame) => frame.includes('ledger is locked'))
    expect(m.ui.lastFrame()).toContain('ledger is locked')
    m.ui.unmount()
    m.queue.close()
  })
})

describe('R11.25 applying a suppression re-reads the gates', () => {
  it('marks the rail stale without a relaunch', async () => {
    let bytesMoved = false
    const reads: string[] = []
    const views = fakeViews({
      gates: async (skillId) => {
        reads.push(skillId)
        return [gate('security', { outcome: 'failed', runId: 'run-live-1', current: !bytesMoved })]
      },
    })
    const m = mount(views)
    await m.ui.settle(60)
    await liveRun(m, 'security', 'failed', { findings: [FINDING] })
    await waitForFrame(m.ui, (frame) => railRow(frame).includes('failed'))
    expect(railRow(m.ui.lastFrame())).not.toContain('~')

    m.ui.stdin.send('\t')
    await m.ui.settle()
    m.ui.stdin.send('2')
    await waitForFrame(m.ui, (frame) => frame.includes('unsafe-script'))
    m.ui.stdin.send('s')
    await waitForFrame(m.ui, (frame) => frame.includes('Suppress —'))
    m.ui.stdin.send('\r')
    await waitForFrame(m.ui, (frame) => frame.includes('id: MP2'))
    // `resume` → `gates` → `none`: written, and nothing run afterwards.
    m.ui.stdin.send('t')
    m.ui.stdin.send('t')
    await m.ui.settle()

    const readsBefore = reads.length
    // The write moves the skill's bytes, so the verdict is now recorded against others.
    bytesMoved = true
    m.ui.stdin.send('a')
    await waitForFrame(m.ui, (frame) => railRow(frame).includes('~failed'))

    expect(railRow(m.ui.lastFrame())).toContain('~failed')
    expect(views.suppressResolutions).toEqual(['apply'])
    expect(reads.length).toBeGreaterThan(readsBefore)
    // No relaunch: the only run this session is the one driven above.
    expect(m.runs.size).toBe(1)
    m.ui.unmount()
    m.queue.close()
  })
})

describe('R11.25 `y` on a cell the rail filled', () => {
  const toSecurity = async (ui: InkHarness): Promise<void> => {
    ui.stdin.send('\t')
    await ui.settle()
    ui.stdin.send('l')
    ui.stdin.send('l')
    await ui.settle()
  }

  it('names the fix command for the verdict’s run, and reads nothing under the newest run', async () => {
    const { skill } = await recordedSkill()
    const views = fakeViews({
      gates: async () => [gate('security', { outcome: 'failed', runId: 'run-older-sec' })],
    })
    const m = mount(views, [skill], { columns: 130, rows: 40 })
    await waitForFrame(m.ui, (frame) => railRow(frame).includes('failed'))
    await toSecurity(m.ui)

    m.ui.stdin.send('y')
    await waitForFrame(m.ui, (frame) => frame.includes('skillgantry fix'))
    expect(m.ui.lastFrame()).toContain('skillgantry fix declawed --stage security --run run-older-sec')
    // The newest run holds a prompt for security. Had `y` read it, it would be copied.
    expect(m.ui.frames.join('')).not.toContain(']52;c;')
    expect(m.ui.lastFrame()).not.toContain('copied')
    m.ui.unmount()
    m.queue.close()
  })

  it('says to re-run the stage when the verdict is stale, and names no command', async () => {
    const { skill } = await recordedSkill()
    const views = fakeViews({
      gates: async () => [
        gate('security', { outcome: 'failed', runId: 'run-older-sec', current: false }),
      ],
    })
    const m = mount(views, [skill], { columns: 130, rows: 40 })
    await waitForFrame(m.ui, (frame) => railRow(frame).includes('~failed'))
    await toSecurity(m.ui)

    m.ui.stdin.send('y')
    await waitForFrame(m.ui, (frame) => /re-run|press r/.test(frame))
    expect(m.ui.lastFrame()).toContain('other bytes')
    expect(m.ui.lastFrame()).not.toContain('skillgantry fix')
    expect(m.ui.frames.join('')).not.toContain(']52;c;')
    m.ui.unmount()
    m.queue.close()
  })

  it('does not offer a prompt for a filled pass', async () => {
    const { skill } = await recordedSkill()
    const views = fakeViews({ gates: async () => [gate('security')] })
    const m = mount(views, [skill], { columns: 130, rows: 40 })
    await waitForFrame(m.ui, (frame) => /passed\s+passed/.test(railRow(frame)))
    await toSecurity(m.ui)

    m.ui.stdin.send('y')
    await waitForFrame(m.ui, (frame) => frame.includes('no prompt'))
    expect(m.ui.lastFrame()).toContain('security found nothing — no prompt')
    expect(m.ui.frames.join('')).not.toContain(']52;c;')
    m.ui.unmount()
    m.queue.close()
  })

  it('costs the footer no row', async () => {
    const { skill } = await recordedSkill()
    const views = fakeViews({
      gates: async () => [gate('security', { outcome: 'failed', runId: 'run-older-sec' })],
    })
    const m = mount(views, [skill], { columns: 130, rows: 40 })
    await waitForFrame(m.ui, (frame) => railRow(frame).includes('failed'))
    await toSecurity(m.ui)
    const before = m.ui.lastFrame().split('\n').length
    m.ui.stdin.send('y')
    await waitForFrame(m.ui, (frame) => frame.includes('skillgantry fix'))
    expect(m.ui.lastFrame()).toContain('skillgantry fix')
    expect(m.ui.lastFrame().split('\n').length).toBe(before)
    m.ui.unmount()
    m.queue.close()
  })
})
