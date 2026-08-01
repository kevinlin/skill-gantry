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

function onRunEvent(state: AppState, event: RunEvent): AppState {
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
    case 'run:done':
      return withSkill(state, skillId, (row) => ({
        ...row,
        status: statusOf(event.outcome),
        activeRunId: null,
      }))
    case 'run:cancelled':
    case 'run:error':
      return withSkill(state, skillId, (row) => ({
        ...row,
        status: 'errored',
        activeRunId: null,
      }))
    default:
      return state
  }
}

function onQueueEvent(state: AppState, event: QueueEvent): AppState {
  if (event.type === 'run:event') return onRunEvent(state, event.event)
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
  }
}
