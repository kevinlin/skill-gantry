import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { runPipeline, type RunHandle } from '../../src/core/pipeline/run.js'
import { saveToolLock } from '../../src/core/config/config.js'
import { makeFakeTool } from '../helpers/fake-tool.js'
import { makeHeadless, type Headless } from '../helpers/headless.js'
import { SKILL_MD } from '../helpers/tmp-repo.js'

// A spy that delegates: every case below still runs the real pipeline, and the
// two that need to see what the batch handed it read the calls.
vi.mock('../../src/core/pipeline/run.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/pipeline/run.js')>()
  return { ...actual, runPipeline: vi.fn(actual.runPipeline) }
})

const SARIF = (results: unknown[]): string =>
  JSON.stringify({
    version: '2.1.0',
    runs: [{ tool: { driver: { name: 'skillspector', version: '2.5.1' } }, results }],
  })

const FINDING = {
  ruleId: 'LP3',
  message: { text: 'no declared permissions' },
  level: 'warning',
  locations: [{ physicalLocation: { artifactLocation: { uri: 'SKILL.md' } } }],
}

interface Sweep {
  h: Headless
  /** Every skill directory the stand-in scanner was pointed at, one per line. */
  scanned: () => Promise<string[]>
  /** The repo holding `good`, `bad` and `fine`, and the one holding `other`. */
  repoId: string
  otherRepoId: string
  skillId: (name: string) => string
}

/**
 * Two repos, so a sweep of one proves it left the other alone, and a scanner
 * that fails `bad` and passes everything else — which is what makes "one failing
 * skill among passing ones" a fact about the batch and not about the fixture.
 * `$2` is the skill directory and `$7` the SARIF path the adapter names.
 */
async function sweep(): Promise<Sweep> {
  const h = await makeHeadless({
    repos: [
      {
        'good/SKILL.md': SKILL_MD('good'),
        'bad/SKILL.md': SKILL_MD('bad'),
        'fine/SKILL.md': SKILL_MD('fine'),
      },
      { 'other/SKILL.md': SKILL_MD('other') },
    ],
  })
  const log = join(await mkdtemp(join(tmpdir(), 'sg-scans-')), 'scanned')
  const bin = await makeFakeTool(
    'skillspector',
    `echo "$2" >> '${log}'\n` +
      `case "$2" in */bad) printf '%s' '${SARIF([FINDING])}' > "$7";; ` +
      `*) printf '%s' '${SARIF([])}' > "$7";; esac`,
  )
  await saveToolLock(h.home, {
    version: 1,
    tools: {
      skillspector: {
        installKind: 'uv-tool',
        requestedPin: 'v2.5.1',
        resolvedVersion: '2.5.1',
        bin,
        integrity: 'n/a',
        installedAt: '2026-08-01T00:00:00Z',
        verifiedAt: '2026-08-01T00:00:00Z',
      },
    },
  })
  const repoId = basename(h.repos[0] as string)
  return {
    h,
    repoId,
    otherRepoId: basename(h.repos[1] as string),
    skillId: (name) => `${repoId}/${name}`,
    scanned: async () =>
      existsSync(log) ? (await readFile(log, 'utf8')).split('\n').filter((l) => l !== '') : [],
  }
}

/** A request that must have been refused before any run existed. */
async function expectNoRunStarted(s: Sweep): Promise<void> {
  expect(await s.scanned()).toEqual([])
  expect(vi.mocked(runPipeline)).not.toHaveBeenCalled()
  expect(s.h.out.filter((line) => line.includes('run:start'))).toEqual([])
}

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('../../src/core/pipeline/run.js')>(
    '../../src/core/pipeline/run.js',
  )
  vi.mocked(runPipeline).mockReset()
  vi.mocked(runPipeline).mockImplementation(actual.runPipeline)
})

