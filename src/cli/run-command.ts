import { homedir } from 'node:os'
import { join } from 'node:path'
import { Command, CommanderError } from 'commander'
import { loadConfig, loadToolLock } from '../core/config/config.js'
import { loadEnvFile, provenanceOf, spawnEnv } from '../core/config/env.js'
import { discoverSkills } from '../core/discovery/discover.js'
import { openLedger } from '../core/ledger/db.js'
import { GATE_STAGES } from '../core/ledger/gates.js'
import { syncLifecycle } from '../core/ledger/lifecycle.js'
import { runPipeline } from '../core/pipeline/run.js'
import { VERSION } from '../core/version.js'
import type { GantryConfig } from '../core/config/schema.js'
import type { SkillRef, Stage } from '../core/types.js'
import { runDoctor } from './doctor-command.js'
import { runList } from './list-command.js'
import { runFix, type FixOptions } from './fix-command.js'
import { runOptimise, type OptimiseOptions } from './optimise-command.js'
import { runEvals, type EvalsOptions } from './evals-command.js'
import { runSuppress, type SuppressOptions } from './suppress-command.js'
import { detectInterrupted, formatInterrupted, runRecover } from './recover-command.js'
import { runRelease, type ReleaseOptions } from './release-command.js'
import { runRepoAdd } from './repo-command.js'
import { runRetire, type RetireOptions } from './retire-command.js'
import { runStatus } from './status-command.js'
import { needsSetup, startSetup, type SetupOptions } from './setup-command.js'
import { maybeUpgrade, runUpgrade, type UpgradeOptions } from './upgrade-command.js'
import { startTui, type TuiOptions } from './tui-command.js'

const STAGES: readonly Stage[] = ['validate', 'evaluate', 'security', 'optimise', 'release']

export interface CliDeps {
  home: string
  dbPath: string
  write: (line: string) => void
  /** The error stream, one line per call. `main()` defaults it to `console.error`. */
  writeErr?: (line: string) => void
  /**
   * Whether standard input is a terminal (R12.14). `main()` fills it from
   * `process.stdin`; left unset, as by an in-process caller that injects
   * `startTui`, the root action and `setup` take it as already decided and do
   * not refuse.
   */
  stdinIsTTY?: boolean
  /** Test seam. Defaults to the real terminal interface. */
  startTui?: (options: TuiOptions) => Promise<void>
  /** Test seam. Defaults to the real wizard. */
  startSetup?: (options: SetupOptions) => Promise<void>
  /** Test seam, and the one that keeps the default suite offline: the real
      `maybeUpgrade` reaches the release index, and every test driving the root
      action would otherwise make that request. */
  maybeUpgrade?: (deps: CliDeps) => Promise<'continue' | 'relaunched'>
  /** The same seam for the same reason, on doctor's §5.3 condition. */
  upgradeCheck?: (home: string) => Promise<{ current: string; latest: string } | null>
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
  // `install-cli.sh` has honoured `SG_HOME` since M1 so the acceptance suite can
  // install without touching a real home. The binary has to honour the same
  // variable or the upgrade acceptance test would relink the developer's own
  // `~/.local/bin/skillgantry` while proving that the rename works.
  const home = process.env['SG_HOME'] ?? join(homedir(), '.skillgantry')
  return {
    home,
    dbPath: join(home, 'gantry.db'),
    write: (line) => console.log(line),
  }
}

/** Every skill in every registered repo, in config order. */
export async function discoverAll(config: GantryConfig): Promise<SkillRef[]> {
  const skills: SkillRef[] = []
  for (const repo of config.repos) skills.push(...(await discoverSkills(repo)))
  return skills
}

/**
 * Config, the whole discovered set and the selected skill, which is what every
 * skill-taking subcommand needs and what four of them each spelled out
 * separately. The full set travels with the selection because `syncLifecycle`
 * takes it (R1.6): a caller that only got the one skill would sync a single row.
 */
export async function selectSkill(
  home: string,
  selector: string,
): Promise<{ config: GantryConfig; allSkills: SkillRef[]; skill: SkillRef }> {
  const config = await loadConfig(home)
  const allSkills = await discoverAll(config)
  return { config, allSkills, skill: resolveSkill(allSkills, selector) }
}

/**
 * What `list` and `status` call a skill: the declared name, or the directory it
 * lives in when the frontmatter declares none. The id is the key; this is the
 * label a reader recognises.
 */
export const skillName = (skill: SkillRef): string => skill.name ?? skill.id.split('/').at(-1) ?? skill.id

/**
 * The hint is the whole point of the message: the caller has just learned that
 * a name is shared, and the id form is the one spelling that cannot be.
 */
