import { copyFile, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { candidateManifest } from '../discovery/candidate.js'
import { skillDigest } from '../discovery/digest.js'
import type { Ledger } from '../ledger/db.js'
import { latestGateOutcomes } from '../ledger/gates.js'
import { packageCandidate } from '../release/archive.js'
import { writeEvidenceBundle } from '../release/evidence.js'
import { verifyInstallable } from '../release/install-check.js'
import { readVersionsManifest } from '../release/manifest.js'
import { checkPreconditions } from '../release/preconditions.js'
import { type ManifestMode, manifestKeyFor, releaseScope, stageCandidateEdits } from '../release/release.js'
import { resolveTargetVersion } from '../release/version.js'
import { RELEASE_TOOL_ID } from '../tools/catalogue.js'
import { type Exec, defaultExec } from '../tools/exec.js'
import type { ErrorKind, ToolOutcome } from '../types.js'
import { reduceStageOutcome } from './outcome.js'
import { applyFromSandbox, discardFromSandbox, prepareFromSandbox } from './mutation.js'
import type {
  PendingMutation,
  StageContext,
  StageExecutor,
  StagePlan,
  StageResult,
  ToolRunRecord,
} from './types.js'

export interface ReleaseStageOptions {
  ledger: Ledger
  exec?: Exec
  /** Injected so the changelog date is not read from the clock in a test. */
  now?: () => Date
  /** R10.10: supplied by the caller, which is the only place that scans. */
  interrupted?: boolean
}

/**
 * Per-run state the pipeline does not carry. A plain nullable field, not a
 * map keyed by run directory: `run.ts` builds one `ReleaseStageExecutor` per
 * stage invocation (§6), so one instance ever sees at most one release, and a
 * map that nothing ever deletes from would just be a field wearing a
 * collection's clothes.
 */
interface Staged {
  version: string
  archiveSha256: string
  archiveName: string
  manifestMode: ManifestMode
  gates: ReturnType<typeof latestGateOutcomes>
  skillDigest: string
  manifestEntries: Awaited<ReturnType<typeof candidateManifest>>['entries']
}

function record(
  outcome: ToolOutcome,
  errorKind: ErrorKind | null,
  summary: string,
  version: string | null,
): ToolRunRecord {
  return {
    toolId: RELEASE_TOOL_ID,
    toolVersion: version,
    outcome,
    exitCode: null,
    durationMs: 0,
    errorKind,
    artefactDir: '',
    findings: [],
    metrics: {},
    summary,
  }
}

/**
 * §8.2's total reduction, applied to release's one synthesised tool run
 * instead of hand-rolled a second time: a second copy of that decision table
 * would drift the day §8.2 changes and this one is not updated to match.
 */
function single(stage: 'release', toolRun: ToolRunRecord): StageResult {
  const { outcome, verdict } = reduceStageOutcome([toolRun.outcome])
  return { stage, outcome, verdict, toolRuns: [toolRun] }
}

/** True when a file exists at `path`, false for absent, permission-denied, or any other stat failure. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Row 5/6 of §12.4's classification table, for a failure this stage's own
 * code raised or that propagated out of `packageCandidate` / `verifyInstallable`
 * unconverted (a spawn failure classifying `unzip` itself, not the `skills`
 * invocation `verifyInstallable` already turns into an `InstallCheckResult`).
 * Reads the error object's own signal — `killed` and `code` — the same way
 * Node reports it, rather than pattern-matching `message`: a timeout's message
 * is `Command failed: …` with no "timeout" substring in it at all, so a regex
 * over text can only ever be an approximation of what the error object already
 * states directly.
 */
function classifyExecError(err: unknown): ErrorKind {
  const failure = err as { code?: number | string; killed?: boolean } | null
  if (failure?.killed === true) return 'timeout'
  if (typeof failure?.code === 'string') return 'spawn'
  // Not a Node process error: a bug, a bad frontmatter block, a manifest key
  // release itself wrote wrong. Row 3b's kind is the closest existing fit —
  // the sandbox held authorised, in-progress work that could not complete.
  return 'mutation-aborted'
}

/** First line only: `skills`'s own stderr can be several lines of usage help. */
const firstLine = (text: string): string => text.trim().split('\n')[0] ?? ''

/**
 * Design §12.4. The order is inverted from revision 2, which applied first and
 * verified afterwards: a packaging or installability failure then had to undo a
 * change already live in the user's repo, and the archive — a required output —
 * was in neither the mutation scope nor the journal, so an aborted release could
 * leave a zip behind while claiming to have rolled back.
 */
export class ReleaseStageExecutor implements StageExecutor {
  readonly stage = 'release' as const
  readonly mutating = true

  #staged: Staged | null = null

  constructor(private readonly options: ReleaseStageOptions) {}

  async plan(ctx: StageContext): Promise<StagePlan> {
    const version = this.#targetVersion(ctx)
    if (version === null) {
      // No `releaseTarget`, or one that does not resolve: there is nothing
      // this stage could stage, package or verify, so declaring a non-empty
      // scope here would only make the pipeline open a sandbox for `execute`
      // to immediately refuse in.
      return { toolIds: [], policy: 'native', mutationScope: { paths: [] } }
    }
    const manifest = await readVersionsManifest(ctx.skill.repo.path)
    const archiveName = `${manifestKeyFor(ctx.skill)}_${version}.zip`
    return {
      // Empty per design §6: release selects no tool from `stageTools`. The one
      // tool it does invoke is reported as a tool run by `execute`.
      toolIds: [],
      policy: 'native',
      mutationScope: releaseScope(ctx.skill, manifest !== null, archiveName),
    }
  }

  #targetVersion(ctx: StageContext): string | null {
    if (!ctx.releaseTarget) return null
    try {
      return resolveTargetVersion(ctx.skill.version, ctx.releaseTarget.version)
    } catch {
      return null
    }
  }

  // `plan` carries nothing `execute` needs a second time — the manifest mode
  // is re-derived here, from the live tree rather than the plan-time
  // snapshot, precisely because `checkPreconditions` must see whatever
  // changed between plan and execute.
  async execute(ctx: StageContext): Promise<StageResult> {
    const exec = this.options.exec ?? defaultExec

    if (!ctx.authorised) {
      return single(
        this.stage,
        record('skipped', 'no-authorisation', 'release needs authorisation (--yes)', null),
      )
    }
    const locked = ctx.lock.tools[RELEASE_TOOL_ID]
    if (!locked) {
      return single(
        this.stage,
        record(
          'skipped',
          'not-installed',
          `${RELEASE_TOOL_ID} is not installed: release cannot run its installability gate`,
          null,
        ),
      )
    }

    // resolve-target-version, ahead of the sandbox check: it is a pure
    // function of the frontmatter version and the requested spec, so nothing
    // is lost by computing it before depending on whether a sandbox exists —
    // and `plan()` already declared an empty scope for exactly this failure,
    // so the pipeline never opened one to refuse in.
    if (!ctx.releaseTarget) {
      return single(
        this.stage,
        record('failed', null, 'no target version supplied: release never infers one (R9.10)', locked.resolvedVersion),
      )
    }
    let version: string
    try {
      version = resolveTargetVersion(ctx.skill.version, ctx.releaseTarget.version)
    } catch (err) {
      return single(this.stage, record('failed', null, (err as Error).message, locked.resolvedVersion))
    }

    if (!ctx.sandbox) {
      return single(
        this.stage,
        record('errored', 'mutation-aborted', 'no sandbox was opened for the release', locked.resolvedVersion),
      )
    }

    // A versions.json that exists but does not parse to the expected shape is
    // closer to R9.2's "already disagree" than to "no manifest": silently
    // falling through to the SKILL.md-only path would release a version the
    // repo's own manifest — unreadably — might already contradict. Refuse
    // instead of guessing, and say so, rather than reporting a misleadingly
    // generic precondition failure.
    const manifestPath = join(ctx.skill.repo.path, 'versions.json')
    const repoManifest = await readVersionsManifest(ctx.skill.repo.path)
    if (repoManifest === null && (await pathExists(manifestPath))) {
      return single(
        this.stage,
        record(
          'failed',
          null,
          'versions.json exists but could not be read as the expected {"skills": {...}} shape: ' +
            'fix or remove it before releasing (R9.2)',
          locked.resolvedVersion,
        ),
      )
    }

    // validate-preconditions
    const liveManifest = await candidateManifest(ctx.skill)
    const currentDigest = await skillDigest(liveManifest)
    const gates = latestGateOutcomes(this.options.ledger.db, ctx.skill.id)
    const refusals = checkPreconditions({
      gates,
      currentDigest,
      // R1.6: the candidate's frontmatter, never the ledger.
      deprecated: ctx.skill.deprecated,
      frontmatterVersion: ctx.skill.version,
      manifestVersion: repoManifest?.versions[manifestKeyFor(ctx.skill)] ?? null,
      hasManifest: repoManifest !== null,
      interrupted: this.options.interrupted === true,
    })
    if (refusals.length > 0) {
      return single(
        this.stage,
        record('failed', null, refusals.map((r) => r.message).join('; '), locked.resolvedVersion),
      )
    }

    const stagingDir = join(ctx.runDir, 'staging')
    try {
      // stage-candidate-edits
      const staged = await stageCandidateEdits({
        sandbox: ctx.sandbox,
        skill: ctx.skill,
        version,
        date: (this.options.now?.() ?? new Date()).toISOString().slice(0, 10),
        ...(ctx.releaseTarget.notes === undefined ? {} : { notes: ctx.releaseTarget.notes }),
        manifest: repoManifest,
      })

      // package-in-sandbox: over the *sandbox* skill directory, so the archive is
      // exactly the bytes being released rather than the bytes on disk.
      const sandboxSkill = {
        ...ctx.skill,
        dir: ctx.sandbox.resolve(ctx.skill.relPath === '.' ? '.' : ctx.skill.relPath),
        repo: { ...ctx.skill.repo, path: ctx.sandbox.workRoot },
      }
      const packaged = await packageCandidate({
        manifest: await candidateManifest(sandboxSkill),
        stagingDir,
        skillName: manifestKeyFor(ctx.skill),
        version,
        exec,
      })

      // verify-install
      const check = await verifyInstallable({
        archivePath: packaged.archivePath,
        stagingDir,
        skillsBin: locked.bin,
        exec,
      })
      if (!check.ok) {
        // A spawn failure or a timeout is not the tool's own verdict on the
        // candidate — §12.4 rows 5/6, `errored`, not `failed` (row 4).
        if (check.errorKind) {
          return single(
            this.stage,
            record(
              'errored',
              check.errorKind,
              `${RELEASE_TOOL_ID} ${check.errorKind === 'timeout' ? 'timed out' : 'could not be invoked'}: ${firstLine(check.output)}`,
              locked.resolvedVersion,
            ),
          )
        }
        return single(
          this.stage,
          record('failed', null, `installability gate refused: ${firstLine(check.output)}`, locked.resolvedVersion),
        )
      }

      // The archive joins the change set by being placed in the sandbox at its
      // eventual repo-relative path, so it is previewed, journalled and removed
      // by a rollback exactly like every other scoped file (R9.4).
      const archiveName = `${manifestKeyFor(ctx.skill)}_${version}.zip`
      const inSandbox = ctx.sandbox.resolve(archiveName)
      await mkdir(join(inSandbox, '..'), { recursive: true })
      await copyFile(packaged.archivePath, inSandbox)

      this.#staged = {
        version,
        archiveSha256: packaged.sha256,
        archiveName,
        manifestMode: staged.manifestMode,
        gates,
        skillDigest: currentDigest,
        manifestEntries: liveManifest.entries,
      }

      return single(
        this.stage,
        record(
          'passed',
          null,
          `staged ${manifestKeyFor(ctx.skill)} ${version}, archive verified installable`,
          locked.resolvedVersion,
        ),
      )
    } catch (err) {
      return single(
        this.stage,
        record('errored', classifyExecError(err), (err as Error).message, locked.resolvedVersion),
      )
    }
  }

  /**
   * Null unless `execute` reached `passed` and staged its state: a release
   * that failed its own installability gate (or anything else before then)
   * has nothing worth previewing, and `run.ts` treats a null pending mutation
   * as R9.11's before-apply abort — a sandbox discard, nothing to compensate.
   * Without this guard a refused release still surfaced a diff, and an
   * apply on it would have written the version bump and changelog live with
   * no archive and no evidence, which is not what design §12.4 promises.
   */
  prepareMutation = (ctx: StageContext): Promise<PendingMutation | null> =>
    this.#staged ? prepareFromSandbox(ctx) : Promise.resolve(null)

  applyMutation = async (ctx: StageContext, pending: PendingMutation): Promise<void> => {
    await applyFromSandbox(ctx, pending)
    const staged = this.#staged
    if (!staged) {
      // Unreachable given `prepareMutation`'s guard: the pipeline only calls
      // `applyMutation` on a pending mutation `prepareMutation` itself
      // produced, and it produces one only when `#staged` is set. Thrown
      // rather than silently skipped, because a caller that got here anyway
      // just wrote to the live tree with no evidence bundle to show for it —
      // exactly the failure mode R9.5 exists to make impossible.
      throw new Error(
        `applyMutation ran for ${ctx.runDir} with no staged release state — the live write ` +
          'happened but no evidence will be recorded for it',
      )
    }
    // record-evidence, after the apply: R9.5's bundle describes a release that
    // happened, and writing it before the apply would leave evidence for one
    // that did not.
    await writeEvidenceBundle({
      runDir: ctx.runDir,
      gates: staged.gates,
      lock: ctx.lock,
      skillDigest: staged.skillDigest,
      manifest: { root: ctx.skill.dir, entries: staged.manifestEntries, selfContained: !ctx.skill.rootSkill },
      archiveSha256: staged.archiveSha256,
      manifestMode: staged.manifestMode,
      targetVersion: staged.version,
    })
  }

  discardMutation = (ctx: StageContext): Promise<void> => discardFromSandbox(ctx)
}
