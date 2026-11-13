import type { DatabaseSync } from 'node:sqlite'
import {
  GATE_STAGES,
  gatherReleasePreconditions,
  latestGateOutcomes,
  listIssues,
  loadToolLock,
  openIssueCounts,
  openLedger,
  releaseDirtyPaths,
  resolveTargetVersion,
  type GatheredPreconditions,
  type GatheredRefusalCode,
  type IssueRow,
  type SeverityCount,
} from '../core/index.js'
import { candidateManifest } from '../core/discovery/candidate.js'
import { skillDigest } from '../core/discovery/digest.js'
import type { SkillRef, Stage } from '../core/types.js'
import { detectInterrupted } from './recover-command.js'
import { type CliDeps, selectSkill, skillName } from './run-command.js'
import { hasEvalSuite } from './skill-evals.js'

export interface StatusOptions {
  json?: boolean
  /** R12.19: a release target to decide the checks that need only one. */
  version?: string
}

/**
 * Every `release.blockers[].code` the document can carry: the gatherer's, and
 * the one refusal only a request can cause. Not a member of
 * `GatheredRefusalCode`, because `gatherReleasePreconditions` takes no target
 * and a code it could never emit does not belong in its union.
 */
export type StatusBlockerCode = GatheredRefusalCode | 'target-invalid'

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
  /** Under `--version`: what the target resolved to, which release then names. */
  releaseVersion?: string
  /** The skill declares no version, so a bump level has nothing to bump (R12.12). */
  unversioned?: boolean
}

/** The three refusals that are decided only once a target version exists. */
const UNCHECKED = ['target-version', 'archive', 'sandbox'] as const

/**
 * What `--version` leaves undecided. Opening a sandbox registers a worktree,
 * and `status` writes nothing, so this is the one check it cannot run.
 */
