import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { manifest, parse } from '../../src/core/adapters/skill-scanner.js'
import { credentialsSatisfied, missingCredentials } from '../../src/core/adapters/types.js'
import { zapacSkill } from '../helpers/skill-ref.js'

const skill = zapacSkill('insight-profile')

describe('skill-scanner manifest', () => {
  it('declares LLM mode and the credential sets that mode actually accepts', () => {
    expect(manifest.analysisMode).toBe('llm')
    expect(manifest.credentials.kind).toBe('one-of')
    // --no-ai --no-vt prints "No analyzers enabled for scan" and writes no
    // report, so there is no offline mode to fall back to. A mode change would
    // be a new adapter id.
    expect(manifest.invoke.argv).toContain('--no-vt')
    expect(manifest.invoke.argv).not.toContain('--no-ai')
  })

  it('is unsatisfied without a model, which the tool requires explicitly', () => {
    expect(credentialsSatisfied(manifest.credentials, {})).toBe(false)
    expect(credentialsSatisfied(manifest.credentials, { SKILLSCAN_API_KEY: 'k' })).toBe(false)
    expect(
      credentialsSatisfied(manifest.credentials, { SKILLSCAN_API_KEY: 'k', SKILLSCAN_MODEL: 'm' }),
    ).toBe(true)
    expect(
      credentialsSatisfied(manifest.credentials, { SKILLSCAN_BASE_URL: 'u', SKILLSCAN_MODEL: 'm' }),
    ).toBe(true)
    expect(missingCredentials(manifest.credentials)).toMatch(/SKILLSCAN_MODEL/)
  })
})

describe('skill-scanner parse', () => {
  it('parses its captured SARIF into repo-relative findings', async () => {
    const bytes = await readFile('tests/fixtures/sarif/skill-scanner-insight-profile.sarif')
    const result = parse({
      skill,
      artefacts: new Map([['findings.sarif', bytes]]),
      stdout: '',
      stderr: '',
      exitCode: 0,
      durationMs: 40_000,
    })

    expect(result.outcome).toBe('failed')
    for (const f of result.findings) {
      expect(f.path.startsWith('insight-profile/')).toBe(true)
    }
    // The capture: two credential_leak, one command_execution, one
    // indirect_injection. LLM findings are nondeterministic, so this asserts
    // what the parser does with these bytes, never that a re-run reproduces them.
    expect(result.findings).toHaveLength(4)
    expect(result.findings.every((f) => !f.ruleClass.startsWith('unmapped:'))).toBe(true)
    expect(new Set(result.findings.map((f) => f.ruleClass))).toEqual(
      new Set(['credential-access', 'unsafe-script', 'prompt-injection']),
    )
    // Two findings of one class on two different paths are two issues, so the
    // rebasing has to survive intact.
    expect(
      result.findings.filter((f) => f.ruleClass === 'credential-access').map((f) => f.path).sort(),
    ).toEqual(['insight-profile/SKILL.md', 'insight-profile/scripts/capture.mjs'])
    expect(result.metrics.durationMs).toBe(40_000)
  })

  it('errors when the declared SARIF is absent', () => {
    const result = parse({
      skill,
      artefacts: new Map(),
      stdout: '',
      stderr: '',
      exitCode: 2,
      durationMs: 10,
    })
    expect(result.outcome).toBe('errored')
  })
})
