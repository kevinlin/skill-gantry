# SkillGantry Design Review

**Date:** 2026-08-01  
**Reviewed:** [decision-log.md](decision-log.md), [requirements.md](requirements.md), [design.md](design.md)  
**Verdict:** Revision required before implementation planning

## Summary

The design has a sound high-level shape. The engine and frontend boundary is clear, adapters are separated from execution, the ring-buffer approach directly addresses Ink rendering risk, and the failure policy correctly avoids closing issues after an errored tool run.

The design is not implementation-ready yet. Eight blocking gaps affect release safety, secret handling, fan-out execution, pipeline control, issue reconciliation, and single-skill repos. Four further gaps affect concurrency, adapter boundaries, milestone coverage, and verification. Most are contract problems, so leaving them to the implementation plan would force architectural decisions during coding.

Priority meanings:

- **P1:** Resolve before implementing the affected milestone. The current design can violate a binding requirement or cannot express the required behavior.
- **P2:** Resolve before v1 completion. The design is ambiguous, incomplete, or lacks a verification path.

## Findings

### 1. [P1] The mutation sandbox cannot implement an atomic release

**Evidence**

- R9.1 requires one atomic update spanning the skill's `SKILL.md` and the repo-root `versions.json` (`requirements.md:104-106`). R9.3 and R9.4 add a changelog and archive (`requirements.md:107-110`).
- `GitWorktreeSandbox.diff()` is scoped to the skill path, and `apply()` copies changed files from that path (`design.md:382`).
- `SnapshotSandbox` copies and restores only the skill directory (`design.md:384-386`).
- Release is a native module, but the execution sequence always resolves adapter manifests, invokes `runner`, and calls `adapters.parse()` (`design.md:62`, `design.md:324-330`).

**Impact**

Repo-root changes are outside both sandbox contracts. A release can therefore omit `versions.json`, fail to roll it back, or apply the two version writes separately. Deletions, renames, new untracked files, file modes, and symlinks are also not represented by a scoped `git diff` plus file copying. In addition, the generic pipeline has no execution path for the native release stage because release has no manifest or parser.

**Required revision**

Define a common stage-executor contract implemented by adapter-backed stages and the native release stage. Let a mutation declare every affected path before execution. For git repos, generate and apply a complete binary-safe change set that includes new, deleted, renamed, mode-changed, and repo-root files. For non-git repos, snapshot and restore that same declared path set. Define an atomic apply or compensating rollback for the two version files. Add an end-to-end release test that changes `SKILL.md`, root `versions.json`, the changelog, and the archive, then verifies apply and discard.

### 2. [P1] The redaction boundary does not cover every sidecar write

**Evidence**

- R7.4 requires every byte written to a sidecar artefact to pass through redaction (`requirements.md:83-84`).
- The example adapter instructs SkillSpector to write `findings.sarif` directly into `{stageDir}` (`design.md:157-162`).
- The runner applies `RedactionTransform` to child streams, not to files written by the child process (`design.md:328`, `design.md:394-398`).
- The non-git rollback snapshot and release evidence are also written under the run sidecar (`design.md:285-293`, `design.md:384`).

**Impact**

A tool can place a credential in JSON, SARIF, Markdown, or another native artefact without passing through `RedactionTransform`. `snapshot-pre/` can also copy an existing secret from the skill into the sidecar. Redacting that snapshot in place would make exact rollback impossible, so R7.4 and R10.4 conflict when the source skill contains a secret.

**Required revision**

Run tools against a private staging directory outside the published sidecar. Copy textual artefacts into the sidecar only through one controlled, atomic redacting writer. Define a policy for binary artefacts. Store rollback material outside the sidecar with restrictive permissions or explicitly revise R7.4 to cover an encrypted rollback area. Apply the same rule to evidence bundles and parse-failure artefacts. Test secrets written to stdout, stderr, native artefacts, split stream chunks, snapshots, and evidence bundles.

