import { describe, expect, it } from 'vitest'
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyJournalled, readJournal, rollbackJournal } from '../../src/core/isolation/journal.js'
import { preimageOf } from '../../src/core/isolation/git-worktree.js'
import { defaultExec } from '../../src/core/tools/exec.js'
import type { ChangeSet } from '../../src/core/isolation/types.js'

async function scene() {
  const live = await mkdtemp(join(tmpdir(), 'sg-live-'))
  const source = await mkdtemp(join(tmpdir(), 'sg-src-'))
  const recordDir = await mkdtemp(join(tmpdir(), 'sg-rec-'))
  await mkdir(join(live, 'sk'), { recursive: true })
  await mkdir(join(source, 'sk'), { recursive: true })
  await writeFile(join(live, 'sk/SKILL.md'), 'version: 1.0.0\n')
  await writeFile(join(source, 'sk/SKILL.md'), 'version: 1.1.0\n')
  await writeFile(join(source, 'sk/CHANGELOG.md'), '# Changelog\n')
  const change: ChangeSet = {
    entries: [
      { path: 'sk/SKILL.md', kind: 'modified', binary: false },
      { path: 'sk/CHANGELOG.md', kind: 'added', binary: false },
    ],
    unifiedDiff: '',
    preimages: [
      await preimageOf(live, 'sk/SKILL.md'),
      await preimageOf(live, 'sk/CHANGELOG.md'),
    ],
  }
  return { live, source, recordDir, change }
}

const apply = (s: Awaited<ReturnType<typeof scene>>) =>
  applyJournalled({
    recordDir: s.recordDir,
    liveRoot: s.live,
    sourceRoot: s.source,
    change: s.change,
    exec: defaultExec,
  })

