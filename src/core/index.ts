export * from './types.js'
export * from './pipeline/events.js'
export { runPipeline, type RunHandle, type RunSummary } from './pipeline/run.js'
export { openLedger, type Ledger } from './ledger/db.js'
export { readLifecycleCache, syncLifecycle, type LifecycleState } from './ledger/lifecycle.js'
export { GATE_STAGES, latestGateOutcomes, type GateOutcome } from './ledger/gates.js'
export { RULE_CLASS_MAP_VERSION } from './adapters/rule-classes.js'
export {
  appliedRuleMapVersion,
  migrateRuleMap,
  type RuleMapMigrationResult,
} from './ledger/rule-map-migration.js'
export { discoverSkills, workspacePath } from './discovery/discover.js'
export {
  inspectRepo,
  loadConfig,
  loadToolLock,
  registerRepo,
  type GantryConfig,
  type RepoInspection,
} from './config/config.js'
export {
  configChanges,
  withRepo,
  withScalar,
  withStageTools,
  withoutRepo,
  type ConfigChange,
  type ScalarField,
} from './config/edit.js'
export { loadEnvFile, provenanceOf } from './config/env.js'
export { createQueue, type QueueOptions } from './queue/pool.js'
export {
  MUTATING_STAGES,
  isMutatingJob,
  type JobRecord,
  type JobSpec,
  type JobState,
  type QueueEvent,
  type QueueHandle,
  type QueueSnapshot,
} from './queue/types.js'
export type { CancelPhase, RunPhase } from './pipeline/cancellation.js'
export type {
  PendingMutation,
  StageContext,
  StageResult,
  ToolRunRecord,
} from './stages/types.js'
export { STAGE_ORDER } from './workspace/layout.js'
export { readIndex, type IndexEntry } from './workspace/writer.js'
export {
  CATALOGUE,
  PRESETS,
  RELEASE_TOOL_ID,
  catalogueEntry,
  catalogueIds,
  expandPreset,
  toolsForStage,
  type PresetName,
  type Runtime,
  type ToolSpec,
} from './tools/catalogue.js'
export { installTool, toolRoot, verifyTool } from './tools/install.js'
export {
  INSTALL_COMMAND,
  probeRuntimes,
  runtimesFor,
  type RuntimeStatus,
} from './tools/runtimes.js'
export {
  doctor,
  type DoctorInput,
  type DoctorReport,
  type LifecycleFinding,
  type ToolDriftKind,
  type ToolFinding,
} from './tools/doctor.js'
export { canonicalisePath, saveConfig, saveToolLock } from './config/config.js'
export {
  SETUP_ORDER,
  canEnter,
  entryBlockedReason,
  initialSetupState,
  missingRuntimesFor,
  setupReducer,
  stageToolsFor,
  type InstallState,
  type SetupAction,
  type SetupDriver,
  type SetupState,
  type SetupStateName,
} from './tools/setup.js'
export {
  forgetInterrupted,
  restoreInterrupted,
  scanInterrupted,
  type InterruptedMutation,
} from './isolation/recover.js'
export { retireSkill, type RetireInput, type RetireResult } from './release/retire.js'
export type {
  ChangeEntry,
  ChangeKind,
  ChangeSet,
  MutationSandbox,
  Preimage,
  SandboxRecord,
  SandboxStrategy,
} from './isolation/types.js'
export {
  dashboard,
  evalCaseRate,
  openIssueCounts,
  provenanceOptions,
  runHistory,
  stagePassRates,
  stageWallClock,
  type DashboardStats,
  type EvalCaseRate,
  type ProvenanceOption,
  type RuleClassCount,
  type RunHistoryRow,
  type SeverityCount,
  type StagePassRate,
  type StageWallClock,
  type StatsFilter,
} from './ledger/stats.js'
export { provenanceFingerprint, type ProvenanceLike } from './ledger/fingerprint.js'
export {
  listIssues,
  setIssueState,
  type IssueFilter,
  type IssueRow,
} from './ledger/issue-queries.js'
export {
  detectorSaysGone,
  stateOnUserAction,
  type IssueAction,
  type IssueState,
} from './ledger/issues.js'
