import {
  RULE_CLASS_MAP_VERSION,
  appliedRuleMapVersion,
  doctor,
  loadConfig,
  migrateRuleMap,
  openLedger,
  readLifecycleCache,
  type DoctorReport,
  type LifecycleState,
} from '../core/index.js'
import { discoverAll, type CliDeps } from './run-command.js'

/** The ledger is read here, not in `tools`, which owns no sqlite dependency. */
function lifecycleCache(dbPath: string): ReadonlyMap<string, LifecycleState> {
  const ledger = openLedger(dbPath)
  try {
    return readLifecycleCache(ledger.db)
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

/**
 * R8.14 requires the rule-map migration to be explicit, so this flag is the only
 * trigger: nothing on the openLedger path calls it, which is why a run, a TUI
 * launch and a plain `doctor` all leave a user's triage alone.
 */
function applyRuleMap(dbPath: string, write: CliDeps['write']): void {
  const ledger = openLedger(dbPath)
  try {
    const result = migrateRuleMap(ledger.db)
    write(
      `rule-class map v${result.applied}: ` +
        `${result.reclassified} issue(s) reclassified, ${result.merged} merged`,
    )
  } finally {
    ledger.close()
  }
}

function ruleMapVersions(dbPath: string): { applied: number; current: number } {
  const ledger = openLedger(dbPath)
  try {
    return { applied: appliedRuleMapVersion(ledger.db), current: RULE_CLASS_MAP_VERSION }
  } finally {
    ledger.close()
  }
}

export async function runDoctor(
  deps: CliDeps,
  opts: { json?: boolean; migrateRuleMap?: boolean },
): Promise<DoctorReport> {
  // Before the report is built, so one invocation shows the result.
  if (opts.migrateRuleMap) applyRuleMap(deps.dbPath, deps.write)

  const skills = await discoverAll(await loadConfig(deps.home))
  const report = await doctor({
    home: deps.home,
    skills,
    ledgerLifecycle: lifecycleCache(deps.dbPath),
    ruleMap: ruleMapVersions(deps.dbPath),
  })
  if (opts.json) deps.write(JSON.stringify(report))
  else for (const line of formatDoctor(report)) deps.write(line)
  return report
}
