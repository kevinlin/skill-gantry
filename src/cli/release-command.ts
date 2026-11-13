import {
  commitHint,
  gitChangedPaths,
  loadEnvFile,
  loadToolLock,
  openLedger,
  provenanceOf,
  resolveTargetVersion,
  runPipeline,
  spawnEnv,
  syncLifecycle,
} from '../core/index.js'
import { detectInterrupted } from './recover-command.js'
import { selectSkill, skillName, type CliDeps } from './run-command.js'

export interface ReleaseOptions {
  version: string
  yes?: boolean
  json?: boolean
  allowDirty?: boolean
  notes?: string
}

/**
 * R12.5b. One stage through the same pipeline the TUI drives, which is what
 * keeps R12.1's "same artefacts" true rather than aspirational.
 */
export async function runRelease(
  deps: CliDeps,
  selector: string,
  opts: ReleaseOptions,
): Promise<number> {
  const { config, allSkills, skill } = await selectSkill(deps.home, selector)
  const lock = await loadToolLock(deps.home)
  const env = await loadEnvFile(deps.home)
  for (const warning of env.warnings) deps.write(`warning: ${warning}`)

  const interrupted = (await detectInterrupted(deps.home)).some(
    (item) => item.skillId === skill.id,
  )

  const ledger = openLedger(deps.dbPath)
  try {
    syncLifecycle(ledger.db, allSkills)

    const handle = runPipeline({
      skill,
      stages: ['release'],
      trigger: 'cli-release',
      stageTools: config.stageTools,
      lock,
      ledger,
      env: spawnEnv(process.env, env.vars),
      secrets: env.secrets,
      provenance: provenanceOf(env.vars),
      artefactSizeCapBytes: config.artefactSizeCapBytes,
      timeoutOverridesMs: config.timeoutOverridesMs,
      mutationTimeoutMs: config.mutationTimeoutMs,
      // R12.4: `--yes` is prior authorisation. Without it the stage is skipped
      // by the engine, so the skip lands in the ledger like any other.
      authorised: opts.yes === true,
      releaseTarget: {
        version: opts.version,
        ...(opts.notes === undefined ? {} : { notes: opts.notes }),
      },
      ...(opts.allowDirty === undefined ? {} : { allowDirty: opts.allowDirty }),
      interrupted,
    })

    // The paths of the change set the pipeline applied, which is the only place
    // that knows them: the stage's scope is a plan, and this is what it became.
    let applied: readonly string[] = []

    for await (const event of handle.events) {
      if (opts.json) {
        deps.write(JSON.stringify(event))
      } else if (event.type === 'mutation:pending') {
        // Design §11.5: the diff is emitted immediately before the write, so
        // the R5.2 ordering holds and the diff is always on record.
        deps.write(`changes to ${event.scope.length} path(s):`)
        deps.write(event.diff)
      } else if (event.type === 'stage:done') {
        const toolRun = event.result.toolRuns[0]
        deps.write(
          `release  ${event.outcome}${toolRun?.errorKind ? ` (${toolRun.errorKind})` : ''}` +
            `${toolRun?.summary ? `  ${toolRun.summary}` : ''}`,
        )
      }
      // A headless release is prior-authorised, so the prompt is answered as it
      // arrives rather than waiting out the mutation timeout.
      if (event.type === 'mutation:pending') {
        applied = event.scope
        handle.resolveMutation(event.requestId, 'apply')
      }
    }

    const summary = await handle.done
    if (!opts.json && summary.outcome === 'passed') {
      deps.write(`released ${skill.id} — run ${summary.runId}`)
      // R9.7: named after the release and never run. Plain output only, since a
      // `--json` stream is events a caller parses, and a repo that is not
      // git-backed has no commit to name.
      if (skill.repo.isGit) {
        const paths = await gitChangedPaths(skill.repo.path, applied, deps.exec)
        const hint = commitHint({
          repo: skill.repo.path,
          name: skillName(skill),
          // The bump level the user typed, resolved the way the stage did: the
          // message names the version that was written, not `patch`.
          version: resolveTargetVersion(skill.version, opts.version),
          paths,
        })
        for (const line of hint) deps.write(line)
      }
    }
    return summary.outcome === 'passed' ? 0 : 1
  } finally {
    ledger.close()
  }
}
