import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { wireQueue } from '../../src/cli/tui-command.js'
import { DEFAULT_CONFIG, loadConfig, registerRepo } from '../../src/core/config/config.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { runPipeline } from '../../src/core/pipeline/run.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'

vi.mock('../../src/core/pipeline/run.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/pipeline/run.js')>()
  return { ...actual, runPipeline: vi.fn(actual.runPipeline) }
})

beforeEach(() => {
  vi.mocked(runPipeline).mockClear()
})

/**
 * A job that settles on its own: `validate` over a lock holding no tool ends
 * the run without a subprocess, which is all the wiring needs to be asked.
 */
async function enqueueOne(
  caller: { authorised: boolean; trigger: string },
  spec: { trigger?: string } = {},
): Promise<Record<string, unknown>> {
  const home = await mkdtemp(join(tmpdir(), 'sg-wire-'))
  await registerRepo(home, await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } }))
  const config = await loadConfig(home)
  const [skill] = await discoverSkills(config.repos[0] as (typeof config.repos)[number])

  const ledger = openLedger(':memory:')
  const queue = wireQueue({
    config: DEFAULT_CONFIG,
    lock: { version: 1, tools: {} },
    env: { vars: {}, secrets: [] },
    ledger,
    concurrency: 1,
    ...caller,
  })
  try {
    queue.enqueue([{ skill: skill as NonNullable<typeof skill>, stages: ['validate'], ...spec }])
    await queue.idle()
  } finally {
    queue.close()
    ledger.close()
  }
  const calls = vi.mocked(runPipeline).mock.calls
  expect(calls).toHaveLength(1)
  return calls[0]?.[0] as unknown as Record<string, unknown>
}

describe('wireQueue', () => {
  it("passes the caller's authorised through, so the terminal's true is not every caller's", async () => {
    expect(await enqueueOne({ authorised: true, trigger: 'tui' })).toMatchObject({ authorised: true })
    vi.mocked(runPipeline).mockClear()
    expect(await enqueueOne({ authorised: false, trigger: 'cli' })).toMatchObject({ authorised: false })
  })

  it("passes the caller's trigger as the default, and a job's own trigger wins", async () => {
    expect(await enqueueOne({ authorised: false, trigger: 'cli' })).toMatchObject({ trigger: 'cli' })
    vi.mocked(runPipeline).mockClear()
    expect(await enqueueOne({ authorised: false, trigger: 'cli' }, { trigger: 'retry' })).toMatchObject({
      trigger: 'retry',
    })
  })
})
