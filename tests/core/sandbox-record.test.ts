import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  markSandboxRecord,
  readSandboxRecord,
  scanSandboxRecords,
  writeSandboxRecord,
} from '../../src/core/isolation/record.js'
import type { SandboxRecord } from '../../src/core/isolation/types.js'

const record = (runId: string, state: SandboxRecord['state'] = 'active'): SandboxRecord => ({
  runId,
  stage: 'release',
  strategy: 'snapshot',
  state,
  scope: ['sk/SKILL.md'],
  repoPath: '/repo',
  skillId: 'repo/sk',
  snapshotDir: '/repo/sk-workspace/skillgantry/runs/x/snapshot-pre',
  workRoot: '/repo',
  preimages: [{ path: 'sk/SKILL.md', sha256: 'abc', mode: 33188 }],
  openedAt: '2026-08-03T00:00:00.000Z',
})

describe('sandbox record', () => {
  it('round-trips through disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sg-rec-'))
    await writeSandboxRecord(dir, record('r1'))
    expect(await readSandboxRecord(dir)).toEqual(record('r1'))
  })

  it('returns null for a directory holding no record', async () => {
    expect(await readSandboxRecord(await mkdtemp(join(tmpdir(), 'sg-rec-')))).toBeNull()
  })

  it('marks a state without losing the rest of the record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sg-rec-'))
    await writeSandboxRecord(dir, record('r1'))
    await markSandboxRecord(dir, 'applied')
    const read = await readSandboxRecord(dir)
    expect(read?.state).toBe('applied')
    expect(read?.preimages).toEqual(record('r1').preimages)
  })

  it('scans runs/ and retire/ and returns only active records', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'sg-ws-'))
    const runDir = join(ws, 'skillgantry', 'runs', 'run-a')
    const retireDir = join(ws, 'skillgantry', 'retire', 'ret-b')
    const settled = join(ws, 'skillgantry', 'runs', 'run-c')
    for (const dir of [runDir, retireDir, settled]) await mkdir(dir, { recursive: true })
    await writeSandboxRecord(runDir, record('run-a'))
    await writeSandboxRecord(retireDir, record('ret-b'))
    await writeSandboxRecord(settled, record('run-c', 'applied'))
    const found = await scanSandboxRecords(ws)
    expect(found.map((r) => r.runId).sort()).toEqual(['ret-b', 'run-a'])
  })

  it('ignores an unreadable record rather than failing the scan', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'sg-ws-'))
    const dir = join(ws, 'skillgantry', 'runs', 'broken')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'sandbox.json'), '{ not json')
    expect(await scanSandboxRecords(ws)).toEqual([])
  })

  it('returns nothing for a workspace with no skillgantry directory', async () => {
    expect(await scanSandboxRecords(await mkdtemp(join(tmpdir(), 'sg-ws-')))).toEqual([])
  })
})
