import { useEffect, useReducer, useRef } from 'react'
import { Box, Text, useApp, useInput, useStdout, useWindowSize } from 'ink'
import {
  DEFAULT_CONFIG,
  GATE_STAGES,
  STAGE_ORDER,
  configChanges,
  fixPromptPathFor,
  isNativeStage,
} from '../core/index.js'
import type {
  GantryConfig,
  IssueAction,
  IssueState,
  QueueHandle,
  SetupDriver,
  SkillRef,
  Stage,
} from '../core/index.js'
import { ConfirmPane } from './components/ConfirmPane.js'
import { Dashboard } from './components/Dashboard.js'
import { DetailPane } from './components/DetailPane.js'
import { Issues } from './components/Issues.js'
import { PromptPane } from './components/PromptPane.js'
import { Palette } from './components/Palette.js'
import { Settings } from './components/Settings.js'
import { ReleaseTargetPane } from './components/ReleaseTargetPane.js'
import { SuppressPane } from './components/SuppressPane.js'
import { Setup } from './components/Setup.js'
import { StatusBar } from './components/StatusBar.js'
import { Tools } from './components/Tools.js'
import { Work } from './components/Work.js'
import {
  innerWidth,
  layoutFor,
  reviewDiffRows,
  screenBodyRows,
  truncateMiddle,
  type Layout,
} from './layout.js'
import { osc52 } from './osc52.js'
import { LogPump } from './log-buffer.js'
import { detailRows, outputWindow, resumedGates, settingsRows } from './rows.js'
import { useSetupSession } from './use-setup-session.js'
import { PANELS, initialState, paletteMatches, reducer, selectedSkill, type PromptKind } from './store.js'
import type { Action, AppState, FindingRow, FlashTone, SkillRow } from './store.js'
import {
  type GantryViews,
  listArtefacts,
  loadLastRun,
  loadSkillMd,
  loadSkillStatuses,
  readFixPrompt,
} from './views.js'

export interface AppProps {
  skills: readonly SkillRef[]
  queue: QueueHandle
  /** Stages enqueued when the user has marked none. */
  stages: readonly Stage[]
  concurrency: number
  /** R11.3's screens read the ledger through this; the TUI may not open it. */
  views: GantryViews
  /** The wizard's effects, for the setup screen; the TUI may not spawn. */
  setup: SetupDriver
  /**
   * R11.20 as amended: whether SkillHone is locked. A fact about the lock and
   * not about `stageTools`, which can never hold it — the bundle is catalogued
   * `stage: null` precisely so it cannot reach a stage executor.
   */
  optimiseReady?: boolean
  /** Flush interval, lowered in tests. */
  intervalMs?: number
}

/**
 * The wizard inside the session. Same states, same component; what differs is
 * where its results go — staged rather than written — and that leaving it
 * returns to Settings instead of ending the process.
 */
function SetupScreen({
  state,
  dispatch,
  driver,
}: {
  state: AppState
  dispatch: (action: Action) => void
  driver: SetupDriver
}): React.ReactElement {
  const config = state.staged ?? state.settings?.config
  // The wizard does not start until there is a document to stage into. A
  // conditional around the hook below is not available — hook order is fixed —
  // so the session lives in its own component, mounted only once the config has
  // arrived. That also fixes the seed: `initialSetupState` is a lazy reducer
  // init and runs once, so a wizard mounted before the read landed renders a
  // configured machine as having no tools selected, which is the thing §14.2
  // seeded the wizard to prevent.
  if (!config) return <Text dimColor>reading the configuration…</Text>
  return <SetupSession state={state} dispatch={dispatch} driver={driver} config={config} />
}

function SetupSession({
  state,
  dispatch,
  driver,
  config,
}: {
  state: AppState
  dispatch: (action: Action) => void
  driver: SetupDriver
  config: GantryConfig
}): React.ReactElement {
  const locked = state.settings?.lockedTools ?? []
  const session = useSetupSession({
    driver,
    repos: config.repos,
    seed: {
      selected: [...new Set([...Object.values(config.stageTools).flat(), ...locked])],
      installed: Object.fromEntries(locked.map((id) => [id, 'ok' as const])),
    },
    onSelection: (selected) => dispatch({ type: 'stage-selection', selected }),
    // Resolved here rather than in the hook: staging needs the canonical path
    // and the git flag, and this is the caller that needs them — the CLI's
    // `registerRepo` does its own inspection and must not pay for a second.
    onRepo: async (path, replacing) => {
      const result = await driver.inspectRepo(path)
      if (!result.isDirectory) throw new Error(`no such directory: ${result.resolved}`)
      const entry = { path: result.resolved, isGit: result.isGit }
      if (replacing !== null) {
        // No duplicate refusal here: the repo being replaced holds this path by
        // definition when the field was prefilled, and `withRepoPath` still
        // refuses a path any *other* repo holds.
        dispatch({ type: 'stage-repo-path', repoId: replacing, entry })
        return
      }
      if (result.alreadyRegistered) throw new Error(`already registered: ${result.resolved}`)
      dispatch({ type: 'stage-repo', entry })
    },
    onExit: () => dispatch({ type: 'set-screen', screen: 'settings' }),
    // The done footer names this key, so it does the whole thing the footer
    // says: the change set is on Settings, and this is the one keystroke that
    // reaches it. Advertised and unhandled, it read as a wizard that had
    // staged nothing.
    onConfirm: () => {
      dispatch({ type: 'set-screen', screen: 'settings' })
      dispatch({ type: 'open-confirm' })
    },
  })
  return (
    <Setup
      state={session.state}
      cursor={session.cursor}
      draftPath={session.path}
      inspection={session.inspection}
      error={session.error}
      repos={config.repos}
      repoCursor={session.repoCursor}
      exitLabel="settings"
      // This caller stages; it has written nothing, and the done line has to
      // say so or the user reads "Registered" and quits with the change still
      // in the session.
      commit="staged"
    />
  )
}

/**
 * What `j`/`k` mean on Work, which is whichever panel holds the focus. The
 * output pane's clamp comes from `outputWindow` rather than from
 * `layout.outputHeight` directly: the pane spends rows on its own footnotes, and
 * a clamp against the gross height lets the offset run past what the pane can
 * ever show — every further press then moving nothing.
 */
function moveDown(
  state: AppState,
  layout: Layout,
  skill: SkillRow | undefined,
  delta: number,
): Action {
  if (state.focus === 'queue') return { type: 'select-job', delta }
  // R11.23: in the skills zone the pair moves whichever of the two levels is
  // showing. `select-skill` is clamped to the showing repo, so neither level's
  // cursor can walk into rows the panel says it is not showing.
  if (state.focus !== 'work') {
    return state.listLevel === 'repos'
      ? { type: 'select-repo', delta }
      : { type: 'select-skill', delta }
  }
  // A list of things to act on takes a cursor, not a scroll offset — the same
  // shape SkillList and Issues already have. The other three tabs still scroll.
  if (state.panel === 'findings') {
    // The finding count, not the rendered row count: the cursor indexes
    // findings, and `outputWindow` is what counts the detail rows.
    return { type: 'select-finding' as const, delta, total: skill?.findings.length ?? 0 }
  }
  // The tab's own cursor, never the Issues screen's (R11.13, rev 15). It had
  // fallen through to `scroll-output`, so the pane drew a `▸` at the screen's
  // cursor that no key here could move, and the window did not follow it.
  if (state.panel === 'issues') return { type: 'select-tab-issue', delta }
  const view = outputWindow(state, skill, layout.outputHeight)
  return {
    type: 'scroll-output',
    delta,
    viewport: view.rows,
    total: view.total,
    anchor: view.anchor,
  }
}

