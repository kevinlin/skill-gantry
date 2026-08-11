# SkillGantry M5 Implementation Plan

**Status:** shipped, compacted post-implementation.
**Goal:** Let SkillGantry write to the user's repo without ever being able to lose their work. Two mutation sandboxes behind one interface, a journalled apply with a preimage recheck, crash recovery from a marker written before the first byte moves, and on top of that the release stage: package, prove the archive installs, then touch the working tree once.

**Architecture:** M5 adds two modules to `src/core/` — `isolation` and `release` — plus one native stage executor, a diff review pane in the TUI, and three subcommands (`release`, `retire`, `recover`), taking the CLI to six. The pipeline owns the sandbox lifecycle so both mutating stages share one path; the executor only declares scope and decides. No adapter and no catalogue entry: release wraps no tool of its own.

**Tech Stack:** everything M1–M4 ship, and no new npm dependency. `git`, `zip` and `unzip` are invoked as external commands through the existing `Exec` seam, matching the choice already made for `tar`/`unzip` in `tools/gh-release.ts`.

## Global Constraints

Everything in [plan_m1-engine-and-sidecar.md's Global Constraints](plan_m1-engine-and-sidecar.md), [plan_m2-queue-and-tui.md's](plan_m2-queue-and-tui.md), [plan_m3-tools-module.md's](plan_m3-tools-module.md) and [plan_m4-adapters-and-merge.md's](plan_m4-adapters-and-merge.md) still holds. These are the additions.

- Import boundary unchanged: `cli → tui → core`; `src/tui/**` reaches core only through `src/core/index.ts`; no `console` or `process.exit` in `src/core/**`; no `node:fs` / `node:child_process` / `node:https` / `node:net` in `src/core/adapters/**`.
- `src/core/isolation/**` and `src/core/release/**` own fs and subprocess. Neither opens the ledger. Release's gate query lives in `src/core/ledger/gates.ts` and reaches release as data, which is the rule that already keeps `tools` and `queue` out of sqlite.
- **A mutating stage writes nothing before `sandbox.json` exists.** R10.10. The record is the only thing that makes a crash during the tool, or while awaiting approval, recoverable — the apply journal does not exist until apply.
- **Nothing is applied without a preimage recheck.** R10.11. Every target's current content hash is compared against the hash captured when the change set was built, and a mismatch aborts naming the drifted paths.
- **No claim of atomicity across files.** R10.9. The journal is a compensating-transaction record: prior bytes first, then temp-write-fsync-rename per target, then mark complete.
- **Packaging and the installability check complete before any write to the user's tree.** R9.6a. Everything is built and proven in the sandbox; abort before apply is a sandbox discard with nothing to compensate.
- **The candidate manifest is the archive.** R9.4, R2.9. The zip holds exactly `candidateManifest()`'s entries — no directory entries, no workspace, no `.git`, no earlier archive, symlinks stored as links.
- **`SKILL.md` frontmatter is the authority for lifecycle state.** R1.6. Release preconditions read the candidate's frontmatter, never the ledger; the `skills.lifecycle_state` column is a cache reconciled on discovery, and a divergence is drift to report.
- **The target version is never inferred.** R9.10. A semver or a bump level, supplied explicitly, or the release refuses.
- **Release never commits.** R9.7, R10.7. Committing and tagging are a separate confirmed action, and M5 ships neither.
- **`git`, `zip` and `unzip` must be on PATH for a mutating stage**, in both repo kinds. Checked in one preflight that names the missing command, never discovered halfway through an apply.
- British spelling in identifiers that appear in the specs (`optimise`, `artefact`, `normalise`).
- Conventional Commits, lowercase imperative subject.

## Facts established by running the real tools

Probed 2026-08-03 against the pinned versions installed under `~/.skillgantry/tools`. Several tasks depend on these; none is an assumption.

**1. vercel `skills` 1.5.21 installs a local directory, non-interactively, into its cwd.**

```
cd <isolated-dir> && skills add <extracted-dir> --copy --skill '*' --agent claude-code -y
```

Exit `0` on success. It writes `<cwd>/.claude/skills/<skillName>/` and `<cwd>/skills-lock.json` and nothing else — a probe with `HOME` pointed at an empty temp directory left that directory empty, so the isolated destination R9.6 requires is the cwd, not an env var. `--agent claude-code` matters: without it the tool installs to **all 75 agents it knows**, which is 75 copies of the skill per gate run.

