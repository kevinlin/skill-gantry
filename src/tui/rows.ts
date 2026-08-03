import { truncate } from './layout.js'
import type { AppState } from './store.js'

export interface ScreenRow {
  text: string
  heading?: boolean
  dim?: boolean
  colour?: string
}

const pct = (rate: number): string => `${Math.round(rate * 100)}%`

/** 900ms, 2.5s, 1m 05s — the three magnitudes a stage actually takes. */
export function humanMs(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1_000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${String(Math.round((ms % 60_000) / 1_000)).padStart(2, '0')}s`
}

const SEVERITY_COLOUR: Record<string, string> = {
  critical: 'red',
  high: 'red',
  medium: 'yellow',
  low: 'gray',
  info: 'gray',
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
      colour: SEVERITY_COLOUR[row.severity] ?? 'gray',
    })
  }
  for (const row of stats.openByRuleClass) {
    line(`  ${row.ruleClass.padEnd(22)} ${row.count}`, { dim: true })
  }

  line('Run history', { heading: true })
  for (const row of stats.history) {
    line(
      `  ${row.startedAt.slice(0, 16).replace('T', ' ')}  ${row.outcome.padEnd(8)} ${row.skillId}`,
      {
        colour: row.outcome === 'passed' ? 'green' : row.outcome === 'failed' ? 'red' : 'yellow',
      },
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
      colour: DRIFT_COLOUR[tool.kind] ?? 'gray',
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

  line('Repos', { heading: true })
  if (view.repos.length === 0) {
    line('  none registered — skillgantry setup registers one', { dim: true })
  }
  for (const repo of view.repos) {
    line(
      `  ${repo.id.padEnd(14)} ${repo.skills} skills  ${repo.isGit ? 'git' : 'no git'}  ${repo.path}`,
    )
  }

  line('Execution', { heading: true })
  line(`  concurrency ${view.concurrency}`)
  for (const [stage, tools] of Object.entries(view.stageTools)) {
    line(`  ${stage.padEnd(10)} ${tools.length === 0 ? 'no tool selected' : tools.join(', ')}`, {
      dim: tools.length === 0,
    })
  }

  line('Credentials', { heading: true })
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
