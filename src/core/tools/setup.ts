import type { GantryConfig } from '../config/schema.js'
import type { Stage } from '../types.js'
import { PRESETS, type PresetName, catalogueEntry } from './catalogue.js'
import { type RuntimeStatus, runtimesFor } from './runtimes.js'

export type SetupStateName =
  | 'probe-runtimes'
  | 'select-tools'
  | 'install-and-verify'
  | 'credentials-and-repo'
  | 'done'

export const SETUP_ORDER: readonly SetupStateName[] = [
  'probe-runtimes',
  'select-tools',
  'install-and-verify',
  'credentials-and-repo',
  'done',
]

export type InstallState = 'pending' | 'installing' | 'ok' | 'failed'

export interface SetupState {
  state: SetupStateName
  runtimes: readonly RuntimeStatus[]
  selected: readonly string[]
  installed: Readonly<Record<string, InstallState>>
  errors: Readonly<Record<string, string>>
  repoPath: string | null
  credentials: { present: boolean; warnings: readonly string[] } | null
}

export function initialSetupState(): SetupState {
  return {
    state: 'probe-runtimes',
    runtimes: [],
    selected: [],
    installed: {},
    errors: {},
    repoPath: null,
    credentials: null,
  }
}

export type SetupAction =
  | { type: 'probed'; runtimes: readonly RuntimeStatus[] }
  | { type: 'preset'; name: PresetName }
  | { type: 'toggle'; toolId: string }
  | { type: 'installing'; toolId: string }
  | { type: 'installed'; toolId: string }
  | { type: 'install-failed'; toolId: string; error: string }
  | { type: 'credentials'; present: boolean; warnings: readonly string[] }
  | { type: 'repo'; path: string }
  | { type: 'enter'; state: SetupStateName }

/**
 * Each state is independently re-enterable, which R3.6 requires and doctor
 * relies on: it reuses probe-runtimes and install-and-verify alone. Entry is
 * gated on the prerequisite rather than on having visited the previous state,
 * so backing out of an install to reselect keeps the selection.
 */
export function canEnter(state: SetupState, target: SetupStateName): boolean {
  switch (target) {
    case 'probe-runtimes':
      return true
    case 'select-tools':
      return state.runtimes.length > 0
    case 'install-and-verify':
      return state.selected.length > 0
    case 'credentials-and-repo':
      return state.selected.every((id) => state.installed[id] === 'ok')
    case 'done':
      return state.repoPath !== null
  }
}

export function setupReducer(state: SetupState, action: SetupAction): SetupState {
  switch (action.type) {
    case 'probed':
      return { ...state, runtimes: action.runtimes }
    case 'preset':
      return { ...state, selected: PRESETS[action.name], installed: {}, errors: {} }
    case 'toggle': {
      const selected = state.selected.includes(action.toolId)
        ? state.selected.filter((id) => id !== action.toolId)
        : [...state.selected, action.toolId]
      return { ...state, selected }
    }
    case 'installing':
      return { ...state, installed: { ...state.installed, [action.toolId]: 'installing' } }
    case 'installed':
      return { ...state, installed: { ...state.installed, [action.toolId]: 'ok' } }
    case 'install-failed':
      return {
        ...state,
        installed: { ...state.installed, [action.toolId]: 'failed' },
        errors: { ...state.errors, [action.toolId]: action.error },
      }
    case 'credentials':
      return { ...state, credentials: { present: action.present, warnings: action.warnings } }
    case 'repo':
      return { ...state, repoPath: action.path }
    case 'enter':
      return canEnter(state, action.state) ? { ...state, state: action.state } : state
  }
}

/** R3.7: named so the wizard can show the official command, never run it. */
export function missingRuntimesFor(
  selected: readonly string[],
  runtimes: readonly RuntimeStatus[],
): readonly RuntimeStatus[] {
  const needed = new Set(
    runtimesFor(selected.flatMap((id) => (catalogueEntry(id) ? [catalogueEntry(id)!] : []))),
  )
  return runtimes.filter((status) => needed.has(status.runtime) && !status.present)
}

/**
 * A literal tuple, not `readonly Stage[]`: widening it to `Stage` would make the
 * mapped record below claim a `release` key `stageTools` does not have.
 */
const RUNNABLE_STAGES = ['validate', 'evaluate', 'security', 'optimise'] as const

type RunnableStage = (typeof RUNNABLE_STAGES)[number]

const isRunnableStage = (stage: Stage): stage is RunnableStage =>
  (RUNNABLE_STAGES as readonly Stage[]).includes(stage)

/**
 * A selection is what a run may pick, so it holds only tools the adapter
 * registry knows: `AdapterStageExecutor.plan()` throws on an unknown id, which
 * would fail every run of that stage. An installed tool without a parser is
 * reported as installed and not yet runnable.
 */
export function stageToolsFor(
  selected: readonly string[],
  isRunnable: (toolId: string) => boolean,
): GantryConfig['stageTools'] {
  const tools: Record<RunnableStage, string[]> = {
    validate: [],
    evaluate: [],
    security: [],
    optimise: [],
  }
  for (const id of selected) {
    const spec = catalogueEntry(id)
    if (!spec?.stage || !isRunnable(id)) continue
    if (!isRunnableStage(spec.stage)) continue
    tools[spec.stage].push(id)
  }
  return tools
}

/** The effects the wizard is not allowed to own; wired in src/cli. */
export interface SetupDriver {
  probe(): Promise<readonly RuntimeStatus[]>
  install(toolId: string): Promise<void>
  saveSelection(selected: readonly string[]): Promise<void>
  credentialStatus(): Promise<{ present: boolean; warnings: readonly string[] }>
  registerRepo(path: string): Promise<void>
}
