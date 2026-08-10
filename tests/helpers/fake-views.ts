import { DEFAULT_CONFIG } from '../../src/core/config/config.js'
import type {
  DashboardStats,
  SetupDriver,
  DoctorReport,
  IssueRow,
  ProvenanceOption,
  SkillRef,
  SuppressionRequest,
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
  /** Paths the screens asked the host to open, in order. */
  readonly opened: string[]
  /** Suppression requests the screens staged, and how each was resolved. */
  readonly suppressions: SuppressionRequest[]
  readonly suppressResolutions: Array<'apply' | 'discard'>
  /** Skill ids the release surface pre-flighted, in order. */
  readonly releasePlans: string[]
  /** Skill ids the optimise surface pre-flighted, in order. */
  readonly optimisePlans: string[]
}

/**
 * No sqlite, no spawn: the screens are pure functions of what this returns.
 *
 * `skills` seeds `planRelease`, which is the one view keyed to a skill the
 * caller also renders — a fake returning an unrelated ref would let a test pass
 * while the enqueued job carried the wrong skill.
 */
export function fakeViews(
  overrides: Partial<GantryViews> = {},
  releaseSkills: readonly SkillRef[] = [],
): FakeViews {
  const actions: Array<[string, string]> = []
  const opened: string[] = []
  const suppressions: SuppressionRequest[] = []
  const suppressResolutions: Array<'apply' | 'discard'> = []
  const releasePlans: string[] = []
  const optimisePlans: string[] = []
  return {
    actions,
    opened,
    suppressions,
    suppressResolutions,
    releasePlans,
    optimisePlans,
    openPath: async (path) => {
      opened.push(path)
    },
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
    // R11.19. Returns the ref the App was rendered with, so a test that does
    // not care about the re-read gets the skill it already knows; a test that
    // does care overrides this and asserts the enqueued job carries the fresh
    // one rather than `byId`'s.
    planRelease: async (skillId) => {
      releasePlans.push(skillId)
      const skill = releaseSkills.find((candidate) => candidate.id === skillId)
      if (skill === undefined) throw new Error(`no skill ${skillId}`)
      return { skill, dirty: [] }
    },
    planOptimise: async (skillId) => {
      optimisePlans.push(skillId)
      const skill = releaseSkills.find((candidate) => candidate.id === skillId)
      if (skill === undefined) throw new Error(`no skill ${skillId}`)
      return { skill, prompt: `# Optimise: ${skill.name}\n\n- Skill directory: \`${skill.dir}\`\n`, missing: [] }
    },
    planSuppression: async (request) => {
      suppressions.push(request)
      return {
        label: 'declawed/.skillspector-baseline.yaml',
        diff: '@@ -3,2 +3,6 @@\n rules:\n+- id: MP2\n',
        uncovered: [],
        alreadyPresent: false,
      }
    },
    applySuppression: async () => {
      suppressResolutions.push('apply')
    },
    discardSuppression: async () => {
      suppressResolutions.push('discard')
    },
    ...overrides,
  }
}

export interface FakeSetupDriver extends SetupDriver {
  /** Selections and repos the wizard tried to write, so a test can assert it did not. */
  readonly saved: string[][]
  readonly registered: string[]
  /** R3.12's replacements, as `[repoId, path]`. */
  readonly updated: Array<[string, string]>
}

/** No spawn, no filesystem: the wizard's effects as resolved promises. */
export function fakeSetupDriver(over: Partial<SetupDriver> = {}): FakeSetupDriver {
  const saved: string[][] = []
  const registered: string[] = []
  const updated: Array<[string, string]> = []
  return {
    saved,
    registered,
    updated,
    probe: async () => [
      { runtime: 'uv' as const, present: true, version: '0.7.12', installCommand: 'curl uv | sh' },
    ],
    install: async () => undefined,
    configure: async () => ({ kind: 'skipped' as const }),
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
    updateRepo: async (repoId, path) => {
      updated.push([repoId, path])
    },
    ...over,
  }
}
