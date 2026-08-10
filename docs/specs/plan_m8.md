# M8 — Suppress a finding from the terminal, then re-run the gates

**Status:** shipped.
**Goal:** A maintainer who has judged a finding a false positive can accept it from the Issues screen or the Findings pane, see the exact bytes that will land in their repo before they land, and re-run the gates that the acceptance invalidated — without leaving the terminal and without hand-editing YAML.

**Architecture:** One new declarative field on the adapter manifest, one new core module owning a narrow repo-write path, one new confirmation pane, one key on two existing surfaces, and one headless subcommand. The queue, the pipeline, the ledger schema and the run lifecycle are untouched: the re-run goes through the same `queue.enqueue` call `r` already makes.

## Specification

Layer 1: [requirements.md](requirements.md) — six new ids, R4.16, R8.16, R10.12, R11.16, R11.17, R12.7, and a new M8 row in § Milestone ownership.
Layer 2: [design.md](design.md) §4.4, §7, new §12.5, §15, §16, §17, §18; [design_tui.md](design_tui.md) new §14.7.
Decisions: [decision-log.md](decision-log.md) new §12, D24–D27, retiring D21's deferral.

## The problem

M6 taught SkillGantry to *read* a tool's suppression file ([plan_m6-respect-skillspector-baseline.md](plan_m6-respect-skillspector-baseline.md)). Writing one is still manual: the maintainer leaves the terminal, opens `.skillspector-baseline.yaml`, works out the rule syntax, gets the path shape right, saves, comes back, and re-runs by hand. D21 named that gap and deferred it, listing three costs — the write touches the user's repo, every adapter would have to declare its baseline's path and entry shape, and R8.15 names that file an authority SkillGantry only reads.

There is a second half the deferral did not name. Accepting a finding moves the skill digest, because the baseline file is inside the candidate manifest (§4.4). R9.9 then refuses to release against gates recorded from the bytes before the write. That is deliberate: it stops a baseline being a retroactive gate override (design.md §12.4). So an acceptance always implies a re-run, and a user who does not know that hits a refusal they cannot explain.

## Decisions

**D24. The tool's own baseline file is the only suppression store.**
SkillGantry writes a rule into the file the tool already reads. It does not keep a suppression list of its own.
*Why:* R8.15 named that file the authority for the reason R1.6 named `SKILL.md` one — the file edit and the ledger transaction cannot be made atomic, so one of them has to be the truth. A second, SkillGantry-owned store would make two, and the tool would honour only one of them. It would also be invisible to CI and to the consumer who receives the archive.
*Cost, accepted:* only skillspector ships a baseline. `skill-scanner 0.3.3` has no ignore or baseline flag, `skill-lint` has none, and skill-up runs evals. Suppression is therefore refused for three of four tools, by name, rather than offered and silently ineffective.
*Rejected:* a SkillGantry-owned file in the skill directory (tool-agnostic, but a second authority, and R8.15 rewritten); both, with the tool's file preferred (widest coverage, two files to audit and two code paths); a ledger-only or sidecar suppression (no repo write at all, and no digest movement — so it would let a user suppress past a gate that has already passed, which design.md §12.4's binding exists to prevent).

**D25. The write is a narrow path, not §12's sandbox.**
Preimage captured, diff rendered before any byte moves, authorisation confirmed, preimage rechecked, one atomic rename.
*Why:* §12's machinery answers problems this write does not have. Its sandbox exists because a *tool* writes the live tree over minutes across many paths; here SkillGantry composes one file's bytes itself. Journals exist because POSIX has no multi-file atomic write, and one rename is atomic, so there is no partial state for a journal to compensate. The active-sandbox record covers a crash during tool execution or while awaiting approval, and nothing here is modified until the rename fires. The dirty-skill guard is the odd one out. It exists because a worktree starts at HEAD and would hide uncommitted work, and there is no worktree — the append merges into the user's current bytes by construction.
*What is kept, and why each:* the diff before the write, because that is the standing rule for every byte SkillGantry puts in a user's repo. The preimage recheck, because the window between preview and confirm is exactly R10.11's window and widens with however long the user reads. The atomic rename, because a half-written baseline is one the tool exits 2 on.
*Rejected:* the full sandbox and journalled apply (uniform recovery, at the cost of a `git worktree add` per acceptance and a journal for a write that cannot be partial); a crash marker on top of the narrow path (buys uniform recovery for the microseconds around an atomic rename); no gate at all (fastest, and leaves a wrong glob to be discovered only by the re-run).

