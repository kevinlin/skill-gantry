import { useEffect, useReducer, useRef, useState } from 'react'
import { useInput, usePaste } from 'ink'
import {
  SELECTABLE_CATALOGUE,
  SETUP_ORDER,
  canEnter,
  entryBlockedReason,
  expandSelection,
  initialSetupState,
  setupReducer,
  type InstallState,
  type RepoEntry,
  type RepoInspection,
  type SetupDriver,
  type SetupState,
  type SetupStateName,
} from '../core/index.js'

const PRESET_KEY: Record<string, 'minimal' | 'recommended' | 'everything'> = {
  '1': 'minimal',
  '2': 'recommended',
  '3': 'everything',
}

/** Long enough that a held-down key does not fire a stat per character. */
const INSPECT_DEBOUNCE_MS = 120

export interface SetupSessionOptions {
  driver: SetupDriver
  /** What a re-entered wizard starts from; absent on a clean machine. */
  seed?: { selected?: readonly string[]; installed?: Readonly<Record<string, InstallState>> }
  /**
   * R3.12's registered repos. A parameter and not reducer state: the two
   * callers hold different documents — the CLI's is on disk, §14.2's screen
   * stages its own — so one field in the reducer would mean two things.
   */
  repos?: readonly RepoEntry[]
  /** Where the chosen tools go. `skillgantry setup` writes; the screen stages. */
  onSelection: (selected: readonly string[]) => void
  /** The typed path, resolved by whoever consumes it. Deliberately not the
      inspection: adding a second round trip here doubled the wizard's submit
      latency, which is the whole of what `enter` on the repo step costs.
      `replacing` is the id of the repo the cursor sits on, or null to add. */
  onRepo: (path: string, replacing: string | null) => Promise<void> | void
  /** Leaving: the CLI exits the process, the screen returns to Settings. */
  onExit: () => void
}

export interface SetupSession {
  state: SetupState
  cursor: number
  path: string
  inspection: RepoInspection | null
  error: string | null
  /** Indexes `[...repos, <register another>]`, so the last slot adds. */
  repoCursor: number
}

/**
 * The wizard's whole behaviour, minus where its results go. Both callers drive
 * the same states, the same guards and the same key handling: a second
 * implementation of tool selection would let `skillgantry setup` and the
 * Settings screen disagree about which tools a stage may run, and R3.5b makes
 * that disagreement fail every run of that stage.
 */
