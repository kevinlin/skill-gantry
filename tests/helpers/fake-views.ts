import type {
  DashboardStats,
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
  concurrency: 2,
  repos: [],
  stageTools: { validate: [], evaluate: [], security: [], optimise: [] },
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
    ...overrides,
  }
}
