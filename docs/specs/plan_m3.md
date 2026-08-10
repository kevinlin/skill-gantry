# SkillGantry M3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** revision 1, aligned to [design.md](design.md) revision 3, [requirements.md](requirements.md) revision 3, [plan_m1.md](plan_m1.md) revision 2 and shipped M2.

**Goal:** Complete the `tools` module. Nine external tools become installable, verifiable and lockable through three drivers; a re-enterable setup wizard takes a clean machine from no runtime to a verified toolchain, a registered repo and a written selection; `doctor` re-verifies the lock and reports every drift kind.

**Architecture:** M3 adds six modules to `src/core/tools/`, one Ink screen pair to `src/tui/`, and two subcommands to `src/cli/`. The engine keeps owning decisions and I/O separately: `catalogue.ts` and `setup.ts` are pure, the three drivers own subprocess and network, and the wizard renders a state machine it cannot advance without calling an injected driver. No M1 or M2 interface changes shape.

**Tech Stack:** everything M1 and M2 ship. No new dependency. `fetch` is the Node 24 global; `tar` and `unzip` are invoked as external commands rather than adding an archive library, matching the "prefer mature tools" rule already applied to `git` and `uv`.

## Global Constraints

Everything in [plan_m1.md's Global Constraints](plan_m1.md) and [plan_m2.md's](plan_m2.md) still holds. These are the additions.

- Node engine floor `>=24.0.0`; ESM only, `NodeNext`; relative imports carry `.js`, in `.tsx` too.
- Import boundary unchanged: `cli → tui → core`, `src/tui/**` reaches core only through `src/core/index.ts`, no `console` or `process.exit` in `src/core/**`, no `node:fs` / `node:child_process` / `node:https` / `node:net` in `src/core/adapters/**`.
- `src/core/tools/**` owns fs, network and subprocess. It MUST NOT open the ledger. Doctor's lifecycle check therefore receives ledger state as data from `src/cli/`, which is the same rule that keeps `queue` out of the ledger.
- **The catalogue is the install authority; the adapter registry is the run authority.** A tool may be installed and locked with no adapter. It MUST NOT reach `stageTools`, because `AdapterStageExecutor.plan()` throws `unknown tool: <id>` on an id the registry does not hold, which would fail the whole run.
- Every install lands under `~/.skillgantry/tools/<toolId>/` and nothing lands in a user-global location. This is R3.1, already proven for `uv-tool` in M1, and now binding on two more drivers.
- A `gh-release` install verifies integrity before the binary is used, and `integrity: 'none'` requires a written reason (R3.2b).
- No tool is written into the lock before its executable has answered its version argv. M1's rule, unchanged, now shared by three drivers.
- The wizard NEVER installs a runtime. R3.7 is satisfied by having no code path that could: `probeRuntimes` invokes version argv and nothing else.
- New drivers take an injected `Exec` (and `fetch`) seam so the default `pnpm test` run stays offline. Real installs live in the `SG_INTEGRATION` suite.
- Timeouts: every driver invocation goes through `Exec`, which carries a default 300 s ceiling. An install that hangs must not hang the wizard.
- British spelling in identifiers that appear in the specs (`optimise`, `artefact`, `normalise`).
- Conventional Commits, lowercase imperative subject.

## Spec amendments this milestone carries

Both are amended in this branch, before the code that depends on them, per the repo rule that a spec proven wrong is corrected rather than left to diverge.

**1. R3.5 cannot mean "eight adapters" in M3.** R3.5 as written requires eight adapters, and R4.1 defines an adapter as a manifest *and* a `parse`. But design §17 assigns the remaining seven adapters to M4, M4's exit criteria are about merging their findings, and R3.5a requires installing vercel `skills`, which has no adapter at all and therefore proves install specs cannot live only in adapter manifests. Shipping seven stub parsers to satisfy the literal wording would make seven tools selectable whose output nothing can read.

Split it:

