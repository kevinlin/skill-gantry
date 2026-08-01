# SkillGantry — Requirements

**Date:** 2026-08-01
**Status:** draft for review
**Layer:** requirements (layer 1 of 3: requirements → [design](design.md) → plan)
**Traces to:** [decision-log.md](decision-log.md)

Each requirement carries the decision it derives from and, where the check is not self-evident, how to verify it. `MUST` is binding for v1; `MUST NOT` marks an explicit exclusion.

---

## R1 Scope

- **R1.1** SkillGantry MUST support maintainer lifecycle stages validate, evaluate, security, optimise and release. (D1)
- **R1.2** SkillGantry MUST NOT implement production runtime telemetry, a registry or server component, skill authoring, or the consumer lifecycle. (D1)
- **R1.3** Stage 6 "observe" MUST be satisfied by statistics over runs SkillGantry itself executed, and no other source. (D1)
- **R1.4** Stage 7 "retire" MUST be limited to setting deprecation metadata on a skill and blocking further releases of it. (D1, assumption D)
- **R1.5** SkillGantry MUST NOT record token or cost metrics in v1. (D12)
  *Verify:* no cost or token column exists in the ledger schema and no UI surface displays one.

## R2 Repos and discovery

- **R2.1** A user MUST be able to register any number of skill repos by absolute path, persisted across sessions. (D4)
- **R2.2** Within a registered repo, a skill MUST be identified as a direct child directory containing `SKILL.md`. (D4)
- **R2.3** Discovery MUST exclude directories matching `*-workspace/`, dotdirectories, and `node_modules`. (D4)
  *Verify:* discovery over `zapac-agent-skills` returns 22 skills and does not return `agent-insights-workspace/skill-snapshot`.
- **R2.4** A repo whose root itself contains `SKILL.md` MUST be treated as a single-skill repo. (D4)
- **R2.5** Discovery MUST read `name` and `metadata.version` from `SKILL.md` frontmatter, and MUST tolerate their absence without failing the scan. (D4)
- **R2.6** Discovery MUST record whether each repo is under git, since that selects the mutation isolation strategy. (D17, D18)

## R3 Tool management

- **R3.1** SkillGantry MUST install tools into a directory it owns, isolated per tool, never into the user's global environment. (D2)
- **R3.2** Installation MUST use each tool's native mechanism: `uv tool install` for Python tools, a private npm prefix for TypeScript tools, GitHub release binary for Go tools. (D2)
- **R3.3** Every installed tool's resolved version MUST be recorded in a lockfile. (D2)
- **R3.4** After installing a tool, SkillGantry MUST verify it by invoking it and capturing its version output; an install that cannot be invoked MUST be reported as failed. (D14)
- **R3.5** SkillGantry MUST ship eight tool adapters: skill-lint and agentskills (validate), skill-up and promptfoo (evaluate), skill-scanner and SkillSpector (security), SkillOpt and SkillHone (optimise). Release is a native stage rather than an adapter. (D7, D9)
- **R3.5a** SkillGantry MUST additionally install vercel `skills`, which the release stage invokes for the installability check. Nine external tools are therefore installed in total. (D9, R9.6)
- **R3.6** First-run setup MUST proceed as: probe runtimes → select tools → install with progress → write credentials and register a repo. (D14)
- **R3.7** When a required runtime is missing, SkillGantry MUST display the official install command and MUST NOT install it without explicit confirmation. (D14)
- **R3.8** Tool selection MUST offer Minimal, Recommended and Everything presets in addition to per-stage choice. (D14)
- **R3.9** A `doctor` action MUST re-verify every tool in the lockfile and report drift. (D14)

## R4 Adapters

- **R4.1** Each adapter MUST consist of a declarative manifest and a single `parse` function. (Adapter contract decision)
- **R4.2** The manifest MUST declare id, stage, policy, mutating flag, detectable rule classes, credential requirement, install spec, invocation argv, version argv, expected artefacts, and default timeout. (Adapter contract decision)
- **R4.3** The adapters module MUST NOT spawn processes or perform network access; it receives already-produced output. (Adapter contract decision)
  *Verify:* the adapters module's test suite runs with no subprocess and no network.
- **R4.4** Shared parsers for SARIF and skill-up `v1alpha1` MUST live in the engine so adapters emitting those formats need no bespoke parsing. (Adapter contract decision)
- **R4.5** Adding a tool MUST require no change to the pipeline, runner, ledger or TUI. (Adapter contract decision)
- **R4.6** For the validate and security stages, all selected tools MUST run and their findings MUST be merged. (D8)
- **R4.7** For the evaluate stage, exactly one tool MUST run per stage execution. (D8)
- **R4.8** For the optimise stage, exactly one tool MUST run, and two optimise tools MUST NOT execute concurrently against one skill under any configuration. (D8)

## R5 Execution

