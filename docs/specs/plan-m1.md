# SkillGantry M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** revision 2, aligned to [design.md](design.md) revision 3 and [requirements.md](requirements.md) revision 3.

**Goal:** Build the SkillGantry engine end to end for one adapter, driven by a headless command, with every cross-cutting contract — sidecar layout, redaction, fingerprinting, reconciliation, provenance — proven against real tool output from a tool SkillGantry itself installed.

**Architecture:** One npm package, three source roots (`src/core`, `src/tui`, `src/cli`) with a one-directional import boundary enforced by lint. M1 builds `core` and `cli` only; no terminal interface. The engine discovers skills in registered repos, installs SkillSpector into its own tool root, spawns it against one skill, normalises its SARIF into findings, writes evidence to the skill's sidecar workspace, and records runs and issues in SQLite.

**Tech Stack:** TypeScript 5 (ESM, `NodeNext`), Node 24, pnpm, vitest 4, `node:sqlite` (built-in — verified working on Node 24.15 with no flag), `node:child_process` (direct, for process-group control), `zod` for schema validation, `yaml` for frontmatter, `uuid` v14 for UUIDv7, `commander` for the CLI.

No `execa`: the runner needs `detached: true` plus `process.kill(-pid)` to satisfy R5.9's process-tree kill, which is easier to get exactly right with `node:child_process` directly.

No `better-sqlite3`: `node:sqlite` is built in at our Node floor and avoids shipping a native module in an npm-distributed CLI.

## Global Constraints

- Node engine floor: `>=24.0.0`. Declared in `package.json` `engines`.
- ESM only. `"type": "module"`, `tsconfig` `module: "NodeNext"`, `moduleResolution: "NodeNext"`. Relative imports carry the `.js` extension.
- Import boundary: `src/core/**` MUST NOT import from `src/tui/**` or `src/cli/**`. `src/tui/**` MUST NOT import from `src/cli/**`. Enforced by `no-restricted-imports`; a violation fails `pnpm lint`.
- `src/core/**` MUST NOT call `console.*` or `process.exit`. Enforced by `no-console` and `no-process-exit` scoped to that directory.
- `src/core/adapters/**` MUST NOT import `node:fs`, `node:child_process`, `node:https` or `node:net`. Enforced by `no-restricted-imports`. This is R4.3.
- Metric keys are a closed union. Token and cost keys do not exist. This is R1.5.
- Fingerprints never include a line number or message text. This is R8.4.
- The pinned SkillSpector version is `2.5.1`, installed from the git tag `v2.5.1` and the version every fixture was captured from. SkillSpector is not published to PyPI, so its install spec is the git source `git+https://github.com/NVIDIA/skillspector.git` and its pin is a git ref, not a registry version. Upstream carries no `2.3.7` tag, which is why revision 2's pin was unobtainable.
- SkillSpector is always invoked with `--no-llm`, declared in the manifest as `analysisMode: 'static'` with `credentials: { kind: 'none' }`. Its LLM mode needs a provider key and produces nondeterministic findings, which would make golden fixtures worthless. There is no fallback between modes; a mode change is a new adapter id. This is R4.2b.
- Installs relocate through `UV_TOOL_DIR` and `UV_TOOL_BIN_DIR` set on the child. uv 0.7.12 has no `--tool-dir`. Nothing may land in the user's global `~/.local/share/uv/tools`.
- The uv driver forms a registry requirement as `<spec>==<pin>` and a git requirement as `<spec>@<ref>`. A driver that could form only the first cannot install SkillSpector at all.
- One candidate manifest defines which bytes are a skill, for the digest, for tool input and for packaging. No consumer applies its own exclusion list, and nothing filters after a tool has run. This is R2.9.
- Symlinks are hashed as links, never followed. A link escaping the candidate root is an error. This is R2.10.
- British spelling in identifiers that appear in the spec (`optimise`, `artefact`, `normalise`) to match the requirements documents.
- Every commit message uses Conventional Commits.