export function useSetupSession({
  driver,
  seed,
  repos = [],
  onSelection,
  onRepo,
  onExit,
}: SetupSessionOptions): SetupSession {
  const [state, dispatch] = useReducer(setupReducer, seed, initialSetupState)
  const [cursor, setCursor] = useState(0)
  const [path, setPath] = useState('')
  const [inspection, setInspection] = useState<RepoInspection | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The id under the cursor, or null for the `register another` slot — which
  // is where the step starts, so a clean machine and the existing add flow are
  // unchanged. An id and not an index: §14.2's screen renders before its config
  // has loaded, so an index seeded from an empty list would point at the wrong
  // row the moment the list arrived, and it is the id `onRepo` needs anyway.
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)
  const at = repos.findIndex((repo) => repo.id === selectedRepo)
  const repoCursor = at === -1 ? repos.length : at

  const probe = (): void => {
    void driver.probe().then((runtimes) => dispatch({ type: 'probed', runtimes }))
  }

  useEffect(probe, [driver])

  // Sequence-guarded: inspections resolve out of order when a slow stat on a
  // half-typed path lands after the complete one, which would show the user a
  // verdict about a prefix of what they typed.
  const inspectSeq = useRef(0)
  useEffect(() => {
    if (path.trim().length === 0) {
      setInspection(null)
      return
    }
    // Kept, not cleared, when the step is left: the done screen reports the
    // resolved path rather than the shorthand the user typed.
    if (state.state !== 'credentials-and-repo') return
    const seq = (inspectSeq.current += 1)
    const timer = setTimeout(() => {
      void driver.inspectRepo(path).then(
        (result) => {
          if (seq === inspectSeq.current) setInspection(result)
        },
        () => {
          if (seq === inspectSeq.current) setInspection(null)
        },
      )
    }, INSPECT_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [driver, path, state.state])

  /** Sequential: two package managers writing one tool root is not worth it. */
  const installAll = async (ids: readonly string[]): Promise<void> => {
    // Already installed and verified, so the step reports it rather than
    // repeating it: changing one tool otherwise reinstalls the whole selection.
    const already = new Set(await driver.installedTools())
    const usable: string[] = []
    for (const id of ids) {
      if (already.has(id)) {
        dispatch({ type: 'installed', toolId: id })
        usable.push(id)
        continue
      }
      dispatch({ type: 'installing', toolId: id })
      try {
        await driver.install(id)
        dispatch({ type: 'installed', toolId: id })
        usable.push(id)
      } catch (err) {
        dispatch({ type: 'install-failed', toolId: id, error: (err as Error).message })
      }
    }
    onSelection(ids)
    // R3.10, after the loop rather than inside it: composing a tool's own
    // configuration reads the credential file, which the loop above has no
    // business touching. Only what installed — a tool that failed has nothing
    // to configure, and a row saying its config was written would be a lie
    // about a tool the step above just reported as failed.
    for (const id of usable) {
      const outcome = await driver.configure(id)
      dispatch({ type: 'tool-configured', toolId: id, outcome })
    }
    dispatch({ type: 'credentials', ...(await driver.credentialStatus()) })
  }

  /**
   * Registration is the one wizard action that can fail on input the user can
   * correct, so its rejection becomes a message. Left unhandled it reached
   * Node's default handler and killed the wizard with the terminal in raw mode.
   */
  /**
   * The field is the editor, so moving the cursor rewrites it. A half-typed
   * path is lost, which is the cost of editing at this grain; a draft per slot
   * would be state proportional to the repo count for a walk taken once.
   */
  const moveRepoCursor = (delta: number): void => {
    const next = repoCursor + delta
    if (next < 0 || next > repos.length) return
    const target = repos[next]
    setSelectedRepo(target?.id ?? null)
    setPath(target?.path ?? '')
    setError(null)
  }

  const submitRepo = (): void => {
    if (path.trim().length === 0) {
      // Emptying the field is not a delete, on either slot: removal is
      // Settings' `d`, behind a change set, and a destructive key beside a free
      // text field is where a stray keystroke costs the most.
      setError('type a repo path first, or press ctrl-d to finish without one')
      return
    }
    setError(null)
    void Promise.resolve(onRepo(path, selectedRepo))
      .then(() => {
        dispatch({ type: 'repo', path })
        dispatch({ type: 'enter', state: 'done' })
      })
      .catch((err: Error) => setError(err.message))
  }

  const advance = (): void => {
    const next = SETUP_ORDER[SETUP_ORDER.indexOf(state.state) + 1] as SetupStateName | undefined
    if (!next) return
    if (next === 'install-and-verify' && canEnter(state, next)) {
      dispatch({ type: 'enter', state: next })
      // R3.8 as amended: skill-upper is a dependent, not a choice, so it is
      // added here rather than in `state.selected` — the list on screen stays
      // what the user picked, and `stageToolsFor` drops it anyway, having no
      // adapter.
      void installAll(expandSelection(state.selected))
      return
    }
    if (next === 'done') {
      submitRepo()
      return
    }
    const blocked = entryBlockedReason(state, next)
    if (blocked !== null) {
      setError(blocked)
      return
    }
    setError(null)
    dispatch({ type: 'enter', state: next })
  }

  const back = (): void => {
    const previous = SETUP_ORDER[
      Math.max(0, SETUP_ORDER.indexOf(state.state) - 1)
    ] as SetupStateName
    setError(null)
    dispatch({ type: 'enter', state: previous })
  }

  // Bracketed paste, so a pasted repo path arrives whole. Ink routes it away
  // from useInput, where the single-character guard below would drop it.
  usePaste((text) => {
    if (state.state !== 'credentials-and-repo') return
    setPath((p) => p + text.replace(/[\r\n]+/g, ''))
  })

  useInput((input, key) => {
    // Text entry is handled before any single-letter command, because a repo
    // path contains 'b', 'p' and 'q' and would otherwise steer the wizard.
    if (state.state === 'credentials-and-repo') {
      if (key.return) advance()
      else if (key.escape) back()
      else if (key.ctrl && input === 'd') {
        dispatch({ type: 'skip-repo' })
        dispatch({ type: 'enter', state: 'done' })
      }
      // Arrows, and deliberately not j/k: this is the state where a letter is
      // typed rather than obeyed, which is why this branch sits above the
      // commands at all. R3.12.
      else if (key.upArrow) moveRepoCursor(-1)
      else if (key.downArrow) moveRepoCursor(1)
      else if (key.backspace || key.delete) setPath((p) => p.slice(0, -1))
      else if (input.length > 0 && !key.ctrl && !key.meta) setPath((p) => p + input)
      return
    }
    if (input === 'q') {
      onExit()
      return
    }
    if (input === 'p') {
      probe()
      return
    }
    if (input === 'b') {
      back()
      return
    }
    if (key.return) {
      advance()
      return
    }
    if (state.state === 'select-tools') {
      // Bound to a local first: an element access on a non-literal key is not
      // narrowed under noUncheckedIndexedAccess.
      const preset = PRESET_KEY[input]
      if (preset) {
        dispatch({ type: 'preset', name: preset })
        return
      }
      if (input === 'j' || key.downArrow) {
        setCursor((c) => Math.min(SELECTABLE_CATALOGUE.length - 1, c + 1))
        return
      }
      if (input === 'k' || key.upArrow) {
        setCursor((c) => Math.max(0, c - 1))
        return
      }
      if (input === ' ') {
        const spec = SELECTABLE_CATALOGUE[cursor]
        if (spec) dispatch({ type: 'toggle', toolId: spec.id })
      }
    }
  })

  return { state, cursor, path, inspection, error, repoCursor }
}
