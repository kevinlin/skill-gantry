import { GATE_STAGES, type GateOutcome } from '../ledger/gates.js'

export type RefusalCode =
  | 'deprecated'
  | 'gate-missing'
  | 'gate-not-passed'
  | 'digest-mismatch'
  | 'version-disagreement'
  | 'interrupted-mutation'

export interface Refusal {
  code: RefusalCode
  message: string
}

export interface PreconditionInput {
  gates: readonly GateOutcome[]
  /** The candidate's digest right now, over its candidate manifest. */
  currentDigest: string
  /** R1.6: read from the candidate's frontmatter, never from the ledger. */
  deprecated: boolean
  frontmatterVersion: string | null
  /** null when the repo has no versions.json. */
  manifestVersion: string | null
  hasManifest: boolean
  /** R10.10: an unresolved record means a second apply over an unrecovered first. */
  interrupted: boolean
}

/**
 * Every refusal, not the first. A user who has to fix three things learns all
 * three from one run rather than three.
 */
export function checkPreconditions(input: PreconditionInput): Refusal[] {
  const refusals: Refusal[] = []

  if (input.deprecated) {
    refusals.push({
      code: 'deprecated',
      message: 'the skill is deprecated: gates still run against it, release does not (R1.4)',
    })
  }

  const byStage = new Map(input.gates.map((gate) => [gate.stage, gate]))
  for (const stage of GATE_STAGES) {
    const gate = byStage.get(stage)
    if (!gate) {
      refusals.push({ code: 'gate-missing', message: `${stage} has never run for this skill` })
      continue
    }
    if (gate.outcome !== 'passed') {
      refusals.push({
        code: 'gate-not-passed',
        message: `${stage} last reported ${gate.outcome} (run ${gate.runId})`,
      })
      continue
    }
    if (gate.skillDigest !== input.currentDigest) {
      refusals.push({
        code: 'digest-mismatch',
        message:
          `${stage} passed against ${gate.skillDigest} and the candidate is now ` +
          `${input.currentDigest}: re-run the gates against these bytes (R9.9)`,
      })
    }
  }

  if (input.hasManifest && input.frontmatterVersion !== input.manifestVersion) {
    refusals.push({
      code: 'version-disagreement',
      message:
        `SKILL.md says ${input.frontmatterVersion ?? 'nothing'} and versions.json says ` +
        `${input.manifestVersion ?? 'nothing'}: reconcile them before releasing (R9.2)`,
    })
  }

  if (input.interrupted) {
    refusals.push({
      code: 'interrupted-mutation',
      message: 'an interrupted mutation is unresolved: run `skillgantry recover` first',
    })
  }

  return refusals
}