## Facts established by running the real tool

Both were fed back into [design.md](design.md) revision 3; they are repeated here because several tasks depend on them.

1. SkillSpector 2.5.1's `scan` runs LLM analysis by default and aborts unless a provider credential is present. `--no-llm` selects static analysis and needs none. There is no rule-listing subcommand, so the static rule set, and therefore `manifest.detects`, is derived from captured output by `scripts/capture-fixtures.sh`.
2. SARIF `artifactLocation.uri` is relative to the **scanned directory**, not the repo root. Verified: scanning `declawed` yields `uri: "SKILL.md"` and `uri: "scripts/scan.py"`. The normaliser rebases onto `skill.relPath` to produce the repo-relative path R8.3 requires. This also makes a materialised candidate and an in-place one yield identical findings.

## File structure

```
package.json  tsconfig.json  eslint.config.js  vitest.config.ts  .gitignore
src/
  core/
    index.ts                    public surface re-exports
    types.ts                    Stage, Severity, RuleClass, outcomes, MetricKey, SkillRef
    config/
      schema.ts                 zod schemas for config.json and the tool lock
      config.ts                 load, save, register repo, canonicalise paths
      env.ts                    .env read, mode check, secret value extraction
    discovery/
      frontmatter.ts            split and parse SKILL.md frontmatter
      discover.ts               discoverSkills(), workspacePath()
      candidate.ts              candidateManifest(), materialiseCandidate()
      digest.ts                 skillDigest() over a manifest
    tools/
      uv.ts                     uv-tool install driver
      install.ts                installTool(), verifyTool(), lock writer
    runner/
      redaction.ts              RedactionTransform
      spawn.ts                  runTool(): timeout, process-group kill, artefact load
    adapters/
      types.ts                  AdapterManifest, ParseContext, ToolResult, Parse
      rule-classes.ts           (toolId, nativeRuleId) -> RuleClass, unmapped fallback
      sarif.ts                  shared SARIF 2.1.0 parser
      skillspector.ts           manifest + parse
      registry.ts               id -> { manifest, parse }
    stages/
      types.ts                  StageExecutor, StageContext, StageResult, ToolRunRecord
      outcome.ts                reduceStageOutcome()
      adapter-stage.ts          AdapterStageExecutor
    workspace/
      layout.ts                 path helpers, run id claim
      writer.ts                 run.json, stage.json, index.ndjson, latest, gitignore
    ledger/
      schema.ts                 DDL and migration list
      db.ts                     openLedger()
      fingerprint.ts            fingerprint()
      issues.ts                 transition table
      reconcile.ts              per-detector evidence and conjunctive closure
      record.ts                 recordRun() transaction
    pipeline/
      events.ts                 RunEvent union
      run.ts                    runPipeline() -> RunHandle
  cli/
    index.ts                    bin entry
    run-command.ts              `skillgantry run`
tests/
  fixtures/
    sarif/skillspector-declawed.sarif
    repos/…                     generated by helpers, not committed
  helpers/
    tmp-repo.ts                 build fixture repos in a temp dir
    fake-tool.ts                fixture executables
```

---

## Tasks

### Task 1: Project scaffold with an enforced import boundary

Created the project scaffold (`package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`) with ESM/NodeNext configuration and the enforced import boundary between `src/core`, `src/tui`, and `src/cli`. The boundary test (`tests/boundary.test.ts`) proves that `no-restricted-imports` rules fire for cross-root imports and for `node:fs` inside adapters (R13.1).

### Task 2: Core types with a closed metric key set

Defined the shared type vocabulary in `src/core/types.ts`: `Stage`, `Severity`, `ToolOutcome`, `StageOutcome`, `ErrorKind`, `KnownRuleClass`, `RuleClass`, `MetricKey`, `Metrics`, `RepoRef`, `SkillRef`, and `RawFinding`. Token and cost keys are absent from `METRIC_KEYS` by construction (R1.5); `coerceMetrics` throws on unknown keys to enforce this at runtime.

