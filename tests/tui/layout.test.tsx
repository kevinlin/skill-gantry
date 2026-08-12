import { readFile } from 'node:fs/promises'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import {
  VERSION,
  initialSetupState,
  type JobRecord,
} from '../../src/core/index.js'
import { Setup } from '../../src/tui/components/Setup.js'
import { StatusBar } from '../../src/tui/components/StatusBar.js'
import { Work } from '../../src/tui/components/Work.js'
import { MIN_COLUMNS, MIN_ROWS, layoutFor, truncate, windowFor } from '../../src/tui/layout.js'
import { initialState, type AppState } from '../../src/tui/store.js'
import { renderInk } from '../helpers/render-ink.js'
import { App } from '../../src/tui/app.js'
import { createQueue } from '../../src/core/index.js'
import { fakeRun } from '../helpers/fake-run.js'
import {
  emptyDashboard,
  emptySettings,
  fakeSetupDriver,
  fakeViews,
  toolFinding,
} from '../helpers/fake-views.js'
import { skillRef } from '../helpers/skill-ref.js'

function frameAt(node: ReactElement, columns: number, rows: number): string {
  const harness = renderInk(node, { columns, rows })
  const frame = harness.lastFrame()
  harness.unmount()
  return frame
}

const NAMES = [
  'declawed',
  'gap-analysis',
  'spec-lint',
  'zuhlke-slides-and-decks-generator',
  'rfp-daily',
  'agent-insights',
  'architecture-diagram',
]

function busyState(): AppState {
  const base = initialState(NAMES.map((id) => skillRef(id)), 2)
  const jobs: JobRecord[] = [
    { jobId: 'j1', skillId: 'declawed', stages: ['validate', 'security'], state: 'running' },
    { jobId: 'j2', skillId: 'spec-lint', stages: ['validate'], state: 'queued' },
    { jobId: 'j3', skillId: 'rfp-daily', stages: ['security'], state: 'queued' },
  ] as JobRecord[]
  return {
    ...base,
    jobs,
    log: {
      lines: Array.from({ length: 30 }, (_, i) => `skillspector: scanning declawed/scripts/f${i}.py`),
      dropped: 0,
    },
  }
}

