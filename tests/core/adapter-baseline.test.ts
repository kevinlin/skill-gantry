import { describe, expect, it } from 'vitest'
import { getAdapter, listAdapters } from '../../src/core/adapters/registry.js'

describe('R4.16 baseline declaration', () => {
  it('declares skillspector its baseline file, collection and entry shape', () => {
    const baseline = getAdapter('skillspector')?.manifest.baseline
    expect(baseline).toBeDefined()
    expect(baseline?.path).toBe('{skillDir}/.skillspector-baseline.yaml')
    expect(baseline?.document).toBe('yaml')
    expect(baseline?.collection).toBe('rules')
    expect(baseline?.entry).toEqual({
      id: '{ruleIdGlob}',
      path: '{pathGlob}',
      reason: '{reason}',
    })
  })

  it('scaffolds a v2 document with no fingerprints, so scanner_version is not required', () => {
    expect(getAdapter('skillspector')?.manifest.baseline?.scaffold).toEqual({
      version: 2,
      rules: [],
      fingerprints: [],
    })
  })

  // The flag exists to read the file this spec writes. Two literals of one
  // path is how the day one of them moves becomes the day SkillGantry writes
  // a baseline it no longer passes to the tool.
  it('passes the same path to the tool that it declares as the baseline', () => {
    for (const adapter of listAdapters()) {
      const { baseline, invoke } = adapter.manifest
      if (baseline === undefined) continue
      const paths = (invoke.conditionalArgv ?? []).map((group) => group.whenExists)
      expect(paths, `${adapter.manifest.id} declares a baseline`).toContain(baseline.path)
    }
  })

  it('leaves an adapter whose tool has no baseline undeclared', () => {
    expect(getAdapter('skill-scanner')?.manifest.baseline).toBeUndefined()
    expect(getAdapter('skill-lint')?.manifest.baseline).toBeUndefined()
    expect(getAdapter('skill-up')?.manifest.baseline).toBeUndefined()
  })
})
