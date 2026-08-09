import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openLedger } from '../../src/core/ledger/db.js'
import { runPipeline } from '../../src/core/pipeline/run.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { drain } from '../helpers/fake-run.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'

/**
 * `plan()` used to sit outside every catch in the stage loop, so its throw
 * escaped as an unhandled rejection: no `stage.json`, no ledger row, no
 * `stage:done`. The reachable trigger is R4.11's empty-selection rejection —
 * `optimise` ships no adapter, and an authorised caller that enqueues it
 * reaches `AdapterStageExecutor.plan()`'s throw rather than R12.4's skip.
 */
async function setup() {
  const repoPath = await makeRepo({ files: { 'declawed/SKILL.md': SKILL_MD('declawed', '1.1.0') } })
  const repo = { id: 'fx', path: repoPath, name: 'fx', isGit: false }
  const [skill] = await discoverSkills(repo)
  return {
    ledger: openLedger(':memory:'),
    input: {
      skill: skill!,
      stages: ['optimise'] as const,
      trigger: 'tui',
      // R4.11: empty, which is what `plan()` refuses.
      stageTools: { optimise: [] },
      lock: { version: 1 as const, tools: {} },
      env: {},
      secrets: [],
      provenance: { baseUrlHost: null, models: {}, authTokenHash: null, analysisModes: {} },
      artefactSizeCapBytes: 1024 * 1024,
      timeoutOverridesMs: {},
      // The terminal interface's constant. Without it the stage takes R12.4's
      // skip and never reaches the throw.
      authorised: true,
    },
  }
}

describe('a stage whose plan() throws', () => {
  it('settles as an errored stage rather than failing the run', async () => {
    const { ledger, input } = await setup()
    const handle = runPipeline({ ...input, ledger })
    const events = await drain(handle.events)
    const summary = await handle.done

    expect(events.map((e) => e.type)).toEqual([
      'run:start',
      'stage:start',
      'stage:done',
      'run:done',
    ])
    expect(events.some((e) => e.type === 'run:error')).toBe(false)
    expect(summary.outcome).toBe('errored')
    ledger.close()
  })

  it('writes stage.json naming the refusal, under its own error kind', async () => {
    const { ledger, input } = await setup()
    const handle = runPipeline({ ...input, ledger })
    await drain(handle.events)
    const summary = await handle.done

    const doc = JSON.parse(
      await readFile(join(summary.runDir, '04-optimise', 'stage.json'), 'utf8'),
    )
    expect(doc.outcome).toBe('errored')
    expect(doc.toolRuns[0].errorKind).toBe('plan-failed')
    expect(doc.toolRuns[0].summary).toMatch(/no tools selected for stage optimise/)
    ledger.close()
  })

  it('records the run and its stage in the ledger', async () => {
    const { ledger, input } = await setup()
    const handle = runPipeline({ ...input, ledger })
    await drain(handle.events)
    const summary = await handle.done

    const run = ledger.db
      .prepare('select outcome from runs where id = ?')
      .get(summary.runId) as { outcome: string } | undefined
    expect(run?.outcome).toBe('errored')

    const stages = ledger.db
      .prepare('select stage, outcome from stages where run_id = ?')
      .all(summary.runId) as { stage: string; outcome: string }[]
    expect(stages).toEqual([{ stage: 'optimise', outcome: 'errored' }])
    ledger.close()
  })

  // Migration 3 exists to delete the stage span defaulted to the run's, so a
  // stage settled on this path has to carry its own or it reintroduces the lie.
  it('stamps the stage with its own span rather than leaving it null', async () => {
    const { ledger, input } = await setup()
    const handle = runPipeline({ ...input, ledger })
    await drain(handle.events)
    const summary = await handle.done

    const row = ledger.db
      .prepare('select started_at, ended_at from stages where run_id = ?')
      .get(summary.runId) as { started_at: string | null; ended_at: string | null } | undefined
    expect(row?.started_at).toMatch(/^\d{4}-/)
    expect(row?.ended_at).toMatch(/^\d{4}-/)
    ledger.close()
  })
})
