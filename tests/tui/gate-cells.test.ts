import { describe, expect, it } from 'vitest'
import type { QueueEvent, RunEvent, StageResult } from '../../src/core/index.js'
import { resumedGates } from '../../src/tui/rows.js'
import { initialState, reducer, type AppState } from '../../src/tui/store.js'
import type { GateStatus, LastRun } from '../../src/tui/views.js'
import { skillRef } from '../helpers/skill-ref.js'

const start = (): AppState => initialState([skillRef('declawed'), skillRef('spec-lint')], 2)
const run = (event: RunEvent): QueueEvent => ({ type: 'run:event', jobId: 'j1', event })
const apply = (state: AppState, ...events: QueueEvent[]): AppState =>
  events.reduce((next, event) => reducer(next, { type: 'queue-event', event }), state)

const gate = (stage: GateStatus['stage'], over: Partial<GateStatus> = {}): GateStatus => ({
  stage,
  outcome: 'passed',
  runId: 'run-old',
  runDir: `/ledger/spelling/${stage}`,
  current: true,
  ...over,
})

const settled = (outcome: StageResult['outcome']): StageResult => ({
  stage: 'security',
  outcome,
  verdict: outcome === 'failed' ? 'failed' : 'passed',
  toolRuns: [],
})

const startRun = (runId: string, runDir = `/w/${runId}`): QueueEvent =>
  run({ type: 'run:start', runId, skillId: 'declawed', stages: ['security'], runDir })

/** A run that ended with `security` settled, the way the session sees one. */
const afterRun = (runId: string, outcome: StageResult['outcome']): AppState =>
  apply(
    start(),
    startRun(runId),
    run({ type: 'stage:start', runId, stage: 'security', toolIds: ['skillspector'] }),
    run({ type: 'stage:done', runId, stage: 'security', outcome, result: settled(outcome) }),
    run({ type: 'run:done', runId, outcome, opened: 0, closed: 0, reopened: 0 }),
  )

const cells = (state: AppState) => state.skills[0]!.stages

