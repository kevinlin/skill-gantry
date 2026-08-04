import { describe, expect, it } from 'vitest'
import type {
  QueueEvent,
  RunEvent,
  SkillRef,
  StageResult,
  ToolRunRecord,
} from '../../src/core/index.js'
import {
  initialState,
  paletteMatches,
  reducer,
  selectedSkill,
  type AppState,
} from '../../src/tui/store.js'
import { emptySettings } from '../helpers/fake-views.js'

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

const SKILLS = [skill('declawed'), skill('spec-lint')]
const start = (): ReturnType<typeof initialState> => initialState(SKILLS, 2)

const run = (event: RunEvent): QueueEvent => ({ type: 'run:event', jobId: 'j1', event })

const toolRun: ToolRunRecord = {
  toolId: 'skillspector',
  toolVersion: '2.3.7',
  outcome: 'failed',
  exitCode: 0,
  durationMs: 10,
  errorKind: null,
  artefactDir: '/x',
  findings: [
    {
      ruleClass: 'prompt-injection',
      nativeRuleId: 'PI1',
      severity: 'high',
      path: 'declawed/SKILL.md',
      message: 'suspicious instruction',
    },
  ],
  metrics: { findingsTotal: 1 },
  summary: '1 finding',
}

const stageResult: StageResult = {
  stage: 'security',
  outcome: 'failed',
  verdict: 'failed',
  toolRuns: [toolRun],
}

const feed = (events: QueueEvent[]): ReturnType<typeof initialState> =>
  events.reduce((state, event) => reducer(state, { type: 'queue-event', event }), start())

describe('run events', () => {
  it('marks the skill running and clears the previous run', () => {
    const state = feed([
      run({
        type: 'run:start',
        runId: 'r1',
        skillId: 'declawed',
        stages: ['security'],
        runDir: '/w/r1',
      }),
    ])
    expect(state.skills[0]).toMatchObject({ status: 'running', activeRunId: 'r1', runDir: '/w/r1' })
    expect(state.skills[1]?.status).toBe('idle')
  })

  it('fills the lifecycle rail as stages report', () => {
    const state = feed([
      run({
        type: 'run:start',
        runId: 'r1',
        skillId: 'declawed',
        stages: ['security'],
        runDir: '/w/r1',
      }),
      run({ type: 'stage:start', runId: 'r1', stage: 'security', toolIds: ['skillspector'] }),
      run({
        type: 'tool:done',
        runId: 'r1',
        stage: 'security',
        toolId: 'skillspector',
        result: toolRun,
      }),
      run({ type: 'stage:done', runId: 'r1', stage: 'security', outcome: 'failed', result: stageResult }),
    ])
    expect(state.skills[0]?.stages.security).toMatchObject({
      outcome: 'failed',
      running: false,
      summary: '1 finding',
    })
    expect(state.skills[0]?.findings).toHaveLength(1)
  })

  it('settles the status when the run ends', () => {
    const state = feed([
      run({
        type: 'run:start',
        runId: 'r1',
        skillId: 'declawed',
        stages: ['security'],
        runDir: '/w/r1',
      }),
      run({ type: 'run:done', runId: 'r1', outcome: 'failed', opened: 1, closed: 0, reopened: 0 }),
    ])
    expect(state.skills[0]).toMatchObject({ status: 'failed', activeRunId: null })
  })

  it('shows a cancelled run as errored', () => {
    const state = feed([
      run({
        type: 'run:start',
        runId: 'r1',
        skillId: 'declawed',
        stages: ['security'],
        runDir: '/w/r1',
      }),
      run({ type: 'run:cancelled', runId: 'r1', phase: 'running', reason: 'user' }),
    ])
    expect(state.skills[0]).toMatchObject({ status: 'errored', activeRunId: null })
  })

  it('ignores an event for a run it never saw start', () => {
    const before = start()
    const after = reducer(before, {
      type: 'queue-event',
      event: run({
        type: 'stage:done',
        runId: 'ghost',
        stage: 'security',
        outcome: 'passed',
        result: stageResult,
      }),
    })
    expect(after).toBe(before)
  })

  it('never takes log text into state — R11.4', () => {
    const before = feed([
      run({
        type: 'run:start',
        runId: 'r1',
        skillId: 'declawed',
        stages: ['security'],
        runDir: '/w/r1',
      }),
    ])
    const after = reducer(before, {
      type: 'queue-event',
      event: run({
        type: 'tool:output',
        runId: 'r1',
        stage: 'security',
        toolId: 'skillspector',
        stream: 'stdout',
        chunk: 'scanning…\n',
      }),
    })
    expect(after).toBe(before)
  })
})

