# M7 — Work Screen Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Work screen answer the daily loop end to end — act on a finding, see the statistics, and have every movement key belong to a focus zone — without leaving the screen or breaking the 80×24 floor.

**Architecture:** Everything lands in `src/tui/**` plus one new `GantryViews` method implemented in `src/cli/gantry-views.ts`. No core contract moves: the two fields that give a finding its stage and its tool are already on the `tool:done` event. Pure row-builders in `rows.ts` and pure tier selection in `layout.ts` keep every new decision assertable without rendering Ink.

**Tech Stack:** TypeScript (ESM, `NodeNext`), React + Ink 6, vitest, `ink-testing`-style frame assertions through `tests/helpers/render-ink.tsx`.

## Specification

Layer 1: [requirements.md](requirements.md) R11.11–R11.15, plus R11.9 as amended.
Layer 2: [design.md §14.6](design.md), plus the in-place corrections to §14, §14.1 and §14.3.
Decisions: [decision-log.md §11](decision-log.md), D20–D23.

Spec committed at `54a1669` on `feat/m7-work-screen-overhaul`.

## Global Constraints

Copied verbatim from the spec and from `CLAUDE.md`. Every task's requirements implicitly include this section.

- **Import direction is `cli → tui → core`.** `src/tui/**` may reach core only through `src/core/index.ts`. Lint fails the build otherwise.
- **`src/tui/**` may not spawn, and may not open the ledger.** Both reach the screen through the `GantryViews` port.
- **No `console` and no `process.exit` in `src/core/**`.** Not touched by this milestone, but `pnpm lint` enforces it.
- **Relative imports carry the `.js` extension, in `.tsx` too.**
- **`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` are all on.** Never pass an explicit `undefined` to an optional prop — spread it conditionally (`{...(x ? { colour: x } : {})}`), which is the pattern already used throughout `src/tui/`.
- **British spelling in identifiers that appear in the specs:** `optimise`, `artefact`, `normalise`, `colour`.
- **§14.1 rule 1 — every panel renders exactly the rows it was allocated.** An overflow notice or footnote is counted *against* the allocation, never appended below it.
- **§14.1 rule 2 — text truncates, never wraps.** Content rows carry `wrap="truncate"`; labels go through `truncate()` or `truncateMiddle()`, which measure cells via `string-width`.
- **§14.1 rule 3 — what the chrome costs is `layout.ts`'s to know.** Never re-derive `width - 4` in a pane; call `innerWidth(width, chrome)`.
- **Floor is 80×24; hard minimum `MIN_COLUMNS` 50 × `MIN_ROWS` 14.**
- **R11.15 — no body foreground colour, no background colour, anywhere in `src/tui/**`.**
- **Conventional Commits, lowercase imperative subject describing the behaviour change.**
- **Verification command for the whole milestone:** `pnpm lint && pnpm build && pnpm test`. Do not run `pnpm acceptance` per task; it drives the full CLI and is slow.

## Task Order and Why

Task 2 comes before Task 9 because the Overview card is *funded* by the two rows the titled border gives back — building the card first would overflow 80×24. Task 5 comes before Task 6 because the Findings cursor renders fields Task 5 adds. Everything else is independent.

---

### Task 1: Repalette `tokens.ts`, and prove no surface is painted

**Files:**
- Modify: `src/tui/tokens.ts:13-50`
- Create: `tests/tui/tokens.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ACCENT: string` (now `'#0070f3'`), `SEVERITY_COLOUR: Record<string, string>`, `OUTCOME_COLOUR: Record<string, string>`, `JOB_COLOUR: Record<JobRecord['state'], string>` — all unchanged in shape, hex in value. `VERDICT_WIDTH` and `overflowNotice()` untouched.

- [ ] **Step 1: Write the failing test**

Create `tests/tui/tokens.test.ts`:

```ts
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACCENT,
  JOB_COLOUR,
  OUTCOME_COLOUR,
  SEVERITY_COLOUR,
} from '../../src/tui/tokens.js'

/** Every `.ts`/`.tsx` under src/tui, recursively. */
async function tuiSources(): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (path.endsWith('.ts') || path.endsWith('.tsx')) out.push(path)
    }
  }
  await walk('src/tui')
  return out
}

describe('R11.15 colour vocabulary', () => {
  it('uses the D23 palette for the accent and every state', () => {
    expect(ACCENT).toBe('#0070f3')
    expect(OUTCOME_COLOUR.passed).toBe('#00c853')
    expect(OUTCOME_COLOUR.failed).toBe('#ee0000')
    expect(OUTCOME_COLOUR.errored).toBe('#f5a623')
    expect(OUTCOME_COLOUR.degraded).toBe('#f5a623')
    expect(OUTCOME_COLOUR.skipped).toBe('#555555')
    expect(OUTCOME_COLOUR.idle).toBe('#555555')
    expect(OUTCOME_COLOUR.running).toBe(ACCENT)
    expect(SEVERITY_COLOUR.critical).toBe('#ee0000')
    expect(SEVERITY_COLOUR.high).toBe('#ee0000')
    expect(SEVERITY_COLOUR.medium).toBe('#f5a623')
    expect(SEVERITY_COLOUR.low).toBe('#888888')
    expect(SEVERITY_COLOUR.info).toBe('#888888')
    expect(JOB_COLOUR.running).toBe(ACCENT)
  })

  it('every colour is a hex triple, so a named ANSI cannot creep back in', () => {
    const all = [
      ACCENT,
      ...Object.values(OUTCOME_COLOUR),
      ...Object.values(SEVERITY_COLOUR),
      ...Object.values(JOB_COLOUR),
    ]
    for (const colour of all) expect(colour).toMatch(/^#[0-9a-f]{6}$/)
  })

  // R11.15's mechanically checkable half. The terminal's own background is what
  // makes the screen read on a light theme, so painting one is the regression
  // this guards — not a style preference.
  it('paints no background anywhere in src/tui', async () => {
    const offenders: string[] = []
    for (const path of await tuiSources()) {
      const body = await readFile(path, 'utf8')
      if (body.includes('backgroundColor')) offenders.push(path)
    }
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/tui/tokens.test.ts`
Expected: FAIL — the first case reports `expected 'cyan' to be '#0070f3'`. The background case should already pass; that is fine, it is a regression guard rather than a change driver.

- [ ] **Step 3: Rewrite the colour constants**

In `src/tui/tokens.ts`, replace the `ACCENT` declaration and its comment, and the three maps. The comment must be rewritten too — the existing one asserts "Cyan is the focus accent", which the change makes false:

```ts
/**
 * The screen's colour vocabulary, in one module because it was in five and they
 * had already diverged: `low` severity rendered gray on the Issues screen and
 * on the Dashboard but cyan in the findings pane, so one severity looked like
 * two depending on which screen the user read it from.
 *
 * Hex rather than named ANSI (D23): chalk downsamples for a terminal without
 * truecolour, and a name resolves to whatever the user's theme decided it
 * means, which is how `blue` becomes unreadable on one profile and fine on the
 * next. No body foreground and no background is ever set — the terminal's own
 * pair is what makes this screen read on a light theme (R11.15).
 *
 * The accent is the focus signal — the focused panel's border, the selected
 * output tab, the palette's command ids, the cursor. No state may claim it
 * except `running`, which is the one state telling the user to look at it.
 */
export const ACCENT = '#0070f3'

/**
 * Normalised severity, which is the only severity that reaches a screen: the
 * adapters map every tool's own vocabulary onto these five before a finding is
 * stored. `low` and `info` share the dim grey rather than a colour of their
 * own, because a scanner reports far more of them than of anything else and
 * colouring them makes the two severities that fail a gate harder to find.
 */
export const SEVERITY_COLOUR: Record<string, string> = {
  critical: '#ee0000',
  high: '#ee0000',
  medium: '#f5a623',
  low: '#888888',
  info: '#888888',
}

/**
 * Stage and run outcomes, plus the two non-outcomes a skill row can be in.
 * `degraded` shares `errored`'s amber: both mean the run finished and its
 * evidence is partial, which is one thing to a reader even though the reduction
 * distinguishes them.
 */
export const OUTCOME_COLOUR: Record<string, string> = {
  passed: '#00c853',
  failed: '#ee0000',
  errored: '#f5a623',
  degraded: '#f5a623',
  skipped: '#555555',
  running: ACCENT,
  idle: '#555555',
}

export const JOB_COLOUR: Record<JobRecord['state'], string> = {
  queued: '#555555',
  running: ACCENT,
  done: '#00c853',
  failed: '#ee0000',
  cancelled: '#f5a623',
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/tui/tokens.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the whole suite and fix any frame assertion that encoded a colour name**

Run: `pnpm test`
Expected: PASS. `renderInk` uses `debug: true`, which writes rendered text rather than ANSI codes, so frame assertions match on characters and should be unaffected. If any test asserts on the literal string `cyan`, update it to import `ACCENT` rather than hard-coding the new hex — a test naming the value twice is the drift this module exists to prevent.

- [ ] **Step 6: Commit**

```bash
git add src/tui/tokens.ts tests/tui/tokens.test.ts
git commit -m "ui: take the D23 palette for state and leave surfaces to the terminal"
```

---

### Task 2: `Panel` draws its own titled top border

**Files:**
- Modify: `src/tui/components/Panel.tsx` (whole file)
- Modify: `src/tui/layout.ts:34` (`BOXED_CHROME`)
- Modify: `src/tui/components/QueuePanel.tsx:78`, `src/tui/components/Issues.tsx:51`, `src/tui/components/ScreenList.tsx:35`, `src/tui/components/Help.tsx:65`, `src/tui/components/Palette.tsx:27`, `src/tui/components/ReviewPane.tsx:48`, `src/tui/components/ConfirmPane.tsx:45` — each gains `width`
- Create: `tests/tui/panel.test.tsx`

**Interfaces:**
- Consumes: `ACCENT` from Task 1.
- Produces: `PanelProps` as a discriminated union — `width` is **required** whenever `title` is set. `BOXED_CHROME` is 9, so `layoutFor(80, 24).outputHeight` gains 2 rows over its previous value. Later tasks rely on those two rows existing.

- [ ] **Step 1: Write the failing test**

Create `tests/tui/panel.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { Text } from 'ink'
import { Panel } from '../../src/tui/components/Panel.js'
import { layoutFor } from '../../src/tui/layout.js'
import { renderInk } from '../helpers/render-ink.js'

function frame(node: React.ReactElement, columns = 40, rows = 10): string {
  const ui = renderInk(node, { columns, rows })
  const out = ui.lastFrame()
  ui.unmount()
  return out
}

