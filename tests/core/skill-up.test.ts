import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { manifest, parse } from '../../src/core/adapters/skill-up.js'
import type { SkillRef } from '../../src/core/types.js'

const skill: SkillRef = {
  id: 'zapac/declawed',
  name: 'declawed',
  version: null,
  dir: '/tmp/zapac/declawed',
  relPath: 'declawed',
  repo: { id: 'zapac', path: '/tmp/zapac', name: 'zapac', isGit: true },
  rootSkill: false,
  frontmatterReadable: true,
  workspacePath: '/tmp/zapac/declawed-workspace',
  deprecated: false,
  supersededBy: null,
}

const REPORT = 'iteration-1/report.json'

describe('skill-up manifest', () => {
  it('is the only pick-one stage tool, and redirects its own iteration output', () => {
    expect(manifest.stage).toBe('evaluate')
    expect(manifest.policy).toBe('pick-one')
    // Without --output-dir, skill-up writes iteration-N into <skill>-workspace,
    // which is the sidecar SkillGantry owns and R6.5 forbids it to write.
    expect(manifest.invoke.argv).toContain('--output-dir')
    expect(manifest.invoke.argv).toContain('{toolDir}')
    expect(manifest.artefacts).toEqual([REPORT])
  })
})

describe('skill-up parse', () => {
  it('reports the failing case from a real v1alpha1 report', async () => {
    const bytes = await readFile('tests/fixtures/skill-up/declawed-iteration-1.report.json')
    const result = parse({
      skill,
      artefacts: new Map([[REPORT, bytes]]),
      stdout: '',
      stderr: '',
      exitCode: 1,
      durationMs: 114_000,
    })
    expect(result.outcome).toBe('failed')
    expect(result.findings).toHaveLength(1)
    expect(result.metrics.durationMs).toBe(114_000)
  })

  it('errors when the declared report is absent from the artefact map', () => {
    const result = parse({
      skill,
      artefacts: new Map(),
      stdout: '',
      stderr: '',
      exitCode: 0,
      durationMs: 5,
    })
    expect(result.outcome).toBe('errored')
  })
})
