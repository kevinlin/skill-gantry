# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SkillGantry is a SkillOps orchestrator for maintainers of agent skills. It discovers skills in registered repos, installs and spawns external CLI tools (linters, scanners, eval runners) against them, normalises their output into findings, writes evidence to each skill's sidecar workspace, and records runs and issues in a local SQLite ledger.

Lifecycle stages: `validate`, `evaluate`, `security`, `optimise`, `release`.

## Commands

```bash
pnpm build              # tsc -p tsconfig.json
pnpm install:cli        # build, pack, install to ~/.skillgantry/cli, link ~/.local/bin/skillgantry
pnpm lint               # eslint src tests (also enforces the import boundary)
pnpm test               # vitest run — offline, excludes install + acceptance
pnpm acceptance         # SG_ACCEPTANCE=1, drives the whole CLI
pnpm test:integration   # SG_INTEGRATION=1 + SG_ACCEPTANCE=1: real-network installs, then acceptance
pnpm check              # lint && build && test && acceptance — run before committing
```

Single test file / case:

```bash
pnpm vitest run tests/core/reconcile.test.ts
pnpm vitest run tests/core/reconcile.test.ts -t 'closes only when every detector agrees'
```

`vitest.config.ts` excludes two suites unless their env flag is set, keeping the default run offline and fast: `tests/core/install.test.ts` needs `SG_INTEGRATION=1` (reaches a real package index), `tests/acceptance/**` needs `SG_ACCEPTANCE=1`.

Adapter fixtures are regenerated, not hand-edited: `scripts/capture-fixtures.sh <skills-repo>`. It refuses to run unless the installed tool matches the pinned version, so fixtures and pins cannot drift apart.

The CLI has three subcommands plus a root action, all built by `buildProgram(deps)` in `src/cli/run-command.ts`:

- `skillgantry run <skill> [--json] [--yes]` — headless.
- `skillgantry doctor [--json]` — re-verify the lock, report drift.
- `skillgantry setup` — the Ink wizard.
- `skillgantry [--concurrency <n>]` — no subcommand falls through to the root action, which routes to the wizard when `needsSetup(home)` and otherwise launches the Ink work screen.

## Specs are the source of truth

`docs/specs/` holds three layers, and code follows them. **[docs/specs/index.md](docs/specs/index.md) is the catalogue** — every spec file, its layer, and its ship status live there and nowhere else. Start there to find a document; this section only says how to *use* what you find.

Precedence, highest first:

1. [requirements.md](docs/specs/requirements.md) — numbered `R*` requirements, each tracing to a `D*` decision. Code comments and commit messages cite these ids. Its § Milestone ownership is the single authority for which milestone owns which requirement and what "shipped" meant; `design.md` deliberately carries no second copy.
2. [design.md](docs/specs/design.md) — module map, stage contract, outcome classification table (§8.1), ledger schema and reconciliation (§10), sidecar layout (§9). Read the relevant section before changing a contract.
3. The code.
4. The plans. Each ends with a "Deviations found while implementing" section recording where the shipped code diverged from it, and shipped plans are compacted so they hold the why and not the how. A plan is a record of intent, never a contract.

Design reviews are point-in-time findings against a named commit. Historical; not a contract.

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

`src/tui/**` imports core **only** through `src/core/index.ts` — a deep import such as `../core/ledger/db.js` fails `pnpm lint`.

Rule applied throughout `src/core/`: a module that owns I/O does not also own decisions.

| Module | Job | I/O |
|---|---|---|
| `config/` | `~/.skillgantry/config.json`, tool lock, `.env` read and secret extraction | fs |
| `discovery/` | repo path → `SkillRef[]`, frontmatter, `workspacePath()`, candidate manifest, digest | fs |
| `tools/` | catalogue and presets, runtime probe, three install drivers (`uv.ts`, `npm.ts`, `gh-release.ts`) behind `install.ts` dispatch, verify-by-invocation, lockfile, `doctor.ts` drift report, `setup.ts` state machine | fs, net, subprocess |
| `adapters/` | manifest + `parse` per tool (`skillspector`, `skill-lint`, `skill-up`, `skill-scanner`), shared `sarif.ts` / `eval-report.ts` parsers, `paths.ts` rebasing, versioned rule-class map | **none** |
| `runner/` | spawn one tool: env injection, timeout with process-group kill, stream redaction, artefact load | subprocess, fs |
| `stages/` | `StageExecutor` contract, `AdapterStageExecutor`, outcome reduction | — |
| `pipeline/` | stage sequencing, event emission, run finalisation, cancellation, mutation gate | — |
| `queue/` | bounded worker pool, job state machine, one tagged event stream | — |
| `workspace/` | sidecar writer: run dirs, `run.json`, `stage.json`, `latest`, `index.ndjson` | fs |
| `ledger/` | SQLite schema and migrations, fingerprinting, reconciliation, issue state machine | sqlite |