const ambiguity = (selector: string, matches: readonly SkillRef[]): Error =>
  new Error(
    `ambiguous skill "${selector}": ${matches.map((s) => s.id).join(', ')}; ` +
      'use the full <repoId>/<name> id',
  )

/** Accepts `<repoId>/<name>` or a bare `<name>` when it is unambiguous. */
export function resolveSkill(all: readonly SkillRef[], selector: string): SkillRef {
  const exact = all.filter((s) => s.id === selector)
  if (exact.length === 1) return exact[0] as SkillRef

  const byDir = all.filter((s) => s.id.split('/').at(-1) === selector)
  if (byDir.length === 1) return byDir[0] as SkillRef
  if (byDir.length > 1) throw ambiguity(selector, byDir)

  // A repo-root skill takes its id from the repo directory, which is rarely
  // what the user types, so the declared frontmatter name resolves too.
  const byFrontmatter = all.filter((s) => s.name === selector)
  if (byFrontmatter.length === 1) return byFrontmatter[0] as SkillRef
  if (byFrontmatter.length > 1) throw ambiguity(selector, byFrontmatter)

  throw new Error(`no skill matching "${selector}"`)
}

/**
 * commander calls `process.exit` on its own parse errors unless `exitOverride`
 * is set on *that* command, and a subcommand takes the setting only at the
 * moment `.command()` creates it — so setting it on the root afterwards leaves
 * every existing subcommand free to exit the process. Applied to the whole
 * tree, then, and with the output routed through the deps so a help screen or a
 * parse error reaches whoever injected them rather than the process's streams.
 * commander terminates each write with a newline; the deps take lines.
 */
export function containCommander(
  program: Command,
  io: { write: (text: string) => void; writeErr: (text: string) => void },
): void {
  const unterminated = (text: string): string => text.replace(/\n$/, '')
  const visit = (command: Command): void => {
    command.exitOverride()
    command.configureOutput({
      writeOut: (text) => io.write(unterminated(text)),
      writeErr: (text) => io.writeErr(unterminated(text)),
    })
    for (const child of command.commands) visit(child)
  }
  visit(program)
}

export const isCommanderError = (err: unknown): err is CommanderError =>
  err instanceof CommanderError

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

/**
 * R12.14. Strictly `false`: an unset `stdinIsTTY` is an in-process caller, not a
 * pipe. The message names the three things an agent can do instead, because
 * "needs a terminal" alone is a dead end.
 */
