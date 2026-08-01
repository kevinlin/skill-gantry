import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readlink, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LOCK_STALE_MS,
  claimRunDir,
  readIndex,
  reclaimLogPath,
  withSkillLock,
} from '../../src/core/workspace/writer.js'
import { CORE, runInChild } from '../helpers/child.js'

const ws = async (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-conc-'))

const finaliseInChild = (workspace: string, runId: string, endedAt: string): string => `
import { finalizeRun } from '${CORE}/workspace/writer.js'
await finalizeRun(${JSON.stringify(workspace)}, {
  runId: ${JSON.stringify(runId)},
  outcome: 'passed',
  endedAt: ${JSON.stringify(endedAt)},
})
process.stdout.write('ok')
`

const claimInChild = (workspace: string, count: number): string => `
import { claimRunDir } from '${CORE}/workspace/writer.js'
const ids = []
for (let i = 0; i < ${count}; i += 1) ids.push((await claimRunDir(${JSON.stringify(workspace)})).runId)
process.stdout.write(JSON.stringify(ids))
`

describe('two processes finalising one skill — R6.7', () => {
  it(
    'loses no index entry',
    async () => {
      const root = await ws()
      const a = await claimRunDir(root)
      const b = await claimRunDir(root)

      await Promise.all([
        runInChild(finaliseInChild(root, a.runId, '2026-08-01T00:00:00Z')),
        runInChild(finaliseInChild(root, b.runId, '2026-08-01T00:01:00Z')),
      ])

      const entries = await readIndex(root)
      expect(entries).toHaveLength(2)
      expect(new Set(entries.map((e) => e.runId))).toEqual(new Set([a.runId, b.runId]))
    },
    60_000,
  )

  it(
    'agrees on latest when finish order is inverted',
    async () => {
      const root = await ws()
      const first = await claimRunDir(root)
      const second = await claimRunDir(root)
      expect(second.runId > first.runId).toBe(true)

      // Claimed second, finalised first.
      await runInChild(finaliseInChild(root, second.runId, '2026-08-01T00:00:00Z'))
      await runInChild(finaliseInChild(root, first.runId, '2026-08-01T00:05:00Z'))

      expect(await readlink(join(root, 'skillgantry/runs/latest'))).toContain(second.runId)
    },
    60_000,
  )

  it(
    'never hands two processes the same run directory',
    async () => {
      const root = await ws()
      const [one, two] = await Promise.all([
        runInChild(claimInChild(root, 20)),
        runInChild(claimInChild(root, 20)),
      ])
      const ids = [...(JSON.parse(one) as string[]), ...(JSON.parse(two) as string[])]
      expect(ids).toHaveLength(40)
      expect(new Set(ids).size).toBe(40)
    },
    60_000,
  )
})

describe('lock reclaim — R6.9', () => {
  it('reclaims and logs a lock whose holder is dead', async () => {
    const root = await ws()
    await mkdir(join(root, 'skillgantry'), { recursive: true })
    // Above every platform's pid_max default, so the holder cannot exist.
    await writeFile(join(root, 'skillgantry/.lock'), JSON.stringify({ pid: 4194305 }))

    expect(await withSkillLock(root, async () => 'ran', 2_000)).toBe('ran')

    const log = await readFile(reclaimLogPath(root), 'utf8')
    const record = JSON.parse(log.trim().split('\n')[0]!) as Record<string, unknown>
    expect(record).toMatchObject({ pid: 4194305, reason: 'dead-holder', by: process.pid })
  })

  it('reclaims and logs a lease whose heartbeat stopped', async () => {
    const root = await ws()
    await mkdir(join(root, 'skillgantry'), { recursive: true })
    const path = join(root, 'skillgantry/.lock')
    // A live pid with a dead heartbeat: the lease, not the holder, is stale.
    await writeFile(path, JSON.stringify({ pid: process.pid }))
    const old = new Date(Date.now() - LOCK_STALE_MS * 2)
    await utimes(path, old, old)

    expect(await withSkillLock(root, async () => 'ran', 2_000)).toBe('ran')

    const log = await readFile(reclaimLogPath(root), 'utf8')
    expect(JSON.parse(log.trim().split('\n').at(-1)!)).toMatchObject({ reason: 'stale-lease' })
  })

  it('does not break a live, heartbeating lock', async () => {
    const root = await ws()
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const holding = withSkillLock(root, () => held, 30_000)
    await new Promise((r) => setTimeout(r, 20))

    await expect(withSkillLock(root, async () => 'ran', 150)).rejects.toThrow(/timed out/)
    release()
    await holding
    await expect(stat(reclaimLogPath(root))).rejects.toThrow()
  })
})
