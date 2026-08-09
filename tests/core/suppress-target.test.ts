import { describe, expect, it } from 'vitest'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { previewSuppression } from '../../src/core/suppress/target.js'
import type { RepoRef, SkillRef } from '../../src/core/types.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'

const repoRef = (path: string): RepoRef => ({ id: 'fx', path, name: 'fx', isGit: false })
const fixture = async (): Promise<SkillRef> => {
  const root = await makeRepo({
    files: { 'declawed/SKILL.md': SKILL_MD('declawed'), 'declawed/scripts/scan.py': '# x\n' },
  })
  return (await discoverSkills(repoRef(root)))[0]!
}

describe('previewSuppression', () => {
  it('plans a write for a detector whose tool declares a baseline', async () => {
    const skill = await fixture()
    const preview = await previewSuppression({
      skill,
      reason: 'alignment whitespace',
      rules: [
        { toolId: 'skillspector', nativeRuleId: 'MP2', relPath: `${skill.relPath}/scripts/scan.py` },
      ],
      stillReporting: ['skillspector'],
    })
    expect(preview.plans).toHaveLength(1)
    expect(preview.plans[0]?.toolId).toBe('skillspector')
    expect(preview.plans[0]?.diff).toContain('path: scripts/scan.py')
    expect(preview.uncovered).toEqual([])
  })

  // §10.4's conjunction: skillspector's baseline cannot hide a finding
  // skill-scanner is still reporting plainly beside it, so the gate still fails.
  it('names a detector still reporting it that has no baseline', async () => {
    const skill = await fixture()
    const preview = await previewSuppression({
      skill,
      reason: 'alignment whitespace',
      rules: [
        { toolId: 'skillspector', nativeRuleId: 'MP2', relPath: `${skill.relPath}/scripts/scan.py` },
        {
          toolId: 'skill-scanner',
          nativeRuleId: 'SS-9',
          relPath: `${skill.relPath}/scripts/scan.py`,
        },
      ],
      stillReporting: ['skillspector', 'skill-scanner'],
    })
    expect(preview.plans.map((plan) => plan.toolId)).toEqual(['skillspector'])
    expect(preview.uncovered).toEqual(['skill-scanner'])
  })

  // A detector that says gone has no vote in §10.4's conjunction, so it has
  // none here either — warning about it would be warning about nothing.
  it('ignores a baseline-less detector that is no longer reporting it', async () => {
    const skill = await fixture()
    const preview = await previewSuppression({
      skill,
      reason: 'r',
      rules: [
        { toolId: 'skillspector', nativeRuleId: 'MP2', relPath: `${skill.relPath}/a.md` },
        { toolId: 'skill-lint', nativeRuleId: 'SL-1', relPath: `${skill.relPath}/a.md` },
      ],
      stillReporting: ['skillspector'],
    })
    expect(preview.uncovered).toEqual([])
  })

  it('folds several rule ids for one tool into one plan', async () => {
    const skill = await fixture()
    const preview = await previewSuppression({
      skill,
      reason: 'r',
      rules: [
        { toolId: 'skillspector', nativeRuleId: 'MP2', relPath: `${skill.relPath}/a.md` },
        { toolId: 'skillspector', nativeRuleId: 'SSD-2', relPath: `${skill.relPath}/a.md` },
      ],
      stillReporting: ['skillspector'],
    })
    expect(preview.plans).toHaveLength(1)
    expect(preview.plans[0]?.added).toBe(2)
  })

  it('plans nothing when no detecting tool declares a baseline', async () => {
    const skill = await fixture()
    const preview = await previewSuppression({
      skill,
      reason: 'r',
      rules: [{ toolId: 'skill-scanner', nativeRuleId: 'SS-9', relPath: `${skill.relPath}/a.md` }],
      stillReporting: ['skill-scanner'],
    })
    expect(preview.plans).toEqual([])
    expect(preview.uncovered).toEqual(['skill-scanner'])
  })

  it('refuses an empty reason', async () => {
    const skill = await fixture()
    await expect(
      previewSuppression({
        skill,
        reason: '   ',
        rules: [{ toolId: 'skillspector', nativeRuleId: 'MP2', relPath: `${skill.relPath}/a.md` }],
        stillReporting: ['skillspector'],
      }),
    ).rejects.toThrow('a suppression reason is required')
  })
})
