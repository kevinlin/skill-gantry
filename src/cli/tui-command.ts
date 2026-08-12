import {
  createQueue,
  loadConfig,
  loadEnvFile,
  SKILLHONE_TOOL_ID,
  loadToolLock,
  openLedger,
  provenanceOf,
  runPipeline,
  spawnEnv,
  STAGE_ORDER,
  syncLifecycle,
  type GantryConfig,
  type Stage,
} from '../core/index.js'
import { renderApp } from '../tui/index.js'
import { createGantryViews } from './gantry-views.js'
import { buildSetupDriver } from './setup-command.js'
import { discoverAll } from './run-command.js'

export interface TuiOptions {
  home: string
  dbPath: string
  concurrency?: number
}

/**
 * Stages with at least one tool selected, in lifecycle order. `release` is
 * native rather than adapter-driven, so it has no entry in `stageTools` and
 * the lookup has to tolerate its absence.
 */
export function resolveStages(config: GantryConfig): Stage[] {
  const tools = config.stageTools as Readonly<Partial<Record<Stage, readonly string[]>>>
  return STAGE_ORDER.filter((stage) => (tools[stage] ?? []).length > 0)
}

export async function startTui(options: TuiOptions): Promise<void> {
  const config = await loadConfig(options.home)
  const lock = await loadToolLock(options.home)
  const env = await loadEnvFile(options.home)

  const skills = await discoverAll(config)

  const ledger = openLedger(options.dbPath)
  // R1.6: the file is the authority, so every launch self-heals a cache a
  // crashed-between-write left stale rather than needing manual recovery.
  syncLifecycle(ledger.db, skills)
  const concurrency = options.concurrency ?? config.concurrency

  const queue = createQueue({
    concurrency,
    startRun: (_job, spec) =>
      runPipeline({
        skill: spec.skill,
        stages: spec.stages,
        trigger: spec.trigger ?? 'tui',
        stageTools: config.stageTools,
        lock,
        ledger,
        env: spawnEnv(process.env, env.vars),
        secrets: env.secrets,
        provenance: provenanceOf(env.vars),
        artefactSizeCapBytes: config.artefactSizeCapBytes,
        timeoutOverridesMs: config.timeoutOverridesMs,
        mutationTimeoutMs: config.mutationTimeoutMs,
        // Authorisation in the terminal interface *is* the interactive
        // confirmation the mutation gate performs, not a separate check.
        authorised: true,
        // R11.19 and R10.3. Both are collected per job by the release surface,
        // because both are answered per skill — and until they were carried
        // here, every terminal release reached §12.4 row 3 and failed in the
        // time it took to write one stage.json.
        ...(spec.releaseTarget === undefined ? {} : { releaseTarget: spec.releaseTarget }),
        ...(spec.allowDirty === undefined ? {} : { allowDirty: spec.allowDirty }),
      }),
  })

  try {
    await renderApp({
      skills,
      queue,
      stages: resolveStages(config),
      concurrency,
      // R11.20 as amended. Read from the lock this function already opened, not
      // from `stageTools`: the bundle is catalogued `stage: null` so it can
      // never appear there, and a guard reading the configuration would refuse
      // a tool that is installed and working.
      optimiseReady: SKILLHONE_TOOL_ID in lock.tools,
      setup: buildSetupDriver(options.home),
      views: createGantryViews({
        home: options.home,
        dbPath: options.dbPath,
        write: () => undefined,
      }),
    })
  } finally {
    queue.close()
    ledger.close()
  }
}
