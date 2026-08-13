# M9 — Version check and self-upgrade

**Status:** shipped, compacted.

**Goal:** Publish SkillGantry from GitHub Releases, and have the terminal interface offer — never impose — the newer release it finds at launch, installing it into a versioned prefix and relaunching into it.

**Architecture:** Four new modules under `src/core/upgrade/` do the deciding and the writing, with `fetchImpl` and `Exec` injected so the default suite never reaches the network. `src/cli/` owns every side effect the boundary denies the terminal — the spawn, the exit code, the progress lines — and `src/tui/upgrade-app.tsx` is presentation only: props in, one answer out. Nothing opens the ledger. The install is adopted by a single atomic rename over a symlink whose predecessor stays on disk, which is why this write path needs no marker and no journal.

**Tech Stack:** Node 24 (`fetch`, `AbortSignal.timeout`, `node:child_process`), GitHub Actions, `gh` CLI, npm as the installer, Ink 7 for the prompt, vitest.

## Specification

Layer 1: [requirements.md](requirements.md) — R13.8–R13.12, R11.24, R12.10, all new, plus a new **M9** row in § Milestone ownership.
Layer 2: [design_version-check-and-upgrade.md](design_version-check-and-upgrade.md), reached from [design.md](design.md) §20. Amends design.md §5.3, §15, §17, §18 and [design_tui.md](design_tui.md) §14.14.
Decisions: **D30** and **D31**, appended to [decision-log.md](decision-log.md).

## Global Constraints

Everything in [CLAUDE.md](../../CLAUDE.md) still holds. What shaped this change beyond it:

- **No new runtime dependency.** Global `fetch` rather than a client; `AbortSignal.timeout` rather than a timeout library; `compareSemver` extracted from `src/core/release/version.ts` rather than the `semver` package. `dependencies` in `package.json` did not grow.
- **`src/core/**` has no `console` and no `process.exit`.** `apply` reports through an injected `onProgress` and throws; the CLI owns every line printed and every code returned.
- **`src/tui/**` may not spawn.** The prompt component returns an answer; `src/cli/` acts on it.
- **`fetchImpl` and `Exec` are injected**, defaulting to the real ones, exactly as `src/core/tools/gh-release.ts` already does. `pnpm test` stays offline.
- **`tools/**`, `queue/**`, `isolation/**` must not open the ledger.** `upgrade/**` joins them.
- **Exit codes are constants in one file.** `0` success or current, `1` upgrade available (`--check` only), `2` foreign install, `3` unreachable, `4` integrity mismatch, `5` post-install version mismatch, `6` authorisation withheld.
- **The repo is `kevinlin/skill-gantry`**, API base `https://api.github.com`, both overridable for tests the way `GhReleaseOptions.apiBase` already is.

## Task Order and Why

Specs first, per the repo's own precedence rule and because `tests/specs/traceability.test.ts` fails the build the moment a requirement has no milestone owner — so Task 1 is the one that makes every later task's requirement citation real.

`CHANGELOG.md` before `release.yml`, because the workflow asserts the file's shape and cannot be written against a format that does not exist yet. Both before any client code, so the client is built against a real published release rather than a hypothesised one.

Then the engine bottom-up — `compareSemver` and state, then the changelog parser, eligibility, the check, the apply — each independently testable with no network. `install-cli.sh` moves to the versioned layout immediately after `apply`, because the two must agree about the shape and the acceptance test drives both.

Surfaces last: the prompt, then the subcommand that can use it, then the root action that relaunches, then doctor. The acceptance test closes, because it is the only thing that proves the two properties a unit test cannot.

## Critical Files

