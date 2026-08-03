# SkillGantry M5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** shipped. Revision 1, aligned to [design.md](design.md) revision 3, [requirements.md](requirements.md) revision 6, and shipped M1–M4. See § Deviations found while implementing for where the code and this plan parted company.

**Goal:** Let SkillGantry write to the user's repo without ever being able to lose their work. Two mutation sandboxes behind one interface, a journalled apply with a preimage recheck, crash recovery from a marker written before the first byte moves, and on top of that the release stage: package, prove the archive installs, then touch the working tree once.

**Architecture:** M5 adds two modules to `src/core/` — `isolation` and `release` — plus one native stage executor, a diff review pane in the TUI, and three subcommands (`release`, `retire`, `recover`), taking the CLI to six. The pipeline owns the sandbox lifecycle so both mutating stages share one path; the executor only declares scope and decides. No adapter and no catalogue entry: release wraps no tool of its own.

**Tech Stack:** everything M1–M4 ship, and no new npm dependency. `git`, `zip` and `unzip` are invoked as external commands through the existing `Exec` seam, matching the choice already made for `tar`/`unzip` in `tools/gh-release.ts`.

## Global Constraints

Everything in [plan-m1.md's Global Constraints](plan-m1.md), [plan-m2.md's](plan-m2.md), [plan-m3.md's](plan-m3.md) and [plan-m4.md's](plan-m4.md) still holds. These are the additions.

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

Probed 2026-08-02 against the pinned versions installed under `~/.skillgantry/tools`. Several tasks depend on these; none is an assumption.

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

## File structure

```
src/
  core/
    types.ts                    MODIFIED  ErrorKind += 'mutation-aborted'
    index.ts                    MODIFIED  isolation, release, lifecycle, gates exports
    discovery/
      discover.ts               MODIFIED  SkillRef.deprecated, from frontmatter
    isolation/
      types.ts                  NEW       MutationSandbox, ChangeSet, ChangeEntry, Preimage
      preflight.ts              NEW       requireCommands(): git, zip, unzip
      diff.ts                   NEW       unifiedDiffFor() via git diff --no-index
      record.ts                 NEW       sandbox.json: write, read, scan, mark
      journal.ts                NEW       journal write, apply, compensating rollback
      git-worktree.ts           NEW       GitWorktreeSandbox
      snapshot.ts               NEW       SnapshotSandbox
      open.ts                   NEW       openSandbox() dispatch on repo.isGit
      recover.ts                NEW       scanInterrupted(), restoreInterrupted()
    release/
      version.ts                NEW       resolveTargetVersion() — pure
      frontmatter-edit.ts       NEW       setFrontmatterVersion, setDeprecated — pure
      changelog.ts              NEW       prependChangelogEntry — pure
      manifest.ts               NEW       versions.json read and edit
      preconditions.ts          NEW       checkPreconditions() — pure
      archive.ts                NEW       packageCandidate() — zip
      install-check.ts          NEW       verifyInstallable() — unzip + vercel skills
      evidence.ts               NEW       writeEvidenceBundle()
      release.ts                NEW       the §12.4 state machine
      retire.ts                 NEW       retireSkill(): the standalone mutation flow
    stages/
      types.ts                  MODIFIED  StageContext.sandbox / releaseTarget / authorised
      mutation.ts               NEW       sandbox-backed prepare/apply/discard, shared
      adapter-stage.ts          MODIFIED  mutating from MUTATING_STAGES, mutation hooks
      release-stage.ts          NEW       ReleaseStageExecutor
    ledger/
      gates.ts                  NEW       latestGateOutcomes()
      lifecycle.ts              NEW       readLifecycleCache(), syncLifecycle()
      record.ts                 MODIFIED  lifecycle_state from skill.deprecated
    pipeline/
      run.ts                    MODIFIED  sandbox lifecycle, release executor, authorised, abort
    queue/
      types.ts                  MODIFIED  QueueHandle.resolveMutation
      pool.ts                   MODIFIED  resolveMutation routing
  tui/
    store.ts                    MODIFIED  pending mutation state and actions
    app.tsx                     MODIFIED  modal review, a/d keys, resolveMutation
    components/
      ReviewPane.tsx            NEW       pure render of a pending mutation
  cli/
    run-command.ts              MODIFIED  release/retire/recover subcommands, --yes → authorised
    release-command.ts          NEW
    retire-command.ts           NEW
    recover-command.ts          NEW
    tui-command.ts              MODIFIED  authorised: true, lifecycle sync, interrupted notice
    doctor-command.ts           MODIFIED  lifecycleCache moves into core/ledger/lifecycle.ts
tests/
  helpers/
    tmp-repo.ts                 MODIFIED  makeGitRepo(), SKILL_MD_FULL()
    fake-mutating-tool.ts       NEW       a shell script that edits inside the sandbox
  core/
    preflight.test.ts           sandbox-record.test.ts      isolation-diff.test.ts
    isolation-git.test.ts       isolation-snapshot.test.ts  isolation-journal.test.ts
    isolation-recover.test.ts   pipeline-sandbox.test.ts
    release-version.test.ts     release-frontmatter.test.ts release-changelog.test.ts
    release-manifest.test.ts    release-preconditions.test.ts
    release-archive.test.ts     release-install-check.test.ts
    release-stage.test.ts       retire.test.ts
    gates.test.ts               lifecycle.test.ts
  tui/
    review-pane.test.tsx
  cli/
    release-command.test.ts     retire-command.test.ts      recover-command.test.ts
  acceptance/
    m5.test.ts
docs/specs/
  requirements.md               MODIFIED  R4.13 gains the aborted-apply condition
  design.md                     MODIFIED  §8.1 row 3b, §12.2, §12.4, §13, §15, §16, §17
  index.md                      MODIFIED  plan-m5 row
```

---

## Tasks

### Task 1: Spec amendments, the new error kind, and the mutating preflight

**Files:**
- Modify: `docs/specs/requirements.md` (R4.13 enumeration)
- Modify: `docs/specs/design.md` (§8.1, §12.2, §13, §15, §16, §17)
- Modify: `docs/specs/index.md` (plans table)
- Modify: `src/core/types.ts:32-42`
- Create: `src/core/isolation/preflight.ts`
- Test: `tests/core/preflight.test.ts`

**Interfaces:**
- Produces: `ErrorKind` gains `'mutation-aborted'`. `requireCommands(commands: readonly string[], exec?: Exec): Promise<void>` throws `Error('mutating stage needs <name> on PATH')` on the first absent command. `MUTATION_COMMANDS: readonly string[]` = `['git', 'zip', 'unzip']`.

- [ ] **Step 1: Amend R4.13's enumeration in `docs/specs/requirements.md`**

In R4.13, extend the list of conditions the table must cover, and add the amendment marker. The sentence currently ends `…absent authorisation, and spawn failure.` Replace with:

```
absent authorisation, an aborted mutation apply, and spawn failure.
```

Then append to R4.13's marker list, after the *(rev 6, …)* paragraph:

```
  A mutation apply that aborts after authorisation MUST be a row of this table. *(rev 7, M5 planning: R10.11 requires an apply to abort naming the drifted paths, and no `ErrorKind` described that state, so the abort propagated out of the pipeline as an unhandled rejection and the run lost the partial evidence R5.13 requires it to keep. R4.13's enumeration is prefixed "at least", so the table gains a row rather than the requirement gaining a suffixed id that would need its own milestone owner under R13.7.)*
```

- [ ] **Step 2: Add row 3b to design §8.1's table**

In `docs/specs/design.md`, immediately after the row `| 3 | Mutating stage reached without authorisation | skipped | no-authorisation | no |`:

```
| 3b | Mutation apply aborted after authorisation (preimage drift, journal failure, sandbox open failure) | `errored` | `mutation-aborted` | no |
```

And after the paragraph beginning "Rows 7 and 8 are ordered so…", add:

```
Row 3b is the one row a *stage* rather than a tool produces. R10.11 aborts an apply when a target has drifted since the change set was built, and that is neither a tool failure nor a verdict about the skill: the tools ran and were understood, and then the write was refused. Without the row, `applyMutation` throwing propagated out of the pipeline and the run rejected, discarding the partial evidence R5.13 requires a cancelled or aborted run to keep.
```

- [ ] **Step 3: Extend `ErrorKind`**

```ts
// src/core/types.ts
/** One per non-passing row of the R4.13 classification table. */
export type ErrorKind =
  | 'spawn'
  | 'timeout'
  | 'missing-artefact'
  | 'parse'
  | 'cancelled'
  | 'not-installed'
  | 'no-credentials'
  | 'no-authorisation'
  | 'artefact-too-large'
  /**
   * Row 3b. A stage, not a tool: the change set was built and authorised, and
   * then the write was refused — by preimage drift (R10.11), by a journal that
   * could not be written, or by a sandbox that could not be opened.
   */
  | 'mutation-aborted'
```

- [ ] **Step 4: Write the failing preflight test**

```ts
// tests/core/preflight.test.ts
import { describe, expect, it } from 'vitest'
import { MUTATION_COMMANDS, requireCommands } from '../../src/core/isolation/preflight.js'
import type { Exec } from '../../src/core/tools/exec.js'

const present: Exec = async () => ({ stdout: '/usr/bin/thing\n', stderr: '' })
const absentAll: Exec = async () => {
  throw new Error('exit 1')
}

describe('requireCommands', () => {
  it('resolves when every command answers', async () => {
    await expect(requireCommands(['git', 'zip'], present)).resolves.toBeUndefined()
  })

  it('names the first absent command rather than the last failure', async () => {
    const only = new Set(['git'])
    const exec: Exec = async (_bin, argv) =>
      only.has(argv[0] as string)
        ? { stdout: '/usr/bin/git\n', stderr: '' }
        : Promise.reject(new Error('exit 1'))
    await expect(requireCommands(['git', 'zip', 'unzip'], exec)).rejects.toThrow(
      'mutating stage needs zip on PATH',
    )
  })

  it('fails on the first of all-absent rather than reporting three errors', async () => {
    await expect(requireCommands(MUTATION_COMMANDS, absentAll)).rejects.toThrow(
      'mutating stage needs git on PATH',
    )
  })

  it('names all three commands a mutating stage needs', () => {
    expect([...MUTATION_COMMANDS]).toEqual(['git', 'zip', 'unzip'])
  })
})
```

- [ ] **Step 5: Run it and watch it fail**

Run: `pnpm vitest run tests/core/preflight.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/isolation/preflight.js"`.

- [ ] **Step 6: Implement the preflight**

```ts
// src/core/isolation/preflight.ts
import { type Exec, defaultExec } from '../tools/exec.js'

/**
 * Both sandbox strategies need all three. `git` is not only the worktree
 * strategy's: the snapshot strategy renders its preview with
 * `git diff --no-index`, so a non-git repo needs the binary even though it has
 * no repository.
 */
export const MUTATION_COMMANDS: readonly string[] = ['git', 'zip', 'unzip']

/**
 * Checked once, before a sandbox is opened. Discovering a missing `zip`
 * after the tool has written the live tree would leave a mutation that can be
 * neither packaged nor reviewed, with the marker already claiming it is active.
 */
export async function requireCommands(
  commands: readonly string[],
  exec: Exec = defaultExec,
): Promise<void> {
  for (const command of commands) {
    try {
      await exec('command', ['-v', command], { timeoutMs: 10_000 })
    } catch {
      throw new Error(`mutating stage needs ${command} on PATH`)
    }
  }
}
```

- [ ] **Step 7: Run the test and confirm it passes**

Run: `pnpm vitest run tests/core/preflight.test.ts`
Expected: PASS, 4 tests.

Note: `command -v` is a shell builtin, so `execFile('command', …)` fails on every platform. Replace the invocation with a real binary probe before moving on:

```ts
      await exec(command, ['--version'], { timeoutMs: 10_000 })
```

`git`, `zip` and `unzip` all answer `--version` with exit 0. Re-run the test; the injected `Exec` receives `argv[0] === '--version'` for every command, so the second case's `only.has(argv[0])` check no longer distinguishes them — change that case to key off `bin` instead of `argv[0]`:

```ts
    const exec: Exec = async (bin) =>
      only.has(bin) ? { stdout: '/usr/bin/git\n', stderr: '' } : Promise.reject(new Error('exit 1'))
```

- [ ] **Step 8: Amend the remaining design sections**

In `design.md` §12.2, after the `sandbox.json` code block, add:

```
**Where startup is.** `src/cli/` detects on every launch — before the Work screen, before a headless run — and prints one line per unresolved record naming `skillgantry recover`. It does not block the launch: an old marker the user has decided to leave alone must not make the tool unusable. What does block is a *new* mutating run against a skill that holds an unresolved record, which refuses, because applying a second mutation over an unrecovered first is how a compensating rollback stops being able to compensate.
```

In §13, after the four authority bullets, add:

```
**Invocation.** `skillgantry retire <skill> [--undo] [--superseded-by <id>] [--yes]`. Retirement is not one of the five stages, so it does not run through the pipeline; it runs the same declared-scope, diff-preview, confirmation and journal path directly, with its sandbox and journal under `<workspacePath>/skillgantry/retire/<id>/`. That directory shape is deliberate: startup recovery scans for `sandbox.json` under the workspace, so an interrupted retirement is recovered by the same code as an interrupted release, with no special case.
```

In §15, replace the command block with:

```
skillgantry run <skill> [--repo <path>] --stage validate,evaluate,security
                        [--json] [--yes] [--concurrency N]
skillgantry doctor [--json]
skillgantry release <skill> --version <semver|major|minor|patch> [--yes] [--json]
skillgantry retire <skill> [--undo] [--superseded-by <id>] [--yes] [--json]
skillgantry recover [--restore <runId>] [--forget <runId>] [--json]
```

In §16's table, replace the `isolation` and `Release` rows' Method cells to name the real cases (five change kinds per strategy, crash during the mutating tool, crash awaiting approval, dirty override seeding, concurrent edit between preview and apply, incomplete journal replay) and add a row:

```
| Mutation preflight | `git`, `zip`, `unzip` absent one at a time | A missing command fails before `sandbox.json` is written, naming the command |
```

In §17's "Modules built" table, replace the M5 row's cell with:

```
`isolation`, `release`, `stages/mutation.ts` + `stages/release-stage.ts`, `ledger/gates.ts` + `ledger/lifecycle.ts`, retirement, the mutating-stage gate, the TUI review pane
```

- [ ] **Step 9: Move the plan's index row to `In progress`**

`docs/specs/index.md` already carries the plan-m5 row, added when the plan landed. Change its status from `Not started` to `In progress`; Task 15 changes it to `Shipped`.

- [ ] **Step 10: Verify and commit**

Run: `pnpm lint && pnpm build && pnpm vitest run tests/core/preflight.test.ts tests/core/types.test.ts`
Expected: PASS. `types.test.ts` covers the metric-key union, not `ErrorKind`, so widening the union breaks nothing.

```bash
git add docs/specs src/core/types.ts src/core/isolation/preflight.ts tests/core/preflight.test.ts
git commit -m "feat: add the mutation-aborted error kind and the mutating preflight

R4.13 gains one row: an apply aborted after authorisation had no outcome to
report itself with, so R10.11's abort propagated out of the pipeline and the
run lost its partial evidence. Design §8.1 row 3b, §12.2, §13, §15, §16, §17
amended in the same commit as the type."
```

---

### Task 2: The sandbox interface, the one diff renderer, and the record written before anything moves

**Files:**
- Create: `src/core/isolation/types.ts`
- Create: `src/core/isolation/diff.ts`
- Create: `src/core/isolation/record.ts`
- Test: `tests/core/isolation-diff.test.ts`
- Test: `tests/core/sandbox-record.test.ts`

**Interfaces:**
- Consumes: `Exec` from `src/core/tools/exec.js`.
- Produces:
  - `MutationSandbox`, `ChangeSet`, `ChangeEntry`, `Preimage`, `SandboxRecord`, `SandboxStrategy`, `SandboxState`.
  - `unifiedDiffFor(a: string | null, b: string | null, label: string, exec?: Exec): Promise<string>`.
  - `sandboxRecordPath(dir)`, `writeSandboxRecord(dir, record)`, `readSandboxRecord(dir)`, `markSandboxRecord(dir, state)`, `scanSandboxRecords(workspacePath)`.

- [ ] **Step 1: Write the types**

```ts
// src/core/isolation/types.ts
export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'mode-changed'

export interface ChangeEntry {
  /** Repo-relative, POSIX separators. */
  path: string
  kind: ChangeKind
  /** The former path, renames only. */
  from?: string
  /** The resulting mode, when it is part of the change. */
  mode?: number
  binary: boolean
}

export interface Preimage {
  /** Repo-relative. */
  path: string
  /** sha256 of the live bytes, or null when the path did not exist. */
  sha256: string | null
  /** Live mode, or null when the path did not exist. */
  mode: number | null
}

export interface ChangeSet {
  entries: ChangeEntry[]
  /** Text entries only. Binary ones stay in `entries` — that is R10.8. */
  unifiedDiff: string
  /**
   * What each target looked like when this change set was built. R10.11's
   * recheck compares against these, so they travel with the change set rather
   * than being re-derived at apply — re-deriving would compare the tree against
   * itself and never detect drift.
   */
  preimages: Preimage[]
}

export type SandboxStrategy = 'git-worktree' | 'snapshot'

export type SandboxState = 'active' | 'applied' | 'discarded'

/**
 * R10.10's marker. Written before any mutating tool starts, because the apply
 * journal only exists from apply onward: a crash during tool execution, or
 * while a diff sat awaiting approval, otherwise left a partially modified tree
 * with nothing on disk saying so.
 */
export interface SandboxRecord {
  runId: string
  stage: string
  strategy: SandboxStrategy
  state: SandboxState
  /** Repo-relative paths this mutation may write. */
  scope: string[]
  repoPath: string
  skillId: string
  /** Absolute; empty for the git strategy, which restores by pruning. */
  snapshotDir: string
  /** Absolute path to the sandbox work root, so recovery can prune it. */
  workRoot: string
  preimages: Preimage[]
  openedAt: string
}

export interface MutationSandbox {
  readonly strategy: SandboxStrategy
  /** Repo root inside the sandbox. For the snapshot strategy, the real repo. */
  readonly workRoot: string
  /** Absolute path of a repo-relative path inside the sandbox. */
  resolve(repoRelPath: string): string
  changeSet(): Promise<ChangeSet>
  /** Rechecks preimages, writes the journal, then moves bytes into the live tree. */
  apply(changeSet: ChangeSet): Promise<void>
  discard(): Promise<void>
  dispose(): Promise<void>
}
```

- [ ] **Step 2: Write the failing diff test**

```ts
// tests/core/isolation-diff.test.ts
import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unifiedDiffFor } from '../../src/core/isolation/diff.js'

const scratch = (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-diff-'))

describe('unifiedDiffFor', () => {
  it('renders a modification as a unified diff labelled by repo path', async () => {
    const dir = await scratch()
    await writeFile(join(dir, 'a'), 'one\ntwo\nthree\n')
    await writeFile(join(dir, 'b'), 'one\nTWO\nthree\n')
    const diff = await unifiedDiffFor(join(dir, 'a'), join(dir, 'b'), 'sk/SKILL.md')
    expect(diff).toContain('-two')
    expect(diff).toContain('+TWO')
    expect(diff).toContain('sk/SKILL.md')
    // A reviewer reads repo-relative paths, never our temp directories.
    expect(diff).not.toContain(dir)
  })

  it('renders an addition when the old side is absent', async () => {
    const dir = await scratch()
    await writeFile(join(dir, 'b'), 'new\n')
    const diff = await unifiedDiffFor(null, join(dir, 'b'), 'sk/CHANGELOG.md')
    expect(diff).toContain('+new')
    expect(diff).toContain('sk/CHANGELOG.md')
  })

  it('renders a deletion when the new side is absent', async () => {
    const dir = await scratch()
    await writeFile(join(dir, 'a'), 'gone\n')
    expect(await unifiedDiffFor(join(dir, 'a'), null, 'sk/old.txt')).toContain('-gone')
  })

  it('returns an empty string for two identical files', async () => {
    const dir = await scratch()
    await writeFile(join(dir, 'a'), 'same\n')
    await writeFile(join(dir, 'b'), 'same\n')
    expect(await unifiedDiffFor(join(dir, 'a'), join(dir, 'b'), 'sk/same.txt')).toBe('')
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm vitest run tests/core/isolation-diff.test.ts`
Expected: FAIL — cannot resolve `../../src/core/isolation/diff.js`.

- [ ] **Step 4: Implement the diff renderer**

```ts
// src/core/isolation/diff.ts
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Exec, defaultExec } from '../tools/exec.js'

/** An absent side renders against /dev/null, which git accepts as a path. */
const NULL_PATH = '/dev/null'

/**
 * One renderer for both strategies, which is what makes R10.5's identical
 * review a property of the code rather than two implementations agreeing.
 * `--no-index` works outside a repository, so a non-git repo needs no repo to
 * produce the same text the worktree strategy does.
 *
 * `git diff` exits 1 when the files differ. That is the successful case, so the
 * rejection is inspected for output rather than rethrown.
 */
export async function unifiedDiffFor(
  a: string | null,
  b: string | null,
  label: string,
  exec: Exec = defaultExec,
): Promise<string> {
  const from = a ?? NULL_PATH
  const to = b ?? NULL_PATH
  let stdout: string
  try {
    stdout = (await exec('git', ['diff', '--no-index', '--binary', '--', from, to], {
      timeoutMs: 60_000,
    })).stdout
  } catch (err) {
    const partial = (err as { stdout?: string | Buffer }).stdout
    if (partial === undefined) throw err
    stdout = partial.toString()
  }
  // Substituted rather than passed as --src-prefix, because git rejects a
  // prefix containing a path separator on some versions and silently keeps the
  // temp path on others.
  return stdout.replaceAll(from, label).replaceAll(to, label)
}

/** A pair of temp files, for diffing bytes that are not both on disk. */
export async function diffBuffers(
  before: Buffer | null,
  after: Buffer | null,
  label: string,
  exec: Exec = defaultExec,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sg-diff-'))
  let a: string | null = null
  let b: string | null = null
  if (before) {
    a = join(dir, 'before')
    await writeFile(a, before)
  }
  if (after) {
    b = join(dir, 'after')
    await writeFile(b, after)
  }
  return unifiedDiffFor(a, b, label, exec)
}
```

- [ ] **Step 5: Run the diff test and confirm it passes**

Run: `pnpm vitest run tests/core/isolation-diff.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Write the failing record test**

```ts
// tests/core/sandbox-record.test.ts
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  markSandboxRecord,
  readSandboxRecord,
  scanSandboxRecords,
  writeSandboxRecord,
} from '../../src/core/isolation/record.js'
import type { SandboxRecord } from '../../src/core/isolation/types.js'

const record = (runId: string, state: SandboxRecord['state'] = 'active'): SandboxRecord => ({
  runId,
  stage: 'release',
  strategy: 'snapshot',
  state,
  scope: ['sk/SKILL.md'],
  repoPath: '/repo',
  skillId: 'repo/sk',
  snapshotDir: '/repo/sk-workspace/skillgantry/runs/x/snapshot-pre',
  workRoot: '/repo',
  preimages: [{ path: 'sk/SKILL.md', sha256: 'abc', mode: 33188 }],
  openedAt: '2026-08-03T00:00:00.000Z',
})

describe('sandbox record', () => {
  it('round-trips through disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sg-rec-'))
    await writeSandboxRecord(dir, record('r1'))
    expect(await readSandboxRecord(dir)).toEqual(record('r1'))
  })

  it('returns null for a directory holding no record', async () => {
    expect(await readSandboxRecord(await mkdtemp(join(tmpdir(), 'sg-rec-')))).toBeNull()
  })

  it('marks a state without losing the rest of the record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sg-rec-'))
    await writeSandboxRecord(dir, record('r1'))
    await markSandboxRecord(dir, 'applied')
    const read = await readSandboxRecord(dir)
    expect(read?.state).toBe('applied')
    expect(read?.preimages).toEqual(record('r1').preimages)
  })

  it('scans runs/ and retire/ and returns only active records', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'sg-ws-'))
    const runDir = join(ws, 'skillgantry', 'runs', 'run-a')
    const retireDir = join(ws, 'skillgantry', 'retire', 'ret-b')
    const settled = join(ws, 'skillgantry', 'runs', 'run-c')
    for (const dir of [runDir, retireDir, settled]) await mkdir(dir, { recursive: true })
    await writeSandboxRecord(runDir, record('run-a'))
    await writeSandboxRecord(retireDir, record('ret-b'))
    await writeSandboxRecord(settled, record('run-c', 'applied'))
    const found = await scanSandboxRecords(ws)
    expect(found.map((r) => r.runId).sort()).toEqual(['ret-b', 'run-a'])
  })

  it('ignores an unreadable record rather than failing the scan', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'sg-ws-'))
    const dir = join(ws, 'skillgantry', 'runs', 'broken')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'sandbox.json'), '{ not json')
    expect(await scanSandboxRecords(ws)).toEqual([])
  })

  it('returns nothing for a workspace with no skillgantry directory', async () => {
    expect(await scanSandboxRecords(await mkdtemp(join(tmpdir(), 'sg-ws-')))).toEqual([])
  })
})
```

- [ ] **Step 7: Run it and watch it fail**

Run: `pnpm vitest run tests/core/sandbox-record.test.ts`
Expected: FAIL — cannot resolve `isolation/record.js`.

- [ ] **Step 8: Implement the record**

```ts
// src/core/isolation/record.ts
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SandboxRecord, SandboxState } from './types.js'

const FILE = 'sandbox.json'

export const sandboxRecordPath = (dir: string): string => join(dir, FILE)

/**
 * Written whole and renamed into place, so a reader never sees half a record.
 * A truncated marker is worse than none: recovery would offer to restore from a
 * snapshot directory it could not name.
 */
