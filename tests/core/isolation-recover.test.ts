import { describe, expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { restoreSnapshot } from '../../src/core/isolation/snapshot.js'
import { forgetInterrupted, restoreInterrupted, scanInterrupted } from '../../src/core/isolation/recover.js'
import { readSandboxRecord, writeSandboxRecord } from '../../src/core/isolation/record.js'
import { workspacePath } from '../../src/core/discovery/discover.js'
import { preimageOf } from '../../src/core/isolation/git-worktree.js'
import type { SkillRef } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeRepo } from '../helpers/tmp-repo.js'

async function interrupted() {
  const repo = await makeRepo({ files: { 'sk/SKILL.md': SKILL_MD_FULL('sk') } })
  const skill: SkillRef = {
    id: 'repo/sk',
    name: 'sk',
    version: '1.0.0',
    dir: join(repo, 'sk'),
    relPath: 'sk',
    repo: { id: 'repo', path: repo, name: 'repo', isGit: false },
    rootSkill: false,
    workspacePath: workspacePath(repo, 'sk', false),
    deprecated: false,
    supersededBy: null,
  }
  const recordDir = join(skill.workspacePath, 'skillgantry', 'runs', 'run-a')
  const snapshotDir = join(recordDir, 'snapshot-pre')
  await mkdir(join(snapshotDir, 'sk'), { recursive: true })
  await writeFile(join(snapshotDir, 'sk/SKILL.md'), SKILL_MD_FULL('sk'))
  await writeSandboxRecord(recordDir, {
    runId: 'run-a',
    stage: 'optimise',
    strategy: 'snapshot',
    state: 'active',
    scope: ['sk/SKILL.md'],
    repoPath: repo,
    skillId: skill.id,
    snapshotDir,
    workRoot: repo,
    preimages: [await preimageOf(repo, 'sk/SKILL.md')],
    openedAt: '2026-08-03T00:00:00.000Z',
  })
  // The crash: the tool had already rewritten the live file.
  await writeFile(join(repo, 'sk/SKILL.md'), 'half-written by an optimiser\n')
  return { repo, skill, recordDir }
}

describe('startup recovery', () => {
  it('finds an active record and names its skill', async () => {
    const { skill } = await interrupted()
    const found = await scanInterrupted([skill])
    expect(found).toHaveLength(1)
    expect(found[0]?.skillId).toBe('repo/sk')
    expect(found[0]?.record.stage).toBe('optimise')
    expect(found[0]?.journalIncomplete).toBe(false)
  })

  it('restores the live tree from the snapshot and settles the record', async () => {
    const { repo, skill, recordDir } = await interrupted()
    const found = await scanInterrupted([skill])
    const restored = await restoreInterrupted(found[0]!)
    expect(restored).toEqual(['sk/SKILL.md'])
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(SKILL_MD_FULL('sk'))
    expect((await readSandboxRecord(recordDir))?.state).toBe('discarded')
    expect(await scanInterrupted([skill])).toEqual([])
  })

  it('forgets a record without touching the tree', async () => {
    const { repo, skill } = await interrupted()
    const found = await scanInterrupted([skill])
    await forgetInterrupted(found[0]!)
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe('half-written by an optimiser\n')
    expect(await scanInterrupted([skill])).toEqual([])
  })

  it('restores from an incomplete journal when one exists', async () => {
    const { repo, skill, recordDir } = await interrupted()
    await writeFile(
      join(recordDir, 'journal.json'),
      JSON.stringify({
        runId: 'run-a',
        stage: 'optimise',
        liveRoot: repo,
        complete: false,
        entries: [{ path: 'sk/SKILL.md', priorSha: 'x', priorMode: 33188, priorBytesRef: 'aa' }],
      }),
    )
    await mkdir(join(recordDir, 'journal-bytes'), { recursive: true })
    await writeFile(join(recordDir, 'journal-bytes', 'aa'), 'from the journal\n')
    const found = await scanInterrupted([skill])
    expect(found[0]?.journalIncomplete).toBe(true)
    await restoreInterrupted(found[0]!)
    // The journal is the later evidence: it holds the bytes as they were
    // immediately before the apply, which is closer than the snapshot.
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe('from the journal\n')
  })

  it('settles an already-applied mutation without reverting it', async () => {
    const { repo, skill, recordDir } = await interrupted()
    // The crash R10.10's Important finding names: `openSnapshotSandbox.apply`
    // calls `applyJournalled` (durably marks the journal complete, live bytes
    // already written) and only then `markSandboxRecord(recordDir, 'applied')`.
    // A crash between those two lines leaves the record `active` over a
    // *complete* journal — indistinguishable from "unresolved" unless recovery
    // checks `complete` before falling through to a snapshot restore.
    await writeFile(join(repo, 'sk/SKILL.md'), 'applied by the optimiser\n')
    await writeFile(
      join(recordDir, 'journal.json'),
      JSON.stringify({
        runId: 'run-a',
        stage: 'optimise',
        liveRoot: repo,
        complete: true,
        entries: [{ path: 'sk/SKILL.md', priorSha: 'x', priorMode: 33188, priorBytesRef: 'aa' }],
      }),
    )
    const found = await scanInterrupted([skill])
    expect(found[0]?.journalIncomplete).toBe(false)
    const restored = await restoreInterrupted(found[0]!)
    expect(restored).toEqual([])
    // Must still hold the approved bytes, not the snapshot's pre-stage ones.
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe('applied by the optimiser\n')
    expect((await readSandboxRecord(recordDir))?.state).toBe('applied')
  })

  it('restores a git-strategy record by pruning, leaving the tree alone', async () => {
    const { repo, skill, recordDir } = await interrupted()
    const record = await readSandboxRecord(recordDir)
    await writeSandboxRecord(recordDir, { ...record!, strategy: 'git-worktree', snapshotDir: '' })
    const found = await scanInterrupted([skill])
    // The worktree strategy never wrote the live tree, so there is nothing to
    // restore and the half-written file is not ours.
    expect(await restoreInterrupted(found[0]!)).toEqual([])
    expect((await readSandboxRecord(recordDir))?.state).toBe('discarded')
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe('half-written by an optimiser\n')
  })

  it('ignores restoreSnapshot for a scope path the snapshot never held', async () => {
    const { skill } = await interrupted()
    // restoreSnapshot takes the SkillRef itself (Task 4's landed signature), not
    // a bare repo path, precisely so it can derive the workspace exclusion.
    await expect(restoreSnapshot('/nonexistent', skill, ['sk/SKILL.md'])).resolves.toBeUndefined()
  })
})
