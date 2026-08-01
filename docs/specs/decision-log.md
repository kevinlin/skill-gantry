# SkillGantry — Decision Log

**Date:** 2026-07-31
**Status:** confirmed, pre-spec
**Inputs:** [introducing-skillops.md](../research/introducing-skillops.md), [skillops-lifecycles.md](../research/skillops-lifecycles.md)
**Method:** grilling session, 19 decisions, one at a time, each with a recommendation and rejected alternatives

---

## 1. What SkillGantry is

A TUI orchestrator for the **skill maintainer** half of the SkillOps lifecycle. It installs and manages the CLI tools for validate → evaluate → security → optimise → release, runs them against skills in registered filesystem repos, writes every artefact to the skill's sidecar workspace, and keeps a local ledger of runs, results and open issues.

It does not author skills. It does not serve the consumer lifecycle (discover / install / use). It is not a registry.

---

## 2. Verified environment facts

Established by inspection, not assumption. These constrain several decisions and should be re-checked if they change.

| Fact | Detail |
|---|---|
| Repo state | git repo on `main`; the specification set landed in `be0a555` (greenfield at the time of the grilling session) |
| Tool repos exist | All 12 recommended GitHub repos return 200 |
| Already installed | `skill-up`, `skillspector` v2.3.7 (both `~/.local/bin`) |
| Not installed | `skill-lint`, `skill-scanner`, `SkillOpt`, `SkillHone`, `skillhub`, vercel `skills`, `promptfoo`, `agentskills` |
| Runtimes present | node 24.15, python 3.13, uv 0.7.12, pipx, bun 1.3.14, cargo, go, rustc |
| Tool languages | TS/npm: skill-lint, promptfoo, vercel skills · Go: skill-up · Python/pyproject: skill-scanner, SkillSpector, SkillOpt, SkillHone, agentskills · **Java: skillhub** |
| Author's language mix | 51 `package.json` vs 7 `pyproject.toml`, zero `go.mod`, zero `Cargo.toml` under `~/dev` |
| Reference repo layout | Flat: one skill per top-level dir, `SKILL.md` at its root, sidecar as sibling `<skill>-workspace/` |
| Discovery trap | `agent-insights-workspace/skill-snapshot/SKILL.md` exists, so recursive `SKILL.md` globs pick up snapshots |
| Version invariant | Version lives in two places: `metadata.version` in `SKILL.md` **and** root `versions.json` |
| Release convention | Gitignored archives named `<skill>_<version>.zip` already in use |
| Sidecar convention | `<skill>-workspace/iteration-N/<case>/` with `report.json`, `result.json`, `benchmark.json\|md` |
| Eval schema | skill-up `report.json` v1alpha1: `engine_name`, `model_name`, `start_time`/`end_time`, `case_results[].{status,duration_ms,turns,input_tokens,output_tokens,grading.assertion_results[]}` |
| **Token fields empty** | `input_tokens`/`output_tokens` are `0` and `model_name` is `""` in all three real iterations |
| Gitignore drift | Workspaces are ignored by hand-enumerated entries; `declawed-workspace/` is untracked and unignored |
| Eval duration | `declawed` iteration-3: 1m54s for 4 cases |
| Non-git skills | `~/.claude/skills` holds 54 skills and **is not a git repo** |
| Reference repo git | `zapac-agent-skills` is git, HEAD `e1847a7`, 2 untracked entries |
| **uv relocation** | uv 0.7.12 has no `--tool-dir` on `uv tool install`; tool environments and executables relocate through `UV_TOOL_DIR` and `UV_TOOL_BIN_DIR`. Default tool dir is `~/.local/share/uv/tools` |
| **SkillSpector credentials** | `scan` runs LLM analysis by default and needs one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, an AWS chain or `NVIDIA_INFERENCE_KEY`, selected by `SKILLSPECTOR_PROVIDER`. `--no-llm` runs static analysis with no credential. There is no rule-listing subcommand, so the static rule set must come from captured output |

---

## 3. Decisions

### Scope

