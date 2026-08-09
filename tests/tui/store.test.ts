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

describe('the report a settled queue leaves in the footer', () => {
  const job = (id: string, skillId: string) => ({
    jobId: id,
    skillId,
    stages: ['security'] as const,
    state: 'queued' as const,
    runId: null,
    outcome: null,
    error: null,
    enqueuedAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    endedAt: null,
  })
  const ran = (id: string, skillId: string) => ({
    ...job(id, skillId),
    runId: 'r1',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:01:54.000Z',
  })

  it('names the verdict, what it cost, and where the evidence is', () => {
    const one = job('j1', 'declawed')
    const state = feed([
      { type: 'job:queued', job: one },
      { type: 'job:started', job: { ...one, state: 'running' } },
      run({
        type: 'run:start',
        runId: 'r1',
        skillId: 'declawed',
        stages: ['security'],
        runDir: '/w/declawed-workspace/runs/r1',
      }),
      run({ type: 'stage:done', runId: 'r1', stage: 'security', outcome: 'failed', result: stageResult }),
      { type: 'job:done', job: { ...ran('j1', 'declawed'), state: 'failed', outcome: 'failed' } },
    ])
    expect(state.flash).toBe(
      'declawed security failed · 1m 54s · 1 finding · /w/declawed-workspace/runs/r1',
    )
    expect(state.flashTone).toBe('bad')
  })

  it('tallies a batch instead of reporting the last job of it', () => {
    const a = job('j1', 'declawed')
    const b = job('j2', 'spec-lint')
    const state = feed([
      { type: 'job:queued', job: a },
      { type: 'job:queued', job: b },
      { type: 'job:started', job: { ...a, state: 'running' } },
      { type: 'job:done', job: { ...ran('j1', 'declawed'), state: 'done', outcome: 'passed' } },
      { type: 'job:started', job: { ...b, state: 'running' } },
      { type: 'job:done', job: { ...ran('j2', 'spec-lint'), state: 'done', outcome: 'failed' } },
    ])
    // Worst first, and counted by verdict: a run whose stage failed still ends
    // as job state `done`, so a tally over the state would say `2 passed`.
    expect(state.flash).toBe('2 jobs · 1 failed, 1 passed')
    expect(state.flashTone).toBe('bad')
  })

  it('stays quiet while any job is still queued or running', () => {
    const a = job('j1', 'declawed')
    const b = job('j2', 'spec-lint')
    const state = feed([
      { type: 'job:queued', job: a },
      { type: 'job:queued', job: b },
      { type: 'job:started', job: { ...a, state: 'running' } },
      { type: 'job:done', job: { ...ran('j1', 'declawed'), state: 'done', outcome: 'passed' } },
    ])
    expect(state.flash).toBeNull()
  })

  it('does not raise itself again on a later record for an already-finished job', () => {
    const one = job('j1', 'declawed')
    const settled = feed([
      { type: 'job:queued', job: one },
      { type: 'job:started', job: { ...one, state: 'running' } },
      { type: 'job:done', job: { ...ran('j1', 'declawed'), state: 'done', outcome: 'passed' } },
    ])
    const dismissed = reducer(settled, { type: 'clear-flash' })
    const again = reducer(dismissed, {
      type: 'queue-event',
      event: { type: 'job:done', job: { ...ran('j1', 'declawed'), state: 'done', outcome: 'passed' } },
    })
    expect(again.flash).toBeNull()
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
      surface: 'screen',
    })
    state = reducer(state, { type: 'select-issue', delta: 9 })
    expect(state.selectedIssue).toBe(1)
  })

  it('drops a stale selection when a filter shortens the list', () => {
    let state = reducer(initialState([], 2), {
      type: 'set-issues',
      rows: [{ fingerprint: 'a' }, { fingerprint: 'b' }] as never,
      surface: 'screen',
    })
    state = reducer(state, { type: 'select-issue', delta: 1 })
    state = reducer(state, {
      type: 'set-issues',
      rows: [{ fingerprint: 'a' }] as never,
      surface: 'screen',
    })
    expect(state.selectedIssue).toBe(0)
  })

  // R11.13, rev 15: one row set, two cursors. A response the tab asked for must
  // leave the screen's cursor where the user left it, and the reverse.
  it('clamps only the cursor of the surface that asked', () => {
    const two = [{ fingerprint: 'a' }, { fingerprint: 'b' }] as never
    let state = reducer(initialState([], 2), { type: 'set-issues', rows: two, surface: 'screen' })
    state = reducer(state, { type: 'select-issue', delta: 1 })
    state = reducer(state, { type: 'select-tab-issue', delta: 1 })
    expect([state.selectedIssue, state.selectedTabIssue]).toEqual([1, 1])

    state = reducer(state, {
      type: 'set-issues',
      rows: [{ fingerprint: 'a' }] as never,
      surface: 'tab',
    })
    expect(state.selectedTabIssue).toBe(0)
    expect(state.selectedIssue).toBe(1)
  })

  it('moves the tab cursor without moving the screen cursor', () => {
    const two = [{ fingerprint: 'a' }, { fingerprint: 'b' }] as never
    let state = reducer(initialState([], 2), { type: 'set-issues', rows: two, surface: 'tab' })
    state = reducer(state, { type: 'select-tab-issue', delta: 1 })
    expect(state.selectedTabIssue).toBe(1)
    expect(state.selectedIssue).toBe(0)
    // The window follows the cursor, so a pinned offset would fight it.
    expect(state.outputOffset).toBeNull()
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

describe('output pane scrolling', () => {
  const base = (): AppState => ({
    ...initialState([skill('alpha')], 1),
    focus: 'output',
    artefacts: Array.from({ length: 40 }, (_, index) => `run/artefact-${index}.json`),
    panel: 'artefacts',
  })

  /** 10 rows of pane, one spent on the overflow notice, so 9 rows of list. */
  const scroll = (state: AppState, delta: number): AppState =>
    reducer(state, { type: 'scroll-output', delta, viewport: 9, total: 40, anchor: 'top' })

  it('starts at the anchor and moves one row per press', () => {
    expect(base().outputOffset).toBeNull()
    expect(scroll(base(), 1).outputOffset).toBe(1)
  })

  it('clamps to the last full window rather than to the last row', () => {
    let state = base()
    for (let i = 0; i < 80; i += 1) state = scroll(state, 1)
    // 40 rows, 9 visible: the last window starts at 31 and is still full.
    expect(state.outputOffset).toBe(31)
  })

  it('resumes following when a scrolled log reaches its newest line again', () => {
    const log = {
      ...base(),
      panel: 'log' as const,
      log: { lines: Array.from({ length: 40 }, (_, index) => `line ${index}`), dropped: 0 },
    }
    const action = { type: 'scroll-output' as const, viewport: 9, total: 40, anchor: 'bottom' as const }
    // Back one row from the tail is a pin; forward again is not.
    const pinned = reducer(log, { ...action, delta: -1 })
    expect(pinned.outputOffset).toBe(30)
    expect(reducer(pinned, { ...action, delta: 1 }).outputOffset).toBeNull()
  })

  it('drops the offset when the tab or the skill changes', () => {
    const scrolled = scroll(base(), 5)
    expect(scrolled.outputOffset).toBe(5)
    expect(reducer(scrolled, { type: 'set-panel', panel: 'findings' }).outputOffset).toBeNull()
    expect(reducer(scrolled, { type: 'select-skill', delta: 1 }).outputOffset).toBeNull()
  })
})

describe('set-last-run — R11.10', () => {
  const recorded = {
    runId: 'run-b',
    runDir: '/w/run-b',
    log: { lines: ['skillspector │ recorded line'], dropped: 3 },
    stages: [
      {
        stage: 'security' as const,
        outcome: 'failed' as const,
        summary: '1 finding',
        findings: toolRun.findings,
      },
    ],
  }

  it('fills an untouched row from the recorded run', () => {
    const state = reducer(start(), { type: 'set-last-run', skillId: 'declawed', run: recorded })
    expect(state.skills[0]).toMatchObject({ runDir: '/w/run-b', activeRunId: null })
    expect(state.skills[0]?.stages.security).toEqual({
      outcome: 'failed',
      running: false,
      summary: '1 finding',
      findings: 1,
      // A recorded run's per-stage start is not in `index.ndjson`, so the rail
      // has no clock to run for it and inventing one would count from a time
      // nothing recorded.
      startedAt: null,
    })
    expect(state.skills[0]?.findings).toEqual(toolRun.findings)
    // Only the stage the run executed; the other four stay `·`.
    expect(state.skills[0]?.stages.validate.outcome).toBeNull()
    // `set-statuses` owns the glyph, from the same index.
    expect(state.skills[0]?.status).toBe('idle')
  })

  it('holds the recorded log on the row rather than in the session buffer', () => {
    const state = reducer(start(), { type: 'set-last-run', skillId: 'declawed', run: recorded })
    expect(state.skills[0]?.rehydrated).toBe(true)
    expect(state.skills[0]?.recordedLog).toEqual({
      lines: ['skillspector │ recorded line'],
      dropped: 3,
    })
    // R11.4's buffer is untouched, which is what stops one skill's recorded
    // output appearing under another skill that is running.
    expect(state.log).toEqual({ lines: [], dropped: 0 })
  })

  it('hands the pane back to the live buffer when a run starts', () => {
    const rehydrated = reducer(start(), {
      type: 'set-last-run',
      skillId: 'declawed',
      run: recorded,
    })
    const live = reducer(rehydrated, {
      type: 'queue-event',
      event: run({
        type: 'run:start',
        runId: 'r1',
        skillId: 'declawed',
        stages: ['security'],
        runDir: '/w/r1',
      }),
    })
    expect(live.skills[0]?.rehydrated).toBe(false)
    expect(live.skills[0]?.recordedLog).toEqual({ lines: [], dropped: 0 })
  })

  it('leaves other skills alone', () => {
    const state = reducer(start(), { type: 'set-last-run', skillId: 'declawed', run: recorded })
    expect(state.skills[1]?.runDir).toBeNull()
  })

  it('refuses a row with a live run, however late the read resolves', () => {
    const live = feed([
      run({
        type: 'run:start',
        runId: 'r1',
        skillId: 'declawed',
        stages: ['security'],
        runDir: '/w/r1',
      }),
    ])
    const state = reducer(live, { type: 'set-last-run', skillId: 'declawed', run: recorded })
    expect(state.skills[0]).toMatchObject({ runDir: '/w/r1', activeRunId: 'r1' })
  })

  it('refuses a row whose run this session has already finished', () => {
    const finished = feed([
      run({
        type: 'run:start',
        runId: 'r1',
        skillId: 'declawed',
        stages: ['security'],
        runDir: '/w/r1',
      }),
      run({ type: 'run:done', runId: 'r1', outcome: 'passed', opened: 0, closed: 0 }),
    ])
    // activeRunId is back to null, so `runDir` is what still says "this session".
    expect(finished.skills[0]?.activeRunId).toBeNull()
    const state = reducer(finished, { type: 'set-last-run', skillId: 'declawed', run: recorded })
    expect(state.skills[0]?.runDir).toBe('/w/r1')
  })
})
