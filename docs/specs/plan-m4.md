# SkillGantry M4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** revision 1, aligned to [design.md](design.md) revision 3, [requirements.md](requirements.md) revision 4, shipped M1–M3, and [plan-promptfoo-removal.md](plan-promptfoo-removal.md).

**Goal:** Give every installable tool a parser, then make the merge those parsers exist for happen. Three adapters join skillspector. The rule-class map gains twenty entries, which forces the versioned migration M1 deferred to this milestone. Two tools reporting one problem in one file then resolve to one issue with two detections, and close only when both agree it is gone.

**Architecture:** M4 adds three adapter modules and two shared parsers to `src/core/adapters/`, one migration module to `src/core/ledger/`, and changes three shipped behaviours that only a second tool could expose — a policy resolution that read the last adapter instead of the selection, an occurrence count that the second tool in a stage overwrote, and a rule-class map that could not grow without orphaning live issues. No new module, no new source root, no CLI subcommand.

**Tech Stack:** everything M1–M3 ship. No new dependency.

**Prerequisite: [plan-promptfoo-removal.md](plan-promptfoo-removal.md) is merged first.** M4 Task 1 states how many adapters M4 ships, and that number is wrong while the catalogue still lists promptfoo.

## Global Constraints

Everything in [plan-m1.md's Global Constraints](plan-m1.md), [plan-m2.md's](plan-m2.md) and [plan-m3.md's](plan-m3.md) still holds. These are the additions.

- Import boundary unchanged: `cli → tui → core`; `src/tui/**` reaches core only through `src/core/index.ts`; no `console` or `process.exit` in `src/core/**`; and **no `node:fs`, `node:child_process`, `node:https` or `node:net` in `src/core/adapters/**`**. Three new adapters land in that directory, so R4.3 is now enforced against four parsers instead of one. `tests/boundary.test.ts` already proves the lint rule fires.
- **A parser receives bytes, never a path.** `ParseContext` carries `artefacts: ReadonlyMap<string, Buffer>`, `stdout`, `stderr`, `exitCode` and `durationMs`, and nothing else. A parser that wants a file the manifest did not declare is a manifest bug.
- **Every rule-class map change bumps `RULE_CLASS_MAP_VERSION` and appends a migration.** A migration that finds nothing to merge is a no-op and still records its version. Extending the map without a version bump is what R8.14 forbids, and the ledger test asserts the two stay in step.
- **Adding a mapping is not backward compatible with a live ledger.** `unmapped:skillspector:RA2` and `excessive-permission` produce different fingerprints, so every issue the map newly classifies changes identity. The migration is what stops that orphaning a user's triage.
- **The fixture is the contract, not the tool run.** skill-scanner's LLM mode is nondeterministic, so its golden SARIF is a point-in-time capture and its parse test asserts what the parser does with those bytes — never that a re-run reproduces them. Re-capture is a deliberate act with a version bump, exactly as for skillspector.
- Metric keys stay the closed union in `src/core/types.ts`. skill-up's report carries `input_tokens`, `output_tokens` and `total_tokens`; the parser must not forward them. `coerceMetrics` throws on an unknown key, which is how R1.5 is enforced rather than remembered.
- Fan-out concurrency stays capped at 2 (`FAN_OUT_LIMIT` in `adapter-stage.ts`), each tool in its own artefact directory.
- British spelling in identifiers that appear in the specs (`optimise`, `artefact`, `normalise`).
- Conventional Commits, lowercase imperative subject.

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

The first row is R8.6 (one issue, two detections), R8.13 (one detection row per occurrence) and R8.8 (closure waits for both detectors) in one fixture. The second row is the contrast case that closes as soon as its single detector reports absence.

**5. skill-scanner 0.3.3 has no offline mode.** `skill-scanner scan --path <dir> --no-ai --no-vt` exits 2 with `No analyzers enabled for scan. Configure SKILLSCAN_API_KEY or SKILLSCAN_BASE_URL for LLM analysis and/or VT_API_KEY for VirusTotal`. Its `doctor` adds: *"LLM analysis requires an explicit SKILLSCAN_MODEL or --model value. No default model is applied."* So the adapter declares `analysisMode: 'llm'` and a `one-of` credential requirement over `SKILLSCAN_API_KEY`+`SKILLSCAN_MODEL` or `SKILLSCAN_BASE_URL`+`SKILLSCAN_MODEL`. It supports `--format sarif --output <file>`, so it reuses the shared SARIF parser. VirusTotal mode is a **different adapter id**, not a fallback — R4.2b — and M4 does not ship it.

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

All land in Task 1, before the code that depends on them, per the repo rule that a spec proven wrong is corrected in the same branch.

**1. R3.5b cannot mean "the seven adapters M1 did not".** M3 found agentskills, SkillOpt and SkillHone unpublished in installable form; [plan-promptfoo-removal.md](plan-promptfoo-removal.md) removes promptfoo. Four of the seven have no tool to wrap. R3.5b is rewritten to name the three M4 ships and to state the rule that produced the number.

**2. The M4 exit criterion says "both scanners" and means "two tools".** With skill-lint in validate and skillspector in security, the merge crosses a stage boundary — which the fingerprint permits by design, since it has no stage component. The criterion is reworded to describe the contract rather than the stage.

**3. Design §7 documents one shared parser and R4.4 requires two.** §7.2 is added for the `v1alpha1` eval-report parser, alongside the SARIF one §7.1's neighbour already covers.

**4. Design §10.3 defines `occurrence_count` ambiguously for two tools.** "the number of distinct detections in the most recent run that reported it" does not say whether a run means one tool run or the whole run. The shipped code answers "the last tool run to write", so two tools reporting one issue leave the count at whichever finished last. §10.3 is sharpened to "across every tool run in that run", and Task 6 makes the code agree.

**5. Design §5.3 gains the two new doctor conditions, and §17's M4 row loses "seven".**

## File structure

```
src/
  core/
    index.ts                        MODIFIED  migration + rule-map version exports
    types.ts                        unchanged
    adapters/
      paths.ts                      NEW       rebasePath, shared by both parsers
      sarif.ts                      MODIFIED  imports rebasePath, re-exports it
      eval-report.ts                NEW       shared skill-up v1alpha1 parser (R4.4)
      rule-classes.ts               MODIFIED  22 entries, RULE_CLASS_MAP_VERSION
      skill-lint.ts                 NEW       manifest + stdout JSON parse
      skill-up.ts                   NEW       manifest + parse over eval-report
      skill-scanner.ts              NEW       manifest + parse over sarif
      registry.ts                   MODIFIED  four adapters
    ledger/
      schema.ts                     MODIFIED  migration 2: rule_map_migrations
      rule-map-migration.ts         NEW       migrateRuleMap()
      record.ts                     MODIFIED  occurrence_count across the run
    stages/
      adapter-stage.ts              MODIFIED  policy from the selection; getAdapter seam
    tools/
      doctor.ts                     MODIFIED  rule-map-pending finding
  cli/
    doctor-command.ts               MODIFIED  --migrate-rule-map
tests/
  fixtures/
    sarif/
      skillspector-declawed.sarif           existing
      skillspector-architecture-diagram.sarif   NEW
      skill-scanner-declawed.sarif          NEW  (keyed capture)
    skill-lint/
      architecture-diagram.json             NEW
      zuhlke-slides.json                    NEW
    skill-up/
      declawed-iteration-1.report.json      NEW  (has a FAIL case)
      declawed-iteration-3.report.json      NEW  (all PASS)
  core/
    skill-lint.test.ts        skill-up.test.ts        skill-scanner.test.ts
    eval-report.test.ts       rule-classes.test.ts    MODIFIED
    rule-map-migration.test.ts                        NEW
    record-occurrences.test.ts                        NEW
    adapter-stage-policy.test.ts                      NEW
    cross-tool-merge.test.ts                          NEW
  cli/
    doctor-command.test.ts                            MODIFIED
  acceptance/
    m4.test.ts                                        NEW
scripts/
  capture-fixtures.sh                                 MODIFIED  four tools
docs/specs/
  requirements.md   design.md   plan-m4.md            MODIFIED / NEW
```

---

## Tasks

### Task 1: Spec amendments M4 builds against

**Files:**
- Modify: `docs/specs/requirements.md` — R3.5b, the M4 exit-criteria cell
- Modify: `docs/specs/design.md` — new §7.2, §10.3, §5.3, §17's M4 row
- Test: `tests/core/design-example.test.ts` (must still pass)

**Interfaces:**
- Consumes: nothing.
- Produces: the text every later task cites. No TypeScript symbol.

- [ ] **Step 1: Rewrite R3.5b**

In `docs/specs/requirements.md`, replace:

```markdown
- **R3.5b** SkillGantry MUST ship a manifest and `parse` for the seven adapters M1 did not, each fixture-tested per R13.3. *(rev 4, split from R3.5)*
```

with:

```markdown
- **R3.5b** SkillGantry MUST ship a manifest and `parse` for every catalogued tool a stage can select, each fixture-tested per R13.3. As the catalogue stands that is three beyond M1's skillspector — skill-lint (validate), skill-up (evaluate) and skill-scanner (security). A catalogued tool that no stage selects, which today is vercel `skills`, MUST NOT have an adapter. *(rev 4, split from R3.5; rev 5, M4 planning: "the seven adapters M1 did not" counts four tools that have no installable, skill-directory-driven implementation — agentskills, SkillOpt and SkillHone are unpublished per plan-m3.md, promptfoo needs a per-skill config per decision-log §10. A requirement stated as a count goes wrong every time the catalogue moves, so it is stated as a rule over the catalogue instead.)*
```

- [ ] **Step 2: Reword the M4 exit criterion**

In the milestone ownership table, replace the M4 exit-criteria cell:

```markdown
Fan-out merges findings from both scanners into single issues with two detections; colliding filenames both survive; closure waits for both detectors
```

with:

```markdown
Two tools reporting one rule class in one file produce one issue with two detections and two detector rows, whichever stage each ran in — the fingerprint carries no stage component; two tools writing `findings.sarif` in one fan-out stage each keep their own file and both reach the stage summary; the issue closes only once both detectors have since run conclusively without it, in either finish order; extending the rule-class map is a versioned migration that merges colliding issues without losing a detection
```

- [ ] **Step 3: Add design §7.2 for the second shared parser**

In `docs/specs/design.md`, immediately after §7.1 "Rule-class mapping", insert:

```markdown
### 7.2 Shared eval-report parser

*Satisfies R4.4.*

`src/core/adapters/eval-report.ts` parses skill-up's `schema_version: "v1alpha1"` report into a `ToolResult`, so any evaluate adapter emitting that schema needs no bespoke parsing. It is the second of the two shared parsers R4.4 requires; §7.1's neighbour `sarif.ts` is the first.

Mapping:

| Report field | Becomes |
|---|---|
| `case_results[].status` | `PASS` contributes nothing; anything else is one `RawFinding` of class `eval-failure` |
| `case_results[].case_id` | the finding's path, as `<skillRelPath>/evals/cases/<case_id>.yaml` |
| `case_results[].title` and `grading.assertion_results[].evidence` | the finding message |
| `case_results[].status` counts | `casesTotal`, `casesPassed`, `casesErrored` |
| `case_results[].turns`, summed | `turns` |
| `input_tokens`, `output_tokens`, `total_tokens` | **dropped** |

A case result carries no file path, so the finding's path is derived from the case id under skill-up's own layout convention. The alternative, pathing every failure at `evals/eval.yaml`, would collapse a whole failing suite into one issue and make "which case regressed" unanswerable from the ledger — R8.4's identity is `(skillId, relPath, ruleClass)`, so the path is the only field that can separate them. The cost is that a repo storing its cases elsewhere gets an issue pathed at a file that does not exist: a display defect, not an identity one, since the fingerprint stays stable and per-case.

Token fields are dropped rather than mapped, because `MetricKey` has no key that could hold them. That is R1.5 enforced by construction — `coerceMetrics` throws on an unknown key, so a parser forwarding them fails its own test.
```

- [ ] **Step 4: Sharpen §10.3's occurrence_count sentence**

Replace, in §10.3:

```markdown
`occurrence_count` is the number of distinct detections in the most recent run that reported it.
```

with:

```markdown
`occurrence_count` is the number of detections recorded across **every** tool run of the most recent run that reported the issue. Per tool run would be ambiguous under fan-out: two tools reporting one issue would leave the count at whichever tool finished last, so the number would depend on scheduling. Summing over the run makes it the answer to "how many times was this seen last time we looked", independent of how many tools looked.
```

- [ ] **Step 5: Add the two doctor conditions and correct §17's M4 row**

In §5.3, extend the sentence listing the non-failing conditions:

```markdown
Two further conditions are reported and do not fail the report: `integrity-unverified`, a lock entry recording `integrity: "none"` per §5.2, and `lifecycle-drift` per §13. Neither means a tool cannot run.
```

to:

```markdown
Three further conditions are reported and do not fail the report: `integrity-unverified`, a lock entry recording `integrity: "none"` per §5.2; `lifecycle-drift` per §13; and `rule-map-pending`, a ledger whose applied rule-map version trails the shipped one per §10.6. None means a tool cannot run. `rule-map-pending` is resolved by `skillgantry doctor --migrate-rule-map`, which is the explicit trigger R8.14 requires — the migration never runs as a side effect of opening the ledger.
```

In §17's milestone-modules table, replace the M4 row:

```markdown
| M4 | The seven remaining adapters and their parsers, fan-out policy, cross-tool merge |
```

with:

```markdown
| M4 | The three remaining selectable adapters and their parsers, the shared `v1alpha1` parser, the rule-class map and its versioned migration, fan-out policy, cross-tool merge |
```

- [ ] **Step 6: Verify the spec documents still parse and cross-check**

Run: `pnpm vitest run tests/core/design-example.test.ts`
Expected: PASS.

Run: `grep -c '^\*Satisfies' docs/specs/design.md`
Expected: one more than before Step 3 — §7.2 adds a `*Satisfies R4.4.*` label, and §17 says every such label is parsed and compared against requirements.md.

- [ ] **Step 7: Commit**

```bash
git add docs/specs/requirements.md docs/specs/design.md docs/specs/plan-m4.md
git commit -m "docs: restate R3.5b as a rule over the catalogue, not a count

Seven adapters counted four tools with no installable implementation.
Adds design 7.2 for the shared v1alpha1 parser R4.4 requires, sharpens
10.3's occurrence_count to sum across a run, and names the rule-map
migration as an explicit doctor action.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The full skillspector rule map and the migration that lets it grow

**Files:**
- Modify: `src/core/adapters/rule-classes.ts`
- Modify: `src/core/ledger/schema.ts` (append migration 2)
- Create: `src/core/ledger/rule-map-migration.ts`
- Test: `tests/core/rule-classes.test.ts` (extend), `tests/core/rule-map-migration.test.ts` (new)

**Interfaces:**
- Consumes: `fingerprint(skillId, relPath, ruleClass)`, `classifyRule(toolId, nativeRuleId)`, `IssueState`, `maxSeverity(a, b)`.
- Produces:
  - `export const RULE_CLASS_MAP_VERSION: number` (becomes `2`)
  - `export function migrateRuleMap(db: DatabaseSync): { applied: number; merged: number; reclassified: number }`
  - `export function appliedRuleMapVersion(db: DatabaseSync): number`

This task lands the map growth and the migration together on purpose. Thirteen new skillspector mappings change the fingerprint of every issue a live `gantry.db` already holds under `unmapped:skillspector:*`; shipping the map without the migration orphans them, and shipping the migration without a map change leaves it untested.

- [ ] **Step 1: Write the failing map test**

Add to `tests/core/rule-classes.test.ts`:

```ts
import { RULE_CLASS_MAP, RULE_CLASS_MAP_VERSION, classifyRule } from '../../src/core/adapters/rule-classes.js'
import { KNOWN_RULE_CLASSES } from '../../src/core/types.js'

describe('skillspector static rule map', () => {
  // Every rule id observed across all 20 skills of zapac-agent-skills at the
  // pinned version. An id missing here degrades to unmapped: and can never
  // merge with another tool's finding.
  const OBSERVED = {
    AS1: 'excessive-permission', AS3: 'excessive-permission', AST4: 'unsafe-script',
    E2: 'credential-access', EA2: 'excessive-permission', EA4: 'excessive-permission',
    LP3: 'excessive-permission', MP2: 'prompt-injection', P2: 'prompt-injection',
    P6: 'data-exfiltration', PE2: 'excessive-permission', PE3: 'credential-access',
    RA2: 'excessive-permission', RP1: 'vulnerable-dep', YR4: 'unsafe-script',
  } as const

  it('classifies every rule the pinned version actually produced', () => {
    for (const [id, expected] of Object.entries(OBSERVED)) {
      expect(classifyRule('skillspector', id)).toBe(expected)
    }
  })

  it('maps only onto known classes', () => {
    for (const byTool of Object.values(RULE_CLASS_MAP)) {
      for (const cls of Object.values(byTool)) {
        expect(KNOWN_RULE_CLASSES).toContain(cls)
      }
    }
  })

  it('is versioned, so a map change cannot ship without a migration', () => {
    expect(RULE_CLASS_MAP_VERSION).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/core/rule-classes.test.ts`
Expected: FAIL — `classifyRule('skillspector', 'AS1')` returns `unmapped:skillspector:AS1`, and `RULE_CLASS_MAP_VERSION` is not exported.

- [ ] **Step 3: Grow the map**

Replace the `RULE_CLASS_MAP` block in `src/core/adapters/rule-classes.ts`:

```ts
/**
 * The map version. Every change to RULE_CLASS_MAP bumps this and appends a
 * migration in ledger/rule-map-migration.ts, because a new mapping changes the
 * fingerprint of every issue already recorded under the old unmapped: class.
 * Extending the map without a bump silently orphans a user's triage — R8.14.
 */
export const RULE_CLASS_MAP_VERSION = 2

/**
 * (toolId, nativeRuleId) -> canonical class. Every entry below was observed in
 * real output from the pinned version, swept across all 20 skills of the
 * reference repo; nothing is mapped speculatively, because a wrong mapping
 * merges two unrelated problems into one issue and there is no signal that
 * would ever separate them again.
 */
export const RULE_CLASS_MAP: Readonly<Record<string, Readonly<Record<string, KnownRuleClass>>>> = {
  skillspector: {
    AS1: 'excessive-permission',   // Agent Config Directory Access
    AS3: 'excessive-permission',   // Skill Enumeration
    AST4: 'unsafe-script',         // subprocess module call
    E2: 'credential-access',       // Env Variable Harvesting
    EA2: 'excessive-permission',   // Autonomous Decision Making
    EA4: 'excessive-permission',   // Unbounded Resource Access
    LP3: 'excessive-permission',   // capabilities detected with no declared permissions
    MP2: 'prompt-injection',       // Context Window Stuffing
    P2: 'prompt-injection',        // Hidden Instructions
    P6: 'data-exfiltration',       // Direct Prompt Extraction
    PE2: 'excessive-permission',   // Sudo/Root Execution
    PE3: 'credential-access',      // Credential Access
    RA2: 'excessive-permission',   // Session Persistence
    RP1: 'vulnerable-dep',         // MCP server referenced without a pinned version
    YR4: 'unsafe-script',          // YARA signature match
  },
}
```

- [ ] **Step 4: Run the map test to green**

Run: `pnpm vitest run tests/core/rule-classes.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing migration test**

Create `tests/core/rule-map-migration.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { openLedger } from '../../src/core/ledger/db.js'
import { fingerprint } from '../../src/core/ledger/fingerprint.js'
import {
  appliedRuleMapVersion,
  migrateRuleMap,
} from '../../src/core/ledger/rule-map-migration.js'
import { RULE_CLASS_MAP_VERSION } from '../../src/core/adapters/rule-classes.js'

const SKILL = 'zapac/architecture-diagram'
const PATH = 'architecture-diagram/scripts/html_to_png.py'

/** Minimal rows: repos, skills and one run, so foreign keys are satisfiable. */
function seed(db: import('node:sqlite').DatabaseSync): void {
  db.exec(`insert into repos (id, path, name, is_git) values ('zapac', '/tmp/zapac', 'zapac', 1)`)
  db.exec(`insert into skills (id, repo_id, name, rel_path) values
           ('${SKILL}', 'zapac', 'architecture-diagram', 'architecture-diagram')`)
  for (const r of ['run-a', 'run-b']) {
    db.exec(`insert into runs (id, skill_id, trigger, started_at, skill_digest, sidecar_path)
             values ('${r}', '${SKILL}', 'test', 'now', 'sha256:x', '/tmp/ws')`)
  }
  db.exec(`insert into stages (run_id, stage, outcome, verdict) values ('run-a', 'security', 'failed', 'failed')`)
  db.exec(`insert into tool_runs (stage_id, tool_id, outcome, artefact_dir)
           values (1, 'skillspector', 'failed', '/tmp/ws/a')`)
  db.exec(`insert into tool_runs (stage_id, tool_id, outcome, artefact_dir)
           values (1, 'skill-lint', 'failed', '/tmp/ws/b')`)
}

function insertIssue(
  db: import('node:sqlite').DatabaseSync,
  ruleClass: string,
  state: string,
  opts: { count: number; toolId: string; toolRunId: number; ordinals: number },
): string {
  const fp = fingerprint(SKILL, PATH, ruleClass as never)
  db.prepare(
    `insert into issues (fingerprint, skill_id, rule_class, rel_path, severity_max, state,
                         occurrence_count, first_seen_run, last_seen_run)
     values (?, ?, ?, ?, 'medium', ?, ?, 'run-a', 'run-b')`,
  ).run(fp, SKILL, ruleClass, PATH, state, opts.count)
  for (let i = 0; i < opts.ordinals; i += 1) {
    db.prepare(
      `insert into issue_detections (issue_fp, tool_run_id, ordinal, native_rule_id,
                                     native_severity, message)
       values (?, ?, ?, 'X', 'medium', 'm')`,
    ).run(fp, opts.toolRunId, i)
  }
  db.prepare(
    `insert into issue_detectors (issue_fp, tool_id, last_seen_run) values (?, ?, 'run-b')`,
  ).run(fp, opts.toolId)
  return fp
}

describe('migrateRuleMap', () => {
  it('reclassifies an unmapped issue that has no collision', () => {
    const { db } = openLedger(':memory:')
    seed(db)
    const oldFp = insertIssue(db, 'unmapped:skillspector:AST4', 'acknowledged', {
      count: 2, toolId: 'skillspector', toolRunId: 1, ordinals: 2,
    })

    const result = migrateRuleMap(db)

    expect(result.reclassified).toBe(1)
    expect(result.merged).toBe(0)
    const newFp = fingerprint(SKILL, PATH, 'unsafe-script')
    const row = db.prepare('select rule_class, state, occurrence_count from issues where fingerprint = ?')
      .get(newFp) as { rule_class: string; state: string; occurrence_count: number }
    expect(row.rule_class).toBe('unsafe-script')
    expect(row.state).toBe('acknowledged')
    expect(db.prepare('select count(*) as n from issues where fingerprint = ?').get(oldFp))
      .toEqual({ n: 0 })
    expect(db.prepare('select count(*) as n from issue_detections where issue_fp = ?').get(newFp))
      .toEqual({ n: 2 })
  })

  it('merges into an existing issue, re-parenting detections without an ordinal collision', () => {
    const { db } = openLedger(':memory:')
    seed(db)
    // skill-lint already mapped R06 to unsafe-script; skillspector's AST4 is
    // about to become the same class on the same path. Both used ordinal 0.
    const target = insertIssue(db, 'unsafe-script', 'open', {
      count: 1, toolId: 'skill-lint', toolRunId: 2, ordinals: 1,
    })
    insertIssue(db, 'unmapped:skillspector:AST4', 'wontfix', {
      count: 2, toolId: 'skillspector', toolRunId: 1, ordinals: 2,
    })

    const result = migrateRuleMap(db)

    expect(result.merged).toBe(1)
    const row = db.prepare(
      'select state, occurrence_count, note from issues where fingerprint = ?',
    ).get(target) as { state: string; occurrence_count: number; note: string | null }
    // wontfix outranks open: the strongest state survives a merge.
    expect(row.state).toBe('wontfix')
    expect(row.occurrence_count).toBe(3)
    expect(row.note).toMatch(/rule-map v2/)
    expect(db.prepare('select count(*) as n from issues').get()).toEqual({ n: 1 })
    expect(db.prepare('select count(*) as n from issue_detections where issue_fp = ?').get(target))
      .toEqual({ n: 3 })
    expect(db.prepare('select count(*) as n from issue_detectors where issue_fp = ?').get(target))
      .toEqual({ n: 2 })
  })

  it('is idempotent and records the version it applied', () => {
    const { db } = openLedger(':memory:')
    seed(db)
    insertIssue(db, 'unmapped:skillspector:AST4', 'open', {
      count: 1, toolId: 'skillspector', toolRunId: 1, ordinals: 1,
    })

    expect(migrateRuleMap(db).applied).toBe(RULE_CLASS_MAP_VERSION)
    expect(appliedRuleMapVersion(db)).toBe(RULE_CLASS_MAP_VERSION)

    const second = migrateRuleMap(db)
    expect(second.reclassified).toBe(0)
    expect(second.merged).toBe(0)
  })

  it('leaves a still-unmapped class alone', () => {
    const { db } = openLedger(':memory:')
    seed(db)
    const fp = insertIssue(db, 'unmapped:skillspector:ZZ9', 'open', {
      count: 1, toolId: 'skillspector', toolRunId: 1, ordinals: 1,
    })
    migrateRuleMap(db)
    expect(db.prepare('select rule_class from issues where fingerprint = ?').get(fp))
      .toEqual({ rule_class: 'unmapped:skillspector:ZZ9' })
  })
})
```

- [ ] **Step 6: Run it and watch it fail**

Run: `pnpm vitest run tests/core/rule-map-migration.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 7: Append schema migration 2**

In `src/core/ledger/schema.ts`, append a second element to `MIGRATIONS`:

```ts
  `
  -- R8.14: extending the rule-class map is an explicit, versioned migration.
  -- This table is what makes "explicit" checkable and "once" enforceable.
  create table if not exists rule_map_migrations (
    version    integer primary key,
    applied_at text not null default (datetime('now')),
    note       text
  );
  `,
```

`openLedger` applies migrations by index against `schema_version`, so an existing database picks this up on next open and a fresh one gets both.

- [ ] **Step 8: Write the migration**

Create `src/core/ledger/rule-map-migration.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite'
import { RULE_CLASS_MAP_VERSION, classifyRule } from '../adapters/rule-classes.js'
import type { RuleClass, Severity } from '../types.js'
import { fingerprint } from './fingerprint.js'
import { type IssueState, maxSeverity } from './issues.js'

export interface RuleMapMigrationResult {
  applied: number
  /** Issues whose new fingerprint was free: rewritten in place. */
  reclassified: number
  /** Issues whose new fingerprint already existed: folded into it. */
  merged: number
}

/** wontfix suppresses, acknowledged is triaged, open is live, fixed is closed. */
const STATE_RANK: Readonly<Record<IssueState, number>> = {
  wontfix: 4,
  acknowledged: 3,
  open: 2,
  fixed: 1,
}

const strongestState = (a: IssueState, b: IssueState): IssueState =>
  STATE_RANK[a] >= STATE_RANK[b] ? a : b

/** `null` sorts before any run id; run ids are UUIDv7, so lexical order is claim order. */
const laterRun = (a: string | null, b: string | null): string | null => {
  if (a === null) return b
  if (b === null) return a
  return a > b ? a : b
}

const earlierRun = (a: string | null, b: string | null): string | null => {
  if (a === null) return b
  if (b === null) return a
  return a < b ? a : b
}

export function appliedRuleMapVersion(db: DatabaseSync): number {
  const row = db.prepare('select max(version) as v from rule_map_migrations').get() as
    | { v: number | null }
    | undefined
  return row?.v ?? 1
}

interface IssueRow {
  fingerprint: string
  skill_id: string
  rule_class: string
  rel_path: string
  severity_max: Severity
  state: IssueState
  occurrence_count: number
  first_seen_run: string | null
  last_seen_run: string | null
  note: string | null
}

/**
 * Re-parents every child row of `from` onto `to`, then deletes `from`.
 *
 * Detection ordinals are rebased rather than copied: two issues that merge can
 * each hold an ordinal 0 for the same tool run, and (issue_fp, tool_run_id,
 * ordinal) is the primary key. Rebasing is why R8.13's "one row per occurrence"
 * survives a merge instead of losing a row to a constraint violation.
 */
function fold(db: DatabaseSync, from: string, to: string): void {
  const runs = db
    .prepare('select distinct tool_run_id as id from issue_detections where issue_fp = ?')
    .all(from) as Array<{ id: number }>

  for (const { id } of runs) {
    const top = db
      .prepare(
        'select coalesce(max(ordinal), -1) as m from issue_detections where issue_fp = ? and tool_run_id = ?',
      )
      .get(to, id) as { m: number }
    db.prepare(
      `update issue_detections set issue_fp = ?, ordinal = ordinal + ?
        where issue_fp = ? and tool_run_id = ?`,
    ).run(to, top.m + 1, from, id)
  }

  const detectors = db
    .prepare('select tool_id, last_seen_run, last_absent_run from issue_detectors where issue_fp = ?')
    .all(from) as Array<{ tool_id: string; last_seen_run: string | null; last_absent_run: string | null }>

  for (const d of detectors) {
    const existing = db
      .prepare('select last_seen_run, last_absent_run from issue_detectors where issue_fp = ? and tool_id = ?')
      .get(to, d.tool_id) as { last_seen_run: string | null; last_absent_run: string | null } | undefined

    if (existing) {
      db.prepare(
        'update issue_detectors set last_seen_run = ?, last_absent_run = ? where issue_fp = ? and tool_id = ?',
      ).run(
        laterRun(existing.last_seen_run, d.last_seen_run),
        laterRun(existing.last_absent_run, d.last_absent_run),
        to,
        d.tool_id,
      )
    } else {
      db.prepare(
        'insert into issue_detectors (issue_fp, tool_id, last_seen_run, last_absent_run) values (?, ?, ?, ?)',
      ).run(to, d.tool_id, d.last_seen_run, d.last_absent_run)
    }
  }

  db.prepare('delete from issue_detectors where issue_fp = ?').run(from)
  db.prepare('delete from issues where fingerprint = ?').run(from)
}

/**
 * Applies the shipped rule-class map version to a ledger written under an
 * earlier one. Never called from openLedger: R8.14 requires the migration to be
 * explicit, so the trigger is `skillgantry doctor --migrate-rule-map`.
 *
 * One transaction, because a half-applied migration leaves issues whose
 * fingerprint no longer matches their rule class, and nothing would ever
 * recompute them.
 */
export function migrateRuleMap(db: DatabaseSync): RuleMapMigrationResult {
  const from = appliedRuleMapVersion(db)
  if (from >= RULE_CLASS_MAP_VERSION) {
    return { applied: from, reclassified: 0, merged: 0 }
  }

  const note = `rule-map v${from} -> v${RULE_CLASS_MAP_VERSION}`
  let reclassified = 0
  let merged = 0

  db.exec('begin')
  try {
    const stale = db
      .prepare(`select * from issues where rule_class like 'unmapped:%'`)
      .all() as unknown as IssueRow[]

    for (const issue of stale) {
      // `unmapped:<toolId>:<nativeRuleId>` — the native id may itself contain
      // a colon, so split on the first two only.
      const [, toolId, ...rest] = issue.rule_class.split(':')
      const nativeRuleId = rest.join(':')
      if (!toolId || nativeRuleId === '') continue

      const next: RuleClass = classifyRule(toolId, nativeRuleId)
      if (next === issue.rule_class) continue

      const newFp = fingerprint(issue.skill_id, issue.rel_path, next)
      const target = db
        .prepare('select * from issues where fingerprint = ?')
        .get(newFp) as unknown as IssueRow | undefined

      if (target) {
        db.prepare(
          `update issues set state = ?, severity_max = ?, occurrence_count = ?,
                             first_seen_run = ?, last_seen_run = ?, note = ?
            where fingerprint = ?`,
        ).run(
          strongestState(target.state, issue.state),
          maxSeverity(target.severity_max, issue.severity_max),
          target.occurrence_count + issue.occurrence_count,
          earlierRun(target.first_seen_run, issue.first_seen_run),
          laterRun(target.last_seen_run, issue.last_seen_run),
          target.note ? `${target.note}; ${note}` : note,
          newFp,
        )
        fold(db, issue.fingerprint, newFp)
        merged += 1
      } else {
        // No collision: insert the new identity, move the children onto it,
        // then drop the old row. Inserting first matters because the child
        // tables carry `on delete cascade` — deleting the old row before its
        // rows had somewhere to go would take the detections with it.
        db.prepare(
          `insert into issues (fingerprint, skill_id, rule_class, rel_path, severity_max,
                               state, note, occurrence_count, first_seen_run, last_seen_run,
                               closed_run, reopened_run)
           select ?, skill_id, ?, rel_path, severity_max, state,
                  case when note is null then ? else note || '; ' || ? end,
                  occurrence_count, first_seen_run, last_seen_run, closed_run, reopened_run
             from issues where fingerprint = ?`,
        ).run(newFp, next, note, note, issue.fingerprint)
        db.prepare('update issue_detections set issue_fp = ? where issue_fp = ?')
          .run(newFp, issue.fingerprint)
        db.prepare('update issue_detectors set issue_fp = ? where issue_fp = ?')
          .run(newFp, issue.fingerprint)
        db.prepare('delete from issues where fingerprint = ?').run(issue.fingerprint)
        reclassified += 1
      }
    }

    db.prepare('insert into rule_map_migrations (version, note) values (?, ?)').run(
      RULE_CLASS_MAP_VERSION,
      `${note}: ${reclassified} reclassified, ${merged} merged`,
    )
    db.exec('commit')
  } catch (err) {
    db.exec('rollback')
    throw err
  }

  return { applied: RULE_CLASS_MAP_VERSION, reclassified, merged }
}
```

- [ ] **Step 9: Run the migration test to green**

Run: `pnpm vitest run tests/core/rule-map-migration.test.ts`
Expected: PASS, 4 tests.

If the merge case fails on a foreign-key error, check that `fold` runs its `update issue_detections` before the `delete from issues` — `pragma foreign_keys = on` is set in `openLedger`, and `on delete cascade` will take the detections with the row if the order inverts.

- [ ] **Step 10: Run the whole ledger suite for regressions**

Run: `pnpm vitest run tests/core/ledger-db.test.ts tests/core/reconcile.test.ts tests/core/issues.test.ts tests/core/fingerprint.test.ts`
Expected: PASS. `reconcile.test.ts` builds issues under the old two-entry map; if any case hardcodes `unmapped:skillspector:LP3` or similar, update it to the mapped class and note it in the deviations section.

- [ ] **Step 11: Commit**

```bash
git add src/core/adapters/rule-classes.ts src/core/ledger/schema.ts \
        src/core/ledger/rule-map-migration.ts tests/core/rule-classes.test.ts \
        tests/core/rule-map-migration.test.ts
git commit -m "feat(ledger): map every skillspector static rule and version the map

Thirteen of fifteen rules the pinned version emits degraded to unmapped:
and could never merge with another tool. Mapping them changes the
fingerprint of every issue a live ledger already holds, so the map is now
versioned and migrateRuleMap merges colliding issues, rebases detection
ordinals and keeps the strongest state (R8.14).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The skill-lint adapter, over real captured output

**Files:**
- Create: `src/core/adapters/paths.ts`
- Modify: `src/core/adapters/sarif.ts` (import and re-export `rebasePath`)
- Create: `src/core/adapters/skill-lint.ts`
- Modify: `src/core/adapters/rule-classes.ts` (skill-lint entries, version 3)
- Modify: `src/core/adapters/registry.ts`
- Modify: `scripts/capture-fixtures.sh`
- Create: `tests/fixtures/skill-lint/architecture-diagram.json`, `tests/fixtures/skill-lint/zuhlke-slides.json`
- Test: `tests/core/skill-lint.test.ts`

**Interfaces:**
- Consumes: `AdapterManifest`, `Parse`, `ToolResult`, `RawFinding`, `Severity`, `classifyRule`.
- Produces:
  - `src/core/adapters/paths.ts` → `export function rebasePath(skillRelPath: string, uri: string): string`
  - `src/core/adapters/skill-lint.ts` → `export const manifest: AdapterManifest`, `export const parse: Parse`
  - `RULE_CLASS_MAP_VERSION` becomes `3`

- [ ] **Step 1: Move `rebasePath` into a shared module**

Two parsers now rebase a scanner-relative path onto the skill's repo-relative one, and importing it from `sarif.ts` into a JSON parser would name the wrong thing. Create `src/core/adapters/paths.ts` with the function moved verbatim from `sarif.ts`:

```ts
/**
 * A tool reports paths relative to the directory it was pointed at, which is
 * the candidate root, not the repo root. Scanning `declawed` yields `SKILL.md`
 * and `scripts/scan.py`; R8.3 wants `declawed/SKILL.md`. Rebasing here rather
 * than per parser is also what makes a materialised candidate and an in-place
 * one produce identical findings.
 */
export function rebasePath(skillRelPath: string, uri: string): string {
  const normalised = uri.replace(/\\/g, '/').replace(/^\.\//, '')
  if (skillRelPath === '.' || skillRelPath === '') return normalised
  if (normalised === '') return skillRelPath
  return `${skillRelPath}/${normalised}`
}
```

In `sarif.ts`, delete the local definition and its doc comment, and replace them with:

```ts
import { rebasePath } from './paths.js'

export { rebasePath }
```

The re-export keeps `tests/core/sarif.test.ts`, which imports `rebasePath` from `sarif.js`, working unchanged.

- [ ] **Step 2: Capture the two fixtures**

Extend `scripts/capture-fixtures.sh`. After the skillspector block, add:

```bash
PIN_SKILL_LINT="0.2.0"
LINT_BIN="${SKILL_LINT_BIN:-skill-lint}"
LINT_OUT="$(dirname "$0")/../tests/fixtures/skill-lint"
mkdir -p "$LINT_OUT"

lint_actual="$("$LINT_BIN" --version | tr -d 'v')"
if [ "$lint_actual" != "$PIN_SKILL_LINT" ]; then
  echo "skill-lint is $lint_actual, fixtures are pinned to $PIN_SKILL_LINT" >&2
  exit 1
fi

for skill in architecture-diagram zuhlke-slides; do
  # skill-lint exits 1 on WARN and 2 on TOXIC, which are findings rather than
  # failures, so a non-zero exit here must not abort the capture.
  "$LINT_BIN" "$REPO/$skill" --json > "$LINT_OUT/$skill.json" || true
  echo "captured $LINT_OUT/$skill.json"
done
```

Run it:

```bash
SKILL_LINT_BIN=~/.skillgantry/tools/skill-lint/node_modules/.bin/skill-lint \
  scripts/capture-fixtures.sh ~/dev/ai-sdlc/zapac-agent-skills
```

Then confirm the captured shape, because the assertions in Step 3 depend on it:

```bash
python3 -c "import json;d=json.load(open('tests/fixtures/skill-lint/architecture-diagram.json'));print(d['schemaVersion'],d['verdict'],[(f['ruleId'],f['file'],f['severity']) for f in d['findings']])"
```

Expected: `1 {'label': 'SAFE', 'score': 2, 'exitCode': 0} [('R06','scripts/build_gallery.py','LOW'), ('R06','scripts/html_to_png.py','LOW')]`

- [ ] **Step 3: Write the failing adapter test**

Create `tests/core/skill-lint.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { manifest, parse } from '../../src/core/adapters/skill-lint.js'
import type { SkillRef } from '../../src/core/types.js'

const skill = (relPath: string): SkillRef => ({
  id: `zapac/${relPath}`,
  name: relPath,
  version: null,
  dir: `/tmp/zapac/${relPath}`,
  relPath,
  repo: { id: 'zapac', path: '/tmp/zapac', name: 'zapac', isGit: true },
  rootSkill: false,
  workspacePath: `/tmp/zapac/${relPath}-workspace`,
})

const ctx = (stdout: string, relPath: string, exitCode: number) => ({
  skill: skill(relPath),
  artefacts: new Map<string, Buffer>(),
  stdout,
  stderr: '',
  exitCode,
  durationMs: 120,
})

describe('skill-lint manifest', () => {
  it('declares no artefact, because the report is on stdout', () => {
    expect(manifest.artefacts).toEqual([])
    expect(manifest.invoke.argv).toEqual(['{skillDir}', '--json'])
    expect(manifest.stage).toBe('validate')
    expect(manifest.policy).toBe('fan-out')
    expect(manifest.credentials).toEqual({ kind: 'none' })
  })
})

describe('skill-lint parse', () => {
  it('rebases findings onto the repo-relative path and classifies them', async () => {
    const stdout = await readFile('tests/fixtures/skill-lint/architecture-diagram.json', 'utf8')
    const result = parse(ctx(stdout, 'architecture-diagram', 0))

    expect(result.outcome).toBe('failed')
    expect(result.findings.map((f) => [f.path, f.ruleClass])).toEqual([
      ['architecture-diagram/scripts/build_gallery.py', 'unsafe-script'],
      ['architecture-diagram/scripts/html_to_png.py', 'unsafe-script'],
    ])
    expect(result.findings.every((f) => f.line === undefined)).toBe(true)
    expect(result.metrics.findingsTotal).toBe(2)
    expect(result.metrics.filesScanned).toBeGreaterThan(0)
  })

  it('takes severity from the finding, not from the rule id', async () => {
    const stdout = await readFile('tests/fixtures/skill-lint/zuhlke-slides.json', 'utf8')
    const result = parse(ctx(stdout, 'zuhlke-slides', 2))
    const r06 = result.findings.filter((f) => f.nativeRuleId === 'R06')
    // One rule id, two severities: HIGH for a .pyc, LOW for a bundled .py.
    expect(new Set(r06.map((f) => f.severity))).toEqual(new Set(['high', 'low']))
    expect(result.findings.some((f) => f.ruleClass === 'metadata-invalid')).toBe(true)
  })

  it('passes on a clean report even when the exit code is non-zero', () => {
    const clean = JSON.stringify({
      tool: 'skill-lint', schemaVersion: 1, skill: { files: [] },
      findings: [], verdict: { label: 'WARN', score: 0, exitCode: 1 },
    })
    // Row 11 of the R4.13 table: the parse is authoritative, the exit code is
    // fallback evidence only.
    expect(parse(ctx(clean, 'a', 1)).outcome).toBe('passed')
  })

  it('errors on stdout that is not JSON', () => {
    const result = parse(ctx('Usage: skill-lint <path>\n', 'a', 3))
    expect(result.outcome).toBe('errored')
    expect(result.summary).toMatch(/not JSON/)
  })

  it('errors on an unexpected schema version rather than guessing', () => {
    const future = JSON.stringify({ tool: 'skill-lint', schemaVersion: 2, findings: [] })
    const result = parse(ctx(future, 'a', 0))
    expect(result.outcome).toBe('errored')
    expect(result.summary).toMatch(/schemaVersion/)
  })
})
```

- [ ] **Step 4: Run it and watch it fail**

Run: `pnpm vitest run tests/core/skill-lint.test.ts`
Expected: FAIL — `src/core/adapters/skill-lint.js` does not exist.

- [ ] **Step 5: Write the adapter**

Create `src/core/adapters/skill-lint.ts`:

```ts
import type { RawFinding, Severity } from '../types.js'
import { rebasePath } from './paths.js'
import { classifyRule } from './rule-classes.js'
import type { AdapterManifest, Parse, ToolResult } from './types.js'

/**
 * skill-lint writes its whole report to stdout and offers no --output flag, so
 * this is the first adapter declaring no artefact. Row 7 of the §8.1 table, a
 * declared artefact missing after exit, therefore cannot fire for it; a tool
 * that produced nothing usable is caught by the schema check in parse instead.
 *
 * It stays a validate tool although three of its four rules are security rules:
 * R09 checks SKILL.md frontmatter, which is validate's job, and agentskills —
 * validate's other D7 candidate — is unpublished, so moving it would leave the
 * first gate with no tool. Its security-class findings still merge with
 * skillspector's, because the fingerprint carries no stage component.
 */
export const manifest: AdapterManifest = {
  id: 'skill-lint',
  stage: 'validate',
  policy: 'fan-out',
  mutating: false,
  detects: ['unsafe-script', 'vulnerable-dep', 'excessive-permission', 'metadata-invalid'],
  credentials: { kind: 'none' },
  analysisMode: 'static',
  install: { kind: 'npm-prefix', spec: 'skill-lint', pin: '0.2.0', binName: 'skill-lint' },
  invoke: { argv: ['{skillDir}', '--json'], cwd: 'repoRoot' },
  versionArgv: ['--version'],
  artefacts: [],
  timeoutMs: 60_000,
}

const SCHEMA_VERSION = 1

const SEVERITY: Readonly<Record<string, Severity>> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info',
}

interface Finding {
  ruleId?: string
  severity?: string
  file?: string
  message?: string
  title?: string
}

interface Report {
  schemaVersion?: number
  skill?: { files?: unknown[] }
  findings?: Finding[]
}

const errored = (summary: string): ToolResult => ({
  outcome: 'errored',
  findings: [],
  metrics: {},
  summary,
})

export const parse: Parse = (ctx) => {
  let doc: Report
  try {
    doc = JSON.parse(ctx.stdout) as Report
  } catch {
    return errored('skill-lint stdout was not JSON')
  }

  // Pinned rather than tolerated: upstream schema drift must surface as
  // `errored` with the log retained, never as a confidently wrong result.
  if (doc.schemaVersion !== SCHEMA_VERSION) {
    return errored(`unexpected skill-lint schemaVersion: ${String(doc.schemaVersion)}`)
  }

  const findings: RawFinding[] = (doc.findings ?? []).map((f) => {
    const nativeRuleId = f.ruleId ?? 'unknown'
    return {
      ruleClass: classifyRule(manifest.id, nativeRuleId),
      nativeRuleId,
      severity: SEVERITY[f.severity ?? ''] ?? 'medium',
      path: rebasePath(ctx.skill.relPath, f.file ?? ''),
      message: f.message ?? f.title ?? nativeRuleId,
    }
  })

  return {
    outcome: findings.length === 0 ? 'passed' : 'failed',
    findings,
    metrics: {
      findingsTotal: findings.length,
      filesScanned: doc.skill?.files?.length ?? 0,
      durationMs: ctx.durationMs,
    },
    summary:
      findings.length === 0
        ? 'no findings'
        : `${findings.length} finding${findings.length === 1 ? '' : 's'}`,
  }
}
```

skill-lint emits no line numbers, so `RawFinding.line` is never set — which `exactOptionalPropertyTypes` makes easier to get right than to get wrong.

- [ ] **Step 6: Add the skill-lint rule mappings and bump the map version**

In `src/core/adapters/rule-classes.ts`, add a second tool block and bump the version to `3`:

```ts
export const RULE_CLASS_MAP_VERSION = 3
```

```ts
  'skill-lint': {
    R05: 'vulnerable-dep',          // Runtime external fetch from an unpinned host
    R06: 'unsafe-script',           // Suspicious file in skill
    R07: 'excessive-permission',    // Persistence / agent-state tamper
    R09: 'metadata-invalid',        // Metadata abuse
  },
```

`R05` maps to `vulnerable-dep` rather than `data-exfiltration`: it fires on content pulled *in* from an unpinned host, which is the same shape as skillspector's `RP1` (MCP server referenced without a pinned version), and exfiltration is content going *out*. Mapping the two together gives the merge a second, independent axis.

Extend `tests/core/rule-classes.test.ts` with:

```ts
  it('maps every skill-lint rule the pinned version produced', () => {
    expect(classifyRule('skill-lint', 'R05')).toBe('vulnerable-dep')
    expect(classifyRule('skill-lint', 'R06')).toBe('unsafe-script')
    expect(classifyRule('skill-lint', 'R07')).toBe('excessive-permission')
    expect(classifyRule('skill-lint', 'R09')).toBe('metadata-invalid')
  })
```

- [ ] **Step 7: Register the adapter**

In `src/core/adapters/registry.ts`:

```ts
import * as skillLint from './skill-lint.js'
import * as skillspector from './skillspector.js'

const ADAPTERS: readonly Adapter[] = [
  { manifest: skillspector.manifest, parse: skillspector.parse },
  { manifest: skillLint.manifest, parse: skillLint.parse },
]
```

- [ ] **Step 8: Run the adapter, map, registry, catalogue and boundary suites**

Run: `pnpm vitest run tests/core/skill-lint.test.ts tests/core/rule-classes.test.ts tests/core/catalogue.test.ts tests/core/sarif.test.ts tests/boundary.test.ts`
Expected: PASS. `catalogue.test.ts` asserts a manifest's `install` and `versionArgv` equal the catalogue entry's for every tool holding both — so a typo in either is caught here rather than at install time. `boundary.test.ts` proves the no-`node:fs`-in-adapters rule still fires.

- [ ] **Step 9: Commit**

```bash
git add src/core/adapters/paths.ts src/core/adapters/sarif.ts src/core/adapters/skill-lint.ts \
        src/core/adapters/rule-classes.ts src/core/adapters/registry.ts \
        scripts/capture-fixtures.sh tests/fixtures/skill-lint tests/core/skill-lint.test.ts \
        tests/core/rule-classes.test.ts
git commit -m "feat(adapters): add skill-lint, parsing its JSON report from stdout

First adapter with no artefact file: skill-lint offers no --output flag,
so parse reads ctx.stdout and pins schemaVersion 1 rather than tolerating
drift. rebasePath moves to adapters/paths.ts now that two parsers need it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The shared `v1alpha1` eval-report parser and the skill-up adapter

**Files:**
- Create: `src/core/adapters/eval-report.ts`
- Create: `src/core/adapters/skill-up.ts`
- Modify: `src/core/adapters/registry.ts`
- Modify: `scripts/capture-fixtures.sh`
- Create: `tests/fixtures/skill-up/declawed-iteration-1.report.json`, `tests/fixtures/skill-up/declawed-iteration-3.report.json`
- Test: `tests/core/eval-report.test.ts`, `tests/core/skill-up.test.ts`

**Interfaces:**
- Consumes: `rebasePath` from `./paths.js`; `AdapterManifest`, `Parse`, `ToolResult`.
- Produces:
  - `src/core/adapters/eval-report.ts` → `export interface EvalReportOptions { toolId: string; skillRelPath: string }` and `export function parseEvalReport(bytes: Buffer, opts: EvalReportOptions): ToolResult`
  - `src/core/adapters/skill-up.ts` → `export const manifest: AdapterManifest`, `export const parse: Parse`

This is R4.4's second shared parser. It lives in the engine rather than in the adapter so a future evaluate harness emitting `v1alpha1` needs no bespoke parsing — the same reason `sarif.ts` is shared between skillspector and skill-scanner.

- [ ] **Step 1: Capture the fixtures**

The reference repo holds three real `v1alpha1` reports, one with a failing case. Add to `scripts/capture-fixtures.sh`:

```bash
UP_OUT="$(dirname "$0")/../tests/fixtures/skill-up"
mkdir -p "$UP_OUT"

# skill-up run needs an Agent Engine and spends real model budget, so these are
# copied from the reference repo's own iterations rather than re-run. The schema
# version is asserted here, which is the property the parser is pinned to.
for it in 1 3; do
  src="$REPO/declawed-workspace/iteration-$it/report.json"
  ver="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['schema_version'])" "$src")"
  if [ "$ver" != "v1alpha1" ]; then
    echo "iteration-$it report is $ver, the parser is pinned to v1alpha1" >&2
    exit 1
  fi
  cp "$src" "$UP_OUT/declawed-iteration-$it.report.json"
  echo "captured $UP_OUT/declawed-iteration-$it.report.json"
done
```

Run the script and confirm:

```bash
python3 -c "import json;d=json.load(open('tests/fixtures/skill-up/declawed-iteration-1.report.json'));print(d['schema_version'],[c['status'] for c in d['case_results']])"
```

Expected: `v1alpha1 ['PASS', 'FAIL', 'PASS', 'PASS', 'PASS']`

- [ ] **Step 2: Write the failing parser test**

Create `tests/core/eval-report.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { parseEvalReport } from '../../src/core/adapters/eval-report.js'

const load = (n: number): Promise<Buffer> =>
  readFile(`tests/fixtures/skill-up/declawed-iteration-${n}.report.json`)

const opts = { toolId: 'skill-up', skillRelPath: 'declawed' }

describe('parseEvalReport', () => {
  it('turns each non-PASS case into one eval-failure finding pathed at its case file', async () => {
    const result = parseEvalReport(await load(1), opts)

    expect(result.outcome).toBe('failed')
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.ruleClass).toBe('eval-failure')
    expect(result.findings[0]?.path).toBe(
      'declawed/evals/cases/report-scan-and-changelog.yaml',
    )
    expect(result.findings[0]?.nativeRuleId).toBe('report-scan-and-changelog')
  })

  it('passes when every case passed', async () => {
    const result = parseEvalReport(await load(3), opts)
    expect(result.outcome).toBe('passed')
    expect(result.findings).toEqual([])
  })

  it('reports case counts and turns, and no token metric', async () => {
    const result = parseEvalReport(await load(1), opts)
    expect(result.metrics.casesTotal).toBe(5)
    expect(result.metrics.casesPassed).toBe(4)
    expect(result.metrics.turns).toBeGreaterThan(0)
    // R1.5: the report carries input_tokens, output_tokens and total_tokens.
    // MetricKey has no key that could hold them, so they must not appear.
    expect(Object.keys(result.metrics).join(' ')).not.toMatch(/token|cost/i)
  })

  it('errors on a schema version it was not pinned to', () => {
    const other = Buffer.from(JSON.stringify({ schema_version: 'v1beta1', case_results: [] }))
    const result = parseEvalReport(other, opts)
    expect(result.outcome).toBe('errored')
    expect(result.summary).toMatch(/v1alpha1/)
  })

  it('errors on bytes that are not JSON', () => {
    expect(parseEvalReport(Buffer.from('not json'), opts).outcome).toBe('errored')
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm vitest run tests/core/eval-report.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 4: Write the shared parser**

Create `src/core/adapters/eval-report.ts`:

```ts
import type { RawFinding } from '../types.js'
import { rebasePath } from './paths.js'
import type { ToolResult } from './types.js'

const SCHEMA_VERSION = 'v1alpha1'

interface AssertionResult {
  text?: string
  passed?: boolean
  evidence?: string
}

interface CaseResult {
  case_id?: string
  title?: string
  status?: string
  turns?: number
  grading?: { assertion_results?: AssertionResult[] }
}

interface EvalReport {
  schema_version?: string
  case_results?: CaseResult[]
}

export interface EvalReportOptions {
  toolId: string
  /** Repo-relative path of the evaluated skill; '.' for a repo-root skill. */
  skillRelPath: string
}

const errored = (summary: string): ToolResult => ({
  outcome: 'errored',
  findings: [],
  metrics: {},
  summary,
})

/**
 * Shared parser for skill-up's `v1alpha1` report — the second of the two R4.4
 * names, alongside sarif.ts. It lives in the engine so a future evaluate
 * harness emitting the same schema needs no parser of its own.
 *
 * A case result carries no file path, so a failure is pathed at the case file
 * skill-up's own layout implies. Pathing every failure at `evals/eval.yaml`
 * instead would collapse a whole failing suite into one issue, because identity
 * is (skillId, relPath, ruleClass) and the path is the only field that can
 * separate two failing cases. See design §7.2.
 *
 * Token fields present in the report are dropped rather than mapped: MetricKey
 * has no key that could hold them, and coerceMetrics throws on an unknown one.
 */
export function parseEvalReport(bytes: Buffer, opts: EvalReportOptions): ToolResult {
  let doc: EvalReport
  try {
    doc = JSON.parse(bytes.toString('utf8')) as EvalReport
  } catch {
    return errored('eval report could not be parsed as JSON')
  }

  if (doc.schema_version !== SCHEMA_VERSION) {
    return errored(
      `eval report is ${String(doc.schema_version)}, this parser is pinned to ${SCHEMA_VERSION}`,
    )
  }

  const cases = doc.case_results ?? []
  const findings: RawFinding[] = []
  let passed = 0
  let errors = 0
  let turns = 0

  for (const c of cases) {
    const status = (c.status ?? '').toUpperCase()
    turns += c.turns ?? 0
    if (status === 'PASS') {
      passed += 1
      continue
    }
    if (status === 'ERROR') errors += 1

    const caseId = c.case_id ?? 'unknown'
    const failed = (c.grading?.assertion_results ?? []).filter((a) => a.passed === false)
    const detail = failed.map((a) => a.evidence ?? a.text ?? '').filter(Boolean).join('; ')

    findings.push({
      ruleClass: 'eval-failure',
      nativeRuleId: caseId,
      severity: status === 'ERROR' ? 'high' : 'medium',
      path: rebasePath(opts.skillRelPath, `evals/cases/${caseId}.yaml`),
      message: detail === '' ? (c.title ?? caseId) : `${c.title ?? caseId}: ${detail}`,
    })
  }

  return {
    outcome: findings.length === 0 ? 'passed' : 'failed',
    findings,
    metrics: {
      casesTotal: cases.length,
      casesPassed: passed,
      casesErrored: errors,
      turns,
    },
    summary: `${passed}/${cases.length} cases passed`,
  }
}
```

- [ ] **Step 5: Run the parser test to green**

Run: `pnpm vitest run tests/core/eval-report.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Write the failing adapter test**

Create `tests/core/skill-up.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { manifest, parse } from '../../src/core/adapters/skill-up.js'
import type { SkillRef } from '../../src/core/types.js'

const skill: SkillRef = {
  id: 'zapac/declawed',
  name: 'declawed',
  version: null,
  dir: '/tmp/zapac/declawed',
  relPath: 'declawed',
  repo: { id: 'zapac', path: '/tmp/zapac', name: 'zapac', isGit: true },
  rootSkill: false,
  workspacePath: '/tmp/zapac/declawed-workspace',
}

const REPORT = 'iteration-1/report.json'

describe('skill-up manifest', () => {
  it('is the only pick-one stage tool, and redirects its own iteration output', () => {
    expect(manifest.stage).toBe('evaluate')
    expect(manifest.policy).toBe('pick-one')
    // Without --output-dir, skill-up writes iteration-N into <skill>-workspace,
    // which is the sidecar SkillGantry owns and R6.5 forbids it to write.
    expect(manifest.invoke.argv).toContain('--output-dir')
    expect(manifest.invoke.argv).toContain('{toolDir}')
    expect(manifest.artefacts).toEqual([REPORT])
  })
})

describe('skill-up parse', () => {
  it('reports the failing case from a real v1alpha1 report', async () => {
    const bytes = await readFile('tests/fixtures/skill-up/declawed-iteration-1.report.json')
    const result = parse({
      skill,
      artefacts: new Map([[REPORT, bytes]]),
      stdout: '',
      stderr: '',
      exitCode: 1,
      durationMs: 114_000,
    })
    expect(result.outcome).toBe('failed')
    expect(result.findings).toHaveLength(1)
    expect(result.metrics.durationMs).toBe(114_000)
  })

  it('errors when the declared report is absent from the artefact map', () => {
    const result = parse({
      skill,
      artefacts: new Map(),
      stdout: '',
      stderr: '',
      exitCode: 0,
      durationMs: 5,
    })
    expect(result.outcome).toBe('errored')
  })
})
```

- [ ] **Step 7: Run it and watch it fail**

Run: `pnpm vitest run tests/core/skill-up.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 8: Write the adapter**

Create `src/core/adapters/skill-up.ts`:

```ts
import { parseEvalReport } from './eval-report.js'
import type { AdapterManifest, Parse } from './types.js'

const REPORT = 'iteration-1/report.json'

/**
 * `--output-dir {toolDir}` is not optional. skill-up's default output is
 * `<skill-name>-workspace` alongside the skill — the sidecar SkillGantry owns —
 * and it writes `iteration-N` there, which is exactly what R6.5 forbids
 * SkillGantry to touch. Redirecting into the run's tool directory keeps the
 * user's hand-run iterations intact and puts this run's report where
 * `tool_runs.artefact_dir` already points.
 *
 * `--iteration 1` pins the directory name so the declared artefact path is
 * knowable. The tool directory is created fresh per run, so auto-numbering
 * would land on `iteration-1` anyway; the flag makes that a contract rather
 * than a coincidence.
 *
 * `credentials: { kind: 'none' }` is honest rather than convenient: the Agent
 * Engine is declared by the skill's own `evals/eval.yaml` — `claude_code` in
 * every reference skill — and skill-up resolves that CLI's authentication
 * itself. CredentialRequirement can say "these env keys are set"; it cannot say
 * "an external CLI is logged in". A missing engine therefore surfaces as
 * errored/missing-artefact, not skipped/no-credentials. See the known gaps.
 */
export const manifest: AdapterManifest = {
  id: 'skill-up',
  stage: 'evaluate',
  policy: 'pick-one',
  mutating: false,
  detects: ['eval-failure'],
  credentials: { kind: 'none' },
  analysisMode: 'engine-from-eval-yaml',
  install: {
    kind: 'gh-release',
    repo: 'alibaba/skill-up',
    pin: 'v0.7.0',
    assetPattern: 'skill-up_0\\.7\\.0_{os}_{arch}\\.tar\\.gz',
    binName: 'skill-up',
    integrity: { kind: 'sha256-asset', assetPattern: 'skill-up_0\\.7\\.0_checksums\\.txt' },
  },
  invoke: {
    argv: [
      'run',
      '{skillDir}/evals/eval.yaml',
      '--format',
      'json',
      '--output-dir',
      '{toolDir}',
      '--iteration',
      '1',
    ],
    cwd: 'skillDir',
  },
  versionArgv: ['--version'],
  artefacts: [REPORT],
  // An eval takes minutes, not seconds: declawed's five cases ran 1m54s against
  // claude_code. Fifteen minutes is a ceiling for a hung engine, not a target.
  timeoutMs: 900_000,
}

export const parse: Parse = (ctx) => {
  const bytes = ctx.artefacts.get(REPORT)
  if (!bytes) {
    return {
      outcome: 'errored',
      findings: [],
      metrics: {},
      summary: `skill-up produced no ${REPORT}`,
    }
  }
  const result = parseEvalReport(bytes, {
    toolId: manifest.id,
    skillRelPath: ctx.skill.relPath,
  })
  return { ...result, metrics: { ...result.metrics, durationMs: ctx.durationMs } }
}
```

- [ ] **Step 9: Register it and run the suites**

Add to `src/core/adapters/registry.ts`:

```ts
import * as skillUp from './skill-up.js'
```

```ts
  { manifest: skillUp.manifest, parse: skillUp.parse },
```

Run: `pnpm vitest run tests/core/skill-up.test.ts tests/core/eval-report.test.ts tests/core/catalogue.test.ts`
Expected: PASS. `catalogue.test.ts` compares this manifest's `install` against the catalogue's `skill-up` entry field by field — the `assetPattern` escaping is the easiest thing to get subtly wrong, and that comparison is what catches it.

- [ ] **Step 10: Verify the iteration directory against the real tool**

This is the one manifest claim the fixtures cannot prove. With a working Agent Engine:

```bash
cd ~/dev/ai-sdlc/zapac-agent-skills/declawed
mkdir -p /tmp/su-check
~/.skillgantry/tools/skill-up/skill-up run ./evals/eval.yaml \
  --format json --output-dir /tmp/su-check --iteration 1 \
  --include-case-name 'strip-not-x-but-y'
ls /tmp/su-check
```

Expected: `iteration-1/` containing `report.json` and `result.json`.

If skill-up ignores `--iteration` and numbers differently, change `REPORT` and `manifest.artefacts` to the real path in both `skill-up.ts` and `skill-up.test.ts`, and record it under "Deviations found while implementing". Do not leave the manifest asserting a path the tool does not write — that would classify every eval run as `missing-artefact`.

If no engine is available, say so in the task report rather than marking this step done.

- [ ] **Step 11: Commit**

```bash
git add src/core/adapters/eval-report.ts src/core/adapters/skill-up.ts \
        src/core/adapters/registry.ts scripts/capture-fixtures.sh \
        tests/fixtures/skill-up tests/core/eval-report.test.ts tests/core/skill-up.test.ts
git commit -m "feat(adapters): add skill-up and the shared v1alpha1 eval parser

Second of the two shared parsers R4.4 requires. Failing cases become
eval-failure findings pathed at their case file, so two failing cases are
two issues rather than one. Token fields in the report are dropped: no
MetricKey can hold them (R1.5). --output-dir keeps skill-up's iteration-N
out of the sidecar R6.5 protects.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The skill-scanner adapter, with declared LLM credentials

**Files:**
- Create: `src/core/adapters/skill-scanner.ts`
- Modify: `src/core/adapters/rule-classes.ts` (skill-scanner entries, version 4)
- Modify: `src/core/adapters/registry.ts`
- Modify: `scripts/capture-fixtures.sh`
- Create: `tests/fixtures/sarif/skill-scanner-declawed.sarif`
- Test: `tests/core/skill-scanner.test.ts`

**Interfaces:**
- Consumes: `parseSarif(bytes, { toolId, skillRelPath })`, `credentialsSatisfied(req, env)`, `missingCredentials(req)`.
- Produces: `src/core/adapters/skill-scanner.ts` → `export const manifest: AdapterManifest`, `export const parse: Parse`; `RULE_CLASS_MAP_VERSION` becomes `4`.

**This task needs an LLM key.** skill-scanner has no offline mode, so the fixture cannot be captured without one. Set `SKILLSCAN_API_KEY` and `SKILLSCAN_MODEL` (or `SKILLSCAN_BASE_URL` and `SKILLSCAN_MODEL` for a local gateway) before Step 2. Without a key, stop and report the task as blocked rather than hand-authoring a SARIF file — R13.3 requires fixtures captured from real runs, and a hand-written one would assert the parser against a schema nobody has seen.

- [ ] **Step 1: Confirm the tool refuses to run offline, so the credential declaration is grounded**

Run:

```bash
~/.skillgantry/tools/skill-scanner/bin/skill-scanner scan \
  --path ~/dev/ai-sdlc/zapac-agent-skills/declawed --no-ai --no-vt \
  --format sarif --output /tmp/should-not-exist.sarif; echo "exit=$?"
```

Expected: exit 2, `No analyzers enabled for scan. Configure SKILLSCAN_API_KEY or SKILLSCAN_BASE_URL for LLM analysis and/or VT_API_KEY for VirusTotal`, and no file written. This is why the manifest declares `credentials: one-of` and `analysisMode: 'llm'`.

- [ ] **Step 2: Capture the fixture with a key**

Add to `scripts/capture-fixtures.sh`, after the skillspector block:

```bash
PIN_SKILL_SCANNER="0.3.3"
SCAN_BIN="${SKILL_SCANNER_BIN:-skill-scanner}"

# skill-scanner has no static mode: --no-ai --no-vt exits 2 with "No analyzers
# enabled". The fixture is therefore an LLM-mode capture and needs a key. It is
# skipped rather than failed when none is set, so a contributor without a key
# can still refresh every other fixture.
if [ -n "${SKILLSCAN_API_KEY:-}${SKILLSCAN_BASE_URL:-}" ]; then
  scan_actual="$("$SCAN_BIN" --version | tr -d 'v')"
  if [ "$scan_actual" != "$PIN_SKILL_SCANNER" ]; then
    echo "skill-scanner is $scan_actual, fixtures are pinned to $PIN_SKILL_SCANNER" >&2
    exit 1
  fi
  "$SCAN_BIN" scan --path "$REPO/declawed" --no-vt --format sarif \
    --output "$OUT/skill-scanner-declawed.sarif"
  echo "captured $OUT/skill-scanner-declawed.sarif"
else
  echo "skipping skill-scanner: set SKILLSCAN_API_KEY or SKILLSCAN_BASE_URL to capture it" >&2
fi
```

Run it with a key set, then read what came back — the `detects` list and the rule mappings in Steps 4 and 6 are derived from this output, not guessed:

```bash
python3 -c "
import json,collections
d=json.load(open('tests/fixtures/sarif/skill-scanner-declawed.sarif'))
rules={}; seen=collections.Counter()
for run in d['runs']:
    for r in run.get('tool',{}).get('driver',{}).get('rules',[]):
        rules[r['id']]=(r.get('shortDescription') or {}).get('text')
    for r in run.get('results',[]):
        seen[r.get('ruleId')]+=1
        loc=r['locations'][0]['physicalLocation']
        print(r.get('ruleId'), r.get('level'), loc['artifactLocation'].get('uri'))
print('rules:', rules); print('counts:', dict(seen))"
```

- [ ] **Step 3: Write the failing adapter test**

Create `tests/core/skill-scanner.test.ts`. Fill the two marked assertions from the Step 2 output — they are the only values in this plan that a capture, not a probe, supplies:

```ts
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { manifest, parse } from '../../src/core/adapters/skill-scanner.js'
import { credentialsSatisfied, missingCredentials } from '../../src/core/adapters/types.js'
import type { SkillRef } from '../../src/core/types.js'

const skill: SkillRef = {
  id: 'zapac/declawed',
  name: 'declawed',
  version: null,
  dir: '/tmp/zapac/declawed',
  relPath: 'declawed',
  repo: { id: 'zapac', path: '/tmp/zapac', name: 'zapac', isGit: true },
  rootSkill: false,
  workspacePath: '/tmp/zapac/declawed-workspace',
}

describe('skill-scanner manifest', () => {
  it('declares LLM mode and the credential sets that mode actually accepts', () => {
    expect(manifest.analysisMode).toBe('llm')
    expect(manifest.credentials.kind).toBe('one-of')
    // --no-ai --no-vt exits 2 with "No analyzers enabled", so there is no
    // offline mode to fall back to. A mode change would be a new adapter id.
    expect(manifest.invoke.argv).toContain('--no-vt')
    expect(manifest.invoke.argv).not.toContain('--no-ai')
  })

  it('is unsatisfied without a model, which the tool requires explicitly', () => {
    expect(credentialsSatisfied(manifest.credentials, {})).toBe(false)
    expect(credentialsSatisfied(manifest.credentials, { SKILLSCAN_API_KEY: 'k' })).toBe(false)
    expect(
      credentialsSatisfied(manifest.credentials, { SKILLSCAN_API_KEY: 'k', SKILLSCAN_MODEL: 'm' }),
    ).toBe(true)
    expect(
      credentialsSatisfied(manifest.credentials, { SKILLSCAN_BASE_URL: 'u', SKILLSCAN_MODEL: 'm' }),
    ).toBe(true)
    expect(missingCredentials(manifest.credentials)).toMatch(/SKILLSCAN_MODEL/)
  })
})

describe('skill-scanner parse', () => {
  it('parses its captured SARIF into repo-relative findings', async () => {
    const bytes = await readFile('tests/fixtures/sarif/skill-scanner-declawed.sarif')
    const result = parse({
      skill,
      artefacts: new Map([['findings.sarif', bytes]]),
      stdout: '',
      stderr: '',
      exitCode: 0,
      durationMs: 40_000,
    })

    expect(['passed', 'failed']).toContain(result.outcome)
    for (const f of result.findings) {
      expect(f.path.startsWith('declawed/')).toBe(true)
    }
    // FROM THE STEP 2 CAPTURE: the finding count in the fixture.
    expect(result.findings).toHaveLength(/* fill from capture */ 0)
    // FROM THE STEP 2 CAPTURE: at least one class that is not unmapped:, proving
    // the Step 6 mappings cover what this version emits.
    expect(result.findings.some((f) => !f.ruleClass.startsWith('unmapped:'))).toBe(true)
  })

  it('errors when the declared SARIF is absent', () => {
    const result = parse({
      skill,
      artefacts: new Map(),
      stdout: '',
      stderr: '',
      exitCode: 2,
      durationMs: 10,
    })
    expect(result.outcome).toBe('errored')
  })
})
```

- [ ] **Step 4: Run it and watch it fail**

Run: `pnpm vitest run tests/core/skill-scanner.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 5: Write the adapter**

Create `src/core/adapters/skill-scanner.ts`. Replace the `detects` list with the classes the Step 2 capture actually produced:

```ts
import { parseSarif } from './sarif.js'
import type { AdapterManifest, Parse } from './types.js'

/**
 * skill-scanner 0.3.3 has no static mode. `scan --no-ai --no-vt` exits 2 with
 * "No analyzers enabled for scan", so unlike skillspector there is no offline
 * analysis to pin. The adapter therefore declares LLM mode and the credential
 * sets that mode accepts, and reports `skipped`/`no-credentials` when the user
 * has none — which is the fail-safe R4.10 asks for: a selected tool that cannot
 * run is never silently dropped, and a skipped tool closes no issue.
 *
 * VirusTotal is a different analyser covering different rule classes, so it is
 * a separate adapter id if it is ever wanted, never a fallback from this one.
 * R4.2b: a silent mode change makes two runs' statistics incomparable.
 *
 * Its findings are nondeterministic, so the golden fixture is a point-in-time
 * capture. The parse test asserts what the parser does with those bytes, not
 * that a re-run reproduces them.
 */
export const manifest: AdapterManifest = {
  id: 'skill-scanner',
  stage: 'security',
  policy: 'fan-out',
  mutating: false,
  detects: [
    /* FROM THE STEP 2 CAPTURE — the classes the Step 6 map assigns to the rule
       ids this version emitted. Under §10.4 a too-narrow list costs
       completeness, not correctness, but it must not name a class the tool
       cannot produce. */
  ],
  credentials: {
    kind: 'one-of',
    alternatives: [
      // `skill-scanner doctor`: "LLM analysis requires an explicit
      // SKILLSCAN_MODEL or --model value. No default model is applied."
      { provider: 'Hosted model', required: ['SKILLSCAN_API_KEY', 'SKILLSCAN_MODEL'] },
      { provider: 'Local or gateway model', required: ['SKILLSCAN_BASE_URL', 'SKILLSCAN_MODEL'] },
    ],
  },
  analysisMode: 'llm',
  install: { kind: 'uv-tool', spec: 'skill-scanner', pin: '0.3.3', binName: 'skill-scanner' },
  invoke: {
    argv: [
      'scan',
      '--path',
      '{skillDir}',
      '--no-vt',
      '--format',
      'sarif',
      '--output',
      '{toolDir}/findings.sarif',
    ],
    cwd: 'repoRoot',
  },
  versionArgv: ['--version'],
  artefacts: ['findings.sarif'],
  timeoutMs: 600_000,
}

export const parse: Parse = (ctx) => {
  const bytes = ctx.artefacts.get('findings.sarif')
  if (!bytes) {
    return {
      outcome: 'errored',
      findings: [],
      metrics: {},
      summary: 'skill-scanner produced no findings.sarif',
    }
  }
  const result = parseSarif(bytes, { toolId: manifest.id, skillRelPath: ctx.skill.relPath })
  return { ...result, metrics: { ...result.metrics, durationMs: ctx.durationMs } }
}
```

- [ ] **Step 6: Map its rule ids and bump the map version**

Add a `'skill-scanner'` block to `RULE_CLASS_MAP` with one entry per rule id the Step 2 capture produced, each mapped onto the `KnownRuleClass` its `shortDescription` names, and set:

```ts
export const RULE_CLASS_MAP_VERSION = 4
```

Map only ids the capture actually produced. A speculative mapping merges two unrelated problems into one issue, and no later signal can separate them again.

Extend `tests/core/rule-classes.test.ts` with one assertion per mapped id, in the shape the skillspector and skill-lint cases already use.

- [ ] **Step 7: Register it and run the suites**

Add to `src/core/adapters/registry.ts`:

```ts
import * as skillScanner from './skill-scanner.js'
```

```ts
  { manifest: skillScanner.manifest, parse: skillScanner.parse },
```

Run: `pnpm vitest run tests/core/skill-scanner.test.ts tests/core/rule-classes.test.ts tests/core/catalogue.test.ts tests/core/rule-map-migration.test.ts`
Expected: PASS. The migration test asserts `RULE_CLASS_MAP_VERSION >= 2` and records whatever version it applied, so bumping to 4 must not break it.

- [ ] **Step 8: Commit**

```bash
git add src/core/adapters/skill-scanner.ts src/core/adapters/rule-classes.ts \
        src/core/adapters/registry.ts scripts/capture-fixtures.sh \
        tests/fixtures/sarif/skill-scanner-declawed.sarif tests/core/skill-scanner.test.ts \
        tests/core/rule-classes.test.ts
git commit -m "feat(adapters): add skill-scanner in its only mode, LLM

0.3.3 has no static mode: --no-ai --no-vt exits 2 with 'No analyzers
enabled', so the manifest declares analysisMode llm and the two credential
sets it accepts. VirusTotal covers different rule classes and would be a
separate adapter id, never a fallback (R4.2b).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Make the merge real — occurrence counting across a run, and the cross-tool contract

**Files:**
- Modify: `src/core/ledger/record.ts`
- Test: `tests/core/record-occurrences.test.ts` (new), `tests/core/cross-tool-merge.test.ts` (new)

**Interfaces:**
- Consumes: `recordRun(ledger, input)` and `RunRecordInput` unchanged; `StageResult`, `ToolRunRecord`; `fingerprint`.
- Produces: no new export. `recordRun`'s behaviour changes in one respect — `issues.occurrence_count` becomes the sum over every tool run in the run, per the design §10.3 sentence Task 1 sharpened.

`recordRun` declares `ordinalByFp` inside the per-tool-run loop and writes `occurrence_count` at the end of each tool run. With one tool per stage that is the total; with two, the second tool overwrites the first, so the recorded count depends on which finished last. That is invisible until a second tool exists, which is why it is M4's bug and not M1's.

- [ ] **Step 1: Write the failing occurrence test**

Create `tests/core/record-occurrences.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { openLedger } from '../../src/core/ledger/db.js'
import { fingerprint } from '../../src/core/ledger/fingerprint.js'
import { recordRun } from '../../src/core/ledger/record.js'
import type { StageResult, ToolRunRecord } from '../../src/core/stages/types.js'
import type { RawFinding, SkillRef } from '../../src/core/types.js'

const skill: SkillRef = {
  id: 'zapac/architecture-diagram',
  name: 'architecture-diagram',
  version: null,
  dir: '/tmp/zapac/architecture-diagram',
  relPath: 'architecture-diagram',
  repo: { id: 'zapac', path: '/tmp/zapac', name: 'zapac', isGit: true },
  rootSkill: false,
  workspacePath: '/tmp/zapac/architecture-diagram-workspace',
}

const PATH = 'architecture-diagram/scripts/html_to_png.py'

const finding = (nativeRuleId: string): RawFinding => ({
  ruleClass: 'unsafe-script',
  nativeRuleId,
  severity: 'medium',
  path: PATH,
  message: nativeRuleId,
})

const toolRun = (toolId: string, findings: RawFinding[]): ToolRunRecord => ({
  toolId,
  toolVersion: '1.0.0',
  outcome: findings.length === 0 ? 'passed' : 'failed',
  exitCode: 0,
  durationMs: 10,
  errorKind: null,
  artefactDir: `/tmp/ws/${toolId}`,
  findings,
  metrics: {},
  summary: '',
})

const stage = (name: 'validate' | 'security', toolRuns: ToolRunRecord[]): StageResult => ({
  stage: name,
  outcome: 'failed',
  verdict: 'failed',
  toolRuns,
})

const input = (runId: string, stages: StageResult[]) => ({
  skill,
  runId,
  trigger: 'test',
  startedAt: '2026-08-02T00:00:00Z',
  endedAt: '2026-08-02T00:01:00Z',
  outcome: 'failed',
  skillDigest: 'sha256:x',
  git: { commit: null, dirty: false },
  provenanceJson: '{}',
  toolLockJson: '{}',
  sidecarPath: '/tmp/ws',
  stages,
})

describe('occurrence_count across a run', () => {
  it('sums every tool run rather than keeping whichever finished last', () => {
    const ledger = openLedger(':memory:')
    recordRun(
      ledger,
      input('run-1', [
        // skillspector reports AST4 twice on one file; skill-lint reports R06
        // once on the same file. Both are unsafe-script, so one issue.
        stage('security', [toolRun('skillspector', [finding('AST4'), finding('AST4')])]),
        stage('validate', [toolRun('skill-lint', [finding('R06')])]),
      ]),
    )

    const fp = fingerprint(skill.id, PATH, 'unsafe-script')
    const row = ledger.db
      .prepare('select occurrence_count from issues where fingerprint = ?')
      .get(fp) as { occurrence_count: number }
    expect(row.occurrence_count).toBe(3)
  })

  it('resets rather than accumulates across runs', () => {
    const ledger = openLedger(':memory:')
    recordRun(ledger, input('run-1', [stage('security', [toolRun('skillspector', [finding('AST4'), finding('AST4')])])]))
    recordRun(ledger, input('run-2', [stage('security', [toolRun('skillspector', [finding('AST4')])])]))

    const fp = fingerprint(skill.id, PATH, 'unsafe-script')
    const row = ledger.db
      .prepare('select occurrence_count from issues where fingerprint = ?')
      .get(fp) as { occurrence_count: number }
    // "how many times was this seen last time we looked", not a running total.
    expect(row.occurrence_count).toBe(1)
  })
})
```

- [ ] **Step 2: Run it and watch the first case fail**

Run: `pnpm vitest run tests/core/record-occurrences.test.ts`
Expected: the first case FAILS with `expected 1 to be 3` — skill-lint's tool run wrote last. The second case passes already.

- [ ] **Step 3: Move the count out of the per-tool-run loop**

In `src/core/ledger/record.ts`, hoist the accumulator above the stage loop:

```ts
    const reconcileInput: ReconcileToolRun[] = []
    // Across the whole run, not per tool run: under fan-out two tools reporting
    // one issue would otherwise leave the count at whichever finished last, so
    // the number would depend on scheduling. Design §10.3.
    const occurrencesThisRun = new Map<string, number>()
```

Inside the per-tool-run loop, keep `ordinalByFp` where it is — the detection ordinal is per tool run and must stay so, or two tools would collide on `(issue_fp, tool_run_id, ordinal)` — and add one line where each detection is inserted:

```ts
          const ordinal = ordinalByFp.get(fp) ?? 0
          ordinalByFp.set(fp, ordinal + 1)
          occurrencesThisRun.set(fp, (occurrencesThisRun.get(fp) ?? 0) + 1)
```

Delete the per-tool-run write:

```ts
        for (const [fp, count] of ordinalByFp) {
          db.prepare('update issues set occurrence_count = ? where fingerprint = ?').run(count, fp)
        }
```

and add the run-level write immediately before the `reconcile` call:

```ts
    for (const [fp, count] of occurrencesThisRun) {
      db.prepare('update issues set occurrence_count = ? where fingerprint = ?').run(count, fp)
    }

    delta.closed = reconcile(db, skill.id, input.runId, reconcileInput)
```

- [ ] **Step 4: Run it to green**

Run: `pnpm vitest run tests/core/record-occurrences.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write the cross-tool merge contract test**

Create `tests/core/cross-tool-merge.test.ts`. This is R8.6, R8.8 and R8.13 over the two real fixture files, and it is the test the M4 exit criterion names:

```ts
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { parse as parseSkillLint } from '../../src/core/adapters/skill-lint.js'
import { parse as parseSkillspector } from '../../src/core/adapters/skillspector.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { fingerprint } from '../../src/core/ledger/fingerprint.js'
import { recordRun } from '../../src/core/ledger/record.js'
import type { StageResult, ToolRunRecord } from '../../src/core/stages/types.js'
import type { RawFinding, SkillRef } from '../../src/core/types.js'

const skill: SkillRef = {
  id: 'zapac/architecture-diagram',
  name: 'architecture-diagram',
  version: null,
  dir: '/tmp/zapac/architecture-diagram',
  relPath: 'architecture-diagram',
  repo: { id: 'zapac', path: '/tmp/zapac', name: 'zapac', isGit: true },
  rootSkill: false,
  workspacePath: '/tmp/zapac/architecture-diagram-workspace',
}

const MERGED = 'architecture-diagram/scripts/html_to_png.py'
const LINT_ONLY = 'architecture-diagram/scripts/build_gallery.py'

async function realFindings(): Promise<{ spector: RawFinding[]; lint: RawFinding[] }> {
  const sarif = await readFile('tests/fixtures/sarif/skillspector-architecture-diagram.sarif')
  const json = await readFile('tests/fixtures/skill-lint/architecture-diagram.json', 'utf8')
  const base = { skill, stderr: '', durationMs: 10 }
  const spector = parseSkillspector({
    ...base,
    artefacts: new Map([['findings.sarif', sarif]]),
    stdout: '',
    exitCode: 0,
  })
  const lint = parseSkillLint({ ...base, artefacts: new Map(), stdout: json, exitCode: 0 })
  return { spector: spector.findings, lint: lint.findings }
}

const toolRun = (toolId: string, findings: RawFinding[], outcome: ToolRunRecord['outcome'] = 'failed'): ToolRunRecord => ({
  toolId,
  toolVersion: '1.0.0',
  outcome,
  exitCode: 0,
  durationMs: 10,
  errorKind: outcome === 'errored' ? 'timeout' : null,
  artefactDir: `/tmp/ws/${toolId}`,
  findings,
  metrics: {},
  summary: '',
})

const stages = (spector: RawFinding[], lint: RawFinding[]): StageResult[] => [
  { stage: 'validate', outcome: 'failed', verdict: 'failed', toolRuns: [toolRun('skill-lint', lint)] },
  { stage: 'security', outcome: 'failed', verdict: 'failed', toolRuns: [toolRun('skillspector', spector)] },
]

const runInput = (runId: string, s: StageResult[]) => ({
  skill, runId, trigger: 'test',
  startedAt: '2026-08-02T00:00:00Z', endedAt: '2026-08-02T00:01:00Z',
  outcome: 'failed', skillDigest: 'sha256:x', git: { commit: null, dirty: false },
  provenanceJson: '{}', toolLockJson: '{}', sidecarPath: '/tmp/ws', stages: s,
})

describe('cross-tool merge over real fixtures', () => {
  it('resolves one problem seen by two tools to one issue with two detectors — R8.6', async () => {
    const { spector, lint } = await realFindings()
    const ledger = openLedger(':memory:')
    recordRun(ledger, runInput('run-1', stages(spector, lint)))

    const fp = fingerprint(skill.id, MERGED, 'unsafe-script')
    const detections = ledger.db
      .prepare('select count(*) as n from issue_detections where issue_fp = ?')
      .get(fp) as { n: number }
    const detectors = ledger.db
      .prepare('select tool_id from issue_detectors where issue_fp = ? order by tool_id')
      .all(fp) as Array<{ tool_id: string }>

    // skillspector AST4 twice plus skill-lint R06 once — R8.13, one row per
    // occurrence even though all three collapse to one issue.
    expect(detections.n).toBe(3)
    expect(detectors.map((d) => d.tool_id)).toEqual(['skill-lint', 'skillspector'])

    const issues = ledger.db
      .prepare('select count(*) as n from issues where skill_id = ?')
      .get(skill.id) as { n: number }
    expect(issues.n).toBe(4)
  })

  it('holds the merged issue open while one detector is inconclusive — R8.8', async () => {
    const { spector, lint } = await realFindings()
    const ledger = openLedger(':memory:')
    recordRun(ledger, runInput('run-1', stages(spector, lint)))

    // Run 2: skill-lint finds nothing, skillspector errored. The errored tool
    // contributes nothing, so the issue must survive.
    recordRun(ledger, runInput('run-2', [
      { stage: 'validate', outcome: 'passed', verdict: 'passed', toolRuns: [toolRun('skill-lint', [], 'passed')] },
      { stage: 'security', outcome: 'errored', verdict: 'passed', toolRuns: [toolRun('skillspector', [], 'errored')] },
    ]))

    const fp = fingerprint(skill.id, MERGED, 'unsafe-script')
    expect(ledger.db.prepare('select state from issues where fingerprint = ?').get(fp))
      .toEqual({ state: 'open' })

    // The single-detector issue has no such constraint and closes in run 2.
    const lintOnly = fingerprint(skill.id, LINT_ONLY, 'unsafe-script')
    expect(ledger.db.prepare('select state from issues where fingerprint = ?').get(lintOnly))
      .toEqual({ state: 'fixed' })
  })

  it('closes the merged issue once both detectors have run clean, in either order', async () => {
    for (const order of [['skill-lint', 'skillspector'], ['skillspector', 'skill-lint']]) {
      const { spector, lint } = await realFindings()
      const ledger = openLedger(':memory:')
      recordRun(ledger, runInput('run-1', stages(spector, lint)))

      // One tool clears in run 2, the other in run 3 — closure is a conjunction
      // over a set, so the order must not change the outcome.
      const clear = (tool: string): StageResult[] => [
        { stage: tool === 'skill-lint' ? 'validate' : 'security', outcome: 'passed', verdict: 'passed',
          toolRuns: [toolRun(tool, [], 'passed')] },
      ]
      recordRun(ledger, runInput('run-2', clear(order[0] as string)))
      const fp = fingerprint(skill.id, MERGED, 'unsafe-script')
      expect(ledger.db.prepare('select state from issues where fingerprint = ?').get(fp))
        .toEqual({ state: 'open' })

      recordRun(ledger, runInput('run-3', clear(order[1] as string)))
      expect(ledger.db.prepare('select state from issues where fingerprint = ?').get(fp))
        .toEqual({ state: 'fixed' })
    }
  })
})
```

- [ ] **Step 6: Capture the missing skillspector fixture**

The test needs `skillspector-architecture-diagram.sarif`, which the M1 capture script does not produce. Extend the skillspector block in `scripts/capture-fixtures.sh` to loop:

```bash
for skill in declawed architecture-diagram; do
  "$BIN" scan "$REPO/$skill" --no-llm --format sarif \
    --output "$OUT/skillspector-$skill.sarif"
  echo "captured $OUT/skillspector-$skill.sarif"
done
```

Run it and confirm the fixture holds the four results the merge test counts on:

```bash
python3 -c "
import json;d=json.load(open('tests/fixtures/sarif/skillspector-architecture-diagram.sarif'))
print([(r['ruleId'], r['locations'][0]['physicalLocation']['artifactLocation']['uri']) for run in d['runs'] for r in run['results']])"
```

Expected: `[('AST4','scripts/html_to_png.py'), ('AST4','scripts/html_to_png.py'), ('LP3','SKILL.md'), ('P2','layouts/connectors.md')]`

- [ ] **Step 7: Run the merge test to green**

Run: `pnpm vitest run tests/core/cross-tool-merge.test.ts`
Expected: PASS, 3 tests.

If the four-issue count is off, print what was recorded before changing an assertion — a fifth issue means a rule mapped differently than Task 2 and Task 3 intended, and the map is what should change, not the expectation.

- [ ] **Step 8: Run the full ledger and adapter suites**

Run: `pnpm vitest run tests/core/`
Expected: PASS. `reconcile.test.ts` and `issues.test.ts` cover the same machinery from the other side; a regression there means the occurrence change reached further than intended.

- [ ] **Step 9: Commit**

```bash
git add src/core/ledger/record.ts scripts/capture-fixtures.sh \
        tests/fixtures/sarif/skillspector-architecture-diagram.sarif \
        tests/core/record-occurrences.test.ts tests/core/cross-tool-merge.test.ts
git commit -m "fix(ledger): count occurrences across a run, not per tool run

Two tools reporting one issue left occurrence_count at whichever finished
last, so the number depended on scheduling. Invisible with one tool per
stage, which is why it surfaces now. Adds the cross-tool merge contract
test over real fixtures from both tools: one issue, three detections, two
detectors, closing only when both agree (R8.6, R8.8, R8.13).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Per-stage policy resolved from the selection

**Files:**
- Modify: `src/core/stages/adapter-stage.ts`
- Test: `tests/core/adapter-stage-policy.test.ts` (new), `tests/core/adapter-stage.test.ts` (extend)

**Interfaces:**
- Consumes: `getAdapter(id)`, `Adapter`, `StageContext`, `StagePlan`.
- Produces: `AdapterStageOptions` gains one optional field:

```ts
export interface AdapterStageOptions {
  credentialsOverride?: Readonly<Record<string, CredentialRequirement>>
  /** Test seam: substitute the adapter lookup, so a stage with no shipped adapter is testable. */
  lookup?: (id: string) => Adapter | undefined
}
```

`plan()` currently assigns `policy` inside the loop over selected tools, so it keeps the **last** adapter's policy. A selection whose first tool is `pick-one` and second is `fan-out` therefore ends up `fan-out`, and the guard that rejects more than one tool for a pick-one stage never fires. One adapter per stage made that unreachable; three do not.

- [ ] **Step 1: Write the failing policy test**

Create `tests/core/adapter-stage-policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { AdapterStageExecutor } from '../../src/core/stages/adapter-stage.js'
import { adaptersForStage, getAdapter, listAdapters } from '../../src/core/adapters/registry.js'
import type { Adapter } from '../../src/core/adapters/types.js'
import type { StageContext } from '../../src/core/stages/types.js'

const ctx = (stage: StageContext['stage'], ids: string[]): StageContext =>
  ({ stage, selectedToolIds: ids }) as unknown as StageContext

const withPolicy = (id: string, stage: string, policy: 'fan-out' | 'pick-one'): Adapter => ({
  manifest: { ...(getAdapter('skillspector') as Adapter).manifest, id, stage: stage as never, policy },
  parse: () => ({ outcome: 'passed', findings: [], metrics: {}, summary: '' }),
})

describe('plan() policy resolution', () => {
  it('fans out when every selected tool fans out — R4.6', async () => {
    const plan = await new AdapterStageExecutor('security').plan(
      ctx('security', ['skillspector', 'skill-scanner']),
    )
    expect(plan.policy).toBe('fan-out')
    expect(plan.toolIds).toEqual(['skillspector', 'skill-scanner'])
  })

  it('rejects more than one tool for a pick-one stage — R4.7', async () => {
    const lookup = (id: string): Adapter | undefined =>
      id.startsWith('e') ? withPolicy(id, 'evaluate', 'pick-one') : undefined
    await expect(
      new AdapterStageExecutor('evaluate', { lookup }).plan(ctx('evaluate', ['e1', 'e2'])),
    ).rejects.toThrow(/exactly one tool/)
  })

  it('rejects a pick-one tool listed before a fan-out one', async () => {
    // The bug this test exists for: policy was taken from the last adapter in
    // the loop, so a pick-one tool followed by a fan-out one resolved to
    // fan-out and both ran concurrently. R4.8 forbids exactly that for optimise.
    const lookup = (id: string): Adapter | undefined =>
      id === 'one' ? withPolicy('one', 'optimise', 'pick-one')
      : id === 'many' ? withPolicy('many', 'optimise', 'fan-out')
      : undefined
    await expect(
      new AdapterStageExecutor('optimise', { lookup }).plan(ctx('optimise', ['one', 'many'])),
    ).rejects.toThrow(/exactly one tool|disagree/)
  })

  it('rejects an empty selection before the run starts — R4.11', async () => {
    await expect(new AdapterStageExecutor('security').plan(ctx('security', []))).rejects.toThrow(
      /no tools selected/,
    )
  })
})

describe('optimise concurrency — R4.8', () => {
  it('ships no optimise adapter, so no run can select two', () => {
    expect(adaptersForStage('optimise')).toEqual([])
  })

  it('would serialise one if it existed: every optimise manifest is pick-one and mutating', () => {
    for (const a of listAdapters()) {
      if (a.manifest.stage !== 'optimise') continue
      expect(a.manifest.policy).toBe('pick-one')
      expect(a.manifest.mutating).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run it and watch the third case fail**

Run: `pnpm vitest run tests/core/adapter-stage-policy.test.ts`
Expected: the `lookup` cases FAIL — the option does not exist — and, once it does, the pick-one-before-fan-out case FAILS because `plan()` resolves to `fan-out`.

- [ ] **Step 3: Resolve policy from the whole selection**

In `src/core/stages/adapter-stage.ts`, extend the options type and add a lookup accessor:

```ts
export interface AdapterStageOptions {
  /** Test seam: substitute a manifest's credential requirement. */
  credentialsOverride?: Readonly<Record<string, CredentialRequirement>>
  /**
   * Test seam: substitute the adapter lookup. Optimise ships no adapter, so
   * R4.8's "two optimise tools must never run concurrently" would otherwise be
   * unassertable rather than merely unreachable.
   */
  lookup?: (id: string) => Adapter | undefined
}
```

Add to the class:

```ts
  private adapterFor(id: string): Adapter | undefined {
    return (this.options.lookup ?? getAdapter)(id)
  }
```

and replace `plan()`'s body:

```ts
  async plan(ctx: StageContext): Promise<StagePlan> {
    if (ctx.selectedToolIds.length === 0) {
      throw new Error(`no tools selected for stage ${ctx.stage}`)
    }

    const policies = new Set<'fan-out' | 'pick-one'>()
    for (const id of ctx.selectedToolIds) {
      const adapter = this.adapterFor(id)
      if (!adapter) throw new Error(`unknown tool: ${id}`)
      if (adapter.manifest.stage !== ctx.stage) {
        throw new Error(`${id} is not a ${ctx.stage} tool`)
      }
      policies.add(adapter.manifest.policy)
    }

    // Over the whole selection, not the last adapter seen. Reading the last one
    // meant a pick-one tool listed before a fan-out one resolved to fan-out, so
    // the guard below never fired — which is precisely R4.8's prohibition on two
    // optimise tools running concurrently.
    if (policies.has('pick-one')) {
      if (policies.size > 1) {
        throw new Error(`tools selected for stage ${ctx.stage} disagree on policy`)
      }
      if (ctx.selectedToolIds.length > 1) {
        throw new Error(`stage ${ctx.stage} accepts exactly one tool`)
      }
    }

    const policy: 'fan-out' | 'pick-one' = policies.has('pick-one') ? 'pick-one' : 'fan-out'
    return { toolIds: [...ctx.selectedToolIds], policy, mutationScope: { paths: [] } }
  }
```

Then replace the two `getAdapter(...)` calls in `execute()` with `this.adapterFor(...)`, so a substituted lookup holds for the whole executor rather than only for planning.

- [ ] **Step 4: Run the policy and stage suites to green**

Run: `pnpm vitest run tests/core/adapter-stage-policy.test.ts tests/core/adapter-stage.test.ts tests/core/outcome.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the fan-out artefact-collision case over both real scanners**

R4.9 already gives each tool its own directory, and M1 proved it with two fixture tools. Now that two real scanners both write `findings.sarif`, add the case to `tests/core/adapter-stage.test.ts` using `makeFakeTool` shims named for the real ids, each copying its fixture into `{toolDir}/findings.sarif`, and assert:

```ts
    expect(result.toolRuns.map((t) => t.artefactDir)).toEqual([
      join(stageDir, 'skillspector'),
      join(stageDir, 'skill-scanner'),
    ])
    // Same filename, two files, both parsed.
    for (const run of result.toolRuns) {
      await expect(stat(join(run.artefactDir, 'findings.sarif'))).resolves.toBeTruthy()
    }
    expect(result.outcome).toBe('failed')
```

- [ ] **Step 6: Run the stage suite**

Run: `pnpm vitest run tests/core/adapter-stage.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/stages/adapter-stage.ts tests/core/adapter-stage-policy.test.ts \
        tests/core/adapter-stage.test.ts
git commit -m "fix(stages): resolve stage policy from the whole selection

plan() kept the last adapter's policy, so a pick-one tool listed before a
fan-out one resolved to fan-out and the one-tool guard never fired — which
is exactly what R4.8 forbids for optimise. Adds a lookup seam so that stage
is assertable although it ships no adapter.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Three tools become selectable — wizard, doctor and the migration trigger

**Files:**
- Modify: `src/core/tools/doctor.ts`
- Modify: `src/cli/doctor-command.ts`
- Modify: `src/core/index.ts`
- Test: `tests/core/doctor.test.ts`, `tests/cli/doctor-command.test.ts`, `tests/cli/setup-command.test.ts`, `tests/core/setup.test.ts`, `tests/acceptance/m3.test.tsx`

**Interfaces:**
- Consumes: `migrateRuleMap(db)`, `appliedRuleMapVersion(db)`, `RULE_CLASS_MAP_VERSION`, `stageToolsFor(selected, isRunnable)`.
- Produces:
  - `DoctorInput` gains `ruleMap: { applied: number; current: number }`
  - `ToolDriftKind` gains `'rule-map-pending'`
  - `src/core/index.ts` re-exports `migrateRuleMap`, `appliedRuleMapVersion`, `RULE_CLASS_MAP_VERSION`
  - `skillgantry doctor --migrate-rule-map` applies the migration and prints what it did

`stageToolsFor` filters a selection through the adapter registry, so until now a preset produced `{ security: ['skillspector'] }` and nothing else. With three adapters registered it produces real per-stage sets, and three shipped tests assert the old emptiness. They invert here, in one task, so a reviewer sees the whole consequence at once.

`tools/**` must not open the ledger, so doctor takes the two version numbers as data from `src/cli/` — the same rule that already keeps its lifecycle check out of sqlite.

- [ ] **Step 1: Write the failing doctor test**

Add to `tests/core/doctor.test.ts`:

```ts
  it('reports a ledger whose rule map trails the shipped one, without failing', () => {
    const report = doctor({
      ...baseInput(),
      ruleMap: { applied: 1, current: 4 },
    })
    const finding = report.tools.find((t) => t.kind === 'rule-map-pending')
    expect(finding).toBeDefined()
    // Like integrity-unverified and lifecycle-drift: a standing condition to
    // surface, not a reason a tool cannot run.
    expect(report.ok).toBe(true)
  })

  it('reports nothing when the ledger is current', () => {
    const report = doctor({ ...baseInput(), ruleMap: { applied: 4, current: 4 } })
    expect(report.tools.some((t) => t.kind === 'rule-map-pending')).toBe(false)
  })
```

Use whatever helper `doctor.test.ts` already has in place of `baseInput()`; the point is that `ruleMap` is a new required field on `DoctorInput`, so every existing case in that file needs it too.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/core/doctor.test.ts`
Expected: FAIL — `ruleMap` is not a property of `DoctorInput`, and `tsc` rejects the object literal.

- [ ] **Step 3: Add the condition to the doctor engine**

In `src/core/tools/doctor.ts`, add `'rule-map-pending'` to `ToolDriftKind`, add the input field:

```ts
export interface DoctorInput {
  // …existing fields…
  /**
   * Supplied by src/cli: `tools` must not open the ledger, which is the same
   * rule that keeps queue out of it. `applied` is the ledger's recorded rule-map
   * version, `current` is RULE_CLASS_MAP_VERSION from the shipped build.
   */
  ruleMap: { applied: number; current: number }
}
```

and emit the finding beside the existing non-failing ones:

```ts
  if (input.ruleMap.applied < input.ruleMap.current) {
    findings.push({
      toolId: '(ledger)',
      kind: 'rule-map-pending',
      detail:
        `rule-class map v${input.ruleMap.applied} applied, v${input.ruleMap.current} shipped — ` +
        `run \`skillgantry doctor --migrate-rule-map\``,
    })
  }
```

Make sure `rule-map-pending` joins `integrity-unverified` and `lifecycle-drift` in whatever set decides `report.ok`, rather than the four kinds that fail it.

- [ ] **Step 4: Wire the flag into the CLI**

In `src/cli/doctor-command.ts`, read the applied version when building `DoctorInput`:

```ts
import { RULE_CLASS_MAP_VERSION } from '../core/index.js'
import { appliedRuleMapVersion, migrateRuleMap } from '../core/index.js'
```

```ts
    ruleMap: { applied: appliedRuleMapVersion(ledger.db), current: RULE_CLASS_MAP_VERSION },
```

and register the option on the `doctor` subcommand in `run-command.ts`:

```ts
    .option('--migrate-rule-map', 'apply a pending rule-class map migration')
```

In the action, when the flag is set, run the migration **before** building the report, so the same invocation shows the result:

```ts
  if (options.migrateRuleMap) {
    const result = migrateRuleMap(ledger.db)
    deps.write(
      `rule-class map v${result.applied}: ` +
        `${result.reclassified} issue(s) reclassified, ${result.merged} merged\n`,
    )
  }
```

R8.14 requires the migration to be explicit. This flag is that explicitness: nothing on the `openLedger` path calls it, so a run, a TUI launch and a plain `doctor` all leave the ledger alone.

- [ ] **Step 5: Write the CLI test**

Add to `tests/cli/doctor-command.test.ts`:

```ts
  it('applies a pending rule-map migration only when asked', async () => {
    const h = await home()
    const dbPath = join(h, 'gantry.db')
    const out: string[] = []
    const deps: CliDeps = { home: h, dbPath, write: (s) => out.push(s), startTui: async () => {}, startSetup: async () => {} }

    await buildProgram(deps).parseAsync(['node', 'skillgantry', 'doctor'])
    expect(out.join('')).toMatch(/rule-class map v1 applied/)
    expect(appliedRuleMapVersion(openLedger(dbPath).db)).toBe(1)

    out.length = 0
    await buildProgram(deps).parseAsync(['node', 'skillgantry', 'doctor', '--migrate-rule-map'])
    expect(out.join('')).toMatch(/reclassified/)
    expect(appliedRuleMapVersion(openLedger(dbPath).db)).toBe(RULE_CLASS_MAP_VERSION)
  })
```

- [ ] **Step 6: Invert the three tests that asserted an empty selection**

`tests/cli/setup-command.test.ts` — skill-lint now has a parser, so the case that proved the registry filter needs a tool that still lacks one. `skills` is that tool permanently: it is catalogued with `stage: null` and R3.5b forbids it an adapter. Replace the case with:

```ts
  it('writes a selection holding only runnable tools, and registers the repo', async () => {
    const h = await home()
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    const driver = buildSetupDriver(h)

    await driver.saveSelection(['skillspector', 'skill-lint', RELEASE_TOOL_ID])
    await driver.registerRepo(root)

    const config = await loadConfig(h)
    expect(config.stageTools.security).toEqual(['skillspector'])
    expect(config.stageTools.validate).toEqual(['skill-lint'])
    // The release installer has stage null and no adapter by design (R3.5b), so
    // it never reaches stageTools however it is selected.
    expect(Object.values(config.stageTools).flat()).not.toContain(RELEASE_TOOL_ID)
    expect(config.repos.map((r) => r.name)).toEqual([root.split('/').at(-1)])
  })
```

`tests/acceptance/m3.test.tsx:91` asserts `config.stageTools.security` equals `['skillspector']`. With skill-scanner registered, a preset that installs both puts both in the list. Update it to assert membership rather than equality, and to assert the release installer's absence:

```ts
    expect(config.stageTools.security).toContain('skillspector')
    expect(Object.values(config.stageTools).flat()).not.toContain(RELEASE_TOOL_ID)
```

`tests/core/setup.test.ts` — check for a `stageToolsFor` case that depends on skill-lint or skill-up being unrunnable, and re-point it at `RELEASE_TOOL_ID` for the same reason.

- [ ] **Step 7: Export the new surface**

Add to `src/core/index.ts`:

```ts
export { RULE_CLASS_MAP_VERSION } from './adapters/rule-classes.js'
export {
  appliedRuleMapVersion,
  migrateRuleMap,
  type RuleMapMigrationResult,
} from './ledger/rule-map-migration.js'
```

`src/cli/` reaches core directly, but the export keeps the surface in one place and lets a future Tools screen show the pending state without a deep import.

- [ ] **Step 8: Run every affected suite**

Run: `pnpm vitest run tests/core/doctor.test.ts tests/cli/ tests/core/setup.test.ts`
Expected: PASS.

Run: `SG_ACCEPTANCE=1 pnpm vitest run tests/acceptance/m3.test.tsx`
Expected: PASS — M3's two exit criteria still hold with four adapters registered.

- [ ] **Step 9: Commit**

```bash
git add src/core/tools/doctor.ts src/cli/doctor-command.ts src/cli/run-command.ts \
        src/core/index.ts tests/core/doctor.test.ts tests/cli/doctor-command.test.ts \
        tests/cli/setup-command.test.ts tests/core/setup.test.ts tests/acceptance/m3.test.tsx
git commit -m "feat(cli): report a pending rule-map migration and apply it on request

doctor gains rule-map-pending beside integrity-unverified and
lifecycle-drift, and --migrate-rule-map is the explicit trigger R8.14
requires: nothing on the openLedger path runs the migration. Three tests
that asserted an empty tool selection now assert real per-stage sets,
because skill-lint, skill-up and skill-scanner have parsers.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: M4 acceptance suite

**Files:**
- Create: `tests/acceptance/m4.test.ts`
- Modify: `tests/core/install.test.ts` (integration matrix)

**Interfaces:**
- Consumes: everything M4 built. Adds no export.

One named test per clause of the M4 exit criterion Task 1 reworded. Each drives the real path — real fixture bytes through real parsers into a real ledger — rather than asserting a unit again.

- [ ] **Step 1: Write the suite**

Create `tests/acceptance/m4.test.ts`, guarded by `SG_ACCEPTANCE=1` like its siblings, with these five cases:

```ts
describe('M4 exit criteria', () => {
  it('two tools reporting one class in one file produce one issue with two detections', async () => {
    // Real skillspector SARIF and real skill-lint JSON over architecture-diagram,
    // through runPipeline with fake-tool shims that emit the fixture bytes, into
    // a real sidecar and a real ledger. Asserts: 4 issues for the skill, the
    // merged one carrying 3 detections and 2 issue_detectors rows, whichever
    // stage each tool ran in.
  })

  it('two tools writing findings.sarif in one fan-out stage each keep their own file', async () => {
    // skillspector and skill-scanner shims in one security stage, both writing
    // findings.sarif. Asserts two artefact directories, two files on disk, both
    // parsed, and both named in stage.json.
  })

  it('the merged issue closes only once both detectors have run clean, in either finish order', async () => {
    // Runs the clear-one-then-the-other sequence twice with the order inverted;
    // the issue is open after the first clear and fixed after the second, both
    // times. Closure is a conjunction over a set — §10.4.
  })

  it('extending the rule-class map merges colliding issues without losing a detection', async () => {
    // Records a run under a stubbed one-entry map so a class lands as
    // unmapped:, then applies migrateRuleMap and asserts the total detection
    // count is unchanged, the surviving issue carries both detectors, and a
    // wontfix state survived the merge.
  })

  it('every registered adapter parses its own fixture with no filesystem access', async () => {
    // Iterates listAdapters(), loads each declared artefact from tests/fixtures,
    // and parses with fs, child_process and net stubbed to throw — R4.3, now
    // over four parsers rather than one.
  })
})
```

Write each body out in full following the patterns in `tests/acceptance/m1.test.ts` — a stubbed body is a plan failure, and these are the tests the milestone is judged by.

- [ ] **Step 2: Run it**

Run: `SG_ACCEPTANCE=1 pnpm vitest run tests/acceptance/m4.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 3: Extend the real-install matrix**

`tests/core/install.test.ts` already loops `CATALOGUE` under `SG_INTEGRATION=1`. Add a case asserting that every catalogued tool a stage selects now has an adapter, and that the release installer does not:

```ts
  it('gives every stage-selectable catalogued tool an adapter — R3.5b', () => {
    for (const spec of CATALOGUE) {
      const adapter = getAdapter(spec.id)
      if (spec.stage === null) {
        expect(adapter).toBeUndefined()
      } else {
        expect(adapter, `${spec.id} has no adapter`).toBeDefined()
      }
    }
  })
```

This belongs in the offline part of the file, not the network part — it reads only the catalogue and the registry.

- [ ] **Step 4: Run the full gate**

Run: `pnpm check`
Expected: lint, build, test and acceptance all pass.

Run: `SG_INTEGRATION=1 pnpm test:integration`
Expected: PASS — five tools installed, verified and locked against real indexes, then every acceptance suite. If network or a key is unavailable, say which step did not run rather than reporting it green.

- [ ] **Step 5: Commit**

```bash
git add tests/acceptance/m4.test.ts tests/core/install.test.ts
git commit -m "test: demonstrate every M4 exit criterion

One named test per clause: the cross-tool merge with two detectors, the
fan-out filename collision, order-independent closure, a rule-map migration
that loses no detection, and R4.3 purity over all four parsers.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Requirement coverage for M4

Every requirement M4 owns, and the task that satisfies it. A requirement with no task is a plan defect.

| Requirement | Task |
|---|---|
| R3.5b manifest and `parse` per selectable catalogued tool, each fixture-tested | 1 (amendment), 3 (skill-lint), 4 (skill-up), 5 (skill-scanner), 9 (registry-vs-catalogue check) |
| R4.6 validate and security run every selected tool and merge their findings | 6 (merge over real fixtures), 7 (fan-out policy, per-tool artefact dirs), 9 |
| R4.7 evaluate runs exactly one tool per stage execution | 4 (skill-up is `pick-one`), 7 (`plan()` rejects a second) |
| R4.8 optimise runs one tool, never two concurrently | 7 (policy resolved over the selection, plus the lookup seam that makes the stage assertable with no adapter shipped) |

**Owned elsewhere but shaped here.**

- **R4.4** (M1) required two shared parsers and M1 shipped one. Task 4 ships the second, `eval-report.ts`, and design §7.2 documents it.
- **R8.14** (M1) says extending the rule-class map is an explicit versioned migration. M1's coverage table deferred the runner to M4 with the reason "data-only until a second scanner exists to merge against". Task 2 ships it, and Task 8 gives it its explicit trigger.
- **R8.6, R8.8, R8.13, R13.4** (M1) are the merge and closure contracts. M1 proved them against synthetic findings because only one adapter existed; Task 6 proves them against real output from two tools, which is what design §16's "paired real SARIF fixtures from both scanners" asks for.
- **R8.3, R8.5** (M1) — three more parsers normalise to rule class, severity, repo-relative path and message, retaining the native id; unmapped ids still degrade to a tool-scoped class.
- **R4.2a, R4.2b** (M1) — skill-scanner is the first adapter to use `one-of` credentials in anger, and the first whose declared mode has no offline alternative.
- **R4.3** (M1) — Task 9's last case runs all four parsers with fs, subprocess and network stubbed to throw.
- **R1.5** (M1) — Task 4's parser drops three token fields the report carries.
- **R6.5** (M1) — Task 4's `--output-dir` is what keeps skill-up's own `iteration-N` out of the sidecar M1 promised not to write.
- **R4.9** (M1) — Task 7 Step 5 replays the collision case with two real scanners rather than two fixture tools.
- **R3.9, R12.5a** (M3) — doctor gains a sixth reported condition; the failing four are untouched.

**Deferred within M4, with reasons.**

- **agentskills, SkillOpt and SkillHone get no adapter**, because M3's probe found no installable implementation. Recorded in [plan-m3.md](plan-m3.md); R3.5b as amended is a rule over the catalogue, so this is coverage rather than a gap.
- **promptfoo gets no adapter**, per [plan-promptfoo-removal.md](plan-promptfoo-removal.md) and decision-log §10.
- **VirusTotal-mode skill-scanner** is a separate adapter id under R4.2b and is not shipped. The two modes cover different rule classes, so a fallback would make statistics incomparable.
- **`skillopt` and the optimise stage** stay empty. R4.8 is satisfied structurally — no adapter can be selected — and by the policy resolution and lookup seam Task 7 adds so the rule is asserted rather than merely unreachable.

## Known gaps carried forward

- **skill-up cannot be `skipped` for want of credentials.** Its engine is declared in the skill's own `eval.yaml` and authenticated by that CLI, and `CredentialRequirement` can only test env keys. A missing engine therefore lands as `errored`/`missing-artefact` rather than `skipped`/`no-credentials`. Fixing it means an `ErrorKind` for "declared input absent" and a way to express an external CLI's login, both of which reshape an M1 contract for one tool.
- **A skill with no `evals/` errors rather than skipping.** Most of the 74 reference skills have none, so an evaluate stage over a full repo is mostly `errored`. Same root cause as above.
- **skill-scanner's fixture cannot be refreshed without a key**, and its findings are nondeterministic, so a re-capture will not reproduce byte-for-byte. The capture script skips it with a message rather than failing, so every other fixture stays refreshable.
- **`evals/cases/<case_id>.yaml` is a convention, not a guarantee.** A repo storing its cases elsewhere gets an eval-failure issue pathed at a file that does not exist. The fingerprint stays stable and per-case, so this is a display defect; the alternative collapses a failing suite into one issue, which is worse.
- **The rule-class map is one maintainer's reading of fifteen rule names.** `RA2` Session Persistence as `excessive-permission` and `R05` Runtime external fetch as `vulnerable-dep` are the two judgement calls most likely to be revisited. Both are versioned, so revisiting one is a migration rather than a rewrite.
- **Validate and security both fan out, and the chain halts on the first non-passing stage.** A skill whose validate stage fails never reaches security in a chained run, so the merge accumulates across runs rather than within one. The fingerprint carries no stage component precisely so that works, and R5.3's single-stage runs make it directly observable.
- **R13.7's mechanical coverage check still does not exist.** M3 recorded it; Task 1 edits the ownership table by hand again. It belongs to whichever milestone next touches traceability.

## Self-review

**Spec coverage.** Every requirement in the M4 row of the ownership table maps to a task. R3.5b needed an amendment before implementation, and the amendment plus its evidence is Task 1. Four requirements M1 owns are completed rather than restated here — R4.4's second parser, R8.14's migration runner, and the two contracts M1 could only prove synthetically — each with the reason it waited.

**Placeholders.** Three deliberate gaps remain, all in Task 5 and Task 9, all marked and all with the reason and the command that fills them: skill-scanner's `detects` list, its finding count and its rule mappings come from a keyed capture that cannot run without credentials, and Task 9's bodies are described clause by clause with the assertion each must make. No step says "similar to", "handle the rest" or "add error handling".

**Type consistency.** `Parse` is `(ctx: ParseContext) => ToolResult` in all four adapters. `parseSarif(bytes, { toolId, skillRelPath })` and `parseEvalReport(bytes, { toolId, skillRelPath })` take the same option shape deliberately. `rebasePath(skillRelPath, uri)` keeps its signature through the move to `paths.ts` and is re-exported from `sarif.ts` so no existing import breaks. `fingerprint(skillId, relPath, ruleClass)` is unchanged. `migrateRuleMap(db)` returns `{ applied, reclassified, merged }` in Tasks 2, 8 and 9. `AdapterStageOptions.lookup` has the same signature as `getAdapter`, which is what lets Task 7 default one to the other.

**Scope.** Nine tasks, one milestone, one deliverable: every tool SkillGantry can install now has a parser, and two of them describing one problem produce one issue that closes only when both agree.

## Deviations found while implementing

*(Filled in during implementation. Each entry names where the plan did not survive contact with the shipped code or the installed tool.)*

**1. Task 2's migration test asserted a note the plan's own code never writes.** The step-5 test expected `/rule-map v2/`; `migrateRuleMap` writes `rule-map v1 -> v2`, naming both ends of the move. The note format is the better record, so the test now matches `rule-map v1 -> v${RULE_CLASS_MAP_VERSION}` and stays correct across the later bumps to 3 and 4.

**2. `DoctorReport` has `failed`, not `ok`.** Task 8's step-1 test was written against a field that does not exist, and `ToolFinding` requires `expectedVersion` and `actualVersion`, which the plan's `findings.push` omitted. The new finding carries the two versions in those fields. `ruleMap` being required also reached further than "every existing case in that file": `tests/acceptance/m3.test.tsx` calls `doctor()` twice and both needed it.

**3. Task 9's first criterion cannot run as one chained run.** R5.1 halts the chain on the first stage that does not pass, and skill-lint's findings fail validate, so security never executes and only one detector is ever recorded. The case now performs two single-stage runs, which is what the plan's own "known gap" about chain-halting predicts and what R5.3 exists to allow. Two consequences are asserted rather than hidden: `occurrence_count` on the merged issue is 2, not 3, because it answers "how many times was this seen last time we looked" and the last look was the security-only run; and skill-lint's own issue stays open through that run, because a tool that did not run reports no conclusive absence.

**4. An ESM namespace cannot be spied, so R4.3's purity case mocks instead.** Both `vi.spyOn(fs, 'readFileSync')` and direct reassignment fail with `Cannot redefine property`. The case now mocks `node:fs`, `node:child_process` and `node:net` at load time behind a flag that is only set around the parser calls, so the harness in the same file can still spawn and write. The test asserts the trap bites before trusting a pass, because a seal that silently does nothing is worse than no seal.

**5. Re-capturing `skillspector-declawed.sarif` produces a byte-different file with identical findings.** The only diff is the random `findingId` per result. The M1 fixture is kept, so the capture script stays runnable without churning a fixture whose content has not changed.

**6. Task 7's fan-out case uses the lookup seam.** `plan(ctx('security', ['skillspector', 'skill-scanner']))` against the real registry needs the skill-scanner adapter of Task 5. The assertion — that a selection of two fan-out tools resolves to `fan-out` — is made through the seam meanwhile, and the real-registry form arrives with Task 5.

## Changelog

- 2026-08-02 — revision 1, written after installing and running skill-lint 0.2.0, skill-scanner 0.3.3, skill-up 0.7.0 and skillspector 2.5.1 against the 20 skills of `zapac-agent-skills`.
