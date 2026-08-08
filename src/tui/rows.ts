import { basename } from 'node:path'
import type { DashboardStats, IssueRow, ScalarField } from '../core/index.js'
import { truncate, truncateMiddle, windowFor } from './layout.js'
import { ACCENT, OUTCOME_COLOUR, SEVERITY_COLOUR } from './tokens.js'
import type { AppState, FindingRow, SkillRow } from './store.js'

export type SettingsAction =
  | { kind: 'edit-scalar'; field: ScalarField; current: string }
  | { kind: 'remove-repo'; repoId: string }
  | { kind: 'open-setup' }

export interface ScreenRow {
  text: string
  heading?: boolean
  dim?: boolean
  colour?: string
  /** Present only on rows the user can act on; the cursor visits these alone. */
  action?: SettingsAction
}

const pct = (rate: number): string => `${Math.round(rate * 100)}%`

/**
 * Which log the pane is showing: the recorded one for a row rehydrated off disk,
 * the session's live buffer otherwise. Here rather than in the component,
 * because the pane renders against these lines and `outputWindow` clamps
 * against their count — the same reason `outputWindow` itself is one function.
 */
export const logLines = (state: AppState, skill: SkillRow | undefined): readonly string[] =>
  skill?.rehydrated === true ? skill.recordedLog.lines : state.log.lines

/** The dropped-line footnote's count, from whichever log is showing. */
export const logDropped = (state: AppState, skill: SkillRow | undefined): number =>
  skill?.rehydrated === true ? skill.recordedLog.dropped : state.log.dropped

/** Rows the current tab holds, and where it sits when nothing is pinned. */
function outputTab(
  state: AppState,
  skill: SkillRow | undefined,
): {
  total: number
  anchor: 'top' | 'bottom'
  /**
   * The row the window must contain, for a tab driven by a cursor rather than a
   * scroll offset. `anchor` cannot express it: `top` pins the window at row 0,
   * so a cursor on finding 11 of 12 sat below a pane showing rows 1–10.
   */
  cursor?: number
} {
  switch (state.panel) {
    case 'log':
      // The newest line, because a log is read from its end.
      return { total: logLines(state, skill).length, anchor: 'bottom' }
    case 'findings':
      // The detail rows count towards the *window*: the pane renders them, so
      // they are rows the allocation has to hold. They are not what the cursor
      // clamps on — `selectedFinding` indexes findings, and clamping a finding
      // index against a row count is how it walks past the last finding.
      //
      // Only the selected finding expands, so every earlier finding is exactly
      // one row and its summary sits at row `selectedFinding`.
      return {
        total: findingRows(skill?.findings ?? [], state.selectedFinding, 200).length,
        anchor: 'top',
        cursor: state.selectedFinding,
      }
    case 'issues':
      return { total: state.issues.length, anchor: 'top' }
    case 'artefacts':
      return { total: state.artefacts.length, anchor: 'top' }
    case 'skill':
      return {
        total: state.skillMd.length === 0 ? 0 : state.skillMd.split('\n').length,
        anchor: 'top',
      }
  }
}

export interface OutputWindow {
  /** First and last visible row of the tab's list. */
  start: number
  end: number
  total: number
  /** Rows the list itself gets, net of whichever footnotes are showing. */
  rows: number
  overflow: boolean
  /** The log's `N earlier lines dropped` row, which costs a row like any other. */
  dropped: boolean
  anchor: 'top' | 'bottom'
}

/**
 * The whole of what the output pane shows, in one pure function, because the
 * pane windows against these numbers and the key handler clamps against them.
 * Two derivations of the same arithmetic is how `j` stops moving a few rows
 * short of the end and every further press does nothing — the pane silently
 * disagreeing with the store about how far down is down.
 */
