export type IssueState = 'open' | 'acknowledged' | 'wontfix' | 'fixed'

// Re-exported, not redefined: the ordering moved to types.ts once the outcome
// model needed it too, and the ledger must not be the place a stage reaches for
// a comparison.
export { maxSeverity } from '../types.js'

/** State after the issue is detected again in a later run. */
export function stateOnDetection(current: IssueState): IssueState {
  // A fixed issue that comes back reopens. wontfix stays suppressed.
  return current === 'fixed' ? 'open' : current
}

/**
 * State after a competent tool run does not report the issue.
 * `null` means leave it alone: wontfix is never auto-closed, and a fixed
 * issue is already closed.
 */
export function stateOnAbsence(current: IssueState): IssueState | null {
  return current === 'open' || current === 'acknowledged' ? 'fixed' : null
}
