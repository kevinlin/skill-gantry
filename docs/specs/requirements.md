# SkillGantry — Requirements

**Date:** 2026-08-01
**Status:** revision 3, incorporating [design-review-2.md](design-review-2.md)
**Layer:** requirements (layer 1 of 3: requirements → [design](design.md) → plan)
**Traces to:** [decision-log.md](decision-log.md)

Each requirement carries the decision it derives from and, where the check is not self-evident, how to verify it. `MUST` is binding for v1; `MUST NOT` marks an explicit exclusion. Requirements amended in revision 2 are marked *(rev 2)*, in revision 3 *(rev 3)*, each with the review finding that prompted the change. Revision 4 marks *(rev 4)* and carries one change only: M3 planning showed R3.5 unbuildable as written, so it is split into R3.5 and R3.5b.

---

## R1 Scope

- **R1.1** SkillGantry MUST support maintainer lifecycle stages validate, evaluate, security, optimise and release. (D1)
- **R1.2** SkillGantry MUST NOT implement production runtime telemetry, a registry or server component, skill authoring, or the consumer lifecycle. (D1)
- **R1.3** Stage 6 "observe" MUST be satisfied by statistics over runs SkillGantry itself executed, and no other source. (D1)
- **R1.4** Stage 7 "retire" MUST set deprecation metadata on the skill and MUST cause release to refuse. Gates MUST still run against a deprecated skill. (D1, assumption D)
- **R1.5** SkillGantry MUST NOT record token or cost metrics. *(rev 2, finding 10)*
  *Verify:* the metric key type is a closed union containing no token or cost key, an unknown key is rejected at the adapter boundary, and no ledger column or UI surface exposes one.
- **R1.6** `SKILL.md` frontmatter MUST be the authority for a skill's lifecycle state. Ledger lifecycle columns MUST be a derived cache, reconciled to the file on discovery, and release preconditions MUST read the release candidate's frontmatter rather than the ledger. A divergence MUST be reported as drift, not treated as an error. *(rev 3, finding 10)*
  *Rationale:* the file mutation and the ledger transaction cannot be made atomic, so without a named authority a crash between them leaves release behaviour undefined.

## R2 Repos and discovery

- **R2.1** A user MUST be able to register any number of skill repos by path, persisted across sessions. (D4)
- **R2.2** Within a registered repo, a skill MUST be identified as a direct child directory containing `SKILL.md`. Only direct children are examined. (D4)
- **R2.3** Discovery MUST exclude directories matching `*-workspace/`, dotdirectories, and `node_modules`. (D4)
  *Verify:* discovery over `zapac-agent-skills` returns every direct child holding `SKILL.md` — 20 as the repo stands at `e1847a7` — and does not return `agent-insights-workspace/skill-snapshot`. The count is a property of the reference repo at a point in time, so the binding half of this check is the exclusion.
- **R2.4** A repo whose root itself contains `SKILL.md` MUST be treated as a single-skill repo. (D4)
- **R2.5** Discovery MUST read `name` and `metadata.version` from `SKILL.md` frontmatter, and MUST tolerate their absence without failing the scan. (D4)
- **R2.6** Discovery MUST record whether each repo is under git, since that selects the mutation isolation strategy. (D17, D18)
- **R2.7** Repo paths MUST be canonicalised on registration — expanded, symlink-resolved, trailing separator stripped — and a path canonicalising onto an already-registered repo MUST be rejected. *(rev 2, finding 11)*
- **R2.8** Every run MUST record a `skillDigest` computed over the candidate manifest of R2.9 and over nothing else. For a git repo the run MUST additionally record the HEAD commit and whether the skill path is dirty. *(rev 2, finding 8; rev 3, finding 3)*
  *Verify:* editing any tracked byte of the skill changes the digest; writing a new run artefact into the workspace does not; a skill directory legitimately named `snapshot-pre/` is digested.
- **R2.9** SkillGantry MUST define one candidate manifest per skill, an ordered set of file and symlink entries, and MUST use it as the sole authority for which bytes are the skill, across digesting, tool input, snapshotting and packaging. It MUST NOT filter by basename; only exact SkillGantry-owned or repo-control paths may be excluded. *(rev 3, findings 2, 3)*
- **R2.10** A symlink inside a candidate MUST be recorded and preserved as a link and MUST NOT be followed, in every consumer of the manifest. A symlink whose target resolves outside the candidate root MUST be rejected. *(rev 3, finding 3)*
  *Verify:* retargeting an internal link changes the digest without its target being read; an escaping link fails the run with a named error.
