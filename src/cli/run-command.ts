import { homedir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { loadConfig, loadToolLock } from '../core/config/config.js'
import { loadEnvFile, provenanceOf } from '../core/config/env.js'
import { discoverSkills } from '../core/discovery/discover.js'
import { openLedger } from '../core/ledger/db.js'
import { syncLifecycle } from '../core/ledger/lifecycle.js'
import { runPipeline } from '../core/pipeline/run.js'
import type { SkillRef, Stage } from '../core/types.js'
import { runDoctor } from './doctor-command.js'
import { detectInterrupted, formatInterrupted, runRecover } from './recover-command.js'
import { runRelease, type ReleaseOptions } from './release-command.js'
import { runRetire, type RetireOptions } from './retire-command.js'
import { needsSetup, startSetup, type SetupOptions } from './setup-command.js'
import { startTui, type TuiOptions } from './tui-command.js'

const STAGES: readonly Stage[] = ['validate', 'evaluate', 'security', 'optimise', 'release']

export interface CliDeps {
  home: string
  dbPath: string
  write: (line: string) => void
  /** Test seam. Defaults to the real terminal interface. */
  startTui?: (options: TuiOptions) => Promise<void>
  /** Test seam. Defaults to the real wizard. */
  startSetup?: (options: SetupOptions) => Promise<void>
}

/**
 * commander does not model an exit code on the command itself, but R12.2 makes
 * the code part of the contract, so it is carried here and the bin entry copies
 * it onto the process. Callers can then assert it without spawning.
 */
export interface GantryProgram extends Command {
  exitCode?: number
}

export function defaultDeps(): CliDeps {
  const home = join(homedir(), '.skillgantry')
  return {
    home,
    dbPath: join(home, 'gantry.db'),
    write: (line) => console.log(line),
  }
}

/** Accepts `<repoId>/<name>` or a bare `<name>` when it is unambiguous. */
export function resolveSkill(all: readonly SkillRef[], selector: string): SkillRef {
  const exact = all.filter((s) => s.id === selector)
  if (exact.length === 1) return exact[0] as SkillRef

  const byDir = all.filter((s) => s.id.split('/').at(-1) === selector)
  if (byDir.length === 1) return byDir[0] as SkillRef
  if (byDir.length > 1) {
    throw new Error(`ambiguous skill "${selector}": ${byDir.map((s) => s.id).join(', ')}`)
  }

  // A repo-root skill takes its id from the repo directory, which is rarely
  // what the user types, so the declared frontmatter name resolves too.
  const byFrontmatter = all.filter((s) => s.name === selector)
  if (byFrontmatter.length === 1) return byFrontmatter[0] as SkillRef
  if (byFrontmatter.length > 1) {
    throw new Error(`ambiguous skill "${selector}": ${byFrontmatter.map((s) => s.id).join(', ')}`)
  }

  throw new Error(`no skill matching "${selector}"`)
}

function parseStages(raw: string): Stage[] {
  return raw.split(',').map((token) => {
    const stage = token.trim()
    if (!STAGES.includes(stage as Stage)) throw new Error(`unknown stage: ${stage}`)
    return stage as Stage
  })
}

/**
 * R10.10: startup detects and offers. It never blocks — an old marker the user
 * has chosen to leave must not make the tool unusable — so the notice is a line
 * per record and the refusal lives where a second mutation would be applied
 * over an unrecovered first.
 */
async function noticeInterrupted(deps: CliDeps): Promise<void> {
  const found = await detectInterrupted(deps.home).catch(() => [])
  for (const line of formatInterrupted(found)) deps.write(`warning: ${line}`)
}

export function buildProgram(deps: CliDeps): GantryProgram {
  const program = new Command() as GantryProgram
  program.name('skillgantry').description('SkillOps orchestrator for skill maintainers')
  // Without this, commander scans the *whole* argv for the root's own options
  // before ever dispatching to a subcommand, so `release sk --version minor`
  // was caught by the root's `--version` and never reached the subcommand's
  // own required option (R9.10) — confirmed by a standalone commander repro,
  // not merely suspected. `enablePositionalOptions` stops that scan at the
  // first positional token (the subcommand name), which is what R13.5 needs:
  // root `-V`/`--version` and `release --version <target>` both work.
  program.enablePositionalOptions()
  program.version('0.1.0')

  program
    .command('run')
    .argument('<skill>', 'skill id or bare name')
    .requiredOption('--stage <list>', 'comma-separated lifecycle stages')
    .option('--json', 'emit newline-delimited JSON events')
    .option('--yes', 'authorise mutating stages')
    .action(async (selector: string, opts: { stage: string; json?: boolean; yes?: boolean }) => {
      await noticeInterrupted(deps)
      const requested = parseStages(opts.stage)
      const config = await loadConfig(deps.home)
      const allSkills: SkillRef[] = []
      for (const repo of config.repos) allSkills.push(...(await discoverSkills(repo)))
      const skill = resolveSkill(allSkills, selector)
      const lock = await loadToolLock(deps.home)
      const env = await loadEnvFile(deps.home)

      for (const warning of env.warnings) deps.write(`warning: ${warning}`)

      const ledger = openLedger(deps.dbPath)
      // R1.6: reconciled on every scan, so a stale cache self-heals here too,
      // not only from the TUI's launch path.
      syncLifecycle(ledger.db, allSkills)
      try {
        const handle = runPipeline({
          skill,
          stages: requested,
          trigger: 'cli',
          stageTools: config.stageTools,
          lock,
          ledger,
          env: { ...process.env, ...env.vars },
          secrets: env.secrets,
          provenance: provenanceOf(env.vars),
          artefactSizeCapBytes: config.artefactSizeCapBytes,
          timeoutOverridesMs: config.timeoutOverridesMs,
          // R12.4: a mutating stage is skipped unless authorised. The pipeline
          // decides now, so the skip lands in the ledger and the sidecar
          // instead of being filtered out before the engine ever saw it.
          authorised: opts.yes === true,
        })

        for await (const event of handle.events) {
          if (opts.json) {
            deps.write(JSON.stringify(event))
          } else if (event.type === 'stage:done') {
            deps.write(`${event.stage}  ${event.outcome}`)
          } else if (event.type === 'tool:done') {
            deps.write(`  ${event.toolId}: ${event.result.summary}`)
          }
        }

        const summary = await handle.done
        if (!opts.json) {
          deps.write(
            `run ${summary.runId}  ${summary.outcome}  ` +
              `+${summary.opened} open  -${summary.closed} fixed`,
          )
        }
        program.exitCode = summary.outcome === 'passed' ? 0 : 1
      } finally {
        ledger.close()
      }
    })

  program
    .command('doctor')
    .description('re-verify every locked tool and report drift')
    .option('--json', 'emit one JSON report')
    .option('--migrate-rule-map', 'apply a pending rule-class map migration')
    .action(async (opts: { json?: boolean; migrateRuleMap?: boolean }) => {
      const report = await runDoctor(deps, opts)
      program.exitCode = report.failed ? 1 : 0
    })

  program
    .command('setup')
    .description('probe runtimes, install tools, write credentials and register a repo')
    .action(async () => {
      await (deps.startSetup ?? startSetup)({ home: deps.home })
    })

  program
    .command('release')
    // R9.10: `--version` is required rather than defaulted, and missing it
    // has to surface as a rejected promise here (not a bare process.exit),
    // so a headless caller driving the program in-process gets a catchable
    // error instead of its test runner's process going down with it.
    .exitOverride()
    .argument('<skill>', 'skill id or bare name')
    .requiredOption('--version <target>', 'a semver, or major / minor / patch')
    .option('--yes', 'prior authorisation for the write')
    .option('--json', 'emit newline-delimited JSON events')
    .option('--allow-dirty', 'proceed against a skill with uncommitted changes')
    .option('--notes <text>', 'changelog body for the new entry')
    .action(async (selector: string, opts: ReleaseOptions) => {
      await noticeInterrupted(deps)
      program.exitCode = await runRelease(deps, selector, opts)
    })

  program
    .command('retire')
    .argument('<skill>', 'skill id or bare name')
    .option('--undo', 'clear the deprecation instead of setting it')
    .option('--superseded-by <id>', 'the skill that replaces this one')
    .option('--yes', 'prior authorisation for the write')
    .option('--json', 'emit the pending mutation as JSON')
    .option('--allow-dirty', 'proceed against a skill with uncommitted changes')
    .action(async (selector: string, opts: RetireOptions) => {
      await noticeInterrupted(deps)
      program.exitCode = await runRetire(deps, selector, opts)
    })

  program
    .command('recover')
    .description('report or resolve a mutation interrupted by a crash')
    .option('--restore <runId>', 'restore the working tree from the recorded pre-state')
    .option('--forget <runId>', 'keep the tree as it stands and stop reporting the record')
    .option('--json', 'emit one JSON document')
    .action(async (opts: { restore?: string; forget?: string; json?: boolean }) => {
      await runRecover(deps, opts)
    })

  program
    .option('--concurrency <n>', 'worker pool limit for this session', (value) => Number(value))
    .action(async (opts: { concurrency?: number }) => {
      // Commander runs this only when no subcommand matched. R3.6 calls this
      // first-run setup, and a Work screen over no repos and no tools is empty.
      if (await needsSetup(deps.home)) {
        await (deps.startSetup ?? startSetup)({ home: deps.home })
        return
      }
      await noticeInterrupted(deps)
      const launch = deps.startTui ?? startTui
      await launch({
        home: deps.home,
        dbPath: deps.dbPath,
        ...(opts.concurrency === undefined ? {} : { concurrency: opts.concurrency }),
      })
    })

  return program
}
