export type Stage = 'validate' | 'evaluate' | 'security' | 'optimise' | 'release'

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

/**
 * The one severity ordering. It lives here rather than in either consumer
 * because the ledger aggregates severities and the outcome model compares them
 * against a floor, and a second copy of this table would go stale the day
 * `Severity` gains a member.
 */
const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
}

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b
}

export function atLeastSeverity(s: Severity, floor: Severity): boolean {
  return SEVERITY_RANK[s] >= SEVERITY_RANK[floor]
}

export type ToolOutcome = 'passed' | 'failed' | 'errored' | 'skipped'

export type StageOutcome = 'passed' | 'failed' | 'degraded' | 'errored' | 'skipped'

/** One per non-passing row of the R4.13 classification table. */
export type ErrorKind =
  | 'spawn'
  | 'timeout'
  | 'missing-artefact'
  | 'parse'
  | 'cancelled'
  | 'not-installed'
  | 'no-credentials'
  | 'no-authorisation'
  | 'artefact-too-large'
  /**
   * Row 3b. A stage, not a tool: the change set was built and authorised, and
   * then the write was refused — by preimage drift (R10.11), by a journal that
   * could not be written, or by a sandbox that could not be opened.
   */
  | 'mutation-aborted'

export const KNOWN_RULE_CLASSES = [
  'prompt-injection',
  'credential-access',
  'unsafe-script',
  'data-exfiltration',
  'vulnerable-dep',
  'excessive-permission',
  'metadata-invalid',
  'structure-invalid',
  'trigger-quality',
  'reference-broken',
  'eval-failure',
  'compat-risk',
] as const

export type KnownRuleClass = (typeof KNOWN_RULE_CLASSES)[number]

/** `unmapped:<toolId>:<nativeRuleId>` — tool-scoped, never merges across tools. */
export type RuleClass = KnownRuleClass | `unmapped:${string}`

/**
 * Closed set. Token and cost keys are absent by construction, which is how
 * R1.5 is enforced rather than merely stated.
 */
export const METRIC_KEYS = [
  'durationMs',
  'casesTotal',
  'casesPassed',
  'casesErrored',
  'turns',
  'findingsTotal',
  'filesScanned',
  'rulesEvaluated',
] as const

export type MetricKey = (typeof METRIC_KEYS)[number]

export type Metrics = Partial<Record<MetricKey, number>>

const METRIC_KEY_SET: ReadonlySet<string> = new Set(METRIC_KEYS)

export function coerceMetrics(input: Record<string, number>): Metrics {
  const out: Metrics = {}
  for (const [key, value] of Object.entries(input)) {
    if (!METRIC_KEY_SET.has(key)) {
      throw new Error(`unknown metric key: ${key}`)
    }
    if (!Number.isFinite(value)) {
      throw new Error(`non-finite metric value for ${key}`)
    }
    out[key as MetricKey] = value
  }
  return out
}

export interface RepoRef {
  id: string
  /** Canonical absolute path. */
  path: string
  name: string
  isGit: boolean
}

export interface SkillRef {
  /** `${repo.id}/${dirName}`, or `repo.id` for a repo-root skill. */
  id: string
  name: string | null
  version: string | null
  /** Absolute path to the skill directory. */
  dir: string
  /** Repo-relative path to the skill directory; '.' for a repo-root skill. */
  relPath: string
  repo: RepoRef
  rootSkill: boolean
  /** Absolute path to the sidecar workspace root. */
  workspacePath: string
}

export interface RawFinding {
  ruleClass: RuleClass
  nativeRuleId: string
  severity: Severity
  /** Repo-relative, POSIX separators. */
  path: string
  /** Display only. Never part of a fingerprint. */
  line?: number
  message: string
}
