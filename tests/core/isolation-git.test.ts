import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { openGitWorktreeSandbox } from '../../src/core/isolation/git-worktree.js'
import { readSandboxRecord } from '../../src/core/isolation/record.js'
import { workspacePath } from '../../src/core/discovery/discover.js'
import type { SkillRef } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeGitRepo } from '../helpers/tmp-repo.js'

const run = promisify(execFile)

const SCOPE = [
  'sk/SKILL.md',
  'sk/CHANGELOG.md',
  'sk/old.txt',
  'sk/new.txt',
  'sk/run.sh',
  'sk/bin.dat',
  'versions.json',
]

async function fixture(): Promise<{ repo: string; skill: SkillRef; recordDir: string }> {
  const repo = await makeGitRepo({
    files: {
      'sk/SKILL.md': SKILL_MD_FULL('sk'),
      'sk/old.txt': 'old\n',
      'sk/run.sh': '#!/bin/sh\necho hi\n',
      'sk/bin.dat': 'plain text for now\n',
      'versions.json': '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n',
    },
  })
  // core.fileMode tracks the executable bit, so a chmod after the fixture
  // commit leaves the repo dirty; commit it so HEAD is 755 and the sandbox
  // opens clean, letting the "mode changed" test flip it back to 644 inside.
  await chmod(join(repo, 'sk/run.sh'), 0o755)
  await run('git', ['commit', '-qam', 'run.sh executable'], { cwd: repo })
  const skill: SkillRef = {
    id: 'repo/sk',
    name: 'sk',
    version: '1.0.0',
    dir: join(repo, 'sk'),
    relPath: 'sk',
    repo: { id: 'repo', path: repo, name: 'repo', isGit: true },
    rootSkill: false,
    workspacePath: workspacePath(repo, 'sk', false),
    deprecated: false,
    supersededBy: null,
  }
  return { repo, skill, recordDir: await mkdtemp(join(tmpdir(), 'sg-run-')) }
}

const open = async (over: Partial<Parameters<typeof openGitWorktreeSandbox>[0]> = {}) => {
  const { repo, skill, recordDir } = await fixture()
  const sandbox = await openGitWorktreeSandbox({
    skill,
    stage: 'release',
    runId: 'run-1',
    recordDir,
    scope: SCOPE,
    ...over,
  })
  return { repo, skill, recordDir, sandbox }
}

