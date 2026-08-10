import {
  STAGE_ORDER,
  hasAdapter,
  isBumpLevel,
  resolveTargetVersion,
  withRepo,
  withRepoPath,
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
  type SuppressionRequest,
  type StageOutcome,
  type StatsFilter,
} from '../core/index.js'
import { humanMs } from './rows.js'
import { jobVerdict } from './tokens.js'
import type { LastRun, SettingsView } from './views.js'

export const PANELS = ['log', 'findings', 'issues', 'artefacts', 'skill'] as const
export type Panel = (typeof PANELS)[number]

// `setup` is a screen so `PALETTE_COMMANDS` picks it up from this list rather
// than needing a second registration — §14.2.
export const SCREENS = ['work', 'dashboard', 'issues', 'tools', 'settings', 'setup'] as const
export type Screen = (typeof SCREENS)[number]

export interface PaletteCommand {
  id: string
  label: string
  action:
    | { kind: 'screen'; screen: Screen }
    | { kind: 'quit' }
    | { kind: 'refresh' }
    // R11.22: opens a prompt surface for the selected skill. A fourth kind
    // rather than a sixth screen, because it opens a modal over whatever is up
    // rather than replacing `state.screen`.
    | { kind: 'prompt'; prompt: PromptKind }
}

export const PALETTE_COMMANDS: readonly PaletteCommand[] = [
  ...SCREENS.map((screen) => ({
    id: screen,
    label: `go to ${screen}`,
    action: { kind: 'screen' as const, screen },
  })),
  {
    id: 'evals',
    // Unconditional on the suite's state: a surface reachable only when the
    // file is missing would be unreachable the moment it had done its job, and
    // a thin suite is the case a maintainer most wants to extend.
    label: "compose or extend the selected skill's eval suite",
    action: { kind: 'prompt', prompt: 'evals' },
  },
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

/**
 * In the order the zones sit on the screen, which is why `queue` comes last
 * rather than being appended anywhere: tab reading top-to-bottom is the only
 * reason a user can predict where the next press lands.
 *
 * `work` is the rail and the output pane together (R11.11). They were two stops
 * until §14.6, and separating them bought nothing: `h`/`l` move the rail and
 * `j`/`k` move the pane, so the two were never ambiguous, and a stop whose only
 * job is to disambiguate them is paid for on every cycle.
 */
export const FOCUSES = ['skills', 'work', 'queue'] as const
export type Focus = (typeof FOCUSES)[number]

export type SkillStatus = 'idle' | 'running' | 'passed' | 'failed' | 'errored'

/**
 * A finding plus where it came from. §14.3 recorded that a finding on screen
 * "cannot be attributed to a stage at all" — but the reducer had `event.stage`
 * and `event.result` in hand the whole time, so the attribution was one field
 * away and the Findings pane went without a cursor for it. No core contract
 * moves: `tool:done` already carries all four values.
 */
export interface FindingRow {
  finding: RawFinding
  stage: Stage
  toolId: string
  /** `ToolRunRecord.artefactDir` — the evidence `o` opens (R11.14). */
  artefactDir: string
}

export interface StageCell {
  outcome: StageOutcome | null
  running: boolean
  summary: string
  /**
   * R11.9's trigger, per stage. `SkillRow.findings` accumulates across every
   * stage of the run, so a finding on screen cannot be attributed to the one
   * the rail has selected — this can.
   */
  findings: number
  /**
   * When this stage began, for the rail's counter. `stage:start` carries no
   * timestamp, and giving it one would be a core contract change for one cell
   * of one screen — so the clock is read at dispatch, which is the same trade
   * §14.4 already made for the queue row's `JobRecord.startedAt`. Null on every
   * stage that is not running, including a rehydrated one: a recorded run's
   * per-stage start is not in `index.ndjson` and inventing one would make the
   * rail count from a time nothing recorded.
   */
  startedAt: number | null
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
  findings: FindingRow[]
  /**
   * True while this row's state came off disk rather than out of the session's
   * event stream. It is what lets the Log pane show *this* skill's recorded
   * output: `state.log` is one session-wide buffer, so a row that never ran
   * this session would otherwise show whichever skill did.
   */
  rehydrated: boolean
  /** The recorded run's tool logs, shown only while `rehydrated`. */
  recordedLog: { lines: readonly string[]; dropped: number }
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

/**
 * R11.16's confirmation, held the way `PendingReview` is: one bounded document
 * in state, unlike log text, because R11.4 is about a stream that never stops.
 * `request` survives the editing step — the preview cannot be staged until the
 * reason is committed, and the reason is part of the entry.
 */
export interface SuppressSlot {
  request: SuppressionRequest
  label: string
  toolId: string
  relPath: string
  diff: string
  offset: number
  reason: string
  editingReason: boolean
  uncovered: string[]
  thenRun: 'resume' | 'gates' | 'none'
  /** The gate chain `resume` enqueues, from `resumedGates`. */
  stages: readonly Stage[]
  error: string | null
}

/**
 * R11.19. The target for the release about to be enqueued, held until `enter`
 * turns it into `JobSpec.releaseTarget`. Nothing here has reached the queue:
 * the slot exists precisely because R9.10 forbids inferring the version, so it
 * has to be asked for before a job can be built.
 */
/**
 * R11.21 and R11.22. What a prompt surface holds, which is a document and a
 * scroll — no target, no toggle, no error, because the pane builds no job and
 * writes no byte. That is also what puts it below every write pane in §14.2's
 * order.
 *
 * One slot for both kinds because nothing in the pane was ever about
 * optimisation: it renders a scrolled document, copies it with `y`, and closes
 * on `esc`. `DiffBody`, shared by `ReviewPane` and `SuppressPane`, is the
 * precedent — two renderers of one frame is the divergence `tokens.ts` records
 * from when five modules each owned severity colour.
 */
export interface PromptSlot {
  /** Which stage's mark the surface clears, and what its title says. */
  kind: PromptKind
  skillId: string
  /** The finished R6.12 or R6.13 body, for the clipboard. */
  prompt: string
  /** Split once, because the pane renders it and the scroll clamp counts it. */
  lines: readonly string[]
  offset: number
}

export type PromptKind = 'optimise' | 'evals'

/**
 * The stage each kind's mark occupies, so `end-prompt` clears exactly one and
 * the two cannot disagree about which. `evals` is `evaluate` because that is
 * the rail column the user marked to get here.
 */
export const PROMPT_STAGE: Readonly<Record<PromptKind, Stage>> = {
  optimise: 'optimise',
  evals: 'evaluate',
}

/** The pane's title, from the slot rather than from the component. */
export const PROMPT_TITLE: Readonly<Record<PromptKind, string>> = {
  optimise: 'Optimise',
  evals: 'Eval suite',
}

export interface ReleaseSlot {
  /**
   * Every marked skill this one target applies to, in list order. More than
   * one forbids an explicit semver — a single number cannot describe several
   * skills, while a bump level moves each from its own frontmatter version.
   */
  skillIds: readonly string[]
  /**
   * Freshly read by `planRelease`, and what the enqueued job carries. Not the
   * launch-time `SkillRef`: see `ReleasePreviewView.skill`.
   */
  refs: Record<string, SkillRef>
  /**
   * Starts empty rather than seeded with a suggestion. R9.10 is that the target
   * is supplied, and a prefilled `patch` the user presses enter through is an
   * inference wearing a keystroke's clothes.
   */
  version: string
  notes: string
  /**
   * The override is a tab stop rather than a letter key, because both other
   * stops are free-text fields and every letter worth binding is one a user
   * types — `t` is in `patch`. A stop reached by `tab` and toggled by `space`
   * needs no modifier and no second editing mode.
   */
  field: 'version' | 'notes' | 'dirty'
  /** R10.3. Off until the user turns it on, with `dirty` on screen beside it. */
  allowDirty: boolean
  dirty: readonly string[]
  /**
   * What `version` resolves to, recomputed on every keystroke, or null while it
   * does not resolve. Rendering the resolution is what makes `minor` an
   * explicit choice rather than a guess the user cannot check before enter.
   */
  resolved: string | null
  error: string | null
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
  /**
   * First visible row of the output pane, or `null` for "sit where this tab
   * naturally sits" — the top for a findings, artefact or SKILL.md list, the
   * newest line for the log. Null rather than a number so the log keeps
   * following as it grows: an offset pinned at the tail stops being the tail
   * the moment the next line lands.
   */
  outputOffset: number | null
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
  /** R11.16's acceptance, awaiting its reason or its confirmation. */
  suppress: SuppressSlot | null
  release: ReleaseSlot | null
  /** R11.21's and R11.22's shared surface; `kind` says which opened it. */
  prompt: PromptSlot | null
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
  /**
   * R11.13. Which issues the Work screen's tab is showing. Held separately from
   * `issueFilter`, which the Issues *screen* owns: one field driven by two
   * screens with different scoping vocabularies is how the tab comes to
   * re-filter the screen behind the user's back.
   */
  issueScope: 'skill' | 'repo' | 'all'
  /** Which issue the Issues *screen* has selected. */
  selectedIssue: number
  /**
   * Which issue the Work screen's tab has selected (R11.13, rev 15). Split from
   * `selectedIssue` for the reason `issueScope` was split from `issueFilter`:
   * the tab rendered the screen's cursor while windowing against its own scroll
   * offset, so it drew a selection no key on the Work screen could move and,
   * arriving from a screen left at row 30, drew none at all.
   */
  selectedTabIssue: number
  /**
   * Which finding the Findings pane has selected (R11.14). A cursor rather than
   * a scroll offset because this pane is a list of things to act on, which is
   * what `SkillList` and Issues already are — `outputOffset` still scrolls the
   * other three tabs.
   */
  selectedFinding: number
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
  /**
   * R11.18. The full-length view, holding the row itself and not an index into
   * the list it came from: `run:start` clears `SkillRow.findings` and
   * `set-issues` replaces `state.issues` wholesale, so an index would silently
   * re-point at a different finding while the view was open — and the list it
   * indexed is not on screen to contradict it. It carries no origin either,
   * because opening it never changes `state.screen`: closing reveals whatever
   * was already beneath, and a second record of which screen is up is a second
   * thing that can be wrong.
   */
  detail: { kind: 'finding'; row: FindingRow } | { kind: 'issue'; row: IssueRow } | null
  /**
   * First visible row of the detail view. Its own rather than `screenOffset`,
   * for the reason it holds no origin: the view sits over a screen that is
   * still there, so sharing the offset would scroll what is underneath it.
   */
  detailOffset: number
  /** Set when the port rejected; cleared by the next successful load. */
  viewError: string | null
  /** Bumped by `refresh`, watched by the loading effect. */
  reloads: number
  /**
   * R11.9's one-line report, shown in place of the footer hints so it costs no
   * row (§14.1). Cleared by the next keypress rather than by a timer, which
   * keeps the TUI tests deterministic.
   */
  flash: string | null
  /**
   * How the flash should read. Set with the message and only with it, so the
   * two cannot describe different events; `info` is the dim footer the hints
   * already use, and the other two are for a verdict that should not have to be
   * read to be noticed.
   */
  flashTone: FlashTone
}

export type FlashTone = 'info' | 'good' | 'bad'

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
  /**
   * `total` and `viewport` come from the caller because the reducer cannot know
   * either: the row count depends on which tab is up and the viewport on the
   * terminal. `anchor` is where the tab sits when nothing is pinned, so scrolling
   * back to the newest log line resumes following instead of freezing one line
   * short of it.
   */
  | {
      type: 'scroll-output'
      delta: number
      viewport: number
      total: number
      anchor: 'top' | 'bottom'
    }
  | { type: 'set-statuses'; statuses: Record<string, string> }
  | { type: 'set-last-run'; skillId: string; run: LastRun }
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
  | { type: 'set-issues'; rows: IssueRow[]; surface: 'screen' | 'tab' }
  | { type: 'select-issue'; delta: number }
  | { type: 'select-tab-issue'; delta: number }
  | { type: 'set-issue-filter'; filter: IssueFilter }
  | { type: 'cycle-issue-scope' }
  /** `total` is the caller's because the row count depends on the width. */
  | { type: 'select-finding'; delta: number; total: number }
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
  | { type: 'stage-repo-path'; repoId: string; entry: { path: string; isGit: boolean } }
  | { type: 'open-confirm' }
  | { type: 'close-confirm' }
  | { type: 'discard-staged' }
  | { type: 'set-screen-row-count'; count: number }
  | { type: 'scroll-screen'; delta: number; viewport: number }
  | { type: 'open-detail'; detail: NonNullable<AppState['detail']> }
  | { type: 'close-detail' }
  | { type: 'scroll-detail'; delta: number; viewport: number; total: number }
  | { type: 'refresh-views' }
  | { type: 'view-error'; message: string }
  // R11.16. The §14.2 editor's *shape* — buffer in state, refusal on commit,
  // no per-keystroke write — reused rather than its actions: `begin-edit` is
  // typed to `ScalarField`, the config document's vocabulary, and widening it
  // would put two unrelated editors behind one action.
  | { type: 'begin-suppress'; request: SuppressionRequest; toolId: string; relPath: string; reason: string }
  | {
      type: 'suppress-preview'
      label: string
      diff: string
      uncovered: string[]
      stages: readonly Stage[]
    }
  | { type: 'suppress-reason'; reason: string }
  | { type: 'commit-suppress-reason' }
  | { type: 'cycle-then-run' }
  | { type: 'scroll-suppress'; delta: number }
  | { type: 'suppress-error'; message: string }
  | { type: 'end-suppress' }
  // R11.19. One `release-field` action for both fields rather than one per
  // field: the two differ only in which key of the slot they write, and a
  // second action would have to repeat the resolution the first already does.
  | { type: 'begin-release'; skillIds: readonly string[]; refs: Record<string, SkillRef>; dirty: readonly string[] }
  | { type: 'release-field'; value: string }
  | { type: 'cycle-release-field' }
  | { type: 'toggle-allow-dirty' }
  | { type: 'release-error'; message: string }
  | { type: 'end-release' }
  // R11.21. No field action and no error action: the pane collects nothing.
  | { type: 'begin-prompt'; kind: PromptKind; skillId: string; prompt: string }
  | { type: 'scroll-prompt'; delta: number; viewport: number }
  | { type: 'end-prompt' }
  | { type: 'flash'; message: string; tone?: FlashTone }
  | { type: 'clear-flash' }

/**
 * R11.19's two refusals, both computed from the slot alone so the pane renders
 * a decision rather than making one. `resolveTargetVersion` is core's and pure,
 * so the preview here and the stage's own resolution cannot disagree on the
 * arithmetic — only on the bytes, which is the stage's to re-read.
 *
 * A multi-skill batch resolves to nothing rather than to the first skill's
 * number: the bump is valid for all of them and the resulting version differs
 * per skill, so showing one would name a version most of them will not get.
 */
function resolveRelease(slot: ReleaseSlot): Pick<ReleaseSlot, 'resolved' | 'error'> {
  const spec = slot.version.trim()
  if (spec === '') return { resolved: null, error: null }
  if (slot.skillIds.length > 1) {
    return isBumpLevel(spec)
      ? { resolved: null, error: null }
      : {
          resolved: null,
          error: `${slot.skillIds.length} skills marked: one version cannot describe them all — use major, minor or patch`,
        }
  }
  const only = slot.skillIds[0]
  const current = only === undefined ? null : (slot.refs[only]?.version ?? null)
  try {
    return { resolved: resolveTargetVersion(current, spec), error: null }
  } catch (err) {
    return { resolved: null, error: (err as Error).message }
  }
}

const emptyStages = (): Record<Stage, StageCell> =>
  Object.fromEntries(
    STAGE_ORDER.map((stage) => [
      stage,
      { outcome: null, running: false, summary: '', findings: 0, startedAt: null },
    ]),
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
  rehydrated: false,
  recordedLog: { lines: [], dropped: 0 },
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
    outputOffset: null,
    help: false,
    pending: null,
    displacedReviews: 0,
    suppress: null,
    release: null,
    prompt: null,
    screen: 'work',
    palette: { open: false, query: '', selected: 0 },
    dashboard: null,
    provenances: [],
    statsFilter: {},
    issues: [],
    issueFilter: {},
    issueScope: 'skill',
    selectedIssue: 0,
    selectedTabIssue: 0,
    detail: null,
    detailOffset: 0,
    selectedFinding: 0,
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
    flash: null,
    flashTone: 'info',
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
      // The live buffer takes the pane back over from here.
      rehydrated: false,
      recordedLog: { lines: [], dropped: 0 },
    }))
    // The cursor with the list it indexed into: the row cleared `findings`, so a
    // cursor left at 4 points past the end of an empty pane (R11.14).
    return {
      ...next,
      selectedFinding: 0,
      runIndex: { ...next.runIndex, [event.runId]: event.skillId },
    }
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
        withStage(row, event.stage, {
          running: true,
          summary: event.toolIds.join(', '),
          startedAt: Date.now(),
        }),
      )
    case 'tool:done':
      return withSkill(state, skillId, (row) =>
        withStage(
          {
            ...row,
            findings: [
              ...row.findings,
              ...event.result.findings.map((finding) => ({
                finding,
                stage: event.stage,
                toolId: event.result.toolId,
                artefactDir: event.result.artefactDir,
              })),
            ],
          },
          event.stage,
          { summary: event.result.summary },
        ),
      )
    case 'stage:done':
      return withSkill(state, skillId, (row) =>
        withStage(row, event.stage, {
          running: false,
          outcome: event.outcome,
          // Cleared with `running`, not left behind it: a stage that has settled
          // has an outcome to show and no clock to run, and a field only one
          // flag makes meaningless is the pair that comes apart.
          startedAt: null,
          // The event already carries the whole StageResult, so R11.9's count
          // costs no change to the event contract.
          findings: event.result.toolRuns.reduce((n, run) => n + run.findings.length, 0),
        }),
      )
    default:
      return state
  }
}

