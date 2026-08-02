import { describe, expect, it } from 'vitest'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openSnapshotSandbox } from '../../src/core/isolation/snapshot.js'
import { readSandboxRecord } from '../../src/core/isolation/record.js'
import { ROOT_WORKSPACE_DIR, workspacePath } from '../../src/core/discovery/discover.js'
import type { SkillRef } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeRepo } from '../helpers/tmp-repo.js'

const SCOPE = ['sk/SKILL.md', 'sk/CHANGELOG.md', 'sk/old.txt', 'sk/new.txt', 'sk/run.sh']

async function open(scope: readonly string[] = SCOPE) {
  const repo = await makeRepo({
    files: {
      'sk/SKILL.md': SKILL_MD_FULL('sk'),
      'sk/old.txt': 'old\n',
      'sk/run.sh': '#!/bin/sh\n',
    },
  })
  await chmod(join(repo, 'sk/run.sh'), 0o755)
  const skill: SkillRef = {
    id: 'repo/sk',
    name: 'sk',
    version: '1.0.0',
    dir: join(repo, 'sk'),
    relPath: 'sk',
    repo: { id: 'repo', path: repo, name: 'repo', isGit: false },
    rootSkill: false,
    workspacePath: workspacePath(repo, 'sk', false),
  }
  const recordDir = await mkdtemp(join(tmpdir(), 'sg-run-'))
  const sandbox = await openSnapshotSandbox({
    skill,
    stage: 'optimise',
    runId: 'run-1',
    recordDir,
    scope,
    snapshotDir: join(recordDir, 'snapshot-pre'),
  })
  return { repo, skill, recordDir, sandbox }
}

