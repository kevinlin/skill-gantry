import { describe, expect, it } from 'vitest'
import {
  CATALOGUE,
  PRESETS,
  RELEASE_TOOL_ID,
  catalogueEntry,
  catalogueIds,
  expandPreset,
  toolsForStage,
} from '../../src/core/tools/catalogue.js'
import { getAdapter } from '../../src/core/adapters/registry.js'

describe('catalogue', () => {
  it('holds the release installer, which no stage selects', () => {
    const skills = catalogueEntry(RELEASE_TOOL_ID)
    expect(skills?.stage).toBeNull()
  })

  it('gives every entry a runtime, an install spec and a version argv', () => {
    for (const spec of CATALOGUE) {
      expect(['uv', 'npm', 'none']).toContain(spec.runtime)
      expect(spec.install.pin.length).toBeGreaterThan(0)
      expect(spec.versionArgv.length).toBeGreaterThan(0)
      expect(spec.displayName.length).toBeGreaterThan(0)
    }
  })

  it('uses ids that are unique', () => {
    expect(new Set(catalogueIds()).size).toBe(CATALOGUE.length)
  })

  // The manifest keeps its own install spec for documentation; drift between
  // the two would install one version and record another.
  it('agrees with every adapter manifest that carries an install spec', () => {
    for (const spec of CATALOGUE) {
      const adapter = getAdapter(spec.id)
      if (!adapter) continue
      expect(adapter.manifest.install).toEqual(spec.install)
      expect(adapter.manifest.versionArgv).toEqual(spec.versionArgv)
    }
  })
})

describe('presets', () => {
  it('includes the release installer in all three — R3.8', () => {
    for (const name of ['minimal', 'recommended', 'everything'] as const) {
      expect(expandPreset(name).map((s) => s.id)).toContain(RELEASE_TOOL_ID)
    }
  })

  it('names only catalogued tools', () => {
    const ids = new Set(catalogueIds())
    for (const preset of Object.values(PRESETS)) {
      for (const id of preset) expect(ids.has(id)).toBe(true)
    }
  })

  it('nests minimal in recommended in everything', () => {
    const [min, rec, all] = [PRESETS.minimal, PRESETS.recommended, PRESETS.everything]
    for (const id of min) expect(rec).toContain(id)
    for (const id of rec) expect(all).toContain(id)
  })

  it('gives recommended at most one tool per stage', () => {
    const stages = expandPreset('recommended')
      .map((s) => s.stage)
      .filter((s): s is NonNullable<typeof s> => s !== null)
    expect(new Set(stages).size).toBe(stages.length)
  })

  it('makes everything the whole catalogue', () => {
    expect([...PRESETS.everything].sort()).toEqual([...catalogueIds()].sort())
  })

  it('offers per-stage choice', () => {
    expect(toolsForStage('security').map((s) => s.id)).toContain('skillspector')
  })
})