- **R2.11** When a candidate root would otherwise contain SkillGantry-owned paths, the manifest MUST be materialised into a private directory and tools MUST be pointed at that copy. Excluding paths after a tool has run MUST NOT be the mechanism that keeps them out of tool input. *(rev 3, finding 2)*
  *Verify:* a canary secret planted in a prior native artefact of a repo-root skill is observable by neither a fixture scanner nor the release archive.
- **R2.12** Any `.gitignore` change R6.6 requires MUST be applied before the run's digest is captured. *(rev 3, finding 3)*

## R3 Tool management

- **R3.1** SkillGantry MUST install tools into a directory it owns, isolated per tool, never into the user's global environment. (D2)
- **R3.2** Installation MUST use each tool's native mechanism: `uv tool install` for Python tools, a private npm prefix for TypeScript tools, GitHub release binary for Go tools. (D2)
- **R3.2a** A `uv-tool` install MUST be relocated into the tool root through the `UV_TOOL_DIR` and `UV_TOOL_BIN_DIR` environment variables, set explicitly on the child rather than inherited. *(rev 3, finding 5)*
  *Rationale:* the previously specified `uv tool install --tool-dir` does not exist in uv 0.7.12 and fails outright.
  *Verify:* an install driver contract test runs against the pinned runtime version, and the install lands nothing in the user's global tool directory.
- **R3.2b** A `gh-release` install spec MUST declare an explicit integrity source: a published checksum asset, a pinned digest, or `none` with a written reason. A mismatch MUST fail the install; `none` MUST be recorded in the lockfile and surfaced by `doctor`. *(rev 3, finding 5)*
  *Rationale:* revision 2 promised checksum verification through a manifest with no field able to carry a checksum.
- **R3.3** The lockfile MUST record, per tool, the requested pin, the resolved version, the **resolved absolute executable path**, the install kind, the integrity outcome, and install and verification timestamps. *(rev 2, finding 10; rev 3, finding 5)*
  *Rationale:* an adapter manifest supplies arguments only; without a resolved executable, `uv-tool` and `gh-release` installs leave the command undefined.
- **R3.4** After installing a tool, SkillGantry MUST verify it by invoking it and capturing its version output; an install that cannot be invoked MUST be reported as failed. (D14)
- **R3.5** SkillGantry MUST ship a catalogue entry for each of the eight tools of D7 — skill-lint and agentskills (validate), skill-up and promptfoo (evaluate), skill-scanner and SkillSpector (security), SkillOpt and SkillHone (optimise) — carrying the install spec, runtime and version argv needed to install, verify and lock it. A catalogue entry MUST NOT be selectable for a run until an adapter supplies its `parse`. Release is a native stage rather than an adapter. (D7, D9) *(rev 4, M3 planning: R4.1 defines an adapter as manifest plus `parse`, so "ship eight adapters" claimed M4's parsers for M3, and R3.5a's tool has no adapter at all.)*
- **R3.5a** SkillGantry MUST additionally install vercel `skills`, which the release stage invokes for the installability check. Nine external tools are therefore installed in total. (D9, R9.6)
- **R3.5b** SkillGantry MUST ship a manifest and `parse` for the seven adapters M1 did not, each fixture-tested per R13.3. *(rev 4, split from R3.5)*
- **R3.6** First-run setup MUST proceed as: probe runtimes → select tools → install and verify → write credentials and register a repo. Each state MUST be independently re-enterable. (D14)
- **R3.7** When a required runtime is missing, SkillGantry MUST display the official install command and MUST NOT install it without explicit confirmation. (D14)
- **R3.8** Tool selection MUST offer Minimal, Recommended and Everything presets in addition to per-stage choice. Every preset MUST include vercel `skills`. (D14)
- **R3.9** A `doctor` action MUST re-verify every tool in the lockfile and report drift, distinguishing missing, unverifiable, version-drift and unlocked tools. (D14)

## R4 Adapters