describe('GitWorktreeSandbox', () => {
  it('writes its record before anything else and names the strategy', async () => {
    const { recordDir, sandbox } = await open()
    const record = await readSandboxRecord(recordDir)
    expect(record?.state).toBe('active')
    expect(record?.strategy).toBe('git-worktree')
    expect(record?.workRoot).toBe(sandbox.workRoot)
    // The user's tree is never touched by opening, so restoring is a prune.
    expect(record?.snapshotDir).toBe('')
    await sandbox.dispose()
  })

  it('represents all five change kinds', async () => {
    const { sandbox } = await open()
    await writeFile(sandbox.resolve('sk/SKILL.md'), SKILL_MD_FULL('sk', '1.1.0'))
    await writeFile(sandbox.resolve('sk/CHANGELOG.md'), '# Changelog\n\n## 1.1.0\n')
    await rename(sandbox.resolve('sk/old.txt'), sandbox.resolve('sk/new.txt'))
    await writeFile(sandbox.resolve('sk/bin.dat'), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8]))
    await chmod(sandbox.resolve('sk/run.sh'), 0o644)

    const change = await sandbox.changeSet()
    const byPath = new Map(change.entries.map((e) => [e.path, e]))

    expect(byPath.get('sk/SKILL.md')?.kind).toBe('modified')
    expect(byPath.get('sk/CHANGELOG.md')?.kind).toBe('added')
    expect(byPath.get('sk/new.txt')).toMatchObject({ kind: 'renamed', from: 'sk/old.txt' })
    expect(byPath.get('sk/bin.dat')).toMatchObject({ kind: 'modified', binary: true })
    expect(byPath.get('sk/run.sh')?.kind).toBe('mode-changed')
    // A scoped text diff could express none of the last three, which is R10.8.
    expect(change.unifiedDiff).toContain('1.1.0')
    await sandbox.dispose()
  })

  it('captures a preimage per touched path, including the vanished side of a rename', async () => {
    const { sandbox } = await open()
    await rename(sandbox.resolve('sk/old.txt'), sandbox.resolve('sk/new.txt'))
    const change = await sandbox.changeSet()
    const byPath = new Map(change.preimages.map((p) => [p.path, p]))
    expect(byPath.get('sk/old.txt')?.sha256).toBeTruthy()
    expect(byPath.get('sk/new.txt')?.sha256).toBeNull()
    await sandbox.dispose()
  })

  it('represents a plain deletion, with nothing renamed onto it', async () => {
    const { sandbox } = await open()
    await rm(sandbox.resolve('sk/old.txt'))
    const change = await sandbox.changeSet()
    expect(change.entries).toEqual([expect.objectContaining({ path: 'sk/old.txt', kind: 'deleted' })])
    await sandbox.dispose()
  })

  it('excludes changes outside the declared scope', async () => {
    const { sandbox } = await open({ scope: ['sk/SKILL.md'] })
    await writeFile(sandbox.resolve('sk/SKILL.md'), SKILL_MD_FULL('sk', '1.1.0'))
    await writeFile(sandbox.resolve('versions.json'), '{"skills":{"sk":"9.9.9"}}\n')
    const change = await sandbox.changeSet()
    expect(change.entries.map((e) => e.path)).toEqual(['sk/SKILL.md'])
    await sandbox.dispose()
  })

  it('refuses a dirty scope path without an override', async () => {
    const { repo, skill, recordDir } = await fixture()
    await writeFile(join(repo, 'sk/SKILL.md'), SKILL_MD_FULL('sk', '1.0.0-wip'))
    await expect(
      openGitWorktreeSandbox({ skill, stage: 'release', runId: 'r', recordDir, scope: SCOPE }),
    ).rejects.toThrow(/uncommitted changes[\s\S]*sk\/SKILL\.md/)
  })

  it('seeds the override from the working tree and records its preimage', async () => {
    const { repo, skill, recordDir } = await fixture()
    const dirty = SKILL_MD_FULL('sk', '1.0.0-wip')
    await writeFile(join(repo, 'sk/SKILL.md'), dirty)

    const sandbox = await openGitWorktreeSandbox({
      skill,
      stage: 'release',
      runId: 'r',
      recordDir,
      scope: SCOPE,
      allowDirty: true,
    })
    // The tool must see the user's bytes, not HEAD's: a worktree starts at HEAD,
    // so without seeding an overriding user has the tool read stale bytes and
    // the later apply silently overwrite their uncommitted work.
    expect(await readFile(sandbox.resolve('sk/SKILL.md'), 'utf8')).toBe(dirty)
    expect((await readSandboxRecord(recordDir))?.preimages.find((p) => p.path === 'sk/SKILL.md')?.sha256).toBeTruthy()

    // And the change set is computed against those bytes, so the user's own
    // uncommitted edit does not appear in the diff they are asked to approve.
    expect((await sandbox.changeSet()).entries).toEqual([])
    await sandbox.dispose()
  })

  it('leaves the user tree untouched on discard and removes the worktree on dispose', async () => {
    const { repo, sandbox, recordDir } = await open()
    const before = await readFile(join(repo, 'sk/SKILL.md'), 'utf8')
    await writeFile(sandbox.resolve('sk/SKILL.md'), SKILL_MD_FULL('sk', '2.0.0'))
    await sandbox.discard()
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(before)
    expect((await readSandboxRecord(recordDir))?.state).toBe('discarded')
    await sandbox.dispose()
    await expect(stat(sandbox.workRoot)).rejects.toThrow()
  })

  it('refuses to resolve a path that escapes the sandbox root', async () => {
    const { sandbox } = await open({ scope: ['sk/SKILL.md'] })
    expect(sandbox.resolve('sk/SKILL.md').startsWith(sandbox.workRoot)).toBe(true)
    expect(() => sandbox.resolve('../outside')).toThrow('scope-escapes-root')
    await sandbox.dispose()
  })

  it('applies the sandbox bytes into the live tree', async () => {
    const { repo, sandbox } = await open()
    await writeFile(sandbox.resolve('sk/SKILL.md'), SKILL_MD_FULL('sk', '1.1.0'))
    await writeFile(sandbox.resolve('sk/CHANGELOG.md'), '# Changelog\n')
    const change = await sandbox.changeSet()
    await sandbox.apply(change)
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('1.1.0')
    expect(await readFile(join(repo, 'sk/CHANGELOG.md'), 'utf8')).toBe('# Changelog\n')
    await sandbox.dispose()
  })

  it('aborts the apply when a target drifted between preview and approval', async () => {
    const { repo, sandbox } = await open()
    await writeFile(sandbox.resolve('sk/SKILL.md'), SKILL_MD_FULL('sk', '1.1.0'))
    const change = await sandbox.changeSet()
    await writeFile(join(repo, 'sk/SKILL.md'), SKILL_MD_FULL('sk', '1.0.0-hand-edited'))
    await expect(sandbox.apply(change)).rejects.toThrow('preimage-drift: sk/SKILL.md')
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('1.0.0-hand-edited')
    await sandbox.dispose()
  })
})