### Task 3: SKILL.md frontmatter parsing

Implemented `parseFrontmatter(source)` in `src/core/discovery/frontmatter.ts` to extract `name` and `version` from YAML frontmatter in `SKILL.md`. Tolerates missing frontmatter, missing fields, and non-YAML content without throwing (R2.5).

### Task 4: Skill discovery and workspace path

Implemented `discoverSkills(repo)` to scan registered repo paths for direct-child directories containing `SKILL.md`, plus repo-root skills (R2.2–R2.4). Each `SkillRef` resolves a `workspacePath` using one of two layouts: `<skill>-workspace/` for child skills and `.skillgantry-workspace/` for repo-root skills (R6.8). Exclusions (`.git`, `node_modules`, workspace dirs) are applied at discovery time (R2.3).

### Task 5: Candidate manifest and skill digest

Implemented the candidate manifest as the single authority defining which bytes constitute a skill (R2.9). Three corrections from the second design review:

- **Exclusions are exact paths, not basenames.** Revision 2 excluded "any `snapshot-pre/` directory", so a skill legitimately containing `snapshot-pre/` could change without invalidating its gate evidence. Snapshots live under the workspace, which is already excluded, so the basename rule was pure hazard.
- **Symlinks are hashed as links.** Following one can hash or package content outside the repo; ignoring one entirely misses a real change. A link resolving outside the candidate root is a hard error (R2.10).
- **One manifest, four consumers.** The digest is a pure function of the manifest, so the bytes gated, snapshotted and packaged are the same set by construction. `materialiseCandidate` exists for the repo-root case, where the workspace would otherwise sit inside the tree a tool is pointed at.

### Task 6: Config store with path canonicalisation

Built `~/.skillgantry/config.json` management with `registerRepo`, `loadConfig`, `saveConfig`, `loadToolLock`, and `saveToolLock`. Paths are canonicalised to absolute with `realpath` (R2.7). The tool lock schema records install kind, pin, resolved version, binary path, integrity, and timestamps.

### Task 6a: `uv-tool` install driver and lock writer

Added the `uv-tool` install kind. Numbered `6a` deliberately: it is an insertion from the second design review and renumbering twenty tasks would break every cross-reference.

- **Why this is in M1.** Revision 2 put the whole tool manager in M3, so nothing in M1 could write a lock entry and the only working path was a hand-written one in tests. M1 therefore builds one install kind end to end — `uv-tool`, which is what SkillSpector needs. `npm-prefix`, `gh-release`, presets, the wizard and `doctor` stay in M3.
- **Why `UV_TOOL_DIR`.** uv 0.7.12 rejects `--tool-dir`. Relocation is through `UV_TOOL_DIR` and `UV_TOOL_BIN_DIR`, set explicitly on the child so an install cannot land in the user's global tools.
- **Verify by invocation.** An install that succeeds but produces an unrunnable binary is the common failure, so the lock entry is written only after the executable has answered `--version`.

### Task 7: Credential loading and the secret value set

Implemented `.env` file loading, mode checking (`SG_MODE`), and secret value extraction in `src/core/config/env.ts`. Credential satisfaction is derived from the environment at selection time; no `credentialsPresent` flag is threaded. Secret values are collected for the redaction transform (R7.3–R7.5).

### Task 8: Redaction transform

Built `RedactionTransform` (a Node.js `Transform` stream) and `redactString` in `src/core/runner/redaction.ts` to scrub secrets from tool output. The tail-buffer behaviour holds back the last `maxSecretLength - 1` characters so a secret split across chunk boundaries is still caught (R7.4). Secrets shorter than 8 characters are ignored to avoid false-positive collisions.

### Task 9: Tool runner with process-tree kill and artefact loading

Implemented `runTool()` in `src/core/runner/spawn.ts`: spawns the tool in a detached process group, captures stdout/stderr through the redaction transform, enforces a timeout with process-group kill via `process.kill(-pid)` (R5.9), loads declared artefacts from the tool directory with a size cap, and reports missing and oversize artefacts. The grandchild kill test is the R5.9 acceptance check — killing only the direct child would leave orphaned descendants holding the temp directory open.

