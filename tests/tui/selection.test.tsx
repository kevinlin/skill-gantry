import { describe, expect, it } from 'vitest'
import { padCells } from '../../src/tui/layout.js'
import { issueRows } from '../../src/tui/rows.js'
import type { IssueRow } from '../../src/core/index.js'

const issue = (over: Partial<IssueRow> = {}): IssueRow => ({
  fingerprint: 'fp1',
  skillId: 'declawed',
  repoId: 'zapac',
  ruleClass: 'unsafe-script',
  relPath: 'declawed/scripts/scan.py',
  severity: 'low',
  state: 'open',
  occurrenceCount: 1,
  detectors: ['skill-lint'],
  blockedBy: [],
  lastSeenRun: 'run1',
  suppressed: false,
  suppressionReason: null,
  ...over,
})

describe('R11.15 selected row', () => {
  it('pads the selected row to the full width so the band is not ragged', () => {
    const rows = issueRows([issue(), issue({ fingerprint: 'fp2' })], 0, 90)
    // Ink's `inverse` covers only the characters rendered, so an unpadded short
    // row highlights a stub. SkillList's own comment records that failure.
    expect(rows[0]?.text.length).toBe(90)
    expect(rows[0]?.selected).toBe(true)
    // The unselected row is not padded: it carries no attribute to stretch.
    expect(rows[1]?.text.length).toBeLessThan(90)
    expect(rows[1]?.selected).toBe(false)
  })

  it('pads by cells, not code units, so a wide character cannot overflow', () => {
    const rows = issueRows([issue({ skillId: '日本語スキル' })], 0, 90)
    // padCells measures through string-width; padEnd would have counted units
    // and left the row half the column it needed.
    expect(padCells(rows[0]?.text ?? '', 90).length).toBe(rows[0]?.text.length)
  })
})