| Path | Role |
|---|---|
| `CHANGELOG.md` | 14 backfilled entries; the source of the prompt's notes and the release body |
| `scripts/changelog-from-history.sh` | first-parent walk that derives the backfill; kept so it can be re-derived |
| `.github/workflows/release.yml` | two assertions, `pnpm check`, pack, checksums, `gh release create` |
| `scripts/install-cli.sh` | `versions/<v>` plus an atomic relink |
| `src/core/release/version.ts` | `compare` exported as `compareSemver` |
| `src/core/upgrade/types.ts` | `ReleaseInfo`, `ChangelogEntry`, `UpgradeState`, `UpgradeCheck`, `Eligibility` |
| `src/core/upgrade/state.ts` | `upgrade.json` read and write |
| `src/core/upgrade/changelog.ts` | `parseChangelog`, `entriesAbove` |
| `src/core/upgrade/eligible.ts` | owned / foreign, from the entry path alone |
| `src/core/upgrade/check.ts` | `checkForUpgrade` — throttle, decline, silent failure |
| `src/core/upgrade/apply.ts` | the seven steps, `onProgress`, no-op on failure |
| `src/core/config/config.ts` | version-aware load errors for config and lock |
| `src/tui/upgrade-app.tsx` | the prompt; props in, answer out |
| `src/cli/upgrade-command.ts` | `runUpgrade`, `maybeUpgrade`, `UPGRADE_EXIT` |
| `src/cli/run-command.ts` | the `upgrade` subcommand and the root action's call |
| `src/cli/doctor-command.ts` | performs the check, passes it in as data |
| `src/core/tools/doctor.ts` | `DoctorReport.upgrade`, never touching `failed` |

---

## Tasks

The mechanism is [design_version-check-and-upgrade.md](design_version-check-and-upgrade.md)'s and the code is the how; what follows is what each task was for.

### Task 1: Spec amendments and D30–D31

Landed R11.24, R12.10 and R13.8–R13.12 in `requirements.md` with an M9 ownership row, the design amendments in design.md §5.3/§15/§17/§18 and design_tui.md §14.14, and D30–D31 in the decision log. First because the traceability test fails the build on an unowned requirement, so nothing later could cite an id that did not yet exist.

### Task 2: `CHANGELOG.md` and the backfill script

Derived 14 entries, 0.1.0 through 0.5.1, from a `--first-parent main` walk reading `package.json` at each commit, filtered to `feat`/`fix`/`ui`/`perf` subjects. The script is checked in rather than run once, on `capture-fixtures.sh`'s precedent — a derived artefact is regenerated, not hand-edited. `0.1.0` was written by hand, having no predecessor to diff against.

### Task 3: The release workflow

`.github/workflows/release.yml` on `push: tags: ['v*']`: assert the tag equals the manifest version, assert `CHANGELOG.md` carries that section, `pnpm check`, pack, checksum, `gh release create` with three assets and the extracted section as the body. Both assertions exist because a release that is silently wrong is worse than one that fails to publish.

### Task 4: `compareSemver` and the upgrade state file

Renamed `version.ts`'s private `compare` to `compareParsed` and exported `compareSemver(a, b)` over strings — a second comparator is how the release path and the upgrade path come to disagree about what "newer" means. Added the `upgrade/types.ts` vocabulary and `load`/`saveUpgradeState(home)` over `upgrade.json`.

### Task 5: The changelog parser

`parseChangelog` opens an entry on `^## <semver>` and runs the body to the next `## ` or EOF; `entriesAbove(entries, version)` slices to what a client has not yet installed. Only the `- ` lines are read, which is why the release loop hand-edits the seeded bullets: each one gets a terminal row.

### Task 6: Eligibility

`resolveEligibility(entryPath, home)` decides owned or foreign from the entry path alone — `<home>/versions/` or the legacy `<home>/cli/` is ours, anything else is a development tree, `npx` or a foreign prefix. This is §5.2's refuse-rather-than-clobber rule applied to our own binary.

### Task 7: The check

`checkForUpgrade` resolves `releases/latest` under a 2s `AbortSignal.timeout`, matches the three assets by exact name, fetches and slices the changelog, and decides `available` / `declined` / `current` / `unreachable`. State is written **only on a successful request**, so a failed check buys no silence. `releases/latest` excludes drafts and prereleases by construction, so there is no client-side filter to get wrong.

### Task 8: The apply

