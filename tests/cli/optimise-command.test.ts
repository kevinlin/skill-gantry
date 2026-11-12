import { appendFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { planOptimiseFor, runOptimise } from '../../src/cli/optimise-command.js'
import { selectSkill } from '../../src/cli/run-command.js'
import { digestSkill } from '../../src/core/discovery/digest.js'
import { makeCliFixture, type CliFixture } from '../helpers/tmp-repo.js'

describe('skillgantry optimise', () => {
  it('prints a prompt and writes not one byte', async () => {
    const fixture = await makeCliFixture()
    const before = await readdir(fixture.runsRoot).catch(() => [])

    const code = await runOptimise(fixture.deps, 'declawed', {})

    expect(code).toBe(0)
    expect(fixture.out.join('\n')).toContain('# Optimise: declawed')
    // R11.10 and R12.6's shared constraint: the pipeline is the only writer
    // under runs/. A screen or a command that answers for a run must not
    // rewrite that run's evidence.
    expect(await readdir(fixture.runsRoot).catch(() => [])).toEqual(before)
  })

  it('exits non-zero and names the tool when SkillHone is not installed', async () => {
    const fixture = await makeCliFixture({ lockTools: [] })

    const code = await runOptimise(fixture.deps, 'declawed', {})

    expect(code).toBe(2)
    expect(fixture.out.join('\n')).toContain('skillgantry setup')
  })

  it('keeps the --json document to skill, prompt and missing', async () => {
    const fixture = await makeCliFixture()

    const code = await runOptimise(fixture.deps, 'declawed', { json: true })

    expect(code).toBe(0)
    const doc = JSON.parse(fixture.out.join('')) as Record<string, unknown>
    expect(Object.keys(doc)).toEqual(['skill', 'prompt', 'missing'])
    expect(doc.prompt).toContain('# Optimise: declawed')
  })
})

const NUMBER: Record<string, string> = { validate: '01', evaluate: '02', security: '03' }

interface SeededRun {
  id: string
  /** Defaults to the skill's current digest, so a run is current unless a case says otherwise. */
  digest?: string
  /** stage → the outcome that stage recorded. */
  stages: Record<string, string>
  /** False models a sidecar whose `run.json` is gone. */
  runJson?: boolean
}

/**
 * Sidecars shaped as the pipeline writes them, in the order given — which is
 * the order of `index.ndjson`, so a case can put the newest run first and prove
 * the walk goes by run id rather than by position in the file.
 */
async function seed(fixture: CliFixture, runs: SeededRun[]): Promise<string> {
  const { skill } = await selectSkill(fixture.home, 'declawed')
  const current = await digestSkill(skill)
  for (const run of runs) {
    const runDir = join(fixture.runsRoot, run.id)
    await mkdir(runDir, { recursive: true })
    if (run.runJson !== false) {
      await writeFile(
        join(runDir, 'run.json'),
        JSON.stringify({
          runId: run.id,
          skillId: 'x/declawed',
          skillDigest: run.digest ?? current,
          git: { commit: 'a1b2c3d', dirty: false },
          provenance: {},
          toolLock: {},
        }),
      )
    }
    for (const [stage, outcome] of Object.entries(run.stages)) {
      const stageDir = join(runDir, `${NUMBER[stage] as string}-${stage}`)
      await mkdir(stageDir, { recursive: true })
      await writeFile(
        join(stageDir, 'stage.json'),
        JSON.stringify({
          stage,
          outcome,
          verdict: outcome === 'passed' ? 'passed' : 'failed',
          toolRuns: [
            {
              toolId: stage === 'evaluate' ? 'skill-up' : 'skillspector',
              toolVersion: '1.0.0',
              outcome,
              exitCode: outcome === 'passed' ? 0 : 1,
              durationMs: 10,
              errorKind: null,
              artefactDir: join(stageDir, 'tool'),
              findings: [],
              metrics: {},
              summary: '',
            },
          ],
        }),
      )
    }
    await appendFile(
      join(fixture.runsRoot, 'index.ndjson'),
      `${JSON.stringify({ runId: run.id, outcome: 'failed', endedAt: '2026-08-09T00:00:00Z' })}\n`,
    )
  }
  return current
}

async function promptAfter(runs: SeededRun[]): Promise<string> {
  const fixture = await makeCliFixture()
  await seed(fixture, runs)
  await runOptimise(fixture.deps, 'declawed', {})
  return fixture.out.join('')
}

/** One stage's block: its heading up to the next heading of either level. */
const block = (body: string, stage: string): string => {
  const start = body.indexOf(`### ${stage} — `)
  if (start === -1) return ''
  const rest = body.slice(start + 4)
  const end = rest.search(/\n##/)
  return body.slice(start, end === -1 ? undefined : start + 4 + end)
}

describe('R6.12 optimise evidence across runs', () => {
  it("takes an older run's evaluate result when the newest run recorded only security", async () => {
    const body = await promptAfter([
      { id: '019fe5c3', stages: { security: 'failed' } },
      { id: '019fe5a0', stages: { evaluate: 'passed', security: 'failed' } },
    ])

    expect(block(body, 'evaluate')).toContain('### evaluate — `passed`')
    expect(block(body, 'evaluate')).toContain('Recorded by run `019fe5a0`')
    expect(block(body, 'security')).toContain('Recorded by run `019fe5c3`')
  })

  it('walks newest run id first whatever order the index lists them in', async () => {
    const body = await promptAfter([
      { id: '019fe5a0', stages: { security: 'failed' } },
      { id: '019fe5c3', stages: { security: 'passed' } },
    ])

    expect(block(body, 'security')).toContain('`passed`')
    expect(block(body, 'security')).toContain('Recorded by run `019fe5c3`')
  })

  it('steps over an errored newer record to the verdict before it', async () => {
    const body = await promptAfter([
      { id: '019fe5a0', stages: { evaluate: 'passed' } },
      { id: '019fe5c3', stages: { evaluate: 'errored' } },
    ])

    expect(body).toContain('### evaluate — `passed`')
    expect(body).not.toContain('### evaluate — `errored`')
    expect(block(body, 'evaluate')).toContain('Recorded by run `019fe5a0`')
  })

  it('steps over a skipped newer record the same way', async () => {
    const body = await promptAfter([
      { id: '019fe5a0', stages: { security: 'failed' } },
      { id: '019fe5c3', stages: { security: 'skipped' } },
    ])

    expect(body).toContain('### security — `failed`')
    expect(body).not.toContain('### security — `skipped`')
  })

  it('does not step over a degraded record: some of its tools did reach a verdict', async () => {
    const body = await promptAfter([
      { id: '019fe5a0', stages: { security: 'passed' } },
      { id: '019fe5c3', stages: { security: 'degraded' } },
    ])

    expect(body).toContain('### security — `degraded`')
    expect(block(body, 'security')).toContain('Recorded by run `019fe5c3`')
  })

  it('falls back to the newest record when no run reached a verdict for the stage', async () => {
    const body = await promptAfter([
      { id: '019fe5a0', stages: { evaluate: 'errored' } },
      { id: '019fe5c3', stages: { evaluate: 'skipped' } },
    ])

    expect(body).toContain('### evaluate — `skipped`')
    expect(body).not.toContain('### evaluate — `errored`')
    expect(block(body, 'evaluate')).toContain('Recorded by run `019fe5c3`')
  })

  it('leaves out a stage no run recorded, and orders the rest by the lifecycle', async () => {
    const body = await promptAfter([
      { id: '019fe5a0', stages: { security: 'failed' } },
      { id: '019fe5c3', stages: { validate: 'passed' } },
    ])

    expect(body).not.toContain('### evaluate')
    expect(body.indexOf('### validate')).toBeGreaterThan(-1)
    expect(body.indexOf('### validate')).toBeLessThan(body.indexOf('### security'))
  })

  it('says there is no recorded run when the sidecar holds none', async () => {
    const body = await promptAfter([])

    expect(body).toContain('There is no recorded run for this skill yet.')
    expect(body).not.toContain('### ')
  })

  it("marks a result recorded against another digest as history, and today's as current", async () => {
    const body = await promptAfter([
      { id: '019fe5a0', digest: 'sha256:0000', stages: { evaluate: 'passed' } },
      { id: '019fe5c3', stages: { security: 'failed' } },
    ])

    expect(block(body, 'evaluate')).toContain(
      'Recorded by run `019fe5a0` against an earlier version of the skill. Treat it as history, and re-run the stage before relying on it.',
    )
    expect(block(body, 'security')).toContain(
      "Recorded by run `019fe5c3` against the skill's current files.",
    )
  })

  it('compares against the digest the skill has now, so an edit turns current evidence into history', async () => {
    const fixture = await makeCliFixture()
    await seed(fixture, [{ id: '019fe5c3', stages: { security: 'failed' } }])
    await runOptimise(fixture.deps, 'declawed', {})
    expect(block(fixture.out.join(''), 'security')).toContain("against the skill's current files.")

    await writeFile(join(fixture.repo, 'declawed', 'NOTES.md'), 'edited after the run\n')
    fixture.out.length = 0
    await runOptimise(fixture.deps, 'declawed', {})
    expect(block(fixture.out.join(''), 'security')).toContain('against an earlier version of the skill.')
  })

  it('steps over a run whose run.json is gone rather than naming a digest it cannot read', async () => {
    const body = await promptAfter([
      { id: '019fe5a0', stages: { security: 'failed' } },
      { id: '019fe5c3', stages: { security: 'passed' }, runJson: false },
    ])

    expect(block(body, 'security')).toContain('Recorded by run `019fe5a0`')
  })

  it('names the digest and commit of each run it drew from', async () => {
    const body = await promptAfter([
      { id: '019fe5a0', digest: 'sha256:0000', stages: { evaluate: 'passed' } },
      { id: '019fe5c3', stages: { security: 'failed' } },
    ])

    expect(body).toContain('Run `019fe5a0` · digest `sha256:0000` · commit `a1b2c3d`')
    expect(body).toMatch(/Run `019fe5c3` · digest `sha256:[0-9a-f]{64}` · commit `a1b2c3d`/)
  })

  it('hands the TUI port the same prompt the subcommand prints', async () => {
    const fixture = await makeCliFixture()
    await seed(fixture, [{ id: '019fe5c3', stages: { evaluate: 'passed' } }])
    const { skill } = await selectSkill(fixture.home, 'declawed')

    const plan = await planOptimiseFor(fixture.home, skill)
    await runOptimise(fixture.deps, 'declawed', {})

    expect(plan.prompt).toBe(fixture.out.join(''))
    expect(plan.prompt).toContain('### evaluate — `passed`')
  })

  it('reads the sidecar and writes not one byte of it', async () => {
    const fixture = await makeCliFixture()
    await seed(fixture, [{ id: '019fe5c3', stages: { evaluate: 'passed' } }])
    const before = await readdir(fixture.runsRoot, { recursive: true })

    await runOptimise(fixture.deps, 'declawed', {})

    expect(await readdir(fixture.runsRoot, { recursive: true })).toEqual(before)
  })
})
