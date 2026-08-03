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
