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

export type IssueAction = 'acknowledge' | 'wontfix' | 'reopen'

/**
 * The user half of design §10.5. `null` means no legal transition, and the
 * caller writes nothing — a screen that silently no-ops is better than one that
 * can move an issue somewhere the state machine does not describe.
 *
 * `acknowledge` from `wontfix` is refused: a suppression is a stronger
 * statement than triage, and quietly weakening it would lose a decision the
 * user made. `reopen` is the way back.
 */
export function stateOnUserAction(current: IssueState, action: IssueAction): IssueState | null {
  switch (action) {
    case 'acknowledge':
      return current === 'open' ? 'acknowledged' : null
    case 'wontfix':
      return current === 'wontfix' ? null : 'wontfix'
    case 'reopen':
      return current === 'open' ? null : 'open'
  }
}

/**
 * Whether one detector agrees an issue is gone: it has reported a conclusive
 * absence since the last time it reported the issue. Closure is the conjunction
 * of this over every detector (R8.8), and the Issues screen shows the detectors
 * for which it is false — so both read the same predicate rather than two copies
 * that could disagree about which tool is holding an issue open.
 *
 * Run ids are UUIDv7, so lexical order is claim order.
 */
export function detectorSaysGone(row: {
  last_seen_run: string | null
  last_absent_run: string | null
}): boolean {
  return (
    row.last_absent_run !== null &&
    (row.last_seen_run === null || row.last_absent_run > row.last_seen_run)
  )
}

/**
 * R8.15. Whether one detector's *current* sighting was wholly suppressed.
 *
 * An equality against `last_seen_run` rather than a presence test on
 * `suppressed_run`, so a pair left behind by an older sighting degrades to
 * unsuppressed instead of outliving the sighting it describes. Reconciliation
 * writes both columns in one statement, so the two agree by construction; the
 * equality is what keeps that true through §10.6's merge, which takes each
 * column from a row rather than from a write.
 */
export function detectorSuppressed(row: {
  last_seen_run: string | null
  suppressed_run: string | null
}): boolean {
  return row.suppressed_run !== null && row.suppressed_run === row.last_seen_run
}

/**
 * R8.15. The issue-level conjunction, the twin of R8.8's closure conjunction:
 * an issue reads as suppressed only when every detector *still reporting it*
 * reports it suppressed. A detector that says gone has no vote, and an issue no
 * detector is reporting is not suppressed.
 *
 * This is what stops one tool's baseline speaking for a tool it never consulted
 * — skillspector's file cannot hide a finding skill-scanner is still reporting
 * plainly beside it.
 */
export interface DetectorSuppressionRow {
  last_seen_run: string | null
  last_absent_run: string | null
  suppressed_run: string | null
  suppressed_reason: string | null
}

export function issueSuppression(
  rows: readonly DetectorSuppressionRow[],
): { run: string; reason: string } | null {
  const voters = rows.filter((row) => !detectorSaysGone(row))
  if (voters.length === 0) return null
  if (!voters.every(detectorSuppressed)) return null

  // The latest voter, tie-broken by reason text, so two detectors suppressing
  // in one run produce one deterministic answer rather than an insertion-order
  // one — the same property that made closure a conjunction over a set.
  const winner = voters.reduce((best, row) =>
    (row.suppressed_run as string) > (best.suppressed_run as string) ? row : best,
  ) as DetectorSuppressionRow
  return { run: winner.suppressed_run as string, reason: winner.suppressed_reason ?? '' }
}
