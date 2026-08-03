import { describe, expect, it } from 'vitest'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { retireSkill } from '../../src/core/release/retire.js'
import { scanSandboxRecords } from '../../src/core/isolation/record.js'
import { restoreInterrupted, scanInterrupted } from '../../src/core/isolation/recover.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { parseFrontmatter } from '../../src/core/discovery/frontmatter.js'
import type { SkillRef } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeGitRepo, makeRepo } from '../helpers/tmp-repo.js'

async function scene(git = true): Promise<SkillRef> {
  const make = git ? makeGitRepo : makeRepo
  const repo = await make({ files: { 'sk/SKILL.md': SKILL_MD_FULL('sk') } })
  const [skill] = await discoverSkills({ id: 'repo', path: repo, name: 'repo', isGit: git })
  return skill as SkillRef
}

const front = async (skill: SkillRef) =>
  parseFrontmatter(await readFile(join(skill.dir, 'SKILL.md'), 'utf8'))

describe('retireSkill', () => {
  it('previews the diff, then writes the deprecation on confirmation', async () => {
    const skill = await scene()
    let seen = ''
    const result = await retireSkill({
      skill,
      deprecated: true,
      supersededBy: 'repo/other',
      confirm: async (change) => {
        seen = change.unifiedDiff
        // R5.2: the diff exists before anything is written, in every mode.
        expect((await front(skill)).deprecated).toBe(false)
        return true
      },
    })
    expect(result.applied).toBe(true)
    expect(seen).toContain('deprecated: true')
    expect((await front(skill)).deprecated).toBe(true)
    expect(await readFile(join(skill.dir, 'SKILL.md'), 'utf8')).toContain('superseded_by: repo/other')
    // The version is untouched: retirement is metadata, not a release.
    expect((await front(skill)).version).toBe('1.0.0')
  })

  it('writes nothing when the confirmation is declined', async () => {
    const skill = await scene()
    const result = await retireSkill({ skill, deprecated: true, confirm: async () => false })
    expect(result.applied).toBe(false)
    expect((await front(skill)).deprecated).toBe(false)
  })

  it('reverses by the same route', async () => {
    const skill = await scene()
    await retireSkill({ skill, deprecated: true, supersededBy: 'repo/other', confirm: async () => true })
    await retireSkill({ skill, deprecated: false, confirm: async () => true })
    expect((await front(skill)).deprecated).toBe(false)
    expect(await readFile(join(skill.dir, 'SKILL.md'), 'utf8')).not.toContain('superseded_by')
  })

  it('reports no change when the skill is already in the requested state', async () => {
    const skill = await scene()
    const result = await retireSkill({ skill, deprecated: false, confirm: async () => true })
    expect(result.applied).toBe(false)
    expect(result.scope).toEqual([])
  })

  it('works on a repo with no git, through the snapshot strategy', async () => {
    const skill = await scene(false)
    await retireSkill({ skill, deprecated: true, confirm: async () => true })
    expect((await front(skill)).deprecated).toBe(true)
  })

  it('leaves its record under retire/, where the recovery scan looks', async () => {
    const skill = await scene()
    const result = await retireSkill({ skill, deprecated: true, confirm: async () => true })
    expect(result.recordDir).toContain(join('skillgantry', 'retire'))
    await expect(stat(join(result.recordDir, 'journal.json'))).resolves.toBeTruthy()
    // Settled, so startup does not report a completed retirement as interrupted.
    expect(await scanSandboxRecords(skill.workspacePath)).toEqual([])
  })

  it('recovers an interrupted retirement through the same scan and restore as a crashed release', async () => {
    const skill = await scene()
    // A crash between the sandbox opening and the confirmation reaching apply
    // or discard: the record is written up front (R10.10) and nothing settles
    // it. `confirm` throwing stands in for the process dying mid-review.
    await expect(
      retireSkill({
        skill,
        deprecated: true,
        confirm: async () => {
          throw new Error('simulated crash before the diff was answered')
        },
      }),
    ).rejects.toThrow('simulated crash')

    // Task 6's scan finds it precisely because `recordDirFor` routes on
    // `record.stage === 'retire'` — get that value wrong and this returns [].
    const found = await scanInterrupted([skill])
    expect(found).toHaveLength(1)
    expect(found[0]?.record.stage).toBe('retire')
    expect(found[0]?.recordDir).toContain(join('skillgantry', 'retire'))

    // Nothing was ever written to the live tree (the crash landed before
    // apply), so recovery is a prune and the frontmatter is untouched.
    const restored = await restoreInterrupted(found[0]!)
    expect(restored).toEqual([])
    expect((await front(skill)).deprecated).toBe(false)

    // Settled: a second scan reports nothing left to recover.
    expect(await scanInterrupted([skill])).toEqual([])
  })
})
