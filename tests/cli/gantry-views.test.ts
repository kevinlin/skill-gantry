import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGantryViews } from '../../src/cli/gantry-views.js'
import { gateStatuses } from '../../src/cli/status-command.js'
import { candidateManifest } from '../../src/core/discovery/candidate.js'
import { skillDigest } from '../../src/core/discovery/digest.js'
import { type Exec, commitHint } from '../../src/core/index.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { makeHeadless } from '../helpers/headless.js'
import { recordFixtureRun, skillFixture } from '../helpers/ledger-fixture.js'
import { seedGates } from '../helpers/release-fixture.js'
import { SKILL_MD_FULL } from '../helpers/tmp-repo.js'

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

/** A skill whose gates were recorded against `digest`, with the views that read them. */
async function gateScene(opts: {
  git?: boolean
  outcomes?: Partial<Record<'validate' | 'evaluate' | 'security', 'passed' | 'failed'>>
  digest?: (current: string) => string
}) {
  const h = await makeHeadless({ git: opts.git ?? false })
  const [skill] = await h.skills()
  const current = await skillDigest(await candidateManifest(skill!))
  const ledger = openLedger(h.dbPath)
  seedGates(ledger, skill!, {
    digest: opts.digest?.(current) ?? current,
    runId: 'run-recorded',
    ...(opts.outcomes === undefined ? {} : { outcomes: opts.outcomes }),
  })
  ledger.close()
  return { h, skill: skill! }
}

describe('R11.25 gates', () => {
  it('reads the verdicts `status` is built from, for the bytes on disk', async () => {
    const { h, skill } = await gateScene({ outcomes: { validate: 'passed', evaluate: 'passed', security: 'failed' } })
    const views = createGantryViews(h.deps)

    const gates = await views.gates(skill.id)

    expect(gates.map((gate) => [gate.stage, gate.outcome, gate.current])).toEqual([
      ['validate', 'passed', true],
      ['evaluate', 'passed', true],
      ['security', 'failed', true],
    ])
    expect(gates.every((gate) => gate.runId === 'run-recorded')).toBe(true)
    // One function, so the rail and the document cannot disagree about a verdict.
    expect(gates).toEqual(await gateStatuses(h.deps, skill))
  })

  it('reports a verdict recorded against other bytes as not current', async () => {
    const { h, skill } = await gateScene({ digest: () => 'sha256:someone-elses' })
    const gates = await createGantryViews(h.deps).gates(skill.id)
    expect(gates.map((gate) => gate.current)).toEqual([false, false, false])
    expect(gates.map((gate) => gate.outcome)).toEqual(['passed', 'passed', 'passed'])
  })

  it('leaves a gate no run reached a verdict for with no outcome', async () => {
    const { h, skill } = await gateScene({ outcomes: { validate: 'passed' } })
    const gates = await createGantryViews(h.deps).gates(skill.id)
    expect(gates[0]).toMatchObject({ stage: 'validate', outcome: 'passed' })
    expect(gates[1]).toMatchObject({ stage: 'evaluate', outcome: null, runId: null })
    expect(gates[2]).toMatchObject({ stage: 'security', outcome: null, runId: null })
  })

  it('re-discovers on every call, so an edit made after launch shows as stale', async () => {
    const { h, skill } = await gateScene({})
    const views = createGantryViews(h.deps)
    expect((await views.gates(skill.id)).every((gate) => gate.current)).toBe(true)

    await writeFile(join(skill.dir, 'SKILL.md'), `${SKILL_MD_FULL('sk')}\nedited after the run\n`)

    expect((await views.gates(skill.id)).every((gate) => !gate.current)).toBe(true)
  })

  it('rejects a skill that is not registered', async () => {
    const { h } = await gateScene({})
    await expect(createGantryViews(h.deps).gates('nope/none')).rejects.toThrow('no skill nope/none')
  })
})

describe('R9.7 releaseHint', () => {
  const calls = () => {
    const seen: Array<{ bin: string; cwd: string | undefined }> = []
    const exec: Exec = async (bin, _argv, options) => {
      seen.push({ bin, cwd: options?.cwd })
      return { stdout: '?? sk_1.0.1.zip\0', stderr: '' }
    }
    return { seen, exec }
  }

  it('composes the add and the commit over the paths git reports as changed', async () => {
    const { h, skill } = await gateScene({ git: true })
    const repo = skill.repo.path
    await writeFile(join(skill.dir, 'SKILL.md'), `${SKILL_MD_FULL('sk')}\nbumped\n`)

    const lines = await createGantryViews(h.deps).releaseHint({
      skill,
      version: '1.0.1',
      // CHANGELOG.md was never written, so git does not report it and the add is not asked to take it.
      scope: ['sk/SKILL.md', 'sk/CHANGELOG.md'],
    })

    expect(lines).toEqual(commitHint({ repo, name: 'sk', version: '1.0.1', paths: ['sk/SKILL.md'] }))
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain("-m 'release(sk): 1.0.1'")
  })

  it('goes through the injected Exec, once, in the repo', async () => {
    const { h, skill } = await gateScene({ git: true })
    const { seen, exec } = calls()

    const lines = await createGantryViews({ ...h.deps, exec }).releaseHint({
      skill,
      version: '1.0.1',
      scope: ['sk_1.0.1.zip'],
    })

    expect(seen).toEqual([{ bin: 'git', cwd: skill.repo.path }])
    expect(lines).toEqual(
      commitHint({ repo: skill.repo.path, name: 'sk', version: '1.0.1', paths: ['sk_1.0.1.zip'] }),
    )
  })

  it('says nothing for a repo that is not git-backed, and does not ask git', async () => {
    const { h, skill } = await gateScene({ git: false })
    const { seen, exec } = calls()

    expect(
      await createGantryViews({ ...h.deps, exec }).releaseHint({ skill, version: '1.0.1', scope: ['sk/SKILL.md'] }),
    ).toEqual([])
    expect(seen).toEqual([])
  })

  it('says nothing when git reports none of the scope changed', async () => {
    const { h, skill } = await gateScene({ git: true })
    expect(
      await createGantryViews(h.deps).releaseHint({ skill, version: '1.0.1', scope: ['sk/SKILL.md'] }),
    ).toEqual([])
  })
})
