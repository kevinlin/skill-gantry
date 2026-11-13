import {
  MUTATING_STAGES,
  loadConfig,
  loadEnvFile,
  loadToolLock,
  openLedger,
  syncLifecycle,
  type JobRecord,
  type Stage,
} from '../core/index.js'
import { oneLine } from './errors.js'
import { type CliDeps, discoverAll } from './run-command.js'
import { wireQueue } from './tui-command.js'

const passedOutright = (job: JobRecord): boolean => job.state === 'done' && job.outcome === 'passed'

/**
 * `run --repo <repoId>` (R12.16): the requested stages over every skill of one
 * repo, through the queue the terminal interface uses and under the configured
 * concurrency. Resolves to the exit code: `0` when every job passed, `1`
 * otherwise. A request that cannot be carried out throws, and every such throw
 * happens before the ledger is opened, so a refusal leaves no run behind.
 *
 * Gate stages only. A release target and the confirmation to write are answered
 * per skill (R11.19), and a batch has nowhere to ask — so a mutating stage is
 * refused here, not skipped the way R12.4 skips it for one named skill.
 */
export async function runBatch(
  deps: CliDeps,
  repoId: string,
  stages: readonly Stage[],
  json: boolean,
): Promise<number> {
  const mutating = stages.filter((stage) => MUTATING_STAGES.has(stage))
  if (mutating.length > 0) {
    throw new Error(
      `run --repo takes gate stages only, and ${mutating.join(', ')} mutates: ` +
        'a release target and its confirmation are answered per skill, ' +
        'so name the skill: `skillgantry run <skill> --stage ' +
        `${mutating.join(',')}\``,
    )
  }

  const config = await loadConfig(deps.home)
  if (!config.repos.some((repo) => repo.id === repoId)) {
    const known = config.repos.map((repo) => repo.id)
    throw new Error(
      `no repo matching "${repoId}"; ` +
        (known.length === 0 ? 'none is registered' : `registered: ${known.join(', ')}`),
    )
  }
  // The whole discovered set goes to `syncLifecycle` (R1.6), as `selectSkill`
  // passes it: it reconciles only the skills it is given, so one repo's worth
  // would leave every other repo's cache as stale as this scan found it.
  const allSkills = await discoverAll(config)
  const skills = allSkills.filter((skill) => skill.repo.id === repoId)
  if (skills.length === 0) throw new Error(`repo "${repoId}" has no skill to run`)

  const lock = await loadToolLock(deps.home)
  const env = await loadEnvFile(deps.home)
  for (const warning of env.warnings) deps.write(`warning: ${warning}`)

  const ledger = openLedger(deps.dbPath)
  syncLifecycle(ledger.db, allSkills)
  const queue = wireQueue({
    config,
    lock,
    env,
    ledger,
    concurrency: config.concurrency,
    // Not `true`, which is the terminal's because its confirmation is
    // interactive. Nothing here asked anyone.
    authorised: false,
    trigger: 'cli',
  })

  // Started before the first enqueue and read while the runs are in flight: a
  // sweep takes minutes, and a CI log that prints nothing until the end reads
  // as a hang.
  const skillOf = new Map<string, string>()
  const finished: JobRecord[] = []
  const drain = (async () => {
    for await (const event of queue.events) {
      if (event.type === 'job:queued') {
        skillOf.set(event.job.jobId, event.job.skillId)
      } else if (event.type === 'run:event') {
        const skillId = skillOf.get(event.jobId) as string
        if (json) deps.write(JSON.stringify({ skillId, event: event.event }))
        else if (event.event.type === 'stage:done') {
          deps.write(`${skillId}  ${event.event.stage}  ${event.event.outcome}`)
        }
      } else if (event.type === 'job:done' || event.type === 'job:failed' || event.type === 'job:cancelled') {
        finished.push(event.job)
        // A job that never reached a verdict has no stage row to say so, and
        // `run:error` is not in the plain stream. Without this line the summary
        // counts a skill as not passed and names no reason.
        if (!json && event.job.state !== 'done') {
          deps.write(
            `warning: ${event.job.skillId} did not complete: ${oneLine(event.job.error ?? event.job.state)}`,
          )
        }
      }
    }
  })()

  try {
    queue.enqueue(skills.map((skill) => ({ skill, stages })))
    await queue.idle()
  } finally {
    queue.close()
    await drain.finally(() => ledger.close())
  }

  // Over the skills asked for, in discovery order, not over whichever jobs
  // reported: the summary then names a skill whose job never did as not passed,
  // and reads the same on every run whatever order the pool finished in.
  const passedIds = new Set(finished.filter(passedOutright).map((job) => job.skillId))
  const notPassed = skills.map((skill) => skill.id).filter((id) => !passedIds.has(id))
  const passed = skills.length - notPassed.length

  if (json) deps.write(JSON.stringify({ summary: { skills: skills.length, passed, notPassed } }))
  else deps.write(`${skills.length} skills: ${passed} passed, ${notPassed.length} not passed`)

  return notPassed.length === 0 ? 0 : 1
}