### Task 10: Adapter contract, rule-class map and registry

Defined `AdapterManifest`, `InstallSpec`, `ParseContext`, `ToolResult`, `Parse`, and `Adapter` types in `src/core/adapters/types.ts`. Implemented `classifyRule(toolId, nativeRuleId)` mapping native rule IDs to the twelve known `RuleClass` values, with unmapped rules scoped to `unmapped:<toolId>:<nativeRuleId>` to prevent cross-tool merging. The adapter registry (`src/core/adapters/registry.ts`) allows lookup by id and stage.

### Task 11: Shared SARIF 2.1.0 parser

Built `parseSarif(bytes, opts)` in `src/core/adapters/sarif.ts` to parse SARIF 2.1.0 output into `ToolResult` with normalised findings. `rebasePath(skillRelPath, uri)` turns the scanner-relative `artifactLocation.uri` into the repo-relative path R8.3 requires. Severity maps SARIF levels to the internal scale; unmapped rules get the fallback class (R8.5).

### Task 12: SkillSpector adapter against a real captured fixture

Replaced the Task 10 placeholder with the real SkillSpector adapter manifest and parse function in `src/core/adapters/skillspector.ts`. Golden SARIF fixtures were captured from SkillSpector 2.5.1 (`--no-llm`) via `scripts/capture-fixtures.sh`, which refuses to run unless the installed version matches the pin (R13.3). The design-example test keeps `design.md` §7 and the shipped manifest in step.

### Task 13: Total stage outcome reduction

Implemented `reduceStageOutcome(outcomes)` in `src/core/stages/outcome.ts` as a total function over the four tool outcomes, producing a `StageOutcome` and a separate `verdict` field (design §8.2). The Cartesian test (all non-empty multisets up to length 3) is the R5.11 acceptance check ensuring the reduction is defined for every reachable combination.

### Task 14: Adapter stage executor

Built `AdapterStageExecutor` in `src/core/stages/adapter-stage.ts` with `plan()` and `execute()`. Selection is resolved before the lockfile is consulted; a selected tool that is not installed yields `skipped` with `error_kind = 'not-installed'` rather than being quietly dropped.

The classification table (R4.13, design §8.1) is ordered; first match wins. A successful, schema-valid parse is authoritative and the exit code is fallback evidence only.

| # | Condition | Outcome | `errorKind` | Reconciles? |
|---|---|---|---|---|
| 1 | not in the lock, or no runnable `bin` | `skipped` | `not-installed` | no |
| 2 | `credentials` unsatisfied | `skipped` | `no-credentials` | no |
| 3 | mutating stage, no authorisation | `skipped` | `no-authorisation` | no (M5) |
| 4 | cancelled | `errored` | `cancelled` | no |
| 5 | timeout, tree killed | `errored` | `timeout` | no |
| 6 | artefact over the size cap | `errored` | `artefact-too-large` | no |
| 7 | declared artefact absent | `errored` | `missing-artefact` | no |
| 8 | `parse` threw | `errored` | `parse` | no |
| 9 | `parse` returned `errored` | `errored` | `parse` | no |
| 10 | parsed, no findings, exit 0 | `passed` | — | yes |
| 11 | parsed, no findings, exit non-zero | `passed` | — | yes |
| 12 | parsed, findings present | `failed` | — | yes |
| 13 | spawn failed | `errored` | `spawn` | no |

Row 7 sits before row 8 deliberately. Revision 2 handed an empty artefact map to the parser and classified by whichever exception it happened to raise, so a missing report was reported as a parse defect.

### Task 15: Sidecar workspace writer

Implemented the sidecar layout in `src/core/workspace/`: `claimRunDir`, `stageDirFor`, `writeRunJson`, `writeStageJson`, `finalizeRun` (`index.ndjson`, `latest` symlink), `readIndex`, `ensureGitignore`, and `withSkillLock` (R6.1–R6.6). Three durability corrections from the second design review:

