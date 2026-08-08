# M8 — Suppress a finding from the terminal, then re-run the gates

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** designed, not started.
**Goal:** A maintainer who has judged a finding a false positive can accept it from the Issues screen or the Findings pane, see the exact bytes that will land in their repo before they land, and re-run the gates that the acceptance invalidated — without leaving the terminal and without hand-editing YAML.

**Architecture:** One new declarative field on the adapter manifest, one new core module owning a narrow repo-write path, one new confirmation pane, one key on two existing surfaces, and one headless subcommand. The queue, the pipeline, the ledger schema and the run lifecycle are untouched: the re-run goes through the same `queue.enqueue` call `r` already makes.

## Specification

Layer 1: [requirements.md](requirements.md) — six new ids, R4.16, R8.16, R10.12, R11.16, R11.17, R12.7, and a new M8 row in § Milestone ownership.
Layer 2: [design.md](design.md) §4.4, §7, new §12.5, §15, §16, §17, §18; [design-tui.md](design-tui.md) new §14.7.
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
*Rejected:* running every gate unconditionally (correct for release, and pays skill-up's ~2 minutes for a security-only acceptance); running only the stage that produced the finding (skips a failed stage the user did not accept anything in); no offer at all (leaves the R9.9 refusal to be discovered later).

## Contracts

### The manifest declares its baseline

One optional field, fully declarative. R4.1 says an adapter is a manifest and a single `parse`; a second exported function would make it three, so the tool-specific knowledge goes in data and `src/core/` owns a generic "append a mapping to a named sequence in a YAML or JSON document" writer.

```ts
interface BaselineSpec {
  /** `{skillDir}` vocabulary, substituted as `invoke.argv` is — but see below. */
  path: string
  document: 'yaml' | 'json'
  /** The sequence one accepted finding is appended to. */
  collection: string
  /** The document written when the file is absent. */
  scaffold: Record<string, unknown>
  /** One entry, in the finding vocabulary. Kept separate from the path
      vocabulary so a token from one cannot leak into the other. */
  entry: Record<string, string>
}
```

skillspector's, pinned to 2.5.1:

```ts
baseline: {
  path: '{skillDir}/.skillspector-baseline.yaml',
  document: 'yaml',
  collection: 'rules',
  scaffold: { version: 2, rules: [], fingerprints: [] },
  entry: { id: '{ruleIdGlob}', path: '{pathGlob}', reason: '{reason}' },
}
```

`{ruleIdGlob}` and `{pathGlob}` are glob-escaped by definition of the token. skillspector matches rules with `fnmatch`, so `*`, `?` and `[` in the substituted value are metacharacters: a file named `notes[1].md` needs `notes[[]1].md` or the rule matches nothing at all. Escaping as a property of the token keeps the writer tool-agnostic.

**The path shape is the silent failure mode.** skillspector's SARIF reports a skill-relative `uri: scripts/scan.py`, while `RawFinding.path` is repo-relative, rebased onto `skillRelPath` by §7.1. The glob matches against the tool's own path, so `{pathGlob}` carries the skill-relative form. Writing the repo-relative one produces a rule that is syntactically valid, loads without complaint, and suppresses nothing. For a repo-root skill `skillRelPath` is `.`, so the two coincide and the rule is unchanged.

**Two literals of one path.** `conditionalArgv.whenExists` already carries `{skillDir}/.skillspector-baseline.yaml`. A registry test asserts that every manifest declaring a `baseline` has a conditional group whose `whenExists` equals `baseline.path` — otherwise the day one of them moves is the day SkillGantry writes a file it no longer passes to the tool.

### The write path

`src/core/suppress/`. Core may spawn and touch the filesystem; the prohibition is on `src/tui/**` and on `src/core/adapters/**`.

`baseline.path` substitutes `{skillDir}` to the **live** skill directory. That is deliberately the opposite of §7's conditional-argv rule, which resolves against the tool-facing path — same token, opposite answer. For a repo-root skill the tool reads a materialised throwaway copy (§4.4), so a write resolved the tool's way would land in a temp directory and be discarded. The inversion carries a comment, because it reads as a bug otherwise.

```
read live bytes, or take `scaffold` when absent   → preimage: sha256 + mode, null when absent
parse through yaml's Document API                 → comments and key order survive
refuse a non-mapping document, or a `collection` that is not a sequence
append the entry; never touch `version`
stop if an identical entry is already present
write <candidateRoot>/.skillgantry-write.tmp, fsync
unifiedDiffFor(live, tmp, label, exec)            → the same renderer both sandboxes use
await authorisation                               → the pane, or --yes
re-hash live against the preimage                 → abort naming the path on any mismatch
rename tmp over the target, fsync the directory
```

Three of those need their reason stated.

**`version` is never touched.** A legacy v1 rule-only baseline stays v1. skillspector loads it with a warning; bumping it to 2 retroactively applies the non-empty-reason rule to rules the user wrote before that rule existed, and can turn a loadable file into an unloadable one.

**The identical-entry stop.** Without it, pressing `s` twice on one issue stacks duplicate rules in the user's repo, and nothing downstream would notice.

**The temp file is in the candidate root, and §4.4 gains a row.** Same-directory rename is the only portable atomic recipe, and reusing the temp file for both the diff and the write means the bytes reviewed are the bytes renamed rather than a second render that could differ. But a file inside the skill directory is inside the candidate manifest, so a run digesting concurrently would hash it. `.skillgantry-write.tmp` at the candidate root joins §4.4's exclusion table as a fifth exact SkillGantry-owned path, which is what R2.9 already permits. Release solved the same problem the same way for `<skillName>_*.zip`.

**The abort includes absent-became-present.** A preimage of `null` that finds a file at recheck is drift: someone created the baseline while the diff sat on screen.

## Surfaces

`s` on the Issues screen and on the Work Findings pane. Free on both today — Dashboard's `s` is its skill filter, and the Work screen's issue-scope cycle is uppercase `S`.

The Findings pane has what it needs in hand: `FindingRow` carries `finding.nativeRuleId`, `finding.path`, `toolId` and `stage`. The Issues screen does not, so `GantryViews` gains one read resolving a fingerprint to its detections' native rule ids, taken from the issue's `last_seen_run` rather than from all history — a rule id reported once and not since would otherwise add a rule for a finding that no longer exists.

**Refusals and warnings are named.** A finding from a tool with no `baseline` reports `skill-scanner declares no baseline` and points at `w` for wontfix, saying that wontfix does not affect the gate. The harder case is an issue both scanners report: skillspector's rule can be written, but §10.4's conjunction leaves the issue unsuppressed while skill-scanner still reports it, and the security stage still fails. The pane says so before the write. A user who accepts a finding, re-runs, and watches it fail anyway has been misled by the feature that was supposed to help.

**The reason** reuses §14.2's `begin-edit` / `edit-input` / `stage-edit` / `cancel-edit` reducer shape rather than a second text input. Prefilled `Accepted <date> via SkillGantry`, editable, empty refused — skillspector's v2 schema refuses it too, and the reason is what the Issues row later renders as `⊘ suppressed: <reason>`.

**`SuppressPane`** is a sibling of `ReviewPane` and `ConfirmPane`. It renders diff text, so `ReviewPane`'s diff body is extracted into a shared `DiffBody` used by both: two renderers of one diff is the divergence `tokens.ts` records from when five modules each owned severity colour, and that gutter's comment already says this is the pane where a colour has to mean what it means everywhere else.

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

The last two body rows are conditional: the second-detector warning only when one exists, the R9.9 line whenever the *resolved* stage set does not cover all three gates. Resolved and not the toggle's label, because "resume from the first non-passing gate" already covers all three when validate is the failure, and a warning that release will refuse would then be false.

Every row is counted against the pane's allocation, per §14.1's first rule. Precedence slots second in §14.2's fixed order — after the mutation review, before the config confirmation — on that order's own principle, which is what a keystroke can destroy.

**The flash says the ledger has not caught up.** R8.15 makes the file the authority and the suppression columns a cache recomputed on conclusive tool runs, so the `⊘ suppressed` mark appears only after the re-run. Without that line the user applies, sees the Issues screen unchanged, and concludes nothing happened.

## Re-run

Both non-`nothing` toggle settings call `queue.enqueue` — the same call `r` makes, with the same batch shape R5.5 defines. No new run path and no core change.

`resume from the first non-passing gate` resolves to the contiguous chain from the earliest gate whose last recorded outcome is not `passed`, through security. A stage that never ran reads `·` and counts as non-passing. When all three gates passed the set is empty and the toggle starts on `every gate` instead. The pane lists the resolved stage names, so there is nothing for the user to infer from the label.

The Issues screen is cross-repo and does not know the target skill's rail, so the pane calls the existing `loadLastRun(skill)` for that skill when it opens: one index read plus at most five `stage.json` reads, the lazy-per-selection shape §14.5 already uses.

## Headless

```
skillgantry suppress <skill> --tool <id> --rule <nativeRuleId> --path <skillRelPath>
                             --reason <text> [--yes] [--json]
skillgantry suppress <skill> --fingerprint <fp> --reason <text> [--yes] [--json]
```

`--fingerprint` resolves rule ids from the ledger the way the Issues screen does. `--yes` is prior authorisation with the diff emitted to output immediately before the write, which is R12.4's rule for every mutating headless path. Without it the diff prints, nothing is written, and the exit is non-zero. The exit code reports whether a suppression was written, never whether the skill passes — R12.6's precedent for `fix`, and for its reason: reusing R12.2's meaning would make a clean skill indistinguishable from a failed lookup.

No `--then-run`. The shell composes `suppress && run`, and duplicating stage selection into a second command is how the two come to disagree.

## Requirement amendments

| Id | Statement |
|---|---|
| R4.16 | A manifest MUST be able to declare its tool's suppression file: the path in the `{skillDir}` vocabulary, the document format, the target collection, the scaffold written when the file is absent, and the entry template in the finding vocabulary. The declaration MUST be data; an adapter MUST NOT perform the write. A substituted value reaching a field the tool glob-matches MUST be escaped. |
| R8.16 | Amends R8.15's authority clause. SkillGantry MAY write the skill's suppression file through R10.12. The file remains the authority and the ledger's suppression columns remain a derived cache recomputed on conclusive tool runs. |
| R10.12 | A repo write that is a single file composed by SkillGantry MUST capture a preimage, emit a diff before any byte moves, obtain authorisation, recheck the preimage and abort naming the path on any mismatch, and land through one atomic rename. It MUST NOT write when an identical entry is already present. It MUST NOT claim, and does not need, the sandbox, journal or crash marker R10.1–R10.11 require of a tool-driven mutation. |
| R11.16 | A user MUST be able to accept a finding from the Issues screen and from the Findings pane. A detecting tool that declares no baseline MUST be named in the refusal. Another detector still reporting the issue that cannot be suppressed MUST be named before the write. A reason MUST be required and MUST NOT be empty. The action MUST NOT change any panel's row allocation. |
| R11.17 | The confirmation MUST offer to enqueue the gate chain resumed from the first non-passing stage, every gate, or nothing, and MUST state that recorded gate runs were passed against the bytes from before the write. |
| R12.7 | `skillgantry suppress` MUST be available headlessly. `--yes` is prior authorisation and the diff MUST be emitted immediately before the write. The exit code MUST report whether a suppression was written, not whether the skill passes. |

Milestone ownership gains an M8 row owning all six. Range safety under R13.7: R4.16 follows R4.15, R8.16 follows R8.15, R10.12 follows R10.11, R11.16 and R11.17 follow R11.15, R12.7 follows R12.6. No existing range widens.

## Spec edits

| Document | Edit |
|---|---|
| requirements.md | Six ids above; R8.15's authority sentence amended in place to cite R8.16; new M8 row |
| design.md §4.4 | `.skillgantry-write.tmp` added to the exclusion table with its reason |
| design.md §7 | `BaselineSpec` on `AdapterManifest`, skillspector's declaration, the path-shape trap, the two-literals test |
| design.md §12.5 | New: the narrow write path, and what it deliberately omits from §12.1–§12.3 |
| design.md §15 | `skillgantry suppress` |
| design.md §16 | Test rows |
| design.md §17, §18 | Traceability, change history |
| design-tui.md §14.7 | New: the two surfaces, the reason input, `SuppressPane`, the toggle, precedence |
| decision-log.md §12 | D24–D27; D21's deferral marked retired |
| CLAUDE.md | "release and retire are the only commands that write to the user's own repo" becomes three, naming the safety each carries |
| index.md | This plan's row |

## Testing

| Target | Guard |
|---|---|
| Entry substitution | Every token resolves; `{pathGlob}` is skill-relative and not repo-relative; `*`, `?` and `[` in a filename are escaped to a character class; a repo-root skill's path is unchanged |
| Document append | Comments and key order survive a round trip; a non-mapping document is refused; a `collection` that is not a sequence is refused; `version` is unchanged on a v1 file; an absent file takes the scaffold; an identical entry is a no-op |
| Write path | Preimage drift aborts naming the path; absent-became-present aborts; the diff is byte-identical to what the rename lands; `.skillgantry-write.tmp` is excluded from the digest |
| Registry | Every manifest declaring a `baseline` has a `conditionalArgv` whose `whenExists` equals `baseline.path` |
| Surfaces | The refusal names the tool for a skill-scanner finding; the second-detector warning appears only when one exists; the frame's row count is unchanged at 80×24 and 50×14; an empty reason cannot be applied |
| Re-run | The resolved chain is contiguous from the first non-passing gate; a `·` stage counts as non-passing; all three passing resolves to empty and the toggle starts on `every gate`; `nothing` enqueues nothing |
| Headless | Without `--yes` the diff prints and the file is byte-identical; the exit code tracks the write and not the skill's outcome |
| Acceptance | A fake tool branching on `--baseline`, as `m6-baseline.test.ts` already does: the gate fails, `suppress` writes the rule, the re-run passes, the ledger reads the issue suppressed and still `open` with its history, and deleting the entry brings the finding back |
| Integration (`SG_INTEGRATION=1`) | Real skillspector, twice over a real skill: scan, write the rule from the SARIF it produced, re-scan, and assert the result comes back carrying `suppressions` |

The integration row is the one that matters, and it has to reach the real binary. A wrong path shape produces a rule that loads cleanly and matches nothing, so the stage fails exactly as before with no error anywhere. The acceptance tier cannot catch it: its fake tool branches on whether the `--baseline` flag arrived, which is a different question from whether the rule inside the file matches — no shell fixture implements fnmatch.

## Risks and one-way doors

**Suppression is one-way in the terminal.** Removing a rule is out of scope, so undoing means editing the YAML by hand or reverting the file in git. The mitigation is that the diff gate makes a wrong rule visible before it lands, and the file is an ordinary tracked file in the user's repo. If the acceptance flow gets used enough that mistakes are routine, `S` to unsuppress through the same write path is the follow-up.

**Coverage is one tool of four.** Every security finding skill-scanner raises, and everything skill-lint raises, can only be marked `wontfix`, which does not affect the gate. That is a property of the ecosystem rather than of this design, and D24 chose to state it rather than paper over it with a second store.

**skillspector's glob semantics are its own.** `*` crosses path separators and matching is case-insensitive. A rule written for `scripts/scan.py` is exact, so neither bites today, but a future manifest that emits a pattern rather than a literal path inherits both.

---

## Global Constraints

Everything in prior plans' Global Constraints still holds. These bind every task below:

- **ESM only, `NodeNext`.** Every relative import carries the `.js` extension, in `.tsx` too.
- **Node floor `>=24.0.0`.** `node:sqlite` and `node:child_process` used directly. No `better-sqlite3`, no `execa`.
- **`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`** are all on. The last one requires conditional spreads rather than an explicit `undefined`.
- **Import direction is `cli → tui → core`,** enforced by lint. `src/tui/**` reaches core only through `src/core/index.ts`, may touch `node:fs`, and may not spawn or open the ledger. `src/core/adapters/**` may not import `node:fs`, `node:child_process`, `node:https` or `node:net`. No `console` or `process.exit` in `src/core/**`.
- **British spelling in identifiers that appear in the specs:** `optimise`, `artefact`, `normalise`, `catalogue`, `authorisation`.
- **Comments explain why a rule exists,** usually by naming the failure mode the alternative had. No restating comments.
- **Conventional Commits,** lowercase imperative subject describing the behaviour change.
- **§14.1's row budget** governs every terminal change: a panel renders exactly the rows it was allocated, an overflow notice counts *against* that allocation, text truncates and never wraps, and chrome costs are `layout.ts`'s to know.
- **R11.15's colour prohibition:** no body foreground and no background colour anywhere in `src/tui/**`. A selected row is `inverse` over text padded with `padCells` to the pane's inner width.
- **Verification command:** `pnpm check` (lint, build, test, acceptance) before any commit that closes a task.

## Task Order and Why

Task 1 is first because R13.7's traceability test fails the build until every new requirement has exactly one milestone owner and a design section claiming it — so every later task would be committing against a red build.

Task 5 comes before Task 6 because Task 6 writes `.skillgantry-write.tmp` into the candidate root, and until Task 5 excludes it a concurrent digest hashes it.

Task 7 comes before Tasks 8 and 10 because the headless command and the terminal key both consume the same target resolution; building either first would produce a second one.

Task 9 declares `SuppressSlot` and builds the pane, Task 10 is the pure gate resolver, and Task 11 wires the keys that need both. That order is forced rather than chosen: the pane imports the slot type, and Task 11's preview effect fills the slot's `stages` from `resumedGates` — either dependency the other way round leaves a task that cannot compile alone, which is not an independently testable deliverable.

Tasks 12 and 13 are last: both need the whole path. They are two tasks and not one because they answer different questions in different tiers — the acceptance tier proves the flow against a fake tool, and only the integration tier, reaching a real skillspector, can prove the rule we wrote is one the tool matches.

Tasks 3 and 4 are pure and independent of everything but Task 2's types.

## Critical Files — Summary

| Path | Role |
|---|---|
| `src/core/adapters/types.ts` | `BaselineSpec`, `AdapterManifest.baseline` |
| `src/core/adapters/skillspector.ts` | `BASELINE_PATH` const shared with `conditionalArgv`, the `baseline` declaration |
| `src/core/suppress/entry.ts` | `globEscape`, `skillRelative`, `suppressionEntry` — pure |
| `src/core/suppress/document.ts` | `appendEntries` over a YAML or JSON document — pure |
| `src/core/suppress/write.ts` | `planSuppression`, `applySuppression`, `discardSuppression` |
| `src/core/suppress/target.ts` | `SuppressionRequest` → the tools that can be written and the ones that cannot |
| `src/core/discovery/candidate.ts` | `WRITE_TEMP_NAME` and its exclusion |
| `src/core/ledger/issue-queries.ts` | `issueDetectionRules` — `(toolId, nativeRuleId)` at the issue's `last_seen_run` |
| `src/cli/suppress-command.ts` | `skillgantry suppress` |
| `src/cli/gantry-views.ts` | `planSuppression` / `applySuppression` / `discardSuppression` port implementations |
| `src/tui/views.ts` | The three new `GantryViews` methods |
| `src/tui/components/DiffBody.tsx` | Diff rows extracted from `ReviewPane`, shared with `SuppressPane` |
| `src/tui/components/SuppressPane.tsx` | The confirmation, the reason editor row, the re-run toggle |
| `src/tui/store.ts` | `SuppressSlot`, the `suppress` slot, its actions, the toggle state |
| `src/tui/rows.ts` | `resumedGates()` — the contiguous chain from the first non-passing gate |
| `src/tui/app.tsx` | `s` on the Issues screen and the Findings pane; the pane's `a`/`d`/`t`; the preview effect |

---

## Implementation Tasks

### Task 1: Spec amendments

The repo's rule: when implementation proves a spec wrong, amend the spec in the same branch. Here the spec is amended *first*, because R13.7 is machine-checked.

**Files:**
- Modify: `docs/specs/requirements.md`
- Modify: `docs/specs/design.md`
- Modify: `docs/specs/design-tui.md`
- Modify: `docs/specs/decision-log.md`
- Modify: `CLAUDE.md`
- Test: `tests/specs/traceability.test.ts` (existing, must stay green)

**Interfaces:**
- Consumes: nothing.
- Produces: requirement ids R4.16, R8.16, R10.12, R11.16, R11.17, R12.7 that every later task's comments cite.

- [ ] **Step 1: Run the traceability test to see it green before touching anything**

Run: `pnpm vitest run tests/specs/traceability.test.ts`
Expected: PASS. This is the baseline — if it is already red, stop and fix that first.

- [ ] **Step 2: Add the six requirements to `requirements.md`**

Append R4.16 after R4.15, R8.16 after R8.15, R10.12 after R10.11, R11.16 and R11.17 after R11.15, R12.7 after R12.6. Use the exact statements from the "Requirement amendments" table above. Each carries a `*(rev 14)*` marker and a `*Rationale:*` line naming the failure mode, matching the register of its neighbours.

Amend R8.15's opening sentence in place so it reads `The skill's own suppression file MUST be the authority, written only through R10.12, and ledger suppression columns MUST be a derived cache…`.

Add to the revision preamble at the top: `Revision 14 marks *(rev 14)* and adds R4.16, R8.16, R10.12, R11.16, R11.17 and R12.7: M6 taught SkillGantry to read a tool's suppression file and left writing one a manual YAML edit, which D21 deferred to M8.`

- [ ] **Step 3: Add the M8 row to § Milestone ownership**

```markdown
| M8 | R4.16, R8.16, R10.12, R11.16, R11.17, R12.7 | `s` on the Issues screen and the Findings pane writes one glob rule into the tool's own baseline, behind a displayed diff, a preimage recheck and one atomic rename; a tool with no baseline is refused by name and a second uncovered detector is named before the write; the confirmation offers the resumed gate chain or every gate and says which recorded gates were passed against the previous bytes; `skillgantry suppress` does the same headlessly and its exit code tracks the write rather than the skill; and a real skillspector run that failed passes on the re-run |
```

- [ ] **Step 4: Add the design sections**

`design.md` §4.4: one row in the exclusion table for `.skillgantry-write.tmp` with the reason. §7: the `BaselineSpec` interface, skillspector's declaration, the skill-relative path trap, the shared-constant rule. New §12.5 covering the write sequence and the four §12 mechanisms it omits with a reason each. §15: the `suppress` subcommand. §16: the test rows from the "Testing" table above. §17: the six ids mapped to their sections. §18: a change-history entry.

`design-tui.md`: new §14.7 covering the two surfaces, the reason editor, `SuppressPane`, the toggle, and the precedence slot.

`decision-log.md`: new §12 carrying D24–D27 verbatim from the Decisions section above, and one line in §11 under D21 reading `*Retired by §12, D24–D27.*`

- [ ] **Step 5: Update CLAUDE.md**

Replace the sentence beginning `release and retire are the only commands that write to the user's own repo` with one naming three writers and the safety each carries — release and retire behind §12's sandbox, journal and marker; suppress behind §12.5's diff, preimage recheck and atomic rename.

- [ ] **Step 6: Run the traceability test**

Run: `pnpm vitest run tests/specs/traceability.test.ts`
Expected: PASS. A failure here names either a requirement with no milestone owner or one no design section claims — fix the document it names, not the test.

- [ ] **Step 7: Commit**

```bash
git add docs/specs CLAUDE.md
git commit -m "docs (m8): amend the specs for terminal suppression"
```

---

### Task 2: `BaselineSpec` on the manifest

**Files:**
- Modify: `src/core/adapters/types.ts`
- Modify: `src/core/adapters/skillspector.ts`
- Create: `tests/core/adapter-baseline.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BaselineSpec` (`{ path: string; document: 'yaml' | 'json'; collection: string; scaffold: Record<string, unknown>; entry: Readonly<Record<string, string>> }`), and `AdapterManifest.baseline?: BaselineSpec`. Tasks 3, 4, 6 and 7 all take a `BaselineSpec`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/adapter-baseline.test.ts
import { describe, expect, it } from 'vitest'
import { getAdapter, listAdapters } from '../../src/core/adapters/registry.js'

describe('R4.16 baseline declaration', () => {
  it('declares skillspector its baseline file, collection and entry shape', () => {
    const baseline = getAdapter('skillspector')?.manifest.baseline
    expect(baseline).toBeDefined()
    expect(baseline?.path).toBe('{skillDir}/.skillspector-baseline.yaml')
    expect(baseline?.document).toBe('yaml')
    expect(baseline?.collection).toBe('rules')
    expect(baseline?.entry).toEqual({
      id: '{ruleIdGlob}',
      path: '{pathGlob}',
      reason: '{reason}',
    })
  })

  it('scaffolds a v2 document with no fingerprints, so scanner_version is not required', () => {
    expect(getAdapter('skillspector')?.manifest.baseline?.scaffold).toEqual({
      version: 2,
      rules: [],
      fingerprints: [],
    })
  })

  // The flag exists to read the file this spec writes. Two literals of one
  // path is how the day one of them moves becomes the day SkillGantry writes
  // a baseline it no longer passes to the tool.
  it('passes the same path to the tool that it declares as the baseline', () => {
    for (const adapter of listAdapters()) {
      const { baseline, invoke } = adapter.manifest
      if (baseline === undefined) continue
      const paths = (invoke.conditionalArgv ?? []).map((group) => group.whenExists)
      expect(paths, `${adapter.manifest.id} declares a baseline`).toContain(baseline.path)
    }
  })

  it('leaves an adapter whose tool has no baseline undeclared', () => {
    expect(getAdapter('skill-scanner')?.manifest.baseline).toBeUndefined()
    expect(getAdapter('skill-lint')?.manifest.baseline).toBeUndefined()
    expect(getAdapter('skill-up')?.manifest.baseline).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/core/adapter-baseline.test.ts`
Expected: FAIL — `baseline` is not a property of `AdapterManifest`, so this will not compile.

- [ ] **Step 3: Add the type**

In `src/core/adapters/types.ts`, above `AdapterManifest`:

```ts
/**
 * R4.16. Where a tool keeps the findings its user has accepted, and what one
 * accepted finding looks like inside that file.
 *
 * Declarative rather than a function the adapter exports, for two reasons.
 * R4.1 makes an adapter a manifest and a single `parse`, and a third export
 * would quietly make it three. And R4.3 forbids an adapter touching the
 * filesystem at all, which lint enforces — so the write has to live outside
 * the adapter whatever shape the declaration takes.
 */
export interface BaselineSpec {
  /**
   * `{skillDir}`/`{repoRoot}` vocabulary. Resolved against the **live** skill
   * directory, deliberately unlike `conditionalArgv.whenExists`, which
   * resolves against the tool-facing path: a repo-root skill's tool reads a
   * materialised candidate copy, so a write resolved the tool's way would
   * land in a temp directory and be discarded with it (design §12.5).
   */
  path: string
  document: 'yaml' | 'json'
  /** The sequence one accepted finding is appended to. */
  collection: string
  /** The whole document, written when the file is absent. */
  scaffold: Record<string, unknown>
  /** One entry, in `src/core/suppress/entry.ts`'s finding vocabulary. */
  entry: Readonly<Record<string, string>>
}
```

Add the field to `AdapterManifest`, beneath `artefacts`:

```ts
  /** R4.16. Absent when the tool has no suppression file of its own. */
  baseline?: BaselineSpec
```

- [ ] **Step 4: Declare skillspector's**

In `src/core/adapters/skillspector.ts`, above the manifest:

```ts
/**
 * One constant for the flag and the writer. The registry test asserts the two
 * agree for every adapter, but a shared constant makes them agree at compile
 * time for this one.
 */
const BASELINE_PATH = '{skillDir}/.skillspector-baseline.yaml'
```

Replace both literals in `conditionalArgv` with `BASELINE_PATH`, and add to the manifest after `artefacts`:

```ts
  baseline: {
    path: BASELINE_PATH,
    document: 'yaml',
    collection: 'rules',
    // v2 with an empty `fingerprints` needs no `scanner_version`; a v2 with
    // entries does, and SkillGantry never writes one — the fingerprint form
    // hashes the whole file's content plus every finding field, so it cannot
    // be authored from SARIF and self-invalidates on the next edit anyway.
    scaffold: { version: 2, rules: [], fingerprints: [] },
    entry: { id: '{ruleIdGlob}', path: '{pathGlob}', reason: '{reason}' },
  },
```

- [ ] **Step 5: Run the test**

Run: `pnpm vitest run tests/core/adapter-baseline.test.ts tests/core/skillspector.test.ts`
Expected: PASS, both files.

- [ ] **Step 6: Commit**

```bash
git add src/core/adapters/types.ts src/core/adapters/skillspector.ts tests/core/adapter-baseline.test.ts
git commit -m "feat (adapters): declare a tool's suppression file on its manifest"
```

---

### Task 3: Entry substitution and glob escaping

**Files:**
- Create: `src/core/suppress/entry.ts`
- Create: `tests/core/suppress-entry.test.ts`

**Interfaces:**
- Consumes: `BaselineSpec` from Task 2.
- Produces: `globEscape(value: string): string`, `skillRelative(repoRelPath: string, skillRelPath: string): string`, `suppressionEntry(spec: BaselineSpec, vars: FindingVars): Record<string, string>`, and `interface FindingVars { nativeRuleId: string; skillRelativePath: string; reason: string }`. Tasks 6 and 7 call `suppressionEntry` and `skillRelative`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/suppress-entry.test.ts
import { describe, expect, it } from 'vitest'
import type { BaselineSpec } from '../../src/core/adapters/types.js'
import { globEscape, skillRelative, suppressionEntry } from '../../src/core/suppress/entry.js'

const spec: BaselineSpec = {
  path: '{skillDir}/.skillspector-baseline.yaml',
  document: 'yaml',
  collection: 'rules',
  scaffold: { version: 2, rules: [], fingerprints: [] },
  entry: { id: '{ruleIdGlob}', path: '{pathGlob}', reason: '{reason}' },
}

describe('skillRelative', () => {
  // skillspector reports `scripts/scan.py`; RawFinding.path is
  // `declawed/scripts/scan.py`. The glob matches the tool's own path, so
  // writing the repo-relative one yields a rule that loads and matches nothing.
  it('strips the skill prefix from a repo-relative path', () => {
    expect(skillRelative('declawed/scripts/scan.py', 'declawed')).toBe('scripts/scan.py')
  })

  it('leaves a repo-root skill path alone', () => {
    expect(skillRelative('scripts/scan.py', '.')).toBe('scripts/scan.py')
  })

  it('leaves a path that does not carry the prefix alone', () => {
    expect(skillRelative('versions.json', 'declawed')).toBe('versions.json')
  })

  it('does not strip a sibling whose name merely starts the same way', () => {
    expect(skillRelative('declawed-notes/x.md', 'declawed')).toBe('declawed-notes/x.md')
  })
})

describe('globEscape', () => {
  it('leaves an ordinary path untouched', () => {
    expect(globEscape('scripts/scan.py')).toBe('scripts/scan.py')
  })

  // fnmatch treats these as metacharacters in the *pattern*, so an unescaped
  // `notes[1].md` is a character class and matches nothing on disk.
  it('escapes each fnmatch metacharacter as a single-member class', () => {
    expect(globEscape('notes[1].md')).toBe('notes[[]1].md')
    expect(globEscape('a*b')).toBe('a[*]b')
    expect(globEscape('a?b')).toBe('a[?]b')
  })
})

describe('suppressionEntry', () => {
  it('resolves every token in the declared entry', () => {
    expect(
      suppressionEntry(spec, {
        nativeRuleId: 'MP2',
        skillRelativePath: 'scripts/scan.py',
        reason: 'Alignment whitespace in a re.VERBOSE block',
      }),
    ).toEqual({
      id: 'MP2',
      path: 'scripts/scan.py',
      reason: 'Alignment whitespace in a re.VERBOSE block',
    })
  })

  it('escapes the glob-bound tokens and leaves the reason literal', () => {
    expect(
      suppressionEntry(spec, {
        nativeRuleId: 'MP2',
        skillRelativePath: 'notes[1].md',
        reason: 'accepted *as-is*',
      }),
    ).toEqual({ id: 'MP2', path: 'notes[[]1].md', reason: 'accepted *as-is*' })
  })

  it('throws on a token no vocabulary defines', () => {
    expect(() =>
      suppressionEntry(
        { ...spec, entry: { id: '{severity}' } },
        { nativeRuleId: 'MP2', skillRelativePath: 'a.md', reason: 'r' },
      ),
    ).toThrow('unknown suppression token: {severity}')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/core/suppress-entry.test.ts`
Expected: FAIL — cannot resolve `../../src/core/suppress/entry.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/core/suppress/entry.ts
import type { BaselineSpec } from '../adapters/types.js'

/**
 * The finding vocabulary. Kept separate from `invoke.argv`'s path vocabulary
 * so a `{skillDir}` cannot leak into an entry field, or a `{reason}` into a
 * path — two vocabularies in one substituter is how a token comes to mean
 * something in a position it was never defined for.
 */
export interface FindingVars {
  nativeRuleId: string
  /** Skill-relative: the tool globs against the path it reported, not ours. */
  skillRelativePath: string
  reason: string
}

/**
 * fnmatch metacharacters, each escaped as a single-member character class.
 * `[]]` is how fnmatch spells a literal `]` — a `]` immediately after `[` is
 * not a class terminator.
 */
export const globEscape = (value: string): string =>
  value.replace(/[*?[\]]/g, (ch) => `[${ch}]`)

/**
 * R4.16's path trap. `RawFinding.path` is repo-relative because §7.1 rebases
 * every reported path onto `skillRelPath`; the tool's own baseline globs
 * against the path the tool reported, which is skill-relative. The prefix test
 * carries the separator so a sibling directory sharing the skill's name is not
 * mistaken for the skill.
 */
export function skillRelative(repoRelPath: string, skillRelPath: string): string {
  if (skillRelPath === '.') return repoRelPath
  const prefix = `${skillRelPath}/`
  return repoRelPath.startsWith(prefix) ? repoRelPath.slice(prefix.length) : repoRelPath
}

const TOKENS: Readonly<Record<string, (vars: FindingVars) => string>> = {
  nativeRuleId: (vars) => vars.nativeRuleId,
  ruleIdGlob: (vars) => globEscape(vars.nativeRuleId),
  skillRelativePath: (vars) => vars.skillRelativePath,
  pathGlob: (vars) => globEscape(vars.skillRelativePath),
  reason: (vars) => vars.reason,
}

/** One accepted finding, in the shape the manifest declared. */
export function suppressionEntry(
  spec: BaselineSpec,
  vars: FindingVars,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, template] of Object.entries(spec.entry)) {
    out[key] = template.replace(/\{(\w+)\}/g, (_whole, token: string) => {
      const resolve = TOKENS[token]
      // Thrown rather than left literal: a `{typo}` written into a user's repo
      // is a rule that never matches and never explains itself.
      if (resolve === undefined) throw new Error(`unknown suppression token: {${token}}`)
      return resolve(vars)
    })
  }
  return out
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run tests/core/suppress-entry.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/suppress/entry.ts tests/core/suppress-entry.test.ts
git commit -m "feat (suppress): compose a baseline entry from a finding"
```

---

### Task 4: Appending to the baseline document

**Files:**
- Create: `src/core/suppress/document.ts`
- Create: `tests/core/suppress-document.test.ts`

**Interfaces:**
- Consumes: `BaselineSpec` from Task 2.
- Produces: `appendEntries(current: string | null, spec: BaselineSpec, entries: readonly Record<string, string>[]): AppendResult`, where `interface AppendResult { text: string; added: number; alreadyPresent: number }`. Task 6 calls it.

Entries is a list, not one entry: an issue can carry several native rule ids, and they all land in one file.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/suppress-document.test.ts
import { describe, expect, it } from 'vitest'
import type { BaselineSpec } from '../../src/core/adapters/types.js'
import { appendEntries } from '../../src/core/suppress/document.js'

const spec: BaselineSpec = {
  path: '{skillDir}/.skillspector-baseline.yaml',
  document: 'yaml',
  collection: 'rules',
  scaffold: { version: 2, rules: [], fingerprints: [] },
  entry: { id: '{ruleIdGlob}', path: '{pathGlob}', reason: '{reason}' },
}

const rule = { id: 'MP2', path: 'scripts/scan.py', reason: 'alignment whitespace' }

describe('appendEntries', () => {
  it('takes the scaffold when the file is absent', () => {
    const { text, added } = appendEntries(null, spec, [rule])
    expect(added).toBe(1)
    expect(text).toContain('version: 2')
    expect(text).toContain('id: MP2')
    expect(text).toContain('path: scripts/scan.py')
  })

  // The user's own comments are the only record of why the earlier entries are
  // there. A rewrite that drops them is a silent edit of their file.
  it('preserves comments and key order on an existing document', () => {
    const current = [
      '# hand-written, do not regenerate',
      'version: 2',
      'scanner_version: "2.5.1"',
      'rules:',
      '  - id: SQP-1',
      '    reason: description nit',
      'fingerprints: []',
      '',
    ].join('\n')
    const { text } = appendEntries(current, spec, [rule])
    expect(text).toContain('# hand-written, do not regenerate')
    expect(text.indexOf('version: 2')).toBeLessThan(text.indexOf('rules:'))
    expect(text).toContain('id: SQP-1')
    expect(text).toContain('id: MP2')
  })

  // Bumping a v1 rule-only file to v2 retroactively applies v2's non-empty
  // reason rule to rules written before it existed, and can make a loadable
  // file unloadable.
  it('never touches version', () => {
    const { text } = appendEntries('version: 1\nrules: []\n', spec, [rule])
    expect(text).toContain('version: 1')
    expect(text).not.toContain('version: 2')
  })

  it('creates the collection when the document has no such key', () => {
    const { text, added } = appendEntries('version: 2\n', spec, [rule])
    expect(added).toBe(1)
    expect(text).toContain('rules:')
    expect(text).toContain('id: MP2')
  })

  it('appends several entries in one pass', () => {
    const second = { id: 'SSD-2', path: 'SKILL.md', reason: 'lab phrase' }
    const { text, added } = appendEntries(null, spec, [rule, second])
    expect(added).toBe(2)
    expect(text).toContain('id: MP2')
    expect(text).toContain('id: SSD-2')
  })

  // Without this, pressing `s` twice stacks duplicate rules in the user's repo
  // and nothing downstream notices.
  it('reports an identical entry as already present and adds nothing', () => {
    const once = appendEntries(null, spec, [rule])
    const twice = appendEntries(once.text, spec, [rule])
    expect(twice.added).toBe(0)
    expect(twice.alreadyPresent).toBe(1)
    expect(twice.text).toBe(once.text)
  })

  it('refuses a document that is not a mapping', () => {
    expect(() => appendEntries('- a\n- b\n', spec, [rule])).toThrow('baseline is not a mapping')
  })

  it('refuses a collection that is not a sequence', () => {
    expect(() => appendEntries('version: 2\nrules: {}\n', spec, [rule])).toThrow(
      'baseline `rules` is not a sequence',
    )
  })

  it('refuses a document that does not parse', () => {
    expect(() => appendEntries('a: [\n', spec, [rule])).toThrow(/baseline is not parseable/)
  })

  it('round-trips a json document', () => {
    const json: BaselineSpec = { ...spec, document: 'json' }
    const { text } = appendEntries('{"version":2,"rules":[]}', json, [rule])
    expect(JSON.parse(text)).toEqual({ version: 2, rules: [rule] })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/core/suppress-document.test.ts`
Expected: FAIL — cannot resolve `../../src/core/suppress/document.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/core/suppress/document.ts
import { Document, isMap, isSeq, parseDocument } from 'yaml'
import type { BaselineSpec } from '../adapters/types.js'

export interface AppendResult {
  text: string
  added: number
  /** Entries the collection already held verbatim. */
  alreadyPresent: number
}

const sameEntry = (a: unknown, b: Record<string, string>): boolean => {
  if (typeof a !== 'object' || a === null) return false
  const left = a as Record<string, unknown>
  const keys = Object.keys(b)
  return (
    Object.keys(left).length === keys.length && keys.every((key) => left[key] === b[key])
  )
}

function appendJson(
  current: string | null,
  spec: BaselineSpec,
  entries: readonly Record<string, string>[],
): AppendResult {
  let doc: unknown
  try {
    doc = current === null ? structuredClone(spec.scaffold) : JSON.parse(current)
  } catch (err) {
    throw new Error(`baseline is not parseable: ${(err as Error).message}`)
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new Error('baseline is not a mapping')
  }
  const map = doc as Record<string, unknown>
  const existing = map[spec.collection] ?? []
  if (!Array.isArray(existing)) {
    throw new Error(`baseline \`${spec.collection}\` is not a sequence`)
  }
  const list = [...existing]
  let added = 0
  let alreadyPresent = 0
  for (const entry of entries) {
    if (list.some((item) => sameEntry(item, entry))) alreadyPresent += 1
    else {
      list.push(entry)
      added += 1
    }
  }
  if (added === 0) return { text: current ?? `${JSON.stringify(map, null, 2)}\n`, added, alreadyPresent }
  map[spec.collection] = list
  return { text: `${JSON.stringify(map, null, 2)}\n`, added, alreadyPresent }
}

/**
 * R10.12's document half. Through yaml's Document API rather than
 * parse-then-stringify, because the user's comments are the only record of why
 * the entries already there are there, and a rewrite that drops them is a
 * silent edit of their file.
 *
 * `version` is never written. Bumping a legacy v1 rule-only baseline to v2
 * retroactively applies v2's non-empty-reason rule to rules the user wrote
 * before it existed, which can turn a loadable file into an unloadable one.
 */
export function appendEntries(
  current: string | null,
  spec: BaselineSpec,
  entries: readonly Record<string, string>[],
): AppendResult {
  if (spec.document === 'json') return appendJson(current, spec, entries)

  const doc = current === null ? new Document(spec.scaffold) : parseDocument(current)
  if (doc.errors.length > 0) {
    throw new Error(`baseline is not parseable: ${doc.errors[0]?.message ?? 'unknown'}`)
  }
  if (!isMap(doc.contents)) throw new Error('baseline is not a mapping')

  // `true` returns the node rather than its plain JS value, which is what lets
  // the sequence be mutated in place with its comments intact.
  const node = doc.contents.get(spec.collection, true)
  let added = 0
  let alreadyPresent = 0

  if (node === undefined || node === null) {
    const fresh = entries.filter((entry, index) => entries.indexOf(entry) === index)
    doc.set(spec.collection, doc.createNode(fresh))
    return { text: String(doc), added: fresh.length, alreadyPresent: 0 }
  }
  if (!isSeq(node)) throw new Error(`baseline \`${spec.collection}\` is not a sequence`)

  for (const entry of entries) {
    if (node.items.some((item) => sameEntry((item as { toJSON?: () => unknown }).toJSON?.() ?? item, entry))) {
      alreadyPresent += 1
      continue
    }
    node.add(doc.createNode(entry))
    added += 1
  }
  if (added === 0 && current !== null) return { text: current, added, alreadyPresent }
  return { text: String(doc), added, alreadyPresent }
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run tests/core/suppress-document.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/suppress/document.ts tests/core/suppress-document.test.ts
git commit -m "feat (suppress): append an accepted finding to a baseline document"
```

---

### Task 5: Exclude the write temp file from the candidate manifest

The temp file has to sit beside its target for `rename` to be atomic, which puts it inside the candidate root. A run digesting concurrently would hash it.

**Files:**
- Modify: `src/core/discovery/candidate.ts:24-26`
- Modify: `src/core/index.ts`
- Modify: `tests/core/digest.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `WRITE_TEMP_NAME` (`'.skillgantry-write.tmp'`), exported from `src/core/discovery/candidate.ts` and re-exported from `src/core/index.ts`. Task 6 imports it.

- [ ] **Step 1: Write the failing test**

Append to `tests/core/digest.test.ts`, inside its existing top-level `describe`. Match the fixture helper the file already uses — read the top of the file first and follow it rather than inventing a second setup shape.

```ts
  // The suppression write stages its bytes beside the target so the rename is
  // atomic (§12.5), which puts the temp file inside the candidate root. A run
  // digesting mid-write must not hash it — R2.9 permits the exclusion because
  // the path is exactly SkillGantry-owned.
  it('excludes the suppression write temp file', async () => {
    const skill = await fixtureSkill()
    const before = await skillDigest(skill)
    await writeFile(join(skill.dir, WRITE_TEMP_NAME), 'staged bytes')
    expect(await skillDigest(skill)).toBe(before)
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/core/digest.test.ts`
Expected: FAIL — `WRITE_TEMP_NAME` is not exported, and once stubbed, the digest differs.

- [ ] **Step 3: Add the exclusion**

In `src/core/discovery/candidate.ts`, above `excludedPaths`:

```ts
/**
 * Where `src/core/suppress/write.ts` stages its bytes. Same-directory rename is
 * the only portable atomic recipe, so the file lands inside the candidate root
 * — and an exact SkillGantry-owned path is what R2.9 allows to be excluded.
 * Release solved the same problem the same way for `<skillName>_*.zip`.
 */
export const WRITE_TEMP_NAME = '.skillgantry-write.tmp'
```

In `excludedPaths`, add it to the `owned` set unconditionally. The `.gitignore` exclusion two lines below is guarded by `rootSkill`; this one is not, because the write happens in whichever candidate root holds the baseline:

```ts
function excludedPaths(skill: SkillRef): Set<string> {
  const owned = new Set<string>([
    posix(relative(skill.dir, skill.workspacePath)),
    '.git',
    WRITE_TEMP_NAME,
  ])
  if (skill.rootSkill) owned.add('.gitignore')
```

Re-export from `src/core/index.ts` beside the other `discovery` exports:

```ts
export { WRITE_TEMP_NAME } from './discovery/candidate.js'
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/core/digest.test.ts tests/core/candidate.test.ts`
Expected: PASS, both files.

- [ ] **Step 5: Commit**

```bash
git add src/core/discovery/candidate.ts src/core/index.ts tests/core/digest.test.ts
git commit -m "feat (candidate): exclude the suppression write temp file from the digest"
```

---

### Task 6: The write path

**Files:**
- Create: `src/core/suppress/write.ts`
- Create: `tests/core/suppress-write.test.ts`
- Modify: `src/core/index.ts`

**Interfaces:**
- Consumes: `appendEntries` (Task 4), `WRITE_TEMP_NAME` (Task 5), `unifiedDiffFor` from `src/core/isolation/diff.js`, `Exec` from `src/core/tools/exec.js`.
- Produces:

```ts
export interface SuppressionPlan {
  toolId: string
  /** Absolute path of the file the rename lands on. */
  path: string
  /** Repo-relative, for the diff label and the pane title. */
  label: string
  /** sha256 of the live file; null when it is absent. */
  preimage: string | null
  tempPath: string
  diff: string
  added: number
  alreadyPresent: number
}

export function planSuppression(input: PlanInput): Promise<SuppressionPlan>
export function applySuppression(plan: SuppressionPlan): Promise<void>
export function discardSuppression(plan: SuppressionPlan): Promise<void>
```

Tasks 7, 8 and 10 consume all three.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/suppress-write.test.ts
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WRITE_TEMP_NAME } from '../../src/core/discovery/candidate.js'
import {
  applySuppression,
  discardSuppression,
  planSuppression,
} from '../../src/core/suppress/write.js'
import type { BaselineSpec } from '../../src/core/adapters/types.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import type { RepoRef, SkillRef } from '../../src/core/types.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'

const spec: BaselineSpec = {
  path: '{skillDir}/.skillspector-baseline.yaml',
  document: 'yaml',
  collection: 'rules',
  scaffold: { version: 2, rules: [], fingerprints: [] },
  entry: { id: '{ruleIdGlob}', path: '{pathGlob}', reason: '{reason}' },
}
const rule = { id: 'MP2', path: 'scripts/scan.py', reason: 'alignment whitespace' }

// digest.test.ts's shape: a real SkillRef through discovery, so `relPath`,
// `dir` and `repo.path` are whatever discovery actually produces.
const repoRef = (path: string): RepoRef => ({ id: 'fx', path, name: 'fx', isGit: false })
const fixture = async (): Promise<SkillRef> => {
  const root = await makeRepo({
    files: { 'declawed/SKILL.md': SKILL_MD('declawed'), 'declawed/scripts/scan.py': '# x\n' },
  })
  return (await discoverSkills(repoRef(root)))[0]!
}

describe('R10.12 suppression write', () => {
  it('stages the bytes without touching the target, and diffs them', async () => {
    const skill = await fixture()
    const plan = await planSuppression({ skill, toolId: 'skillspector', spec, entries: [rule] })
    expect(plan.added).toBe(1)
    expect(plan.diff).toContain('+  id: MP2')
    expect(plan.tempPath).toBe(join(skill.dir, WRITE_TEMP_NAME))
    await expect(stat(plan.path)).rejects.toThrow()
  })

  it('lands exactly the staged bytes on apply', async () => {
    const skill = await fixture()
    const plan = await planSuppression({ skill, toolId: 'skillspector', spec, entries: [rule] })
    const staged = await readFile(plan.tempPath, 'utf8')
    await applySuppression(plan)
    expect(await readFile(plan.path, 'utf8')).toBe(staged)
    await expect(stat(plan.tempPath)).rejects.toThrow()
  })

  it('leaves nothing behind on discard', async () => {
    const skill = await fixture()
    const plan = await planSuppression({ skill, toolId: 'skillspector', spec, entries: [rule] })
    await discardSuppression(plan)
    await expect(stat(plan.tempPath)).rejects.toThrow()
    await expect(stat(plan.path)).rejects.toThrow()
  })

  // R10.11's rule, reused: the window between preview and confirm widens with
  // however long the user reads the diff.
  it('aborts naming the path when the file changed under the preview', async () => {
    const skill = await fixture()
    await writeFile(join(skill.dir, '.skillspector-baseline.yaml'), 'version: 2\nrules: []\n')
    const plan = await planSuppression({ skill, toolId: 'skillspector', spec, entries: [rule] })
    await writeFile(join(skill.dir, '.skillspector-baseline.yaml'), 'version: 2\nrules: []\n# edited\n')
    await expect(applySuppression(plan)).rejects.toThrow(/preimage-drift/)
  })

  it('aborts when a file appeared where the preview found none', async () => {
    const skill = await fixture()
    const plan = await planSuppression({ skill, toolId: 'skillspector', spec, entries: [rule] })
    await writeFile(join(skill.dir, '.skillspector-baseline.yaml'), 'version: 2\nrules: []\n')
    await expect(applySuppression(plan)).rejects.toThrow(/preimage-drift/)
  })

  it('reports an entry already in the file and stages nothing', async () => {
    const skill = await fixture()
    const first = await planSuppression({ skill, toolId: 'skillspector', spec, entries: [rule] })
    await applySuppression(first)
    const second = await planSuppression({ skill, toolId: 'skillspector', spec, entries: [rule] })
    expect(second.added).toBe(0)
    expect(second.alreadyPresent).toBe(1)
    expect(second.diff).toBe('')
  })
})
```

`makeRepo` returns the repo root, not a `SkillRef` — the `fixture()` helper above is `tests/core/digest.test.ts`'s pattern, which runs the path through real discovery so `relPath`, `dir` and `repo.path` are whatever discovery actually produces rather than three hand-built strings that agree with nothing.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/core/suppress-write.test.ts`
Expected: FAIL — cannot resolve `../../src/core/suppress/write.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/core/suppress/write.ts
import { createHash } from 'node:crypto'
import { open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import type { BaselineSpec } from '../adapters/types.js'
import { WRITE_TEMP_NAME } from '../discovery/candidate.js'
import { unifiedDiffFor } from '../isolation/diff.js'
import { type Exec, defaultExec } from '../tools/exec.js'
import type { SkillRef } from '../types.js'
import { appendEntries } from './document.js'

export interface SuppressionPlan {
  toolId: string
  path: string
  label: string
  preimage: string | null
  tempPath: string
  diff: string
  added: number
  alreadyPresent: number
}

export interface PlanInput {
  skill: SkillRef
  toolId: string
  spec: BaselineSpec
  entries: readonly Record<string, string>[]
  exec?: Exec
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

const readOrNull = async (path: string): Promise<string | null> =>
  readFile(path, 'utf8').then(
    (text) => text,
    (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return null
      throw err
    },
  )

/** Written through a handle so the bytes are on the platter before the diff. */
async function writeSynced(path: string, text: string): Promise<void> {
  const handle = await open(path, 'w')
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncDir(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Resolves against the **live** skill directory, deliberately unlike §7's
 * conditional-argv stat, which resolves against the tool-facing path. A
 * repo-root skill's tool reads a materialised candidate copy (§4.4), so a write
 * resolved the tool's way would land in a temp directory and be discarded with
 * it. Same token, opposite answer, and it reads as a bug without this comment.
 */
const resolveBaselinePath = (skill: SkillRef, spec: BaselineSpec): string =>
  spec.path.replace(/\{(skillDir|repoRoot)\}/g, (_m, key: string) =>
    key === 'skillDir' ? skill.dir : skill.repo.path,
  )

/**
 * R10.12, first half: nothing the user's repo can see changes here. The staged
 * temp file is both what the diff is computed from and what the rename lands,
 * so the bytes reviewed are the bytes written rather than a second render that
 * could differ.
 */
export async function planSuppression(input: PlanInput): Promise<SuppressionPlan> {
  const { skill, spec, entries, toolId } = input
  const path = resolveBaselinePath(skill, spec)
  const label = relative(skill.repo.path, path)
  const current = await readOrNull(path)
  const preimage = current === null ? null : sha256(current)
  const { text, added, alreadyPresent } = appendEntries(current, spec, entries)
  const tempPath = join(skill.dir, WRITE_TEMP_NAME)

  if (added === 0) {
    return { toolId, path, label, preimage, tempPath, diff: '', added, alreadyPresent }
  }
  await writeSynced(tempPath, text)
  const diff = await unifiedDiffFor(current === null ? null : path, tempPath, label, input.exec ?? defaultExec)
  return { toolId, path, label, preimage, tempPath, diff, added, alreadyPresent }
}

/**
 * R10.12, second half. The recheck is R10.11's rule verbatim: a user editing
 * the baseline while the diff sat on screen would otherwise have that edit
 * silently overwritten. An absent preimage that now finds a file is drift too —
 * someone created the baseline under the preview.
 */
export async function applySuppression(plan: SuppressionPlan): Promise<void> {
  const current = await readOrNull(plan.path)
  const now = current === null ? null : sha256(current)
  if (now !== plan.preimage) {
    throw new Error(`preimage-drift: ${plan.label} changed since the diff was built`)
  }
  await rename(plan.tempPath, plan.path)
  await syncDir(dirname(plan.path))
}

export async function discardSuppression(plan: SuppressionPlan): Promise<void> {
  await rm(plan.tempPath, { force: true })
}
```

Re-export from `src/core/index.ts`:

```ts
export {
  applySuppression,
  discardSuppression,
  planSuppression,
  type PlanInput,
  type SuppressionPlan,
} from './suppress/write.js'
export { appendEntries, type AppendResult } from './suppress/document.js'
export { globEscape, skillRelative, suppressionEntry, type FindingVars } from './suppress/entry.js'
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/core/suppress-write.test.ts && pnpm lint`
Expected: PASS, 6 tests, and lint clean — `src/core/suppress/**` may use `node:fs`, but confirm no `console` slipped in.

- [ ] **Step 5: Commit**

```bash
git add src/core/suppress/write.ts src/core/index.ts tests/core/suppress-write.test.ts
git commit -m "feat (suppress): stage, diff, recheck and atomically rename a baseline write"
```

---

### Task 7: Resolving a request to the tools that can answer it

**Files:**
- Create: `src/core/suppress/target.ts`
- Modify: `src/core/ledger/issue-queries.ts`
- Modify: `src/core/index.ts`
- Create: `tests/core/suppress-target.test.ts`

**Interfaces:**
- Consumes: `suppressionEntry`, `skillRelative` (Task 3), `planSuppression` (Task 6), `getAdapter` from the registry.
- Produces:

```ts
/** What the two surfaces ask for. Resolved to `PreviewInput` by whoever can
    open the ledger — `src/cli/gantry-views.ts` for the TUI, the command for
    the CLI — because neither `src/core/suppress/**` nor `src/tui/**` may. */
export type SuppressionRequest =
  | { kind: 'issue'; skillId: string; fingerprint: string; reason: string }
  | {
      kind: 'finding'
      skillId: string
      toolId: string
      nativeRuleId: string
      relPath: string
      reason: string
    }

export interface DetectionRule { toolId: string; nativeRuleId: string; relPath: string }

export interface SuppressionPreview {
  plans: SuppressionPlan[]
  /** Detectors still reporting it whose tool declares no baseline. */
  uncovered: string[]
  reason: string
}

export function issueDetectionRules(db: DatabaseSync, fingerprint: string): DetectionRule[]
export function previewSuppression(input: PreviewInput): Promise<SuppressionPreview>
```

Tasks 8 and 10 both call `previewSuppression`; Task 10's port takes a `SuppressionRequest` and resolves it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/suppress-target.test.ts
import { describe, expect, it } from 'vitest'
import { previewSuppression } from '../../src/core/suppress/target.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import type { RepoRef, SkillRef } from '../../src/core/types.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'

const repoRef = (path: string): RepoRef => ({ id: 'fx', path, name: 'fx', isGit: false })
const fixture = async (): Promise<SkillRef> => {
  const root = await makeRepo({
    files: { 'declawed/SKILL.md': SKILL_MD('declawed'), 'declawed/scripts/scan.py': '# x\n' },
  })
  return (await discoverSkills(repoRef(root)))[0]!
}

describe('previewSuppression', () => {
  it('plans a write for a detector whose tool declares a baseline', async () => {
    const skill = await fixture()
    const preview = await previewSuppression({
      skill,
      reason: 'alignment whitespace',
      rules: [
        { toolId: 'skillspector', nativeRuleId: 'MP2', relPath: `${skill.relPath}/scripts/scan.py` },
      ],
      stillReporting: ['skillspector'],
    })
    expect(preview.plans).toHaveLength(1)
    expect(preview.plans[0]?.toolId).toBe('skillspector')
    expect(preview.plans[0]?.diff).toContain('path: scripts/scan.py')
    expect(preview.uncovered).toEqual([])
  })

  // §10.4's conjunction: skillspector's baseline cannot hide a finding
  // skill-scanner is still reporting plainly beside it, so the gate still fails.
  it('names a detector still reporting it that has no baseline', async () => {
    const skill = await fixture()
    const preview = await previewSuppression({
      skill,
      reason: 'alignment whitespace',
      rules: [
        { toolId: 'skillspector', nativeRuleId: 'MP2', relPath: `${skill.relPath}/scripts/scan.py` },
        { toolId: 'skill-scanner', nativeRuleId: 'SS-9', relPath: `${skill.relPath}/scripts/scan.py` },
      ],
      stillReporting: ['skillspector', 'skill-scanner'],
    })
    expect(preview.plans.map((plan) => plan.toolId)).toEqual(['skillspector'])
    expect(preview.uncovered).toEqual(['skill-scanner'])
  })

  // A detector that says gone has no vote in §10.4's conjunction, so it has
  // none here either — warning about it would be warning about nothing.
  it('ignores a baseline-less detector that is no longer reporting it', async () => {
    const skill = await fixture()
    const preview = await previewSuppression({
      skill,
      reason: 'r',
      rules: [
        { toolId: 'skillspector', nativeRuleId: 'MP2', relPath: `${skill.relPath}/a.md` },
        { toolId: 'skill-lint', nativeRuleId: 'SL-1', relPath: `${skill.relPath}/a.md` },
      ],
      stillReporting: ['skillspector'],
    })
    expect(preview.uncovered).toEqual([])
  })

  it('folds several rule ids for one tool into one plan', async () => {
    const skill = await fixture()
    const preview = await previewSuppression({
      skill,
      reason: 'r',
      rules: [
        { toolId: 'skillspector', nativeRuleId: 'MP2', relPath: `${skill.relPath}/a.md` },
        { toolId: 'skillspector', nativeRuleId: 'SSD-2', relPath: `${skill.relPath}/a.md` },
      ],
      stillReporting: ['skillspector'],
    })
    expect(preview.plans).toHaveLength(1)
    expect(preview.plans[0]?.added).toBe(2)
  })

  it('plans nothing when no detecting tool declares a baseline', async () => {
    const skill = await fixture()
    const preview = await previewSuppression({
      skill,
      reason: 'r',
      rules: [{ toolId: 'skill-scanner', nativeRuleId: 'SS-9', relPath: `${skill.relPath}/a.md` }],
      stillReporting: ['skill-scanner'],
    })
    expect(preview.plans).toEqual([])
    expect(preview.uncovered).toEqual(['skill-scanner'])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/core/suppress-target.test.ts`
Expected: FAIL — cannot resolve `../../src/core/suppress/target.js`.

- [ ] **Step 3: Write the ledger query**

In `src/core/ledger/issue-queries.ts`, beside `listIssues`:

```ts
export interface DetectionRule {
  toolId: string
  nativeRuleId: string
  relPath: string
}

/**
 * The native rule ids one issue was reported under, restricted to its
 * `last_seen_run`. All of history would add a rule for a rule id reported once
 * and not since — a suppression for a finding that no longer exists.
 */
export function issueDetectionRules(db: DatabaseSync, fingerprint: string): DetectionRule[] {
  const rows = db
    .prepare(
      `select distinct tr.tool_id as toolId, d.native_rule_id as nativeRuleId, i.rel_path as relPath
         from issue_detections d
         join tool_runs tr on tr.id = d.tool_run_id
         join stages s on s.id = tr.stage_id
         join issues i on i.fingerprint = d.issue_fp
        where d.issue_fp = ? and s.run_id = i.last_seen_run
        order by tr.tool_id, d.native_rule_id`,
    )
    .all(fingerprint) as DetectionRule[]
  return rows
}
```

- [ ] **Step 4: Write the target resolver**

```ts
// src/core/suppress/target.ts
import { getAdapter } from '../adapters/registry.js'
import type { SkillRef } from '../types.js'
import { skillRelative, suppressionEntry } from './entry.js'
import { planSuppression, type SuppressionPlan } from './write.js'
import type { DetectionRule } from '../ledger/issue-queries.js'

/**
 * What the two surfaces ask for, before anything has opened the ledger. Kept
 * here rather than in the TUI because the CLI asks the same question, and two
 * request shapes is how the two surfaces come to accept different things.
 */
export type SuppressionRequest =
  | { kind: 'issue'; skillId: string; fingerprint: string; reason: string }
  | {
      kind: 'finding'
      skillId: string
      toolId: string
      nativeRuleId: string
      relPath: string
      reason: string
    }

export interface SuppressionPreview {
  plans: SuppressionPlan[]
  /**
   * Detectors still reporting the issue whose tool declares no baseline.
   * §10.4 reads an issue suppressed only when every tool still reporting it
   * reports it suppressed, so one of these leaves the gate failing — which the
   * user has to be told before the write, not after the re-run.
   */
  uncovered: string[]
  reason: string
}

export interface PreviewInput {
  skill: SkillRef
  reason: string
  rules: readonly DetectionRule[]
  /** R8.8's blockers: the detectors that have not since reported it absent. */
  stillReporting: readonly string[]
}

export async function previewSuppression(input: PreviewInput): Promise<SuppressionPreview> {
  const { skill, reason, rules, stillReporting } = input
  if (reason.trim() === '') throw new Error('a suppression reason is required')

  const byTool = new Map<string, DetectionRule[]>()
  for (const rule of rules) {
    byTool.set(rule.toolId, [...(byTool.get(rule.toolId) ?? []), rule])
  }

  const plans: SuppressionPlan[] = []
  const uncovered: string[] = []
  for (const [toolId, toolRules] of [...byTool].sort(([a], [b]) => a.localeCompare(b))) {
    const spec = getAdapter(toolId)?.manifest.baseline
    if (spec === undefined) {
      if (stillReporting.includes(toolId)) uncovered.push(toolId)
      continue
    }
    const entries = toolRules.map((rule) =>
      suppressionEntry(spec, {
        nativeRuleId: rule.nativeRuleId,
        skillRelativePath: skillRelative(rule.relPath, skill.relPath),
        reason,
      }),
    )
    plans.push(await planSuppression({ skill, toolId, spec, entries }))
  }
  return { plans, uncovered, reason }
}
```

Re-export both from `src/core/index.ts`:

```ts
export {
  previewSuppression,
  type PreviewInput,
  type SuppressionPreview,
  type SuppressionRequest,
} from './suppress/target.js'
export { issueDetectionRules, type DetectionRule } from './ledger/issue-queries.js'
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/core/suppress-target.test.ts tests/core/issue-queries.test.ts`
Expected: PASS, both files.

- [ ] **Step 6: Commit**

```bash
git add src/core/suppress/target.ts src/core/ledger/issue-queries.ts src/core/index.ts tests/core/suppress-target.test.ts
git commit -m "feat (suppress): resolve an issue or finding to the tools that can accept it"
```

---

### Task 8: `skillgantry suppress`

**Files:**
- Create: `src/cli/suppress-command.ts`
- Modify: `src/cli/run-command.ts:247-260` (register beside `fix`)
- Create: `tests/cli/suppress-command.test.ts`

**Interfaces:**
- Consumes: `previewSuppression`, `applySuppression`, `discardSuppression`, `issueDetectionRules`, `selectSkill` from `src/cli/run-command.js`, `openLedger`.
- Produces: `runSuppress(deps: CliDeps, selector: string, options: SuppressOptions): Promise<number>` returning the exit code, matching how `runFix` is shaped.

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/suppress-command.test.ts
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildProgram } from '../../src/cli/run-command.js'
import { makeCliFixture } from '../helpers/tmp-repo.js'

describe('skillgantry suppress', () => {
  it('prints the diff and writes nothing without --yes', async () => {
    const { deps, skill, lines } = await makeCliFixture()
    const program = buildProgram(deps)
    await program.parseAsync(
      ['suppress', skill.id, '--tool', 'skillspector', '--rule', 'MP2',
       '--path', 'scripts/scan.py', '--reason', 'alignment whitespace'],
      { from: 'user' },
    )
    expect(lines.join('\n')).toContain('+  id: MP2')
    expect(program.exitCode).not.toBe(0)
    await expect(stat(join(skill.dir, '.skillspector-baseline.yaml'))).rejects.toThrow()
  })

  it('emits the diff immediately before the write with --yes', async () => {
    const { deps, skill, lines } = await makeCliFixture()
    const program = buildProgram(deps)
    await program.parseAsync(
      ['suppress', skill.id, '--tool', 'skillspector', '--rule', 'MP2',
       '--path', 'scripts/scan.py', '--reason', 'alignment whitespace', '--yes'],
      { from: 'user' },
    )
    expect(program.exitCode).toBe(0)
    const written = await readFile(join(skill.dir, '.skillspector-baseline.yaml'), 'utf8')
    expect(written).toContain('id: MP2')
    expect(lines.findIndex((line) => line.includes('+  id: MP2'))).toBeLessThan(
      lines.findIndex((line) => line.includes('.skillspector-baseline.yaml written')),
    )
  })

  // R12.7: the code tracks the write, not the skill. Reusing R12.2's meaning
  // would make a clean skill indistinguishable from a failed lookup.
  it('exits non-zero naming the tool when it declares no baseline', async () => {
    const { deps, skill, lines } = await makeCliFixture()
    const program = buildProgram(deps)
    await program.parseAsync(
      ['suppress', skill.id, '--tool', 'skill-scanner', '--rule', 'SS-9',
       '--path', 'SKILL.md', '--reason', 'r', '--yes'],
      { from: 'user' },
    )
    expect(program.exitCode).not.toBe(0)
    expect(lines.join('\n')).toContain('skill-scanner declares no baseline')
  })

  it('refuses an empty reason', async () => {
    const { deps, skill, lines } = await makeCliFixture()
    const program = buildProgram(deps)
    await program.parseAsync(
      ['suppress', skill.id, '--tool', 'skillspector', '--rule', 'MP2',
       '--path', 'scripts/scan.py', '--reason', '   ', '--yes'],
      { from: 'user' },
    )
    expect(program.exitCode).not.toBe(0)
    expect(lines.join('\n')).toContain('reason is required')
  })

  it('reports an entry already present and exits non-zero', async () => {
    const { deps, skill, lines } = await makeCliFixture()
    await writeFile(
      join(skill.dir, '.skillspector-baseline.yaml'),
      'version: 2\nrules:\n  - id: MP2\n    path: scripts/scan.py\n    reason: r\n',
    )
    const program = buildProgram(deps)
    await program.parseAsync(
      ['suppress', skill.id, '--tool', 'skillspector', '--rule', 'MP2',
       '--path', 'scripts/scan.py', '--reason', 'r', '--yes'],
      { from: 'user' },
    )
    expect(program.exitCode).not.toBe(0)
    expect(lines.join('\n')).toContain('already suppressed')
  })

  it('emits one json document with --json', async () => {
    const { deps, skill, lines } = await makeCliFixture()
    const program = buildProgram(deps)
    await program.parseAsync(
      ['suppress', skill.id, '--tool', 'skillspector', '--rule', 'MP2',
       '--path', 'scripts/scan.py', '--reason', 'r', '--yes', '--json'],
      { from: 'user' },
    )
    const doc = JSON.parse(lines.join('\n')) as { written: string[]; uncovered: string[] }
    expect(doc.written).toEqual([join(skill.dir, '.skillspector-baseline.yaml')])
    expect(doc.uncovered).toEqual([])
  })
})
```

`makeCliFixture()` must give a `CliDeps` whose `write` collects into `lines`, a registered repo, and a skill. Read `tests/cli/fix-command.test.ts` and reuse whatever setup it already has rather than adding a helper — if that file builds its fixture inline, build this one the same way.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/cli/suppress-command.test.ts`
Expected: FAIL — `error: unknown command 'suppress'`.

- [ ] **Step 3: Write the command**

```ts
// src/cli/suppress-command.ts
import {
  applySuppression,
  discardSuppression,
  issueDetectionRules,
  listIssues,
  openLedger,
  previewSuppression,
  type DetectionRule,
} from '../core/index.js'
import { selectSkill, type CliDeps } from './run-command.js'

export interface SuppressOptions {
  tool?: string
  rule?: string
  path?: string
  fingerprint?: string
  reason?: string
  yes?: boolean
  json?: boolean
}

/**
 * R12.7. The exit code reports whether a suppression was written, never
 * whether the skill passes: R12.2 already binds `run`'s code to stage
 * outcomes, and reusing that meaning here would make a clean skill
 * indistinguishable from a failed lookup.
 */
export async function runSuppress(
  deps: CliDeps,
  selector: string,
  options: SuppressOptions,
): Promise<number> {
  const reason = (options.reason ?? '').trim()
  if (reason === '') {
    deps.write('a suppression reason is required')
    return 2
  }

  const { skill } = await selectSkill(deps.home, selector)

  let rules: DetectionRule[]
  let stillReporting: string[]
  if (options.fingerprint !== undefined) {
    const ledger = openLedger(deps.dbPath)
    try {
      rules = issueDetectionRules(ledger.db, options.fingerprint)
      const row = listIssues(ledger.db, { skillId: skill.id }).find(
        (issue) => issue.fingerprint === options.fingerprint,
      )
      if (row === undefined) {
        deps.write(`no issue ${options.fingerprint} recorded for ${skill.id}`)
        return 2
      }
      stillReporting = row.blockedBy
    } finally {
      ledger.close()
    }
  } else {
    if (options.tool === undefined || options.rule === undefined || options.path === undefined) {
      deps.write('supply --fingerprint, or all of --tool, --rule and --path')
      return 2
    }
    rules = [{ toolId: options.tool, nativeRuleId: options.rule, relPath: options.path }]
    stillReporting = [options.tool]
  }

  const preview = await previewSuppression({ skill, reason, rules, stillReporting })

  if (preview.plans.length === 0) {
    for (const toolId of preview.uncovered) deps.write(`${toolId} declares no baseline`)
    if (preview.uncovered.length === 0) deps.write('no detecting tool declares a baseline')
    return 3
  }
  if (preview.plans.every((plan) => plan.added === 0)) {
    for (const plan of preview.plans) await discardSuppression(plan)
    deps.write(`already suppressed in ${preview.plans.map((plan) => plan.label).join(', ')}`)
    return 4
  }

  // R12.4's rule: the diff is emitted to output immediately before the write.
  for (const plan of preview.plans) deps.write(plan.diff)
  for (const toolId of preview.uncovered) {
    deps.write(`${toolId} also reports this and declares no baseline — the gate will still fail`)
  }

  if (options.yes !== true) {
    for (const plan of preview.plans) await discardSuppression(plan)
    deps.write('nothing written; pass --yes to authorise the write')
    return 5
  }

  const written: string[] = []
  for (const plan of preview.plans) {
    await applySuppression(plan)
    written.push(plan.path)
  }
  if (options.json === true) {
    deps.write(JSON.stringify({ written, uncovered: preview.uncovered, reason }, null, 2))
  } else {
    for (const path of written) deps.write(`${path} written`)
  }
  return 0
}
```

For `--json`, the earlier `deps.write(plan.diff)` calls would break the single document. Guard them: wrap the diff and warning writes in `if (options.json !== true)`, and put the diff into the JSON document as a `diff` key instead. Apply that guard before running the tests.

- [ ] **Step 4: Register it**

In `src/cli/run-command.ts`, after the `fix` registration:

```ts
  program
    .command('suppress')
    .description("record a finding in its tool's own suppression file")
    .argument('<skill>', 'skill id or unambiguous name')
    .option('--tool <id>', 'the detecting tool')
    .option('--rule <nativeRuleId>', 'the tool\'s own rule id')
    .option('--path <skillRelPath>', 'skill-relative path the finding is in')
    .option('--fingerprint <fp>', 'an issue fingerprint, resolved from the ledger')
    .option('--reason <text>', 'why the finding is accepted; required and non-empty')
    .option('--yes', 'prior authorisation for the write')
    .option('--json', 'emit one JSON document')
    .action(async (skill: string, options: SuppressOptions) => {
      program.exitCode = await runSuppress(deps, skill, options)
    })
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/cli/suppress-command.test.ts tests/cli/run-command.test.ts`
Expected: PASS, both files.

- [ ] **Step 6: Commit**

```bash
git add src/cli/suppress-command.ts src/cli/run-command.ts tests/cli/suppress-command.test.ts
git commit -m "feat (cli): add skillgantry suppress"
```

---

### Task 9: `DiffBody` and `SuppressPane`

**Files:**
- Create: `src/tui/components/DiffBody.tsx`
- Modify: `src/tui/components/ReviewPane.tsx`
- Create: `src/tui/components/SuppressPane.tsx`
- Create: `tests/tui/suppress-pane.test.tsx`

**Interfaces:**
- Consumes: `Layout` and `innerWidth` from `src/tui/layout.js`, `Panel`.
- Produces: `DiffBody({ diff, offset, height, width, chrome })`, and `SuppressPane({ suppress, layout })` where `suppress` is the store slot Task 10 defines. Task 10 renders `SuppressPane`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/tui/suppress-pane.test.tsx
import { describe, expect, it } from 'vitest'
import { SuppressPane } from '../../src/tui/components/SuppressPane.js'
import { layoutFor } from '../../src/tui/layout.js'
import { renderInk } from '../helpers/render-ink.js'

const slot = {
  label: 'declawed/.skillspector-baseline.yaml',
  toolId: 'skillspector',
  relPath: 'declawed/scripts/scan.py',
  diff: '@@ -3,2 +3,6 @@\n rules:\n+- id: MP2\n+  path: scripts/scan.py\n',
  offset: 0,
  reason: 'alignment whitespace',
  editingReason: false,
  uncovered: [] as string[],
  thenRun: 'resume' as const,
  stages: ['validate', 'security'] as const,
  error: null,
}

describe('SuppressPane', () => {
  it('names the tool and the file in its title', () => {
    const { lastFrame } = renderInk(<SuppressPane suppress={slot} layout={layoutFor(80, 24)} />)
    expect(lastFrame()).toContain('skillspector')
    expect(lastFrame()).toContain('.skillspector-baseline.yaml')
  })

  it('renders the diff and the reason row', () => {
    const { lastFrame } = renderInk(<SuppressPane suppress={slot} layout={layoutFor(80, 24)} />)
    expect(lastFrame()).toContain('id: MP2')
    expect(lastFrame()).toContain('alignment whitespace')
  })

  it('names an uncovered detector only when there is one', () => {
    const clean = renderInk(<SuppressPane suppress={slot} layout={layoutFor(80, 24)} />)
    expect(clean.lastFrame()).not.toContain('declares no baseline')
    const dirty = renderInk(
      <SuppressPane suppress={{ ...slot, uncovered: ['skill-scanner'] }} layout={layoutFor(80, 24)} />,
    )
    expect(dirty.lastFrame()).toContain('skill-scanner')
    expect(dirty.lastFrame()).toContain('declares no baseline')
  })

  // R11.17. Resolved and not the toggle's label: "resume" already covers all
  // three gates when validate is the failure, and the warning would then lie.
  it('warns about stale gates only when the resolved set misses one', () => {
    const partial = renderInk(<SuppressPane suppress={slot} layout={layoutFor(80, 24)} />)
    expect(partial.lastFrame()).toContain('previous bytes')
    const full = renderInk(
      <SuppressPane
        suppress={{ ...slot, stages: ['validate', 'evaluate', 'security'] as const }}
        layout={layoutFor(80, 24)}
      />,
    )
    expect(full.lastFrame()).not.toContain('previous bytes')
  })

  it('stays inside the terminal at the 50x14 floor', () => {
    const { lastFrame } = renderInk(<SuppressPane suppress={slot} layout={layoutFor(50, 14)} />, {
      columns: 50,
      rows: 14,
    })
    expect(lastFrame().split('\n').length).toBeLessThanOrEqual(14)
  })
})
```

`renderInk` returns an `InkHarness` whose frame comes from `lastFrame()`, and takes `{ columns, rows }` as its second argument — the 50x14 case must pass both, or the harness renders at its 100x30 default and the assertion tests nothing.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/tui/suppress-pane.test.tsx`
Expected: FAIL — cannot resolve `SuppressPane.js`.

- [ ] **Step 3: Extract `DiffBody` from `ReviewPane`**

Move `ReviewPane`'s `colour()` helper and its diff-line map into `src/tui/components/DiffBody.tsx`:

```tsx
// src/tui/components/DiffBody.tsx
import { Text } from 'ink'
import { truncate } from '../layout.js'
import { ACCENT, STATUS } from '../tokens.js'

/**
 * Diff gutters through the shared vocabulary rather than the three ANSI names
 * a diff conventionally uses: these are the panes whose `a` writes the user's
 * repo, so an added line reading green in whatever the terminal profile calls
 * green — beside a rail rendering `passed` as `#00c853` — is exactly where a
 * colour has to mean what it means everywhere else. One renderer for both
 * panes, because two is the divergence `tokens.ts` records from when five
 * modules each owned severity colour.
 */
const colour = (line: string): string | undefined =>
  line.startsWith('+')
    ? STATUS.ok
    : line.startsWith('-')
      ? STATUS.bad
      : line.startsWith('@@')
        ? ACCENT
        : undefined

export function DiffBody({
  diff,
  offset,
  height,
  width,
}: {
  diff: string
  offset: number
  height: number
  width: number
}): React.ReactElement[] {
  const lines = diff.split('\n')
  // Clamped so the last window is a full one: clamping to the last line left a
  // single diff line on screen at the bottom of a long diff.
  const start = Math.min(offset, Math.max(0, lines.length - height))
  return lines.slice(start, start + height).map((line, index) => (
    <Text key={`${start + index}`} wrap="truncate" color={colour(line)}>
      {truncate(line, width)}
    </Text>
  ))
}
```

Rewrite `ReviewPane`'s body to call `DiffBody` with the values it already computes. Its own tests must stay green untouched — that is the check that the extraction changed nothing.

- [ ] **Step 4: Declare the slot type**

`SuppressPane` imports `SuppressSlot` from the store, so the type lands here rather than with the state field in Task 11 — a component that cannot compile without a later task's edit is not an independently testable deliverable. In `src/tui/store.ts`, beside `PendingReview`:

```ts
/**
 * R11.16's confirmation, held the way `PendingReview` is: one bounded document
 * in state, unlike log text, because R11.4 is about a stream that never stops.
 * `request` survives the editing step — the preview cannot be staged until the
 * reason is committed, and the reason is part of the entry.
 */
export interface SuppressSlot {
  request: SuppressionRequest
  label: string
  toolId: string
  relPath: string
  diff: string
  offset: number
  reason: string
  editingReason: boolean
  uncovered: string[]
  thenRun: 'resume' | 'gates' | 'none'
  /** The gate chain `resume` enqueues, from `resumedGates`. */
  stages: readonly Stage[]
  error: string | null
}
```

`AppState.suppress` and the actions are Task 11's; this step adds the type alone.

- [ ] **Step 5: Write `SuppressPane`**

```tsx
// src/tui/components/SuppressPane.tsx
import { Box, Text } from 'ink'
import { innerWidth, reviewDiffRows, truncate, truncateMiddle, type Layout } from '../layout.js'
import type { SuppressSlot } from '../store.js'
import { STATUS } from '../tokens.js'
import { DiffBody } from './DiffBody.js'
import { Panel } from './Panel.js'
import { StatusBar } from './StatusBar.js'

const HINTS = 'a apply · d discard · t then-run · j/k scroll · esc cancel'

const GATES = ['validate', 'evaluate', 'security'] as const

export function SuppressPane({
  suppress,
  layout,
}: {
  suppress: SuppressSlot
  layout: Layout
}): React.ReactElement {
  const cols = Math.max(8, innerWidth(layout.columns, layout.chrome))
  // Every footnote is counted *against* the allocation, never appended below
  // it — §14.1's first rule, learned from the row that pushed the queue panel
  // off an 80x24.
  const footnotes =
    1 + (suppress.uncovered.length > 0 ? 1 : 0) + 1 + (suppress.stages.length < GATES.length ? 1 : 0)
  const height = Math.max(1, reviewDiffRows(layout) - footnotes)

  return (
    <Box flexDirection="column" width={layout.columns}>
      <Panel
        title={`Suppress — ${suppress.toolId} · ${truncateMiddle(suppress.relPath, Math.max(12, cols - 16))}`}
        focused
        chrome={layout.chrome}
        width={layout.columns}
      >
        {DiffBody({ diff: suppress.diff, offset: suppress.offset, height, width: cols })}
        <Text wrap="truncate" inverse={suppress.editingReason}>
          {truncate(`reason ${suppress.reason}`, cols)}
        </Text>
        {suppress.uncovered.length > 0 && (
          <Text color={STATUS.warn} wrap="truncate">
            {truncate(
              `also reported by ${suppress.uncovered.join(', ')}, which declares no baseline — the gate will still fail`,
              cols,
            )}
          </Text>
        )}
        <Text dimColor wrap="truncate">
          {truncate(
            suppress.thenRun === 'none'
              ? 'then run: nothing · t cycles'
              : `then run: ${suppress.stages.join(', ')} · t cycles`,
            cols,
          )}
        </Text>
        {suppress.stages.length < GATES.length && (
          <Text dimColor wrap="truncate">
            {truncate('recorded gates passed against the previous bytes', cols)}
          </Text>
        )}
      </Panel>
      <StatusBar hints={suppress.error ?? HINTS} columns={layout.columns} />
    </Box>
  )
}
```

`STATUS.warn` must be the existing errored/degraded token — check `src/tui/tokens.ts` for its real name and use that. Do not add a token.

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run tests/tui/suppress-pane.test.tsx tests/tui/review-pane.test.tsx`
Expected: PASS, both files. `review-pane.test.tsx` passing unchanged is the proof the extraction was behaviour-preserving.

- [ ] **Step 7: Commit**

```bash
git add src/tui/store.ts src/tui/components/DiffBody.tsx src/tui/components/ReviewPane.tsx src/tui/components/SuppressPane.tsx tests/tui/suppress-pane.test.tsx
git commit -m "feat (tui): add the suppression confirmation pane"
```

---

### Task 10: Resolving which gates the write invalidated

**Files:**
- Modify: `src/tui/rows.ts`
- Create: `tests/tui/suppress-rerun.test.ts`

**Interfaces:**
- Consumes: `GATE_STAGES` from core, `StageCell` from `src/tui/store.js`.
- Produces: `resumedGates(cells: readonly StageCell[]): Stage[]` in `rows.ts`. Task 11's preview effect and its `a` handler both call it.

Pure and ahead of the keys, because Task 11's effect needs it to fill the slot's `stages` — a resolver written afterwards would leave that task unable to compile on its own.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tui/suppress-rerun.test.ts
import { describe, expect, it } from 'vitest'
import { resumedGates } from '../../src/tui/rows.js'
import type { StageCell } from '../../src/tui/store.js'

const cell = (outcome: StageCell['outcome']): StageCell => ({
  outcome,
  running: false,
  summary: '',
  findings: 0,
})

// validate, evaluate, security, optimise, release — the rail's own order.
const rail = (...gates: StageCell['outcome'][]): StageCell[] => [
  ...gates.map(cell),
  cell(null),
  cell(null),
]

describe('resumedGates', () => {
  // R5.1 halts on the first non-passed stage, so enqueueing the failed one
  // alone makes the user press r again.
  it('resumes from the first non-passing gate through security', () => {
    expect(resumedGates(rail('passed', 'passed', 'failed'))).toEqual(['security'])
    expect(resumedGates(rail('failed', null, null))).toEqual([
      'validate',
      'evaluate',
      'security',
    ])
    expect(resumedGates(rail('passed', 'failed', null))).toEqual(['evaluate', 'security'])
  })

  it('treats a stage that never ran as non-passing', () => {
    expect(resumedGates(rail(null, null, null))).toEqual(['validate', 'evaluate', 'security'])
  })

  it('resolves to nothing when every gate passed', () => {
    expect(resumedGates(rail('passed', 'passed', 'passed'))).toEqual([])
  })

  it('treats a degraded or errored gate as non-passing', () => {
    expect(resumedGates(rail('passed', 'degraded', 'passed'))).toEqual([
      'evaluate',
      'security',
    ])
  })
})
```

`StageCell`'s real shape is at `src/tui/store.ts:91`. Read it and match the fields exactly — the sketch above may be missing one.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/tui/suppress-rerun.test.ts`
Expected: FAIL — `resumedGates` is not exported from `rows.ts`.

- [ ] **Step 3: Write the resolver**

```ts
// src/tui/rows.ts — beside the other pure row builders
import { GATE_STAGES } from '../core/index.js'

/**
 * R11.17. The contiguous chain from the earliest non-passing gate through
 * security, not the literal set of failed stages: R5.1 halts the chain, so a
 * validate failure leaves evaluate and security at `·`, and enqueueing
 * validate alone makes the user press `r` again. Empty when all three passed,
 * which is what makes the pane start the toggle on `every gate` there — every
 * one of those runs was still recorded against the pre-write digest.
 */
export function resumedGates(cells: readonly StageCell[]): Stage[] {
  const first = GATE_STAGES.findIndex(
    (_stage, index) => cells[index]?.outcome !== 'passed',
  )
  return first === -1 ? [] : [...GATE_STAGES.slice(first)]
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/tui/suppress-rerun.test.ts tests/tui/rows.test.ts`
Expected: PASS, both files.

- [ ] **Step 5: Commit**

```bash
git add src/tui/rows.ts tests/tui/suppress-rerun.test.ts
git commit -m "feat (tui): resolve the gate chain a suppression invalidates"
```

---

### Task 11: `s` on both surfaces, and the enqueue

**Files:**
- Modify: `src/tui/store.ts`
- Modify: `src/tui/views.ts`
- Modify: `src/cli/gantry-views.ts`
- Modify: `src/tui/app.tsx`
- Modify: `tests/helpers/fake-views.ts`
- Create: `tests/tui/suppress-key.test.tsx`

**Interfaces:**
- Consumes: `SuppressSlot` and `SuppressPane` (Task 9), `resumedGates` (Task 10), `previewSuppression` / `applySuppression` / `discardSuppression` (Tasks 6–7).
- Produces: `AppState.suppress: SuppressSlot | null` over the interface Task 9 declared, its eight actions, and three `GantryViews` methods.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/tui/suppress-key.test.tsx
import { describe, expect, it } from 'vitest'
import { reducer, initialState } from '../../src/tui/store.js'

describe('R11.16 suppression slot', () => {
  it('opens with the reason editor active and the prefill in the buffer', () => {
    const state = reducer(initialState([], 2), {
      type: 'begin-suppress',
      toolId: 'skillspector',
      relPath: 'declawed/scripts/scan.py',
      reason: 'Accepted 2026-08-09 via SkillGantry',
    })
    expect(state.suppress?.editingReason).toBe(true)
    expect(state.suppress?.reason).toBe('Accepted 2026-08-09 via SkillGantry')
  })

  it('refuses to leave the editor with an empty reason', () => {
    let state = reducer(initialState([], 2), {
      type: 'begin-suppress',
      toolId: 'skillspector',
      relPath: 'a.md',
      reason: '',
    })
    state = reducer(state, { type: 'suppress-reason', reason: '   ' })
    state = reducer(state, { type: 'commit-suppress-reason' })
    expect(state.suppress?.editingReason).toBe(true)
    expect(state.suppress?.error).toContain('reason is required')
  })

  it('cycles the then-run toggle and comes back round', () => {
    let state = reducer(initialState([], 2), {
      type: 'begin-suppress',
      toolId: 'skillspector',
      relPath: 'a.md',
      reason: 'r',
    })
    expect(state.suppress?.thenRun).toBe('resume')
    state = reducer(state, { type: 'cycle-then-run' })
    expect(state.suppress?.thenRun).toBe('gates')
    state = reducer(state, { type: 'cycle-then-run' })
    expect(state.suppress?.thenRun).toBe('none')
    state = reducer(state, { type: 'cycle-then-run' })
    expect(state.suppress?.thenRun).toBe('resume')
  })

  it('clears the slot on cancel', () => {
    let state = reducer(initialState([], 2), {
      type: 'begin-suppress',
      toolId: 'skillspector',
      relPath: 'a.md',
      reason: 'r',
    })
    state = reducer(state, { type: 'end-suppress' })
    expect(state.suppress).toBeNull()
  })
})
```

Read `tests/tui/store.test.ts` first: `initialState` may take a different argument list. Match the call it already makes.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/tui/suppress-key.test.tsx`
Expected: FAIL — `begin-suppress` is not an `Action`.

- [ ] **Step 3: Add the slot, the actions and the reducer cases**

Add `SuppressSlot` and `suppress: SuppressSlot | null` to `AppState` (initialised `null`), plus these `Action` members:

```ts
  | { type: 'begin-suppress'; toolId: string; relPath: string; reason: string }
  | { type: 'suppress-preview'; label: string; diff: string; uncovered: string[]; stages: readonly Stage[] }
  | { type: 'suppress-reason'; reason: string }
  | { type: 'commit-suppress-reason' }
  | { type: 'cycle-then-run' }
  | { type: 'scroll-suppress'; delta: number }
  | { type: 'suppress-error'; message: string }
  | { type: 'end-suppress' }
```

`begin-suppress` opens the slot with `editingReason: true`, `thenRun: 'resume'`, `offset: 0`, `diff: ''`, `stages: []`, `error: null`, and the `SuppressionRequest` stored on the slot. `commit-suppress-reason` refuses a blank reason by setting `error` and leaving `editingReason` true; otherwise it clears both. `cycle-then-run` walks `resume → gates → none → resume`. Every case returns the state unchanged when `state.suppress` is null.

The editor mirrors §14.2's `begin-edit` / `edit-input` / `stage-edit` / `cancel-edit` **shape** rather than reusing those actions: `begin-edit` is typed to `ScalarField`, which is the config document's vocabulary, and widening it to carry a suppression reason would put two unrelated editors behind one action. The shape is what is reused — buffer in state, refusal on commit, no per-keystroke write — because that is the part the user learns. Unlike the config editor, the buffer is **seeded** with the prefill and the first keystroke appends to it, which is what a prefill is for.

- [ ] **Step 4: Add the port methods**

In `src/tui/views.ts`, on `GantryViews`:

```ts
  /**
   * Stages the bytes and returns the diff. Nothing has reached the baseline
   * yet — R10.12 puts the write behind a displayed diff, and this is the half
   * that runs before the user has seen one.
   */
  planSuppression(request: SuppressionRequest): Promise<SuppressionPreviewView>
  /** Rechecks the preimage and renames. Rejects with `preimage-drift` on drift. */
  applySuppression(): Promise<void>
  /** Removes the staged temp file. Safe to call when nothing is staged. */
  discardSuppression(): Promise<void>
```

The port holds the staged plans between the two calls, so `SuppressionPlan` never enters React state — it carries absolute paths and a preimage hash, neither of which a component renders. `SuppressionPreviewView` is `{ label: string; diff: string; uncovered: string[]; alreadyPresent: boolean }` — deliberately not `SuppressionPlan`, which carries absolute paths and a preimage hash that no component renders and React state has no business holding.

Implement all three in `src/cli/gantry-views.ts` over `previewSuppression`, `applySuppression` and `discardSuppression`, resolving the skill through `discoverAll(await loadConfig(deps.home))` and the issue's `blockedBy` through `listIssues`. Add the same three to `tests/helpers/fake-views.ts` as recording stubs.

- [ ] **Step 5: Bind `s` on both surfaces**

In `src/tui/app.tsx`, in the Issues-screen branch beside `a`/`w`/`o`:

```ts
      else if (plain && input === 's') {
        const row = state.issues[state.selectedIssue]
        if (row !== undefined) {
          dispatch({
            type: 'begin-suppress',
            toolId: row.detectors.join(', '),
            relPath: row.relPath,
            reason: `Accepted ${new Date().toISOString().slice(0, 10)} via SkillGantry`,
          })
        }
      }
```

And on the Work screen, guarded to the Findings pane exactly the way `o` at `app.tsx:598` is, reaching the row through the same expression it uses:

```ts
    if (plain && input === 's' && state.panel === 'findings' && state.focus === 'work') {
      const chosen = current?.findings[state.selectedFinding]
      if (!chosen) {
        dispatch({ type: 'flash', message: 'no finding selected' })
        return
      }
      dispatch({
        type: 'begin-suppress',
        request: {
          kind: 'finding',
          skillId: current.skillId,
          toolId: chosen.toolId,
          nativeRuleId: chosen.finding.nativeRuleId,
          relPath: chosen.finding.path,
          reason: '',
        },
        relPath: chosen.finding.path,
        toolId: chosen.toolId,
        reason: `Accepted ${new Date().toISOString().slice(0, 10)} via SkillGantry`,
      })
      return
    }
```

`begin-suppress` therefore carries the `SuppressionRequest` alongside the display fields, and the slot holds it: the preview cannot be requested until the reason is committed, so the request has to survive the editing step.

Add the modal branch, **second** in the precedence chain — after `state.pending`, before `state.confirm`:

```ts
  if (state.suppress) return <SuppressPane suppress={state.suppress} layout={layout} />
```

and its key handler above the Work-screen gate, so `a`, `d`, `t`, `j`, `k` and `esc` reach the pane while it is open.

- [ ] **Step 6: Request the preview when the reason is committed**

Nothing has staged bytes yet — `begin-suppress` only opened the editor. The preview fires on the transition out of it, in an effect keyed on the slot's request and `editingReason`:

```tsx
  // Keyed on `editingReason` going false rather than run on `begin-suppress`,
  // because the reason is part of the entry: previewing before it is committed
  // would stage a diff with the prefill in it and then have to redo the write.
  useEffect(() => {
    const slot = state.suppress
    if (!slot || slot.editingReason || slot.diff !== '') return
    void views
      .planSuppression({ ...slot.request, reason: slot.reason })
      .then((preview) => {
        if (preview.alreadyPresent) {
          dispatch({ type: 'suppress-error', message: `already suppressed in ${preview.label}` })
          return
        }
        dispatch({
          type: 'suppress-preview',
          label: preview.label,
          diff: preview.diff,
          uncovered: preview.uncovered,
          stages: resumedGates(current?.stages ?? []),
        })
      })
      .catch((err: unknown) =>
        dispatch({ type: 'suppress-error', message: (err as Error).message }),
      )
  }, [state.suppress?.request, state.suppress?.editingReason])
```

`suppress-preview` sets `thenRun` to `'gates'` when `stages` is empty, since every gate then passed against the pre-write digest and `resume` would enqueue nothing. A preview whose `plans` are empty resolves to a `suppress-error` naming the uncovered tools — `views.planSuppression` reports that case rather than returning an empty diff, so the pane never renders with nothing to confirm.

- [ ] **Step 7: Apply, and enqueue what the toggle asks for**

In the `SuppressPane` key handler from Task 10, on `a`:

```ts
      if (plain && input === 'a') {
        const slot = state.suppress
        if (!slot || slot.editingReason) return
        void views
          .applySuppression()
          .then(() => {
            const stages =
              slot.thenRun === 'gates'
                ? [...GATE_STAGES]
                : slot.thenRun === 'resume'
                  ? slot.stages
                  : []
            if (stages.length > 0 && current) {
              queue.enqueue([{ skill: byId.current.get(current.skillId)!, stages }])
            }
            dispatch({ type: 'end-suppress' })
            // R8.15: the file is the authority and the ledger a cache
            // recomputed on conclusive tool runs, so the ⊘ mark appears only
            // after the re-run. Without this line the user applies, sees the
            // Issues screen unchanged, and concludes nothing happened.
            flash(`${slot.label} written · the mark appears after the re-run`, 'good')
          })
          .catch((err: unknown) => dispatch({ type: 'suppress-error', message: (err as Error).message }))
        return
      }
```

Replace the non-null assertion with whatever the existing `r` handler at `app.tsx:666-673` uses to turn a skill id into a `SkillRef` — it already does this safely and lint may reject `!`.

`d` calls `views.discardSuppression()` then dispatches `end-suppress`. `t` dispatches `cycle-then-run`. `j`/`k` dispatch `scroll-suppress`. `esc` behaves as `d`.

When the preview resolves, dispatch `suppress-preview` with `stages: resumedGates(current.stages)`, and set `thenRun` to `'gates'` when that array is empty.

- [ ] **Step 8: Run the tests**

Run: `pnpm vitest run tests/tui/ tests/cli/gantry-views.test.ts`
Expected: PASS, whole directory. A failure in `focus-zones.test.tsx` or `issues.test.tsx` means `s` leaked into a zone it does not belong to.

- [ ] **Step 9: Commit**

```bash
git add src/tui src/cli/gantry-views.ts tests/tui/suppress-key.test.tsx tests/helpers/fake-views.ts
git commit -m "feat (tui): accept a finding with s, and re-run the gates it invalidated"
```

---

### Task 12: The acceptance test — the flow, on a fake tool

`tests/acceptance/m6-baseline.test.ts` is the model: a fake tool whose script branches on whether SkillGantry passed `--baseline`, which is what makes the run end to end rather than two fixtures. This task proves the same for the write half — fail, accept, re-run, pass, and the ledger agreeing.

It does **not** prove the glob matches; a shell fixture does not implement fnmatch. Task 13 is that proof.

**Files:**
- Create: `tests/acceptance/m8.test.ts`

**Interfaces:**
- Consumes: `buildProgram`, `registerRepo`, `saveToolLock`, `openLedger`, `makeFakeTool`, `makeRepo`, `SKILL_MD`.
- Produces: nothing.

- [ ] **Step 1: Write the test**

Copy `tests/acceptance/m6-baseline.test.ts`'s fixture setup verbatim — its `sarif(suppressed)` builder, its `SCRIPT` branching on `$8`/`$9`, its `registerRepo` and `saveToolLock` calls — and change only what follows. The one adjustment: its `SCRIPT` tests `-f "$9"`, which is true for any baseline file; here the file starts absent, so the branch is exercised by the suppression creating it.

```ts
// tests/acceptance/m8.test.ts — after the copied fixture setup
describe('M8 suppression round trip', () => {
  it('fails, accepts the finding, and passes on the re-run', async () => {
    const { deps, skill, lines } = await fixture()   // the copied setup

    // 1. The gate fails on MP2 and the ledger files one open issue.
    let program = buildProgram(deps)
    await program.parseAsync(['run', skill.id, '--stage', 'security'], { from: 'user' })
    expect(program.exitCode).not.toBe(0)

    const ledger = openLedger(deps.dbPath)
    const before = listIssues(ledger.db, { skillId: skill.id })
    expect(before).toHaveLength(1)
    expect(before[0]?.state).toBe('open')
    expect(before[0]?.suppressed).toBe(false)
    const fingerprint = before[0]!.fingerprint
    const firstSeen = before[0]!.lastSeenRun
    ledger.close()

    // 2. Accept it. The baseline did not exist, so this creates it.
    program = buildProgram(deps)
    await program.parseAsync(
      ['suppress', skill.id, '--fingerprint', fingerprint,
       '--reason', 'alignment whitespace, not padding', '--yes'],
      { from: 'user' },
    )
    expect(program.exitCode).toBe(0)
    const baseline = await readFile(join(skill.dir, '.skillspector-baseline.yaml'), 'utf8')
    expect(baseline).toContain('id: MP2')
    expect(baseline).toContain('path: scripts/scan.py')

    // 3. The re-run passes, and the finding is still reported — R4.15 makes it
    //    annotated, never dropped, which is what keeps the issue's history.
    program = buildProgram(deps)
    await program.parseAsync(['run', skill.id, '--stage', 'security'], { from: 'user' })
    expect(program.exitCode).toBe(0)

    // 4. R8.15: suppressed, still open, history intact, absent from the counts.
    const after = openLedger(deps.dbPath)
    const row = listIssues(after.db, { skillId: skill.id })[0]
    expect(row?.suppressed).toBe(true)
    expect(row?.state).toBe('open')
    expect(row?.fingerprint).toBe(fingerprint)
    expect(row?.lastSeenRun).not.toBe(firstSeen)
    expect(row?.suppressionReason).toContain('alignment whitespace')
    expect(openIssueCounts(after.db, { skillId: skill.id }).suppressed).toBe(1)
    after.close()

    // 5. Delete the entry and the finding comes back — the file is the
    //    authority, so removing the rule un-suppresses on the next run.
    await writeFile(join(skill.dir, '.skillspector-baseline.yaml'), 'version: 2\nrules: []\n')
    program = buildProgram(deps)
    await program.parseAsync(['run', skill.id, '--stage', 'security'], { from: 'user' })
    expect(program.exitCode).not.toBe(0)
    const final = openLedger(deps.dbPath)
    expect(listIssues(final.db, { skillId: skill.id })[0]?.suppressed).toBe(false)
    final.close()
  })
})
```

`openIssueCounts`'s real return shape is in `src/core/ledger/stats.ts` — read it and assert against the field it actually exposes rather than the `.suppressed` guessed above.

- [ ] **Step 2: Run it**

Run: `SG_ACCEPTANCE=1 pnpm vitest run tests/acceptance/m8.test.ts`
Expected: PASS. A failure at step 3 with the exit code still non-zero means the conditional argv did not fire — check that `--baseline` reached the fake tool's `$8`.

- [ ] **Step 3: Commit**

```bash
git add tests/acceptance/m8.test.ts
git commit -m "test (m8): fail, accept the finding, pass on the re-run"
```

---

### Task 13: The integration test — the glob, on the real tool

A wrong path shape produces a rule that loads cleanly, matches nothing, and leaves the stage failing exactly as before with no error anywhere. No fake tool catches that, because the fake tool is not the thing doing the matching. This is the one test that is worth reaching a real binary for, so it goes in the `SG_INTEGRATION=1` tier beside `tests/core/install.test.ts`.

**Files:**
- Create: `tests/core/suppress-integration.test.ts`
- Modify: `vitest.config.ts:13-17` (add the file to the `INTEGRATION` list)

**Interfaces:**
- Consumes: the whole path, plus a real installed skillspector.
- Produces: nothing.

- [ ] **Step 1: Add the file to the integration exclusion list**

In `vitest.config.ts`, add `'tests/core/suppress-integration.test.ts'` to the `INTEGRATION` array, so the default offline run stays offline and `pnpm test:integration` picks it up.

- [ ] **Step 2: Write the test**

```ts
// tests/core/suppress-integration.test.ts
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { getAdapter } from '../../src/core/adapters/registry.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { applySuppression, previewSuppression } from '../../src/core/index.js'
import { loadToolLock } from '../../src/core/config/config.js'
import type { RepoRef } from '../../src/core/types.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'

const run = promisify(execFile)

// A skill skillspector reports on with `--no-llm`. The padded run is MP2's
// trigger — the same finding the M6 baseline work was prompted by.
const PADDED = `# scan\nPATTERN = r"""\n  a${' '.repeat(40)}\n"""\n`

describe('the written rule is one skillspector matches', () => {
  it('suppresses on a real re-scan', async () => {
    const lock = await loadToolLock(process.env.SKILLGANTRY_HOME ?? '')
    const bin = lock.tools['skillspector']?.execPath
    expect(bin, 'skillspector must be installed and locked').toBeDefined()

    const root = await makeRepo({
      files: { 'declawed/SKILL.md': SKILL_MD('declawed'), 'declawed/scripts/scan.py': PADDED },
    })
    const repo: RepoRef = { id: 'fx', path: root, name: 'fx', isGit: false }
    const skill = (await discoverSkills(repo))[0]!
    const spec = getAdapter('skillspector')!.manifest.baseline!

    const scan = async (baseline: boolean): Promise<number> => {
      const out = join(root, 'findings.sarif')
      await run(bin!, [
        'scan', skill.dir, '--no-llm', '--format', 'sarif', '--output', out,
        ...(baseline ? ['--baseline', join(skill.dir, '.skillspector-baseline.yaml')] : []),
      ]).catch(() => undefined)   // a scan with findings exits non-zero
      const sarif = JSON.parse(await readFile(out, 'utf8')) as {
        runs: { results: { suppressions?: unknown[] }[] }[]
      }
      const results = sarif.runs[0]?.results ?? []
      return results.filter((r) => (r.suppressions?.length ?? 0) > 0).length
    }

    // Nothing suppressed before, and at least one finding to suppress.
    expect(await scan(false)).toBe(0)

    const sarif = JSON.parse(await readFile(join(root, 'findings.sarif'), 'utf8')) as {
      runs: { results: { ruleId: string; locations: { physicalLocation: { artifactLocation: { uri: string } } }[] }[] }[]
    }
    const first = sarif.runs[0]!.results[0]!
    const preview = await previewSuppression({
      skill,
      reason: 'accepted by the integration test',
      rules: [
        {
          toolId: 'skillspector',
          nativeRuleId: first.ruleId,
          // Repo-relative, exactly as RawFinding carries it — the conversion
          // to the skill-relative form the tool globs against is the thing
          // under test.
          relPath: `${skill.relPath}/${first.locations[0]!.physicalLocation.artifactLocation.uri}`,
        },
      ],
      stillReporting: ['skillspector'],
    })
    for (const plan of preview.plans) await applySuppression(plan)

    // The whole point: skillspector's own fnmatch must match what we wrote.
    expect(await scan(true)).toBeGreaterThan(0)
  })
})
```

`loadToolLock`'s entry field for the resolved executable is R3.3's "resolved absolute executable path" — read `src/core/config/config.ts` for its real name and use that rather than `execPath` if it differs. If the test cannot find an installed skillspector it must fail loudly, never skip: a silently skipped integration test is how this regression ships.

- [ ] **Step 3: Run it**

Run: `SG_INTEGRATION=1 pnpm vitest run tests/core/suppress-integration.test.ts`
Expected: PASS. A failure on the final assertion with `0` suppressed is the path-shape bug — the rule's `path` must be skill-relative (`scripts/scan.py`), not repo-relative (`declawed/scripts/scan.py`).

- [ ] **Step 4: Run the whole check**

Run: `pnpm check && pnpm test:integration`
Expected: lint, build, test, acceptance and the integration tier all green.

- [ ] **Step 5: Commit**

```bash
git add tests/core/suppress-integration.test.ts vitest.config.ts
git commit -m "test (m8): prove the written rule is one skillspector matches"
```

---

## Deviations found while implementing

None yet — implementation has not started.
