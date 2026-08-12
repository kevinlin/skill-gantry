import { describe, expect, it } from 'vitest'
import { createQueue, type IssueRow, type SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { layoutFor, screenBodyRows, wrapCells } from '../../src/tui/layout.js'
import { findingDetailRows, issueDetailRows } from '../../src/tui/rows.js'
import { initialState, reducer, type FindingRow } from '../../src/tui/store.js'
import { fakeRun } from '../helpers/fake-run.js'
import { fakeViews } from '../helpers/fake-views.js'
import { renderInk } from '../helpers/render-ink.js'

/** Long enough that the Findings pane cuts it at every supported width. */
const MESSAGE =
  'Instruction block interpolates untrusted issue text verbatim into the prompt, ' +
  'so a crafted issue title reaches the model as instructions rather than as data.'

const finding = (over: Partial<FindingRow['finding']> = {}): FindingRow => ({
  finding: {
    ruleClass: 'injection.untrusted-interpolation',
    nativeRuleId: 'MP2',
    severity: 'high',
    path: 'declawed/SKILL.md',
    line: 58,
    message: MESSAGE,
    ...over,
  },
  stage: 'security',
  toolId: 'skillspector',
  artefactDir: '/Users/me/dev/zapac-agent-skills/declawed-workspace/skillgantry/runs/019f/03-security/skillspector',
})

const issue = (over: Partial<IssueRow> = {}): IssueRow => ({
  fingerprint: 'fp1',
  skillId: 'declawed',
  repoId: 'zapac',
  ruleClass: 'unsafe-script',
  relPath: 'declawed/scripts/scan.py',
  severity: 'low',
  state: 'open',
  occurrenceCount: 3,
  detectors: ['skill-lint', 'skillspector'],
  blockedBy: ['skillspector'],
  lastSeenRun: '019ff63f-f1be-7402-8d75-3eb77b20eaf1',
  lastSeenRunDir: '2026-08-11_17-40-46',
  suppressed: false,
  suppressionReason: null,
  ...over,
})

const skill: SkillRef = {
  id: 'declawed',
  name: 'declawed',
  version: '1.0.0',
  dir: '/repo/declawed',
  relPath: 'declawed',
  repo: { id: 'zapac', path: '/repo', name: 'zapac', isGit: false },
  rootSkill: false,
  frontmatterReadable: true,
  workspacePath: '/repo/declawed-workspace',
  deprecated: false,
  supersededBy: null,
}

function harness(views = fakeViews(), size = { columns: 100, rows: 30 }) {
  const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('run-1').handle })
  const ui = renderInk(
    <App
      skills={[skill]}
      queue={queue}
      stages={['security']}
      concurrency={1}
      views={views}
      intervalMs={20}
    />,
    size,
  )
  return { queue, ui }
}

