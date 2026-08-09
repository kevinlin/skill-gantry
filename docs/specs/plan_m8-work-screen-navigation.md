# M8 extension — Work screen navigation and the detail view

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** planned.
**Goal:** Every movement key on the Work screen acts on the zone that owns it, both arrow pairs work where the letter pairs do, the Dashboard key is advertised wherever the Overview card renders, and `enter` opens the selected finding or issue at the length its tool wrote it.

**Architecture:** No core change. One new component, two new pure row builders, one new state field and one new cursor, and a rewrite of the key routing in the single `useInput` block. The queue, the pipeline, the ledger and every adapter are untouched.

## Specification

Layer 1: [requirements.md](requirements.md) — one new id, R11.18, and rev-15 amendments in place to R11.11, R11.12, R11.13 and R11.14. R11.18 is owned by M8's row in § Milestone ownership.
Layer 2: [design-tui.md](design-tui.md) new §14.8, amended §14.2 and §14.6; [design.md](design.md) §17, §18.
Decisions: none new. The three the grilling settled that are not already in a `D*` are recorded under Decisions below.

## The problem

Four extensions landed on the Work screen and M7 made one pass over the assembled frame. What is left is navigation, and three defects show in a shipped run:

**The Dashboard is reachable but not findable.** `0` has worked since M7 and the Overview card has printed `0  full dashboard →` for as long. But that row sits in a card whose other rows open with counts — `2 low`, `med evaluate 26.5s` — so the key reads as a number; and `rows.ts` returns early for the `compact` tier, so the one place the binding is advertised is off screen at every terminal height below 24 rows, and absent entirely in narrow mode.

**The movement keys are half zone-scoped.** R11.11 scoped the vertical pair, the horizontal pair and the mark key. It also said screen-level keys stay available everywhere, and nothing said which of the two clauses `1`–`5` fell under — so they fire from the skill list and from the queue, moving a pane the user is not in. Meanwhile `↑`/`↓` have been aliases of `j`/`k` in eight blocks since M2 and `←`/`→` are bound nowhere, which is not a decision anyone made.

**A cursor no key can move.** The Work Issues tab renders `▸` and reverse video at `state.selectedIssue` while windowing against `outputOffset`. So it draws a selection the Work screen cannot move, and on arriving from an Issues screen left at row 30 it draws none at all. Underneath, both surfaces read one `state.issues` and one `selectedIssue`; only the *filter* fields were ever split. Whichever query resolves last replaces the other's rows, under a cursor `set-issues` clamps rather than resets — and the effect serving the Issues screen has no `live` cancellation flag, while the tab's effect does.

**And the pane truncates by design.** R11.14 counts the inline finding detail against the pane's allocation, which is exactly what makes each of its rows truncate. At the 80-column floor the inner width is 76 cells and the message row spends four on its indent, so the sentence a scanner wrote — the field a maintainer reads to judge the finding — is the one guaranteed to be cut.

## Decisions

**The detail view is a full-screen replacement, not an overlay.** *Why:* nothing in `src/tui/**` draws over live content; `ReviewPane` and `Help` replace the Work body, `SuppressPane`, `ConfirmPane` and `PaletteScreen` replace the app's. *Cost, accepted:* the surrounding frame is gone for the duration of one `esc`. *Rejected:* an inset overlay — it would be narrower than the pane it covered, which is backwards for a view that exists to stop truncating, and Ink has no positioning primitive that would keep it inside §14.1's budget.

**A view-selection key focuses the zone it selects.** *Why:* it satisfies the zone rule without costing a keystroke, and it is honest — `2` means "show me findings", and showing you findings means putting you where they are. *Cost, accepted:* one more thing `1`–`5` do. *Rejected:* strict scoping, which removes function and buys only purity; and the status quo, which is action at a distance.

**`state.detail` holds the row, not an index.** *Why:* `run:start` clears `SkillRow.findings` and `set-issues` replaces `state.issues` wholesale, so an index silently re-points while the view is open — and the list it indexed is not on screen to contradict it. *Cost, accepted:* the view does not follow a live update. That is the correct behaviour for a thing the user opened to read.

## Contracts

```ts
// store.ts — the one new state field and the one new cursor.
detail: { kind: 'finding'; row: FindingRow } | { kind: 'issue'; row: IssueRow } | null
selectedTabIssue: number

// The response carries the surface that asked, so a stale one cannot land on the other.
| { type: 'set-issues'; rows: IssueRow[]; surface: 'screen' | 'tab' }
| { type: 'open-detail'; detail: NonNullable<AppState['detail']> }
| { type: 'close-detail' }
| { type: 'select-tab-issue'; delta: number }
```

