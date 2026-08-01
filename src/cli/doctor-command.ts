import {
  discoverSkills,
  doctor,
  loadConfig,
  openLedger,
  type DoctorReport,
  type LifecycleState,
  type SkillRef,
} from '../core/index.js'
import type { CliDeps } from './run-command.js'

/** The ledger is read here, not in `tools`, which owns no sqlite dependency. */
function lifecycleCache(dbPath: string): ReadonlyMap<string, LifecycleState> {
  const ledger = openLedger(dbPath)
  try {
    const rows = ledger.db
      .prepare('select id, lifecycle_state as state from skills')
      .all() as Array<{ id: string; state: string }>
    return new Map(
      rows.map((row) => [row.id, row.state === 'deprecated' ? 'deprecated' : 'active'] as const),
    )
  } finally {
    ledger.close()
  }
}

export function formatDoctor(report: DoctorReport): string[] {
  const lines: string[] = []
  for (const runtime of report.runtimes) {
    lines.push(
      runtime.present
        ? `runtime ${runtime.runtime}  ${runtime.version}`
        : `runtime ${runtime.runtime}  missing — install with: ${runtime.installCommand}`,
    )
  }
  for (const tool of report.tools) {
    const detail = tool.detail ? `  ${tool.detail}` : ''
    lines.push(`${tool.toolId.padEnd(16)}${tool.kind}${detail}`)
  }
  for (const drift of report.lifecycle) {
    lines.push(
      `${drift.skillId.padEnd(16)}lifecycle-drift  file ${drift.file}, ledger ${drift.ledger}`,
    )
  }
  lines.push(report.failed ? 'doctor: drift found' : 'doctor: no drift')
  return lines
}

export async function runDoctor(deps: CliDeps, opts: { json?: boolean }): Promise<DoctorReport> {
  const config = await loadConfig(deps.home)
  const skills: SkillRef[] = []
  for (const repo of config.repos) skills.push(...(await discoverSkills(repo)))
  const report = await doctor({
    home: deps.home,
    skills,
    ledgerLifecycle: lifecycleCache(deps.dbPath),
  })
  if (opts.json) deps.write(JSON.stringify(report))
  else for (const line of formatDoctor(report)) deps.write(line)
  return report
}
