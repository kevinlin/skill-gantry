import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { getAdapter } from '../adapters/registry.js'
import {
  type Adapter,
  type AdapterManifest,
  type ConditionalArgv,
  type CredentialRequirement,
  credentialsSatisfied,
  missingCredentials,
} from '../adapters/types.js'
import { MUTATING_STAGES } from '../queue/types.js'
import { type RunToolOutput, runTool } from '../runner/spawn.js'
import type { ErrorKind, SkillRef, Stage } from '../types.js'
import { applyFromSandbox, discardFromSandbox, prepareFromSandbox } from './mutation.js'
import {
  actionableFindings,
  highestSeverity,
  meetsFailFloor,
  reduceStageOutcome,
} from './outcome.js'
import type {
  MutationScope,
  PendingMutation,
  StageContext,
  StageExecutor,
  StagePlan,
  StageResult,
  ToolRunRecord,
} from './types.js'

const FAN_OUT_LIMIT = 2

export interface AdapterStageOptions {
  /** Test seam: substitute a manifest's credential requirement. */
  credentialsOverride?: Readonly<Record<string, CredentialRequirement>>
  /**
   * Test seam: substitute the adapter lookup. Optimise ships no adapter, so
   * R4.8's "two optimise tools must never run concurrently" would otherwise be
   * unassertable rather than merely unreachable.
   */
  lookup?: (id: string) => Adapter | undefined
}

function substitute(argv: readonly string[], vars: Readonly<Record<string, string>>): string[] {
  return argv.map((arg) =>
    arg.replace(/\{(skillDir|repoRoot|toolDir)\}/g, (_m, key: string) => vars[key] ?? _m),
  )
}

/**
 * R4.14. The groups whose declared path exists, appended in declaration order.
 *
 * Here and not in `plan()`: `plan()` runs on the context from before
 * `openSandbox` re-roots `skill.dir`, and a repo-root skill's tool is handed a
 * materialised candidate copy rather than the skill directory — so a stat
 * against the pre-substitution path answers for a directory the tool never sees.
 *
 * `isFile()` rather than existence: `--baseline <dir>` makes skillspector exit
 * 2 with no SARIF written. A stat failure of any kind reads as absent, because
 * a file the engine cannot stat is one the tool cannot read, and the loud
 * direction — every suppressed finding resurfacing — is the safe one.
 */
async function resolveConditionalArgv(
  groups: readonly ConditionalArgv[] | undefined,
  vars: Readonly<Record<string, string>>,
): Promise<string[]> {
  const out: string[] = []
  for (const group of groups ?? []) {
    const [path] = substitute([group.whenExists], vars) as [string]
    const present = await stat(path).then(
      (info) => info.isFile(),
      () => false,
    )
    if (present) out.push(...substitute(group.argv, vars))
  }
  return out
}

type Classification = Pick<
  ToolRunRecord,
  'outcome' | 'errorKind' | 'findings' | 'metrics' | 'summary'
>

const errored = (kind: ErrorKind, summary: string, durationMs: number): Classification => ({
  outcome: 'errored',
  errorKind: kind,
  findings: [],
  metrics: { durationMs },
  summary,
})

/**
 * Rows 4 to 13 of the R4.13 table, in order, first match wins. Rows 1 to 3 are
 * decided before a process is ever spawned, by `skipped()` below.
 *
 * The governing rule is that a schema-valid parse is authoritative and the exit
 * code is fallback evidence only: scanners and linters exit non-zero precisely
 * because they found something, so treating exit status as primary turns valid
 * findings into errors. Only rows 10 to 12b reach reconciliation.
 */