- **R3.5** (M3) — SkillGantry MUST ship a catalogue entry for each of the eight tools named in D7, and for the tool of R3.5a, sufficient to install, verify and lock it. A catalogue entry MUST NOT be selectable for a run until an adapter supplies its `parse`.
- **R3.5b** (M4, new) — SkillGantry MUST ship a manifest and `parse` for the seven adapters M1 did not, each fixture-tested per R13.3.

**2. `assetPattern` needs platform tokens.** A single fixed pattern cannot resolve a Go release asset on two machines. §5.2 gains: `{os}` and `{arch}` in `assetPattern` are substituted from the host before matching, `{os}` from `process.platform` and `{arch}` as `arm64` or `amd64`.

Both amendments land in Task 1, along with the `doctor` finding kinds §5.3 implies but does not name, and the §17 milestone-modules rows.

## Facts established by reading the shipped code

1. `installAndLock(home, uvSpec, versionArgv)` is `uv-tool`-only. Task 5 kept that signature working by delegating.
2. `verifyTool` requires a semver-shaped substring. A tool printing only `v1.2` fails verification. Known gap.
3. `toolLockEntrySchema` already accepts all three `installKind` values and carries `integrity`. No lock-schema migration.
4. `AdapterStageExecutor.plan()` throws on an id absent from the adapter registry — why the wizard filters `stageTools`.
5. `parseFrontmatter` returns `{ name, version }`. Task 6 extended it with `deprecated`.
6. `buildProgram(deps)` owns the whole commander program. `CliDeps.startTui` is the test seam; Task 10 added `startSetup` beside it.
7. `renderInk` in `tests/helpers/render-ink.tsx` drives Ink with a fake TTY, so wizard frames are directly assertable.

## File structure

```
src/
  core/
    index.ts                    MODIFIED  catalogue, presets, setup, doctor, runtime exports
    discovery/
      frontmatter.ts            MODIFIED  deprecated flag, for doctor's lifecycle check
    tools/
      exec.ts                   NEW       Exec seam, defaultExec with a timeout
      catalogue.ts              NEW       ToolSpec × 9, PRESETS, lookups
      runtimes.ts               NEW       probeRuntimes(), official install commands
      npm.ts                    NEW       npm-prefix driver
      gh-release.ts             NEW       gh-release driver, integrity, extraction
      install.ts                MODIFIED  installTool() dispatch over three kinds
      doctor.ts                 NEW       drift report
      setup.ts                  NEW       setup state machine, SetupDriver, stageToolsFor
      uv.ts                     unchanged
  tui/
    index.tsx                   MODIFIED  renderSetup()
    setup-app.tsx               NEW       SetupApp: input, driver calls, state
    components/
      Setup.tsx                 NEW       pure render of SetupState
  cli/
    run-command.ts              MODIFIED  doctor + setup subcommands, first-run routing
    doctor-command.ts           NEW       skillgantry doctor [--json]
    setup-command.ts            NEW       driver wiring, startSetup
tests/
  helpers/
    fake-release.ts             NEW       local http server serving a release + checksums
  core/
    catalogue.test.ts           npm-install.test.ts     gh-release.test.ts
    runtimes.test.ts            install-dispatch.test.ts
    doctor.test.ts              setup.test.ts
  tui/
    setup-wizard.test.tsx
  cli/
    doctor-command.test.ts      setup-command.test.ts
  acceptance/
    m3.test.tsx
docs/specs/
  requirements.md               MODIFIED  R3.5 split, R3.5b added, ownership table
  design.md                     MODIFIED  §5.1a catalogue, §5.2 tokens, §5.3 kinds, §17
```

---

## Tasks

### Task 1: Tool catalogue, presets and the spec amendments they require

Created `src/core/tools/catalogue.ts` with `ToolSpec`, `CATALOGUE`, `PRESETS` (minimal/recommended/everything), and lookup functions. Amended R3.5 in `requirements.md` to split installability (M3) from parsers (M4/R3.5b), added §5.1a to `design.md` documenting the catalogue's role relative to the adapter registry, extended §5.2 with platform tokens and §5.3 with the two non-failing doctor conditions. Probed the nine D7 tools; six were installable, three omitted (see Deviations below).

### Task 2: The exec seam and runtime probing