export async function writeSandboxRecord(dir: string, record: SandboxRecord): Promise<void> {
  await mkdir(dir, { recursive: true })
  const target = sandboxRecordPath(dir)
  const temp = `${target}.tmp`
  await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`)
  await rename(temp, target)
}

export async function readSandboxRecord(dir: string): Promise<SandboxRecord | null> {
  try {
    return JSON.parse(await readFile(sandboxRecordPath(dir), 'utf8')) as SandboxRecord
  } catch {
    return null
  }
}

export async function markSandboxRecord(dir: string, state: SandboxState): Promise<void> {
  const record = await readSandboxRecord(dir)
  if (!record) return
  await writeSandboxRecord(dir, { ...record, state })
}

/**
 * Every place a sandbox can live under one skill's workspace. Retirement uses
 * `retire/<id>/` rather than a run directory precisely so this scan finds it
 * with no second code path.
 */
async function candidateDirs(workspacePath: string): Promise<string[]> {
  const root = join(workspacePath, 'skillgantry')
  const out: string[] = []
  for (const group of ['runs', 'retire']) {
    const base = join(root, group)
    let entries
    try {
      entries = await readdir(base, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) out.push(join(base, entry.name))
    }
  }
  return out
}

/** Only `active` records: applied or discarded is resolved history. */
export async function scanSandboxRecords(workspacePath: string): Promise<SandboxRecord[]> {
  const found: SandboxRecord[] = []
  for (const dir of await candidateDirs(workspacePath)) {
    const record = await readSandboxRecord(dir)
    if (record?.state === 'active') found.push(record)
  }
  return found
}
```

- [ ] **Step 9: Run both suites and confirm**

Run: `pnpm vitest run tests/core/sandbox-record.test.ts tests/core/isolation-diff.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 10: Commit**

```bash
git add src/core/isolation tests/core/isolation-diff.test.ts tests/core/sandbox-record.test.ts
git commit -m "feat: add the mutation sandbox contract, one diff renderer and the active-sandbox record

The record is written before any mutating tool starts (R10.10): the apply
journal exists only from apply onward, so a crash during the tool or while a
diff awaited approval had nothing on disk saying the tree was modified. One
diff renderer via git diff --no-index, so R10.5's identical review is a
property of the code rather than two implementations agreeing."
```

---

### Task 3: `GitWorktreeSandbox` — five change kinds, and a dirty override that seeds

**Files:**
- Create: `src/core/isolation/git-worktree.ts`
- Create: `src/core/isolation/journal.ts` (signature only; Task 5 implements the body)
- Modify: `tests/helpers/tmp-repo.ts`
- Test: `tests/core/isolation-git.test.ts`

**Interfaces:**
- Consumes: everything Task 2 produces; `SkillRef`; `Exec`.
- Produces:
  - `SandboxInput { skill: SkillRef; stage: string; runId: string; recordDir: string; scope: readonly string[]; allowDirty?: boolean; exec?: Exec }`
  - `openGitWorktreeSandbox(input: SandboxInput): Promise<MutationSandbox>`
  - `parseRawDiff(raw: string, binary: ReadonlySet<string>): ChangeEntry[]`
  - `ApplyInput { recordDir: string; liveRoot: string; sourceRoot: string; change: ChangeSet; exec: Exec }` and `applyJournalled(input: ApplyInput): Promise<void>`
  - `makeGitRepo(spec: RepoSpec): Promise<string>` and `SKILL_MD_FULL(name, version?, description?)` in the test helper.

- [ ] **Step 1: Add the git repo helper and a SKILL.md with a description**

```ts
// tests/helpers/tmp-repo.ts — append
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * A committed repo, because a worktree starts at HEAD: `git worktree add HEAD`
 * against a repo with no commit fails with an unhelpful invalid-reference error.
 */
export async function makeGitRepo(spec: RepoSpec): Promise<string> {
  const root = await makeRepo(spec)
  await run('git', ['init', '-q', '.'], { cwd: root })
  await run('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root })
  await run('git', ['config', 'user.name', 'test'], { cwd: root })
  await run('git', ['add', '-A'], { cwd: root })
  await run('git', ['commit', '-qm', 'fixture'], { cwd: root })
  return root
}

/**
 * `SKILL_MD` with a description, which vercel `skills` requires before it will
 * install a directory — so every release fixture needs one. `SKILL_MD` itself is
 * left alone: adding a line to it changes the bytes every existing digest and
 * fingerprint test is built on.
 */
export const SKILL_MD_FULL = (
  name: string,
  version = '1.0.0',
  description = `the ${name} skill`,
): string =>
  `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  version: ${version}\n---\n\n# ${name}\n`
```

- [ ] **Step 2: Write the failing change-set test**

```ts
// tests/core/isolation-git.test.ts
import { describe, expect, it } from 'vitest'
import { chmod, mkdtemp, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openGitWorktreeSandbox } from '../../src/core/isolation/git-worktree.js'
import { readSandboxRecord } from '../../src/core/isolation/record.js'
import { workspacePath } from '../../src/core/discovery/discover.js'
import type { SkillRef } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeGitRepo } from '../helpers/tmp-repo.js'

const SCOPE = [
  'sk/SKILL.md',
  'sk/CHANGELOG.md',
  'sk/old.txt',
  'sk/new.txt',
  'sk/run.sh',
  'sk/bin.dat',
  'versions.json',
]

async function fixture(): Promise<{ repo: string; skill: SkillRef; recordDir: string }> {
  const repo = await makeGitRepo({
    files: {
      'sk/SKILL.md': SKILL_MD_FULL('sk'),
      'sk/old.txt': 'old\n',
      'sk/run.sh': '#!/bin/sh\necho hi\n',
      'sk/bin.dat': 'plain text for now\n',
      'versions.json': '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n',
    },
  })
  await chmod(join(repo, 'sk/run.sh'), 0o755)
  const skill: SkillRef = {
    id: 'repo/sk',
    name: 'sk',
    version: '1.0.0',
    dir: join(repo, 'sk'),
    relPath: 'sk',
    repo: { id: 'repo', path: repo, name: 'repo', isGit: true },
    rootSkill: false,
    workspacePath: workspacePath(repo, 'sk', false),
  }
  return { repo, skill, recordDir: await mkdtemp(join(tmpdir(), 'sg-run-')) }
}

const open = async (over: Partial<Parameters<typeof openGitWorktreeSandbox>[0]> = {}) => {
  const { repo, skill, recordDir } = await fixture()
  const sandbox = await openGitWorktreeSandbox({
    skill,
    stage: 'release',
    runId: 'run-1',
    recordDir,
    scope: SCOPE,
    ...over,
  })
  return { repo, skill, recordDir, sandbox }
}

describe('GitWorktreeSandbox', () => {
  it('writes its record before anything else and names the strategy', async () => {
    const { recordDir, sandbox } = await open()
    const record = await readSandboxRecord(recordDir)
    expect(record?.state).toBe('active')
    expect(record?.strategy).toBe('git-worktree')
    expect(record?.workRoot).toBe(sandbox.workRoot)
    // The user's tree is never touched by opening, so restoring is a prune.
    expect(record?.snapshotDir).toBe('')
    await sandbox.dispose()
  })

  it('represents all five change kinds', async () => {
    const { sandbox } = await open()
    await writeFile(sandbox.resolve('sk/SKILL.md'), SKILL_MD_FULL('sk', '1.1.0'))
    await writeFile(sandbox.resolve('sk/CHANGELOG.md'), '# Changelog\n\n## 1.1.0\n')
    await rename(sandbox.resolve('sk/old.txt'), sandbox.resolve('sk/new.txt'))
    await writeFile(sandbox.resolve('sk/bin.dat'), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8]))
    await chmod(sandbox.resolve('sk/run.sh'), 0o644)

    const change = await sandbox.changeSet()
    const byPath = new Map(change.entries.map((e) => [e.path, e]))

    expect(byPath.get('sk/SKILL.md')?.kind).toBe('modified')
    expect(byPath.get('sk/CHANGELOG.md')?.kind).toBe('added')
    expect(byPath.get('sk/new.txt')).toMatchObject({ kind: 'renamed', from: 'sk/old.txt' })
    expect(byPath.get('sk/bin.dat')).toMatchObject({ kind: 'modified', binary: true })
    expect(byPath.get('sk/run.sh')?.kind).toBe('mode-changed')
    // A scoped text diff could express none of the last three, which is R10.8.
    expect(change.unifiedDiff).toContain('1.1.0')
    await sandbox.dispose()
  })

  it('captures a preimage per touched path, including the vanished side of a rename', async () => {
    const { sandbox } = await open()
    await rename(sandbox.resolve('sk/old.txt'), sandbox.resolve('sk/new.txt'))
    const change = await sandbox.changeSet()
    const byPath = new Map(change.preimages.map((p) => [p.path, p]))
    expect(byPath.get('sk/old.txt')?.sha256).toBeTruthy()
    expect(byPath.get('sk/new.txt')?.sha256).toBeNull()
    await sandbox.dispose()
  })

  it('excludes changes outside the declared scope', async () => {
    const { sandbox } = await open({ scope: ['sk/SKILL.md'] })
    await writeFile(sandbox.resolve('sk/SKILL.md'), SKILL_MD_FULL('sk', '1.1.0'))
    await writeFile(sandbox.resolve('versions.json'), '{"skills":{"sk":"9.9.9"}}\n')
    const change = await sandbox.changeSet()
    expect(change.entries.map((e) => e.path)).toEqual(['sk/SKILL.md'])
    await sandbox.dispose()
  })

  it('refuses a dirty scope path without an override', async () => {
    const { repo, skill, recordDir } = await fixture()
    await writeFile(join(repo, 'sk/SKILL.md'), SKILL_MD_FULL('sk', '1.0.0-wip'))
    await expect(
      openGitWorktreeSandbox({ skill, stage: 'release', runId: 'r', recordDir, scope: SCOPE }),
    ).rejects.toThrow(/uncommitted changes[\s\S]*sk\/SKILL\.md/)
  })

  it('seeds the override from the working tree and records its preimage', async () => {
    const { repo, skill, recordDir } = await fixture()
    const dirty = SKILL_MD_FULL('sk', '1.0.0-wip')
    await writeFile(join(repo, 'sk/SKILL.md'), dirty)

    const sandbox = await openGitWorktreeSandbox({
      skill,
      stage: 'release',
      runId: 'r',
      recordDir,
      scope: SCOPE,
      allowDirty: true,
    })
    // The tool must see the user's bytes, not HEAD's: a worktree starts at HEAD,
    // so without seeding an overriding user has the tool read stale bytes and
    // the later apply silently overwrite their uncommitted work.
    expect(await readFile(sandbox.resolve('sk/SKILL.md'), 'utf8')).toBe(dirty)
    expect((await readSandboxRecord(recordDir))?.preimages.find((p) => p.path === 'sk/SKILL.md')?.sha256).toBeTruthy()

    // And the change set is computed against those bytes, so the user's own
    // uncommitted edit does not appear in the diff they are asked to approve.
    expect((await sandbox.changeSet()).entries).toEqual([])
    await sandbox.dispose()
  })

  it('leaves the user tree untouched on discard and removes the worktree on dispose', async () => {
    const { repo, sandbox, recordDir } = await open()
    const before = await readFile(join(repo, 'sk/SKILL.md'), 'utf8')
    await writeFile(sandbox.resolve('sk/SKILL.md'), SKILL_MD_FULL('sk', '2.0.0'))
    await sandbox.discard()
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(before)
    expect((await readSandboxRecord(recordDir))?.state).toBe('discarded')
    await sandbox.dispose()
    await expect(stat(sandbox.workRoot)).rejects.toThrow()
  })

  it('refuses to resolve a path that escapes the sandbox root', async () => {
    const { sandbox } = await open({ scope: ['sk/SKILL.md'] })
    expect(sandbox.resolve('sk/SKILL.md').startsWith(sandbox.workRoot)).toBe(true)
    expect(() => sandbox.resolve('../outside')).toThrow('scope-escapes-root')
    await sandbox.dispose()
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm vitest run tests/core/isolation-git.test.ts`
Expected: FAIL — cannot resolve `isolation/git-worktree.js`.

- [ ] **Step 4: Add the journal signature Tasks 3 and 4 compile against**

Task 5 replaces the body and keeps the signature. It exists now so this task and Task 4 can be verified independently.

```ts
// src/core/isolation/journal.ts
import type { Exec } from '../tools/exec.js'
import type { ChangeSet } from './types.js'

export interface ApplyInput {
  /** Where journal.json lives: the run directory or a retire directory. */
  recordDir: string
  /** The user's repo root — what is being written. */
  liveRoot: string
  /** Where the approved bytes are. Equals liveRoot for the snapshot strategy. */
  sourceRoot: string
  change: ChangeSet
  exec: Exec
}

export async function applyJournalled(_input: ApplyInput): Promise<void> {
  throw new Error('not implemented: plan-m5 Task 5')
}
```

- [ ] **Step 5: Implement the structural change-set parser**

```ts
// src/core/isolation/git-worktree.ts
import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, normalize, sep } from 'node:path'
import type { SkillRef } from '../types.js'
import { type Exec, defaultExec } from '../tools/exec.js'
import { applyJournalled } from './journal.js'
import { markSandboxRecord, writeSandboxRecord } from './record.js'
import type { ChangeEntry, ChangeSet, MutationSandbox, Preimage } from './types.js'

export interface SandboxInput {
  skill: SkillRef
  stage: string
  runId: string
  recordDir: string
  scope: readonly string[]
  /** R10.3: proceed against a dirty scope path only when the user says so. */
  allowDirty?: boolean
  exec?: Exec
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

export async function preimageOf(root: string, relPath: string): Promise<Preimage> {
  try {
    const abs = join(root, relPath)
    const info = await lstat(abs)
    return { path: relPath, sha256: sha256(await readFile(abs)), mode: info.mode }
  } catch {
    return { path: relPath, sha256: null, mode: null }
  }
}

/** Splits a NUL-delimited git stream, dropping the trailing empty field. */
const nulFields = (raw: string): string[] => raw.split('\0').filter((f) => f.length > 0)

/**
 * `--numstat -z -M` marks a binary file with `-` in both count columns. It is
 * the only place git says "binary"; `--raw` does not carry it.
 */
export function binaryPaths(numstat: string): Set<string> {
  const out = new Set<string>()
  const fields = nulFields(numstat)
  for (let i = 0; i < fields.length; i += 1) {
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/.exec(fields[i] as string)
    if (!match) continue
    const added = match[1] as string
    const inline = match[3] as string
    // A rename carries its two paths as the following fields and leaves the
    // inline path empty. A renamed binary's bytes are unchanged, so it is
    // classified `renamed` and never needs the binary flag.
    if (inline.length === 0) {
      i += 2
      continue
    }
    if (added === '-') out.add(inline)
  }
  return out
}

/**
 * `:<srcMode> <dstMode> <srcSha> <dstSha> <status>` then the path, or two paths
 * for a rename — **old first**, which inverts the order
 * `git status --porcelain -z` uses for the same change.
 *
 * A mode change reports status `M`, so `srcMode !== dstMode` is the only signal.
 * Classifying by the status letter alone lost every mode change silently, and
 * R10.8 names it as one of the five kinds that must be represented.
 */
export function parseRawDiff(raw: string, binary: ReadonlySet<string>): ChangeEntry[] {
  const fields = nulFields(raw)
  const entries: ChangeEntry[] = []
  for (let i = 0; i < fields.length; i += 1) {
    const meta = fields[i] as string
    if (!meta.startsWith(':')) continue
    const [srcMode, dstMode, , , status = 'M'] = meta.slice(1).split(/\s+/)
    const letter = status.charAt(0)
    const renamed = letter === 'R' || letter === 'C'
    const first = fields[++i] as string
    const path = renamed ? (fields[++i] as string) : first
    const mode = Number.parseInt(dstMode ?? '0', 8)

    const kind: ChangeEntry['kind'] = renamed
      ? 'renamed'
      : letter === 'A'
        ? 'added'
        : letter === 'D'
          ? 'deleted'
          : srcMode !== dstMode
            ? 'mode-changed'
            : 'modified'

    entries.push({
      path,
      kind,
      ...(renamed ? { from: first } : {}),
      ...(Number.isNaN(mode) || mode === 0 ? {} : { mode }),
      binary: binary.has(path),
    })
  }
  return entries
}
```

- [ ] **Step 6: Implement the sandbox**

```ts
// src/core/isolation/git-worktree.ts — continued

/** The scope paths git reports as dirty in the user's working tree. */
async function dirtyScopePaths(
  repoPath: string,
  scope: readonly string[],
  exec: Exec,
): Promise<string[]> {
  const { stdout } = await exec('git', ['status', '--porcelain=v1', '-z', '--', ...scope], {
    cwd: repoPath,
    timeoutMs: 60_000,
  })
  const fields = nulFields(stdout)
  const paths: string[] = []
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i] as string
    // `status -z` puts the NEW path first for a rename and the old one after,
    // which is the opposite of `diff --raw -z`.
    paths.push(field.slice(3))
    if (field.startsWith('R') || field.startsWith('C')) i += 1
  }
  return paths
}

export async function openGitWorktreeSandbox(input: SandboxInput): Promise<MutationSandbox> {
  const exec = input.exec ?? defaultExec
  const repoPath = input.skill.repo.path
  const scope = [...input.scope]

  const dirty = await dirtyScopePaths(repoPath, scope, exec)
  if (dirty.length > 0 && input.allowDirty !== true) {
    throw new Error(
      `refusing to mutate a skill with uncommitted changes:\n  ${dirty.join('\n  ')}\n` +
        'commit them, or re-run with the dirty override',
    )
  }

  // mkdtemp then remove: `git worktree add` insists on creating the directory.
  const workRoot = await mkdtemp(join(tmpdir(), 'sg-worktree-'))
  await rm(workRoot, { recursive: true, force: true })
  await exec('git', ['worktree', 'add', '--detach', '-q', workRoot, 'HEAD'], {
    cwd: repoPath,
    timeoutMs: 120_000,
  })

  const preimages: Preimage[] = []
  for (const relPath of scope) {
    const preimage = await preimageOf(repoPath, relPath)
    preimages.push(preimage)
    if (!dirty.includes(relPath)) continue
    // R10.3's second half: seed the worktree with the user's actual bytes.
    const target = join(workRoot, relPath)
    if (preimage.sha256 === null) {
      await rm(target, { force: true })
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    await copyFile(join(repoPath, relPath), target)
  }

  await writeSandboxRecord(input.recordDir, {
    runId: input.runId,
    stage: input.stage,
    strategy: 'git-worktree',
    state: 'active',
    scope,
    repoPath,
    skillId: input.skill.id,
    snapshotDir: '',
    workRoot,
    preimages,
    openedAt: new Date().toISOString(),
  })

  const resolve = (repoRelPath: string): string => {
    const normalised = normalize(repoRelPath)
    if (isAbsolute(normalised) || normalised === '..' || normalised.startsWith(`..${sep}`)) {
      throw new Error(`scope-escapes-root: ${repoRelPath}`)
    }
    return join(workRoot, normalised)
  }

  const changeSet = async (): Promise<ChangeSet> => {
    // Staging inside a throwaway worktree costs nothing, and it is what makes
    // git report a rename as R rather than as an unrelated delete plus an
    // untracked add — the case R10.8 names.
    await exec('git', ['add', '-A', '--', ...scope], { cwd: workRoot, timeoutMs: 120_000 })
    const args = ['diff', '--cached']
    const [raw, numstat, diff] = await Promise.all([
      exec('git', [...args, '--raw', '-M', '-z', '--', ...scope], { cwd: workRoot }),
      exec('git', [...args, '--numstat', '-M', '-z', '--', ...scope], { cwd: workRoot }),
      exec('git', [...args, '--binary', '-M', '--', ...scope], { cwd: workRoot }),
    ])
    const entries = parseRawDiff(raw.stdout, binaryPaths(numstat.stdout))
    // Both sides of a rename: the apply deletes one and writes the other, so
    // both need a preimage for R10.11 to detect drift on either.
    const touched = new Set(entries.flatMap((e) => (e.from ? [e.path, e.from] : [e.path])))
    return {
      entries,
      unifiedDiff: diff.stdout,
      preimages: await Promise.all([...touched].map((relPath) => preimageOf(repoPath, relPath))),
    }
  }

  return {
    strategy: 'git-worktree',
    workRoot,
    resolve,
    changeSet,
    apply: async (change) => {
      await applyJournalled({ recordDir: input.recordDir, liveRoot: repoPath, sourceRoot: workRoot, change, exec })
      await markSandboxRecord(input.recordDir, 'applied')
    },
    // Nothing was written to the user's tree, so there is nothing to undo.
    discard: async () => markSandboxRecord(input.recordDir, 'discarded'),
    dispose: async () => {
      await exec('git', ['worktree', 'remove', '--force', workRoot], {
        cwd: repoPath,
        timeoutMs: 60_000,
      }).catch(async () => {
        await rm(workRoot, { recursive: true, force: true })
        await exec('git', ['worktree', 'prune'], { cwd: repoPath }).catch(() => undefined)
      })
    },
  }
}
```

- [ ] **Step 7: Run the test and confirm it passes**

Run: `pnpm vitest run tests/core/isolation-git.test.ts`
Expected: PASS, 8 tests. None calls `apply()`, so the Task 5 placeholder is never reached.

- [ ] **Step 8: Verify and commit**

Run: `pnpm lint && pnpm build && pnpm vitest run tests/core/isolation-git.test.ts`

```bash
git add src/core/isolation tests/core/isolation-git.test.ts tests/helpers/tmp-repo.ts
git commit -m "feat: add the git worktree mutation sandbox

Stages inside the throwaway worktree before diffing: without staging, a rename
reads as an unrelated delete plus an untracked add, and R10.8 requires renames
to be represented. A mode change reports status M, so it is classified from
srcMode != dstMode rather than the status letter. The dirty override seeds the
worktree from the user's working tree and records the preimage, which is what
stops the later apply from silently overwriting uncommitted work (R10.3)."
```

---

### Task 4: `SnapshotSandbox` — the same interface over a repo with no git

**Files:**
- Create: `src/core/isolation/snapshot.ts`
- Create: `src/core/isolation/open.ts`
- Test: `tests/core/isolation-snapshot.test.ts`

**Interfaces:**
- Consumes: Task 2's types, `unifiedDiffFor`, `preimageOf` and `SandboxInput` from `git-worktree.js`, `candidateManifest`, `requireCommands`.
- Produces:
  - `openSnapshotSandbox(input: SandboxInput & { snapshotDir: string }): Promise<MutationSandbox>`
  - `openSandbox(input: SandboxInput): Promise<MutationSandbox>` — dispatches on `skill.repo.isGit`, after `requireCommands(MUTATION_COMMANDS)`.

The two strategies differ in one way that matters: the worktree gives the tool a copy, so the live tree is untouched until apply. The snapshot gives the tool the **live tree** and keeps the copy, so `discard()` is a restore rather than a no-op. Everything above `MutationSandbox` is written once against the interface and never asks which one it has.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/isolation-snapshot.test.ts
import { describe, expect, it } from 'vitest'
import { chmod, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openSnapshotSandbox } from '../../src/core/isolation/snapshot.js'
import { readSandboxRecord } from '../../src/core/isolation/record.js'
import { workspacePath } from '../../src/core/discovery/discover.js'
import type { SkillRef } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeRepo } from '../helpers/tmp-repo.js'

const SCOPE = ['sk/SKILL.md', 'sk/CHANGELOG.md', 'sk/old.txt', 'sk/new.txt', 'sk/run.sh']

async function open(scope: readonly string[] = SCOPE) {
  const repo = await makeRepo({
    files: {
      'sk/SKILL.md': SKILL_MD_FULL('sk'),
      'sk/old.txt': 'old\n',
      'sk/run.sh': '#!/bin/sh\n',
    },
  })
  await chmod(join(repo, 'sk/run.sh'), 0o755)
  const skill: SkillRef = {
    id: 'repo/sk',
    name: 'sk',
    version: '1.0.0',
    dir: join(repo, 'sk'),
    relPath: 'sk',
    repo: { id: 'repo', path: repo, name: 'repo', isGit: false },
    rootSkill: false,
    workspacePath: workspacePath(repo, 'sk', false),
  }
  const recordDir = await mkdtemp(join(tmpdir(), 'sg-run-'))
  const sandbox = await openSnapshotSandbox({
    skill,
    stage: 'optimise',
    runId: 'run-1',
    recordDir,
    scope,
    snapshotDir: join(recordDir, 'snapshot-pre'),
  })
  return { repo, skill, recordDir, sandbox }
}

describe('SnapshotSandbox', () => {
  it('copies every existing scope path before anything runs, preserving modes', async () => {
    const { recordDir, sandbox } = await open()
    const snap = join(recordDir, 'snapshot-pre')
    expect(await readFile(join(snap, 'sk/SKILL.md'), 'utf8')).toBe(SKILL_MD_FULL('sk'))
    expect((await stat(join(snap, 'sk/run.sh'))).mode & 0o111).not.toBe(0)
    // A scope path that does not exist yet is not an error: release declares
    // CHANGELOG.md and the archive, neither of which need exist beforehand.
    await expect(stat(join(snap, 'sk/CHANGELOG.md'))).rejects.toThrow()
    expect((await readSandboxRecord(recordDir))?.snapshotDir).toBe(snap)
    await sandbox.dispose()
  })

  it('points the tool at the live tree', async () => {
    const { repo, sandbox } = await open()
    expect(sandbox.workRoot).toBe(repo)
    expect(sandbox.resolve('sk/SKILL.md')).toBe(join(repo, 'sk/SKILL.md'))
    await sandbox.dispose()
  })

  it('represents all five change kinds against the snapshot', async () => {
    const { sandbox } = await open()
    await writeFile(sandbox.resolve('sk/SKILL.md'), SKILL_MD_FULL('sk', '1.1.0'))
    await writeFile(sandbox.resolve('sk/CHANGELOG.md'), '# Changelog\n')
    await rename(sandbox.resolve('sk/old.txt'), sandbox.resolve('sk/new.txt'))
    await chmod(sandbox.resolve('sk/run.sh'), 0o644)

    const change = await sandbox.changeSet()
    const byPath = new Map(change.entries.map((e) => [e.path, e]))
    expect(byPath.get('sk/SKILL.md')?.kind).toBe('modified')
    expect(byPath.get('sk/CHANGELOG.md')?.kind).toBe('added')
    // Content-equal delete plus add is a rename, detected by hash, because
    // there is no index to ask.
    expect(byPath.get('sk/new.txt')).toMatchObject({ kind: 'renamed', from: 'sk/old.txt' })
    expect(byPath.get('sk/run.sh')?.kind).toBe('mode-changed')
    expect(change.unifiedDiff).toContain('1.1.0')
    await sandbox.dispose()
  })

  it('flags a binary change without trying to diff it', async () => {
    const { sandbox } = await open(['sk/bin.dat'])
    await writeFile(sandbox.resolve('sk/bin.dat'), Buffer.from([0, 1, 2, 0, 4]))
    const change = await sandbox.changeSet()
    expect(change.entries[0]).toMatchObject({ path: 'sk/bin.dat', kind: 'added', binary: true })
    await sandbox.dispose()
  })

  it('restores the live tree on discard, including a deletion and a mode', async () => {
    const { repo, recordDir, sandbox } = await open()
    const before = await readFile(join(repo, 'sk/SKILL.md'), 'utf8')
    await writeFile(sandbox.resolve('sk/SKILL.md'), 'clobbered\n')
    await rm(sandbox.resolve('sk/old.txt'))
    await writeFile(sandbox.resolve('sk/CHANGELOG.md'), 'new file\n')
    await chmod(sandbox.resolve('sk/run.sh'), 0o644)

    await sandbox.discard()

    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(before)
    expect(await readFile(join(repo, 'sk/old.txt'), 'utf8')).toBe('old\n')
    // A path the snapshot did not hold was created by the tool, so restoring
    // means removing it.
    await expect(stat(join(repo, 'sk/CHANGELOG.md'))).rejects.toThrow()
    expect((await stat(join(repo, 'sk/run.sh'))).mode & 0o111).not.toBe(0)
    expect((await readSandboxRecord(recordDir))?.state).toBe('discarded')
    await sandbox.dispose()
  })

  it('keeps the snapshot after dispose, because it is the run evidence', async () => {
    const { recordDir, sandbox } = await open()
    await sandbox.dispose()
    expect(await readdir(join(recordDir, 'snapshot-pre'))).toContain('sk')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/core/isolation-snapshot.test.ts`
Expected: FAIL — cannot resolve `isolation/snapshot.js`.

- [ ] **Step 3: Implement the snapshot copy and the structural change set**

```ts
// src/core/isolation/snapshot.ts
import { chmod, copyFile, cp, lstat, mkdir, readFile, readdir, rm, stat, symlink, readlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path'
import { type Exec, defaultExec } from '../tools/exec.js'
import { unifiedDiffFor } from './diff.js'
import { type SandboxInput, preimageOf } from './git-worktree.js'
import { applyJournalled } from './journal.js'
import { markSandboxRecord, writeSandboxRecord } from './record.js'
import type { ChangeEntry, ChangeSet, MutationSandbox, Preimage } from './types.js'

export interface SnapshotInput extends SandboxInput {
  /** `<run>/snapshot-pre` — inside the workspace, never inside the candidate. */
  snapshotDir: string
}

/** Bytes are binary if they hold a NUL in the first 8 KiB, which is git's rule. */
const looksBinary = (bytes: Buffer): boolean => bytes.subarray(0, 8192).includes(0)

async function copyInto(
  liveRoot: string,
  relPath: string,
  destRoot: string,
): Promise<void> {
  const source = join(liveRoot, relPath)
  let info
  try {
    info = await lstat(source)
  } catch {
    // A scope path need not exist: release declares CHANGELOG.md and the
    // archive, and neither exists before the first release.
    return
  }
  const dest = join(destRoot, relPath)
  await mkdir(dirname(dest), { recursive: true })
  if (info.isSymbolicLink()) {
    // R2.10 holds in every consumer of the manifest, snapshots included.
    await symlink(await readlink(source), dest)
    return
  }
  if (info.isDirectory()) {
    await cp(source, dest, { recursive: true, verbatimSymlinks: true })
    return
  }
  await copyFile(source, dest)
  await chmod(dest, info.mode & 0o7777)
}

/** Every file under a scope path, as repo-relative paths. */
async function expand(root: string, relPath: string): Promise<string[]> {
  let info
  try {
    info = await lstat(join(root, relPath))
  } catch {
    return []
  }
  if (!info.isDirectory()) return [relPath]
  const out: string[] = []
  for (const entry of await readdir(join(root, relPath), { withFileTypes: true, recursive: true })) {
    if (entry.isDirectory()) continue
    const abs = join(entry.parentPath, entry.name)
    out.push(relative(root, abs).split(sep).join('/'))
  }
  return out
}

export async function openSnapshotSandbox(input: SnapshotInput): Promise<MutationSandbox> {
  const exec = input.exec ?? defaultExec
  const liveRoot = input.skill.repo.path
  const scope = [...input.scope]

  for (const relPath of scope) await copyInto(liveRoot, relPath, input.snapshotDir)

  const preimages: Preimage[] = []
  for (const relPath of scope) preimages.push(await preimageOf(liveRoot, relPath))

  await writeSandboxRecord(input.recordDir, {
    runId: input.runId,
    stage: input.stage,
    strategy: 'snapshot',
    state: 'active',
    scope,
    repoPath: liveRoot,
    skillId: input.skill.id,
    snapshotDir: input.snapshotDir,
    workRoot: liveRoot,
    preimages,
    openedAt: new Date().toISOString(),
  })

  const resolve = (repoRelPath: string): string => {
    const normalised = normalize(repoRelPath)
    if (isAbsolute(normalised) || normalised === '..' || normalised.startsWith(`..${sep}`)) {
      throw new Error(`scope-escapes-root: ${repoRelPath}`)
    }
    return join(liveRoot, normalised)
  }

  const changeSet = async (): Promise<ChangeSet> => {
    const paths = new Set<string>()
    for (const relPath of scope) {
      for (const p of await expand(liveRoot, relPath)) paths.add(p)
      for (const p of await expand(input.snapshotDir, relPath)) paths.add(p)
    }

    const before = new Map<string, Preimage>()
    const after = new Map<string, Preimage>()
    for (const relPath of paths) {
      before.set(relPath, await preimageOf(input.snapshotDir, relPath))
      after.set(relPath, await preimageOf(liveRoot, relPath))
    }

    // A delete and an add with equal content is a rename. There is no index to
    // ask, so identity comes from the bytes — which is also what R10.8 needs, a
    // rename represented as one entry rather than as an unrelated pair.
    const deleted = [...paths].filter((p) => before.get(p)?.sha256 && !after.get(p)?.sha256)
    const added = [...paths].filter((p) => !before.get(p)?.sha256 && after.get(p)?.sha256)
    const renames = new Map<string, string>()
    for (const from of deleted) {
      const hash = before.get(from)?.sha256
      const to = added.find((p) => after.get(p)?.sha256 === hash && !renames.has(p))
      if (to) renames.set(to, from)
    }

    const entries: ChangeEntry[] = []
    for (const relPath of [...paths].sort()) {
      const was = before.get(relPath) as Preimage
      const now = after.get(relPath) as Preimage
      if (was.sha256 === null && now.sha256 === null) continue
      if (renames.has(relPath)) {
        entries.push({ path: relPath, kind: 'renamed', from: renames.get(relPath) as string, binary: false })
        continue
      }
      if ([...renames.values()].includes(relPath)) continue
      if (was.sha256 === now.sha256 && was.mode !== now.mode) {
        entries.push({ path: relPath, kind: 'mode-changed', mode: now.mode ?? 0, binary: false })
        continue
      }
      if (was.sha256 === now.sha256) continue

      const kind = was.sha256 === null ? 'added' : now.sha256 === null ? 'deleted' : 'modified'
      const sample = now.sha256 === null
        ? await readFile(join(input.snapshotDir, relPath)).catch(() => Buffer.alloc(0))
        : await readFile(join(liveRoot, relPath)).catch(() => Buffer.alloc(0))
      entries.push({
        path: relPath,
        kind,
        ...(now.mode === null ? {} : { mode: now.mode }),
        binary: looksBinary(sample),
      })
    }

    const diffs: string[] = []
    for (const entry of entries) {
      if (entry.binary || entry.kind === 'mode-changed' || entry.kind === 'renamed') continue
      diffs.push(
        await unifiedDiffFor(
          before.get(entry.path)?.sha256 === null ? null : join(input.snapshotDir, entry.path),
          after.get(entry.path)?.sha256 === null ? null : join(liveRoot, entry.path),
          entry.path,
          exec,
        ),
      )
    }

    return {
      entries,
      unifiedDiff: diffs.join(''),
      // Against the live tree, which is what the apply will write over.
      preimages: await Promise.all([...paths].map((relPath) => preimageOf(liveRoot, relPath))),
    }
  }

  return {
    strategy: 'snapshot',
    workRoot: liveRoot,
    resolve,
    changeSet,
    apply: async (change) => {
      // The tool already wrote the live tree, so there is nothing to move. The
      // journal is still written: R10.9 wants the prior bytes on record, and
      // R10.11's recheck is what catches a user edit made while the diff sat
      // awaiting approval.
      await applyJournalled({ recordDir: input.recordDir, liveRoot, sourceRoot: liveRoot, change, exec })
      await markSandboxRecord(input.recordDir, 'applied')
    },
    discard: async () => {
      await restoreSnapshot(input.snapshotDir, liveRoot, scope)
      await markSandboxRecord(input.recordDir, 'discarded')
    },
    // The snapshot is run evidence under the sidecar, so it outlives the
    // sandbox. Removing it would take the only copy of the pre-stage bytes.
    dispose: async () => undefined,
  }
}

/** Shared with startup recovery, which restores from the same directory. */
export async function restoreSnapshot(
  snapshotDir: string,
  liveRoot: string,
  scope: readonly string[],
): Promise<void> {
  for (const relPath of scope) {
    const live = [...new Set(await expand(liveRoot, relPath))]
    const saved = new Set(await expand(snapshotDir, relPath))
    // Anything the tool created that the snapshot never held.
    for (const p of live) {
      if (!saved.has(p)) await rm(join(liveRoot, p), { force: true })
    }
    for (const p of saved) {
      const source = join(snapshotDir, p)
      const dest = join(liveRoot, p)
      await mkdir(dirname(dest), { recursive: true })
      const info = await lstat(source)
      if (info.isSymbolicLink()) {
        await rm(dest, { force: true })
        await symlink(await readlink(source), dest)
        continue
      }
      await copyFile(source, dest)
      await chmod(dest, (await stat(source)).mode & 0o7777)
    }
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run tests/core/isolation-snapshot.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Implement the dispatch**

```ts
// src/core/isolation/open.ts
import { join } from 'node:path'
import type { SandboxInput } from './git-worktree.js'
import { openGitWorktreeSandbox } from './git-worktree.js'
import { MUTATION_COMMANDS, requireCommands } from './preflight.js'
import { openSnapshotSandbox } from './snapshot.js'
import type { MutationSandbox } from './types.js'

/**
 * R10.2 and R10.4 in one call, behind R10.5's single interface. The preflight
 * runs first, because discovering a missing `zip` after the tool has written the
 * live tree leaves a mutation that can be neither packaged nor reviewed, with
 * the marker already claiming it is active.
 */
export async function openSandbox(input: SandboxInput): Promise<MutationSandbox> {
  await requireCommands(MUTATION_COMMANDS, input.exec)
  if (input.skill.repo.isGit) return openGitWorktreeSandbox(input)
  return openSnapshotSandbox({ ...input, snapshotDir: join(input.recordDir, 'snapshot-pre') })
}
```

- [ ] **Step 6: Verify and commit**

Run: `pnpm lint && pnpm build && pnpm vitest run tests/core/isolation-snapshot.test.ts tests/core/isolation-git.test.ts`

```bash
git add src/core/isolation tests/core/isolation-snapshot.test.ts
git commit -m "feat: add the snapshot mutation sandbox and the strategy dispatch

The snapshot strategy hands the tool the live tree and keeps the copy, so
discard is a restore rather than a no-op — the one behavioural difference the
interface hides. Renames are detected by content hash, because there is no
index to ask, and R10.8 requires a rename to be one entry rather than an
unrelated delete and add. The snapshot survives dispose: it is the only copy of
the pre-stage bytes and it is run evidence."
```

---

### Task 5: Journalled apply, the preimage recheck, and recovery from an interrupted one

**Files:**
- Modify: `src/core/isolation/journal.ts` (replace the Task 3 placeholder)
- Test: `tests/core/isolation-journal.test.ts`

**Interfaces:**
- Consumes: `ApplyInput`, `ChangeSet`, `Preimage`, `preimageOf`.
- Produces:
  - `applyJournalled(input: ApplyInput): Promise<void>` — throws `Error('preimage-drift: <paths>')` before writing anything.
  - `Journal { runId: string; stage: string; liveRoot: string; complete: boolean; entries: JournalEntry[] }`, `JournalEntry { path: string; priorSha: string | null; priorMode: number | null; priorBytesRef: string | null }`
  - `journalPath(recordDir): string`, `readJournal(recordDir): Promise<Journal | null>`, `rollbackJournal(recordDir): Promise<string[]>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/isolation-journal.test.ts
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyJournalled, readJournal, rollbackJournal } from '../../src/core/isolation/journal.js'
import { preimageOf } from '../../src/core/isolation/git-worktree.js'
import { defaultExec } from '../../src/core/tools/exec.js'
import type { ChangeSet } from '../../src/core/isolation/types.js'

async function scene() {
  const live = await mkdtemp(join(tmpdir(), 'sg-live-'))
  const source = await mkdtemp(join(tmpdir(), 'sg-src-'))
  const recordDir = await mkdtemp(join(tmpdir(), 'sg-rec-'))
  await mkdir(join(live, 'sk'), { recursive: true })
  await mkdir(join(source, 'sk'), { recursive: true })
  await writeFile(join(live, 'sk/SKILL.md'), 'version: 1.0.0\n')
  await writeFile(join(source, 'sk/SKILL.md'), 'version: 1.1.0\n')
  await writeFile(join(source, 'sk/CHANGELOG.md'), '# Changelog\n')
  const change: ChangeSet = {
    entries: [
      { path: 'sk/SKILL.md', kind: 'modified', binary: false },
      { path: 'sk/CHANGELOG.md', kind: 'added', binary: false },
    ],
    unifiedDiff: '',
    preimages: [
      await preimageOf(live, 'sk/SKILL.md'),
      await preimageOf(live, 'sk/CHANGELOG.md'),
    ],
  }
  return { live, source, recordDir, change }
}

const apply = (s: Awaited<ReturnType<typeof scene>>) =>
  applyJournalled({
    recordDir: s.recordDir,
    liveRoot: s.live,
    sourceRoot: s.source,
    change: s.change,
    exec: defaultExec,
  })

describe('applyJournalled', () => {
  it('writes the prior bytes before touching a target', async () => {
    const s = await scene()
    await apply(s)
    const journal = await readJournal(s.recordDir)
    expect(journal?.complete).toBe(true)
    const skillEntry = journal?.entries.find((e) => e.path === 'sk/SKILL.md')
    expect(skillEntry?.priorSha).toBeTruthy()
    expect(
      await readFile(join(s.recordDir, 'journal-bytes', skillEntry?.priorBytesRef as string), 'utf8'),
    ).toBe('version: 1.0.0\n')
    // An added path has no prior bytes, and the journal says so rather than
    // recording an empty file that a rollback would then restore.
    expect(journal?.entries.find((e) => e.path === 'sk/CHANGELOG.md')?.priorSha).toBeNull()
  })

  it('writes every target', async () => {
    const s = await scene()
    await apply(s)
    expect(await readFile(join(s.live, 'sk/SKILL.md'), 'utf8')).toBe('version: 1.1.0\n')
    expect(await readFile(join(s.live, 'sk/CHANGELOG.md'), 'utf8')).toBe('# Changelog\n')
  })

  it('aborts naming the drifted paths and writes nothing', async () => {
    const s = await scene()
    // The user edits while the diff sits awaiting approval — R10.11's window,
    // which widens with the mutation timeout.
    await writeFile(join(s.live, 'sk/SKILL.md'), 'version: 1.0.0-hand-edited\n')
    await expect(apply(s)).rejects.toThrow('preimage-drift: sk/SKILL.md')
    expect(await readFile(join(s.live, 'sk/SKILL.md'), 'utf8')).toBe('version: 1.0.0-hand-edited\n')
    await expect(stat(join(s.live, 'sk/CHANGELOG.md'))).rejects.toThrow()
    // Nothing was applied, so no journal claims otherwise.
    expect(await readJournal(s.recordDir)).toBeNull()
  })

  it('applies a deletion and a rename', async () => {
    const s = await scene()
    await writeFile(join(s.live, 'sk/old.txt'), 'old\n')
    await writeFile(join(s.source, 'sk/new.txt'), 'old\n')
    s.change.entries.push(
      { path: 'sk/new.txt', kind: 'renamed', from: 'sk/old.txt', binary: false },
    )
    s.change.preimages.push(
      await preimageOf(s.live, 'sk/old.txt'),
      await preimageOf(s.live, 'sk/new.txt'),
    )
    await apply(s)
    expect(await readFile(join(s.live, 'sk/new.txt'), 'utf8')).toBe('old\n')
    await expect(stat(join(s.live, 'sk/old.txt'))).rejects.toThrow()
  })

  it('rolls back an incomplete journal from the recorded prior bytes', async () => {
    const s = await scene()
    await apply(s)
    // Simulate a crash between the journal write and the final mark.
    const journal = await readJournal(s.recordDir)
    await writeFile(
      join(s.recordDir, 'journal.json'),
      JSON.stringify({ ...journal, complete: false }),
    )
    const restored = await rollbackJournal(s.recordDir)
    expect(restored.sort()).toEqual(['sk/CHANGELOG.md', 'sk/SKILL.md'])
    expect(await readFile(join(s.live, 'sk/SKILL.md'), 'utf8')).toBe('version: 1.0.0\n')
    // A path with no prior bytes did not exist before, so rollback removes it.
    await expect(stat(join(s.live, 'sk/CHANGELOG.md'))).rejects.toThrow()
  })

  it('leaves a complete journal alone', async () => {
    const s = await scene()
    await apply(s)
    expect(await rollbackJournal(s.recordDir)).toEqual([])
    expect(await readFile(join(s.live, 'sk/SKILL.md'), 'utf8')).toBe('version: 1.1.0\n')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/core/isolation-journal.test.ts`
Expected: FAIL — `not implemented: plan-m5 Task 5`, plus missing exports.

- [ ] **Step 3: Implement the journal**

```ts
// src/core/isolation/journal.ts
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Exec } from '../tools/exec.js'
import { preimageOf } from './git-worktree.js'
import type { ChangeSet } from './types.js'

export interface JournalEntry {
  path: string
  /** null when the path did not exist, which is how rollback knows to remove it. */
  priorSha: string | null
  priorMode: number | null
  /** Filename under `journal-bytes/`, or null for a path that did not exist. */
  priorBytesRef: string | null
}

export interface Journal {
  runId: string
  stage: string
  liveRoot: string
  /** False until every target has been written. A crash leaves it false. */
  complete: boolean
  entries: JournalEntry[]
}

export interface ApplyInput {
  /** Where journal.json lives: the run directory or a retire directory. */
  recordDir: string
  /** The user's repo root — what is being written. */
  liveRoot: string
  /** Where the approved bytes are. Equals liveRoot for the snapshot strategy. */
  sourceRoot: string
  change: ChangeSet
  exec: Exec
}

const BYTES_DIR = 'journal-bytes'

export const journalPath = (recordDir: string): string => join(recordDir, 'journal.json')

export async function readJournal(recordDir: string): Promise<Journal | null> {
  try {
    return JSON.parse(await readFile(journalPath(recordDir), 'utf8')) as Journal
  } catch {
    return null
  }
}

/**
 * R10.11. Every target's current bytes are compared against the preimage taken
 * when the change set was built, and any mismatch aborts before the first write.
 * Without this, an edit made while the diff sat awaiting approval was silently
 * overwritten, and the mutation timeout is how wide that window gets.
 */
export async function recheckPreimages(
  liveRoot: string,
  change: ChangeSet,
): Promise<string[]> {
  const drifted: string[] = []
  for (const expected of change.preimages) {
    const actual = await preimageOf(liveRoot, expected.path)
    if (actual.sha256 !== expected.sha256 || actual.mode !== expected.mode) {
      drifted.push(expected.path)
    }
  }
  return drifted
}

/** Temp file in the target's own directory, fsynced, then renamed over it. */
async function writeAtomic(dest: string, bytes: Buffer, mode: number | undefined): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  const temp = `${dest}.sg-tmp`
  const handle = await open(temp, 'w')
  try {
    await handle.write(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  if (mode !== undefined) await chmod(temp, mode & 0o7777)
  await rename(temp, dest)
}

/**
 * POSIX offers no multi-file atomic write, so this does not claim atomicity —
 * it is a compensating-transaction record. Prior bytes first, then one atomic
 * write per target, then the completion mark. A crash leaves the journal
 * incomplete and `rollbackJournal` puts every recorded path back.
 */
export async function applyJournalled(input: ApplyInput): Promise<void> {
  const { change, liveRoot, sourceRoot, recordDir } = input

  const drifted = await recheckPreimages(liveRoot, change)
  if (drifted.length > 0) {
    throw new Error(`preimage-drift: ${drifted.join(', ')}`)
  }

  // Both sides of a rename are targets: one is written, the other removed.
  const targets = [...new Set(change.entries.flatMap((e) => (e.from ? [e.path, e.from] : [e.path])))]

  const bytesDir = join(recordDir, BYTES_DIR)
  await mkdir(bytesDir, { recursive: true })

  const entries: JournalEntry[] = []
  for (const path of targets) {
    const prior = await preimageOf(liveRoot, path)
    let ref: string | null = null
    if (prior.sha256 !== null) {
      ref = createHash('sha256').update(path).digest('hex').slice(0, 16)
      await copyFile(join(liveRoot, path), join(bytesDir, ref))
    }
    entries.push({ path, priorSha: prior.sha256, priorMode: prior.mode, priorBytesRef: ref })
  }

  const journal: Journal = {
    runId: '',
    stage: '',
    liveRoot,
    complete: false,
    entries,
  }
  await writeFile(journalPath(recordDir), `${JSON.stringify(journal, null, 2)}\n`)

  const removed = new Set(change.entries.flatMap((e) => (e.from ? [e.from] : [])))
  for (const entry of change.entries) {
    if (entry.kind === 'deleted') {
      await rm(join(liveRoot, entry.path), { force: true })
      continue
    }
    if (entry.kind === 'mode-changed') {
      if (entry.mode !== undefined) await chmod(join(liveRoot, entry.path), entry.mode & 0o7777)
      continue
    }
    // Snapshot strategy: source and live are the same tree, so the bytes are
    // already in place and only the removals and modes remain.
    if (sourceRoot !== liveRoot) {
      await writeAtomic(
        join(liveRoot, entry.path),
        await readFile(join(sourceRoot, entry.path)),
        entry.mode,
      )
    }
  }
  for (const path of removed) await rm(join(liveRoot, path), { force: true })

  await writeFile(journalPath(recordDir), `${JSON.stringify({ ...journal, complete: true }, null, 2)}\n`)
}

/**
 * Compensating rollback (R10.9). Returns the paths it restored, so a caller can
 * report them; an empty array means the journal was complete and nothing needed
 * compensating.
 */
export async function rollbackJournal(recordDir: string): Promise<string[]> {
  const journal = await readJournal(recordDir)
  if (!journal || journal.complete) return []
  const restored: string[] = []
  for (const entry of journal.entries) {
    const dest = join(journal.liveRoot, entry.path)
    if (entry.priorBytesRef === null) {
      await rm(dest, { force: true })
    } else {
      await writeAtomic(
        dest,
        await readFile(join(recordDir, BYTES_DIR, entry.priorBytesRef)),
        entry.priorMode ?? undefined,
      )
    }
    restored.push(entry.path)
  }
  await writeFile(journalPath(recordDir), `${JSON.stringify({ ...journal, complete: true }, null, 2)}\n`)
  return restored
}
```

`runId` and `stage` are empty strings here because `ApplyInput` does not carry them; add them to `ApplyInput` and thread them from both sandboxes if the acceptance suite wants them in the journal. They are diagnostic, not load-bearing — the `liveRoot` and the entries are what a rollback needs.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run tests/core/isolation-journal.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the apply cases to both sandbox suites**

```ts
// tests/core/isolation-git.test.ts — append inside the describe
  it('applies the sandbox bytes into the live tree', async () => {
    const { repo, sandbox } = await open()
    await writeFile(sandbox.resolve('sk/SKILL.md'), SKILL_MD_FULL('sk', '1.1.0'))
    await writeFile(sandbox.resolve('sk/CHANGELOG.md'), '# Changelog\n')
    const change = await sandbox.changeSet()
    await sandbox.apply(change)
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('1.1.0')
    expect(await readFile(join(repo, 'sk/CHANGELOG.md'), 'utf8')).toBe('# Changelog\n')
    await sandbox.dispose()
  })

  it('aborts the apply when a target drifted between preview and approval', async () => {
    const { repo, sandbox } = await open()
    await writeFile(sandbox.resolve('sk/SKILL.md'), SKILL_MD_FULL('sk', '1.1.0'))
    const change = await sandbox.changeSet()
    await writeFile(join(repo, 'sk/SKILL.md'), SKILL_MD_FULL('sk', '1.0.0-hand-edited'))
    await expect(sandbox.apply(change)).rejects.toThrow('preimage-drift: sk/SKILL.md')
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('1.0.0-hand-edited')
    await sandbox.dispose()
  })
```

```ts
// tests/core/isolation-snapshot.test.ts — append inside the describe
  it('accepts the live bytes on apply and records the prior ones', async () => {
    const { repo, recordDir, sandbox } = await open()
    await writeFile(sandbox.resolve('sk/SKILL.md'), SKILL_MD_FULL('sk', '1.1.0'))
    const change = await sandbox.changeSet()
    await sandbox.apply(change)
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('1.1.0')
    const journal = JSON.parse(await readFile(join(recordDir, 'journal.json'), 'utf8')) as {
      complete: boolean
    }
    expect(journal.complete).toBe(true)
    await sandbox.dispose()
  })
```

- [ ] **Step 6: Run everything and commit**

Run: `pnpm lint && pnpm build && pnpm vitest run tests/core/isolation-journal.test.ts tests/core/isolation-git.test.ts tests/core/isolation-snapshot.test.ts`
Expected: PASS, 17 tests.

```bash
git add src/core/isolation tests/core/isolation-journal.test.ts tests/core/isolation-git.test.ts tests/core/isolation-snapshot.test.ts
git commit -m "feat: add the journalled apply and the preimage recheck

The journal records prior bytes before any target is modified and marks itself
complete only after the last write, so a crash leaves an incomplete journal that
rollbackJournal can compensate from (R10.9). This claims no atomicity across
files, because POSIX offers none. The recheck runs before the first write and
aborts naming the drifted paths (R10.11): an edit made while the diff sat
awaiting approval was otherwise silently overwritten."
```

---

### Task 6: Startup recovery and `skillgantry recover`

**Files:**
- Create: `src/core/isolation/recover.ts`
- Create: `src/cli/recover-command.ts`
- Modify: `src/cli/run-command.ts`
- Modify: `src/core/index.ts`
- Test: `tests/core/isolation-recover.test.ts`
- Test: `tests/cli/recover-command.test.ts`

**Interfaces:**
- Produces:
  - `InterruptedMutation { record: SandboxRecord; recordDir: string; skillId: string; journalIncomplete: boolean }`
  - `scanInterrupted(skills: readonly SkillRef[]): Promise<InterruptedMutation[]>`
  - `restoreInterrupted(found: InterruptedMutation, exec?: Exec): Promise<string[]>` — returns the restored repo-relative paths.
  - `forgetInterrupted(found: InterruptedMutation): Promise<void>` — marks the record `discarded` without restoring.
  - `runRecover(deps: CliDeps, opts: { restore?: string; forget?: string; json?: boolean }): Promise<InterruptedMutation[]>`

- [ ] **Step 1: Write the failing core test**

```ts
// tests/core/isolation-recover.test.ts
import { describe, expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { restoreSnapshot } from '../../src/core/isolation/snapshot.js'
import { forgetInterrupted, restoreInterrupted, scanInterrupted } from '../../src/core/isolation/recover.js'
import { readSandboxRecord, writeSandboxRecord } from '../../src/core/isolation/record.js'
import { workspacePath } from '../../src/core/discovery/discover.js'
import { preimageOf } from '../../src/core/isolation/git-worktree.js'
import type { SkillRef } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeRepo } from '../helpers/tmp-repo.js'

async function interrupted() {
  const repo = await makeRepo({ files: { 'sk/SKILL.md': SKILL_MD_FULL('sk') } })
  const skill: SkillRef = {
    id: 'repo/sk',
    name: 'sk',
    version: '1.0.0',
    dir: join(repo, 'sk'),
    relPath: 'sk',
    repo: { id: 'repo', path: repo, name: 'repo', isGit: false },
    rootSkill: false,
    workspacePath: workspacePath(repo, 'sk', false),
  }
  const recordDir = join(skill.workspacePath, 'skillgantry', 'runs', 'run-a')
  const snapshotDir = join(recordDir, 'snapshot-pre')
  await mkdir(join(snapshotDir, 'sk'), { recursive: true })
  await writeFile(join(snapshotDir, 'sk/SKILL.md'), SKILL_MD_FULL('sk'))
  await writeSandboxRecord(recordDir, {
    runId: 'run-a',
    stage: 'optimise',
    strategy: 'snapshot',
    state: 'active',
    scope: ['sk/SKILL.md'],
    repoPath: repo,
    skillId: skill.id,
    snapshotDir,
    workRoot: repo,
    preimages: [await preimageOf(repo, 'sk/SKILL.md')],
    openedAt: '2026-08-03T00:00:00.000Z',
  })
  // The crash: the tool had already rewritten the live file.
  await writeFile(join(repo, 'sk/SKILL.md'), 'half-written by an optimiser\n')
  return { repo, skill, recordDir }
}

describe('startup recovery', () => {
  it('finds an active record and names its skill', async () => {
    const { skill } = await interrupted()
    const found = await scanInterrupted([skill])
    expect(found).toHaveLength(1)
    expect(found[0]?.skillId).toBe('repo/sk')
    expect(found[0]?.record.stage).toBe('optimise')
    expect(found[0]?.journalIncomplete).toBe(false)
  })

  it('restores the live tree from the snapshot and settles the record', async () => {
    const { repo, skill, recordDir } = await interrupted()
    const found = await scanInterrupted([skill])
    const restored = await restoreInterrupted(found[0]!)
    expect(restored).toEqual(['sk/SKILL.md'])
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(SKILL_MD_FULL('sk'))
    expect((await readSandboxRecord(recordDir))?.state).toBe('discarded')
    expect(await scanInterrupted([skill])).toEqual([])
  })

  it('forgets a record without touching the tree', async () => {
    const { repo, skill } = await interrupted()
    const found = await scanInterrupted([skill])
    await forgetInterrupted(found[0]!)
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe('half-written by an optimiser\n')
    expect(await scanInterrupted([skill])).toEqual([])
  })

  it('restores from an incomplete journal when one exists', async () => {
    const { repo, skill, recordDir } = await interrupted()
    await writeFile(
      join(recordDir, 'journal.json'),
      JSON.stringify({
        runId: 'run-a',
        stage: 'optimise',
        liveRoot: repo,
        complete: false,
        entries: [{ path: 'sk/SKILL.md', priorSha: 'x', priorMode: 33188, priorBytesRef: 'aa' }],
      }),
    )
    await mkdir(join(recordDir, 'journal-bytes'), { recursive: true })
    await writeFile(join(recordDir, 'journal-bytes', 'aa'), 'from the journal\n')
    const found = await scanInterrupted([skill])
    expect(found[0]?.journalIncomplete).toBe(true)
    await restoreInterrupted(found[0]!)
    // The journal is the later evidence: it holds the bytes as they were
    // immediately before the apply, which is closer than the snapshot.
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe('from the journal\n')
  })

  it('restores a git-strategy record by pruning, leaving the tree alone', async () => {
    const { repo, skill, recordDir } = await interrupted()
    const record = await readSandboxRecord(recordDir)
    await writeSandboxRecord(recordDir, { ...record!, strategy: 'git-worktree', snapshotDir: '' })
    const found = await scanInterrupted([skill])
    // The worktree strategy never wrote the live tree, so there is nothing to
    // restore and the half-written file is not ours.
    expect(await restoreInterrupted(found[0]!)).toEqual([])
    expect((await readSandboxRecord(recordDir))?.state).toBe('discarded')
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe('half-written by an optimiser\n')
  })

  it('ignores restoreSnapshot for a scope path the snapshot never held', async () => {
    const { repo } = await interrupted()
    await expect(restoreSnapshot('/nonexistent', repo, ['sk/SKILL.md'])).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/core/isolation-recover.test.ts`
Expected: FAIL — cannot resolve `isolation/recover.js`.

- [ ] **Step 3: Implement recovery**

```ts
// src/core/isolation/recover.ts
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { SkillRef } from '../types.js'
import { type Exec, defaultExec } from '../tools/exec.js'
import { readJournal, rollbackJournal } from './journal.js'
import { markSandboxRecord, scanSandboxRecords } from './record.js'
import { restoreSnapshot } from './snapshot.js'
import type { SandboxRecord } from './types.js'

export interface InterruptedMutation {
  record: SandboxRecord
  /** Absolute path to the run or retire directory holding the record. */
  recordDir: string
  skillId: string
  journalIncomplete: boolean
}

const recordDirFor = (record: SandboxRecord, workspacePath: string): string => {
  const group = record.stage === 'retire' ? 'retire' : 'runs'
  return join(workspacePath, 'skillgantry', group, record.runId)
}

/**
 * R10.10. A `SnapshotSandbox` lets the tool write the real tree, so a crash
 * during the mutating tool or while a diff awaited approval leaves the skill
 * partially modified with no journal — the journal only exists from apply
 * onward, which is exactly why the record is written before the tool starts.
 */
export async function scanInterrupted(
  skills: readonly SkillRef[],
): Promise<InterruptedMutation[]> {
  const found: InterruptedMutation[] = []
  for (const skill of skills) {
    for (const record of await scanSandboxRecords(skill.workspacePath)) {
      const recordDir = recordDirFor(record, skill.workspacePath)
      const journal = await readJournal(recordDir)
      found.push({
        record,
        recordDir,
        skillId: skill.id,
        journalIncomplete: journal !== null && !journal.complete,
      })
    }
  }
  return found
}

/**
 * Journal first, snapshot second. An incomplete journal holds the bytes as they
 * were immediately before the apply, which is later evidence than the snapshot
 * taken before the tool ran, and restoring the older copy would discard changes
 * the user had already approved.
 */
export async function restoreInterrupted(
  found: InterruptedMutation,
  exec: Exec = defaultExec,
): Promise<string[]> {
  const restored = await rollbackJournal(found.recordDir)
  if (restored.length > 0) {
    await markSandboxRecord(found.recordDir, 'discarded')
    return restored
  }

  if (found.record.strategy === 'git-worktree') {
    // The user's tree was never touched, so recovery is a prune. Anything odd
    // in the tree predates us and is not ours to revert.
    await rm(found.record.workRoot, { recursive: true, force: true })
    await exec('git', ['worktree', 'prune'], { cwd: found.record.repoPath }).catch(() => undefined)
    await markSandboxRecord(found.recordDir, 'discarded')
    return []
  }

  await restoreSnapshot(found.record.snapshotDir, found.record.repoPath, found.record.scope)
  await markSandboxRecord(found.recordDir, 'discarded')
  return [...found.record.scope]
}

/** Keeps the tree as it stands and stops the record being reported again. */
export async function forgetInterrupted(found: InterruptedMutation): Promise<void> {
  await markSandboxRecord(found.recordDir, 'discarded')
}
```

- [ ] **Step 4: Run the core test and confirm it passes**

Run: `pnpm vitest run tests/core/isolation-recover.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Export the isolation surface from core's public index**

```ts
// src/core/index.ts — append
export {
  forgetInterrupted,
  restoreInterrupted,
  scanInterrupted,
  type InterruptedMutation,
} from './isolation/recover.js'
export type {
  ChangeEntry,
  ChangeKind,
  ChangeSet,
  MutationSandbox,
  Preimage,
  SandboxRecord,
  SandboxStrategy,
} from './isolation/types.js'
```

- [ ] **Step 6: Write the failing CLI test**

```ts
// tests/cli/recover-command.test.ts
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram } from '../../src/cli/run-command.js'
import { DEFAULT_CONFIG, registerRepo, saveConfig } from '../../src/core/config/config.js'
import { writeSandboxRecord } from '../../src/core/isolation/record.js'
import { workspacePath } from '../../src/core/discovery/discover.js'
import { SKILL_MD_FULL, makeRepo } from '../helpers/tmp-repo.js'

async function harness() {
  const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
  const repo = await makeRepo({ files: { 'sk/SKILL.md': SKILL_MD_FULL('sk') } })
  await saveConfig(home, DEFAULT_CONFIG)
  await registerRepo(home, repo)

  const ws = workspacePath(repo, 'sk', false)
  const recordDir = join(ws, 'skillgantry', 'runs', 'run-a')
  const snapshotDir = join(recordDir, 'snapshot-pre')
  await mkdir(join(snapshotDir, 'sk'), { recursive: true })
  await writeFile(join(snapshotDir, 'sk/SKILL.md'), SKILL_MD_FULL('sk'))
  await writeSandboxRecord(recordDir, {
    runId: 'run-a',
    stage: 'optimise',
    strategy: 'snapshot',
    state: 'active',
    scope: ['sk/SKILL.md'],
    repoPath: repo,
    skillId: `${join(repo).split('/').pop()}/sk`,
    snapshotDir,
    workRoot: repo,
    preimages: [{ path: 'sk/SKILL.md', sha256: 'stale', mode: 33188 }],
    openedAt: '2026-08-03T00:00:00.000Z',
  })
  await writeFile(join(repo, 'sk/SKILL.md'), 'half-written\n')

  const out: string[] = []
  const program = buildProgram({
    home,
    dbPath: join(home, 'gantry.db'),
    write: (line) => out.push(line),
  })
  return { home, repo, out, program }
}

describe('skillgantry recover', () => {
  it('lists an unresolved mutation and names the resolving flags', async () => {
    const { out, program } = await harness()
    await program.parseAsync(['node', 'skillgantry', 'recover'])
    expect(out.join('\n')).toContain('run-a')
    expect(out.join('\n')).toContain('--restore run-a')
  })

  it('restores on --restore and reports the paths', async () => {
    const { repo, out, program } = await harness()
    await program.parseAsync(['node', 'skillgantry', 'recover', '--restore', 'run-a'])
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(SKILL_MD_FULL('sk'))
    expect(out.join('\n')).toContain('sk/SKILL.md')
  })

  it('leaves the tree alone on --forget', async () => {
    const { repo, program } = await harness()
    await program.parseAsync(['node', 'skillgantry', 'recover', '--forget', 'run-a'])
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe('half-written\n')
  })

  it('says so when nothing is unresolved', async () => {
    const { out, program } = await harness()
    await program.parseAsync(['node', 'skillgantry', 'recover', '--forget', 'run-a'])
    out.length = 0
    await program.parseAsync(['node', 'skillgantry', 'recover'])
    expect(out.join('\n')).toContain('no interrupted mutation')
  })

  it('emits one JSON document under --json', async () => {
    const { out, program } = await harness()
    await program.parseAsync(['node', 'skillgantry', 'recover', '--json'])
    expect(JSON.parse(out[0] as string)).toMatchObject([{ record: { runId: 'run-a' } }])
  })
})
```

- [ ] **Step 7: Implement the command**

```ts
// src/cli/recover-command.ts
import {
  discoverSkills,
  forgetInterrupted,
  loadConfig,
  restoreInterrupted,
  scanInterrupted,
  type InterruptedMutation,
  type SkillRef,
} from '../core/index.js'
import type { CliDeps } from './run-command.js'

export async function detectInterrupted(home: string): Promise<InterruptedMutation[]> {
  const config = await loadConfig(home)
  const skills: SkillRef[] = []
  for (const repo of config.repos) skills.push(...(await discoverSkills(repo)))
  return scanInterrupted(skills)
}

/**
 * R10.10's offer. Printed on every launch and never blocking one: an old marker
 * the user has decided to leave alone must not make the tool unusable. What
 * does block is a new mutating run against the same skill, which the release
 * stage refuses.
 */
export function formatInterrupted(found: readonly InterruptedMutation[]): string[] {
  return found.map(
    (item) =>
      `interrupted ${item.record.stage} on ${item.skillId} (${item.record.runId}, ` +
      `${item.record.strategy}${item.journalIncomplete ? ', apply incomplete' : ''}) — ` +
      `skillgantry recover --restore ${item.record.runId}`,
  )
}

export async function runRecover(
  deps: CliDeps,
  opts: { restore?: string; forget?: string; json?: boolean },
): Promise<InterruptedMutation[]> {
  const found = await detectInterrupted(deps.home)

  const target = opts.restore ?? opts.forget
  if (target !== undefined) {
    const item = found.find((candidate) => candidate.record.runId === target)
    if (!item) throw new Error(`no interrupted mutation with run id ${target}`)
    if (opts.restore !== undefined) {
      const restored = await restoreInterrupted(item)
      deps.write(
        restored.length > 0
          ? `restored ${restored.length} path(s): ${restored.join(', ')}`
          : `pruned the sandbox for ${item.record.runId}; the working tree was never modified`,
      )
    } else {
      await forgetInterrupted(item)
      deps.write(`forgot ${item.record.runId}; the working tree is unchanged`)
    }
    return found
  }

  if (opts.json) {
    deps.write(JSON.stringify(found))
    return found
  }
  if (found.length === 0) {
    deps.write('no interrupted mutation')
    return found
  }
  for (const line of formatInterrupted(found)) deps.write(line)
  return found
}
```

- [ ] **Step 8: Register the subcommand and the startup notice**

```ts
// src/cli/run-command.ts — inside buildProgram, after the doctor command
  program
    .command('recover')
    .description('report or resolve a mutation interrupted by a crash')
    .option('--restore <runId>', 'restore the working tree from the recorded pre-state')
    .option('--forget <runId>', 'keep the tree as it stands and stop reporting the record')
    .option('--json', 'emit one JSON document')
    .action(async (opts: { restore?: string; forget?: string; json?: boolean }) => {
      await runRecover(deps, opts)
    })
```

```ts
// src/cli/run-command.ts — a helper used by the run action and the root action
/**
 * R10.10: startup detects and offers. It never blocks — an old marker the user
 * has chosen to leave must not make the tool unusable — so the notice is a line
 * per record and the refusal lives where a second mutation would be applied
 * over an unrecovered first.
 */
async function noticeInterrupted(deps: CliDeps): Promise<void> {
  const found = await detectInterrupted(deps.home).catch(() => [])
  for (const line of formatInterrupted(found)) deps.write(`warning: ${line}`)
}
```

Call `await noticeInterrupted(deps)` as the first statement of the `run` action and of the root action, after `needsSetup` returns false.

- [ ] **Step 9: Run and commit**

Run: `pnpm lint && pnpm build && pnpm vitest run tests/core/isolation-recover.test.ts tests/cli/recover-command.test.ts tests/cli/run-command.test.ts`
Expected: PASS. `run-command.test.ts` is M1's and must stay green: `noticeInterrupted` swallows its own errors so a home with no config cannot fail a run.

```bash
git add src/core/isolation/recover.ts src/core/index.ts src/cli/recover-command.ts src/cli/run-command.ts tests/core/isolation-recover.test.ts tests/cli/recover-command.test.ts
git commit -m "feat: detect and resolve an interrupted mutation on startup

R10.10's marker is only useful if something reads it. Recovery prefers an
incomplete journal over the snapshot, because the journal holds the bytes as
they were immediately before the apply and restoring the older copy would
discard changes the user had already approved. The git strategy recovers by
pruning: it never wrote the live tree, so anything odd there is not ours."
```

---

### Task 7: The pipeline owns the sandbox, and authorisation becomes the engine's decision

**Files:**
- Modify: `src/core/stages/types.ts`
- Create: `src/core/stages/mutation.ts`
- Modify: `src/core/stages/adapter-stage.ts`
- Modify: `src/core/pipeline/run.ts`
- Modify: `src/cli/run-command.ts`
- Modify: `src/cli/tui-command.ts`
- Create: `tests/helpers/fake-mutating-tool.ts`
- Test: `tests/core/pipeline-sandbox.test.ts`

**Interfaces:**
- Consumes: `openSandbox`, `MutationSandbox`, `ChangeSet`; `MUTATING_STAGES` from `queue/types.js`.
- Produces:
  - `StageContext` gains `sandbox?: MutationSandbox`, `authorised: boolean`, `releaseTarget?: ReleaseTarget`, `runDir: string`, `allowDirty?: boolean`.
  - `ReleaseTarget { version: string; notes?: string }`.
  - `prepareFromSandbox(ctx)`, `applyFromSandbox(ctx, pending)`, `discardFromSandbox(ctx, pending)` in `stages/mutation.ts`, plus a `WeakMap` keyed by `PendingMutation` that carries the `ChangeSet` its diff came from.
  - `RunPipelineInput` gains `authorised?: boolean`, `releaseTarget?: ReleaseTarget`, `allowDirty?: boolean`.

Design §11.3 step 6 puts the sandbox in the pipeline, not the executor, and that is what lets one mutation path serve both mutating stages. An executor declares scope and decides; it never opens or closes a sandbox.

- [ ] **Step 1: Extend the stage context**

```ts
// src/core/stages/types.ts — additions
import type { MutationSandbox } from '../isolation/types.js'

/** R9.10: supplied explicitly, never inferred. */
export interface ReleaseTarget {
  /** A semver, or one of `major` / `minor` / `patch`. */
  version: string
  /** Free text prepended under the new changelog heading. */
  notes?: string
}

export interface StageContext {
  // …existing fields unchanged…
  /** `<workspace>/skillgantry/runs/<runId>` — where sandbox.json and the journal live. */
  runDir: string
  /**
   * R5.2. For a mutating stage: true means the write may proceed once the diff
   * has been shown. In the TUI it is always true and the gate prompts; headless
   * it is `--yes`. False makes the stage `skipped` with `no-authorisation`.
   */
  authorised: boolean
  /** Present only for a mutating stage, opened by the pipeline before any tool. */
  sandbox?: MutationSandbox
  releaseTarget?: ReleaseTarget
  /** R10.3's override, off by default. */
  allowDirty?: boolean
}
```

- [ ] **Step 2: Write the shared mutation hooks**

```ts
// src/core/stages/mutation.ts
import type { ChangeSet } from '../isolation/types.js'
import type { PendingMutation, StageContext } from './types.js'

/**
 * The change set a pending mutation was built from. It travels beside the
 * `PendingMutation` rather than inside it because `PendingMutation` crosses the
 * event stream to a frontend, and a frontend has no use for preimage hashes —
 * while `apply` cannot do without them, since R10.11's recheck compares against
 * the values captured when the diff was built.
 */
const CHANGE_SETS = new WeakMap<PendingMutation, ChangeSet>()

export function rememberChangeSet(pending: PendingMutation, change: ChangeSet): PendingMutation {
  CHANGE_SETS.set(pending, change)
  return pending
}

export function changeSetFor(pending: PendingMutation): ChangeSet {
  const change = CHANGE_SETS.get(pending)
  if (!change) throw new Error('no change set recorded for this pending mutation')
  return change
}

/** Null means the tools changed nothing, so there is nothing to approve. */
export async function prepareFromSandbox(ctx: StageContext): Promise<PendingMutation | null> {
  if (!ctx.sandbox) return null
  const change = await ctx.sandbox.changeSet()
  if (change.entries.length === 0) return null
  return rememberChangeSet(
    {
      diff: change.unifiedDiff,
      scope: change.entries.map((entry) => entry.path),
    },
    change,
  )
}

export async function applyFromSandbox(
  ctx: StageContext,
  pending: PendingMutation,
): Promise<void> {
  if (!ctx.sandbox) throw new Error('applyMutation called with no sandbox')
  await ctx.sandbox.apply(changeSetFor(pending))
}

export async function discardFromSandbox(ctx: StageContext): Promise<void> {
  await ctx.sandbox?.discard()
}
```

- [ ] **Step 3: Make `AdapterStageExecutor` mutating where the stage is**

```ts
// src/core/stages/adapter-stage.ts — replace the `mutating` field and add the hooks
import { MUTATING_STAGES } from '../queue/types.js'
import {
  applyFromSandbox,
  discardFromSandbox,
  prepareFromSandbox,
} from './mutation.js'

export class AdapterStageExecutor implements StageExecutor {
  /**
   * Derived rather than hard-coded false. The set lives in `queue/types.ts` so
   * the queue can serialise mutating jobs without importing an executor, and
   * reading it here is what stops the two disagreeing about which stages write.
   */
  readonly mutating: boolean

  constructor(
    readonly stage: Stage,
    private readonly options: AdapterStageOptions = {},
  ) {
    this.mutating = MUTATING_STAGES.has(stage)
  }

  // …plan() and execute() unchanged, except plan()'s return value…

  prepareMutation = (ctx: StageContext): Promise<PendingMutation | null> => prepareFromSandbox(ctx)
  applyMutation = (ctx: StageContext, pending: PendingMutation): Promise<void> =>
    applyFromSandbox(ctx, pending)
  discardMutation = (ctx: StageContext): Promise<void> => discardFromSandbox(ctx)
}
```

`plan()` must now declare a scope for a mutating stage, because a sandbox over an empty scope can neither snapshot nor diff. An optimise tool writes inside the skill directory, so:

```ts
    const mutationScope: MutationScope = this.mutating
      ? { paths: [ctx.skill.relPath === '.' ? '.' : ctx.skill.relPath] }
      : { paths: [] }
    return { toolIds: [...ctx.selectedToolIds], policy, mutationScope }
```

- [ ] **Step 4: Write the fake mutating tool**

```ts
// tests/helpers/fake-mutating-tool.ts
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface FakeMutatingTool {
  bin: string
}

/**
 * Stands in for an optimise tool: it rewrites `SKILL.md` in the directory it is
 * pointed at and writes a SARIF report so the adapter path is exercised end to
 * end. The point is that it writes *inside the sandbox*, which is the only way
 * to prove `{skillDir}` resolved there.
 */
export async function makeFakeMutatingTool(replacement: string): Promise<FakeMutatingTool> {
  const dir = await mkdtemp(join(tmpdir(), 'sg-mut-tool-'))
  const bin = join(dir, 'fake-optimiser')
  await writeFile(
    bin,
    [
      '#!/bin/sh',
      '# $1 is the skill dir, $2 the tool dir',
      `printf '%s' ${JSON.stringify(replacement)} > "$1/SKILL.md"`,
      'printf \'{"version":"2.1.0","runs":[{"tool":{"driver":{"name":"fake"}},"results":[]}]}\' > "$2/findings.sarif"',
      'echo rewrote SKILL.md',
      'exit 0',
    ].join('\n'),
  )
  await chmod(bin, 0o755)
  return { bin }
}
```

- [ ] **Step 5: Write the failing pipeline test**

```ts
// tests/core/pipeline-sandbox.test.ts
import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPipeline } from '../../src/core/pipeline/run.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { workspacePath } from '../../src/core/discovery/discover.js'
import { AdapterStageExecutor } from '../../src/core/stages/adapter-stage.js'
import { scanSandboxRecords } from '../../src/core/isolation/record.js'
import type { RunEvent } from '../../src/core/pipeline/events.js'
import type { SkillRef } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeGitRepo } from '../helpers/tmp-repo.js'
import { makeFakeMutatingTool } from '../helpers/fake-mutating-tool.js'

const OPTIMISED = SKILL_MD_FULL('sk', '1.0.0', 'rewritten by the optimiser')

/** A registry the optimise stage can be planned against; none ships. */
const fakeAdapter = (bin: string) => ({
  manifest: {
    id: 'fake-optimiser',
    stage: 'optimise' as const,
    policy: 'pick-one' as const,
    mutating: true,
    detects: [],
    credentials: { kind: 'none' as const },
    analysisMode: 'static',
    install: { kind: 'npm-prefix' as const, spec: 'x', pin: '1.0.0', binName: 'x' },
    invoke: { argv: ['{skillDir}', '{toolDir}'], cwd: 'repoRoot' as const },
    versionArgv: ['--version'],
    artefacts: ['findings.sarif'],
    timeoutMs: 30_000,
  },
  parse: () => ({ outcome: 'passed' as const, findings: [], metrics: {}, summary: 'rewrote' }),
  bin,
})

async function harness() {
  const repo = await makeGitRepo({ files: { 'sk/SKILL.md': SKILL_MD_FULL('sk') } })
  const skill: SkillRef = {
    id: 'repo/sk',
    name: 'sk',
    version: '1.0.0',
    dir: join(repo, 'sk'),
    relPath: 'sk',
    repo: { id: 'repo', path: repo, name: 'repo', isGit: true },
    rootSkill: false,
    workspacePath: workspacePath(repo, 'sk', false),
  }
  const tool = await makeFakeMutatingTool(OPTIMISED)
  const adapter = fakeAdapter(tool.bin)
  const ledger = openLedger(':memory:')

  const start = (over: Parameters<typeof runPipeline>[0] extends infer T ? Partial<T> : never) =>
    runPipeline({
      skill,
      stages: ['optimise'],
      trigger: 'test',
      stageTools: { optimise: ['fake-optimiser'] },
      lock: {
        version: 1,
        tools: {
          'fake-optimiser': {
            installKind: 'npm-prefix',
            requestedPin: '1.0.0',
            resolvedVersion: '1.0.0',
            bin: tool.bin,
            integrity: 'n/a',
            installedAt: 'now',
            verifiedAt: 'now',
          },
        },
      },
      ledger,
      env: process.env,
      secrets: [],
      provenance: { baseUrlHost: null, models: {}, authTokenHash: null },
      artefactSizeCapBytes: 1_000_000,
      timeoutOverridesMs: {},
      executorFactory: () =>
        new AdapterStageExecutor('optimise', { lookup: (id) => (id === 'fake-optimiser' ? adapter : undefined) }),
      ...over,
    })

  return { repo, skill, start }
}

const drain = async (handle: ReturnType<typeof runPipeline>): Promise<RunEvent[]> => {
  const seen: RunEvent[] = []
  for await (const event of handle.events) seen.push(event)
  return seen
}

describe('a mutating stage through the pipeline', () => {
  it('points the tool inside the sandbox and leaves the live tree untouched until apply', async () => {
    const { repo, start } = await harness()
    const handle = start({ authorised: true })
    const events = drain(handle)
    // The prompt arrives before anything is written — R5.2's ordering.
    await new Promise((r) => setTimeout(r, 50))
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(SKILL_MD_FULL('sk'))

    const seen = await events
    const pending = seen.find((e) => e.type === 'mutation:pending')
    expect(pending).toBeUndefined()
  })

  it('emits mutation:pending carrying the diff, then applies on approval', async () => {
    const { repo, start } = await harness()
    const handle = start({ authorised: true })
    void (async () => {
      for await (const event of handle.events) {
        if (event.type === 'mutation:pending') {
          expect(event.diff).toContain('rewritten by the optimiser')
          expect(event.scope).toEqual(['sk/SKILL.md'])
          handle.resolveMutation(event.requestId, 'apply')
        }
      }
    })()
    const summary = await handle.done
    expect(summary.outcome).toBe('passed')
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(OPTIMISED)
  })

  it('leaves the tree unchanged and reports skipped on discard', async () => {
    const { repo, start } = await harness()
    const handle = start({ authorised: true })
    void (async () => {
      for await (const event of handle.events) {
        if (event.type === 'mutation:pending') handle.resolveMutation(event.requestId, 'discard')
      }
    })()
    const summary = await handle.done
    expect(summary.stages[0]?.outcome).toBe('skipped')
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(SKILL_MD_FULL('sk'))
  })

  it('skips with no-authorisation when the run was not authorised', async () => {
    const { repo, start } = await harness()
    const summary = await start({ authorised: false }).done
    expect(summary.stages[0]?.outcome).toBe('skipped')
    expect(summary.stages[0]?.toolRuns[0]?.errorKind).toBe('no-authorisation')
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(SKILL_MD_FULL('sk'))
  })

  it('reports mutation-aborted and finalises when a target drifts before apply', async () => {
    const { repo, start } = await harness()
    const handle = start({ authorised: true })
    void (async () => {
      for await (const event of handle.events) {
        if (event.type === 'mutation:pending') {
          // The user edits while the diff sits on screen — R10.11's window.
          await writeFile(join(repo, 'sk/SKILL.md'), 'hand-edited\n')
          handle.resolveMutation(event.requestId, 'apply')
        }
      }
    })()
    const summary = await handle.done
    expect(summary.stages[0]?.outcome).toBe('errored')
    expect(summary.stages[0]?.toolRuns[0]?.errorKind).toBe('mutation-aborted')
    // R5.13: the run still finalises, so the partial evidence survives.
    expect(summary.runId).toBeTruthy()
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe('hand-edited\n')
  })

  it('settles the sandbox record on every path, so nothing is left reported as active', async () => {
    const { skill, start } = await harness()
    const handle = start({ authorised: true })
    void (async () => {
      for await (const event of handle.events) {
        if (event.type === 'mutation:pending') handle.resolveMutation(event.requestId, 'apply')
      }
    })()
    await handle.done
    expect(await scanSandboxRecords(skill.workspacePath)).toEqual([])
  })
})
```

- [ ] **Step 6: Run it and watch it fail**

Run: `pnpm vitest run tests/core/pipeline-sandbox.test.ts`
Expected: FAIL — `runPipeline` accepts no `authorised`, opens no sandbox, and `mutation:pending` never fires.

- [ ] **Step 7: Wire the sandbox lifecycle into the pipeline**

```ts
// src/core/pipeline/run.ts — additions inside the stage loop
      const plan = await executor.plan(ctx0)

      let sandbox: MutationSandbox | undefined
      let openFailure: string | null = null
      if (executor.mutating && input.authorised === true && plan.mutationScope.paths.length > 0) {
        try {
          sandbox = await openSandbox({
            skill: input.skill,
            stage,
            runId: id,
            recordDir: runDir,
            scope: plan.mutationScope.paths,
            ...(input.allowDirty === undefined ? {} : { allowDirty: input.allowDirty }),
          })
        } catch (err) {
          // A sandbox that will not open is row 3b: nothing was written, and the
          // stage has to say why rather than rejecting the whole run.
          openFailure = (err as Error).message
        }
      }

      const ctx: StageContext = {
        ...ctx0,
        // {skillDir} and {repoRoot} follow the sandbox, which is what makes the
        // tool write the copy rather than the user's tree (design §7).
        ...(sandbox
          ? { skill: { ...toolFacingSkill, dir: sandbox.resolve(input.skill.relPath), repo: { ...input.skill.repo, path: sandbox.workRoot } } }
          : {}),
        ...(sandbox ? { sandbox } : {}),
      }

      if (openFailure !== null) {
        const result = abortedStage(stage, plan, `sandbox: ${openFailure}`)
        await writeStageJson(stageDir, result)
        results.push(result)
        queue.push({ type: 'stage:done', runId: id, stage, outcome: result.outcome, result })
        outcome = result.outcome
        break
      }
```

and, around the gate:

```ts
      let result: StageResult
      try {
        result = await gateMutation(executor, ctx, plan, executed)
      } catch (err) {
        // Row 3b. R10.11 aborts an authorised apply on drift, and R5.13 requires
        // the run to finalise anyway so its partial evidence survives.
        await executor.discardMutation?.(ctx, { diff: '', scope: [] }).catch(() => undefined)
        result = abortedStage(stage, plan, (err as Error).message, executed)
      } finally {
        await sandbox?.dispose()
      }
```

with the helper:

```ts
/** Row 3b of design §8.1: an authorised apply that refused to write. */
function abortedStage(
  stage: Stage,
  plan: StagePlan,
  message: string,
  executed?: StageResult,
): StageResult {
  const toolId = plan.toolIds[0] ?? stage
  return {
    stage,
    outcome: 'errored',
    verdict: executed?.verdict ?? 'passed',
    toolRuns: [
      {
        toolId,
        toolVersion: null,
        outcome: 'errored',
        exitCode: null,
        durationMs: 0,
        errorKind: 'mutation-aborted',
        artefactDir: '',
        findings: [],
        metrics: {},
        summary: message,
      },
    ],
  }
}
```

- [ ] **Step 8: Make authorisation the engine's decision**

`RunPipelineInput` gains `authorised?: boolean`, `releaseTarget?: ReleaseTarget` and `allowDirty?: boolean`, all threaded onto `StageContext`, and `ctx0.authorised = input.authorised === true`. `AdapterStageExecutor.execute` gains row 3 at the top:

```ts
    // Row 3, before a process is spawned. It lands in the ledger as a tool run,
    // which is what the CLI's old pre-filter could not do: a stage filtered out
    // before the engine saw it was invisible to doctor, to statistics and to the
    // sidecar.
    if (this.mutating && !ctx.authorised) {
      const toolRuns = plan.toolIds.map((toolId) =>
        skipped(toolId, join(ctx.stageDir, toolId), 'no-authorisation'),
      )
      const { outcome, verdict } = reduceStageOutcome(toolRuns.map((t) => t.outcome))
      return { stage: ctx.stage, outcome, verdict, toolRuns }
    }
```

Then delete the pre-filter in `src/cli/run-command.ts` — the `MUTATING` set, the `stages`/`skippedStages` split and the synthetic `stage:done` write — and pass `authorised: opts.yes === true` instead. `src/cli/tui-command.ts` passes `authorised: true`, because in the terminal interface authorisation *is* the interactive confirmation the gate performs.

- [ ] **Step 9: Run everything**

Run: `pnpm lint && pnpm build && pnpm test`
Expected: PASS. Two M1/M2 suites need updating and both are behaviour changes this task intends:
- `tests/cli/run-command.test.ts`'s "skips a mutating stage without --yes" now asserts a real `stage:done` from the engine rather than the synthetic line.
- `tests/core/pipeline-mutation.test.ts`'s fake executors set `authorised: true`, since the gate is now reached only when the run is authorised.

- [ ] **Step 10: Commit**

```bash
git add src/core/stages src/core/pipeline/run.ts src/cli tests/core/pipeline-sandbox.test.ts tests/helpers/fake-mutating-tool.ts tests/cli/run-command.test.ts tests/core/pipeline-mutation.test.ts
git commit -m "feat: open the mutation sandbox in the pipeline and move authorisation into the engine

Design §11.3 step 6 puts the sandbox in the pipeline, so one mutation path
serves both mutating stages and an executor only declares scope and decides.
Authorisation moves off the CLI: filtering a mutating stage out of the request
made R12.4's skip invisible to the ledger, to doctor and to the sidecar. An
aborted apply is row 3b rather than an unhandled rejection, so R5.13's
finalisation still happens and the partial evidence survives."
```

---

### Task 8: The release decisions — version, frontmatter, changelog, manifest, preconditions

**Files:**
- Create: `src/core/release/version.ts`
- Create: `src/core/release/frontmatter-edit.ts`
- Create: `src/core/release/changelog.ts`
- Create: `src/core/release/manifest.ts`
- Create: `src/core/release/preconditions.ts`
- Create: `src/core/ledger/gates.ts`
- Test: `tests/core/release-version.test.ts`, `tests/core/release-frontmatter.test.ts`, `tests/core/release-changelog.test.ts`, `tests/core/release-manifest.test.ts`, `tests/core/release-preconditions.test.ts`, `tests/core/gates.test.ts`

Five pure modules and one query. Everything that decides is testable with no filesystem, which is the same split that made `adapters` and `ledger` M1's most valuable suites.

**Interfaces:**
- Produces:
  - `resolveTargetVersion(current: string | null, spec: string): string`
  - `setFrontmatterVersion(source: string, version: string): string`, `setDeprecated(source: string, value: boolean, supersededBy?: string): string`
  - `prependChangelogEntry(existing: string, version: string, date: string, notes?: string): string`
  - `readVersionsManifest(repoPath): Promise<{ path: string; versions: Record<string, string> } | null>`, `setManifestVersion(source: string, key: string, version: string): string`
  - `GateOutcome { stage: Stage; outcome: string; skillDigest: string; runId: string; sidecarPath: string }`, `latestGateOutcomes(db, skillId): GateOutcome[]`
  - `checkPreconditions(input: PreconditionInput): Refusal[]`, `Refusal { code: RefusalCode; message: string }`

- [ ] **Step 1: Write the failing version test**

```ts
// tests/core/release-version.test.ts
import { describe, expect, it } from 'vitest'
import { resolveTargetVersion } from '../../src/core/release/version.js'

describe('resolveTargetVersion', () => {
  it('accepts an explicit semver', () => {
    expect(resolveTargetVersion('1.0.0', '2.3.4')).toBe('2.3.4')
  })

  it.each([
    ['major', '2.0.0'],
    ['minor', '1.3.0'],
    ['patch', '1.2.4'],
  ])('applies the %s bump level', (level, expected) => {
    expect(resolveTargetVersion('1.2.3', level)).toBe(expected)
  })

  it('drops a prerelease when bumping, because a bump means a release', () => {
    expect(resolveTargetVersion('1.2.3-rc.1', 'patch')).toBe('1.2.4')
  })

  it('refuses a bump level with no current version', () => {
    expect(() => resolveTargetVersion(null, 'minor')).toThrow('no current version to bump')
  })

  it('accepts an explicit semver with no current version', () => {
    expect(resolveTargetVersion(null, '0.1.0')).toBe('0.1.0')
  })

  it('refuses a spec that is neither a semver nor a bump level', () => {
    expect(() => resolveTargetVersion('1.0.0', 'next')).toThrow('not a semver or a bump level')
  })

  it('refuses a target that is not greater than the current version', () => {
    expect(() => resolveTargetVersion('2.0.0', '1.9.9')).toThrow('not greater than 2.0.0')
    expect(() => resolveTargetVersion('2.0.0', '2.0.0')).toThrow('not greater than 2.0.0')
  })
})
```

- [ ] **Step 2: Implement it**

```ts
// src/core/release/version.ts
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

const BUMPS = ['major', 'minor', 'patch'] as const
type Bump = (typeof BUMPS)[number]

interface Parsed {
  major: number
  minor: number
  patch: number
  prerelease: string | null
}

export function parseSemver(value: string): Parsed | null {
  const match = SEMVER.exec(value.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  }
}

/** A release is greater than a prerelease of the same numbers, per semver. */
function compare(a: Parsed, b: Parsed): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (a.prerelease === b.prerelease) return 0
  if (a.prerelease === null) return 1
  if (b.prerelease === null) return -1
  return a.prerelease < b.prerelease ? -1 : 1
}

/**
 * R9.10: explicit, never inferred. A bump level is still explicit — the user
 * named which component moves — but it needs a current version to move from.
 *
 * The greater-than check is not in R9, and it is here because release applies to
 * the user's repo and writes an archive named after the version: a mistyped
 * downgrade would publish evidence claiming the newer bytes are the older
 * release. It refuses rather than warns, because a refusal is reversible.
 */
export function resolveTargetVersion(current: string | null, spec: string): string {
  const parsedCurrent = current === null ? null : parseSemver(current)
  const trimmed = spec.trim()

  let target: string
  if ((BUMPS as readonly string[]).includes(trimmed)) {
    if (!parsedCurrent) {
      throw new Error(`no current version to bump: supply an explicit semver instead of ${trimmed}`)
    }
    const { major, minor, patch } = parsedCurrent
    // A prerelease bumped by patch becomes the release it was heading for.
    target =
      trimmed === 'major'
        ? `${major + 1}.0.0`
        : trimmed === 'minor'
          ? `${major}.${minor + 1}.0`
          : parsedCurrent.prerelease !== null
            ? `${major}.${minor}.${patch}`
            : `${major}.${minor}.${patch + 1}`
  } else {
    if (!parseSemver(trimmed)) {
      throw new Error(`${spec} is not a semver or a bump level (major, minor, patch)`)
    }
    target = trimmed
  }

  const parsedTarget = parseSemver(target) as Parsed
  if (parsedCurrent && compare(parsedTarget, parsedCurrent) <= 0) {
    throw new Error(`${target} is not greater than ${current}`)
  }
  return target
}
```

The `patch` branch on a prerelease returns `1.2.3` for `1.2.3-rc.1`, which `compare` accepts as greater. The test asserts `1.2.4`; pick one and make both agree — the plan's test is the contract, so change the branch to always `patch + 1` and delete the prerelease special case, which is one fewer rule to remember.

- [ ] **Step 3: Run the version test**

Run: `pnpm vitest run tests/core/release-version.test.ts`
Expected: PASS, 9 assertions across 7 cases.

- [ ] **Step 4: Write the failing frontmatter and changelog tests**

```ts
// tests/core/release-frontmatter.test.ts
import { describe, expect, it } from 'vitest'
import { setDeprecated, setFrontmatterVersion } from '../../src/core/release/frontmatter-edit.js'
import { parseFrontmatter } from '../../src/core/discovery/frontmatter.js'

const SOURCE = [
  '---',
  'name: sk',
  'description: does a thing',
  '# a comment the user wrote',
  'metadata:',
  '  version: 1.0.0',
  '  author: someone',
  '---',
  '',
  '# sk',
  '',
  'Body text with a --- sequence in it.',
  '',
].join('\n')

describe('setFrontmatterVersion', () => {
  it('replaces the version and changes nothing else', () => {
    const out = setFrontmatterVersion(SOURCE, '1.1.0')
    expect(parseFrontmatter(out).version).toBe('1.1.0')
    // Re-serialising the YAML would reorder keys and drop the comment — a
    // mutation the user did not ask for and would see in the diff.
    expect(out).toContain('# a comment the user wrote')
    expect(out).toContain('  author: someone')
    expect(out.split('\n').length).toBe(SOURCE.split('\n').length)
    expect(out).toContain('Body text with a --- sequence in it.')
  })

  it('inserts a version into a metadata block that has none', () => {
    const source = '---\nname: sk\nmetadata:\n  author: x\n---\n\n# sk\n'
    expect(parseFrontmatter(setFrontmatterVersion(source, '0.1.0')).version).toBe('0.1.0')
  })

  it('creates the metadata block when the frontmatter has none', () => {
    const source = '---\nname: sk\ndescription: d\n---\n\n# sk\n'
    const out = setFrontmatterVersion(source, '0.1.0')
    expect(parseFrontmatter(out).version).toBe('0.1.0')
    expect(parseFrontmatter(out).name).toBe('sk')
  })

  it('refuses a file with no frontmatter rather than inventing one', () => {
    expect(() => setFrontmatterVersion('# sk\n', '1.0.0')).toThrow('no frontmatter')
  })
})

describe('setDeprecated', () => {
  it('sets the flag and the supersession', () => {
    const out = setDeprecated(SOURCE, true, 'repo/other')
    expect(parseFrontmatter(out).deprecated).toBe(true)
    expect(out).toContain('superseded_by: repo/other')
    expect(parseFrontmatter(out).version).toBe('1.0.0')
  })

  it('clears the flag on reversal and removes the supersession', () => {
    const out = setDeprecated(setDeprecated(SOURCE, true, 'repo/other'), false)
    expect(parseFrontmatter(out).deprecated).toBe(false)
    expect(out).not.toContain('superseded_by')
  })
})
```

```ts
// tests/core/release-changelog.test.ts
import { describe, expect, it } from 'vitest'
import { prependChangelogEntry } from '../../src/core/release/changelog.js'

describe('prependChangelogEntry', () => {
  it('creates a file with a heading when none exists', () => {
    const out = prependChangelogEntry('', '1.1.0', '2026-08-03')
    expect(out.startsWith('# Changelog\n')).toBe(true)
    expect(out).toContain('## 1.1.0 — 2026-08-03')
  })

  it('inserts under an existing heading, above the previous entry', () => {
    const existing = '# Changelog\n\n## 1.0.0 — 2026-01-01\n\n- first\n'
    const out = prependChangelogEntry(existing, '1.1.0', '2026-08-03')
    expect(out.indexOf('## 1.1.0')).toBeLessThan(out.indexOf('## 1.0.0'))
    expect(out).toContain('- first')
  })

  it('carries notes under the new heading', () => {
    const out = prependChangelogEntry('', '1.1.0', '2026-08-03', '- fixed the thing')
    expect(out).toContain('## 1.1.0 — 2026-08-03\n\n- fixed the thing\n')
  })

  it('refuses to add a version the changelog already names', () => {
    const existing = '# Changelog\n\n## 1.1.0 — 2026-01-01\n'
    expect(() => prependChangelogEntry(existing, '1.1.0', '2026-08-03')).toThrow(
      'changelog already has an entry for 1.1.0',
    )
  })
})
```

- [ ] **Step 5: Implement the text editors**

```ts
// src/core/release/frontmatter-edit.ts
const BLOCK = /^(﻿?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/

/**
 * Line edits, not a YAML round trip. Re-serialising would reorder keys, drop
 * comments and re-quote strings, so the diff the user is asked to approve would
 * carry changes nobody requested — and R10.8's review is only useful if every
 * line in it is a line release meant to write.
 */
function editBlock(source: string, edit: (lines: string[]) => string[]): string {
  const match = BLOCK.exec(source)
  if (!match) throw new Error('no frontmatter: refusing to invent one')
  const [, open, body, close] = match as unknown as [string, string, string, string]
  const edited = edit(body.split(/\r?\n/)).join('\n')
  return `${open}${edited}${close}${source.slice(match[0].length)}`
}

/** Index of a key inside the `metadata:` mapping, or -1. */
function findInMetadata(lines: readonly string[], key: string): number {
  const start = lines.findIndex((line) => /^metadata:\s*$/.test(line))
  if (start === -1) return -1
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] as string
    if (line.length > 0 && !/^\s/.test(line)) break
    if (new RegExp(`^\\s+${key}:`).test(line)) return i
  }
  return -1
}

function setMetadataKey(lines: string[], key: string, value: string): string[] {
  const existing = findInMetadata(lines, key)
  if (existing !== -1) {
    const indent = /^(\s+)/.exec(lines[existing] as string)?.[1] ?? '  '
    lines[existing] = `${indent}${key}: ${value}`
    return lines
  }
  const start = lines.findIndex((line) => /^metadata:\s*$/.test(line))
  if (start === -1) return [...lines, 'metadata:', `  ${key}: ${value}`]
  lines.splice(start + 1, 0, `  ${key}: ${value}`)
  return lines
}

function removeMetadataKey(lines: string[], key: string): string[] {
  const at = findInMetadata(lines, key)
  if (at !== -1) lines.splice(at, 1)
  return lines
}

export function setFrontmatterVersion(source: string, version: string): string {
  return editBlock(source, (lines) => setMetadataKey(lines, 'version', version))
}

/** R1.4's metadata, written through the ordinary mutation path (design §13). */
export function setDeprecated(source: string, value: boolean, supersededBy?: string): string {
  return editBlock(source, (lines) => {
    if (!value) return removeMetadataKey(removeMetadataKey(lines, 'deprecated'), 'superseded_by')
    const withFlag = setMetadataKey(lines, 'deprecated', 'true')
    return supersededBy === undefined
      ? removeMetadataKey(withFlag, 'superseded_by')
      : setMetadataKey(withFlag, 'superseded_by', supersededBy)
  })
}
```

```ts
// src/core/release/changelog.ts
const HEADING = '# Changelog'

/**
 * R9.3. The date is a parameter rather than read from the clock, because a pure
 * function is what lets the release state machine be tested without freezing
 * time.
 */
export function prependChangelogEntry(
  existing: string,
  version: string,
  date: string,
  notes?: string,
): string {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`^##\\s+${escaped}\\b`, 'm').test(existing)) {
    throw new Error(`changelog already has an entry for ${version}`)
  }

  const entry = `## ${version} — ${date}\n\n${notes ? `${notes.trimEnd()}\n` : ''}`
  const trimmed = existing.trimStart()
  if (trimmed.startsWith(HEADING)) {
    const firstBreak = existing.indexOf('\n', existing.indexOf(HEADING))
    const head = existing.slice(0, firstBreak + 1)
    const tail = existing.slice(firstBreak + 1).replace(/^\n+/, '')
    return `${head}\n${entry}\n${tail}`
  }
  return `${HEADING}\n\n${entry}${existing.length > 0 ? `\n${trimmed}` : ''}`
}
```

- [ ] **Step 6: Run both suites**

Run: `pnpm vitest run tests/core/release-frontmatter.test.ts tests/core/release-changelog.test.ts`
Expected: PASS, 10 cases.

- [ ] **Step 7: Write and implement the manifest reader**

```ts
// tests/core/release-manifest.test.ts
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { readVersionsManifest, setManifestVersion } from '../../src/core/release/manifest.js'
import { makeRepo } from '../helpers/tmp-repo.js'

const REAL = '{\n  "skills": {\n    "architecture-diagram": "1.1.1",\n    "declawed": "1.1.0"\n  }\n}\n'

describe('versions.json', () => {
  it('reads the real shape: entries nested under a skills key', async () => {
    const repo = await makeRepo({ files: { 'versions.json': REAL } })
    const manifest = await readVersionsManifest(repo)
    expect(manifest?.path).toBe(join(repo, 'versions.json'))
    expect(manifest?.versions.declawed).toBe('1.1.0')
  })

  it('returns null when the repo has no manifest, which is the 54-skill case', async () => {
    expect(await readVersionsManifest(await makeRepo({ files: {} }))).toBeNull()
  })

  it('returns null for a manifest it cannot understand rather than guessing', async () => {
    const repo = await makeRepo({ files: { 'versions.json': '["a","b"]' } })
    expect(await readVersionsManifest(repo)).toBeNull()
  })

  it('edits one entry and preserves the rest of the file', () => {
    const out = setManifestVersion(REAL, 'declawed', '1.2.0')
    expect(JSON.parse(out)).toEqual({
      skills: { 'architecture-diagram': '1.1.1', declawed: '1.2.0' },
    })
    expect(out.endsWith('\n')).toBe(true)
  })

  it('refuses a key the manifest does not carry', () => {
    expect(() => setManifestVersion(REAL, 'absent', '1.0.0')).toThrow(
      'versions.json has no entry for absent',
    )
  })
})
```

```ts
// src/core/release/manifest.ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface VersionsManifest {
  path: string
  versions: Record<string, string>
}

/**
 * The reference repo's shape, verified against the real file: entries nested
 * under a `skills` key, values bare semver strings. A top-level map would have
 * written a second, wrong manifest shape into twenty live skills.
 *
 * SkillGantry never creates this file (R9.1). Null means the repo has no
 * manifest, which is the case for all 54 skills in `~/.claude/skills`.
 */
export async function readVersionsManifest(repoPath: string): Promise<VersionsManifest | null> {
  const path = join(repoPath, 'versions.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const skills = (parsed as { skills?: unknown }).skills
  if (typeof skills !== 'object' || skills === null || Array.isArray(skills)) return null
  const versions: Record<string, string> = {}
  for (const [key, value] of Object.entries(skills as Record<string, unknown>)) {
    if (typeof value === 'string') versions[key] = value
  }
  return { path, versions }
}

/** Two-space JSON with a trailing newline, which is what the real file uses. */
export function setManifestVersion(source: string, key: string, version: string): string {
  const doc = JSON.parse(source) as { skills?: Record<string, string> }
  if (!doc.skills || !(key in doc.skills)) {
    throw new Error(`versions.json has no entry for ${key}`)
  }
  doc.skills[key] = version
  return `${JSON.stringify(doc, null, 2)}\n`
}
```

Run: `pnpm vitest run tests/core/release-manifest.test.ts` — PASS, 5 cases.

- [ ] **Step 8: Write and implement the gate query**

```ts
// tests/core/gates.test.ts
import { describe, expect, it } from 'vitest'
import { openLedger } from '../../src/core/ledger/db.js'
import { latestGateOutcomes } from '../../src/core/ledger/gates.js'
import { recordRun } from '../../src/core/ledger/record.js'
import { workspacePath } from '../../src/core/discovery/discover.js'
import type { SkillRef, Stage } from '../../src/core/types.js'

const skill: SkillRef = {
  id: 'repo/sk',
  name: 'sk',
  version: '1.0.0',
  dir: '/repo/sk',
  relPath: 'sk',
  repo: { id: 'repo', path: '/repo', name: 'repo', isGit: false },
  rootSkill: false,
  workspacePath: workspacePath('/repo', 'sk', false),
}

const run = (
  ledger: ReturnType<typeof openLedger>,
  runId: string,
  digest: string,
  stages: ReadonlyArray<[Stage, 'passed' | 'failed']>,
): void => {
  recordRun(ledger, {
    skill,
    runId,
    trigger: 'test',
    startedAt: 'now',
    endedAt: 'now',
    outcome: 'passed',
    skillDigest: digest,
    git: { commit: null, dirty: false },
    provenanceJson: '{}',
    toolLockJson: '{}',
    sidecarPath: `/repo/sk-workspace/skillgantry/runs/${runId}`,
    stages: stages.map(([stage, outcome]) => ({ stage, outcome, verdict: outcome, toolRuns: [] })),
  })
}

describe('latestGateOutcomes', () => {
  it('returns the most recent outcome per gate stage, by run id', () => {
    const ledger = openLedger(':memory:')
    run(ledger, '019000000000-a', 'sha256:old', [['validate', 'failed']])
    run(ledger, '019000000000-b', 'sha256:new', [['validate', 'passed'], ['security', 'passed']])
    const gates = latestGateOutcomes(ledger.db, skill.id)
    const byStage = new Map(gates.map((g) => [g.stage, g]))
    expect(byStage.get('validate')).toMatchObject({ outcome: 'passed', skillDigest: 'sha256:new' })
    expect(byStage.get('security')?.runId).toBe('019000000000-b')
    // A stage never run has no row, which is what release refuses on.
    expect(byStage.has('evaluate')).toBe(false)
  })

  it('ignores optimise and release, which are not gates', () => {
    const ledger = openLedger(':memory:')
    run(ledger, '019000000000-a', 'sha256:x', [['release', 'passed']])
    expect(latestGateOutcomes(ledger.db, skill.id)).toEqual([])
  })
})
```

```ts
// src/core/ledger/gates.ts
import type { DatabaseSync } from 'node:sqlite'
import type { Stage } from '../types.js'

/** R9.8's three. optimise and release are not gates and never authorise one. */
export const GATE_STAGES: readonly Stage[] = ['validate', 'evaluate', 'security']

export interface GateOutcome {
  stage: Stage
  outcome: string
  /** R9.9's binding: the bytes this gate actually ran against. */
  skillDigest: string
  runId: string
  sidecarPath: string
}

/**
 * The most recent run per gate stage. Ordered by run id, not by timestamp:
 * UUIDv7 is ordered by claim, which is the same field `latest` uses, so two runs
 * finishing out of order still agree on which evidence is newer.
 */
export function latestGateOutcomes(db: DatabaseSync, skillId: string): GateOutcome[] {
  const rows = db
    .prepare(
      `select s.stage as stage, s.outcome as outcome, r.skill_digest as digest,
              r.id as run_id, r.sidecar_path as sidecar
         from stages s
         join runs r on r.id = s.run_id
        where r.skill_id = ? and s.stage in ('validate', 'evaluate', 'security')
        order by r.id desc, s.id desc`,
    )
    .all(skillId) as Array<{
    stage: string
    outcome: string
    digest: string
    run_id: string
    sidecar: string
  }>

  const seen = new Map<string, GateOutcome>()
  for (const row of rows) {
    if (seen.has(row.stage)) continue
    seen.set(row.stage, {
      stage: row.stage as Stage,
      outcome: row.outcome,
      skillDigest: row.digest,
      runId: row.run_id,
      sidecarPath: row.sidecar,
    })
  }
  return [...seen.values()]
}
```

Run: `pnpm vitest run tests/core/gates.test.ts` — PASS, 2 cases.

- [ ] **Step 9: Write and implement the preconditions**

```ts
// tests/core/release-preconditions.test.ts
import { describe, expect, it } from 'vitest'
import { checkPreconditions } from '../../src/core/release/preconditions.js'
import type { PreconditionInput } from '../../src/core/release/preconditions.js'

const DIGEST = 'sha256:aaa'

const base: PreconditionInput = {
  gates: [
    { stage: 'validate', outcome: 'passed', skillDigest: DIGEST, runId: 'r1', sidecarPath: '/s' },
    { stage: 'evaluate', outcome: 'passed', skillDigest: DIGEST, runId: 'r1', sidecarPath: '/s' },
    { stage: 'security', outcome: 'passed', skillDigest: DIGEST, runId: 'r1', sidecarPath: '/s' },
  ],
  currentDigest: DIGEST,
  deprecated: false,
  frontmatterVersion: '1.0.0',
  manifestVersion: '1.0.0',
  hasManifest: true,
  interrupted: false,
}

const codes = (over: Partial<PreconditionInput>): string[] =>
  checkPreconditions({ ...base, ...over }).map((r) => r.code)

describe('checkPreconditions', () => {
  it('permits a skill whose three gates passed against the current bytes', () => {
    expect(checkPreconditions(base)).toEqual([])
  })

  it('refuses a deprecated skill — R1.4', () => {
    expect(codes({ deprecated: true })).toContain('deprecated')
  })

  it('refuses a gate that never ran', () => {
    expect(codes({ gates: base.gates.slice(0, 2) })).toContain('gate-missing')
  })

  it.each(['failed', 'degraded', 'errored', 'skipped'])('refuses a %s gate', (outcome) => {
    const gates = [{ ...base.gates[0]!, outcome }, ...base.gates.slice(1)]
    expect(codes({ gates })).toContain('gate-not-passed')
  })

  it('refuses when a gate ran against different bytes — R9.9', () => {
    const gates = [{ ...base.gates[0]!, skillDigest: 'sha256:stale' }, ...base.gates.slice(1)]
    expect(codes({ gates })).toContain('digest-mismatch')
  })

  it('refuses when the two versions already disagree, reporting both — R9.2', () => {
    const refusals = checkPreconditions({ ...base, manifestVersion: '0.9.0' })
    expect(refusals.map((r) => r.code)).toContain('version-disagreement')
    expect(refusals[0]?.message).toContain('1.0.0')
    expect(refusals[0]?.message).toContain('0.9.0')
  })

  it('permits the no-manifest case, which is every skill in ~/.claude/skills', () => {
    expect(codes({ hasManifest: false, manifestVersion: null })).toEqual([])
  })

  it('refuses while an interrupted mutation is unresolved', () => {
    expect(codes({ interrupted: true })).toContain('interrupted-mutation')
  })

  it('reports every refusal at once rather than the first', () => {
    expect(codes({ deprecated: true, gates: [] }).sort()).toEqual([
      'deprecated',
      'gate-missing',
      'gate-missing',
      'gate-missing',
    ])
  })
})
```

```ts
// src/core/release/preconditions.ts
import { GATE_STAGES, type GateOutcome } from '../ledger/gates.js'

export type RefusalCode =
  | 'deprecated'
  | 'gate-missing'
  | 'gate-not-passed'
  | 'digest-mismatch'
  | 'version-disagreement'
  | 'interrupted-mutation'

export interface Refusal {
  code: RefusalCode
  message: string
}

export interface PreconditionInput {
  gates: readonly GateOutcome[]
  /** The candidate's digest right now, over its candidate manifest. */
  currentDigest: string
  /** R1.6: read from the candidate's frontmatter, never from the ledger. */
  deprecated: boolean
  frontmatterVersion: string | null
  /** null when the repo has no versions.json. */
  manifestVersion: string | null
  hasManifest: boolean
  /** R10.10: an unresolved record means a second apply over an unrecovered first. */
  interrupted: boolean
}

/**
 * Every refusal, not the first. A user who has to fix three things learns all
 * three from one run rather than three.
 */
export function checkPreconditions(input: PreconditionInput): Refusal[] {
  const refusals: Refusal[] = []

  if (input.deprecated) {
    refusals.push({
      code: 'deprecated',
      message: 'the skill is deprecated: gates still run against it, release does not (R1.4)',
    })
  }

  const byStage = new Map(input.gates.map((gate) => [gate.stage, gate]))
  for (const stage of GATE_STAGES) {
    const gate = byStage.get(stage)
    if (!gate) {
      refusals.push({ code: 'gate-missing', message: `${stage} has never run for this skill` })
      continue
    }
    if (gate.outcome !== 'passed') {
      refusals.push({
        code: 'gate-not-passed',
        message: `${stage} last reported ${gate.outcome} (run ${gate.runId})`,
      })
      continue
    }
    if (gate.skillDigest !== input.currentDigest) {
      refusals.push({
        code: 'digest-mismatch',
        message:
          `${stage} passed against ${gate.skillDigest} and the candidate is now ` +
          `${input.currentDigest}: re-run the gates against these bytes (R9.9)`,
      })
    }
  }

  if (input.hasManifest && input.frontmatterVersion !== input.manifestVersion) {
    refusals.push({
      code: 'version-disagreement',
      message:
        `SKILL.md says ${input.frontmatterVersion ?? 'nothing'} and versions.json says ` +
        `${input.manifestVersion ?? 'nothing'}: reconcile them before releasing (R9.2)`,
    })
  }

  if (input.interrupted) {
    refusals.push({
      code: 'interrupted-mutation',
      message: 'an interrupted mutation is unresolved: run `skillgantry recover` first',
    })
  }

  return refusals
}
```

- [ ] **Step 10: Run everything and commit**

Run: `pnpm lint && pnpm build && pnpm vitest run tests/core/release-version.test.ts tests/core/release-frontmatter.test.ts tests/core/release-changelog.test.ts tests/core/release-manifest.test.ts tests/core/release-preconditions.test.ts tests/core/gates.test.ts`
Expected: PASS.

```bash
git add src/core/release src/core/ledger/gates.ts tests/core/release-*.test.ts tests/core/gates.test.ts
git commit -m "feat: add the release decisions as pure modules

Version resolution, frontmatter and changelog editing, manifest reading and the
precondition check all decide without touching disk, which is the split that
made adapters and ledger the most valuable suites in M1. Frontmatter is edited
line by line rather than round-tripped through YAML: re-serialising reorders
keys and drops comments, so the diff the user approves would carry changes
nobody asked for. versions.json nests entries under a skills key — verified
against the real twenty-entry file, not assumed."
```

---

### Task 9: The archive, the installability gate, and the evidence bundle

**Files:**
- Create: `src/core/release/archive.ts`
- Create: `src/core/release/install-check.ts`
- Create: `src/core/release/evidence.ts`
- Test: `tests/core/release-archive.test.ts`
- Test: `tests/core/release-install-check.test.ts`

**Interfaces:**
- Consumes: `candidateManifest`, `materialiseCandidate`, `CandidateManifest`, `Exec`, `GateOutcome`.
- Produces:
  - `packageCandidate(input: PackageInput): Promise<{ archivePath: string; sha256: string; entries: string[] }>` with `PackageInput { manifest: CandidateManifest; stagingDir: string; skillName: string; version: string; exec?: Exec }`
  - `verifyInstallable(input: InstallCheckInput): Promise<InstallCheckResult>` with `InstallCheckResult { ok: boolean; exitCode: number | null; output: string; destination: string }`
  - `writeEvidenceBundle(input: EvidenceInput): Promise<string>` — returns the evidence directory.

The whole of this task runs before a single byte reaches the user's tree. That ordering is R9.6a, and it is the reason revision 2's release had to undo a live change when a gate failed.

- [ ] **Step 1: Write the failing archive test**

```ts
// tests/core/release-archive.test.ts
import { describe, expect, it } from 'vitest'
import { chmod, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageCandidate } from '../../src/core/release/archive.js'
import { candidateManifest } from '../../src/core/discovery/candidate.js'
import { workspacePath } from '../../src/core/discovery/discover.js'
import { defaultExec } from '../../src/core/tools/exec.js'
import type { SkillRef } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeRepo } from '../helpers/tmp-repo.js'

async function scene(rootSkill = false) {
  const files = rootSkill
    ? { 'SKILL.md': SKILL_MD_FULL('sk'), 'scripts/run.sh': '#!/bin/sh\n', 'sk_0.9.0.zip': 'stale' }
    : { 'sk/SKILL.md': SKILL_MD_FULL('sk'), 'sk/scripts/run.sh': '#!/bin/sh\n' }
  const repo = await makeRepo({ files })
  const dir = rootSkill ? repo : join(repo, 'sk')
  await chmod(join(dir, rootSkill ? 'scripts/run.sh' : 'scripts/run.sh'), 0o755)
  await symlink('SKILL.md', join(dir, 'alias.md'))
  const skill: SkillRef = {
    id: rootSkill ? 'repo' : 'repo/sk',
    name: 'sk',
    version: '1.0.0',
    dir,
    relPath: rootSkill ? '.' : 'sk',
    repo: { id: 'repo', path: repo, name: 'repo', isGit: false },
    rootSkill,
    workspacePath: workspacePath(repo, rootSkill ? '.' : 'sk', rootSkill),
  }
  return { repo, skill, stagingDir: await mkdtemp(join(tmpdir(), 'sg-stage-')) }
}

describe('packageCandidate', () => {
  it('writes the archive into the staging directory, never the repo', async () => {
    const { repo, skill, stagingDir } = await scene()
    const result = await packageCandidate({
      manifest: await candidateManifest(skill),
      stagingDir,
      skillName: 'sk',
      version: '1.1.0',
    })
    expect(result.archivePath).toBe(join(stagingDir, 'sk_1.1.0.zip'))
    // R9.4 and R9.6a: nothing at the repo root until apply.
    await expect(stat(join(repo, 'sk_1.1.0.zip'))).rejects.toThrow()
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('holds exactly the manifest entries, with no directory entries', async () => {
    const { skill, stagingDir } = await scene()
    const manifest = await candidateManifest(skill)
    const result = await packageCandidate({
      manifest,
      stagingDir,
      skillName: 'sk',
      version: '1.1.0',
    })
    const { stdout } = await defaultExec('unzip', ['-Z1', result.archivePath])
    const listed = stdout.trim().split('\n').sort()
    expect(listed).toEqual(manifest.entries.map((e) => e.relPath).sort())
    expect(listed.some((name) => name.endsWith('/'))).toBe(false)
  })

  it('stores a symlink as a link and keeps the exec bit', async () => {
    const { skill, stagingDir } = await scene()
    const result = await packageCandidate({
      manifest: await candidateManifest(skill),
      stagingDir,
      skillName: 'sk',
      version: '1.1.0',
    })
    const out = await mkdtemp(join(tmpdir(), 'sg-unzip-'))
    await defaultExec('unzip', ['-q', result.archivePath, '-d', out])
    const info = await stat(join(out, 'alias.md'))
    // Following the link would package the target's bytes twice and break R2.10.
    expect(info.isSymbolicLink() || (await readFile(join(out, 'alias.md'), 'utf8')).length > 0).toBe(true)
    expect((await stat(join(out, 'scripts/run.sh'))).mode & 0o111).not.toBe(0)
  })

  it('excludes an earlier archive and the workspace from a repo-root candidate', async () => {
    const { skill, stagingDir } = await scene(true)
    const manifest = await candidateManifest(skill)
    const result = await packageCandidate({
      manifest,
      stagingDir,
      skillName: 'sk',
      version: '1.1.0',
    })
    const { stdout } = await defaultExec('unzip', ['-Z1', result.archivePath])
    expect(stdout).not.toContain('sk_0.9.0.zip')
    expect(stdout).not.toContain('.skillgantry-workspace')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/core/release-archive.test.ts`
Expected: FAIL — cannot resolve `release/archive.js`.

- [ ] **Step 3: Implement the archive**

```ts
// src/core/release/archive.ts
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { type CandidateManifest, materialiseCandidate } from '../discovery/candidate.js'
import { type Exec, defaultExec } from '../tools/exec.js'

export interface PackageInput {
  manifest: CandidateManifest
  /** `<run>/staging` — outside the candidate root, which is why the archive
   *  cannot contain itself. */
  stagingDir: string
  skillName: string
  version: string
  exec?: Exec
}

/**
 * A large skill would otherwise overflow argv. The reference repo's biggest
 * skill is well under this; the batch loop exists so a pathological one degrades
 * into several `zip` calls rather than an E2BIG nobody can act on.
 */
const ENTRIES_PER_CALL = 500

/**
 * R9.4: the archive holds exactly the candidate manifest. The entry list is not
 * an optimisation — `zip -r <dir>` adds directory entries the manifest does not
 * have, so passing names is what makes the archive equal to the digested set.
 *
 * `-y` stores symlinks as links (R2.10 holds in every consumer of the manifest);
 * `-X` drops extra attributes. The archive is still not byte-reproducible,
 * because zip embeds mtimes: the skill digest is the reproducible identity and
 * this SHA-256 is evidence of one build.
 */
export async function packageCandidate(
  input: PackageInput,
): Promise<{ archivePath: string; sha256: string; entries: string[] }> {
  const exec = input.exec ?? defaultExec
  await mkdir(input.stagingDir, { recursive: true })

  // Materialise first: the manifest already excludes the workspace, the git
  // directory and any earlier archive, and copying it means `zip` is pointed at
  // a tree that contains nothing else to get wrong.
  const contentRoot = join(input.stagingDir, 'content')
  await rm(contentRoot, { recursive: true, force: true })
  await mkdir(contentRoot, { recursive: true })
  await materialiseCandidate(input.manifest, contentRoot)

  const archivePath = join(input.stagingDir, `${input.skillName}_${input.version}.zip`)
  await rm(archivePath, { force: true })

  const entries = input.manifest.entries.map((entry) => entry.relPath)
  for (let i = 0; i < entries.length; i += ENTRIES_PER_CALL) {
    await exec('zip', ['-X', '-y', '-q', archivePath, ...entries.slice(i, i + ENTRIES_PER_CALL)], {
      cwd: contentRoot,
      timeoutMs: 300_000,
    })
  }

  const bytes = await readFile(archivePath)
  return { archivePath, sha256: createHash('sha256').update(bytes).digest('hex'), entries }
}
```

- [ ] **Step 4: Run the archive test**

Run: `pnpm vitest run tests/core/release-archive.test.ts`
Expected: PASS, 4 cases. `unzip -Z1` lists names only; if the installed unzip lacks `-Z`, use `unzip -l` and parse the trailing column.

- [ ] **Step 5: Write the failing installability test**

```ts
// tests/core/release-install-check.test.ts
import { describe, expect, it } from 'vitest'
import { chmod, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyInstallable } from '../../src/core/release/install-check.js'
import { packageCandidate } from '../../src/core/release/archive.js'
import { candidateManifest } from '../../src/core/discovery/candidate.js'
import { workspacePath } from '../../src/core/discovery/discover.js'
import type { SkillRef } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeRepo } from '../helpers/tmp-repo.js'

/** Stands in for vercel `skills`: records its argv, cwd and env, then answers. */
async function fakeSkills(exitCode: number): Promise<{ bin: string; log: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'sg-skills-'))
  const log = join(dir, 'invocation.txt')
  const bin = join(dir, 'skills')
  await writeFile(
    bin,
    [
      '#!/bin/sh',
      `{ echo "cwd=$PWD"; echo "track=$DO_NOT_TRACK"; echo "argv=$*"; } > ${JSON.stringify(log)}`,
      exitCode === 0
        ? 'echo Installed 1 skill'
        : 'echo "No valid skills found. Skills require a SKILL.md with name and description." >&2',
      `exit ${exitCode}`,
    ].join('\n'),
  )
  await chmod(bin, 0o755)
  return { bin, log }
}

async function archive() {
  const repo = await makeRepo({ files: { 'sk/SKILL.md': SKILL_MD_FULL('sk') } })
  const skill: SkillRef = {
    id: 'repo/sk',
    name: 'sk',
    version: '1.0.0',
    dir: join(repo, 'sk'),
    relPath: 'sk',
    repo: { id: 'repo', path: repo, name: 'repo', isGit: false },
    rootSkill: false,
    workspacePath: workspacePath(repo, 'sk', false),
  }
  const stagingDir = await mkdtemp(join(tmpdir(), 'sg-stage-'))
  const packaged = await packageCandidate({
    manifest: await candidateManifest(skill),
    stagingDir,
    skillName: 'sk',
    version: '1.1.0',
  })
  return { packaged, stagingDir }
}

describe('verifyInstallable', () => {
  it('extracts the archive and installs that directory, in copy mode, non-interactively', async () => {
    const { packaged, stagingDir } = await archive()
    const { bin, log } = await fakeSkills(0)
    const result = await verifyInstallable({
      archivePath: packaged.archivePath,
      stagingDir,
      skillsBin: bin,
    })
    expect(result.ok).toBe(true)
    const invocation = await readdir(stagingDir).then(() => import('node:fs/promises').then((fs) => fs.readFile(log, 'utf8')))
    // R9.6: the same bytes a consumer receives, installed from a directory,
    // because vercel `skills` documents git sources and local directories and
    // not zip archives.
    expect(invocation).toContain('--copy')
    expect(invocation).toContain('-y')
    expect(invocation).toContain('--agent claude-code')
    // The isolated destination is the cwd, verified by probe: the tool writes
    // <cwd>/.claude/skills and <cwd>/skills-lock.json and nothing else.
    expect(invocation).toContain(`cwd=${result.destination}`)
    // A gate must not emit an install telemetry event on the user's behalf.
    expect(invocation).toContain('track=1')
  })

  it('reports a non-zero exit as a failed gate, carrying the tool output', async () => {
    const { packaged, stagingDir } = await archive()
    const { bin } = await fakeSkills(1)
    const result = await verifyInstallable({
      archivePath: packaged.archivePath,
      stagingDir,
      skillsBin: bin,
    })
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('No valid skills found')
  })

  it('installs the extracted tree, not the archive', async () => {
    const { packaged, stagingDir } = await archive()
    const { bin, log } = await fakeSkills(0)
    await verifyInstallable({ archivePath: packaged.archivePath, stagingDir, skillsBin: bin })
    const invocation = await import('node:fs/promises').then((fs) => fs.readFile(log, 'utf8'))
    expect(invocation).not.toContain('.zip')
  })
})
```

- [ ] **Step 6: Implement the installability gate**

```ts
// src/core/release/install-check.ts
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { type Exec, defaultExec } from '../tools/exec.js'

export interface InstallCheckInput {
  archivePath: string
  /** `<run>/staging` — extraction and destination both live under it. */
  stagingDir: string
  /** The lock's resolved executable for vercel `skills`. */
  skillsBin: string
  exec?: Exec
  timeoutMs?: number
}

export interface InstallCheckResult {
  ok: boolean
  exitCode: number | null
  output: string
  /** The isolated destination, kept for the evidence bundle. */
  destination: string
}

/**
 * R9.6. The archive is extracted and *that directory* is installed, because
 * vercel `skills` documents git sources and local directories, not zip archives
 * — revision 2's "install the archive" was not executable as written. Extracting
 * first also verifies the same bytes a consumer receives.
 *
 * `--agent claude-code` matters: without it the tool installs to all 75 agents
 * it knows, which is 75 copies of the skill per gate run. The isolated
 * destination is the cwd, verified by probe.
 */
export async function verifyInstallable(input: InstallCheckInput): Promise<InstallCheckResult> {
  const exec = input.exec ?? defaultExec
  const extracted = join(input.stagingDir, 'verify-extract')
  const destination = join(input.stagingDir, 'verify-install')
  await rm(extracted, { recursive: true, force: true })
  await rm(destination, { recursive: true, force: true })
  await mkdir(extracted, { recursive: true })
  await mkdir(destination, { recursive: true })

  await exec('unzip', ['-q', '-o', input.archivePath, '-d', extracted], { timeoutMs: 120_000 })

  try {
    const { stdout, stderr } = await exec(
      input.skillsBin,
      ['add', extracted, '--copy', '--skill', '*', '--agent', 'claude-code', '-y'],
      {
        cwd: destination,
        env: { ...process.env, DO_NOT_TRACK: '1' } as Record<string, string>,
        timeoutMs: input.timeoutMs ?? 180_000,
      },
    )
    return { ok: true, exitCode: 0, output: `${stdout}${stderr}`, destination }
  } catch (err) {
    const failure = err as { code?: number; stdout?: string | Buffer; stderr?: string | Buffer }
    return {
      ok: false,
      exitCode: typeof failure.code === 'number' ? failure.code : null,
      output: `${failure.stdout?.toString() ?? ''}${failure.stderr?.toString() ?? ''}`,
      destination,
    }
  }
}
```

- [ ] **Step 7: Run the installability test**

Run: `pnpm vitest run tests/core/release-install-check.test.ts`
Expected: PASS, 3 cases. Simplify the awkward dynamic imports in the test to a top-level `import { readFile } from 'node:fs/promises'` before committing.

- [ ] **Step 8: Implement the evidence bundle**

```ts
// src/core/release/evidence.ts
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolLock } from '../config/schema.js'
import type { CandidateManifest } from '../discovery/candidate.js'
import type { GateOutcome } from '../ledger/gates.js'

export interface EvidenceInput {
  /** `<run>` — the bundle lands at `<run>/evidence`. */
  runDir: string
  gates: readonly GateOutcome[]
  lock: ToolLock
  skillDigest: string
  manifest: CandidateManifest
  archiveSha256: string
  /** R9.5's manifest mode: which release path this run took. */
  manifestMode: 'versions.json' | 'none'
  targetVersion: string
}

const STAGE_DIR: Readonly<Record<string, string>> = {
  validate: '01-validate',
  evaluate: '02-evaluate',
  security: '03-security',
}

/**
 * R9.5. The bundle is a copy, not a reference: the gate runs it cites can be
 * pruned, and evidence that stops resolving is not evidence. It is deliberately
 * unredacted (R7.4a) — rewriting a tool's own report risks corrupting it — and
 * the workspace is mode 0700 and gitignored.
 */
export async function writeEvidenceBundle(input: EvidenceInput): Promise<string> {
  const dir = join(input.runDir, 'evidence')
  await mkdir(dir, { recursive: true })

  for (const gate of input.gates) {
    const source = join(gate.sidecarPath, STAGE_DIR[gate.stage] ?? gate.stage, 'stage.json')
    await copyFile(source, join(dir, `${gate.stage}.json`)).catch(async () => {
      // A pruned run directory is recorded as absent rather than failing the
      // release: the ledger row is still the evidence that the gate passed.
      await writeFile(
        join(dir, `${gate.stage}.json`),
        `${JSON.stringify({ stage: gate.stage, runId: gate.runId, stageJson: 'unavailable' }, null, 2)}\n`,
      )
    })
  }

  await writeFile(join(dir, 'tool-lock.json'), `${JSON.stringify(input.lock, null, 2)}\n`)
  await writeFile(
    join(dir, 'release.json'),
    `${JSON.stringify(
      {
        targetVersion: input.targetVersion,
        skillDigest: input.skillDigest,
        archiveSha256: `sha256:${input.archiveSha256}`,
        manifestMode: input.manifestMode,
        gates: input.gates,
        candidateManifest: input.manifest.entries,
      },
      null,
      2,
    )}\n`,
  )
  return dir
}
```

- [ ] **Step 9: Verify and commit**

Run: `pnpm lint && pnpm build && pnpm vitest run tests/core/release-archive.test.ts tests/core/release-install-check.test.ts`

```bash
git add src/core/release tests/core/release-archive.test.ts tests/core/release-install-check.test.ts
git commit -m "feat: package the candidate, prove it installs, and bundle the evidence

The archive is zipped from an explicit entry list, because zip -r adds directory
entries the candidate manifest does not have and R9.4 requires the archive to be
exactly the digested set. Installability extracts and installs the directory:
vercel skills documents git sources and local directories, not zip archives, so
revision 2's install-the-archive was not executable. --agent claude-code because
the default installs to all 75 agents the tool knows, and DO_NOT_TRACK because a
gate must not emit telemetry on the user's behalf. All of it before any write to
the user's tree (R9.6a)."
```

---

### Task 10: Frontmatter as the lifecycle authority, the ledger as a cache

**Files:**
- Modify: `src/core/discovery/discover.ts`
- Create: `src/core/ledger/lifecycle.ts`
- Modify: `src/core/ledger/record.ts`
- Modify: `src/core/index.ts`
- Modify: `src/cli/doctor-command.ts`
- Modify: `src/cli/tui-command.ts`
- Test: `tests/core/lifecycle.test.ts`

**Interfaces:**
- Produces:
  - `SkillRef` gains `deprecated: boolean` and `supersededBy: string | null`.
  - `readLifecycleCache(db): Map<string, LifecycleState>`
  - `syncLifecycle(db, skills: readonly SkillRef[]): { reconciled: number }`
- Consumes: `parseFrontmatter`, which already returns `deprecated` (M3, Task 6).

M3 shipped doctor's `lifecycle-drift` report and left reconciliation to M5, which is this task. `parseFrontmatter` already reads `metadata.deprecated`; `discoverSkills` discards it, and nothing writes the ledger column but the `'active'` literal in `recordRun`'s insert.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/lifecycle.test.ts
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { readLifecycleCache, syncLifecycle } from '../../src/core/ledger/lifecycle.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { recordRun } from '../../src/core/ledger/record.js'
import { discoverSkills, workspacePath } from '../../src/core/discovery/discover.js'
import type { SkillRef } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeRepo } from '../helpers/tmp-repo.js'

const deprecatedMd = (name: string) =>
  `---\nname: ${name}\ndescription: d\nmetadata:\n  version: 1.0.0\n  deprecated: true\n  superseded_by: repo/other\n---\n\n# ${name}\n`

const record = (ledger: ReturnType<typeof openLedger>, skill: SkillRef) =>
  recordRun(ledger, {
    skill,
    runId: '019000000000-a',
    trigger: 'test',
    startedAt: 'now',
    endedAt: 'now',
    outcome: 'passed',
    skillDigest: 'sha256:x',
    git: { commit: null, dirty: false },
    provenanceJson: '{}',
    toolLockJson: '{}',
    sidecarPath: '/s',
    stages: [{ stage: 'validate', outcome: 'passed', verdict: 'passed', toolRuns: [] }],
  })

describe('lifecycle authority', () => {
  it('discovery reads deprecation from frontmatter', async () => {
    const repo = await makeRepo({
      files: { 'live/SKILL.md': SKILL_MD_FULL('live'), 'dead/SKILL.md': deprecatedMd('dead') },
    })
    const skills = await discoverSkills({ id: 'repo', path: repo, name: 'repo', isGit: false })
    const byId = new Map(skills.map((s) => [s.id, s]))
    expect(byId.get('repo/live')?.deprecated).toBe(false)
    expect(byId.get('repo/dead')?.deprecated).toBe(true)
    expect(byId.get('repo/dead')?.supersededBy).toBe('repo/other')
  })

  it('records the lifecycle state a run observed rather than a hard-coded active', async () => {
    const ledger = openLedger(':memory:')
    const skill: SkillRef = {
      id: 'repo/dead',
      name: 'dead',
      version: '1.0.0',
      dir: '/repo/dead',
      relPath: 'dead',
      repo: { id: 'repo', path: '/repo', name: 'repo', isGit: false },
      rootSkill: false,
      workspacePath: workspacePath('/repo', 'dead', false),
      deprecated: true,
      supersededBy: 'repo/other',
    }
    record(ledger, skill)
    expect(readLifecycleCache(ledger.db).get('repo/dead')).toBe('deprecated')
  })

  it('reconciles a stale cache to the file, in both directions', async () => {
    const ledger = openLedger(':memory:')
    const repo = await makeRepo({ files: { 'dead/SKILL.md': deprecatedMd('dead') } })
    const skills = await discoverSkills({ id: 'repo', path: repo, name: 'repo', isGit: false })
    const skill = skills[0] as SkillRef
    // A run recorded before the deprecation, so the cache says active.
    record(ledger, { ...skill, deprecated: false, supersededBy: null })
    expect(readLifecycleCache(ledger.db).get(skill.id)).toBe('active')

    expect(syncLifecycle(ledger.db, skills).reconciled).toBe(1)
    expect(readLifecycleCache(ledger.db).get(skill.id)).toBe('deprecated')
    // Idempotent: a second scan reconciles nothing.
    expect(syncLifecycle(ledger.db, skills).reconciled).toBe(0)

    // Reversal is one file write, and the ledger follows on the next scan.
    const revived = [{ ...skill, deprecated: false, supersededBy: null }]
    expect(syncLifecycle(ledger.db, revived).reconciled).toBe(1)
    expect(readLifecycleCache(ledger.db).get(skill.id)).toBe('active')
  })

  it('ignores a skill the ledger has never seen rather than inserting a row', () => {
    const ledger = openLedger(':memory:')
    const unknown: SkillRef = {
      id: 'repo/never-run',
      name: 'x',
      version: null,
      dir: '/repo/x',
      relPath: 'x',
      repo: { id: 'repo', path: '/repo', name: 'repo', isGit: false },
      rootSkill: false,
      workspacePath: '/repo/x-workspace',
      deprecated: true,
      supersededBy: null,
    }
    expect(syncLifecycle(ledger.db, [unknown]).reconciled).toBe(0)
    expect(readLifecycleCache(ledger.db).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/core/lifecycle.test.ts`
Expected: FAIL — `SkillRef` has no `deprecated`; `ledger/lifecycle.js` does not resolve.

- [ ] **Step 3: Carry deprecation onto `SkillRef`**

```ts
// src/core/types.ts — inside SkillRef
  /** R1.6: read from SKILL.md frontmatter, which is the authority. */
  deprecated: boolean
  supersededBy: string | null
```

```ts
// src/core/discovery/frontmatter.ts — Frontmatter gains one field
  /** R1.4's optional pointer at the replacement. */
  supersededBy: string | null
```

with `supersededBy: asString(metadata.superseded_by)` in the return and `supersededBy: null` in `EMPTY`.

```ts
// src/core/discovery/discover.ts — inside toSkill
  let front = {
    name: null as string | null,
    version: null as string | null,
    deprecated: false,
    supersededBy: null as string | null,
  }
  // …unchanged read…
  return {
    // …unchanged fields…
    deprecated: front.deprecated,
    supersededBy: front.supersededBy,
  }
```

- [ ] **Step 4: Implement the cache and its reconciliation**

```ts
// src/core/ledger/lifecycle.ts
import type { DatabaseSync } from 'node:sqlite'
import type { SkillRef } from '../types.js'

export type LifecycleState = 'active' | 'deprecated'

/**
 * The ledger's copy of a lifecycle state. It is a cache, not the truth: the file
 * mutation and this transaction cannot be made atomic, so R1.6 names the file as
 * the authority and leaves a divergence as drift to report.
 *
 * It still earns its place — the Issues and Dashboard screens filter deprecated
 * skills across every registered repo without reading 76 files.
 */
export function readLifecycleCache(db: DatabaseSync): Map<string, LifecycleState> {
  const rows = db.prepare('select id, lifecycle_state as state from skills').all() as Array<{
    id: string
    state: string
  }>
  return new Map(rows.map((row) => [row.id, row.state === 'deprecated' ? 'deprecated' : 'active']))
}

/**
 * Reconciles the cache to the files, so a stale ledger self-heals on the next
 * discovery rather than needing recovery. A skill the ledger has never seen is
 * left alone: a row with no run is not a cache miss, it is a skill nothing has
 * ever recorded, and inserting one here would put discovery's I/O upstream of
 * the ledger's foreign keys.
 */
export function syncLifecycle(
  db: DatabaseSync,
  skills: readonly SkillRef[],
): { reconciled: number } {
  const cache = readLifecycleCache(db)
  let reconciled = 0
  db.exec('begin')
  try {
    for (const skill of skills) {
      const cached = cache.get(skill.id)
      if (cached === undefined) continue
      const file: LifecycleState = skill.deprecated ? 'deprecated' : 'active'
      if (cached === file) continue
      db.prepare(
        `update skills
            set lifecycle_state = ?,
                deprecated_at = case when ? = 'deprecated' then datetime('now') else null end,
                superseded_by = ?
          where id = ?`,
      ).run(file, file, skill.supersededBy, skill.id)
      reconciled += 1
    }
    db.exec('commit')
  } catch (err) {
    db.exec('rollback')
    throw err
  }
  return { reconciled }
}
```

- [ ] **Step 5: Stop `recordRun` writing a hard-coded `active`**

```ts
// src/core/ledger/record.ts — the skills upsert
    db.prepare(
      `insert into skills (id, repo_id, name, rel_path, current_version,
                           lifecycle_state, deprecated_at, superseded_by)
       values (?, ?, ?, ?, ?, ?, case when ? = 'deprecated' then datetime('now') end, ?)
       on conflict(id) do update set
         name = excluded.name,
         current_version = excluded.current_version,
         -- The file is the authority, and this run just read it (R1.6).
         lifecycle_state = excluded.lifecycle_state,
         superseded_by = excluded.superseded_by,
         last_seen = datetime('now')`,
    ).run(
      skill.id,
      skill.repo.id,
      skill.name,
      skill.relPath,
      skill.version,
      skill.deprecated ? 'deprecated' : 'active',
      skill.deprecated ? 'deprecated' : 'active',
      skill.supersededBy,
    )
```

- [ ] **Step 6: Route the CLI's cache read through core, and sync on launch**

`src/cli/doctor-command.ts` deletes its private `lifecycleCache` and calls `readLifecycleCache(ledger.db)`. `src/cli/tui-command.ts` and the `run` action both call `syncLifecycle(ledger.db, skills)` after discovery, which is where "reconciled on every scan" actually happens. Export both from `src/core/index.ts`:

```ts
export { readLifecycleCache, syncLifecycle } from './ledger/lifecycle.js'
export { GATE_STAGES, latestGateOutcomes, type GateOutcome } from './ledger/gates.js'
```

`doctor.ts` already imports `LifecycleState` from its own module; keep that type where it is and have `lifecycle.ts` re-export it, or import doctor's. One definition either way — a second copy is what R1.6's own rationale warns about.

- [ ] **Step 7: Run the whole suite**

Run: `pnpm lint && pnpm build && pnpm test`
Expected: PASS. Every fixture that builds a `SkillRef` by hand now needs the two new fields; that is roughly a dozen test files and the compiler names each one. Prefer adding the fields to the fixture helpers over sprinkling them at call sites.

- [ ] **Step 8: Commit**

```bash
git add src/core tests/core/lifecycle.test.ts src/cli
git commit -m "feat: make SKILL.md frontmatter the lifecycle authority and the ledger a cache

M3 shipped doctor's lifecycle-drift report and left reconciliation to M5. The
ledger column was written as a hard-coded 'active' on insert and never updated,
so a deprecated skill read as active for every consumer but doctor. Discovery
now carries deprecation off the file, recordRun records what the run observed,
and syncLifecycle reconciles the cache on every scan — so a stale ledger
self-heals rather than needing recovery (R1.6)."
```

---

### Task 11: `ReleaseStageExecutor` and the §12.4 state machine

**Files:**
- Create: `src/core/release/release.ts`
- Create: `src/core/stages/release-stage.ts`
- Modify: `src/core/pipeline/run.ts` (executor factory)
- Modify: `docs/specs/design.md` (§12.4 classification)
- Test: `tests/core/release-stage.test.ts`

**Interfaces:**
- Consumes: everything Tasks 8–10 produce, plus `openSandbox`, `prepareFromSandbox`, `applyFromSandbox`, `discardFromSandbox`, `RELEASE_TOOL_ID`.
- Produces:
  - `stageCandidateEdits(input): Promise<{ manifestMode: 'versions.json' | 'none' }>` — writes `SKILL.md`, `CHANGELOG.md` and `versions.json` **inside the sandbox**.
  - `releaseScope(skill, repoHasManifest, skillName, version): MutationScope`
  - `ReleaseStageExecutor implements StageExecutor` with `stage = 'release'`, `mutating = true`.

The order is design §12.4's, inverted from revision 2: everything is built and proven in the sandbox, and the user's tree is touched once, at the end, when nothing is left that can fail on its own merits.

```
validate-preconditions → resolve-target-version → stage-candidate-edits
  → package-in-sandbox → verify-install → build-change-set → preview-diff
  → await-confirmation → recheck-preimages → apply → record-evidence → done
```

Everything up to `build-change-set` happens in `execute()`. `preview-diff` and `await-confirmation` are the pipeline's gate. `recheck-preimages` and `apply` are `applyMutation`. `record-evidence` runs after a successful apply.

**What the stage reports as a tool run.** `StageResult` carries no message of its own and `reduceStageOutcome` throws on an empty list, so the stage synthesises exactly one `ToolRunRecord` under `RELEASE_TOOL_ID` — the one external tool it invokes. Add this table to design §12.4:

| Situation | `ToolOutcome` | `error_kind` |
|---|---|---|
| vercel `skills` absent from the lock | `skipped` | `not-installed` |
| Not authorised (headless without `--yes`) | `skipped` | `no-authorisation` |
| A precondition refused (deprecated, gate, digest, version disagreement, unresolved mutation) | `failed` | — |
| The installability check exited non-zero | `failed` | — |
| `zip` / `unzip` / `skills` could not be invoked | `errored` | `spawn` |
| The check timed out | `errored` | `timeout` |
| The apply aborted after authorisation | `errored` | `mutation-aborted` |
| Applied | `passed` | — |

A refusal is `failed` with no `error_kind`, because the gate ran and understood the skill; that is the same distinction §8.1's governing rule draws between a verdict and an error. Row 6 of the probed facts is what makes this safe: `reconcile.ts` tolerates a tool with no adapter, so a `skills` tool run touches no issue.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/release-stage.test.ts
import { describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReleaseStageExecutor } from '../../src/core/stages/release-stage.js'
import { openSandbox } from '../../src/core/isolation/open.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { recordRun } from '../../src/core/ledger/record.js'
import { candidateManifest } from '../../src/core/discovery/candidate.js'
import { skillDigest } from '../../src/core/discovery/digest.js'
import { workspacePath } from '../../src/core/discovery/discover.js'
import { prepareFromSandbox } from '../../src/core/stages/mutation.js'
import type { StageContext } from '../../src/core/stages/types.js'
import type { Ledger } from '../../src/core/ledger/db.js'
import type { SkillRef, Stage } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeGitRepo } from '../helpers/tmp-repo.js'

/** Answers like vercel `skills` 1.5.21 does, per the probed facts. */
async function fakeSkills(exitCode = 0): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sg-skills-'))
  const bin = join(dir, 'skills')
  await writeFile(
    bin,
    exitCode === 0
      ? '#!/bin/sh\necho "Installed 1 skill"\nexit 0\n'
      : '#!/bin/sh\necho "No valid skills found." >&2\nexit 1\n',
  )
  await chmod(bin, 0o755)
  return bin
}

async function scene(opts: { manifest?: boolean; skillsExit?: number } = {}) {
  const withManifest = opts.manifest !== false
  const repo = await makeGitRepo({
    files: {
      'sk/SKILL.md': SKILL_MD_FULL('sk'),
      ...(withManifest ? { 'versions.json': '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n' } : {}),
    },
  })
  const skill: SkillRef = {
    id: 'repo/sk',
    name: 'sk',
    version: '1.0.0',
    dir: join(repo, 'sk'),
    relPath: 'sk',
    repo: { id: 'repo', path: repo, name: 'repo', isGit: true },
    rootSkill: false,
    workspacePath: workspacePath(repo, 'sk', false),
    deprecated: false,
    supersededBy: null,
  }
  const digest = await skillDigest(await candidateManifest(skill))
  const ledger = openLedger(':memory:')
  passGates(ledger, skill, digest)

  const runDir = join(skill.workspacePath, 'skillgantry', 'runs', 'run-rel')
  await mkdir(runDir, { recursive: true })
  const bin = await fakeSkills(opts.skillsExit ?? 0)

  const ctx = (over: Partial<StageContext> = {}): StageContext => ({
    skill,
    stage: 'release' as Stage,
    stageDir: join(runDir, '05-release'),
    runDir,
    selectedToolIds: [],
    lock: {
      version: 1,
      tools: {
        skills: {
          installKind: 'npm-prefix',
          requestedPin: '1.5.21',
          resolvedVersion: '1.5.21',
          bin,
          integrity: 'n/a',
          installedAt: 'now',
          verifiedAt: 'now',
        },
      },
    },
    env: process.env,
    secrets: [],
    artefactSizeCapBytes: 1_000_000,
    timeoutOverridesMs: {},
    onOutput: () => undefined,
    authorised: true,
    releaseTarget: { version: 'minor' },
    ...over,
  })

  return { repo, skill, ledger, runDir, ctx, digest }
}

function passGates(ledger: Ledger, skill: SkillRef, digest: string, runId = '019000000000-a'): void {
  recordRun(ledger, {
    skill,
    runId,
    trigger: 'test',
    startedAt: 'now',
    endedAt: 'now',
    outcome: 'passed',
    skillDigest: digest,
    git: { commit: null, dirty: false },
    provenanceJson: '{}',
    toolLockJson: '{}',
    sidecarPath: join(skill.workspacePath, 'skillgantry', 'runs', runId),
    stages: (['validate', 'evaluate', 'security'] as Stage[]).map((stage) => ({
      stage,
      outcome: 'passed' as const,
      verdict: 'passed' as const,
      toolRuns: [],
    })),
  })
}

/** The pipeline's job, done by hand so the executor is testable in isolation. */
async function run(s: Awaited<ReturnType<typeof scene>>, over: Partial<StageContext> = {}) {
  const executor = new ReleaseStageExecutor({ ledger: s.ledger })
  const base = s.ctx(over)
  const plan = await executor.plan(base)
  const sandbox =
    base.authorised && plan.mutationScope.paths.length > 0
      ? await openSandbox({
          skill: s.skill,
          stage: 'release',
          runId: 'run-rel',
          recordDir: s.runDir,
          scope: plan.mutationScope.paths,
        })
      : undefined
  const ctx: StageContext = { ...base, ...(sandbox ? { sandbox } : {}) }
  const result = await executor.execute(ctx, plan)
  return { executor, ctx, plan, sandbox, result }
}

describe('ReleaseStageExecutor', () => {
  it('declares a scope spanning the skill, its changelog, the manifest and the archive', async () => {
    const s = await scene()
    const plan = await new ReleaseStageExecutor({ ledger: s.ledger }).plan(s.ctx())
    expect(plan.policy).toBe('native')
    expect(plan.toolIds).toEqual([])
    expect([...plan.mutationScope.paths].sort()).toEqual(
      ['sk/CHANGELOG.md', 'sk/SKILL.md', 'sk_1.1.0.zip', 'versions.json'].sort(),
    )
  })

  it('stages the edits, packages and verifies without touching the live tree', async () => {
    const s = await scene()
    const { result, ctx, executor, sandbox } = await run(s)
    expect(result.outcome).toBe('passed')

    // R9.6a: nothing live yet, including the archive.
    expect(await readFile(join(s.repo, 'sk/SKILL.md'), 'utf8')).toContain('1.0.0')
    await expect(stat(join(s.repo, 'sk_1.1.0.zip'))).rejects.toThrow()
    await expect(stat(join(s.repo, 'sk/CHANGELOG.md'))).rejects.toThrow()

    const pending = await executor.prepareMutation(ctx, await executor.plan(ctx), result)
    expect(pending?.diff).toContain('1.1.0')
    expect([...(pending?.scope ?? [])].sort()).toEqual(
      ['sk/CHANGELOG.md', 'sk/SKILL.md', 'sk_1.1.0.zip', 'versions.json'].sort(),
    )
    await sandbox?.dispose()
  })

  it('applies every scoped file and the archive together, and writes the evidence', async () => {
    const s = await scene()
    const { result, ctx, executor, sandbox } = await run(s)
    const pending = await executor.prepareMutation(ctx, await executor.plan(ctx), result)
    await executor.applyMutation(ctx, pending!)

    expect(await readFile(join(s.repo, 'sk/SKILL.md'), 'utf8')).toContain('1.1.0')
    expect(await readFile(join(s.repo, 'sk/CHANGELOG.md'), 'utf8')).toContain('## 1.1.0')
    expect(JSON.parse(await readFile(join(s.repo, 'versions.json'), 'utf8'))).toEqual({
      skills: { sk: '1.1.0' },
    })
    // R9.4: the archive is an output of the transaction, at the repo root.
    expect((await stat(join(s.repo, 'sk_1.1.0.zip'))).size).toBeGreaterThan(0)

    const evidence = JSON.parse(
      await readFile(join(s.runDir, 'evidence', 'release.json'), 'utf8'),
    ) as { archiveSha256: string; manifestMode: string; candidateManifest: unknown[] }
    expect(evidence.archiveSha256).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(evidence.manifestMode).toBe('versions.json')
    expect(evidence.candidateManifest.length).toBeGreaterThan(0)
    // R9.7: never a commit.
    await sandbox?.dispose()
  })

  it('releases a repo with no manifest and records the mode', async () => {
    const s = await scene({ manifest: false })
    const { result, ctx, executor, sandbox } = await run(s)
    expect(result.outcome).toBe('passed')
    const pending = await executor.prepareMutation(ctx, await executor.plan(ctx), result)
    await executor.applyMutation(ctx, pending!)
    expect(await readFile(join(s.repo, 'sk/SKILL.md'), 'utf8')).toContain('1.1.0')
    // R9.1: SkillGantry never creates a versions.json.
    await expect(stat(join(s.repo, 'versions.json'))).rejects.toThrow()
    const evidence = JSON.parse(await readFile(join(s.runDir, 'evidence', 'release.json'), 'utf8')) as {
      manifestMode: string
    }
    expect(evidence.manifestMode).toBe('none')
    await sandbox?.dispose()
  })

  it('fails and leaves no repo-root archive when the installability gate refuses', async () => {
    const s = await scene({ skillsExit: 1 })
    const { result, sandbox } = await run(s)
    expect(result.outcome).toBe('failed')
    expect(result.toolRuns[0]?.errorKind).toBeNull()
    expect(result.toolRuns[0]?.summary).toContain('No valid skills found')
    await expect(stat(join(s.repo, 'sk_1.1.0.zip'))).rejects.toThrow()
    expect(await readFile(join(s.repo, 'sk/SKILL.md'), 'utf8')).toContain('1.0.0')
    await sandbox?.dispose()
  })

  it('refuses on a digest mismatch, naming the requirement', async () => {
    const s = await scene()
    await writeFile(join(s.repo, 'sk/SKILL.md'), SKILL_MD_FULL('sk', '1.0.0', 'edited after the gates'))
    const { result, sandbox } = await run(s, { allowDirty: true })
    expect(result.outcome).toBe('failed')
    expect(result.toolRuns[0]?.summary).toContain('R9.9')
    await sandbox?.dispose()
  })

  it('refuses a deprecated skill while the gates still pass', async () => {
    const s = await scene()
    const { result, sandbox } = await run(s, {
      skill: { ...s.skill, deprecated: true },
    })
    expect(result.outcome).toBe('failed')
    expect(result.toolRuns[0]?.summary).toContain('deprecated')
    await sandbox?.dispose()
  })

  it('skips with not-installed when vercel skills is absent from the lock', async () => {
    const s = await scene()
    const { result } = await run(s, { lock: { version: 1, tools: {} } })
    expect(result.outcome).toBe('skipped')
    expect(result.toolRuns[0]?.errorKind).toBe('not-installed')
  })

  it('skips with no-authorisation and never opens a sandbox', async () => {
    const s = await scene()
    const { result, sandbox } = await run(s, { authorised: false })
    expect(sandbox).toBeUndefined()
    expect(result.outcome).toBe('skipped')
    expect(result.toolRuns[0]?.errorKind).toBe('no-authorisation')
  })

  it('refuses when no target version was supplied — R9.10', async () => {
    const s = await scene()
    const { result } = await run(s, { releaseTarget: undefined })
    expect(result.outcome).toBe('failed')
    expect(result.toolRuns[0]?.summary).toContain('no target version')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/core/release-stage.test.ts`
Expected: FAIL — cannot resolve `stages/release-stage.js`.

- [ ] **Step 3: Implement the staged edits and the scope**

```ts
// src/core/release/release.ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { MutationSandbox } from '../isolation/types.js'
import type { MutationScope } from '../stages/types.js'
import type { SkillRef } from '../types.js'
import { prependChangelogEntry } from './changelog.js'
import { setFrontmatterVersion } from './frontmatter-edit.js'
import { setManifestVersion } from './manifest.js'

export type ManifestMode = 'versions.json' | 'none'

/** The archive's key in versions.json is the skill's directory name. */
export const manifestKeyFor = (skill: SkillRef): string =>
  skill.rootSkill ? (skill.name ?? basename(skill.repo.path)) : basename(skill.relPath)

/**
 * R10.1: the scope may reach outside the skill directory, which is exactly why
 * revision 1's skill-scoped sandbox could not express a release. The archive is
 * in scope because R9.4 makes it an output that must be previewed, journalled
 * and removed by a rollback like any other.
 */
export function releaseScope(
  skill: SkillRef,
  hasManifest: boolean,
  archiveName: string,
): MutationScope {
  const prefix = skill.relPath === '.' ? '' : `${skill.relPath}/`
  return {
    paths: [
      `${prefix}SKILL.md`,
      `${prefix}CHANGELOG.md`,
      archiveName,
      ...(hasManifest ? ['versions.json'] : []),
    ],
  }
}

export interface StageEditsInput {
  sandbox: MutationSandbox
  skill: SkillRef
  version: string
  /** ISO date, injected so the state machine stays testable. */
  date: string
  notes?: string
  hasManifest: boolean
}

/** All three writes land inside the sandbox; nothing here can reach the live tree. */
export async function stageCandidateEdits(input: StageEditsInput): Promise<void> {
  const prefix = input.skill.relPath === '.' ? '' : `${input.skill.relPath}/`

  const skillMdPath = input.sandbox.resolve(`${prefix}SKILL.md`)
  await writeFile(
    skillMdPath,
    setFrontmatterVersion(await readFile(skillMdPath, 'utf8'), input.version),
  )

  const changelogPath = input.sandbox.resolve(`${prefix}CHANGELOG.md`)
  const existing = await readFile(changelogPath, 'utf8').catch(() => '')
  await mkdir(dirname(changelogPath), { recursive: true })
  await writeFile(
    changelogPath,
    prependChangelogEntry(existing, input.version, input.date, input.notes),
  )

  if (!input.hasManifest) return
  const manifestPath = input.sandbox.resolve('versions.json')
  await writeFile(
    manifestPath,
    setManifestVersion(
      await readFile(manifestPath, 'utf8'),
      manifestKeyFor(input.skill),
      input.version,
    ),
  )
}
```

- [ ] **Step 4: Implement the executor**

```ts
// src/core/stages/release-stage.ts
import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { candidateManifest } from '../discovery/candidate.js'
import { skillDigest } from '../discovery/digest.js'
import type { Ledger } from '../ledger/db.js'
import { latestGateOutcomes } from '../ledger/gates.js'
import { packageCandidate } from '../release/archive.js'
import { writeEvidenceBundle } from '../release/evidence.js'
import { verifyInstallable } from '../release/install-check.js'
import { readVersionsManifest } from '../release/manifest.js'
import { checkPreconditions } from '../release/preconditions.js'
import { manifestKeyFor, releaseScope, stageCandidateEdits } from '../release/release.js'
import { resolveTargetVersion } from '../release/version.js'
import { RELEASE_TOOL_ID } from '../tools/catalogue.js'
import { type Exec, defaultExec } from '../tools/exec.js'
import type { ErrorKind, ToolOutcome } from '../types.js'
import { applyFromSandbox, discardFromSandbox, prepareFromSandbox } from './mutation.js'
import type {
  PendingMutation,
  StageContext,
  StageExecutor,
  StagePlan,
  StageResult,
  ToolRunRecord,
} from './types.js'

export interface ReleaseStageOptions {
  ledger: Ledger
  exec?: Exec
  /** Injected so the changelog date is not read from the clock in a test. */
  now?: () => Date
  /** R10.10: supplied by the caller, which is the only place that scans. */
  interrupted?: boolean
}

/** Per-run state the pipeline does not carry, keyed by the run directory. */
interface Staged {
  version: string
  archiveSha256: string
  archivePath: string
  archiveName: string
  manifestMode: 'versions.json' | 'none'
  gates: ReturnType<typeof latestGateOutcomes>
  skillDigest: string
  manifestEntries: Awaited<ReturnType<typeof candidateManifest>>['entries']
}

function record(
  outcome: ToolOutcome,
  errorKind: ErrorKind | null,
  summary: string,
  version: string | null,
): ToolRunRecord {
  return {
    toolId: RELEASE_TOOL_ID,
    toolVersion: version,
    outcome,
    exitCode: null,
    durationMs: 0,
    errorKind,
    artefactDir: '',
    findings: [],
    metrics: {},
    summary,
  }
}

const single = (stage: 'release', toolRun: ToolRunRecord): StageResult => ({
  stage,
  outcome: toolRun.outcome === 'passed' ? 'passed' : toolRun.outcome === 'failed' ? 'failed' : toolRun.outcome === 'skipped' ? 'skipped' : 'errored',
  verdict: toolRun.outcome === 'failed' ? 'failed' : 'passed',
  toolRuns: [toolRun],
})

/**
 * Design §12.4. The order is inverted from revision 2, which applied first and
 * verified afterwards: a packaging or installability failure then had to undo a
 * change already live in the user's repo, and the archive — a required output —
 * was in neither the mutation scope nor the journal, so an aborted release could
 * leave a zip behind while claiming to have rolled back.
 */
export class ReleaseStageExecutor implements StageExecutor {
  readonly stage = 'release' as const
  readonly mutating = true

  readonly #staged = new Map<string, Staged>()

  constructor(private readonly options: ReleaseStageOptions) {}

  async plan(ctx: StageContext): Promise<StagePlan> {
    const version = this.#targetVersion(ctx)
    const manifest = await readVersionsManifest(ctx.skill.repo.path)
    const archiveName = `${manifestKeyFor(ctx.skill)}_${version ?? '0.0.0'}.zip`
    return {
      // Empty per design §6: release selects no tool from `stageTools`. The one
      // tool it does invoke is reported as a tool run by `execute`.
      toolIds: [],
      policy: 'native',
      mutationScope: releaseScope(ctx.skill, manifest !== null, archiveName),
    }
  }

  #targetVersion(ctx: StageContext): string | null {
    if (!ctx.releaseTarget) return null
    try {
      return resolveTargetVersion(ctx.skill.version, ctx.releaseTarget.version)
    } catch {
      return null
    }
  }

  async execute(ctx: StageContext, _plan: StagePlan): Promise<StageResult> {
    const exec = this.options.exec ?? defaultExec

    if (!ctx.authorised) {
      return single(this.stage, record('skipped', 'no-authorisation', 'release needs authorisation (--yes)', null))
    }
    const locked = ctx.lock.tools[RELEASE_TOOL_ID]
    if (!locked) {
      return single(
        this.stage,
        record('skipped', 'not-installed', `${RELEASE_TOOL_ID} is not installed: release cannot run its installability gate`, null),
      )
    }
    if (!ctx.sandbox) {
      return single(this.stage, record('errored', 'mutation-aborted', 'no sandbox was opened for the release', locked.resolvedVersion))
    }
    if (!ctx.releaseTarget) {
      return single(this.stage, record('failed', null, 'no target version supplied: release never infers one (R9.10)', locked.resolvedVersion))
    }

    // validate-preconditions
    const liveManifest = await candidateManifest(ctx.skill)
    const currentDigest = await skillDigest(liveManifest)
    const gates = latestGateOutcomes(this.options.ledger.db, ctx.skill.id)
    const repoManifest = await readVersionsManifest(ctx.skill.repo.path)
    const refusals = checkPreconditions({
      gates,
      currentDigest,
      // R1.6: the candidate's frontmatter, never the ledger.
      deprecated: ctx.skill.deprecated,
      frontmatterVersion: ctx.skill.version,
      manifestVersion: repoManifest?.versions[manifestKeyFor(ctx.skill)] ?? null,
      hasManifest: repoManifest !== null,
      interrupted: this.options.interrupted === true,
    })
    if (refusals.length > 0) {
      return single(
        this.stage,
        record('failed', null, refusals.map((r) => r.message).join('; '), locked.resolvedVersion),
      )
    }

    // resolve-target-version
    let version: string
    try {
      version = resolveTargetVersion(ctx.skill.version, ctx.releaseTarget.version)
    } catch (err) {
      return single(this.stage, record('failed', null, (err as Error).message, locked.resolvedVersion))
    }

    const stagingDir = join(ctx.runDir, 'staging')
    try {
      // stage-candidate-edits
      await stageCandidateEdits({
        sandbox: ctx.sandbox,
        skill: ctx.skill,
        version,
        date: (this.options.now?.() ?? new Date()).toISOString().slice(0, 10),
        ...(ctx.releaseTarget.notes === undefined ? {} : { notes: ctx.releaseTarget.notes }),
        hasManifest: repoManifest !== null,
      })

      // package-in-sandbox: over the *sandbox* skill directory, so the archive is
      // exactly the bytes being released rather than the bytes on disk.
      const sandboxSkill = {
        ...ctx.skill,
        dir: ctx.sandbox.resolve(ctx.skill.relPath === '.' ? '.' : ctx.skill.relPath),
        repo: { ...ctx.skill.repo, path: ctx.sandbox.workRoot },
      }
      const packaged = await packageCandidate({
        manifest: await candidateManifest(sandboxSkill),
        stagingDir,
        skillName: manifestKeyFor(ctx.skill),
        version,
      })

      // verify-install
      const check = await verifyInstallable({
        archivePath: packaged.archivePath,
        stagingDir,
        skillsBin: locked.bin,
        exec,
      })
      if (!check.ok) {
        return single(
          this.stage,
          record('failed', null, `installability gate refused: ${check.output.trim().split('\n')[0] ?? ''}`, locked.resolvedVersion),
        )
      }

      // The archive joins the change set by being placed in the sandbox at its
      // eventual repo-relative path, so it is previewed, journalled and removed
      // by a rollback exactly like every other scoped file (R9.4).
      const archiveName = `${manifestKeyFor(ctx.skill)}_${version}.zip`
      const inSandbox = ctx.sandbox.resolve(archiveName)
      await mkdir(join(inSandbox, '..'), { recursive: true })
      await copyFile(packaged.archivePath, inSandbox)

      this.#staged.set(ctx.runDir, {
        version,
        archiveSha256: packaged.sha256,
        archivePath: packaged.archivePath,
        archiveName,
        manifestMode: repoManifest === null ? 'none' : 'versions.json',
        gates,
        skillDigest: currentDigest,
        manifestEntries: liveManifest.entries,
      })

      return single(
        this.stage,
        record('passed', null, `staged ${manifestKeyFor(ctx.skill)} ${version}, archive verified installable`, locked.resolvedVersion),
      )
    } catch (err) {
      const message = (err as Error).message
      const kind: ErrorKind = /ENOENT|could not be invoked|spawn/i.test(message) ? 'spawn' : 'mutation-aborted'
      return single(this.stage, record('errored', kind, message, locked.resolvedVersion))
    }
  }

  prepareMutation = (ctx: StageContext): Promise<PendingMutation | null> => prepareFromSandbox(ctx)

  applyMutation = async (ctx: StageContext, pending: PendingMutation): Promise<void> => {
    await applyFromSandbox(ctx, pending)
    const staged = this.#staged.get(ctx.runDir)
    if (!staged) return
    // record-evidence, after the apply: R9.5's bundle describes a release that
    // happened, and writing it before the apply would leave evidence for one
    // that did not.
    await writeEvidenceBundle({
      runDir: ctx.runDir,
      gates: staged.gates,
      lock: ctx.lock,
      skillDigest: staged.skillDigest,
      manifest: { root: ctx.skill.dir, entries: staged.manifestEntries, selfContained: !ctx.skill.rootSkill },
      archiveSha256: staged.archiveSha256,
      manifestMode: staged.manifestMode,
      targetVersion: staged.version,
    })
  }

  discardMutation = (ctx: StageContext): Promise<void> => discardFromSandbox(ctx)
}
```

- [ ] **Step 5: Route the factory to it**

```ts
// src/core/pipeline/run.ts
  const makeExecutor: StageExecutorFactory =
    input.executorFactory ??
    ((stage) =>
      stage === 'release'
        ? new ReleaseStageExecutor({
            ledger: input.ledger,
            ...(input.interrupted === undefined ? {} : { interrupted: input.interrupted }),
          })
        : new AdapterStageExecutor(stage))
```

`RunPipelineInput` gains `interrupted?: boolean`, supplied by `src/cli/`, which is the only place that scans workspaces. `defaultExecutorFactory` keeps its old shape for callers that pass no ledger, and gains a comment saying why release is not reachable through it.

- [ ] **Step 6: Run the test and confirm it passes**

Run: `pnpm vitest run tests/core/release-stage.test.ts`
Expected: PASS, 11 cases.

- [ ] **Step 7: Amend design §12.4 with the classification table**

Insert the table from this task's preamble after §12.4's **Evidence** paragraph, with the sentence explaining why a refusal is `failed` and not `errored`.

- [ ] **Step 8: Verify and commit**

Run: `pnpm lint && pnpm build && pnpm test`

```bash
git add src/core/release src/core/stages/release-stage.ts src/core/pipeline/run.ts docs/specs/design.md tests/core/release-stage.test.ts
git commit -m "feat: add the release stage and its state machine

Everything is built and proven inside the sandbox and the user's tree is touched
once, at the end (R9.6a). The archive joins the change set by being placed in
the sandbox at its eventual repo-relative path, so it is previewed, journalled
and removed by a rollback like any other scoped file — revision 2 left it in
neither the scope nor the journal, so an aborted release could leave a zip
behind while claiming to have rolled back. A precondition refusal is failed with
no error kind: the gate ran and understood the skill, which is the distinction
§8.1's governing rule already draws."
```

---

### Task 12: `skillgantry release` and the headless diff-before-write

**Files:**
- Create: `src/cli/release-command.ts`
- Modify: `src/cli/run-command.ts`
- Test: `tests/cli/release-command.test.ts`

**Interfaces:**
- Produces: `runRelease(deps: CliDeps, selector: string, opts: ReleaseOptions): Promise<number>` returning the exit code; `ReleaseOptions { version: string; yes?: boolean; json?: boolean; allowDirty?: boolean; notes?: string }`.

R12.4 and design §11.5: `--yes` is prior authorisation, and the diff is still computed and emitted to stdout immediately before the write, so the ordering R5.2 requires holds and the diff is always on record.

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/release-command.test.ts
import { describe, expect, it } from 'vitest'
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram } from '../../src/cli/run-command.js'
import { DEFAULT_CONFIG, registerRepo, saveConfig, saveToolLock } from '../../src/core/config/config.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { recordRun } from '../../src/core/ledger/record.js'
import { candidateManifest } from '../../src/core/discovery/candidate.js'
import { skillDigest } from '../../src/core/discovery/digest.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import type { Stage } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeGitRepo } from '../helpers/tmp-repo.js'

async function harness() {
  const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
  const repo = await makeGitRepo({
    files: {
      'sk/SKILL.md': SKILL_MD_FULL('sk'),
      'versions.json': '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n',
    },
  })
  await saveConfig(home, DEFAULT_CONFIG)
  const config = await registerRepo(home, repo)

  const skillsDir = await mkdtemp(join(tmpdir(), 'sg-skills-'))
  const bin = join(skillsDir, 'skills')
  await writeFile(bin, '#!/bin/sh\necho "Installed 1 skill"\nexit 0\n')
  await chmod(bin, 0o755)
  await saveToolLock(home, {
    version: 1,
    tools: {
      skills: {
        installKind: 'npm-prefix',
        requestedPin: '1.5.21',
        resolvedVersion: '1.5.21',
        bin,
        integrity: 'n/a',
        installedAt: 'now',
        verifiedAt: 'now',
      },
    },
  })

  const dbPath = join(home, 'gantry.db')
  const [skill] = await discoverSkills(config.repos[0]!)
  const ledger = openLedger(dbPath)
  recordRun(ledger, {
    skill: skill!,
    runId: '019000000000-a',
    trigger: 'test',
    startedAt: 'now',
    endedAt: 'now',
    outcome: 'passed',
    skillDigest: await skillDigest(await candidateManifest(skill!)),
    git: { commit: null, dirty: false },
    provenanceJson: '{}',
    toolLockJson: '{}',
    sidecarPath: join(skill!.workspacePath, 'skillgantry', 'runs', '019000000000-a'),
    stages: (['validate', 'evaluate', 'security'] as Stage[]).map((stage) => ({
      stage,
      outcome: 'passed' as const,
      verdict: 'passed' as const,
      toolRuns: [],
    })),
  })
  ledger.close()

  const out: string[] = []
  return { home, repo, out, program: buildProgram({ home, dbPath, write: (l) => out.push(l) }) }
}

describe('skillgantry release', () => {
  it('emits the diff immediately before the write, and writes', async () => {
    const { repo, out, program } = await harness()
    await program.parseAsync(['node', 'sg', 'release', 'sk', '--version', 'minor', '--yes'])

    const text = out.join('\n')
    const diffAt = text.indexOf('+++ ')
    const appliedAt = text.indexOf('released')
    // R5.2's ordering holds in headless mode too: `--yes` is prior
    // authorisation, not permission to skip the diff.
    expect(diffAt).toBeGreaterThanOrEqual(0)
    expect(diffAt).toBeLessThan(appliedAt)
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('1.1.0')
    expect((await stat(join(repo, 'sk_1.1.0.zip'))).size).toBeGreaterThan(0)
    expect(program.exitCode).toBe(0)
  })

  it('skips and exits non-zero without --yes, writing nothing', async () => {
    const { repo, out, program } = await harness()
    await program.parseAsync(['node', 'sg', 'release', 'sk', '--version', 'minor'])
    expect(out.join('\n')).toContain('no-authorisation')
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('1.0.0')
    await expect(stat(join(repo, 'sk_1.1.0.zip'))).rejects.toThrow()
    expect(program.exitCode).toBe(1)
  })

  it('reports every refusal and exits non-zero when a gate has not passed', async () => {
    const { repo, out, program } = await harness()
    await writeFile(join(repo, 'sk/SKILL.md'), SKILL_MD_FULL('sk', '1.0.0', 'edited after the gates'))
    await program.parseAsync(['node', 'sg', 'release', 'sk', '--version', 'minor', '--yes', '--allow-dirty'])
    expect(out.join('\n')).toContain('R9.9')
    expect(program.exitCode).toBe(1)
  })

  it('refuses without --version rather than inferring one', async () => {
    const { program } = await harness()
    await expect(
      program.parseAsync(['node', 'sg', 'release', 'sk', '--yes']),
    ).rejects.toThrow(/version/)
  })

  it('emits newline-delimited JSON under --json', async () => {
    const { out, program } = await harness()
    await program.parseAsync(['node', 'sg', 'release', 'sk', '--version', 'patch', '--yes', '--json'])
    const types = out.map((line) => (JSON.parse(line) as { type: string }).type)
    expect(types).toContain('mutation:pending')
    expect(types).toContain('run:done')
  })
})
```

- [ ] **Step 2: Implement the command**

```ts
// src/cli/release-command.ts
import { loadToolLock, loadConfig } from '../core/config/config.js'
import { loadEnvFile, provenanceOf } from '../core/config/env.js'
import { openLedger, runPipeline, syncLifecycle } from '../core/index.js'
import { detectInterrupted } from './recover-command.js'
import { resolveSkill, type CliDeps } from './run-command.js'

export interface ReleaseOptions {
  version: string
  yes?: boolean
  json?: boolean
  allowDirty?: boolean
  notes?: string
}

/**
 * R12.5b. One stage through the same pipeline the TUI drives, which is what
 * keeps R12.1's "same artefacts" true rather than aspirational.
 */
export async function runRelease(
  deps: CliDeps,
  selector: string,
  opts: ReleaseOptions,
): Promise<number> {
  const config = await loadConfig(deps.home)
  const skill = await resolveSkill(config, selector)
  const lock = await loadToolLock(deps.home)
  const env = await loadEnvFile(deps.home)
  for (const warning of env.warnings) deps.write(`warning: ${warning}`)

  const interrupted = (await detectInterrupted(deps.home)).some(
    (item) => item.skillId === skill.id,
  )

  const ledger = openLedger(deps.dbPath)
  try {
    syncLifecycle(ledger.db, [skill])

    const handle = runPipeline({
      skill,
      stages: ['release'],
      trigger: 'cli-release',
      stageTools: config.stageTools,
      lock,
      ledger,
      env: { ...process.env, ...env.vars },
      secrets: env.secrets,
      provenance: provenanceOf(env.vars),
      artefactSizeCapBytes: config.artefactSizeCapBytes,
      timeoutOverridesMs: config.timeoutOverridesMs,
      mutationTimeoutMs: config.mutationTimeoutMs,
      // R12.4: `--yes` is prior authorisation. Without it the stage is skipped
      // by the engine, so the skip lands in the ledger like any other.
      authorised: opts.yes === true,
      releaseTarget: {
        version: opts.version,
        ...(opts.notes === undefined ? {} : { notes: opts.notes }),
      },
      ...(opts.allowDirty === undefined ? {} : { allowDirty: opts.allowDirty }),
      interrupted,
    })

    for await (const event of handle.events) {
      if (opts.json) {
        deps.write(JSON.stringify(event))
      } else if (event.type === 'mutation:pending') {
        // Design §11.5: the diff is emitted immediately before the write, so
        // the R5.2 ordering holds and the diff is always on record.
        deps.write(`changes to ${event.scope.length} path(s):`)
        deps.write(event.diff)
      } else if (event.type === 'stage:done') {
        const toolRun = event.result.toolRuns[0]
        deps.write(
          `release  ${event.outcome}${toolRun?.errorKind ? ` (${toolRun.errorKind})` : ''}` +
            `${toolRun?.summary ? `  ${toolRun.summary}` : ''}`,
        )
      }
      // A headless release is prior-authorised, so the prompt is answered as it
      // arrives rather than waiting out the mutation timeout.
      if (event.type === 'mutation:pending') handle.resolveMutation(event.requestId, 'apply')
    }

    const summary = await handle.done
    if (!opts.json && summary.outcome === 'passed') {
      deps.write(`released ${skill.id} — run ${summary.runId}`)
    }
    return summary.outcome === 'passed' ? 0 : 1
  } finally {
    ledger.close()
  }
}
```

- [ ] **Step 3: Register the subcommand**

```ts
// src/cli/run-command.ts — inside buildProgram
  program
    .command('release')
    .argument('<skill>', 'skill id or bare name')
    .requiredOption('--version <target>', 'a semver, or major / minor / patch')
    .option('--yes', 'prior authorisation for the write')
    .option('--json', 'emit newline-delimited JSON events')
    .option('--allow-dirty', 'proceed against a skill with uncommitted changes')
    .option('--notes <text>', 'changelog body for the new entry')
    .action(async (selector: string, opts: ReleaseOptions) => {
      await noticeInterrupted(deps)
      program.exitCode = await runRelease(deps, selector, opts)
    })
```

- [ ] **Step 4: Run and commit**

Run: `pnpm lint && pnpm build && pnpm vitest run tests/cli/release-command.test.ts`
Expected: PASS, 5 cases.

```bash
git add src/cli tests/cli/release-command.test.ts
git commit -m "feat: add skillgantry release

One stage through the same pipeline the TUI drives, so R12.1's same-artefacts
claim stays true rather than aspirational. --yes is prior authorisation and not
permission to skip the diff: the change set is still computed and printed
immediately before the write, which is the R5.2 ordering design §11.5 spells
out for headless mode."
```

---

### Task 13: Retirement, through the ordinary mutation path

**Files:**
- Create: `src/core/release/retire.ts`
- Create: `src/cli/retire-command.ts`
- Modify: `src/cli/run-command.ts`
- Modify: `src/core/index.ts`
- Test: `tests/core/retire.test.ts`
- Test: `tests/cli/retire-command.test.ts`

**Interfaces:**
- Produces:
  - `retireSkill(input: RetireInput): Promise<RetireResult>` with
    ```ts
    interface RetireInput {
      skill: SkillRef
      deprecated: boolean
      supersededBy?: string
      /** Answers the diff. Headless passes `() => opts.yes === true`. */
      confirm: (change: ChangeSet) => Promise<boolean>
      allowDirty?: boolean
      exec?: Exec
    }
    interface RetireResult { applied: boolean; recordDir: string; scope: string[]; diff: string }
    ```
  - `runRetire(deps, selector, opts): Promise<number>`

Retirement is not one of the five stages, so it does not run through the pipeline — but R1.4's write is a mutation, and design §13 holds it to the same declared scope, diff preview, confirmation and journal. Its sandbox lives under `<workspacePath>/skillgantry/retire/<id>/` precisely so Task 6's recovery scan finds an interrupted retirement with no second code path.

- [ ] **Step 1: Write the failing core test**

```ts
// tests/core/retire.test.ts
import { describe, expect, it } from 'vitest'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { retireSkill } from '../../src/core/release/retire.js'
import { scanSandboxRecords } from '../../src/core/isolation/record.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { parseFrontmatter } from '../../src/core/discovery/frontmatter.js'
import type { SkillRef } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeGitRepo, makeRepo } from '../helpers/tmp-repo.js'

async function scene(git = true): Promise<SkillRef> {
  const make = git ? makeGitRepo : makeRepo
  const repo = await make({ files: { 'sk/SKILL.md': SKILL_MD_FULL('sk') } })
  const [skill] = await discoverSkills({ id: 'repo', path: repo, name: 'repo', isGit: git })
  return skill as SkillRef
}

const front = async (skill: SkillRef) =>
  parseFrontmatter(await readFile(join(skill.dir, 'SKILL.md'), 'utf8'))

describe('retireSkill', () => {
  it('previews the diff, then writes the deprecation on confirmation', async () => {
    const skill = await scene()
    let seen = ''
    const result = await retireSkill({
      skill,
      deprecated: true,
      supersededBy: 'repo/other',
      confirm: async (change) => {
        seen = change.unifiedDiff
        // R5.2: the diff exists before anything is written, in every mode.
        expect((await front(skill)).deprecated).toBe(false)
        return true
      },
    })
    expect(result.applied).toBe(true)
    expect(seen).toContain('deprecated: true')
    expect((await front(skill)).deprecated).toBe(true)
    expect(await readFile(join(skill.dir, 'SKILL.md'), 'utf8')).toContain('superseded_by: repo/other')
    // The version is untouched: retirement is metadata, not a release.
    expect((await front(skill)).version).toBe('1.0.0')
  })

  it('writes nothing when the confirmation is declined', async () => {
    const skill = await scene()
    const result = await retireSkill({ skill, deprecated: true, confirm: async () => false })
    expect(result.applied).toBe(false)
    expect((await front(skill)).deprecated).toBe(false)
  })

  it('reverses by the same route', async () => {
    const skill = await scene()
    await retireSkill({ skill, deprecated: true, supersededBy: 'repo/other', confirm: async () => true })
    await retireSkill({ skill, deprecated: false, confirm: async () => true })
    expect((await front(skill)).deprecated).toBe(false)
    expect(await readFile(join(skill.dir, 'SKILL.md'), 'utf8')).not.toContain('superseded_by')
  })

  it('reports no change when the skill is already in the requested state', async () => {
    const skill = await scene()
    const result = await retireSkill({ skill, deprecated: false, confirm: async () => true })
    expect(result.applied).toBe(false)
    expect(result.scope).toEqual([])
  })

  it('works on a repo with no git, through the snapshot strategy', async () => {
    const skill = await scene(false)
    await retireSkill({ skill, deprecated: true, confirm: async () => true })
    expect((await front(skill)).deprecated).toBe(true)
  })

  it('leaves its record under retire/, where the recovery scan looks', async () => {
    const skill = await scene()
    const result = await retireSkill({ skill, deprecated: true, confirm: async () => true })
    expect(result.recordDir).toContain(join('skillgantry', 'retire'))
    await expect(stat(join(result.recordDir, 'journal.json'))).resolves.toBeTruthy()
    // Settled, so startup does not report a completed retirement as interrupted.
    expect(await scanSandboxRecords(skill.workspacePath)).toEqual([])
  })
})
```

- [ ] **Step 2: Implement it**

```ts
// src/core/release/retire.ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { v7 as uuidv7 } from 'uuid'
import { openSandbox } from '../isolation/open.js'
import type { ChangeSet } from '../isolation/types.js'
import type { Exec } from '../tools/exec.js'
import type { SkillRef } from '../types.js'
import { setDeprecated } from './frontmatter-edit.js'

export interface RetireInput {
  skill: SkillRef
  deprecated: boolean
  supersededBy?: string
  /** Answers the diff. R5.2 holds here as it does for a mutating stage. */
  confirm: (change: ChangeSet) => Promise<boolean>
  allowDirty?: boolean
  exec?: Exec
}

export interface RetireResult {
  applied: boolean
  recordDir: string
  scope: string[]
  diff: string
}

/**
 * R1.4 and design §13. Not a stage — `Stage` is a closed union of five and
 * retirement is metadata-only — but the write is a mutation, so it takes the
 * same declared scope, preview, confirmation and journal.
 *
 * The record lives under `retire/<id>/` rather than a run directory so Task 6's
 * scan finds an interrupted retirement with no special case.
 */
export async function retireSkill(input: RetireInput): Promise<RetireResult> {
  const relPath = input.skill.relPath === '.' ? 'SKILL.md' : `${input.skill.relPath}/SKILL.md`
  const recordDir = join(input.skill.workspacePath, 'skillgantry', 'retire', uuidv7())
  await mkdir(recordDir, { recursive: true })

  const sandbox = await openSandbox({
    skill: input.skill,
    stage: 'retire',
    runId: recordDir.split('/').at(-1) as string,
    recordDir,
    scope: [relPath],
    ...(input.allowDirty === undefined ? {} : { allowDirty: input.allowDirty }),
    ...(input.exec === undefined ? {} : { exec: input.exec }),
  })

  try {
    const path = sandbox.resolve(relPath)
    const source = await readFile(path, 'utf8')
    const edited = setDeprecated(
      source,
      input.deprecated,
      ...(input.supersededBy === undefined ? [] : [input.supersededBy]),
    )
    if (edited !== source) await writeFile(path, edited)

    const change = await sandbox.changeSet()
    if (change.entries.length === 0) {
      await sandbox.discard()
      return { applied: false, recordDir, scope: [], diff: '' }
    }

    const scope = change.entries.map((entry) => entry.path)
    if (!(await input.confirm(change))) {
      await sandbox.discard()
      return { applied: false, recordDir, scope, diff: change.unifiedDiff }
    }

    await sandbox.apply(change)
    return { applied: true, recordDir, scope, diff: change.unifiedDiff }
  } finally {
    await sandbox.dispose()
  }
}
```

`setDeprecated`'s third parameter is optional, so the spread above needs `exactOptionalPropertyTypes`-safe handling; if the spread form does not type-check, branch on `input.supersededBy === undefined` and call the two-argument form.

- [ ] **Step 3: Run the core test**

Run: `pnpm vitest run tests/core/retire.test.ts`
Expected: PASS, 6 cases.

- [ ] **Step 4: Write the failing CLI test**

```ts
// tests/cli/retire-command.test.ts
import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram } from '../../src/cli/run-command.js'
import { DEFAULT_CONFIG, registerRepo, saveConfig } from '../../src/core/config/config.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { readLifecycleCache } from '../../src/core/ledger/lifecycle.js'
import { recordRun } from '../../src/core/ledger/record.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { SKILL_MD_FULL, makeGitRepo } from '../helpers/tmp-repo.js'

async function harness() {
  const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
  const repo = await makeGitRepo({ files: { 'sk/SKILL.md': SKILL_MD_FULL('sk') } })
  await saveConfig(home, DEFAULT_CONFIG)
  const config = await registerRepo(home, repo)
  const dbPath = join(home, 'gantry.db')
  const [skill] = await discoverSkills(config.repos[0]!)
  const ledger = openLedger(dbPath)
  recordRun(ledger, {
    skill: skill!,
    runId: '019000000000-a',
    trigger: 'test',
    startedAt: 'now',
    endedAt: 'now',
    outcome: 'passed',
    skillDigest: 'sha256:x',
    git: { commit: null, dirty: false },
    provenanceJson: '{}',
    toolLockJson: '{}',
    sidecarPath: '/s',
    stages: [{ stage: 'validate', outcome: 'passed', verdict: 'passed', toolRuns: [] }],
  })
  ledger.close()
  const out: string[] = []
  return { home, repo, dbPath, out, program: buildProgram({ home, dbPath, write: (l) => out.push(l) }) }
}

describe('skillgantry retire', () => {
  it('prints the diff before the write and mirrors the ledger cache', async () => {
    const { repo, dbPath, out, program } = await harness()
    await program.parseAsync(['node', 'sg', 'retire', 'sk', '--superseded-by', 'repo/other', '--yes'])
    const text = out.join('\n')
    expect(text.indexOf('deprecated: true')).toBeLessThan(text.indexOf('retired'))
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('deprecated: true')

    const ledger = openLedger(dbPath)
    // §13: the file is the authority and the cache follows on the next scan.
    expect(readLifecycleCache(ledger.db).get('repo/sk')).toBe('deprecated')
    ledger.close()
    expect(program.exitCode).toBe(0)
  })

  it('writes nothing and exits non-zero without --yes', async () => {
    const { repo, out, program } = await harness()
    await program.parseAsync(['node', 'sg', 'retire', 'sk'])
    expect(out.join('\n')).toContain('needs --yes')
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).not.toContain('deprecated')
    expect(program.exitCode).toBe(1)
  })

  it('reverses with --undo', async () => {
    const { repo, program } = await harness()
    await program.parseAsync(['node', 'sg', 'retire', 'sk', '--yes'])
    await program.parseAsync(['node', 'sg', 'retire', 'sk', '--undo', '--yes'])
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).not.toContain('deprecated: true')
  })

  it('leaves the gates runnable against a deprecated skill', async () => {
    const { repo, program, out } = await harness()
    await program.parseAsync(['node', 'sg', 'retire', 'sk', '--yes'])
    out.length = 0
    // R1.4: gates still run; only release refuses.
    await program.parseAsync(['node', 'sg', 'run', 'sk', '--stage', 'validate'])
    expect(out.join('\n')).not.toContain('deprecated')
  })
})
```

- [ ] **Step 5: Implement the command**

```ts
// src/cli/retire-command.ts
import {
  discoverSkills,
  loadConfig,
  openLedger,
  retireSkill,
  syncLifecycle,
} from '../core/index.js'
import { resolveSkill, type CliDeps } from './run-command.js'

export interface RetireOptions {
  undo?: boolean
  supersededBy?: string
  yes?: boolean
  json?: boolean
  allowDirty?: boolean
}

export async function runRetire(
  deps: CliDeps,
  selector: string,
  opts: RetireOptions,
): Promise<number> {
  const config = await loadConfig(deps.home)
  const skill = await resolveSkill(config, selector)

  const result = await retireSkill({
    skill,
    deprecated: opts.undo !== true,
    ...(opts.supersededBy === undefined ? {} : { supersededBy: opts.supersededBy }),
    ...(opts.allowDirty === undefined ? {} : { allowDirty: opts.allowDirty }),
    // R5.2: the diff is emitted before the write in every mode, and `--yes` is
    // prior authorisation rather than permission to skip it.
    confirm: async (change) => {
      if (opts.json) {
        deps.write(JSON.stringify({ type: 'mutation:pending', scope: change.entries.map((e) => e.path), diff: change.unifiedDiff }))
      } else {
        deps.write(change.unifiedDiff)
      }
      if (opts.yes === true) return true
      deps.write('retirement needs --yes')
      return false
    },
  })

  if (!result.applied) return 1

  // §13: the file is the authority; the cache follows. Reconciling here means a
  // user who never runs another gate still sees the right state in the ledger.
  const ledger = openLedger(deps.dbPath)
  try {
    const skills = []
    for (const repo of config.repos) skills.push(...(await discoverSkills(repo)))
    syncLifecycle(ledger.db, skills)
  } finally {
    ledger.close()
  }

  deps.write(opts.undo === true ? `reinstated ${skill.id}` : `retired ${skill.id}`)
  return 0
}
```

- [ ] **Step 6: Register the subcommand**

```ts
// src/cli/run-command.ts — inside buildProgram
  program
    .command('retire')
    .argument('<skill>', 'skill id or bare name')
    .option('--undo', 'clear the deprecation instead of setting it')
    .option('--superseded-by <id>', 'the skill that replaces this one')
    .option('--yes', 'prior authorisation for the write')
    .option('--json', 'emit the pending mutation as JSON')
    .option('--allow-dirty', 'proceed against a skill with uncommitted changes')
    .action(async (selector: string, opts: RetireOptions) => {
      await noticeInterrupted(deps)
      program.exitCode = await runRetire(deps, selector, opts)
    })
```

- [ ] **Step 7: Run and commit**

Run: `pnpm lint && pnpm build && pnpm vitest run tests/core/retire.test.ts tests/cli/retire-command.test.ts`

```bash
git add src/core/release/retire.ts src/cli tests/core/retire.test.ts tests/cli/retire-command.test.ts
git commit -m "feat: add retirement through the ordinary mutation path

R1.4's write is metadata but it is still a mutation, so it takes the same
declared scope, diff preview, confirmation and journal a stage does. Its record
lives under retire/<id>/ rather than a run directory so the startup recovery
scan finds an interrupted retirement with no special case. The frontmatter is
the authority and the ledger cache is reconciled after the write, so a user who
never runs another gate still sees the right state."
```

---

### Task 14: The review pane, and resolving a mutation from the queue

**Files:**
- Modify: `src/core/queue/types.ts`
- Modify: `src/core/queue/pool.ts`
- Modify: `src/tui/store.ts`
- Modify: `src/tui/app.tsx`
- Modify: `src/tui/components/Work.tsx`
- Create: `src/tui/components/ReviewPane.tsx`
- Modify: `src/cli/tui-command.ts`
- Test: `tests/tui/review-pane.test.tsx`

**Interfaces:**
- Produces:
  - `QueueHandle.resolveMutation(jobId: string, requestId: string, action: 'apply' | 'discard'): void`
  - `AppState.pending: PendingReview | null` where `PendingReview { jobId: string; runId: string; stage: Stage; requestId: string; diff: string; scope: readonly string[]; offset: number }`
  - Actions `{ type: 'scroll-review'; delta: number }`; `mutation:pending` and `mutation:resolved` handled by the existing `queue-event` action.
  - `ReviewPane({ pending, layout }): React.ReactElement`

plan-m2 recorded this as a known gap: "the gate has no diff renderer, because no stage produces one until M5". This is that renderer. The diff is a bounded one-shot document, so it lives in React state — R11.4 is about a stream that never stops, which is a different problem.

- [ ] **Step 1: Add `resolveMutation` to the queue**

```ts
// src/core/queue/types.ts — inside QueueHandle
  /**
   * R5.12's command path, routed by job rather than by run: a frontend knows
   * which job it is looking at, and the run id only appears on the event stream.
   */
  resolveMutation(jobId: string, requestId: string, action: 'apply' | 'discard'): void
```

```ts
// src/core/queue/pool.ts — inside the returned object
    resolveMutation(jobId, requestId, action) {
      running.get(jobId)?.handle.resolveMutation(requestId, action)
    },
```

- [ ] **Step 2: Write the failing store and pane test**

```tsx
// tests/tui/review-pane.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { App } from '../../src/tui/app.js'
import { reducer, initialState } from '../../src/tui/store.js'
import { renderInk } from '../helpers/render-ink.js'
import { fakeQueue } from '../helpers/fake-run.js'
import type { QueueEvent, SkillRef } from '../../src/core/index.js'

const skill = (id: string): SkillRef => ({
  id,
  name: id,
  version: '1.0.0',
  dir: `/repo/${id}`,
  relPath: id,
  repo: { id: 'repo', path: '/repo', name: 'repo', isGit: true },
  rootSkill: false,
  workspacePath: `/repo/${id}-workspace`,
  deprecated: false,
  supersededBy: null,
})

const DIFF = [
  'diff --git a/sk/SKILL.md b/sk/SKILL.md',
  '--- a/sk/SKILL.md',
  '+++ b/sk/SKILL.md',
  '@@ -1,3 +1,3 @@',
  '-  version: 1.0.0',
  '+  version: 1.1.0',
].join('\n')

const pendingEvent = (jobId: string): QueueEvent => ({
  type: 'run:event',
  jobId,
  event: {
    type: 'mutation:pending',
    runId: 'run-1',
    stage: 'release',
    requestId: 'req-1',
    diff: DIFF,
    scope: ['sk/SKILL.md', 'sk_1.1.0.zip'],
  },
})

describe('the review store', () => {
  it('holds a pending mutation and clears it on resolution', () => {
    let state = initialState([skill('sk')], 2)
    state = reducer(state, {
      type: 'queue-event',
      event: { type: 'run:event', jobId: 'j1', event: { type: 'run:start', runId: 'run-1', skillId: 'sk', stages: ['release'], runDir: '/d' } },
    })
    state = reducer(state, { type: 'queue-event', event: pendingEvent('j1') })
    expect(state.pending).toMatchObject({ jobId: 'j1', requestId: 'req-1', stage: 'release' })

    state = reducer(state, {
      type: 'queue-event',
      event: {
        type: 'run:event',
        jobId: 'j1',
        event: { type: 'mutation:resolved', runId: 'run-1', stage: 'release', requestId: 'req-1', action: 'apply' },
      },
    })
    expect(state.pending).toBeNull()
  })

  it('scrolls the diff without leaving it', () => {
    let state = initialState([skill('sk')], 2)
    state = reducer(state, { type: 'queue-event', event: pendingEvent('j1') })
    state = reducer(state, { type: 'scroll-review', delta: 3 })
    expect(state.pending?.offset).toBe(3)
    state = reducer(state, { type: 'scroll-review', delta: -99 })
    expect(state.pending?.offset).toBe(0)
  })
})

describe('the review pane', () => {
  it('replaces the screen, shows the scope and the diff, and offers a and d', async () => {
    const queue = fakeQueue()
    const { frames, unmount } = renderInk(<App skills={[skill('sk')]} queue={queue} stages={['release']} concurrency={2} intervalMs={5} />)
    queue.emit(pendingEvent('j1'))
    await new Promise((r) => setTimeout(r, 30))
    const frame = frames.at(-1) as string
    expect(frame).toContain('sk/SKILL.md')
    expect(frame).toContain('version: 1.1.0')
    expect(frame).toContain('a apply')
    expect(frame).toContain('d discard')
    unmount()
  })

  it('routes a on the keyboard to queue.resolveMutation', async () => {
    const queue = fakeQueue()
    const resolve = vi.spyOn(queue, 'resolveMutation')
    const { stdin, unmount } = renderInk(<App skills={[skill('sk')]} queue={queue} stages={['release']} concurrency={2} intervalMs={5} />)
    queue.emit(pendingEvent('j1'))
    await new Promise((r) => setTimeout(r, 30))
    stdin.write('a')
    await new Promise((r) => setTimeout(r, 30))
    expect(resolve).toHaveBeenCalledWith('j1', 'req-1', 'apply')
    unmount()
  })

  it('swallows movement while the review is open, like help', async () => {
    const queue = fakeQueue()
    const { stdin, frames, unmount } = renderInk(<App skills={[skill('sk'), skill('other')]} queue={queue} stages={['release']} concurrency={2} intervalMs={5} />)
    queue.emit(pendingEvent('j1'))
    await new Promise((r) => setTimeout(r, 30))
    stdin.write('j')
    await new Promise((r) => setTimeout(r, 30))
    // The selection must not move under a screen the user cannot see.
    expect(frames.at(-1)).toContain('sk/SKILL.md')
    unmount()
  })

  it('fits its row budget at 80x24 and 50x14, reporting what it cut', async () => {
    const queue = fakeQueue()
    for (const [columns, rows] of [[80, 24], [50, 14]] as const) {
      const { frames, unmount } = renderInk(
        <App skills={[skill('sk')]} queue={queue} stages={['release']} concurrency={2} intervalMs={5} />,
        { columns, rows },
      )
      queue.emit({ ...pendingEvent('j1'), event: { ...(pendingEvent('j1') as { event: { type: string } }).event, diff: Array.from({ length: 200 }, (_, i) => `+line ${i}`).join('\n') } } as QueueEvent)
      await new Promise((r) => setTimeout(r, 30))
      const frame = frames.at(-1) as string
      expect(frame.split('\n').length).toBeLessThanOrEqual(rows)
      expect(frame).toContain('more')
      unmount()
    }
  })
})
```

`fakeQueue` is new in `tests/helpers/fake-run.ts`: a `QueueHandle` whose `events` is an `AsyncEventQueue` an `emit` helper pushes into, with `resolveMutation` and `cancelJob` as spies. If `fake-run.ts` already exports something close, extend it rather than adding a second fake.

- [ ] **Step 3: Extend the store**

```ts
// src/tui/store.ts — additions
export interface PendingReview {
  jobId: string
  runId: string
  stage: Stage
  requestId: string
  diff: string
  scope: readonly string[]
  /** First visible diff line, moved by `scroll-review`. */
  offset: number
}

// AppState gains:
  /**
   * The diff awaiting an answer. It lives in state, unlike log text: a change
   * set is one bounded document, and R11.4 is about a stream that never stops.
   */
  pending: PendingReview | null
```

`initialState` gains `pending: null`; `Action` gains `{ type: 'scroll-review'; delta: number }`; `onQueueEvent` gains the `jobId` so `mutation:pending` can record it, and `onRunEvent` gains:

```ts
    case 'mutation:pending':
      return {
        ...state,
        pending: {
          jobId,
          runId: event.runId,
          stage: event.stage,
          requestId: event.requestId,
          diff: event.diff,
          scope: event.scope,
          offset: 0,
        },
      }
    case 'mutation:resolved':
      return state.pending?.requestId === event.requestId ? { ...state, pending: null } : state
```

with the reducer case:

```ts
    case 'scroll-review':
      return state.pending
        ? { ...state, pending: { ...state.pending, offset: Math.max(0, state.pending.offset + action.delta) } }
        : state
```

`run:cancelled`, `run:error` and `run:done` also clear `pending`, because a prompt whose run has ended can never be answered.

- [ ] **Step 4: Write the pane**

```tsx
// src/tui/components/ReviewPane.tsx
import { Box, Text } from 'ink'
import { innerWidth, truncate, windowFor, type Layout } from '../layout.js'
import type { PendingReview } from '../store.js'
import { Panel } from './Panel.js'

/** Rows the frame spends before its first diff line: chrome, scope, footer. */
const CHROME_ROWS = { boxed: 6, bare: 4 } as const

const colour = (line: string): string | undefined =>
  line.startsWith('+') ? 'green' : line.startsWith('-') ? 'red' : line.startsWith('@@') ? 'cyan' : undefined

/**
 * R5.2 in the terminal: authorisation is confirmation of a displayed diff. Sized
 * from the layout like every other pane, and the overflow footnote is counted
 * *against* the allocation rather than appended below it — design §14.1's first
 * rule, learned from the row that pushed the queue panel off an 80x24.
 */
export function ReviewPane({
  pending,
  layout,
}: {
  pending: PendingReview
  layout: Layout
}): React.ReactElement {
  const cols = Math.max(8, innerWidth(layout.columns, layout.chrome))
  const lines = pending.diff.split('\n')
  const budget = Math.max(1, layout.rows - CHROME_ROWS[layout.chrome])
  const { start, end } = windowFor(lines.length, pending.offset, budget - 1)
  const shown = lines.slice(start, end)
  const hidden = lines.length - shown.length

  return (
    <Panel title={`Review — ${pending.stage} writes ${pending.scope.length} path(s)`} focused chrome={layout.chrome}>
      <Text wrap="truncate" dimColor>
        {truncate(pending.scope.join('  '), cols)}
      </Text>
      {shown.map((line, index) => (
        <Text key={`${start + index}`} wrap="truncate" {...(colour(line) ? { color: colour(line) } : {})}>
          {truncate(line, cols)}
        </Text>
      ))}
      <Box>
        <Text wrap="truncate">
          {truncate(
            `a apply · d discard · j/k scroll${hidden > 0 ? ` · ${hidden} more line(s)` : ''}`,
            cols,
          )}
        </Text>
      </Box>
    </Panel>
  )
}
```

- [ ] **Step 5: Make it modal in `app.tsx`**

`Work` renders `<ReviewPane>` in place of the whole screen when `state.pending` is set, the same way `Help` does. The keymap gains, immediately after the `q` and `?` handlers and **before** the help branch:

```ts
    // Modal like help: swallowing movement keeps the selection where the user
    // left it rather than scrolling a screen they cannot see.
    if (state.pending) {
      const { jobId, requestId } = state.pending
      if (input === 'a') queue.resolveMutation(jobId, requestId, 'apply')
      else if (input === 'd' || key.escape) queue.resolveMutation(jobId, requestId, 'discard')
      else if (input === 'j' || key.downArrow) dispatch({ type: 'scroll-review', delta: 1 })
      else if (input === 'k' || key.upArrow) dispatch({ type: 'scroll-review', delta: -1 })
      return
    }
```

`Help`'s binding list gains the three new keys, and the footer hint bar swaps to `a apply · d discard` while a review is open — the footer carries five keys, and two of them are only meaningful here.

- [ ] **Step 6: Pass authorisation from the TUI wiring**

```ts
// src/cli/tui-command.ts — inside startRun
        // R5.2: in the terminal interface authorisation *is* the interactive
        // confirmation the gate performs, so the run is always authorised and
        // the gate is what asks.
        authorised: true,
```

and `syncLifecycle(ledger.db, skills)` after discovery, from Task 10.

- [ ] **Step 7: Run and commit**

Run: `pnpm lint && pnpm build && pnpm vitest run tests/tui tests/core/queue.test.ts`
Expected: PASS. `tests/tui/store.test.ts` needs `pending: null` in its expected initial state, and every hand-built `SkillRef` in `tests/tui/` needs Task 10's two fields.

```bash
git add src/core/queue src/tui src/cli/tui-command.ts tests/tui/review-pane.test.tsx tests/helpers/fake-run.ts
git commit -m "feat: add the mutation review pane and route resolution through the queue

plan-m2 shipped the gate and recorded the missing renderer as a known gap,
because no stage produced a diff until now. The diff lives in React state:
R11.4 is about a stream that never stops, and a change set is one bounded
document. resolveMutation is routed by job id, because a frontend knows which
job it is looking at and the run id only appears on the event stream."
```

---

### Task 15: The M5 acceptance suite

**Files:**
- Create: `tests/acceptance/m5.test.ts`
- Modify: `docs/specs/design.md` (§16 rows from Task 1, confirmed against what shipped)
- Modify: `docs/specs/index.md` (status)

One named test per clause of the M5 exit criterion, driven through the CLI so the assertions are about the product rather than a module:

> Both sandbox strategies pass apply, rollback and crash-recovery tests over all five change kinds, plus a crash during the mutating tool and one while awaiting approval; the dirty-skill guard holds and its override seeds correctly; preimage drift aborts; digest mismatch blocks release; the no-manifest path releases correctly; a packaging or installability failure leaves no repo-root archive and no live file change

- [ ] **Step 1: Write the suite, one `it` per clause**

```ts
// tests/acceptance/m5.test.ts
import { describe, expect, it } from 'vitest'

/**
 * Each case is named after the clause of the M5 exit criterion it proves. The
 * harness drives `buildProgram`, so what is asserted is the product and not a
 * module — the same shape as tests/acceptance/m4.test.ts.
 */
describe('M5 exit criteria', () => {
  it('both sandbox strategies apply and roll back all five change kinds', async () => {
    // For each of git and non-git: a fake mutating tool performs a modify, an
    // add, a delete, a rename and a mode change inside the sandbox; the change
    // set carries five entries; apply lands all five; a second run discards and
    // the tree is byte-identical to its pre-stage state.
  })

  it('recovers a crash during the mutating tool', async () => {
    // Spawn a child that opens a snapshot sandbox, has the tool write, then
    // exits without resolving. `skillgantry recover --restore` puts the tree
    // back. tests/helpers/child.ts already drives engine code in a second
    // process for the M2 concurrency suite — reuse it, because an in-process
    // test cannot leave a marker behind.
  })

  it('recovers a crash while awaiting approval', async () => {
    // Same, killed after `mutation:pending` and before a resolution.
  })

  it('refuses a dirty skill and seeds the override correctly', async () => {
    // Without --allow-dirty the release refuses naming the dirty path; with it,
    // the tool reads the user's uncommitted bytes and the change set is computed
    // against them.
  })

  it('aborts the apply when a target drifts between preview and approval', async () => {
    // The pipeline case from Task 7, through the CLI: the stage is errored with
    // mutation-aborted, the run still finalises, and the user's edit survives.
  })

  it('blocks a release whose gates passed against different bytes', async () => {
    // Pass all three gates, edit the skill, release: rejected naming R9.9, and
    // nothing is written.
  })

  it('releases a repo with no versions.json and records the mode', async () => {
    // The ~/.claude/skills case: SKILL.md and CHANGELOG.md are updated, no
    // manifest is created, and evidence records manifestMode: none.
  })

  it('leaves no repo-root archive and no live change when packaging fails', async () => {
    // `zip` replaced by a shim that exits 1: the stage errors with spawn, the
    // repo root holds no zip, and SKILL.md is untouched.
  })

  it('leaves no repo-root archive and no live change when the installability gate fails', async () => {
    // vercel `skills` shim exits 1: the stage is failed, and the same two
    // assertions hold. This is the clause revision 2's ordering could not meet.
  })

  it('runs the gates against a deprecated skill and refuses to release it', async () => {
    // R1.4 in one case: retire, run validate (passes), release (refuses).
  })

  it('records a release in the ledger and closes no issue', async () => {
    // The probed fact behind the design: `skills` is a catalogued tool with no
    // adapter, so its tool run reconciles nothing. Open an issue in a prior run,
    // release, assert it is still open.
  })
})
```

Each body is written out in full during implementation, following `tests/acceptance/m4.test.ts`'s harness pattern: a real home, a real repo, a real ledger, and shell shims standing in for the external commands. The comments above are the contract each case has to satisfy — a case that ships as a comment is a plan failure, so the reviewer's gate for this task is that every `it` has assertions.

- [ ] **Step 2: Run the acceptance suite**

Run: `pnpm acceptance`
Expected: PASS, including M1–M4's suites unchanged.

- [ ] **Step 3: Run the whole check**

Run: `pnpm check`
Expected: PASS — lint, build, the offline suite, then acceptance.

- [ ] **Step 4: Run the integration suite, which now installs the release tool for real**

Run: `pnpm test:integration`
Expected: PASS. This is the one place vercel `skills` 1.5.21 is installed from the real npm registry and invoked against a real archive, which is what keeps the Task 9 shim honest.

- [ ] **Step 5: Mark the plan shipped and commit**

Update `docs/specs/index.md`'s plan-m5 row status to `Shipped`, and confirm design §16's `isolation` and `Release` rows name the cases that actually shipped.

```bash
git add tests/acceptance/m5.test.ts docs/specs
git commit -m "test: add the M5 acceptance suite

One named case per clause of the M5 exit criterion, driven through
buildProgram so what is asserted is the product rather than a module. The two
crash cases run in a child process, because an in-process test cannot leave an
unresolved sandbox marker behind — the same reason M2's concurrency suite needs
tests/helpers/child.ts."
```

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

- **The optimise stage ships no tool.** No catalogued optimise tool exists — both D7 candidates are unpublished, per plan-m3.md. R4.8 stays satisfied structurally, and Task 7 proves the mutating path with a fake optimiser rather than leaving it unexercised until a tool appears.
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

## Self-review

**Spec coverage.** Every requirement in the M5 row of the ownership table maps to a task above, and the four whose contracts M5 amends are named in the Spec amendments section with the defect that forced each. R9.11's "abort path from every state" is Task 11's state machine plus Task 7's row-3b handling: an abort before apply is a sandbox discard, and an abort at or after apply is a journal rollback.

**Placeholders.** No task says TBD or "similar to Task N". Two deliberate stand-ins, both named as such and both replaced within the plan: `journal.ts`'s throwing body from Task 3, replaced in Task 5, and Task 15's case list, whose comments are the contract and whose reviewer gate is that every `it` ships with assertions.

**Type consistency.** `SandboxInput` is defined once in `git-worktree.ts` and imported by `snapshot.ts` and `open.ts`; `SnapshotInput` extends it with `snapshotDir`. `ChangeSet` carries `entries`, `unifiedDiff` and `preimages` in all of Tasks 2, 3, 4, 5, 7 and 13. `preimageOf(root, relPath)` keeps the same two parameters in Tasks 3, 4, 5 and 6. `applyJournalled(ApplyInput)` has the same five fields in Tasks 3, 4 and 5. `MutationSandbox.apply` takes the change set in every implementation and every caller, which is what makes R10.11's recheck compare against the values captured at preview rather than re-derived at apply. `StageContext` gains `runDir`, `authorised`, `sandbox`, `releaseTarget` and `allowDirty` in Task 7 and every later task reads those names. `LifecycleState` has one definition, re-exported rather than copied.

**Scope.** Fifteen tasks, one milestone, one deliverable: SkillGantry can write to the user's repo, and every way that write can go wrong has a marker on disk, a preview before it happens, and a path back.

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