### 3. [P1] Fan-out tools overwrite each other's logs and artefacts

**Evidence**

- Validate and security must run all selected tools and merge their findings (`requirements.md:52-54`).
- A stage has one directory containing one `stdout.log`, one `stage.json`, and native artefacts (`design.md:275-300`).
- Each tool writes into the same `{stageDir}`, and `stage.json` is written after each tool (`design.md:104-107`, `design.md:326-329`).
- The example scanner uses the generic filename `findings.sarif` (`design.md:158-162`), which the second scanner can also reasonably use.

**Impact**

Two tools in one fan-out stage can interleave or overwrite `stdout.log`, `findings.sarif`, and `stage.json`. Sequential execution still overwrites generic filenames. This loses provenance and makes `tool_runs.artefact_dir` unable to identify one tool's evidence reliably.

**Required revision**

Use a layout such as `<stage>/<toolId>/stdout.log`, `<stage>/<toolId>/stderr.log`, and `<stage>/<toolId>/<native artefacts>`. Write the stage-level `stage.json` once, after all tool results are available, with stable references to each tool directory. Define whether fan-out is parallel or sequential and test two tools that emit the same filenames.

### 4. [P1] Tool and stage outcomes are not a total model

**Evidence**

- `ToolResult.outcome` permits only `passed`, `failed`, and `errored` (`design.md:134-139`).
- Failure handling also produces `skipped` (`design.md:365-366`).
- Stage computation introduces `degraded` but does not define a stage-outcome type (`design.md:334-344`).
- The outcome table omits combinations including `failed + errored`, `passed + skipped`, `failed + skipped`, and `errored + skipped`.
- Selected tools are intersected with the lockfile before execution (`design.md:326`), so a selected but absent tool can disappear instead of producing the documented `skipped/not-installed` result.

**Impact**

The pipeline cannot deterministically decide whether to halt, what the headless exit code should be, whether release is allowed, or what to render for common fan-out failures. Silently removing an uninstalled selected tool can also let a validate or security stage pass without running all selected tools, contrary to R4.6.

**Required revision**

Define explicit `ToolOutcome` and `StageOutcome` types and a total reduction table for every non-empty combination. Resolve the configured selection first, then create a tool result for every selected tool, including not-installed and no-credentials cases. Define the zero-tool case and validate `fan-out` and `pick-one` selections before starting a run. Test the full Cartesian outcome matrix.

### 5. [P1] The event stream has no command path for confirmation or cancellation

**Evidence**

- `pipeline.run()` returns only an async iterable of outbound events (`design.md:306-320`).
- `mutation:pending` is said to block until an apply or discard action arrives, but no method, channel, or correlation identifier accepts that action (`design.md:317-318`, `design.md:330`).
- The queue must be visible and cancellable (`requirements.md:67`), while the event list contains no enqueue, dequeue, queue-state, or cancellation protocol.
- The headless interface says `--yes` skips the confirmation gate, but R5.2 requires confirmation following a diff preview (`requirements.md:59`, `design.md:425-430`).

**Impact**

Neither frontend can resume a blocked mutation through the declared API. Pending-job cancellation is also undefined. The CLI's `--yes` behavior is ambiguous: it may authorize a write before a diff exists, which does not match the literal order in R5.2.

**Required revision**

Return a bidirectional handle, for example `RunHandle { events, resolveMutation(requestId, action), cancel() }`, plus queue snapshot and queued-job cancellation operations. Define behavior for cancellation before start, during a tool, and while awaiting mutation approval. Resolve the R5.2/R12.4 tension by specifying whether `--yes` is prior authorization or whether headless mutation requires a separate precomputed diff token.

### 6. [P1] Finding identity and reconciliation do not satisfy the issue lifecycle

**Evidence**