Created `src/core/tools/exec.ts` (injectable `Exec` type with 300 s timeout via `defaultExec`) and `src/core/tools/runtimes.ts` (`probeRuntimes`, `runtimesFor`, `INSTALL_COMMAND`). R3.7 is satisfied structurally: the probe invokes version argv and nothing else — there is no install code path.

### Task 3: The npm-prefix install driver

Created `src/core/tools/npm.ts` with `npmInstall`: installs a pinned package into a `--prefix`-scoped directory under the tool root, so nothing touches a user-global npm prefix (R3.1 applied to the second driver).

### Task 4: The gh-release driver, with declared integrity

Created `src/core/tools/gh-release.ts` with `resolveAssetPattern` (`{os}`/`{arch}` tokens), three integrity modes (`sha256-digest`, `sha256-asset`, `none`), tar/zip extraction, and recursive binary search. Created `tests/helpers/fake-release.ts` — a local HTTP server serving release JSON and asset downloads for offline testing. R3.2b: a mismatch fails the install; `none` is a recorded condition, not a silent one.

### Task 5: Install dispatch over the three kinds

Rewrote `src/core/tools/install.ts` to dispatch through `drive()` over `uv-tool`, `npm-prefix` and `gh-release`, with `installTool(home, spec, options)` as the unified entry point. Kept `installAndLock()` as a backwards-compatible wrapper so M1's integration test needed no edit.

### Task 6: The doctor engine

Created `src/core/tools/doctor.ts` reporting six drift kinds: `missing`, `unverifiable`, `version-drift`, `unlocked` (the four R3.9 kinds that fail the report), plus `integrity-unverified` and `lifecycle-drift` (warnings). Extended `parseFrontmatter` with `deprecated: boolean` for R1.6's lifecycle-drift detection. Doctor takes `DoctorInput` (home, discovered skills, ledger lifecycle cache) so `tools` needs neither discovery's I/O nor sqlite.

### Task 7: `skillgantry doctor [--json]`

Created `src/cli/doctor-command.ts` wiring discovery, the ledger lifecycle cache and the doctor engine into `runDoctor` + `formatDoctor`. Registered the `doctor` subcommand in `run-command.ts` (R12.5a). Exported the full M3 surface from `src/core/index.ts`.

### Task 8: The setup state machine

Created `src/core/tools/setup.ts` with five states (`probe-runtimes → select-tools → install-and-verify → credentials-and-repo → done`), each independently re-enterable once its prerequisite holds (R3.6). `stageToolsFor` filters through the adapter registry so no run selects a tool whose output nothing parses. Defined `SetupDriver` — the effects the wizard cannot own; implemented in `src/cli/`.

### Task 9: The wizard screens

Created `src/tui/components/Setup.tsx` (pure renderer of `SetupState`) and `src/tui/setup-app.tsx` (driver-calling shell with `useReducer` + `useInput` keybindings: preset keys, j/k navigation, space toggle, b/p/q commands, text entry in the credentials state). Exported `renderSetup()` from `src/tui/index.tsx`.

### Task 10: Wire setup into the CLI, and route first run to it

Created `src/cli/setup-command.ts` with `buildSetupDriver` (the single place installs, config, the credential file and the adapter registry meet — same role `tui-command.ts` plays for the Work screen), `needsSetup` (no repo and no locked tool) and `startSetup`. Routed the bare `skillgantry` invocation to setup on a clean machine, to the TUI otherwise. Added `CliDeps.startSetup` as a test seam.

### Task 11: M3 acceptance suite and the real-install matrix

Created `tests/acceptance/m3.test.tsx` demonstrating both exit criteria: the wizard reaches a verified toolchain over real config/lock/verification (network stubbed), and doctor reports all six conditions from one home. Extended the integration suite (`SG_INTEGRATION=1`) to install every catalogued tool against real indexes; widened `test:integration` in `package.json`.

---

## Requirement coverage for M3

Every requirement M3 owns, and the task that satisfies it. A requirement with no task is a plan defect.

