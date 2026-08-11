# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SkillGantry is a SkillOps orchestrator for maintainers of agent skills. It discovers skills in registered repos, installs and spawns external CLI tools (linters, scanners, eval runners) against them, normalises their output into findings, writes evidence to each skill's sidecar workspace, and records runs and issues in a local SQLite ledger.

Lifecycle stages: `validate`, `evaluate`, `security`, `optimise`, `release`.

Three commands write to the user's own repo, and they do not carry the same safety. `release` and `retire` drive a *tool* over the live tree, so the crash safety there does not read off the code: a marker on disk before the first byte moves, a diff before any write, a path back from every failure — design §12. `suppress` composes one file's bytes itself, so it keeps the diff, the preimage recheck and one atomic rename and deliberately omits the sandbox, the journal and the marker, with a reason stated for each — design §12.5. Read the section before touching any of the three.

A fourth write path makes its own trade: `upgrade` replaces SkillGantry's own installation. It keeps nothing from §12 — no marker, no journal, no sandbox — because the new bytes are built where nothing resolves through them, verified twice, and adopted by one atomic rename whose predecessor is still on disk. There is no partially-updated state a marker could describe, and the retained prefix *is* the rollback — design §20 and design_version-check-and-upgrade.md §4.4. Its ordering is the whole safety argument, so read that before moving a step.

## Commands

```bash
pnpm build              # tsc -p tsconfig.json
pnpm install:cli        # build, pack, install to ~/.skillgantry/versions/<v>, link ~/.local/bin/skillgantry
pnpm lint               # eslint src tests (also enforces the import boundary)
pnpm test               # vitest run — offline, excludes install + acceptance
pnpm acceptance         # SG_ACCEPTANCE=1, drives the whole CLI
pnpm test:integration   # SG_INTEGRATION=1 + SG_ACCEPTANCE=1: real-network installs, real-fs suppress, then acceptance
pnpm check              # lint && build && test && acceptance — run before committing
```

`.github/workflows/check.yml` runs exactly `pnpm check` on every push to main and every PR, under Node 24 and pnpm 10 with `--frozen-lockfile`. So a green `pnpm check` locally is the whole gate.

Single test file / case:

```bash
pnpm vitest run tests/core/reconcile.test.ts
pnpm vitest run tests/core/reconcile.test.ts -t 'closes only when every detector agrees'
```