describe('Panel titled border', () => {
  it('renders the title inside the top border, not as a body row', () => {
    const out = frame(
      <Panel title="Skills" hint="7/18" focused={false} chrome="boxed" width={40}>
        <Text>first</Text>
      </Panel>,
    )
    const lines = out.split('\n').filter((line) => line.trim().length > 0)
    // The title rides the border: same row as the corner glyphs.
    expect(lines[0]).toContain('Skills')
    expect(lines[0]).toContain('7/18')
    expect(lines[0]?.startsWith('┌')).toBe(true)
    expect(lines[0]).toContain('┐')
    // And the very next row is content, not a repeat of the heading.
    expect(lines[1]).toContain('first')
    expect(lines[1]).not.toContain('Skills')
  })

  it('matches the title row to the box beneath it exactly, so no corner tears', () => {
    const out = frame(
      <Panel title="Queue" hint="idle" focused chrome="boxed" width={40}>
        <Text>row</Text>
      </Panel>,
    )
    const lines = out.split('\n').filter((line) => line.trim().length > 0)
    const top = lines[0] as string
    const bottom = lines.at(-1) as string
    expect(top.length).toBe(bottom.length)
    expect(top.length).toBe(40)
  })

  it('keeps the title as a body row in bare chrome, which has no border to hold it', () => {
    const out = frame(
      <Panel title="Skills" focused={false} chrome="bare" width={40}>
        <Text>first</Text>
      </Panel>,
    )
    const lines = out.split('\n').filter((line) => line.trim().length > 0)
    expect(lines[0]).toContain('Skills')
    expect(lines[0]?.startsWith('┌')).toBe(false)
  })

  it('gives the two saved rows back to the layout budget', () => {
    // BOXED_CHROME 11 -> 9: a titled boxed panel no longer spends a body row on
    // its heading, and Work has two of them (Skills and Queue).
    expect(layoutFor(80, 24).outputHeight).toBe(13)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/tui/panel.test.tsx`
Expected: FAIL — the first case reports the title on its own row below `┌───┐`, and the last reports `outputHeight` as 11 rather than 13.

- [ ] **Step 3: Rewrite `Panel.tsx`**

Replace the whole file:

```tsx
import { Box, Text } from 'ink'
import { ACCENT } from '../tokens.js'
import { truncate } from '../layout.js'

interface PanelCommon {
  focused: boolean
  chrome: 'boxed' | 'bare'
  grow?: boolean
  /** The rail owns the edge above the output pane; they share one rule. */
  borderTop?: boolean
  children: React.ReactNode
}

/**
 * `width` is required with a title and optional without, because a titled boxed
 * panel draws its heading row and its box in two independent renders: one cell
 * of disagreement puts the `┐` a column away from the `│` under it, which reads
 * as a torn frame rather than as a layout bug. Making it a type error is why
 * the compiler catches the next call site instead of a user catching it.
 */
export type PanelProps = PanelCommon &
  (
    | {
        title: string
        /** Counts and state that belong beside the title, never below it. */
        hint?: string
        width: number
      }
    | { title?: undefined; hint?: undefined; width?: number }
  )

/**
 * One chrome decision for all four panels. `bare` drops the border and keeps
 * the title as a row, because four bordered boxes cost fifteen rows of a
 * stacked narrow column before a single line of content — and because there is
 * no border there to embed a heading in.
 */
export function Panel(props: PanelProps): React.ReactElement {
  const { focused, chrome, grow = false, borderTop = true, children } = props
  const title = props.title
  const hint = props.hint
  const width = props.width ?? 0

  const label =
    title === undefined ? null : (
      <>
        <Text bold={focused} {...(focused ? { color: ACCENT } : {})}>
          {title}
        </Text>
        {hint === undefined || hint.length === 0 ? null : <Text dimColor> {hint}</Text>}
      </>
    )

  if (chrome === 'bare') {
    return (
      <Box
        flexDirection="column"
        {...(width > 0 ? { width, flexShrink: 0 } : {})}
        {...(grow ? { flexGrow: 1 } : {})}
      >
        {/* `truncate` rather than the default wrap: a heading that wraps to two
            rows spends a row the budget allocated to content, and the panel
            below it falls off the bottom of the terminal. */}
        {label === null ? null : <Text wrap="truncate">{label}</Text>}
        {children}
      </Box>
    )
  }

  const borderColour = focused ? ACCENT : '#555555'
  // `┌─ title hint ────┐`: two dashes and two spaces of furniture around the
  // label, so the run of `─` is whatever is left. Floored at 0 rather than 1 —
  // a floor of one made a 12-cell panel need 13 cells, which is §14.1's first
  // rule broken by the chrome that exists to obey it.
  const furniture = 6
  const labelRoom = Math.max(0, width - furniture)
  const shownTitle = title === undefined ? '' : truncate(title, labelRoom)
  const shownHint =
    hint === undefined || hint.length === 0
      ? ''
      : truncate(hint, Math.max(0, labelRoom - shownTitle.length - 1))
  const used = shownTitle.length + (shownHint.length === 0 ? 0 : shownHint.length + 1)
  const fill = Math.max(0, width - used - furniture + 2)

  return (
    <Box flexDirection="column" {...(width > 0 ? { width, flexShrink: 0 } : {})}>
      {borderTop && title !== undefined && (
        <Text wrap="truncate">
          <Text color={borderColour}>┌─ </Text>
          <Text bold={focused} {...(focused ? { color: ACCENT } : {})}>
            {shownTitle}
          </Text>
          {shownHint.length === 0 ? null : <Text dimColor> {shownHint}</Text>}
          <Text color={borderColour}>{` ${'─'.repeat(fill)}┐`}</Text>
        </Text>
      )}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={borderColour}
        // The heading row above *is* this box's top edge when there is a title.
        borderTop={borderTop && title === undefined}
        paddingX={1}
        {...(width > 0 ? { width, flexShrink: 0 } : {})}
        {...(grow ? { flexGrow: 1 } : {})}
      >
        {children}
      </Box>
    </Box>
  )
}
```

- [ ] **Step 4: Drop `BOXED_CHROME` to 9**

In `src/tui/layout.ts`, replace the constant and amend its comment:

```ts
/**
 * Rows spent on chrome before any content, per layout.
 *
 * boxed — header, footer, the queue box's titled border and bottom edge, the
 * rail box, and the output pane's tab row plus the bottom border it shares with
 * the rail. It was 11 until §14.6 moved a titled panel's heading into its top
 * border: Skills and Queue each stopped spending a body row on their name, and
 * those two rows are what funds the Overview card.
 * bare  — header, footer, one title row per panel, the rail's two rows, and the
 * output pane's tab row. Four bordered boxes cost 15 rows in a stacked column,
 * which left nothing for content in a 60x20 split, so narrow drops the borders
 * and separates panels by their titles instead.
 */
const BOXED_CHROME = 9
const BARE_CHROME = 8
```

- [ ] **Step 5: Pass `width` at the seven titled call sites**

Each already has the number in scope. Make exactly these edits and no others:

```
QueuePanel.tsx:78   <Panel title="Queue" hint={hint} focused={focused} chrome={chrome} width={width}>
Issues.tsx:51-58    add  width={columns}   to the existing prop list
ScreenList.tsx:35   <Panel title={title} {...(hint === undefined ? {} : { hint })} focused chrome={layout.chrome} width={layout.columns}>
Help.tsx:65         <Panel title="SkillGantry — keys" focused chrome={layout.chrome} width={layout.columns}>
Palette.tsx:27      <Panel title={`:${palette.query}`} focused chrome={layout.chrome} width={layout.columns}>
ReviewPane.tsx:48   <Panel title={title} focused chrome={layout.chrome} width={layout.columns}>
ConfirmPane.tsx:45  add  width={layout.columns}   to the existing prop list
```

`QueuePanel` already receives a `width` prop from `Work.tsx:77`; it simply never forwarded it. `OutputPane` and `LifecycleRail` pass no title and need no change.

- [ ] **Step 6: Run the build to prove the type change caught every site**

Run: `pnpm build`
Expected: PASS. A missing `width` on a titled `Panel` is a compile error, so a clean build is the proof that all seven were found. If it fails, the error names the file and line — fix that call site the same way.

- [ ] **Step 7: Run the panel test**

Run: `pnpm vitest run tests/tui/panel.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 8: Run the whole suite and update the frame assertions that encoded the old chrome**

Run: `pnpm test`
Expected: some failures in `tests/tui/layout.test.tsx`, `tests/tui/work-screen.test.tsx` and `tests/tui/output-pane.test.tsx`. Two legitimate causes, and it matters which one you are looking at:

1. A test asserting a **row count or a pane height** that was true at `BOXED_CHROME` 11. Update the expected number — the two extra content rows are the deliberate outcome of this task.
2. A test asserting a **title appears on its own line** below a border. Update it to expect the title on the border row.

Do not "fix" a failure by widening an assertion to match whatever renders. If a frame is missing a panel entirely, that is a real overflow bug in the new border arithmetic — the `fill` calculation is where to look.

- [ ] **Step 9: Commit**

```bash
git add src/tui/components/Panel.tsx src/tui/layout.ts src/tui/components/QueuePanel.tsx src/tui/components/Issues.tsx src/tui/components/ScreenList.tsx src/tui/components/Help.tsx src/tui/components/Palette.tsx src/tui/components/ReviewPane.tsx src/tui/components/ConfirmPane.tsx tests/tui/panel.test.tsx tests/tui/layout.test.tsx tests/tui/work-screen.test.tsx tests/tui/output-pane.test.tsx
git commit -m "ui: draw a titled panel's heading in its top border"
```

---

### Task 3: Three focus zones, and every movement key scoped to one

**Files:**
- Modify: `src/tui/store.ts:61-67` (`FOCUSES`)
- Modify: `src/tui/app.tsx:518-537` (`j`/`k`, `h`/`l`, `space`), `src/tui/app.tsx:591-594` (`x`)
- Modify: `src/tui/components/Work.tsx:130`, `:140`, `:166`, `:175` (`focused` props)
- Create: `tests/tui/focus-zones.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `FOCUSES = ['skills', 'work', 'queue'] as const`, so `Focus = 'skills' | 'work' | 'queue'`. Every later task that reads `state.focus === 'output'` must read `state.focus === 'work'`.

- [ ] **Step 1: Write the failing test**

Create `tests/tui/focus-zones.test.tsx`. It drives the real `App`, because the point of the task is which key the handler answers:

```tsx
import { describe, expect, it } from 'vitest'
import { createQueue, type SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { FOCUSES, reducer, initialState } from '../../src/tui/store.js'
import { fakeRun } from '../helpers/fake-run.js'
import { fakeViews } from '../helpers/fake-views.js'
import { renderInk } from '../helpers/render-ink.js'

const skill = (id: string): SkillRef => ({
  id,
  name: id,
  version: '1.0.0',
  dir: `/repo/${id}`,
  relPath: id,
  repo: { id: 'fx', path: '/repo', name: 'fx', isGit: false },
  rootSkill: false,
  workspacePath: `/repo/${id}-workspace`,
  deprecated: false,
  supersededBy: null,
})

const SKILLS = [skill('declawed'), skill('spec-lint')]

function harness() {
  const queue = createQueue({ concurrency: 2, startRun: (job) => fakeRun(`run-${job.skillId}`).handle })
  const ui = renderInk(
    <App
      skills={SKILLS}
      queue={queue}
      stages={['security']}
      concurrency={2}
      views={fakeViews()}
      intervalMs={20}
    />,
    { columns: 100, rows: 30 },
  )
  return { queue, ui }
}

describe('R11.11 focus zones', () => {
  it('cycles exactly three zones, in the order they sit on the screen', () => {
    expect([...FOCUSES]).toEqual(['skills', 'work', 'queue'])
    let state = initialState(SKILLS, 2)
    expect(state.focus).toBe('skills')
    state = reducer(state, { type: 'cycle-focus', delta: 1 })
    expect(state.focus).toBe('work')
    state = reducer(state, { type: 'cycle-focus', delta: 1 })
    expect(state.focus).toBe('queue')
    state = reducer(state, { type: 'cycle-focus', delta: 1 })
    expect(state.focus).toBe('skills')
  })

  it('leaves the rail alone while the skill list has focus', async () => {
    const { ui, queue } = harness()
    await ui.settle()
    // Validate is selected on entry. `l` must not move it from the skills zone.
    ui.stdin.send('l')
    await ui.settle()
    expect(ui.lastFrame()).toMatch(/▸\s*Validate/)
    ui.unmount()
    queue.close()
  })

  it('moves the rail once the work zone has focus', async () => {
    const { ui, queue } = harness()
    await ui.settle()
    ui.stdin.send('\t')
    await ui.settle()
    ui.stdin.send('l')
    await ui.settle()
    expect(ui.lastFrame()).toMatch(/▸\s*Evaluate/)
    ui.unmount()
    queue.close()
  })

  it('marks a skill in the skills zone and a stage in the work zone', async () => {
    const { ui, queue } = harness()
    await ui.settle()
    ui.stdin.send(' ')
    await ui.settle()
    expect(ui.lastFrame()).toContain('1 marked')
    ui.stdin.send('\t')
    await ui.settle()
    ui.stdin.send(' ')
    await ui.settle()
    // The rail marks its selected stage with `*`, and the skill mark stands.
    expect(ui.lastFrame()).toMatch(/\*\s*Validate/)
    expect(ui.lastFrame()).toContain('1 marked')
    ui.unmount()
    queue.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/tui/focus-zones.test.tsx`
Expected: FAIL — the first case reports four focuses, and "leaves the rail alone" reports `▸ Evaluate` because `h`/`l` currently fire in every zone.

- [ ] **Step 3: Collapse `FOCUSES` to three**

In `src/tui/store.ts`, replace the declaration and its comment:

```ts
/**
 * In the order the zones sit on the screen, which is why `queue` comes last
 * rather than being appended anywhere: tab reading top-to-bottom is the only
 * reason a user can predict where the next press lands.
 *
 * `work` is the rail and the output pane together (R11.11). They were two stops
 * until §14.6, and separating them bought nothing: `h`/`l` move the rail and
 * `j`/`k` move the pane, so the two were never ambiguous, and a stop whose only
 * job is to disambiguate them is paid for on every cycle.
 */
export const FOCUSES = ['skills', 'work', 'queue'] as const
export type Focus = (typeof FOCUSES)[number]
```

- [ ] **Step 4: Scope the keys in `app.tsx`**

Replace the `j`/`k`, `h`/`l` and `space` block (currently `app.tsx:518-537`) with:

```tsx
    if ((plain && input === 'j') || key.downArrow) {
      dispatch(moveDown(state, layout, current, 1))
      return
    }
    if ((plain && input === 'k') || key.upArrow) {
      dispatch(moveDown(state, layout, current, -1))
      return
    }
    // R11.11: the rail belongs to the work zone. It fired in every zone before,
    // so moving down the skill list moved the rail with it and nothing on
    // screen said so — and the rail describes the *selected* skill, so moving
    // both at once is how a user loses track of which stage they are reading.
    if (plain && (input === 'h' || input === 'l')) {
      if (state.focus !== 'work') return
      dispatch({ type: 'select-stage', delta: input === 'l' ? 1 : -1 })
      return
    }
    if (plain && input === ' ') {
      if (state.focus === 'queue') return
      dispatch(
        state.focus === 'work' ? { type: 'toggle-stage-mark' } : { type: 'toggle-skill-mark' },
      )
      return
    }
```

Then scope `x` to the queue zone (currently `app.tsx:591-594`):

```tsx
    if (plain && input === 'x') {
      // R11.11: the job cursor lives in the queue zone, so this is where it acts.
      if (state.focus !== 'queue') return
      const job = state.jobs[state.selectedJob]
      if (job) void queue.cancelJob(job.jobId)
    }
```

- [ ] **Step 5: Find and update every remaining `'output'` and `'stages'` focus read**

Run: `grep -rn "focus === 'output'\|focus === 'stages'\|'output'\|'stages'" src/tui/`

In `src/tui/components/Work.tsx`, both `SideBySide` and `Stacked` pass `focused` to the rail and the pane. One flag now lights both boxes, which is what makes the merged zone visible:

```tsx
// SideBySide, lines 130 and 140 — and the identical pair in Stacked
focused={state.focus === 'work'}
```

Also check `moveDown` in `app.tsx` (its `state.focus` switch) and `src/tui/components/OutputPane.tsx`'s overflow-notice recovery text, which reads `focused ? 'j/k scrolls' : 'tab focuses this pane'` — that stays correct and needs no edit.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run tests/tui/focus-zones.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 7: Run the whole suite**

Run: `pnpm lint && pnpm build && pnpm test`
Expected: PASS. `tests/tui/store.test.ts` and `tests/tui/work-screen.test.tsx` may assert on a four-stop cycle or send `\t` twice to reach the output pane; update those to the three-stop order. A test that sends `\t\t` to focus the pane now lands on the queue — change it to a single `\t`.

- [ ] **Step 8: Commit**

```bash
git add src/tui/store.ts src/tui/app.tsx src/tui/components/Work.tsx tests/tui/focus-zones.test.tsx tests/tui/store.test.ts tests/tui/work-screen.test.tsx
git commit -m "ui: scope every movement key to one of three focus zones"
```

---

### Task 4: Issues as a fifth output tab, over one shared row builder

**Files:**
- Modify: `src/tui/rows.ts` — add `issueRows()`
- Modify: `src/tui/components/Issues.tsx:69-110` — render through `issueRows()`
- Modify: `src/tui/store.ts:28-29` (`PANELS`), and add `scopeIssues` handling
- Modify: `src/tui/components/OutputPane.tsx` — add the `issues` branch
- Modify: `src/tui/app.tsx:514-517` (`'1'`–`'4'` becomes `'1'`–`'5'`), plus the `S` binding
- Create: `tests/tui/issues-tab.test.tsx`

**Interfaces:**
- Consumes: `Panel` with required width (Task 2), `Focus` (Task 3).
- Produces:
  - `export interface IssueRowView { text: string; severity: string; suppressed: boolean; selected: boolean; fingerprint: string }`
  - `export function issueRows(rows: readonly IssueRow[], selected: number, width: number): IssueRowView[]`
  - `PANELS = ['log', 'findings', 'issues', 'artefacts', 'skill'] as const`
  - `AppState.issueScope: 'skill' | 'repo' | 'all'`
  - Action `{ type: 'cycle-issue-scope' }`

- [ ] **Step 1: Write the failing test**

Create `tests/tui/issues-tab.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import type { IssueRow } from '../../src/core/index.js'
import { issueRows } from '../../src/tui/rows.js'
import { PANELS, initialState, reducer } from '../../src/tui/store.js'

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

describe('R11.13 Issues on the output pane', () => {
  it('puts Issues third, so Log and Findings keep the keys they had', () => {
    expect([...PANELS]).toEqual(['log', 'findings', 'issues', 'artefacts', 'skill'])
  })

  it('builds one row per issue, marking the selection and the suppression', () => {
    const rows = issueRows(
      [issue(), issue({ fingerprint: 'fp2', suppressed: true, suppressionReason: 'fixed paths' })],
      1,
      100,
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text).toContain('unsafe-script')
    expect(rows[0]?.text).toContain('declawed')
    expect(rows[0]?.text.startsWith(' ')).toBe(true)
    expect(rows[1]?.text).toContain('▸')
    expect(rows[1]?.suppressed).toBe(true)
    expect(rows[1]?.text).toContain('⊘ suppressed: fixed paths')
  })

  it('names R8.8 blockers on the row, so "why is this still open" is visible', () => {
    const rows = issueRows([issue({ blockedBy: ['skillspector'] })], 0, 100)
    expect(rows[0]?.text).toContain('⟂ skillspector')
  })

  it('cycles the scope skill → repo → all → skill', () => {
    let state = initialState([], 2)
    expect(state.issueScope).toBe('skill')
    state = reducer(state, { type: 'cycle-issue-scope' })
    expect(state.issueScope).toBe('repo')
    state = reducer(state, { type: 'cycle-issue-scope' })
    expect(state.issueScope).toBe('all')
    state = reducer(state, { type: 'cycle-issue-scope' })
    expect(state.issueScope).toBe('skill')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/tui/issues-tab.test.tsx`
Expected: FAIL — `issueRows is not a function`.

- [ ] **Step 3: Add `issueRows()` to `rows.ts`**

Append to `src/tui/rows.ts`, importing `IssueRow` from core and `truncateMiddle` from `./layout.js`:

```ts
export interface IssueRowView {
  text: string
  severity: string
  suppressed: boolean
  /** A flag rather than the caller re-reading the cursor glyph out of `text`,
      which breaks the moment the glyph changes. */
  selected: boolean
  fingerprint: string
}

/** Paired with the word, so the state survives a monochrome terminal. */
const STATE_MARK: Record<string, string> = {
  open: '●',
  acknowledged: '◐',
  wontfix: '×',
  fixed: '○',
}

/**
 * One issue, one row, built once for both the Issues screen and the Work
 * screen's Issues tab (R11.13). Two renderers is the divergence this module
 * already records from when five of them owned severity colour and `low` read
 * gray on two screens and cyan on a third.
 *
 * Fixed left columns and the path last, because the path is the only field that
 * can be arbitrarily long and so the only one that should absorb the
 * truncation. The rule class gets its own column rather than sharing the
 * path's: the path is elided from the *head* so its basename survives, which
 * ate the rule class when the two shared one field — and the rule class is what
 * names the issue.
 */
export function issueRows(
  rows: readonly IssueRow[],
  selected: number,
  width: number,
): IssueRowView[] {
  const severityWidth = 9
  const stateWidth = 14
  const skillWidth = Math.min(24, Math.max(10, Math.floor(width * 0.22)))
  const ruleWidth = Math.min(18, Math.max(8, Math.floor(width * 0.2)))
  const pathWidth = Math.max(
    8,
    width - severityWidth - stateWidth - skillWidth - ruleWidth - 4,
  )

  return rows.map((row, index) => {
    // R8.8's blockers: the detectors that have not since reported a conclusive
    // absence, so "why is this still open" is on the row.
    const blocked = row.blockedBy.length === 0 ? '' : ` ⟂ ${row.blockedBy.join(',')}`
    // R8.15: marked, never hidden. Its width is reserved out of the path's
    // rather than appended to it — `truncateMiddle` elides the head, so a mark
    // simply concatenated on is what a long reason eats first.
    const mark = row.suppressed
      ? truncate(
          ` ⊘ suppressed${row.suppressionReason ? `: ${row.suppressionReason}` : ''}`,
          Math.max(14, Math.floor(pathWidth * 0.6)),
        )
      : ''
    const cursor = index === selected ? '▸' : ' '
    const text =
      `${cursor} ` +
      row.severity.padEnd(severityWidth) +
      `${STATE_MARK[row.state] ?? '?'} ${row.state}`.padEnd(stateWidth) +
      truncate(row.skillId, skillWidth).padEnd(skillWidth) +
      truncate(row.ruleClass, ruleWidth).padEnd(ruleWidth) +
      truncateMiddle(`${row.relPath}${blocked}`, Math.max(4, pathWidth - mark.length)) +
      mark
    return {
      text: truncate(text, width),
      severity: row.severity,
      suppressed: row.suppressed,
      selected: index === selected,
      fingerprint: row.fingerprint,
    }
  })
}
```

- [ ] **Step 4: Add `issueScope` to the store**

In `src/tui/store.ts`: widen `PANELS`, add the field, the action and the reducer case.

```ts
export const PANELS = ['log', 'findings', 'issues', 'artefacts', 'skill'] as const
```

Add to `AppState`:

```ts
  /**
   * R11.13. Which issues the Work screen's tab is showing. Held separately from
   * `issueFilter`, which the Issues *screen* owns: one field driven by two
   * screens with different scoping vocabularies is how the tab comes to
   * re-filter the screen behind the user's back.
   */
  issueScope: 'skill' | 'repo' | 'all'
```

Add to `Action`:

```ts
  | { type: 'cycle-issue-scope' }
```

Add to `initialState`: `issueScope: 'skill',`

Add the reducer case:

```ts
    case 'cycle-issue-scope': {
      const next = { skill: 'repo', repo: 'all', all: 'skill' } as const
      return { ...state, issueScope: next[state.issueScope], selectedIssue: 0 }
    }
```

- [ ] **Step 5: Render the Issues screen through `issueRows()`**

In `src/tui/components/Issues.tsx`, delete the inline column arithmetic (`severityWidth` through `pathWidth`), delete the local `STATE_MARK`, and replace the `state.issues.slice(start, end).map(...)` block with:

```tsx
        {issueRows(state.issues, state.selectedIssue, cols)
          .slice(start, end)
          .map((row) => (
            <Text
              key={row.fingerprint}
              wrap="truncate"
              bold={row.selected}
              dimColor={row.suppressed}
            >
              <Text color={SEVERITY_COLOUR[row.severity] ?? '#888888'}>{row.text}</Text>
            </Text>
          ))}
```

- [ ] **Step 6: Add the `issues` branch to `OutputPane`**

In `src/tui/components/OutputPane.tsx`, after the `findings` branch and before `artefacts`:

```tsx
  if (state.panel === 'issues') {
    if (state.issues.length === 0) {
      return <Text dimColor wrap="truncate">no issues in this scope — S widens it</Text>
    }
    return (
      <Box flexDirection="column">
        {issueRows(state.issues, state.selectedIssue, cols)
          .slice(view.start, view.end)
          .map((row) => (
            <Text key={row.fingerprint} wrap="truncate" dimColor={row.suppressed}>
              <Text color={SEVERITY_COLOUR[row.severity] ?? '#888888'}>{row.text}</Text>
            </Text>
          ))}
        {notice}
      </Box>
    )
  }
```

And add the `issues` case to `outputTab()` in `rows.ts`, so the pane and the key clamp agree:

```ts
    case 'issues':
      return { total: state.issues.length, anchor: 'top' }
```

- [ ] **Step 7: Bind `1`–`5` and `S` in `app.tsx`**

Replace the digit guard:

```tsx
    if (plain && input >= '1' && input <= '5') {
      dispatch({ type: 'set-panel', panel: PANELS[Number(input) - 1]! })
      return
    }
```

Add the scope key after it. The tab binds **no** state transition — `a`, `w` and `o` stay on the Issues screen, because `o` on this pane means "open the artefact directory" (Task 7) and one pane whose key means two things across two of its own tabs is a keymap that cannot be learned:

```tsx
    if (plain && input === 'S' && state.panel === 'issues') {
      dispatch({ type: 'cycle-issue-scope' })
      return
    }
```

- [ ] **Step 8: Load the tab's issues in the effect that already loads the screen's**

In `src/tui/app.tsx`, find the effect that calls `views.issues(...)`. Add a second effect keyed on `[state.screen, state.panel, state.issueScope, state.selectedSkill, state.reloads]` that resolves the scope against the selected skill and dispatches `set-issues`:

```tsx
  // R11.13's three scopes resolve onto `IssueFilter`'s existing shapes, so the
  // ledger needs no change: a skill id, a repo id, or no filter at all.
  useEffect(() => {
    if (state.screen !== 'work' || state.panel !== 'issues') return
    const skill = selectedSkill(state)
    if (!skill) return
    const ref = byId.current.get(skill.skillId)
    const filter =
      state.issueScope === 'skill'
        ? { skillId: skill.skillId }
        : state.issueScope === 'repo' && ref
          ? { repoId: ref.repo.id }
          : {}
    let live = true
    void views.issues(filter).then(
      (rows) => {
        if (live) dispatch({ type: 'set-issues', rows })
      },
      (err: unknown) => {
        if (live) dispatch({ type: 'view-error', message: (err as Error).message })
      },
    )
    return () => {
      live = false
    }
  }, [state.screen, state.panel, state.issueScope, state.selectedSkill, state.reloads, views])
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm vitest run tests/tui/issues-tab.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 10: Run the whole suite**

Run: `pnpm lint && pnpm build && pnpm test`
Expected: PASS. `tests/tui/issues.test.tsx` asserts on the screen's rows and should still pass — the row text is byte-identical apart from the cursor glyph, which moved from `›` to `▸`. Update that expectation; do not change `issueRows` to emit `›`, because `▸` is the study's cursor and every other list is moving to it.

- [ ] **Step 11: Commit**

```bash
git add src/tui/rows.ts src/tui/store.ts src/tui/app.tsx src/tui/components/Issues.tsx src/tui/components/OutputPane.tsx tests/tui/issues-tab.test.tsx tests/tui/issues.test.tsx
git commit -m "ui: triage issues from the Work screen over one shared row builder"
```

---

### Task 5: A finding carries its stage, its tool and its artefact directory

**Files:**
- Modify: `src/tui/store.ts:83-102` (`SkillRow.findings`), `:447-452` (`tool:done`), `:745-771` (`set-last-run`)
- Modify: `src/tui/views.ts:95-100` (`LastRunStage`), `:161-168` (`loadLastRun`)
- Modify: `src/tui/components/OutputPane.tsx:144-165` (read `.finding`)
- Modify: `src/tui/rows.ts:45-47` (`outputTab`'s findings case is unchanged in value but the type moves)
- Create: `tests/tui/finding-attribution.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  export interface FindingRow {
    finding: RawFinding
    stage: Stage
    toolId: string
    /** `ToolRunRecord.artefactDir` — what `o` opens. */
    artefactDir: string
  }
  ```
  `SkillRow.findings` becomes `FindingRow[]`. `LastRunStage.findings` becomes `FindingRow[]`. Task 6 renders these fields and Task 7 opens `artefactDir`.

- [ ] **Step 1: Write the failing test**

Create `tests/tui/finding-attribution.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { RawFinding, SkillRef, ToolRunRecord } from '../../src/core/index.js'
import { initialState, reducer } from '../../src/tui/store.js'

const skill: SkillRef = {
  id: 'declawed',
  name: 'declawed',
  version: '1.0.0',
  dir: '/repo/declawed',
  relPath: 'declawed',
  repo: { id: 'fx', path: '/repo', name: 'fx', isGit: false },
  rootSkill: false,
  workspacePath: '/repo/declawed-workspace',
  deprecated: false,
  supersededBy: null,
}

const finding: RawFinding = {
  ruleClass: 'unsafe-script',
  nativeRuleId: 'SG101',
  severity: 'low',
  path: 'declawed/scripts/scan.py',
  message: 'shell=True on an interpolated path',
}

const toolRun = (over: Partial<ToolRunRecord> = {}): ToolRunRecord => ({
  toolId: 'skill-lint',
  toolVersion: '1.0.0',
  outcome: 'passed',
  exitCode: 0,
  durationMs: 10,
  errorKind: null,
  artefactDir: '/repo/declawed-workspace/skillgantry/runs/r1/01-validate/skill-lint',
  findings: [finding],
  metrics: {},
  summary: '1 finding',
  ...over,
})

describe('R11.14 finding attribution', () => {
  it('records the stage, the tool and the artefact directory from tool:done', () => {
    let state = initialState([skill], 2)
    state = reducer(state, {
      type: 'queue-event',
      event: {
        type: 'run:event',
        jobId: 'j1',
        event: { type: 'run:start', runId: 'r1', skillId: 'declawed', stages: ['validate'], runDir: '/runs/r1' },
      },
    })
    state = reducer(state, {
      type: 'queue-event',
      event: {
        type: 'run:event',
        jobId: 'j1',
        event: { type: 'tool:done', runId: 'r1', stage: 'validate', toolId: 'skill-lint', result: toolRun() },
      },
    })

    const rows = state.skills[0]?.findings ?? []
    expect(rows).toHaveLength(1)
    expect(rows[0]?.stage).toBe('validate')
    expect(rows[0]?.toolId).toBe('skill-lint')
    expect(rows[0]?.artefactDir).toBe(
      '/repo/declawed-workspace/skillgantry/runs/r1/01-validate/skill-lint',
    )
    expect(rows[0]?.finding.ruleClass).toBe('unsafe-script')
  })

  it('attributes two tools in one stage to themselves, not to the stage', () => {
    let state = initialState([skill], 2)
    state = reducer(state, {
      type: 'queue-event',
      event: {
        type: 'run:event',
        jobId: 'j1',
        event: { type: 'run:start', runId: 'r1', skillId: 'declawed', stages: ['security'], runDir: '/runs/r1' },
      },
    })
    for (const toolId of ['skill-scanner', 'skillspector']) {
      state = reducer(state, {
        type: 'queue-event',
        event: {
          type: 'run:event',
          jobId: 'j1',
          event: {
            type: 'tool:done',
            runId: 'r1',
            stage: 'security',
            toolId,
            result: toolRun({ toolId, artefactDir: `/runs/r1/03-security/${toolId}` }),
          },
        },
      })
    }
    const rows = state.skills[0]?.findings ?? []
    expect(rows.map((row) => row.toolId)).toEqual(['skill-scanner', 'skillspector'])
    expect(rows.map((row) => row.artefactDir)).toEqual([
      '/runs/r1/03-security/skill-scanner',
      '/runs/r1/03-security/skillspector',
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/tui/finding-attribution.test.ts`
Expected: FAIL — `rows[0].stage` is `undefined`, because `findings` holds bare `RawFinding`s.

- [ ] **Step 3: Add `FindingRow` and widen `SkillRow`**

In `src/tui/store.ts`, add above `StageCell`:

```ts
/**
 * A finding plus where it came from. §14.3 recorded that a finding on screen
 * "cannot be attributed to a stage at all" — but the reducer had `event.stage`
 * and `event.result` in hand the whole time, so the attribution was one field
 * away and the Findings pane went without a cursor for it. No core contract
 * moves: `tool:done` already carries all four values.
 */
export interface FindingRow {
  finding: RawFinding
  stage: Stage
  toolId: string
  /** `ToolRunRecord.artefactDir` — the evidence `o` opens (R11.14). */
  artefactDir: string
}
```

Change `SkillRow`:

```ts
  findings: FindingRow[]
```

- [ ] **Step 4: Populate it in the `tool:done` case**

Replace the `tool:done` case (`store.ts:447-452`):

```ts
    case 'tool:done':
      return withSkill(state, skillId, (row) =>
        withStage(
          {
            ...row,
            findings: [
              ...row.findings,
              ...event.result.findings.map((finding) => ({
                finding,
                stage: event.stage,
                toolId: event.result.toolId,
                artefactDir: event.result.artefactDir,
              })),
            ],
          },
          event.stage,
          { summary: event.result.summary },
        ),
      )
```

- [ ] **Step 5: Carry the same fields through the rehydration path**

In `src/tui/views.ts`, change `LastRunStage` and re-import `FindingRow`:

```ts
import type { FindingRow } from './store.js'

export interface LastRunStage {
  stage: Stage
  outcome: StageOutcome
  summary: string
  /**
   * Attributed the way a live run's are (R11.14). Flattening `toolRuns` into
   * bare findings here would make a rehydrated finding the one kind the
   * Findings pane could not open the evidence for.
   */
  findings: FindingRow[]
}
```

And in `loadLastRun`, replace the `findings` line of the pushed stage:

```ts
      findings: result.toolRuns.flatMap((run) =>
        run.findings.map((finding) => ({
          finding,
          stage,
          toolId: run.toolId,
          artefactDir: run.artefactDir,
        })),
      ),
```

`set-last-run` in the store needs no change: it already does `action.run.stages.flatMap((recorded) => recorded.findings)`, which now yields `FindingRow[]`.

- [ ] **Step 6: Make `OutputPane` read through `.finding`**

In the `findings` branch of `src/tui/components/OutputPane.tsx`, change the map body so each field goes through `row.finding`:

```tsx
        {skill.findings.slice(view.start, view.end).map((row, index) => (
          <Text
            key={`${view.start + index}-${row.finding.path}-${row.finding.nativeRuleId}`}
            wrap="truncate"
          >
            <Text color={SEVERITY_COLOUR[row.finding.severity] ?? '#ee0000'}>
              {row.finding.severity}
            </Text>{' '}
            {truncate(
              `${row.finding.suppressed ? '⊘ ' : ''}${row.finding.ruleClass} ${row.finding.path} ${row.finding.message}`,
              cols - row.finding.severity.length - 1,
            )}
          </Text>
        ))}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm vitest run tests/tui/finding-attribution.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 8: Run the whole suite**

Run: `pnpm lint && pnpm build && pnpm test`
Expected: PASS. `pnpm build` will name every remaining place that treated `findings` as `RawFinding[]` — fix each by reaching through `.finding`. Check `tests/tui/store.test.ts` and `tests/tui/output-pane.test.tsx`, which construct findings directly; wrap their fixtures in the new shape rather than casting.

- [ ] **Step 9: Commit**

```bash
git add src/tui/store.ts src/tui/views.ts src/tui/components/OutputPane.tsx tests/tui/finding-attribution.test.ts tests/tui/store.test.ts tests/tui/output-pane.test.tsx
git commit -m "ui: attribute every finding to its stage, tool and artefact directory"
```

---

### Task 6: The Findings pane gets a cursor and inline detail

**Files:**
- Modify: `src/tui/rows.ts` — add `findingRows()`, change `outputTab`'s findings case
- Modify: `src/tui/store.ts` — add `selectedFinding` and `select-finding`
- Modify: `src/tui/components/OutputPane.tsx` — render `findingRows()`
- Modify: `src/tui/app.tsx` — `moveDown` moves the finding cursor in this pane
- Create: `tests/tui/findings-pane.test.ts`

**Interfaces:**
- Consumes: `FindingRow` (Task 5), `PANELS` with `issues` (Task 4).
- Produces:
  - `export interface FindingRowView { text: string; severity: string | null; dim: boolean; key: string }`
  - `export function findingRows(rows: readonly FindingRow[], selected: number, width: number): FindingRowView[]`
  - `AppState.selectedFinding: number`, action `{ type: 'select-finding'; delta: number; total: number }`

- [ ] **Step 1: Write the failing test**

Create `tests/tui/findings-pane.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { RawFinding } from '../../src/core/index.js'
import { findingRows } from '../../src/tui/rows.js'
import type { FindingRow } from '../../src/tui/store.js'

const raw = (over: Partial<RawFinding> = {}): RawFinding => ({
  ruleClass: 'unsafe-script',
  nativeRuleId: 'SG101',
  severity: 'low',
  path: 'declawed/scripts/scan.py',
  message: 'subprocess.run called with shell=True on an interpolated path',
  ...over,
})

const row = (over: Partial<FindingRow> = {}): FindingRow => ({
  finding: raw(),
  stage: 'validate',
  toolId: 'skill-lint',
  artefactDir: '/runs/r1/01-validate/skill-lint',
  ...over,
})

describe('R11.14 findings pane rows', () => {
  it('renders one row per finding and expands only the selected one', () => {
    const rows = findingRows([row(), row({ finding: raw({ nativeRuleId: 'SG102' }) })], 0, 100)
    // Two summary rows plus the detail rows of the first.
    expect(rows.filter((r) => r.text.includes('unsafe-script')).length).toBeGreaterThanOrEqual(2)
    const detail = rows.map((r) => r.text).join('\n')
    expect(detail).toContain('subprocess.run called with shell=True')
    expect(detail).toContain('SG101')
    expect(detail).toContain('/runs/r1/01-validate/skill-lint')
    expect(detail).toContain('[o] open')
    // The unselected finding contributes its summary row and nothing else.
    expect(detail).not.toContain('SG102 ')
  })

  it('moves the detail with the cursor', () => {
    const rows = findingRows([row(), row({ finding: raw({ nativeRuleId: 'SG102' }) })], 1, 100)
    const text = rows.map((r) => r.text).join('\n')
    expect(text).toContain('SG102')
    expect(text).not.toContain('SG101 ·')
  })

  it('names the tool and the stage on the summary row, so a cursor is answerable', () => {
    const rows = findingRows([row()], 0, 100)
    expect(rows[0]?.text).toContain('▸')
    expect(rows[0]?.text).toContain('skill-lint')
  })

  it('shows the suppression justification instead of hiding the finding — R8.15', () => {
    const rows = findingRows(
      [row({ finding: raw({ suppressed: { justification: 'fixed paths' } }) })],
      0,
      100,
    )
    const text = rows.map((r) => r.text).join('\n')
    expect(text).toContain('⊘')
    expect(text).toContain('fixed paths')
  })

  it('is empty for no findings, so the pane can say so without a special case', () => {
    expect(findingRows([], 0, 100)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/tui/findings-pane.test.ts`
Expected: FAIL — `findingRows is not a function`.

- [ ] **Step 3: Add `findingRows()` to `rows.ts`**

```ts
export interface FindingRowView {
  text: string
  /** Set on a summary row, null on a detail row, which carries no state. */
  severity: string | null
  dim: boolean
  key: string
}

/**
 * The Findings pane as a flat row list, detail included, so `outputWindow` can
 * window it and the key handler can clamp against the same count. Expansion
 * being *more rows* rather than a nested box is what keeps §14.1's first rule
 * true by construction: the detail is counted against the allocation, so the
 * list shrinks while a row is open instead of the panel below falling off.
 *
 * One derivation, for the reason `outputWindow` is one function: the pane
 * renders against these rows and `j` clamps against their length, and two
 * copies of that arithmetic is how `j` stops several rows short of the end and
 * every further press does nothing.
 */
export function findingRows(
  rows: readonly FindingRow[],
  selected: number,
  width: number,
): FindingRowView[] {
  const out: FindingRowView[] = []
  rows.forEach((row, index) => {
    const { finding } = row
    const chosen = index === selected
    const suppressed = finding.suppressed !== undefined
    const location = finding.line === undefined ? finding.path : `${finding.path}:${finding.line}`
    out.push({
      text: truncate(
        `${chosen ? '▸' : ' '} ${finding.severity.padEnd(9)}${suppressed ? '⊘ ' : ''}${
          finding.ruleClass
        }  ${location}  ${row.toolId}`,
        width,
      ),
      severity: finding.severity,
      dim: suppressed,
      key: `${index}-summary`,
    })
    if (!chosen) return
    // Indented under the row it belongs to, and truncated like every other
    // content row: a wrapped message spends rows the budget already allocated.
    const detail = [
      `    ${finding.message}`,
      `    ${finding.ruleClass} · ${finding.nativeRuleId} · ${row.stage} · ${row.toolId}`,
      `    ${row.artefactDir}`,
      ...(finding.suppressed === undefined
        ? []
        : [`    ⊘ suppressed: ${finding.suppressed.justification}`]),
      '    [o] open evidence   [y] copy prompt   [r] rerun',
    ]
    detail.forEach((line, offset) => {
      out.push({
        text: truncate(line, width),
        severity: null,
        dim: true,
        key: `${index}-detail-${offset}`,
      })
    })
  })
  return out
}
```

Change `outputTab`'s findings case so the window counts rendered rows, not findings:

```ts
    case 'findings':
      // The detail rows count: the pane renders them and `j` clamps on them.
      return {
        total: findingRows(skill?.findings ?? [], state.selectedFinding, 200).length,
        anchor: 'top',
      }
```

- [ ] **Step 4: Add the cursor to the store**

In `AppState`:

```ts
  /**
   * Which finding the Findings pane has selected (R11.14). A cursor rather than
   * a scroll offset because this pane is a list of things to act on, which is
   * what `SkillList` and Issues already are — `outputOffset` still scrolls the
   * other three tabs.
   */
  selectedFinding: number
```

In `Action`:

```ts
  /** `total` is the caller's because the row count depends on the width. */
  | { type: 'select-finding'; delta: number; total: number }
```

In `initialState`: `selectedFinding: 0,`

The reducer case, plus a reset on the two actions that replace the list:

```ts
    case 'select-finding':
      return {
        ...state,
        selectedFinding: clamp(state.selectedFinding + action.delta, action.total),
        // The window follows the cursor, so a pinned offset would fight it.
        outputOffset: null,
      }
```

In the `select-skill` case, add `selectedFinding: 0` — another skill's findings are another list. In the `run:start` branch of `onRunEvent`, the row's `findings` is already cleared; add `selectedFinding: 0` to the returned state there too.

- [ ] **Step 5: Render through `findingRows()`**

Replace the whole `findings` branch of `OutputPane`'s `Body`:

```tsx
  if (state.panel === 'findings') {
    if (!skill || skill.findings.length === 0) return <Text dimColor>no findings</Text>
    return (
      <Box flexDirection="column">
        {findingRows(skill.findings, state.selectedFinding, cols)
          .slice(view.start, view.end)
          .map((row) => (
            <Text key={row.key} wrap="truncate" dimColor={row.dim}>
              {row.severity === null ? (
                row.text
              ) : (
                <Text color={SEVERITY_COLOUR[row.severity] ?? '#ee0000'}>{row.text}</Text>
              )}
            </Text>
          ))}
        {notice}
      </Box>
    )
  }
```

- [ ] **Step 6: Route `j`/`k` to the cursor in this pane**

In `src/tui/app.tsx`, inside `moveDown`, add a branch before the generic output-scroll branch:

```tsx
  // A list of things to act on takes a cursor, not a scroll offset — the same
  // shape SkillList and Issues already have. The other three tabs still scroll.
  if (state.focus === 'work' && state.panel === 'findings') {
    const total = findingRows(current?.findings ?? [], state.selectedFinding, 200).length
    return { type: 'select-finding' as const, delta, total }
  }
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm vitest run tests/tui/findings-pane.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 8: Prove the pane and the clamp agree, and that the budget holds**

Add to `tests/tui/findings-pane.test.ts`:

```ts
import { initialState, reducer } from '../../src/tui/store.js'
import { outputWindow } from '../../src/tui/rows.js'

it('never lets the cursor leave the window the pane renders', () => {
  const findings = Array.from({ length: 12 }, (_, i) =>
    row({ finding: raw({ nativeRuleId: `SG${i}` }) }),
  )
  let state = { ...initialState([], 2), panel: 'findings' as const }
  state = { ...state, skills: [{ ...({} as never) }] } // replaced below
  // Drive the cursor to the end and assert it stopped at the last row.
  const skill = { findings } as never
  for (let i = 0; i < 40; i += 1) {
    const total = findingRows(findings, state.selectedFinding, 200).length
    state = reducer(state, { type: 'select-finding', delta: 1, total })
  }
  const total = findingRows(findings, state.selectedFinding, 200).length
  const view = outputWindow(state, skill, 10)
  expect(state.selectedFinding).toBeLessThan(total)
  expect(view.end).toBeLessThanOrEqual(total)
})
```

Run: `pnpm vitest run tests/tui/findings-pane.test.ts`
Expected: PASS, 6 tests. If the cursor exceeds `total`, the clamp is reading a different row count than the renderer — which is the exact bug this test exists for. Fix by making both call `findingRows`, never by loosening the assertion.

- [ ] **Step 9: Run the whole suite**

Run: `pnpm lint && pnpm build && pnpm test`
Expected: PASS. `tests/tui/output-pane.test.tsx` asserts the old flat findings rows; update those to the new summary-row shape.

- [ ] **Step 10: Commit**

```bash
git add src/tui/rows.ts src/tui/store.ts src/tui/app.tsx src/tui/components/OutputPane.tsx tests/tui/findings-pane.test.ts tests/tui/output-pane.test.tsx
git commit -m "ui: give the findings pane a cursor and inline evidence"
```

---

### Task 7: `openPath` on the port, and `o` on a finding

**Files:**
- Modify: `src/tui/views.ts:225-235` (`GantryViews`)
- Modify: `src/cli/gantry-views.ts` — implement `openPath`
- Modify: `src/tui/app.tsx` — the `o` binding
- Modify: `tests/helpers/fake-views.ts` — record calls
- Create: `tests/tui/open-evidence.test.tsx`

**Interfaces:**
- Consumes: `FindingRow.artefactDir` (Task 5), `selectedFinding` (Task 6).
- Produces: `GantryViews.openPath(path: string): Promise<void>`; `FakeViews.opened: string[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/tui/open-evidence.test.tsx`. Note the assertion is on the **port**, never on a spawn — `src/tui/**` may not spawn, and that is precisely why this is a port method:

```tsx
import { describe, expect, it } from 'vitest'
import { createQueue, type SkillRef, type ToolRunRecord } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeRun, type FakeRun } from '../helpers/fake-run.js'
import { fakeViews } from '../helpers/fake-views.js'
import { renderInk, waitForFrame } from '../helpers/render-ink.js'

const skill: SkillRef = {
  id: 'declawed',
  name: 'declawed',
  version: '1.0.0',
  dir: '/repo/declawed',
  relPath: 'declawed',
  repo: { id: 'fx', path: '/repo', name: 'fx', isGit: false },
  rootSkill: false,
  workspacePath: '/repo/declawed-workspace',
  deprecated: false,
  supersededBy: null,
}

const ARTEFACT_DIR = '/repo/declawed-workspace/skillgantry/runs/r1/01-validate/skill-lint'

const toolRun: ToolRunRecord = {
  toolId: 'skill-lint',
  toolVersion: '1.0.0',
  outcome: 'failed',
  exitCode: 1,
  durationMs: 10,
  errorKind: null,
  artefactDir: ARTEFACT_DIR,
  findings: [
    {
      ruleClass: 'unsafe-script',
      nativeRuleId: 'SG101',
      severity: 'medium',
      path: 'declawed/scripts/scan.py',
      message: 'shell=True on an interpolated path',
    },
  ],
  metrics: {},
  summary: '1 finding',
}

describe('R11.14 open evidence', () => {
  it('opens the selected finding’s artefact directory through the port', async () => {
    const views = fakeViews()
    const runs = new Map<string, FakeRun>()
    const queue = createQueue({
      concurrency: 1,
      startRun: (job) => {
        const run = fakeRun('r1')
        runs.set(job.jobId, run)
        return run.handle
      },
    })
    const ui = renderInk(
      <App skills={[skill]} queue={queue} stages={['validate']} concurrency={1} views={views} intervalMs={20} />,
      { columns: 110, rows: 30 },
    )
    await ui.settle()
    ui.stdin.send('r')
    await ui.settle(40)
    const run = [...runs.values()][0]
    run?.emit({ type: 'run:start', runId: 'r1', skillId: 'declawed', stages: ['validate'], runDir: '/runs/r1' })
    run?.emit({ type: 'tool:done', runId: 'r1', stage: 'validate', toolId: 'skill-lint', result: toolRun })
    await ui.settle(40)

    // Focus the work zone, open the Findings tab, then act on the finding.
    ui.stdin.send('\t')
    await ui.settle()
    ui.stdin.send('2')
    await waitForFrame(ui, (frame) => frame.includes('unsafe-script'))
    ui.stdin.send('o')
    await ui.settle(40)

    expect(views.opened).toEqual([ARTEFACT_DIR])
    ui.unmount()
    queue.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/tui/open-evidence.test.tsx`
Expected: FAIL — `views.opened` is `undefined`.

- [ ] **Step 3: Declare the method on the port**

In `src/tui/views.ts`, add to `GantryViews`:

```ts
  /**
   * Hands a path to the host's default viewer. On the port and not in the
   * renderer because `src/tui/**` may not spawn — and on `GantryViews` rather
   * than a second port because this interface is already the terminal
   * interface's one injected dependency, and already carries writes in
   * `actOnIssue` and `applyConfig`. It is the TUI's port, not the ledger's.
   */
  openPath(path: string): Promise<void>
```

- [ ] **Step 4: Implement it in `src/cli/gantry-views.ts`**

Add the import and the method:

```ts
import { spawn } from 'node:child_process'
```

```ts
    openPath: async (path) => {
      // Per-platform opener, detached and fully un-piped: the child outlives
      // this call by design, and inheriting our stdio would let it write over
      // the alternate screen Ink owns.
      const command =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'explorer'
            : 'xdg-open'
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, [path], { detached: true, stdio: 'ignore' })
        child.once('error', reject)
        // Resolved on spawn rather than on exit: `open` returns immediately on
        // macOS but `xdg-open` can block for the lifetime of the viewer, and a
        // promise the TUI awaits must not be held open by a file manager.
        child.once('spawn', () => {
          child.unref()
          resolve()
        })
      })
    },
```

- [ ] **Step 5: Record it on the fake**

In `tests/helpers/fake-views.ts`, add to `FakeViews`:

```ts
  /** Paths the screens asked the host to open, in order. */
  readonly opened: string[]
```

And in `fakeViews()`, before the spread of `overrides`:

```ts
  const opened: string[] = []
```

```ts
    opened,
    openPath: async (path) => {
      opened.push(path)
    },
```

- [ ] **Step 6: Bind `o` in `app.tsx`**

Place it inside the Work-screen block, after the `S` binding and before `y`. It must be gated on the Findings pane, so the Issues tab's `o` stays unbound (R11.13):

```tsx
    if (plain && input === 'o' && state.panel === 'findings' && state.focus === 'work') {
      const chosen = current?.findings[state.selectedFinding]
      if (!chosen) {
        dispatch({ type: 'flash', message: 'no finding selected' })
        return
      }
      const shown = truncateMiddle(
        chosen.artefactDir,
        Math.max(20, innerWidth(layout.columns, layout.chrome) - 12),
      )
      void views.openPath(chosen.artefactDir).then(
        () => dispatch({ type: 'flash', message: `opened · ${shown}` }),
        // Named, never swallowed: a viewer that is not installed is a thing the
        // user can fix, and a silent `o` is one they cannot.
        (err: unknown) => dispatch({ type: 'flash', message: `${(err as Error).message} · ${shown}`, tone: 'bad' }),
      )
      return
    }
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm vitest run tests/tui/open-evidence.test.tsx`
Expected: PASS, 1 test.

- [ ] **Step 8: Run the whole suite**

Run: `pnpm lint && pnpm build && pnpm test`
Expected: PASS. `pnpm build` will fail on any other `GantryViews` implementation missing `openPath` — there should be exactly one (`createGantryViews`) plus the fake. `pnpm lint` must stay clean: the `spawn` import is in `src/cli/`, which is allowed, and would fail the boundary rule if it drifted into `src/tui/` or `src/core/adapters/`.

- [ ] **Step 9: Commit**

```bash
git add src/tui/views.ts src/cli/gantry-views.ts src/tui/app.tsx tests/helpers/fake-views.ts tests/tui/open-evidence.test.tsx
git commit -m "ui: open a finding's artefact directory through the host"
```

---

### Task 8: `y` copies the selected finding's stage

**Files:**
- Modify: `src/tui/app.tsx:540-579` (the `y` handler)
- Modify: `tests/tui/fix-prompt-key.test.tsx` — add the retarget case

**Interfaces:**
- Consumes: `FindingRow.stage` (Task 5), `selectedFinding` (Task 6).
- Produces: no new exports. Behaviour only.

- [ ] **Step 1: Write the failing test**

Add to `tests/tui/fix-prompt-key.test.tsx`, following the existing harness in that file:

```tsx
it('copies the stage that produced the selected finding, whatever the rail points at — R11.9 as amended', async () => {
  // A run whose security stage found something while the rail sits on Validate.
  // Before the amendment this reported "validate found nothing — no prompt".
  const { ui, run, promptPaths } = await harnessWithFinding({ stage: 'security' })
  ui.stdin.send('\t')          // focus the work zone
  await ui.settle()
  ui.stdin.send('2')           // Findings tab
  await waitForFrame(ui, (frame) => frame.includes('unsafe-script'))
  expect(ui.lastFrame()).toMatch(/▸\s*Validate/)   // the rail has not moved
  ui.stdin.send('y')
  await ui.settle(40)

  expect(promptPaths).toHaveLength(1)
  expect(promptPaths[0]).toContain('03-security')
  ui.unmount()
  run.close()
})
```

Build `harnessWithFinding` beside the file's existing harness. It must write a real fix prompt to disk, because `readFixPrompt` reads one — reuse `tests/helpers/tmp-repo.ts`'s `makeRepo()` and `claimRunDir`/`stageDirFor` the way `tests/tui/work-screen.test.tsx` already does, then emit a `tool:done` for `security` carrying one finding.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/tui/fix-prompt-key.test.tsx`
Expected: FAIL — no prompt is copied, and the flash reads `validate found nothing — no prompt`, because `y` still reads `STAGE_ORDER[state.selectedStage]`.

- [ ] **Step 3: Retarget the stage**

In `src/tui/app.tsx`, replace the stage resolution at the top of the `y` handler and rewrite the comment, which currently asserts the attribution is impossible:

```tsx
    if (plain && input === 'y') {
      if (!current) return
      // R11.9 as amended: the stage that produced the *selected finding* when the
      // Findings pane holds one, and the rail's stage otherwise. §14.3 recorded
      // that a finding "cannot be attributed to a stage at all" — Task 5's
      // `FindingRow` is that attribution, so a user acting on a finding no
      // longer has to move the rail to the stage that found it. §9.4 still
      // writes one prompt per stage, so what is copied is still a stage's.
      const chosen =
        state.panel === 'findings' ? current.findings[state.selectedFinding] : undefined
      const stage = chosen?.stage ?? (STAGE_ORDER[state.selectedStage] as Stage)
      const flash = (message: string) => dispatch({ type: 'flash', message })
```

The rest of the handler is unchanged: it already reads `current.stages[stage].findings` for the "found nothing" case and calls `fixPromptPathFor(current.runDir, stage)`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/tui/fix-prompt-key.test.tsx`
Expected: PASS — every existing case in the file plus the new one. The existing cases exercise the rail fallback, which is why they must keep passing unchanged.

- [ ] **Step 5: Run the whole suite**

Run: `pnpm lint && pnpm build && pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tui/app.tsx tests/tui/fix-prompt-key.test.tsx
git commit -m "ui: copy the fix prompt of the stage that found the selected finding"
```

---

### Task 9: The Overview card and its height-driven tiers

**Files:**
- Modify: `src/tui/layout.ts` — `overview` on `Layout`, `SKILL_LIST_MIN`
- Modify: `src/tui/rows.ts` — `bar()`, `overviewRows()`
- Create: `src/tui/components/Overview.tsx`
- Modify: `src/tui/components/Work.tsx` — render the card in `SideBySide`
- Modify: `src/tui/app.tsx` — the `0` binding, and the launch-time dashboard load
- Create: `tests/tui/overview.test.tsx`

**Interfaces:**
- Consumes: `Panel` with required width (Task 2), `ACCENT`/`OUTCOME_COLOUR` (Task 1).
- Produces:
  - `Layout.overview: 'full' | 'compact' | 'none'`
  - `export const SKILL_LIST_MIN = 6`
  - `export function bar(rate: number, cells: number): string`
  - `export function overviewRows(stats: DashboardStats | null, tier: 'full' | 'compact', width: number): ScreenRow[]`
  - `export function Overview({ stats, tier, width, chrome }): React.ReactElement`

- [ ] **Step 1: Write the failing test**

Create `tests/tui/overview.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { MIN_COLUMNS, MIN_ROWS, layoutFor, SKILL_LIST_MIN } from '../../src/tui/layout.js'
import { bar, overviewRows } from '../../src/tui/rows.js'
import { emptyDashboard } from '../helpers/fake-views.js'

const stats = {
  ...emptyDashboard,
  repos: 1,
  skills: 18,
  runs: 21,
  stagePassRates: [
    { stage: 'validate' as const, runs: 9, passed: 8, rate: 8 / 9 },
    { stage: 'evaluate' as const, runs: 7, passed: 2, rate: 2 / 7 },
    { stage: 'security' as const, runs: 14, passed: 3, rate: 3 / 14 },
  ],
  openBySeverity: [
    { severity: 'high' as const, count: 1 },
    { severity: 'low' as const, count: 4 },
  ],
}

describe('R11.12 Overview card', () => {
  it('draws a proportional bar with the DESIGN.md glyphs', () => {
    expect(bar(0, 10)).toBe('▕░░░░░░░░░░▏')
    expect(bar(1, 10)).toBe('▕██████████▏')
    expect(bar(0.5, 10)).toBe('▕█████░░░░░▏')
  })

  it('full names every stage, the issue mix and the way to the dashboard', () => {
    const rows = overviewRows(stats, 'full', 28).map((row) => row.text)
    const text = rows.join('\n')
    expect(text).toContain('validate')
    expect(text).toContain('89%')
    expect(text).toContain('1 high')
    expect(text).toContain('0 dashboard')
  })

  it('compact is the bars alone', () => {
    const rows = overviewRows(stats, 'compact', 28).map((row) => row.text)
    expect(rows).toHaveLength(3)
    expect(rows.join('\n')).not.toContain('dashboard')
  })

  it('leaves the skill list at or above its minimum at every size', () => {
    for (let rows = MIN_ROWS; rows <= 60; rows += 1) {
      for (const columns of [MIN_COLUMNS, 80, 110, 200]) {
        const layout = layoutFor(columns, rows)
        if (layout.mode !== 'standard' || layout.overview === 'none') continue
        expect(layout.skillRows).toBeGreaterThanOrEqual(SKILL_LIST_MIN)
      }
    }
  })

  it('returns the rows it gives up when the tier shrinks', () => {
    // Same width, one row shorter at a tier boundary: the list must not lose
    // rows to a card that just got smaller.
    let previous: { rows: number; tier: string; skillRows: number } | null = null
    for (let rows = MIN_ROWS; rows <= 60; rows += 1) {
      const layout = layoutFor(110, rows)
      if (layout.mode !== 'standard') continue
      if (previous && previous.tier !== layout.overview && layout.overview === 'none') {
        expect(layout.skillRows).toBeGreaterThan(previous.skillRows)
      }
      previous = { rows, tier: layout.overview, skillRows: layout.skillRows }
    }
  })

  it('never shows the card in narrow, which has no column to put it in', () => {
    expect(layoutFor(60, 40).overview).toBe('none')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/tui/overview.test.tsx`
Expected: FAIL — `bar is not a function` and `layout.overview` is `undefined`.

- [ ] **Step 3: Add the tier decision to `layout.ts`**

Add the constants and the field:

```ts
/**
 * Rows the skill list keeps whatever else wants them. Six because the list is
 * the screen's primary navigation and a four-row list of 18 skills scrolls on
 * every keypress; the card is a summary and can be absent.
 */
export const SKILL_LIST_MIN = 6

/** Body rows each tier renders, before `Panel`'s two rows of chrome. */
const OVERVIEW_ROWS = { full: 6, compact: 3, none: 0 } as const
```

Add to `Layout`:

```ts
  /**
   * R11.12. Which tier of the Overview card fits, chosen from the rows left
   * after `SKILL_LIST_MIN` — rows and not a width band, because the card
   * competes for the left column's *height*: a 200x20 terminal has cells to
   * spare and nothing to give.
   */
  overview: 'full' | 'compact' | 'none'
```

Return `overview: 'none'` from the `too-small` branch, then compute it in the main branch, after `outputHeight`:

```ts
  // The left column is as tall as the right one defines, and the card takes its
  // tier plus Panel's two rows out of that.
  const leftColumn = narrow ? 0 : outputHeight + 2
  const overview: Layout['overview'] = narrow
    ? 'none'
    : (['full', 'compact'] as const).find(
        (tier) => leftColumn - (OVERVIEW_ROWS[tier] + 2) >= SKILL_LIST_MIN,
      ) ?? 'none'
```

And make `skillRows` account for it:

```ts
    skillRows: narrow ? skillRows : leftColumn - (OVERVIEW_ROWS[overview] + (overview === 'none' ? 0 : 2)),
```

- [ ] **Step 4: Add `bar()` and `overviewRows()` to `rows.ts`**

```ts
/**
 * A proportional bar in the `DESIGN.md` §8 glyphs. Rounded rather than floored
 * so a rate just under a tenth still shows one cell — a 9% pass rate rendering
 * as an empty bar reads as "no runs", which is a different fact.
 */
export function bar(rate: number, cells: number): string {
  const filled = Math.round(Math.max(0, Math.min(1, rate)) * cells)
  return `▕${'█'.repeat(filled)}${'░'.repeat(cells - filled)}▏`
}

/**
 * The Overview card's body, as the same flat `ScreenRow` list `dashboardRows`
 * emits, so §14.1's first rule holds by construction: the component renders
 * exactly the rows its tier was allocated. `layoutFor` chose the tier; this
 * only fills it.
 */
export function overviewRows(
  stats: DashboardStats | null,
  tier: 'full' | 'compact',
  width: number,
): ScreenRow[] {
  const rows: ScreenRow[] = []
  const line = (text: string, extra: Omit<ScreenRow, 'text'> = {}): void => {
    rows.push({ text: truncate(text, width), ...extra })
  }
  if (stats === null) {
    line('loading…', { dim: true })
    return rows
  }
  if (stats.runs === 0) {
    line('no runs recorded yet', { dim: true })
    return rows
  }

  // Bar cells from the width rather than a constant: a 26-cell column and a
  // 34-cell one are both inside §14.1's standard band.
  const cells = Math.max(6, Math.min(10, width - 18))
  for (const row of stats.stagePassRates) {
    line(
      `${row.stage.slice(0, 8).padEnd(8)} ${bar(row.rate, cells)} ${pct(row.rate).padStart(4)}`,
      { colour: OUTCOME_COLOUR[row.rate >= 0.6 ? 'passed' : row.rate >= 0.25 ? 'errored' : 'failed'] },
    )
  }
  if (tier === 'compact') return rows

  line(
    stats.openBySeverity.length === 0
      ? 'no open issues'
      : stats.openBySeverity.map((row) => `${row.count} ${row.severity}`).join(' · '),
    { dim: true },
  )
  const slowest = [...stats.wallClock].sort((a, b) => (b.medianMs ?? 0) - (a.medianMs ?? 0))[0]
  line(slowest === undefined ? '' : `median ${slowest.stage} ${humanMs(slowest.medianMs)}`, {
    dim: true,
  })
  line('0  full dashboard →', { colour: ACCENT })
  return rows
}
```

Import `ACCENT` and `DashboardStats` at the top of `rows.ts` if they are not already there.

- [ ] **Step 5: Create the component**

Create `src/tui/components/Overview.tsx`:

```tsx
import { Text } from 'ink'
import type { DashboardStats } from '../../core/index.js'
import { innerWidth } from '../layout.js'
import { overviewRows } from '../rows.js'
import { Panel } from './Panel.js'

export interface OverviewProps {
  stats: DashboardStats | null
  tier: 'full' | 'compact'
  width: number
  chrome: 'boxed' | 'bare'
}

/**
 * R11.12. Unfocused always: the card is a read-only summary with no cursor, so
 * giving it a focus stop would put a stop on the Tab cycle that answers no key
 * — which is the cost R11.11 removed a stop to avoid.
 */
export function Overview({ stats, tier, width, chrome }: OverviewProps): React.ReactElement {
  const cols = Math.max(8, innerWidth(width, chrome))
  return (
    <Panel title="Overview" hint="every repo" focused={false} chrome={chrome} width={width}>
      {overviewRows(stats, tier, cols).map((row, index) => (
        <Text
          key={`${index}-${row.text}`}
          wrap="truncate"
          dimColor={row.dim === true}
          {...(row.colour === undefined ? {} : { color: row.colour })}
        >
          {row.text}
        </Text>
      ))}
    </Panel>
  )
}
```

- [ ] **Step 6: Render it in `SideBySide`**

In `src/tui/components/Work.tsx`, wrap the `SkillList` in a column and add the card below it:

```tsx
      <Box flexDirection="column" width={layout.skillListWidth} flexShrink={0}>
        <SkillList
          skills={state.skills}
          selected={state.selectedSkill}
          marked={state.markedSkills}
          focused={state.focus === 'skills'}
          width={layout.skillListWidth}
          height={layout.skillRows}
          chrome={layout.chrome}
        />
        {layout.overview !== 'none' && (
          <Overview
            stats={state.dashboard}
            tier={layout.overview}
            width={layout.skillListWidth}
            chrome={layout.chrome}
          />
        )}
      </Box>
```

`Stacked` is unchanged — narrow has no left column, and `layoutFor` returns `'none'` there.

- [ ] **Step 7: Load the stats, and bind `0`**

In `src/tui/app.tsx`, the existing dashboard effect loads only while `state.screen === 'dashboard'`. Widen its condition so the card has data on Work:

```tsx
    if (state.screen !== 'dashboard' && state.screen !== 'work') return
```

Add the `0` binding inside the Work block, beside the digit guard. It goes to the existing screen, not to a modal — R11.3 requires the screen to exist and `esc` already returns to Work:

```tsx
    if (plain && input === '0') {
      dispatch({ type: 'set-screen', screen: 'dashboard' })
      return
    }
```

Add `0 overview` to nothing: `HINTS` in `Work.tsx` is already seven pairs at 67 columns, and an eighth truncates the tail, which is `q quit`. The card names the key itself on its last row, which is the tier that has the room for it.

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm vitest run tests/tui/overview.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 9: Prove the frame still fits at both floors**

Add to `tests/tui/overview.test.tsx`:

```tsx
import { Work } from '../../src/tui/components/Work.js'
import { initialState } from '../../src/tui/store.js'
import { renderInk } from '../helpers/render-ink.js'

it('renders inside the terminal at 80x24 and at 50x14', () => {
  for (const [columns, rows] of [[80, 24], [50, 14], [110, 34]] as const) {
    const ui = renderInk(<Work state={{ ...initialState([], 2), dashboard: stats }} />, { columns, rows })
    const frame = ui.lastFrame()
    ui.unmount()
    const lines = frame.split('\n').filter((line) => line.length > 0)
    expect(lines.length).toBeLessThanOrEqual(rows)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(columns)
  }
})
```

Run: `pnpm vitest run tests/tui/overview.test.tsx`
Expected: PASS, 8 tests. A row count over the terminal's means the card is not paying for itself out of `skillRows` — fix the `skillRows` arithmetic in Step 3, never by shrinking the assertion.

- [ ] **Step 10: Run the whole suite and the acceptance pass**

Run: `pnpm lint && pnpm build && pnpm test`
Expected: PASS. `tests/tui/layout.test.tsx` asserts frame budgets and will need its expected `skillRows` updated for the sizes where a card now appears.

Then run the full gate once, since this is the last task:

Run: `pnpm check`
Expected: PASS — lint, build, test and acceptance. `pnpm acceptance` drives the real CLI and does not render the TUI, so it should be unaffected; a failure there means something in this milestone reached outside `src/tui/`.

- [ ] **Step 11: Commit**

```bash
git add src/tui/layout.ts src/tui/rows.ts src/tui/components/Overview.tsx src/tui/components/Work.tsx src/tui/app.tsx tests/tui/overview.test.tsx tests/tui/layout.test.tsx
git commit -m "ui: show stage pass rates beside the skill list in height-driven tiers"
```

---

### Task 10: One selected row, one highlight — padded reverse video

**Files:**
- Modify: `src/tui/rows.ts` — `issueRows()` and `findingRows()` pad the selected row
- Modify: `src/tui/components/SkillList.tsx:71-87` — inverse instead of bold alone
- Modify: `src/tui/components/OutputPane.tsx` — apply `inverse` on a selected row
- Modify: `src/tui/components/Issues.tsx` — same
- Create: `tests/tui/selection.test.tsx`

**Interfaces:**
- Consumes: `IssueRowView.selected` (Task 4), `FindingRowView` (Task 6), `padCells` (already in `layout.ts:170`).
- Produces: `FindingRowView` gains `selected: boolean`. No other new exports.

This is R11.15's second clause, and it is last because it is the one purely visual change — the eight tasks before it are behavioural and none depends on it. It changes all three lists **together** on purpose: one list highlighting differently from the other two is worse than three consistent cursors, which is the state the milestone would ship in if this were deferred.

- [ ] **Step 1: Write the failing test**

Create `tests/tui/selection.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/tui/selection.test.tsx`
Expected: FAIL — `rows[0].text.length` is the truncated content length, not 90.

- [ ] **Step 3: Pad the selected row in both builders**

In `rows.ts`, import `padCells` from `./layout.js`. In `issueRows`, replace the returned `text`:

```ts
      // Padded only when selected: reverse video covers the characters
      // rendered, so a short selected row highlights a stub instead of a band
      // (R11.15). An unselected row has no attribute to stretch.
      text: index === selected ? padCells(truncate(text, width), width) : truncate(text, width),
```

In `findingRows`, add `selected` to `FindingRowView` and do the same for the summary row:

```ts
export interface FindingRowView {
  text: string
  severity: string | null
  dim: boolean
  selected: boolean
  key: string
}
```

```ts
    const summary = `${chosen ? '▸' : ' '} ${finding.severity.padEnd(9)}${
      suppressed ? '⊘ ' : ''
    }${finding.ruleClass}  ${location}  ${row.toolId}`
    out.push({
      text: chosen ? padCells(truncate(summary, width), width) : truncate(summary, width),
      severity: finding.severity,
      dim: suppressed,
      selected: chosen,
      key: `${index}-summary`,
    })
```

The detail rows keep `selected: false` — they belong to the selection but are not it, and inverting six rows makes the pane a block of colour rather than a highlighted row.

- [ ] **Step 4: Apply `inverse` in the three components**

`SkillList.tsx` — replace the row `Text` and its comment, which currently records why it did *not* do this:

```tsx
        // Reverse video over a padded label, not bold alone. The earlier note
        // here said an inverse block "only covers the label, so a short name
        // left the highlight ragged" — true, and `padCells` is the fix rather
        // than a reason to go without (R11.15).
        const label = `${index === selected ? '▸' : ' '}${
          marked.includes(skill.skillId) ? '*' : ' '
        }`
        return (
          <Text key={skill.skillId} wrap="truncate" inverse={index === selected} bold={index === selected}>
            {label}
            <Text color={OUTCOME_COLOUR[skill.status] ?? '#555555'}>
              {skill.status === 'running' ? TURNING[tick % TURNING.length] : MARK[skill.status]}
            </Text>{' '}
            {index === selected
              ? padCells(truncate(skill.label, labelWidth), labelWidth)
              : truncate(skill.label, labelWidth)}
          </Text>
        )
```

`OutputPane.tsx`, findings branch — add `inverse={row.selected}`.
`OutputPane.tsx`, issues branch — add `inverse={row.selected}`.
`Issues.tsx` — add `inverse={row.selected}` beside the existing `bold={row.selected}`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tests/tui/selection.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 6: Run the whole suite**

Run: `pnpm lint && pnpm build && pnpm test`
Expected: PASS. Frame assertions that match on a skill name with a regex like `/›\s*[○◐●!×]\s*spec-lint/` need their cursor glyph changed from `›` to `▸`; `renderInk`'s `debug: true` writes text, not ANSI, so the `inverse` attribute itself does not appear in a frame and no assertion needs to account for it.

- [ ] **Step 7: Commit**

```bash
git add src/tui/rows.ts src/tui/components/SkillList.tsx src/tui/components/OutputPane.tsx src/tui/components/Issues.tsx tests/tui/selection.test.tsx tests/tui/work-screen.test.tsx
git commit -m "ui: highlight a selected row with padded reverse video"
```

---

### Task 11: Flip the index status and record the deviations

**Files:**
- Modify: `docs/specs/index.md` — add the `plan-m7.md` row
- Modify: this file — fill in the Deviations section

**Interfaces:**
- Consumes: everything above.
- Produces: nothing consumed by code.

- [ ] **Step 1: Flip the catalogue status**

The `plan-m7.md` row was added to `index.md` when this plan was written, because `index.md` is the only catalogue of the spec tree and a plan absent from it is an orphan `spec-lint` reports. All that is left is its Status:

```
| [plan-m7.md](plan-m7.md) | M7 | Planned | …
                                  ^^^^^^^  ->  Shipped
```

- [ ] **Step 2: Verify the traceability gate still holds**

Run: `pnpm vitest run tests/specs/traceability.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 3: Fill in the Deviations section below**

Write down every place the implementation diverged from §14.6, and amend `design.md` in the same branch rather than letting the two drift — that is this repo's standing rule, not a nicety.

Two things to check specifically, because both are places this plan reasoned from the box model rather than from a rendered frame:

1. `Panel`'s `furniture` constant (Task 2). If it moved, §14.6's description of the title row is wrong and needs the real shape.
2. `layoutFor`'s tier boundaries (Task 9). If `SKILL_LIST_MIN` or `OVERVIEW_ROWS` moved, R11.12's *Verify* clause still holds — it is deliberately property-based — but §14.6 names `full` as "three bars plus the issue summary, the medians and the dashboard link", which is a row count and would be wrong.

- [ ] **Step 4: Commit**

```bash
git add docs/specs/index.md docs/specs/plan-m7.md docs/specs/design.md
git commit -m "docs: catalogue plan-m7 and record its deviations"
```

---

## Deviations found while implementing

*Filled in during Task 10. Empty until then.*

---

## Self-Review

Run against the spec after writing this plan.

**Spec coverage.** Every requirement maps to a task:

| Requirement | Task |
|---|---|
| R11.11 three zones, keys scoped | 3 |
| R11.12 Overview card, tiers, layout-decided | 9 |
| R11.13 Issues tab, scope cycle, no transitions, one row builder | 4 |
| R11.14 stage and tool per finding, cursor, detail, open key, no fixer | 5, 6, 7 |
| R11.15 no body fg, no bg | 1 |
| R11.15 padded reverse video on the selected row | 10 |
| R11.9 amended — `y` follows the selected finding's stage | 8 |
| §14.6 titled border, `BOXED_CHROME` 9, width required | 2 |

The first pass of this review found R11.15's reverse-video clause with no task, while M7's exit criteria in the ownership table names it — "a selected row's reverse-video band spans the pane's inner width". Deferring it would have shipped a milestone that could not meet its own exit criteria, so it is Task 10 rather than a follow-up. It is last because it is the only purely visual task and nothing depends on it.

**One thing a reviewer will notice and should not change.** `ScreenRow.colour` is `string | undefined` and `overviewRows` fills it from `OUTCOME_COLOUR`, which returns hex after Task 1 — as does `dashboardRows`, unchanged. Both are correct: Task 1 changed the map, not its call sites.

**Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N". Every code step carries the actual code. Task 8's `harnessWithFinding` is the one helper described rather than written out — it is a variation on the harness already in that file, and writing a second copy of a 40-line fixture into this plan would invite the implementer to duplicate rather than reuse it. The step names the three existing helpers to build it from.

**Type consistency.** Checked across tasks: `FindingRow` is defined once (Task 5) and consumed by name in Tasks 6, 7 and 8. `findingRows(rows, selected, width)` has one signature, used identically in `rows.ts`, `OutputPane` and `app.tsx`'s `moveDown`. `issueRows(rows, selected, width)` likewise across `Issues.tsx` and `OutputPane`. `FindingRowView` gains `selected` in Task 10 and `IssueRowView` carries it from Task 4 — the first draft of Task 4 had `Issues.tsx` recover the selection with `row.text.startsWith('▸')`, which breaks the moment the cursor glyph changes and would have broken in Task 10 when the row gets padded; it is a flag on the view instead. `Layout.overview` is `'full' | 'compact' | 'none'` in `layout.ts`, and `Overview`'s prop is the narrower `'full' | 'compact'` because `Work.tsx` guards on `!== 'none'` before rendering it — deliberate, and the guard is in Step 6.

**One thing the plan assumes and the implementer should verify at Task 2, Step 6.** `Panel`'s `fill` arithmetic is written from the box model, not measured. If the first frame shows a top border one cell wide or narrow, adjust `furniture` — the assertion in Step 1's second case (`top.length === bottom.length === 40`) is what catches it, and it is deliberately an equality rather than a range.
