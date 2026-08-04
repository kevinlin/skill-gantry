import {
  STAGE_ORDER,
  hasAdapter,
  withRepo,
  withScalar,
  withStageTools,
  withoutRepo,
  type DashboardStats,
  type DoctorReport,
  type GantryConfig,
  type ScalarField,
  type IssueFilter,
  type IssueRow,
  type JobRecord,
  type ProvenanceOption,
  type QueueEvent,
  type RawFinding,
  type RunEvent,
  type SkillRef,
  type Stage,
  type StageOutcome,
  type StatsFilter,
} from '../core/index.js'
import type { SettingsView } from './views.js'

export const PANELS = ['log', 'findings', 'artefacts', 'skill'] as const
export type Panel = (typeof PANELS)[number]

export const SCREENS = ['work', 'dashboard', 'issues', 'tools', 'settings'] as const
export type Screen = (typeof SCREENS)[number]

export interface PaletteCommand {
  id: string
  label: string
  action: { kind: 'screen'; screen: Screen } | { kind: 'quit' } | { kind: 'refresh' }
}

export const PALETTE_COMMANDS: readonly PaletteCommand[] = [
  ...SCREENS.map((screen) => ({
    id: screen,
    label: `go to ${screen}`,
    action: { kind: 'screen' as const, screen },
  })),
  { id: 'refresh', label: 'reload this screen from the ledger', action: { kind: 'refresh' } },
  { id: 'quit', label: 'quit SkillGantry', action: { kind: 'quit' } },
]

/** Substring on id or label, so `:iss` and `:go to iss` both find Issues. */
export const paletteMatches = (query: string): PaletteCommand[] => {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return [...PALETTE_COMMANDS]
  return PALETTE_COMMANDS.filter(
    (command) => command.id.includes(needle) || command.label.toLowerCase().includes(needle),
  )
}

export const FOCUSES = ['skills', 'stages', 'queue'] as const
export type Focus = (typeof FOCUSES)[number]

export type SkillStatus = 'idle' | 'running' | 'passed' | 'failed' | 'errored'

export interface StageCell {
  outcome: StageOutcome | null
  running: boolean
  summary: string
}

export interface SkillRow {
  skillId: string
  label: string
  dir: string
  workspacePath: string
  status: SkillStatus
  activeRunId: string | null
  runDir: string | null
  stages: Record<Stage, StageCell>
  findings: RawFinding[]
}

export interface PendingReview {
  jobId: string
  runId: string
  stage: Stage
  requestId: string
  diff: string
  scope: readonly string[]
  /** First visible diff line, moved by `scroll-review`. */
  offset: number
}

export interface AppState {
  skills: SkillRow[]
  selectedSkill: number
  selectedStage: number
  selectedJob: number
  markedSkills: string[]
  markedStages: Stage[]
  jobs: JobRecord[]
  focus: Focus
  panel: Panel
  concurrency: number
  /** runId -> skillId. Only run:start names its skill. */
  runIndex: Record<string, string>
  log: { lines: readonly string[]; dropped: number }
  skillMd: string
  artefacts: string[]
  /** `?` replaces the whole screen; the footer carries only five keys. */
  help: boolean
  /**
   * The diff awaiting an answer. It lives in state, unlike log text: a change
   * set is one bounded document, and R11.4 is about a stream that never stops.
   */
  pending: PendingReview | null
  /**
   * How many `mutation:pending` events overwrote the slot while a *different*
   * request was still in it. `pending` is a single slot, but that is not the
   * reachable cause of a displacement: `pool.ts` admits one mutating job at a
   * time and `run.ts` serialises two pendings inside one job, so a non-zero
   * count means the previous request was never cleared — a stale slot the store
   * missed the resolution for. It resets whenever the slot empties, so it counts
   * displacements against the review on screen rather than the whole session.
   */
  displacedReviews: number
  screen: Screen
  palette: { open: boolean; query: string; selected: number }
  /**
   * Ledger-backed views. `null` means "not loaded yet", which the screens show
   * as a loading row — distinct from an empty result, which is a real answer
   * and reads as "no runs recorded".
   */
  dashboard: DashboardStats | null
  provenances: ProvenanceOption[]
  statsFilter: StatsFilter
  issues: IssueRow[]
  issueFilter: IssueFilter
  selectedIssue: number
  tools: DoctorReport | null
  settings: SettingsView | null
  /**
   * The edited document, or null when nothing is staged. R11.8: an edit reaches
   * disk only through a confirmed change set, so the screen renders this and the
   * loaded `settings.config` stays the thing the change list is computed against.
   */
  staged: GantryConfig | null
  /** Index into the settings screen's actionable rows, which alone take it. */
  settingsCursor: number
  /**
   * The open value editor: what is being typed, the value it replaces, and why
   * the last attempt was refused. The buffer starts empty rather than seeded
   * with the current value — a seeded buffer makes the first keystroke append,
   * so typing `4` over a `2` stages 24.
   */
  editing: { field: ScalarField; current: string; buffer: string; error: string | null } | null
  /** The change set is on screen, awaiting the keystroke that writes it. */
  confirm: boolean
  /** First visible body row on a row-list screen, moved by `scroll-screen`. */
  screenOffset: number
  /**
   * Body rows the current screen built. The reducer cannot compute it — the row
   * count depends on the terminal width, which only the component knows — and
   * clamping a scroll against a stale count is what let `j` at the bottom of a
   * list walk the offset into the hundreds.
   */
  screenRowCount: number
  /** Set when the port rejected; cleared by the next successful load. */
  viewError: string | null
  /** Bumped by `refresh`, watched by the loading effect. */
  reloads: number
}

