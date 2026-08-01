import {
  createQueue,
  discoverSkills,
  loadConfig,
  loadEnvFile,
  loadToolLock,
  openLedger,
  provenanceOf,
  runPipeline,
  STAGE_ORDER,
  type GantryConfig,
  type SkillRef,
  type Stage,
} from '../core/index.js'
import { renderApp } from '../tui/index.js'

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

  const skills: SkillRef[] = []
  for (const repo of config.repos) skills.push(...(await discoverSkills(repo)))

  const ledger = openLedger(options.dbPath)
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
        env: { ...process.env, ...env.vars },
        secrets: env.secrets,
        provenance: provenanceOf(env.vars),
        artefactSizeCapBytes: config.artefactSizeCapBytes,
        timeoutOverridesMs: config.timeoutOverridesMs,
        mutationTimeoutMs: config.mutationTimeoutMs,
      }),
  })

  try {
    await renderApp({
      skills,
      queue,
      stages: resolveStages(config),
      concurrency,
    })
  } finally {
    queue.close()
    ledger.close()
  }
}
