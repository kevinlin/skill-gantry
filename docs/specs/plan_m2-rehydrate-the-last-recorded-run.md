# Work screen: rehydrate the last recorded run

## Context

Relaunching `skillgantry` against a skill with recorded runs shows an empty screen: the lifecycle rail reads `·` under all five stages, Findings is empty, Artefacts is empty, and `y` refuses with `no run this session` — while every byte of that evidence sits on disk.

Verified against live state:

- 4 runs for `zapac-agent-skills/declawed` in the ledger, newest `019fcf6e` outcome `failed`
- `declawed-workspace/skillgantry/runs/019fcf6e-.../03-security/stage.json` carries outcome, verdict, per-tool summaries and 2 findings; `fix-prompt.md` is beside it
- `index.ndjson` holds all 4 records; `latest` resolves

**Root cause.** `SkillRow` in [store.ts:83-93](src/tui/store.ts#L83-L93) is populated by exactly two paths, and only one of them survives a relaunch:

| Field | Written by | Rehydrated on launch |
|---|---|---|
| `status` | `set-statuses` ← `loadSkillStatuses` reads `index.ndjson` | yes |
| `stages` (rail cells) | `stage:start` / `tool:done` / `stage:done` events | **no** |
| `findings` | `tool:done` events | **no** |
| `runDir`, `activeRunId` | `run:start` event | **no** |

`loadSkillStatuses` ([views.ts:61-75](src/tui/views.ts#L61-L75)) is the only launch-time read, added in M2 Task 11 for the skill-list glyph alone. Everything else is a pure function of the session's queue event stream, so it starts empty and stays empty until `r` is pressed. `runDir` being null also disables Artefacts (`listArtefacts(null)` returns `[]`) and the `y` fix-prompt key.

The screenshot's `!` beside `declawed` and green `●` beside `experience-prototype` are the glyph path working — which is what makes the empty rail beside them read as a bug rather than a blank slate.

**Outcome.** Selecting a skill loads its most recent recorded run from the sidecar: stage outcomes and summaries on the rail, the findings list, the artefact list, and a working `y`. No run needs to be started.

**Scope decisions taken with the user.** The Log pane is *not* replayed — its lines live in one session-wide ring buffer shared by every skill while everything above is per-skill state, so seeding it has ambiguous semantics when one skill is running and another is selected. Instead the empty-log message names the recorded run's directory. And this lands as a new binding requirement, R11.10, not as an unrecorded defect fix.

---

## Spec changes

### `docs/specs/requirements.md`

Header note: add revision 10, one change only.

New requirement after R11.9:

> - **R11.10** On selecting a skill, the Work screen MUST present that skill's most recently recorded run without a run having been started in the session: the lifecycle rail's per-stage outcome and summary, the findings list, and the artefact list. It MUST read them from the run's sidecar evidence rather than the ledger, per R8.2, and MUST NOT write to the sidecar. A run started or completed in the session MUST take precedence, and a recorded run MUST NOT overwrite one. *(rev 10)*
>   *Rationale:* the Work screen was a pure function of the session's event stream, so relaunching against four recorded runs showed an empty rail, an empty findings list, an empty artefact list, and refused `y` naming a case that no longer describes the state.
>   *Verify:* a session that has enqueued nothing renders the selected skill's last stage outcomes and findings; a stage that run did not execute still reads `·`; a run started in the session is not replaced when the selection leaves and returns; the sidecar is byte-identical after selection.

Ownership table — **M2**, which already owns every other Work-screen render requirement (R11.1, R11.2, R11.4–R11.6). Add `R11.10` to the M2 row and one exit criterion:

> ; a relaunch renders the selected skill's last recorded rail, findings and artefacts with nothing enqueued, and never replaces a run the session started

R11.9 wording: `no run this session` is no longer reachable while a run is on disk, so the case becomes *no recorded run*, and the `skillgantry fix` fallback it names would itself exit 1. Change the requirement's enumerated case to "no recorded run" and drop the fallback claim.

### `docs/specs/design.md`

New **§14.5 Rehydrating the last recorded run**, carrying `*Satisfies R11.10.*` so `tests/specs/traceability.test.ts` claims it. Content:

- Why the sidecar and not the ledger: R8.2 makes the sidecar the evidence, the screen already knows its skill so no cross-skill query is needed, and `src/tui/**` may not open the ledger. Same reasoning `skillgantry fix` records at [fix-command.ts:54-60](src/cli/fix-command.ts#L54-L60), and the same resolution rule — greatest run id in `index.ndjson`, never the `latest` symlink, which is absent mid-write.
- Why lazily, per selected skill: one index read plus up to five `stage.json` reads. Eager over 54 skills at launch is 270 reads for four rows on screen. Matches the SKILL.md and artefact panes, which already load on selection.
- Why the reducer holds the precedence rule and not the effect: the read is async, so a `r` pressed while it is in flight must not have its live run clobbered by a response that resolves after `run:start`. `run:start` sets `activeRunId` and `runDir` together, so refusing when either is set is both the precedence rule and the race guard, in one condition evaluated at dispatch time.
- Why the Log pane is not replayed, and what it says instead.

§14.3: update the "no run this session" sentence to match the new R11.9 wording.

### `docs/specs/plan_m2.md`

Append a dated entry to the `## Changelog` section, in the register of the two entries above it — the defect first, then the rules that came out of it. Also strike the now-false clause in **Known gaps**: `loadSkillStatuses` is no longer the only launch-time sidecar read.

`docs/specs/index.md` needs no row: no new spec file.

---

## Code changes

### `src/core/index.ts` — export `runsRoot`

Additive, one identifier onto the existing `workspace/layout.js` export line. [fix-command.ts:127](src/cli/fix-command.ts#L127) currently hard-codes `join(skill.workspacePath, 'skillgantry', 'runs', runId)`; switch it to `join(runsRoot(skill.workspacePath), runId)` so the new reader and the existing one cannot disagree about the layout.

### `src/tui/views.ts` — `loadLastRun`

Sits beside `loadSkillStatuses`, which it shares a resolution rule with — factor the `reduce` that picks the greatest run id into a local `newestRunId(entries)` and call it from both.

```ts
export interface LastRunStage {
  stage: Stage
  outcome: StageOutcome
  summary: string
  findings: RawFinding[]
}

export interface LastRun {
  runId: string
  runDir: string
  /** Only stages the run executed; the rest stay `·` on the rail. */
  stages: LastRunStage[]
}

export async function loadLastRun(workspacePath: string): Promise<LastRun | null>
```

- newest run id from `readIndex(workspacePath)`, null when the index is empty or unreadable
- `runDir = join(runsRoot(workspacePath), runId)`
- per stage in `STAGE_ORDER`, read `join(stageDirFor(runDir, i + 1, stage), 'stage.json')` as `StageResult`; ENOENT means the run did not execute it — skip, do not throw
- `summary`: `toolRuns.map(r => r.summary).join(', ')`, matching what `stage:start` does with tool ids
- `findings`: `toolRuns.flatMap(r => r.findings)`

Read-only throughout — R11.10 and R12.6 share that constraint, and the pipeline stays the only writer under `runs/`.

### `src/tui/store.ts` — `set-last-run`

```ts
| { type: 'set-last-run'; skillId: string; run: LastRun }
```

Reducer case, via the existing `withSkill` helper:

- refuse when `row.activeRunId !== null || row.runDir !== null` — the precedence rule and the in-flight race guard in one condition
- otherwise set `runDir`, build `stages` from `emptyStages()` overlaid with the recorded ones (per-cell `outcome`, `summary`, `findings` count, `running: false`), and `findings` as the recorded stages' findings concatenated in stage order
- leave `status` alone: `set-statuses` already owns it from the same index

### `src/tui/app.tsx`

New effect beside the existing panel loader:

```ts
useEffect(() => {
  if (!current || current.runDir !== null) return
  const skillId = current.skillId
  void loadLastRun(current.workspacePath).then((run) => {
    if (run !== null) dispatch({ type: 'set-last-run', skillId, run })
  })
}, [current?.skillId, current?.runDir])
```

`skillId` captured so a response landing after the selection moved still lands on the row it was read for. The artefacts pane needs no change — its effect already depends on `current?.runDir` and re-fires when this sets it.

`y` handler: the `current.runDir === null` branch now means no run has ever been recorded, so `skillgantry fix` would exit 1 too. Flash `no recorded run for <skillId> — press r` instead of naming the CLI.

### `src/tui/components/OutputPane.tsx`

Log pane, empty case only: when `skill.runDir` is set but no lines have flushed, say `no output this session — logs under <runDir>` (through `truncateMiddle`, so the run id survives) rather than `no output yet — select a skill and press r`. Same single row, no budget change.

---

## Tests

| File | Cases |
|---|---|
| `tests/tui/output-pane.test.tsx` | `loadLastRun` over a fabricated sidecar (`tests/helpers/tmp-repo.ts`): resolves the greatest run id not the last index line; skips a stage with no `stage.json`; returns null on an absent workspace; the sidecar is byte-identical afterwards |
| `tests/tui/store.test.ts` | `set-last-run` fills an untouched row; refuses a row with `activeRunId` set; refuses a row whose `runDir` this session wrote; an unrecorded stage stays `outcome: null` |
| `tests/tui/work-screen.test.tsx` | render `App` over a real sidecar with nothing enqueued — the rail shows the recorded outcome under its stage, `2 Findings` lists the recorded findings, `3 Artefacts` lists the run's files |
| `tests/tui/fix-prompt-key.test.tsx` | new case: `y` copies the prompt from a **rehydrated** run, no run enqueued — the payoff case. Update the existing no-run case to the new flash wording |
| `tests/specs/traceability.test.ts` | unchanged; passes only once R11.10 has one owner and §14.5 claims it |

## Verification

```bash
pnpm check          # lint && build && test && acceptance
```

Then against real data, which is what produced the report:

```bash
skillgantry         # select declawed
```

Expect: rail reads `FAIL` under Security and `·` elsewhere (that run executed security alone); `2` lists the two medium findings (`excessive-permission` on `SKILL.md`, `prompt-injection` on `scripts/scan.py`); `3` lists `03-security/skillspector/findings.sarif` and the two logs; `1` names the run directory; `l` `l` then `y` copies `03-security/fix-prompt.md` and flashes `copied`.

Then press `r` on the same skill and confirm the recorded state is replaced by the live run, not merged with it.