**D1.** v1 covers maintainer stages 1–5.
Validate, Evaluate, Security Scan, Optimise/Fix, Version+Publish. Stage 6 (Observe) collapses to a *local* ledger over runs SkillGantry itself executed. Stage 7 (Retire) is metadata-only.
*Why:* stages 1–5 are genuine local CLIs and fit the orchestrator model exactly. Stages 6–7 are not CLI tools: Langfuse and Opik are docker-compose platforms, Backstage is a Node monorepo app. And "observe production usage" presumes a runtime telemetry pipeline that does not exist yet.
*Rejected:* all 7 stages with thin adapters (drags Docker and a telemetry ingest story into a CLI manager, most of it unexercisable today); stages 1–3 only (ships faster but leaves the release papercut unsolved); adding the consumer lifecycle (two personas in one v1).

**D9.** Release is SkillGantry-native logic, not a wrapped tool.
Atomic dual version bump (`SKILL.md` `metadata.version` + root `versions.json`), refusing to proceed if the two were already out of sync. Changelog entry. `<skill>_<version>.zip` matching the existing naming convention. Evidence bundle into the sidecar: validate result, eval report, merged scan findings, tool version lockfile. Then a real gate: install the zip into a temp dir via vercel `skills` and confirm it resolves. Git commit and tag offered as a confirmed action, never automatic.
*Why:* both research-doc candidates are wrong-shaped. SkillHub is a Java server; vercel `skills` is a consumer-side installer. The installability check turns release from bookkeeping into a verifiable gate.
*Rejected:* native-only without the install check (broken releases surface at consumer install time); optional SkillHub push (Java server + Docker inside a CLI manager); GitHub Release via `gh` (outward-facing publish, extra auth dependency; candidate for later).

### Stack

**D3.** TypeScript + Ink.
Ring-buffer subprocess output, throttle renders to roughly 10fps, stream full logs straight to the sidecar file rather than through React state.
*Why:* on pure merit Go+Bubbletea wins: single static binary with no chicken-and-egg runtime problem for a tool that manages runtimes, plus `glamour` for in-terminal markdown and `bubbles` for table/tree/viewport. But the author has 51 TypeScript projects and zero Go ones, and maintainability is a standing constraint. Ink's known weakness is whole-tree re-render under high-frequency output; the buffering rule above is the mitigation, and it is written into the design rather than left to chance.
*Rejected:* Go+Bubbletea (language with no other footprint here); Python+Textual (richest widgets, natural `uv tool install` distribution, second-class fluency); TypeScript+OpenTUI (better streaming, too young).

**D15.** Engine library, TUI frontend, thin headless command.
Core engine package owns discovery, adapter registry, pipeline executor, artefact writer and ledger. TUI is one consumer. `skillgantry run <skill> --stage validate,evaluate,security --json` covers CI and scripting, exits non-zero on gate failure, writes the same sidecar artefacts.
*Why:* TUI code is the least testable part of the app. An engine/frontend boundary makes the whole lifecycle testable without a terminal, which the standing "write testable code" instruction requires anyway. The headless entrypoint is a small marginal cost on top of a boundary already wanted.
*Rejected:* TUI-only (engine only exercisable through a terminal, no CI story); full CLI parity (two complete interfaces for one user); boundary-now-CLI-later (boundary goes unvalidated by a second consumer).

### Tools

**D2.** Managed isolated installs, pinned.
SkillGantry owns a tool root. Each tool installs via its native manager into its own isolated environment: `uv tool install` for the Python tools, a private npm prefix for the TypeScript tools, GitHub release binary for skill-up. Resolved versions recorded in a lockfile so runs are reproducible and stats comparable.
*Why:* reproducibility is a precondition for the stats feature. Comparing runs across drifting tool versions produces noise, not trends. Native managers avoid reinventing installation.
*Rejected:* ephemeral `uvx`/`npx` per run (cold-start noise pollutes latency stats, network required every run); Docker per tool (uniform but heavy, path-translation bugs mounting repo + sidecar); detect-only (then it is not a tool manager and the setup feature disappears).

