import {
  GATE_STAGES,
  latestGateOutcomes,
  loadConfig,
  openIssueCounts,
  openLedger,
} from '../core/index.js'
import { type CliDeps, discoverAll, skillName } from './run-command.js'

export interface ListOptions {
  json?: boolean
}

type GateStage = 'validate' | 'evaluate' | 'security'

/** One row of design §15.1's `list` document. */
export interface ListedSkill {
  id: string
  name: string
  repoId: string
  dir: string
  version: string | null
  deprecated: boolean
  gates: Record<GateStage, string | null>
  openIssues: number
}

/**
 * R12.11. Reads the ledger and computes no digest, so a verdict here is the last
 * one recorded and may be about other bytes: saying whether it still holds costs
 * a read of every file in the skill, which is `status`'s job for one skill and
 * would be a walk of the whole repo here.
 *
 * It does not call `syncLifecycle` either — that is a write, and `deprecated`
 * comes from the frontmatter R1.6 makes the authority anyway.
 */
export async function runList(deps: CliDeps, opts: ListOptions): Promise<void> {
  const skills = await discoverAll(await loadConfig(deps.home))

  const ledger = openLedger(deps.dbPath)
  let rows: ListedSkill[]
  try {
    rows = skills.map((skill) => {
      const recorded = new Map(latestGateOutcomes(ledger.db, skill.id).map((g) => [g.stage, g.outcome]))
      const open = openIssueCounts(ledger.db, { skillId: skill.id }).bySeverity
      return {
        id: skill.id,
        name: skillName(skill),
        repoId: skill.repo.id,
        dir: skill.dir,
        version: skill.version,
        deprecated: skill.deprecated,
        gates: Object.fromEntries(
          GATE_STAGES.map((stage) => [stage, recorded.get(stage) ?? null]),
        ) as Record<GateStage, string | null>,
        openIssues: open.reduce((total, row) => total + row.count, 0),
      }
    })
  } finally {
    ledger.close()
  }

  if (opts.json === true) {
    deps.write(JSON.stringify({ skills: rows }))
    return
  }
  if (rows.length === 0) {
    deps.write('no skills found: register a repo with `skillgantry repo add <path>`')
    return
  }
  for (const row of rows) {
    const gates = GATE_STAGES.map((stage) => `${stage} ${row.gates[stage as GateStage] ?? '-'}`).join('  ')
    deps.write(
      `${row.id}  ${row.version ?? '-'}${row.deprecated ? ' (deprecated)' : ''}  ${gates}  ${row.openIssues} open`,
    )
  }
}