export function classifyToolRun(
  adapter: Adapter,
  skill: SkillRef,
  run: RunToolOutput,
): Classification {
  const { durationMs } = run

  if (run.cancelled) return errored('cancelled', 'cancelled', durationMs)
  if (run.timedOut) return errored('timeout', 'timed out', durationMs)
  if (run.oversizeArtefacts.length > 0) {
    return errored(
      'artefact-too-large',
      `artefact over the size cap: ${run.oversizeArtefacts.join(', ')}`,
      durationMs,
    )
  }
  if (run.spawnFailed) return errored('spawn', `could not spawn: ${run.spawnError}`, durationMs)
  // Before parse, not after: a missing report is not a parser defect, and
  // classifying it by whichever exception the parser raised said it was.
  if (run.missingArtefacts.length > 0) {
    return errored(
      'missing-artefact',
      `declared artefact never written: ${run.missingArtefacts.join(', ')}`,
      durationMs,
    )
  }

  let parsed
  try {
    parsed = adapter.parse({
      skill,
      artefacts: run.artefacts,
      stdout: run.stdout,
      stderr: run.stderr,
      exitCode: run.exitCode,
      durationMs,
    })
  } catch (err) {
    return errored('parse', `parse threw: ${(err as Error).message}`, durationMs)
  }

  if (parsed.outcome === 'errored') {
    return errored('parse', parsed.summary, durationMs)
  }

  // Rows 12b and 12c: the parse found things, but nothing the gate may act on —
  // either every finding is below the fail floor, or the tool itself reported
  // them all as suppressed by the user's own suppression file (R4.15).
  //
  // The findings pass through untouched in both cases, so they are still filed
  // and still reconciled — dropping them would make every issue this tool ever
  // filed look absent and close all of them. Only the gate softens.
  //
  // `findings.length > 0` is load-bearing: every shipped parser derives `failed`
  // from `findings.length`, and without the clause a future parser returning
  // `failed` with nothing to point at would be silently downgraded.
  const highest = highestSeverity(actionableFindings(parsed.findings))
  if (
    parsed.outcome === 'failed' &&
    parsed.findings.length > 0 &&
    (highest === null || !meetsFailFloor(highest))
  ) {
    return {
      outcome: 'passed',
      errorKind: null,
      findings: parsed.findings,
      metrics: { ...parsed.metrics, durationMs },
      // Named, because "2 findings" beside `passed` otherwise reads as a bug.
      summary:
        highest === null ? `${parsed.summary}, none actionable` : `${parsed.summary}, highest ${highest}`,
    }
  }

  // Rows 10 to 12. The exit code is recorded but does not vote.
  return {
    outcome: parsed.outcome,
    errorKind: null,
    findings: parsed.findings,
    metrics: { ...parsed.metrics, durationMs },
    summary: parsed.summary,
  }
}

/** Rows 1 to 3: decided before a process is spawned. */
function skipped(toolId: string, artefactDir: string, kind: ErrorKind, detail = ''): ToolRunRecord {
  const reason: Record<string, string> = {
    'not-installed': 'tool is not installed',
    'no-credentials': `needs ${detail}`,
    'no-authorisation': 'mutating stage without authorisation',
  }
  return {
    toolId,
    toolVersion: null,
    outcome: 'skipped',
    exitCode: null,
    durationMs: 0,
    errorKind: kind,
    artefactDir,
    findings: [],
    metrics: {},
    summary: reason[kind] ?? kind,
  }
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      out[i] = await fn(items[i] as T)
    }
  })
  await Promise.all(workers)
  return out
}

export class AdapterStageExecutor implements StageExecutor {
  /**
   * Derived rather than hard-coded false. The set lives in `queue/types.ts` so
   * the queue can serialise mutating jobs without importing an executor, and
   * reading it here is what stops the two disagreeing about which stages write.
   */
  readonly mutating: boolean

  constructor(
    readonly stage: Stage,
    private readonly options: AdapterStageOptions = {},
  ) {
    this.mutating = MUTATING_STAGES.has(stage)
  }

  private credentialsFor(manifest: AdapterManifest): CredentialRequirement {
    return this.options.credentialsOverride?.[manifest.id] ?? manifest.credentials
  }

  private adapterFor(id: string): Adapter | undefined {
    return (this.options.lookup ?? getAdapter)(id)
  }

  /**
   * Resolves the configured selection and validates it. The lockfile is not
   * consulted here: a selected tool must survive planning even when it is not
   * installed, so that execute() can report it as skipped rather than dropping it.
   */
  async plan(ctx: StageContext): Promise<StagePlan> {
    if (ctx.selectedToolIds.length === 0) {
      // R12.4: an unauthorised mutating stage skips regardless of what (if
      // anything) is configured for it. Optimise ships no adapter yet, so
      // its shipped default is an empty selection — treating that as a
      // planning error here would make `--stage optimise` without `--yes`
      // reject under the default config instead of producing R12.4's skip.
      if (this.mutating && !ctx.authorised) {
        return {
          toolIds: [],
          policy: 'pick-one',
          mutationScope: { paths: [ctx.skill.relPath === '.' ? '.' : ctx.skill.relPath] },
        }
      }
      throw new Error(`no tools selected for stage ${ctx.stage}`)
    }
    const policies = new Set<'fan-out' | 'pick-one'>()
    for (const id of ctx.selectedToolIds) {
      const adapter = this.adapterFor(id)
      if (!adapter) {
        // R12.4: an unauthorised mutating stage never runs a tool, so its
        // selection is never resolved against the registry either — that is
        // what stops "optimise ships no adapter yet" from turning every
        // unauthorised request into a crash instead of the visible skip R12.4
        // requires. A stage that *is* authorised still needs a real tool.
        if (this.mutating && !ctx.authorised) continue
        throw new Error(`unknown tool: ${id}`)
      }
      if (adapter.manifest.stage !== ctx.stage) {
        throw new Error(`${id} is not a ${ctx.stage} tool`)
      }
      policies.add(adapter.manifest.policy)
    }

    // Over the whole selection, not the last adapter seen. Reading the last one
    // meant a pick-one tool listed before a fan-out one resolved to fan-out, so
    // the guard below never fired — which is precisely R4.8's prohibition on two
    // optimise tools running concurrently.
    if (policies.has('pick-one')) {
      if (policies.size > 1) {
        throw new Error(`tools selected for stage ${ctx.stage} disagree on policy`)
      }
      if (ctx.selectedToolIds.length > 1) {
        throw new Error(`stage ${ctx.stage} accepts exactly one tool`)
      }
    }

    const policy: 'fan-out' | 'pick-one' = policies.has('pick-one') ? 'pick-one' : 'fan-out'
    // An optimise tool writes inside the skill directory; a sandbox over an
    // empty scope can neither snapshot nor diff.
    const mutationScope: MutationScope = this.mutating
      ? { paths: [ctx.skill.relPath === '.' ? '.' : ctx.skill.relPath] }
      : { paths: [] }
    return { toolIds: [...ctx.selectedToolIds], policy, mutationScope }
  }