**D7.** Both candidate tools ship for every stage in v1.
Validate: skill-lint, agentskills. Evaluate: skill-up, promptfoo. Security: skill-scanner (Cisco), SkillSpector (NVIDIA). Optimise: SkillOpt, SkillHone. Release: native, so eight tool adapters in total. Counting vercel `skills`, which the native release stage invokes for its installability check, nine external tools are installed.
*Why:* deliberate choice for coverage and fidelity to the research doc. The two scanners are genuinely complementary: Cisco does SARIF, policy checks and data-flow; NVIDIA does taint tracking, dependency checks and signatures.
*Accepted cost:* roughly double the adapter work and double the install surface that can break. This makes the adapter contract the piece most expensive to get wrong, which is why D19 validates it before widening.
*Rejected:* one default per stage with the rest as config (leaner, less security coverage); start with only the two installed tools; Optimise-via-Claude-Code instead of SkillOpt (worth revisiting as a third optimise adapter: inspectable, no fifth Python tool, reuses the managed credentials).

**D8.** Per-stage multi-tool policy.
- Validate, Security: **fan out**: run both, merge findings, dedup by (file, line, rule-class), retain per-finding provenance.
- Evaluate: **pick one**: skill-up default, promptfoo selectable.
- Optimise: **pick one, never concurrent.**

*Why:* the three stages differ in kind. Findings union usefully. Two eval harnesses measure different things and averaging their scores is meaningless. Two LLM optimisers writing one `SKILL.md` concurrently is a corruption bug.
*Rejected:* always-selectable (simplest data model, forfeits the coverage that motivated D7); always-fan-out (unsafe at Optimise, inflates issue counts); fan-out plus eval comparison mode (richest, real UI effort; deferrable).

**D14.** Guided wizard with preset bundles.
Four steps: probe runtimes and report gaps, offering each official install command with explicit confirmation and never bootstrapping silently → pick tools per stage or via a Minimal / Recommended / Everything preset → install into the tool root with live progress, then verify each by invoking it and recording the resolved version into the lockfile → write the env file and register the first repo. Re-runnable later via the Tools screen and a `doctor` check.
*Why:* nine external tools across three package managers is the single biggest onboarding cliff. Verify-by-invocation catches the common failure where install succeeds but the binary is not runnable.
*Rejected:* presets only (no per-stage choice during setup); lazy install on first use (first run interrupted by installs, no toolchain overview); wizard plus declarative reconciled config (shareable and reproducible, adds a reconcile loop and drift UI; candidate for later).

### Targets and artefacts

**D4.** Registered repos, flat discovery.
N repos registered by path in global config, switchable in the TUI. Within a repo, a skill is a direct child directory containing `SKILL.md`, excluding `*-workspace/`, dotdirs and `node_modules`. Single-skill repos (`SKILL.md` at repo root) supported.
*Why:* matches the reference repo layout exactly, sidesteps the snapshot-glob trap by construction, and lets `zapac-agent-skills`, `~/.claude/skills` and any client repo sit side by side for cross-repo stats.
*Rejected:* single repo per session (no cross-repo stats, relaunch to switch); per-repo config declaring globs (handles odd layouts, config file per repo); recursive autodetect (zero config, misfires on nested snapshots and fixtures).

**D5.** Namespaced runs under the existing sidecar.

```
declawed-workspace/
  iteration-1/                     ← existing skill-up output, read-only history
  iteration-3/
  skillgantry/
    runs/
      2026-07-31T0833-a1b2/
        run.json                   ← provenance snapshot, see D11
        01-validate/  stdout.log  stage.json
        02-evaluate/  report.json stage.json
        03-security/  findings.sarif stage.json
      latest -> 2026-07-31T0833-a1b2
      index.json
```