- **Index recovers on read.** One `write()` per record plus `fsync` is the strongest POSIX guarantee, but a power failure can still leave a partial final line. `readIndex` discards an invalid final line; `finalizeRun` prefixes a newline when the file does not end in one.
- **`latest` is the greatest run id.** UUIDv7 is ordered by claim time. Defining it as "the later run" left open whether later meant started, finished or locked.
- **The lock has a lease.** A plain `wx` lockfile whose holder is killed blocks that skill forever. The lockfile carries the holder's pid and a heartbeat mtime; a waiter past the stale threshold breaks it.

### Task 16: Ledger schema, connection and fingerprinting

Created the SQLite ledger in `src/core/ledger/` with DDL, migrations, `openLedger`, and `fingerprint(skillId, relPath, ruleClass)`. The fingerprint is a stable 12-character hex identifier derived from only (skillId, relPath, ruleClass) — no line number, no message text (R8.4). This is what enables cross-tool merging: two scanners reporting one class in one file produce a single identifier (R8.6).

### Task 17: Issue state machine, reconciliation and the run transaction

Implemented the four-state issue lifecycle (`open`, `acknowledged`, `wontfix`, `fixed`) with `stateOnDetection` and `stateOnAbsence` transitions (R8.7, R8.10). Three rules carry the weight:

- **Errored or skipped tools reconcile nothing**, so a crashed scanner cannot mark every issue it ever found as fixed.
- **Closure is a conjunction over detectors.** Merge-first identity means one issue can carry detections from two scanners. An `issue_detectors` row per tool turns closure into "every detector has since been conclusively absent", which no ordering can influence (R8.8). Revision 2 closed when the *most recent* owner reported absence, but fan-out tools run concurrently so completion timing decided ownership.
- **Scope is derived, not declared.** A tool's reconciliation scope is its `detects` unioned with every class it has actually produced for this skill, subsuming the `unmapped:` clause and covering mapped classes the manifest forgot.

### Task 18: Pipeline, event stream and run handle

Built `runPipeline(input)` in `src/core/pipeline/run.ts` returning a `RunHandle` with an `AsyncEventQueue` of typed `RunEvent`s. Sequences stages, emits events, writes the gitignore before the digest (R2.12), captures the digest and git state, writes sidecar evidence, records into the ledger, and finalises the run. M1 emits no `mutation:pending`; the handle carries `resolveMutation` so M5 adds a stage without reshaping the API.

### Task 19: Headless run command

Created `buildProgram(deps)` for the `skillgantry run` CLI command in `src/cli/run-command.ts`. Exit code is zero only when every executed stage passed (R12.2). `--json` emits newline-delimited events for pipe consumption (R12.3). `resolveSkill` resolves a `<repo>/<skill>` selector against the config.

### Task 20: M1 acceptance suite and packaging verification

Built the `pnpm acceptance` suite (`tests/acceptance/m1.test.ts`, `tests/acceptance/packaging.test.ts`) where each exit criterion from the requirements milestone table becomes one named test. Covers the full round trip: discovery, install, spawn with redaction, sidecar evidence, ledger recording, reconciliation across two runs, fingerprint stability, and `npm pack` verification (R13.5).

---

## Requirement coverage for M1

Every requirement M1 owns, and the task that satisfies it. A requirement with no task is a plan defect.