/**
 * What the reason editor opens holding. Dated because the Issues row renders it
 * back months later as `⊘ suppressed: <reason>`, and "accepted" with no when is
 * a note the maintainer cannot audit.
 */
const suppressionPrefill = (): string =>
  `Accepted ${new Date().toISOString().slice(0, 10)} via SkillGantry`

/**
 * `enter`, `s` and `o` all reach for the selected finding, and all three are
 * already gated on the Findings pane — so the pane is open and the list under
 * it is empty, which `no finding selected` named as a cursor problem the user
 * could not fix by moving the cursor. The recovery is the run that would
 * produce one, in the words `QueuePanel`'s own empty state already teaches.
 *
 * One constant for the three sites: the same refusal spelled three times is
 * how two of them come to say different things about one condition, which is
 * the divergence `StatusBar` was extracted to end for the footer itself.
 */
const NO_FINDINGS = 'no findings here · space marks a stage, r runs it'

/**
 * R11.23's repo level has a cursor and no mark, and a cursor whose mark key
 * does nothing is what the guard-then-flash shape exists to prevent. Names the
 * key that reaches the level where the mark means something, in one constant
 * for the reason `NO_FINDINGS` is one.
 */
const NO_REPO_MARK = 'l enters the repo · space marks a skill'

/** The palette above the same footer hint every screen prints. */
function PaletteScreen({ state }: { state: AppState }): React.ReactElement {
  const { columns, rows } = useWindowSize()
  const layout = layoutFor(columns, rows)
  return (
    <Box flexDirection="column" width={columns}>
      <Palette palette={state.palette} layout={layout} />
      <StatusBar hints="enter run · esc cancel" columns={columns} />
    </Box>
  )
}

