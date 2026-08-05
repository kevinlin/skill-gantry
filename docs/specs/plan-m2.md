# SkillGantry M2 Implementation Plan

**Status:** Shipped. Aligned to [design.md](design.md) revision 3, [requirements.md](requirements.md) revision 3 and [plan-m1.md](plan-m1.md) revision 2.

**Goal:** Put a queue and a terminal interface over the M1 engine — batch enqueue with a bounded worker pool, a command path that cancels and resolves, and a Work screen that renders live state without holding log text in React.

**Architecture:** M2 adds two modules to `src/core` (`queue`, plus cancellation and the mutation gate inside `pipeline`) and the whole of `src/tui`. No M1 call site is rewritten, and `skillgantry run` keeps its exit codes and its JSON stream.

**Tech Stack:** everything M1 ships, plus Ink 6 and React 19 for the terminal interface, and `tsx` as a dev dependency so tests can run engine code in a second process.

## Global Constraints

Everything in [plan-m1.md's Global Constraints](plan-m1.md) still holds. These are the additions.

- The import boundary gains a rule: `src/tui/**` imports core **only** through `src/core/index.ts`. Deep imports such as `../core/ledger/db.js` fail `pnpm lint`. This is R13.1 applied to the new consumer.
- `src/tui/**` may touch the filesystem. It may not spawn processes or open the ledger; those belong to `src/cli/tui-command.ts`, which owns the wiring.
- Log text never enters React state line by line. Chunks go to a ring buffer held outside the component tree and a fixed-interval tick copies the visible window into state. This is R11.4, and the reducer test asserts it by dispatching a `tool:output` event and expecting no state change.
- Ring buffer capacity is 2000 lines, flush interval 100 ms, both from design §14.
- Every change to a file M1 created is **additive**. An added optional parameter, an added optional interface method, an added union member field, a new export. If a change would break an M1 call site, it is out of scope for M2.
- Mutating stages are `optimise` and `release`. M2 ships neither. It ships the gate, the timeout and the serialisation they will use, tested against fake executors, because R5.7, R5.13 and R5.14 are M2-owned and cannot wait for M5.
- Cancellation has four phases and exactly four: `queued` (owned by the queue), `running`, `awaiting-approval`, `finalising` (owned by the pipeline). A cancelled run still finalises.
- JSX is `react-jsx`. Relative imports in `.tsx` carry the `.js` extension like everywhere else under `NodeNext`.
- Every commit message uses Conventional Commits.

## Working against M1

M1 is being implemented in a separate worktree. Where a task below shows a whole M1 file, it shows that file **as plan-m1 specifies it, with the M2 change applied**. If the shipped file has drifted from plan-m1, apply the described change to the shipped file rather than pasting over it. Each task states its change in prose before the code for exactly this reason.

Two M1 behaviours M2 depends on, both verified in plan-m1's own tests:

1. `runTool` already accepts an `AbortSignal`, kills the process **group** on abort, and returns `cancelled: true`. `classifyToolRun` already maps that to `errored` with `error_kind = 'cancelled'`, which does not reconcile. So cancelling a running tool needs no new kill path — only a pipeline that survives it.
2. `withSkillLock` already carries a pid and a stale threshold, and `finalizeRun` already defines `latest` as the greatest run id. M1 tests both **in one process**. R6.7 and R6.9 are M2-owned because one process shares a lock table and a file descriptor table, so an in-process test cannot prove either. M2 proves them across real processes and logs the reclaim, which M1's no-op callback does not.

## One M1 behaviour M2 must change

`AdapterStageExecutor` calls `ctx.onOutput(toolId, 'stdout', run.stdout)` **once, after the tool exits**, with the whole capture. A frontend fed that way sees nothing until the tool finishes, so R11.4's "live tool output" and its 10,000-lines-in-5-seconds acceptance test are both unsatisfiable. Task 6 adds an optional `onChunk` to `runTool` and forwards it, so `tool:output` events arrive while the tool runs. The `StageContext.onOutput` signature does not change; only its call frequency does. Task 6 states the consequence for the headless CLI, which ignores `tool:output` either way.

## File structure

```
src/
  core/
    index.ts                    MODIFIED  queue, stage and workspace-read exports
    config/
      schema.ts                 MODIFIED  mutationTimeoutMs
      config.ts                 MODIFIED  DEFAULT_CONFIG.mutationTimeoutMs
    pipeline/
      cancellation.ts           NEW       RunPhase, CancelPhase, Cancellation
      mutation-gate.ts          NEW       MutationGate, MutationDecision
      events.ts                 MODIFIED  phase on run:cancelled, scope on mutation:pending
      run.ts                    MODIFIED  cancellation, mutation gate, executor factory
    queue/
      types.ts                  NEW       JobSpec, JobRecord, QueueEvent, QueueHandle
      pool.ts                   NEW       createQueue()
    runner/
      spawn.ts                  MODIFIED  onChunk
    stages/
      types.ts                  MODIFIED  PendingMutation, optional mutation methods
      adapter-stage.ts          MODIFIED  forward chunks as they arrive
    workspace/
      writer.ts                 MODIFIED  reclaim reason, reclaim log
  tui/
    index.tsx                   renderApp()
    app.tsx                     App: event subscription, input, pump ownership
    store.ts                    AppState, reducer, initialState
    log-buffer.ts               RingBuffer, LogPump
    views.ts                    loadSkillMd, listArtefacts, loadSkillStatuses
    components/
      SkillList.tsx
      LifecycleRail.tsx
      OutputPane.tsx
      QueuePanel.tsx
      Work.tsx
  cli/
    index.ts                    MODIFIED  root options, default action
    run-command.ts              MODIFIED  --concurrency, default action
    tui-command.ts              NEW       config -> queue -> renderApp
tests/
  helpers/
    fake-executor.ts            NEW
    fake-run.ts                 NEW
    child.ts                    NEW
    render-ink.tsx              NEW
  core/
    pipeline-cancel.test.ts     mutation-gate.test.ts     pipeline-mutation.test.ts
    queue.test.ts               queue-cancel.test.ts      workspace-concurrency.test.ts
    streaming.test.ts
  tui/
    log-buffer.test.ts          store.test.ts             work-screen.test.tsx
    output-pane.test.tsx        queue-panel.test.tsx      app-batch.test.tsx
  acceptance/
    m2.test.ts
```

---

### Task 1: Cancellation across the pipeline's three phases

Introduced `Cancellation` class tracking run phase (starting → running → awaiting-approval → finalising → done), made `cancel()` return `Promise<void>` that resolves only after finalisation, and added `phase` to `run:cancelled` events. Created `StageExecutorFactory` as a test seam so the pipeline never names a concrete executor. Also produced the `fakeExecutor` test helper used by Tasks 2, 3 and 14. `cancel` returning `Promise<void>` is source-compatible with M1's `void` return: no M1 caller invokes `cancel`. See `src/core/pipeline/cancellation.ts`, `src/core/pipeline/run.ts`, `tests/core/pipeline-cancel.test.ts`, `tests/helpers/fake-executor.ts`.

---

### Task 2: Mutation gate with a correlation id and a timeout

Built `MutationGate` to correlate `mutation:pending` prompts with their resolution via `requestId`, with a configurable timeout that discards unapplied mutations (R5.14). Extended `StageExecutor` with optional `prepareMutation`/`applyMutation`/`discardMutation` hooks. Three policy decisions: an unapplied mutation makes its stage `skipped` (the alternative reports `passed` while nothing was written); the timeout discards rather than applies (R5.14); cancellation pre-empts the gate so it never emits a prompt nobody can answer. See `src/core/pipeline/mutation-gate.ts`, `src/core/stages/types.ts`, `tests/core/mutation-gate.test.ts`, `tests/core/pipeline-mutation.test.ts`.

---

### Task 3: Bounded worker pool with batch enqueue

Created `createQueue(options)` with `startRun` injection so the queue schedules and the caller wires (the wiring lives in `src/cli/tui-command.ts`). A single mutation slot serialises mutating jobs while read-only jobs skip ahead, preventing head-of-line blocking from one paused prompt. Defined `JobSpec`, `JobRecord`, `QueueEvent`, `QueueHandle`, `MUTATING_STAGES`. Also produced `fakeRun` test helper. See `src/core/queue/pool.ts`, `src/core/queue/types.ts`, `tests/core/queue.test.ts`, `tests/helpers/fake-run.ts`.

---

### Task 4: Cancelling a queued or running job

Implemented `cancelJob(jobId)` — a queued job is removed before anything spawns (no run directory to clean up); a running job is cancelled through its `RunHandle`, which finalises before `cancelJob` resolves. See `src/core/queue/pool.ts`, `tests/core/queue-cancel.test.ts`.

---

### Task 5: Cross-process finalisation and a logged lock reclaim

Proved R6.7 and R6.9 across real processes using `tsx` child scripts, because an in-process test shares a lock table and cannot prove either. Added `ReclaimReason`, `reclaimLogPath`, and `appendReclaimLog` so a reclaimed lock leaves a durable trace in the sidecar. Changed `withSkillLock`'s default reclaim listener to write the log (M1's default was a no-op). See `src/core/workspace/writer.ts`, `tests/helpers/child.ts`, `tests/core/workspace-concurrency.test.ts`.

