import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { manifest, parse } from '../../src/core/adapters/skill-lint.js'
import type { SkillRef } from '../../src/core/types.js'

const skill = (relPath: string): SkillRef => ({
  id: `zapac/${relPath}`,
  name: relPath,
  version: null,
  dir: `/tmp/zapac/${relPath}`,
  relPath,
  repo: { id: 'zapac', path: '/tmp/zapac', name: 'zapac', isGit: true },
  rootSkill: false,
  workspacePath: `/tmp/zapac/${relPath}-workspace`,
})

const ctx = (stdout: string, relPath: string, exitCode: number) => ({
  skill: skill(relPath),
  artefacts: new Map<string, Buffer>(),
  stdout,
  stderr: '',
  exitCode,
  durationMs: 120,
})

describe('skill-lint manifest', () => {
  it('declares no artefact, because the report is on stdout', () => {
    expect(manifest.artefacts).toEqual([])
    expect(manifest.invoke.argv).toEqual(['{skillDir}', '--json'])
    expect(manifest.stage).toBe('validate')
    expect(manifest.policy).toBe('fan-out')
    expect(manifest.credentials).toEqual({ kind: 'none' })
  })
})

describe('skill-lint parse', () => {
  it('rebases findings onto the repo-relative path and classifies them', async () => {
    const stdout = await readFile('tests/fixtures/skill-lint/architecture-diagram.json', 'utf8')
    const result = parse(ctx(stdout, 'architecture-diagram', 0))

    expect(result.outcome).toBe('failed')
    expect(result.findings.map((f) => [f.path, f.ruleClass])).toEqual([
      ['architecture-diagram/scripts/build_gallery.py', 'unsafe-script'],
      ['architecture-diagram/scripts/html_to_png.py', 'unsafe-script'],
    ])
    expect(result.findings.every((f) => f.line === undefined)).toBe(true)
    expect(result.metrics.findingsTotal).toBe(2)
    expect(result.metrics.filesScanned).toBeGreaterThan(0)
  })

  it('takes severity from the finding, not from the rule id', async () => {
    const stdout = await readFile('tests/fixtures/skill-lint/zuhlke-slides.json', 'utf8')
    const result = parse(ctx(stdout, 'zuhlke-slides', 2))
    const r06 = result.findings.filter((f) => f.nativeRuleId === 'R06')
    // One rule id, two severities: HIGH for a .pyc, LOW for a bundled .py.
    expect(new Set(r06.map((f) => f.severity))).toEqual(new Set(['high', 'low']))
    expect(result.findings.some((f) => f.ruleClass === 'metadata-invalid')).toBe(true)
  })

  it('passes on a clean report even when the exit code is non-zero', () => {
    const clean = JSON.stringify({
      tool: 'skill-lint', schemaVersion: 1, skill: { files: [] },
      findings: [], verdict: { label: 'WARN', score: 0, exitCode: 1 },
    })
    // Row 11 of the R4.13 table: the parse is authoritative, the exit code is
    // fallback evidence only.
    expect(parse(ctx(clean, 'a', 1)).outcome).toBe('passed')
  })

  it('errors on stdout that is not JSON', () => {
    const result = parse(ctx('Usage: skill-lint <path>\n', 'a', 3))
    expect(result.outcome).toBe('errored')
    expect(result.summary).toMatch(/not JSON/)
  })

  it('errors on an unexpected schema version rather than guessing', () => {
    const future = JSON.stringify({ tool: 'skill-lint', schemaVersion: 2, findings: [] })
    const result = parse(ctx(future, 'a', 0))
    expect(result.outcome).toBe('errored')
    expect(result.summary).toMatch(/schemaVersion/)
  })
})