- **R4.1** Each adapter MUST consist of a declarative manifest and a single `parse` function. (Adapter contract decision)
- **R4.2** The manifest MUST declare id, stage, policy, mutating flag, detectable rule classes, credential requirement, analysis mode, install spec including the binary name, invocation argv, version argv, expected artefacts, and default timeout. (Adapter contract decision)
- **R4.2a** The credential requirement MUST be able to express alternative sets of environment keys and the provider selection each implies. A boolean MUST NOT be used. *(rev 3, finding 6)*
  *Rationale:* SkillSpector accepts any one of four provider credential sets; a boolean cannot name which value is missing or whether the configured provider is usable.
- **R4.2b** An adapter MUST declare the analysis mode it invokes its tool in, that mode MUST be recorded in run provenance, and its declared rule classes MUST cover only that mode. SkillGantry MUST NOT fall back from one mode to another. *(rev 3, finding 6)*
  *Rationale:* two modes cover different rule classes, so a silent fallback makes statistics incomparable.
  *Verify:* a clean-environment smoke test invokes the exact manifest argv with no provider key set and succeeds.
- **R4.3** `parse` MUST receive artefact **contents** rather than paths, and MUST perform no filesystem, process or network access. *(rev 2, finding 10)*
  *Verify:* the adapters test suite runs with filesystem, subprocess and network access stubbed to throw.
- **R4.4** Shared parsers for SARIF and skill-up `v1alpha1` MUST live in the engine so adapters emitting those formats need no bespoke parsing. (Adapter contract decision)
- **R4.5** Adding a tool MUST require no change to the pipeline, runner, ledger or TUI. (Adapter contract decision)
- **R4.6** For the validate and security stages, all selected tools MUST run and their findings MUST be merged. (D8)
- **R4.7** For the evaluate stage, exactly one tool MUST run per stage execution. (D8)
- **R4.8** For the optimise stage, exactly one tool MUST run, and two optimise tools MUST NOT execute concurrently against one skill under any configuration. (D8)
- **R4.9** Each tool in a stage MUST write into its own artefact directory, and the stage summary MUST be written once after every tool has finished. *(rev 2, finding 3)*
  *Verify:* two fixture tools both emitting `findings.sarif` in one fan-out stage each retain their own file and both appear in the stage summary.
- **R4.10** Tool selection MUST be resolved before the lockfile is consulted, and every selected tool MUST produce a result, including `skipped` for a tool that is not installed. A selected tool MUST NOT be silently dropped. *(rev 2, finding 4)*
- **R4.11** A stage whose tool selection is empty MUST be rejected before the run starts. *(rev 2, finding 4)*
- **R4.12** An artefact exceeding the configured size cap MUST yield `errored` and MUST be left on disk unparsed. *(rev 2, finding 10)*
- **R4.13** The mapping from an execution result to a tool outcome MUST be a total, ordered decision table covering at least: parsed with no findings, parsed with findings, non-zero exit with no parseable output, timeout, a missing declared artefact, a parser exception, an oversized artefact, cancellation, not installed, unsatisfied credentials, absent authorisation, and spawn failure. A successful, schema-valid parse MUST be authoritative and the exit code MUST be fallback evidence only. Each row MUST state whether it contributes to issue reconciliation. *(rev 3, finding 7)*
  *Rationale:* linters and scanners exit non-zero precisely because they found something; without this, valid findings become errors and a missing report can read as a pass.
  *Verify:* one test per row, each asserting the reconciliation effect.

## R5 Execution

- **R5.1** Stages validate, evaluate and security MUST chain automatically and MUST halt on the first stage whose outcome is not `passed`. (D6)
- **R5.2** Stages optimise and release MUST NOT execute their write step without authorisation, and the diff MUST be emitted before the write in every mode. In the terminal interface authorisation is interactive confirmation of a displayed diff. In the headless interface `--yes` is prior authorisation, and the diff is emitted to output immediately before the write. *(rev 2, finding 5)*
- **R5.3** Any single stage MUST be runnable in isolation, and any completed stage MUST be re-runnable. (D6)
- **R5.4** SkillGantry MUST NOT loop automatically from optimise back to validate in v1. (D6)
- **R5.5** A user MUST be able to select multiple skills and stages and enqueue them as one batch. (D16)
- **R5.6** A bounded worker pool with a configurable limit, default 2, MUST drain the queue. (D16)
- **R5.7** Mutating stages MUST execute serially regardless of the configured concurrency limit. (D16)
- **R5.8** Failure of one skill's pipeline MUST NOT prevent other queued skills from running. (D16)
- **R5.9** Every tool invocation MUST enforce a timeout, after which the **entire process tree** is killed, the outcome is `errored`, and the partial log is preserved. *(rev 2, finding 12)*
  *Verify:* a fixture process that spawns a grandchild and then hangs leaves no surviving descendant after the timeout fires.
