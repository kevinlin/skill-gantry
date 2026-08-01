import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { manifest, parse } from '../../src/core/adapters/skillspector.js'
import type { SkillRef } from '../../src/core/types.js'

const skill = {
  id: 'zapac/declawed',
  relPath: 'declawed',
  dir: '/repo/declawed',
} as unknown as SkillRef

const fixture = async (): Promise<Buffer> =>
  readFile(join(process.cwd(), 'tests/fixtures/sarif/skillspector-declawed.sarif'))

const ctx = async (): Promise<Parameters<typeof parse>[0]> => ({
  skill,
  artefacts: new Map([['findings.sarif', await fixture()]]),
  stdout: 'Report saved to: findings.sarif\n',
  stderr: '',
  exitCode: 0,
  durationMs: 1200,
})

describe('skillspector manifest', () => {
  it('passes --no-llm so the tool never needs an API key', () => {
    expect(manifest.invoke.argv).toContain('--no-llm')
    expect(manifest.credentials.kind).toBe('none')
  })

  it('is pinned to the version the fixture was captured from', () => {
    expect(manifest.install.pin).toBe('v2.5.1')
  })

  it('fans out and is read-only', () => {
    expect(manifest.policy).toBe('fan-out')
    expect(manifest.mutating).toBe(false)
    expect(manifest.stage).toBe('security')
  })

  it('declares the artefact its argv writes', () => {
    expect(manifest.artefacts).toEqual(['findings.sarif'])
    expect(manifest.invoke.argv.join(' ')).toContain('{toolDir}/findings.sarif')
  })

  it('declares a reconciliation scope covering what it detects', () => {
    expect(manifest.detects).toContain('excessive-permission')
    expect(manifest.detects).toContain('prompt-injection')
  })

  it('declares static mode with no credential, matching its argv', () => {
    expect(manifest.analysisMode).toBe('static')
    expect(manifest.credentials).toEqual({ kind: 'none' })
    expect(manifest.invoke.argv).toContain('--no-llm')
  })

  it('claims no class that only LLM analysis reaches', () => {
    expect(manifest.detects).not.toContain('vulnerable-dep')
  })
})

describe('skillspector parse', () => {
  it('fails the gate with the two real findings', async () => {
    const out = parse(await ctx())
    expect(out.outcome).toBe('failed')
    expect(out.findings).toHaveLength(2)
  })

  it('rebases both real paths onto the skill directory', async () => {
    const paths = parse(await ctx())
      .findings.map((f) => f.path)
      .sort()
    expect(paths).toEqual(['declawed/SKILL.md', 'declawed/scripts/scan.py'])
  })

  it('does not use the exit code to decide the verdict', async () => {
    // The real tool exits 0 with findings present.
    const out = parse({ ...(await ctx()), exitCode: 0 })
    expect(out.outcome).toBe('failed')
  })

  it('errors when the declared artefact is absent', async () => {
    const out = parse({ ...(await ctx()), artefacts: new Map() })
    expect(out.outcome).toBe('errored')
    expect(out.summary).toMatch(/findings\.sarif/)
  })
})
