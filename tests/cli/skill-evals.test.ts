import { mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evalAssetsOf, hasEvalSuite } from '../../src/cli/skill-evals.js'
import type { SkillRef } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeRepo } from '../helpers/tmp-repo.js'

/** A repo holding `declawed/` plus whatever else the case adds under it. */
async function skillWith(files: Record<string, string>): Promise<SkillRef> {
  const repo = await makeRepo({
    files: { 'declawed/SKILL.md': SKILL_MD_FULL('declawed'), ...files },
  })
  return {
    id: 'x/declawed',
    name: 'declawed',
    dir: join(repo, 'declawed'),
    relPath: 'declawed',
    repo: { id: 'x', path: repo },
    workspacePath: join(repo, 'declawed-workspace'),
  } as SkillRef
}

describe('evalAssetsOf', () => {
  it('lists the suite file and counts the case files, nothing else', async () => {
    const skill = await skillWith({
      'declawed/evals/eval.yaml': 'cases: []\n',
      'declawed/evals/cases/a.yaml': 'a\n',
      'declawed/evals/cases/b.yaml': 'b\n',
    })

    expect(await evalAssetsOf(skill)).toEqual([
      'declawed/evals/eval.yaml',
      'declawed/evals/cases/ (2 files)',
    ])
  })

  it('never returns a bare directory', async () => {
    // `evals` and `evals/cases` each used to be listed as a path on its own,
    // which an agent reads as a file it can open.
    const skill = await skillWith({
      'declawed/evals/eval.yaml': 'cases: []\n',
      'declawed/evals/cases/a.yaml': 'a\n',
      'declawed/evals/fixtures/input.txt': 'x\n',
    })

    const assets = await evalAssetsOf(skill)
    expect(assets).not.toContain('declawed/evals')
    expect(assets).not.toContain('declawed/evals/cases')
    for (const asset of assets) expect(asset).not.toMatch(/\/$/)
  })

  it('lists the cases without a suite, so the gap is visible', async () => {
    const skill = await skillWith({ 'declawed/evals/cases/a.yaml': 'a\n' })

    expect(await evalAssetsOf(skill)).toEqual(['declawed/evals/cases/ (1 file)'])
  })

  it('counts only the regular files directly in cases/', async () => {
    const skill = await skillWith({
      'declawed/evals/cases/a.yaml': 'a\n',
      'declawed/evals/cases/nested/b.yaml': 'b\n',
    })
    await symlink('a.yaml', join(skill.dir, 'evals', 'cases', 'link.yaml'))

    expect(await evalAssetsOf(skill)).toEqual(['declawed/evals/cases/ (1 file)'])
  })

  it('reports an empty cases directory as zero files', async () => {
    const skill = await skillWith({})
    await mkdir(join(skill.dir, 'evals', 'cases'), { recursive: true })

    expect(await evalAssetsOf(skill)).toEqual(['declawed/evals/cases/ (0 files)'])
  })

  it('returns nothing for an evals directory that holds neither', async () => {
    const skill = await skillWith({ 'declawed/evals/README.md': 'notes\n' })

    expect(await evalAssetsOf(skill)).toEqual([])
  })

  it('returns nothing for a skill with no evals directory', async () => {
    expect(await evalAssetsOf(await skillWith({}))).toEqual([])
  })

  it('does not list a directory named eval.yaml as the suite', async () => {
    const skill = await skillWith({})
    await mkdir(join(skill.dir, 'evals', 'eval.yaml'), { recursive: true })

    expect(await evalAssetsOf(skill)).toEqual([])
  })
})

describe('hasEvalSuite', () => {
  it('is true for evals/eval.yaml and false for cases alone', async () => {
    expect(await hasEvalSuite(await skillWith({ 'declawed/evals/eval.yaml': 'x\n' }))).toBe(true)
    expect(await hasEvalSuite(await skillWith({ 'declawed/evals/cases/a.yaml': 'a\n' }))).toBe(false)
    expect(await hasEvalSuite(await skillWith({}))).toBe(false)
  })
})