- **R5.10** The queue MUST be visible, and both queued and running jobs MUST be cancellable. (D16)
- **R5.11** Tool and stage outcomes MUST each be a closed set, and the reduction from tool outcomes to a stage outcome MUST be total over every non-empty combination. A stage's verdict MUST be carried as a field of the stage result, not as a metric. *(rev 2, finding 4; rev 3, finding 11)*
  *Verify:* a test enumerates the full Cartesian product of tool outcomes and asserts exactly one stage outcome for each, and a `degraded` stage still reports a verdict.
- **R5.12** The engine MUST expose a command path alongside its event stream, sufficient to resolve a pending mutation by correlation id and to cancel a run or a queued job. *(rev 2, finding 5)*
- **R5.13** Cancellation MUST be defined and implemented for four phases: queued, tool running, awaiting mutation approval, and finalising. A cancelled run MUST still finalise so its partial evidence survives. *(rev 2, finding 5)*
- **R5.14** A pending mutation that is never resolved MUST time out and discard. *(rev 2, finding 5)*

## R6 Artefacts

- **R6.1** All run artefacts MUST be written under `<workspacePath>/skillgantry/runs/<runId>/`. (D5)
- **R6.2** Each stage MUST write a stage summary once, after all its tools complete, alongside one subdirectory per tool containing that tool's stdout log, stderr log and native artefacts. *(rev 2, finding 3)*
- **R6.3** Each run MUST write a `run.json` at its root carrying the run id, skill id, skill digest, git metadata, provenance and tool lock as sibling keys. (D5, D11)
- **R6.4** SkillGantry MUST maintain a `latest` pointer and an append-only `runs/index.ndjson` per skill workspace. Each record MUST be written, newline included, in one write call to an appending descriptor and then fsynced, and a reader MUST discard an invalid or truncated final line rather than failing. SkillGantry MUST NOT claim that appending guarantees a record survives whole. *(rev 2, finding 9; rev 3, finding 9)*
  *Rationale:* POSIX append placement does not guarantee that a record and its terminating newline survive a power failure, so recovery belongs on the reader.
  *Verify:* a file whose final line is truncated mid-record loads every earlier record and the next append does not corrupt it.
- **R6.5** SkillGantry MUST NOT write into, rename, or delete pre-existing `iteration-N` directories; it MAY read them. (D5)
- **R6.6** SkillGantry MUST ensure the repo's `.gitignore` contains both `*-workspace/` and `.skillgantry-workspace/`, adding them if absent. *(rev 2, finding 7)*
- **R6.7** Concurrent runs against one skill MUST NOT lose an index entry, leave `latest` nondeterministic, or collide on a run directory. Run identifiers MUST be claimed by exclusive directory creation rather than assumed unique. `latest` MUST be defined by one stable field, the greatest run identifier among finalised runs, so it is independent of start, finish and lock-acquisition order. *(rev 2, finding 9; rev 3, finding 9)*
  *Verify:* two runs finalising the same skill simultaneously both appear in the index, and two runs whose start and finish order are inverted agree on `latest`.
- **R6.9** The per-skill finalisation lock MUST be released automatically when its holder dies. Where the platform cannot provide that, the lock MUST carry a lease with a defined stale threshold and a documented reclaim path, and a reclaim MUST be logged. *(rev 3, finding 9)*
  *Rationale:* a crashed run must not leave a lock that blocks every future run of that skill.
- **R6.8** The workspace path MUST be defined for both layouts: a sibling `<skill>-workspace/` for a skill in a multi-skill repo, and an in-repo `.skillgantry-workspace/` for a repo-root skill. The workspace directory MUST be excluded from the skill digest and from snapshot copies. *(rev 2, finding 7)*
  *Verify:* a repo-root fixture completes discovery, a read-only stage, snapshot creation and rollback without the snapshot containing a copy of itself.