| Requirement | Task |
|---|---|
| R1.1 stages supported | 2 (types), 18 (sequencing) |
| R1.2 exclusions | Scope of M1; nothing implements a registry or telemetry |
| R1.3 stats from own runs only | 16, 17 (ledger is the only source) |
| R1.5 no token or cost metric | 2 (`METRIC_KEYS`, `coerceMetrics`), 16 (schema test) |
| R2.1 register repos | 6 |
| R2.2 direct-child discovery | 4 |
| R2.3 exclusions | 4 |
| R2.4 repo-root skill | 4 |
| R2.5 tolerate missing frontmatter | 3, 4 |
| R2.6 record git | 4, 5 |
| R2.7 canonicalise paths | 6 |
| R2.8 skill digest over the candidate manifest | 5, 18 |
| R2.9 candidate manifest is the sole authority | 5 |
| R2.10 symlink policy | 5 |
| R2.11 materialise a non-self-contained candidate | 5, 20 |
| R2.12 gitignore before digest | 18 |
| R3.1 managed isolated tool root | 6a |
| R3.2a uv relocation via UV_TOOL_DIR | 6a |
| R3.3 lock schema with resolved executable | 6, 6a |
| R3.4 verify by invocation | 6a |
| R4.1–R4.2 manifest and parse | 10, 12 |
| R4.2a structured credential requirement | 10, 14 |
| R4.2b declared analysis mode in provenance | 10, 12, 18 |
| R4.3 pure parsers | 10 (lint rule), 7 in Task 7 of the contract, 11, 12 |
| R4.4 shared SARIF parser | 11 |
| R4.5 adding a tool touches nothing else | 10 (registry), 14 |
| R4.9 per-tool artefact directories | 14, 15 |
| R4.10 selection before lockfile | 14 |
| R4.11 empty selection rejected | 14 |
| R4.12 oversize artefact | 9, 14 |
| R4.13 tool classification table | 9, 14 |
| R5.1 chain and halt | 13, 18 |
| R5.9 timeout and process-tree kill | 9, 20 |
| R5.11 total outcome reduction, verdict as a field | 13 |
| R6.1–R6.3 sidecar layout | 15, 18 |
| R6.4 index.ndjson durability and reader recovery | 15 |
| R6.5 leave iteration-N alone | 15 (writes only under `skillgantry/`) |
| R6.6 gitignore both patterns | 15, 18 |
| R6.8 workspace path both layouts | 4, 15 |
| R7.1–R7.2 env load and mode warning | 7 |
| R7.3 inject, never persist | 9, 19 |
| R7.4 stream redaction | 8, 9, 20 |
| R7.4a unredacted artefacts flagged | 15, 20 |
| R7.5 provenance without the token | 7, 15, 20 |
| R7.7 owner-only workspace | 15 |
| R8.1–R8.2 ledger is truth, sidecar is evidence | 16, 17 |
| R8.3 normalised findings | 11, 12 |
| R8.4 fingerprint without line or message | 16, 20 |
| R8.5 unmapped fallback | 10, 11 |
| R8.6 cross-tool merge | 16, 17 |
| R8.7 four states | 17 |
| R8.8 close only when every detector is conclusively absent | 17, 20 |
| R8.10 full transition table | 17 |
| R8.11 acknowledged reconciles | 17 |
| R8.12 scope derived from what the tool produced | 17 |
| R8.13 detection per occurrence | 17 |
| R8.14 explicit rule-map migration | 10 (map is data; migration lands with M4's second scanner) |
| R12.1 same pipeline | 19 |
| R12.2 exit code | 19, 20 |
| R12.3 JSON output | 19 |
| R13.1 enforced boundary | 1 |
| R13.2 event stream, no stdout in core | 1 (lint), 18 |
| R13.3 fixtures from real runs, scripted | 12 |
| R13.4 fingerprint and reconciliation tests | 16, 17 |
| R13.5 npm distribution | 20 |
| R13.6 a contract test per P1 finding of both reviews | 5, 6a, 9, 12, 13, 14, 15, 16, 17, 20 |
| R13.7 one ownership table, checked coverage | 12 (design example test); the ownership table itself lives only in requirements.md |

**Owned elsewhere but shaped here.** R3.2b (gh-release integrity) is an M3 requirement whose *schema* lands in M1, because `InstallSpec` and the lock entry are defined in Tasks 10 and 6. M1 ships no gh-release driver.

**Deferred within M1, with reasons.** R8.14's migration *runner* is data-only until a second scanner exists to merge against; Task 10 ships the map and its tests, and M4 ships the migration that consumes it. R4.8's concurrency prohibition is structurally satisfied in M1 because no optimise adapter exists; M4 tests it directly.

## Self-review

**Spec coverage.** Every M1 requirement in the milestone table maps to a task above. Two are satisfied structurally rather than by code, and both are called out with their reason.

**Placeholders.** No task contains TBD, TODO, "similar to Task N", or a code step without code. Task 10 ships a deliberate placeholder `skillspector.ts` so the registry compiles; Task 12 replaces it, and both tasks say so explicitly.

**Type consistency.** `ToolResult.outcome` is narrowed to `passed | failed | errored` in the adapter contract (Task 10) and widened to the full `ToolOutcome` on `ToolRunRecord` (Task 14), because only the executor can produce `skipped`. `StageResult.verdict` is `'passed' | 'failed'` everywhere and is a field, never a metric. `fingerprint(skillId, relPath, ruleClass)` keeps the same three parameters in Tasks 16, 17 and 20. `claimRunDir` returns `{ runId, runDir }` in Tasks 15 and 18. `stageDirFor(runDir, index, stage)` is called with `STAGE_ORDER.indexOf(stage) + 1` in Task 18 and with a literal `3` in Task 15's test, both yielding `03-security`. `digestSkill(skill)` takes a `SkillRef` and `skillDigest(manifest)` takes a `CandidateManifest`; Task 18 calls the former. Credential state is derived from `ctx.env` by `credentialsSatisfied`, so no `credentialsPresent` flag is threaded anywhere.

**Scope.** Twenty-one tasks, one milestone, one working deliverable: a headless engine that installs a real scanner, runs it, and records the result. No TUI, no wizard, no mutating stage.

## What changed in revision 2 of this plan

Aligning to design revision 3, which closed [design-review-r2.md](design-review-r2.md).

| Finding | Change |
|---|---|
| 2, 3 Candidate view and digest | Task 5 rewritten: `candidateManifest()` becomes the single exclusion authority, the `snapshot-pre` basename rule is gone, symlinks are hashed and escapes rejected, `materialiseCandidate()` added for repo-root skills. Task 18 orders the gitignore write before digest capture. Task 20 gains the canary test. |
| 5 M1 tool bootstrap | New Task 6a: the `uv-tool` driver via `UV_TOOL_DIR`/`UV_TOOL_BIN_DIR`, lock writer and verify-by-invocation. `InstallSpec` gains a declared `Integrity` for `gh-release`; the lock gains `integrity`. Task 20 gains an exit criterion driven by a genuinely managed install. |
| 6 SkillSpector credentials | `requiresCredentials: boolean` replaced by `CredentialRequirement` throughout Tasks 10 and 14; `analysisMode` added and recorded in provenance; `detects` narrowed to static mode; a test now keeps design.md §7 and the shipped manifest in step. |
| 7 Classification | Task 14 gains the ordered thirteen-row table as `classifyToolRun`, with missing artefacts classified before the parser is called, `spawn` added to `ErrorKind`, and a test per row. |
| 8 Detector ownership | `issue_detectors` added in Task 16; Task 17's reconciliation becomes two phases and a conjunction, with scope derived from what a tool has produced. |
| 9 Durability | Task 15 gains reader-side index recovery, `latest` by greatest run id, and a leased lock that a dead holder cannot keep. |
| 11 Traceability | The coverage table above is the plan's own check; milestone ownership is not restated here, it lives in requirements.md alone. |

## Changelog

- 2026-08-01 — **Compacted post-implementation.** Removed step-by-step task bodies, code blocks, file-by-file diffs, test listings, and verification commands now that M1 has shipped and the `worktree-m1-engine` branch is merged. Preserved Goal, Global Constraints, Facts, File structure, task intent summaries with design rationale, the classification table, Requirement coverage, Self-review, and revision-2 change log. Original plan recoverable via git history.
