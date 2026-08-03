# SkillGantry M6 Implementation Plan

**Status:** shipped, compacted. Written against [design.md](design.md) revision 3, [requirements.md](requirements.md) revision 6 and shipped M1–M5.

**Goal:** Turned five milestones of recorded evidence into answers. Cross-repo statistics out of the ledger, an Issues table a maintainer can triage from, and the four top-level screens design §14 named and M2 shipped one of.

**Architecture:** M6 added two query modules to `src/core/ledger/` and four screens plus a command palette to `src/tui/`. The TUI still may not open the ledger, so every ledger read reaches it through one injected port (`GantryViews`) that `src/cli/` implements — the same seam shape as `startRun`. Three columns the ledger had always had but never truthfully populated were fixed first, because R8.9 asks questions they are the only possible answer to.

**Tech Stack:** everything M1–M5 shipped, and no new npm dependency. Queries are plain SQL over `node:sqlite`; medians and JSON metric sums are computed in TypeScript because SQLite offers neither.

## Global Constraints

Everything in [plan-m1.md's Global Constraints](plan-m1.md), [plan-m2.md's](plan-m2.md), [plan-m3.md's](plan-m3.md), [plan-m4.md's](plan-m4.md) and [plan-m5.md's](plan-m5.md) still holds. These are the additions.

- Import boundary unchanged: `cli → tui → core`; `src/tui/**` reaches core **only** through `src/core/index.ts`; no `console` or `process.exit` in `src/core/**`; no `node:fs` / `node:child_process` / `node:https` / `node:net` in `src/core/adapters/**`.
- **`src/tui/**` may not open the ledger and may not spawn.** It may read the filesystem. Every ledger query and the `doctor` probe reach it as data through the `GantryViews` port, implemented in `src/cli/gantry-views.ts`. `src/cli/**` may deep-import core (`run-command.ts` already does); `src/tui/**` may not.
- **The rule-map migration never runs implicitly.** R8.14. `skillgantry doctor --migrate-rule-map` stays its only trigger; the Tools screen reports `rule-map-pending` and does not resolve it.
- **`SKILL.md` frontmatter stays the lifecycle authority.** R1.6. The Dashboard and Issues screens read the `skills` cache — that is what design §13 says the cache is for — and a divergence is `doctor`'s `lifecycle-drift`, not this screen's problem.
- **Log text never enters React state line by line.** R11.4. Ring buffer capacity 2000 lines, flush interval 100 ms. Nothing in M6 goes near the pump; the new screens hold bounded documents.
- **Every full-screen view obeys design §14.1's row budget.** A panel renders exactly the rows it was allocated; an overflow count is counted *against* that allocation, never appended below it; text truncates and never wraps; pane sizes are decided in `src/tui/layout.ts` and nowhere else.
- **Metric keys stay a closed union.** R1.5. `METRIC_KEYS` gains nothing; no token or cost key exists by construction, and `coerceMetrics` throws on an unknown key.
- **Finding identity is unchanged.** R8.4: `(skillId, relPath, ruleClass)`. M6 reads issues; it does not re-key them.
- **Closure stays a conjunction over `issue_detectors`.** R8.8. The Issues screen shows which detector is holding an issue open by calling the *same* predicate `reconcile.ts` closes on, never a second copy of it.
- British spelling in identifiers that appear in the specs (`optimise`, `artefact`, `normalise`).
- Conventional Commits, lowercase imperative subject describing the behaviour change.

## Facts established by reading the shipped code

Three of these are defects, not design choices. Each blocks a clause of R8.9 or R7.6, so M6 fixes it before querying it.

**1. `stages.metrics_json` is always `'{}'`.** `record.ts` wrote the literal. Tool metrics lived on `ToolRunRecord.metrics` and reached the ledger nowhere. R8.9's "eval case pass rate" had no source until this was fixed — `casesTotal` / `casesPassed` existed only in memory.

**2. `stages.started_at` and `stages.ended_at` held the *run's* times.** Same insert, bound to `input.startedAt` / `input.endedAt`. R8.9's "wall-clock per stage" would report every stage of a run as taking the whole run. Nothing read either column, so correcting them broke no caller.

**3. The ledger's provenance omitted `analysisModes`.** `run.ts` recorded `JSON.stringify(input.provenance)` while `run.json` got `withAnalysisModes(input.provenance, analysisModes)`. R4.2b exists so a mode change shows up as a visible boundary in the statistics; a fingerprint over the ledger's copy could not see one.

**4. The milestone ownership table is already clean.** 133 declared requirements, each owned by exactly one milestone, none unowned — verified by expanding every range in document order. So R13.7's ownership half passes on the first run and the check is not a rewrite of the table.

**5. Design coverage is not clean: 19 requirements are claimed by no `*Satisfies*` label.** `R1.1`, `R1.2`, `R1.3`, `R1.5`, `R4.9`, `R4.10`, `R4.11`, `R4.12`, `R5.13`, `R5.14`, `R7.1`, `R7.2`, `R7.4a`, `R7.5`, `R7.6`, `R8.13`, `R8.14`, `R13.6`, `R13.7`. Every one of them is *implemented* and *described*; the label is what is missing. `R7.6` is the exception — no design section describes statistics at all, which is why Task 1 writes §10.7 before Task 4 builds it.

**6. Ranges in both documents expand in document order, and that rule is load-bearing.** `R6.1–R6.8` covers `R6.9` because requirements.md declares R6.9 *before* R6.8. A checker expanding numerically instead would report a false gap.

**7. §10.3's satisfies label carries prose: `*Satisfies R8.4, R8.6. Supersedes the message-shape scheme in revision 1.*`** and §6's carries `R9 dispatch`. The parser therefore takes the first whitespace-delimited word of each comma-separated token and strips trailing periods, rather than assuming the whole label is ids.

**8. There is no user path to `acknowledged` or `wontfix`.** `stateOnDetection` and `stateOnAbsence` are the only transitions in code; R8.10's "user acknowledgement" and "user marks wontfix" rows exist in design §10.5 and in no function. The Issues screen is the first thing that needs them.

**9. `reconcile.ts` already holds the closure predicate M6 wants to display**, inline at lines 108–112. Extracting it is what stops the Issues screen from carrying a second copy that could disagree about which detector is blocking closure.

**10. `MIGRATIONS` is `readonly string[]` and `openLedger` runs each with `db.exec`.** A fingerprint backfill needs sha256, which SQLite has no function for, so Task 3 widens a migration to `{ sql, backfill? }`.

## Spec amendments this milestone carries

All landed in Task 1, before the code that depends on them, per the repo rule that a spec proven wrong is corrected in the same branch.

1. **Design gains §10.7, "Statistics queries".** R7.6 and R8.9 are M6's and no design section describes either. Without it, Task 4 would invent a contract and the design would document the code afterwards, which inverts the layers.
2. **Nineteen `*Satisfies*` labels are added or extended.** Fact 5's list. This is the mapping R13.7 requires to exist, not new behaviour: each requirement is already implemented in the section that gains the label.
3. **Design §10.5 gains three user-action rows.** `open → acknowledged`, `open|acknowledged|fixed → wontfix`, `acknowledged|wontfix|fixed → open`. R8.10 already enumerates acknowledgement and wontfix; the reopen row is new and deliberate — a `wontfix` with no way back is a trap, and R8.10 requires the table to be *total*, so the transition has to be stated rather than left to a screen.
4. **Design §14 gains the palette and the screen set it already promised.** §14 names "Dashboard, Issues, Tools, Settings" and a `:` command palette in prose; §14.1 defines the row budget for panes. It gains: the palette is the screen switcher, every screen is a `Panel` windowed against `layout.rows`, and `esc` returns to Work.
5. **Design §16 gains the four M6 test rows** (statistics queries, issue queries and user transitions, the traceability check, the new screens' row budget), and §17's M6 module row gains `ledger/stats.ts`, `ledger/issue-queries.ts` and `tui/rows.ts`.

## Critical Files — Summary

| Path | Role |
|---|---|
| `tests/specs/traceability.test.ts` | R13.7's mechanical check: ownership exactly once, design coverage at least once |
| `src/core/stages/outcome.ts` | `reduceStageMetrics()` — the sum that makes eval case rate answerable |
| `src/core/ledger/fingerprint.ts` | `provenanceFingerprint()` — R7.6's grouping key, over a fixed field order |
| `src/core/ledger/db.ts` | `Migration` gains an optional `backfill` for data SQL cannot compute |
| `src/core/ledger/stats.ts` | the five R8.9 query families and `dashboard()` |
| `src/core/ledger/issue-queries.ts` | `listIssues()`, `setIssueState()` — cross-repo triage |
| `src/core/ledger/issues.ts` | `stateOnUserAction()`, `detectorSaysGone()` — the decisions, kept out of the I/O modules |
| `src/tui/views.ts` | `GantryViews` — the port the TUI declares and the CLI implements |
| `src/cli/gantry-views.ts` | the implementation: ledger, doctor probe, config and `.env` in one place |
| `src/tui/rows.ts` | pure row builders for Dashboard, Tools and Settings, testable without Ink |
| `src/tui/components/Palette.tsx` | `:` command palette — the screen switcher |
| `src/tui/components/Dashboard.tsx` | R8.9 rendered, filterable by provenance (R7.6) |
| `src/tui/components/Issues.tsx` | cross-repo issue table with state transitions |
| `src/tui/components/Tools.tsx` | the `doctor` report as a screen |
| `src/tui/components/Settings.tsx` | repos, concurrency, credential status |
| `tests/acceptance/m6.test.tsx` | one named test per M6 exit-criterion clause, two repos in one ledger |

## Tasks

### Task 1: Design §10.7, the missing satisfies labels, and R13.7's mechanical check

Wrote `tests/specs/traceability.test.ts` — R13.7's mechanical check that every requirement has exactly one milestone owner and at least one design `*Satisfies*` label. Added design §10.7 (statistics queries contract), nineteen missing `*Satisfies*` labels, user transition rows in §10.5, screen definitions in §14, test rows in §16, and M6's module row in §17. Added plan-m6 to the spec index.

### Task 2: Per-stage timings and stage metrics

Fixed two ledger defects: `stages.metrics_json` was always `'{}'` and `stages.started_at`/`ended_at` held the run's times rather than the stage's. Added `reduceStageMetrics()` in `stages/outcome.ts` to sum count-like metrics (dropping `durationMs` since fan-out tools run concurrently). The pipeline stamps all three fields in one place so aborted stages carry them too. Migration 3 nulled the old wrong values rather than leaving a mix of two different measurements.

### Task 3: The provenance fingerprint, its column, and the backfill

Added `provenanceFingerprint()` in `ledger/fingerprint.ts` — R7.6's grouping key — hashing a fixed field order so `JSON.stringify` key order cannot split identical provenances. Migration 4 added `runs.provenance_fp` with an index and backfilled every existing run. Also fixed the ledger recording the bare provenance instead of the resolved one (with `analysisModes`), closing the gap R4.2b exists to prevent.

### Task 4: `stats.ts` — the five R8.9 query families

Built `src/core/ledger/stats.ts`: `stagePassRates`, `evalCaseRate`, `stageWallClock`, `openIssueCounts`, `runHistory`, composed by `dashboard()`. All take one `StatsFilter` so per-skill, per-repo, and cross-repo queries are one code path with a narrower `where` clause. `provenanceOptions()` lists the distinct fingerprints for the Dashboard's filter. Created the shared `tests/helpers/ledger-fixture.ts` two-repo recorder.

### Task 5: `issue-queries.ts` and the user transitions

Added `stateOnUserAction()` — design §10.5's three user transitions (acknowledge, wontfix, reopen) — and `detectorSaysGone()` — the closure predicate extracted from `reconcile.ts` so the Issues screen names the blocking detector by calling the same function. Built `listIssues()` and `setIssueState()` in `issue-queries.ts` for cross-repo triage.

### Task 6: The `GantryViews` port and its CLI implementation

Declared `GantryViews` in `src/tui/views.ts` — the six-method port the TUI consumes — and implemented it in `src/cli/gantry-views.ts`, which opens and closes the ledger per call rather than holding a handle. Created `tests/helpers/fake-views.ts` providing `fakeViews()` for every later TUI test.

### Task 7: Screens in the store, and the `:` command palette

Extended the store with `Screen`, palette state, and all view data fields. Built the `Palette` component and wired screen routing in `app.tsx`. Added `screenBodyRows()` to the layout. Stubbed the four screens so the palette has somewhere to navigate to. The palette reads its open flag from a ref (deviation 1) because React batches keypresses.

### Task 8: The Dashboard screen

Built pure `dashboardRows()` in `src/tui/rows.ts` and the shared `ScreenList` windowing renderer. The Dashboard renders all five R8.9 clauses, names its scope, and cycles the provenance filter with `p` and the skill filter with `s`. Row budget is assertable without Ink because the body is a flat `ScreenRow[]` list.

### Task 9: The Issues screen

Built the Issues screen with a per-row selection, severity and state columns, and the three user transition keys (`a` acknowledge, `w` wontfix, `o` reopen). Names the detector holding each issue open (R8.8). Re-reads from the ledger after every transition rather than patching in place. The rule class gets its own column (deviation 2).

### Task 10: Tools and Settings, the two read-only screens

Both share `ScreenList`. Tools renders `doctor`'s report with runtime, tool and lifecycle-drift sections, and `r` re-probes. Settings shows repos, concurrency, stage tool selection, credential status (presence only, never a value — R7.3), `.env` warnings, and the rule-map version. Both are pure row builders in `rows.ts`.

### Task 11: Help, the footer, and the row budget across every screen

Extended the layout regression test to walk all five screens at every size (200×60 down to 50×14) with enough data to trigger overflow. Added the eleven new key bindings to Help. No screen overflowed (deviation 8), so the plan's fix step was a no-op.

### Task 12: The M6 acceptance suite

`tests/acceptance/m6.test.tsx` writes a real config and ledger, records runs across two repos, builds the port with `createGantryViews`, and drives the rendered `App`. One named test per exit criterion: Dashboard across repos, provenance filter, Issues with transitions, Tools and Settings reachable, and the boundary assertion that `app.tsx` never imports `node:sqlite`.

## Requirement coverage for M6

Every requirement M6 owns, and the task that satisfies it. A requirement with no task is a plan defect.

| Requirement | Task |
|---|---|
| R7.6 statistics groupable and filterable by provenance fingerprint | 3 (`provenanceFingerprint`, the column, the backfill), 4 (`StatsFilter.provenanceFp` on every query, `provenanceOptions`), 8 (`p` cycles the filter and the scope is named on screen), 12 |
| R8.9 statistics per skill and across repos: stage pass rate, eval case pass rate, wall clock per stage, open issues by severity and rule class, run history | 2 (the two columns that made two of the five answerable), 4 (all five queries plus the counts), 8 (all five rendered), 12 |
| R11.3 Dashboard, Issues, Tools and Settings reachable as top-level screens | 7 (the screen field, the palette, the routing), 8 (Dashboard), 9 (Issues), 10 (Tools, Settings), 11 (the row budget on all four), 12 |

**Owned elsewhere but closed here.**

- **R13.7** (M1) has been recorded as an open gap by M3, M4 and M5. Task 1 builds the check and adds the nineteen labels it needs, because M6 is the milestone that edits traceability anyway and the gap has no other future owner.
- **R8.10** (M1) is the issue transition table. Its "user acknowledgement" and "user marks wontfix" rows had no code path until Task 5; the reopen transitions are new and are added to design §10.5 rather than left implicit in a screen.
- **R8.8** (M1) is closure as a conjunction over `issue_detectors`. Task 5 extracts the predicate `reconcile` closes on so the Issues screen names the blocking detector by calling the same function — design §19 predicted this screen would want it.
- **R4.2b** (M1) requires the analysis mode to be recorded in run provenance. Task 3 is what makes the ledger's copy carry it; before, only `run.json` did.
- **R3.9, R12.5a** (M3) are doctor and its drift kinds. Task 10 renders the existing report; it adds no drift kind and resolves none.
- **R1.6** (M5) makes the `skills` lifecycle column a cache. Design §13 says the cache exists so the Issues and Dashboard screens can filter deprecated skills across every repo without reading 76 files; Tasks 8 and 9 are the first consumers.
- **R11.4** (M2) is untouched by design: nothing on the new screens streams, so nothing new goes near the ring buffer.

**Deferred within M6, with reasons.**

- **No headless statistics command.** R8.9 states what the statistics must cover and no requirement gives them a CLI surface; R12.5a and R12.5b name `doctor` and `release` and nothing else. `stats.ts` is a plain module, so a `skillgantry stats --json` is a thin wrapper whenever one is wanted.
- **Settings is read-only.** Design §14 lists "repos, concurrency, credentials status", and registering a repo is `skillgantry setup`'s job (R3.6), which is already a re-enterable state machine. An editable Settings screen would be a second write path to `config.json` with no requirement asking for one.
- **The Dashboard has no time filter.** R8.9 asks for run history, not a date range. `StatsFilter` takes three fields and a `since` would be a fourth with nothing to justify it yet.
- **Issue notes are not editable.** `setIssueState` accepts a note and `issues.note` stores it; typing one needs a text input on the Issues screen, and R8.7 requires the state, not the note.
- **No `optimise → validate` loop, no git commit or tag.** R5.4 and R9.7, deferred by D6 and D9 respectively. Unchanged by M6.

## Known gaps carried forward

- **Stage wall clock and stage metrics start at M6.** Every run recorded by M1–M5 has null stage timings after migration 3 and `{}` metrics, so the Dashboard's wall-clock and eval-case sections describe runs from this milestone onward. There is nothing to backfill: the data was never recorded. A user with months of history sees a partial answer until they run again.
- **A pre-M6 run fingerprints differently from an identical post-M6 one.** The backfill hashes the provenance as stored, and stored provenance before Task 3 carried no `analysisModes`, so an otherwise-identical later run lands in a different provenance group. The boundary is real — the mode genuinely was not recorded — and it is visible rather than silent, which is the direction §7 argues for.
- **The provenance filter on issue counts is "as of the last sighting".** An issue is not a run, so `issueScope` reaches it through `last_seen_run`. An issue last seen under provider A and still open shows up only under A's filter, even if provider B would also find it. The alternative — ignoring the filter for issues — shows one provider's numbers beside every provider's issues.
- **`occurrence_count` still understates by design.** Design §19 already carries this: merge-first identity means three credential findings in one file are one issue with three detections, and the Dashboard's rule-class counts read as "files with a problem of this class". M6 renders the number; it does not change what it means.
- **The Issues screen has no pagination beyond scrolling.** `listIssues` returns every matching row and the screen windows them. A ledger with tens of thousands of issues would build one large array per frame; the reference repos hold tens.
- **Every screen re-reads on refresh, not on change.** There is no ledger change notification, so a run finishing while the Dashboard is open does not update it — `:refresh` or leaving and returning does. Watching the ledger would mean either polling or a notify channel `node:sqlite` does not offer.
- **`createGantryViews` opens and closes the ledger per call.** Correct under a concurrent writer and measurably more expensive than a held handle. At one open per screen refresh that is not worth optimising; at one per keystroke it would be.
- **The palette is the only screen switcher.** Three keystrokes (`:`, a letter or two, enter) to change screen. Direct keys were rejected because Work spends `1`–`4` on its output panels, but a user switching often will feel it.
- **Tools screen refresh spawns.** `r` re-invokes every locked tool's version argv through the port. On a slow machine the screen shows the previous report until it returns, with no in-flight indicator beyond the unchanged frame.
- **The `esc`-to-Work rule shadows nothing today and could later.** `esc` on Dashboard, Issues, Tools or Settings returns to Work; if one of those screens later grows a modal of its own, that modal must consume `esc` before this rule sees it, the way the palette and the review pane already do.

## Deviations found while implementing

1. **The palette reads its open flag and query from a ref, not from state** (Task 7). The plan's keymap branched on `state.palette.open` and appended to `state.palette.query`. React batches the dispatches from keypresses that arrive in one tick, so every handler in that batch saw the same stale value: `:` and the first letter arrived together, the letter's handler still saw the palette closed and fell through to Work's bindings, and typing `issues` filtered on whatever the last character matched. `app.tsx` now keeps `{ open, query }` in a ref for key routing and dispatches for rendering. Key handling has to be synchronous; state is what the frame draws.
2. **The Issues screen gives the rule class its own column** (Task 9). The plan put `ruleClass`, `relPath` and the blockers in one field truncated by `truncateMiddle`, which elides the *head* so a basename survives — and at 100 columns that ate the rule class the plan's own test asserts is visible. The rule class is what names an issue, so it gets a fixed column and only the path plus blockers absorb the truncation.
3. **`toolsRows` names `lifecycle-drift` on each row rather than as a heading** (Task 10). The plan's heading was `Lifecycle drift` while its test asserted the token `lifecycle-drift`. The row now carries the kind in `doctor`'s own vocabulary, so the screen and the headless report call one condition by one name.
4. **Row casts go through `unknown`** (Tasks 4, 5). `node:sqlite` types `.all()` as `Record<string, SQLOutputValue>[]`, which does not overlap a named interface, so `as SeverityCount[]` fails `tsc`. Matched the existing `as unknown as` form in `reconcile.ts` and `rule-map-migration.ts` rather than inventing a third convention.
5. **The four screen stubs render `state.viewError ?? 'loading…'`** (Task 7). The plan's placeholder destructured `state` as `_state`, which `@typescript-eslint/no-unused-vars` rejects. Reading the error is what the finished screens do anyway, so the stub does it too.
6. **`Help.tsx` keys its rows on key plus description.** `r` now names two bindings, enqueue on Work and re-probe on Tools, so the key alone is no longer a unique React key.
7. **The acceptance suite waits 3 s on the Tools screen** (Task 12). It is the one screen whose port call spawns: `doctor` invokes each runtime's version argv, which the plan's shared 60 ms settle catches mid-probe.
8. **The layout regression asserts the frame is the screen it navigated to** (Task 11). A Work frame fits every size, so a budget assertion alone would have passed on a palette navigation that silently failed. No screen overflowed, so the plan's Step 3 was a no-op.

## Changelog

- 2026-08-04 — **Compacted post-implementation.** Removed step-by-step tasks, file-by-file diffs, code snippets, file structure tree, and verification commands now that the feature has shipped. Preserved Goal, Global Constraints, Facts, Spec Amendments, Design Decisions, Critical Files summary, Requirement Coverage, Known Gaps, Deviations, and follow-ups. Original plan recoverable via git history.
- 2026-08-03 — revision 1, written against design.md revision 3, requirements.md revision 6 and shipped M1–M5. Three ledger defects found by reading the shipped recorder (empty stage metrics, run times in the stage columns, provenance recorded without its analysis modes) are fixed in Tasks 2 and 3 before anything queries them. The design-coverage gap Task 1 closes was measured, not estimated: nineteen requirements carry no `*Satisfies*` label, and the milestone ownership table is already clean at 133 requirements.