Exit `1` with `No valid skills found. Skills require a SKILL.md with name and description.` on a directory holding no valid skill. So the R9.6 gate is a genuine exit-code gate, and a skill whose frontmatter carries no `description` fails it — R2.5 tolerates that for discovery, and release does not.

`DO_NOT_TRACK` is honoured by the binary. The gate sets it: a release check must not emit an install telemetry event on the user's behalf.

**2. `versions.json` nests its entries under a `skills` key, keyed by directory name.** The reference repo's file is `{ "skills": { "architecture-diagram": "1.1.1", … } }`, twenty entries, values bare semver strings. A top-level `{ "<name>": "…" }` assumption would have written a second, wrong manifest shape into 20 real skills.

**3. `zip` with an explicit entry list is manifest-exact.** From the staging root:

```
zip -X -y -q <out.zip> <relPath> <relPath> …
```

produces exactly those entries, in the order given, with symlinks stored as links (`-y`) and the exec bit preserved. Verified by round-tripping through `unzip`. Passing a directory (`zip -r .`) instead adds directory entries the manifest does not have, so the entry list is not an optimisation — it is what makes the archive equal to the digested set. `-X` drops extra attributes; the archive is still not byte-reproducible, because zip embeds mtimes. The skill digest is the reproducible identity; the archive SHA-256 is evidence of one build.

**4. A detached worktree yields all five change kinds once the change is staged.** `git worktree add --detach <tmp> HEAD`, then inside it `git add -A -- <scope paths>`, then:

- `git diff --cached --raw -M -z` → `:<srcMode> <dstMode> <srcSha> <dstSha> <status>\0<path>[\0<path2>]`. Added is `A` with src mode `000000`; a **mode change reports status `M`** and is only visible as `srcMode !== dstMode`; a rename is `R100` followed by **old path then new path**.
- `git diff --cached --numstat -M -z` → `-\t-\t<path>` marks a binary file.
- `git diff --cached --binary -M` → the unified diff, with `GIT binary patch` hunks and `old mode`/`new mode` lines.

Staging inside the sandbox is free: the worktree is thrown away. Without it a rename appears as an unrelated delete plus an untracked add, which R10.8 explicitly forbids. Note the path order inverts between `git status --porcelain -z` (new, then old) and `git diff --raw -z` (old, then new); the raw form is the one this plan parses.

**5. `git diff --no-index --binary` renders a diff outside a repo.** It is how the snapshot strategy produces the same preview text as the worktree strategy, so R10.5's "identical review" is one renderer rather than two. It exits `1` when the files differ, which is success, not failure.

**6. `reconcile.ts` already tolerates a tool with no adapter.** `scopeFor` reads `getAdapter(toolId)?.manifest.detects ?? []`, and a tool that has produced no rule class for a skill yields an empty scope, which the loop skips. So the release stage may record a `tool_runs` row for vercel `skills` — a catalogued tool with no adapter — without touching a single issue.

**7. `AdapterStageExecutor` hard-codes `mutating = false` and returns `mutationScope: { paths: [] }`.** Nothing in the shipped pipeline can open a sandbox; `gateMutation` exists and is unreachable because no executor implements `prepareMutation`. M5 makes both true rather than adding a parallel path.

**8. `run-command.ts` filters mutating stages out of the request when `--yes` is absent** and prints a synthetic `stage:done` line for each. Nothing reaches the engine or the ledger, so R12.4's skip is invisible to `doctor`, to statistics and to the sidecar. Task 7 moves the decision into the pipeline.

## Spec amendments this milestone carries

All land in Task 1, before the code that depends on them, per the repo rule that a spec proven wrong is corrected in the same branch.