---

### Task 6: Stream tool output while the tool runs

Added `onChunk` to `runTool` so chunks flow from the redactor's output to the event stream while the tool is still running. Chunks are taken downstream of the redactor, so a secret cannot reach a frontend even though the final capture is redacted separately. `AdapterStageExecutor` forwards chunks via `ctx.onOutput` per-chunk instead of replaying the whole capture after exit. The headless CLI ignores `tool:output` either way. See `src/core/runner/spawn.ts`, `src/core/stages/adapter-stage.ts`, `tests/core/streaming.test.ts`.

---

### Task 7: TUI toolchain and the boundary rule that comes with it

Installed Ink 6 + React 19, configured `react-jsx`, added `.tsx` to vitest, and enforced the deep-import lint rule (`src/tui/**` imports core only through `src/core/index.ts`). Created the `renderInk` test helper and a placeholder `app.tsx` (replaced by Task 10). Deliberately omitted `ink-testing-library` — the helper wraps Ink's own `render` in twenty lines and avoids tracking Ink's major versions. See `src/tui/index.tsx`, `tests/helpers/render-ink.tsx`, `eslint.config.js`.

---

### Task 8: Ring buffer and the fixed-interval log pump

Built `RingBuffer` (fixed-size, allocation-free once full) and `LogPump` (per-source line assembly, ticked flush). One buffer per run rather than per tool, because a per-tool buffer would lose interleaving order on re-merge. The pump keeps a carry string per source so two tools writing concurrently never splice their halves. Memory is bounded by capacity (2000 lines) and renders are bounded by elapsed time (100 ms), not by line count. See `src/tui/log-buffer.ts`, `tests/tui/log-buffer.test.ts`.