```ts
// rows.ts — two builders, one pane. Pure, so the budget is assertable without Ink.
export function findingDetailRows(row: FindingRow, width: number): ScreenRow[]
export function issueDetailRows(row: IssueRow, width: number): ScreenRow[]
```

## Requirement amendments

| Id | Change |
|---|---|
| R11.11 | *(rev 15)* a key acting on another zone moves focus there instead; view-selection keys are such keys; both arrow pairs alias both letter pairs |
| R11.12 | *(rev 15)* every tier that renders carries the dashboard key, rendered as a key rather than as a value |
| R11.13 | *(rev 15)* the tab's selection is its own and moves under its own keys; a response to one surface's query is not applied to the other |
| R11.14 | *(rev 15)* the inline detail stays inside the allocation; a full-length presentation is a separate surface |
| R11.18 | new — the full-length view, its three entry points, its actions, and its dismissal |

## Spec edits

| Document | Edit |
|---|---|
| requirements.md | rev-15 preamble line; four in-place amendments; R11.18; M8's ownership row and exit criteria |
| design-tui.md | new §14.8; §14.2 precedence gains the detail view; §14.6 gains the digit-focus rule, the arrow aliases, the compact-tier link and the Issues cursor split |
| design.md | §17 claims §14.8; §18 gains an "M8 extension" row |
| index.md | row for this plan; plan-m8.md's status; two pre-existing catalogue defects fixed — the `plan-m6-settings-edit.md` dead link and the orphan `plan_m2-rehydrate-the-last-recorded-run.md` |
| plan-m8.md | `## Changelog` pointing here |

## Testing

| Target | Guard |
|---|---|
| `tests/tui/arrow-keys.test.tsx` | new — `\x1b[C`/`\x1b[D` move the rail, `\x1b[A`/`\x1b[B` the skill list, each sent as one string. No test in the suite sends an arrow today |
| `tests/tui/focus-zones.test.tsx` | a view-selection key pressed in each zone leaves focus on the pane; the cycle still visits exactly three zones |
| `tests/tui/issues-tab.test.tsx` | moving the tab cursor leaves the Issues screen's cursor and scroll unchanged; a response tagged for the other surface is discarded |
| `tests/tui/detail-pane.test.tsx` | new — builders assert content and count without Ink; frame measured at 80×24 and 50×14; `o`/`y`/`s` reach their ports; `esc` returns to the screen beneath with its selection unmoved |
| `tests/tui/overview.test.tsx` | compact is four rows and names the dashboard; `OVERVIEW_ROWS[tier]` equals the builder's row count for both tiers; the dead tier-shrink loop repaired or removed |
| `tests/tui/layout.test.tsx` | the help screen still fits every size after `KEYS` grows |

## Risks and one-way doors

- **`rows === 21` loses the Overview card**, the single height the `OVERVIEW_ROWS.compact` bump moves. Accepted; every other height 14–40 is unchanged.
- **One `state.issues` still serves both surfaces.** Two cursors and a tagged response remove the observable failures; the surfaces still cannot hold different row sets at once. A second array is the follow-up if it is ever needed.
- **The Issues screen footer already truncates at 80 columns** (83 cells against a 74-cell budget). Pre-existing, untouched here, recorded so it is not read as caused by this work.
- **The Artefacts tab still has no cursor**, so no way to see a full path or open one. `o` through the existing `views.openPath` port is the follow-up; it needs a cursor first.

---

## Global Constraints

Everything in prior plans' constraints still holds. The ones this work touches:

- **ESM only, `NodeNext`.** Every relative import carries the `.js` extension, in `.tsx` too.
- **Import direction is `cli → tui → core`,** enforced by lint. `src/tui/**` may not spawn or open the ledger — the detail view reaches the filesystem only through `GantryViews`.
- **§14.1's row budget** governs every terminal change: a panel renders exactly the rows it was allocated, an overflow notice is counted *against* that allocation, text truncates and never wraps, and what the chrome costs is `layout.ts`'s to know.
- **R11.15's colour prohibition:** no body foreground and no background colour anywhere in `src/tui/**`. A selected row is `inverse` over text padded to the pane's inner width with `padCells`.
- **Comments explain why a rule exists,** usually by naming the failure mode the alternative had.
- **Conventional Commits,** lowercase imperative subject.
- **Verification command:** `pnpm check` before any commit that closes a task.