/** The size the frame must never exceed, whatever the content. */
function measure(frame: string): { rows: number; columns: number } {
  const lines = frame.replace(/\n$/, '').split('\n')
  const bare = lines.map((line) => line.replace(/\[[0-9;]*m/g, ''))
  return { rows: bare.length, columns: Math.max(...bare.map((l) => [...l].length)) }
}

describe('layoutFor', () => {
  it('refuses to render below the floor rather than shredding the frame', () => {
    expect(layoutFor(MIN_COLUMNS - 1, 40).mode).toBe('too-small')
    expect(layoutFor(120, MIN_ROWS - 1).mode).toBe('too-small')
    expect(layoutFor(MIN_COLUMNS, MIN_ROWS).mode).not.toBe('too-small')
  })

  it('stacks the skill list above the rail below 76 columns', () => {
    expect(layoutFor(75, 30).skillListWidth).toBe(0)
    expect(layoutFor(76, 30).skillListWidth).toBeGreaterThan(0)
  })

  it('spends a wide terminal on the skill column, up to a cap', () => {
    expect(layoutFor(110, 30).skillListWidth).toBe(26)
    expect(layoutFor(160, 30).skillListWidth).toBe(28)
    // Past the cap the extra width goes to the pane, not to the list.
    expect(layoutFor(240, 30).skillListWidth).toBe(34)
    expect(layoutFor(400, 30).skillListWidth).toBe(34)
  })

  it('shortens stage labels only once the rail cannot hold full ones', () => {
    expect(layoutFor(120, 30).stageLabels).toBe('full')
    expect(layoutFor(80, 24).stageLabels).toBe('full')
    expect(layoutFor(52, 24).stageLabels).toBe('short')
  })

  it('grows the output pane with the terminal instead of pinning it at 12', () => {
    expect(layoutFor(120, 50).outputHeight).toBeGreaterThan(layoutFor(120, 24).outputHeight)
  })
})

describe('truncate', () => {
  it('reserves a cell for the ellipsis', () => {
    expect(truncate('abcdefgh', 5)).toBe('abcd…')
    expect(truncate('abc', 5)).toBe('abc')
    expect(truncate('abc', 0)).toBe('')
  })

  it('measures cells, not code units, so a CJK name cannot overflow', () => {
    // Four ideographs are eight cells wide; .length would have called it four.
    expect([...truncate('日本語表示', 6)].length).toBeLessThanOrEqual(3)
    expect(truncate('日本語表示', 6).endsWith('…')).toBe(true)
  })
})

describe('windowFor', () => {
  it('keeps the selection inside the window', () => {
    for (const selected of [0, 5, 9, 19]) {
      const { start, end } = windowFor(20, selected, 6)
      expect(selected).toBeGreaterThanOrEqual(start)
      expect(selected).toBeLessThan(end)
      expect(end - start).toBe(6)
    }
  })

  it('shows everything when it fits', () => {
    expect(windowFor(3, 0, 10)).toEqual({ start: 0, end: 3 })
  })
})

describe('Work screen fits its terminal', () => {
  for (const [columns, rows] of [
    [200, 60],
    [120, 40],
    [100, 30],
    [80, 24],
    [60, 20],
    [50, 14],
  ] as const) {
    it(`fits ${columns}x${rows}`, () => {
      const size = measure(frameAt(<Work state={busyState()} />, columns, rows))
      expect(size.rows).toBeLessThanOrEqual(rows)
      expect(size.columns).toBeLessThanOrEqual(columns)
    })

    it(`fits the help screen at ${columns}x${rows}`, () => {
      const state = { ...busyState(), help: true }
      const size = measure(frameAt(<Work state={state} />, columns, rows))
      expect(size.rows).toBeLessThanOrEqual(rows)
      expect(size.columns).toBeLessThanOrEqual(columns)
    })
  }

  it('says so below the floor instead of rendering a broken frame', () => {
    const frame = frameAt(<Work state={busyState()} />, 40, 10)
    expect(frame).toContain('Terminal too small')
    expect(frame).toContain('50×14')
  })

  it('truncates a long skill name instead of spilling past the column', () => {
    const frame = frameAt(<Work state={busyState()} />, 100, 30)
    expect(frame).not.toContain('zuhlke-slides-and-decks-generator')
    expect(frame).toContain('…')
  })

  it('windows a skill list longer than its pane and says how many are hidden', () => {
    const state = { ...busyState(), skills: initialState(NAMES.map((id) => skillRef(id)), 2).skills }
    const frame = frameAt(<Work state={state} />, 80, 16)
    expect(frame).toMatch(/\+\d+ more/)
  })
})

describe('the status bar', () => {
  const versionLine = (frame: string): string =>
    frame
      .replace(/\n$/, '')
      .split('\n')
      .map((line) => line.replace(/\[[0-9;]*m/g, ''))
      .at(-1) as string

  it('carries the version beside the keys, on the row the keys already had', () => {
    const line = versionLine(frameAt(<Work state={busyState()} />, 80, 24))
    expect(line).toContain('? help')
    expect(line.trimEnd().endsWith(`v${VERSION}`)).toBe(true)
  })

  it('reports the packed version rather than a literal that can drift', async () => {
    const pkg = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string }
    expect(VERSION).toBe(pkg.version)
  })

  it('shows it on the help and review screens too', () => {
    const help = versionLine(frameAt(<Work state={{ ...busyState(), help: true }} />, 80, 24))
    expect(help).toContain(`v${VERSION}`)
  })

  it('drops the version rather than truncating the keys', () => {
    const hints = 'j/k move · q quit'
    const wide = versionLine(frameAt(<StatusBar hints={hints} columns={40} />, 40, 5))
    expect(wide).toContain(hints)
    expect(wide).toContain(`v${VERSION}`)
    // One cell short of holding both: the keys survive whole, the version goes.
    const tight = hints.length + VERSION.length + 1
    const narrow = versionLine(frameAt(<StatusBar hints={hints} columns={tight} />, tight, 5))
    expect(narrow).toContain(hints)
    expect(narrow).not.toContain(VERSION)
  })
})

/** More rows than any terminal below can show: a budget only holds where there
    is overflow to truncate. */
const BUSY_VIEWS = () =>
  fakeViews({
    dashboard: async () => ({
      ...emptyDashboard,
      repos: 2,
      skills: 3,
      runs: 30,
      stagePassRates: [{ stage: 'validate' as const, runs: 30, passed: 20, rate: 0.667 }],
      wallClock: [{ stage: 'validate' as const, runs: 30, medianMs: 2_500, maxMs: 90_000 }],
      evalCases: { casesTotal: 60, casesPassed: 41, casesErrored: 2, rate: 41 / 60 },
      openBySeverity: [{ severity: 'high' as const, count: 12 }],
      openByRuleClass: Array.from({ length: 8 }, (_, i) => ({
        ruleClass: `rule-class-number-${i}`,
        count: i + 1,
      })),
      history: Array.from({ length: 30 }, (_, i) => ({
        runId: `019283af-0000-7000-8000-0000000000${String(i).padStart(2, '0')}`,
        skillId: 'alpha/a-rather-long-skill-identifier',
        repoId: 'alpha',
        outcome: 'passed',
        startedAt: '2026-08-03T10:00:00.000Z',
        endedAt: '2026-08-03T10:01:00.000Z',
        provenanceFp: 'abc123abc123',
      })),
    }),
    issues: async () =>
      Array.from({ length: 40 }, (_, i) => ({
        fingerprint: `fp${String(i).padStart(10, '0')}`,
        skillId: 'alpha/a-rather-long-skill-identifier',
        repoId: 'alpha',
        ruleClass: 'prompt-injection',
        relPath: `declawed/scripts/a-fairly-long-path-${i}.py`,
        severity: 'high' as const,
        state: 'open' as const,
        occurrenceCount: 2,
        detectors: ['skillspector', 'skill-scanner'],
        blockedBy: ['skill-scanner'],
        lastSeenRun: '019283af-0000-7000-8000-000000000001',
        lastSeenRunDir: '2026-08-11_17-40-46',
      })),
    tools: async () => ({
      runtimes: [
        {
          runtime: 'uv' as const,
          present: false,
          version: null,
          installCommand: 'curl -LsSf https://astral.sh/uv/install.sh | sh',
        },
      ],
      tools: Array.from({ length: 12 }, (_, i) =>
        toolFinding(`tool-number-${i}`, 'version-drift', 'locked 0.4.0, reports 0.5.0'),
      ),
      lifecycle: Array.from({ length: 4 }, (_, i) => ({
        skillId: `alpha/skill-${i}`,
        file: 'deprecated' as const,
        ledger: 'active' as const,
      })),
      skills: Array.from({ length: 3 }, (_, i) => ({
        skillId: `alpha/unreadable-skill-${i}`,
        kind: 'frontmatter-unreadable' as const,
        detail: 'name and version unavailable',
      })),
      failed: true,
    }),
    settings: async () => ({
      ...emptySettings,
      concurrency: 4,
      config: {
        ...emptySettings.config,
        concurrency: 4,
        repos: Array.from({ length: 6 }, (_, i) => ({
          id: `repo-${i}`,
          name: `repo-${i}`,
          path: `/Users/someone/dev/a-rather-long-repository-path-${i}`,
          isGit: true,
        })),
      },
      repos: Array.from({ length: 6 }, (_, i) => ({
        id: `repo-${i}`,
        name: `repo-${i}`,
        path: `/Users/someone/dev/a-rather-long-repository-path-${i}`,
        isGit: true,
        skills: 20,
      })),
      credentials: Array.from({ length: 4 }, (_, i) => ({
        label: `tool-${i}`,
        satisfied: false,
        detail: 'needs one of Anthropic (ANTHROPIC_AUTH_TOKEN) or OpenAI (OPENAI_API_KEY)',
      })),
      envWarnings: ['/home/.skillgantry/.env is more permissive than 600 (mode 644)'],
    }),
  })

describe('every M6 screen fits its terminal — §14.1', () => {
  for (const [columns, rows] of [
    [200, 60],
    [120, 40],
    [100, 30],
    [80, 24],
    [60, 20],
    [50, 14],
  ] as const) {
    for (const screen of ['dashboard', 'issues', 'tools', 'settings']) {
      it(`fits ${screen} at ${columns}x${rows}`, async () => {
        const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('r1').handle })
        const ui = renderInk(
          <App
            skills={NAMES.map((id) => skillRef(id))}
            queue={queue}
            stages={['security']}
            concurrency={2}
            views={BUSY_VIEWS()}
            intervalMs={20}
          />,
          { columns, rows },
        )
        await ui.settle()
        ui.stdin.send(':')
        for (const char of screen) ui.stdin.send(char)
        ui.stdin.send('\r')
        await ui.settle(60)
        const frame = ui.lastFrame()
        const size = measure(frame)
        ui.unmount()
        // Guards the budget assertion against a navigation that silently failed:
        // a Work frame fits every size, so it would pass without proving anything.
        expect(frame.toLowerCase()).toContain(screen)
        expect(size.rows).toBeLessThanOrEqual(rows)
        expect(size.columns).toBeLessThanOrEqual(columns)
      })
    }

    it(`fits the setup screen at ${columns}x${rows}`, async () => {
      const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('r1').handle })
      const ui = renderInk(
        <App
          skills={NAMES.map((id) => skillRef(id))}
          queue={queue}
          stages={['security']}
          concurrency={2}
          views={BUSY_VIEWS()}
          setup={fakeSetupDriver()}
          intervalMs={20}
        />,
        { columns, rows },
      )
      await ui.settle()
      for (const char of ':setup\r') ui.stdin.send(char)
      await ui.settle(60)
      // enter reaches the tool list, 3 selects everything: the longest body the
      // wizard has.
      ui.stdin.send('\r')
      ui.stdin.send('3')
      await ui.settle(60)
      const size = measure(ui.lastFrame())
      ui.unmount()
      expect(size.rows).toBeLessThanOrEqual(rows)
      expect(size.columns).toBeLessThanOrEqual(columns)
    })

    // R3.12 put unbounded content on a step that had none, so the list is what
    // gives way — §14.1's first rule, and the reason the step windows at all.
    it(`fits the setup repo step with a long list at ${columns}x${rows}`, async () => {
      const repos = Array.from({ length: 12 }, (_, n) => ({
        id: `repo-${n}`,
        path: `/home/u/dev/a-fairly-long-skills-repo-path-${n}`,
        name: `repo-${n}`,
        isGit: n % 2 === 0,
      }))
      const state = {
        ...initialSetupState(),
        state: 'credentials-and-repo' as const,
        credentials: { present: true, warnings: [] },
      }
      const ui = renderInk(
        <Setup
          state={state}
          cursor={0}
          draftPath="/home/u/dev/typing-a-new-one"
          inspection={{
            resolved: '/home/u/dev/typing-a-new-one',
            isDirectory: true,
            alreadyRegistered: false,
            skillCount: 4,
            isGit: true,
          }}
          repos={repos}
          repoCursor={repos.length}
        />,
        { columns, rows },
      )
      await ui.settle()
      const size = measure(ui.lastFrame())
      ui.unmount()
      expect(size.rows).toBeLessThanOrEqual(rows)
      expect(size.columns).toBeLessThanOrEqual(columns)
    })

    it(`fits the confirmation pane at ${columns}x${rows}`, async () => {
      const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('r1').handle })
      const ui = renderInk(
        <App
          skills={NAMES.map((id) => skillRef(id))}
          queue={queue}
          stages={['security']}
          concurrency={2}
          views={BUSY_VIEWS()}
          setup={fakeSetupDriver()}
          intervalMs={20}
        />,
        { columns, rows },
      )
      await ui.settle()
      for (const char of ':settings\r') ui.stdin.send(char)
      await ui.settle(60)
      // Six removals plus a scalar edit: more change rows than the shortest
      // terminal below can show.
      for (const char of 'dddddde8\rc') ui.stdin.send(char)
      await ui.settle(60)
      const frame = ui.lastFrame()
      const size = measure(frame)
      ui.unmount()
      expect(frame).toContain('Confirm')
      expect(size.rows).toBeLessThanOrEqual(rows)
      expect(size.columns).toBeLessThanOrEqual(columns)
    })

    it(`fits the palette at ${columns}x${rows}`, async () => {
      const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('r1').handle })
      const ui = renderInk(
        <App
          skills={NAMES.map((id) => skillRef(id))}
          queue={queue}
          stages={['security']}
          concurrency={2}
          views={BUSY_VIEWS()}
          intervalMs={20}
        />,
        { columns, rows },
      )
      await ui.settle()
      ui.stdin.send(':')
      await ui.settle(40)
      const size = measure(ui.lastFrame())
      ui.unmount()
      expect(size.rows).toBeLessThanOrEqual(rows)
      expect(size.columns).toBeLessThanOrEqual(columns)
    })
  }
})