- **R5.1** Stages validate, evaluate and security MUST chain automatically and MUST halt on the first stage whose outcome is not `passed`. (D6)
- **R5.2** Stages optimise and release MUST NOT execute their write step without explicit user confirmation following a diff preview. (D6)
- **R5.3** Any single stage MUST be runnable in isolation, and any completed stage MUST be re-runnable. (D6)
- **R5.4** SkillGantry MUST NOT loop automatically from optimise back to validate in v1. (D6)
- **R5.5** A user MUST be able to select multiple skills and stages and enqueue them as one batch. (D16)
- **R5.6** A bounded worker pool with a configurable limit, default 2, MUST drain the queue. (D16)
- **R5.7** Mutating stages MUST execute serially regardless of the configured concurrency limit. (D16)
- **R5.8** Failure of one skill's pipeline MUST NOT prevent other queued skills from running. (D16)
- **R5.9** Every tool invocation MUST enforce a timeout, after which the process tree is killed, the outcome is `errored`, and the partial log is preserved. (D16)
- **R5.10** The queue MUST be visible and cancellable. (D16)

## R6 Artefacts

- **R6.1** All run artefacts MUST be written under `<skill>-workspace/skillgantry/runs/<runId>/`. (D5)
- **R6.2** Each stage MUST write to its own numbered subdirectory containing the tool's raw log, its native artefacts, and a normalised `stage.json`. (D5)
- **R6.3** Each run MUST write a `run.json` at its root. (D5, D11)
- **R6.4** SkillGantry MUST maintain a `latest` pointer and a `runs/index.json` per skill workspace. (D5)
- **R6.5** SkillGantry MUST NOT write into, rename, or delete pre-existing `iteration-N` directories; it MAY read them. (D5)
- **R6.6** SkillGantry MUST ensure the repo's `.gitignore` contains a `*-workspace/` entry, adding it if absent. (D5)

## R7 Credentials and secret handling

- **R7.1** Credentials MUST be read from a single `~/.skillgantry/.env` in the format the user supplied. (D10)
- **R7.2** SkillGantry MUST warn when that file's mode is more permissive than 600. (D10)
- **R7.3** Credentials MUST be injected into child process environments at spawn and MUST NOT be written to any file by SkillGantry. (D10)
- **R7.4** Every byte written to a sidecar artefact MUST pass through a redaction filter that replaces known secret values with a placeholder. (D10)
  *Verify:* a fixture tool that echoes its full environment produces a sidecar log containing no secret value from `.env`.
- **R7.5** `run.json` MUST record the resolved provenance: base URL host, all five model mappings, and a short hash of the auth token. It MUST NOT record the token itself. (D11)
- **R7.6** Statistics views MUST be groupable and filterable by provenance fingerprint. (D11)

## R8 Ledger, issues and statistics

- **R8.1** A SQLite database at `~/.skillgantry/gantry.db` MUST be the queryable source of truth for repos, skills, runs, stages, tool runs, issues and detections. (D12)
- **R8.2** Sidecar artefacts MUST remain the evidence the ledger references; the ledger MUST NOT duplicate raw tool output. (D12)
- **R8.3** Every finding MUST be normalised to a rule class, severity, repo-relative path and message, retaining its native rule id and severity as provenance. (D12, finding-identity decision)
- **R8.4** A finding's fingerprint MUST be derived from skill id, normalised path, rule class and message shape, and MUST NOT include a line number. (Finding-identity decision)
  *Verify:* inserting blank lines above a finding leaves its fingerprint unchanged.
- **R8.5** A native rule id with no mapping MUST fall back to a tool-scoped rule class that can never merge with another tool's findings. (Finding-identity decision)
- **R8.6** The same underlying problem detected by two tools MUST resolve to one issue carrying two detections. (D8, finding-identity decision)
- **R8.7** An issue MUST hold exactly one state: open, acknowledged, wontfix or fixed. (D12)
- **R8.8** An issue MUST be closed automatically only when the tool that most recently detected it completed with outcome `passed` or `failed` in a later run and did not report it. (Failure-policy decision)
  *Verify:* a run in which the security tool errors closes zero issues.
- **R8.9** Statistics MUST cover, per skill and across repos: stage pass rate, eval case pass rate, wall-clock per stage, open issue counts by severity and rule class, and run history. (D12)

## R9 Release

- **R9.1** Release MUST update `metadata.version` in `SKILL.md` and the skill's entry in the repo's `versions.json` as one atomic operation. (D9)
- **R9.2** Release MUST refuse to proceed when those two versions already disagree, reporting both values. (D9)
  *Verify:* a fixture repo with deliberately mismatched versions is rejected before any write.