- R8.6 requires the same underlying problem from two tools to become one issue (`requirements.md:96`).
- The fingerprint includes `messageShape`, but normalization only replaces numbers, quoted strings, and path-like tokens (`design.md:181-194`). Two tools can describe the same problem with different words and produce different fingerprints.
- D8 originally records deduplication by file, line, and rule class (`decision-log.md:84-90`), while R8.4 excludes line number and adds message shape (`requirements.md:93-95`). The source documents do not record how this decision changed.
- Reconciliation considers only classes in `manifest.detects`, whose type is `KnownRuleClass[]` (`design.md:101`, `design.md:263-270`). An `unmapped:<toolId>:<nativeId>` issue is outside that set and can never close.
- Reconciliation considers only `open` issues (`design.md:266`). An `acknowledged` issue is therefore never marked fixed when it disappears. Recurrence of a `fixed` issue is not defined.
- `issue_detections` permits only one row per issue and tool run (`design.md:224-226`), while the accepted fingerprint limitation can collapse multiple same-tool findings into one issue (`design.md:194`).

**Impact**

Cross-tool duplication can remain visible, unmapped issues can remain open forever, acknowledged issues can never resolve automatically, and repeated detections can be lost or violate the primary key. These behaviors affect the M1 ledger slice and later Dashboard and Issues views.

**Required revision**

Record the superseding finding-identity decision explicitly. Define a canonical cross-tool identity strategy and validate it against paired real scanner fixtures. Include a tool's own unmapped classes in its reconciliation scope. Add a complete issue-state transition table covering open, acknowledged, wontfix, fixed, recurrence, tool error, and rule-map migration. Give detections their own stable identifier or ordinal.

### 7. [P1] The sidecar location is undefined for a repo-root skill

**Evidence**

- A repo whose root contains `SKILL.md` must be supported as one skill (`requirements.md:27`).
- Artefacts must live under `<skill>-workspace/`, and the repo `.gitignore` must ignore `*-workspace/` (`requirements.md:71-76`).
- The design shows only the flat multi-skill sibling layout and places `snapshot-pre/` inside that sidecar (`design.md:275-294`).

**Impact**

For a repo-root skill, a literal sibling sidecar is outside the repo and cannot be ignored by the repo's `.gitignore`. Putting the sidecar inside the repo makes it part of the root skill passed to tools, and a naive non-git snapshot can recursively copy the sidecar into its own `snapshot-pre/` directory.

**Required revision**

Define one canonical `workspacePath(skill)` algorithm for flat and repo-root skills. Specify scanner exclusions and snapshot copy exclusions so the workspace, `.git`, and temporary isolation data cannot become skill input. Add a repo-root fixture that runs discovery, a read-only stage, snapshot creation, rollback, and `.gitignore` verification.

### 8. [P1] Release gates are not tied to the bytes being released

**Evidence**

- R9.8 requires the most recent gate outcomes to be passed (`requirements.md:112`).
- `run.json` records provenance and the tool lock, but no git commit or content digest for the skill input (`design.md:231-251`).
- The release module reads the ledger for gate results (`design.md:76`) but no invalidation rule is defined when the skill changes after those runs.
- Discovery supports arbitrary registered repos and missing version metadata (`requirements.md:23-29`), while release assumes an existing repo-root `versions.json`, an entry for the skill, a changelog location, and a target version without defining any of them.

**Impact**

A user can pass validate, evaluate, and security, modify the skill, and then release different content using the old evidence. Repos outside the reference layout also have undefined release behavior.

**Required revision**

Record a deterministic skill-input digest and, for git repos, the commit plus dirty-state metadata in every run. Require the release candidate to match the passed gate set. Define release eligibility, target-version input and validation, `versions.json` creation or rejection behavior, changelog path and format, archive output path, and how non-git repos behave.

### 9. [P2] Concurrent runs can race while finalising one skill workspace

**Evidence**