1. **R10.11's abort has no outcome to report itself with.** `ErrorKind` has nine members, one per non-passing row of the R4.13 table, and none of them describes "the change set was built, approval was given, and the apply refused because a target had drifted". Left unamended, `applyMutation` throwing propagates out of `gateMutation` and the whole run rejects with `run:error`, losing the evidence R5.13 requires a cancelled or aborted run to keep. R4.13's list of conditions is prefixed "at least", so the table gains one row rather than the requirement gaining a suffixed id: design §8.1 gains **row 3b — a mutation apply aborted after authorisation → `errored`, `error_kind = 'mutation-aborted'`, does not reconcile**, and R4.13's enumeration gains "an aborted mutation apply".
2. **Design §13 says how retirement writes and not where it is invoked.** A capability with no entry point cannot be tested through the interface a user has. §13 gains the invocation path (`skillgantry retire <skill> [--undo] [--superseded-by <id>] [--yes]`), and §15 lists it beside `release`. No requirement changes: R1.4 owns the behaviour, and which command carries it is an implementation choice.
3. **R10.10 requires startup to detect an unresolved record and design §12.2 does not say which startup.** §12.2 gains: the CLI detects on every launch and names the resolving command, and a new mutating run against a skill holding an unresolved record refuses. §15 lists `skillgantry recover`.
4. **Design §12.4 does not say what the release stage reports as a tool run.** §12.4 gains the classification table in Task 11, since `StageResult` carries no message of its own and `reduceStageOutcome` throws on an empty outcome list.
5. **Design §16's Release and `isolation` rows gain the cases this plan actually writes**, and §17's M5 module row gains `stages/mutation.ts` and `ledger/gates.ts`.

## Critical Files — Summary

| Path | Role |
|---|---|
| `src/core/isolation/types.ts` | `MutationSandbox`, `ChangeSet`, `Preimage`, `SandboxRecord` |
| `src/core/isolation/git-worktree.ts` | git worktree sandbox with five change kinds and dirty-override seeding |
| `src/core/isolation/snapshot.ts` | snapshot sandbox for non-git repos, same interface |
| `src/core/isolation/journal.ts` | journalled apply with preimage recheck, compensating rollback, symlinks as links |
| `src/core/isolation/record.ts` | `sandbox.json` written before anything moves (R10.10) |
| `src/core/isolation/recover.ts` | startup sweep and `skillgantry recover` restore/forget |
| `src/core/isolation/open.ts` | `openSandbox()` dispatch on `repo.isGit` |
| `src/core/isolation/preflight.ts` | `requireCommands()`: `git`, `zip`, `unzip` on PATH |
| `src/core/isolation/diff.ts` | one diff renderer via `git diff --no-index` for both strategies |
| `src/core/release/release.ts` | the §12.4 state machine |
| `src/core/release/preconditions.ts` | gate, digest, lifecycle and version checks |
| `src/core/release/archive.ts` | `packageCandidate()` — `zip -X -y -q` over the candidate manifest |
| `src/core/release/install-check.ts` | `verifyInstallable()` — extract and install via vercel `skills` |
| `src/core/release/retire.ts` | `retireSkill()`: standalone mutation through the ordinary path |
| `src/core/stages/release-stage.ts` | `ReleaseStageExecutor`; `passed` means staged and proven installable |
| `src/core/stages/mutation.ts` | sandbox-backed prepare/apply/discard shared by both mutating stages |
| `src/core/pipeline/run.ts` | sandbox lifecycle, authorisation gate, abort handling |
| `src/core/ledger/gates.ts` | `latestGateOutcomes()` — release reads gates as data |
| `src/core/ledger/lifecycle.ts` | `syncLifecycle()` — the cache reconciled from frontmatter on discovery |
| `tests/acceptance/m5.test.ts` | one named test per M5 exit-criterion clause, crash cases in a child process |

---

## Tasks

### Task 1: Spec amendments, the new error kind, and the mutating preflight

Amended R4.13 to add the aborted-mutation-apply row, and design §8.1, §12.2, §13, §15, §16, §17 alongside it. Added `mutation-aborted` to `ErrorKind`. Shipped `requireCommands`, which probes `git`, `zip` and `unzip` on PATH before a sandbox opens — a missing command names itself instead of being discovered halfway through an apply.

### Task 2: The sandbox interface, the one diff renderer, and the record written before anything moves

Defined `MutationSandbox`, `ChangeSet`, `ChangeEntry`, `Preimage`, and the `SandboxRecord` types. Built one diff renderer via `git diff --no-index`, so R10.5's identical review is a property of the code rather than two implementations agreeing. Shipped the `sandbox.json` record: written before any mutating tool starts, it is the only thing that makes a crash during the tool or while awaiting approval recoverable.

### Task 3: `GitWorktreeSandbox` — five change kinds, and a dirty override that seeds