The seven steps — download, verify checksum, install, verify version, snapshot, relink, prune — staged in `<home>/versions/.tmp-<version>/` on the destination's own filesystem. Steps 1–5 sit inside a `try` that removes the temp directory and the half-built prefix before rethrowing, so any failure before the rename leaves the installation byte-identical (R13.12). A prune failure is reported and swallowed.

### Task 9: `install-cli.sh` moves to the versioned layout

The prefix became `$SG_HOME/versions/$version`, read from the manifest before the pack step, and the blanket `rm -rf` narrowed to that one version's prefix so re-running stays idempotent without deleting a sibling the upgrade path retains. Retention is two by `sort -V`, and a legacy `$SG_HOME/cli` is removed after a successful verify.

### Task 10: Version-aware config and lock load errors

`loadConfig` and `loadToolLock` check the document's `version` before the zod parse and throw a named error naming both versions, `skillgantry upgrade` and the backup path. Any other malformation still rejects with the zod error unchanged. Without this the first release to bump the literal would have broken launch with an unreadable message.

### Task 11: The prompt

`UpgradeApp` in a `Panel` titled `upgrade available`, two keys through `useInput` and every other key inert, rendered without `alternateScreen` so the decision stays in the user's scrollback. The frame and footer take their rows first and the entries take the remainder, reporting the count dropped — the Findings pane's shape.

### Task 12: `skillgantry upgrade`

`runUpgrade` forces the check past both the throttle and the decline, resolves eligibility, and prompts only on a TTY without `--yes`. Progress lines go through `deps.write` in `install-cli.sh`'s register. **It never relaunches** (R12.10): `upgrade` is a command, not a session.

### Task 13: The root action and the relaunch

`maybeUpgrade` runs after the existing mutation-record scan and answers `'continue'` or `'relaunched'`. On confirmation it applies, then re-executes `process.execPath` plus the new entry file — not the PATH link, so the relaunch depends on neither the rename having been observed nor the shell's command hash. `SG_UPGRADED_FROM` on the child is the loop guard.

### Task 14: The doctor condition

`DoctorReport.upgrade` as its own field rather than a new `ToolDriftKind` member: SkillGantry is not one of the tools in the lock, and widening that union would put it into every per-tool loop over the kinds. `doctor-command.ts` performs the check with `force: true` and passes the result in as data, so `src/core/tools/` gains no network dependency. It never touches `report.failed`.

### Task 15: Acceptance

`tests/acceptance/m9.test.ts`, two cases the unit tier cannot prove, on `m5.test.ts`'s crash-recovery precedent: a real `install-cli.sh` into a temporary `SG_HOME` upgraded against a locally-served release, and the same upgrade paused before the relink and killed with `SIGKILL`, asserting the link is intact and the binary still reports the **old** version.

## Requirement coverage

| Requirement | Task |
|---|---|
| R13.8 tag/manifest and changelog assertions, three assets, body from the changelog | 3 |
| R13.9 CHANGELOG.md maintained, backfilled, read from the release asset | 2, 5, 7 |
| R13.10 versioned prefix, atomic relink, retention, foreign refusal | 6, 8, 9 |
| R13.11 throttle, no blocking, failure not recorded, decline sticks | 7, 14 |
| R13.12 verify before adopt, snapshot, no-op on failure, relaunch guard | 8, 10, 13, 15 |
| R11.24 the prompt, two answers, decline recorded, interrupt is not an answer | 11, 13 |
| R12.10 `skillgantry upgrade`, `--check` exit direction, no relaunch, coded failures | 12 |
| M9 spec amendments, D30–D31 | 1 |

## Deviations found while implementing

**Task 1 — the milestone is M9, not M12.** The plan was written against a milestone numbering the tree renumbered before implementation started. The plan body and [design_version-check-and-upgrade.md](design_version-check-and-upgrade.md) said M12 throughout and were rewritten to M9. That collided with the pre-existing `| M9 | R11.23 |` row — [plan_m7.2-repo-skill-navigation.md](plan_m7.2-repo-skill-navigation.md)'s work, which `index.md` calls M7.2 — leaving § Milestone ownership with two rows labelled M9. Left as it stood by decision at the time; the later spec compaction pass relabelled R11.23's row M7.2.

