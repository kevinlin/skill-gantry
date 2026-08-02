import { describe, expect, it } from 'vitest'
import { prependChangelogEntry } from '../../src/core/release/changelog.js'

describe('prependChangelogEntry', () => {
  it('creates a file with a heading when none exists', () => {
    const out = prependChangelogEntry('', '1.1.0', '2026-08-03')
    expect(out.startsWith('# Changelog\n')).toBe(true)
    expect(out).toContain('## 1.1.0 — 2026-08-03')
  })

  it('inserts under an existing heading, above the previous entry', () => {
    const existing = '# Changelog\n\n## 1.0.0 — 2026-01-01\n\n- first\n'
    const out = prependChangelogEntry(existing, '1.1.0', '2026-08-03')
    expect(out.indexOf('## 1.1.0')).toBeLessThan(out.indexOf('## 1.0.0'))
    expect(out).toContain('- first')
  })

  it('leaves exactly one blank line between the new entry and the one before it', () => {
    const existing = '# Changelog\n\n## 1.0.0 — 2026-01-01\n\n- first\n'
    const out = prependChangelogEntry(existing, '1.1.0', '2026-08-03')
    // Exact text: a naive splice leaves three newlines here (one from the
    // entry's own trailing blank, one re-added at the join, one already on
    // the tail), which is invisible in a `toContain` check but grows by a
    // line every release.
    expect(out).toBe(
      '# Changelog\n\n## 1.1.0 — 2026-08-03\n\n## 1.0.0 — 2026-01-01\n\n- first\n',
    )
  })

  it('carries notes under the new heading', () => {
    const out = prependChangelogEntry('', '1.1.0', '2026-08-03', '- fixed the thing')
    expect(out).toContain('## 1.1.0 — 2026-08-03\n\n- fixed the thing\n')
  })

  it('refuses to add a version the changelog already names', () => {
    const existing = '# Changelog\n\n## 1.1.0 — 2026-01-01\n'
    expect(() => prependChangelogEntry(existing, '1.1.0', '2026-08-03')).toThrow(
      'changelog already has an entry for 1.1.0',
    )
  })
})
