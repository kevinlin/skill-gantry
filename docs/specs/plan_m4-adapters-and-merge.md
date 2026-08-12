# SkillGantry M4 Implementation Plan

**Status:** shipped, compacted post-implementation.
**Goal:** Give every installable tool a parser, then make the merge those parsers exist for happen. Three adapters join skillspector. The rule-class map gains twenty entries, which forces the versioned migration M1 deferred to this milestone. Two tools reporting one problem in one file then resolve to one issue with two detections, and close only when both agree it is gone.

**Architecture:** M4 adds three adapter modules and two shared parsers to `src/core/adapters/`, one migration module to `src/core/ledger/`, and changes three shipped behaviours that only a second tool could expose — a policy resolution that read the last adapter instead of the selection, an occurrence count that the second tool in a stage overwrote, and a rule-class map that could not grow without orphaning live issues. No new module, no new source root, no CLI subcommand.

**Prerequisite: [plan_m3.1-promptfoo-removal.md](plan_m3.1-promptfoo-removal.md) is merged first.**

## Global Constraints

Everything in [plan_m1-engine-and-sidecar.md's Global Constraints](plan_m1-engine-and-sidecar.md), [plan_m2-queue-and-tui.md's](plan_m2-queue-and-tui.md) and [plan_m3-tools-module.md's](plan_m3-tools-module.md) still holds. M4 additions:

- Import boundary unchanged; three new adapters in `src/core/adapters/` enforce R4.3 against four parsers.
- A parser receives bytes, never a path. `ParseContext` carries `artefacts: ReadonlyMap<string, Buffer>`, `stdout`, `stderr`, `exitCode` and `durationMs`.
- Every rule-class map change bumps `RULE_CLASS_MAP_VERSION` and appends a migration (R8.14).
- The fixture is the contract, not the tool run. skill-scanner's LLM mode is nondeterministic; re-capture is deliberate.
- Metric keys stay the closed union; `coerceMetrics` throws on unknown keys (R1.5).

## Facts established by running the real tools

Probed 2026-08-01 against pinned versions installed into scoped prefixes. Several tasks depend on these; none is an assumption.

**1. skill-lint 0.2.0 writes JSON to stdout and declares no output file.** `skill-lint <dir> --json` emits one JSON document on stdout, nothing on stderr, and exits `0` SAFE / `1` WARN / `2` TOXIC / `3` scanner error. Verified: `architecture-diagram` exits 0 with two findings, `zuhlke-slides` exits 2 with 28. Its adapter therefore declares `artefacts: []` and parses `ctx.stdout` — the first adapter with no artefact file, and the reason row 7 of the §8.1 table (missing declared artefact) cannot fire for it.

Report shape, `schemaVersion: 1`:

```jsonc
{ "tool": "skill-lint", "schemaVersion": 1, "origin": "local:/abs/path",
  "skill": { "name": "...", "description": "...", "files": [{ "relPath": "...", "size": 0, "role": "..." }] },
  "findings": [{ "ruleId": "R06", "ast": "AST03", "severity": "LOW",
                 "title": "Suspicious file in skill", "file": "scripts/scan.py",
                 "evidence": "", "message": "Bundled script .py — review contents", "role": "skill-script" }],
  "verdict": { "label": "SAFE", "score": 2, "exitCode": 0 },
  "scoring": { "CRITICAL": 10, "HIGH": 5, "MEDIUM": 2, "LOW": 1 } }
```

`file` is relative to the scanned directory, exactly like a SARIF `artifactLocation.uri`, so it rebases the same way. There is no line number in any finding — which R8.4 already made irrelevant to identity.

Its four rules, across all 20 skills of `zapac-agent-skills`: `R05` Runtime external fetch (21), `R06` Suspicious file in skill (54), `R07` Persistence / agent-state tamper (2), `R09` Metadata abuse (4). Severity varies within one rule — `R06` is `HIGH` for a `.pyc` and `LOW` for a bundled `.py` — so severity comes from the finding, never from the rule id.

**2. skill-lint is catalogued as a validate tool and stays there.** Three of its four rules are security rules and the tool calls itself a security scanner, but `R09` checks `SKILL.md` frontmatter for `name` and `description`, which is validate's whole job, and agentskills — validate's other D7 candidate — is unpublished. Moving it to security would leave the first lifecycle gate with no tool at all. Its security-class findings still merge with skillspector's: the fingerprint is `(skillId, relPath, ruleClass)` with no stage component, which is precisely what merge-first identity is for.

**3. skillspector 2.5.1 static mode emits fifteen rules, not two.** M1 mapped `LP3` and `MP2` because those were the only two `declawed` produced. Sweeping all 20 skills produced:

| id | `shortDescription` | count |
|---|---|---|
| `AS1` | Agent Config Directory Access | 1 |
| `AS3` | Skill Enumeration | 2 |
| `AST4` | subprocess module call | 8 |
| `E2` | Env Variable Harvesting | 1 |
| `EA2` | Autonomous Decision Making | 5 |
| `EA4` | Unbounded Resource Access | 1 |
| `LP3` | no declared permissions but code capabilities detected | 5 |
| `MP2` | Context Window Stuffing | 1 |
| `P2` | Hidden Instructions | 13 |
| `P6` | Direct Prompt Extraction | 4 |
| `PE2` | Sudo/Root Execution | 1 |
| `PE3` | Credential Access | 2 |
| `RA2` | Session Persistence | 21 |
| `RP1` | MCP server referenced without pinned version | 12 |
| `YR4` | YARA rule match | 4 |

Thirteen of those fifteen currently degrade to `unmapped:skillspector:<id>` and can therefore never merge with anything. That is the change that makes the migration load-bearing rather than theoretical.

**4. `architecture-diagram` is the cross-tool merge fixture.** Small, and it produces exactly one genuine merge:

```
skillspector  AST4  warning  scripts/html_to_png.py:135
skillspector  AST4  warning  scripts/html_to_png.py:223
skillspector  LP3   warning  SKILL.md:1
skillspector  P2    error    layouts/connectors.md:66
skill-lint    R06   LOW      scripts/build_gallery.py
skill-lint    R06   LOW      scripts/html_to_png.py
```

Under the Task 2 and Task 3 mappings (`AST4` → `unsafe-script`, `R06` → `unsafe-script`) one run over both tools yields **four issues and five detections**:

| fingerprint of | detections | detectors |
|---|---|---|
| `scripts/html_to_png.py` + `unsafe-script` | 3 — skillspector ordinals 0 and 1, skill-lint ordinal 0 | **2** |
| `scripts/build_gallery.py` + `unsafe-script` | 1 | 1 (skill-lint) |
| `SKILL.md` + `excessive-permission` | 1 | 1 (skillspector) |
| `layouts/connectors.md` + `prompt-injection` | 1 | 1 (skillspector) |

The first row is R8.6 (one issue, two detections), R8.13 (one detection row per occurrence) and R8.8 (closure waits for both detectors) in one fixture.

**5. skill-scanner 0.3.3 has no offline mode.** `skill-scanner scan --path <dir> --no-ai --no-vt` exits with `No analyzers enabled for scan. Configure SKILLSCAN_API_KEY or SKILLSCAN_BASE_URL for LLM analysis and/or VT_API_KEY for VirusTotal`. So the adapter declares `analysisMode: 'llm'` and a `one-of` credential requirement over `SKILLSCAN_API_KEY`+`SKILLSCAN_MODEL` or `SKILLSCAN_BASE_URL`+`SKILLSCAN_MODEL`. It supports `--format sarif --output <file>`, so it reuses the shared SARIF parser. VirusTotal mode is a **different adapter id**, not a fallback — R4.2b — and M4 does not ship it.

**6. skill-up 0.7.0's report is the `v1alpha1` schema R4.4 names, and it writes `iteration-N`.** `skill-up run [eval.yaml] --format json --output-dir <dir>` writes `<dir>/iteration-N/{result.json,report.json}`, where N auto-increments past existing iterations. Pointing `--output-dir` at the run's tool artefact directory is mandatory: the default is `<skill-name>-workspace` alongside the skill, which is the sidecar SkillGantry owns and where R6.5 forbids it to write `iteration-N`.

Report shape, verified against three real runs in `declawed-workspace/`:

```jsonc
{ "skill_name": "declawed", "schema_version": "v1alpha1",
  "engine_name": "claude_code", "model_name": "",
  "start_time": "...", "end_time": "...",
  "case_results": [{ "case_id": "strip-not-x-but-y", "title": "...", "status": "PASS",
                     "duration_ms": 38205, "turns": 1,
                     "input_tokens": 0, "output_tokens": 0,
                     "grading": { "status": "PASS", "turns_executed": 1, "turns_total": 1,
                                  "assertion_results": [{ "text": "...", "passed": true, "evidence": "..." }],
                                  "summary": { "passed": 2, "failed": 0, "total": 2, "pass_rate": 1 } },
                     "configuration": "with_skill", "prompt": "...", "response": "..." }],
  "total_tokens": 0 }
```

`iteration-1` holds a real `FAIL` case; `iteration-3` is all `PASS`. `case_results[]` carries **no file path** — the derived path Task 4 uses is the one design decision this schema forces.

**7. The engine skill-up drives is declared by the skill, not by SkillGantry.** `declawed/evals/eval.yaml` says `engine: { name: claude_code }`, and skill-up resolves that CLI's own authentication. `CredentialRequirement` can express "these env keys are set"; it cannot express "an external CLI is logged in". The adapter therefore declares `credentials: { kind: 'none' }`, and a missing engine surfaces as `errored`/`missing-artefact` rather than `skipped`/`no-credentials`. Recorded as a known gap, not papered over.

## Spec amendments this milestone carries

All landed in Task 1, before the code that depends on them, per the repo rule that a spec proven wrong is corrected in the same branch.

1. **R3.5b cannot mean "the seven adapters M1 did not".** Rewritten to name the three M4 ships and state the rule that produced the number.
2. **The M4 exit criterion says "both scanners" and means "two tools".** Reworded to describe the contract rather than the stage.
3. **Design §7 documents one shared parser and R4.4 requires two.** §7.2 added for the `v1alpha1` eval-report parser.
4. **Design §10.3 defines `occurrence_count` ambiguously for two tools.** Sharpened to "across every tool run in that run".
5. **Design §5.3 gains the two new doctor conditions, and §17's M4 row loses "seven".**

## Critical Files — Summary

| Path | Role |
|---|---|
| `src/core/adapters/paths.ts` | `rebasePath` shared by both parser families |
| `src/core/adapters/eval-report.ts` | shared `v1alpha1` parser (R4.4's second) |
| `src/core/adapters/skill-lint.ts` | validate adapter; parses JSON from stdout |
| `src/core/adapters/skill-up.ts` | evaluate adapter; delegates to eval-report |
| `src/core/adapters/skill-scanner.ts` | security adapter; delegates to SARIF parser, `one-of` credentials |
| `src/core/adapters/rule-classes.ts` | 22 entries across 3 tools, `RULE_CLASS_MAP_VERSION = 4` |
| `src/core/adapters/registry.ts` | four adapters registered |
| `src/core/ledger/schema.ts` | migration 2: `rule_map_migrations` table |
| `src/core/ledger/rule-map-migration.ts` | `migrateRuleMap()`: reclassify or fold on collision |
| `src/core/ledger/record.ts` | `occurrence_count` summed across a run, not per tool run |
| `src/core/stages/adapter-stage.ts` | policy resolved from the whole selection; `lookup` seam |
| `src/core/tools/doctor.ts` | `rule-map-pending` finding |
| `src/cli/doctor-command.ts` | `--migrate-rule-map` flag |
| `tests/core/cross-tool-merge.test.ts` | R8.6, R8.8, R8.13 over real fixtures from two tools |
| `tests/acceptance/m4.test.ts` | one named test per M4 exit-criterion clause |

---

## Tasks

### Task 1: Spec amendments M4 builds against

Amended `requirements.md` (R3.5b, M4 exit-criteria cell) and `design.md` (§7.2, §10.3, §5.3, §17's M4 row) so every later task builds against accurate contracts. R3.5b became a rule over the catalogue rather than a count that went wrong every time the catalogue moved.

### Task 2: The full skillspector rule map and the migration that lets it grow

Mapped all fifteen rules the pinned version emits onto canonical classes, introduced `RULE_CLASS_MAP_VERSION = 2`, and shipped `migrateRuleMap` — a single-transaction reclassify-or-fold that re-parents detections (rebasing ordinals to avoid PK collisions), merges detector rows, and keeps the strongest issue state. Thirteen rules that degraded to `unmapped:` can now merge with other tools' findings.

### Task 3: The skill-lint adapter, over real captured output

Moved `rebasePath` from `sarif.ts` into `adapters/paths.ts` so both parser families share it. Built the first adapter with no artefact file — skill-lint writes its JSON report to stdout and offers no `--output` flag. Added four skill-lint rule mappings (`R05`→`vulnerable-dep`, `R06`→`unsafe-script`, `R07`→`excessive-permission`, `R09`→`metadata-invalid`), bumping the map to version 3.

### Task 4: The shared `v1alpha1` eval-report parser and the skill-up adapter

Shipped R4.4's second shared parser (`eval-report.ts`) alongside the skill-up adapter. Failing cases become `eval-failure` findings pathed at `<skillRelPath>/evals/cases/<case_id>.yaml`, so two failing cases produce two issues rather than one. Token fields are dropped — no `MetricKey` can hold them (R1.5). `--output-dir {toolDir} --iteration 1` keeps skill-up's output out of the sidecar R6.5 protects.

### Task 5: The skill-scanner adapter, with declared LLM credentials

Built the first adapter with `one-of` credentials and no offline alternative. skill-scanner 0.3.3 has no static mode, so the manifest declares `analysisMode: 'llm'` and two credential sets; VirusTotal mode would be a separate adapter id (R4.2b). Fixture captured from `insight-profile` with LLM analysis. Bumped rule-class map to version 4.

### Task 6: Make the merge real — occurrence counting across a run, and the cross-tool contract

Fixed the bug where `occurrence_count` was written per tool run (last writer wins under fan-out) — hoisted the accumulator above the stage loop so it sums across the whole run per design §10.3. Shipped the cross-tool merge contract test over real fixtures from both tools: one issue with three detections and two detectors, closing only when both agree it is gone (R8.6, R8.8, R8.13).

### Task 7: Per-stage policy resolved from the selection

Fixed `plan()` resolving policy from the last adapter in the loop — a pick-one tool listed before a fan-out one escaped the one-tool guard. Policy is now resolved over the whole selection. Added a `lookup` seam so the optimise stage (which ships no adapter) is assertable rather than merely unreachable.

### Task 8: Three tools become selectable — wizard, doctor and the migration trigger

Added `rule-map-pending` to doctor (non-failing, like `integrity-unverified` and `lifecycle-drift`). Wired `--migrate-rule-map` as the explicit trigger R8.14 requires — nothing on the `openLedger` path runs the migration. Inverted three tests that asserted empty tool selections, since skill-lint, skill-up and skill-scanner now have parsers.

### Task 9: M4 acceptance suite

Wrote one named test per M4 exit-criterion clause: cross-tool merge with two detectors, fan-out filename collision, order-independent closure, rule-map migration preserving detections, and R4.3 purity over all four parsers. Extended the install-test matrix to assert every stage-selectable tool has an adapter (R3.5b).

---

## Requirement coverage for M4

Every requirement M4 owns, and the task that satisfies it.

| Requirement | Task |
|---|---|
| R3.5b manifest and `parse` per selectable catalogued tool, each fixture-tested | 1 (amendment), 3 (skill-lint), 4 (skill-up), 5 (skill-scanner), 9 (registry-vs-catalogue check) |
| R4.6 validate and security run every selected tool and merge their findings | 6 (merge over real fixtures), 7 (fan-out policy, per-tool artefact dirs), 9 |
| R4.7 evaluate runs exactly one tool per stage execution | 4 (skill-up is `pick-one`), 7 (`plan()` rejects a second) |
| R4.8 optimise runs one tool, never two concurrently | 7 (policy resolved over the selection, plus the lookup seam that makes the stage assertable with no adapter shipped) |

**Owned elsewhere but shaped here.**

- **R4.4** (M1) required two shared parsers and M1 shipped one. Task 4 ships the second, `eval-report.ts`, and design §7.2 documents it.
- **R8.14** (M1) says extending the rule-class map is an explicit versioned migration. Task 2 ships it, and Task 8 gives it its explicit trigger.
- **R8.6, R8.8, R8.13, R13.4** (M1) are the merge and closure contracts. Task 6 proves them against real output from two tools.
- **R8.3, R8.5** (M1) — three more parsers normalise to rule class, severity, repo-relative path and message.
- **R4.2a, R4.2b** (M1) — skill-scanner is the first adapter to use `one-of` credentials in anger.
- **R4.3** (M1) — Task 9's last case runs all four parsers with fs, subprocess and network stubbed to throw.
- **R1.5** (M1) — Task 4's parser drops three token fields the report carries.
- **R6.5** (M1) — Task 4's `--output-dir` keeps skill-up out of the sidecar.
- **R4.9** (M1) — Task 7 Step 5 replays the collision case with two real scanners.
- **R3.9, R12.5a** (M3) — doctor gains a sixth reported condition.

**Deferred within M4, with reasons.**

- **agentskills, SkillOpt and SkillHone get no adapter**, because M3's probe found no installable implementation. R3.5b as amended is a rule over the catalogue, so this is coverage rather than a gap.
- **promptfoo gets no adapter**, per [plan_m3.1-promptfoo-removal.md](plan_m3.1-promptfoo-removal.md) and decision-log §10.
- **VirusTotal-mode skill-scanner** is a separate adapter id under R4.2b and is not shipped.
- **`skillopt` and the optimise stage** stay empty. R4.8 is satisfied structurally and by the lookup seam.

## Known gaps carried forward

- **skill-up cannot be `skipped` for want of credentials.** Its engine is declared in the skill's own `eval.yaml` and authenticated by that CLI, and `CredentialRequirement` can only test env keys. A missing engine therefore lands as `errored`/`missing-artefact` rather than `skipped`/`no-credentials`.
- **A skill with no `evals/` errors rather than skipping.** Most reference skills have none, so an evaluate stage over a full repo is mostly `errored`.
- **skill-scanner's fixture cannot be refreshed without a key**, and its findings are nondeterministic. The capture script skips it with a message rather than failing.
- **skill-scanner finds nothing in most reference skills.** Its three mapped rule ids are what one skill elicited from one model — a different model or later version will name rules this map does not hold, degrading to `unmapped:` until a versioned migration adds them.
- **`evals/cases/<case_id>.yaml` is a convention, not a guarantee.** A repo storing its cases elsewhere gets an issue pathed at a file that does not exist — a display defect, not an identity one.
- **The rule-class map is one maintainer's reading of fifteen rule names.** `RA2` as `excessive-permission` and `R05` as `vulnerable-dep` are the two judgement calls most likely to be revisited.
- **Validate and security both fan out, and the chain halts on the first non-passing stage.** The merge accumulates across runs rather than within one. R5.3's single-stage runs make this directly observable.
- **R13.7's mechanical coverage check still does not exist.** Belongs to whichever milestone next touches traceability.

## Deviations found while implementing

1. **Task 2's migration test asserted a note the plan's own code never writes.** The note format is `rule-map v1 -> v2`, naming both ends; the test matches `rule-map v1 -> v${RULE_CLASS_MAP_VERSION}`.
2. **`DoctorReport` has `failed`, not `ok`.** Task 8's test rewired to use the actual field name. `ruleMap` being required reached further than expected: `tests/acceptance/m3.test.tsx` calls `doctor()` twice and both needed it.
3. **Task 9's first criterion cannot run as one chained run.** R5.1 halts the chain on the first stage that does not pass, so security never executes. The case performs two single-stage runs, which is what R5.3 exists to allow.
4. **An ESM namespace cannot be spied, so R4.3's purity case mocks instead.** `vi.spyOn(fs, 'readFileSync')` fails with `Cannot redefine property`. The case mocks `node:fs`, `node:child_process` and `node:net` at load time behind a flag.
5. **Re-capturing `skillspector-declawed.sarif` produces a byte-different file with identical findings.** Only the random `findingId` differs. The M1 fixture is kept to avoid churn.
6. **skill-scanner's fixture is captured from `insight-profile`, not `declawed`.** LLM analysis reports `declawed` CLEAN; `insight-profile` yields four findings across three rule ids.
7. **skill-scanner's rule ids carry the tool's own prefix.** They are `skill-scanner/credential_leak` etc., not bare ids like skillspector's `AST4`.
8. **The tool exits 0 when it refuses offline**, not exit 2 as predicted. The refusal, not the exit code, grounds `analysisMode: 'llm'`.
9. **Task 7's fan-out case uses the lookup seam** while the skill-scanner adapter was blocked on a credential, then ran against the real registry once unblocked.
10. **`tests/core/spawn.test.ts > kills the whole process tree on timeout` is intermittent under load.** Its 1 000 ms timeout races shell startup. M4 does not touch that test; belongs to whichever milestone next opens `runner/`.

## Changelog

- 2026-08-02 — revision 1, written after installing and running skill-lint 0.2.0, skill-scanner 0.3.3, skill-up 0.7.0 and skillspector 2.5.1 against the 20 skills of `zapac-agent-skills`.
- 2026-08-02 — **Compacted post-implementation.** Removed step-by-step tasks, file-by-file diffs, code snippets, and verification commands now that the feature has shipped. Preserved Goal, Facts, Spec Amendments, Design Decisions, Critical Files summary, Requirement Coverage, Known Gaps, and Deviations. Original plan recoverable via git history.
- 2026-08-02 — **A severity fail floor on the tool-outcome gate.** A run over `zapac-agent-skills/declawed` failed validate on a tool that had found nothing wrong: skill-lint 0.2.0 exited 0, called the skill `SAFE`, and reported two `LOW` `R06` "bundled script, review contents carefully" advisories against the skill's own `.sh` and `.py`. §8.1 row 12 read "findings present → `failed`" with no severity dimension, so an advisory failed a gate as hard as a critical and R5.1 halted the lifecycle.

  Row 12 now splits: a finding at or above a `medium` fail floor fails, findings all below it pass as row 12b. Both reconcile. **`medium` and not `high`** because §7.1 normalises SARIF `warning → medium` and uses `medium` for a result carrying no level, while §7.2 gives a failing eval case `medium` — a higher floor would pass most scanner findings and every failing eval case. The floor is a constant, since a per-skill threshold would make two runs of one tool incomparable in the ledger, and it is a uniform rule over normalised severity rather than a reproduction of each tool's own scoring: skill-lint bands a weighted score, so two `LOW`s and one `MEDIUM` both total 2 and only one crosses the floor.

  **Gated at the executor, not in the three parsers.** `classifyToolRun` is where §8.1 lives, so the amendment and the code land together and a fifth adapter inherits the floor instead of having to remember a helper. The parsers still report `failed` on any finding; §8.1's authority is over *what the tool found*, and the floor decides only whether that halts the chain. Findings pass through **verbatim** — `record.ts` files issues and detections for every tool run regardless of outcome and `reconcile.ts` admits `passed` runs to both phases, so a sub-floor advisory is still tracked and still closes when it goes away. Emptying `findings` instead would have made every issue the tool ever filed look absent and closed all of them.

  Also folded the one severity ordering into `types.ts`: `ledger/issues.ts` held a private `SEVERITY_RANK` that the outcome model now needs too, and a stage must not reach into the ledger for a comparison. `issues.ts` re-exports `maxSeverity`, so its consumers are untouched. Amended R4.13 in place rather than adding `R4.13a` — the table is what R4.13 owns, and a suffixed id would need its own milestone owner under R13.7.

- 2026-08-12 — **skill-scanner's declared credential keys re-checked, and they stand.** A real `~/.skillgantry/.env` held `SKILLSCAN_BASE_URL`, `SKILL_SCANNER_LLM_API_KEY` and `SKILL_SCANNER_LLM_MODEL`, satisfying neither declared alternative, so the security stage would have skipped as `no-credentials`. The tool's own documentation for the pinned 0.3.3 names `SKILLSCAN_MODEL`, `SKILLSCAN_API_KEY` and `SKILLSCAN_BASE_URL` — "if `SKILLSCAN_MODEL` plus either `SKILLSCAN_API_KEY` or `SKILLSCAN_BASE_URL` is available, LLM analysis runs" — which is exactly the `one-of` pair the manifest declares, and `SKILL_SCANNER_LLM_*` is read by nothing. A misnamed credential file, not an adapter defect; recorded so the next reader does not re-litigate the pair. The same investigation found the Settings screen reporting that skip against the wrong environment, fixed in [plan_m6-screens-and-palette.md](plan_m6-screens-and-palette.md)'s changelog for this date.
