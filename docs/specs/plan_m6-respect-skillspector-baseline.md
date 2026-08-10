# Respect the SkillSpector baseline

## Context

`zapac-agent-skills/declawed/.skillspector-baseline.yaml` accepts two findings as false positives. SkillGantry ignores it. Security run `019fd2d8-9c46-73dd-8409-cceef0668b37`, started 76 seconds *after* the baseline was written, reported `MP2` at `declawed/scripts/scan.py:34` anyway, failed the stage, and filed an open issue.

Root cause, confirmed against the installed tool: **skillspector 2.5.1 supports baselines and SkillGantry never passes the flag.**

- `skillspector scan … --baseline/-b PATH` — "Matching findings are dropped before scoring."
- No auto-discovery: `cli.py:136-138` in the installed package loads the file only when passed. `.skillspector-baseline.yaml` is merely the default *output* path of `skillspector baseline`.
- SkillGantry's argv is a frozen literal with no baseline flag: [skillspector.ts:36-44](src/core/adapters/skillspector.ts#L36-L44).

What the flag does, from diffing two real scans of `declawed` (identical but for a nondeterministic `properties.findingId`):

```
+ "suppressions": [ { "kind": "external",
+     "justification": "False positive: whitespace run is re.VERBOSE comment alignment, not context padding" } ]
```

The result is **still emitted**, annotated with the standard SARIF 2.1.0 `result.suppressions` array. `--show-suppressed` changes nothing in SARIF format — it is a terminal-format switch — so we do not pass it. SkillGantry therefore receives the finding *and* the user's reason text, and [sarif.ts](src/core/adapters/sarif.ts) ignores the field entirely.

Also verified: a malformed baseline exits 2 with no SARIF written, which is already R4.13 row 7 `missing-artefact` → `errored` → reconciliation untouched. Nothing to build there.

Intended outcome: a baselined finding stops failing the stage and stops showing as an open issue, without SkillGantry inventing a second, competing suppression store.

### The shape of the answer

The baseline file is the **authority**; the ledger holds a **derived cache** recomputed on every conclusive tool run. That is R1.6's existing pattern — `SKILL.md` frontmatter owns lifecycle, `skills.lifecycle_state` is a cache reconciled every run ([record.ts:48-56](src/core/ledger/record.ts#L48-L56)) — and for the same reason: the file edit and the ledger transaction cannot be made atomic.

Three rejected alternatives, each for a specific failure:

- **Reuse `wontfix`.** §10.5 makes it sticky and reversible only by explicit user action, so deleting a baseline entry would leave the issue suppressed forever.
- **Drop suppressed results in the parser.** The tool would look like it reported nothing, §10.4 would close the issue as `fixed`, and the Issues screen could not tell an accepted false positive from a real fix.
- **Carry them in a second array on `ToolResult`.** See §2 — it loses data silently.

## Design

### 1. Pass the flag — a generic conditional-argv mechanism

[adapters/types.ts](src/core/adapters/types.ts) gains one type and one optional field:

```ts
/**
 * Argument group the executor appends only when a path exists. Declared, never
 * probed: R4.3 forbids an adapter touching the filesystem and lint enforces it,
 * so the manifest names the condition and the stage executor answers it.
 *
 * Appended after `argv`, so a manifest ending in a positional argument cannot
 * use one — the group would land past the positional and read as more
 * positionals. Every shipped manifest ends in an option value.
 */
export interface ConditionalArgv {
  /** Same `{skillDir}`/`{repoRoot}`/`{toolDir}` vocabulary as `argv`. */
  whenExists: string
  argv: readonly string[]
}

invoke: { argv; cwd; conditionalArgv?: readonly ConditionalArgv[] }
```

[skillspector.ts](src/core/adapters/skillspector.ts):

```ts
conditionalArgv: [
  { whenExists: '{skillDir}/.skillspector-baseline.yaml',
    argv: ['--baseline', '{skillDir}/.skillspector-baseline.yaml'] },
],
```

