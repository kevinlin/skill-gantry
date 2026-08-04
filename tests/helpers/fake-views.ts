import { DEFAULT_CONFIG } from '../../src/core/config/config.js'
import type {
  DashboardStats,
  SetupDriver,
  DoctorReport,
  IssueRow,
  ProvenanceOption,
} from '../../src/core/index.js'
import type { GantryViews, SettingsView } from '../../src/tui/views.js'

export const emptyDashboard: DashboardStats = {
  repos: 0,
  skills: 0,
  runs: 0,
  stagePassRates: [],
  wallClock: [],
  evalCases: { casesTotal: 0, casesPassed: 0, casesErrored: 0, rate: null },
  openBySeverity: [],
  openByRuleClass: [],
  history: [],
}

export const emptyDoctor: DoctorReport = { runtimes: [], tools: [], lifecycle: [], failed: false }

/** The shipped shapes, so a fixture cannot drift from what `doctor` returns. */
export const toolFinding = (
  toolId: string,
  kind: DoctorReport['tools'][number]['kind'],
  detail = '',
): DoctorReport['tools'][number] => ({
  toolId,
  kind,
  expectedVersion: null,
  actualVersion: null,
  detail,
})

export const emptySettings: SettingsView = {
  home: '/home/.skillgantry',
  dbPath: '/home/.skillgantry/gantry.db',
  configPath: '/home/.skillgantry/config.json',
  envPath: '/home/.skillgantry/.env',
  lockPath: '/home/.skillgantry/tools/lock.json',
  config: { ...DEFAULT_CONFIG, stageTools: { ...DEFAULT_CONFIG.stageTools, security: [] } },
  presentKeys: [],
  concurrency: 2,
  repos: [],
  stageTools: { validate: [], evaluate: [], security: [], optimise: [] },
  lockedTools: [],
  toolTimeouts: [],
  credentials: [],
  envWarnings: [],
  ruleMap: { applied: 1, current: 1 },
}

export interface FakeViews extends GantryViews {
  /** Every action the screens asked for, in order. */
  readonly actions: Array<[string, string]>
}

/** No sqlite, no spawn: the screens are pure functions of what this returns. */
export function fakeViews(overrides: Partial<GantryViews> = {}): FakeViews {
  const actions: Array<[string, string]> = []
  return {
    actions,
    dashboard: async () => emptyDashboard,
    provenances: async (): Promise<ProvenanceOption[]> => [],
    issues: async (): Promise<IssueRow[]> => [],
    actOnIssue: async (fingerprint, action) => {
      actions.push([fingerprint, action])
      return 'acknowledged'
    },
    tools: async () => emptyDoctor,
    settings: async () => emptySettings,
    applyConfig: async () => undefined,
    ...overrides,
  }
}

export interface FakeSetupDriver extends SetupDriver {
  /** Selections and repos the wizard tried to write, so a test can assert it did not. */
  readonly saved: string[][]
  readonly registered: string[]
}

/** No spawn, no filesystem: the wizard's effects as resolved promises. */
export function fakeSetupDriver(over: Partial<SetupDriver> = {}): FakeSetupDriver {
  const saved: string[][] = []
  const registered: string[] = []
  return {
    saved,
    registered,
    probe: async () => [
      { runtime: 'uv' as const, present: true, version: '0.7.12', installCommand: 'curl uv | sh' },
    ],
    install: async () => undefined,
    installedTools: async () => [],
    saveSelection: async (selected) => {
      saved.push([...selected])
    },
    credentialStatus: async () => ({ present: false, warnings: [] }),
    inspectRepo: async (path) => ({
      resolved: path,
      isDirectory: true,
      alreadyRegistered: false,
      skillCount: 3,
      isGit: true,
    }),
    registerRepo: async (path) => {
      registered.push(path)
    },
    ...over,
  }
}
