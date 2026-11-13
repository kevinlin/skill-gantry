import { describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { archiveNameFor, releaseDirtyPaths } from '../../src/core/index.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { releaseScope } from '../../src/core/release/release.js'
import { ReleaseStageExecutor } from '../../src/core/stages/release-stage.js'
import type { StageContext } from '../../src/core/stages/types.js'
import { type Exec, defaultExec } from '../../src/core/tools/exec.js'
import { repoSkillRef } from '../helpers/skill-ref.js'
import { SKILL_MD_FULL, makeGitRepo } from '../helpers/tmp-repo.js'

async function scene() {
  const repo = await makeGitRepo({
    files: {
      '.gitignore': '*.zip\n',
      'sk/SKILL.md': SKILL_MD_FULL('sk'),
      'versions.json': '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n',
    },
  })
  return { repo, skill: repoSkillRef(repo, 'sk', { isGit: true }) }
}

/** Real git, with the argv it was given kept for the assertion. */
function recording(): { exec: Exec; pathspecs: string[][] } {
  const pathspecs: string[][] = []
  const exec: Exec = (bin, argv, options) => {
    pathspecs.push([...argv].slice([...argv].indexOf('--') + 1))
    return defaultExec(bin, argv, options)
  }
  return { exec, pathspecs }
}

describe('releaseDirtyPaths', () => {
  it('leaves the archive out of the scope without a version, as it always has', async () => {
    const { skill } = await scene()
    const { exec, pathspecs } = recording()

    expect(await releaseDirtyPaths(skill, exec)).toEqual([])

    expect(pathspecs[0]).toEqual(expect.arrayContaining(['sk/SKILL.md', 'sk/CHANGELOG.md', 'versions.json']))
    expect(pathspecs[0]?.some((path) => path.endsWith('.zip'))).toBe(false)
  })

  it('previews the archive a resolved version names, beside the rest of the scope', async () => {
    const { skill } = await scene()
    const { exec, pathspecs } = recording()

    await releaseDirtyPaths(skill, exec, '1.0.1')

    expect(pathspecs[0]).toContain('sk_1.0.1.zip')
  })

  it('reports an archive already in the tree whether or not the repo ignores it, for the version it names only', async () => {
    const { repo, skill } = await scene()
    // `*.zip` is ignored: git hides it unless asked, and the preview asks.
    await writeFile(join(repo, 'sk_1.0.1.zip'), 'a stray archive')

    expect(await releaseDirtyPaths(skill)).toEqual([])
    expect(await releaseDirtyPaths(skill, defaultExec, '1.0.1')).toEqual(['sk_1.0.1.zip'])
    expect(await releaseDirtyPaths(skill, defaultExec, '1.0.2')).toEqual([])
  })
})

describe('archiveNameFor', () => {
  it('is the name the release stage puts in the mutation scope it plans', async () => {
    const { repo } = await scene()
    const ledger = openLedger(':memory:')
    for (const relPath of ['sk', '.']) {
      const skill = repoSkillRef(repo, relPath, { isGit: true })
      const plan = await new ReleaseStageExecutor({ ledger }).plan({
        skill,
        releaseTarget: { version: 'patch' },
      } as unknown as StageContext)

      // Both skill shapes: the key is the directory name for one and the declared name for the other.
      expect(plan.mutationScope.paths).toEqual(releaseScope(skill, true, archiveNameFor(skill, '1.0.1')).paths)
      expect(plan.mutationScope.paths).toContain(archiveNameFor(skill, '1.0.1'))
    }
    ledger.close()
    expect(archiveNameFor(repoSkillRef('/r', 'sk'), '2.0.0')).toBe('sk_2.0.0.zip')
    expect(archiveNameFor(repoSkillRef('/r', '.'), '2.0.0')).toBe('root_2.0.0.zip')
  })
})