describe('job events', () => {
  it('tracks a job through its states without duplicating it', () => {
    const job = {
      jobId: 'j1',
      skillId: 'declawed',
      stages: ['security'] as const,
      state: 'queued' as const,
      runId: null,
      outcome: null,
      error: null,
      enqueuedAt: 'now',
      startedAt: null,
      endedAt: null,
    }
    const state = feed([
      { type: 'job:queued', job },
      { type: 'job:started', job: { ...job, state: 'running' } },
      { type: 'job:done', job: { ...job, state: 'done', outcome: 'passed', runId: 'r1' } },
    ])
    expect(state.jobs).toHaveLength(1)
    expect(state.jobs[0]).toMatchObject({ state: 'done', outcome: 'passed' })
  })
})

describe('navigation', () => {
  it('moves the skill cursor without running off either end', () => {
    let state = reducer(start(), { type: 'select-skill', delta: 1 })
    expect(state.selectedSkill).toBe(1)
    state = reducer(state, { type: 'select-skill', delta: 5 })
    expect(state.selectedSkill).toBe(1)
    state = reducer(state, { type: 'select-skill', delta: -9 })
    expect(state.selectedSkill).toBe(0)
    expect(selectedSkill(state)?.skillId).toBe('declawed')
  })

  it('cycles the output panel', () => {
    let state = reducer(start(), { type: 'cycle-panel', delta: 1 })
    expect(state.panel).toBe('findings')
    state = reducer(state, { type: 'cycle-panel', delta: -1 })
    expect(state.panel).toBe('log')
    state = reducer(state, { type: 'set-panel', panel: 'skill' })
    expect(state.panel).toBe('skill')
  })

  it('marks skills and stages for a batch — R5.5', () => {
    let state = reducer(start(), { type: 'toggle-skill-mark' })
    state = reducer(state, { type: 'select-skill', delta: 1 })
    state = reducer(state, { type: 'toggle-skill-mark' })
    expect(state.markedSkills).toEqual(['declawed', 'spec-lint'])

    state = reducer(state, { type: 'select-stage', delta: 2 })
    state = reducer(state, { type: 'toggle-stage-mark' })
    expect(state.markedStages).toEqual(['security'])

    state = reducer(state, { type: 'toggle-skill-mark' })
    expect(state.markedSkills).toEqual(['declawed'])
  })

  it('stores a flushed log window without inspecting it', () => {
    const state = reducer(start(), { type: 'log-flush', lines: ['a', 'b'], dropped: 7 })
    expect(state.log).toEqual({ lines: ['a', 'b'], dropped: 7 })
  })
})

