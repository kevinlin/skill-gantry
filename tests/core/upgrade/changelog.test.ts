import { describe, expect, it } from 'vitest'
import { entriesAbove, parseChangelog } from '../../../src/core/index.js'

const DOC = `# Changelog

## 0.6.0 — 2026-08-14
- feat(tui): two-level repo and skill navigation
- fix(core): reproduce the candidate manifest

## 0.5.1 — 2026-08-10
- fix(specs,tui): state the revision the body reached

## 0.5.0 — 2026-08-10
`

describe('parseChangelog', () => {
  it('splits on version headings and keeps each body', () => {
    const entries = parseChangelog(DOC)
    expect(entries.map((e) => e.version)).toEqual(['0.6.0', '0.5.1', '0.5.0'])
    expect(entries[0]?.lines).toEqual([
      'feat(tui): two-level repo and skill navigation',
      'fix(core): reproduce the candidate manifest',
    ])
  })

  // A version with nothing under it is a real state — 0.5.0 above — and must
  // parse to an empty body rather than swallowing the next section.
  it('yields an empty body for a section with no bullets', () => {
    expect(parseChangelog(DOC)[2]).toEqual({ version: '0.5.0', lines: [] })
  })

  it('ignores headings that are not versions', () => {
    expect(parseChangelog('# Changelog\n\n## Unreleased\n- x\n')).toEqual([])
  })
})

describe('entriesAbove', () => {
  it('keeps only versions strictly greater than the running one', () => {
    expect(entriesAbove(parseChangelog(DOC), '0.5.1').map((e) => e.version)).toEqual(['0.6.0'])
  })

  it('spans every intervening version', () => {
    expect(entriesAbove(parseChangelog(DOC), '0.4.9').map((e) => e.version)).toEqual([
      '0.6.0',
      '0.5.1',
      '0.5.0',
    ])
  })

  it('returns nothing when the running version is the newest', () => {
    expect(entriesAbove(parseChangelog(DOC), '0.6.0')).toEqual([])
  })
})