## R7 Credentials and secret handling

- **R7.1** Credentials MUST be read from a single `~/.skillgantry/.env` in the format the user supplied. (D10)
- **R7.2** SkillGantry MUST warn when that file's mode is more permissive than 600. (D10)
- **R7.3** Credentials MUST be injected into child process environments at spawn and MUST NOT be written to any file by SkillGantry. (D10)
- **R7.4** Every byte of stdout and stderr that SkillGantry writes to disk MUST pass through a redaction filter that replaces known secret values with a placeholder, including values split across chunk boundaries. *(rev 2, finding 2 — narrowed from "every byte written to a sidecar artefact")*
  *Verify:* a fixture tool echoing its full environment to both streams, in fragments, produces logs containing no secret value from `.env`.
- **R7.4a** Artefacts written by a tool itself, snapshot contents and evidence bundles are NOT redacted, because redacting them would corrupt tool output and make byte-exact rollback impossible. Each such artefact MUST be recorded in the stage summary with an explicit unredacted marker. *(rev 2, finding 2)*
- **R7.5** `run.json` MUST record the resolved provenance: base URL host, all five model mappings, and a short hash of the auth token. It MUST NOT record the token itself. (D11)
- **R7.6** Statistics views MUST be groupable and filterable by provenance fingerprint. (D11)
- **R7.7** The workspace root MUST be created with owner-only permissions. *(rev 2, finding 2)*

## R8 Ledger, issues and statistics

- **R8.1** A SQLite database at `~/.skillgantry/gantry.db` MUST be the queryable source of truth for repos, skills, runs, stages, tool runs, issues and detections. (D12)
- **R8.2** Sidecar artefacts MUST remain the evidence the ledger references; the ledger MUST NOT duplicate raw tool output. (D12)
- **R8.3** Every finding MUST be normalised to a rule class, severity, repo-relative path and message, retaining its native rule id and severity as provenance. (D12)
- **R8.4** A finding's fingerprint MUST be derived from skill id, normalised path and rule class only. It MUST NOT include a line number or message text. *(rev 2, finding 6 — supersedes the message-shape scheme)*
  *Verify:* inserting blank lines above a finding leaves its fingerprint unchanged; two tools reporting the same class in the same file produce one fingerprint.
- **R8.5** A native rule id with no mapping MUST fall back to a tool-scoped rule class that can never merge with another tool's findings. (D12)
- **R8.6** The same underlying problem detected by two tools MUST resolve to one issue carrying two detections. (D8)
  *Verify:* paired real SARIF fixtures from both scanners over one fixture skill yield one issue with two detections.
- **R8.7** An issue MUST hold exactly one state: open, acknowledged, wontfix or fixed. (D12)
- **R8.8** An issue MUST be closed automatically only when **every** tool that has detected it has since completed with outcome `passed` or `failed` and not reported it. Closure MUST NOT depend on which detection is most recent, on tool completion order, or on row insertion order. *(rev 2; rev 3, finding 8)*
  *Rationale:* fan-out tools run concurrently, so two detections from one run have no defined order; selecting one owning detector made closure depend on timing.
  *Verify:* a run in which the security tool errors closes zero issues; likewise for a skipped tool; and an issue with two detecting tools closes only once both have reported a conclusive absence, whichever order they finish in.
- **R8.9** Statistics MUST cover, per skill and across repos: stage pass rate, eval case pass rate, wall-clock per stage, open issue counts by severity and rule class, and run history. (D12)
- **R8.10** The issue lifecycle MUST be specified as a total transition table covering first detection, redetection, absence, user acknowledgement, wontfix, recurrence of a fixed issue, and a detecting tool that errored or was skipped. `wontfix` MUST never close automatically. A redetected `fixed` issue MUST reopen. *(rev 2, finding 6)*
- **R8.11** Reconciliation MUST consider issues in state `open` and `acknowledged`. *(rev 2, finding 6)*
  *Rationale:* limiting it to `open` meant an acknowledged issue could never resolve.
