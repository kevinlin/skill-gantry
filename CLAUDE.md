# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SkillGantry is a SkillOps orchestrator for maintainers of agent skills. It discovers skills in registered repos, installs and spawns external CLI tools (linters, scanners, eval runners) against them, normalises their output into findings, writes evidence to each skill's sidecar workspace, and records runs and issues in a local SQLite ledger.

Lifecycle stages: `validate`, `evaluate`, `security`, `optimise`, `release`.

## Commands

```bash
pnpm build              # tsc -p tsconfig.json
pnpm lint               # eslint src tests (also enforces the import boundary)
pnpm test               # vitest run — offline, excludes install + acceptance
pnpm acceptance         # SG_ACCEPTANCE=1, drives the whole CLI
pnpm test:integration   # adds the real-network install driver test
pnpm check              # lint && build && test && acceptance — run before committing
```

Single test file / case:

```bash
pnpm vitest run tests/core/reconcile.test.ts
pnpm vitest run tests/core/reconcile.test.ts -t 'closes only when every detector agrees'
```

`vitest.config.ts` excludes two suites unless their env flag is set, keeping the default run offline and fast: `tests/core/install.test.ts` needs `SG_INTEGRATION=1` (reaches a real package index), `tests/acceptance/**` needs `SG_ACCEPTANCE=1`.

Adapter fixtures are regenerated, not hand-edited: `scripts/capture-fixtures.sh <skills-repo>`. It refuses to run unless the installed tool matches the pinned version, so fixtures and pins cannot drift apart.

The CLI itself has two entry paths: `skillgantry run <skill> [--json] [--yes]` is the headless one, and `skillgantry [--concurrency <n>]` with no subcommand falls through to commander's root action and launches the Ink work screen.

## Specs are the source of truth

`docs/specs/` holds three layers, and code follows them:

- [requirements.md](docs/specs/requirements.md) — numbered `R*` requirements, each tracing to a decision. Code comments and commit messages cite these ids.
- [design.md](docs/specs/design.md) — module map, stage contract, outcome classification table (§8.1), ledger schema and reconciliation (§10), sidecar layout (§9). Read the relevant section before changing a contract.
- [plan-m1.md](docs/specs/plan-m1.md) / [plan-m2.md](docs/specs/plan-m2.md) — task-by-task implementation plans with checkboxes.
- [decision-log.md](docs/specs/decision-log.md) — `D*` decisions the requirements derive from.

M1 (engine + headless CLI) and M2 (queue + Ink TUI) are both merged. `plan-m2.md` still carries unchecked boxes; the shipped code is ahead of it, and its "Working against M1" section records where the two diverged. Trust the code over either plan; trust `design.md` and `requirements.md` over the code.

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
| `tools/` | tool root, uv install driver, verify-by-invocation, lockfile | fs, net, subprocess |
| `adapters/` | manifest + `parse` per tool, shared SARIF parser, rule-class map | **none** |
| `runner/` | spawn one tool: env injection, timeout with process-group kill, stream redaction, artefact load | subprocess, fs |
| `stages/` | `StageExecutor` contract, `AdapterStageExecutor`, outcome reduction | — |
| `pipeline/` | stage sequencing, event emission, run finalisation, cancellation, mutation gate | — |
| `queue/` | bounded worker pool, job state machine, one tagged event stream | — |
| `workspace/` | sidecar writer: run dirs, `run.json`, `stage.json`, `latest`, `index.ndjson` | fs |
| `ledger/` | SQLite schema and migrations, fingerprinting, reconciliation, issue state machine | sqlite |

`adapters` and `ledger` depend on nothing else in the engine. They hold the subtlest rules and are tested exhaustively with no mocking.

`queue/pool.ts` schedules; it never builds a run. The caller injects `startRun`, which is why `src/cli/tui-command.ts` is the only place config, lock, env, ledger and pipeline meet.

### The TUI

`src/tui/store.ts` is a reducer over `Action`, and every input — queue events, log flushes, key presses — is an action. The components are thin. `views.ts` holds the reads the store cannot do itself (`SKILL.md`, artefact listing, last outcome per skill from the sidecar `index.ndjson` rather than the ledger, since cross-repo ledger aggregates are M6).

### Contracts worth knowing before you edit

- **Outcome classification** (design §8.1) is an ordered table, first match wins. A successful schema-valid parse is authoritative; the exit code is fallback evidence only. A scanner exiting 1 with a clean report has *passed*. Only `passed`/`failed` from a tool that actually ran feed issue reconciliation. That fail-safe stops a crashed or absent scanner from closing everything it once found.
- **Stage reduction** (design §8.2) is total over the four tool outcomes, with `verdict` carried separately so a `degraded` stage still reports whether the tools that ran found anything.
- **Finding identity** is `(skillId, relPath, ruleClass)` and nothing else: no line number, no message text, no tool id. Two scanners describing one problem resolve to one issue with two detections.
- **Reconciliation** closes an issue only when every tool that has ever detected it agrees it is gone. It is a conjunction over a set, deliberately order-free, because fan-out tools run concurrently.
- **Candidate manifest** (design §4.4) is the single definition of which bytes are a skill: for the digest, for tool input, and for packaging. No consumer applies its own exclusion list, and nothing filters findings after a tool has run.
- **`SKILL.md` frontmatter is the authority** for a skill's lifecycle state. Ledger lifecycle columns are a derived cache; a divergence is drift to report, not an error.
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

`tests/tui/store.test.ts` dispatches actions and asserts state; the component tests render through `tests/helpers/render-ink.tsx` and assert on frames. `deps.startTui` on `CliDeps` is the seam that lets `tests/cli/tui-command.test.ts` assert the launch without a terminal.

Adapter tests run against golden SARIF fixtures captured from the pinned tool version, so upstream schema drift shows up as a test failure. Ledger tests use in-memory SQLite. Design §16 lists the target and guard for each suite; consult it when adding tests for a new module.