SkillGantry also resolves the gitignore drift by writing a single `*-workspace/` entry.
*Why:* artefacts stay where the author asked, one sidecar per skill, and the `skillgantry/` namespace guarantees no collision with hand-run skill-up, which claims the `iteration-N` counter. Pre-existing iterations remain readable as history.
*Rejected:* continuing `iteration-N` (maximum continuity, two writers in one namespace); central store with symlinks (pristine repos, artefacts no longer where you would `ls`); split artefacts-in-sidecar / index-only-central (sidecar stops being self-describing when copied).

### Execution

**D6.** Manual step plus auto-run-to-gate. No loop in v1.
Read-only stages 1–3 chain automatically and halt on the first failure. Mutating stages 4–5 always stop and require explicit confirmation with a diff preview. Any stage can be single-stepped or re-run in isolation.
*Why:* the brief said "step by step automatically", which is two things; this satisfies both readings. The research doc's `Optimise → Validate` feedback loop is deliberately deferred. Unattended iteration means an LLM optimiser rewriting `SKILL.md` repeatedly with no human in the loop, which needs per-iteration snapshots and a hard cap to be safe.
*Rejected:* full bounded control loop (most faithful to SkillOps, biggest time-saver, unsafe without the guards above); strictly manual per keypress (safest, tedious for the common three-gate case); recommended plus opt-in loop (covers both, two execution paths in v1).

**D16.** Bounded queue with batch selection.
Multi-select skills, pick stages, enqueue. Worker pool with configurable limit, default 2. Within one skill stages stay sequential and fail-fast; across skills one failure never blocks the rest. Per-stage timeout preserving the partial log. Mutating stages forced serial regardless of the limit. Queue visible and cancellable.
*Why:* at 1m54s per eval, sweeping 22 skills serially is a ~40-minute wait. The binding constraint on concurrency is LLM rate limits, not CPU, so the default is low and configurable rather than derived from core count.
*Rejected:* strictly one run at a time (trivially correct, uncompressible); bounded queue without batch (22 manual launches per sweep); adding scheduled nightly sweeps (real monitoring surface, needs a scheduler and unattended spend; candidate for later).

**D17 + D18.** Git worktree isolation, sidecar snapshot fallback.
Git repos: mutating stages run against a throwaway worktree; review the diff; approve the merge back. Non-git repos: copy the skill dir to `<run>/snapshot-pre/`, same diff gate, one-key rollback. Both paths present an identical review UI, so the isolation mechanism is an implementation detail the user never thinks about.
*Why:* worktrees give the strongest isolation: the working tree stays untouched until approval. But they cannot serve `~/.claude/skills`, which is 54 skills with no git at all, i.e. most of the author's skills by count. A fallback is mandatory.
*Rejected:* snapshot-only everywhere (uniform, but blends uncommitted user edits with tool edits in one diff); diff-gate with no snapshot (no undo for non-git repos); refusing to mutate non-git repos (one clean mechanism, leaves 54 skills gate-only); offering `git init` at registration (uniform, surprising side effect in a home config dir); shadow mirror repo (one mechanism everywhere, a sync layer that can drift).

### Config and data

**D10.** Single env file, mode 600.
One `~/.skillgantry/.env` in exactly the shape the author supplied, injected into child process environments at spawn. A **redaction filter on the artefact write path** scrubs known secret values from every log and artefact before it reaches disk.
*Why:* every one of these tools already expects env-var configuration, so this is the least surprising and most debuggable option. Redaction is a correctness requirement rather than hardening: SkillGantry persists subprocess stdout into the sidecar, and any tool that echoes its own config would otherwise write the token to a file sitting beside a git repo.
*Rejected:* Keychain for the token with plaintext profile files and TUI-switchable profiles (no plaintext secret at rest, enables provider A/B; declined for simplicity); ambient env only (zero secret custody, drops the "set up once, centrally managed" requirement); age/sops-encrypted profiles (defensible if synced, unreadable config diffs).