function requireTerminal(deps: CliDeps, what: string): void {
  if (deps.stdinIsTTY !== false) return
  throw new Error(
    `${what} needs a terminal and standard input is not one: ` +
      'use `skillgantry list`, `skillgantry status <skill>` or `skillgantry --help`',
  )
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
  program.version(VERSION)

  program
    .command('list')
    .description('list every skill in every registered repo with its last gate verdicts')
    .option('--json', 'emit one JSON document')
    .action(async (opts: { json?: boolean }) => {
      // R12.11: no interrupted-mutation notice here. It would put a `warning:`
      // line on the stream a caller is about to parse as one document.
      await runList(deps, opts)
    })

  program
    .command('status')
    .description('report what stands between a skill and its release, and the commands that clear it')
    .argument('<skill>', 'skill id or bare name')
    .option('--json', 'emit one JSON document')
    .action(async (selector: string, opts: { json?: boolean }) => {
      // R12.12: the code says a document was produced, never whether the skill
      // is ready — `ready` is in the document, where a caller reads it.
      await runStatus(deps, selector, opts)
    })

  program
    .command('repo')
    .description('manage the repos whose skills SkillGantry discovers')
    .command('add')
    .description('register a skill repo, under the rules the setup wizard applies')
    .argument('<path>', 'a directory holding skills')
    .option('--json', 'emit one JSON document')
    .action(async (path: string, opts: { json?: boolean }) => {
      await runRepoAdd(deps, path, opts)
    })

  program
    .command('run')
    .description('run lifecycle stages against a skill and record the evidence')
    .argument('<skill>', 'skill id or bare name')
    .option('--stage <list>', 'comma-separated lifecycle stages (default: validate, evaluate and security)')
    .option('--json', 'emit newline-delimited JSON events')
    .option('--yes', 'authorise mutating stages')
    .action(async (selector: string, opts: { stage?: string; json?: boolean; yes?: boolean }) => {
      await noticeInterrupted(deps)
      // R12.1: the three gate stages, because the commonest request is "is
      // this skill sound" and release, which needs a target and `--yes`, is
      // never implied.
      const requested = opts.stage === undefined ? [...GATE_STAGES] : parseStages(opts.stage)
      const { config, allSkills, skill } = await selectSkill(deps.home, selector)
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
          env: spawnEnv(process.env, env.vars),
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
      requireTerminal(deps, 'the setup wizard')
      await (deps.startSetup ?? startSetup)({ home: deps.home })
    })

  program
    .command('release')
    .description("bump a skill's version, package it and verify it installs, once its gates have passed")
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
    .description('deprecate a skill in its own frontmatter, or clear the deprecation with --undo')
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
    .command('fix')
    .description('print the coding-agent fix prompt for a recorded run')
    .argument('<skill>', 'skill id or bare name')
    .option('--stage <stage>', 'restrict to one lifecycle stage')
    .option('--run <id-or-dir>', 'a recorded run id or its directory name; defaults to the most recent')
    .option('--json', 'emit one JSON document')
    .action(async (selector: string, opts: FixOptions) => {
      // R12.6: the code answers "is there a prompt on stdout", not "did the
      // skill pass" — reusing R12.2's meaning would make a clean skill and a
      // failed lookup indistinguishable.
      program.exitCode = await runFix(deps, selector, opts)
    })

  program
    .command('optimise')
    .description('print the coding-agent optimisation prompt for a skill')
    .argument('<skill>', 'skill id or bare name')
    .option('--json', 'emit one JSON document')
    .action(async (selector: string, opts: OptimiseOptions) => {
      // R12.8, sharing R12.6's meaning: the code answers "is there a prompt on
      // stdout", not "did the skill pass". Reusing R12.2's meaning would make a
      // clean skill and an uninstalled optimiser indistinguishable.
      program.exitCode = await runOptimise(deps, selector, opts)
    })

  program
    .command('evals')
    .description("print the coding-agent prompt for authoring a skill's eval suite")
    .argument('<skill>', 'skill id or bare name')
    .option('--json', 'emit one JSON document')
    .action(async (selector: string, opts: EvalsOptions) => {
      // R12.9, sharing R12.6's and R12.8's meaning: the code answers "is there
      // a prompt on stdout", so a skill with a passing suite and one whose
      // runner is not installed stay distinguishable.
      program.exitCode = await runEvals(deps, selector, opts)
    })

  program
    .command('upgrade')
    .description('check for a newer published release and install it')
    .option('--yes', 'prior authorisation for the install')
    .option('--json', 'emit one JSON document')
    .option('--check', 'report only; install nothing')
    .action(async (opts: UpgradeOptions) => {
      // R12.10: the code answers "what happened to the upgrade", not R12.2's
      // stage question — `fix`'s and `suppress`'s established divergence.
      program.exitCode = await runUpgrade(deps, opts)
    })

  program
    .command('suppress')
    .description("record a finding in its tool's own suppression file")
    .argument('<skill>', 'skill id or unambiguous name')
    .option('--tool <id>', 'the detecting tool')
    .option('--rule <nativeRuleId>', "the tool's own rule id")
    .option('--path <skillRelPath>', 'skill-relative path the finding is in')
    .option('--fingerprint <fp>', 'an issue fingerprint, resolved from the ledger')
    .option('--reason <text>', 'why the finding is accepted; required and non-empty')
    .option('--yes', 'prior authorisation for the write')
    .option('--json', 'emit one JSON document')
    .action(async (selector: string, opts: SuppressOptions) => {
      // R12.7: the code reports whether a suppression was written, never
      // whether the skill passes — `fix`'s precedent, for the same reason.
      program.exitCode = await runSuppress(deps, selector, opts)
    })

  program
    .option('--concurrency <n>', 'worker pool limit for this session', (value) => Number(value))
    .action(async (opts: { concurrency?: number }) => {
      // Commander runs this only when no subcommand matched. Ink throws from
      // `useInput` when standard input is not a terminal, and an agent's is
      // never one, so the refusal comes before either interface can mount.
      requireTerminal(deps, 'the terminal interface')
      // R3.6 calls this first-run setup, and a Work screen over no repos and no
      // tools is empty.
      if (await needsSetup(deps.home)) {
        await (deps.startSetup ?? startSetup)({ home: deps.home })
        return
      }
      await noticeInterrupted(deps)
      // R11.24: before the main screen mounts, and after the mutation-record
      // scan for its reason — both are launch-time work that never blocks.
      if ((await (deps.maybeUpgrade ?? maybeUpgrade)(deps)) === 'relaunched') return
      const launch = deps.startTui ?? startTui
      await launch({
        home: deps.home,
        dbPath: deps.dbPath,
        ...(opts.concurrency === undefined ? {} : { concurrency: opts.concurrency }),
      })
    })

  return program
}
