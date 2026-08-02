import { atLeastSeverity, maxSeverity } from '../types.js'
import type { RawFinding, Severity, StageOutcome, ToolOutcome } from '../types.js'

export const TOOL_OUTCOMES: readonly ToolOutcome[] = ['passed', 'failed', 'errored', 'skipped']

/**
 * Row 12 of the §8.1 table needs a severity dimension. Without one, skill-lint
 * exiting 0 and calling a skill SAFE still failed validate on two LOW "bundled
 * script, review contents" advisories against the skill's own scripts, and R5.1
 * halted the lifecycle on a tool that had found nothing wrong.
 *
 * `medium` rather than `high`: §7.1 normalises SARIF `warning` to `medium` and
 * uses it for a result carrying no level at all, and a failing eval case is
 * `medium`. A higher floor would pass most scanner findings and every failing
 * eval case, which is the same defect inverted.
 *
 * A constant, not configuration: a per-skill threshold would make two runs of
 * one tool incomparable in the ledger.
 */
export const FAIL_SEVERITY_FLOOR: Severity = 'medium'

/** `null` for an empty set, so a caller cannot mistake "nothing" for `info`. */
export function highestSeverity(findings: readonly RawFinding[]): Severity | null {
  return findings.reduce<Severity | null>(
    (acc, f) => (acc === null ? f.severity : maxSeverity(acc, f.severity)),
    null,
  )
}

/** Whether a finding set reaches the floor, and so fails the gate. */
export function meetsFailFloor(highest: Severity): boolean {
  return atLeastSeverity(highest, FAIL_SEVERITY_FLOOR)
}

export interface StageVerdict {
  outcome: StageOutcome
  /** What the stage would have said had every tool run. */
  verdict: 'passed' | 'failed'
}

/**
 * Two axes rather than a case list: completeness (did every selected tool
 * actually run) and verdict (did anything fail). Total over every non-empty
 * combination by construction.
 */
export function reduceStageOutcome(outcomes: readonly ToolOutcome[]): StageVerdict {
  if (outcomes.length === 0) {
    throw new Error('cannot reduce an empty tool selection')
  }

  let passed = 0
  let failed = 0
  let errored = 0
  for (const o of outcomes) {
    if (o === 'passed') passed += 1
    else if (o === 'failed') failed += 1
    else if (o === 'errored') errored += 1
  }

  const ran = passed + failed
  const complete = ran === outcomes.length
  const verdict: 'passed' | 'failed' = failed > 0 ? 'failed' : 'passed'

  if (complete) return { outcome: verdict, verdict }
  if (ran > 0) return { outcome: 'degraded', verdict }
  if (errored > 0) return { outcome: 'errored', verdict }
  return { outcome: 'skipped', verdict }
}

/** The read-only chain continues only while stages pass outright. */
export function haltsChain(outcome: StageOutcome): boolean {
  return outcome !== 'passed'
}
