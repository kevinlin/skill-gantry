import { describe, expect, it } from 'vitest'
import { appendFile, mkdir, mkdtemp, readFile, readlink, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  claimRunDir,
  ensureGitignore,
  finalizeRun,
  readIndex,
  stageDirFor,
  withSkillLock,
  writeRunJson,
  writeStageJson,
} from '../../src/core/workspace/writer.js'
import type { StageResult } from '../../src/core/stages/types.js'

const ws = async (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-ws-'))

/** The clock is the caller's, so every test that does not care passes now. */
const claim = (root: string, at: Date = new Date()) => claimRunDir(root, at)

const latestOf = async (root: string): Promise<string> =>
  readlink(join(root, 'skillgantry/runs/latest'))

const stageResult = (): StageResult => ({
  stage: 'security',
  outcome: 'failed',
  verdict: 'failed',
  toolRuns: [
    {
      toolId: 'skillspector',
      toolVersion: '2.5.1',
      outcome: 'failed',
      exitCode: 0,
      durationMs: 1200,
      errorKind: null,
      artefactDir: '/x/skillspector',
      findings: [],
      metrics: { findingsTotal: 2 },
      summary: '2 findings',
    },
  ],
})

describe('claimRunDir', () => {
  it('names the directory for the start time and keeps a uuidv7 run id', async () => {
    const { runId, runDir } = await claimRunDir(await ws(), new Date(2026, 7, 11, 14, 32, 7))
    expect(runId).toMatch(/^[0-9a-f-]{36}$/)
    expect(basename(runDir)).toBe('2026-08-11_14-32-07')
  })

  it('produces time-ordered ids', async () => {
    const root = await ws()
    const a = await claim(root)
    await new Promise((r) => setTimeout(r, 5))
    const b = await claim(root)
    expect([a.runId, b.runId].sort()).toEqual([a.runId, b.runId])
  })

  it('suffixes the name for a second run started in the same second', async () => {
    const root = await ws()
    const at = new Date(2026, 7, 11, 14, 32, 7)
    const a = await claimRunDir(root, at)
    const b = await claimRunDir(root, at)
    expect(basename(a.runDir)).toBe('2026-08-11_14-32-07')
    expect(basename(b.runDir)).toBe('2026-08-11_14-32-07-2')
    expect((await stat(a.runDir)).isDirectory()).toBe(true)
    expect((await stat(b.runDir)).isDirectory()).toBe(true)
    expect(a.runId).not.toBe(b.runId)
  })

  it('creates the runs root with owner-only permissions', async () => {
    const root = await ws()
    const { runDir } = await claim(root)
    expect((await stat(runDir)).mode & 0o777).toBe(0o700)
  })
})

describe('writeRunJson and writeStageJson', () => {
  it('writes provenance and tool lock as siblings, with no token', async () => {
    const { runDir, runId } = await claim(await ws())
    await writeRunJson(runDir, {
      runId,
      skillId: 'fx/declawed',
      skillDigest: 'sha256:abc',
      git: { commit: null, dirty: false },
      provenance: {
        baseUrlHost: 'api.deepseek.com',
        models: { ANTHROPIC_MODEL: 'x' },
        authTokenHash: 'sha256:1a2b3c4d',
        analysisModes: { skillspector: 'static' },
      },
      toolLock: { skillspector: '2.5.1' },
    })
    const doc = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8'))
    expect(Object.keys(doc)).toEqual(
      expect.arrayContaining(['runId', 'skillDigest', 'provenance', 'toolLock']),
    )
    expect(doc.provenance.toolLock).toBeUndefined()
    expect(JSON.stringify(doc)).not.toMatch(/sk-/)
  })

  it('records unredacted artefacts so the exposure is visible', async () => {
    const { runDir } = await claim(await ws())
    const stageDir = stageDirFor(runDir, 3, 'security')
    await writeStageJson(stageDir, stageResult(), { skillspector: ['findings.sarif'] })
    const doc = JSON.parse(await readFile(join(stageDir, 'stage.json'), 'utf8'))
    expect(doc.toolRuns[0].unredactedArtefacts).toEqual(['findings.sarif'])
    expect(doc.toolRuns[0].redacted).toBe(false)
    expect(doc.outcome).toBe('failed')
  })

  it('numbers stage directories by lifecycle position', async () => {
    const { runDir } = await claim(await ws())
    expect(basename(stageDirFor(runDir, 3, 'security'))).toBe('03-security')
  })
})

describe('finalizeRun', () => {
  it('appends one line per run and points latest at the newest', async () => {
    const root = await ws()
    const a = await claim(root)
    await finalizeRun(root, {
      runId: a.runId,
      dir: basename(a.runDir),
      outcome: 'passed',
      endedAt: '2026-08-01T00:00:00Z',
    })
    const b = await claim(root)
    await finalizeRun(root, {
      runId: b.runId,
      dir: basename(b.runDir),
      outcome: 'failed',
      endedAt: '2026-08-01T00:01:00Z',
    })

    const lines = (await readFile(join(root, 'skillgantry/runs/index.ndjson'), 'utf8'))
      .trim()
      .split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1]!).outcome).toBe('failed')
    expect(await latestOf(root)).toBe(basename(b.runDir))
  })

  it('loses no line when three runs finalise concurrently', async () => {
    const root = await ws()
    const claims = await Promise.all([claim(root), claim(root), claim(root)])
    // Three claims in one second, so the suffix is what keeps them distinct.
    expect(new Set(claims.map((c) => basename(c.runDir))).size).toBe(3)
    await Promise.all(
      claims.map((c, i) =>
        finalizeRun(root, {
          runId: c.runId,
          dir: basename(c.runDir),
          outcome: 'passed',
          endedAt: `2026-08-01T00:0${i}:00Z`,
        }),
      ),
    )
    const lines = (await readFile(join(root, 'skillgantry/runs/index.ndjson'), 'utf8'))
      .trim()
      .split('\n')
    expect(lines).toHaveLength(3)
    expect(new Set(lines.map((l) => JSON.parse(l).runId)).size).toBe(3)
  })

  it("points latest at the greatest run id's directory even when finish order is inverted", async () => {
    const root = await ws()
    const first = await claim(root)
    const second = await claim(root)
    expect(second.runId > first.runId).toBe(true)

    // Second claimed later but finalises first.
    await finalizeRun(root, {
      runId: second.runId,
      dir: basename(second.runDir),
      outcome: 'passed',
      endedAt: '2026-08-01T00:00:00Z',
    })
    await finalizeRun(root, {
      runId: first.runId,
      dir: basename(first.runDir),
      outcome: 'passed',
      endedAt: '2026-08-01T00:05:00Z',
    })
    expect(await latestOf(root)).toBe(basename(second.runDir))
  })

  /**
   * A workspace written before the directory name was recorded holds entries
   * with no `dir`, and back then the basename was the run id. `latest` must
   * still resolve, so the fallback is exercised where it is decided.
   */
  it('points latest at an entry with no recorded directory by its run id', async () => {
    const root = await ws()
    await mkdir(join(root, 'skillgantry/runs/019fcf6e'), { recursive: true })
    await finalizeRun(root, {
      runId: '019fcf6e',
      outcome: 'passed',
      endedAt: '2026-08-01T00:00:00Z',
    })
    expect(await latestOf(root)).toBe('019fcf6e')
  })
})