describe('SnapshotSandbox', () => {
  it('copies every existing scope path before anything runs, preserving modes', async () => {
    const { recordDir, sandbox } = await open()
    const snap = join(recordDir, 'snapshot-pre')
    expect(await readFile(join(snap, 'sk/SKILL.md'), 'utf8')).toBe(SKILL_MD_FULL('sk'))
    expect((await stat(join(snap, 'sk/run.sh'))).mode & 0o111).not.toBe(0)
    // A scope path that does not exist yet is not an error: release declares
    // CHANGELOG.md and the archive, neither of which need exist beforehand.
    await expect(stat(join(snap, 'sk/CHANGELOG.md'))).rejects.toThrow()
    expect((await readSandboxRecord(recordDir))?.snapshotDir).toBe(snap)
    await sandbox.dispose()
  })

  it('points the tool at the live tree', async () => {
    const { repo, sandbox } = await open()
    expect(sandbox.workRoot).toBe(repo)
    expect(sandbox.resolve('sk/SKILL.md')).toBe(join(repo, 'sk/SKILL.md'))
    await sandbox.dispose()
  })

  it('represents all five change kinds against the snapshot', async () => {
    const { sandbox } = await open()
    await writeFile(sandbox.resolve('sk/SKILL.md'), SKILL_MD_FULL('sk', '1.1.0'))
    await writeFile(sandbox.resolve('sk/CHANGELOG.md'), '# Changelog\n')
    await rename(sandbox.resolve('sk/old.txt'), sandbox.resolve('sk/new.txt'))
    await chmod(sandbox.resolve('sk/run.sh'), 0o644)

    const change = await sandbox.changeSet()
    const byPath = new Map(change.entries.map((e) => [e.path, e]))
    expect(byPath.get('sk/SKILL.md')?.kind).toBe('modified')
    expect(byPath.get('sk/CHANGELOG.md')?.kind).toBe('added')
    // Content-equal delete plus add is a rename, detected by hash, because
    // there is no index to ask.
    expect(byPath.get('sk/new.txt')).toMatchObject({ kind: 'renamed', from: 'sk/old.txt' })
    expect(byPath.get('sk/run.sh')?.kind).toBe('mode-changed')
    expect(change.unifiedDiff).toContain('1.1.0')
    await sandbox.dispose()
  })

  it('flags a binary change without trying to diff it', async () => {
    const { sandbox } = await open(['sk/bin.dat'])
    await writeFile(sandbox.resolve('sk/bin.dat'), Buffer.from([0, 1, 2, 0, 4]))
    const change = await sandbox.changeSet()
    expect(change.entries[0]).toMatchObject({ path: 'sk/bin.dat', kind: 'added', binary: true })
    await sandbox.dispose()
  })

  it('restores the live tree on discard, including a deletion and a mode', async () => {
    const { repo, recordDir, sandbox } = await open()
    const before = await readFile(join(repo, 'sk/SKILL.md'), 'utf8')
    await writeFile(sandbox.resolve('sk/SKILL.md'), 'clobbered\n')
    await rm(sandbox.resolve('sk/old.txt'))
    await writeFile(sandbox.resolve('sk/CHANGELOG.md'), 'new file\n')
    await chmod(sandbox.resolve('sk/run.sh'), 0o644)

    await sandbox.discard()

    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(before)
    expect(await readFile(join(repo, 'sk/old.txt'), 'utf8')).toBe('old\n')
    // A path the snapshot did not hold was created by the tool, so restoring
    // means removing it.
    await expect(stat(join(repo, 'sk/CHANGELOG.md'))).rejects.toThrow()
    expect((await stat(join(repo, 'sk/run.sh'))).mode & 0o111).not.toBe(0)
    expect((await readSandboxRecord(recordDir))?.state).toBe('discarded')
    await sandbox.dispose()
  })

  it('keeps the snapshot after dispose, because it is the run evidence', async () => {
    const { recordDir, sandbox } = await open()
    await sandbox.dispose()
    expect(await readdir(join(recordDir, 'snapshot-pre'))).toContain('sk')
  })

  it('preserves a symlink as a link, on copy and on restore (R2.10)', async () => {
    const repo = await makeRepo({ files: { 'sk/SKILL.md': SKILL_MD_FULL('sk'), 'sk/old.txt': 'old\n' } })
    await symlink('old.txt', join(repo, 'sk/link.txt'))
    const skill: SkillRef = {
      id: 'repo/sk',
      name: 'sk',
      version: '1.0.0',
      dir: join(repo, 'sk'),
      relPath: 'sk',
      repo: { id: 'repo', path: repo, name: 'repo', isGit: false },
      rootSkill: false,
      workspacePath: workspacePath(repo, 'sk', false),
    }
    const recordDir = await mkdtemp(join(tmpdir(), 'sg-run-'))
    const sandbox = await openSnapshotSandbox({
      skill,
      stage: 'optimise',
      runId: 'run-1',
      recordDir,
      scope: ['sk/link.txt'],
      snapshotDir: join(recordDir, 'snapshot-pre'),
    })

    const snapLink = join(recordDir, 'snapshot-pre', 'sk/link.txt')
    expect((await lstat(snapLink)).isSymbolicLink()).toBe(true)
    expect(await readlink(snapLink)).toBe('old.txt')

    // Point the live link elsewhere, then confirm discard restores the link
    // itself rather than following it and copying target bytes.
    await rm(sandbox.resolve('sk/link.txt'))
    await symlink('new.txt', sandbox.resolve('sk/link.txt'))
    await sandbox.discard()
    const liveLink = join(repo, 'sk/link.txt')
    expect((await lstat(liveLink)).isSymbolicLink()).toBe(true)
    expect(await readlink(liveLink)).toBe('old.txt')
    await sandbox.dispose()
  })

  it('excludes the workspace directory from a repo-root scope copy (R6.8)', async () => {
    // A repo-root skill's workspace lives inside the repo it is scoping, and
    // the run directory (holding the very snapshot being written) lives
    // inside that workspace. Copying the workspace into the snapshot would
    // therefore try to copy the snapshot into itself.
    const repo = await makeRepo({ files: { 'SKILL.md': SKILL_MD_FULL('root') } })
    const skill: SkillRef = {
      id: 'repo',
      name: 'root',
      version: '1.0.0',
      dir: repo,
      relPath: '.',
      repo: { id: 'repo', path: repo, name: 'repo', isGit: false },
      rootSkill: true,
      workspacePath: workspacePath(repo, '.', true),
    }
    const recordDir = join(repo, ROOT_WORKSPACE_DIR, 'skillgantry', 'runs', 'run-1')
    await mkdir(recordDir, { recursive: true })
    const sandbox = await openSnapshotSandbox({
      skill,
      stage: 'release',
      runId: 'run-1',
      recordDir,
      scope: ['.'],
      snapshotDir: join(recordDir, 'snapshot-pre'),
    })
    const snap = join(recordDir, 'snapshot-pre')
    expect(await readFile(join(snap, 'SKILL.md'), 'utf8')).toBe(SKILL_MD_FULL('root'))
    await expect(readdir(join(snap, ROOT_WORKSPACE_DIR))).rejects.toThrow()

    await sandbox.discard()
    await expect(stat(join(repo, ROOT_WORKSPACE_DIR, 'skillgantry', 'runs', 'run-1', 'sandbox.json'))).resolves.toBeDefined()
    await sandbox.dispose()
  })
})