  async execute(ctx: StageContext, plan: StagePlan): Promise<StageResult> {
    // Row 3, before a process is spawned. It lands in the ledger as a tool run,
    // which is what the CLI's old pre-filter could not do: a stage filtered out
    // before the engine saw it was invisible to doctor, to statistics and to the
    // sidecar.
    if (this.mutating && !ctx.authorised) {
      const toolRuns = plan.toolIds.map((toolId) =>
        skipped(toolId, join(ctx.stageDir, toolId), 'no-authorisation'),
      )
      // reduceStageOutcome throws on an empty selection (nothing to reduce);
      // an unauthorised stage with nothing configured is still R12.4's skip.
      if (toolRuns.length === 0) {
        return { stage: ctx.stage, outcome: 'skipped', verdict: 'passed', toolRuns }
      }
      const { outcome, verdict } = reduceStageOutcome(toolRuns.map((t) => t.outcome))
      return { stage: ctx.stage, outcome, verdict, toolRuns }
    }

    const limit = plan.policy === 'pick-one' ? 1 : FAN_OUT_LIMIT

    const toolRuns = await mapLimit(plan.toolIds, limit, async (toolId) => {
      const artefactDir = join(ctx.stageDir, toolId)
      const adapter = this.adapterFor(toolId)
      if (!adapter) return skipped(toolId, artefactDir, 'not-installed')

      const locked = ctx.lock.tools[toolId]
      if (!locked) return skipped(toolId, artefactDir, 'not-installed')

      // Structured, so the skip summary and the wizard can both name what is
      // missing. A boolean could only say "something".
      const required = this.credentialsFor(adapter.manifest)
      if (!credentialsSatisfied(required, ctx.env)) {
        return skipped(toolId, artefactDir, 'no-credentials', missingCredentials(required))
      }

      const { manifest } = adapter
      const vars = {
        skillDir: ctx.skill.dir,
        repoRoot: ctx.skill.repo.path,
        toolDir: artefactDir,
      }
      const argv = [
        ...substitute(manifest.invoke.argv, vars),
        ...(await resolveConditionalArgv(manifest.invoke.conditionalArgv, vars)),
      ]

      const run = await runTool({
        bin: locked.bin,
        argv,
        cwd: manifest.invoke.cwd === 'skillDir' ? ctx.skill.dir : ctx.skill.repo.path,
        toolDir: artefactDir,
        env: ctx.env,
        secrets: ctx.secrets,
        artefacts: manifest.artefacts,
        artefactSizeCapBytes: ctx.artefactSizeCapBytes,
        timeoutMs: ctx.timeoutOverridesMs[toolId] ?? manifest.timeoutMs,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        // Per chunk, not once at the end: a frontend that only learns the whole
        // capture on exit cannot show a running tool (R11.4).
        onChunk: (stream, chunk) => ctx.onOutput(toolId, stream, chunk),
      })

      const base = {
        toolId,
        toolVersion: locked.resolvedVersion,
        exitCode: run.exitCode,
        durationMs: run.durationMs,
        artefactDir,
      }

      return { ...base, ...classifyToolRun(adapter, ctx.skill, run) }
    })

    const { outcome, verdict } = reduceStageOutcome(toolRuns.map((t) => t.outcome))
    return { stage: ctx.stage, outcome, verdict, toolRuns }
  }

  prepareMutation = (ctx: StageContext): Promise<PendingMutation | null> => prepareFromSandbox(ctx)
  applyMutation = (ctx: StageContext, pending: PendingMutation): Promise<void> =>
    applyFromSandbox(ctx, pending)
  discardMutation = (ctx: StageContext): Promise<void> => discardFromSandbox(ctx)
}
