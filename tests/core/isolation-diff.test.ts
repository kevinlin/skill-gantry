import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unifiedDiffFor } from '../../src/core/isolation/diff.js'

const scratch = (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-diff-'))

describe('unifiedDiffFor', () => {
  it('renders a modification as a unified diff labelled by repo path', async () => {
    const dir = await scratch()
    await writeFile(join(dir, 'a'), 'one\ntwo\nthree\n')
    await writeFile(join(dir, 'b'), 'one\nTWO\nthree\n')
    const diff = await unifiedDiffFor(join(dir, 'a'), join(dir, 'b'), 'sk/SKILL.md')
    expect(diff).toContain('-two')
    expect(diff).toContain('+TWO')
    expect(diff).toContain('sk/SKILL.md')
    // A reviewer reads repo-relative paths, never our temp directories.
    expect(diff).not.toContain(dir)
  })

  it('renders an addition when the old side is absent', async () => {
    const dir = await scratch()
    await writeFile(join(dir, 'b'), 'new\n')
    const diff = await unifiedDiffFor(null, join(dir, 'b'), 'sk/CHANGELOG.md')
    expect(diff).toContain('+new')
    expect(diff).toContain('sk/CHANGELOG.md')
  })

  it('renders a deletion when the new side is absent', async () => {
    const dir = await scratch()
    await writeFile(join(dir, 'a'), 'gone\n')
    expect(await unifiedDiffFor(join(dir, 'a'), null, 'sk/old.txt')).toContain('-gone')
  })

  it('returns an empty string for two identical files', async () => {
    const dir = await scratch()
    await writeFile(join(dir, 'a'), 'same\n')
    await writeFile(join(dir, 'b'), 'same\n')
    expect(await unifiedDiffFor(join(dir, 'a'), join(dir, 'b'), 'sk/same.txt')).toBe('')
  })
})