- **R8.12** A tool's reconciliation scope MUST include every rule class it has previously produced for that skill, in addition to its declared detectable classes. *(rev 2, finding 6; rev 3, finding 8)*
  *Rationale:* revision 2 added unmapped classes only. A declared set that is merely incomplete leaves a mapped class equally unclosable, so scope is derived from what the tool has actually reported rather than from what it claims to detect.
- **R8.13** A tool reporting several occurrences that resolve to one issue MUST produce one detection row per occurrence. *(rev 2, finding 6)*
- **R8.14** Extending the rule-class map MUST be an explicit, versioned migration that recomputes affected fingerprints, merges colliding issues, re-parents detections, retains the strongest state, and records a note. It MUST NOT happen implicitly. *(rev 2, finding 6)*

## R9 Release

- **R9.1** When the repo contains a root `versions.json`, release MUST update `metadata.version` in `SKILL.md` and that manifest entry in one operation, and MUST refuse when the two already disagree. When no `versions.json` exists, release MUST update `SKILL.md` alone and record that the repo has no manifest. SkillGantry MUST NOT create a `versions.json`. *(rev 2, finding 8)*
  *Rationale:* the 54 skills in `~/.claude/skills` have no manifest; the original wording made release undefined there.
- **R9.2** Release MUST refuse to proceed when the two versions already disagree, reporting both values. (D9)
- **R9.3** Release MUST write a changelog entry for the new version at `<skillDir>/CHANGELOG.md`, creating the file if absent. *(rev 2, finding 8)*
- **R9.4** Release MUST produce an archive at `<repoRoot>/<skillName>_<version>.zip`, whose contents are exactly the candidate manifest of R2.9. The archive MUST be built in a staging location, MUST be part of the reviewed change set and the apply journal, and MUST be removed by a rollback. *(rev 2, finding 8; rev 3, findings 1, 2)*
  *Verify:* an aborted release leaves no archive at the repo root and no modified live file.
- **R9.5** Release MUST write an evidence bundle into the sidecar containing the validate result, eval report, merged security findings, the tool lockfile, the skill digest, the candidate manifest, the archive SHA-256 and the manifest mode. *(rev 2, finding 8; rev 3, finding 1)*
- **R9.6** Release MUST verify installability by extracting the staged archive into a temporary directory and installing **that directory** via vercel `skills`, non-interactively, into an isolated destination, and MUST fail if it does not resolve. *(rev 3, finding 1)*
  *Rationale:* vercel `skills` documents git sources and local directories, not zip archives, so installing the archive directly is not executable as specified. Extracting first verifies the same bytes a consumer receives.
- **R9.6a** Packaging and installability verification MUST complete before any write to the user's working tree. *(rev 3, finding 1)*
  *Rationale:* revision 2 applied first and verified afterwards, so a failing gate had to undo a release that was already live.
- **R9.7** Release MUST NOT create a git commit or tag as part of applying the change. Committing and tagging MUST be a separate confirmed action. (D9)
- **R9.8** Release MUST refuse when the skill's most recent gate outcomes are anything other than `passed`, or when the skill is deprecated. (Failure-policy decision, R1.4)
- **R9.9** Release MUST refuse unless the skill digest recorded by each passing gate run equals the release candidate's current digest. *(rev 2, finding 8)*
  *Verify:* passing all gates, editing the skill, then releasing is rejected with a digest-mismatch error.
- **R9.10** The target version MUST be supplied explicitly, as a semantic version or as a bump level applied to the current frontmatter version. It MUST NOT be inferred. *(rev 2, finding 8)*
- **R9.11** Release MUST be expressed as an explicit state machine with a defined abort path from every state. *(rev 2, findings 1, 8)*

## R10 Mutation safety

- **R10.1** Before any mutating stage, SkillGantry MUST establish an isolation sandbox over a **declared path scope**, which MAY include paths outside the skill directory such as the repo-root manifest. *(rev 2, finding 1)*
  *Rationale:* a sandbox scoped to the skill directory cannot express a release.
- **R10.2** For a git-backed repo, the sandbox MUST be a detached git worktree, and tools MUST operate inside it rather than the user's working tree. (D17)
- **R10.3** For a git-backed repo, SkillGantry MUST refuse to run a mutating stage against a skill directory with uncommitted changes unless the user overrides. When overridden, the sandbox MUST be seeded with the current working-tree bytes of every dirty scope path and MUST record their preimage. *(rev 2; rev 3, finding 4)*
  *Rationale:* the worktree starts at HEAD, so without seeding, an overriding user has the tool read stale bytes and the later apply silently overwrite their uncommitted work.
  *Verify:* a dirty override presents the user's bytes to the tool and reverses cleanly.
