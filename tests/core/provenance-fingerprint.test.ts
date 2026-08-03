import { describe, expect, it } from 'vitest'
import { provenanceFingerprint } from '../../src/core/ledger/fingerprint.js'

const base = {
  baseUrlHost: 'api.deepseek.com',
  models: { ANTHROPIC_MODEL: 'a', ANTHROPIC_DEFAULT_OPUS_MODEL: 'b' },
  authTokenHash: 'sha256:1a2b3c4d',
  analysisModes: { skillspector: 'static' },
}

describe('provenanceFingerprint', () => {
  it('is stable across key insertion order', () => {
    const reordered = {
      analysisModes: { skillspector: 'static' },
      authTokenHash: 'sha256:1a2b3c4d',
      models: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'b', ANTHROPIC_MODEL: 'a' },
      baseUrlHost: 'api.deepseek.com',
    }
    expect(provenanceFingerprint(reordered)).toBe(provenanceFingerprint(base))
  })

  it('changes when a model mapping changes', () => {
    const other = { ...base, models: { ...base.models, ANTHROPIC_MODEL: 'z' } }
    expect(provenanceFingerprint(other)).not.toBe(provenanceFingerprint(base))
  })

  it('changes when a tool changes analysis mode — R4.2b', () => {
    const other = { ...base, analysisModes: { skillspector: 'llm' } }
    expect(provenanceFingerprint(other)).not.toBe(provenanceFingerprint(base))
  })

  it('tolerates an absent field, so an older stored provenance still hashes', () => {
    expect(provenanceFingerprint({}).length).toBe(12)
  })
})
