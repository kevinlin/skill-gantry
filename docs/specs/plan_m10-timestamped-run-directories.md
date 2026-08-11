# Plan — M10: timestamped run directories

**Date:** 2026-08-11
**Status:** shipped
**Layer:** plan (layer 3 of 3: [requirements](requirements.md) → [design](design.md) → plan)
**Satisfies:** R6.1, R6.4, R6.7 as amended in requirements revision 26; D32
**Design:** [design.md](design.md) §9, §9.1, §9.2, §11.3, §13, §15

---

## Why

A skill's sidecar named every run directory by its UUIDv7 run id:

```
code-review-expert-workspace/skillgantry/runs/019fcf6e-3a11-7c02-9f04-1d2e3f4a5b6c/
```

`ls` on a workspace with six runs was six UUIDs. Nothing in the name said when a run happened, so identifying one meant opening `run.json` in each candidate. The directory is now `YYYY-MM-DD_HH-mm-ss` from the run's start time, and the run id stays where the ledger, the index and the `--run` selector already expect it — inside `run.json`.

## The one idea

**The name and the identity answer different questions, so they are separated rather than exchanged.**

Nothing was moved onto the timestamp. `latest`, gate authority (`gates.ts`), issue reconciliation (`issues.ts`) and the rule-map migration all still compare run ids as strings, which is only sound because UUIDv7 is time-ordered and cannot tie. A directory name at one-second precision can and does tie — which is exactly why it makes a good label and a bad key.

Four consequences follow, and they are the whole change:

1. **The claim retries the name, not the id.** `claimDirIn(root, base)` takes `<base>`, `<base>-2`, `<base>-3` under exclusive `mkdir`. Retrying the id would collide again: the name comes from the clock. The attempt bound rose from 5 to 100, because 5 was safe only while each attempt drew a fresh UUID and collided by accident; a clock-derived name collides by construction for every run started in the same second.
2. **The index carries the directory name.** `IndexEntry` gains `dir`, and `runDirFor(ws, entry)` is the single resolver. An entry with no `dir` is read as a run named by its id — the rule that held when such entries were written, so pre-M10 workspaces resolve with no migration.
3. **Recovery stopped reconstructing paths.** `recordDirFor` is deleted. `scanSandboxRecords` already enumerated the real directories under `runs/` and `retire/` and discarded the path; it now returns `{ record, dir }`. This is strictly better than a fallback: recovery is now indifferent to the naming scheme rather than tracking it.
4. **`--run` takes either handle**, matching the id first, so a directory named like an id cannot make the argument ambiguous.

Retirement uses the same name and the same claim loop, so the two groups one recovery scan walks read the same way.

## Key files

| Concern | File |
|---|---|
| `runDirName`, `runDirFor` | `src/core/workspace/layout.ts` |
| `claimDirIn`, `claimRunDir(ws, startedAt)`, `IndexEntry.dir`, `latest` | `src/core/workspace/writer.ts` |
| one `startedAt` instant for the record and the name | `src/core/pipeline/run.ts` |
| `{ record, dir }` from the scan | `src/core/isolation/record.ts`, `src/core/isolation/recover.ts` |
| retire record claimed like a run directory | `src/core/release/retire.ts` |
| newest-entry resolution | `src/tui/views.ts`, `src/cli/fix-command.ts`, `src/cli/optimise-command.ts` |

## Deviations found while implementing

- **The plan said "add an M10 row to § Milestone ownership". It must not.** The change amends R6.1, R6.4 and R6.7 in place and adds no requirement id, and `tests/specs/traceability.test.ts` fails a requirement claimed by two milestones. The ownership table is unchanged; M10 appears only in design §18's change history.
- **The retry bound had to move.** Not foreseen: the acceptance suite claims 40 directories across two processes inside one second, which a bound of 5 rejects. The bound was never about the retry *count* before — a fresh UUID per attempt made a second collision vanishingly unlikely — so it had to be re-derived from what now causes collisions.
- **`latest`'s ordering reduce changed shape, not rule.** It reduces over entries rather than ids so the winner's `dir` is in hand; the field it orders on is untouched. The distinction is worth naming because the obvious simplification — order on `dir`, since that is what gets written — reintroduces the exact tie R6.7's "one stable field" exists to rule out.
- **`tests/acceptance/m2.test.tsx` had to resolve a dir it previously derived.** The queue's job summary carries `runId` and no directory, so the test reads the index. Left as-is rather than widening the summary: the pipeline's `RunSummary` already carries `runDir`, and the queue is not a run-evidence reader.
