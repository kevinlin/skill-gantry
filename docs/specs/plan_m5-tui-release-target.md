# M5 extension — releasing from the terminal

**Requirements:** R11.19, R11.20 (rev 16), owned by M5.
**Design:** [design_tui.md §14.9](design_tui.md); [design.md §8.1](design.md) row 0.

## Why

Run `019fe543-fcab-77da-a316-16877e43e428` released `zapac-agent-skills/declawed` from the Work screen and failed in 90ms:

```
"stage": "release", "outcome": "failed",
"summary": "no target version supplied: release never infers one (R9.10)"
```

The engine was right. §12.4 row 3 is exactly that refusal, and R9.10 requires it. The defect was that the terminal offered an action it could not complete: `releaseTarget` had one producer in the codebase — the headless `--version` flag — `JobSpec` had no field to carry one, and `startRun` never passed one. A TUI release had never succeeded in any build, and `ReviewPane`, which M5 built to be R5.2's "interactive confirmation of a displayed diff", was unreachable in production as a result: the only other mutating stage is `optimise`, which ships no adapter.

Two defects of the same family were fixed with it, both found while tracing the first.

**Marking `optimise` lost the whole run.** The terminal sets `authorised: true`, so the stage passed R12.4's skip and reached `AdapterStageExecutor.plan()`'s R4.11 rejection. `plan()` was the one executor call outside the stage loop's try, so the throw escaped as `run:error` — no `stage.json`, no ledger row, none of the partial evidence R5.13 requires. Worse than the release failure, which at least recorded itself.

**The release would have refused even with a version.** `declawed/.skillspector-baseline.yaml` was untracked and inside the release scope, so R10.3 refused, and the terminal had no `--allow-dirty` equivalent. That file is M8's own output, so the workflow M8 had just shipped — accept a finding, write a baseline, re-run gates, release — dead-ended in the terminal.

## Decisions

- **The target is collected before the job, not at the diff.** Forced by the data flow: the target is what produces the diff, since `stageCandidateEdits` writes the version bump the diff shows.
- **`r` opens the surface; there is no second run key.** R5.5's batch shape is untouched, and `markedStages` keeps one meaning.
- **A release job is its own batch, `['release']` alone.** R9.9 binds the release to gates recorded against the current digest; gates in the same job would be recording their pass while the release read the ledger for it.
- **`planRelease` returns a freshly read `SkillRef`, and the enqueued job carries it.** `App` builds `byId` once and never refreshes it, so after one release in a session the in-memory version is the one just superseded. Headless was never affected — `runRelease` calls `selectSkill` per invocation.
- **The pre-flight stops at R10.3's dirty paths.** No gate, digest or deprecation check: the stage re-derives all of those against the live tree, and a second authority fed by a stale ledger read would block releases that would have succeeded.
- **The override is a tab stop toggled by `space`, not a letter key.** Both other fields are free text and `t` — `SuppressPane`'s toggle — is in `patch`.
- **No requirement id for the `plan()` boundary.** Revision 7's precedent: R4.13's enumeration is prefixed "at least", so the table gains row 0 and a `plan-failed` error kind.

## Key files

| Change | File |
|---|---|
| `plan()` inside the stage's failure boundary | `src/core/pipeline/run.ts` |
| `plan-failed` error kind | `src/core/types.ts` |
| R10.3 pre-flight | `src/core/release/preflight.ts` (new), `src/core/isolation/git-worktree.ts` (exports `dirtyPaths`) |
| `releaseTarget`, `allowDirty` on a job | `src/core/queue/types.ts` |
| the port | `src/tui/views.ts`, `src/cli/gantry-views.ts` |
| slot, resolution, batch refusal | `src/tui/store.ts` |
| the surface | `src/tui/components/ReleaseTargetPane.tsx` (new) |
| `r`, `enter`, the mark guard | `src/tui/app.tsx` |
| forwarding to the pipeline | `src/cli/tui-command.ts` |

Tests: `tests/core/pipeline-plan-failure.test.ts`, `tests/tui/release-target.test.tsx`, plus the authorised-empty-selection case in `tests/cli/run-command.test.ts`.

## Deviations found while implementing