---

### Task 9: The store the screen is a function of

Created the `reducer(state, action)` that all components read. `tool:output` events deliberately bypass it — they go to the pump — and the test asserts this by dispatching one and expecting no state change (R11.4). A `runIndex: runId → skillId` map lets later events find their skill row without the caller threading context. See `src/tui/store.ts`, `tests/tui/store.test.ts`.

---

### Task 10: The Work screen

Built `SkillList`, `LifecycleRail`, `OutputPane`, `Work` components and the `App` shell. `App` owns three things: the subscription to `queue.events`, the pump, and the keymap. Everything else is a pure function of `AppState`. R11.1: the skill list, the five-stage rail and the output pane are on screen at the same time, not behind a mode switch. See `src/tui/components/`, `src/tui/app.tsx`, `src/tui/views.ts`, `tests/tui/work-screen.test.tsx`.

---

### Task 11: The three non-log panes, over real files

Proved the findings, artefacts and SKILL.md panes against real disk state, and added a `set-statuses` action so the skill list shows each skill's last recorded outcome (from the sidecar index, not the ledger) before the first run of a session. See `src/tui/store.ts`, `src/tui/app.tsx`, `tests/tui/output-pane.test.tsx`.

---

### Task 12: The queue panel and per-job cancellation

Added `QueuePanel` to the Work screen showing queued, running, and completed jobs (R5.10, R11.6). Wired batch enqueue: marks → specs → one `enqueue` call (R5.5), and per-job cancellation through the `x` key. See `src/tui/components/QueuePanel.tsx`, `src/tui/components/Work.tsx`, `tests/tui/queue-panel.test.tsx`, `tests/tui/app-batch.test.tsx`.

