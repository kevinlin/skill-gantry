import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGantryViews } from '../../src/cli/gantry-views.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { recordFixtureRun, skillFixture } from '../helpers/ledger-fixture.js'

async function home(security: string[] = []) {
  const dir = await mkdtemp(join(tmpdir(), 'sg-views-'))
  await writeFile(
    join(dir, 'config.json'),
    JSON.stringify({
      version: 1,
      repos: [],
      stageTools: { validate: ['skill-lint'], evaluate: [], security, optimise: [] },
      concurrency: 2,
      artefactSizeCapBytes: 33_554_432,
      timeoutOverridesMs: {},
      mutationTimeoutMs: 300_000,
    }),
  )
  return dir
}

describe('createGantryViews', () => {
  it('reads statistics and issues out of the ledger the CLI owns', async () => {
    const dir = await home()
    const dbPath = join(dir, 'gantry.db')
    const ledger = openLedger(dbPath)
    recordFixtureRun(ledger, {
      runId: '019283af-0000-7000-8000-000000000001',
      skill: skillFixture('alpha', 'declawed'),
      stages: [
        {
          stage: 'security',
          outcome: 'failed',
          findings: [
            {
              ruleClass: 'prompt-injection' as never,
              nativeRuleId: 'X1',
              severity: 'high',
              path: 'declawed/SKILL.md',
              message: 'm',
            },
          ],
        },
      ],
    })
    ledger.close()

    const views = createGantryViews({ home: dir, dbPath, write: () => undefined })
    expect((await views.dashboard({})).runs).toBe(1)
    const issues = await views.issues({})
    expect(issues).toHaveLength(1)
    expect(await views.actOnIssue(issues[0]!.fingerprint, 'acknowledge')).toBe('acknowledged')
    expect(await views.issues({ state: 'acknowledged' })).toHaveLength(1)
  })

  it('reports settings without reading a secret value', async () => {
    const dir = await home()
    await writeFile(join(dir, '.env'), 'ANTHROPIC_AUTH_TOKEN=super-secret-value\n', { mode: 0o600 })
    const views = createGantryViews({
      home: dir,
      dbPath: join(dir, 'gantry.db'),
      write: () => undefined,
    })
    const settings = await views.settings()
    expect(settings.concurrency).toBe(2)
    expect(JSON.stringify(settings)).not.toContain('super-secret-value')
  })

  it('closes the ledger it opened for each call', async () => {
    const dir = await home()
    const views = createGantryViews({
      home: dir,
      dbPath: join(dir, 'gantry.db'),
      write: () => undefined,
    })
    // Two calls in a row would throw on a handle left open in WAL mode by the
    // first if the implementation leaked it.
    await views.dashboard({})
    await views.dashboard({})
  })
})

describe('credential rows', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  /** The one selected tool declaring a requirement; skill-lint declares none. */
  const scannerRow = async (dir: string) =>
    (
      await createGantryViews({
        home: dir,
        dbPath: join(dir, 'gantry.db'),
        write: () => undefined,
      }).settings()
    ).credentials.find((row) => row.label === 'skill-scanner')

  it('reports a credential the file holds against the file, unlabelled', async () => {
    const dir = await home(['skill-scanner'])
    await writeFile(
      join(dir, '.env'),
      'SKILLSCAN_BASE_URL=http://localhost:11434\nSKILLSCAN_MODEL=ollama/llama3.1\n',
      { mode: 0o600 },
    )
    expect(await scannerRow(dir)).toEqual({
      label: 'skill-scanner',
      satisfied: true,
      detail: 'via Local or gateway model',
    })
  })

  /**
   * The divergence this row exists to close: the gate composes the child
   * environment with `spawnEnv`, so a key the shell exports satisfies the run.
   * Read from `.env` alone the screen said `missing` and named a file that held
   * nothing to fix.
   */
  it('counts a credential the shell exports, and says where it came from', async () => {
    const dir = await home(['skill-scanner'])
    await writeFile(join(dir, '.env'), 'SKILLSCAN_BASE_URL=http://localhost:11434\n', {
      mode: 0o600,
    })
    vi.stubEnv('SKILLSCAN_MODEL', 'ollama/llama3.1')
    expect(await scannerRow(dir)).toEqual({
      label: 'skill-scanner',
      satisfied: true,
      detail: 'via Local or gateway model (shell)',
    })
  })

  it('names both alternatives when neither environment holds one', async () => {
    const dir = await home(['skill-scanner'])
    await writeFile(join(dir, '.env'), 'SKILLSCAN_BASE_URL=http://localhost:11434\n', {
      mode: 0o600,
    })
    // Set and empty, which is the case `(env[key] ?? '') !== ''` exists for: an
    // exported-but-blank key is not a credential.
    vi.stubEnv('SKILLSCAN_MODEL', '')
    const row = await scannerRow(dir)
    expect(row?.satisfied).toBe(false)
    expect(row?.detail).toBe('needs one of Hosted model, Local or gateway model')
  })
})

describe('config origin reporting', () => {
  it('reports which config keys the file actually holds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sg-views-'))
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({
        version: 1,
        stageTools: { validate: [], evaluate: [], security: [], optimise: [] },
        concurrency: 4,
        artefactSizeCapBytes: 1024,
      }),
    )
    const view = await createGantryViews({
      home: dir,
      dbPath: join(dir, 'gantry.db'),
      write: () => undefined,
    }).settings()

    expect(view.presentKeys).toContain('concurrency')
    // Absent from the file, filled by the schema: the screen must be able to say
    // "default" rather than showing a number nobody wrote.
    expect(view.presentKeys).not.toContain('mutationTimeoutMs')
    expect(view.configPath).toBe(join(dir, 'config.json'))
  })

  it('reports no present keys when the file does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sg-views-'))
    const view = await createGantryViews({
      home: dir,
      dbPath: join(dir, 'gantry.db'),
      write: () => undefined,
    }).settings()
    expect(view.presentKeys).toEqual([])
  })
})
