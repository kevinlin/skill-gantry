import { describe, expect, it } from 'vitest'
import {
  CATALOGUE,
  PRESETS,
  RELEASE_TOOL_ID,
  SELECTABLE_CATALOGUE,
  SKILLHONE_TOOL_ID,
  SKILL_UPPER_TOOL_ID,
  SKILL_UP_TOOL_ID,
  catalogueEntry,
  catalogueIds,
  expandPreset,
  expandSelection,
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
      // A `git-skill` bundle is the one kind with nothing to invoke, so it
      // verifies by §5.2's three facts instead. Asserting an argv it can never
      // answer would make the invariant describe a tool rather than a rule.
      if (spec.install.kind !== 'git-skill') expect(spec.versionArgv.length).toBeGreaterThan(0)
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

  it('makes everything the whole selectable catalogue', () => {
    expect([...PRESETS.everything].sort()).toEqual(
      SELECTABLE_CATALOGUE.map((spec) => spec.id).sort(),
    )
  })

  it('offers per-stage choice', () => {
    expect(toolsForStage('security').map((s) => s.id)).toContain('skillspector')
  })
})

describe('the skillhone entry', () => {
  it('is installable but selectable by no stage', () => {
    const spec = catalogueEntry(SKILLHONE_TOOL_ID)
    expect(spec?.install.kind).toBe('git-skill')
    // R3.5b: an id the adapter registry does not hold fails every run of the
    // stage that selects it, so a bundle with no parser must reach no stage.
    expect(spec?.stage).toBeNull()
    expect(spec?.versionArgv).toEqual([])
  })

  it('pins a commit sha, because upstream publishes no tags', () => {
    const spec = catalogueEntry(SKILLHONE_TOOL_ID)
    if (spec?.install.kind !== 'git-skill') throw new Error('wrong kind')
    expect(spec.install.pin).toMatch(/^[0-9a-f]{40}$/)
    expect(spec.install.skills).toContain('skillhone-optimization')
    expect(spec.install.requirements).toBe('skills/skillhone/assets/requirements.txt')
  })

  it('joins Recommended and Everything but not Minimal', () => {
    expect(PRESETS.minimal).not.toContain(SKILLHONE_TOOL_ID)
    expect(PRESETS.recommended).toContain(SKILLHONE_TOOL_ID)
    expect(PRESETS.everything).toContain(SKILLHONE_TOOL_ID)
  })
})

describe('the skill-upper entry', () => {
  it('is installable but selectable by no stage — R3.11', () => {
    const spec = catalogueEntry(SKILL_UPPER_TOOL_ID)
    expect(spec?.install.kind).toBe('git-skill')
    // R3.5b: `AdapterStageExecutor.plan()` throws `unknown tool` on an id the
    // registry does not hold, which would fail every evaluate run.
    expect(spec?.stage).toBeNull()
    expect(spec?.versionArgv).toEqual([])
  })

  it('declares no requirements file, so no venv is built', () => {
    const spec = catalogueEntry(SKILL_UPPER_TOOL_ID)
    if (spec?.install.kind !== 'git-skill') throw new Error('wrong kind')
    expect(spec.install.requirements).toBeUndefined()
    expect(spec.install.skills).toEqual([SKILL_UPPER_TOOL_ID])
    expect(spec.runtime).toBe('none')
  })

  it('pins the skill-up release tag, so the two halves cannot drift apart', () => {
    const upper = catalogueEntry(SKILL_UPPER_TOOL_ID)
    const runner = catalogueEntry(SKILL_UP_TOOL_ID)
    if (upper?.install.kind !== 'git-skill') throw new Error('wrong kind')
    expect(upper.install.repo).toBe('alibaba/skill-up')
    expect(upper.install.pin).toBe(runner?.install.pin)
  })

  it('is offered by no preset and on no selectable row — R3.8', () => {
    for (const preset of Object.values(PRESETS)) {
      expect(preset).not.toContain(SKILL_UPPER_TOOL_ID)
    }
    expect(SELECTABLE_CATALOGUE.map((spec) => spec.id)).not.toContain(SKILL_UPPER_TOOL_ID)
    expect(catalogueIds()).toContain(SKILL_UPPER_TOOL_ID)
  })

  it('follows skill-up into the install set, and only then', () => {
    expect(expandSelection([SKILL_UP_TOOL_ID])).toContain(SKILL_UPPER_TOOL_ID)
    expect(expandSelection(['skillspector'])).not.toContain(SKILL_UPPER_TOOL_ID)
    // Idempotent: a re-entered wizard stages its own previous expansion.
    expect(expandSelection([SKILL_UP_TOOL_ID, SKILL_UPPER_TOOL_ID])).toEqual([
      SKILL_UP_TOOL_ID,
      SKILL_UPPER_TOOL_ID,
    ])
  })
})