`adapters` and `ledger` depend on nothing else in the engine. They hold the subtlest rules and are tested exhaustively with no mocking.

`queue/pool.ts` schedules; it never builds a run. The caller injects `startRun`, which is why `src/cli/tui-command.ts` is the only place config, lock, env, ledger and pipeline meet.

### The tools module

Same split as the rest of the engine: `catalogue.ts` and `setup.ts` are pure decisions, the three drivers own subprocess and network. Every driver takes an injected `Exec` (`exec.ts`, 300 s default ceiling) and `gh-release.ts` also takes `fetchImpl`, which is what keeps `pnpm test` offline — real installs live in the `SG_INTEGRATION` suite. `install.ts` dispatches on `installKind` and writes the lock entry only after `verifyTool` gets a semver out of the binary.

`tools/**` must not open the ledger. Doctor's lifecycle check therefore takes ledger state as an argument, from `src/cli/` — the same rule that keeps `queue/` out of the ledger.

### The TUI

`src/tui/store.ts` is a reducer over `Action`, and every input — queue events, log flushes, key presses — is an action. The components are thin. `views.ts` holds the reads the store cannot do itself (`SKILL.md`, artefact listing, last outcome per skill from the sidecar `index.ndjson` rather than the ledger, since cross-repo ledger aggregates are M6).

`layout.ts` holds the size decisions, and holds all of them: `layoutFor(columns, rows)` is pure, `Work` calls `useWindowSize()` and passes the result down, and no component carries a fixed height. `components/Panel.tsx` is the one place the `boxed`/`bare` chrome choice is read. Design §14.1 states the three rules a frame has to obey to stay inside its row budget; break one and a panel falls off the bottom of an 80×24.

The setup wizard is a second app, not a screen of the first: `setup-app.tsx` owns input and driver calls, `components/Setup.tsx` is a pure render of `SetupState`. The wizard cannot advance a state without calling an injected driver.

### Contracts worth knowing before you edit