**D11.** Provenance snapshot into `run.json`.
At run start, write the resolved, secret-redacted config into `run.json`: base URL host, all five model mappings, and a short hash of the token so a key change is detectable without storing the key. Stats views group and filter by that fingerprint.
*Why:* D10's single global env file means a provider switch silently changes what every subsequent run measures, and skill-up cannot rescue this: its `model_name` field is empty string in all real reports. Without the snapshot, DeepSeek and Claude runs blend into one meaningless trend line. With it, a provider switch appears as a visible boundary.
*Rejected:* env dir with an active symlink plus snapshot (keeps provider A/B with plain env files; reconsider if cross-provider evaluation becomes a real workflow); single file with no snapshot (least code, comparison valid only while the file is never touched); per-repo override merge (useful for client endpoints, adds merge-order rules and a second secret location).

**D12.** SQLite ledger, stateful issues, no cost metric.
`~/.skillgantry/gantry.db` is the queryable source of truth for runs, stages, metrics and findings; the sidecar holds the evidence files it points at. An issue is any normalised finding (lint error, failing eval case, or security finding) carrying a stable fingerprint of (skill, rule id, normalised location) so it survives across runs and across both fan-out tools. State: open / acknowledged / wontfix / fixed, where fixed is set automatically once a later run stops reporting it.

Collectable in v1: stage pass/fail, eval case pass rate, wall-clock per stage, findings by severity, lint errors. **Not collectable: tokens and cost** (skill-up reports zero for both in every real run).
*Why:* fingerprinting is what makes "open issues" a number that means something across two scanners and many runs, and `wontfix` is what stops a noisy scanner rule nagging on every run. Excluding cost is deliberate: a wrong cost number is worse than no cost number.
*Rejected:* derived stateless issues (much less code, cannot suppress false positives); JSON-only with no database (zero dependencies, human-readable, no real querying and a growing startup scan); inferring cost from `~/.claude/projects/*.jsonl` by timestamp-and-cwd matching (supplies the missing dimension, but concurrent Claude Code sessions misattribute).

### UI and sequencing

**D13.** Master-detail work screen plus sibling screens.

```
┌─ SkillGantry ─ zapac-agent-skills ─ [1]Work [2]Dash [3]Issues [4]Tools ┐
│ declawed     ● │ Validate ── Evaluate ── Security ── Optimise ── Release│
│ gap-analysis ○ │    ok         8/10       3 high       ·          ·     │
│ spec-lint    ! │────────────────────────────────────────────────────────│
│ zuhlke-slides○ │ Log │ Findings │ Artefacts │ SKILL.md                  │
│ rfp-daily    ○ │ skillspector: scanning declawed/scripts/scan.py…       │
│                │ cisco: 2 findings (1 high, 1 medium)                   │
└────────────────┴────────────────────────────────────────────────────────┘
```

Left rail: repo switcher plus skill list with per-skill status glyph. Right top: horizontal lifecycle rail, five stages, glyph and last result each. Right bottom: tabbed output pane with tabs Log, Findings, Artefacts, `SKILL.md`. Sibling top-level screens on number keys: Dashboard, Issues, Tools, Settings. Vim-ish keys, `?` help, `:` command palette.
*Why:* the daily action is running a pipeline, so it gets the primary screen, and the skill-list + lifecycle + live-log composition is what makes an orchestrator feel live. Cross-skill views need somewhere to live that is not the work screen.
*Rejected:* full-screen mode per activity (readable at small sizes, far less Ink re-render, loses the live composition); dashboard-first drill-down (good for portfolio monitoring, buries the daily action two levels deep); two-pane with no siblings (smallest surface, nowhere for portfolio stats or the merged issue ledger).

**D19.** Thin vertical slice, then widen.

| Milestone | Content |
|---|---|
| M1 | Engine, adapter contract, **one** adapter (skillspector: installed, read-only, fast, structured output), sidecar writer, ledger, headless `run`. No TUI. |
| M2 | TUI Work screen over that same engine. |
| M3 | Tool manager and setup wizard. |
| M4 | Remaining 7 tool adapters. |
| M5 | Mutating stages with worktree isolation and snapshot fallback. |
| M6 | Dashboard and Issues screens. |

