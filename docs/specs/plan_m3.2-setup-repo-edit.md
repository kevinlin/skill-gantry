# SkillGantry M3 Extension — The setup repo step shows and edits what is registered

**Status:** Shipped 2026-08-10, on branch `worktree-m3-setup-repo-edit`. Written against [design_tui.md](design_tui.md) §14.12, [design.md](design.md) §5.3, [requirements.md](requirements.md) revision 23 (R3.12) and shipped M1–M4.1. Owned by M3, which owns the wizard.

**Goal:** The `credentials-and-repo` state names every repo already registered and can replace a selected repo's path in place, keeping that repo's identifier so its recorded runs and issues follow the change. A clean machine's frame does not change.

**Architecture:** The registered list is a parameter of the render, supplied by whichever caller owns the config document — `startSetup` reads it once from disk, §14.2's screen passes its staged one. The wizard's reducer is untouched. A new pure transform `withRepoPath` owns the id-preserving replacement, `updateRepo` is its filesystem half in the shape `registerRepo` already has, and `SetupDriver.updateRepo` is what the write-through caller reaches it by. The cursor indexes `[...repos, <new>]`, so adding is a position rather than a mode and one `enter` handler serves both.

## Global constraints

All constraints from [plan_m1-engine-and-sidecar.md](plan_m1-engine-and-sidecar.md) through [plan_m8-suppress-finding.md](plan_m8-suppress-finding.md) hold. The ones this work exercises: one write path per document (`registerRepo`/`updateRepo` for the CLI, `applyConfig` for the screen), the setup states are shared and not reimplemented, `src/tui/**` may not spawn or open the ledger, §14.1's row budget holds on a step that until now had no unbounded content.

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

- **The requirement id, the revision and the design section were chosen to skip a number, and the gap has since closed.** This work took R3.12, rev 23 and §14.12 while R3.11, rev 22 and §14.11 were claimed by then-unmerged work on `m10-skillup-first-eval`: two branches claiming one id is a conflict in a table R13.7 machine-checks. That branch landed before this one merged, so the sequence is contiguous and the merge touched only the two documents where both sides appended — the revision preamble and the tail of `design_tui.md` — with no renumbering on either side. Worth repeating for the next parallel branch: pick the next free id, not the next number.
- **The cursor holds a repo id, not an index.** The plan said "`repoCursor` indexing `[...repos, <new>]`", which is what the component takes — but the *session* cannot store it that way. §14.2's screen renders before `state.settings` has loaded, so a `useState` seeded from an empty list starts at 0 and then points at the first repo the moment the list arrives, prefilling the field on a screen the user has not touched. The hook holds `selectedRepo: string | null` and derives the index; null is the add slot, which is also exactly what `onRepo` needs as `replacing`.
- **`RepoEntry` is a named type now.** Three modules needed the shape and `GantryConfig['repos'][number]` in three signatures is a shape nobody can search for. Exported from `config/schema.ts` through `config.ts` and `core/index.ts`.
- **`REPO_FIXED_ROWS` is 7, and below it the list collapses to one row.** The plan counted six fixed rows and missed both `marginTop` blanks. At 50×14 the step's allocation is six rows, which its fixed content fills on its own — and `listWindow` cannot emit fewer than two rows once it has anything to hide. So the block is dropped below `REPO_LIST_MIN` and replaced by `N registered · ↑/↓ choose`: the arrows still move a cursor and still prefill the field, and a list that vanished silently would make both read as a broken key. The verdict's two rows are reserved whether or not anything is typed, because a list that reflowed on the first keystroke is the frame moving under the cursor §14.4 records the cost of.
- **`withRepoPath` accepts the repo its own path** rather than refusing every duplicate. The field is prefilled with that path, so submitting it unchanged has to be a no-op and not an error. The duplicate rule still holds against every *other* entry, which is the half that protects the config.
- **The staged caller drops its own duplicate refusal on the replace path.** `SetupScreen.onRepo` threw on `alreadyRegistered` before dispatching; for a replacement that throw fires on the prefilled path itself. It now refuses only on the add path and lets `withRepoPath` own the rule for the other, which is the same split `registerRepo` and `updateRepo` have on disk.
- **No skill counts on the list rows.** The config entry carries none, and `SettingsView.repos` is not reachable from the wizard. A port read for a decoration is not the trade; the rows carry id, git-ness and path.
