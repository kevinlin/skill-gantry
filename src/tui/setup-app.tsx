import { useEffect, useReducer, useState } from 'react'
import { useApp, useInput } from 'ink'
import {
  CATALOGUE,
  SETUP_ORDER,
  canEnter,
  initialSetupState,
  setupReducer,
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

export function SetupApp({ driver }: SetupAppProps): React.ReactElement {
  const [state, dispatch] = useReducer(setupReducer, undefined, initialSetupState)
  const [cursor, setCursor] = useState(0)
  const [path, setPath] = useState('')
  const { exit } = useApp()

  const probe = (): void => {
    void driver.probe().then((runtimes) => dispatch({ type: 'probed', runtimes }))
  }

  useEffect(probe, [driver])

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

  const advance = (): void => {
    const next = SETUP_ORDER[SETUP_ORDER.indexOf(state.state) + 1] as SetupStateName | undefined
    if (!next) return
    if (next === 'install-and-verify' && canEnter(state, next)) {
      dispatch({ type: 'enter', state: next })
      void installAll(state.selected)
      return
    }
    if (next === 'done' && path.length > 0) {
      void driver.registerRepo(path).then(() => {
        dispatch({ type: 'repo', path })
        dispatch({ type: 'enter', state: 'done' })
      })
      return
    }
    dispatch({ type: 'enter', state: next })
  }

  const back = (): void => {
    const previous = SETUP_ORDER[
      Math.max(0, SETUP_ORDER.indexOf(state.state) - 1)
    ] as SetupStateName
    dispatch({ type: 'enter', state: previous })
  }

  useInput((input, key) => {
    // Text entry is handled before any single-letter command, because a repo
    // path contains 'b', 'p' and 'q' and would otherwise steer the wizard.
    if (state.state === 'credentials-and-repo') {
      if (key.return) advance()
      else if (key.escape) back()
      else if (key.backspace || key.delete) setPath((p) => p.slice(0, -1))
      else if (input.length === 1 && !key.ctrl && !key.meta) setPath((p) => p + input)
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

  return <Setup state={state} cursor={cursor} />
}
