import { describe, expect, it } from 'vitest'
import { checkPreconditions } from '../../src/core/release/preconditions.js'
import type { PreconditionInput } from '../../src/core/release/preconditions.js'

const DIGEST = 'sha256:aaa'

const base: PreconditionInput = {
  gates: [
    { stage: 'validate', outcome: 'passed', skillDigest: DIGEST, runId: 'r1', sidecarPath: '/s' },
    { stage: 'evaluate', outcome: 'passed', skillDigest: DIGEST, runId: 'r1', sidecarPath: '/s' },
    { stage: 'security', outcome: 'passed', skillDigest: DIGEST, runId: 'r1', sidecarPath: '/s' },
  ],
  currentDigest: DIGEST,
  deprecated: false,
  frontmatterVersion: '1.0.0',
  manifestVersion: '1.0.0',
  hasManifest: true,
  interrupted: false,
}

const codes = (over: Partial<PreconditionInput>): string[] =>
  checkPreconditions({ ...base, ...over }).map((r) => r.code)

describe('checkPreconditions', () => {
  it('permits a skill whose three gates passed against the current bytes', () => {
    expect(checkPreconditions(base)).toEqual([])
  })

  it('refuses a deprecated skill — R1.4', () => {
    expect(codes({ deprecated: true })).toContain('deprecated')
  })

  it('refuses a gate that never ran', () => {
    expect(codes({ gates: base.gates.slice(0, 2) })).toContain('gate-missing')
  })

  it.each(['failed', 'degraded', 'errored', 'skipped'])('refuses a %s gate', (outcome) => {
    const gates = [{ ...base.gates[0]!, outcome }, ...base.gates.slice(1)]
    expect(codes({ gates })).toContain('gate-not-passed')
  })

  it('refuses when a gate ran against different bytes — R9.9', () => {
    const gates = [{ ...base.gates[0]!, skillDigest: 'sha256:stale' }, ...base.gates.slice(1)]
    expect(codes({ gates })).toContain('digest-mismatch')
  })

  it('refuses when the two versions already disagree, reporting both — R9.2', () => {
    const refusals = checkPreconditions({ ...base, manifestVersion: '0.9.0' })
    expect(refusals.map((r) => r.code)).toContain('version-disagreement')
    expect(refusals[0]?.message).toContain('1.0.0')
    expect(refusals[0]?.message).toContain('0.9.0')
  })

  it('permits the no-manifest case, which is every skill in ~/.claude/skills', () => {
    expect(codes({ hasManifest: false, manifestVersion: null })).toEqual([])
  })

  it('refuses while an interrupted mutation is unresolved', () => {
    expect(codes({ interrupted: true })).toContain('interrupted-mutation')
  })

  it('reports every refusal at once rather than the first', () => {
    expect(codes({ deprecated: true, gates: [] }).sort()).toEqual([
      'deprecated',
      'gate-missing',
      'gate-missing',
      'gate-missing',
    ])
  })
})