*Why:* M1 tests every cross-cutting assumption (artefact layout, normalisation schema, fingerprinting, provenance snapshot) against real tool output, in CI, on the cheapest possible path. Each milestone is independently useful.
*Rejected:* TUI-first with a fake engine (best final UX, but real tool output is messier than any stub and would force UI rework); adapters-first breadth (retires integration risk earliest, nothing usable for a long stretch, adapter design gets no feedback from its consumers); two parallel slices adding skill-lint at M1 to validate the contract against a second language (**reconsider at M4 planning**, since a Python-shaped abstraction is a live risk given 5 of 9 tools are Python).

---

## 4. Confirmed assumptions

- **A. Distribution.** npm package, invoked as `npx skillgantry`, Node 24 target, pnpm for development. `bun build --compile` single binary deferred.
- **B. Testing.** vitest on the engine. Adapter parsers tested against golden fixtures captured from real runs in `zapac-agent-skills`, not hand-written stubs. `ink-testing-library` for the Work screen.
- **C. Vocabulary.** *Run* = one pipeline execution over one skill. *Stage* = one lifecycle step. *Finding* becomes an *issue* when it enters the ledger. *Sidecar* = `<skill>-workspace/`. *Tool root* = SkillGantry's managed install directory.
- **D. Retire.** Stage 7 sets deprecation metadata and blocks further releases. No registry, no notifications.

---

## 5. Explicit non-goals for v1

- Skill authoring
- The consumer lifecycle: discover, assess, install, use, feedback, update, rollback, remove
- A skill registry or any server component (no SkillHub, no Docker)
- Production runtime telemetry (no Langfuse, no Opik, no Backstage)
- Cost and token metrics (blocked upstream, not by us)
- Unattended optimise/validate looping
- Approval workflows and multi-user governance
- Scheduled or daemonised background sweeps

---

## 6. Open risks

| Risk | Why it matters | Current mitigation |
|---|---|---|
| Adapter contract shaped by Python | 5 of 9 tools are Python; M1 validates against one Python tool only | Revisit at M4 planning; consider pulling skill-lint (TypeScript) forward |
| Ink re-render under heavy log output | Streaming subprocess output is the app's core loop | Ring buffer, ~10fps render throttle, full logs bypass React state |
| Secret leaking into a persisted artefact | Tools receive credentials in env and their stdout is written to the sidecar | Redaction filter on the artefact write path, treated as a correctness requirement |
| Nine polyglot installs across three package managers | Largest onboarding cliff and largest breakage surface | Pinned lockfile, verify-by-invocation, `doctor`, preset bundles |
| Upstream tool immaturity | These projects are new; output schemas will move | Golden fixtures from real runs; adapters degrade to exit code plus raw log when parsing fails |
| Compromised credential | A live DeepSeek token was pasted into the originating conversation | **Rotate the key.** All specs use redacted placeholders |

---

## 7. Amendments after design review

[design-review-r1.md](design-review-r1.md) (2026-08-01) raised eight blocking and four secondary findings. Ten were accepted and fixed inside [requirements.md](requirements.md) and [design.md](design.md) without disturbing any decision above. Four changed a confirmed decision, and are recorded here so the record stays honest about what moved and why.

**A1. Finding identity is merge-first, superseding the message-shape scheme.**
The fingerprint is now `(skillId, path, ruleClass)` with no message component. The review showed that a message-derived discriminator cannot satisfy R8.6: two scanners describing one problem in different words produce different shapes and therefore two issues. Cross-tool merging and per-occurrence separation cannot both hold without a semantic key neither tool provides. Merging wins; occurrences move into the detections table with an ordinal.
*Consequence:* three distinct credential findings in one file become one issue with three detections. The issue count reads as "files with a problem of this class", not "occurrences of it".
*Record correction:* D8 originally specified dedup by file, line and rule class. Revision 1 of the design changed that to message shape without amending this log. This entry closes that gap.