The stat goes in a `resolveConditionalArgv` helper beside `substitute` in [adapter-stage.ts](src/core/stages/adapter-stage.ts), called from `execute()` at [:294](src/core/stages/adapter-stage.ts#L294). Three rules, each covering a real failure:

- **Against the substituted path, in `execute()` and never `plan()`.** `plan()` runs on `ctx0` at [run.ts:313](src/core/pipeline/run.ts#L313), *before* `openSandbox` re-roots `ctx.skill.dir` at [:373-387](src/core/pipeline/run.ts#L373-L387). Statting `input.skill.dir` also breaks the repo-root case, where the tool is handed a materialised candidate copy ([run.ts:184-190](src/core/pipeline/run.ts#L184-L190)) — that works today only because the baseline happens to be inside the candidate manifest, and stops working the day the exclusion set moves.
- **`isFile()`, not existence.** `--baseline <dir>` makes skillspector exit 2 with no SARIF.
- **A non-ENOENT stat failure reads as absent.** A baseline the engine cannot stat is one the tool cannot read; the loud direction — every suppressed finding resurfacing — is the safe one.

A literal path would be wrong on both counts: `cwd` is `repoRoot` for skillspector, so a relative path resolves against the wrong directory.

### 2. Parse — `RawFinding` gains an optional suppression

```ts
export interface RawFinding {
  // …
  /**
   * SARIF 2.1.0 `result.suppressions`. The tool still reported the finding and
   * still believes it; the user's baseline says do not act on it.
   */
  suppressed?: { justification: string }
}
```

**One optional field, not a second array on `ToolResult`.** Two reasons, both decisive:

- R8.4's fingerprint is `(skillId, relPath, ruleClass)`, so two `credential-access` findings in one file — one baselined, one not — collapse to **one issue**. A split array destroys the pairing the ledger needs to decide whether that issue is suppressed at all.
- The failure shapes are asymmetric. With a second array, a consumer that forgets to read it never files those findings → their fingerprints are absent from `reported` → phase 1 marks them absent → phase 2 closes them `fixed`. Silent data loss, and the exact outcome we are trying to avoid. With one optional field, forgetting it means the finding behaves as it does today: filed, counted, reconciled, gate-failing. The feature degrades to "no suppression", never to "issue closed and history lost".

One field rather than `suppressed?: boolean` + `suppressionReason?: string`: a reason without a flag is unrepresentable and a flag without a reason is a second empty state. Assigned conditionally under `exactOptionalPropertyTypes`, the way [sarif.ts:70](src/core/adapters/sarif.ts#L70) already assigns `line`.

In [sarif.ts](src/core/adapters/sarif.ts), a `suppressionOf(res)` helper:

```
SARIF §3.27.23: an EMPTY suppressions array means explicitly not suppressed,
an ABSENT one means no information — a truthiness test conflates them.
status 'rejected' and 'underReview' have not taken effect; absent status
defaults to 'accepted', which is what skillspector 2.5.1 emits.
```

`outcome`, `findings.length` and `metrics.findingsTotal` are **unchanged** — the parser's verdict stays "did I see anything", and a count that drops when a user edits YAML makes "did this skill improve" unanswerable. `summary` gains the count: `2 findings, 1 suppressed`. That string reaches the lifecycle rail and `stage.json`, and is the feature's always-on signal that the flag fired.

Consumers:

| File | Change |
|---|---|
| [stages/outcome.ts](src/core/stages/outcome.ts) | new export `actionableFindings(findings)` — those without `suppressed`. A named helper rather than teaching `highestSeverity` to filter, because a function called "highest severity" that quietly means "highest actionable severity" is the hidden policy this codebase writes comments against |
| [stages/adapter-stage.ts](src/core/stages/adapter-stage.ts#L115-L125) | row 12b computes `highest` over `actionableFindings(parsed.findings)`; its guard gains `parsed.findings.length > 0`, because every shipped parser derives `failed` from `findings.length` and dropping the clause would silently downgrade a future parser that returns `failed` with nothing to point at. Findings still pass through verbatim |
| [stages/fix-prompt.ts](src/core/stages/fix-prompt.ts) | table built from `actionableFindings`; `null` when that set is empty; one line naming the omitted count. The one instruction a prompt must never give a coding agent is "fix the thing the user has explicitly ruled on". Sub-floor findings are not suppressed, so R6.10's "a `passed` sub-floor stage writes one" still holds |
| [cli/fix-command.ts:49,95](src/cli/fix-command.ts#L49) | the "is there anything to fix" test and the R12.6 exit code become actionable-only, so a fully-suppressed run exits 1 saying so rather than 0 with an empty table |
| [workspace/writer.ts](src/core/workspace/writer.ts#L79) | none — `...run` serialises the field for free. Historical `stage.json` files have no key → absent → not suppressed → unchanged behaviour, which is what lets R11.10 rehydration and `skillgantry fix` answer for old runs |
| [tui/components/OutputPane.tsx](src/tui/components/OutputPane.tsx) | one glyph on suppressed rows in the Findings pane; no new row |

### 3. The ledger — a derived cache at two levels

**Migration 5** in [schema.ts](src/core/ledger/schema.ts), four columns, no backfill and no default — every pre-existing row is "not suppressed", which is what it was, and the next run recomputes from the file. A backfill would be the ledger inventing a user decision.

```sql
alter table issue_detectors add column suppressed_run    text;
alter table issue_detectors add column suppressed_reason text;
alter table issues          add column suppressed_run    text;
alter table issues          add column suppressed_reason text;
```

**Two levels because the question has two levels**, exactly the shape `issue_detectors` already has for closure: evidence per tool, decision as a conjunction over the set. Nothing on `issue_detections` — R8.2 makes the SARIF artefact the per-occurrence evidence, and an unread column is maintenance with no reader.

**Per tool run**, in [record.ts](src/core/ledger/record.ts#L135-L195) alongside `reported`: a fingerprint is suppressed for that tool run only when **every** occurrence of it was suppressed. One baselined occurrence must not hide an issue the same tool is still reporting plainly beside it.

**Per issue**, in [issues.ts](src/core/ledger/issues.ts) beside `detectorSaysGone`: an issue is suppressed only when every detector **still reporting it** reports it suppressed. A detector that says gone has no vote. This is the twin of R8.8's closure conjunction, and it is what stops skillspector's tool-scoped baseline hiding a live finding from skill-scanner, which was never consulted.

**The clear is structural, not a separate code path.** [reconcile.ts](src/core/ledger/reconcile.ts#L60-L66)'s existing upsert gains both columns, bound to `null` for an unsuppressed sighting, in the same statement that advances `last_seen_run`. There is no clear path to forget to call. The absent branch at [:83-86](src/core/ledger/reconcile.ts#L83-L86) nulls them too, so a row is honest read on its own.

**A suppressed fingerprint joins `reported`, not the absent set.** This falls out with no change to the first loop, and it is the whole safety property. Were it absent instead: `last_absent_run` advances → every detector agrees it is gone → phase 2 sets `state = 'fixed'`. History would survive literally, but the issue would read `fixed` while not being fixed, and an issue the user had *acknowledged* would be silently closed by `stateOnAbsence`.

**Phase 2 closure is unchanged.** `detectorSaysGone` does not read the new columns; a suppressed sighting blocks closure by advancing `last_seen_run` and nothing else. A new pass after closure recomputes the issue-level cache over the fingerprints phase 1 could have touched — **every** touched issue, not only the `open`/`acknowledged` closure candidates, because restricting it would freeze a `wontfix` issue's flag forever and `wontfix` rows are on the Issues screen. Exported as `recomputeIssueSuppression(db, fp)` because [rule-map-migration.ts](src/core/ledger/rule-map-migration.ts) must call it too; a second copy of the conjunction is how the two would come to disagree.

**A tool that errored or was skipped changes nothing** — [reconcile.ts:58](src/core/ledger/reconcile.ts#L58) already `continue`s before either write, so the existing fail-safe extends for free. That is precisely why the write belongs in `reconcile.ts` and not in `record.ts`, which iterates every tool run including the errored ones.

**Unchanged on purpose:** `occurrence_count` counts suppressed occurrences (§10.3 defines it as "how many times was this seen last time we looked", and the tool did see it); `severity_max` still rises and stays monotone (severity is a property of the finding, suppression of the user's decision about it); `state` is never written by suppression.

`wontfix` and suppressed are orthogonal by construction, so R8.7's "exactly one state" survives — suppression is not a state. Both hide; removing the baseline entry un-suppresses but leaves the `wontfix`; reopening a `wontfix` leaves the suppression.

**[rule-map-migration.ts](src/core/ledger/rule-map-migration.ts) must be amended.** `fold()` names detector columns explicitly in both its select and its insert, so left alone a merge drops the pair on insert and keeps the target's stale pair on update. Take both from the row whose `last_seen_run` won, then `recomputeIssueSuppression`. No `RULE_CLASS_MAP_VERSION` bump — the rule map itself has not changed.

**Read paths:**

- [stats.ts](src/core/ledger/stats.ts#L214) `openIssueCounts` — `and i.suppressed_run is null`, plus a sibling `suppressed` count. An issue the user has baselined is one they have decided about; counting it keeps the Dashboard number from ever falling for anyone who uses a baseline, which is that number's entire job.
- [issue-queries.ts](src/core/ledger/issue-queries.ts) `listIssues` — **keeps** suppressed rows, projects `suppressed` / `suppressionReason` from the row already selected, gains an optional `suppressed?: boolean` filter (omitted means both, so today's TUI call is unchanged), and sorts them last via a leading `(i.suppressed_run is not null)` term. The Issues screen is the audit surface; hiding a suppression there makes it unfalsifiable.
- [gates.ts](src/core/ledger/gates.ts) — **no change**, and this is intended: a fully-suppressed security stage reports `passed`, so R9.8 permits release. The audit trail is the SARIF annotation on disk, `issue_detectors.suppressed_reason`, and — the one that binds — **the baseline file is inside the candidate manifest, so writing it moves the skill digest and R9.9 refuses release when a passing gate's recorded digest differs.** You cannot baseline your way past a gate that has already passed. [release/preconditions.ts](src/core/release/preconditions.ts) needs nothing.

### 4. Surface

**Issues screen** ([Issues.tsx](src/tui/components/Issues.tsx)) — zero new rows, zero new keys. The state column is already exactly filled by `◐ acknowledged`, so the mark rides the trailing field beside the existing `⟂ blockers` precedent at [:70,81](src/tui/components/Issues.tsx#L70): `⊘ suppressed: <reason>`, surviving `truncateMiddle` because that elides the head. The row renders `dimColor`. The `Panel` title at [:52](src/tui/components/Issues.tsx#L52) gains `· N suppressed`. Glyph paired with the word, so a monochrome terminal loses nothing.

**`skillgantry run --json`** changes additively only: `tool:done` carries `ToolRunRecord`, so each suppressed finding gains one optional key. No new event, no version bump. **Not** extending `RunDelta` — a `suppressed` counter would mean editing six files kept in step for a number the stage summary already puts on the rail during the run and the Issues screen already answers after it.

**`skillgantry fix`** — exit 1 for a fully-suppressed run, omitted rows named in the prompt, `--json` reporting `findings` (actionable) and `suppressed` as siblings.

## Tests

| Target | Method | Guard |
|---|---|---|
| `parseSarif` | `tests/core/sarif.test.ts`, pure, hand-built docs plus the golden fixture | `suppressions: []` and an absent array are both **not** suppressed; `rejected` and `underReview` do not suppress, absent `status` does; missing `justification` → `''`; `findingsTotal` still counts every result; `outcome` still `failed`; summary names the count |
| Golden fixture | `scripts/capture-fixtures.sh` gains a baselined capture passing the reference repo's own `declawed/.skillspector-baseline.yaml`, writing `tests/fixtures/sarif/skillspector-declawed-baselined.sarif`. The pin guard already refuses on version drift (R13.3) | a diff test asserts the only deltas from `skillspector-declawed.sarif` are `result.suppressions` and `properties.findingId`, so upstream moving anything else fails the suite |
| `classifyToolRun` | `tests/core/adapter-stage.test.ts` | every at-or-above-floor finding suppressed → `passed` with **all** findings retained; suppressed `high` + live `low` → `passed` via 12b; suppressed `low` + live `high` → `failed`; a parser returning `failed` with zero findings still `failed` |
| Conditional argv | `tests/core/adapter-stage.test.ts` + `tests/helpers/fake-tool.ts` | absent file → no flag; present → flag with the **substituted** path; a directory does not fire it; against a re-rooted `ctx.skill.dir` the flag names the materialised candidate, not the source |
| Reconcile, phase 1 | `tests/core/reconcile.test.ts`, in-memory SQLite | a suppressed fingerprint joins `reported`, advances `last_seen_run`, does **not** close, does not touch `state`; the next unsuppressed sighting nulls both columns while `first_seen_run`, `occurrence_count` and every detection row survive |
| Both conjunctions | `tests/core/reconcile.test.ts` | two fan-out detectors, one suppressing → not suppressed, in either finish order; both → suppressed; one tool reporting two occurrences of one fingerprint with one suppressed → that detector does not suppress; a gone detector has no vote |
| Fail-safe | `tests/core/reconcile.test.ts` | an `errored` run and a `skipped` run each leave both columns exactly as the last conclusive run left them |
| `record.ts` | `tests/core/record-occurrences.test.ts` | `occurrence_count` counts suppressed occurrences; `severity_max` rises on a suppressed `critical` and never falls |
| State machine | `tests/core/issues.test.ts` | `wontfix` + suppressed together; suppression writes no `state`; reopen leaves the suppression; un-baselining leaves the `wontfix` |
| Queries | `tests/core/stats.test.ts`, `tests/core/issue-queries.test.ts` | a suppressed `open` issue is absent from `bySeverity`/`byRuleClass` and present in `suppressed`; un-suppressing restores it; `listIssues` returns it by default sorted last, projects the reason, and `filter.suppressed` narrows both ways |
| Migration 5 | `tests/core/ledger-backfill.test.ts` | a v4 database migrates with all four columns null and every row intact — **no backfill invents a suppression** — and a subsequent `recordRun` populates them |
| Rule-map merge | `tests/core/rule-map-migration.test.ts` | a merge takes the pair from the row whose `last_seen_run` won and recomputes the issue cache; a `suppressed_run` not equal to the merged `last_seen_run` degrades to not-suppressed |
| `buildFixPrompt` | `tests/core/fix-prompt.test.ts`, pure | fully suppressed → `null`; mixed → suppressed rows omitted, survivors renumbered from 1, omitted count named; a sub-floor `passed` stage still yields one |
| `skillgantry fix` | `tests/cli/fix-command.test.ts`, `tests/cli/fix-exit-code.test.ts` | a fully-suppressed run exits 1 saying so; `--json` carries both counts; a pre-feature `stage.json` answers identically to today; the sidecar is byte-identical afterwards |
| Issues screen | `tests/tui/issues.test.tsx`, `renderInk` at 80×24 and 50×14 | the frame's row count is identical with and without a suppressed row; the row carries `⊘` and the reason; the panel title names the count |
| End to end | `tests/acceptance/`, fake tool emitting a suppressed SARIF | `run --stage security --json` exits 0, the stage reads `passed`, the ledger holds the issue `open` **and** suppressed |

## Spec amendments

Amend in-branch. New ids go at the **end** of their section — `expand()` in [traceability.test.ts:15-28](tests/specs/traceability.test.ts#L15-L28) reads declaration order, so an id inserted before a range's last member is swallowed and the build stays green while the wrong milestone owns it.

| Id | Substance |
|---|---|
| **R4.14** | A manifest MUST be able to declare argument groups appended only when a named path exists, in the same substitution vocabulary as `invoke.argv`. The existence test MUST be performed by the stage executor against the **substituted, tool-facing** path, and MUST NOT be performed by the adapter. *Verify:* absent with no baseline; present with the materialised-candidate path for a repo-root skill; absent for a directory at that path |
| **R4.15** | A finding a tool reports as suppressed MUST cross the parse boundary as a finding annotated with the tool's justification. It MUST NOT be dropped, MUST NOT be moved to a separate collection, and MUST NOT contribute to the fail floor |
| **R6.11** | A fix prompt MUST omit suppressed findings and name how many it omitted. A stage whose every finding is suppressed MUST NOT write one |
| **R8.15** | The skill's own suppression file MUST be the authority; ledger suppression columns MUST be a derived cache recomputed on every conclusive tool run and cleared by the same run that observes the finding unsuppressed. A suppressed finding MUST be recorded as **reported**, MUST NOT close its issue, MUST NOT alter its issue state, and MUST retain its detections, occurrence count and severity. An issue MUST read as suppressed only when every tool still reporting it reports it suppressed. Open issue counts MUST exclude suppressed issues; issue listings MUST NOT |

**R4.13 is amended in place, no new id** — rows 12 and 12b gain the word "unsuppressed" and a row 12c is added (findings present, none actionable → `passed`). Its text says the enumeration is "at least", and rev 7 set exactly this precedent. Mark *(rev 11)*, and add the rev-11 sentence to the preamble at [requirements.md:8](requirements.md#L8).

**Milestone ownership** — all four join **M6**'s row, exit criteria extended by one clause: *a baselined finding passes the gate, stays open in the ledger with its history, is excluded from the open counts but listed and marked on the Issues screen, and reappears the run after its baseline entry is deleted.* M6 rather than M1 or M4 on this repo's own precedent: rev 9 put R6.10's `stages/` and `pipeline/` change in M6 because the milestone owning a post-ship extension is the one whose surfaces it changes, and every user-visible surface here is M6's. Range-safety: M1 owns `R4.9–R4.13`, `R8.10–R8.14`, `R6.1–R6.6, R6.8`; §R6 declares R6.1…R6.6, R6.7, R6.9, R6.8, R6.10, so R6.11 last is safe. Nothing widens.

No `R11.11`. The Issues mark is covered by R11.3 plus R8.15's listing clause, and §14.1's budget already binds it.

**design.md** — §7 (`ConditionalArgv`, `RawFinding.suppressed`, why the stat is in `execute()` and not `plan()`, the digest and archive consequences), §8.1 (rows 12/12b reworded, new 12c), §8.2 (one clause saying the reduction is unchanged, so a reader does not go looking), §9.4 (the prompt's omission rule), §10.1 (four columns with the derived-cache comment), §10.3 (`occurrence_count` counts suppressed, and why), §10.4 (the phase-1 write and clear, a new paragraph *"Why a suppressed finding is reported, not absent"*, the per-issue conjunction beside the closure conjunction), §10.5 (two redetection rows plus a note that suppression is a column and not a state, and why `wontfix` was rejected), §10.6 (`fold()`'s pair plus the recompute), §10.7 (the exclusion, and why counts exclude while listings do not), §12.4 (a baseline is a gate override and R9.9's digest binding is what stops it being retroactive), §14 (the Issues mark), §15 (the additive `--json` field, `fix`'s new exit case), §16 (test rows), new §18.5.

**index.md** — one plan row, `plan_m6-baseline-suppression.md`, M6 (extension).

## Sequencing

1. `requirements.md` — the four ids, R4.13's rev-11 rows, the M6 row, the preamble. Then `pnpm vitest run tests/specs` **before touching design.md**, so a swallowed id fails rather than silently getting the wrong owner.
2. `design.md`, then `tests/specs` again.
3. `ConditionalArgv` + the skillspector manifest + `resolveConditionalArgv` + its test. Independently shippable and independently valuable — on its own it makes skillspector honour the baseline, which is the user-visible half.
4. `RawFinding.suppressed` + `sarif.ts` + the captured fixture + parser tests. Independent of 3.
5. `actionableFindings` + `classifyToolRun`; classification tests. Needs 4.
6. Migration 5 + its test. Independent of 3–5.
7. `issues.ts` predicates, `record.ts` per-run conjunction, `reconcile.ts` both phases, `recomputeIssueSuppression`; reconcile and record tests. Needs 4, 6.
8. `rule-map-migration.ts` `fold()` + recompute. Needs 7.
9. `stats.ts`, `issue-queries.ts`, `core/index.ts` exports. Needs 6, 7.
10. `fix-prompt.ts` + `fix-command.ts`. Needs 5.
11. `Issues.tsx`, `rows.ts`, `views.ts` port types, `OutputPane.tsx` glyph. Needs 9.
12. Acceptance, then `pnpm check`.

Steps 3 and 4 are independent; 10 and 11 are independent of each other.

## Verification

End to end, against the repo that produced the failing run:

```bash
pnpm check                                  # lint && build && test && acceptance
node dist/cli/index.js run declawed --stage security --json > /tmp/run.ndjson

# the motivating case: MP2 is baselined, so the stage must pass
jq -r 'select(.type=="stage:done") | .result.outcome' /tmp/run.ndjson      # passed

# the finding is retained, annotated, not discarded
RUN=$(ls -t ~/…/declawed-workspace/skillgantry/runs | head -1)
jq '.toolRuns[0].findings[] | {nativeRuleId, suppressed}' <run>/03-security/stage.json
jq -r '.toolRuns[0].summary' <run>/03-security/stage.json                  # "1 finding, 1 suppressed"

# the flag actually fired, and the ledger reads it the way we designed
jq '.runs[0].results[0].suppressions' <run>/03-security/skillspector/findings.sarif
sqlite3 ~/.skillgantry/gantry.db \
  "select i.state, i.suppressed_run is not null as suppressed, i.suppressed_reason,
          d.tool_id, d.last_seen_run, d.last_absent_run
     from issues i join issue_detectors d on d.issue_fp = i.fingerprint
    where i.rel_path = 'declawed/scripts/scan.py';"
# expect: state 'open', suppressed 1, last_absent_run NULL — reported, not absent

# no fix prompt for a fully-suppressed stage
ls <run>/03-security/fix-prompt.md            # expect: no such file
node dist/cli/index.js fix declawed --stage security; echo $?   # expect 1

# round trip: delete the MP2 entry from the baseline, re-run
#   → stage fails again, same fingerprint, first_seen_run unchanged, suppressed_run NULL
```

Then in the TUI: open Issues, confirm the suppressed row is present, dimmed, marked with its reason and sorted last, and that the panel title counts it; confirm the Dashboard's open count excludes it; confirm the frame's row count is unchanged at 80×24 and 50×14.

## Deviations found while implementing

**The fixture diff needed a captured pair, not the existing fixture.** The plan diffed a new baselined capture against `skillspector-declawed.sarif`, which was captured 2026-08-01 and holds two results. Current `declawed` produces one: `LP3` was fixed in the skill since. A cross-capture diff would therefore report the skill's own edits as upstream schema drift, which is the opposite of what the test is for. `capture-fixtures.sh` now captures both halves back to back — `skillspector-declawed-unbaselined.sarif` and `skillspector-declawed-baselined.sarif` — and the diff runs over that pair. The historical fixture is untouched, because `tests/core/skillspector.test.ts` and `tests/acceptance/m4.test.ts` are asserting against those bytes.

**The Issues mark could not simply be concatenated.** §4 reasoned it would survive `truncateMiddle` because that elides the head, but the mark sits after `relPath` in one string, so a long reason is exactly what pushes the glyph into the elided part — observed at 100 columns. Its width is now reserved out of the path field's instead, and the reason is truncated to at most 60% of it. Still zero new rows and zero new keys.

**`promptFor` returns a suppressed count alongside its document.** `skillgantry fix` had to tell "found nothing" from "found only things you have already ruled on" while both exit 1, and the count was not otherwise reachable from a `null` return.

**A per-issue detector predicate was needed, not just a column read.** `detectorSuppressed` tests `suppressed_run === last_seen_run` rather than `suppressed_run !== null`. Without the equality, §10.6's merge — which takes columns from a row rather than from a write — could carry a pair from the losing row and leave a suppression describing a sighting that no longer exists.

**`tests/core/ledger-backfill.test.ts`'s v3 fixture gained two tables.** It seeded `runs` alone, so migration 5's `alter table` on `issues` and `issue_detectors` failed against it. The fixture, not the migration, was the partial thing.

**`RunDelta` was left alone, as planned, and so was `gates.ts`.** Confirmed against the real repo: a fully suppressed security stage reports `passed`, and R9.9's digest binding is what stops that being retroactive — editing the baseline moves the digest.