- **R10.4** For a repo not under git, the sandbox MUST copy every declared scope path to `snapshot-pre/` within the run directory before any write, preserving file modes and links, and applying the candidate manifest's exclusions. *(rev 2, findings 1, 7; rev 3, findings 2, 3)*
- **R10.5** Both sandbox strategies MUST expose one interface and present an identical review to the user. (D18)
- **R10.6** Rollback MUST restore every path in the declared scope to its pre-stage state. (D17, D18)
- **R10.7** Applying a mutation MUST NOT create a git commit. (D6, D9)
- **R10.8** The change set presented for review MUST represent additions, deletions, renames, mode changes and binary files, not only textual modifications to existing files. *(rev 2, finding 1)*
  *Verify:* a fixture mutation performing each of those five kinds is fully represented in the change set and fully reversed by rollback.
- **R10.9** Applying a multi-file mutation MUST write a journal recording prior content before any target is modified, and MUST support compensating rollback from that journal after an interrupted apply. SkillGantry MUST NOT claim atomicity across files. *(rev 2, finding 1)*
  *Verify:* a crash injected between journal write and final rename is recovered on next launch with every file restored.
- **R10.10** Before a mutating tool starts against a sandbox that lets it write the live tree, SkillGantry MUST write an active-sandbox record naming the scope and the restore source, and startup MUST detect an unresolved record and offer restoration. *(rev 3, finding 4)*
  *Rationale:* the apply journal exists only from apply onward, so a crash during tool execution or while awaiting approval left a partially modified tree with no recovery marker.
  *Verify:* a crash during the mutating tool, and a crash while awaiting approval, are both recovered on next launch.
- **R10.11** Immediately before applying, SkillGantry MUST recheck each target's current content against the preimage captured when the change set was built, and MUST abort naming the drifted paths on any mismatch. *(rev 3, finding 4)*
  *Verify:* an edit made between diff preview and approval aborts the apply instead of being overwritten.

## R11 Terminal interface

- **R11.1** The Work screen MUST present, simultaneously: the repo and skill list with per-skill status, the five-stage lifecycle rail for the selected skill, and an output pane. (D13)
- **R11.2** The output pane MUST offer Log, Findings, Artefacts and `SKILL.md` views. (D13)
- **R11.3** Dashboard, Issues, Tools and Settings MUST be reachable as top-level screens. (D13)
- **R11.4** Live tool output MUST NOT be held in component state line by line; it MUST pass through a bounded ring buffer flushed on a fixed interval. (D3)
  *Verify:* a tool emitting 10,000 lines in 5 seconds does not degrade input responsiveness.
- **R11.5** The full, unbounded log MUST be available on disk even when the in-memory buffer has discarded earlier lines. (D3)
- **R11.6** The queue MUST be visible from the Work screen with per-job cancellation. *(rev 2, finding 5)*

## R12 Headless interface

- **R12.1** `skillgantry run <skill> --stage <list>` MUST execute the same pipeline as the TUI and write the same artefacts. (D15)
- **R12.2** It MUST exit non-zero when any executed stage outcome is not `passed`. (D15)
- **R12.3** It MUST support machine-readable output via `--json`. (D15)
- **R12.4** A mutating stage MUST be skipped unless `--yes` is supplied. With `--yes`, the diff MUST be emitted to output immediately before the write. *(rev 2, finding 5)*
- **R12.5a** `doctor` MUST be available as a headless subcommand. *(rev 2, finding 11; split in rev 3, finding 11)*
- **R12.5b** `release` MUST be available as a headless subcommand. *(rev 2, finding 11; split in rev 3, finding 11)*
  *Rationale:* the two land in different milestones, and a requirement with two owners defeats the ownership table.

## R13 Structure, quality and distribution

- **R13.1** The engine MUST NOT depend on the terminal interface; the dependency MUST be one-directional and enforced automatically. (D15)
  *Verify:* a lint rule fails the build on any import from `core` into `tui` or `cli`.
