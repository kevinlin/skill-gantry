# SkillGantry M6 Extension — Editable Settings Implementation Plan

**Status:** Shipped 2026-08-04, on branch `feat/m6-settings-edit`. Written against [design_tui.md](design_tui.md) §14.2, [requirements.md](requirements.md) revision 8 (R11.7, R11.8) and shipped M1–M6. Owned by M6; the summary of these tasks lives in [plan_m6.md § Extension: editable Settings](plan_m6.md#extension-editable-settings), which this document is the executable form of.

**Goal:** The Settings screen names every setting, its value and the file that holds it, and lets a user change any configurable field from the TUI — through the setup states that already own tool selection and repo registration, and through one staged document that reaches disk only as a confirmed change set.

**Architecture:** One staged `GantryConfig` lives in the TUI store. Three edit paths mutate it (the setup states as a screen, an inline value editor, repo removal), all through pure transforms in `src/core/config/edit.ts`. Nothing writes until the user confirms a semantic change list, at which point the single port method `GantryViews.applyConfig` validates the whole document and saves it once. The wizard is reused, not reimplemented: its input handling and effect calls moved into a `useSetupSession` hook that both `skillgantry setup` and the in-TUI screen drive with different callbacks.

## Global Constraints

All constraints from [plan_m1.md](plan_m1.md) through [plan_m6.md](plan_m6.md) hold. The ones this work exercises: one write path to `config.json` (via `GantryViews.applyConfig`), the setup states are shared not reimplemented, no credential enters a change set (R7.3), `src/tui/**` may not spawn or open the ledger, §14.1's row budget holds on the new full-screen views.

---

## Critical Files

| Path | Role |
|---|---|
| `src/core/config/edit.ts` | Pure transforms (`withRepo`, `withoutRepo`, `withStageTools`, `withScalar`) and `configChanges` — the decisions over a config document |
| `src/core/config/config.ts` | `registerRepo` delegates to `withRepo` so the two write paths cannot disagree |
| `src/tui/views.ts` | `SettingsView` carries `presentKeys`, `lockedTools`, `toolTimeouts`; `GantryViews` gains `applyConfig` |
| `src/cli/gantry-views.ts` | Implements origin reporting and `applyConfig` (validates then writes once) |
| `src/tui/rows.ts` | `settingsRows` renders from `state.staged ?? view.config`; `SettingsAction` type drives cursor-only rows |
| `src/tui/store.ts` | `staged`, `settingsCursor`, `editing`, `confirm` state; actions for the editor and staging lifecycle |
| `src/tui/use-setup-session.ts` | Extracted wizard hook shared by `setup-app.tsx` and the in-TUI setup screen |
| `src/tui/components/ConfirmPane.tsx` | Field-level change list under §14.1's budget; `a` apply / `d` discard |
| `src/tui/components/Settings.tsx` | Cursor, editor line, staged count in the panel hint |
| `src/tui/app.tsx` | Setup screen routing, editor key handling, confirm modal precedence (review > confirm > palette) |
| `tests/core/config-edit.test.ts` | 20 cases covering all transforms and `configChanges` |
| `tests/tui/settings-edit.test.tsx` | Staging, editor rejection, discard, setup-screen seeding, confirm pane rendering |
| `tests/acceptance/m6.test.tsx` | Edit-and-apply against a real config file; discard leaves bytes identical |

---

## Tasks

### Task 13: The pure config transforms and the change list

Built `src/core/config/edit.ts` with five pure functions that own the decisions over a config document. `withRepo` derives an id from the directory name and deduplicates collisions; `withoutRepo` filters by id; `withStageTools` files each tool under its catalogue stage, rejecting unrunnable tools (R3.5b); `withScalar` parses a user-typed string, validates through `configSchema.parse`, and rejects with the schema message. `configChanges` produces a field-level diff in stable document order (repos, stage tools, scalars, overrides) so the confirmation pane can be asserted. Refactored `registerRepo` onto `withRepo` so the two write paths cannot disagree about what registering means.

### Task 14: The view tells the truth about origin

Extended `SettingsView` with `presentKeys` (top-level keys the file literally holds, distinguishing a written value from a schema default), `lockedTools`, `toolTimeouts`, and the three file paths. Added `GantryViews.applyConfig` — the only write path — which runs `configSchema.parse` before writing. Rewrote `settingsRows` to render grouped by holding file, with an origin token (`config.json` / `default` / `session N`) on each editable row and an `action` field the cursor visits.

### Task 15: Staging, the value editor and repo removal

Added staging state to the store: `staged: GantryConfig | null`, `editing`, `confirm`. The reducer applies transforms over `state.staged ?? state.settings.config`, and on rejection keeps the editor open with the error message so the user can fix it. Keys: `e` opens the editor from the selected row's action, printable characters append to buffer, `enter` stages, `esc` cancels, `d` stages a repo removal, `c` opens the confirm modal when staged changes exist. Text entry is handled before single-letter commands so digits and letters in values do not steer the screen.

### Task 16: The setup states as a screen

Extracted `useSetupSession` from `setup-app.tsx` — the hook owns the probe, sequence-guarded inspect, install loop, advance and back. Two callbacks (`onSelection`, `onRepo`) replace the direct driver writes, which is the seam that makes the in-TUI screen stage its result rather than writing immediately. Added `initialSetupState(seed?)` so a re-entered wizard shows the current toolchain instead of rendering a configured machine as empty. The screen seeds from the union of `stageTools` values and `lockedTools`, marks already-verified tools as installed to skip reinstall, and exits back to Settings rather than killing the session.

### Task 17: The confirmation pane, modal precedence and the budget

Built `ConfirmPane.tsx`: one coloured row per `ConfigChange`, the holding file in the title, a restart notice, and `a apply · d discard` in the footer. Repo removals carry "workspaces and recorded runs are kept" so "remove" over a path does not read as a directory delete. Modal precedence: review pane (writes the user's repo) > confirm pane (writes `config.json`) > palette. The layout walk proves both new views stay within budget from 200×60 down to 50×14.

---

## Requirement coverage

| Requirement | Task |
|---|---|
| R11.7 every setting, its value, its holding file, its origin | 14 (origin through the port, groups and origin tokens in the rows), 17 (acceptance) |
| R11.8 staged edits, confirmed change set, one validated write, wizard reuse, no credential editing | 13 (transforms, change list), 15 (staging, editor, removal), 16 (the setup states reused through one hook), 17 (the pane, precedence, acceptance) |

## Deviations found while implementing

- **No `+ add a repo` row.** Task 14 Step 7 put an `open-setup` row at the end of the Repos group. Design §14.2's own mock has no such row, and it made the first actionable row depend on how many repos are registered — so `e` on a freshly-loaded screen edited `concurrency` on one machine and did nothing on another. Adding a repo is `:setup`, which the empty-state line now says. Repos with no entries render a dim hint instead.
- **The editor's buffer starts empty.** The plan's `begin-edit` seeded it with the current value, which makes the first keystroke append: `e4` over a `2` staged `24`. `editing` carries `current` for the prompt (`concurrency [2] → 4`) and `buffer` starts empty, which is what makes the plan's own `e4\r` keystrokes mean what they say.
- **`hasAdapter` is exported from `src/core/index.ts`.** `stage-selection` applies `withStageTools`, which needs R3.5b's runnable predicate, and `src/tui/**` may not import `core/adapters/registry.js` directly. `setup-command.ts` had been spelling the same rule as `getAdapter(id) !== undefined`.
- **`onRepo` takes the typed path, not a resolved entry, and may reject.** The hook cannot call `driver.registerRepo` itself — the screen stages instead of writing — but it still owns the error path R3.6 needs, so it awaits `onRepo` and turns a rejection into the message the wizard already displayed. The first attempt had the hook inspect the path itself to obtain `isGit`; that put a second round trip in front of every `enter` on the repo step and made M3's acceptance criterion fail under a loaded full-suite run while passing in isolation. The screen's `onRepo` does the inspection, because it is the caller that needs the canonical path and the git flag; `registerRepo` already does its own. `SetupDriver.registerRepo` keeps its `(path)` signature.
- **`ScreenList` gained a `reserve` prop.** The editor line is a row below the panel, and §14.1 forbids appending it: the panel now gives that row up rather than the frame growing past the terminal.
- **The confirm branch closes the editor ref on `enter`.** Keys arriving in the same tick as the enter — the `c` in `e4\rc` — belong to the screen, not to a field already submitted. The sync effect reopens it in the one case where staging refused the value.
- **Two test fixtures had to be re-stated, not adapted.** `SettingsView` now carries the document the rows render, so a fixture setting `concurrency: 3` on the view alone described a config that no `createGantryViews` result could produce. The affected cases in `tests/tui/rows.test.ts` and `tests/tui/tools-settings.test.tsx` set both.
- **The acceptance apply needs its own settle.** `a` writes through the port, so the assertion is one filesystem round trip away rather than one render; the two keystrokes are sent separately.

## Changelog

- 2026-08-09 — **Compacted post-implementation.** Removed step-by-step tasks, file-by-file diffs, code snippets, and verification commands now that the feature has shipped. Preserved Goal, Architecture, Global Constraints (condensed), Critical Files summary, task intent summaries, requirement coverage, and deviations. Original plan recoverable via git history.