describe('index recovery', () => {
  it('discards a truncated final line and keeps every earlier record', async () => {
    const root = await ws()
    const a = await claim(root)
    await finalizeRun(root, { runId: a.runId, outcome: 'passed', endedAt: '2026-08-01T00:00:00Z' })

    const path = join(root, 'skillgantry/runs/index.ndjson')
    await appendFile(path, '{"runId":"partial","outc')

    const entries = await readIndex(root)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.runId).toBe(a.runId)
  })

  it('does not fuse a new record onto a partial line', async () => {
    const root = await ws()
    const path = join(root, 'skillgantry/runs/index.ndjson')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '{"runId":"partial","outc')

    const b = await claim(root)
    await finalizeRun(root, { runId: b.runId, outcome: 'passed', endedAt: '2026-08-01T00:01:00Z' })

    const entries = await readIndex(root)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.runId).toBe(b.runId)
  })
})

describe('withSkillLock', () => {
  it('reclaims a lock whose holder is dead', async () => {
    const root = await ws()
    await mkdir(join(root, 'skillgantry'), { recursive: true })
    // pid 2^22 + 1 is above every platform's pid_max default, so it cannot exist.
    await writeFile(join(root, 'skillgantry/.lock'), JSON.stringify({ pid: 4194305 }))

    const reclaimed: number[] = []
    const value = await withSkillLock(root, async () => 'ran', 1_000, (_p, pid) =>
      reclaimed.push(pid),
    )
    expect(value).toBe('ran')
    expect(reclaimed).toEqual([4194305])
  })

  it('times out rather than breaking a live lock', async () => {
    const root = await ws()
    await mkdir(join(root, 'skillgantry'), { recursive: true })
    await writeFile(join(root, 'skillgantry/.lock'), JSON.stringify({ pid: process.pid }))
    await expect(withSkillLock(root, async () => 'ran', 100)).rejects.toThrow(/timed out/)
  })

  it('serialises concurrent critical sections', async () => {
    const root = await ws()
    const order: string[] = []
    await Promise.all([
      withSkillLock(root, async () => {
        order.push('a-start')
        await new Promise((r) => setTimeout(r, 50))
        order.push('a-end')
      }),
      withSkillLock(root, async () => {
        order.push('b-start')
        order.push('b-end')
      }),
    ])
    // Which holder wins the race is not defined; that the sections never
    // interleave is. Asserting a fixed winner would test the scheduler.
    expect(['a-start,a-end,b-start,b-end', 'b-start,b-end,a-start,a-end']).toContain(
      order.join(','),
    )
  })
})

describe('ensureGitignore', () => {
  it('adds both workspace patterns when absent', async () => {
    const repo = await ws()
    await ensureGitignore(repo)
    const body = await readFile(join(repo, '.gitignore'), 'utf8')
    expect(body).toContain('*-workspace/')
    expect(body).toContain('.skillgantry-workspace/')
  })

  it('is idempotent and preserves existing entries', async () => {
    const repo = await ws()
    await writeFile(join(repo, '.gitignore'), 'node_modules/\n*-workspace/\n')
    await ensureGitignore(repo)
    await ensureGitignore(repo)
    const body = await readFile(join(repo, '.gitignore'), 'utf8')
    expect(body).toContain('node_modules/')
    expect(body.match(/\*-workspace\//g)).toHaveLength(1)
  })
})