const UNCHECKED_UNDER_TARGET = ['sandbox'] as const

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
    // A bump level is offered only where it can resolve. A skill with no
    // version has none to bump, and R9.10 refuses the level the entry used to
    // name — five skills in the reference home were each sent to it.
    const bumpless = input.releaseVersion === undefined && input.unversioned === true
    const version = input.releaseVersion ?? (bumpless ? '<semver>' : '<patch|minor|major>')
    const noBump = bumpless
      ? '; the skill declares no version, so a bump level has nothing to bump: give the first version as a semver'
      : ''
    return [
      {
        command: `skillgantry release ${id} --version ${version} --yes`,
        why: `every gate passed against the current bytes and nothing blocks the release${noBump}${uncommitted}`,
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
    // owns: no command here knows which bytes are right. A target that does not
    // resolve is theirs for the same reason — R9.10 has release never infer a
    // version, so a command that substituted one would release a number nobody
    // chose.
    if (
      blocker.code === 'version-disagreement' ||
      blocker.code === 'manifest-unreadable' ||
      blocker.code === 'target-invalid'
    ) {
      steps.push({ command: null, why: blocker.message })
    }
    // Two routes install it, and neither is a command an agent should run on
    // its own: a preset also rewrites the stage selection (R12.18), so which
    // one is the maintainer's call, and a `command` here would make it the
    // agent's. The reason names both so the maintainer is not sent to a
    // terminal when a script would do.
    if (blocker.code === 'release-tool-missing') {
      steps.push({
        command: null,
        why:
          `${blocker.message}; installing it is the maintainer's call, because a preset also ` +
          'rewrites the stage selection: `skillgantry setup` in a terminal, or ' +
          '`skillgantry setup --yes --preset <name>`',
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
    /** Only under `--version` (R12.19). */
    target?: { requested: string; resolved: string | null }
  }
  next: NextStep[]
}

/**
 * The same question `runRelease` asks, so the two cannot disagree about it.
 */
const isInterrupted = async (home: string, skillId: string): Promise<boolean> =>
  (await detectInterrupted(home)).some((item) => item.skillId === skillId)

/**
 * The digest the gates are compared with, and the three gates in `GATE_STAGES`
 * order, from what `gatherReleasePreconditions` already read. The one place
 * release's evidence becomes `GateStatus[]`, so `status` and every other caller
 * of `gateStatuses` report the same verdicts for the same ledger.
 *
 * An unreadable versions.json returns the gatherer alone, before it read the
 * digest or the gates, and the caller still owes both — hence the fallback to
 * the same two reads, rather than a gate list that is empty because a manifest
 * is not.
 */
async function readGates(
  db: DatabaseSync,
  skill: SkillRef,
  gathered: GatheredPreconditions,
): Promise<{ gates: GateStatus[]; digest: string }> {
  const read = gathered.evidence ?? {
    currentDigest: await skillDigest(await candidateManifest(skill)),
    gates: latestGateOutcomes(db, skill.id),
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
  return { gates, digest: read.currentDigest }
}

/**
 * R11.25's verdicts and R12.12's `gates`, for a caller that wants only those:
 * each gate stage's most recent verdict, and whether the bytes it was recorded
 * against are the ones on disk now. Takes just the two paths and a skill, so a
 * surface that is not a command — the terminal interface's rail, through a port
 * — reaches the function the document is built from rather than a copy of it.
 *
 * It opens and closes the ledger itself, and reads the tree for a digest: a
 * verdict is only as current as the moment it is asked.
 */
export async function gateStatuses(
  deps: Pick<CliDeps, 'home' | 'dbPath'>,
  skill: string | SkillRef,
): Promise<GateStatus[]> {
  const resolved = typeof skill === 'string' ? (await selectSkill(deps.home, skill)).skill : skill
  const lock = await loadToolLock(deps.home)
  const interrupted = await isInterrupted(deps.home, resolved.id)

  const ledger = openLedger(deps.dbPath)
  try {
    const gathered = await gatherReleasePreconditions({ skill: resolved, db: ledger.db, lock, interrupted })
    return (await readGates(ledger.db, resolved, gathered)).gates
  } finally {
    ledger.close()
  }
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
 *
 * `target` is R12.19's `--version`. It is resolved by `resolveTargetVersion`,
 * which `ReleaseStageExecutor.plan` calls, and the archive that resolved
 * version names is previewed with the rest of the scope; neither needs a
 * write. A target that does not resolve is one more blocker and leaves the
 * archive unlooked-for, since there is no name to look for.
 */
export async function buildStatus(
  deps: CliDeps,
  selector: string,
  target?: string,
): Promise<StatusDocument> {
  const { skill } = await selectSkill(deps.home, selector)
  const lock = await loadToolLock(deps.home)
  const interrupted = await isInterrupted(deps.home, skill.id)

  const ledger = openLedger(deps.dbPath)
  try {
    const gathered = await gatherReleasePreconditions({ skill, db: ledger.db, lock, interrupted })
    const { gates, digest } = await readGates(ledger.db, skill, gathered)

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

    let resolved: string | null = null
    const blockers: Array<{ code: StatusBlockerCode; message: string }> = gathered.refusals.map(
      ({ code, message }) => ({ code, message }),
    )
    if (target !== undefined) {
      try {
        resolved = resolveTargetVersion(skill.version, target)
      } catch (err) {
        // A refusal the document reports, not a failure of the command: the
        // question was answered, and the answer was no.
        blockers.push({ code: 'target-invalid', message: (err as Error).message })
      }
    }
    const dirty = await releaseDirtyPaths(skill, undefined, resolved ?? undefined)

    return {
      skill: {
        id: skill.id,
        name: skillName(skill),
        repoId: skill.repo.id,
        dir: skill.dir,
        repoPath: skill.repo.path,
        version: skill.version,
        deprecated: skill.deprecated,
        digest,
      },
      gates,
      hasEvalSuite: suite,
      issues: {
        open: counts.bySeverity.reduce((total, row) => total + row.count, 0),
        suppressed: counts.suppressed,
        bySeverity: counts.bySeverity,
        items,
      },
      release: {
        ready: blockers.length === 0,
        blockers,
        dirty,
        unchecked: [...(target === undefined ? UNCHECKED : UNCHECKED_UNDER_TARGET)],
        ...(target === undefined ? {} : { target: { requested: target, resolved } }),
      },
      next: nextSteps({
        skillId: skill.id,
        interrupted,
        deprecated: skill.deprecated,
        hasEvalSuite: suite,
        gates,
        blockers,
        dirty,
        ...(resolved === null ? {} : { releaseVersion: resolved }),
        ...(skill.version === null ? { unversioned: true } : {}),
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
  const doc = await buildStatus(deps, selector, opts.version)
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
  if (doc.release.target !== undefined) {
    const { requested, resolved } = doc.release.target
    deps.write(`    target  ${requested} -> ${resolved ?? '(does not resolve)'}`)
  }
  if (doc.release.dirty.length > 0) deps.write(`    uncommitted: ${doc.release.dirty.join(', ')}`)
  deps.write(
    doc.release.target === undefined
      ? `    decided once a target is given: ${doc.release.unchecked.join(', ')}`
      : `    not decided here: ${doc.release.unchecked.join(', ')}`,
  )
  if (doc.next.length > 0) deps.write('  next')
  for (const step of doc.next) {
    deps.write(`    ${step.command ?? '(by hand)'}`)
    deps.write(`      ${step.why}`)
  }
}
