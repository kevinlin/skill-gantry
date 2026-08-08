# M8 — Suppress a finding from the terminal, then re-run the gates

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
| Acceptance | A real skillspector run on the reference repo: security fails, `s` accepts the finding, the re-run passes, and the ledger reads the issue suppressed |

The acceptance row is the one that matters. A wrong path shape produces a rule that loads cleanly and matches nothing, so the stage fails exactly as before with no error anywhere. No unit test over our own substitution catches that — only a real scan against a real baseline does.

## Risks and one-way doors

**Suppression is one-way in the terminal.** Removing a rule is out of scope, so undoing means editing the YAML by hand or reverting the file in git. The mitigation is that the diff gate makes a wrong rule visible before it lands, and the file is an ordinary tracked file in the user's repo. If the acceptance flow gets used enough that mistakes are routine, `S` to unsuppress through the same write path is the follow-up.

**Coverage is one tool of four.** Every security finding skill-scanner raises, and everything skill-lint raises, can only be marked `wontfix`, which does not affect the gate. That is a property of the ecosystem rather than of this design, and D24 chose to state it rather than paper over it with a second store.

**skillspector's glob semantics are its own.** `*` crosses path separators and matching is case-insensitive. A rule written for `scripts/scan.py` is exact, so neither bites today, but a future manifest that emits a pattern rather than a literal path inherits both.

## Deviations found while implementing

None yet — implementation has not started.