Implemented the git worktree sandbox: `git worktree add --detach`, staging inside the throwaway worktree to report renames (without staging, a rename reads as an unrelated delete plus an untracked add). The dirty override seeds the worktree from the user's working tree and records preimages, so the tool sees the user's actual bytes and the later apply does not silently overwrite uncommitted work. Also added `makeGitRepo` and `SKILL_MD_FULL` test helpers.

### Task 4: `SnapshotSandbox` — the same interface over a repo with no git

Implemented the snapshot sandbox for non-git repos: copies the declared scope into `snapshot-pre/` using the candidate manifest as the exclusion authority, runs the tool against the live tree, and computes the change set by comparison. Added `openSandbox` dispatch that selects the strategy from `repo.isGit`.

### Task 5: Journalled apply, the preimage recheck, and recovery from an interrupted one

Implemented the journal: prior bytes and metadata fsynced to `journal-bytes/` and `journal.json` before the first live target moves, then temp-write-fsync-rename per target. Added `recheckPreimages`, which compares each target's current content hash against the preimage and aborts naming the drifted paths. Added `rollbackJournal`, which restores from the recorded prior bytes. Symlinks are handled as links throughout: the journal reads through the `S_IFLNK` bit in the recorded mode.

### Task 6: Startup recovery and `skillgantry recover`

Implemented `scanInterrupted` and `restoreInterrupted`, which sweep workspace directories for `sandbox.json` records in `state: active`. Every CLI launch prints one `warning:` line per unresolved record and never blocks; a new mutating run against a skill with an unresolved record refuses. `skillgantry recover --restore <id>` restores from the snapshot or prunes the worktree; `--forget <id>` marks it discarded.

### Task 7: The pipeline owns the sandbox, and authorisation becomes the engine's decision

Moved the sandbox lifecycle into `run.ts`: open before the executor, gate the mutation, apply or discard, and dispose in a `finally` that `execute()` is inside. Made `authorised` a `StageContext` field so the engine decides whether to skip a mutating stage — R12.4's `--yes` removal became a pipeline property rather than a CLI filter. Added row 3b handling so an aborted apply yields `mutation-aborted` instead of propagating out.

### Task 8: The release decisions — version, frontmatter, changelog, manifest, preconditions

Built the pure-decision half of release: `resolveTargetVersion` (semver or bump level against the frontmatter), `setFrontmatterVersion` and `setDeprecated` (regex-based, preserving surrounding frontmatter), `prependChangelogEntry`, `readVersionsManifest` and `setManifestVersion` (the `{ "skills": { … } }` shape), and `checkPreconditions` (gates passed, digests match, not deprecated, versions agree).

### Task 9: The archive, the installability gate, and the evidence bundle

Implemented `packageCandidate`, which runs `zip -X -y -q` over the exact candidate manifest entries — no directory entries, symlinks as links. Added `verifyInstallable`, which extracts the staged archive and installs the directory via `vercel skills add --copy --agent claude-code -y`, with `DO_NOT_TRACK=1`. Wrote `writeEvidenceBundle` for the evidence directory under the run.

### Task 10: Frontmatter as the lifecycle authority, the ledger as a cache

Added `deprecated` to `SkillRef` from frontmatter, `syncLifecycle` to reconcile the `skills` table on discovery, and a `lifecycle_state` column set from the authority on `recordRun`. `doctor` reports a mismatch as `lifecycle-drift`. Release preconditions read the candidate's frontmatter, never the ledger.

### Task 11: `ReleaseStageExecutor` and the §12.4 state machine

Shipped the release stage executor: validate-preconditions → resolve-target-version → stage-candidate-edits → package-in-sandbox → verify-install → build-change-set. The executor's `passed` means "staged and proven installable" — the write is the pipeline's through `gateMutation`. The tool run is recorded under `RELEASE_TOOL_ID` against vercel `skills`, which reconciles nothing.

### Task 12: `skillgantry release` and the headless diff-before-write

Added the `release` subcommand with `--version` (required), `--yes`, `--json`, `--allow-dirty`, and `--notes`. Added `enablePositionalOptions()` on the root program — without it commander caught `--version minor` as the root's own `--version`.

### Task 13: Retirement, through the ordinary mutation path

Implemented `retireSkill`, which writes `metadata.deprecated: true` into `SKILL.md` frontmatter through the ordinary mutation path: declared scope, diff preview, confirmation, journal. Its sandbox record lives under `retire/<id>/`, so startup recovery finds it with no special case. Added `skillgantry retire` with `--undo`, `--superseded-by`, `--yes`, `--json`, `--allow-dirty`.

