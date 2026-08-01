import type { StageOutcome, ToolOutcome } from '../types.js'

export const TOOL_OUTCOMES: readonly ToolOutcome[] = ['passed', 'failed', 'errored', 'skipped']

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