describe('set-gates — §14.15', () => {
  it('fills an empty gate cell with the verdict alone, carrying no summary and no count', () => {
    const state = reducer(start(), {
      type: 'set-gates',
      skillId: 'declawed',
      gates: [gate('validate'), gate('evaluate', { outcome: 'failed', runId: 'run-b', current: false })],
    })
    expect(cells(state).validate).toEqual({
      outcome: 'passed',
      running: false,
      // Both belong to a run the panes beside the rail are not showing.
      summary: '',
      findings: 0,
      startedAt: null,
      current: true,
      filledFrom: 'run-old',
    })
    expect(cells(state).evaluate).toMatchObject({
      outcome: 'failed',
      current: false,
      filledFrom: 'run-b',
    })
    // A gate with no verdict, and the two stages that are not gates, stay empty.
    expect(cells(state).security.outcome).toBeNull()
    expect(cells(state).optimise.outcome).toBeNull()
    expect(cells(state).release.outcome).toBeNull()
  })

  it('leaves a gate that never reached a verdict empty', () => {
    const state = reducer(start(), {
      type: 'set-gates',
      skillId: 'declawed',
      gates: [gate('validate', { outcome: null, runId: null, runDir: null, current: false })],
    })
    expect(cells(state).validate.outcome).toBeNull()
    expect(cells(state).validate.filledFrom).toBeUndefined()
  })

  it('keeps the outcome of the run the verdict came from and sets its currency', () => {
    const before = afterRun('run-new', 'passed')
    const kept = cells(before).security
    expect(kept.summary).not.toBe('')
    const state = reducer(before, {
      type: 'set-gates',
      skillId: 'declawed',
      gates: [gate('security', { runId: 'run-new', current: false })],
    })
    expect(cells(state).security).toEqual({ ...kept, current: false })
    // Not a fill: this cell is the newest run's own, so `y` still reads that run.
    expect(cells(state).security.filledFrom).toBeUndefined()
  })

  it('returns the same state when a re-read finds nothing different', () => {
    const gates = [gate('validate'), gate('security', { runId: 'run-new' })]
    const once = reducer(afterRun('run-new', 'passed'), { type: 'set-gates', skillId: 'declawed', gates })
    expect(reducer(once, { type: 'set-gates', skillId: 'declawed', gates })).toBe(once)
  })

  it('matches the cell to the verdict by run id, whatever spelling the ledger gives the directory', () => {
    const state = reducer(afterRun('run-new', 'failed'), {
      type: 'set-gates',
      skillId: 'declawed',
      gates: [gate('security', { outcome: 'failed', runId: 'run-new', runDir: '/elsewhere', current: true })],
    })
    expect(cells(state).security.current).toBe(true)
  })

  it('leaves a newer run’s non-verdict outcome alone, unmarked, over an older pass', () => {
    // The user watched this fail; R9.8 steps over it for the release, and the
    // rail must not put the older pass in its place.
    for (const outcome of ['errored', 'skipped'] as const) {
      const before = afterRun('run-new', outcome)
      const state = reducer(before, {
        type: 'set-gates',
        skillId: 'declawed',
        gates: [gate('security', { runId: 'run-old', current: true })],
      })
      expect(cells(state).security).toEqual(cells(before).security)
      expect(cells(state).security.current).toBeUndefined()
      expect(cells(state).security.filledFrom).toBeUndefined()
    }
  })

  it('fills the gates a recorded run did not execute and keeps the one it did', () => {
    const recorded: LastRun = {
      runId: 'run-eval',
      runDir: '/w/run-eval',
      log: { lines: [], dropped: 0 },
      stages: [{ stage: 'evaluate', outcome: 'passed', summary: '12/12 cases', findings: [] }],
    }
    const before = reducer(start(), { type: 'set-last-run', skillId: 'declawed', run: recorded })
    const state = reducer(before, {
      type: 'set-gates',
      skillId: 'declawed',
      gates: [
        gate('validate', { runId: 'run-v' }),
        gate('evaluate', { runId: 'run-eval' }),
        gate('security', { runId: 'run-s', outcome: 'failed' }),
      ],
    })
    expect(cells(state).validate).toMatchObject({ outcome: 'passed', filledFrom: 'run-v' })
    expect(cells(state).evaluate).toMatchObject({ outcome: 'passed', summary: '12/12 cases', current: true })
    expect(cells(state).evaluate.filledFrom).toBeUndefined()
    expect(cells(state).security).toMatchObject({ outcome: 'failed', filledFrom: 'run-s' })
  })

  it('is dropped for a row with a run in flight, and for no other row', () => {
    const live = apply(start(), startRun('run-live'))
    const dropped = reducer(live, { type: 'set-gates', skillId: 'declawed', gates: [gate('validate')] })
    expect(dropped).toBe(live)

    // The other skill has nothing in flight, so it still takes the fill.
    const other = reducer(live, { type: 'set-gates', skillId: 'spec-lint', gates: [gate('validate')] })
    expect(other.skills[1]?.stages.validate.outcome).toBe('passed')
  })

  it('never touches a cell that is running', () => {
    // A cancelled run can end with its stage still marked running; whatever the
    // ledger says about that stage is about an older run.
    const state = apply(
      start(),
      startRun('run-live'),
      run({ type: 'stage:start', runId: 'run-live', stage: 'security', toolIds: ['skillspector'] }),
      run({ type: 'run:cancelled', runId: 'run-live', phase: 'running', reason: 'user' }),
    )
    const after = reducer(state, { type: 'set-gates', skillId: 'declawed', gates: [gate('security')] })
    expect(cells(after).security).toEqual(cells(state).security)
    expect(cells(after).security.running).toBe(true)
  })

  it('refreshes a cell it filled earlier when the bytes move', () => {
    const filled = reducer(start(), { type: 'set-gates', skillId: 'declawed', gates: [gate('validate')] })
    expect(cells(filled).validate.current).toBe(true)
    const edited = reducer(filled, {
      type: 'set-gates',
      skillId: 'declawed',
      gates: [gate('validate', { current: false })],
    })
    expect(cells(edited).validate).toMatchObject({ outcome: 'passed', current: false })
  })

  it('lands on the row it names, not on the selected one', () => {
    const state = reducer(start(), { type: 'set-gates', skillId: 'spec-lint', gates: [gate('validate')] })
    expect(state.skills[0]?.stages.validate.outcome).toBeNull()
    expect(state.skills[1]?.stages.validate.outcome).toBe('passed')
  })
})

describe('a new run clears what set-gates wrote', () => {
  it('starts from empty cells, so a fill never outlives the run that replaces it', () => {
    const filled = reducer(start(), { type: 'set-gates', skillId: 'declawed', gates: [gate('validate')] })
    const next = apply(filled, startRun('run-next'))
    expect(cells(next).validate).toMatchObject({ outcome: null })
    expect(cells(next).validate.filledFrom).toBeUndefined()
    expect(cells(next).validate.current).toBeUndefined()
  })
})

describe('resumedGates counts a stale cell as not passed', () => {
  it('returns the chain from the first stale gate', () => {
    const state = reducer(start(), {
      type: 'set-gates',
      skillId: 'declawed',
      gates: [
        gate('validate'),
        gate('evaluate', { runId: 'run-e', current: false }),
        gate('security', { runId: 'run-s' }),
      ],
    })
    // security is current, but R5.1 halts the chain at evaluate.
    expect(resumedGates(cells(state))).toEqual(['evaluate', 'security'])
  })

  it('is empty only when every gate passed against the current bytes', () => {
    const state = reducer(start(), {
      type: 'set-gates',
      skillId: 'declawed',
      gates: [gate('validate'), gate('evaluate'), gate('security')],
    })
    expect(resumedGates(cells(state))).toEqual([])
  })
})