/** Worst first, so a batch says what went wrong before it says what did not. */
const TALLY_ORDER = ['failed', 'errored', 'degraded', 'cancelled', 'skipped', 'passed'] as const

/**
 * What the queue just cost, in the footer's row rather than one of its own —
 * the same trick R11.9's copy report plays, for the same reason (§14.1).
 *
 * Raised when the queue *empties*, not on every job that lands. A batch of
 * twenty skills reporting twenty times would hide the footer's five keys for
 * the whole run and tell the user nothing they could act on until the end;
 * what they walked away from the terminal to find out is whether it all
 * passed. One job reports itself in full instead, down to the run directory,
 * because that is the one case where the evidence has a single address to name
 * (product principle 1).
 */
function landingFlash(state: AppState): { flash: string; flashTone: FlashTone } | null {
  const finished = state.jobs.filter((job) => job.state !== 'queued' && job.state !== 'running')
  const first = finished[0]
  if (!first) return null

  // Counted by verdict, never by job state: the pool ends a run whose security
  // stage failed as `done`, so a tally over the state reported a batch that
  // found criticals as "4 passed".
  const verdicts = finished.map((job) => jobVerdict(job).label)
  const count = (label: string): number => verdicts.filter((word) => word === label).length
  const tone: FlashTone =
    count('failed') + count('errored') > 0 ? 'bad' : count('passed') === verdicts.length ? 'good' : 'info'

  if (finished.length > 1) {
    // A closed set in a fixed order, so the same batch reads the same way twice
    // and a verdict nobody planned for cannot vanish from the count.
    const tally = TALLY_ORDER.map((label) => ({ label, n: count(label) }))
      .filter((entry) => entry.n > 0)
      .map((entry) => `${entry.n} ${entry.label}`)
    return { flash: `${finished.length} jobs · ${tally.join(', ')}`, flashTone: tone }
  }

  const row = state.skills.find((skill) => skill.skillId === first.skillId)
  const findings = row
    ? first.stages.reduce((total, stage) => total + row.stages[stage].findings, 0)
    : 0
  const elapsed =
    first.startedAt === null || first.endedAt === null
      ? null
      : Date.parse(first.endedAt) - Date.parse(first.startedAt)
  // Verdict first and the path last: `StatusBar` cuts from the end, so a
  // narrow terminal loses the address before it loses the answer.
  const parts = [
    `${first.skillId} ${first.stages.join(',')} ${jobVerdict(first).label}`,
    elapsed === null ? '' : humanMs(elapsed),
    `${findings} finding${findings === 1 ? '' : 's'}`,
    row?.runDir ?? '',
  ].filter(Boolean)
  return { flash: parts.join(' · '), flashTone: tone }
}