describe('skillgantry run --repo (R12.16)', () => {
  it('exits 1 when one skill among passing ones fails, and says which in plain output', async () => {
    const s = await sweep()

    expect(await s.h.run(['run', '--repo', s.repoId, '--stage', 'security'])).toBe(1)

    const rows = s.h.out.slice(0, -1)
    expect([...rows].sort()).toEqual(
      [
        `${s.skillId('bad')}  security  failed`,
        `${s.skillId('fine')}  security  passed`,
        `${s.skillId('good')}  security  passed`,
      ].sort(),
    )
    expect(s.h.out.at(-1)).toBe('3 skills: 2 passed, 1 not passed')
    expect(s.h.err).toEqual([])
  })

  it('exits 0 when every skill of the repo passes, and runs nothing outside it', async () => {
    const s = await sweep()

    expect(await s.h.run(['run', '--repo', s.otherRepoId, '--stage', 'security'])).toBe(0)

    expect(s.h.out).toEqual([
      `${s.otherRepoId}/other  security  passed`,
      '1 skills: 1 passed, 0 not passed',
    ])
    expect((await s.scanned()).map((dir) => basename(dir))).toEqual(['other'])
  })

  it('streams json events one per line, each naming its skill, closed by the summary', async () => {
    const s = await sweep()

    expect(await s.h.run(['run', '--repo', s.repoId, '--stage', 'security', '--json'])).toBe(1)

    const lines = s.h.out.map((line) => JSON.parse(line) as Record<string, unknown>)
    const events = lines.slice(0, -1) as Array<{ skillId: string; event: { type: string } }>
    expect(events.length).toBeGreaterThan(0)
    for (const line of events) {
      expect(Object.keys(line).sort()).toEqual(['event', 'skillId'])
      expect(typeof line.event.type).toBe('string')
    }
    expect(
      events.filter((e) => e.event.type === 'run:start').map((e) => e.skillId).sort(),
    ).toEqual([s.skillId('bad'), s.skillId('fine'), s.skillId('good')].sort())
    expect(lines.at(-1)).toEqual({
      summary: { skills: 3, passed: 2, notPassed: [s.skillId('bad')] },
    })
  })

  it('asks for the three gate stages when --stage is absent', async () => {
    const s = await sweep()

    await s.h.run(['run', '--repo', s.otherRepoId, '--json'])

    const starts = s.h.out
      .map((line) => JSON.parse(line) as { event?: { type: string; stages?: string[] } })
      .filter((line) => line.event?.type === 'run:start')
    expect(starts.map((line) => line.event?.stages)).toEqual([['validate', 'evaluate', 'security']])
  })

  it('counts a job that failed to start as not passed and still finishes the others', async () => {
    const s = await sweep()
    const actual = await vi.importActual<typeof import('../../src/core/pipeline/run.js')>(
      '../../src/core/pipeline/run.js',
    )
    vi.mocked(runPipeline).mockImplementation((input) => {
      if (!input.skill.id.endsWith('/fine')) return actual.runPipeline(input)
      const done = Promise.reject(new Error('could not open the run'))
      done.catch(() => undefined)
      const handle: RunHandle = {
        runId: Promise.resolve('never'),
        events: (async function* () {})(),
        resolveMutation: () => undefined,
        cancel: async () => undefined,
        done,
      }
      return handle
    })

    expect(await s.h.run(['run', '--repo', s.repoId, '--stage', 'security', '--json'])).toBe(1)

    const summary = JSON.parse(s.h.out.at(-1) as string) as {
      summary: { skills: number; passed: number; notPassed: string[] }
    }
    expect(summary.summary.skills).toBe(3)
    expect(summary.summary.passed).toBe(1)
    expect([...summary.summary.notPassed].sort()).toEqual(
      [s.skillId('bad'), s.skillId('fine')].sort(),
    )
  })

  it('reports why a job that failed to start did not complete, in plain output', async () => {
    const s = await sweep()
    vi.mocked(runPipeline).mockImplementation(() => {
      const done = Promise.reject(new Error('could not open the run'))
      done.catch(() => undefined)
      return {
        runId: Promise.resolve('never'),
        events: (async function* () {})(),
        resolveMutation: () => undefined,
        cancel: async () => undefined,
        done,
      }
    })

    expect(await s.h.run(['run', '--repo', s.otherRepoId, '--stage', 'security'])).toBe(1)

    expect(s.h.out).toEqual([
      `warning: ${s.otherRepoId}/other did not complete: could not open the run`,
      '1 skills: 0 passed, 1 not passed',
    ])
  })

  it('hands the pipeline authorised: false and the cli trigger, whatever the caller passed', async () => {
    const s = await sweep()

    await s.h.run(['run', '--repo', s.otherRepoId, '--stage', 'security', '--yes'])

    const calls = vi.mocked(runPipeline).mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toMatchObject({ authorised: false, trigger: 'cli' })
  })

  it('sizes the pool by the configured concurrency', async () => {
    const s = await sweep()
    const { loadConfig, saveConfig } = await import('../../src/core/config/config.js')
    await saveConfig(s.h.home, { ...(await loadConfig(s.h.home)), concurrency: 1 })

    // One slot and a scanner that records overlap: a pool of 1 never has two
    // runs in flight, so the second scan cannot start before the first ends.
    let inFlight = 0
    let peak = 0
    const actual = await vi.importActual<typeof import('../../src/core/pipeline/run.js')>(
      '../../src/core/pipeline/run.js',
    )
    vi.mocked(runPipeline).mockImplementation((input) => {
      const handle = actual.runPipeline(input)
      inFlight += 1
      peak = Math.max(peak, inFlight)
      void handle.done.then(
        () => (inFlight -= 1),
        () => (inFlight -= 1),
      )
      return handle
    })

    await s.h.run(['run', '--repo', s.repoId, '--stage', 'security'])

    expect(peak).toBe(1)
  })
})

