import { useEffect, useReducer, useRef, useState } from 'react'
import { useApp, useInput, usePaste } from 'ink'
import {
  CATALOGUE,
  SETUP_ORDER,
  canEnter,
  entryBlockedReason,
  initialSetupState,
  setupReducer,
  type RepoInspection,
  type SetupDriver,
  type SetupStateName,
} from '../core/index.js'
import { Setup } from './components/Setup.js'

export interface SetupAppProps {
  driver: SetupDriver
}

const PRESET_KEY: Record<string, 'minimal' | 'recommended' | 'everything'> = {
  '1': 'minimal',
  '2': 'recommended',
  '3': 'everything',
}

/** Long enough that a held-down key does not fire a stat per character. */
const INSPECT_DEBOUNCE_MS = 120

export function SetupApp({ driver }: SetupAppProps): React.ReactElement {
  const [state, dispatch] = useReducer(setupReducer, undefined, initialSetupState)
  const [cursor, setCursor] = useState(0)
  const [path, setPath] = useState('')
  const [inspection, setInspection] = useState<RepoInspection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { exit } = useApp()

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
    for (const id of ids) {
      dispatch({ type: 'installing', toolId: id })
      try {
        await driver.install(id)
        dispatch({ type: 'installed', toolId: id })
      } catch (err) {
        dispatch({ type: 'install-failed', toolId: id, error: (err as Error).message })
      }
    }
    await driver.saveSelection(ids)
    const credentials = await driver.credentialStatus()
    dispatch({ type: 'credentials', ...credentials })
  }

  /**
   * Registration is the one wizard action that can fail on input the user can
   * correct, so its rejection becomes a message. Left unhandled it reached
   * Node's default handler and killed the wizard with the terminal in raw mode.
   */
  const submitRepo = (): void => {
    if (path.trim().length === 0) {
      setError('type a repo path first, or press ctrl-d to finish without one')
      return
    }
    setError(null)
    void driver.registerRepo(path).then(
      () => {
        dispatch({ type: 'repo', path })
        dispatch({ type: 'enter', state: 'done' })
      },
      (err: Error) => setError(err.message),
    )
  }

  const advance = (): void => {
    const next = SETUP_ORDER[SETUP_ORDER.indexOf(state.state) + 1] as SetupStateName | undefined
    if (!next) return
    if (next === 'install-and-verify' && canEnter(state, next)) {
      dispatch({ type: 'enter', state: next })
      void installAll(state.selected)
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
      else if (key.backspace || key.delete) setPath((p) => p.slice(0, -1))
      else if (input.length > 0 && !key.ctrl && !key.meta) setPath((p) => p + input)
      return
    }
    if (input === 'q') {
      exit()
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
        setCursor((c) => Math.min(CATALOGUE.length - 1, c + 1))
        return
      }
      if (input === 'k' || key.upArrow) {
        setCursor((c) => Math.max(0, c - 1))
        return
      }
      if (input === ' ') {
        const spec = CATALOGUE[cursor]
        if (spec) dispatch({ type: 'toggle', toolId: spec.id })
      }
    }
  })

  return (
    <Setup state={state} cursor={cursor} draftPath={path} inspection={inspection} error={error} />
  )
}