---

### Task 13: Launch the terminal interface from the CLI

Created `tui-command.ts` as the single place where config, credentials, the lockfile and the ledger meet. Added `--concurrency` option and a default action so `skillgantry` (no subcommand) launches the TUI while `skillgantry run …` stays headless. Exposed `startTui` on `CliDeps` as a test seam. See `src/cli/tui-command.ts`, `src/cli/run-command.ts`, `tests/cli/tui-command.test.ts`.

---

### Task 14: M2 acceptance suite

One named test per M2 exit criterion: live Work screen rendering, additive-only M1 surface, concurrent finalisation without index loss (R6.7), all four cancellation phases (R5.13), and the 10,000-line ring buffer bound (R11.4 + R11.5 — the on-disk log has all 10,000 lines while renders stay under 200). See `tests/acceptance/m2.test.ts`.

---

## Requirement coverage for M2

Every requirement M2 owns, and the task that satisfies it. A requirement with no task is a plan defect.

| Requirement | Task |
|---|---|
| R5.3 any stage in isolation, any completed stage re-runnable | 3 (queue), 14 (real pipeline, two runs of one skill) |
| R5.4 no automatic optimise → validate loop | 2 (pipeline never re-enters), 3 (queue never self-enqueues) |
| R5.5 multi-skill, multi-stage batch enqueue | 3 (`enqueue(specs[])`), 12 (marks and one call from the screen) |
| R5.6 bounded pool, configurable, default 2 | 3 (`concurrency`), 13 (`--concurrency`, config fallback) |
| R5.7 mutating stages serialised regardless of the limit | 3 (single mutation slot) |
| R5.8 one skill's failure does not stop the others | 3 (`drive` contains every rejection) |
| R5.10 queue visible, queued and running jobs cancellable | 3 (`snapshot`), 4 (`cancelJob`), 12 (panel and key) |
| R5.12 command path beside the event stream | 1 (`cancel`), 2 (`resolveMutation` by correlation id), 4 (`cancelJob`) |
| R5.13 cancellation in four phases, run still finalises | 1 (running, finalising), 2 (awaiting approval), 4 (queued), 14 (all four) |
| R5.14 unresolved mutation times out and discards | 2 |
| R6.7 concurrent runs on one skill | 5 (cross-process), 14 (through the pipeline) |
| R6.9 lock released when its holder dies, reclaim logged | 5 |
| R11.1 skill list, lifecycle rail and output pane at once | 10, 11 (status before the first run) |
| R11.2 Log, Findings, Artefacts and SKILL.md views | 10 (rendering), 11 (real files) |
| R11.4 ring buffer outside React, fixed-interval flush | 8 (buffer and pump), 9 (reducer refuses log text), 10, 14 (10,000 lines) |
| R11.5 full log on disk when the buffer has dropped lines | 6 (runner still writes every byte), 11 (the pane says so), 14 |
| R11.6 queue visible from the Work screen with per-job cancel | 12 |

**Owned elsewhere but touched here.** R11.3's top-level screens are M6; M2 ships Work alone. R5.2's diff-before-write and R12.4's `--yes` are M5; M2 ships the gate they run through and no mutating stage. R13.1 is M1's, and Task 7 extends its lint rule to the new consumer rather than restating the requirement.

**Changed in M1's files, and why.** `runTool` gains `onChunk` and `AdapterStageExecutor` forwards it (Task 6) because R11.4 cannot be met by a frontend that learns everything after the process exits. `withSkillLock`'s reclaim listener gains a reason and a default that writes a log (Task 5) because R6.9 requires the reclaim to be logged and M1's default discards it. Every other edit stays inside the additive rule stated in the constraints.

## Known gaps carried into M3 and M5

Recorded so they are not mistaken for oversights.