- The queue permits concurrent work, and only mutating jobs receive special locking (`design.md:346-348`). Two read-only runs for one skill are not prohibited.
- Both runs update the same `index.json` and `latest` pointer (`design.md:296-300`, `design.md:331`).
- `index.json` is called append-only even though it is one JSON document, and no atomic update or lock is specified.
- A run id uses only a minute timestamp and four hexadecimal characters but is described as collision-safe (`design.md:296`).

**Impact**

Concurrent finalisation can lose an index entry, point `latest` at a nondeterministic run, or collide on a run directory. A process crash during a JSON rewrite can also leave history unreadable.

**Required revision**

Use a per-skill finalisation lock, write and fsync a temporary index before atomic rename, and define `latest` semantics under concurrency. Use a collision-resistant identifier such as UUIDv7 or a longer random suffix, and claim uniqueness only after exclusive directory creation succeeds. Consider NDJSON if true append-only behavior is required.

### 10. [P2] Several adapter and engine boundaries are internally inconsistent

**Evidence**

- `adapters` is described as owning no I/O and as exhaustively testable without mocking (`design.md:69`, `design.md:78`). `ParseContext.artefact()` returns a file path, and the example parser receives that path (`design.md:115-123`, `design.md:165-166`), so parsing must perform filesystem I/O.
- `invoke.argv` and `versionArgv` contain arguments but the contract does not identify the executable for uv-tool and GitHub-release installs (`design.md:96-113`).
- `ToolResult.metrics` accepts any numeric key (`design.md:134-139`), despite R1.5 forbidding token and cost metrics (`requirements.md:18-19`).
- The execution sequence records the ledger, but the `pipeline` dependency row omits `ledger`, and no other owner is named (`design.md:71-76`, `design.md:324-332`).

**Impact**

Implementers must invent where file reads, executable resolution, metric filtering, and ledger transactions live. Different adapters can make incompatible choices, and token fields from real skill-up reports can enter `metrics_json` accidentally.

**Required revision**

Pass artefact bytes or a read-only artefact map into pure parsers, or explicitly permit filesystem reads and revise the boundary claim. Add an executable or resolved-command contract to the tool lock. Replace open-ended metrics with a typed, allowed metric set that excludes token and cost values. Name the owner and transaction boundary for ledger recording.

### 11. [P2] Requirement coverage and milestone acceptance are incomplete

**Evidence**

- The design says each section names the requirements it satisfies (`design.md:8`), but there is no substantive design section for R2 discovery, R3 tool management, R1.4 retirement, or R9 release. These appear only as module rows, comments, or milestone names.
- The `queue` module is not assigned to any milestone (`design.md:449-458`).
- The requirements milestone table does not assign or mechanically verify several binding v1 requirements, including retirement, most queue behavior, the complete release contract, and npm distribution (`requirements.md:152-163`).
- M1 claims all of R8 while M6 separately claims R8.9 (`requirements.md:158`, `requirements.md:163`).

**Impact**

The implementation plan can satisfy every listed milestone and still omit required v1 behavior. Missing design sections also push decisions about config schemas, discovery canonicalization, presets, doctor drift, retirement metadata, and release workflow into coding tasks.

**Required revision**

Add design sections for discovery and repo registration, tool root and lock schema, setup and doctor, retirement, and the full release state machine. Add a requirement-to-section-to-milestone matrix with exactly one owning milestone and a mechanical acceptance check for every MUST and MUST NOT requirement.

### 12. [P2] The verification strategy does not cover the highest-risk contracts

**Evidence**

- The current test table covers parser fixtures, basic pipeline outcomes, timeout, an env-echoing process, isolation apply and rollback, version mismatch, discovery, and a TUI smoke test (`design.md:432-447`).
- It does not require tests for native-artefact redaction, fan-out filename collisions, process-tree termination, queued and pending-mutation cancellation, concurrent workspace finalisation, root-level release changes, release evidence/input matching, or issue state transitions beyond an errored tool.
- R5.9 specifically requires killing the process tree, while the proposed timeout fixture only mentions a sleeping process (`requirements.md:66`, `design.md:441`).