## Task Order and Why

Task 1 is first because R13.7's traceability test fails the build until R11.18 has exactly one milestone owner and a design section claiming it — every later task would otherwise commit against a red build. Tasks 2 and 3 are the key routing and are independent of everything else; 2 before 3 only because the arrow test establishes that a CSI sequence reaches Ink through `FakeStdin`, which nothing in the suite has proved. Task 4 must precede Task 5: the detail view opens from the Issues tab, and opening it off a cursor that cannot move is not testable. Task 6 depends on 5 for the key it advertises. Task 7 is independent and last because it is the only one that moves layout arithmetic, so a failure there is unambiguous.

## Critical Files — Summary

| Path | Role |
|---|---|
| `src/tui/app.tsx` | The one `useInput`. Arrow aliases, digit focus, `S` scoping, `enter`/`esc`, the detail render slot, the Issues-screen effect's `live` flag |
| `src/tui/store.ts` | `detail`, `selectedTabIssue`, the tagged `set-issues`, and the three new actions |
| `src/tui/rows.ts` | `findingDetailRows`, `issueDetailRows`, `outputTab`'s issues cursor, the compact-tier link row, the two action rows |
| `src/tui/components/DetailPane.tsx` | New. Full-screen replacement plus its own `StatusBar` |
| `src/tui/components/OutputPane.tsx` | The issues branch windows and renders off the tab's own cursor |
| `src/tui/components/Issues.tsx` | Selected-row action row |
| `src/tui/components/Help.tsx` | `KEYS`: the stale `1 – 4`, and rows for `enter`, `0`, `S`, `s` |
| `src/tui/layout.ts` | `OVERVIEW_ROWS.compact` |

---

## Implementation Tasks

### Task 1: Spec amendments

**Files:** Modify: `docs/specs/requirements.md`, `docs/specs/design-tui.md`, `docs/specs/design.md`, `docs/specs/index.md`, `docs/specs/plan-m8.md`. Create: this file.

- [ ] **Step 1:** requirements.md — rev-15 preamble sentence; amend R11.11, R11.12, R11.13, R11.14 in place; add R11.18; extend M8's ownership row and exit criteria.
- [ ] **Step 2:** design-tui.md — new `### 14.8` opening exactly `*Satisfies R11.18.*`; amend §14.2 and §14.6.
- [ ] **Step 3:** design.md §17 and §18; index.md rows and the two catalogue defects; plan-m8.md `## Changelog`.
- [ ] **Step 4:** Run `pnpm vitest run tests/specs/traceability.test.ts`. Expected: 2 passed.
- [ ] **Step 5: Commit** `docs (m8): spec the zone-scoped keys and the full-length detail view`

### Task 2: Arrow keys on the rail

**Files:** Modify: `src/tui/app.tsx`. Test: `tests/tui/arrow-keys.test.tsx` (new).

- [ ] **Step 1:** In the `h`/`l` branch, accept `key.leftArrow` and `key.rightArrow`. Nothing else moves — the vertical pair is already aliased in all eight blocks.
- [ ] **Step 2:** New test sending `'\x1b[C'`, `'\x1b[D'` against the rail and `'\x1b[A'`, `'\x1b[B'` against the skill list, each as one `stdin.send` string. The bracketed-paste case in `setup-wizard.test.tsx` is the precedent that a multi-byte CSI reaches Ink through the fake.
- [ ] **Step 3:** Run `pnpm vitest run tests/tui/arrow-keys.test.tsx`.
- [ ] **Step 4: Commit** `feat (tui): move the rail with the horizontal arrows`

### Task 3: A view-selection key focuses the pane it names

**Files:** Modify: `src/tui/app.tsx`. Test: `tests/tui/focus-zones.test.tsx`.

- [ ] **Step 1:** The `'1'`–`'5'` branch dispatches `set-panel` and `set-focus: 'work'`.
- [ ] **Step 2:** Scope `S` to `focus === 'work' && panel === 'issues'`, matching the `o` and `s` guards. Leave `0`, `r` and `y` screen-level.
- [ ] **Step 3:** Cases: a digit from the skill list and from the queue leaves focus on the pane; the existing "cycles exactly three zones" still passes.
- [ ] **Step 4:** Run `pnpm vitest run tests/tui/focus-zones.test.tsx`.
- [ ] **Step 5: Commit** `feat (tui): focus the output pane from the key that selects its view`