describe('screens and the palette — R11.3', () => {
  it('starts on Work', () => {
    expect(initialState([], 2).screen).toBe('work')
  })

  it('switches screen', () => {
    const state = reducer(initialState([], 2), { type: 'set-screen', screen: 'issues' })
    expect(state.screen).toBe('issues')
  })

  it('filters the command list as the user types, and clamps the selection', () => {
    let state = reducer(initialState([], 2), { type: 'palette-open' })
    expect(state.palette.open).toBe(true)
    state = reducer(state, { type: 'palette-input', query: 'iss' })
    expect(paletteMatches(state.palette.query).map((command) => command.id)).toEqual(['issues'])
    state = reducer(state, { type: 'palette-move', delta: 5 })
    expect(state.palette.selected).toBe(0)
  })

  it('resets the query when it closes, so the next `:` starts clean', () => {
    let state = reducer(initialState([], 2), { type: 'palette-open' })
    state = reducer(state, { type: 'palette-input', query: 'set' })
    state = reducer(state, { type: 'palette-close' })
    expect(state.palette).toEqual({ open: false, query: '', selected: 0 })
  })

  it('clamps the issue selection to the rows it was given', () => {
    let state = reducer(initialState([], 2), {
      type: 'set-issues',
      rows: [{ fingerprint: 'a' }, { fingerprint: 'b' }] as never,
    })
    state = reducer(state, { type: 'select-issue', delta: 9 })
    expect(state.selectedIssue).toBe(1)
  })

  it('drops a stale selection when a filter shortens the list', () => {
    let state = reducer(initialState([], 2), {
      type: 'set-issues',
      rows: [{ fingerprint: 'a' }, { fingerprint: 'b' }] as never,
    })
    state = reducer(state, { type: 'select-issue', delta: 1 })
    state = reducer(state, { type: 'set-issues', rows: [{ fingerprint: 'a' }] as never })
    expect(state.selectedIssue).toBe(0)
  })

  it('resets the scroll offset when the screen changes', () => {
    let state = reducer(initialState([], 2), { type: 'set-screen-row-count', count: 40 })
    state = reducer(state, { type: 'scroll-screen', delta: 5, viewport: 4 })
    expect(state.screenOffset).toBe(5)
    state = reducer(state, { type: 'set-screen', screen: 'tools' })
    expect(state.screenOffset).toBe(0)
  })

  it('clamps the scroll to the last full window, not to the last row', () => {
    let state = reducer(initialState([], 2), { type: 'set-screen-row-count', count: 10 })
    state = reducer(state, { type: 'scroll-screen', delta: 99, viewport: 4 })
    expect(state.screenOffset).toBe(6)
  })
})

describe('config staging', () => {
  const loaded = { ...emptySettings }
  const withSettings = (): AppState =>
    reducer(initialState([], 2), { type: 'set-settings', view: loaded })

  it('stages a scalar edit without touching the loaded view', () => {
    let state = reducer(withSettings(), {
      type: 'begin-edit',
      field: 'concurrency',
      current: '2',
    })
    state = reducer(state, { type: 'edit-input', buffer: '4' })
    state = reducer(state, { type: 'stage-edit' })

    expect(state.staged?.concurrency).toBe(4)
    expect(state.settings?.config.concurrency).toBe(2)
    expect(state.editing).toBeNull()
  })

  it('keeps the editor open and names the error when the value is invalid', () => {
    let state = reducer(withSettings(), { type: 'begin-edit', field: 'concurrency', current: '2' })
    state = reducer(state, { type: 'edit-input', buffer: '99' })
    state = reducer(state, { type: 'stage-edit' })

    expect(state.staged).toBeNull()
    expect(state.editing?.error).toMatch(/concurrency/)
  })

  it('stages a second edit on top of the first', () => {
    let state = reducer(withSettings(), { type: 'begin-edit', field: 'concurrency', current: '2' })
    state = reducer(state, { type: 'edit-input', buffer: '4' })
    state = reducer(state, { type: 'stage-edit' })
    state = reducer(state, {
      type: 'begin-edit',
      field: 'mutationTimeoutMs',
      current: '300000',
    })
    state = reducer(state, { type: 'edit-input', buffer: '60000' })
    state = reducer(state, { type: 'stage-edit' })

    expect(state.staged?.concurrency).toBe(4)
    expect(state.staged?.mutationTimeoutMs).toBe(60000)
  })

  it('drops every staged edit on discard', () => {
    let state = reducer(withSettings(), { type: 'begin-edit', field: 'concurrency', current: '2' })
    state = reducer(state, { type: 'edit-input', buffer: '4' })
    state = reducer(state, { type: 'stage-edit' })
    expect(reducer(state, { type: 'discard-staged' }).staged).toBeNull()
  })
})