**Impact**

The test suite can pass while the blocking failures in this review remain present. Several acceptance criteria are currently assertions rather than mechanically demonstrated contracts.

**Required revision**

Add contract tests for each P1 finding. In particular, use a fixture process that spawns a child and verify both are terminated, a fixture tool that writes a secret into a native artefact, two fan-out tools with colliding filenames, and full git and non-git release transactions that exercise apply, discard, and crash recovery.

## Requirements coverage snapshot

| Requirement group | Assessment | Main gap |
|---|---|---|
| R1 Scope | Partial | Retirement is only a ledger column; token/cost exclusion is not enforced in metrics |
| R2 Repos and discovery | Insufficient detail | No config schema, canonical path rules, or complete discovery algorithm |
| R3 Tool management | Insufficient detail | No tool-root or lock schema, preset contents, wizard state machine, or doctor drift rules |
| R4 Adapters | Partial | Fan-out storage, executable resolution, and pure parsing are unresolved |
| R5 Execution | Not yet implementable | Outcome combinations and command/control protocol are incomplete |
| R6 Artefacts | Partial | Fan-out collisions, single-skill placement, and concurrent finalisation are unresolved |
| R7 Credentials | Does not meet R7.4 | Native artefacts, snapshots, and copied evidence bypass the redaction transform |
| R8 Ledger | Partial | Cross-tool identity and state reconciliation have correctness gaps |
| R9 Release | Not yet implementable | Native-stage dispatch, mutation scope, release inputs, and evidence binding are missing |
| R10 Mutation safety | Does not meet full scope | Repo-root and non-file changes are outside the sandbox/apply model |
| R11 Terminal interface | Mostly covered | It depends on the missing queue and mutation command protocol |
| R12 Headless interface | Partial | `--yes` and post-diff confirmation semantics conflict |
| R13 Quality and distribution | Partial | Boundaries need closure; npm packaging has no acceptance check |

## Verified context drift

Two facts should be refreshed before the implementation plan:

- `decision-log.md:24` says this directory is not a git repo. It is now a git repo on `main`, with commit `be0a555` containing the specification set.
- The example manifest pins SkillSpector `0.4.2` (`design.md:157`). The locally installed executable reports `2.3.7`. Its current CLI still supports `scan`, `--format sarif`, and `--output`, but fixture capture and the example pin must refer to the same selected version.

## Strengths to retain

- The one-package engine/TUI/CLI dependency direction is simple and testable (`design.md:40-54`).
- The adapter manifest plus parser split is the right extension point once the I/O boundary is resolved (`design.md:80-167`).
- The external ring buffer and fixed render tick directly address R11.4 without losing the disk log (`design.md:400-419`).
- Parse success taking precedence over exit code is appropriate for scanners and linters that use non-zero exits for findings (`design.md:350-366`).
- Keeping errored tool runs out of issue reconciliation is the correct fail-safe direction (`design.md:256-273`).

## Minimum revision set before implementation planning

1. Define a common executable-stage contract, a bidirectional run handle, and a total outcome model.
2. Redesign mutation scope and apply/rollback so release can safely change skill and repo-root files.
3. Route every published sidecar write through a defined redaction policy, and resolve the rollback-snapshot conflict.
4. Give every fan-out tool an isolated artefact directory and aggregate the stage result once.
5. Finalize finding identity, issue state transitions, and unmapped-rule reconciliation using real paired fixtures.
6. Define the repo-root skill workspace path and per-skill finalisation locking.
7. Bind gate evidence to an exact skill-input digest and specify the complete release state machine.
8. Add the missing requirement sections, milestone ownership matrix, and contract tests.

After these revisions, the existing package shape and milestone order can remain. The main need is to close the contracts before converting the design into implementation tasks.
