import {
  GATE_STAGES,
  gatherReleasePreconditions,
  latestGateOutcomes,
  listIssues,
  loadToolLock,
  openIssueCounts,
  openLedger,
  releaseDirtyPaths,
  type IssueRow,
  type SeverityCount,
} from '../core/index.js'
import { candidateManifest } from '../core/discovery/candidate.js'
import { skillDigest } from '../core/discovery/digest.js'
import type { Stage } from '../core/types.js'
import { detectInterrupted } from './recover-command.js'
import { type CliDeps, selectSkill, skillName } from './run-command.js'
import { hasEvalSuite } from './skill-evals.js'

export interface StatusOptions {
  json?: boolean
}

export interface GateStatus {
  stage: Stage
  outcome: string | null
  runId: string | null
  runDir: string | null
  /** The recorded run's digest is the one computed now. */
  current: boolean
}

export interface NextStep {
  /** null when no command resolves it: the maintainer has to act. */
  command: string | null
  why: string
}

export interface NextInput {
  skillId: string
  interrupted: boolean
  deprecated: boolean
  hasEvalSuite: boolean
  /** Always the three gate stages, in `GATE_STAGES` order. */
  gates: readonly GateStatus[]
  blockers: readonly { code: string; message: string }[]
  dirty: readonly string[]
}

/** The three refusals that are decided only once a target version exists. */
const UNCHECKED = ['target-version', 'archive', 'sandbox'] as const

const listOf = (stages: readonly string[]): string => stages.join(',')

/**
 * Design §15.1's "`next` is ordered". Pure, so each branch is one case: an
 * interrupted mutation, then a blocker no command resolves, then deprecation,
 * then the gates — and with no blocker left, release alone. Every blocker the
 * gatherer can emit has an entry somewhere in that order; a blocked skill with
 * an empty `next` is a dead end.
 *
 * A gate is stale before it is anything else. A failure recorded against other
 * bytes is not a finding to fix: the bytes it was about may be gone, so the
 * answer is a re-run, and `fix` is for what the *current* bytes failed.
 *
 * `--run` on a `fix` suggestion is load-bearing. Gates are selected per stage
 * and `fix` defaults to the newest run, which need not have executed that stage
 * at all.
 */
export function nextSteps(input: NextInput): NextStep[] {
  const id = input.skillId
  if (input.blockers.length === 0) {
    const uncommitted =
      input.dirty.length === 0
        ? ''
        : `; uncommitted in the release scope: ${input.dirty.join(', ')} ` +
          '(commit them, or add --allow-dirty to release over them)'
    return [
      {
        command: `skillgantry release ${id} --version <patch|minor|major> --yes`,
        why: `every gate passed against the current bytes and nothing blocks the release${uncommitted}`,
      },
    ]
  }

  const steps: NextStep[] = []

  if (input.interrupted) {
    steps.push({
      command: 'skillgantry recover',
      why: 'an interrupted mutation of this skill is unresolved: release refuses until it is restored or forgotten',
    })
  }

  for (const blocker of input.blockers) {
    // None of these has a command that clears it, and an entry-less blocker
    // leaves a caller that follows `next` with nowhere to go. A version
    // disagreement and an unreadable versions.json are files the maintainer
    // owns: no command here knows which bytes are right.
    if (blocker.code === 'version-disagreement' || blocker.code === 'manifest-unreadable') {
      steps.push({ command: null, why: blocker.message })
    }
    // `setup` is the install path and it is a wizard, so the step is named for
    // the one who can take it rather than left as a command an agent would try.
    if (blocker.code === 'release-tool-missing') {
      steps.push({
        command: null,
        why:
          `${blocker.message}; the maintainer has to run \`skillgantry setup\` in a terminal ` +
          'to install it, which an agent cannot',
      })
    }
  }

  if (input.deprecated) {
    steps.push({
      command: `skillgantry retire ${id} --undo`,
      why: 'the skill is deprecated: release refuses a deprecated skill until the deprecation is cleared',
    })
  }

  if (!input.hasEvalSuite) {
    steps.push({
      command: `skillgantry evals ${id}`,
      why: 'no evals/eval.yaml: the evaluate gate has no suite to run',
    })
  }

  const stale = input.gates.filter((gate) => gate.outcome === null || !gate.current)
  if (stale.length > 0) {
    steps.push({
      command: `skillgantry run ${id} --stage ${listOf(stale.map((gate) => gate.stage))}`,
      why: stale
        .map((gate) =>
          gate.outcome === null ? `${gate.stage} has never run` : `${gate.stage} last ran against other bytes`,
        )
        .join('; '),
    })
  }

  const current = input.gates.filter((gate) => gate.outcome !== null && gate.current)
  for (const gate of current.filter((entry) => entry.outcome === 'failed')) {
    steps.push({
      command: `skillgantry fix ${id} --stage ${gate.stage} --run ${gate.runId}`,
      why: `${gate.stage} failed against the current bytes (run ${gate.runId}): print its prompt for a coding agent, apply it, then re-run`,
    })
  }

  const degraded = current.filter((gate) => gate.outcome !== 'passed' && gate.outcome !== 'failed')
  if (degraded.length > 0) {
    steps.push({
      command: `skillgantry run ${id} --stage ${listOf(degraded.map((gate) => gate.stage))}`,
      why: `${degraded.map((gate) => gate.stage).join(', ')} degraded: a tool did not complete, which is not a finding to fix — re-run it`,
    })
    steps.push({
      command: 'skillgantry doctor',
      why: 'a tool that did not complete usually means a missing or drifted install; doctor re-verifies every locked tool',
    })
  }

  return steps
}

type OpenState = 'open' | 'acknowledged'

const isOpen = (issue: IssueRow): issue is IssueRow & { state: OpenState } =>
  issue.state === 'open' || issue.state === 'acknowledged'

