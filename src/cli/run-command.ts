import { homedir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { loadConfig, loadToolLock } from '../core/config/config.js'
import { loadEnvFile, provenanceOf } from '../core/config/env.js'
import { discoverSkills } from '../core/discovery/discover.js'
import { openLedger } from '../core/ledger/db.js'
import { runPipeline } from '../core/pipeline/run.js'
import type { GantryConfig } from '../core/config/schema.js'
import type { SkillRef, Stage } from '../core/types.js'

const STAGES: readonly Stage[] = ['validate', 'evaluate', 'security', 'optimise', 'release']
const MUTATING: ReadonlySet<Stage> = new Set<Stage>(['optimise', 'release'])

export interface CliDeps {
  home: string
  dbPath: string
  write: (line: string) => void
}

export function defaultDeps(): CliDeps {
  const home = join(homedir(), '.skillgantry')
  return {
    home,
    dbPath: join(home, 'gantry.db'),
    // eslint-disable-next-line no-console
    write: (line) => console.log(line),
  }
}

/** Accepts `<repoId>/<name>` or a bare `<name>` when it is unambiguous. */
export async function resolveSkill(config: GantryConfig, selector: string): Promise<SkillRef> {
  const all: SkillRef[] = []
  for (const repo of config.repos) all.push(...(await discoverSkills(repo)))

  const exact = all.filter((s) => s.id === selector)
  if (exact.length === 1) return exact[0] as SkillRef

  const byName = all.filter((s) => s.id.split('/').at(-1) === selector)
  if (byName.length === 1) return byName[0] as SkillRef
  if (byName.length > 1) {
    throw new Error(`ambiguous skill "${selector}": ${byName.map((s) => s.id).join(', ')}`)
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

export function buildProgram(deps: CliDeps): Command {
  const program = new Command()
  program.name('skillgantry').description('SkillOps orchestrator for skill maintainers')

  program
    .command('run')
    .argument('<skill>', 'skill id or bare name')
    .requiredOption('--stage <list>', 'comma-separated lifecycle stages')
    .option('--json', 'emit newline-delimited JSON events')
    .option('--yes', 'authorise mutating stages')
    .action(async (selector: string, opts: { stage: string; json?: boolean; yes?: boolean }) => {
      const requested = parseStages(opts.stage)
      const config = await loadConfig(deps.home)
      const skill = await resolveSkill(config, selector)
      const lock = await loadToolLock(deps.home)
      const env = await loadEnvFile(deps.home)

      for (const warning of env.warnings) deps.write(`warning: ${warning}`)

      // R12.4: a mutating stage is skipped unless authorised.
      const stages = requested.filter((s) => opts.yes || !MUTATING.has(s))
      const skippedStages = requested.filter((s) => !stages.includes(s))

      const ledger = openLedger(deps.dbPath)
      try {
        for (const stage of skippedStages) {
          const event = {
            type: 'stage:done',
            stage,
            outcome: 'skipped',
            reason: 'no-authorisation',
          }
          deps.write(opts.json ? JSON.stringify(event) : `${stage}  skipped (needs --yes)`)
        }

        if (stages.length === 0) {
          program.exitCode = 0
          return
        }

        const handle = runPipeline({
          skill,
          stages,
          trigger: 'cli',
          stageTools: config.stageTools,
          lock,
          ledger,
          env: { ...process.env, ...env.vars },
          secrets: env.secrets,
          provenance: provenanceOf(env.vars),
          artefactSizeCapBytes: config.artefactSizeCapBytes,
          timeoutOverridesMs: config.timeoutOverridesMs,
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

  return program
}