export type Action =
  | { type: 'queue-event'; event: QueueEvent }
  | { type: 'log-flush'; lines: readonly string[]; dropped: number }
  | { type: 'select-skill'; delta: number }
  | { type: 'select-stage'; delta: number }
  | { type: 'select-job'; delta: number }
  | { type: 'toggle-skill-mark' }
  | { type: 'toggle-stage-mark' }
  | { type: 'clear-marks' }
  | { type: 'set-focus'; focus: Focus }
  | { type: 'cycle-focus'; delta: number }
  | { type: 'set-panel'; panel: Panel }
  | { type: 'cycle-panel'; delta: number }
  | { type: 'set-skill-md'; body: string }
  | { type: 'set-artefacts'; paths: string[] }
  | { type: 'set-statuses'; statuses: Record<string, string> }
  | { type: 'toggle-help'; open?: boolean }
  /** `viewport` is the diff rows the pane can show, so the clamp leaves a full
      window at the bottom rather than a single line. */
  | { type: 'scroll-review'; delta: number; viewport: number }
  | { type: 'set-screen'; screen: Screen }
  | { type: 'palette-open' }
  | { type: 'palette-input'; query: string }
  | { type: 'palette-move'; delta: number }
  | { type: 'palette-close' }
  | { type: 'set-dashboard'; stats: DashboardStats }
  | { type: 'set-provenances'; options: ProvenanceOption[] }
  | { type: 'set-stats-filter'; filter: StatsFilter }
  | { type: 'set-issues'; rows: IssueRow[] }
  | { type: 'select-issue'; delta: number }
  | { type: 'set-issue-filter'; filter: IssueFilter }
  | { type: 'set-tools'; report: DoctorReport }
  | { type: 'set-settings'; view: SettingsView }
  | { type: 'settings-cursor'; delta: number; count: number }
  | { type: 'begin-edit'; field: ScalarField; current: string }
  | { type: 'edit-input'; buffer: string }
  | { type: 'stage-edit' }
  | { type: 'cancel-edit' }
  | { type: 'stage-remove-repo'; repoId: string }
  | { type: 'stage-selection'; selected: readonly string[] }
  | { type: 'stage-repo'; entry: { path: string; isGit: boolean } }
  | { type: 'open-confirm' }
  | { type: 'close-confirm' }
  | { type: 'discard-staged' }
  | { type: 'set-screen-row-count'; count: number }
  | { type: 'scroll-screen'; delta: number; viewport: number }
  | { type: 'refresh-views' }
  | { type: 'view-error'; message: string }

const emptyStages = (): Record<Stage, StageCell> =>
  Object.fromEntries(
    STAGE_ORDER.map((stage) => [stage, { outcome: null, running: false, summary: '' }]),
  ) as Record<Stage, StageCell>