/** Design §15.1's `status` document. */
export interface StatusDocument {
  skill: {
    id: string
    name: string
    repoId: string
    dir: string
    repoPath: string
    version: string | null
    deprecated: boolean
    digest: string
  }
  gates: GateStatus[]
  hasEvalSuite: boolean
  issues: {
    open: number
    suppressed: number
    bySeverity: SeverityCount[]
    items: Array<{
      fingerprint: string
      severity: string
      ruleClass: string
      path: string
      state: OpenState
      detectors: string[]
    }>
  }
  release: {
    ready: boolean
    blockers: Array<{ code: string; message: string }>
    dirty: string[]
    unchecked: string[]
  }
  next: NextStep[]
}

/**
 * R12.12. Writes nothing to the repo or the sidecar, and does not call
 * `syncLifecycle`: that reconciles the ledger's lifecycle cache and is a write,
 * and `deprecated` is read from the frontmatter, which R1.6 makes the authority.
 * Opening the ledger can create and migrate it, as for every command.
 *
 * The blockers are `gatherReleasePreconditions`' — the function the release
 * stage calls — so this cannot answer from a second implementation of what
 * release refuses on.
 */
export async function buildStatus(deps: CliDeps, selector: string): Promise<StatusDocument> {
  const { skill } = await selectSkill(deps.home, selector)
  const lock = await loadToolLock(deps.home)
  // The same question `runRelease` asks, so the two cannot disagree about it.
  const interrupted = (await detectInterrupted(deps.home)).some((item) => item.skillId === skill.id)

  const ledger = openLedger(deps.dbPath)
  try {
    const gathered = await gatherReleasePreconditions({ skill, db: ledger.db, lock, interrupted })

    // An unreadable versions.json returns alone, before the digest or the gates
    // were read, and the document still owes both.
    const read = gathered.evidence ?? {
      currentDigest: await skillDigest(await candidateManifest(skill)),
      gates: latestGateOutcomes(ledger.db, skill.id),
    }

    const recorded = new Map(read.gates.map((gate) => [gate.stage, gate]))
    const gates: GateStatus[] = GATE_STAGES.map((stage) => {
      const gate = recorded.get(stage)
      return gate === undefined
        ? { stage, outcome: null, runId: null, runDir: null, current: false }
        : {
            stage,
            outcome: gate.outcome,
            runId: gate.runId,
            runDir: gate.sidecarPath,
            current: gate.skillDigest === read.currentDigest,
          }
    })

    const counts = openIssueCounts(ledger.db, { skillId: skill.id })
    const items = listIssues(ledger.db, { skillId: skill.id, suppressed: false })
      .filter(isOpen)
      .map((issue) => ({
        fingerprint: issue.fingerprint,
        severity: issue.severity,
        ruleClass: issue.ruleClass,
        path: issue.relPath,
        state: issue.state,
        detectors: issue.detectors,
      }))

    const suite = await hasEvalSuite(skill)
    const dirty = await releaseDirtyPaths(skill)
    const blockers = gathered.refusals.map(({ code, message }) => ({ code, message }))

    return {
      skill: {
        id: skill.id,
        name: skillName(skill),
        repoId: skill.repo.id,
        dir: skill.dir,
        repoPath: skill.repo.path,
        version: skill.version,
        deprecated: skill.deprecated,
        digest: read.currentDigest,
      },
      gates,
      hasEvalSuite: suite,
      issues: {
        open: counts.bySeverity.reduce((total, row) => total + row.count, 0),
        suppressed: counts.suppressed,
        bySeverity: counts.bySeverity,
        items,
      },
      release: { ready: blockers.length === 0, blockers, dirty, unchecked: [...UNCHECKED] },
      next: nextSteps({
        skillId: skill.id,
        interrupted,
        deprecated: skill.deprecated,
        hasEvalSuite: suite,
        gates,
        blockers,
        dirty,
      }),
    }
  } finally {
    ledger.close()
  }
}

/**
 * The exit code says whether the document was produced, not whether the skill
 * is ready: a caller that wants readiness reads `release.ready`, and `2` is
 * already the code for "could not answer".
 */
export async function runStatus(deps: CliDeps, selector: string, opts: StatusOptions): Promise<void> {
  const doc = await buildStatus(deps, selector)
  if (opts.json === true) {
    deps.write(JSON.stringify(doc))
    return
  }

  deps.write(`${doc.skill.id}  ${doc.skill.version ?? '-'}${doc.skill.deprecated ? ' (deprecated)' : ''}`)
  deps.write(`  digest  ${doc.skill.digest}`)
  for (const gate of doc.gates) {
    const verdict = gate.outcome === null ? '-' : `${gate.outcome}${gate.current ? '' : ' (stale)'}`
    deps.write(`  ${gate.stage.padEnd(9)} ${verdict}${gate.runId === null ? '' : `  run ${gate.runId}`}`)
  }
  deps.write(`  eval suite  ${doc.hasEvalSuite ? 'yes' : 'no'}`)
  deps.write(`  issues  ${doc.issues.open} open, ${doc.issues.suppressed} suppressed`)
  deps.write(doc.release.ready ? '  release  ready to attempt' : '  release  not ready')
  for (const blocker of doc.release.blockers) deps.write(`    blocked: ${blocker.message}`)
  if (doc.release.dirty.length > 0) deps.write(`    uncommitted: ${doc.release.dirty.join(', ')}`)
  deps.write(`    decided once a target is given: ${doc.release.unchecked.join(', ')}`)
  if (doc.next.length > 0) deps.write('  next')
  for (const step of doc.next) {
    deps.write(`    ${step.command ?? '(by hand)'}`)
    deps.write(`      ${step.why}`)
  }
}