- **R13.2** The engine MUST communicate progress through a typed event stream rather than by writing to stdout. (D15)
- **R13.3** Adapter parsers MUST be tested against fixtures captured from real tool runs at the pinned versions, not hand-authored samples. Fixture capture MUST be scripted so fixtures and pins cannot drift apart. *(rev 2, drift)*
- **R13.4** Fingerprint stability, the full issue transition table, reconciliation under an errored tool, and the cross-tool merge contract MUST each have dedicated tests. *(rev 2, findings 6, 12)*
- **R13.5** SkillGantry MUST be distributable as an npm package runnable via `npx`, targeting Node 24. (Assumption A)
  *Verify:* `npm pack` output installs into a clean prefix in CI and `skillgantry --version` runs from it.
- **R13.6** Every P1 finding in either design review MUST have a corresponding contract test. *(rev 2, finding 12; rev 3)*
- **R13.7** Requirement-to-milestone ownership MUST exist in exactly one document, and requirement-to-design-section coverage MUST be checked mechanically. A requirement owned by no milestone, owned by two, claimed by no design section, or claimed by a section but absent from this document MUST fail the build. *(rev 3, finding 11)*
  *Rationale:* two hand-maintained tables drifted, so the matrix produced to fix the first review's coverage gap became unreliable as a planning input.

---

## Milestone ownership

**This table is the single authority for milestone ownership.** [design.md §17](design.md) maps requirements to design sections and deliberately carries no milestone column; revision 2 duplicated the mapping in both documents and the two disagreed. Derived from D19. Exactly one milestone owns each requirement.

| Milestone | Requirements owned | Exit criteria |
|---|---|---|
| M1 | R1.1–R1.3, R1.5, R2, R3.1, R3.2a, R3.3, R3.4, R4.1–R4.5, R4.9–R4.13, R5.1, R5.9, R5.11, R6.1–R6.6, R6.8, R7.1–R7.5, R7.7, R8.1–R8.8, R8.10–R8.14, R12.1–R12.3, R13.1–R13.7 | `skillgantry run <skill> --stage security --json` writes a complete run directory and populates the ledger, driven by a **managed** SkillSpector the tool root installed and verified; a whitespace-only edit changes no fingerprint; a directory named `snapshot-pre/` is digested; an errored tool closes no issue; every row of the R4.13 table is asserted; no secret appears in any log; a hanging grandchild process is killed on timeout; the packed npm artefact runs from a clean prefix |
| M2 | R5.3–R5.8, R5.10, R5.12–R5.14, R6.7, R6.9, R11.1–R11.2, R11.4–R11.6 | Work screen renders live state over the M1 engine without changing any M1 interface — the queue, command path and per-skill locking that M2 adds are additive; two concurrent runs on one skill finalise without loss and agree on `latest` under inverted finish order; a dead holder's lock is reclaimed; cancellation works in all four phases |
| M3 | R3.2, R3.2b, R3.5, R3.5a, R3.6–R3.9, R12.5a | A clean machine reaches a verified toolchain through the wizard alone; doctor reports all four drift kinds plus integrity and lifecycle drift |
| M4 | R3.5b, R4.6–R4.8 | Fan-out merges findings from both scanners into single issues with two detections; colliding filenames both survive; closure waits for both detectors |
| M5 | R1.4, R1.6, R5.2, R9, R10, R12.4, R12.5b | Both sandbox strategies pass apply, rollback and crash-recovery tests over all five change kinds, plus a crash during the mutating tool and one while awaiting approval; the dirty-skill guard holds and its override seeds correctly; preimage drift aborts; digest mismatch blocks release; the no-manifest path releases correctly; a packaging or installability failure leaves no repo-root archive and no live file change |
| M6 | R7.6, R8.9, R11.3 | Dashboard and Issues render ledger queries across all registered repos |

Every requirement has exactly one owner, and the table is machine-checked under R13.7 — ranges expand in document order, and a requirement claimed twice or not at all fails the build. The M1/M3 split of tool management is expressed as separate requirements (R3.1, R3.2a, R3.3, R3.4 in M1; R3.2, R3.2b and the rest in M3) rather than as prose qualifying a shared id, because a qualifier is not checkable.

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
- Routing tool output through a private staging directory so native artefacts can be redacted (design review finding 2, declined in favour of keeping every artefact in the sidecar)