- **The `plan()` failure needed its own `ErrorKind`, which the plan had not anticipated.** `mutation-aborted` was the closest existing fit and is wrong: §8.1 documents it as a write refused *after* authorisation, and nothing is built on this path. Added `plan-failed`. No ledger migration — `error_kind` is an unconstrained `text` column.
- **The dirty override could not use `t`.** The plan named `t`, mirroring `SuppressPane`. `SuppressPane` can bind a letter because its reason editor is an explicit mode; this pane is two free-text fields, and `t` is in `patch`. Resolved as a third tab stop, which needs no modifier and no mode.
- **Three existing TUI suites marked stages they had not configured.** `focus-zones`, `arrow-keys` and `app-batch` passed `stages={['security']}` and then marked `validate`, which R11.20 now refuses. They are about which zone owns a key, not about configuration, so each was given the stages it marks. The guard firing in three suites that never meant to test it is the evidence it was needed.
- **`tests/helpers/fake-views.ts` was silently incomplete.** `tsconfig.json` includes `src` only, so a `FakeViews` missing a `GantryViews` member is not a compile error — it would have failed at runtime as `views.planRelease is not a function`. Worth knowing before the next port method: the type says the fake is complete and nothing checks it.
- **The `optimise` guard subsumed part of R4.11.** R4.11 requires an empty selection to be rejected "before the run starts", and until R11.20 the terminal had no way to honour that. The engine's row 0 is now defence in depth rather than the only line.

## What the first real release found (rev 17)

The surface worked on the first try — target `patch → 1.1.2`, notes, R10.3's override raised with its path named, sandbox opened, preconditions run. The release then failed on a second defect the original bug had been hiding, because no terminal release had ever got far enough to reach it. Runs `019fe58d` and `019fe590`:

```
validate/evaluate/security passed against sha256:299bb1…
the candidate is now                      sha256:0f2851…
```

`declawed/.DS_Store` was gitignored. The candidate manifest walks the filesystem, so it counted the file and the gates digested it; the git worktree starts at HEAD and is seeded from `git status`, which hides ignored files, so the sandbox did not have it. R9.9 compared two different sets of files — and re-running the gates reproduced the same live digest and refused again. Not a refusal the user could act on: a release made structurally impossible. It was never TUI-specific; `skillgantry release` hits it identically, by construction, since the precondition check is shared.

Nor was it one file: 51 `.DS_Store` files in that repo plus `__pycache__/` under two skill roots, so most skills in it could not be released.

Two fixes, composed:

- **`dirtyPaths` passes `--ignored`** (R10.2). The sandbox now reproduces the manifest rather than git's default view of it, which is what makes R9.9 satisfiable at all. Membership is still asked of the manifest, so a path the candidate excludes is reported by git and dropped.
- **`.DS_Store` and `Thumbs.db` leave the candidate** (R2.9, §4.4). Without this the fix above would seed them into the worktree and ship them to consumers. R2.9's basename prohibition was written against revision 2's `snapshot-pre/` rule, which matched a name a real skill directory could carry; these two cannot be, so they earn the exception rather than merely surviving it.

**Cost, accepted deliberately:** every skill's digest changes, so every gate run recorded before this is invalid under R9.9 and must be re-run before that skill can be released. Correct — the old digests counted bytes that were never part of the skill.

**A third defect fell out.** `stageForDiff` staged only the scope, and `git add -A` skips ignored files, so a seed made entirely of non-scope paths staged nothing and the seed commit failed with "nothing to commit", taking the sandbox open down as a §12.4 row-4 abort. Pre-existing — an untracked candidate file outside the scope with a clean scope would have done it — but `--ignored` makes it the common case. It now force-adds the seeded paths, and the commit takes `--allow-empty`, because a failed one costs a sandbox where an empty one costs nothing.

## Flagged, not fixed

- **`byId` is stale for every field, not just `version`.** `App` snapshots the `SkillRef`s it was rendered with and never refreshes, so `deprecated` and `name` can drift from `SKILL.md`, which R1.6 makes the authority. Only `release` reads `version`, so only `release` was fixed. A refresh on `run:done` would close it generally at the cost of re-walking every registered repo per run.
- **`optimise` still has no adapter.** D7 deferred both candidates. R11.20 makes that visible instead of fatal; it does not fill the gap.
