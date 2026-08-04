import { useEffect, useReducer, useRef } from 'react'
import { Box, Text, useApp, useInput, useWindowSize } from 'ink'
import {
  DEFAULT_CONFIG,
  configChanges,
} from '../core/index.js'
import type {
  IssueAction,
  IssueState,
  QueueHandle,
  SetupDriver,
  SkillRef,
  Stage,
} from '../core/index.js'
import { ConfirmPane } from './components/ConfirmPane.js'
import { Dashboard } from './components/Dashboard.js'
import { Issues } from './components/Issues.js'
import { Palette } from './components/Palette.js'
import { Settings } from './components/Settings.js'
import { Setup } from './components/Setup.js'
import { Tools } from './components/Tools.js'
import { Work } from './components/Work.js'
import {
  innerWidth,
  layoutFor,
  reviewDiffRows,
  screenBodyRows,
  truncate,
  type Layout,
} from './layout.js'
import { LogPump } from './log-buffer.js'
import { outputWindow, settingsRows } from './rows.js'
import { useSetupSession } from './use-setup-session.js'
import { PANELS, initialState, paletteMatches, reducer, selectedSkill } from './store.js'
import type { Action, AppState, SkillRow } from './store.js'
import { type GantryViews, listArtefacts, loadSkillMd, loadSkillStatuses } from './views.js'

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
  const locked = state.settings?.lockedTools ?? []
  const session = useSetupSession({
    driver,
    seed: {
      selected: [...new Set([...Object.values(config?.stageTools ?? {}).flat(), ...locked])],
      installed: Object.fromEntries(locked.map((id) => [id, 'ok' as const])),
    },
    onSelection: (selected) => dispatch({ type: 'stage-selection', selected }),
    // Resolved here rather than in the hook: staging needs the canonical path
    // and the git flag, and this is the caller that needs them — the CLI's
    // `registerRepo` does its own inspection and must not pay for a second.
    onRepo: async (path) => {
      const result = await driver.inspectRepo(path)
      if (!result.isDirectory) throw new Error(`no such directory: ${result.resolved}`)
      if (result.alreadyRegistered) throw new Error(`already registered: ${result.resolved}`)
      dispatch({ type: 'stage-repo', entry: { path: result.resolved, isGit: result.isGit } })
    },
    onExit: () => dispatch({ type: 'set-screen', screen: 'settings' }),
  })
  return (
    <Setup
      state={session.state}
      cursor={session.cursor}
      draftPath={session.path}
      inspection={session.inspection}
      error={session.error}
      exitLabel="settings"
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
  if (state.focus !== 'output') return { type: 'select-skill', delta }
  const view = outputWindow(state, skill, layout.outputHeight)
  return {
    type: 'scroll-output',
    delta,
    viewport: view.rows,
    total: view.total,
    anchor: view.anchor,
  }
}

/** The palette above the same footer hint every screen prints. */
function PaletteScreen({ state }: { state: AppState }): React.ReactElement {
  const { columns, rows } = useWindowSize()
  const layout = layoutFor(columns, rows)
  return (
    <Box flexDirection="column" width={columns}>
      <Palette palette={state.palette} layout={layout} />
      <Text dimColor>{truncate('enter run · esc cancel', columns)}</Text>
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

  // Keyed on the screen, its filters and `reloads`: a screen the user is not
  // looking at is not queried, and `refresh` is what re-runs the one they are.
  useEffect(() => {
    if (state.pending) return
    const fail = (err: unknown): void =>
      dispatch({ type: 'view-error', message: (err as Error).message })
    if (state.screen === 'dashboard') {
      void views
        .dashboard(state.statsFilter)
        .then((stats) => dispatch({ type: 'set-dashboard', stats }), fail)
      void views
        .provenances()
        .then((options) => dispatch({ type: 'set-provenances', options }), fail)
    }
    if (state.screen === 'issues') {
      void views.issues(state.issueFilter).then((rows) => dispatch({ type: 'set-issues', rows }), fail)
    }
    if (state.screen === 'tools') {
      void views.tools().then((report) => dispatch({ type: 'set-tools', report }), fail)
    }
    if (state.screen === 'settings') {
      void views.settings().then((view) => dispatch({ type: 'set-settings', view }), fail)
    }
  }, [state.screen, state.statsFilter, state.issueFilter, state.reloads])

  useInput((input, key) => {
    // Ink normalises a modified key onto the bare letter — `input` becomes
    // `keypress.name` when ctrl is held, and an alt-prefixed `\x1ba` has its
    // escape stripped — so without this every binding also answers to Ctrl and
    // Alt. Ctrl+A is a reflex keystroke, and on the review screen the `a`
    // binding writes to the user's repo. Escape and the arrows are unaffected:
    // they arrive as named keys with `input` empty.
    const plain = !key.ctrl && !key.meta && !key.super && !key.hyper
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
    // Second in precedence, ordered by what a keystroke costs: the review's `a`
    // writes the user's repo, this one writes ~/.skillgantry/config.json.
    if (state.confirm && state.staged !== null) {
      const staged = state.staged
      if (plain && input === 'a') {
        void views
          .applyConfig(staged)
          .then(() => {
            dispatch({ type: 'discard-staged' })
            dispatch({ type: 'close-confirm' })
            // Re-read rather than patch: the file is the authority for what the
            // write actually produced, origins included.
            dispatch({ type: 'refresh-views' })
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
      exit()
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
        } else if (chosen?.action.kind === 'quit') exit()
        else close()
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
      else if (plain && input === 'a') act('acknowledge')
      else if (plain && input === 'w') act('wontfix')
      else if (plain && input === 'o') act('reopen')
      else if (plain && input === 'f') {
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
    if (plain && input >= '1' && input <= '4') {
      dispatch({ type: 'set-panel', panel: PANELS[Number(input) - 1]! })
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
    if (plain && input === 'h') {
      dispatch({ type: 'select-stage', delta: -1 })
      return
    }
    if (plain && input === 'l') {
      dispatch({ type: 'select-stage', delta: 1 })
      return
    }
    if (plain && input === ' ') {
      dispatch(
        state.focus === 'stages' ? { type: 'toggle-stage-mark' } : { type: 'toggle-skill-mark' },
      )
      return
    }
    if (plain && input === 'r') {
      // R5.5: every marked skill and stage becomes one batch, one call.
      const chosen = state.markedSkills.length > 0 ? state.markedSkills : [current?.skillId]
      const wanted = state.markedStages.length > 0 ? state.markedStages : stages
      const specs = chosen
        .flatMap((id) => (id ? [byId.current.get(id)] : []))
        .flatMap((skill) => (skill ? [{ skill, stages: wanted }] : []))
      if (specs.length > 0) queue.enqueue(specs)
      dispatch({ type: 'clear-marks' })
      return
    }
    if (plain && input === 'x') {
      const job = state.jobs[state.selectedJob]
      if (job) void queue.cancelJob(job.jobId)
    }
  })

  // The review pane stays the first branch: it is the one screen that wins over
  // every modal, because `a` on it writes to the user's repo.
  if (state.pending) return <Work state={state} />
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
  if (state.palette.open) return <PaletteScreen state={state} />
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