### Task 14: The review pane, and resolving a mutation from the queue

Added the TUI review pane as a modal over the Work screen: the diff is displayed, `a` applies, `d` discards. Wired `QueueHandle.resolveMutation` to route the decision through `pool.ts` to the blocked `run.ts`. The review is the first branch in both `Work.tsx` and `app.tsx`, so the diff is always visible before the key is active.

### Task 15: The M5 acceptance suite

Wrote one named test per M5 exit-criterion clause in `tests/acceptance/m5.test.ts`: both sandbox strategies over five change kinds, crash during the mutating tool, crash while awaiting approval, dirty-skill guard and override, preimage drift, digest mismatch, no-manifest release, packaging failure, installability failure, deprecated skill, and release ledger recording. The two crash cases run in a child process via `tests/helpers/child.ts`.

---

## Requirement coverage for M5

Every requirement M5 owns, and the task that satisfies it. A requirement with no task is a plan defect.

| Requirement | Task |
|---|---|
| R1.4 retirement sets deprecation metadata, release refuses, gates still run | 10 (`SkillRef.deprecated`), 13 (the write and its reversal), 11 (`checkPreconditions` refuses), 15 |
| R1.6 frontmatter is the authority, the ledger a cache reconciled on discovery | 10 (`syncLifecycle`, `recordRun`), 11 (preconditions read the candidate's frontmatter), 13 |
| R5.2 no write without authorisation, diff before write in every mode | 7 (the gate and `authorised`), 12 (headless diff ordering), 13 (retirement), 14 (terminal confirmation of a displayed diff) |
| R9.1 dual version bump, or `SKILL.md` alone with no manifest, never creating one | 8 (`setManifestVersion`, `readVersionsManifest`), 11 (`stageCandidateEdits`) |
| R9.2 refuse when the two versions disagree, reporting both | 8 (`version-disagreement`), 11 (a `versions.json` that exists but does not parse refuses too, rather than falling through to the no-manifest path and releasing over a manifest that may already contradict it) |
| R9.3 changelog entry at `<skillDir>/CHANGELOG.md` | 8 (`prependChangelogEntry`), 11 |
| R9.4 archive is exactly the candidate manifest, staged, reviewed, journalled, rolled back | 9 (`packageCandidate`), 11 (copied into the sandbox so it joins the change set), 15 |
| R9.5 evidence bundle | 9 (`writeEvidenceBundle`), 11 (written after the apply) |
| R9.6 installability by extracting and installing that directory | 9 (`verifyInstallable`) |
| R9.6a packaging and verification before any write to the working tree | 11 (the state machine's order), 15 |
| R9.7 no commit or tag as part of applying | 11, 15. Nothing in the apply path invokes git. The one `git commit` in the codebase is the dirty-override seed (Task 3), which runs at sandbox *open*, inside the throwaway worktree, with `--no-verify`; its objects are unreachable garbage once the worktree is removed and the user's own history is never written |
| R9.8 refuse unless the recent gates passed, or when deprecated | 8 (`checkPreconditions`), 11 |
| R9.9 refuse unless each gate run's digest equals the candidate's | 8 (`digest-mismatch`), 11, 15 |
| R9.10 target version supplied explicitly | 8 (`resolveTargetVersion`), 11 (refuses with none), 12 (`--version` is required) |
| R9.11 release as an explicit state machine with an abort path from every state | 11 |
| R10.1 sandbox over a declared path scope, possibly outside the skill directory | 3, 4 (scope is an input), 11 (`releaseScope` spans the repo root) |
| R10.2 git-backed repo uses a detached worktree | 3 |
| R10.3 refuse a dirty skill unless overridden; the override seeds and records preimages | 3, 13 (`retire --allow-dirty` reaches the same guard), 15. Both the check and the seed span the whole candidate, not only the declared scope: the digest is taken over the candidate, so leaving the rest at HEAD made release refuse with an unactionable `digest-mismatch` |
| R10.4 non-git repo copies the declared scope to `snapshot-pre/`, modes and links preserved | 4 |
| R10.5 one interface, an identical review | 2 (one diff renderer), 4 (`openSandbox` dispatch) |
| R10.6 rollback restores every path in the declared scope | 4 (`restoreSnapshot`), 5 (`rollbackJournal`), 15. `restoreSnapshot` restores the scope but deletes only what the manifest-filtered copy could have captured — restoring "every path" literally deleted live files the snapshot deliberately never took, the repo's own `.gitignore` and any stale archive among them |
| R10.7 applying never creates a commit | 5 (the journal writes files and nothing else) |
| R10.8 the change set represents all five kinds, not only text | 3, 4, 15 |
| R10.9 journal before any target is modified, compensating rollback, no atomicity claim | 5 |
| R10.10 active-sandbox record before a mutating tool starts; startup detects and offers | 2 (the record), 3, 4 (written at open), 6 (`scanInterrupted`, `skillgantry recover`), 15 |
| R10.11 preimage recheck immediately before applying, aborting on drift | 5 (`recheckPreimages`), 7 (row 3b), 15 |
| R12.4 a mutating stage is skipped without `--yes`; with it the diff precedes the write | 7 (the engine decides), 12 |
| R12.5b `release` as a headless subcommand | 12 |

**Owned elsewhere but shaped here.**

- **R4.13** (M1) gains one row. The table is what R4.13 owns and its enumeration is prefixed "at least", so the amendment is in place rather than as a suffixed id that would need its own milestone owner under R13.7 — Task 1.
- **R5.13** (M2) is cancellation in four phases. `awaiting-approval` is only reachable now that a stage produces a mutation; Task 7's cases exercise it against a real sandbox rather than a fake executor.
- **R5.7** (M2) serialises mutating stages. M5 is the first milestone with one, so Task 15's release cases are what actually exercise the mutation slot.
- **R5.14** (M2) is the unresolved-prompt timeout, and Task 5's preimage recheck is what makes the widened window safe.
- **R2.9, R2.10** (M1) — Task 9 makes the archive and Task 4 makes the snapshot two more consumers of the one candidate manifest, symlinks included.
- **R3.5a** (M3) installed vercel `skills` for a gate nothing invoked. Task 9 invokes it.
- **R3.9, R12.5a** (M3) — doctor's `lifecycle-drift` becomes resolvable now that something reconciles the cache.
- **R6.1–R6.3** (M1) — `staging/`, `snapshot-pre/`, `sandbox.json`, `journal.json` and `evidence/` all land under the run directory the sidecar layout already defines.
- **R11.1, R11.2** (M2) — the review pane is modal over the Work screen, like the help screen, and obeys design §14.1's row budget.

**Deferred within M5, with reasons.**

- **The optimise stage ships no tool.** No catalogued optimise tool exists — both D7 candidates are unpublished, per plan_m3-tools-module.md. R4.8 stays satisfied structurally, and Task 7 proves the mutating path with a fake optimiser rather than leaving it unexercised until a tool appears.
- **Git commit and tag stay unimplemented.** R9.7 forbids release from committing, and D9 offers committing as a separate confirmed action. Nothing in R9 requires SkillGantry to perform it, so it stays out.
- **The TUI has no retirement or recovery screen.** `skillgantry retire` and `skillgantry recover` are the entry points; the Tools and Issues screens are R11.3 and M6.
- **No `optimise → validate` loop.** R5.4, deferred by D6.

## Known gaps carried forward

- **`git`, `zip` and `unzip` become hard requirements for a mutating stage**, in both repo kinds — the snapshot strategy renders its preview with `git diff --no-index`. The preflight names the missing command before anything is written, but a machine without them can gate and never release. A pure-JS diff and zip writer would remove the dependency and reimplement two mature tools; the repo's standing rule prefers the tools.
- **The archive is not byte-reproducible.** zip embeds mtimes, so two builds of identical bytes differ. The skill digest is the reproducible identity; the archive SHA-256 is evidence of one build. A `-X` flag plus a fixed mtime would fix it and is not required by R9.
- **The installability gate installs to one agent.** `--agent claude-code` is a choice: the default installs to all 75 agents vercel `skills` knows, which is 75 copies per gate run. A skill that only resolves for a different agent would pass a gate that did not exercise its case.
- **A skill with no `description` in its frontmatter cannot be released.** vercel `skills` refuses to install it, so the gate fails. R2.5 deliberately tolerates missing frontmatter for discovery; release does not, and the refusal names the tool's own message rather than explaining the requirement.
- **`occurrence_count` and the release tool run.** The release stage records a `tool_runs` row under `skills`, a tool with no adapter. It reconciles nothing (probed fact 6), but it does appear in per-tool statistics as a tool that always reports zero findings.
- **Renamed binaries are never flagged `binary`.** `git diff --numstat` reports a rename with `0 0` and no binary marker, and the snapshot strategy classifies a content-equal pair as `renamed` before it inspects the bytes. The rename is represented, which is what R10.8 requires; the flag is display metadata.
- **The snapshot strategy's rename detection is content-based**, so two files with identical bytes, one deleted and one added, read as a rename even when the user meant two independent changes. Git's own heuristic has the same property.
- **Retirement does not run through the queue**, so a retirement and a mutating stage on one skill are not serialised against each other by R5.7's mutation slot. The preimage recheck catches the collision at apply rather than preventing it.
- **`syncLifecycle` ignores a skill the ledger has never seen.** A repo registered but never run has no `skills` row, so a deprecated skill in it is invisible to a ledger query until its first run. Discovery is the authority and reads the file, so nothing behaves wrongly; only the cache lags.
- **R13.7's mechanical coverage check still does not exist.** M3 and M4 both recorded it; M5 edits the ownership table by hand again, in Task 1, so the gap is now three milestones old and belongs to whichever milestone next touches traceability.

Found while implementing, and left standing:

- **The TUI holds one pending-review slot, and a displacement is only ever a bug signal.** Two reviews cannot legitimately be live at once: `pool.ts` admits one mutating job at a time and `run.ts` serialises pendings within a job. So the `(+N waiting)` count does not mean "another skill is queued behind this diff" — it means the slot still held a request whose resolution the store never saw. It resets when the slot empties. If R5.12 later admits two mutating jobs concurrently, the slot becomes a real queue and this count stops being diagnostic.
- **`abortedStage` uses the stage name as the tool id when the stage selected no tool.** Release plans no tools, so an aborted release records a `tool_runs` row whose `tool_id` is `release`. Reconciliation tolerates it (no adapter, no rule classes), but per-tool statistics will show it as a tool.
- **The `--stage optimise --yes` selection is checked mid-loop, not before the run.** R4.11 says an unauthorised mutating stage is rejected "before the run starts"; on the default config, where `optimise` selects no tool, an authorised request throws inside the stage loop and escapes before `finalizeRun`. A pre-run selection check in `run-command.ts` closes it.
- **`src/cli/index.ts` does not catch `program.parseAsync`.** A commander rejection surfaces as an unhandled rejection trace rather than commander's one-line stderr and exit 1. The reachable case is `release` with no `--version`. Pre-existing shape, newly reachable.
- **A no-op retirement leaves an empty record directory.** `retire/<id>/` is created before the no-change check, so declining or re-retiring an already-deprecated skill leaves a settled but empty directory behind.
- **`journal-bytes/` creation is not separately fsynced.** The first backup file's `fsyncDir` covers it in practice, since a directory with no entries has nothing to lose.
- **`ENTRIES_PER_CALL` batching in `archive.ts` is untested.** No fixture approaches the 500-entry threshold that would split the `zip` invocation.
- **`resolve('')` normalises to `'.'` and returns the work root** instead of rejecting as a scope escape. Nothing passes an empty path; the guard is one case short of total.

## Deviations found while implementing

Where the shipped code diverged from this plan's literal instructions, and why. A plan is a record of intent; these are the places building against it proved the intent wrong.

1. **`unzip` is probed with `-v`, not `--version`.** `unzip --version` exits non-zero on a working binary, so the preflight reported a false negative on every machine.
2. **The diff renderer rewrites header lines only.** The plan's global `replaceAll` over the diff text mangled any body line containing the temp path fragment, including git's own `a/` and `b/` prefixes. Rewriting `---`/`+++`/`diff --git` lines alone is the correction. `Binary files a/X and b/Y differ` is still not rewritten and leaks the temp path. The `diffBuffers` helper this task specified was written, never called by either sandbox, and removed.
3. **Three git facts the plan had wrong.** `git add -A -- <pathspec>` is fatal when the pathspec matches nothing, so the scope is staged path by path; the dirty-override seed must be committed *inside* the worktree or the baseline stays at the original HEAD and the user's own edit reads as the tool's; and a fixture `chmod` dirties the repo under `core.fileMode`.
4. **The candidate manifest is the exclusion authority for the snapshot copy**, not the bespoke list the plan wrote — CLAUDE.md's single-authority rule. An outside-root scope path falls back to a documented raw copy. Copy-time exclusions therefore come from the manifest while `changeSet()`'s expansion stays manifest-unaware: an added archive is a change to represent even though the manifest excludes an existing one from candidacy.
5. **The journal fsyncs a barrier before the first live write.** The plan wrote the prior bytes and the journal in program order with no `sync`, which does not give R10.9 what it needs: a power loss can persist the live mutation while the backup naming it is still in write-back cache.
6. **Recovery distinguishes a complete journal from an absent one.** The plan's `rollbackJournal` returned `[]` for both, so a crash landing between the journal's completion mark and `markSandboxRecord('applied')` fell through to a full snapshot restore and reverted an apply the user had approved.
7. **`restoreSnapshot(snapshotDir, skill, scope)`** takes a `SkillRef` and an explicit scope, not the plan's optional `excluded` parameter with a permissive default, which was a trap for every later caller. It is also bounded by the candidate policy: it never deletes a live path the manifest-filtered copy could not have captured.
8. **`execute()` runs inside the sandbox disposal `try`.** The plan left it outside, so a release executor throwing out of `execute` skipped disposal and left the worktree registered and the record `active` forever.
9. **The release stage's `passed` is "staged and proven installable".** `prepareMutation` returns null unless `execute` reached that state. The plan let a refused release still yield an approvable change set, which could have half-applied a version bump with no archive and no evidence.
10. **Exec failures are classified from the error object, not its message.** The plan's regex over `err.message` never matched: a timeout's message is `Command failed: …` with no "timeout" in it. `killed` and a string `code` are what Node actually states.
11. **`enablePositionalOptions()` on the root program.** Without it commander scans the whole argv for the root's own options first, so `release <skill> --version minor` was caught by the root `--version` and never reached the subcommand. Confirmed against a standalone commander repro.
12. **`retireSkill` takes `allowDirty` from the caller.** The plan defaulted it to true, which removed R10.3's decision from the user and made `--allow-dirty` inert. A no-op retirement now exits 0 with a message, while a genuine decline still exits 1.
13. **The review pane is the first branch in both `Work.tsx` and `app.tsx`.** The plan rendered help and the too-small notice ahead of it while giving the review keymap precedence, so `a` could authorise a write whose diff was never displayed. `offset` means first-visible in both the reducer and the component, clamped at both ends.
14. **The release scope is force-staged.** `git add -A` silently skips a gitignored path, and the release archive is exactly the kind of file a repo gitignores — so release reported `passed` with no zip in the change set and evidence that said otherwise.
15. **A failure after the apply is `mutation-incomplete`, not a discard.** The plan had one abort kind. Settling a completed apply as an abort flipped a git sandbox's marker to `discarded` over a written tree, putting it beyond recovery, or restored the pre-tool snapshot over an approved apply.
16. **Recovery sweeps `<target>.sg-tmp` before deciding anything.** A crash between `writeAtomic`'s temp file and its rename leaves one inside the candidate root, where it changes every later digest and so blocks the next release.
17. **The journal handles symlinks as links.** It was the one place in the system still reading through them: the apply wrote a regular file over a user's link, the rollback restored a copy of its target, and a dangling link preimaged as "does not exist" so drift could not see a retarget.

## Changelog

- 2026-08-03 — revision 1, written against design.md revision 3, requirements.md revision 6 and shipped M1–M4. Facts probed against vercel `skills` 1.5.21, `zip`/`unzip`, `git` 2.x and the real `versions.json` of `zapac-agent-skills`.
- 2026-08-03 — **Shipped.** Fifteen tasks plus a whole-branch review and its fix wave. Deviations recorded above; four coverage rows corrected where the shipped contract turned out narrower or wider than this plan claimed; eight gaps found during implementation added to Known gaps. design.md took six amendments, recorded in its §18.3.
- 2026-08-03 — **Compacted post-implementation.** Removed step-by-step tasks, file-by-file diffs, code snippets, and verification commands now that the feature has shipped. Preserved Goal, Global Constraints, Facts, Spec Amendments, Critical Files summary, Requirement Coverage, Known Gaps, and Deviations. Original plan recoverable via git history.