- **R9.3** Release MUST write a changelog entry for the new version. (D9)
- **R9.4** Release MUST produce an archive named `<skill>_<version>.zip`. (D9)
- **R9.5** Release MUST write an evidence bundle into the sidecar containing the validate result, eval report, merged security findings and the tool lockfile for the run. (D9)
- **R9.6** Release MUST install the produced archive into a temporary directory via vercel `skills` and MUST fail if it does not resolve. (D9)
- **R9.7** Release MUST NOT create a git commit or tag without explicit confirmation. (D9)
- **R9.8** Release MUST refuse when the skill's most recent gate outcomes are anything other than `passed`. (Failure-policy decision)

## R10 Mutation safety

- **R10.1** Before any mutating stage, SkillGantry MUST establish an isolation sandbox. (D17, D18)
- **R10.2** For a git-backed repo, the sandbox MUST be a detached git worktree, and tools MUST operate inside it rather than the user's working tree. (D17)
- **R10.3** For a git-backed repo, SkillGantry MUST refuse to run a mutating stage against a skill directory with uncommitted changes unless the user overrides. (D17)
  *Rationale:* the worktree starts at HEAD, so uncommitted work would be silently absent from the tool's input and lost from the resulting diff.
- **R10.4** For a repo not under git, the sandbox MUST copy the skill directory to `snapshot-pre/` within the run directory before any write. (D18)
- **R10.5** Both sandbox strategies MUST expose one interface and present an identical diff-and-confirm review to the user. (D18)
- **R10.6** Rollback MUST restore the skill directory to its pre-stage state. (D17, D18)
- **R10.7** Applying a mutation MUST NOT create a git commit. (D6, D9)

## R11 Terminal interface

- **R11.1** The Work screen MUST present, simultaneously: the repo and skill list with per-skill status, the five-stage lifecycle rail for the selected skill, and an output pane. (D13)
- **R11.2** The output pane MUST offer Log, Findings, Artefacts and `SKILL.md` views. (D13)
- **R11.3** Dashboard, Issues, Tools and Settings MUST be reachable as top-level screens. (D13)
- **R11.4** Live tool output MUST NOT be held in component state line by line; it MUST pass through a bounded ring buffer flushed on a fixed interval. (D3)
  *Verify:* a tool emitting 10,000 lines in 5 seconds does not degrade input responsiveness.
- **R11.5** The full, unbounded log MUST be available on disk even when the in-memory buffer has discarded earlier lines. (D3)

## R12 Headless interface

- **R12.1** `skillgantry run <skill> --stage <list>` MUST execute the same pipeline as the TUI and write the same artefacts. (D15)
- **R12.2** It MUST exit non-zero when any stage outcome is not `passed`. (D15)
- **R12.3** It MUST support machine-readable output via `--json`. (D15)
- **R12.4** A mutating stage MUST be skipped unless `--yes` is supplied. (D6, D15)

## R13 Structure, quality and distribution

- **R13.1** The engine MUST NOT depend on the terminal interface; the dependency MUST be one-directional and enforced automatically. (D15)
  *Verify:* a lint rule fails the build on any import from `core` into `tui` or `cli`.
- **R13.2** The engine MUST communicate progress through a typed event stream rather than by writing to stdout. (D15)
- **R13.3** Adapter parsers MUST be tested against fixtures captured from real tool runs, not hand-authored samples. (Assumption B)
- **R13.4** Fingerprint stability and issue reconciliation MUST have dedicated tests, including the case where a tool errors. (D12, failure-policy decision)
- **R13.5** SkillGantry MUST be distributable as an npm package runnable via `npx`, targeting Node 24. (Assumption A)

---

## Milestone acceptance

Derived from D19. A milestone is complete when its requirements are met and its criteria are mechanically verifiable.

| Milestone | Requirements in scope | Exit criteria |
|---|---|---|
| M1 | R2, R4 (one adapter), R5.9, R6, R7, R8, R12, R13.1–13.4 | `skillgantry run <skill> --stage security --json` writes a complete run directory and populates the ledger; a whitespace-only edit changes no fingerprint; an errored tool closes no issue; no secret appears anywhere under the sidecar |
| M2 | R11.1–11.5 | Work screen renders live state from the M1 engine with no engine change |
| M3 | R3 | A clean machine reaches a verified toolchain through the wizard alone |
| M4 | R4 (all eight), R4.6–4.8 | Fan-out merges findings from both scanners into single issues with two detections |
| M5 | R10, R5.2 | Both sandbox strategies pass apply and rollback tests; the dirty-skill guard holds |
| M6 | R8.9, R11.3 | Dashboard and Issues render ledger queries across all registered repos |

## Deferred

Recorded so they are not silently lost. None are v1 requirements.

- Automatic optimise → validate control loop (D6)
- Scheduled or daemonised sweeps (D16)
- Provider profile switching for cross-provider evaluation (D10, D11)
- GitHub Release publishing (D9)
- SkillHub registry integration (D9)
- Claude Code as a third optimise adapter (D7)
- Evaluate-stage comparison mode across two harnesses (D8)
- Single-binary distribution via `bun build --compile` (assumption A)
- Cost and token metrics, blocked on upstream reporting (D12)
