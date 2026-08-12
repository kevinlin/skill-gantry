import {
  RULE_CLASS_MAP_VERSION,
  VERSION,
  appliedRuleMapVersion,
  checkForUpgrade,
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
  for (const skill of report.skills) {
    // Padded to 15 and joined with a space, so the kind lands in the same
    // column as the tool rows' and a qualified skill id — which is longer than
    // any tool id — still cannot run into the word beside it.
    lines.push(`${skill.skillId.padEnd(15)} ${skill.kind}  ${skill.detail}`)
  }
  if (report.upgrade) {
    lines.push(
      `${'skillgantry'.padEnd(16)}skillgantry-outdated  ` +
        `${report.upgrade.current} installed, ${report.upgrade.latest} available — ` +
        'run `skillgantry upgrade`',
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

/**
 * §5.3. Performed here and passed into the report builder as data, exactly as
 * the lifecycle cache and the rule-map versions already are, so
 * `src/core/tools/` gains no network dependency. The throttle is ignored — an
 * explicit `doctor` answering from a cache would be useless — and an
 * unreachable check is `null`, never a failed report.
 */
export async function upgradeAvailable(
  home: string,
): Promise<{ current: string; latest: string } | null> {
  const check = await checkForUpgrade({
    home,
    currentVersion: VERSION,
    now: Date.now(),
    force: true,
  }).catch(() => ({ kind: 'unreachable' as const }))
  return check.kind === 'available' ? { current: VERSION, latest: check.release.version } : null
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
    upgradeAvailable: await (deps.upgradeCheck ?? upgradeAvailable)(deps.home),
  })
  if (opts.json) deps.write(JSON.stringify(report))
  else for (const line of formatDoctor(report)) deps.write(line)
  return report
}