| Requirement | Task |
|---|---|
| R3.2 native install mechanism per language | 3 (npm-prefix), 4 (gh-release), 5 (dispatch), 11 (real installs) |
| R3.2b declared gh-release integrity, mismatch fails, `none` recorded and surfaced | 4 (driver and its four integrity cases), 5 (integrity into the lock), 6 (`integrity-unverified`) |
| R3.5 catalogue entry per tool, installable and verifiable | 1 (catalogue and amendment), 5, 11 |
| R3.5a vercel `skills` installed, nine in total | 1 (`RELEASE_TOOL_ID`, in every preset), 11 |
| R3.6 four re-enterable setup states | 8 (machine and `canEnter`), 9 (wizard), 10 (first-run routing) |
| R3.7 missing runtime shows its official command, never installs | 2 (`INSTALL_COMMAND`, probe-only), 8 (`missingRuntimesFor`), 9 (the frame that shows it) |
| R3.8 Minimal, Recommended, Everything plus per-stage choice | 1 (`PRESETS` and their properties), 9 (`1`/`2`/`3` and space-toggle) |
| R3.9 doctor re-verifies and reports four drift kinds | 6 (engine), 7 (subcommand), 11 (all four in one report) |
| R12.5a `doctor` as a headless subcommand | 7 |

**Owned elsewhere but shaped here.** R1.6's authority rule is M5's; M3 implements only the `lifecycle-drift` *report* §13 assigns to doctor, and adds the `deprecated` frontmatter field that reconciliation will need (Task 6). R3.1, R3.3 and R3.4 are M1's and are extended, not restated: two more drivers now land under the tool root, write a resolved `bin`, and verify by invocation before locking. R4.5's "adding a tool touches nothing else" is M1's and is exercised here — nine tools install with no change to pipeline, runner, ledger or the Work screen.

**Deferred within M3, with reasons.** The seven remaining parsers are R3.5b and M4's, per the Task 1 amendment. Doctor does not offer to repair drift; R3.9 requires reporting, and repair is re-entering `install-and-verify`, which the wizard already does. The Tools top-level screen is R11.3 and M6; the wizard is reached by `skillgantry setup` and by first run.

## Known gaps carried forward

- **A tool whose `--version` prints no patch component fails verification.** `verifyTool`'s semver regex is M1's, and doctor will label such a tool `unverifiable`. If Task 1's probe finds one, widen the regex in that task and say so here.
- **`stageTools` after a preset holds only skillspector.** Everything else installs in M3 and becomes selectable in M4 with R3.5b. The wizard says so; the acceptance test asserts it.
- **Sequential installs.** The wizard installs one tool at a time. Two package managers writing one tool root concurrently buys seconds and costs a class of failure that is tedious to reproduce.
- **No credential *writing*.** R3.6's fourth state is "write credentials and register a repo"; the wizard reports `.env` presence and its mode warning and registers the repo, but does not write secrets. R7.3 forbids SkillGantry writing credentials to any file, so the state can only ever report on a file the user owns.
- **R13.7's mechanical coverage check does not exist yet.** M1's coverage table lists it as satisfied by the design-example test, which checks one manifest against one design section. Task 1 edits the ownership table by hand, so that gap now matters more; it belongs to whichever milestone next touches traceability.

## Self-review

Every requirement in the M3 row of the ownership table maps to a task. R3.5 required an amendment before implementation; the amendment and its rationale are in Task 1. No task says TBD. Type signatures (`ToolSpec`, `Exec`, `SetupDriver`, `DoctorInput`) are consistent across all consuming tasks. Eleven tasks, one milestone, one deliverable: `skillgantry` on a clean machine walks a user to a verified toolchain, and `skillgantry doctor` tells them when it has drifted.

## Deviations found while implementing

### Task 1 Step 2 — three of D7's tools are not installable, so the catalogue holds six

Probe date 2026-08-01. `uv pip index versions` does not exist in uv 0.7.12 (`error: unrecognized subcommand 'index'`), so PyPI was probed through `https://pypi.org/pypi/<name>/json` instead.