describe('skillgantry run --repo — requests refused before a run exists', () => {
  it('rejects an unknown repo id', async () => {
    const s = await sweep()

    expect(await s.h.run(['run', '--repo', 'nope', '--stage', 'security'])).toBe(2)

    expect(s.h.err).toHaveLength(1)
    expect(s.h.err[0]).toMatch(/^error: .*nope/)
    await expectNoRunStarted(s)
  })

  it('rejects a repo with no discovered skill', async () => {
    const h = await makeHeadless({ repos: [{ 'README.md': 'nothing here' }] })
    const repoId = basename(h.repos[0] as string)

    expect(await h.run(['run', '--repo', repoId])).toBe(2)

    expect(h.err[0]).toMatch(/^error: .*no skill/)
    expect(vi.mocked(runPipeline)).not.toHaveBeenCalled()
  })

  it('rejects a skill given beside --repo', async () => {
    const s = await sweep()

    expect(await s.h.run(['run', 'good', '--repo', s.repoId, '--stage', 'security'])).toBe(2)

    expect(s.h.err[0]).toMatch(/^error: .*not both/)
    await expectNoRunStarted(s)
  })

  it('rejects neither a skill nor --repo', async () => {
    const s = await sweep()

    expect(await s.h.run(['run', '--stage', 'security'])).toBe(2)

    expect(s.h.err[0]).toMatch(/^error: .*--repo/)
    await expectNoRunStarted(s)
  })

  it.each(['release', 'optimise', 'security,release'])(
    'rejects --stage %s, which a batch has nowhere to authorise',
    async (stages) => {
      const s = await sweep()

      expect(await s.h.run(['run', '--repo', s.repoId, '--stage', stages])).toBe(2)

      expect(s.h.err[0]).toMatch(/^error: .*(release|optimise)/)
      await expectNoRunStarted(s)
    },
  )

  it('leaves the single-skill path alone: a release without --yes still reaches the engine', async () => {
    const s = await sweep()

    await s.h.run(['run', 'other', '--stage', 'release', '--json'])

    const done = s.h.out
      .map((line) => JSON.parse(line) as { type: string; outcome?: string })
      .find((event) => event.type === 'stage:done')
    expect(done?.outcome).toBe('skipped')
    expect(vi.mocked(runPipeline).mock.calls[0]?.[0]).toMatchObject({ authorised: false })
  })
})