const toRow = (skill: SkillRef): SkillRow => ({
  skillId: skill.id,
  label: skill.name ?? skill.id,
  dir: skill.dir,
  workspacePath: skill.workspacePath,
  status: 'idle',
  activeRunId: null,
  runDir: null,
  stages: emptyStages(),
  findings: [],
})

export function initialState(skills: readonly SkillRef[], concurrency: number): AppState {
  return {
    skills: skills.map(toRow),
    selectedSkill: 0,
    selectedStage: 0,
    selectedJob: 0,
    markedSkills: [],
    markedStages: [],
    jobs: [],
    focus: 'skills',
    panel: 'log',
    concurrency,
    runIndex: {},
    log: { lines: [], dropped: 0 },
    skillMd: '',
    artefacts: [],
    help: false,
    pending: null,
    displacedReviews: 0,
    screen: 'work',
    palette: { open: false, query: '', selected: 0 },
    dashboard: null,
    provenances: [],
    statsFilter: {},
    issues: [],
    issueFilter: {},
    selectedIssue: 0,
    tools: null,
    settings: null,
    staged: null,
    settingsCursor: 0,
    editing: null,
    confirm: false,
    screenOffset: 0,
    screenRowCount: 0,
    viewError: null,
    reloads: 0,
  }
}

export const selectedSkill = (state: AppState): SkillRow | undefined =>
  state.skills[state.selectedSkill]

const clamp = (value: number, length: number): number =>
  length === 0 ? 0 : Math.min(Math.max(value, 0), length - 1)

const cycle = (values: readonly string[], current: string, delta: number): number =>
  (values.indexOf(current) + delta + values.length) % values.length

const toggle = <T>(list: readonly T[], value: T): T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

const statusOf = (outcome: StageOutcome): SkillStatus =>
  outcome === 'passed' ? 'passed' : outcome === 'failed' ? 'failed' : 'errored'

function withSkill(state: AppState, skillId: string, update: (row: SkillRow) => SkillRow): AppState {
  const index = state.skills.findIndex((row) => row.skillId === skillId)
  if (index === -1) return state
  const skills = [...state.skills]
  skills[index] = update(skills[index] as SkillRow)
  return { ...state, skills }
}

const withStage = (row: SkillRow, stage: Stage, patch: Partial<StageCell>): SkillRow => ({
  ...row,
  stages: { ...row.stages, [stage]: { ...row.stages[stage], ...patch } },
})

function onRunEvent(state: AppState, jobId: string, event: RunEvent): AppState {
  if (event.type === 'run:start') {
    const next = withSkill(state, event.skillId, (row) => ({
      ...row,
      status: 'running',
      activeRunId: event.runId,
      runDir: event.runDir,
      stages: emptyStages(),
      findings: [],
    }))
    return { ...next, runIndex: { ...next.runIndex, [event.runId]: event.skillId } }
  }

  // Handled before the skillId guard below: a review pane is keyed by job and
  // run id, not by the skill row, so none of these four can depend on
  // run:start having already been seen — a run:done racing ahead of its own
  // start being observed must still be able to clear a pending it created.
  if (event.type === 'mutation:pending') {
    // A second request cannot legitimately arrive on top of a live one — the
    // queue serialises mutating jobs and the pipeline serialises pendings
    // within one — so a displacement here means the slot still held a request
    // whose resolution the store never saw. Counting it makes that visible
    // instead of losing the older diff silently.
    const displaced = state.pending !== null && state.pending.requestId !== event.requestId
    return {
      ...state,
      displacedReviews: displaced ? state.displacedReviews + 1 : state.displacedReviews,
      pending: {
        jobId,
        runId: event.runId,
        stage: event.stage,
        requestId: event.requestId,
        diff: event.diff,
        scope: event.scope,
        offset: 0,
      },
    }
  }
  if (event.type === 'mutation:resolved') {
    return state.pending?.requestId === event.requestId
      ? { ...state, pending: null, displacedReviews: 0 }
      : state
  }
  // A prompt whose run has ended can never be answered.
  if (event.type === 'run:done' || event.type === 'run:cancelled' || event.type === 'run:error') {
    const skillId = state.runIndex[event.runId]
    const next = skillId
      ? withSkill(state, skillId, (row) => ({
          ...row,
          status: event.type === 'run:done' ? statusOf(event.outcome) : 'errored',
          activeRunId: null,
        }))
      : state
    if (state.pending?.runId !== event.runId) return { ...next, pending: state.pending }
    return { ...next, pending: null, displacedReviews: 0 }
  }

  // tool:output is deliberately absent: it belongs to the pump, and taking it
  // here would put log text into React state line by line. That is R11.4.
  const skillId = state.runIndex[event.runId]
  if (!skillId) return state

  switch (event.type) {
    case 'stage:start':
      return withSkill(state, skillId, (row) =>
        withStage(row, event.stage, { running: true, summary: event.toolIds.join(', ') }),
      )
    case 'tool:done':
      return withSkill(state, skillId, (row) =>
        withStage({ ...row, findings: [...row.findings, ...event.result.findings] }, event.stage, {
          summary: event.result.summary,
        }),
      )
    case 'stage:done':
      return withSkill(state, skillId, (row) =>
        withStage(row, event.stage, { running: false, outcome: event.outcome }),
      )
    default:
      return state
  }
}