| Tool | Probe result | Catalogue entry |
|---|---|---|
| skill-lint | `npm view skill-lint version` → `0.2.0`, repo `LichAmnesia/skill-lint`, bin `skill-lint`; installed into a temp prefix, `--version` → `0.2.0` | `npm-prefix`, pin `0.2.0` |
| promptfoo | `npm view promptfoo version` → `0.121.20`, bins `promptfoo`, `pf` | `npm-prefix`, pin `0.121.20` |
| skills (vercel) | `npm view skills version` → `1.5.21`, repo `vercel-labs/skills`, bin `skills`; `--version` → `1.5.21`. `@vercel/skills` is 404 | `npm-prefix`, pin `1.5.21`, `stage: null` |
| skill-up | `gh search` → `alibaba/skill-up` (Go). Latest release `v0.7.0` publishes `skill-up_0.7.0_{os}_{arch}.tar.gz` for darwin/linux/windows × amd64/arm64 plus `skill-up_0.7.0_checksums.txt`; README documents `skill-up --version` | `gh-release`, pin `v0.7.0`, integrity `sha256-asset` |
| skill-scanner | PyPI `0.3.3`, summary "Security scanner for detecting and remediating malicious AI agent skills"; installed via `uv tool install skill-scanner==0.3.3`, bins `skill-scanner` and `skillscan`, `--version` → `0.3.3` | `uv-tool`, pin `0.3.3` |
| SkillSpector | known; copied verbatim from `src/core/adapters/skillspector.ts`. `git ls-remote --tags NVIDIA/skillspector` confirms `v2.5.1` | `uv-tool`, pin `v2.5.1` |
| **SkillOpt** | PyPI `0.2.0`, `microsoft/SkillOpt`. Installed successfully, but its three entry points — `skillopt-train`, `skillopt-eval`, `skillopt-sleep` — are argparse research scripts and **none accepts `--version`**: each answers with a usage error. There is no unified `skillopt` executable. **Omitted** | none |
| **SkillHone** | Not on PyPI, not on npm. `Tencent/SkillHone` is a skills-and-docs repo: no `pyproject.toml`, no `setup.py`, no tags. **Omitted** | none |
| **agentskills** | Not on PyPI, not on npm (`npm view agentskills` → 404). `agentskills/agentskills` is the specification/docs repo: `package.json` is `"private": true` with one `dev` script, no `bin`, no tags. **Omitted** | none |

Consequences, all recorded in the specs rather than left implicit:

- Optimise has no catalogued tool, so no preset carries one. §5.3's preset paragraph was rewritten accordingly; the previous wording named `skillopt` and "all eight".
- Verify-by-invocation is what rejected SkillOpt. A tool whose executables cannot answer a version argv cannot be locked, since M1's rule is that no lock entry is written before the executable answers. Carrying it would have made every wizard run show a failed install.
- `promptfoo --version` was not probed by installing it; the package is large and its `--version` flag is long-standing. Task 11's integration run is what confirms it.

### Pre-existing flake observed during M3, not caused by it

`tests/core/spawn.test.ts > runTool > kills the whole process tree on timeout` failed three times across roughly a dozen full-suite runs and passed every time it was run in isolation (five consecutive runs). It is an M1 test over `src/core/runner/`, which M3 does not touch, and it fails only under the load of the whole suite — a timing margin, not a regression. Whichever milestone next touches the runner should widen it.

### Task 11 Step 3 — two integration assertions had to change to be about the driver

1. **promptfoo refuses to run under a test process.** `verifyTool` spawns with the ambient environment, so vitest's markers reach the child and promptfoo aborts with "Refusing to open the default Promptfoo database while running tests". The test now sets `PROMPTFOO_CONFIG_DIR` to a scratch directory. Nothing in the driver changed; `skillgantry setup` carries no such marker.
2. **`~/.local/share/uv/tools/skillspector` already exists on the reference machine**, hand-installed before SkillGantry existed, so "the global path does not exist" asserted the wrong thing — it would pass on a clean machine for a reason unrelated to our install. Rewritten to capture the path's state before the install and assert it is unchanged, which is what R3.1 actually forbids.

