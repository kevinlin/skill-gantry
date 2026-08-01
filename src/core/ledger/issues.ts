import type { Severity } from '../types.js'

export type IssueState = 'open' | 'acknowledged' | 'wontfix' | 'fixed'

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
