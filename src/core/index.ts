export * from './types.js'
export * from './pipeline/events.js'
export { VERSION } from './version.js'
export { runPipeline, type RunHandle, type RunSummary } from './pipeline/run.js'
export { openLedger, type Ledger } from './ledger/db.js'
export { readLifecycleCache, syncLifecycle, type LifecycleState } from './ledger/lifecycle.js'
export { GATE_STAGES, latestGateOutcomes, type GateOutcome } from './ledger/gates.js'
export { RULE_CLASS_MAP_VERSION } from './adapters/rule-classes.js'
export { hasAdapter } from './adapters/registry.js'
export {
  appliedRuleMapVersion,
  migrateRuleMap,
  type RuleMapMigrationResult,
} from './ledger/rule-map-migration.js'
export { WRITE_TEMP_NAME } from './discovery/candidate.js'
export { discoverSkills, workspacePath } from './discovery/discover.js'
export {
  DEFAULT_CONFIG,
  inspectRepo,
  loadConfig,
  loadToolLock,
  registerRepo,
  updateRepo,
  type GantryConfig,
  type RepoEntry,
  type RepoInspection,
} from './config/config.js'
export {
  configChanges,
  withRepo,
  withRepoPath,
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
export { isNativeStage } from './stages/types.js'
export { buildFixPrompt, type FixPromptInput } from './stages/fix-prompt.js'
export { buildOptimisePrompt, type OptimisePromptInput } from './stages/optimise-prompt.js'
export { buildEvalPrompt, type EvalPromptInput } from './stages/eval-prompt.js'
export {
  STAGE_ORDER,
  fixPromptPathFor,
  runsRoot,
  stageDirFor,
  toolDirFor,
} from './workspace/layout.js'
export { readIndex, type IndexEntry } from './workspace/writer.js'
export {
  CATALOGUE,
  PRESETS,
  RELEASE_TOOL_ID,
  SELECTABLE_CATALOGUE,
  SKILLHONE_TOOL_ID,
  SKILL_UPPER_TOOL_ID,
  SKILL_UP_TOOL_ID,
  catalogueEntry,
  catalogueIds,
  expandPreset,
  expandSelection,
  toolsForStage,
  type GitSkillSpec,
  type PresetName,
  type Runtime,
  type ToolSpec,
} from './tools/catalogue.js'
export { installTool, toolRoot, verifyTool } from './tools/install.js'
export { defaultExec, type Exec } from './tools/exec.js'
export {
  RUNTIME_SKILL_DIRS,
  detectSkillDirs,
  gitSkillUninstall,
  type GitSkillInstall,
} from './tools/git-skill.js'
export {
  serialiseSkillhoneSettings,
  settingsDigest,
  skillhoneSettings,
  skillhoneSettingsPath,
  writeSkillhoneSettings,
  type ConfigureOutcome,
  type SkillhoneProfile,
  type SkillhoneSettings,
} from './tools/skillhone-settings.js'
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
  type UpgradeFinding,
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
export { releaseDirtyPaths } from './release/preflight.js'
export { compareSemver, isBumpLevel, resolveTargetVersion } from './release/version.js'
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
  issueDetectionRules,
  listIssues,
  setIssueState,
  type DetectionRule,
  type IssueFilter,
  type IssueRow,
} from './ledger/issue-queries.js'
export {
  detectorSaysGone,
  detectorSuppressed,
  issueSuppression,
  stateOnUserAction,
  type DetectorSuppressionRow,
  type IssueAction,
  type IssueState,
} from './ledger/issues.js'
export { recomputeIssueSuppression } from './ledger/reconcile.js'
export { actionableFindings } from './stages/outcome.js'
export { appendEntries, type AppendResult } from './suppress/document.js'
export { globEscape, skillRelative, suppressionEntry, type FindingVars } from './suppress/entry.js'
export {
  applySuppression,
  discardSuppression,
  planSuppression,
  type PlanInput,
  type SuppressionPlan,
} from './suppress/write.js'
export {
  previewSuppression,
  type PreviewInput,
  type SuppressionPreview,
  type SuppressionRequest,
} from './suppress/target.js'
export {
  applyUpgrade,
  type ApplyOptions,
  type ApplyResult,
  type ApplyStep,
} from './upgrade/apply.js'
export { entriesAbove, parseChangelog } from './upgrade/changelog.js'
export {
  DEFAULT_REPO,
  THROTTLE_MS,
  checkForUpgrade,
  type CheckOptions,
} from './upgrade/check.js'
export { resolveEligibility } from './upgrade/eligible.js'
export { loadUpgradeState, saveUpgradeState } from './upgrade/state.js'
export type {
  ChangelogEntry,
  Eligibility,
  ReleaseInfo,
  UpgradeCheck,
  UpgradeState,
} from './upgrade/types.js'
