import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { candidateManifest } from '../../src/core/discovery/candidate.js'
import { digestSkill } from '../../src/core/discovery/digest.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { candidatePolicyFor } from '../../src/core/isolation/candidate-policy.js'
import { dirtyPaths } from '../../src/core/isolation/git-worktree.js'
import { openSandbox } from '../../src/core/isolation/open.js'
import { defaultExec } from '../../src/core/tools/exec.js'
import type { SkillRef } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeGitRepo } from '../helpers/tmp-repo.js'

/**
 * Run `019fe590`. `declawed/.DS_Store` was gitignored, so it was in the
 * candidate the gates digested and absent from the worktree the sandbox built
 * from HEAD — and `git status` does not report ignored files, so it was never
 * seeded either. R9.9 refused, and re-running the gates reproduced the same
 * live digest and refused again: not a refusal the user could act on, but a
 * release made structurally impossible.
 */
async function fixture(files: Record<string, string>): Promise<SkillRef> {
  const root = await makeGitRepo({
    files: {
      'declawed/SKILL.md': SKILL_MD_FULL('declawed', '1.1.1'),
      '.gitignore': '.DS_Store\nThumbs.db\n__pycache__/\n',
      ...files,
    },
  })
  const [skill] = await discoverSkills({ id: 'fx', path: root, name: 'fx', isGit: true })
  return skill as SkillRef
}

describe('§4.4 excludes filesystem droppings from the candidate', () => {
  it('leaves .DS_Store and Thumbs.db out at any depth', async () => {
    const skill = await fixture({})
    await writeFile(join(skill.dir, '.DS_Store'), 'finder')
    await mkdir(join(skill.dir, 'references'), { recursive: true })
    await writeFile(join(skill.dir, 'references', '.DS_Store'), 'finder')
    await writeFile(join(skill.dir, 'references', 'Thumbs.db'), 'explorer')
    await writeFile(join(skill.dir, 'references', 'guide.md'), '# guide\n')

    const entries = (await candidateManifest(skill)).entries.map((e) => e.relPath)
    expect(entries).toEqual(['SKILL.md', 'references/guide.md'])
  })

  it('does not move the digest when Finder writes one', async () => {
    const skill = await fixture({})
    const before = await digestSkill(skill)
    await writeFile(join(skill.dir, '.DS_Store'), 'finder')
    expect(await digestSkill(skill)).toBe(before)
  })

  // The name is reserved by the operating system, so this is the one basename
  // rule §4.4 tolerates — a file legitimately called `.DS_Store` does not exist.
  it('still counts a normally named file the same way', async () => {
    const skill = await fixture({})
    const before = await digestSkill(skill)
    await writeFile(join(skill.dir, 'DS_Store.md'), 'real content\n')
    expect(await digestSkill(skill)).not.toBe(before)
  })
})

describe('R10.3 sees the candidate files git hides', () => {
  it('reports an ignored candidate file as dirty', async () => {
    // `scripts/` is committed, so git collapses the untracked report to the
    // ignored directory itself rather than to its tracked parent.
    const skill = await fixture({ 'declawed/scripts/run.sh': '#!/bin/sh\n' })
    await mkdir(join(skill.dir, 'scripts', '__pycache__'), { recursive: true })
    await writeFile(join(skill.dir, 'scripts', '__pycache__', 'x.pyc'), 'bytecode')

    const dirty = await dirtyPaths(
      skill.repo.path,
      ['declawed/SKILL.md'],
      await candidatePolicyFor(skill),
      defaultExec,
    )
    // Reported as the collapsed directory git names it, which is what the
    // seeding loop copies recursively.
    expect(dirty).toContain('declawed/scripts/__pycache__')
  })

  it('does not report a path the candidate excludes', async () => {
    const skill = await fixture({})
    await writeFile(join(skill.dir, '.DS_Store'), 'finder')

    const dirty = await dirtyPaths(
      skill.repo.path,
      ['declawed/SKILL.md'],
      await candidatePolicyFor(skill),
      defaultExec,
    )
    // git reports it now that `--ignored` is passed; membership is still asked
    // of the manifest, and the manifest no longer has it.
    expect(dirty).not.toContain('declawed/.DS_Store')
  })

  /**
   * The whole point, asserted as the equality R9.9 checks: the digest of the
   * sandbox and the digest of the live tree, with an ignored candidate file
   * present. Before `--ignored` these disagreed and nothing the user could do
   * would reconcile them.
   */
  it('builds a sandbox whose candidate digest equals the live one', async () => {
    const skill = await fixture({ 'declawed/scripts/run.sh': '#!/bin/sh\n' })
    await mkdir(join(skill.dir, 'scripts', '__pycache__'), { recursive: true })
    await writeFile(join(skill.dir, 'scripts', '__pycache__', 'x.pyc'), 'bytecode')
    const live = await digestSkill(skill)

    const sandbox = await openSandbox({
      skill,
      stage: 'release',
      runId: 'test-run',
      recordDir: await makeGitRepo({ files: { 'placeholder.md': 'x' } }),
      scope: ['declawed/SKILL.md', 'declawed/CHANGELOG.md'],
      allowDirty: true,
    })
    try {
      const inSandbox: SkillRef = {
        ...skill,
        dir: sandbox.resolve(skill.relPath),
        repo: { ...skill.repo, path: sandbox.workRoot },
      }
      expect(await digestSkill(inSandbox)).toBe(live)
    } finally {
      await sandbox.dispose()
    }
  })

  // `--ignored` widens what git reports, so the guard has to be shown not to
  // have become a toll every release pays.
  it('leaves a clean repo clean, so the override is not demanded of everyone', async () => {
    // `makeGitRepo` commits the fixture, and nothing ignored sits in the
    // candidate — the sidecar workspace is outside it.
    const skill = await fixture({ 'declawed/scripts/run.sh': '#!/bin/sh\n' })

    const dirty = await dirtyPaths(
      skill.repo.path,
      ['declawed/SKILL.md'],
      await candidatePolicyFor(skill),
      defaultExec,
    )
    expect(dirty).toEqual([])
  })
})
