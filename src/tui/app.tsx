import { useEffect, useReducer, useRef } from 'react'
import { Box, Text, useApp, useInput, useWindowSize } from 'ink'
import type {
  IssueAction,
  IssueState,
  QueueHandle,
  SkillRef,
  Stage,
} from '../core/index.js'
import { Dashboard } from './components/Dashboard.js'
import { Issues } from './components/Issues.js'
import { Palette } from './components/Palette.js'
import { Settings } from './components/Settings.js'
import { Tools } from './components/Tools.js'
import { Work } from './components/Work.js'
import { layoutFor, reviewDiffRows, screenBodyRows, truncate } from './layout.js'
import { LogPump } from './log-buffer.js'
import { PANELS, initialState, paletteMatches, reducer, selectedSkill } from './store.js'
import type { AppState } from './store.js'
import { type GantryViews, listArtefacts, loadSkillMd, loadSkillStatuses } from './views.js'

export interface AppProps {
  skills: readonly SkillRef[]
  queue: QueueHandle
  /** Stages enqueued when the user has marked none. */
  stages: readonly Stage[]
  concurrency: number
  /** R11.3's screens read the ledger through this; the TUI may not open it. */
  views: GantryViews
  /** Flush interval, lowered in tests. */
  intervalMs?: number
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
  intervalMs,
}: AppProps): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, skills, (list) => initialState(list, concurrency))
  // The scroll clamp needs the same row count the review pane renders, and
  // `layout.ts` is the one place that decides it (§14.1's third rule).
  const { columns, rows } = useWindowSize()
  const layout = layoutFor(columns, rows)
  const reviewRows = reviewDiffRows(layout)
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
    if (plain && input === 'q') {
      exit()
      return
    }
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
    if (state.screen === 'tools' || state.screen === 'settings') {
      if (plain && input === 'r' && state.screen === 'tools') {
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
      dispatch(
        state.focus === 'queue'
          ? { type: 'select-job', delta: 1 }
          : { type: 'select-skill', delta: 1 },
      )
      return
    }
    if ((plain && input === 'k') || key.upArrow) {
      dispatch(
        state.focus === 'queue'
          ? { type: 'select-job', delta: -1 }
          : { type: 'select-skill', delta: -1 },
      )
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
    default:
      return <Work state={state} />
  }
}
