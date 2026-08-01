import { describe, expect, it } from 'vitest'
import { fingerprint } from '../../src/core/ledger/fingerprint.js'

describe('fingerprint', () => {
  it('is a stable 12-character hex identifier', () => {
    const fp = fingerprint('fx/declawed', 'declawed/SKILL.md', 'credential-access')
    expect(fp).toMatch(/^[0-9a-f]{12}$/)
    expect(fp).toBe(fingerprint('fx/declawed', 'declawed/SKILL.md', 'credential-access'))
  })

  it('merges two tools reporting the same class in the same file', () => {
    // Neither the tool id nor the message participates, so detections collapse.
    expect(fingerprint('fx/d', 'd/SKILL.md', 'prompt-injection')).toBe(
      fingerprint('fx/d', 'd/SKILL.md', 'prompt-injection'),
    )
  })

  it('separates different rule classes in one file', () => {
    expect(fingerprint('fx/d', 'd/SKILL.md', 'prompt-injection')).not.toBe(
      fingerprint('fx/d', 'd/SKILL.md', 'credential-access'),
    )
  })

  it('separates the same class in different files', () => {
    expect(fingerprint('fx/d', 'd/a.py', 'unsafe-script')).not.toBe(
      fingerprint('fx/d', 'd/b.py', 'unsafe-script'),
    )
  })

  it('separates the same class in different skills', () => {
    expect(fingerprint('fx/a', 'a/SKILL.md', 'unsafe-script')).not.toBe(
      fingerprint('fx/b', 'b/SKILL.md', 'unsafe-script'),
    )
  })

  it('never merges unmapped classes across tools', () => {
    expect(fingerprint('fx/d', 'd/SKILL.md', 'unmapped:skillspector:X1')).not.toBe(
      fingerprint('fx/d', 'd/SKILL.md', 'unmapped:skill-scanner:X1'),
    )
  })

  it('normalises windows separators before hashing', () => {
    expect(fingerprint('fx/d', 'd\\scripts\\scan.py', 'unsafe-script')).toBe(
      fingerprint('fx/d', 'd/scripts/scan.py', 'unsafe-script'),
    )
  })
})