- **Read-only and mutating jobs for one skill can overlap.** R5.7 asks only that mutating stages serialise, and the single mutation slot delivers that. A mutating job writing a skill while a read-only job scans it is an isolation question, and isolation is M5's module.
- **The gate has no diff renderer.** `mutation:pending` carries a unified diff and the TUI does not yet display it, because no stage produces one until M5. M5 adds the review pane and the confirmation key.
- **The Work screen is the only screen.** `1`–`4` switch output panels, not top-level screens. Dashboard, Issues and Tools are R11.3 and M6.
- **The Work screen's sidecar reads bypass the ledger.** Cross-repo aggregates need ledger queries, which are M6. Reading one index per skill is fine for the tens of skills in the reference repos and would not be for thousands. `loadSkillStatuses` was the only such read until R11.10 added `loadLastRun` beside it.

## Deviations found while implementing

Each one is a place the plan as written did not survive contact with the shipped code or the installed library. All are in the branch.

- **Ink 6 reads input through `readable` + `read()`, not `data`.** The Task 7 fake stdin delivered no keypress at all. `tests/helpers/render-ink.tsx` now backs `FakeStdin` with a queue and emits `readable` (and implements `unshift`).
- **`runTool` ignored an already-aborted signal.** It attached an `abort` listener after spawning, so a cancel landing in the window between `tool:start` and the listener left the tool running to its timeout. `spawn.ts` now re-checks `signal.aborted` after attaching. Task 1's first case fails intermittently without it.
- **`withSkillLock` crashed on an empty lockfile.** Creating the file and writing its holder are two steps, so a second *process* can read it empty and `JSON.parse('')` threw. An unreadable body now means "holder unknown", reclaimable only by the lease. Task 5's cross-process case is what exposed this; no in-process test could.
- **`createQueue` needed delivery barriers.** `idle()` and the queued branch of `cancelJob` resolved before the events they had just pushed reached a consumer, so Task 3 and Task 4 assertions raced. Both now defer resolution by one macrotask.
- **The queue test harnesses create their fake runs lazily.** As written they built a `FakeRun` inside `startRun`, so a test finishing a whole batch in one loop could never settle the job that had not started yet, and `idle()` hung. `queue.test.ts`, `queue-cancel.test.ts` and `queue-panel.test.tsx` create the run on first access by job id instead.
- **`resolveStages` must tolerate a missing `release` key.** `stageTools` has no `release` entry — release is native — so indexing it by `Stage` does not type-check.
- **`LifecycleRail` passes `color` by spread.** `exactOptionalPropertyTypes` rejects `color={cond ? 'cyan' : undefined}`.
- **The M2 acceptance suite is `tests/acceptance/m2.test.tsx`.** It renders `<App />`, so it cannot be a `.ts` file.
- **`tests/core/spawn.test.ts`'s partial-output timeout is 3s, not 1s.** An M1 test, flaky before this branch and more so as the suite grew: the assertion is that a kill preserves what was already written, and a cold shell can take over a second to emit its first line.
- **Task 13's manual check is unrun.** `node dist/cli/index.js` renders the Work screen, then Ink throws `Raw mode is not supported` because this session has no TTY. Needs a human at a terminal.

## Changelog

