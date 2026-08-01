# SkillGantry Design Re-review

**Date:** 2026-08-01

**Reviewed revision:** `9503fdc`

**Reviewed:** [decision-log.md](decision-log.md), [requirements.md](requirements.md), [design.md](design.md), [design-review.md](design-review.md)

**Verdict:** Substantially improved, but revision is still required before implementation planning

## Summary

Revision 2 resolves several important problems from the first review. The fan-out artefact layout is now safe, the outcome reduction is total, the event stream has a command path, parser inputs are genuinely pure, release evidence is bound to a skill digest, and the test strategy covers the main cross-cutting contracts.

The latest design still has seven P1 gaps and four P2 gaps. The most serious are in the release transaction, repo-root skill packaging, mutation crash recovery, M1 tool bootstrap, the SkillSpector credential contract, and tool-result failure classification. These should be resolved in the specification set before producing the implementation plan.

Priority meanings:

- **P1:** Resolve before planning or implementing the affected milestone. The current design can violate a binding requirement or cannot execute the stated flow safely.
- **P2:** Resolve before v1 completion. The design is ambiguous, internally inconsistent, or makes an unsupported durability claim.

## Disposition of the first review

| Original finding | Status in revision 2 | Re-review result |
|---|---|---|
| 1. Release and mutation boundary | Partial | Native dispatch and repo-root scope are fixed, but the archive and downstream verification remain outside the declared transaction; see finding 1 |
| 2. Redaction boundary | Resolved by decision change | A2 narrows the requirement explicitly; the chosen approach creates a separate repo-root exposure addressed in finding 2 |
| 3. Fan-out collisions | Resolved | Per-tool directories and one stage summary are clear and testable |
| 4. Outcome model | Resolved | The four tool outcomes now reduce through a total function |
| 5. Command and cancellation path | Resolved | `RunHandle`, `QueueHandle`, correlation ids, and four cancellation phases are defined |
| 6. Finding identity and reconciliation | Partial | Identity, states, ordinals, and unmapped classes are fixed; latest-detector ownership remains ambiguous under concurrent fan-out; see finding 8 |
| 7. Repo-root sidecar | Partial | The path is defined, but tools and packaging can still consume the workspace; see finding 2 |
| 8. Release gates and candidate bytes | Partial | Digests are recorded and checked, but digest exclusions and release output handling leave gaps; see findings 1 and 3 |
| 9. Concurrent finalisation | Partial | UUIDv7, exclusive creation, locking, and NDJSON are improvements; crash-tail and lock recovery remain undefined; see finding 9 |
| 10. Adapter and engine boundaries | Resolved | Artefact bytes, executable paths, closed metrics, and ledger ownership are specified |
| 11. Coverage and milestones | Partial | Missing sections and ownership tables were added, but milestone dependencies and trace rows conflict; see findings 5 and 11 |
| 12. Verification | Partial | The test matrix is much stronger; the remaining P1 paths need explicit tests |

## Findings

### 1. [P1] The archive and installability gate remain outside the release transaction

**Evidence**

