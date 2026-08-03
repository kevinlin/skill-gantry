import {
  STAGE_ORDER,
  type JobRecord,
  type QueueEvent,
  type RawFinding,
  type RunEvent,
  type SkillRef,
  type Stage,
  type StageOutcome,
} from '../core/index.js'

export const PANELS = ['log', 'findings', 'artefacts', 'skill'] as const
export type Panel = (typeof PANELS)[number]

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
   * Count of `mutation:pending` events that arrived while another was already
   * displayed and silently overwrote it. `pending` is a single slot per the
   * plan (R5.12's two-skills-pending case is a known gap here, not solved),
   * so this is the one visible trace that a second run is blocked behind the
   * one on screen rather than one more press away from being unblocked.
   */
  displacedReviews: number
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
  | { type: 'scroll-review'; delta: number }

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
    // R5.12 needs two skills to be able to have a mutation pending at once;
    // `pending` is a single slot per the plan, so a second request silently
    // displaces the first here. The count is the only trace of that until a
    // queue of pendings replaces the slot — a known gap, not a fix.
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
    return state.pending?.requestId === event.requestId ? { ...state, pending: null } : state
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
    return { ...next, pending: state.pending?.runId === event.runId ? null : state.pending }
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
      // Clamped to the diff's own last line, not an arbitrary large number:
      // without this, holding `j` past the end drove offset into the
      // thousands and the same number of `k` presses were needed before the
      // view moved again.
      const maxOffset = Math.max(0, state.pending.diff.split('\n').length - 1)
      const offset = Math.min(maxOffset, Math.max(0, state.pending.offset + action.delta))
      return { ...state, pending: { ...state.pending, offset } }
    }
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
