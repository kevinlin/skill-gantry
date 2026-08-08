# SkillGantry — Requirements

**Date:** 2026-08-01
**Status:** revision 3, incorporating [design-review-r2.md](design-review-r2.md)
**Layer:** requirements (layer 1 of 3: requirements → [design](design.md) → plan)
**Traces to:** [decision-log.md](decision-log.md)

Each requirement carries the decision it derives from and, where the check is not self-evident, how to verify it. `MUST` is binding for v1; `MUST NOT` marks an explicit exclusion. Requirements amended in revision 2 are marked *(rev 2)*, in revision 3 *(rev 3)*, each with the review finding that prompted the change. Revision 4 marks *(rev 4)* and carries one change only: M3 planning showed R3.5 unbuildable as written, so it is split into R3.5 and R3.5b. Revision 6 marks *(rev 6)* and likewise carries one: a shipped run proved R4.13's table failed a gate on an advisory, so the table gains a severity fail floor. Revision 8 marks *(rev 8)* and adds R11.7 and R11.8: M6 shipped Settings read-only and recorded the reason as "no requirement asking for one", which is the gap these two close. Revision 9 marks *(rev 9)* and adds R6.10, R11.9 and R12.6: a failed security run left the user with a finding list and no next step, and both its findings were unsafe to apply mechanically, so the deliverable is a generated coding-agent prompt rather than a fixer. Revision 10 marks *(rev 10)* and carries one change: the Work screen was a pure function of the session's event stream, so a relaunch against a skill with recorded runs showed nothing, which R11.10 closes. Revision 11 marks *(rev 11)* and adds R4.14, R4.15, R6.11 and R8.15, amending R4.13 in place: a security run failed a gate on a finding the user had accepted in the skill's own SkillSpector baseline file, because SkillGantry never passed the tool its baseline flag and had nowhere to put the suppression the tool reports back. Revision 12 marks *(rev 12)* and adds R11.11–R11.15, amending R11.9 in place: the Work screen had taken four extensions without one pass over the assembled frame, so it listed what was wrong with a skill and offered no way to act on it, put every statistic behind leaving the screen, and scoped one movement key to the focused panel while two others ignored it.

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
- **R3.5** SkillGantry MUST ship a catalogue entry for each D7 tool that a public index publishes in installable, skill-directory-driven form — skill-lint (validate), skill-up (evaluate), skill-scanner and SkillSpector (security) — carrying the install spec, runtime and version argv needed to install, verify and lock it. A D7 tool that no index publishes, or that cannot take a skill directory as its input, MUST be omitted from the catalogue with its probe output recorded rather than carried as an entry that can only fail. A catalogue entry MUST NOT be selectable for a run until an adapter supplies its `parse`. Release is a native stage rather than an adapter. (D7, D9) *(rev 4, M3 planning: R4.1 defines an adapter as manifest plus `parse`, so "ship eight adapters" claimed M4's parsers for M3, and R3.5a's tool has no adapter at all.)* *(rev 5: agentskills, SkillOpt and SkillHone unpublished — plan-m3.md; promptfoo needs a per-skill config no repo has — decision-log §10.)*
- **R3.5a** SkillGantry MUST additionally install vercel `skills`, which the release stage invokes for the installability check. Nine external tools are therefore installed in total. (D9, R9.6)
- **R3.5b** SkillGantry MUST ship a manifest and `parse` for every catalogued tool a stage can select, each fixture-tested per R13.3. As the catalogue stands that is three beyond M1's skillspector — skill-lint (validate), skill-up (evaluate) and skill-scanner (security). A catalogued tool that no stage selects, which today is vercel `skills`, MUST NOT have an adapter. *(rev 4, split from R3.5; rev 5, M4 planning: "the seven adapters M1 did not" counts four tools that have no installable, skill-directory-driven implementation — agentskills, SkillOpt and SkillHone are unpublished per plan-m3.md, promptfoo needs a per-skill config per decision-log §10. A requirement stated as a count goes wrong every time the catalogue moves, so it is stated as a rule over the catalogue instead.)*
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
- **R4.13** The mapping from an execution result to a tool outcome MUST be a total, ordered decision table covering at least: parsed with no findings, parsed with an unsuppressed finding at or above the fail floor, parsed with unsuppressed findings all below the fail floor, parsed with findings of which none are unsuppressed, non-zero exit with no parseable output, timeout, a missing declared artefact, a parser exception, an oversized artefact, cancellation, not installed, unsatisfied credentials, absent authorisation, an aborted mutation apply, and spawn failure. A successful, schema-valid parse MUST be authoritative and the exit code MUST be fallback evidence only. Each row MUST state whether it contributes to issue reconciliation. *(rev 3, finding 7)*
  A tool outcome MUST be `failed` only when an unsuppressed finding reaches a fail floor over normalised severity. The floor MUST be `medium`, MUST be a constant rather than configuration, and MUST NOT be derived per tool. A finding below the floor MUST be retained, recorded and reconciled exactly as one above it. *(rev 6, run `019fc2e4`: skill-lint exited 0 calling the skill `SAFE`, reported two `LOW` advisories against the skill's own scripts, and R5.1 halted the lifecycle on a tool that had found nothing wrong.)*
  A mutation apply that aborts after authorisation MUST be a row of this table. *(rev 7, M5 planning: R10.11 requires an apply to abort naming the drifted paths, and no `ErrorKind` described that state, so the abort propagated out of the pipeline as an unhandled rejection and the run lost the partial evidence R5.13 requires it to keep. R4.13's enumeration is prefixed "at least", so the table gains a row rather than the requirement gaining a suffixed id that would need its own milestone owner under R13.7.)*
  A finding the tool itself reports as suppressed (R4.15) MUST NOT reach the fail floor, and a parse whose findings are all suppressed MUST be its own row yielding `passed`. Both rows MUST contribute to reconciliation exactly as their unsuppressed counterparts do. *(rev 11, run `019fd2d8`: the user had accepted two findings in `declawed`'s own baseline file 76 seconds before the run, and the stage failed on one of them anyway. rev 7's precedent applies — the enumeration is "at least", so the table gains rows rather than the requirement gaining suffixed ids.)*
  *Rationale:* linters and scanners exit non-zero precisely because they found something; without this, valid findings become errors and a missing report can read as a pass. Revision 3's table then read "findings present" with no severity dimension, so an advisory failed a gate as hard as a critical. `medium` and not `high` because SARIF `warning` normalises to `medium` and is also the fallback for a result carrying no level, and a failing eval case is `medium` — a higher floor would pass most scanner findings and every failing eval case. Configurable or per-tool would make two runs of one tool incomparable in the ledger.
  *Verify:* one test per row, each asserting the reconciliation effect; and a `low`-only report from a tool exiting 0 yields `passed` with every finding still filed as an open issue, which still closes on a later run that does not report it.
- **R4.14** A manifest MUST be able to declare argument groups appended only when a named path exists, in the same substitution vocabulary as `invoke.argv`. The existence test MUST be performed by the stage executor against the substituted, tool-facing path, and MUST NOT be performed by the adapter. *(rev 11)*
  *Rationale:* R4.3 forbids an adapter touching the filesystem, and the path a tool is handed is not the path the manifest names — the mutation sandbox re-roots it and a repo-root skill is handed a materialised candidate copy — so only the executor can answer the question, and only after substitution.
  *Verify:* absent with no such file; present carrying the materialised-candidate path for a repo-root skill; absent when a directory sits at that path.
- **R4.15** A finding a tool reports as suppressed MUST cross the parse boundary as a finding annotated with the tool's justification. It MUST NOT be dropped, MUST NOT be moved to a separate collection, and MUST NOT contribute to the fail floor. *(rev 11)*
  *Rationale:* dropping it in the parser makes the tool look as though it reported nothing, which closes the issue as `fixed` and leaves the Issues screen unable to tell an accepted false positive from a real fix. A separate collection fails silently in the other direction: a consumer that forgets to read it never files those findings, so R8.8 sees them absent and closes them.
  *Verify:* an empty `suppressions` array and an absent one are both unsuppressed; a suppressed critical yields `passed` with the finding still filed and reconciled.

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
- **R6.10** A stage that produced at least one finding MUST write a coding-agent fix prompt beside its stage summary, naming the skill directory, the repo root, the commit and dirty flag, the skill digest, every tool report, the stage summary, and each finding's severity, rule class, native rule id, location and message. The prompt MUST instruct the agent to read the tool's own report before editing and to judge each finding's validity, MUST instruct it to stop and report rather than change code it judges correct, and MUST forbid any write under a workspace directory. SkillGantry MUST NOT apply the prompt itself. *(rev 9)*
  *Rationale:* the normalised finding record carries six fields, so the SARIF `properties` a scanner uses to explain, qualify and remediate a finding never reach the ledger; and both findings in run `019fcd9e` were unsafe to apply — one named a frontmatter field the schema does not have, the other flagged alignment whitespace inside a regex.
  *Verify:* a zero-finding stage writes no prompt; a stage that passed under the R4.13 sub-floor row writes one; the prompt names the user's real skill directory rather than a materialised candidate or a sandbox.
- **R6.11** A fix prompt MUST omit suppressed findings and MUST name how many it omitted. A stage whose every finding is suppressed MUST NOT write one. *(rev 11)*
  *Rationale:* the one instruction a prompt must never give a coding agent is to fix the thing the user has already ruled on. Sub-floor findings are not suppressed, so R6.10's "a `passed` sub-floor stage writes one" is untouched.
  *Verify:* a fully suppressed stage writes none; a mixed stage numbers its survivors from 1 and names the omitted count.

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
- **R8.15** The skill's own suppression file MUST be the authority, and ledger suppression columns MUST be a derived cache recomputed on every conclusive tool run and cleared by the same run that observes the finding unsuppressed. A suppressed finding MUST be recorded as **reported**, MUST NOT close its issue, MUST NOT alter its issue state, and MUST retain its detections, occurrence count and severity. An issue MUST read as suppressed only when every tool still reporting it reports it suppressed. Open issue counts MUST exclude suppressed issues; issue listings MUST NOT. *(rev 11)*
  *Rationale:* the same reasoning as R1.6 — the file edit and the ledger transaction cannot be made atomic, so the file is named the authority and the ledger is a cache. Recording a suppressed finding as absent instead would advance every detector's absence, close the issue as `fixed`, and silently close an issue the user had acknowledged. `wontfix` was rejected as the mechanism because it is sticky by design (R8.10), so deleting a baseline entry would leave the issue suppressed forever. Counts exclude and listings do not because a decided issue should not inflate the Dashboard, while hiding a suppression from the audit surface makes it unfalsifiable.
  *Verify:* a suppressed sighting advances `last_seen_run` and closes nothing; the next unsuppressed sighting clears the columns with `first_seen_run`, occurrence count and detections intact; two fan-out detectors with one suppressing leave the issue unsuppressed in either finish order; an errored or skipped tool run changes neither column.

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
- **R11.7** The Settings screen MUST show every setting SkillGantry reads, its current effective value, the file that holds it, and whether that value came from the file, from a built-in default, or from a session override. *(rev 8)*
  *Rationale:* config loading substitutes a default for every absent key, so a number on screen carrying no origin cannot be told apart from one the user wrote, and a user editing the wrong file to change it is the predictable result.
  *Verify:* with no `config.json` on disk every execution row reads as a default; writing one key changes that row and no other; launching with `--concurrency` shows the session value beside the stored one.
- **R11.8** A user MUST be able to edit every field of the configuration file from the terminal interface, other than its schema version. Edits MUST be staged rather than written per keystroke; the resulting change set MUST be displayed and confirmed before any write; and applying MUST validate the whole document against the config schema and write it once. Tool selection and repo registration MUST reuse the R3.6 setup states rather than a second implementation of either. An applied change MUST NOT alter the configuration of a run already queued or in flight, and the change set MUST name each field whose new value takes effect only on the next launch. Credentials MUST NOT be editable, and no credential value may appear in a change set. *(rev 8)*
  *Rationale:* R7.3 keeps credential values out of every file SkillGantry writes, and a confirmation screen is not an exception. Runs are rebound to no new configuration mid-flight because a run's recorded provenance and tool lock are only true of the configuration it was planned under. Reuse of the setup states is required rather than encouraged: a second selection path would let the wizard and the screen disagree about which tools a stage may run, and R3.5b already makes that disagreement fail every run of that stage.
  *Verify:* discarding a staged edit leaves the file byte-identical; applying rewrites it once and the screen re-reads it from disk; a value the schema rejects cannot be staged and its rejection is shown; the credential rows offer no edit action; a run enqueued before an apply completes under the configuration it started with.
- **R11.9** The Work screen MUST offer one key that copies the selected stage's R6.10 fix prompt to the system clipboard via OSC 52, and MUST display the prompt's path whether or not the copy was emitted, naming which unavailable case applies when it was not: no recorded run, the stage reported nothing, or the prompt is not on disk. *(rev 10: R11.10 rehydrates a recorded run, so "no run this session" no longer describes the state it named — a run on disk is now presented — and the `skillgantry fix` command line it offered as a fallback would itself exit non-zero in the case that remains.)* The action MUST NOT change any panel's row allocation. *(rev 9)*
  The stage MUST be the one that produced the selected finding whenever the Findings pane holds a selection, and the lifecycle rail's selected stage otherwise. *(rev 12: R11.14 gives each finding its stage, which is the attribution rev 9 recorded as unavailable — a user acting on a finding should not have to move the rail to the stage that found it. §9.4 writes one prompt per stage, so the prompt copied is still a stage's.)*
  *Rationale:* Terminal.app, and tmux without passthrough enabled, discard OSC 52 silently, so an action that can only report success is one the user cannot trust; showing the path always leaves a working fallback. The row-allocation clause is §14.1's budget: a permanent hint row is what that rule exists to stop.
  *Verify:* the emitted sequence carries the base64 of the file's bytes; the path is shown in each of the three unavailable cases; the frame's row count is unchanged by the keypress, at 80×24 and at 50×14; with a finding selected the prompt copied is that finding's stage's, whatever the rail points at.
- **R11.10** On selecting a skill, the Work screen MUST present that skill's most recently recorded run without a run having been started in the session: the lifecycle rail's per-stage outcome and summary, the findings list, the artefact list, and the run's recorded tool output in the Log view. It MUST read them from the run's sidecar evidence rather than the ledger, per R8.2, and MUST NOT write to the sidecar. A run started or completed in the session MUST take precedence, and a recorded run MUST NOT overwrite one. Recorded output MUST be held per skill and MUST NOT be written into the R11.4 buffer, so that a skill with no run this session can never display another skill's live output. A replayed log MUST obey the same bound and report what it dropped, as R11.4 and R11.5 require of a live one. *(rev 10; the Log view added after a shipped run showed the pane naming a directory beside four panes that had loaded, which read as a failure to load rather than as a scope boundary.)*
  *Rationale:* the Work screen was a pure function of the session's event stream, so relaunching against four recorded runs showed an empty rail, an empty findings list, an empty artefact list, and refused `y` naming a case that no longer describes the state. The per-skill clause is what makes the Log view answerable at all: the live buffer is session-wide, so seeding it would show whichever skill last ran.
  *Verify:* a session that has enqueued nothing renders the selected skill's last stage outcomes, findings and tool output; a stage that run did not execute still reads `·`; a run started in the session is not replaced when the selection leaves and returns; with one skill's run live, selecting a second skill shows the second's recorded output and not the first's live output; the sidecar is byte-identical after selection.
- **R11.11** The Work screen MUST present exactly three focus zones — the skill list; the lifecycle rail together with the output pane; the queue — cycled in the order they sit on the screen by one key. Every movement and marking key MUST act on the focused zone alone: the vertical pair, the horizontal pair, and the mark key. A key with no meaning in the focused zone MUST do nothing rather than act on another zone. Screen-level keys MUST stay available in every zone. *(rev 12)*
  *Rationale:* the horizontal pair fired in every zone, so moving down the skill list moved the rail at the same time with no mode saying so — and the rail describes the *selected* skill, so moving both at once is how a user loses track of which stage they are reading. The rail and the output pane are one zone because the two key pairs already tell them apart inside it; a stop whose only job is to disambiguate keys that were never ambiguous is paid for on every cycle.
  *Verify:* from the skill list the horizontal pair leaves the rail's selection unchanged; the mark key marks a skill in the first zone and a stage in the second; the cancel key acts only on the queue's selection; cycling from the queue returns to the skill list.
- **R11.12** The Work screen MUST present aggregate statistics beside the skill list when, and only when, the terminal has rows to spare after the skill list's own minimum. It MUST degrade by dropping content through a fixed set of named tiers ending in absence, never by truncating a tier, and the tier MUST be chosen in the single place pane sizes are decided. Each tier MUST render exactly the rows it was allocated. *(rev 12)*
  *Rationale:* the card competes for rows, not columns, so a width band is the wrong test — a wide, short terminal has cells to spare and no rows. Choosing the tier inside the layout function is what lets every boundary be asserted without rendering a frame, which is the same reason §14.1 put the pane heights there.
  *Verify:* the tier chosen at every size from the minimum upward leaves the skill list at or above its minimum; dropping to a smaller tier returns exactly the rows it gave up to the list; the card is absent whenever no tier fits; and at no size does the frame exceed the terminal's rows. The assertions are over the layout function, not over a named size, because a change to what the chrome costs would otherwise move the boundary and break a test that was describing arithmetic rather than a rule.
- **R11.13** The output pane MUST offer a view of the ledger's issues whose scope is cyclable between the selected skill, that skill's repo, and every registered repo. It MUST NOT offer issue state transitions, which stay on the Issues screen. That view and the Issues screen MUST derive their rows from one function. *(rev 12)*
  *Rationale:* one issue rendered two ways by two modules is the divergence recorded from when five modules each owned severity colour and `low` read gray on two screens and cyan on a third. Transitions stay on the screen because the pane's open-report key already means something else — one pane whose key means two things across two of its own tabs is a keymap that cannot be learned.
  *Verify:* the three scopes resolve to the ledger's existing per-skill, per-repo and unfiltered queries; a transition key pressed on the tab changes no issue; the tab and the screen render one issue identically.
- **R11.14** Every finding the Work screen holds MUST carry the stage and the tool that produced it. The Findings view MUST offer a per-finding selection, and MUST present for the selected finding alone its message, rule class, native rule id, the path of the report its tool wrote, and the tool's suppression justification when there is one. It MUST offer one key that opens that report through the host's default viewer. The detail MUST be counted against the view's row allocation. SkillGantry MUST NOT author or apply a fix for a finding. *(rev 12)*
  *Rationale:* R6.10's, at the screen: the normalised record carries six fields, so the SARIF `properties` a scanner uses to explain, qualify and remediate a finding never reach a surface at all — the tool's own report is where they are, so reaching it is the screen's job. The final clause restates R6.10 here so that a per-finding action row cannot quietly acquire a fixer, which is what the design study it derives from proposed.
  *Verify:* a finding's stage and tool survive into its row; the detail rows sit inside the allocation at 80×24 and at 50×14; the report is opened through an injected port, so no test spawns; no key on the view writes to the skill.
- **R11.15** The terminal interface MUST NOT set a body foreground colour and MUST NOT set any background colour. Emphasis MUST be carried by bold, by reverse video, or by a colour on a token that names a state. A row rendered in reverse video MUST be padded to its pane's inner width before the attribute is applied. *(rev 12)*
  *Rationale:* SkillGantry inherits the terminal's own two colours, which is the whole reason it reads on a light theme; naming a body foreground breaks it for every user whose background is not the one the palette assumed. Reverse video swaps that inherited pair rather than replacing it, so it is the one emphasis that cannot collide with a theme. The padding clause is Ink's behaviour: the attribute covers only the characters actually rendered, so an unpadded short row highlights a stub instead of a band.
  *Verify:* no colour is set on a body text node carrying no state; a selected row's highlight spans the pane's inner width; the frame stays legible with the terminal's background set light and set dark.

## R12 Headless interface

- **R12.1** `skillgantry run <skill> --stage <list>` MUST execute the same pipeline as the TUI and write the same artefacts. (D15)
- **R12.2** It MUST exit non-zero when any executed stage outcome is not `passed`. (D15)
- **R12.3** It MUST support machine-readable output via `--json`. (D15)
- **R12.4** A mutating stage MUST be skipped unless `--yes` is supplied. With `--yes`, the diff MUST be emitted to output immediately before the write. *(rev 2, finding 5)*
- **R12.5a** `doctor` MUST be available as a headless subcommand. *(rev 2, finding 11; split in rev 3, finding 11)*
- **R12.5b** `release` MUST be available as a headless subcommand. *(rev 2, finding 11; split in rev 3, finding 11)*
  *Rationale:* the two land in different milestones, and a requirement with two owners defeats the ownership table.
- **R12.6** A fix prompt MUST be obtainable headlessly for a recorded run, defaulting to the most recent finalised run of the named skill and accepting an explicit run id and stage. The command MUST NOT write to the user's repo or to the sidecar. Its exit code MUST report whether a prompt was produced, not whether the skill passed. *(rev 9)*
  *Rationale:* R12.2 binds `run`'s exit code to stage outcomes, and reusing that meaning here would make a clean skill indistinguishable from a failed lookup. Not writing is what lets the command answer for runs recorded before R6.10 existed without rewriting their evidence.
  *Verify:* the sidecar is byte-identical after the command; a run recorded with findings but no prompt file still yields one; a run with no findings anywhere exits non-zero saying so.

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
| M2 | R5.3–R5.8, R5.10, R5.12–R5.14, R6.7, R6.9, R11.1–R11.2, R11.4–R11.6, R11.10 | Work screen renders live state over the M1 engine without changing any M1 interface — the queue, command path and per-skill locking that M2 adds are additive; two concurrent runs on one skill finalise without loss and agree on `latest` under inverted finish order; a dead holder's lock is reclaimed; cancellation works in all four phases; a relaunch renders the selected skill's last recorded rail, findings and artefacts with nothing enqueued, and never replaces a run the session started |
| M3 | R3.2, R3.2b, R3.5, R3.5a, R3.6–R3.9, R12.5a | A clean machine reaches a verified toolchain through the wizard alone; doctor reports all four drift kinds plus integrity and lifecycle drift |
| M4 | R3.5b, R4.6–R4.8 | Two tools reporting one rule class in one file produce one issue with two detections and two detector rows, whichever stage each ran in — the fingerprint carries no stage component; two tools writing `findings.sarif` in one fan-out stage each keep their own file and both reach the stage summary; the issue closes only once both detectors have since run conclusively without it, in either finish order; extending the rule-class map is a versioned migration that merges colliding issues without losing a detection |
| M5 | R1.4, R1.6, R5.2, R9, R10, R12.4, R12.5b | Both sandbox strategies pass apply, rollback and crash-recovery tests over all five change kinds, plus a crash during the mutating tool and one while awaiting approval; the dirty-skill guard holds and its override seeds correctly; preimage drift aborts; digest mismatch blocks release; the no-manifest path releases correctly; a packaging or installability failure leaves no repo-root archive and no live file change |
| M6 | R4.14, R4.15, R6.10, R6.11, R7.6, R8.9, R8.15, R11.3, R11.7, R11.8, R11.9, R12.6 | Dashboard and Issues render ledger queries across all registered repos; Settings names every setting's value, holding file and origin; a staged edit reaches disk only through a confirmed change set — applying writes the file once and re-reads it, discarding leaves it byte-identical, and a schema-invalid value never stages; a stage that found something writes a fix prompt beside its summary and a stage that found nothing writes none; `y` on the Work screen copies that prompt and names its path in every case, at no row cost; `skillgantry fix` produces one for a recorded run without writing a byte; a baselined finding passes the gate, stays open in the ledger with its history, is excluded from the open counts but listed and marked on the Issues screen, and reappears the run after its baseline entry is deleted |
| M7 | R11.11–R11.15 | The zone key cycles exactly three zones and every movement key is inert outside its own; the Overview tier chosen at every size leaves the skill list at or above its minimum and returns the rows it gives up, asserted over the layout function rather than at a named size; the Issues tab and the Issues screen render one issue through one function, and no transition key on the tab changes anything; a finding carries its stage and its tool, the selected finding's detail sits inside the view's allocation at 80×24 and 50×14, the open-report key reaches the tool's report through an injected port, and the copy key yields that finding's stage's prompt whatever the rail points at; no body foreground and no background colour is set anywhere in the tree, and a selected row's reverse-video band spans the pane's inner width |

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