- **Outcome classification** (design §8.1) is an ordered table, first match wins. A successful schema-valid parse is authoritative; the exit code is fallback evidence only. A scanner exiting 1 with a clean report has *passed*. Only `passed`/`failed` from a tool that actually ran feed issue reconciliation. That fail-safe stops a crashed or absent scanner from closing everything it once found.
- **Stage reduction** (design §8.2) is total over the four tool outcomes, with `verdict` carried separately so a `degraded` stage still reports whether the tools that ran found anything.
- **Finding identity** is `(skillId, relPath, ruleClass)` and nothing else: no line number, no message text, no tool id. Two scanners describing one problem resolve to one issue with two detections.
- **Reconciliation** closes an issue only when every tool that has ever detected it agrees it is gone. It is a conjunction over a set, deliberately order-free, because fan-out tools run concurrently.
- **Extending the rule-class map is a migration, not an edit.** `RULE_CLASS_MAP_VERSION` in `adapters/rule-classes.ts` bumps with every change, and `ledger/rule-map-migration.ts` reclassifies live issues, merging any that collide onto one fingerprint without dropping a detection (R8.14). Changing a mapping without bumping the version orphans every issue already filed under the old class. `doctor` reports applied-vs-shipped version as drift.
- **An adapter declares the artefacts it reads, and may declare none.** `manifest.artefacts` is the contract; skill-lint declares `[]` and parses `ctx.stdout`, which is why row 7 of the §8.1 table (missing declared artefact) cannot fire for it. Two tools in one fan-out stage each keep their own `findings.sarif`; neither overwrites the other.
- **Candidate manifest** (design §4.4) is the single definition of which bytes are a skill: for the digest, for tool input, and for packaging. No consumer applies its own exclusion list, and nothing filters findings after a tool has run.
- **The catalogue is the install authority; the adapter registry is the run authority** (design §5.1a). A tool can be installed, verified and locked with no adapter — vercel `skills` is. It must not reach `stageTools`, because `AdapterStageExecutor.plan()` throws `unknown tool: <id>` on an id the registry lacks and would fail the whole run. `AdapterManifest.install` survives as documentation, kept in step by a test asserting the two agree for every tool holding both.
- **The wizard never installs a runtime** (R3.7). Not a check — there is no code path that could. `probeRuntimes` invokes version argv and nothing else; `INSTALL_COMMAND` is printed for the user to run.
- **A `gh-release` install verifies integrity before the binary is used**, and `integrity: 'none'` requires a written reason (R3.2b). `{os}` / `{arch}` in `assetPattern` are substituted from the host before matching.
- **`SKILL.md` frontmatter is the authority** for a skill's lifecycle state. Ledger lifecycle columns are a derived cache; a divergence is drift to report, not an error — which is exactly what `doctor` reports it as.
- **Log text never enters React state line by line.** Tool output goes to a ring buffer outside the component tree (2000 lines, 100 ms flush, design §14) and a tick copies the visible window in. The reducer test asserts this by dispatching a `tool:output` event and expecting no state change.
- **Cancellation has exactly four phases**: `queued` (queue-owned), `running`, `awaiting-approval`, `finalising` (pipeline-owned). A cancelled run still finalises.
- **Mutating stages are `optimise` and `release`.** The set lives in `queue/types.ts` so the queue can serialise them without importing a stage executor. Neither stage ships yet; the gate, timeout and serialisation do.

## Conventions

- ESM only, `NodeNext`. Relative imports carry the `.js` extension, in `.tsx` too. JSX is `react-jsx`.
- Node floor `>=24.0.0`. `node:sqlite` and `node:child_process` are used directly. No `better-sqlite3` (native module in an npm CLI), and no `execa` (the runner needs `detached: true` plus `process.kill(-pid)` for the process-tree kill).
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` are all on.
- British spelling in identifiers that appear in the specs: `optimise`, `artefact`, `normalise`.
- Metric keys are a closed union in `src/core/types.ts`. Token and cost keys do not exist by construction; that is how R1.5 is enforced. `coerceMetrics` throws on an unknown key.
- Comments explain *why a rule exists*, usually by naming the failure mode the alternative had. Match that register; do not add restating comments.
- Conventional Commits, lowercase imperative subject describing the behaviour change.

Lint enforces the invariants, so a violation fails `pnpm lint` rather than review: no cross-root imports, no deep core imports from `src/tui/**`, no `console` or `process.exit` in `src/core/**`, and no `node:fs` / `node:child_process` / `node:https` / `node:net` in `src/core/adapters/**` (adapters receive artefact bytes, they do not read them). `tests/boundary.test.ts` proves the rules fire by writing probe files and running eslint on them.

## Testing

Tests mirror `src/` under `tests/core/`, plus `tests/tui/`, `tests/cli/` and `tests/acceptance/`. Helpers: `tests/helpers/tmp-repo.ts` builds a fixture repo in a temp dir, `tests/helpers/fake-tool.ts` writes executable shell scripts standing in for real tools (including a grandchild-spawning script for the process-tree kill test), `tests/helpers/fake-executor.ts` and `fake-run.ts` stand in for a stage executor and a `RunHandle` so queue and store tests never spawn.

`tests/tui/store.test.ts` dispatches actions and asserts state; the component tests render through `tests/helpers/render-ink.tsx`, which drives Ink with a fake TTY and `debug: true`, and assert on frames. `deps.startTui` and `deps.startSetup` on `CliDeps` are the seams that let the `tests/cli/` tests assert a launch without a terminal.

Adapter tests run against golden fixtures captured from the pinned tool version — `tests/fixtures/sarif/` plus a directory per non-SARIF reporter (`skill-lint/`, `skill-up/`) — so upstream schema drift shows up as a test failure. Ledger tests use in-memory SQLite. Design §16 lists the target and guard for each suite; consult it when adding tests for a new module.