### Task 4: The Issues tab's own cursor, and the response that cannot land twice

**Files:** Modify: `src/tui/store.ts`, `src/tui/rows.ts`, `src/tui/app.tsx`, `src/tui/components/OutputPane.tsx`. Test: `tests/tui/issues-tab.test.tsx`.

- [ ] **Step 1:** `store.ts` — add `selectedTabIssue`; `set-issues` takes `surface` and applies to that surface's cursor alone; `cycle-issue-scope` resets `selectedTabIssue`; `select-tab-issue` clamps like `select-finding`.
- [ ] **Step 2:** `rows.ts` — `outputTab`'s `issues` case returns `cursor: state.selectedTabIssue`, mirroring the `findings` case.
- [ ] **Step 3:** `app.tsx` — `moveDown` routes `issues` to `select-tab-issue`; both `set-issues` dispatch sites pass their `surface`; the Issues-screen effect gains the `live` flag.
- [ ] **Step 4:** `OutputPane.tsx` — the issues branch renders off `selectedTabIssue`.
- [ ] **Step 5:** Run `pnpm vitest run tests/tui/issues-tab.test.tsx tests/tui/store.test.ts`.
- [ ] **Step 6: Commit** `fix (tui): give the issues tab a cursor its own keys move`

### Task 5: The detail view

**Files:** Create: `src/tui/components/DetailPane.tsx`. Modify: `src/tui/rows.ts`, `src/tui/store.ts`, `src/tui/app.tsx`. Test: `tests/tui/detail-pane.test.tsx` (new).

- [ ] **Step 1:** `findingDetailRows` — severity, rule class, native rule id, stage, tool, `path:line`, the whole message, the whole `artefactDir`, the whole suppression justification. `issueDetailRows` — fingerprint, state, severity, rule class, skill, path, first and last seen run, detection count, blockers, suppression reason.
- [ ] **Step 2:** `DetailPane` — `Panel` windowed by `screenBodyRows()`, own `StatusBar` with `o open · y copy · s suppress · j/k scroll · esc close · q quit`, `flash` in place of the hints when set.
- [ ] **Step 3:** `store.ts` — `detail`, `open-detail`, `close-detail`.
- [ ] **Step 4:** `app.tsx` — `enter` opens from the Findings pane, the Issues tab and the Issues screen; `esc` closes; `j`/`k` and the vertical arrows scroll; `o`/`y`/`s` stay live. Render after `PaletteScreen`, before the screen switch.
- [ ] **Step 5:** Tests per the Testing table.
- [ ] **Step 6:** Run `pnpm vitest run tests/tui/detail-pane.test.tsx`.
- [ ] **Step 7: Commit** `feat (tui): open the selected finding or issue at full length`

### Task 6: Discoverability

**Files:** Modify: `src/tui/rows.ts`, `src/tui/components/Issues.tsx`, `src/tui/components/Help.tsx`. Test: `tests/tui/layout.test.tsx`.

- [ ] **Step 1:** The findings action row gains `[enter] details`.
- [ ] **Step 2:** The Issues tab and the Issues screen gain a selected-row action row of the same shape. Neither footer is touched.
- [ ] **Step 3:** `KEYS` — `1 – 4` becomes `1 – 5` naming the Issues tab; add `enter`, `0`, `S`, `s`.
- [ ] **Step 4:** Run `pnpm vitest run tests/tui/layout.test.tsx`.
- [ ] **Step 5: Commit** `feat (tui): advertise the detail view and the four keys the help screen omitted`

### Task 7: The dashboard key on every tier that renders

**Files:** Modify: `src/tui/rows.ts`, `src/tui/layout.ts`. Test: `tests/tui/overview.test.tsx`.

- [ ] **Step 1:** `overviewRows` emits the link on `compact` too, relabelled `[0] full dashboard →`.
- [ ] **Step 2:** `OVERVIEW_ROWS.compact` 3 → 4.
- [ ] **Step 3:** Update the compact assertions; add the test pinning `OVERVIEW_ROWS[tier]` to the builder's row count for both tiers; repair or remove the dead tier-shrink loop.
- [ ] **Step 4:** Run `pnpm vitest run tests/tui/overview.test.tsx tests/tui/layout.test.tsx`.
- [ ] **Step 5: Commit** `feat (tui): advertise the dashboard key on every overview tier`

## Deviations found while implementing

_To be filled in as the plan is executed._