describe('applyJournalled', () => {
  it('writes the prior bytes before touching a target', async () => {
    const s = await scene()
    await apply(s)
    const journal = await readJournal(s.recordDir)
    expect(journal?.complete).toBe(true)
    const skillEntry = journal?.entries.find((e) => e.path === 'sk/SKILL.md')
    expect(skillEntry?.priorSha).toBeTruthy()
    expect(
      await readFile(join(s.recordDir, 'journal-bytes', skillEntry?.priorBytesRef as string), 'utf8'),
    ).toBe('version: 1.0.0\n')
    // An added path has no prior bytes, and the journal says so rather than
    // recording an empty file that a rollback would then restore.
    expect(journal?.entries.find((e) => e.path === 'sk/CHANGELOG.md')?.priorSha).toBeNull()
  })

  it('writes every target', async () => {
    const s = await scene()
    await apply(s)
    expect(await readFile(join(s.live, 'sk/SKILL.md'), 'utf8')).toBe('version: 1.1.0\n')
    expect(await readFile(join(s.live, 'sk/CHANGELOG.md'), 'utf8')).toBe('# Changelog\n')
  })

  it('aborts naming the drifted paths and writes nothing', async () => {
    const s = await scene()
    // The user edits while the diff sits awaiting approval — R10.11's window,
    // which widens with the mutation timeout.
    await writeFile(join(s.live, 'sk/SKILL.md'), 'version: 1.0.0-hand-edited\n')
    await expect(apply(s)).rejects.toThrow('preimage-drift: sk/SKILL.md')
    expect(await readFile(join(s.live, 'sk/SKILL.md'), 'utf8')).toBe('version: 1.0.0-hand-edited\n')
    await expect(stat(join(s.live, 'sk/CHANGELOG.md'))).rejects.toThrow()
    // Nothing was applied, so no journal claims otherwise.
    expect(await readJournal(s.recordDir)).toBeNull()
  })

  it('applies a deletion and a rename', async () => {
    const s = await scene()
    await writeFile(join(s.live, 'sk/old.txt'), 'old\n')
    await writeFile(join(s.source, 'sk/new.txt'), 'old\n')
    s.change.entries.push(
      { path: 'sk/new.txt', kind: 'renamed', from: 'sk/old.txt', binary: false },
    )
    s.change.preimages.push(
      await preimageOf(s.live, 'sk/old.txt'),
      await preimageOf(s.live, 'sk/new.txt'),
    )
    await apply(s)
    expect(await readFile(join(s.live, 'sk/new.txt'), 'utf8')).toBe('old\n')
    await expect(stat(join(s.live, 'sk/old.txt'))).rejects.toThrow()
  })

  it('rolls back an incomplete journal from the recorded prior bytes', async () => {
    const s = await scene()
    await apply(s)
    // Simulate a crash between the journal write and the final mark.
    const journal = await readJournal(s.recordDir)
    await writeFile(
      join(s.recordDir, 'journal.json'),
      JSON.stringify({ ...journal, complete: false }),
    )
    const restored = await rollbackJournal(s.recordDir)
    expect(restored.sort()).toEqual(['sk/CHANGELOG.md', 'sk/SKILL.md'])
    expect(await readFile(join(s.live, 'sk/SKILL.md'), 'utf8')).toBe('version: 1.0.0\n')
    // A path with no prior bytes did not exist before, so rollback removes it.
    await expect(stat(join(s.live, 'sk/CHANGELOG.md'))).rejects.toThrow()
  })

  it('leaves a complete journal alone', async () => {
    const s = await scene()
    await apply(s)
    expect(await rollbackJournal(s.recordDir)).toEqual([])
    expect(await readFile(join(s.live, 'sk/SKILL.md'), 'utf8')).toBe('version: 1.1.0\n')
  })

  // R10.8 names all five change kinds; the two scenes above already exercise
  // apply for a deletion, a rename and a mode change (the "applies a deletion
  // and a rename" case, plus the git/snapshot sandbox suites for the mode
  // change), but nothing had rolled one back. A reversed rename or a restored
  // deletion is exactly the kind of bug that would fail silently.
  it('rolls back a deletion, a rename and a mode change', async () => {
    const s = await scene()
    await writeFile(join(s.live, 'sk/old.txt'), 'old\n')
    await writeFile(join(s.source, 'sk/new.txt'), 'old\n')
    await writeFile(join(s.live, 'sk/gone.txt'), 'gone\n')
    await writeFile(join(s.live, 'sk/mode.txt'), 'mode\n')
    await chmod(join(s.live, 'sk/mode.txt'), 0o644)
    s.change.entries.push(
      { path: 'sk/new.txt', kind: 'renamed', from: 'sk/old.txt', binary: false },
      { path: 'sk/gone.txt', kind: 'deleted', binary: false },
      { path: 'sk/mode.txt', kind: 'mode-changed', mode: 0o755, binary: false },
    )
    s.change.preimages.push(
      await preimageOf(s.live, 'sk/old.txt'),
      await preimageOf(s.live, 'sk/new.txt'),
      await preimageOf(s.live, 'sk/gone.txt'),
      await preimageOf(s.live, 'sk/mode.txt'),
    )
    await apply(s)

    // Confirm the apply actually did the three things being rolled back,
    // so the rollback assertions below prove a reversal rather than a no-op.
    expect(await readFile(join(s.live, 'sk/new.txt'), 'utf8')).toBe('old\n')
    await expect(stat(join(s.live, 'sk/old.txt'))).rejects.toThrow()
    await expect(stat(join(s.live, 'sk/gone.txt'))).rejects.toThrow()
    expect((await stat(join(s.live, 'sk/mode.txt'))).mode & 0o777).toBe(0o755)

    // Simulate a crash between the journal write and the final mark.
    const journal = await readJournal(s.recordDir)
    await writeFile(join(s.recordDir, 'journal.json'), JSON.stringify({ ...journal, complete: false }))
    const restored = await rollbackJournal(s.recordDir)
    expect(restored.sort()).toEqual(
      ['sk/CHANGELOG.md', 'sk/SKILL.md', 'sk/gone.txt', 'sk/mode.txt', 'sk/new.txt', 'sk/old.txt'].sort(),
    )

    // Deletion reversed: the file is back with its prior bytes.
    expect(await readFile(join(s.live, 'sk/gone.txt'), 'utf8')).toBe('gone\n')
    // Rename reversed: the old path is back, the new one never existed before.
    expect(await readFile(join(s.live, 'sk/old.txt'), 'utf8')).toBe('old\n')
    await expect(stat(join(s.live, 'sk/new.txt'))).rejects.toThrow()
    // Mode change reversed: the original permission bits are restored.
    expect((await stat(join(s.live, 'sk/mode.txt'))).mode & 0o777).toBe(0o644)
  })

  // §4.4 and R2.10: a link is stored as a link everywhere else in the system —
  // the candidate manifest, the digest, the snapshot copy and the archive — and
  // the journal was the one stage that read through it. `readFile` on a symlink
  // returns the target's bytes, so the apply wrote a regular file over the
  // user's link and the rollback restored a copy of whatever it had pointed at.
  it('applies and rolls back a symlink as a link, never as its target bytes', async () => {
    const s = await scene()
    await writeFile(join(s.live, 'sk/target.txt'), 'pointed-at\n')
    await symlink('target.txt', join(s.live, 'sk/link.txt'))
    await writeFile(join(s.source, 'sk/target.txt'), 'pointed-at\n')
    await symlink('other.txt', join(s.source, 'sk/link.txt'))
    s.change.entries.push({ path: 'sk/link.txt', kind: 'modified', binary: false })
    s.change.preimages.push(await preimageOf(s.live, 'sk/link.txt'))

    await apply(s)
    expect((await lstat(join(s.live, 'sk/link.txt'))).isSymbolicLink()).toBe(true)
    expect(await readlink(join(s.live, 'sk/link.txt'))).toBe('other.txt')
    // The link was retargeted, not dereferenced: what it used to point at is
    // untouched, which a `readFile`-based apply could not have left true.
    expect(await readFile(join(s.live, 'sk/target.txt'), 'utf8')).toBe('pointed-at\n')

    const journal = await readJournal(s.recordDir)
    await writeFile(join(s.recordDir, 'journal.json'), JSON.stringify({ ...journal, complete: false }))
    await rollbackJournal(s.recordDir)
    expect((await lstat(join(s.live, 'sk/link.txt'))).isSymbolicLink()).toBe(true)
    expect(await readlink(join(s.live, 'sk/link.txt'))).toBe('target.txt')
  })

  // The other half of the same rule, on the read side. A dangling link used to
  // read as "the path does not exist" — sha256 null — so drift could not see a
  // retarget onto a missing file, and rollback would have deleted the link
  // instead of putting it back.
  it('preimages a dangling symlink as present, by its target string', async () => {
    const s = await scene()
    await symlink('nowhere.txt', join(s.live, 'sk/dangling.txt'))
    const preimage = await preimageOf(s.live, 'sk/dangling.txt')
    expect(preimage.sha256).not.toBeNull()
    expect(preimage.mode).not.toBeNull()

    await symlink('elsewhere.txt', join(s.source, 'sk/dangling.txt'))
    s.change.entries.push({ path: 'sk/dangling.txt', kind: 'modified', binary: false })
    s.change.preimages.push(preimage)
    // Retargeted between preview and apply: drift, not a silently equal pair.
    await rm(join(s.live, 'sk/dangling.txt'))
    await symlink('somewhere-else.txt', join(s.live, 'sk/dangling.txt'))
    await expect(apply(s)).rejects.toThrow('preimage-drift: sk/dangling.txt')
  })
})