`vitest.config.ts` excludes two groups unless their env flag is set, keeping the default run offline and fast. `SG_INTEGRATION=1` unlocks `tests/core/install.test.ts` (reaches a real package index) and `tests/core/suppress-integration.test.ts` (drives the suppress write path over a real filesystem — the default run never exercises it, which matters because `suppress` is one of the three paths that write to the user's repo). `SG_ACCEPTANCE=1` unlocks `tests/acceptance/**`. The offline default holds because every install driver takes an injected `Exec` and `gh-release.ts` an injected `fetchImpl`.

Design §15 is the CLI surface: ten subcommands plus a root action, all built by `buildProgram(deps)` in `src/cli/run-command.ts`.

### scripts/

- `capture-fixtures.sh <skills-repo>` — regenerates adapter fixtures; they are never hand-edited. It refuses to run unless the installed tool matches the pinned version, so fixtures and pins cannot drift apart.
- `install-cli.sh` — behind `pnpm install:cli`.
- `release-version.sh [patch|minor|major] [--dry-run]` — behind `pnpm release:version`. Cuts a version and stops: see § Cutting a release.
- `changelog-from-history.sh` — derives changelog entries from a first-parent walk. `--pending <version>` emits just the unreleased section, which is what `release-version.sh` seeds from.

## Specs are the source of truth

`docs/specs/` holds three layers, and code follows them. **[docs/specs/index.md](docs/specs/index.md) is the only catalogue** — every spec file, its layer and its ship status live there. Start there to find a document.

Precedence, highest first:

1. [requirements.md](docs/specs/requirements.md) — numbered `R*` requirements, each tracing to a `D*` decision. Code comments and commit messages cite these ids. Its § Milestone ownership is the single authority for which milestone owns which requirement; `design.md` deliberately carries no second copy.
2. [design.md](docs/specs/design.md) — every contract in the system, with §14's terminal interface split into [design_tui.md](docs/specs/design_tui.md) under its own section numbers. Read the section that owns a contract before changing it; the map below says which section that is.
3. The code.
4. The plans — a record of intent, never a contract. Each ends with a "Deviations found while implementing" section, and shipped plans are compacted to hold the why, not the how.

Design reviews are point-in-time findings against a named commit. Historical.

Two root files carry names that collide with that tree and are not contracts: `DESIGN.md` is the TUI visual design system (palette, density, mood) and `PRODUCT.md` the product schema. A bare "design §N" always means `docs/specs/design.md`. `docs/specs/meta/convention.md` holds the spec naming and structure rules the `spec-lint` skill applies, and `docs/research/` predates the specs.

When implementation proves a spec wrong, amend the spec doc in the same branch rather than letting the two diverge.

`AGENTS.md` is a symlink to this file. Edit `CLAUDE.md`.

## Architecture

One npm package, three source roots, boundary enforced by lint rather than a workspace split. Allowed import direction is `cli → tui → core`.

```
src/core/    engine — no console, no process.exit
src/tui/     Ink app; may touch fs, may not spawn or open the ledger
src/cli/     bin entry `skillgantry`; run-command.ts builds the commander program,
             tui-command.ts owns the wiring (config, ledger, queue) the TUI is denied
```

Design §3 is the module map (job, dependencies and owned I/O per module) and is not repeated here. The rule it applies throughout `src/core/`: a module that owns I/O does not also own decisions. `adapters` and `ledger` depend on almost nothing, hold the subtlest rules, and are tested exhaustively with no mocking.

The seams no single file reveals:

- `queue/pool.ts` schedules and never builds a run; the caller injects `startRun`. `src/cli/tui-command.ts` is the only place config, lock, env, ledger and pipeline meet.
- Every ledger read reaches the TUI through one injected port: `src/tui/views.ts` declares `GantryViews`, `src/cli/gantry-views.ts` implements it. It opens and closes the ledger per call, because a long-lived WAL reader in the writer's process serves a snapshot from before the run it was opened to show.
- The pipeline owns the sandbox lifecycle, not the executor. `pipeline/run.ts` opens it, gates the mutation, applies or discards, and disposes in a `finally` that `execute()` is inside; an executor only declares `mutationScope` and decides. A throw that skipped disposal left a worktree registered and the record `active` forever.
- Retirement (`release/retire.ts`) drives the mutation path directly, outside the pipeline, writing its record under the same workspace shape — which is why one recovery scan finds an interrupted retirement and an interrupted release with no special case.
- The catalogue is the install authority, the adapter registry the run authority (design §5.1a). A tool can be installed, verified and locked with no adapter — vercel `skills` is — but must not reach `stageTools`, or `AdapterStageExecutor.plan()` throws `unknown tool: <id>` and fails the whole run.
- `tools/**`, `queue/**` and `isolation/**` must not open the ledger, and `upgrade/**` joins them. Doctor's lifecycle check therefore takes ledger state as an argument, from `src/cli/` — and so does its `skillgantry-outdated` condition, because `tools/**` owns no network dependency either.
- The launch check and doctor's condition both reach the release index, so `CliDeps.maybeUpgrade` and `CliDeps.upgradeCheck` exist for the reason `startTui` and `startSetup` do: without them every test driving the root action or `doctor` makes a real request, and `pnpm test` stops being offline.
- Palette key routing reads a ref, not state — React batches keypresses that arrive in one tick, and reading state lost every character but the last.

### Read the design section before changing a contract

| Changing | Read |
|---|---|
| which bytes are a skill — digest, tool input, packaging | §4.4, §4.5 |
| tool install, lock, verify, doctor drift | §5.1–§5.3 |
| an adapter, its declared artefacts, rule classes | §7, §7.1, §7.2 |
| what a tool outcome means, how a stage reduces | §8.1, §8.2 |
| sidecar layout, index durability, secret handling | §9 |
| ledger schema, finding identity, reconciliation, issue states, rule-map migration | §10 |
| run lifecycle, events, cancellation phases | §11 |
| sandbox, dirty override, journalled apply, release state machine | §12 |
| retirement | §13 |
| a screen, the row budget, render discipline | design_tui.md §14, §14.1 |
| a CLI flag or exit code | §15 |
| the release contract, the changelog, the versioned prefix, the check or the apply | §20 → design_version-check-and-upgrade.md |

Two of those bite hardest because the change looks local. Extending the rule-class map is a migration, not an edit: bump `RULE_CLASS_MAP_VERSION` and reclassify live issues, or every issue filed under the old class is orphaned (R8.14). And outcome classification is an ordered table where a schema-valid parse beats the exit code, so a scanner exiting 1 with a clean report has *passed*.

### Cutting a release

§20 states the contract; this is the loop that satisfies it. Publishing is a tag, so nothing ships until one is pushed.

```bash
pnpm release:version [patch|minor|major] [--dry-run]   # default patch
```

It refuses a dirty tree, bumps `package.json`'s version line in place, and prepends a `## <version> — <date>` section to `CHANGELOG.md`, seeded by `changelog-from-history.sh --pending` from the commits since the last bump — filtered to `feat` / `fix` / `ui` / `perf` subjects, falling back to `- No user-facing change.` when none match. Then it stops and prints what remains:

```bash
# edit the seeded section by hand — bullets are headlines, detail in a paragraph under one
pnpm check
git commit -am 'chore(release): <version>'
git tag v<version> && git push origin v<version>
```

That hand edit is not optional. `parseChangelog` reads only the `- ` lines and the upgrade prompt gives each one terminal row, so a raw commit subject is the wrong shape; the seed is a draft.

The tag fires `.github/workflows/release.yml`, which refuses to publish unless the tag matches `package.json` and `CHANGELOG.md` has a section for it (R13.8) — a mismatch would make every client install a version it did not ask for and still see the upgrade available. `CHANGELOG.md` ships as a release asset, and that asset is what a client's launch check reads, so a section is immutable once published.

## Conventions

- ESM only, `NodeNext`. Relative imports carry the `.js` extension, in `.tsx` too. JSX is `react-jsx`.
- Node floor `>=24.0.0`. `node:sqlite` and `node:child_process` are used directly. No `better-sqlite3` (native module in an npm CLI), and no `execa` (the runner needs `detached: true` plus `process.kill(-pid)` for the process-tree kill).
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` are all on.
- British spelling in identifiers that appear in the specs: `optimise`, `artefact`, `normalise`.
- Metric keys are a closed union in `src/core/types.ts`. Token and cost keys do not exist by construction; that is how R1.5 is enforced. `coerceMetrics` throws on an unknown key.
- Comments explain *why a rule exists*, usually by naming the failure mode the alternative had. Match that register; do not add restating comments.
- Conventional Commits, lowercase imperative subject describing the behaviour change.

Lint enforces the invariants, so a violation fails `pnpm lint` rather than review: no cross-root imports, no deep core imports from `src/tui/**` (core is reachable only through `src/core/index.ts`), no `console` or `process.exit` in `src/core/**`, and no `node:fs` / `node:child_process` / `node:https` / `node:net` in `src/core/adapters/**` (adapters receive artefact bytes, they do not read them). `tests/boundary.test.ts` proves the rules fire by writing probe files and running eslint on them.

## Testing

Tests mirror `src/` under `tests/core/`, plus `tests/tui/`, `tests/cli/`, `tests/specs/` and `tests/acceptance/`. Design §16 lists the target and guard for each suite; consult it when adding tests for a new module.

- `tests/helpers/` is why no unit test spawns a real tool or opens a terminal: fixture repos (`tmp-repo.ts`, `makeGitRepo()` for the worktree strategy), executable stand-in tools (`fake-tool.ts` including a grandchild-spawner for the process-tree kill, `fake-mutating-tool.ts`, `fake-release.ts`), `fake-executor.ts` / `fake-run.ts` / `fake-views.ts`, `render-ink.tsx` (fake TTY, `debug: true`, assert on frames), and `child.ts` for running the CLI in a second process.
- A harness standing in for `pipeline/run.ts` must re-root `skill.dir` and `skill.repo.path` into the sandbox the way `run.ts` does. Leaving the live `skill` in place is what let `candidateManifest` and `readVersionsManifest` be exercised against the live tree while production ran them against the sandbox — the blind spot that hid the untracked-candidate-file digest mismatch.
- Crash recovery is the one thing a unit test cannot prove. A fabricated `sandbox.json` shows only that recovery *reads* a marker; killing a real child mid-mutation lives in `tests/acceptance/m5.test.ts`.
- Adapter tests run against golden fixtures captured from the pinned tool version, so upstream schema drift shows up as a test failure. Ledger tests use in-memory SQLite. `deps.startTui` / `deps.startSetup` on `CliDeps` are the seams that let `tests/cli/` assert a launch without a terminal.