**Task 1 — `tests/specs/traceability.test.ts` has a third case the plan did not mention.** `states the revision the body has actually reached` compares requirements.md's `**Status:** revision N` header against the highest revision marker in the body, so the seven new requirements marked *(rev 25)* failed the build until the header was bumped.

**Task 1 — §17's table is not what the coverage test parses.** The test unions every `*Satisfies …*` label in design.md and design_tui.md; §17's requirement-group table is prose. Adding rows there left the test red, and the labels are what closed it: `*Satisfies R13.8–R13.12.*` opening §20, `R12.10` appended to §15's label, and `*Satisfies R11.24.*` opening §14.14.

**Task 6 — the roots are `realpath`'d too, or every install reads as foreign.** The plan compared a resolved entry path against an unresolved root. On macOS `os.tmpdir()` alone is `/var/folders/…` while the resolved entry point is `/private/var/folders/…`, so the owned case never matched. `resolveRoot` resolves each root and falls back to its literal spelling when it does not exist — a root that is not there cannot contain the entry point either.

**Task 7 — `latest` caches `null` for "checked, nothing newer".** The resolved release is compared against the running version *before* the state is written, so the throttled path never reports a version it would have to re-compare.

**Task 9 — the layout is named in four more places than the plan lists.** `tests/acceptance/install-cli.test.ts` asserted `cli/node_modules/.bin` directly and failed the moment the prefix moved. `README.md`, `CLAUDE.md` and design.md §2 each documented `~/.skillgantry/cli`, including a `rm -rf` a user would copy, and were corrected with it.

**Task 12 — `runUpgrade` takes a trailing injection parameter.** The test list needs `fetchImpl`, `Exec`, the entry path and the TTY answer all replaced, and none of them belongs on `UpgradeOptions`, which is commander's flags. `runUpgrade(deps, options, inject = {})` is `runEvals(…, userHome)`'s established shape: every field defaults to the real thing, and the subcommand's own call site passes none of them.

**Tasks 13 and 14 — two new `CliDeps` seams, and they are what keeps `pnpm test` offline.** The root action and `doctor` both now reach the release index, so *every* existing test driving either would have made a real request. `deps.maybeUpgrade` and `deps.upgradeCheck` default to the real implementations and are stubbed in those suites, exactly as `deps.startTui` and `deps.startSetup` already are.

**Merge — the prompt is §14.14, not §14.13.** The plan told Task 1 to leave design_tui.md's duplicate `### 14.12` pair alone because that defect belonged to nobody. A spec lint landed on `main` while this branch was in flight (commit `c973ea4`) and fixed it, renumbering the setup repo step to §14.13 — which the branch's own new §14.13 then collided with, invisibly, because the collision only exists in the merged tree. A merge that compiles and passes is not a merge that is consistent: nothing mechanical checks that two section numbers in one file differ.

**Task 15 — the binary had to learn `SG_HOME`, and the release source is two files.** `install-cli.sh` has honoured `SG_HOME` since M1 so the acceptance test can install without touching a real home; the binary did not, so `skillgantry upgrade --yes` under test would have installed into the developer's own `~/.skillgantry` and renamed their own `~/.local/bin/skillgantry`. `defaultDeps()` now reads it. `SG_UPGRADE_API_BASE` and `SG_UPGRADE_REPO` were added alongside, read in `src/cli/` and passed down as options. The served release is built from `package.json` plus `dist/` alone — `files: ["dist"]` is the whole package, and `VERSION` reads the manifest, so bumping it is what makes the packed build answer `--version` with the new number.

## Changelog

- 2026-08-11 — Written.
- 2026-08-11 — Shipped. Renumbered M12 → M9 to match the tree's plan naming.
- 2026-08-13 — **Compacted post-implementation.** Removed the step-by-step tasks, file-by-file diffs, code snippets and verification commands now that the feature has shipped. Preserved Goal, Architecture, Global Constraints, Task Order, Critical Files, a one-paragraph intent per task, Requirement coverage and the deviations. The original is in git history; the mechanism is [design_version-check-and-upgrade.md](design_version-check-and-upgrade.md).