describe('R11.18 the full-length view', () => {
  // The whole point of the surface: every pane in the tree is bound by an
  // allocation, which is what guarantees it cuts the message.
  it('wraps the finding message instead of truncating it', () => {
    const rows = findingDetailRows(finding(), 60)
    const text = rows.map((row) => row.text).join('\n')
    expect(text).not.toContain('…')
    for (const word of MESSAGE.split(' ')) expect(text).toContain(word)
    expect(text).toContain('MP2')
    expect(text).toContain('security · skillspector')
    expect(text).toContain('declawed/SKILL.md:58')
    // The directory, not a report file — artefact names belong to the adapter.
    expect(text).toContain('03-security/skillspector')
  })

  it('carries the suppression justification whole when there is one', () => {
    const long = 'Alignment whitespace inside a re.VERBOSE block, not context padding, and the '
      + 'scanner has no way to tell the two apart from the token stream alone.'
    const rows = findingDetailRows(
      finding({ suppressed: { justification: long } }),
      50,
    )
    const text = rows.map((row) => row.text).join('\n')
    expect(text).toContain('⊘ Suppressed')
    for (const word of long.split(' ')) expect(text).toContain(word)
  })

  it('spells out the R8.8 blockers the issue row can only glyph', () => {
    const text = issueDetailRows(issue(), 70)
      .map((row) => row.text)
      .join('\n')
    expect(text).toContain('open until skillspector report a conclusive absence')
    expect(text).toContain('3 occurrences')
    expect(text).toContain('detected by skill-lint, skillspector')
    expect(text).toContain('fingerprint fp1')
  })

  // R6.1: the directory says when the sighting was; the run id says nothing a
  // reader can use, and 36 cells of it crowded out the rest of the row.
  it('names the last sighting by its run directory and not by the run id', () => {
    const text = issueDetailRows(issue(), 70)
      .map((row) => row.text)
      .join('\n')
    expect(text).toContain('last seen 2026-08-11_17-40-46')
    expect(text).not.toContain('019ff63f')
  })

  // The one case where the id is all there is. Falling back to it beats a row
  // that reports a sighting and cannot say which run it came from.
  it('falls back to the run id when nothing is left to name the run', () => {
    // Joined with a space, not a newline: the State row wraps, so the id can
    // land on a row of its own.
    const text = issueDetailRows(issue({ lastSeenRunDir: null }), 70)
      .map((row) => row.text)
      .join(' ')
    expect(text).toContain('last seen 019ff63f-f1be-7402-8d75-3eb77b20eaf1')
  })

  it('says so rather than printing null when the issue has never been seen', () => {
    const text = issueDetailRows(issue({ lastSeenRun: null, lastSeenRunDir: null, blockedBy: [] }), 70)
      .map((row) => row.text)
      .join('\n')
    expect(text).toContain('never seen in a run')
    expect(text).not.toContain('null')
  })

  // §14.1: no row may exceed the width it was built at, wrapped or not.
  it('keeps every row inside the width at the two floors', () => {
    for (const width of [76, 46]) {
      for (const row of findingDetailRows(finding(), width)) {
        expect(row.text.length).toBeLessThanOrEqual(width)
      }
      for (const row of issueDetailRows(issue(), width)) {
        expect(row.text.length).toBeLessThanOrEqual(width)
      }
    }
  })

  it('hard-splits a word longer than the width rather than overflowing', () => {
    const lines = wrapCells('a'.repeat(25), 10)
    expect(lines).toEqual(['aaaaaaaaaa', 'aaaaaaaaaa', 'aaaaa'])
  })

  it('opens at the top, so a second finding does not inherit the first scroll', () => {
    let state = initialState([skill], 1)
    state = reducer(state, { type: 'open-detail', detail: { kind: 'finding', row: finding() } })
    state = reducer(state, { type: 'scroll-detail', delta: 3, viewport: 4, total: 20 })
    expect(state.detailOffset).toBe(3)
    state = reducer(state, { type: 'open-detail', detail: { kind: 'issue', row: issue() } })
    expect(state.detailOffset).toBe(0)
    state = reducer(state, { type: 'close-detail' })
    expect(state.detail).toBeNull()
  })

  it('clamps the scroll to the last full window', () => {
    let state = initialState([skill], 1)
    state = reducer(state, { type: 'open-detail', detail: { kind: 'issue', row: issue() } })
    state = reducer(state, { type: 'scroll-detail', delta: 99, viewport: 4, total: 10 })
    expect(state.detailOffset).toBe(6)
    state = reducer(state, { type: 'scroll-detail', delta: -99, viewport: 4, total: 10 })
    expect(state.detailOffset).toBe(0)
  })

  it('fits the terminal at 80x24 and at 50x14', async () => {
    for (const [columns, rows] of [
      [80, 24],
      [50, 14],
    ] as const) {
      const { ui, queue } = harness(fakeViews({ issues: async () => [issue()] }), { columns, rows })
      await ui.settle(60)
      ui.stdin.send('3')
      await ui.settle(60)
      ui.stdin.send('\r')
      await ui.settle(40)
      const lines = ui
        .lastFrame()
        .replace(/\n$/, '')
        .split('\n')
        .map((line) => line.replace(/\x1b\[[0-9;]*m/g, ''))
      expect(lines.length).toBeLessThanOrEqual(rows)
      expect(Math.max(...lines.map((line) => [...line].length))).toBeLessThanOrEqual(columns)
      expect(ui.lastFrame()).toContain('Issue — declawed')
      ui.unmount()
      queue.close()
    }
  })

  it('closes back to the screen it was opened over, with that cursor unmoved', async () => {
    const { ui, queue } = harness(
      fakeViews({ issues: async () => [issue(), issue({ fingerprint: 'fp2' })] }),
      { columns: 160, rows: 30 },
    )
    await ui.settle(60)
    // Open it over the Issues screen, which `esc` would otherwise send to Work.
    ui.stdin.send(':')
    await ui.settle()
    ui.stdin.send('issues')
    await ui.settle()
    ui.stdin.send('\r')
    await ui.settle(60)
    ui.stdin.send('j')
    await ui.settle()
    ui.stdin.send('\r')
    await ui.settle(40)
    expect(ui.lastFrame()).toContain('fingerprint fp2')

    ui.stdin.send('\x1b')
    await ui.settle(40)
    // Back on Issues, not on Work, and still on the second row.
    expect(ui.lastFrame()).toContain('Issues')
    expect(ui.lastFrame()).not.toContain('fingerprint')
    ui.unmount()
    queue.close()
  })

  it('reaches the evidence port from inside, without spawning', async () => {
    const views = fakeViews()
    const { ui, queue } = harness(views, { columns: 120, rows: 30 })
    await ui.settle(60)
    ui.stdin.send('2')
    await ui.settle(40)
    // No run this session and no recorded one, so the pane holds no finding —
    // the reducer is where the row comes from, which is what `o` needs.
    ui.stdin.send('\r')
    await ui.settle(20)
    // The refusal names the run that would produce a finding, not the cursor:
    // all three sites are already gated on the Findings pane, so the pane is
    // open and the list under it is empty.
    expect(ui.lastFrame()).toContain('no findings here · space marks a stage, r runs it')
    ui.unmount()
    queue.close()
  })

  // The scroll path is not decoration: at the smaller floor a wrapped message
  // outgrows the pane, which is the case the clamp and the overflow notice
  // exist for. Asserted against `layoutFor` rather than a rendered frame, so a
  // later change to what the chrome costs moves the arithmetic and not the rule.
  it('outgrows its allocation at 50x14, where the scroll has to work', () => {
    expect(findingDetailRows(finding(), 46).length).toBeGreaterThan(
      screenBodyRows(layoutFor(50, 14)),
    )
    // And fits without scrolling at the wider floor, so the notice is not
    // permanent furniture.
    expect(findingDetailRows(finding(), 76).length).toBeLessThanOrEqual(
      screenBodyRows(layoutFor(80, 24)),
    )
  })
})