function onQueueEvent(state: AppState, event: QueueEvent): AppState {
  if (event.type === 'run:event') return onRunEvent(state, event.jobId, event.event)
  const index = state.jobs.findIndex((job) => job.jobId === event.job.jobId)
  const jobs = index === -1 ? [...state.jobs, event.job] : [...state.jobs]
  if (index !== -1) jobs[index] = event.job
  const next = { ...state, jobs, selectedJob: clamp(state.selectedJob, jobs.length) }
  // Only on the update that empties the queue, and only when this event is the
  // one that emptied it — a later record for an already-finished job would
  // otherwise re-raise a report the user has already dismissed.
  const settled = jobs.every((job) => job.state !== 'queued' && job.state !== 'running')
  const wasRunning = state.jobs.some((job) => job.state === 'queued' || job.state === 'running')
  if (!settled || !wasRunning) return next
  return { ...next, ...(landingFlash(next) ?? {}) }
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
        // Another skill's findings are another list; the offset and the cursor
        // were both about this one.
        outputOffset: null,
        selectedFinding: 0,
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
    // Every one of these four replaces what the pane is showing, so the offset
    // goes back to the tab's anchor: carrying row 40 onto a list of six opens a
    // pane that looks empty until the user presses `k` forty times.
    case 'set-panel':
      return { ...state, panel: action.panel, outputOffset: null }
    case 'cycle-panel':
      return {
        ...state,
        panel: PANELS[cycle(PANELS, state.panel, action.delta)] as Panel,
        outputOffset: null,
      }
    case 'set-skill-md':
      return { ...state, skillMd: action.body, outputOffset: null }
    case 'set-artefacts':
      return { ...state, artefacts: action.paths, outputOffset: null }
    case 'scroll-output': {
      // Clamped to the last *full* window, like `scroll-review` and
      // `scroll-screen`: holding `j` past the end otherwise drives the offset
      // into the hundreds and needs as many `k` presses before the view moves.
      const maxOffset = Math.max(0, action.total - Math.max(1, action.viewport))
      const anchored = action.anchor === 'bottom' ? maxOffset : 0
      const next = Math.min(maxOffset, Math.max(0, (state.outputOffset ?? anchored) + action.delta))
      // Back at the anchor is not a pin: the log resumes following, which is the
      // state a user who has scrolled to the newest line is asking for.
      return { ...state, outputOffset: next === anchored ? null : next }
    }
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
    // The response carries the surface that asked for it, so it clamps that
    // surface's cursor alone (R11.13, rev 15). One row set still serves both,
    // so an untagged response landing on the other left a cursor pointing at an
    // unrelated issue — clamped rather than reset, which is what hid it.
    case 'set-issues':
      return {
        ...state,
        issues: action.rows,
        ...(action.surface === 'tab'
          ? { selectedTabIssue: clamp(state.selectedTabIssue, action.rows.length) }
          : { selectedIssue: clamp(state.selectedIssue, action.rows.length) }),
        viewError: null,
      }
    case 'select-issue':
      return {
        ...state,
        selectedIssue: clamp(state.selectedIssue + action.delta, state.issues.length),
      }
    case 'select-tab-issue':
      return {
        ...state,
        selectedTabIssue: clamp(state.selectedTabIssue + action.delta, state.issues.length),
        // The window follows the cursor, so a pinned offset would fight it —
        // `select-finding`'s reason, for the pane's other cursored tab.
        outputOffset: null,
      }
    case 'set-issue-filter':
      return { ...state, issueFilter: action.filter, selectedIssue: 0, screenOffset: 0 }
    case 'select-finding':
      return {
        ...state,
        selectedFinding: clamp(state.selectedFinding + action.delta, action.total),
        // The window follows the cursor, so a pinned offset would fight it.
        outputOffset: null,
      }
    case 'cycle-issue-scope': {
      const next = { skill: 'repo', repo: 'all', all: 'skill' } as const
      return { ...state, issueScope: next[state.issueScope], selectedTabIssue: 0, outputOffset: null }
    }
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
    // R11.16. Every case below returns the state untouched when no slot is
    // open, so a stray keypress after the pane closes cannot resurrect one.
    case 'begin-suppress':
      return {
        ...state,
        suppress: {
          request: action.request,
          label: '',
          toolId: action.toolId,
          relPath: action.relPath,
          diff: '',
          offset: 0,
          // Seeded, unlike the config editor's empty buffer: a prefill the
          // first keystroke replaces is not a prefill.
          reason: action.reason,
          editingReason: true,
          uncovered: [],
          thenRun: 'resume',
          stages: [],
          error: null,
        },
      }
    case 'suppress-preview':
      return state.suppress === null
        ? state
        : {
            ...state,
            suppress: {
              ...state.suppress,
              label: action.label,
              diff: action.diff,
              uncovered: action.uncovered,
              stages: action.stages,
              // Every gate passed against the pre-write digest, so `resume`
              // would enqueue nothing — which is not an offer.
              thenRun: action.stages.length === 0 ? 'gates' : state.suppress.thenRun,
              error: null,
            },
          }
    case 'suppress-reason':
      return state.suppress === null
        ? state
        : { ...state, suppress: { ...state.suppress, reason: action.reason, error: null } }
    case 'commit-suppress-reason': {
      const slot = state.suppress
      if (slot === null) return state
      // The editor stays open holding what the user typed, as `stage-edit`
      // does: closing it on a rejection throws the half-fixed value away.
      if (slot.reason.trim() === '') {
        return { ...state, suppress: { ...slot, error: 'a suppression reason is required' } }
      }
      return { ...state, suppress: { ...slot, editingReason: false, error: null } }
    }
    case 'cycle-then-run': {
      const slot = state.suppress
      if (slot === null) return state
      const next =
        slot.thenRun === 'resume' ? 'gates' : slot.thenRun === 'gates' ? 'none' : 'resume'
      return { ...state, suppress: { ...slot, thenRun: next } }
    }
    case 'scroll-suppress':
      return state.suppress === null
        ? state
        : {
            ...state,
            suppress: {
              ...state.suppress,
              offset: Math.max(0, state.suppress.offset + action.delta),
            },
          }
    case 'suppress-error':
      return state.suppress === null
        ? state
        : { ...state, suppress: { ...state.suppress, error: action.message } }
    case 'begin-release':
      return {
        ...state,
        release: {
          skillIds: action.skillIds,
          refs: action.refs,
          version: '',
          notes: '',
          field: 'version',
          allowDirty: false,
          dirty: action.dirty,
          resolved: null,
          error: null,
        },
      }
    case 'release-field': {
      const slot = state.release
      if (slot === null) return state
      if (slot.field === 'notes') return { ...state, release: { ...slot, notes: action.value } }
      // Resolved on every keystroke rather than on commit: the refusal a user
      // needs is "1.0.0 is not greater than 1.1.0", and hearing it only after
      // enter is hearing it after the job exists.
      const next = { ...slot, version: action.value }
      return { ...state, release: { ...next, ...resolveRelease(next) } }
    }
    case 'cycle-release-field': {
      const slot = state.release
      if (slot === null) return state
      // The override stop exists only when there is something to override —
      // a stop that toggles a flag with no subject is a stop that teaches the
      // user the wrong thing about what the flag does.
      const stops: ReleaseSlot['field'][] =
        slot.dirty.length > 0 ? ['version', 'notes', 'dirty'] : ['version', 'notes']
      const next = stops[(stops.indexOf(slot.field) + 1) % stops.length] as ReleaseSlot['field']
      return { ...state, release: { ...slot, field: next } }
    }
    case 'toggle-allow-dirty': {
      const slot = state.release
      if (slot === null || slot.dirty.length === 0) return state
      return { ...state, release: { ...slot, allowDirty: !slot.allowDirty } }
    }
    case 'release-error':
      return state.release === null
        ? state
        : { ...state, release: { ...state.release, error: action.message } }
    case 'end-release':
      return {
        ...state,
        release: null,
        // The mark is the request, and closing the surface answers it however
        // it ended. Leaving it set made `esc` a trap: the mark survived, so the
        // next `r` reopened the release pane over whatever stage the user had
        // marked since, and the only way out was a keystroke nothing on screen
        // advertised. Skill marks are a separate axis and are left alone.
        markedStages: state.markedStages.filter((stage) => stage !== 'release'),
      }
    case 'begin-prompt': {
      const lines = action.prompt.split('\n')
      return {
        ...state,
        prompt: { kind: action.kind, skillId: action.skillId, prompt: action.prompt, lines, offset: 0 },
      }
    }
    case 'scroll-prompt': {
      const slot = state.prompt
      if (slot === null) return state
      const max = Math.max(0, slot.lines.length - action.viewport)
      return {
        ...state,
        prompt: { ...slot, offset: Math.min(max, Math.max(0, slot.offset + action.delta)) },
      }
    }
    case 'end-prompt': {
      // The mark goes with the surface, `end-release`'s rule for its reason: a
      // mark that survives `esc` means the next `r` reopens this pane over
      // whatever has been marked since, with nothing on screen naming the
      // keystroke that would free the user. The kind decides which stage's
      // mark goes, so the two surfaces cannot clear each other's.
      const cleared = state.prompt === null ? null : PROMPT_STAGE[state.prompt.kind]
      return {
        ...state,
        prompt: null,
        markedStages: state.markedStages.filter((stage) => stage !== cleared),
        markedSkills: [],
      }
    }
    case 'end-suppress':
      return { ...state, suppress: null }
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
    case 'stage-repo-path': {
      const base = state.staged ?? state.settings?.config
      if (!base) return state
      try {
        return { ...state, staged: withRepoPath(base, action.repoId, action.entry) }
      } catch (err) {
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
    // Opening always starts at the top: the view is a thing to read, and a
    // second finding inheriting the first one's scroll opens mid-sentence.
    case 'open-detail':
      return { ...state, detail: action.detail, detailOffset: 0 }
    case 'close-detail':
      return { ...state, detail: null, detailOffset: 0 }
    case 'scroll-detail': {
      const maxOffset = Math.max(0, action.total - Math.max(1, action.viewport))
      return {
        ...state,
        detailOffset: Math.min(maxOffset, Math.max(0, state.detailOffset + action.delta)),
      }
    }
    case 'refresh-views':
      return { ...state, reloads: state.reloads + 1 }
    case 'view-error':
      return { ...state, viewError: action.message }
    case 'flash':
      return { ...state, flash: action.message, flashTone: action.tone ?? 'info' }
    case 'clear-flash':
      return state.flash === null ? state : { ...state, flash: null, flashTone: 'info' }
    case 'set-last-run':
      // R11.10's precedence rule and the in-flight race guard in one condition:
      // the read is async, so a recorded run resolving after an `r` must not
      // overwrite the live one. `run:start` sets both fields together.
      return withSkill(state, action.skillId, (row) => {
        if (row.activeRunId !== null || row.runDir !== null) return row
        const stages = { ...emptyStages() }
        for (const recorded of action.run.stages) {
          stages[recorded.stage] = {
            outcome: recorded.outcome,
            running: false,
            summary: recorded.summary,
            findings: recorded.findings.length,
            startedAt: null,
          }
        }
        return {
          ...row,
          runDir: action.run.runDir,
          stages,
          // In stage order, the order a live run would have appended them in.
          findings: action.run.stages.flatMap((recorded) => recorded.findings),
          rehydrated: true,
          recordedLog: action.run.log,
          // `status` is left alone: `set-statuses` already owns it, from the
          // same index this run was resolved out of.
        }
      })
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