With those two changes `SG_INTEGRATION=1` installs, verifies and locks all six catalogued tools, and skill-up's `sha256-asset` integrity verifies against the published `checksums.txt`.

### Task 8 Step 3 — `RUNNABLE_STAGES` had to be a literal tuple

As written, `const RUNNABLE_STAGES: readonly Stage[]` widens the element type to `Stage`, so `{ [K in (typeof RUNNABLE_STAGES)[number]]: string[] }` resolves to a record with a `release` key and `tsc` rejects the cast (`TS2352 … Property 'release' is missing`). Shipped as `as const` plus an `isRunnableStage` type guard, which also removes the cast at the `tools[…].push` site.

## Changelog

- 2026-08-01 — revision 1, written against design.md revision 3 and requirements.md revision 3.
- 2026-08-01 — **Compacted post-implementation.** Removed step-by-step tasks, file-by-file diffs, code snippets, test bodies, verification commands and commit messages now that the feature has shipped. Preserved Goal, Global Constraints, Spec Amendments, File Structure, Design Decisions, Requirement Coverage, Known Gaps, Deviations, and follow-ups. Original plan recoverable via git history. 
- 026-08-02 — Promptfoo removal carried out under a separate plan: [plan_m3-promptfoo-removal.md](plan_m3-promptfoo-removal.md).
- 2026-08-02 — **`pnpm install:cli`** — new `scripts/install-cli.sh` builds, packs, and installs into `~/.skillgantry/cli/`, symlinking `~/.local/bin/skillgantry`. Paths overridable via `SG_HOME`/`SG_BIN_DIR`. Acceptance test in `tests/acceptance/install-cli.test.ts`. Deliberate exception to R3.1, which governs managed tools, not SkillGantry's own binary. Original plan recoverable via git history as `plan_m3-install-as-terminal-command.md`.
- 2026-08-02 — **Fix the `credentials-and-repo` wizard step** — five bugs, all reproduced before fix: typed path never displayed (rendered post-registration state instead of the draft buffer), pasted paths dropped (single-char guard vs multi-char paste), unhandled rejection crashed the wizard, `~` not expanded, and Enter on empty input was a silent no-op. Added `inspectRepo` on `SetupDriver` for real-time path feedback (debounced, sequence-guarded). Ctrl+D now exits without a repo (`repoSkipped`). Design §5.3 updated.
- 2026-08-02 — **Wizard styling** — step counter and five-step progress rail replace the raw state enum in the title; frame capped at 84 columns. Nine new cases in `tests/tui/setup-wizard.test.tsx`; `tests/core/config.test.ts` covers `~` expansion and `inspectRepo`. Ink 6.8 → 7.1 bump recorded in [plan_m2.md](plan_m2.md).
- 2026-08-10: **Stabilise acceptance under full-suite load.** Two root causes were reproduced before their fixes landed.
  - Ink acceptances guessed at React and filesystem timing with fixed `settle` delays. M3 sent Enter and the repo path while the final installer or next wizard state was still pending, then read `config.repos` as empty. M6 proved the ledger transition had completed while the Issues frame still rendered `open`. M3 now gates the final `skills` install deterministically, and both cases wait for their user-visible states with `waitForFrame` before continuing. A suspected lost update in `config.json` was not reproducible, so no production config change or unsupported regression claim shipped.
  - `packaging.test.ts` and `install-cli.test.ts` ran in separate Vitest workers and both compiled into the checkout's `dist/` while one of them packed it. Reproduction installed tarballs containing a zero-byte `LifecycleRail.js` or `ReleaseTargetPane.js`. Their build-and-pack critical sections now share a checkout-scoped cross-process lock; the rest of the acceptance suite remains parallel.
  - Red/green evidence: the gated M3 case failed on the old flow with `skills` still installing, M6 failed with an acknowledged ledger row behind a stale `open` frame, and the two distribution tests reproduced a corrupt package before locking. After the first two fixes, the targeted M3 and distribution runs passed, `pnpm lint` and `pnpm build` passed, and three consecutive full acceptance runs each reported 53 passed and 2 skipped.