**A2. R7.4 narrowed to streams; artefacts stay in the sidecar.**
Tools write native artefacts themselves, so those bytes never pass through SkillGantry's redaction transform, and redacting a rollback snapshot would destroy byte-exact restore. Rather than route tools through a private staging directory outside the sidecar, R7.4 now covers stdout and stderr only. Native artefacts, snapshots and evidence bundles are unredacted; the workspace root is mode 0700, both workspace patterns are gitignored, and every unredacted artefact is flagged in the stage summary.
*Why this way:* keeping every artefact in the sidecar was the original brief. The staging-directory alternative is recorded as deferred.

**A3. Release tolerates a repo with no `versions.json`.**
D9's dual version bump assumed a repo-root manifest. The 54 skills in `~/.claude/skills` have none. Release now performs the dual write only when `versions.json` exists, and otherwise updates `SKILL.md` alone and records `manifest: none` in the evidence bundle. SkillGantry never creates the file.

**A4. Repo-root skills use an in-repo dotdirectory workspace.**
A sibling `<skill>-workspace/` for a repo-root skill lands outside the repo and cannot be gitignored by it. Such skills use `.skillgantry-workspace/` inside the repo, excluded from the skill digest and from snapshot copies.

---

## 8. Amendments after the second design review

[design-review-2.md](design-review-2.md) (2026-08-01) raised seven blocking and four secondary findings against revision 2. All eleven were accepted. Most were absorbed inside [requirements.md](requirements.md) and [design.md](design.md); the four below changed a confirmed decision.

**A5. Release verifies before it writes.**
D9 ordered the release as apply, then package, then installability check. That released first and validated second: a packaging or install failure had to undo a change already live in the user's repo, and the archive, a required output, sat in neither the mutation scope nor the recovery journal, so an aborted release could leave a zip behind while reporting a rollback. The order is now stage-edits → package in the sandbox → verify install → preview → apply, with the archive in the change set and the journal.
*Also corrected:* "install the zip via vercel `skills`" is not executable. That tool documents git sources and local directories, not archives. Release now extracts the staged archive and installs the extracted directory, which verifies the same bytes a consumer receives regardless of which sources the tool grows.

**A6. M1 owns a slice of the tool manager.**
D19 put the tool manager wholly in M3 while asking M1 to run a real scanner. Those cannot both hold: M1's runner resolves its executable from the lockfile, and nothing in M1 could write one. M1 now builds the `uv-tool` install driver, the lock writer and verify-by-invocation. `npm-prefix`, `gh-release`, presets, the wizard and `doctor` stay in M3. The alternative, a dev-only bootstrap script, was rejected because it leaves the lock contract unexercised by shipped code in the milestone whose entire purpose is validating cross-cutting contracts against real tool output.

**A7. Issue closure is a conjunction over detectors, not a single owner.**
A1 made identity merge-first, so one issue can carry detections from two scanners. D12's closure rule then asked which tool "most recently" detected it — but fan-out tools run concurrently, so two detections from one run have no order, and completion timing decided ownership. Identical runs could disagree on whether an issue closed. Closure now requires every tool that has detected an issue to have since run conclusively without it. Reconciliation scope is likewise derived from what a tool has actually reported, not from what its manifest claims to detect.
*Consequence:* an issue found by both scanners stays open while either is erroring or deselected. That is the intended fail-safe direction, made per-tool and visible rather than arbitrary.

**A8. One candidate manifest defines what a skill is.**
A4's in-repo `.skillgantry-workspace/` put the workspace inside the tree a repo-root skill's tools are pointed at, and revision 2 mitigated that by dropping findings after the scan. Too late: a model-assisted scanner can read a prior run's unredacted artefact and transmit it before SkillGantry sees any finding. A single candidate manifest now defines the skill's bytes for digesting, tool input, snapshotting and packaging, with exact owned-path exclusions rather than basename matching and a symlink rule that holds in every consumer. When the candidate root would contain SkillGantry-owned paths, the manifest is materialised into a private copy and the tool is pointed there — so the exposure is removed by construction rather than filtered afterwards.
*Record correction:* revision 2's digest excluded "any `snapshot-pre/` directory", which would have let a legitimately named skill directory change without invalidating gate evidence.

## 9. Next

Convert the specification set into an implementation plan, M1 first.
