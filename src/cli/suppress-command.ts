import {
  applySuppression,
  discardSuppression,
  issueDetectionRules,
  listIssues,
  openLedger,
  previewSuppression,
  type DetectionRule,
} from '../core/index.js'
import { selectSkill, type CliDeps } from './run-command.js'

export interface SuppressOptions {
  tool?: string
  rule?: string
  path?: string
  fingerprint?: string
  reason?: string
  yes?: boolean
  json?: boolean
}

/**
 * R12.7. The exit code reports whether a suppression was written, never
 * whether the skill passes: R12.2 already binds `run`'s code to stage
 * outcomes, and reusing that meaning here would make a clean skill
 * indistinguishable from a failed lookup. The non-zero codes are distinct
 * because a script acts differently on each — a bad request is the caller's
 * fault, an uncovered tool is the ecosystem's, and an entry already present is
 * success that needed no write.
 */
export async function runSuppress(
  deps: CliDeps,
  selector: string,
  options: SuppressOptions,
): Promise<number> {
  const reason = (options.reason ?? '').trim()
  if (reason === '') {
    deps.write('a suppression reason is required')
    return 2
  }

  const { skill } = await selectSkill(deps.home, selector)

  let rules: DetectionRule[]
  let stillReporting: string[]
  if (options.fingerprint !== undefined) {
    const ledger = openLedger(deps.dbPath)
    try {
      rules = issueDetectionRules(ledger.db, options.fingerprint)
      const row = listIssues(ledger.db, { skillId: skill.id }).find(
        (issue) => issue.fingerprint === options.fingerprint,
      )
      if (row === undefined) {
        deps.write(`no issue ${options.fingerprint} recorded for ${skill.id}`)
        return 2
      }
      stillReporting = row.blockedBy
    } finally {
      ledger.close()
    }
  } else {
    if (options.tool === undefined || options.rule === undefined || options.path === undefined) {
      deps.write('supply --fingerprint, or all of --tool, --rule and --path')
      return 2
    }
    rules = [{ toolId: options.tool, nativeRuleId: options.rule, relPath: options.path }]
    stillReporting = [options.tool]
  }

  const preview = await previewSuppression({ skill, reason, rules, stillReporting })
  const json = options.json === true

  if (preview.plans.length === 0) {
    for (const toolId of preview.uncovered) deps.write(`${toolId} declares no baseline`)
    if (preview.uncovered.length === 0) deps.write('no detecting tool declares a baseline')
    return 3
  }
  if (preview.plans.every((plan) => plan.added === 0)) {
    for (const plan of preview.plans) await discardSuppression(plan)
    deps.write(`already suppressed in ${preview.plans.map((plan) => plan.label).join(', ')}`)
    return 4
  }

  // R12.4's rule: the diff is emitted to output immediately before the write.
  // Suppressed under --json, where it travels as a key instead, because a
  // second document on the same stream is not one a caller can parse.
  if (!json) {
    for (const plan of preview.plans) deps.write(plan.diff)
    for (const toolId of preview.uncovered) {
      deps.write(`${toolId} also reports this and declares no baseline — the gate will still fail`)
    }
  }

  if (options.yes !== true) {
    for (const plan of preview.plans) await discardSuppression(plan)
    deps.write('nothing written; pass --yes to authorise the write')
    return 5
  }

  const written: string[] = []
  for (const plan of preview.plans) {
    await applySuppression(plan)
    written.push(plan.path)
  }
  if (json) {
    deps.write(
      JSON.stringify(
        {
          written,
          uncovered: preview.uncovered,
          reason,
          diff: preview.plans.map((plan) => plan.diff).join('\n'),
        },
        null,
        2,
      ),
    )
  } else {
    for (const path of written) deps.write(`${path} written`)
  }
  return 0
}
