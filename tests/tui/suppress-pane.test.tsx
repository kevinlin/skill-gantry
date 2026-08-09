import { describe, expect, it } from 'vitest'
import { SuppressPane } from '../../src/tui/components/SuppressPane.js'
import { layoutFor } from '../../src/tui/layout.js'
import type { SuppressSlot } from '../../src/tui/store.js'
import { renderInk } from '../helpers/render-ink.js'

const slot: SuppressSlot = {
  request: {
    kind: 'finding',
    skillId: 'fx/declawed',
    toolId: 'skillspector',
    nativeRuleId: 'MP2',
    relPath: 'declawed/scripts/scan.py',
    reason: '',
  },
  label: 'declawed/.skillspector-baseline.yaml',
  toolId: 'skillspector',
  relPath: 'declawed/scripts/scan.py',
  // `unifiedDiffFor`'s shape: the headers carry the file the rename lands on,
  // which is why the title names the *finding* rather than repeating it.
  diff: [
    '--- a/declawed/.skillspector-baseline.yaml',
    '+++ b/declawed/.skillspector-baseline.yaml',
    '@@ -3,2 +3,6 @@',
    ' rules:',
    '+- id: MP2',
    '+  path: scripts/scan.py',
  ].join('\n'),
  offset: 0,
  reason: 'alignment whitespace',
  editingReason: false,
  uncovered: [],
  thenRun: 'resume',
  stages: ['validate', 'security'],
  error: null,
}

describe('SuppressPane', () => {
  it('names the tool and the file in its title', () => {
    const { lastFrame } = renderInk(<SuppressPane suppress={slot} layout={layoutFor(80, 24)} />)
    expect(lastFrame()).toContain('skillspector')
    expect(lastFrame()).toContain('.skillspector-baseline.yaml')
  })

  it('renders the diff and the reason row', () => {
    const { lastFrame } = renderInk(<SuppressPane suppress={slot} layout={layoutFor(80, 24)} />)
    expect(lastFrame()).toContain('id: MP2')
    expect(lastFrame()).toContain('alignment whitespace')
  })

  it('names an uncovered detector only when there is one', () => {
    const clean = renderInk(<SuppressPane suppress={slot} layout={layoutFor(80, 24)} />)
    expect(clean.lastFrame()).not.toContain('declares no baseline')
    const dirty = renderInk(
      <SuppressPane
        suppress={{ ...slot, uncovered: ['skill-scanner'] }}
        layout={layoutFor(80, 24)}
      />,
    )
    expect(dirty.lastFrame()).toContain('skill-scanner')
    expect(dirty.lastFrame()).toContain('declares no baseline')
  })

  // R11.17. Resolved and not the toggle's label: "resume" already covers all
  // three gates when validate is the failure, and the warning would then lie.
  it('warns about stale gates only when the resolved set misses one', () => {
    const partial = renderInk(<SuppressPane suppress={slot} layout={layoutFor(80, 24)} />)
    expect(partial.lastFrame()).toContain('previous bytes')
    const full = renderInk(
      <SuppressPane
        suppress={{ ...slot, stages: ['validate', 'evaluate', 'security'] }}
        layout={layoutFor(80, 24)}
      />,
    )
    expect(full.lastFrame()).not.toContain('previous bytes')
  })

  it('lists the resolved stages, and says nothing when the toggle is off', () => {
    const on = renderInk(<SuppressPane suppress={slot} layout={layoutFor(80, 24)} />)
    expect(on.lastFrame()).toContain('then run: validate, security')
    const off = renderInk(
      <SuppressPane suppress={{ ...slot, thenRun: 'none' }} layout={layoutFor(80, 24)} />,
    )
    expect(off.lastFrame()).toContain('then run: nothing')
  })

  it('stays inside the terminal at 80x24 and at the 50x14 floor', () => {
    const wide = renderInk(<SuppressPane suppress={slot} layout={layoutFor(80, 24)} />, {
      columns: 80,
      rows: 24,
    })
    expect(wide.lastFrame().replace(/\n$/, '').split('\n').length).toBeLessThanOrEqual(24)
    const floor = renderInk(<SuppressPane suppress={slot} layout={layoutFor(50, 14)} />, {
      columns: 50,
      rows: 14,
    })
    expect(floor.lastFrame().replace(/\n$/, '').split('\n').length).toBeLessThanOrEqual(14)
  })
})
