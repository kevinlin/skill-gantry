import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
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
  type Ledger,
  type QueueHandle,
  type Stage,
  type ToolLock,
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

export interface QueueWiring {
  config: GantryConfig
  lock: ToolLock
  env: { vars: Record<string, string>; secrets: readonly string[] }
  ledger: Ledger
  concurrency: number
  /**
   * Taken from the caller and given no default. The terminal passes `true`
   * because its confirmation is interactive; a batch has nowhere to ask and
   * passes `false`. A wiring that hardcoded the first would hand `run --repo`
   * an authorisation nobody gave.
   */
  authorised: boolean
  /** What a job records when its own spec names none: `tui` or `cli`. */
  trigger: string
}

/**
 * The one place `createQueue` meets `runPipeline`, shared by the terminal
 * interface and `run --repo` (R12.16). Two copies is how a second caller comes
 * to leave out `releaseTarget` or the timeouts and run a different pipeline
 * from the one the terminal shows.
 */
export function wireQueue(wiring: QueueWiring): QueueHandle {
  const { config, lock, env, ledger } = wiring
  return createQueue({
    concurrency: wiring.concurrency,
    startRun: (_job, spec) =>
      runPipeline({
        skill: spec.skill,
        stages: spec.stages,
        trigger: spec.trigger ?? wiring.trigger,
        stageTools: config.stageTools,
        lock,
        ledger,
        env: spawnEnv(process.env, env.vars),
        secrets: env.secrets,
        provenance: provenanceOf(env.vars),
        artefactSizeCapBytes: config.artefactSizeCapBytes,
        timeoutOverridesMs: config.timeoutOverridesMs,
        mutationTimeoutMs: config.mutationTimeoutMs,
        authorised: wiring.authorised,
        // R11.19 and R10.3. Both are collected per job by the release surface,
        // because both are answered per skill — and until they were carried
        // here, every terminal release reached §12.4 row 3 and failed in the
        // time it took to write one stage.json.
        ...(spec.releaseTarget === undefined ? {} : { releaseTarget: spec.releaseTarget }),
        ...(spec.allowDirty === undefined ? {} : { allowDirty: spec.allowDirty }),
      }),
  })
}

/**
 * design_tui §14.15. What the status line names beside the version, or nothing when the
 * home is the default one — `~/.skillgantry`, spelled by the same expression
 * `run-command.ts` falls back to, and deliberately not by `SG_HOME`: a home the
 * user relocated is the case the label exists for, and reading the variable here
 * would make a chosen home look like the default because it was chosen.
 *
 * Shortened to `~` so the label is the path a person typed, and so a long home
 * under the user's own spends the columns on what distinguishes it. The match is
 * on a separator, not a prefix: `/Users/keliana` is not under `/Users/keli`.
 * Resolved first, so a trailing slash or a dot segment does not make the
 * default look like somewhere else.
 *
 * Here and not in `src/tui/**`, which may not ask the process who its user is.
 */
export function homeLabel(home: string, user: string = homedir()): string | undefined {
  const resolved = resolve(home)
  const root = resolve(user)
  if (resolved === join(root, '.skillgantry')) return undefined
  if (resolved === root) return '~'
  return resolved.startsWith(`${root}${sep}`) ? `~${resolved.slice(root.length)}` : resolved
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

  const queue = wireQueue({
    config,
    lock,
    env,
    ledger,
    concurrency,
    // Authorisation in the terminal interface *is* the interactive
    // confirmation the mutation gate performs, not a separate check.
    authorised: true,
    trigger: 'tui',
  })

  const label = homeLabel(options.home)
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
      // Absent for the default home, so the footer says nothing a user running
      // the usual setup has to read past.
      ...(label === undefined ? {} : { homeLabel: label }),
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