function onQueueEvent(state: AppState, event: QueueEvent): AppState {
  if (event.type === 'run:event') return onRunEvent(state, event.jobId, event.event)
  const index = state.jobs.findIndex((job) => job.jobId === event.job.jobId)
  const jobs = index === -1 ? [...state.jobs, event.job] : [...state.jobs]
  if (index !== -1) jobs[index] = event.job
  return { ...state, jobs, selectedJob: clamp(state.selectedJob, jobs.length) }
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'queue-event':
      return onQueueEvent(state, action.event)
    case 'log-flush':
      return { ...state, log: { lines: action.lines, dropped: action.dropped } }
    case 'select-skill':
      return {
        ...state,
        selectedSkill: clamp(state.selectedSkill + action.delta, state.skills.length),
      }
    case 'select-stage':
      return {
        ...state,
        selectedStage: clamp(state.selectedStage + action.delta, STAGE_ORDER.length),
      }
    case 'select-job':
      return { ...state, selectedJob: clamp(state.selectedJob + action.delta, state.jobs.length) }
    case 'toggle-skill-mark': {
      const row = selectedSkill(state)
      return row ? { ...state, markedSkills: toggle(state.markedSkills, row.skillId) } : state
    }
    case 'toggle-stage-mark': {
      const stage = STAGE_ORDER[state.selectedStage]
      return stage ? { ...state, markedStages: toggle(state.markedStages, stage) } : state
    }
    case 'clear-marks':
      return { ...state, markedSkills: [], markedStages: [] }
    case 'set-focus':
      return { ...state, focus: action.focus }
    case 'cycle-focus':
      return { ...state, focus: FOCUSES[cycle(FOCUSES, state.focus, action.delta)] as Focus }
    case 'set-panel':
      return { ...state, panel: action.panel }
    case 'cycle-panel':
      return { ...state, panel: PANELS[cycle(PANELS, state.panel, action.delta)] as Panel }
    case 'set-skill-md':
      return { ...state, skillMd: action.body }
    case 'set-artefacts':
      return { ...state, artefacts: action.paths }
    case 'toggle-help':
      return { ...state, help: action.open ?? !state.help }
    case 'scroll-review': {
      if (!state.pending) return state
      // Clamped to the last *full* window, not to the diff's last line and not
      // to an arbitrary large number: holding `j` past the end used to drive
      // offset into the thousands, needing as many `k` presses before the view
      // moved again, and clamping to the last line left one diff row on screen.
      const lines = state.pending.diff.split('\n').length
      const maxOffset = Math.max(0, lines - Math.max(1, action.viewport))
      const offset = Math.min(maxOffset, Math.max(0, state.pending.offset + action.delta))
      return { ...state, pending: { ...state.pending, offset } }
    }
    case 'set-screen':
      // The palette closes and the offset resets with the switch: leaving the
      // palette open over the new screen sent the first keystroke there to a
      // filter the user could no longer see, and a carried-over offset opens
      // the next screen scrolled to a row it does not have.
      return {
        ...state,
        screen: action.screen,
        palette: { open: false, query: '', selected: 0 },
        screenOffset: 0,
      }
    case 'palette-open':
      return { ...state, palette: { open: true, query: '', selected: 0 } }
    case 'palette-input':
      return {
        ...state,
        palette: {
          open: true,
          query: action.query,
          selected: clamp(0, paletteMatches(action.query).length),
        },
      }
    case 'palette-move':
      return {
        ...state,
        palette: {
          ...state.palette,
          selected: clamp(
            state.palette.selected + action.delta,
            paletteMatches(state.palette.query).length,
          ),
        },
      }
    case 'palette-close':
      return { ...state, palette: { open: false, query: '', selected: 0 } }
    case 'set-dashboard':
      return { ...state, dashboard: action.stats, viewError: null }
    case 'set-provenances':
      return { ...state, provenances: action.options }
    case 'set-stats-filter':
      // Replaced, not merged: a filter that keeps a stale skillId while the
      // user changes provenance answers a question nobody asked.
      return { ...state, statsFilter: action.filter, dashboard: null, screenOffset: 0 }
    case 'set-issues':
      return {
        ...state,
        issues: action.rows,
        selectedIssue: clamp(state.selectedIssue, action.rows.length),
        viewError: null,
      }
    case 'select-issue':
      return {
        ...state,
        selectedIssue: clamp(state.selectedIssue + action.delta, state.issues.length),
      }
    case 'set-issue-filter':
      return { ...state, issueFilter: action.filter, selectedIssue: 0, screenOffset: 0 }
    case 'set-tools':
      return { ...state, tools: action.report, viewError: null }
    case 'set-settings':
      return { ...state, settings: action.view, viewError: null }
    case 'settings-cursor':
      return { ...state, settingsCursor: clamp(state.settingsCursor + action.delta, action.count) }
    case 'begin-edit':
      return {
        ...state,
        editing: { field: action.field, current: action.current, buffer: '', error: null },
      }
    case 'edit-input':
      return state.editing === null
        ? state
        : { ...state, editing: { ...state.editing, buffer: action.buffer, error: null } }
    case 'cancel-edit':
      return { ...state, editing: null }
    case 'stage-edit': {
      const editing = state.editing
      const base = state.staged ?? state.settings?.config
      if (!editing || !base) return state
      try {
        return { ...state, staged: withScalar(base, editing.field, editing.buffer), editing: null }
      } catch (err) {
        // The editor stays open holding what the user typed: closing it on a
        // rejection throws away the value they were half way through fixing.
        return { ...state, editing: { ...editing, error: (err as Error).message } }
      }
    }
    case 'stage-remove-repo': {
      const base = state.staged ?? state.settings?.config
      return base ? { ...state, staged: withoutRepo(base, action.repoId) } : state
    }
    case 'stage-selection': {
      const base = state.staged ?? state.settings?.config
      return base
        ? { ...state, staged: withStageTools(base, action.selected, hasAdapter) }
        : state
    }
    case 'stage-repo': {
      const base = state.staged ?? state.settings?.config
      if (!base) return state
      try {
        return { ...state, staged: withRepo(base, action.entry) }
      } catch (err) {
        // Registering a path twice is the user's mistake, not a crash: the
        // screen says so and the staging is left as it was.
        return { ...state, viewError: (err as Error).message }
      }
    }
    case 'open-confirm':
      return state.staged === null ? state : { ...state, confirm: true, screenOffset: 0 }
    case 'close-confirm':
      return { ...state, confirm: false, screenOffset: 0 }
    case 'discard-staged':
      return { ...state, staged: null, editing: null, confirm: false, settingsCursor: 0 }
    case 'set-screen-row-count':
      return { ...state, screenRowCount: action.count }
    case 'scroll-screen': {
      // Clamped the way `scroll-review` is: to the last *full* window, so
      // holding `j` cannot drive the offset past the end and leave one row on
      // screen needing as many `k` presses before the view moves again.
      const maxOffset = Math.max(0, state.screenRowCount - Math.max(1, action.viewport))
      return {
        ...state,
        screenOffset: Math.min(maxOffset, Math.max(0, state.screenOffset + action.delta)),
      }
    }
    case 'refresh-views':
      return { ...state, reloads: state.reloads + 1 }
    case 'view-error':
      return { ...state, viewError: action.message }
    case 'set-statuses':
      return {
        ...state,
        skills: state.skills.map((row) => {
          const recorded = action.statuses[row.skillId]
          // A live run always wins over a record of an old one.
          if (recorded === undefined || row.status === 'running') return row
          return { ...row, status: statusOf(recorded as StageOutcome) }
        }),
      }
  }
}