export function outputWindow(
  state: AppState,
  skill: SkillRow | undefined,
  height: number,
): OutputWindow {
  const { total, anchor, cursor } = outputTab(state, skill)
  const dropped = state.panel === 'log' && logDropped(state, skill) > 0
  const body = Math.max(1, height - (dropped ? 1 : 0))
  const overflow = total > body
  const rows = overflow ? Math.max(1, body - 1) : body
  const maxStart = Math.max(0, total - rows)
  const natural =
    cursor === undefined
      ? anchor === 'bottom'
        ? maxStart
        : 0
      : windowFor(total, cursor, rows).start
  const start = Math.min(state.outputOffset ?? natural, maxStart)
  return { start, end: Math.min(total, start + rows), total, rows, overflow, dropped, anchor }
}

/** 900ms, 2.5s, 1m 05s — the three magnitudes a stage actually takes. */
export function humanMs(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1_000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${String(Math.round((ms % 60_000) / 1_000)).padStart(2, '0')}s`
}

/**
 * A flat row list rather than nested boxes, so the screen's whole body is one
 * windowed list. §14.1's first rule then holds by construction: the component
 * renders exactly the rows it was allocated and counts the overflow notice
 * against them, instead of five sections each deciding their own height.
 */
export function dashboardRows(state: AppState, width: number): ScreenRow[] {
  const rows: ScreenRow[] = []
  const line = (text: string, extra: Omit<ScreenRow, 'text'> = {}): void => {
    rows.push({ text: truncate(text, width), ...extra })
  }

  if (state.viewError !== null) {
    line(`ledger read failed: ${state.viewError}`, { colour: 'red' })
    return rows
  }
  const stats = state.dashboard
  if (stats === null) {
    line('loading…', { dim: true })
    return rows
  }

  const scope = state.statsFilter.skillId ?? state.statsFilter.repoId ?? 'every registered repo'
  line(`${stats.repos} repos · ${stats.skills} skills · ${stats.runs} runs`, { dim: true })
  line(`scope ${scope} · provenance ${state.statsFilter.provenanceFp ?? 'all'}`, { dim: true })

  if (stats.runs === 0) {
    line('no runs recorded yet — run a stage and this fills in', { dim: true })
    return rows
  }

  line('Stage pass rate', { heading: true })
  for (const row of stats.stagePassRates) {
    line(`  ${row.stage.padEnd(10)} ${pct(row.rate).padStart(4)}  ${row.passed}/${row.runs}`)
  }

  line('Eval cases', { heading: true })
  line(
    stats.evalCases.rate === null
      ? '  no eval case recorded'
      : `  ${stats.evalCases.casesPassed}/${stats.evalCases.casesTotal} passed (${pct(stats.evalCases.rate)})` +
          (stats.evalCases.casesErrored > 0 ? `, ${stats.evalCases.casesErrored} errored` : ''),
  )

  line('Wall clock', { heading: true })
  for (const row of stats.wallClock) {
    line(`  ${row.stage.padEnd(10)} median ${humanMs(row.medianMs)} · max ${humanMs(row.maxMs)}`)
  }

  line('Open issues', { heading: true })
  if (stats.openBySeverity.length === 0) line('  none open')
  for (const row of stats.openBySeverity) {
    line(`  ${row.severity.padEnd(10)} ${row.count}`, {
      colour: SEVERITY_COLOUR[row.severity] ?? '#888888',
    })
  }
  for (const row of stats.openByRuleClass) {
    line(`  ${row.ruleClass.padEnd(22)} ${row.count}`, { dim: true })
  }

  line('Run history', { heading: true })
  for (const row of stats.history) {
    line(
      `  ${row.startedAt.slice(0, 16).replace('T', ' ')}  ${row.outcome.padEnd(8)} ${row.skillId}`,
      // Through the shared map rather than a ternary: the ternary painted
      // `skipped` the same yellow as `errored`, so a stage nobody ran read as a
      // stage that broke.
      { colour: OUTCOME_COLOUR[row.outcome] ?? '#555555' },
    )
  }
  return rows
}

const DRIFT_COLOUR: Record<string, string> = {
  ok: 'green',
  missing: 'red',
  unverifiable: 'red',
  'version-drift': 'yellow',
  unlocked: 'yellow',
  'integrity-unverified': 'yellow',
}

export function toolsRows(state: AppState, width: number): ScreenRow[] {
  const rows: ScreenRow[] = []
  const line = (text: string, extra: Omit<ScreenRow, 'text'> = {}): void => {
    rows.push({ text: truncate(text, width), ...extra })
  }

  if (state.viewError !== null) {
    line(`doctor failed: ${state.viewError}`, { colour: 'red' })
    return rows
  }
  const report = state.tools
  if (report === null) {
    line('probing runtimes and verifying tools…', { dim: true })
    return rows
  }

  line('Runtimes', { heading: true })
  for (const runtime of report.runtimes) {
    line(
      runtime.present
        ? `  ${runtime.runtime.padEnd(10)} ${runtime.version ?? ''}`
        : `  ${runtime.runtime.padEnd(10)} missing — ${runtime.installCommand}`,
      { colour: runtime.present ? 'green' : 'red' },
    )
  }

  line('Tools', { heading: true })
  if (report.tools.length === 0) line('  nothing locked yet — run the setup wizard', { dim: true })
  for (const tool of report.tools) {
    line(`  ${tool.toolId.padEnd(16)} ${tool.kind}${tool.detail ? `  ${tool.detail}` : ''}`, {
      colour: DRIFT_COLOUR[tool.kind] ?? '#555555',
    })
  }

  if (report.lifecycle.length > 0) {
    line('Lifecycle', { heading: true })
    for (const drift of report.lifecycle) {
      // R1.6: the file is the authority, so this is the cache to reconcile, not
      // an error — which is exactly how doctor reports it. The kind is named on
      // the row in doctor's own vocabulary, so the screen and the headless
      // report call one condition by one name.
      line(
        `  ${drift.skillId.padEnd(20)} lifecycle-drift  file ${drift.file}, ledger ${drift.ledger}`,
        { colour: 'yellow' },
      )
    }
  }

  line(report.failed ? 'drift found' : 'no drift', {
    colour: report.failed ? 'yellow' : 'green',
  })
  // The migration is explicit (R8.14), so this screen names the command and is
  // not itself a trigger. Stated unconditionally rather than only when pending:
  // a user reading a clean report should still know where the button is.
  line('resolve with: skillgantry doctor --migrate-rule-map', { dim: true })
  return rows
}

export function settingsRows(state: AppState, width: number): ScreenRow[] {
  const rows: ScreenRow[] = []
  const line = (text: string, extra: Omit<ScreenRow, 'text'> = {}): void => {
    rows.push({ text: truncate(text, width), ...extra })
  }

  if (state.viewError !== null) {
    line(`config read failed: ${state.viewError}`, { colour: 'red' })
    return rows
  }
  const view = state.settings
  if (view === null) {
    line('loading…', { dim: true })
    return rows
  }

  // The staged document, so every edit is visible before it is written and the
  // screen never shows a value the user has already changed (R11.8).
  const config = state.staged ?? view.config
  const configFile = basename(view.configPath)
  /** R11.7: which file holds this value, or that nobody wrote it at all. */
  const origin = (key: string): string =>
    view.presentKeys.includes(key) ? configFile : 'default'
  // Actionable rows alone take the cursor, so `j` never stops on a heading.
  let actionable = 0
  const action = (text: string, act: SettingsAction, extra: Omit<ScreenRow, 'text'> = {}): void => {
    const marker = actionable === state.settingsCursor ? '›' : ' '
    actionable += 1
    rows.push({ text: truncate(`${marker} ${text}`, width), action: act, ...extra })
  }

  line(`Repos — ${view.configPath}`, { heading: true })
  if (config.repos.length === 0) {
    line('  none registered — :setup registers one', { dim: true })
  }
  for (const repo of config.repos) {
    const skills = view.repos.find((known) => known.id === repo.id)?.skills ?? 0
    action(
      ` ${repo.id.padEnd(14)} ${skills} skills  ${repo.isGit ? 'git' : 'no git'}  ${repo.path}`,
      { kind: 'remove-repo', repoId: repo.id },
    )
  }

  line(`Execution — ${view.configPath}`, { heading: true })
  const session =
    state.concurrency === config.concurrency ? '' : ` · session ${state.concurrency}`
  action(` concurrency ${config.concurrency}  (${origin('concurrency')})${session}`, {
    kind: 'edit-scalar',
    field: 'concurrency',
    current: String(config.concurrency),
  })
  action(
    ` artefact cap ${config.artefactSizeCapBytes} bytes  (${origin('artefactSizeCapBytes')})`,
    {
      kind: 'edit-scalar',
      field: 'artefactSizeCapBytes',
      current: String(config.artefactSizeCapBytes),
    },
  )
  action(` mutation timeout ${config.mutationTimeoutMs}ms  (${origin('mutationTimeoutMs')})`, {
    kind: 'edit-scalar',
    field: 'mutationTimeoutMs',
    current: String(config.mutationTimeoutMs),
  })
  for (const [stage, tools] of Object.entries(config.stageTools)) {
    // R11.8: tool selection is the setup states, not a second selection path.
    action(
      ` ${stage.padEnd(10)} ${tools.length === 0 ? 'no tool selected' : tools.join(', ')}`,
      { kind: 'open-setup' },
      { dim: tools.length === 0 },
    )
  }
  for (const tool of view.toolTimeouts) {
    const override = config.timeoutOverridesMs[tool.toolId]
    action(
      ` timeout ${tool.toolId.padEnd(14)} ${override ?? tool.defaultMs}ms  (${
        override === undefined ? 'adapter default' : configFile
      })`,
      {
        kind: 'edit-scalar',
        field: `timeoutOverridesMs.${tool.toolId}`,
        current: override === undefined ? '' : String(override),
      },
    )
  }

  line(`Credentials — ${view.envPath}`, { heading: true })
  if (view.credentials.length === 0) line('  no selected tool declares one', { dim: true })
  for (const credential of view.credentials) {
    // Presence and provider label only. R7.3 keeps credential values out of
    // every file SkillGantry writes, and a screen is not an exception.
    line(
      `  ${credential.label.padEnd(16)} ${credential.satisfied ? 'ok' : 'missing'}  ${credential.detail}`,
      { colour: credential.satisfied ? 'green' : 'yellow' },
    )
  }
  for (const warning of view.envWarnings) line(`  ${warning}`, { colour: 'yellow' })

  line('Paths', { heading: true })
  line(`  home    ${view.home}`, { dim: true })
  line(`  ledger  ${view.dbPath}`, { dim: true })
  const current = view.ruleMap.applied === view.ruleMap.current
  line(`  rule map v${view.ruleMap.applied} applied, v${view.ruleMap.current} shipped`, {
    // Built conditionally rather than passing `colour: undefined`, which
    // `exactOptionalPropertyTypes` rejects.
    ...(current ? { dim: true } : { colour: 'yellow' }),
  })
  return rows
}

export interface IssueRowView {
  text: string
  severity: string
  suppressed: boolean
  /** A flag rather than the caller re-reading the cursor glyph out of `text`,
      which breaks the moment the glyph changes. */
  selected: boolean
  fingerprint: string
}

/** Paired with the word, so the state survives a monochrome terminal. */
const STATE_MARK: Record<string, string> = {
  open: '●',
  acknowledged: '◐',
  wontfix: '×',
  fixed: '○',
}

/**
 * One issue, one row, built once for both the Issues screen and the Work
 * screen's Issues tab (R11.13). Two renderers is the divergence this module
 * already records from when five of them owned severity colour and `low` read
 * gray on two screens and cyan on a third.
 *
 * Fixed left columns and the path last, because the path is the only field that
 * can be arbitrarily long and so the only one that should absorb the
 * truncation. The rule class gets its own column rather than sharing the
 * path's: the path is elided from the *head* so its basename survives, which
 * ate the rule class when the two shared one field — and the rule class is what
 * names the issue.
 */
export function issueRows(
  rows: readonly IssueRow[],
  selected: number,
  width: number,
): IssueRowView[] {
  const severityWidth = 9
  const stateWidth = 14
  const skillWidth = Math.min(24, Math.max(10, Math.floor(width * 0.22)))
  const ruleWidth = Math.min(18, Math.max(8, Math.floor(width * 0.2)))
  const pathWidth = Math.max(
    8,
    width - severityWidth - stateWidth - skillWidth - ruleWidth - 4,
  )

  return rows.map((row, index) => {
    // R8.8's blockers: the detectors that have not since reported a conclusive
    // absence, so "why is this still open" is on the row.
    const blocked = row.blockedBy.length === 0 ? '' : ` ⟂ ${row.blockedBy.join(',')}`
    // R8.15: marked, never hidden. Its width is reserved out of the path's
    // rather than appended to it — `truncateMiddle` elides the head, so a mark
    // simply concatenated on is what a long reason eats first.
    const mark = row.suppressed
      ? truncate(
          ` ⊘ suppressed${row.suppressionReason ? `: ${row.suppressionReason}` : ''}`,
          Math.max(14, Math.floor(pathWidth * 0.6)),
        )
      : ''
    const cursor = index === selected ? '▸' : ' '
    const text =
      `${cursor} ` +
      row.severity.padEnd(severityWidth) +
      `${STATE_MARK[row.state] ?? '?'} ${row.state}`.padEnd(stateWidth) +
      truncate(row.skillId, skillWidth).padEnd(skillWidth) +
      truncate(row.ruleClass, ruleWidth).padEnd(ruleWidth) +
      truncateMiddle(`${row.relPath}${blocked}`, Math.max(4, pathWidth - mark.length)) +
      mark
    return {
      text: truncate(text, width),
      severity: row.severity,
      suppressed: row.suppressed,
      selected: index === selected,
      fingerprint: row.fingerprint,
    }
  })
}

export interface FindingRowView {
  text: string
  /** Set on a summary row, null on a detail row, which carries no state. */
  severity: string | null
  dim: boolean
  key: string
}

/**
 * The Findings pane as a flat row list, detail included, so `outputWindow` can
 * window it and the key handler can clamp against the same count. Expansion
 * being *more rows* rather than a nested box is what keeps §14.1's first rule
 * true by construction: the detail is counted against the allocation, so the
 * list shrinks while a row is open instead of the panel below falling off.
 *
 * One derivation, for the reason `outputWindow` is one function: the pane
 * renders against these rows and `j` clamps against their length, and two
 * copies of that arithmetic is how `j` stops several rows short of the end and
 * every further press does nothing.
 */
export function findingRows(
  rows: readonly FindingRow[],
  selected: number,
  width: number,
): FindingRowView[] {
  const out: FindingRowView[] = []
  rows.forEach((row, index) => {
    const { finding } = row
    const chosen = index === selected
    const suppressed = finding.suppressed !== undefined
    const location = finding.line === undefined ? finding.path : `${finding.path}:${finding.line}`
    out.push({
      text: truncate(
        `${chosen ? '▸' : ' '} ${finding.severity.padEnd(9)}${suppressed ? '⊘ ' : ''}${
          finding.ruleClass
        }  ${location}  ${row.toolId}`,
        width,
      ),
      severity: finding.severity,
      dim: suppressed,
      key: `${index}-summary`,
    })
    if (!chosen) return
    // Indented under the row it belongs to, and truncated like every other
    // content row: a wrapped message spends rows the budget already allocated.
    const detail = [
      `    ${finding.message}`,
      `    ${finding.ruleClass} · ${finding.nativeRuleId} · ${row.stage} · ${row.toolId}`,
      `    ${row.artefactDir}`,
      ...(finding.suppressed === undefined
        ? []
        : [`    ⊘ suppressed: ${finding.suppressed.justification}`]),
      '    [o] open evidence   [y] copy prompt   [r] rerun',
    ]
    detail.forEach((line, offset) => {
      out.push({
        text: truncate(line, width),
        severity: null,
        dim: true,
        key: `${index}-detail-${offset}`,
      })
    })
  })
  return out
}

/**
 * A proportional bar in the `DESIGN.md` §8 glyphs. Rounded rather than floored
 * so a rate just under a tenth still shows one cell — a 9% pass rate rendering
 * as an empty bar reads as "no runs", which is a different fact.
 */
export function bar(rate: number, cells: number): string {
  const filled = Math.round(Math.max(0, Math.min(1, rate)) * cells)
  return `▕${'█'.repeat(filled)}${'░'.repeat(cells - filled)}▏`
}

/**
 * The Overview card's body, as the same flat `ScreenRow` list `dashboardRows`
 * emits, so §14.1's first rule holds by construction: the component renders
 * exactly the rows its tier was allocated. `layoutFor` chose the tier; this
 * only fills it.
 */
export function overviewRows(
  stats: DashboardStats | null,
  tier: 'full' | 'compact',
  width: number,
): ScreenRow[] {
  const rows: ScreenRow[] = []
  const line = (text: string, extra: Omit<ScreenRow, 'text'> = {}): void => {
    rows.push({ text: truncate(text, width), ...extra })
  }
  if (stats === null) {
    line('loading…', { dim: true })
    return rows
  }
  if (stats.runs === 0) {
    line('no runs recorded yet', { dim: true })
    return rows
  }

  // Both derived from the width, and derived so the row *fits* it: the row is
  // `label · bar · pct`, which is `labelWidth + cells + 8` cells, and reserving
  // a constant instead cut the percentage off at a 22-cell list column — the one
  // number the bar exists to quantify. The label shortens before the bar does,
  // for the reason the rail's does: `sec` still names the stage, a two-cell bar
  // no longer shows a proportion.
  const labelWidth = width >= 24 ? 8 : 3
  const cells = Math.max(4, Math.min(10, width - labelWidth - 8))
  for (const row of stats.stagePassRates) {
    line(
      `${row.stage.slice(0, labelWidth).padEnd(labelWidth)} ${bar(row.rate, cells)} ${pct(
        row.rate,
      ).padStart(4)}`,
      {
        // A literal fallback, not `colour: undefined`: `exactOptionalPropertyTypes`
        // rejects an explicit undefined for an optional prop, and an indexed read
        // of the map is `string | undefined` under `noUncheckedIndexedAccess`.
        colour:
          OUTCOME_COLOUR[row.rate >= 0.6 ? 'passed' : row.rate >= 0.25 ? 'errored' : 'failed'] ??
          '#555555',
      },
    )
  }
  if (tier === 'compact') return rows

  line(
    stats.openBySeverity.length === 0
      ? 'no open issues'
      : stats.openBySeverity.map((row) => `${row.count} ${row.severity}`).join(' · '),
    { dim: true },
  )
  const slowest = [...stats.wallClock].sort((a, b) => (b.medianMs ?? 0) - (a.medianMs ?? 0))[0]
  // `med` rather than `median`: the full word pushed the row past an 18-cell
  // inner width and the duration — the datum — was what got cut.
  line(slowest === undefined ? '' : `med ${slowest.stage} ${humanMs(slowest.medianMs)}`, {
    dim: true,
  })
  line('0  full dashboard →', { colour: ACCENT })
  return rows
}