**D26. Both surfaces, one action, one rule shape.**
`s` on the Issues screen and on the Work Findings pane, both resolving to the same `{id, path}` rule.
*Why:* the Findings pane is where a maintainer is when they judge a finding, and the Issues screen is where they are when they triage the backlog. Both questions are the same question.
*The grain is honest about itself:* a skillspector rule keyed on id and path suppresses every occurrence of that rule id in that file. That matches the issue fingerprint's grain — `(skillId, relPath, ruleClass)` — but it is coarser than one finding, so the Findings pane's confirmation says what the rule will cover rather than implying it accepted one row. Narrowing to a single occurrence would need a `message` glob, which breaks the next time the tool rewords its message.
*Rejected:* the Findings pane alone (D21's original placement, and the Issues screen is the audit surface); the Work screen's Issues tab as a third surface (R11.13 forbids that tab binding a state-changing key, precisely so its keymap stays learnable).

**D27. The re-run is offered at confirm time, as a toggle, and defaults to resuming the chain.**
`t` cycles `resume from the first non-passing gate` → `every gate` → `nothing`. `a` applies and enqueues per the toggle; `d` discards.
*Why:* the acceptance moves the digest, so which stages are now stale is a fact the pane knows and the user should not have to derive. A toggle rather than three apply keys, so `a` and `d` keep exactly the meaning the mutation review already trains.
*Why "resume the chain" and not "the stages that failed":* R5.1 halts on the first non-passed stage, so when validate fails, evaluate and security read `·`. Enqueueing validate alone would make the user press it again. Defined as the contiguous run from the earliest non-passing gate through security, the two options collapse to the same set when validate is the failure, which is correct rather than redundant.
*Two edge states, both defined rather than left to fall out:* a stage that never ran reads `·` and counts as non-passing, so a skill with no recorded run at all resumes from validate. A skill whose three gates all passed resolves to an empty set, and the toggle then starts on `every gate` — which is the right default there anyway, since every one of those passing runs was recorded against the pre-write digest.
*Rejected:* running every gates unconditionally (correct for release, and pays skill-up's ~2 minutes for a security-only acceptance); running only the stage that produced the finding (skips a failed stage the user did not accept anything in); no offer at all (leaves the R9.9 refusal to be discovered later).

## Contracts

### The manifest declares its baseline

One optional field on `AdapterManifest`, fully declarative. `BaselineSpec` carries the path (`{skillDir}` vocabulary), document format, target collection name, a scaffold for absent files, and an entry template in the finding vocabulary. See [design.md](design.md) §7 for the canonical interface and skillspector's declaration.

The path shape is the silent failure mode: skillspector's SARIF reports a skill-relative `uri`, while `RawFinding.path` is repo-relative. `{pathGlob}` carries the skill-relative form. Writing the repo-relative one produces a rule that is syntactically valid, loads without complaint, and suppresses nothing.

Two literals of one path: `conditionalArgv.whenExists` and `baseline.path` must agree. A registry test asserts this for every adapter.

### The write path

`src/core/suppress/`. See [design.md](design.md) §12.5 for the canonical sequence.

`baseline.path` resolves against the **live** skill directory, deliberately unlike §7's conditional-argv stat (tool-facing path). A repo-root skill's tool reads a materialised candidate copy, so a write resolved the tool's way would land in a temp directory and be discarded.

The temp file (`.skillgantry-write.tmp`) sits in the candidate root for atomic rename. It joins §4.4's exclusion table so a concurrent digest does not hash it.

Three rules stated: `version` is never touched (bumping v1→v2 can make a loadable file unloadable); an identical entry is a no-op (prevents duplicate rules on double-press); absent-became-present is drift (someone created the baseline while the diff sat on screen).

## Surfaces

`s` on the Issues screen and on the Work Findings pane. See [design_tui.md](design_tui.md) §14.7 for the canonical pane spec.

```
┌─ Suppress — skillspector · declawed/scripts/scan.py ───────────────┐
│ --- a/declawed/.skillspector-baseline.yaml                         │
│ +++ b/declawed/.skillspector-baseline.yaml                         │
│ @@ -3,2 +3,6 @@                                                    │
│  rules:                                                            │
│ +- id: MP2                                                         │
│ +  path: scripts/scan.py                                           │
│ +  reason: Alignment whitespace in a re.VERBOSE block, not padding │
│ reason ▏Alignment whitespace in a re.VERBOSE block, not padding▕   │
│ also reported by skill-scanner, no baseline — security still fails │
│ then run: validate, evaluate, security · t cycles                  │
│ recorded gates passed against the previous bytes                   │
└────────────────────────────────────────────────────────────────────┘
a apply · d discard · t then-run · j/k scroll · esc cancel
```

Refusals and warnings are named: a tool with no `baseline` is refused by name; an issue both scanners report warns that the gate will still fail. The reason reuses §14.2's editor shape. `SuppressPane` shares `DiffBody` with `ReviewPane`.

## Re-run

Both non-`nothing` toggle settings call `queue.enqueue`. `resume from the first non-passing gate` resolves to the contiguous chain from the earliest gate whose last recorded outcome is not `passed`, through security. A `·` stage counts as non-passing. When all three gates passed the set is empty and the toggle starts on `every gate`.

## Headless

```
skillgantry suppress <skill> --tool <id> --rule <nativeRuleId> --path <skillRelPath>
                             --reason <text> [--yes] [--json]
skillgantry suppress <skill> --fingerprint <fp> --reason <text> [--yes] [--json]
```

`--yes` is prior authorisation with the diff emitted immediately before the write. Without it the diff prints, nothing is written, and exit is non-zero. The exit code reports whether a suppression was written, never whether the skill passes. No `--then-run` — the shell composes `suppress && run`.

## Requirement amendments

| Id | Statement |
|---|---|
| R4.16 | A manifest MUST be able to declare its tool's suppression file: the path in the `{skillDir}` vocabulary, the document format, the target collection, the scaffold written when the file is absent, and the entry template in the finding vocabulary. The declaration MUST be data; an adapter MUST NOT perform the write. A substituted value reaching a field the tool glob-matches MUST be escaped. |
| R8.16 | Amends R8.15's authority clause. SkillGantry MAY write the skill's suppression file through R10.12. The file remains the authority and the ledger's suppression columns remain a derived cache recomputed on conclusive tool runs. |
| R10.12 | A repo write that is a single file composed by SkillGantry MUST capture a preimage, emit a diff before any byte moves, obtain authorisation, recheck the preimage and abort naming the path on any mismatch, and land through one atomic rename. It MUST NOT write when an identical entry is already present. It MUST NOT claim, and does not need, the sandbox, journal or crash marker R10.1–R10.11 require of a tool-driven mutation. |
| R11.16 | A user MUST be able to accept a finding from the Issues screen and from the Findings pane. A detecting tool that declares no baseline MUST be named in the refusal. Another detector still reporting the issue that cannot be suppressed MUST be named before the write. A reason MUST be required and MUST NOT be empty. The action MUST NOT change any panel's row allocation. |
| R11.17 | The confirmation MUST offer to enqueue the gate chain resumed from the first non-passing stage, every gate, or nothing, and MUST state that recorded gate runs were passed against the bytes from before the write. |
| R12.7 | `skillgantry suppress` MUST be available headlessly. `--yes` is prior authorisation and the diff MUST be emitted immediately before the write. The exit code MUST report whether a suppression was written, not whether the skill passes. |

## Spec edits

| Document | Edit |
|---|---|
| requirements.md | Six ids above; R8.15's authority sentence amended; new M8 row |
| design.md §4.4 | `.skillgantry-write.tmp` exclusion |
| design.md §7 | `BaselineSpec` on `AdapterManifest` |
| design.md §12.5 | The narrow write path |
| design.md §15 | `skillgantry suppress` |
| design.md §16, §17, §18 | Test rows, traceability, history |
| design_tui.md §14.7 | The two surfaces, reason, `SuppressPane`, toggle, precedence |
| decision-log.md §12 | D24–D27; D21 retired |
| CLAUDE.md | Three writers named |

## Testing

| Target | Guard |
|---|---|
| Entry substitution | Every token resolves; `{pathGlob}` is skill-relative; fnmatch metacharacters escaped; repo-root path unchanged |
| Document append | Comments survive; non-mapping refused; non-sequence refused; `version` unchanged; absent takes scaffold; identical entry is no-op |
| Write path | Preimage drift aborts; absent-became-present aborts; diff matches rename; `.skillgantry-write.tmp` excluded from digest |
| Registry | Every `baseline` has a `conditionalArgv.whenExists` that agrees |
| Surfaces | Refusal names tool; second-detector warning conditional; row count stable at 80×24 and 50×14; empty reason refused |
| Re-run | Chain contiguous from first non-passing gate; `·` counts as non-passing; all passed → empty; toggle starts on `every gate` |
| Headless | Without `--yes` the file is unchanged; exit code tracks write not outcome |
| Acceptance | Fake tool: gate fails → suppress → re-run passes → ledger agrees → delete entry → finding returns |
| Integration (`SG_INTEGRATION=1`) | Real skillspector: scan → write rule from SARIF → re-scan → `suppressions` present |

## Risks and one-way doors

**Suppression is one-way in the terminal.** Removing a rule is out of scope. Undoing means editing the YAML or reverting in git. The mitigation is that the diff gate makes a wrong rule visible before it lands.

**Coverage is one tool of four.** Everything skill-scanner and skill-lint raise can only be marked `wontfix`. That is a property of the ecosystem rather than of this design, and D24 chose to state it.

**skillspector's glob semantics are its own.** `*` crosses path separators and matching is case-insensitive. A rule written for `scripts/scan.py` is exact, so neither bites today, but a future manifest emitting patterns inherits both.

## Task Order and Why

Task 1 (specs) first because R13.7's traceability test fails the build until requirements are owned. Task 5 (exclusion) before Task 6 (write path) because the temp file would be hashed by a concurrent digest. Task 7 (target resolution) before Tasks 8 and 10 because both consume it. Task 9 (pane) before Task 10 (gate resolver) and Task 11 (wiring) by data dependency. Tasks 12–13 last: acceptance proves the flow, integration proves the glob matches what skillspector's fnmatch honours.

## Critical Files — Summary

| Path | Role |
|---|---|
| `src/core/adapters/types.ts` | `BaselineSpec`, `AdapterManifest.baseline` |
| `src/core/adapters/skillspector.ts` | `BASELINE_PATH`, the `baseline` declaration |
| `src/core/suppress/entry.ts` | `globEscape`, `skillRelative`, `suppressionEntry` |
| `src/core/suppress/document.ts` | `appendEntries` — YAML/JSON, comment-preserving |
| `src/core/suppress/write.ts` | `planSuppression`, `applySuppression`, `discardSuppression` |
| `src/core/suppress/target.ts` | `SuppressionRequest` → plans + uncovered detectors |
| `src/core/discovery/candidate.ts` | `WRITE_TEMP_NAME` exclusion |
| `src/core/ledger/issue-queries.ts` | `issueDetectionRules` |
| `src/cli/suppress-command.ts` | `skillgantry suppress` |
| `src/cli/gantry-views.ts` | Port implementations for the TUI |
| `src/tui/views.ts` | `GantryViews` methods |
| `src/tui/components/DiffBody.tsx` | Shared diff renderer |
| `src/tui/components/SuppressPane.tsx` | Confirmation, reason editor, re-run toggle |
| `src/tui/store.ts` | `SuppressSlot`, actions, toggle state |
| `src/tui/rows.ts` | `resumedGates()` |
| `src/tui/app.tsx` | `s` binding, pane precedence, preview effect |

## Implementation Tasks

### Task 1: Spec amendments

Amended `requirements.md` (six ids, M8 row), `design.md` (§4.4, §7, §12.5, §15, §16, §17, §18), `design_tui.md` (§14.7), `decision-log.md` (§12, D24–D27, D21 retired), and `CLAUDE.md` (three writers named). Traceability test stayed green.

### Task 2: `BaselineSpec` on the manifest

Added `BaselineSpec` interface to `src/core/adapters/types.ts` and declared skillspector's baseline with a shared `BASELINE_PATH` constant. Registry test asserts `conditionalArgv.whenExists` agrees with `baseline.path` for every adapter.

### Task 3: Entry substitution and glob escaping

Built `src/core/suppress/entry.ts`: `globEscape` escapes fnmatch metacharacters (`*`, `?`, `[`) as single-member character classes; `skillRelative` strips the skill prefix from a repo-relative path; `suppressionEntry` resolves template tokens against a `FindingVars` vocabulary and throws on unknown tokens.

### Task 4: Appending to the baseline document

Built `src/core/suppress/document.ts`: `appendEntries` operates through yaml's Document API to preserve comments and key order, never touches `version`, deduplicates entries, and refuses non-mapping documents or non-sequence collections. JSON path through `JSON.parse`/`stringify`.

### Task 5: Exclude the write temp file from the candidate manifest

Added `WRITE_TEMP_NAME` (`.skillgantry-write.tmp`) to `src/core/discovery/candidate.ts`'s `excludedPaths` set unconditionally.

### Task 6: The write path

Built `src/core/suppress/write.ts`: `planSuppression` stages bytes via fsync'd handle and computes the diff; `applySuppression` rechecks the preimage hash and renames atomically with a directory fsync; `discardSuppression` removes the temp file.

### Task 7: Resolving a request to the tools that can answer it

Built `src/core/suppress/target.ts`: `previewSuppression` groups detection rules by tool, plans writes for tools with baselines, and reports uncovered detectors still reporting the issue. Added `issueDetectionRules` to the ledger.

### Task 8: `skillgantry suppress`

Built `src/cli/suppress-command.ts`: resolves via `--tool`/`--rule`/`--path` or `--fingerprint`, emits diff before write, respects `--yes` for prior authorisation, exit code tracks the write not the skill's outcome, `--json` emits a structured document.

### Task 9: `DiffBody` and `SuppressPane`

Extracted `DiffBody` from `ReviewPane` (shared diff renderer with token-based gutter colours). Built `SuppressPane` as a sibling confirmation pane: diff body, reason editor row, uncovered-detector warning (conditional), re-run toggle display, and stale-gates notice (conditional on resolved set missing a gate).

### Task 10: Resolving which gates the write invalidated

Added `resumedGates` to `src/tui/rows.ts`: the contiguous chain from the earliest non-passing gate through security. Empty when all three passed (toggle starts on `every gate`). Takes the rail's `Record<Stage, StageCell>`.

### Task 11: `s` on both surfaces, and the enqueue

Added `SuppressSlot` and eight actions to the store. Bound `s` on the Issues screen (resolves fingerprint to detection rules) and the Findings pane (carries `nativeRuleId` and `path` directly). Preview fires when the reason editor commits. `a` applies, enqueues per toggle, flashes confirmation. Added three `GantryViews` port methods implemented in `gantry-views.ts`.

### Task 12: The acceptance test — the flow, on a fake tool

`tests/acceptance/m8.test.ts`: fake tool branching on `--baseline`, proving fail → suppress → re-run passes → ledger suppressed → delete entry → finding returns.

### Task 13: The integration test — the glob, on the real tool

`tests/core/suppress-integration.test.ts`: real skillspector, real scan, real write, real re-scan asserting the finding carries `suppressions`. Added to the `SG_INTEGRATION=1` tier.

---

## Deviations found while implementing

Shipped as designed. Eight corrections the code forced, none of them to a decision.

**Task 1: M5 owned the `R10` group token, so R10.12 was owned twice.** The plan said "no existing range widens", which is true of ranges and false of the group form: `R10` expands to every `R10.*`, so adding R10.12 gave it two owners and R13.7 failed the build. M5's cell is now `R10.1–R10.11`. The same trap is live for `R9` and for `R2`, which are also group tokens.

**Task 3: `]` must not be glob-escaped.** The sketch's regex was `/[*?[\]]/g`, which turns `notes[1].md` into `notes[[]1[]].md` — a pattern for a filename with a `]` in it, matching nothing. `]` only terminates a class that is open, and every `[` is escaped, so no class is ever open when one is reached. The plan's own test asserted the correct answer; the implementation sketch beside it did not.

**Task 5: the digest fixture is `makeRepo`, not a `fixtureSkill()` helper.** `tests/core/digest.test.ts` builds skills through `discoverSkills` over a `makeRepo` root and has no such helper. Followed the file.

**Task 8: the CLI fixture must canonicalise its repo path.** §4.1 canonicalises on registration, so on macOS the registered path is `/private/var/...` while the raw `mkdtemp` path is `/var/...`, and a fixture built from the latter disagrees with the skill the command resolves. `realpath` in the harness.

**Task 9: `DiffBody` returns rows and a hidden count, and the pane title names the finding.** The sketch's `DiffBody` returned rows alone, but `ReviewPane` renders `N hidden` in its own footer, so the extraction had to hand back what it dropped or that footnote would have been lost. And the title carries the finding's path, per §14.7's frame — the baseline's filename is already in the diff's `---`/`+++` headers, which the plan's test fixture omitted.

**Task 10: `resumedGates` takes the rail's record, not an array.** `SkillRow.stages` is `Record<Stage, StageCell>`. Indexing by stage name rather than by position is also the safer shape: the positional version silently depended on `GATE_STAGES` and `STAGE_ORDER` agreeing on their first three entries.

**Task 11: the reason buffer needs a ref mirror.** `app.tsx` already mirrors the palette query and the value editor outside React, because React batches the dispatches from several keypresses delivered in one tick and reading state loses every character but the last. A reason editor reading `slot.reason` had exactly that bug. `reasonRef` follows the reducer, which stays the authority for whether the editor is open.

Task 11 also resolved the plan's own internal disagreement: Step 3's `begin-suppress` carried `{toolId, relPath, reason}` while Step 5's dispatch also passed a `request`. Step 5 is right — §14.7 requires the request to survive the editing step — so the action carries the `SuppressionRequest` alongside the two display fields.

**Task 13: `pnpm test:integration` names its files explicitly.** Adding the file to `vitest.config.ts`'s `INTEGRATION` list only stops the default run from picking it up; the script had to name it too, or the one test that reaches a real binary would never have run in the tier built for it.

**Two tests added beyond the plan.** `tests/tui/suppress-surfaces.test.tsx` drives `s` through the whole app from both surfaces — nothing else proved the key reaches the pane, that the preview waits for the reason, or that an empty reason is refused at the keyboard rather than only in the reducer. And the integration test was checked by inverting `skillRelative` to write the repo-relative path: it fails on exactly the assertion it exists for, which is the difference between a passing test and a test that would catch the bug.

## Changelog

- 2026-08-10 — **Compacted post-implementation.** Removed step-by-step tasks, file-by-file diffs, code snippets, and verification commands now that the feature has shipped. Preserved Goal, Decisions (D24–D27), Contracts (thinned to summaries with design-doc links), Surfaces (ASCII layout kept), Requirement amendments, Critical Files summary, and Deviations. Original plan recoverable via git history.