export function App({
  skills,
  queue,
  stages,
  concurrency,
  views,
  setup,
  optimiseReady = false,
  intervalMs,
}: AppProps): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, skills, (list) => initialState(list, concurrency))
  // The scroll clamp needs the same row count the review pane renders, and
  // `layout.ts` is the one place that decides it (§14.1's third rule).
  const { columns, rows } = useWindowSize()
  const layout = layoutFor(columns, rows)
  const reviewRows = reviewDiffRows(layout)
  // What the change set is computed against: the document on disk, never the
  // staged one, or every change would compare against itself.
  const settingsConfig = state.settings?.config ?? DEFAULT_CONFIG
  const { exit } = useApp()
  // R11.9's escape has to reach the terminal Ink owns — the alternate screen,
  // raw mode, the stream Ink was constructed with — so it goes out through the
  // stream Ink itself holds, not `process.stdout`.
  const { stdout } = useStdout()
  const byId = useRef(new Map(skills.map((skill) => [skill.id, skill])))
  /**
   * The palette's input state, mirrored outside React. Key handling has to be
   * synchronous and React batches the dispatches from several keypresses
   * delivered in one tick: reading `state.palette` instead meant `:` and the
   * first letter arrived together, the letter's handler still saw the palette
   * closed, and every character but the last was lost — typing `issues`
   * selected whatever `s` matched. State stays what the frame renders.
   */
  const palette = useRef({ open: false, query: '' })
  /** The value editor's buffer, mirrored outside React for the same reason. */
  const editor = useRef({ open: false, buffer: '' })
  /** The suppression reason's buffer, mirrored for that same reason again. */
  const reasonRef = useRef('')
  /** R11.19's two text fields, mirrored for that same reason a third time. */
  const releaseRef = useRef({ version: '', notes: '' })
  useEffect(() => {
    releaseRef.current = {
      version: state.release?.version ?? '',
      notes: state.release?.notes ?? '',
    }
  }, [state.release?.version, state.release?.notes])
  useEffect(() => {
    // The reducer owns the buffer — a refused reason keeps the editor open
    // holding it — so the ref follows state rather than the handler guessing.
    reasonRef.current = state.suppress?.reason ?? ''
  }, [state.suppress?.reason])
  useEffect(() => {
    // The reducer owns whether the editor is open — a refused value keeps it up
    // — so the ref follows state rather than the key handler guessing.
    editor.current = { open: state.editing !== null, buffer: state.editing?.buffer ?? '' }
  }, [state.editing])

  const pump = useRef<LogPump | null>(null)
  if (pump.current === null) {
    pump.current = new LogPump({
      ...(intervalMs === undefined ? {} : { intervalMs }),
      onFlush: (lines, dropped) => dispatch({ type: 'log-flush', lines, dropped }),
    })
  }

  useEffect(() => {
    const active = pump.current
    active?.start()
    let live = true
    // Grabbed once and driven by hand, rather than `for await`, so cleanup can
    // call `iterator.return()`: a `next()` awaited when this effect tears down
    // otherwise leaves its resolver parked in the queue's shared FIFO, where a
    // later push would hand it to a dead consumer instead of the one mounted
    // after it — exactly what remounting the Work screen against a live queue
    // does in a test, and what a stale resolver would do for real too.
    const iterator = queue.events[Symbol.asyncIterator]()
    void (async () => {
      while (live) {
        const { value: event, done } = await iterator.next()
        if (done || !live) break
        // Log text goes to the buffer, never through the reducer — R11.4.
        if (event.type === 'run:event' && event.event.type === 'tool:output') {
          active?.write(event.event.toolId, event.event.chunk)
        } else {
          dispatch({ type: 'queue-event', event })
        }
      }
    })()
    return () => {
      live = false
      void iterator.return?.()
      active?.stop()
    }
  }, [queue])

  useEffect(() => {
    void loadSkillStatuses(skills).then((statuses) => dispatch({ type: 'set-statuses', statuses }))
  }, [skills])

  const current = selectedSkill(state)
  useEffect(() => {
    if (!current) return
    if (state.panel === 'skill') {
      void loadSkillMd(current.dir).then((body) => dispatch({ type: 'set-skill-md', body }))
    }
    if (state.panel === 'artefacts') {
      void listArtefacts(current.runDir).then((paths) => dispatch({ type: 'set-artefacts', paths }))
    }
  }, [state.panel, current?.skillId, current?.runDir])

  // R11.10. Lazily, per selected skill: eagerly at launch over 54 skills is 270
  // reads to fill four rows. `skillId` is captured so a response landing after
  // the selection moved still lands on the row it was read for; the reducer
  // holds the precedence rule, because the read can resolve after a `run:start`.
  useEffect(() => {
    if (!current || current.runDir !== null) return
    const skillId = current.skillId
    void loadLastRun(current.workspacePath).then((run) => {
      if (run !== null) dispatch({ type: 'set-last-run', skillId, run })
    })
  }, [current?.skillId, current?.runDir])

  // Keyed on the screen, its filters and `reloads`: a screen the user is not
  // looking at is not queried, and `refresh` is what re-runs the one they are.
  useEffect(() => {
    if (state.pending) return
    // `live` for the reason the tab's effect below has always had one: both
    // effects write one `state.issues`, so a response in flight when the screen
    // changes lands on whichever surface is up by then (R11.13, rev 15).
    let live = true
    const fail = (err: unknown): void => {
      if (live) dispatch({ type: 'view-error', message: (err as Error).message })
    }
    // The Overview card lives on Work (R11.12), so the stats it renders have
    // to load there too — the card is a read of the same dashboard query.
    if (state.screen === 'dashboard' || state.screen === 'work') {
      void views
        .dashboard(state.statsFilter)
        .then((stats) => live && dispatch({ type: 'set-dashboard', stats }), fail)
      void views
        .provenances()
        .then((options) => live && dispatch({ type: 'set-provenances', options }), fail)
    }
    if (state.screen === 'issues') {
      void views
        .issues(state.issueFilter)
        .then((rows) => live && dispatch({ type: 'set-issues', rows, surface: 'screen' }), fail)
    }
    if (state.screen === 'tools') {
      void views.tools().then((report) => live && dispatch({ type: 'set-tools', report }), fail)
    }
    // The setup screen reads the same document, because it stages into it. The
    // palette reaches that screen from anywhere (§14.2), and opened from Work
    // it had no document to stage into: every staging dispatch resolved a base
    // of `undefined` and returned the state unchanged while the wizard walked
    // on to `done` reporting success. Nothing was staged and nothing was said.
    if (state.screen === 'settings' || state.screen === 'setup') {
      void views.settings().then((view) => live && dispatch({ type: 'set-settings', view }), fail)
    }
    return () => {
      live = false
    }
  }, [state.screen, state.statsFilter, state.issueFilter, state.reloads])

  // R11.13's three scopes resolve onto `IssueFilter`'s existing shapes, so the
  // ledger needs no change: a skill id, a repo id, or no filter at all. A second
  // effect rather than a branch in the one above, because its dependencies are
  // the tab's — the panel and the selected skill — and folding them into that
  // list would re-query the Dashboard on every `j` in the skill list.
  useEffect(() => {
    if (state.screen !== 'work' || state.panel !== 'issues') return
    const skill = selectedSkill(state)
    if (!skill) return
    const ref = byId.current.get(skill.skillId)
    const filter =
      state.issueScope === 'skill'
        ? { skillId: skill.skillId }
        : state.issueScope === 'repo' && ref
          ? { repoId: ref.repo.id }
          : {}
    let live = true
    void views.issues(filter).then(
      (rows) => {
        if (live) dispatch({ type: 'set-issues', rows, surface: 'tab' })
      },
      (err: unknown) => {
        if (live) dispatch({ type: 'view-error', message: (err as Error).message })
      },
    )
    return () => {
      live = false
    }
  }, [state.screen, state.panel, state.issueScope, state.selectedSkill, state.reloads, views])

  // R11.16. The preview fires on the transition *out* of the reason editor,
  // not on `begin-suppress`: the reason is part of the entry, so previewing
  // before it is committed would stage a diff with the prefill in it and then
  // have to redo the write.
  useEffect(() => {
    const slot = state.suppress
    if (!slot || slot.editingReason || slot.diff !== '') return
    void views
      .planSuppression({ ...slot.request, reason: slot.reason })
      .then((preview) => {
        if (preview.alreadyPresent) {
          dispatch({ type: 'suppress-error', message: `already suppressed in ${preview.label}` })
          return
        }
        dispatch({
          type: 'suppress-preview',
          label: preview.label,
          diff: preview.diff,
          uncovered: preview.uncovered,
          stages: current ? resumedGates(current.stages) : [...GATE_STAGES],
        })
      })
      .catch((err: unknown) => dispatch({ type: 'suppress-error', message: (err as Error).message }))
  }, [state.suppress?.request, state.suppress?.editingReason])

  const closeSuppress = async (): Promise<void> => {
    await views.discardSuppression().catch(() => undefined)
    dispatch({ type: 'end-suppress' })
  }

  const applySuppression = (slot: NonNullable<AppState['suppress']>): void => {
    void views
      .applySuppression()
      .then(() => {
        const wanted =
          slot.thenRun === 'gates' ? [...GATE_STAGES] : slot.thenRun === 'resume' ? slot.stages : []
        const ref = current ? byId.current.get(current.skillId) : undefined
        if (wanted.length > 0 && ref) queue.enqueue([{ skill: ref, stages: wanted }])
        dispatch({ type: 'end-suppress' })
        // R8.15: the file is the authority and the ledger a cache recomputed on
        // conclusive tool runs, so the ⊘ mark appears only after the re-run.
        // Without this line the user applies, sees the Issues screen unchanged,
        // and concludes nothing happened.
        dispatch({
          type: 'flash',
          message: `${slot.label} written · the mark appears after the re-run`,
          tone: 'good',
        })
      })
      .catch((err: unknown) => dispatch({ type: 'suppress-error', message: (err as Error).message }))
  }

  // R11.18 puts the same three finding actions on a second surface, so each is
  // one function both call. Two copies of `o` is how the pane and the detail
  // come to report a different path for one directory.
  const flash = (message: string, tone?: FlashTone): void =>
    dispatch({ type: 'flash', message, ...(tone === undefined ? {} : { tone }) })

  const shortPath = (path: string): string =>
    truncateMiddle(path, Math.max(20, innerWidth(layout.columns, layout.chrome) - 12))

  /**
   * Quitting is where a staged document is lost, and the wizard stages from a
   * screen that is not Settings — so this guards the document, not the screen.
   * One function for both quit keys, because a refusal spelled at one of the
   * two sites is a refusal the other never makes.
   */
  const quitUnlessStaged = (): void => {
    if (state.staged === null) {
      exit()
      return
    }
    flash(`${configChanges(settingsConfig, state.staged).length} staged · :settings, then c applies`)
  }

  const openEvidence = (artefactDir: string): void => {
    const shown = shortPath(artefactDir)
    void views.openPath(artefactDir).then(
      () => flash(`opened · ${shown}`),
      // Named, never swallowed: a viewer that is not installed is a thing the
      // user can fix, and a silent `o` is one they cannot.
      (err: unknown) => flash(`${(err as Error).message} · ${shown}`, 'bad'),
    )
  }

  /**
   * R11.19. One `planRelease` per marked skill, because both fields it returns
   * are per-skill: the version the bump moves from, and the uncommitted paths
   * the override would cover. The refs it hands back replace `byId`'s for the
   * enqueue — see `ReleasePreviewView.skill` for why the launch-time snapshot
   * cannot be trusted here.
   */
  const beginRelease = (skillIds: readonly string[]): void => {
    void Promise.all(skillIds.map((id) => views.planRelease(id)))
      .then((previews) => {
        dispatch({
          type: 'begin-release',
          skillIds,
          refs: Object.fromEntries(previews.map((preview) => [preview.skill.id, preview.skill])),
          // Merged across the batch: one dirty skill blocks its own release, and
          // the user needs to see every path before deciding on the override.
          dirty: [...new Set(previews.flatMap((preview) => preview.dirty))],
        })
      })
      .catch((err: unknown) => flash((err as Error).message, 'bad'))
  }

  /**
   * R11.21's and R11.22's one entry. Both ports return the finished body, so
   * this decides nothing beyond which one to ask; the refusal — SkillHone
   * unlocked, skill-up unlocked, skill-upper reachable nowhere — reaches the
   * same guard-then-flash shape `y`, `o` and `s` already use.
   */
  const openPrompt = (kind: PromptKind, skillId: string): void => {
    const plan = kind === 'optimise' ? views.planOptimise(skillId) : views.planEvals(skillId)
    void plan.then(
      (preview) => dispatch({ type: 'begin-prompt', kind, skillId, prompt: preview.prompt }),
      (err: unknown) => flash((err as Error).message, 'bad'),
    )
  }

  /**
   * The one place a release job is built. It refuses rather than enqueues when
   * the target does not resolve, because an unresolvable target reaches §12.4
   * row 3 and fails — and a job whose only possible outcome is that failure is
   * the bug this whole surface exists to close.
   */
  const startRelease = (slot: NonNullable<AppState['release']>): void => {
    if (slot.version.trim() === '') {
      dispatch({ type: 'release-error', message: 'a target version is required (R9.10)' })
      return
    }
    if (slot.error !== null) return
    // Built once and shared, because that is the batch's invariant: one target,
    // every marked skill. Rebuilt per skill it would only be stated by repetition.
    const releaseTarget = {
      version: slot.version.trim(),
      ...(slot.notes.trim() === '' ? {} : { notes: slot.notes.trim() }),
    }
    const override = slot.allowDirty ? { allowDirty: true } : {}
    const specs = slot.skillIds.flatMap((id) => {
      const skill = slot.refs[id]
      return skill ? [{ skill, stages: ['release'] as const, releaseTarget, ...override }] : []
    })
    if (specs.length > 0) queue.enqueue(specs)
    dispatch({ type: 'end-release' })
    dispatch({ type: 'clear-marks' })
  }

  const beginSuppress = (skillId: string, chosen: FindingRow): void =>
    dispatch({
      type: 'begin-suppress',
      request: {
        kind: 'finding',
        skillId,
        toolId: chosen.toolId,
        nativeRuleId: chosen.finding.nativeRuleId,
        relPath: chosen.finding.path,
        reason: '',
      },
      toolId: chosen.toolId,
      relPath: chosen.finding.path,
      reason: suppressionPrefill(),
    })

  const copyFixPrompt = (skill: SkillRow, stage: Stage): void => {
    if (skill.runDir === null) {
      // R11.10 rehydrates a recorded run, so this branch now means the skill
      // has never run — where `skillgantry fix` would exit non-zero too.
      flash(`no recorded run for ${skill.skillId} — press r`)
      return
    }
    if (skill.stages[stage].findings === 0) {
      flash(`${stage} found nothing — no prompt`)
      return
    }
    const path = fixPromptPathFor(skill.runDir, stage)
    // Cut in the middle so the basename — the part that tells the user which
    // stage it is — survives the trim.
    const shown = shortPath(path)
    void readFixPrompt(path).then(
      (body) => {
        if (body === null) {
          flash(`not written yet · ${shown}`)
          return
        }
        const seq = osc52(body)
        // Never claims a copy the terminal was never asked to make.
        if (seq === null) {
          flash(`too large to copy · ${shown}`)
          return
        }
        // Not Ink's `write()` from the same hook: that writes *above* the app
        // and forces a clear-and-re-render, flickering the frame for a
        // sequence that renders nothing.
        stdout.write(seq)
        flash(`copied · ${shown}`)
      },
      (err: unknown) => flash(`${(err as Error).message} · ${shown}`),
    )
  }

  useInput((input, key) => {
    // Ink normalises a modified key onto the bare letter — `input` becomes
    // `keypress.name` when ctrl is held, and an alt-prefixed `\x1ba` has its
    // escape stripped — so without this every binding also answers to Ctrl and
    // Alt. Ctrl+A is a reflex keystroke, and on the review screen the `a`
    // binding writes to the user's repo. Escape and the arrows are unaffected:
    // they arrive as named keys with `input` empty.
    const plain = !key.ctrl && !key.meta && !key.super && !key.hyper
    // R11.9's flash is cleared by the next keystroke rather than by a timer, so
    // the frame a test asserts on is the frame the keypress produced.
    if (state.flash !== null) dispatch({ type: 'clear-flash' })
    // Modal like help, and checked first: the review pane is the one screen
    // that wins over every other modal (Work.tsx renders it first for the
    // same reason), so `?` must not sneak help on top of a diff still
    // awaiting an answer.
    if (state.pending) {
      const { jobId, requestId } = state.pending
      if (plain && input === 'a') queue.resolveMutation(jobId, requestId, 'apply')
      else if ((plain && input === 'd') || key.escape) queue.resolveMutation(jobId, requestId, 'discard')
      else if ((plain && input === 'j') || key.downArrow)
        dispatch({ type: 'scroll-review', delta: 1, viewport: reviewRows })
      else if ((plain && input === 'k') || key.upArrow)
        dispatch({ type: 'scroll-review', delta: -1, viewport: reviewRows })
      return
    }
    // Second in precedence, on that order's own principle — what a keystroke
    // can destroy. This `a` writes the user's repo too, but one file it
    // composed itself rather than whatever a tool left in the tree (§12.5).
    if (state.suppress) {
      const slot = state.suppress
      if (slot.editingReason) {
        // The buffer is seeded with the prefill and appended to, unlike the
        // config editor's empty one: a prefill the first keystroke throws away
        // is not a prefill.
        if (key.return) dispatch({ type: 'commit-suppress-reason' })
        else if (key.escape) void closeSuppress()
        else if (key.backspace || key.delete) {
          reasonRef.current = reasonRef.current.slice(0, -1)
          dispatch({ type: 'suppress-reason', reason: reasonRef.current })
        } else if (plain && input.length > 0) {
          reasonRef.current += input
          dispatch({ type: 'suppress-reason', reason: reasonRef.current })
        }
        return
      }
      if (plain && input === 'a') applySuppression(slot)
      else if ((plain && input === 'd') || key.escape) void closeSuppress()
      else if (plain && input === 't') dispatch({ type: 'cycle-then-run' })
      else if ((plain && input === 'j') || key.downArrow)
        dispatch({ type: 'scroll-suppress', delta: 1 })
      else if ((plain && input === 'k') || key.upArrow)
        dispatch({ type: 'scroll-suppress', delta: -1 })
      return
    }
    // Third. Below suppress on that same order — what a keystroke can destroy —
    // because nothing here writes: the pane builds a job, and the write it
    // leads to is still gated by `ReviewPane` above. Above the config
    // confirmation because it is the modal actually on screen.
    if (state.release) {
      const slot = state.release
      if (key.escape) dispatch({ type: 'end-release' })
      else if (key.return) startRelease(slot)
      else if (key.tab) dispatch({ type: 'cycle-release-field' })
      else if (slot.field === 'dirty') {
        // No text field is focused on this stop, so `space` is unambiguous —
        // which is the whole reason the override is a stop rather than a letter.
        if (plain && input === ' ') dispatch({ type: 'toggle-allow-dirty' })
      } else if (key.backspace || key.delete) {
        const buffer = releaseRef.current[slot.field].slice(0, -1)
        releaseRef.current = { ...releaseRef.current, [slot.field]: buffer }
        dispatch({ type: 'release-field', value: buffer })
      } else if (plain && input.length > 0) {
        const buffer = releaseRef.current[slot.field] + input
        releaseRef.current = { ...releaseRef.current, [slot.field]: buffer }
        dispatch({ type: 'release-field', value: buffer })
      }
      return
    }
    // Fourth: the config confirmation writes ~/.skillgantry/config.json, which
    // is SkillGantry's own file rather than the user's repo.
    if (state.confirm && state.staged !== null) {
      const staged = state.staged
      if (plain && input === 'a') {
        // Which repos the session is working on was decided by the discovery
        // `startTui` ran at launch, so a repo this write adds is on Settings
        // and not in the skill list. The pane said "next launch" before the
        // write; this says it after, where the user is looking for the repo.
        const repoChange = configChanges(settingsConfig, staged).some((change) =>
          change.path.startsWith('repos['),
        )
        void views
          .applyConfig(staged)
          .then(() => {
            dispatch({ type: 'discard-staged' })
            dispatch({ type: 'close-confirm' })
            // Re-read rather than patch: the file is the authority for what the
            // write actually produced, origins included.
            dispatch({ type: 'refresh-views' })
            flash(
              repoChange
                ? 'config.json written · its skills are listed after a relaunch'
                : 'config.json written',
              'good',
            )
          })
          // The staging survives a failed write, so the user can retry it.
          .catch((err: unknown) =>
            dispatch({ type: 'view-error', message: (err as Error).message }),
          )
      } else if (plain && input === 'd') {
        dispatch({ type: 'discard-staged' })
      } else if (key.escape) {
        dispatch({ type: 'close-confirm' })
      } else if ((plain && input === 'j') || key.downArrow) {
        dispatch({ type: 'scroll-screen', delta: 1, viewport: screenBodyRows(layout) })
      } else if ((plain && input === 'k') || key.upArrow) {
        dispatch({ type: 'scroll-screen', delta: -1, viewport: screenBodyRows(layout) })
      }
      return
    }
    // Fifth: R11.21's and R11.22's shared surface, whose keys destroy nothing —
    // it builds no job and writes no byte, which is why it sits below all three
    // write panes and above the setup screen. The render order below carries
    // the same order.
    if (state.prompt) {
      const slot = state.prompt
      if (key.escape) dispatch({ type: 'end-prompt' })
      else if (plain && input === 'y') {
        const seq = osc52(slot.prompt)
        if (seq === null) {
          // An action able to report only success is the failure §14.3 exists
          // to prevent, and a prompt over the cap is exactly that case.
          flash(`too large to copy · ${slot.skillId}`)
        } else {
          // Not Ink's `write()` from the same hook: that writes above the app
          // and forces a clear-and-re-render, flickering the frame for a
          // sequence that renders nothing.
          stdout.write(seq)
          flash(`${slot.kind} prompt copied · ${slot.skillId}`)
        }
      } else if ((plain && input === 'j') || key.downArrow) {
        dispatch({ type: 'scroll-prompt', delta: 1, viewport: reviewRows })
      } else if ((plain && input === 'k') || key.upArrow) {
        dispatch({ type: 'scroll-prompt', delta: -1, viewport: reviewRows })
      }
      return
    }
    // Third, per §14.2's precedence, and above every binding below rather than
    // below them: the wizard's own handler is the only one that may act while it
    // is up. Its repo step is a text field, and the wizard guarded its own keys
    // against that — but this handler runs too, so `q` in a path quit the whole
    // session with the staged configuration in it, `esc` jumped to Work instead
    // of stepping back, and `:` opened the palette over the wizard.
    if (state.screen === 'setup') return
    // Text entry wins over every single-letter command, for the reason the
    // wizard's own handler documents: a value is digits and a path is letters,
    // and either would otherwise steer the screen instead of filling the field.
    // `:` included — a colon is a character a user can legitimately type.
    if (editor.current.open) {
      // The buffer comes off the ref for the reason the palette's does: React
      // batches the keypresses that arrive in one tick, so reading it from state
      // loses every character but the last.
      const write = (buffer: string): void => {
        editor.current = { open: true, buffer }
        dispatch({ type: 'edit-input', buffer })
      }
      if (key.escape) {
        editor.current = { open: false, buffer: '' }
        dispatch({ type: 'cancel-edit' })
      } else if (key.return) {
        // Closed here rather than after the render: keys arriving in the same
        // tick as the enter — `c` in `e4\rc` — belong to the screen, not to a
        // field the user has already submitted. The effect reopens it when
        // `stage-edit` refused the value, which is the only case it stays up.
        editor.current = { open: false, buffer: '' }
        dispatch({ type: 'stage-edit' })
      } else if (key.backspace || key.delete) write(editor.current.buffer.slice(0, -1))
      else if (plain && input.length > 0) write(editor.current.buffer + input)
      return
    }
    if (plain && input === 'q') {
      quitUnlessStaged()
      return
    }
    if (palette.current.open) {
      const matches = paletteMatches(palette.current.query)
      const type = (query: string): void => {
        palette.current = { open: true, query }
        dispatch({ type: 'palette-input', query })
      }
      const close = (): void => {
        palette.current = { open: false, query: '' }
        dispatch({ type: 'palette-close' })
      }
      if (key.escape) close()
      else if (key.return) {
        const chosen = matches[state.palette.selected]
        palette.current = { open: false, query: '' }
        if (chosen?.action.kind === 'screen') {
          dispatch({ type: 'set-screen', screen: chosen.action.screen })
        } else if (chosen?.action.kind === 'refresh') {
          dispatch({ type: 'refresh-views' })
          dispatch({ type: 'palette-close' })
        } else if (chosen?.action.kind === 'prompt') {
          // R11.22: the selected skill, whatever the suite's state. A surface
          // reachable only when the file is missing would be unreachable the
          // moment it had done its job.
          const target = selectedSkill(state)?.skillId
          dispatch({ type: 'palette-close' })
          if (target === undefined) flash('no skill selected')
          else openPrompt(chosen.action.prompt, target)
        } else if (chosen?.action.kind === 'quit') {
          dispatch({ type: 'palette-close' })
          quitUnlessStaged()
        } else close()
      } else if (key.downArrow || (key.ctrl && input === 'n')) {
        dispatch({ type: 'palette-move', delta: 1 })
      } else if (key.upArrow || (key.ctrl && input === 'p')) {
        dispatch({ type: 'palette-move', delta: -1 })
      } else if (key.backspace || key.delete) {
        type(palette.current.query.slice(0, -1))
      } else if (plain && input.length > 0) {
        type(palette.current.query + input)
      }
      return
    }
    if (plain && input === ':') {
      palette.current = { open: true, query: '' }
      dispatch({ type: 'palette-open' })
      return
    }
    // R11.18. Below the palette, because its keys destroy nothing — and the
    // ordering is forced rather than merely consistent: `s` here opens the
    // suppress pane, so a detail that outranked it would swallow the pane it
    // had just summoned. Above the `esc` below, which would otherwise send a
    // detail opened over the Issues screen to Work instead of closing it.
    if (state.detail !== null) {
      const detail = state.detail
      if (key.escape) dispatch({ type: 'close-detail' })
      else if ((plain && input === 'j') || key.downArrow || (plain && input === 'k') || key.upArrow) {
        // Clamped against the rows the pane will actually render, at the width
        // it will render them — `outputWindow`'s rule, for the same reason.
        const rows = detailRows(detail, Math.max(8, innerWidth(layout.columns, layout.chrome)))
        dispatch({
          type: 'scroll-detail',
          delta: (plain && input === 'k') || key.upArrow ? -1 : 1,
          viewport: screenBodyRows(layout),
          total: rows.length,
        })
      } else if (plain && input === 'o') {
        if (detail.kind === 'finding') openEvidence(detail.row.artefactDir)
        else flash('an issue has no artefact directory — open it from a finding')
      } else if (plain && input === 'y') {
        // The Issues screen is cross-repo and holds no rail, so a prompt is only
        // answerable for a finding on the skill the Work screen has selected.
        if (detail.kind === 'finding' && current) copyFixPrompt(current, detail.row.stage)
        else flash('no recorded run here — copy the prompt from the Work screen')
      } else if (plain && input === 's') {
        if (detail.kind === 'finding' && current) beginSuppress(current.skillId, detail.row)
        else if (detail.kind === 'issue') flash('accept it from Issues · esc, then :issues')
      }
      return
    }
    // esc anywhere but Work goes home, so a user who palette-jumped by mistake
    // is one keystroke from where they came from.
    if (key.escape && state.screen !== 'work') {
      dispatch({ type: 'set-screen', screen: 'work' })
      return
    }
    if (state.screen === 'settings') {
      const rows = settingsRows(state, innerWidth(columns, layout.chrome))
      const actionable = rows.flatMap((row) => (row.action ? [row.action] : []))
      const selected = actionable[state.settingsCursor]
      if ((plain && input === 'j') || key.downArrow) {
        dispatch({ type: 'settings-cursor', delta: 1, count: actionable.length })
      } else if ((plain && input === 'k') || key.upArrow) {
        dispatch({ type: 'settings-cursor', delta: -1, count: actionable.length })
      } else if (plain && input === 'e' && selected?.kind === 'edit-scalar') {
        editor.current = { open: true, buffer: '' }
        dispatch({ type: 'begin-edit', field: selected.field, current: selected.current })
      } else if (plain && input === 'd' && selected?.kind === 'remove-repo') {
        dispatch({ type: 'stage-remove-repo', repoId: selected.repoId })
      } else if (plain && input === 'c') {
        dispatch({ type: 'open-confirm' })
      }
      return
    }
    if (state.screen === 'tools') {
      if (plain && input === 'r') {
        // A re-probe, not a migration: `tools()` invokes each binary's version
        // argv, which is what R3.9 means by re-verify.
        dispatch({ type: 'refresh-views' })
      } else if ((plain && input === 'j') || key.downArrow) {
        dispatch({ type: 'scroll-screen', delta: 1, viewport: screenBodyRows(layout) })
      } else if ((plain && input === 'k') || key.upArrow) {
        dispatch({ type: 'scroll-screen', delta: -1, viewport: screenBodyRows(layout) })
      }
      return
    }
    if (state.screen === 'issues') {
      const row = state.issues[state.selectedIssue]
      const act = (action: IssueAction): void => {
        if (!row) return
        // Re-read rather than patch: a locally-patched row the current filter no
        // longer admits stays on screen and cannot be acted on again, and the
        // ledger is the authority for what the transition actually produced.
        void views
          .actOnIssue(row.fingerprint, action)
          .then(() => dispatch({ type: 'refresh-views' }))
          .catch((err: unknown) =>
            dispatch({ type: 'view-error', message: (err as Error).message }),
          )
      }
      if ((plain && input === 'j') || key.downArrow) dispatch({ type: 'select-issue', delta: 1 })
      else if ((plain && input === 'k') || key.upArrow) dispatch({ type: 'select-issue', delta: -1 })
      // R11.18's third surface. The row truncates its path and elides its
      // suppression reason to fit the fixed columns; this is where both are read.
      else if (key.return && row) dispatch({ type: 'open-detail', detail: { kind: 'issue', row } })
      else if (plain && input === 'a') act('acknowledge')
      else if (plain && input === 'w') act('wontfix')
      else if (plain && input === 'o') act('reopen')
      // R11.16's second surface. `s` is free here — Dashboard's `s` is its
      // skill filter and the Work screen's issue-scope cycle is uppercase `S`.
      else if (plain && input === 's') {
        if (row) {
          dispatch({
            type: 'begin-suppress',
            request: {
              kind: 'issue',
              skillId: row.skillId,
              fingerprint: row.fingerprint,
              reason: '',
            },
            toolId: row.detectors.join(', '),
            relPath: row.relPath,
            reason: suppressionPrefill(),
          })
        }
      } else if (plain && input === 'f') {
        const states: Array<IssueState | undefined> = [
          undefined,
          'open',
          'acknowledged',
          'wontfix',
          'fixed',
        ]
        const next = states[(states.indexOf(state.issueFilter.state) + 1) % states.length]
        dispatch({ type: 'set-issue-filter', filter: next === undefined ? {} : { state: next } })
      }
      return
    }
    if (state.screen === 'dashboard') {
      if (plain && input === 'p') {
        // Cycles through the options and past the end to unfiltered, so the key
        // that applies a filter is also the key that removes it.
        const ids: Array<string | undefined> = [
          undefined,
          ...state.provenances.map((option) => option.fingerprint),
        ]
        const next = ids[(ids.indexOf(state.statsFilter.provenanceFp) + 1) % ids.length]
        dispatch({
          type: 'set-stats-filter',
          filter: next === undefined ? {} : { provenanceFp: next },
        })
      } else if (plain && input === 's') {
        const skillId = state.statsFilter.skillId === undefined ? current?.skillId : undefined
        dispatch({ type: 'set-stats-filter', filter: skillId === undefined ? {} : { skillId } })
      } else if ((plain && input === 'j') || key.downArrow) {
        dispatch({ type: 'scroll-screen', delta: 1, viewport: screenBodyRows(layout) })
      } else if ((plain && input === 'k') || key.upArrow) {
        dispatch({ type: 'scroll-screen', delta: -1, viewport: screenBodyRows(layout) })
      }
      return
    }
    if (plain && input === '?') {
      dispatch({ type: 'toggle-help' })
      return
    }
    // Help is modal: swallowing movement while it is open keeps the selection
    // where the user left it rather than scrolling a screen they cannot see.
    if (state.help) {
      if (key.escape) dispatch({ type: 'toggle-help', open: false })
      return
    }
    // Every binding below belongs to Work. `r` on the Issues screen must not
    // enqueue a batch and `x` must not cancel a job the user cannot see, so the
    // guard is one gate rather than a condition repeated eight times.
    if (state.screen !== 'work') return
    if (key.tab) {
      dispatch({ type: 'cycle-focus', delta: key.shift ? -1 : 1 })
      return
    }
    // R11.12's way out of the card. The existing screen, not a modal: R11.3
    // requires the screen to exist and `esc` already returns to Work.
    if (plain && input === '0') {
      dispatch({ type: 'set-screen', screen: 'dashboard' })
      return
    }
    // R11.11, rev 15: the key moves focus to the pane it names rather than
    // acting on it from another zone. Reading these as screen-level keys
    // licensed exactly the action at a distance the zone rule forbids, and
    // scoping them strictly would have cost a `tab` to reach a pane the key
    // already names.
    if (plain && input >= '1' && input <= '5') {
      dispatch({ type: 'set-panel', panel: PANELS[Number(input) - 1]! })
      dispatch({ type: 'set-focus', focus: 'work' })
      return
    }
    // R11.13's scope cycle. The tab binds no state transition — `a`, `w` and `o`
    // stay on the Issues screen, because `o` on this pane means "open the
    // artefact directory" and one pane whose key means two things across two of
    // its own tabs is a keymap that cannot be learned.
    // Scoped to the zone that owns the pane, like `o` and `s` below (R11.11,
    // rev 15): cycling the scope from the Log tab, or from the skill list,
    // changes state nothing on screen reflects.
    if (plain && input === 'S' && state.panel === 'issues' && state.focus === 'work') {
      dispatch({ type: 'cycle-issue-scope' })
      return
    }
    if ((plain && input === 'j') || key.downArrow) {
      dispatch(moveDown(state, layout, current, 1))
      return
    }
    if ((plain && input === 'k') || key.upArrow) {
      dispatch(moveDown(state, layout, current, -1))
      return
    }
    // R11.11: the rail belongs to the work zone. It fired in every zone before,
    // so moving down the skill list moved the rail with it and nothing on
    // screen said so — and the rail describes the *selected* skill, so moving
    // both at once is how a user loses track of which stage they are reading.
    // The horizontal arrows alias the pair (R11.11, rev 15). The vertical pair
    // has been aliased in every block above since M2 while this one was bound
    // nowhere, so a user who reached for `←` got silence and no way to learn why.
    if ((plain && (input === 'h' || input === 'l')) || key.leftArrow || key.rightArrow) {
      const inward = input === 'l' || key.rightArrow
      // R11.23. The pair had a meaning in one zone and returned early in the
      // other, so it was bound nowhere in the skill list — which the two levels
      // of that column now give it. Inward only from the repo level: there is
      // nothing under a skill, and making `l` jump zones instead would put a
      // third meaning on a pair R11.11 scopes to one. Outward always, so the
      // binding does not change meaning with how many repos are registered.
      if (state.focus === 'skills') {
        if (inward) {
          if (state.listLevel === 'repos') dispatch({ type: 'enter-repo' })
          return
        }
        dispatch({ type: 'leave-repo' })
        return
      }
      if (state.focus !== 'work') return
      dispatch({ type: 'select-stage', delta: inward ? 1 : -1 })
      return
    }
    if (plain && input === ' ') {
      if (state.focus === 'queue') return
      if (state.focus === 'work') {
        // R11.20. The rail is R11.1's five stages whatever is configured, so a
        // mark is the one place that can tell the user a stage has nothing
        // behind it. Without this the mark lands, `r` enqueues, and the engine
        // answers with a refusal from inside a run that should never have
        // started — `optimise` ships no adapter (D7), and reached
        // `AdapterStageExecutor.plan()`'s R4.11 rejection every time.
        //
        // `stages` is the configured selection, which is what makes a gate
        // runnable; a native stage is runnable whatever `stageTools` says, and
        // the predicate is core's so this cannot drift from the executor
        // factory that answers the same question.
        const marking = STAGE_ORDER[state.selectedStage] as Stage
        if (marking === 'optimise') {
          // R11.20 as amended: optimise has a native *action*, not an executor,
          // so its runnability is a fact about the lock rather than about the
          // configuration. `stageTools` can never hold SkillHone — it is
          // catalogued `stage: null` precisely so it cannot — so a guard
          // reading `stages` here would refuse a tool that is installed.
          if (!optimiseReady) {
            // The wizard is a screen since §14.2, so the recovery is a
            // keystroke away rather than a quit and a shell command.
            flash('skillhone not installed · :setup installs it')
            return
          }
        } else if (!isNativeStage(marking) && !stages.includes(marking)) {
          flash(`${marking} has no tool selected · :settings configures one`)
          return
        }
        dispatch({ type: 'toggle-stage-mark' })
        return
      }
      if (state.listLevel === 'repos') {
        flash(NO_REPO_MARK)
        return
      }
      dispatch({ type: 'toggle-skill-mark' })
      return
    }
    // R11.18's two Work surfaces. Read-only, so the Issues tab may bind it —
    // R11.13 forbids that tab a state *transition*, which this is not.
    if (key.return && state.focus === 'work') {
      if (state.panel === 'findings') {
        const chosen = current?.findings[state.selectedFinding]
        if (chosen) dispatch({ type: 'open-detail', detail: { kind: 'finding', row: chosen } })
        else flash(NO_FINDINGS)
        return
      }
      if (state.panel === 'issues') {
        const row = state.issues[state.selectedTabIssue]
        if (row) dispatch({ type: 'open-detail', detail: { kind: 'issue', row } })
        return
      }
    }
    // R11.16's first surface, gated on the Findings pane exactly as `o` below
    // is: the Issues *tab* binds no state-changing key (R11.13).
    if (plain && input === 's' && state.panel === 'findings' && state.focus === 'work') {
      const chosen = current?.findings[state.selectedFinding]
      if (!chosen || !current) {
        flash(NO_FINDINGS)
        return
      }
      beginSuppress(current.skillId, chosen)
      return
    }
    // Gated on the Findings pane, so the Issues tab's `o` stays unbound: its
    // state transitions live on the Issues screen, and one pane whose key means
    // two things across two of its own tabs is a keymap nobody can learn (R11.13).
    if (plain && input === 'o' && state.panel === 'findings' && state.focus === 'work') {
      const chosen = current?.findings[state.selectedFinding]
      if (!chosen) {
        flash(NO_FINDINGS)
        return
      }
      openEvidence(chosen.artefactDir)
      return
    }
    if (plain && input === 'y') {
      if (!current) return
      // R11.9 as amended: the stage that produced the *selected finding* when the
      // Findings pane holds one, and the rail's stage otherwise. §14.3 recorded
      // that a finding "cannot be attributed to a stage at all" — `FindingRow`
      // is that attribution, so a user acting on a finding no longer has to move
      // the rail to the stage that found it. §9.4 still writes one prompt per
      // stage, so what is copied is still a stage's.
      const chosenFinding =
        state.panel === 'findings' ? current.findings[state.selectedFinding] : undefined
      copyFixPrompt(current, chosenFinding?.stage ?? (STAGE_ORDER[state.selectedStage] as Stage))
      return
    }
    if (plain && input === 'r') {
      // R5.5: every marked skill and stage becomes one batch, one call.
      const chosen = state.markedSkills.length > 0 ? state.markedSkills : [current?.skillId]
      const wanted = state.markedStages.length > 0 ? state.markedStages : stages
      // R11.19. Release needs a target before a job can exist, so `r` opens the
      // surface that collects one instead of enqueuing. It is its own batch and
      // not a stage of a longer chain: the gates it depends on must already have
      // passed against these bytes (R9.9), so running them in the same job would
      // release against a digest the ledger has not recorded a pass for.
      if (wanted.includes('release')) {
        // Refused rather than resolved either way, because both resolutions are
        // a lie about what the marks asked for. Running the gates in the same
        // job would record their pass and then release against it in one breath,
        // which is the retroactive authorisation R9.9 exists to refuse; dropping
        // them silently — what this did — left a user marking `evaluate` to fix
        // a failing gate, pressing `r`, and getting the release surface again
        // with no word that `evaluate` had been discarded.
        if (wanted.length > 1) {
          flash('release runs on its own — unmark it, or unmark the other stages')
          return
        }
        const ids = chosen.filter((id): id is string => id !== undefined)
        if (ids.length > 0) beginRelease(ids)
        return
      }
      // R11.21. Optimise opens a surface and enqueues nothing: SkillGantry
      // composes the prompt and hands it over, and R6.12 forbids it running the
      // optimiser. Its own batch for release's reason — a mixed mark cannot be
      // resolved either way without lying about what was asked for.
      if (wanted.includes('optimise')) {
        if (wanted.length > 1) {
          flash('optimise runs on its own — unmark it, or unmark the other stages')
          return
        }
        const ids = chosen.filter((id): id is string => id !== undefined)
        // One skill: SkillHone's loop is per-skill by construction, one skill
        // repo against one eval repo, so a prompt naming five is five loops in
        // one paste.
        if (ids.length > 1) {
          flash('optimise takes one skill at a time — unmark the others')
          return
        }
        const only = ids[0]
        if (only !== undefined) openPrompt('optimise', only)
        return
      }
      // One call rather than two copies of it: the suite-present path below
      // reaches the same enqueue, and two copies is how one of them comes to
      // build a different batch.
      const enqueue = (): void => {
        const specs = chosen
          .flatMap((id) => (id ? [byId.current.get(id)] : []))
          .flatMap((skill) => (skill ? [{ skill, stages: wanted }] : []))
        if (specs.length > 0) queue.enqueue(specs)
        dispatch({ type: 'clear-marks' })
      }
      // R11.22. The evaluate gate cannot start without `evals/eval.yaml`, so a
      // skill carrying none reaches the surface that hands over the prompt for
      // authoring one rather than a run whose only outcome is
      // errored/missing-artefact. One skill only: the prompt is per-skill by
      // construction, and N port reads to build N prompts nobody asked for is
      // the wrong trade — a suite-less skill inside a batch still errors, and
      // `:evals` on the selection is the recovery.
      const evalIds = chosen.filter((id): id is string => id !== undefined)
      const soleSkill = evalIds.length === 1 ? evalIds[0] : undefined
      if (wanted.includes('evaluate') && soleSkill !== undefined) {
        void views.planEvals(soleSkill).then(
          (preview) => {
            if (preview.hasSuite) {
              enqueue()
              return
            }
            // Refused rather than resolved, §14.9's rule and for its reason:
            // both resolutions of a mixed mark lie about what the marks asked
            // for, and dropping the others silently is the failure release
            // shipped with.
            if (wanted.length > 1) {
              flash(`${soleSkill} has no eval suite · unmark the others to compose one`, 'bad')
              return
            }
            openPrompt('evals', soleSkill)
          },
          // A pre-flight that cannot answer must not silently enqueue a run the
          // gate cannot start, so the refusal names the tool and stops.
          (err: unknown) => flash((err as Error).message, 'bad'),
        )
        return
      }
      enqueue()
      return
    }
    if (plain && input === 'x') {
      // R11.11: the job cursor lives in the queue zone, so this is where it acts.
      if (state.focus !== 'queue') return
      const job = state.jobs[state.selectedJob]
      if (job) void queue.cancelJob(job.jobId)
    }
  })

  // The review pane stays the first branch: it is the one screen that wins over
  // every modal, because `a` on it writes to the user's repo.
  if (state.pending) return <Work state={state} />
  // Second, for the key handler's reason: its `a` writes the user's repo.
  if (state.suppress) return <SuppressPane suppress={state.suppress} layout={layout} />
  // Third, matching the key handler's precedence exactly: two orders that can
  // disagree is how a keystroke reaches a pane the user is not looking at.
  if (state.release) return <ReleaseTargetPane release={state.release} layout={layout} />
  if (state.confirm && state.staged !== null) {
    return (
      <ConfirmPane
        changes={configChanges(settingsConfig, state.staged)}
        configPath={state.settings?.configPath ?? ''}
        offset={state.screenOffset}
        layout={layout}
      />
    )
  }
  // §14.2 orders the modals by what a keystroke can destroy, and this pane's
  // keys destroy nothing: it builds no job and writes no byte. Below the three
  // write panes, above the palette.
  if (state.prompt) {
    return <PromptPane prompt={state.prompt} flash={state.flash} layout={layout} />
  }
  if (state.palette.open) return <PaletteScreen state={state} />
  // R11.18: after the palette and the two write panes above, per §14.2's order
  // — what a keystroke here can destroy is nothing.
  if (state.detail !== null) return <DetailPane state={state} />
  switch (state.screen) {
    case 'dashboard':
      return <Dashboard state={state} dispatch={dispatch} />
    case 'issues':
      return <Issues state={state} />
    case 'tools':
      return <Tools state={state} dispatch={dispatch} />
    case 'settings':
      return <Settings state={state} dispatch={dispatch} />
    case 'setup':
      return <SetupScreen state={state} dispatch={dispatch} driver={setup} />
    default:
      return <Work state={state} />
  }
}
