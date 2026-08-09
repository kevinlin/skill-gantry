import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BaselineSpec } from '../../src/core/adapters/types.js'
import { WRITE_TEMP_NAME } from '../../src/core/discovery/candidate.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import {
  applySuppression,
  discardSuppression,
  planSuppression,
} from '../../src/core/suppress/write.js'
import type { RepoRef, SkillRef } from '../../src/core/types.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'

const spec: BaselineSpec = {
  path: '{skillDir}/.skillspector-baseline.yaml',
  document: 'yaml',
  collection: 'rules',
  scaffold: { version: 2, rules: [], fingerprints: [] },
  entry: { id: '{ruleIdGlob}', path: '{pathGlob}', reason: '{reason}' },
}
const rule = { id: 'MP2', path: 'scripts/scan.py', reason: 'alignment whitespace' }

// digest.test.ts's shape: a real SkillRef through discovery, so `relPath`,
// `dir` and `repo.path` are whatever discovery actually produces.
const repoRef = (path: string): RepoRef => ({ id: 'fx', path, name: 'fx', isGit: false })
const fixture = async (): Promise<SkillRef> => {
  const root = await makeRepo({
    files: { 'declawed/SKILL.md': SKILL_MD('declawed'), 'declawed/scripts/scan.py': '# x\n' },
  })
  return (await discoverSkills(repoRef(root)))[0]!
}

describe('R10.12 suppression write', () => {
  it('stages the bytes without touching the target, and diffs them', async () => {
    const skill = await fixture()
    const plan = await planSuppression({ skill, toolId: 'skillspector', spec, entries: [rule] })
    expect(plan.added).toBe(1)
    expect(plan.diff).toContain('id: MP2')
    expect(plan.tempPath).toBe(join(skill.dir, WRITE_TEMP_NAME))
    await expect(stat(plan.path)).rejects.toThrow()
  })

  it('lands exactly the staged bytes on apply', async () => {
    const skill = await fixture()
    const plan = await planSuppression({ skill, toolId: 'skillspector', spec, entries: [rule] })
    const staged = await readFile(plan.tempPath, 'utf8')
    await applySuppression(plan)
    expect(await readFile(plan.path, 'utf8')).toBe(staged)
    await expect(stat(plan.tempPath)).rejects.toThrow()
  })

  it('leaves nothing behind on discard', async () => {
    const skill = await fixture()
    const plan = await planSuppression({ skill, toolId: 'skillspector', spec, entries: [rule] })
    await discardSuppression(plan)
    await expect(stat(plan.tempPath)).rejects.toThrow()
    await expect(stat(plan.path)).rejects.toThrow()
  })

  // R10.11's rule, reused: the window between preview and confirm widens with
  // however long the user reads the diff.
  it('aborts naming the path when the file changed under the preview', async () => {
    const skill = await fixture()
    await writeFile(join(skill.dir, '.skillspector-baseline.yaml'), 'version: 2\nrules: []\n')
    const plan = await planSuppression({ skill, toolId: 'skillspector', spec, entries: [rule] })
    await writeFile(
      join(skill.dir, '.skillspector-baseline.yaml'),
      'version: 2\nrules: []\n# edited\n',
    )
    await expect(applySuppression(plan)).rejects.toThrow(/preimage-drift/)
  })

  it('aborts when a file appeared where the preview found none', async () => {
    const skill = await fixture()
    const plan = await planSuppression({ skill, toolId: 'skillspector', spec, entries: [rule] })
    await writeFile(join(skill.dir, '.skillspector-baseline.yaml'), 'version: 2\nrules: []\n')
    await expect(applySuppression(plan)).rejects.toThrow(/preimage-drift/)
  })

  it('reports an entry already in the file and stages nothing', async () => {
    const skill = await fixture()
    const first = await planSuppression({ skill, toolId: 'skillspector', spec, entries: [rule] })
    await applySuppression(first)
    const second = await planSuppression({ skill, toolId: 'skillspector', spec, entries: [rule] })
    expect(second.added).toBe(0)
    expect(second.alreadyPresent).toBe(1)
    expect(second.diff).toBe('')
  })
})
