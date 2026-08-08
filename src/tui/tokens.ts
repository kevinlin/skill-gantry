import type { JobRecord } from '../core/index.js'

/**
 * The screen's colour vocabulary, in one module because it was in five and they
 * had already diverged: `low` severity rendered gray on the Issues screen and
 * on the Dashboard but cyan in the findings pane, so one severity looked like
 * two depending on which screen the user read it from.
 *
 * Hex rather than named ANSI (D23): chalk downsamples for a terminal without
 * truecolour, and a name resolves to whatever the user's theme decided it
 * means, which is how `blue` becomes unreadable on one profile and fine on the
 * next. No body foreground and no background is ever set — the terminal's own
 * pair is what makes this screen read on a light theme (R11.15).
 *
 * The accent is the focus signal — the focused panel's border, the selected
 * output tab, the palette's command ids, the cursor. No state may claim it
 * except `running`, which is the one state telling the user to look at it.
 */
export const ACCENT = '#0070f3'

/**
 * The four words the rest of the screen actually means when it says a colour:
 * this thing is fine, this thing wants attention, this thing is broken, this
 * thing is inert. Every map below is written in terms of them, so a hex appears
 * once in this file and nowhere else in `src/tui`.
 *
 * It exists because the alternative was already running: fifteen call sites
 * across `Setup`, `Issues`, `Settings`, `Work`, `StatusBar` and `rows.ts` said
 * `color="red"` and `colour: 'yellow'` while this module said `#ee0000` and
 * `#f5a623`. A name resolves to whatever the user's terminal theme decided it
 * means (D23), so the setup wizard's failed install and the Tools screen's
 * missing tool — one condition — were rendered by two different reds, one of
 * them whatever the profile chose. `toolsRows` had gone the whole way and grown
 * `DRIFT_COLOUR`, a second severity vocabulary in the vocabulary this module
 * was extracted to end.
 *
 * `ok`/`warn`/`bad` carry the same three hexes as `passed`/`errored`/`failed`
 * deliberately, not incidentally: a tool that failed to install and a stage
 * that failed are one thing to a reader, and giving them separate values is how
 * they drift apart. `secondary` is severity `low`'s grey, for text that is
 * legible but not being pointed at; `muted` is the dim of something switched
 * off — a skipped stage, an unfocused border.
 */
export const STATUS = {
  ok: '#00c853',
  warn: '#f5a623',
  bad: '#ee0000',
  secondary: '#888888',
  muted: '#555555',
} as const

/**
 * Normalised severity, which is the only severity that reaches a screen: the
 * adapters map every tool's own vocabulary onto these five before a finding is
 * stored. `low` and `info` share the dim grey rather than a colour of their
 * own, because a scanner reports far more of them than of anything else and
 * colouring them makes the two severities that fail a gate harder to find.
 */
export const SEVERITY_COLOUR: Record<string, string> = {
  critical: STATUS.bad,
  high: STATUS.bad,
  medium: STATUS.warn,
  low: STATUS.secondary,
  info: STATUS.secondary,
}

/**
 * Stage and run outcomes, plus the two non-outcomes a skill row can be in.
 * `degraded` shares `errored`'s amber: both mean the run finished and its
 * evidence is partial, which is one thing to a reader even though the reduction
 * distinguishes them.
 */
export const OUTCOME_COLOUR: Record<string, string> = {
  passed: STATUS.ok,
  failed: STATUS.bad,
  errored: STATUS.warn,
  degraded: STATUS.warn,
  skipped: STATUS.muted,
  running: ACCENT,
  idle: STATUS.muted,
}

export const JOB_COLOUR: Record<JobRecord['state'], string> = {
  queued: STATUS.muted,
  running: ACCENT,
  done: STATUS.ok,
  failed: STATUS.bad,
  cancelled: STATUS.warn,
}

/**
 * What a job is called once it has stopped. `state` is the job's lifecycle and
 * `outcome` is its verdict, and the pool sets `done` for every run that
 * *completed* — a security scan that found a critical finding included. A row
 * rendering the state alone therefore reported that run as a green `done` while
 * the rail one panel up said `failed`, which is the same condition under two
 * names in two colours on one screen.
 *
 * `failed` as a *state* is the other thing entirely: the run threw. It keeps
 * the job vocabulary, because no stage outcome describes it.
 */
export function jobVerdict(job: JobRecord): { label: string; colour: string } {
  if (job.state !== 'done') return { label: job.state, colour: JOB_COLOUR[job.state] }
  const outcome = job.outcome ?? 'done'
  return { label: outcome, colour: OUTCOME_COLOUR[outcome] ?? JOB_COLOUR.done }
}

/** Wide enough for whichever word `jobVerdict` can return, so the column holds. */
export const VERDICT_WIDTH = Math.max(
  ...[...Object.keys(JOB_COLOUR), ...Object.keys(OUTCOME_COLOUR)].map((word) => word.length),
)

/**
 * One phrasing for "this pane is showing part of a list", because the body rows
 * that say it had five — `+3 more`, `+3 more — keep typing`, `rows 1–12 of 40 ·
 * j/k scrolls`, `rows 1–12 of 40`, and nothing at all — and a user who learned
 * one of them on the Dashboard had to learn it again on Issues.
 *
 * Position first, because `+3 more` cannot tell a user whether they are at the
 * top of the list or the bottom of it. `recovery` is how *this* pane reaches
 * the rest and differs per pane, so it is the caller's: a pane the user cannot
 * scroll advertising `j/k` is worse than saying nothing.
 *
 * The notice costs a row like any other, so every caller counts it *against*
 * its allocation rather than appending it below (§14.1's first rule). The
 * `+N more` that rides `SkillList`'s and `Queue`'s titles is a different thing
 * — a hint beside a heading, spending no row — and stays as it is.
 */
export function overflowNotice(
  start: number,
  end: number,
  total: number,
  recovery?: string,
): string {
  return `rows ${start + 1}–${end} of ${total}${recovery === undefined ? '' : ` · ${recovery}`}`
}
