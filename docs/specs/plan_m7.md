# M7 — Work Screen Overhaul Implementation Plan

**Status:** shipped, compacted post-implementation.
**Goal:** Made the Work screen answer the daily loop end to end — act on a finding, see the statistics, and have every movement key belong to a focus zone — without leaving the screen or breaking the 80×24 floor.

**Architecture:** Everything landed in `src/tui/**` plus one new `GantryViews` method implemented in `src/cli/gantry-views.ts`. No core contract moved: the two fields that give a finding its stage and its tool were already on the `tool:done` event. Pure row-builders in `rows.ts` and pure tier selection in `layout.ts` kept every new decision assertable without rendering Ink.

## Specification

Layer 1: [requirements.md](requirements.md) R11.11–R11.15, plus R11.9 as amended.
Layer 2: [design.md §14.6](design.md), plus the in-place corrections to §14, §14.1 and §14.3.
Decisions: [decision-log.md §11](decision-log.md), D20–D23.

Spec committed at `54a1669` on `feat/m7-work-screen-overhaul`.

## Global Constraints

Everything in prior plans' Global Constraints still holds. These are the additions that shaped every M7 task: §14.1's row-budget rules (every panel renders exactly the rows it was allocated; text truncates, never wraps; chrome costs are `layout.ts`'s to know), the 80×24 floor with hard minimum 50×14, R11.15's colour prohibition (no body foreground, no background, anywhere in `src/tui/**`), and `exactOptionalPropertyTypes` requiring conditional spreads rather than explicit `undefined`.

## Task Order and Why

Task 2 comes before Task 9 because the Overview card is *funded* by the two rows the titled border gives back — building the card first would overflow 80×24. Task 5 comes before Task 6 because the Findings cursor renders fields Task 5 adds. Everything else is independent.

## Critical Files — Summary

| Path | Role |
|---|---|
| `src/tui/tokens.ts` | D23 hex palette: `ACCENT`, `SEVERITY_COLOUR`, `OUTCOME_COLOUR`, `JOB_COLOUR` |
| `src/tui/components/Panel.tsx` | Titled top border, discriminated `PanelProps` requiring `width` with `title` |
| `src/tui/layout.ts` | `BOXED_CHROME` 10, `Layout.overview` tier, `SKILL_LIST_MIN` |
| `src/tui/store.ts` | Three focus zones, `FindingRow`, `issueScope`, `selectedFinding`, `PANELS` with `issues` |
| `src/tui/rows.ts` | `issueRows()`, `findingRows()`, `bar()`, `overviewRows()` |
| `src/tui/app.tsx` | Scoped keys per zone, `o`/`y` retargeting, `0` binding, issues tab effect |
| `src/tui/views.ts` | `GantryViews.openPath`, `FindingRow` on `LastRunStage` |
| `src/tui/components/Overview.tsx` | New component for the R11.12 stage pass-rate card |
| `src/tui/components/Work.tsx` | Overview card in `SideBySide`, three-zone focused props |
| `src/tui/components/OutputPane.tsx` | Issues tab, findings cursor with inline detail, `FindingRow` reads |
| `src/tui/components/Issues.tsx` | Renders through shared `issueRows()` |
| `src/tui/components/SkillList.tsx` | Padded reverse-video selection |
| `src/cli/gantry-views.ts` | `openPath` via per-platform detached `spawn` |
| `tests/tui/tokens.test.ts` | D23 palette assertions and `backgroundColor` absence guard |
| `tests/tui/panel.test.tsx` | Titled border, chrome budget, corner alignment |
| `tests/tui/focus-zones.test.tsx` | Three-zone cycle, scoped keys |
| `tests/tui/finding-attribution.test.ts` | `FindingRow` populated from `tool:done` |
| `tests/tui/findings-pane.test.ts` | Cursor, inline detail, window/clamp agreement |
| `tests/tui/open-evidence.test.tsx` | `openPath` through the port |
| `tests/tui/overview.test.tsx` | Tier selection, bar arithmetic, frame fit at both floors |
| `tests/tui/selection.test.tsx` | Padded reverse-video width |

---

## Tasks

### Task 1: Repalette `tokens.ts`, and prove no surface is painted

Replaced every named-ANSI colour constant with the D23 hex palette (R11.15). `ACCENT` moved from `'cyan'` to `'#0070f3'`; severity, outcome and job-state maps moved to hex triples. A test guards that no `backgroundColor` appears anywhere in `src/tui/` and that every exported colour is a hex triple.

### Task 2: `Panel` draws its own titled top border

Rewrote `Panel.tsx` so a titled boxed panel embeds its heading in the `┌─ title hint ─┐` border row instead of spending a body row on it. `BOXED_CHROME` dropped from 11 to 10, recovering one row for the layout budget. `width` became required when `title` is set (discriminated union on `PanelProps`) — the compiler catches a missing call site instead of a user catching a torn corner. Seven call sites updated.

### Task 3: Three focus zones, and every movement key scoped to one

Collapsed four focus stops to three — `skills`, `work`, `queue` — because the rail and the output pane were never ambiguous (R11.11). Scoped `h`/`l` to the work zone, `space` to skills and work, `x` to queue. A key with no meaning in the focused zone now does nothing.

### Task 4: Issues as a fifth output tab, over one shared row builder

Added `issueRows()` in `rows.ts` and used it from both the Issues screen and the new `issues` tab on the output pane (R11.13). Added `issueScope` (`skill` / `repo` / `all`) cycled by `S`. No issue state transitions on the tab — those stay on the Issues screen. `PANELS` became five entries; digit keys extended to `1`–`5`.

### Task 5: A finding carries its stage, its tool and its artefact directory

Introduced `FindingRow` wrapping `RawFinding` with `stage`, `toolId` and `artefactDir`, populated from the `tool:done` event the reducer already had in hand. The same shape is used for live and rehydrated runs via `LastRunStage`, so a rehydrated finding can open its evidence the way a live one does.

### Task 6: The Findings pane gets a cursor and inline detail

Added `findingRows()` producing a flat row list with detail rows inline under the selected finding — message, rule class, native rule id, artefact directory, suppression justification (R11.14). Detail rows count against the allocation (§14.1). The cursor clamps against findings count; the window clamps against rendered-row count — these are two numbers, and the plan's conflation of them was deviation 4.

### Task 7: `openPath` on the port, and `o` on a finding

Declared `GantryViews.openPath(path)` so the TUI can open a finding's artefact directory without spawning (the TUI boundary forbids it). Implemented with a per-platform detached `spawn` in `src/cli/gantry-views.ts`, resolved on spawn rather than on exit so `xdg-open` does not hold the promise. `o` on the Findings pane opens the selected finding's directory; the flash names the path on success or the error on failure.

### Task 8: `y` copies the selected finding's stage

Retargeted the `y` key so it copies the fix prompt of the stage that produced the selected finding, rather than always using the rail's position (R11.9 as amended). Falls back to the rail's stage when the Findings pane has no selection. The existing `y` test cases exercise the rail fallback and keep passing unchanged.

### Task 9: The Overview card and its height-driven tiers

Added `Layout.overview` (`full` / `compact` / `none`) chosen by `layoutFor` from the rows left after `SKILL_LIST_MIN` (R11.12). `overviewRows()` builds stage pass-rate bars, open-issue counts, median timing and a dashboard link. The `Overview` component is unfocused always — no cursor, no focus stop — so it adds no cost to the Tab cycle. `0` navigates to the full Dashboard screen. The card is absent in narrow mode, which has no column to put it in.

### Task 10: One selected row, one highlight — padded reverse video

Applied `inverse` on the selected row in all three lists (SkillList, Findings, Issues) and padded the row to its pane width with `padCells` so the reverse-video band spans the full width (R11.15). Purely visual, last because nothing depends on it. Also moved every list from the `›` cursor glyph to `▸`.

### Task 11: Flip the index status and record the deviations

Updated `index.md` to `Shipped`, filled in the deviations section below, amended `design.md` for the four deviations that contradicted it.

---

## Requirement coverage for M7

Every requirement M7 owns, and the task that satisfies it.

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

## Deviations found while implementing

Every one below came out of measuring a rendered frame instead of reasoning from the box model. The Self-Review predicted that for Tasks 2 and 9. `design.md` is amended in this branch for the four that contradict it.

**1. `Panel`'s furniture is five cells, not six with a `+2` (Task 2).** The plan's `fill = width - used - furniture + 2` made the title row 41 cells wide in a 40-cell panel, so `wrap="truncate"` ate the `┐`. The row is `┌`, `─`, space, label, space, `┐`: five cells that are never the label, so `fill = width - used - 5`. The widths are also measured through `string-width` rather than `.length`: one code unit of disagreement is the torn corner the required `width` exists to prevent, and a CJK title is two cells per unit. §14.6 amended.

**2. `BOXED_CHROME` is 10, not 9 (Task 2).** The plan's premise, "Skills and Queue each stopped spending a body row, and those two rows fund the card", is half right. Only `QueuePanel` is on the frame's vertical path; `SkillList` sits in the *left* column beside the rail, so its row is left-column slack, not a row off the frame's height. At 9 the frame rendered 25 rows into an 80×24 terminal. `layoutFor(80, 24).outputHeight` is therefore 12, not 13. The card is still funded — by the left column's slack plus the one row `outputHeight` gained. §14.1 and §14.6 amended.

**3. The output pane's tab strip had to stop being a flex row (Task 4).** A fifth tab took the strip to 54 cells at a two-cell gap, and a flex row of `flexShrink={0}` boxes overflows its container sideways instead of cutting — §14.1's second rule broken by the one row that names every other. It is now a single `wrap="truncate"` row at a one-cell gap, which fits all five names whole at the 50-column floor.

**4. The findings cursor and the findings *window* are two numbers (Task 6).** The plan clamped `selectedFinding` against `findingRows(...).length`, but that counts rendered rows (summaries plus the selected finding's detail), so the cursor ran past the last finding. It clamps against `findings.length`; the row count stays what `outputWindow` windows on. And `outputOffset: null` does not make the window follow the cursor: `anchor: 'top'` pins it at row 0, so a cursor on finding 11 of 12 sat below the pane. `outputTab` now returns a `cursor` row for the window to contain, resolved through the `windowFor` that `SkillList` and Issues already use. §14 amended.

**5. `overviewRows`' bar arithmetic did not fit its column (Task 9).** `cells = max(6, min(10, width - 18))` reserved a constant that the 8-cell stage label then overran, so at 80×24, where the list column is 22 cells and 18 inside its border, the percentage was truncated away. The row is `labelWidth + cells + 8`, so both are derived from the width, and the label shortens before the bar does. `median` became `med` for the same reason: the full word pushed the duration off the row. §14.6 amended.

**6. `ScreenRow.colour` needed a literal fallback, not an indexed read (Task 9).** The Self-Review said "`ScreenRow.colour` is `string | undefined` and `overviewRows` fills it from `OUTCOME_COLOUR`" — true, but it is `colour?: string`, and under `exactOptionalPropertyTypes` plus `noUncheckedIndexedAccess` an indexed read of the map is not assignable to it. `?? '#555555'`.

**7. Two scope calls the plan left open.**

- *Palette literals outside `tokens.ts`.* Task 1's Self-Review says it "changed the map, not its call sites", and ~40 named-ANSI literals remain at call sites (`green`, `red`, `yellow` on state tokens, which R11.15 permits). Three contradicted the committed palette directly and were fixed: `LifecycleRail`'s marked-stage `'cyan'`, which is the accent under another name, and the `?? 'gray'` fallbacks in `SkillList`, `Issues` and `rows.ts`. The rest are left as the plan decided.
- *The cursor glyph.* Task 10 changed `›` → `▸` in the three lists it touched, and Step 10 notes "every other list is moving to it". `QueuePanel` sits on the Work screen beside the skill list, so two glyphs on one screen is the inconsistency Task 10 exists to remove; `Palette`, `Setup` and the Settings rows were moved with it.

**8. Three of the plan's own test expectations were wrong. Each was corrected against what the code should do; none was widened to match what it did, which Task 2 Step 8 forbids by name.**

- Task 4 asserted `⊘ suppressed: fixed paths` at width 100, where the mark's budget, a share of the path column unchanged from the shipped Issues screen, elides the reason. Asserted at 160 instead.
- Task 9's `overviewRows` writes `0  full dashboard →` while its own assertion looked for `0 dashboard`. The row is right; the assertion was fixed, and a row-count assertion added so the tier's allocation is pinned.
- Task 3's cases asserted `▸ Validate` on the lifecycle rail, which marks its selection with `underline` and `bold` — attributes a `debug: true` frame does not write. They assert on the `*` the mark key leaves on the rail's selected stage, which is what the frame can actually answer.

**Not a deviation, recorded so it is not mistaken for one.** `tests/tui/work-screen.test.tsx`'s "never shows one skill's live output under another skill" failed once under full-suite parallel load and passed in isolation and on every rerun. Timing-sensitive, pre-existing, not caused by this milestone.

## Changelog

- 2026-08-09 — **Compacted post-implementation.** Removed step-by-step tasks, file-by-file diffs, code snippets, and verification commands now that the feature has shipped. Preserved Goal, Architecture, Specification, Global Constraints, Task Order, Critical Files summary, task intents, requirement coverage, and Deviations. Original plan recoverable via git history.
- 2026-08-09 — **Extended.** [plan_m7-work-screen-navigation.md](plan_m7-work-screen-navigation.md) adds R11.18 and amends R11.11–R11.14 in place: the Work screen's navigation, and the full-length view a pane bound by §14.1's allocation cannot be.
