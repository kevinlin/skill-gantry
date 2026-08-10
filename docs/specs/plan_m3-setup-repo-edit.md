# SkillGantry M3 Extension — The setup repo step shows and edits what is registered

**Status:** In progress, on branch `worktree-m3-setup-repo-edit`. Written against [design_tui.md](design_tui.md) §14.12, [design.md](design.md) §5.3, [requirements.md](requirements.md) revision 23 (R3.12) and shipped M1–M9. Owned by M3, which owns the wizard.

**Goal:** The `credentials-and-repo` state names every repo already registered and can replace a selected repo's path in place, keeping that repo's identifier so its recorded runs and issues follow the change. A clean machine's frame does not change.

**Architecture:** The registered list is a parameter of the render, supplied by whichever caller owns the config document — `startSetup` reads it once from disk, §14.2's screen passes its staged one. The wizard's reducer is untouched. A new pure transform `withRepoPath` owns the id-preserving replacement, `updateRepo` is its filesystem half in the shape `registerRepo` already has, and `SetupDriver.updateRepo` is what the write-through caller reaches it by. The cursor indexes `[...repos, <new>]`, so adding is a position rather than a mode and one `enter` handler serves both.

## Global constraints

All constraints from [plan_m1.md](plan_m1.md) through [plan_m9.md](plan_m9.md) hold. The ones this work exercises: one write path per document (`registerRepo`/`updateRepo` for the CLI, `applyConfig` for the screen), the setup states are shared and not reimplemented, `src/tui/**` may not spawn or open the ledger, §14.1's row budget holds on a step that until now had no unbounded content.

---

## Critical files

| Path | Role |
|---|---|
| `src/core/config/edit.ts` | `withRepoPath` — the id-preserving replacement; `configChanges` gains a repo path-change row |
| `src/core/config/config.ts` | `updateRepo(home, repoId, path)`, mirroring `registerRepo` |
| `src/core/tools/setup.ts` | `SetupDriver.updateRepo`; `SetupState` deliberately unchanged |
| `src/tui/use-setup-session.ts` | `repos` option, `repoCursor`, the arrow keys, `onRepo(path, replacing)` |
| `src/tui/components/Setup.tsx` | The registered list, its window, the `unchanged` verdict, the three hint phrasings |
| `src/tui/setup-app.tsx`, `src/cli/setup-command.ts` | The write-through caller: `loadConfig` in `startSetup`, `updateRepo` on the driver |
| `src/tui/app.tsx`, `src/tui/store.ts` | The staging caller: live `config.repos`, `stage-repo-path` over `withRepoPath` |

---

## Tasks

### Task 1: The id-preserving transform and the change row

`withRepoPath(config, repoId, entry)` replaces `path`, `name` and `isGit` on that entry, keeping id and array position, refusing an unknown id and a path another entry holds. `configChanges` emits a `change` row for an id present in both documents whose path differs — without it a staged path edit produces an empty change set and §14.2's confirmation reports that nothing changed.

### Task 2: The filesystem half and the driver

`updateRepo(home, repoId, path)` in the shape `registerRepo` already has: one `inspectRepo`, the same two refusals by name, `loadConfig` → `withRepoPath` → `saveConfig`. `SetupDriver.updateRepo` beside `registerRepo`, implemented in `buildSetupDriver`.

### Task 3: The session's cursor

`useSetupSession` takes `repos` and returns `repoCursor`, indexing `[...repos, <new>]` and starting on the new slot. `↑`/`↓` inside the existing `credentials-and-repo` branch move it and rewrite the draft. `onRepo` takes the target id or null; `submitRepo` supplies it.

### Task 4: The step renders it

`RepoStep` gains the `registered` block, windowed with the existing `listWindow` against `setupBodyRows` less the step's fixed rows. The verdict compares `inspection.resolved` against the repo under the cursor and renders `unchanged` rather than the duplicate error for its own path. Three hint phrasings, each measured against `width - 2`.

### Task 5: Both callers

`startSetup` reads `loadConfig` and passes `config.repos`; `SetupApp` routes `replacing` to `registerRepo` or `updateRepo`. `SetupScreen` passes the staged document's repos, skips its own duplicate refusal for the repo being replaced, and dispatches `stage-repo-path`.

---

## Requirement coverage

| Requirement | Task |
|---|---|
| R3.12 display every registered repo | 3 (the list reaches the session), 4 (the block), 5 (both callers supply it) |
| R3.12 replace in place, keeping the identifier | 1 (`withRepoPath`), 2 (the write path and the driver), 5 (staged and write-through) |
| R3.12 refuse another repo's path, and a non-directory, by name | 1, 2, 4 (the verdict that tells the two apart) |
| R3.12 removal stays outside the wizard | 3 (an empty field keeps its existing message) |

## Deviations found while implementing

- **Requirement id, revision and design section skip a number.** This branch takes R3.12, rev 23 and §14.12 while R3.11, rev 22 and §14.11 are claimed by unmerged work on `m10-skillup-first-eval`. Two branches claiming one id is a conflict in a table R13.7 machine-checks, and the gap closes when that branch lands.
