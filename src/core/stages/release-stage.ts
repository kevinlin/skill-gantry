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

/** Per-run state the pipeline does not carry, keyed by the run directory. */
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

function single(stage: 'release', toolRun: ToolRunRecord): StageResult {
  const outcome =
    toolRun.outcome === 'passed'
      ? 'passed'
      : toolRun.outcome === 'failed'
        ? 'failed'
        : toolRun.outcome === 'skipped'
          ? 'skipped'
          : 'errored'
  return {
    stage,
    outcome,
    verdict: toolRun.outcome === 'failed' ? 'failed' : 'passed',
    toolRuns: [toolRun],
  }
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
 * Design §12.4. The order is inverted from revision 2, which applied first and
 * verified afterwards: a packaging or installability failure then had to undo a
 * change already live in the user's repo, and the archive — a required output —
 * was in neither the mutation scope nor the journal, so an aborted release could
 * leave a zip behind while claiming to have rolled back.
 */
export class ReleaseStageExecutor implements StageExecutor {
  readonly stage = 'release' as const
  readonly mutating = true

  readonly #staged = new Map<string, Staged>()

  constructor(private readonly options: ReleaseStageOptions) {}

  async plan(ctx: StageContext): Promise<StagePlan> {
    const version = this.#targetVersion(ctx)
    const manifest = await readVersionsManifest(ctx.skill.repo.path)
    const archiveName = `${manifestKeyFor(ctx.skill)}_${version ?? '0.0.0'}.zip`
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

  // `plan` carries nothing `execute` needs a second time — the target version
  // and manifest mode are both re-derived here, from the live tree rather than
  // from the plan-time snapshot, precisely because `checkPreconditions` must
  // see whatever changed between plan and execute.
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
    if (!ctx.sandbox) {
      return single(
        this.stage,
        record('errored', 'mutation-aborted', 'no sandbox was opened for the release', locked.resolvedVersion),
      )
    }
    if (!ctx.releaseTarget) {
      return single(
        this.stage,
        record('failed', null, 'no target version supplied: release never infers one (R9.10)', locked.resolvedVersion),
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

    // resolve-target-version
    let version: string
    try {
      version = resolveTargetVersion(ctx.skill.version, ctx.releaseTarget.version)
    } catch (err) {
      return single(this.stage, record('failed', null, (err as Error).message, locked.resolvedVersion))
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
        return single(
          this.stage,
          record(
            'failed',
            null,
            `installability gate refused: ${check.output.trim().split('\n')[0] ?? ''}`,
            locked.resolvedVersion,
          ),
        )
      }

      // The archive joins the change set by being placed in the sandbox at its
      // eventual repo-relative path, so it is previewed, journalled and removed
      // by a rollback exactly like every other scoped file (R9.4).
      const archiveName = `${manifestKeyFor(ctx.skill)}_${version}.zip`
      const inSandbox = ctx.sandbox.resolve(archiveName)
      await mkdir(join(inSandbox, '..'), { recursive: true })
      await copyFile(packaged.archivePath, inSandbox)

      this.#staged.set(ctx.runDir, {
        version,
        archiveSha256: packaged.sha256,
        archiveName,
        manifestMode: staged.manifestMode,
        gates,
        skillDigest: currentDigest,
        manifestEntries: liveManifest.entries,
      })

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
      const message = (err as Error).message
      const kind: ErrorKind = /ENOENT|could not be invoked|spawn|ETIMEDOUT/i.test(message)
        ? /ETIMEDOUT|timed out/i.test(message)
          ? 'timeout'
          : 'spawn'
        : 'mutation-aborted'
      return single(this.stage, record('errored', kind, message, locked.resolvedVersion))
    }
  }

  prepareMutation = (ctx: StageContext): Promise<PendingMutation | null> => prepareFromSandbox(ctx)

  applyMutation = async (ctx: StageContext, pending: PendingMutation): Promise<void> => {
    await applyFromSandbox(ctx, pending)
    const staged = this.#staged.get(ctx.runDir)
    if (!staged) return
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