- 2026-08-01 — **Compacted post-implementation.** Removed step-by-step tasks, file-by-file diffs, code snippets, and verification commands now that the feature has shipped. Preserved Goal, Design Decisions, Global Constraints, File Structure, Requirement Coverage, Known Gaps, and Deviations. Original plan recoverable via git history.
- 2026-08-02 — **The Work screen learned its own size.** M2 shipped it with fixed pane heights, and the numbers were only ever right in the author's window. Measured against a populated eight-skill state it rendered **26 rows into an 80×24 terminal and 30 into a 60×20 split**, so the header scrolled away and the queue panel fell off the bottom; skill names spilled past the list border, and the rail shattered into `Valid`/`ate`. Design gains §14.1, which is now the contract. Changes, each against the defect that motivated it:
  - **`src/tui/layout.ts` is new and is the only place a pane size is decided.** `layoutFor(columns, rows)` is pure and unit-tested; `Work` reads `useWindowSize()` and passes the result down. Four modes (`wide` ≥ 110, `standard` 76–109, `narrow` 50–75, `too-small` below 50×14). Below the floor the screen states the required size instead of rendering a shredded frame.
  - **Narrow drops borders, not panels.** Four bordered boxes cost 15 rows of chrome in a stacked column against 8 for titles alone, and a 60×20 split has 20 rows in total. `components/Panel.tsx` is new and is the single reader of the `boxed`/`bare` choice; it also unified chrome across all four panels, which had been duplicated four ways. R11.1 holds in every mode.
  - **Three row-budget rules, each from a row that overflowed.** An overflow count or footnote is counted *against* a panel's allocation, never appended below it — that alone was the last row of overflow at 80×24. Content rows carry `wrap="truncate"`. The rail and output pane share one horizontal rule via `borderTop={false}`, recovering the two rows a doubled seam had cost.
  - **`truncate()` measures cells via `string-width`** (new direct dependency), not `.length`, so a CJK skill name cannot overflow its column by its own width. `windowFor()` scrolls a list longer than its pane under the selection; a 20-skill repo previously pushed the queue off the screen.
  - **Discoverability is layered rather than crammed.** The header had spent 118 characters on a keybinding wall that wrapped to three lines at 60 columns; it now carries context (skill count, running/concurrency) and the keys moved to a five-key footer plus a `?` help screen — the one design §14 promised and no code implemented. `:` command palette is still unimplemented and still M6's.
  - **Selection is a cursor glyph plus weight, not reverse video.** An inverse block only covers the label, so a short name left a ragged highlight.
  - **Ink 6.8 → 7.1.** `useWindowSize` (re-renders on SIGWINCH), `alternateScreen` and `usePaste` are all Ink 7. All 66 pre-existing TUI and CLI tests passed on 7 unmounted and unchanged, including the `key.delete`/`key.backspace` handler and the hand-rolled Ink 6 stdin fake in `tests/helpers/render-ink.tsx`. `renderApp` now takes the alternate screen so a session does not bury the user's scrollback; `renderSetup` deliberately does not, being summon-choose-exit.
  - **Tests.** `tests/tui/layout.test.tsx` asserts the rendered frame fits at 200×60, 120×40, 100×30, 80×24, 60×20 and 50×14 — the regression that started this. Plus the too-small message, truncation, windowing, and the `?` help open/close cycle in `work-screen.test.tsx`.
  **Not addressed.** `tests/core/spawn.test.ts > kills the whole process tree on timeout` still fails under full-suite load and passes in isolation. It is the pre-existing flake plan-m3.md already records; nothing here touches `src/core/runner/`.
- 2026-08-05 — **The output pane became readable.** M2 shipped it as a viewport onto four lists and gave the user no way to move it, which held while a run's output was short and stopped holding the moment it was not. Three defects, all in the half of the Work screen this plan owns;
  - **Artefacts and SKILL.md truncated in silence.** Both sliced to the pane's height and said nothing about the rest, so a `SKILL.md` preview that stopped after its frontmatter looked like the whole file, and a user hunting a report the stage had written concluded it had not. Both now carry the overflow notice Findings already had, counted against the allocation per §14.1's first rule.
  - **`+N more` could not say where you were, and there was no way to get there.** The pane is now a focus stop, and `j`/`k` scroll whichever tab is up. The cycle is skills → stages → output → queue, in the order the panels sit on the screen. No new key: it is the model the other three panels already train. The notice names the recovery the current state actually offers, `tab focuses this pane` or `j/k scrolls`.
  - **`AppState.outputOffset` is the first visible row, or `null` for the tab's own anchor** — the top of a findings, artefact or SKILL.md list, the newest line of the log. Null rather than a number because an offset pinned at the tail stops being the tail the moment the next line lands; scrolling back to the newest log line therefore resumes following instead of freezing one line short of it. The offset drops to null when the tab or the selected skill changes, since row 40 carried onto a list of six opens a pane that looks empty.
  - **Scrolling the log reads the flushed window, not the ring buffer.** R11.4 is untouched: `state.log.lines` already holds what the 100 ms tick copied in, and the pane windows over it. No new path from the buffer into React.
  - **`outputWindow()` in `rows.ts` is the one derivation of that window.** The pane renders against it and the key handler clamps against it, because two copies of the arithmetic is how `j` stops moving several rows short of the end and every further press does nothing — the pane and the store disagreeing about how far down is down. It is also why the clamp uses the net row count: the pane spends rows on its own footnotes.
  - **The header stopped counting its own name by hand.** `columns - 13` was `"SkillGantry"` plus two spaces, measured once; renaming the product would have overflowed the row.
  - **Tests.** Four reducer cases in `store.test.ts` (anchor start, clamp to the last full window, a log resuming follow, reset on tab and skill change) and one case in `output-pane.test.tsx` driving the real `App`: tab twice, press `j`, assert the window moved. `queue-panel.test.tsx` tabs three times now, which is the focus cycle's own regression.

  Design §14 gains the paragraph these rules are the code of. **Not addressed:** `tests/acceptance/m3.test.tsx > completes the wizard` flakes under a loaded full-suite run and passes in isolation — reproduced on a clean tree, so it is the wizard's settle windows, not this work.