- `ReleaseStageExecutor` declares only `SKILL.md`, `CHANGELOG.md`, and optional root `versions.json` in its mutation scope (`design.md:225`). The required archive is not included.
- The release state machine applies the change before packaging and verifying it: `apply → package → verify-install` (`design.md:651-669`).
- The journal is marked complete as soon as scoped files have been applied, before packaging and verification run (`design.md:640-649`).
- R9.4 requires the archive at the repo root, and R9.6 requires verification of that archive (`requirements.md:138-140`).
- The current Vercel Skills documentation lists Git sources and local directories, but does not document a zip archive as an accepted source. Direct zip installation therefore cannot be assumed. See the [official Vercel Skills README](https://github.com/vercel-labs/skills#source-formats).

**Impact**

The diff preview and journal do not cover the archive. A packaging or installability failure can leave a zip behind even when the release claims to abort and roll back. The live skill is also modified before the installability gate proves that the candidate can be installed. The phrase "install the archive via vercel `skills`" is not executable without an explicit unzip and local-directory flow.

**Required revision**

Build the candidate and archive in the sandbox or a private release staging directory. Extract that exact archive into another temporary directory, then invoke Vercel Skills against the extracted local directory with copy mode, non-interactive flags, and an isolated destination. Only after this succeeds should the design emit the final change set and apply the scoped files plus the archive. Keep the journal recoverable until the whole release reaches `done`, and record the archive SHA-256 in the evidence bundle. Add tests proving that packaging and install failures leave no repo-root archive or live file changes.

### 2. [P1] A repo-root skill can scan and publish its own unredacted workspace

**Evidence**

- A repo-root skill stores `.skillgantry-workspace/` inside the directory passed to tools (`design.md:128-136`).
- Native artefacts, snapshots, and evidence bundles in that workspace are intentionally unredacted (`requirements.md:103-108`, `design.md:403-411`).
- For tools without an exclusion option, the design allows the scan and drops workspace findings only after the tool has finished (`design.md:136`, `design.md:337`).
- The archive is created from the repo-root skill, but its content manifest and exclusions are not defined (`design.md:667`).

**Impact**

Filtering findings in the normaliser is too late. A model-assisted scanner can read and transmit old unredacted artefacts before SkillGantry discards the resulting findings. Packaging can also include `.skillgantry-workspace/`, `.git/`, previous release archives, dependency directories, and the archive currently being created. For a repo-root skill, the archive itself is written inside the skill tree, so an unspecified recursive pack can consume its own output.

**Required revision**

Define one materialised candidate view used by digesting, tools, and packaging. It must contain only releaseable skill files and must exclude the exact workspace path, `.git/`, release archives, temporary files, and other declared non-skill content before any external tool sees it. Do not rely on adapter exclusions or post-scan normalisation for this boundary. Test with a canary secret placed in a prior native artefact and assert that neither a fixture scanner nor the archive can observe it.

### 3. [P1] `skillDigest` can omit real skill content and has no symlink policy

**Evidence**

- The digest excludes "any `snapshot-pre/` directory" rather than the exact snapshot location owned by SkillGantry (`design.md:142-147`, `requirements.md:30-32`).
- The digest algorithm says "every file" but does not define whether symbolic links are followed, rejected, or hashed as links (`design.md:142-149`).
- For a repo-root skill, `.gitignore` is part of the skill tree, and SkillGantry can modify it automatically to add workspace patterns (`requirements.md:92`, `design.md:401`). The ordering between that mutation and digest capture is not defined.
- The repo-root archive is also created inside the digested tree and is not excluded (`requirements.md:138`, `design.md:667`).

**Impact**

A legitimate skill directory named `snapshot-pre/` can change without invalidating gate evidence. Following a symlink can hash or package content outside the repo; not following it without hashing the link target text can miss a meaningful change. Automatic `.gitignore` edits and generated archives can make the recorded digest stale immediately after a run.

**Required revision**

Derive the digest from the same explicit candidate manifest used for packaging. Exclude only exact SkillGantry-owned paths, not any matching basename. Define symlinks end to end across digest, sandbox, diff, rollback, and archive: either reject them, or hash and preserve the link itself without following it outside the candidate root. Ensure required `.gitignore` changes happen before the digest is captured, or explicitly exclude that repo control file from a repo-root skill candidate.

### 4. [P1] Mutation recovery does not cover dirty overrides or crashes during non-git tool execution

**Evidence**

- R10.3 allows the user to override the dirty-skill guard, but a git worktree is still created from `HEAD` (`requirements.md:153-154`, `design.md:634`). The design does not say how the uncommitted bytes enter the sandbox or how conflicts are detected on apply.
- `SnapshotSandbox` lets the tool modify the real non-git skill tree (`design.md:636`).
- The recovery journal is created only during `apply()` (`design.md:638-649`). A crash while the optimiser is writing, or while waiting for approval, occurs before that journal exists.
- The test strategy injects a crash between journal and rename, but not during the mutating tool itself (`design.md:728`).

**Impact**

With a dirty override, the tool can operate on stale `HEAD` and the later apply can overwrite or conflict with the user's uncommitted work. For non-git skills, a process or machine crash during optimiser execution can leave the real skill partially changed with no startup marker directing restoration from `snapshot-pre/`.

**Required revision**

Define dirty override semantics. The safe options are to seed the worktree with the current skill bytes and record their preimage, or to keep the guard non-overridable. Before any non-git tool starts, write an active-sandbox record that startup recovery can detect and restore. Recheck target preimage hashes immediately before apply so edits made after the preview cannot be overwritten silently. Test a dirty override, a concurrent user edit, a crash during tool writing, and a crash while awaiting approval.

### 5. [P1] The installer design and milestone order cannot produce the M1 real-tool slice

**Evidence**

- `runner` depends on `tools` for the resolved executable (`design.md:70-74`).
- M1 must run the real SkillSpector security stage, but the `tools` module and installers are assigned to M3 (`requirements.md:201-203`, `design.md:763-769`).
- The uv install command is specified as `uv tool install --tool-dir <path> ...` (`design.md:182-186`). On the locally required uv 0.7.12, that command fails with `unexpected argument '--tool-dir'`.
- The official uv CLI uses `UV_TOOL_DIR` and `UV_TOOL_BIN_DIR` to relocate tool environments and executables, not a `--tool-dir` option. See the [uv CLI reference](https://docs.astral.sh/uv/reference/cli/#uv-tool-dir) and [environment variable reference](https://docs.astral.sh/uv/reference/environment/#uv_tool_dir).
- The GitHub-release driver promises checksum verification, but `InstallSpec` contains no checksum asset, checksum URL, expected digest, or signature field (`design.md:267-270`).

**Impact**

M1 has no specified way to create the managed SkillSpector installation or lock entry that its runner requires. The M3 uv command cannot run as written, and the GitHub-release checksum promise cannot be implemented from the declared manifest.

**Required revision**

Either move the minimal SkillSpector installer and lock writer into M1, or define a development bootstrap that creates a conforming managed installation and lock entry without using a global executable. Use scoped `UV_TOOL_DIR` and `UV_TOOL_BIN_DIR` environment variables for uv. Extend the GitHub-release install spec with an explicit integrity source and define behavior when upstream publishes no checksum. Add real install-driver contract tests against the pinned runtime versions.

### 6. [P1] The M1 SkillSpector manifest declares the wrong credential mode

**Evidence**

- The example pins SkillSpector 2.3.7, declares `requiresCredentials: false`, and invokes `scan` without `--no-llm` (`design.md:305-323`).
- The locally installed SkillSpector 2.3.7 help states that normal scans select an LLM provider and require one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, AWS credentials, or `NVIDIA_INFERENCE_KEY`. It exposes `--no-llm` to disable that analysis.
- The adapter contract records only a boolean credential requirement, not the required keys or provider mode (`design.md:252-265`).

**Impact**

The M1 vertical slice can fail at runtime while the engine believes no credential is needed. The setup wizard also cannot explain which value is absent or determine whether the selected provider is usable. Results from `--no-llm` and model-assisted scans may cover different rule classes, so silently falling back would make statistics incomparable.

**Required revision**

Choose one explicit M1 mode. Either add `--no-llm`, record the analysis mode in provenance, and declare only the rule classes available in static mode, or make credentials required and declare the exact accepted environment alternatives. Replace the boolean with a structured credential requirement that can express alternative key sets and provider selection. Add a clean-environment smoke test for the exact manifest invocation.

### 7. [P1] Revision 2 removed the tool-result failure policy

**Evidence**

- The design defines how completed `ToolOutcome` values reduce into a stage outcome (`design.md:339-366`).
- It does not define how exit code, parser success, missing artefacts, malformed artefacts, credential absence, timeout, or cancellation produce that `ToolOutcome`. The only specific classifications left are artefact-too-large and cancellation (`design.md:301`, `design.md:591-598`).
- The risk table says a parse failure becomes `errored`, but no executable rule or test covers it (`design.md:801`).

**Impact**

Linters and scanners often exit non-zero when they successfully find issues. Without the removed classification contract, an implementation can turn valid findings into `errored`, treat a missing report as a pass, or let a parse failure reconcile and close issues. The total stage reducer does not solve this earlier classification step.

**Required revision**

Restore a complete tool-execution decision table. A successful, schema-valid parse must be authoritative; exit code is fallback evidence. Define at least: parsed with no findings, parsed with findings, non-zero with no parseable output, timeout, missing declared artefact, parser exception, oversized artefact, cancellation, not installed, and missing credentials. Add one runner or adapter-stage test for every row and assert the issue-reconciliation effect.

### 8. [P2] Cross-tool reconciliation ownership is nondeterministic

**Evidence**

- Fan-out tools run concurrently (`design.md:229`).
- One merged issue can carry detections from both scanners (`design.md:478-490`).
- Reconciliation closes an issue only when its "most recent detection came from this tool" (`design.md:498-508`).
- No ordering rule defines which of two detections from the same run is most recent.

**Impact**

Completion order or insertion order can decide which scanner owns later closure. If that owner passes without the finding while the other scanner errors or is skipped, the result can differ across otherwise identical runs. This weakens the stated fail-safe and makes issue history sensitive to concurrency timing.

**Required revision**

Model conclusive absence per detecting tool instead of selecting one latest detector, or define a deterministic ownership rule that is independent of completion order. The safer merge-first rule is to close only after every tool with an active detection has produced a later conclusive absence. Add tests for two prior detectors followed by pass/absent plus error, pass/absent plus skip, and both absent.

### 9. [P2] NDJSON and lock durability are overstated

**Evidence**

- The design claims an `O_APPEND` crash truncates `index.ndjson` at a line boundary (`design.md:397-399`). POSIX append placement does not guarantee that a full record and its terminating newline survive a process or power failure.
- The queue uses filesystem lockfiles but defines no stale-lock, multi-process, or crash-release semantics (`design.md:75`, `design.md:581`).
- `latest` is called deterministic, but "later" is not defined as start time, finish time, UUIDv7 order, or lock acquisition order (`requirements.md:93-94`, `design.md:399`).

**Impact**

The last NDJSON record can be partial, a stale lock can block future work, and two runs can select different `latest` values depending on timing while still satisfying the current prose.

**Required revision**

Specify one write call per record, fsync policy, and reader recovery that ignores or truncates an invalid final line. Prefer an OS advisory lock that releases on process death, or define leases and stale-lock recovery for lockfiles. Define `latest` by one stable field, then test the inverse start/finish ordering case.

### 10. [P2] Retirement duplicates state without an authority or recovery rule

**Evidence**

- Retirement updates both SQLite lifecycle fields and `metadata.deprecated` in `SKILL.md` (`design.md:417-426`, `design.md:673-677`).
- File mutation uses the sandbox and journal, while ledger changes use a separate SQLite transaction (`design.md:581-589`, `design.md:638-649`).
- Release checks that the skill "is not deprecated" but does not state which copy is authoritative (`design.md:661`).

**Impact**

A crash or database failure can leave the frontmatter and ledger disagreeing. Release behavior then depends on an unstated implementation choice, and reversal can clear one copy while leaving the other deprecated.

**Required revision**

Choose an authority. A simple model is to treat `SKILL.md` as authoritative metadata and derive or reconcile the ledger on discovery. Alternatively, journal the intended ledger transition alongside the file mutation and complete it during startup recovery. Define release behavior for every mismatch and add crash tests on both sides of the file/database boundary.

### 11. [P2] The traceability and milestone claims still conflict

**Evidence**

- M2 says the Work screen must render from the M1 engine "with no engine change", but M2 also owns the new queue, command path, cancellation, and per-skill locking (`requirements.md:202`, `design.md:766`).
- Requirements assign R5.12 to M2, while the design trace table groups R5.12 with M5 (`requirements.md:202`, `design.md:752`).
- Requirements assign R12.4 and R12.5 to M5, while the design table says all R12 headless behavior is owned by M1 (`requirements.md:205`, `design.md:760`).
- Section 12 claims R9.1-R9.10 and R10.1-R10.8 even though it also implements R9.11 and R10.9; sections 14 and 15 similarly omit R11.6 and R12.5 from their satisfaction labels (`design.md:604-606`, `design.md:679-702`).
- Section 8 says a degraded verdict is carried in metrics, but `MetricKey` is numeric-only and the ledger already has a separate `verdict` column (`design.md:247-250`, `design.md:355-359`, `design.md:435`).

**Impact**

The plan can assign the same contract to different milestones or promise that M2 changes no engine code while explicitly adding engine modules. These inconsistencies make the new traceability matrix unreliable as a planning input.

**Required revision**

Generate or mechanically validate one requirement-to-section-to-milestone table and remove the duplicate hand-maintained versions. Either move queue and command contracts into M1 or change the M2 exit criterion to allow the planned engine additions without changing established M1 interfaces. Correct the satisfaction labels and carry `verdict` as a dedicated stage field, not a metric.

## Strengths to retain

- `StageExecutor` gives adapter-backed and native stages one pipeline contract (`design.md:198-229`).
- Per-tool directories and one aggregate stage summary resolve fan-out collisions cleanly (`design.md:368-401`).
- The outcome reducer is compact, total, and easy to test exhaustively (`design.md:339-366`).
- `RunHandle` and `QueueHandle` provide the missing command channel without coupling core to Ink (`design.md:538-577`).
- The merge-first issue model is now explicit about its loss of occurrence granularity (`decision-log.md:235-238`, `design.md:478-490`).
- The test table is materially stronger and names concrete failure fixtures (`design.md:713-736`).
- Decision changes A1-A4 are recorded instead of being hidden as implementation details (`decision-log.md:231-248`).

## Minimum revision set before implementation planning

1. Move archive creation and installability verification before live apply, and include the final archive in the recoverable change set.
2. Define a filtered candidate manifest shared by digesting, scanning, sandboxing, and packaging, including a complete symlink policy.
3. Add pre-apply recovery for non-git mutation and safe semantics for the dirty-worktree override.
4. Make the M1 tool bootstrap executable, correct the uv driver, and define GitHub-release integrity metadata.
5. Correct the SkillSpector credential mode and replace the credential boolean with a structured requirement.
6. Restore the tool-result classification table and its reconciliation effects.
7. Make issue closure, NDJSON recovery, lock recovery, retirement authority, and milestone ownership deterministic.

After these changes, the design will be ready to convert into an implementation plan. The high-level architecture and milestone order can remain, but M1 must receive a concrete managed-tool bootstrap path.