- 2026-08-05 — **The Work screen forgot every run it had recorded.** Relaunching against `declawed`, which has four runs in the ledger and complete evidence on disk, rendered `·` under all five stages, an empty Findings pane, an empty Artefacts pane, and a `y` that refused with `no run this session`. `SkillRow` had two populating paths and only one survived a relaunch: `status` came from `loadSkillStatuses` reading `index.ndjson`, and `stages`, `findings`, `runDir` and `activeRunId` came from queue events alone. The skill-list glyph therefore worked while everything beside it stayed blank, which is what made it read as a bug rather than as a blank slate. Requirements gains R11.10, owned by M2 with the rest of the Work screen's render rules; design gains §14.5.
  - **`loadLastRun(workspacePath)` in `views.ts` reads the newest run's evidence** — the greatest run id in `index.ndjson`, then one `stage.json` per stage the run executed. A stage with no `stage.json` is skipped, not an error: that is how a run that executed security alone still leaves the other four rail cells at `·`.
  - **`newestRunId()` is now one function** rather than the same `reduce` in `loadSkillStatuses` and again in the new reader. `latest` is deliberately not consulted, for the reason §9.2 gives — it is absent mid-write.
  - **The reducer holds the precedence rule.** `set-last-run` refuses a row whose `activeRunId` or `runDir` is already set. The read is async, so a recorded run resolving after an `r` would otherwise overwrite the live one; `run:start` sets both fields together, which makes one condition serve as both R11.10's precedence rule and that race guard.
  - **Lazily, per selected skill.** Eagerly at launch over 54 skills is 270 reads to fill four rows. The effect sits beside the SKILL.md and artefact loaders and captures `skillId`, so a response landing after the selection moved still lands on the row it was read for. Artefacts needed no change at all — its effect already depends on `runDir`.
  - **The Log pane replays per skill.** It shipped unreplayed first, naming the run's directory instead, because `state.log` is one session-wide buffer shared by every skill and seeding it is ambiguous while one skill runs and another is selected. A screenshot of the shipped screen settled it: four panes had loaded and the fifth named a path, which reads as a pane that failed rather than as a scope boundary. So the lines go somewhere else — `SkillRow.recordedLog` plus a `rehydrated` flag that `run:start` clears — and `logLines()`/`logDropped()` in `rows.ts` resolve which log the pane is showing, beside `outputWindow` and for its reason. The buffer is untouched, so R11.4 is untouched and a skill that has not run this session cannot show whichever skill did. Capped at `LOG_CAPACITY` newest-first, reported through the footnote R11.5 already pays for; stdout then stderr per tool, since the pipeline writes two files and the interleaving is not on disk.
  - **`y`'s refusal case changed meaning.** With a recorded run now presented, `runDir === null` means the skill has never run — where the `skillgantry fix` command line it used to offer would exit 1 too. It says `press r`. R11.9 and design §14.3 are amended to match.
  - **Tests.** `loadLastRun` over a fabricated sidecar in `output-pane.test.tsx` (greatest id not last line, a skipped stage, an absent workspace, and the sidecar byte-identical afterwards); four `set-last-run` reducer cases in `store.test.ts`; a `work-screen.test.tsx` case rendering `App` over a real sidecar with nothing enqueued; and the payoff case in `fix-prompt-key.test.tsx` — `y` copying a rehydrated run's prompt with no run started.
