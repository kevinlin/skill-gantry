# SkillGantry M6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** revision 1, written against [design.md](design.md) revision 3, [requirements.md](requirements.md) revision 6 and shipped M1–M5.

**Goal:** Turn five milestones of recorded evidence into answers. Cross-repo statistics out of the ledger, an Issues table a maintainer can triage from, and the four top-level screens design §14 named and M2 shipped one of.

**Architecture:** M6 adds two query modules to `src/core/ledger/` and four screens plus a command palette to `src/tui/`. The TUI still may not open the ledger, so every ledger read reaches it through one injected port (`GantryViews`) that `src/cli/` implements — the same seam shape as `startRun`. Three columns the ledger has always had but never truthfully populated are fixed first, because R8.9 asks questions they are the only possible answer to.

**Tech Stack:** everything M1–M5 ship, and no new npm dependency. Queries are plain SQL over `node:sqlite`; medians and JSON metric sums are computed in TypeScript because SQLite offers neither.

## Global Constraints

Everything in [plan-m1.md's Global Constraints](plan-m1.md), [plan-m2.md's](plan-m2.md), [plan-m3.md's](plan-m3.md), [plan-m4.md's](plan-m4.md) and [plan-m5.md's](plan-m5.md) still holds. These are the additions.

- Import boundary unchanged: `cli → tui → core`; `src/tui/**` reaches core **only** through `src/core/index.ts`; no `console` or `process.exit` in `src/core/**`; no `node:fs` / `node:child_process` / `node:https` / `node:net` in `src/core/adapters/**`.
- **`src/tui/**` may not open the ledger and may not spawn.** It may read the filesystem. Every ledger query and the `doctor` probe reach it as data through the `GantryViews` port, implemented in `src/cli/gantry-views.ts`. `src/cli/**` may deep-import core (`run-command.ts` already does); `src/tui/**` may not.
- **The rule-map migration never runs implicitly.** R8.14. `skillgantry doctor --migrate-rule-map` stays its only trigger; the Tools screen reports `rule-map-pending` and does not resolve it.
- **`SKILL.md` frontmatter stays the lifecycle authority.** R1.6. The Dashboard and Issues screens read the `skills` cache — that is what design §13 says the cache is for — and a divergence is `doctor`'s `lifecycle-drift`, not this screen's problem.
- **Log text never enters React state line by line.** R11.4. Ring buffer capacity 2000 lines, flush interval 100 ms. Nothing in M6 goes near the pump; the new screens hold bounded documents.
- **Every full-screen view obeys design §14.1's row budget.** A panel renders exactly the rows it was allocated; an overflow count is counted *against* that allocation, never appended below it; text truncates and never wraps; pane sizes are decided in `src/tui/layout.ts` and nowhere else.
- **Metric keys stay a closed union.** R1.5. `METRIC_KEYS` gains nothing; no token or cost key exists by construction, and `coerceMetrics` throws on an unknown key.
- **Finding identity is unchanged.** R8.4: `(skillId, relPath, ruleClass)`. M6 reads issues; it does not re-key them.
- **Closure stays a conjunction over `issue_detectors`.** R8.8. The Issues screen shows which detector is holding an issue open by calling the *same* predicate `reconcile.ts` closes on, never a second copy of it.
- British spelling in identifiers that appear in the specs (`optimise`, `artefact`, `normalise`).
- Conventional Commits, lowercase imperative subject describing the behaviour change.

## Facts established by reading the shipped code

Three of these are defects, not design choices. Each blocks a clause of R8.9 or R7.6, so M6 fixes it before querying it.

**1. `stages.metrics_json` is always `'{}'`.** [src/core/ledger/record.ts:106](../../src/core/ledger/record.ts#L106) writes the literal. Tool metrics live on `ToolRunRecord.metrics` and reach the ledger nowhere. R8.9's "eval case pass rate" has no source until this is fixed — `casesTotal` / `casesPassed` exist only in memory.

**2. `stages.started_at` and `stages.ended_at` hold the *run's* times.** Same insert, bound to `input.startedAt` / `input.endedAt`. R8.9's "wall-clock per stage" would report every stage of a run as taking the whole run. Nothing reads either column today (`grep` over `src` and `tests` finds only the insert), so correcting them breaks no caller.

**3. The ledger's provenance omits `analysisModes`.** [src/core/pipeline/run.ts:454](../../src/core/pipeline/run.ts#L454) records `JSON.stringify(input.provenance)` while `run.json` gets `withAnalysisModes(input.provenance, analysisModes)` (line 209). R4.2b exists so a mode change shows up as a visible boundary in the statistics; a fingerprint over the ledger's copy could not see one.

**4. The milestone ownership table is already clean.** 133 declared requirements, each owned by exactly one milestone, none unowned — verified by expanding every range in document order. So R13.7's ownership half passes on the first run and the check is not a rewrite of the table.

**5. Design coverage is not clean: 19 requirements are claimed by no `*Satisfies*` label.** `R1.1`, `R1.2`, `R1.3`, `R1.5`, `R4.9`, `R4.10`, `R4.11`, `R4.12`, `R5.13`, `R5.14`, `R7.1`, `R7.2`, `R7.4a`, `R7.5`, `R7.6`, `R8.13`, `R8.14`, `R13.6`, `R13.7`. Every one of them is *implemented* and *described*; the label is what is missing. `R7.6` is the exception — no design section describes statistics at all, which is why Task 1 writes §10.7 before Task 4 builds it.

**6. Ranges in both documents expand in document order, and that rule is load-bearing.** `R6.1–R6.8` covers `R6.9` because requirements.md declares R6.9 *before* R6.8. A checker expanding numerically instead would report a false gap.

**7. §10.3's satisfies label carries prose: `*Satisfies R8.4, R8.6. Supersedes the message-shape scheme in revision 1.*`** and §6's carries `R9 dispatch`. The parser therefore takes the first whitespace-delimited word of each comma-separated token and strips trailing periods, rather than assuming the whole label is ids.

**8. There is no user path to `acknowledged` or `wontfix`.** `stateOnDetection` and `stateOnAbsence` are the only transitions in code; R8.10's "user acknowledgement" and "user marks wontfix" rows exist in design §10.5 and in no function. The Issues screen is the first thing that needs them.

**9. `reconcile.ts` already holds the closure predicate M6 wants to display**, inline at lines 108–112. Extracting it is what stops the Issues screen from carrying a second copy that could disagree about which detector is blocking closure.

**10. `MIGRATIONS` is `readonly string[]` and `openLedger` runs each with `db.exec`.** A fingerprint backfill needs sha256, which SQLite has no function for, so Task 3 widens a migration to `{ sql, backfill? }`.

## Spec amendments this milestone carries

All land in Task 1, before the code that depends on them, per the repo rule that a spec proven wrong is corrected in the same branch.

1. **Design gains §10.7, "Statistics queries".** R7.6 and R8.9 are M6's and no design section describes either. Without it, Task 4 would invent a contract and the design would document the code afterwards, which inverts the layers.
2. **Nineteen `*Satisfies*` labels are added or extended.** Fact 5's list. This is the mapping R13.7 requires to exist, not new behaviour: each requirement is already implemented in the section that gains the label.
3. **Design §10.5 gains three user-action rows.** `open → acknowledged`, `open|acknowledged|fixed → wontfix`, `acknowledged|wontfix|fixed → open`. R8.10 already enumerates acknowledgement and wontfix; the reopen row is new and deliberate — a `wontfix` with no way back is a trap, and R8.10 requires the table to be *total*, so the transition has to be stated rather than left to a screen.
4. **Design §14 gains the palette and the screen set it already promised.** §14 names "Dashboard, Issues, Tools, Settings" and a `:` command palette in prose; §14.1 defines the row budget for panes. It gains: the palette is the screen switcher, every screen is a `Panel` windowed against `layout.rows`, and `esc` returns to Work.
5. **Design §16 gains the four M6 test rows** (statistics queries, issue queries and user transitions, the traceability check, the new screens' row budget), and §17's M6 module row gains `ledger/stats.ts`, `ledger/issue-queries.ts` and `tui/rows.ts`.

## Critical Files — Summary

| Path | Role |
|---|---|
| `tests/specs/traceability.test.ts` | R13.7's mechanical check: ownership exactly once, design coverage at least once |
| `src/core/stages/outcome.ts` | `reduceStageMetrics()` — the sum that makes eval case rate answerable |
| `src/core/ledger/fingerprint.ts` | `provenanceFingerprint()` — R7.6's grouping key, over a fixed field order |
| `src/core/ledger/db.ts` | `Migration` gains an optional `backfill` for data SQL cannot compute |
| `src/core/ledger/stats.ts` | the five R8.9 query families and `dashboard()` |
| `src/core/ledger/issue-queries.ts` | `listIssues()`, `setIssueState()` — cross-repo triage |
| `src/core/ledger/issues.ts` | `stateOnUserAction()`, `detectorSaysGone()` — the decisions, kept out of the I/O modules |
| `src/tui/views.ts` | `GantryViews` — the port the TUI declares and the CLI implements |
| `src/cli/gantry-views.ts` | the implementation: ledger, doctor probe, config and `.env` in one place |
| `src/tui/rows.ts` | pure row builders for Dashboard, Tools and Settings, testable without Ink |
| `src/tui/components/Palette.tsx` | `:` command palette — the screen switcher |
| `src/tui/components/Dashboard.tsx` | R8.9 rendered, filterable by provenance (R7.6) |
| `src/tui/components/Issues.tsx` | cross-repo issue table with state transitions |
| `src/tui/components/Tools.tsx` | the `doctor` report as a screen |
| `src/tui/components/Settings.tsx` | repos, concurrency, credential status |
| `tests/acceptance/m6.test.tsx` | one named test per M6 exit-criterion clause, two repos in one ledger |

## File structure

```
docs/specs/
  design.md                       MODIFIED  §10.5 rows, §10.7 new, §14, §16, §17, 19 labels
  index.md                        MODIFIED  plan-m6 row
  plan-m6.md                      NEW       this file
src/
  core/
    index.ts                      MODIFIED  stats, issue-query and action exports
    ledger/
      db.ts                       MODIFIED  Migration type with backfill
      schema.ts                   MODIFIED  migrations 3 and 4
      fingerprint.ts              MODIFIED  provenanceFingerprint
      issues.ts                   MODIFIED  stateOnUserAction, detectorSaysGone
      reconcile.ts                MODIFIED  closes on the shared predicate
      record.ts                   MODIFIED  stage metrics, stage timings, provenance fp
      stats.ts                    NEW       R8.9 + R7.6 queries
      issue-queries.ts            NEW       listIssues, setIssueState
    pipeline/run.ts               MODIFIED  stamps stage timings and metrics; records resolved provenance
    stages/outcome.ts             MODIFIED  reduceStageMetrics
    stages/types.ts               MODIFIED  StageResult gains metrics, startedAt, endedAt
  tui/
    app.tsx                       MODIFIED  screen routing, palette keys, view loading
    layout.ts                     MODIFIED  screenBodyRows
    store.ts                      MODIFIED  screen, palette, view data, filters
    views.ts                      MODIFIED  GantryViews port and SettingsView
    rows.ts                       NEW       pure row builders
    index.tsx                     MODIFIED  views prop
    components/
      Dashboard.tsx               NEW
      Issues.tsx                  NEW
      Tools.tsx                   NEW
      Settings.tsx                NEW
      Palette.tsx                 NEW
      Help.tsx                    MODIFIED  the new bindings
  cli/
    gantry-views.ts               NEW       the port's implementation
    tui-command.ts                MODIFIED  builds and passes the port
tests/
  specs/traceability.test.ts      NEW
  core/stage-metrics.test.ts      NEW
  core/provenance-fingerprint.test.ts NEW
  core/ledger-backfill.test.ts    NEW
  core/stats.test.ts              NEW
  core/issue-queries.test.ts      NEW
  cli/gantry-views.test.ts        NEW
  tui/palette.test.tsx            NEW
  tui/dashboard.test.tsx          NEW
  tui/issues.test.tsx             NEW
  tui/tools-settings.test.tsx     NEW
  tui/rows.test.ts                NEW
  tui/layout.test.tsx             MODIFIED  every screen at 80×24 and 50×14
  tui/store.test.ts               MODIFIED  the new actions
  helpers/fake-views.ts           NEW       a GantryViews stand-in
  helpers/ledger-fixture.ts       NEW       recorded runs across two repos
  acceptance/m6.test.tsx          NEW
```

---

## Tasks

### Task 1: Design §10.7, the missing satisfies labels, and R13.7's mechanical check

R13.7 has been recorded as a gap by M3, M4 and M5. M6 is where it closes, because M6 is the milestone that edits traceability anyway: §17's module row, a new §10.7, and the labels the check needs. Nothing else in this plan depends on the check passing, so it goes first and stays green.

**Files:**
- Create: `tests/specs/traceability.test.ts`
- Modify: `docs/specs/design.md` (new §10.7; §10.5, §14, §16, §17; 19 labels)
- Modify: `docs/specs/index.md` (the plan-m6 row)

**Interfaces:**
- Consumes: nothing.
- Produces: design §10.7 as the contract Tasks 4 and 5 implement; `stateOnUserAction`'s transition table as design §10.5 rows for Task 5.

- [ ] **Step 1: Write the failing check**

`tests/specs/traceability.test.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const ID = /^R\d+\.\d+[a-z]?$/
const RANGE = /^(R\d+\.\d+[a-z]?)[–-](R\d+\.\d+[a-z]?)$/
const GROUP = /^R(\d+)$/

/** Declaration order is the authority: `R6.1–R6.8` covers R6.9 because
    requirements.md declares R6.9 first, and a numeric expansion reports a
    gap that is not there. */
function declaredIds(requirements: string): string[] {
  return [...requirements.matchAll(/^- \*\*(R\d+\.\d+[a-z]?)\*\*/gm)].map((m) => m[1] as string)
}

function expand(token: string, ids: readonly string[]): string[] {
  const range = RANGE.exec(token)
  if (range) {
    const from = ids.indexOf(range[1] as string)
    const to = ids.indexOf(range[2] as string)
    if (from === -1 || to === -1 || to < from) throw new Error(`unresolvable range: ${token}`)
    return ids.slice(from, to + 1)
  }
  const group = GROUP.exec(token)
  if (group) return ids.filter((id) => id.startsWith(`R${group[1] as string}.`))
  if (!ID.test(token)) throw new Error(`unparsable requirement token: ${token}`)
  if (!ids.includes(token)) throw new Error(`unknown requirement: ${token}`)
  return [token]
}

/** A label may carry prose after its ids — §10.3 ends in a sentence and §6
    says `R9 dispatch` — so each comma-separated token contributes its first
    word only, trailing periods stripped. */
const tokensOf = (body: string): string[] =>
  body
    .split(',')
    .map((part) => (part.trim().split(/\s+/)[0] ?? '').replace(/\.+$/, ''))
    .filter((token) => token.length > 0)

describe('R13.7 traceability', () => {
  it('gives every requirement exactly one milestone owner', async () => {
    const requirements = await readFile('docs/specs/requirements.md', 'utf8')
    const ids = declaredIds(requirements)
    expect(ids.length).toBeGreaterThan(100)

    const owner = new Map<string, string>()
    const twice: string[] = []
    for (const row of requirements.matchAll(/^\| (M\d) \| ([^|]+) \|/gm)) {
      const milestone = row[1] as string
      for (const token of tokensOf(row[2] as string)) {
        for (const id of expand(token, ids)) {
          if (owner.has(id)) twice.push(`${id}: ${owner.get(id) as string} and ${milestone}`)
          owner.set(id, milestone)
        }
      }
    }

    expect(twice).toEqual([])
    expect(ids.filter((id) => !owner.has(id))).toEqual([])
  })

  it('has a design section claiming every requirement, and claims none that does not exist', async () => {
    const requirements = await readFile('docs/specs/requirements.md', 'utf8')
    const design = await readFile('docs/specs/design.md', 'utf8')
    const ids = declaredIds(requirements)

    const claimed = new Set<string>()
    for (const label of design.matchAll(/^\*Satisfies ([^*]+)\*/gm)) {
      for (const token of tokensOf(label[1] as string)) {
        for (const id of expand(token, ids)) claimed.add(id)
      }
    }

    expect(ids.filter((id) => !claimed.has(id))).toEqual([])
    expect([...claimed].filter((id) => !ids.includes(id))).toEqual([])
  })
})
```

- [ ] **Step 2: Run it and read the gap**

Run: `pnpm vitest run tests/specs/traceability.test.ts`
Expected: the ownership case PASSES (fact 4); the coverage case FAILS listing the 19 ids of fact 5.

- [ ] **Step 3: Write design §10.7**

Insert after §10.6 in `docs/specs/design.md`, before `## 11`:

```markdown
### 10.7 Statistics queries

*Satisfies R7.6, R8.9.*

`src/core/ledger/stats.ts` answers R8.9's five questions with SQL and nothing
else: no fs, no subprocess, no adapter registry. Every query takes the same
filter, so "this skill", "this repo" and "across every registered repo" are one
code path with a narrower `where` clause rather than three queries.

```ts
interface StatsFilter {
  skillId?: string
  repoId?: string
  /** R7.6: the run's provenance fingerprint, §10.2. */
  provenanceFp?: string
}
```

| R8.9 clause | Query | Source |
|---|---|---|
| stage pass rate | `stagePassRates` | `stages.outcome` grouped by `stages.stage` |
| eval case pass rate | `evalCaseRate` | `casesTotal` / `casesPassed` / `casesErrored` from `stages.metrics_json` where `stage = 'evaluate'` |
| wall-clock per stage | `stageWallClock` | `stages.ended_at − stages.started_at`, median and max |
| open issue counts by severity and rule class | `openIssueCounts` | `issues` in state `open` or `acknowledged`, grouped twice |
| run history | `runHistory` | `runs` newest first by run id |

`dashboard()` composes all five plus the three counts a header needs. Medians
and the metric sums are computed in TypeScript: SQLite has no median, and
summing JSON in SQL would put the metric key set in two places.

**Wall clock is the stage's own span, not its tools'.** `durationMs` is
deliberately absent from `stages.metrics_json`: fan-out tools run concurrently,
so summing their durations overstates the stage, and `started_at`/`ended_at`
is the one field that cannot. Stage rows recorded before this section existed
carried the *run's* span in those columns, so migration 3 nulls them — a wall
clock that silently averages a stage's span with its run's is worse than a gap
the query can report as one.

**Stage metrics are the sum of their tool runs' count-like metrics**, reduced by
`reduceStageMetrics` in `stages/outcome.ts` and stamped onto the `StageResult`
by the pipeline, in one place, so an aborted stage (§8.1 rows 3b and 3c) carries
them too.

**R7.6's grouping key is a fingerprint over provenance, not the provenance
blob.** `provenanceFingerprint()` in `ledger/fingerprint.ts` hashes a **fixed
field order** — base URL host, model mappings sorted by key, auth token hash,
analysis modes sorted by key — because `JSON.stringify` over an object would
make two identical provenances hash differently for having been built in a
different key order. It is stored on `runs.provenance_fp`, indexed, so a filter
is a `where` clause rather than a scan that parses every row's JSON. The
fingerprint covers `analysisModes` for the reason §7 gives: a mode change makes
statistics incomparable, so it must show up as a boundary exactly as a provider
change does.
```

- [ ] **Step 4: Add the nineteen labels**

Each requirement below is already implemented and described by the section that gains the label. Add or extend, exactly these:

| Section | Label becomes |
|---|---|
| §1 Shape of the system | `*Satisfies R1.1–R1.3.*` (new) |
| §4.1 Config schema | `*Satisfies R7.1, R7.2.*` (new), plus two sentences: credentials are read from a single `~/.skillgantry/.env` in the format the user supplied, and a mode more permissive than 600 is a warning |
| §6 Stage execution contract | `…, R4.10, R4.11, R5.1, R9 dispatch.` |
| §7 Adapter contract | `*Satisfies R1.5, R4.1–R4.5, R4.12.*` |
| §9 Sidecar layout | `*Satisfies R4.9, R6.1–R6.8, R7.4, R7.7.*` |
| §9.3 Secret handling | `*Satisfies R7.3, R7.4, R7.4a, R7.7.*` |
| §10.2 Provenance | `*Satisfies R7.5.*` (new) |
| §10.3 Finding identity | `*Satisfies R8.4, R8.6, R8.13. Supersedes the message-shape scheme in revision 1.*` |
| §10.6 Rule-map migration | `*Satisfies R8.14.*` (new) |
| §11 Run lifecycle | `…, R5.12–R5.14, R12.4, R13.2.*` |
| §16 Test strategy | `*Satisfies R13.3, R13.4, R13.6.*` |
| §17 Traceability | `*Satisfies R13.7.*` (new) |

- [ ] **Step 5: Add §10.5's user rows, §14's screens, §16's rows and §17's modules**

In §10.5's table, after the `open | user marks wontfix` row:

```markdown
| `acknowledged` | user marks wontfix | `wontfix` | triage may harden after the fact |
| `fixed` | user marks wontfix | `wontfix` | suppresses a recurrence before it happens |
| `acknowledged` | user reopens | `open` | undoes an acknowledgement |
| `wontfix` | user reopens | `open` | the only way back out of a suppression |
| `fixed` | user reopens | `open` | re-triage without waiting for a redetection |
```

In §14, after the `Screens:` paragraph:

```markdown
The palette is the screen switcher: `:` opens it, typing filters the command
list, `enter` runs the selection and `esc` cancels. Direct keys were rejected
because Work already spends `1`–`4` on its output panels, and a second digit
scheme reading differently per screen is how a keymap becomes unguessable.
`esc` on any screen other than Work returns to Work.

Dashboard, Issues, Tools and Settings each render one `Panel` whose body is
windowed against `layout.rows` by `screenBodyRows()`, so §14.1's four rules
hold on them the way they hold on Work and on help. Dashboard, Tools and
Settings build their bodies as a flat list of rows through pure functions in
`src/tui/rows.ts`, which is what lets the row budget be asserted without
rendering Ink.
```

In §16's table, four rows:

```markdown
| Statistics queries | In-memory SQLite, runs recorded across two repos; each R8.9 clause per skill, per repo and unfiltered; the same set filtered by provenance fingerprint | R8.9 is answerable at all, and R7.6 splits the numbers rather than reordering them |
| Issue queries and user transitions | `listIssues` across two repos with each filter; every row of §10.5's user-action rows; `blockedBy` against a two-detector issue where one has reported absence | Triage cannot invent a transition the state machine forbids; the blocking detector is the one `reconcile` would close on |
| Traceability | `tests/specs/traceability.test.ts` parses both documents | R13.7: a requirement owned twice, owned never, claimed by no section, or claimed and absent fails the build |
| Screen row budget | Every screen rendered at 80×24 and 50×14 | §14.1's first rule on four new full-screen views |
```

In §17's module table, the M6 row:

```markdown
| M6 | `ledger/stats.ts`, `ledger/issue-queries.ts`, Dashboard, Issues, Tools and Settings screens, the command palette, `tui/rows.ts`, the `GantryViews` port |
```

- [ ] **Step 6: Add the plan to the index**

In `docs/specs/index.md`, replace the line `M6 (dashboard) has no plan document yet.` with a table row after plan-m5's:

```markdown
| [plan-m6.md](plan-m6.md) | M6 | In progress | Statistics queries, Dashboard, Issues, Tools and Settings screens, the command palette |
```

- [ ] **Step 7: Run the check green**

Run: `pnpm vitest run tests/specs/traceability.test.ts`
Expected: both cases PASS.

- [ ] **Step 8: Commit**

```bash
git add docs/specs/design.md docs/specs/index.md docs/specs/plan-m6.md tests/specs/traceability.test.ts
git commit -m "docs: specify M6's statistics queries and check requirement traceability mechanically"
```

---

### Task 2: Per-stage timings and stage metrics

Facts 1 and 2. Two columns the schema has always had and the recorder has always filled with something else.

**Files:**
- Modify: `src/core/stages/types.ts` (`StageResult`)
- Modify: `src/core/stages/outcome.ts` (`reduceStageMetrics`)
- Modify: `src/core/pipeline/run.ts` (stamp, in one place)
- Modify: `src/core/ledger/record.ts` (write what it is given)
- Modify: `src/core/ledger/schema.ts` (migration 3)
- Create: `tests/core/stage-metrics.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `reduceStageMetrics(toolRuns: readonly ToolRunRecord[]): Metrics`; `StageResult` gains `metrics?: Metrics`, `startedAt?: string`, `endedAt?: string`; `stages.metrics_json` holds summed counts and `stages.started_at`/`ended_at` hold the stage's own ISO span. Task 4 reads all three.

- [ ] **Step 1: Write the failing tests**

`tests/core/stage-metrics.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { openLedger } from '../../src/core/ledger/db.js'
import { recordRun } from '../../src/core/ledger/record.js'
import { reduceStageMetrics } from '../../src/core/stages/outcome.js'
import type { ToolRunRecord } from '../../src/core/stages/types.js'
import { skillFixture } from '../helpers/ledger-fixture.js'

const toolRun = (toolId: string, metrics: ToolRunRecord['metrics']): ToolRunRecord => ({
  toolId,
  toolVersion: '1.0.0',
  outcome: 'passed',
  exitCode: 0,
  durationMs: 1_000,
  errorKind: null,
  artefactDir: `/tmp/${toolId}`,
  findings: [],
  metrics,
  summary: '',
})

describe('reduceStageMetrics', () => {
  it('sums count-like metrics across the stages tool runs', () => {
    const metrics = reduceStageMetrics([
      toolRun('skill-up', { casesTotal: 6, casesPassed: 4, casesErrored: 1 }),
      toolRun('other', { casesTotal: 2, casesPassed: 2 }),
    ])
    expect(metrics).toEqual({ casesTotal: 8, casesPassed: 6, casesErrored: 1 })
  })

  it('drops durationMs, because concurrent fan-out tools do not add up to a stage', () => {
    const metrics = reduceStageMetrics([
      toolRun('a', { durationMs: 5_000, findingsTotal: 1 }),
      toolRun('b', { durationMs: 4_000, findingsTotal: 2 }),
    ])
    expect(metrics).toEqual({ findingsTotal: 3 })
  })
})

describe('recordRun stage columns', () => {
  it('writes the stages own span and metrics, not the runs', () => {
    const ledger = openLedger(':memory:')
    recordRun(ledger, {
      skill: skillFixture('repo', 'sk'),
      runId: '019283af-0000-7000-8000-000000000001',
      trigger: 'test',
      startedAt: '2026-08-03T10:00:00.000Z',
      endedAt: '2026-08-03T10:00:30.000Z',
      outcome: 'passed',
      skillDigest: 'sha256:abc',
      git: { commit: null, dirty: false },
      provenanceJson: '{}',
      toolLockJson: '{}',
      sidecarPath: '/tmp/run',
      stages: [
        {
          stage: 'evaluate',
          outcome: 'passed',
          verdict: 'passed',
          startedAt: '2026-08-03T10:00:05.000Z',
          endedAt: '2026-08-03T10:00:11.000Z',
          metrics: { casesTotal: 4, casesPassed: 4 },
          toolRuns: [],
        },
      ],
    })

    const row = ledger.db
      .prepare('select started_at, ended_at, metrics_json from stages')
      .get() as { started_at: string; ended_at: string; metrics_json: string }
    expect(row.started_at).toBe('2026-08-03T10:00:05.000Z')
    expect(row.ended_at).toBe('2026-08-03T10:00:11.000Z')
    expect(JSON.parse(row.metrics_json)).toEqual({ casesTotal: 4, casesPassed: 4 })
    ledger.close()
  })

  it('leaves both columns null when the stage carried no span', () => {
    const ledger = openLedger(':memory:')
    recordRun(ledger, {
      skill: skillFixture('repo', 'sk'),
      runId: '019283af-0000-7000-8000-000000000002',
      trigger: 'test',
      startedAt: 'now',
      endedAt: 'now',
      outcome: 'passed',
      skillDigest: 'sha256:abc',
      git: { commit: null, dirty: false },
      provenanceJson: '{}',
      toolLockJson: '{}',
      sidecarPath: '/tmp/run',
      stages: [{ stage: 'validate', outcome: 'passed', verdict: 'passed', toolRuns: [] }],
    })
    const row = ledger.db.prepare('select started_at, ended_at from stages').get() as {
      started_at: string | null
      ended_at: string | null
    }
    expect(row.started_at).toBeNull()
    expect(row.ended_at).toBeNull()
    ledger.close()
  })
})
```

- [ ] **Step 2: Write the shared skill fixture the test imports**

`tests/helpers/ledger-fixture.ts` — the two-repo recorder Tasks 4, 5, 6 and 12 all reuse. This step writes only `skillFixture`; Task 4 extends the file.

```ts
import { workspacePath } from '../../src/core/discovery/discover.js'
import type { SkillRef } from '../../src/core/types.js'

export function skillFixture(repoId: string, name: string): SkillRef {
  return {
    id: `${repoId}/${name}`,
    name,
    version: '1.0.0',
    dir: `/${repoId}/${name}`,
    relPath: name,
    repo: { id: repoId, path: `/${repoId}`, name: repoId, isGit: false },
    rootSkill: false,
    workspacePath: workspacePath(`/${repoId}`, name, false),
    deprecated: false,
    supersededBy: null,
  }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run tests/core/stage-metrics.test.ts`
Expected: FAIL — `reduceStageMetrics` is not exported, and the recorder writes the run's times.

- [ ] **Step 4: Widen `StageResult`**

In `src/core/stages/types.ts`:

```ts
export interface StageResult {
  stage: Stage
  outcome: StageOutcome
  verdict: 'passed' | 'failed'
  toolRuns: ToolRunRecord[]
  /**
   * All three are stamped by the pipeline after the stage settles, in one
   * place, so an aborted stage (§8.1 rows 3b and 3c) carries them too rather
   * than each executor remembering to. Absent means "not recorded" and reaches
   * the ledger as null: a stage span defaulted to the run's is the lie
   * migration 3 exists to delete.
   */
  metrics?: Metrics
  startedAt?: string
  endedAt?: string
}
```

- [ ] **Step 5: Add `reduceStageMetrics`**

Append to `src/core/stages/outcome.ts`:

```ts
/**
 * A stage's metrics are the sum of its tool runs' count-like metrics.
 *
 * `durationMs` is dropped rather than summed: fan-out tools run concurrently,
 * so their durations added together overstate the stage, and
 * `stages.started_at`/`ended_at` is the one field that cannot.
 */
export function reduceStageMetrics(toolRuns: readonly ToolRunRecord[]): Metrics {
  const out: Metrics = {}
  for (const run of toolRuns) {
    for (const [key, value] of Object.entries(run.metrics) as [MetricKey, number][]) {
      if (key === 'durationMs') continue
      out[key] = (out[key] ?? 0) + value
    }
  }
  return out
}
```

Add `MetricKey`, `Metrics` and `ToolRunRecord` to the file's type imports.

- [ ] **Step 6: Stamp in the pipeline, once**

In `src/core/pipeline/run.ts`, inside the stage loop: capture the start immediately before `executor.plan(ctx0)`, and stamp immediately before `writeStageJson`. Both the `openFailure` early-exit branch and the normal path go through the same helper.

```ts
      const stageStartedAt = nowIso()
```

```ts
      // Stamped here rather than in each executor: `abortedStage` builds a
      // StageResult too, and three call sites remembering to fill the same
      // three fields is three chances for a stage to reach the ledger with a
      // span that is not its own.
      const stamp = (settled: StageResult): StageResult => ({
        ...settled,
        metrics: reduceStageMetrics(settled.toolRuns),
        startedAt: stageStartedAt,
        endedAt: nowIso(),
      })
```

Apply it to both `result` assignments before `writeStageJson(stageDir, …)`, and to the `openFailure` branch's `abortedStage(...)` result.

- [ ] **Step 7: Write what the recorder is given**

In `src/core/ledger/record.ts`, the `stages` insert:

```ts
      ).run(
        input.runId,
        stage.stage,
        stage.outcome,
        stage.verdict,
        stage.startedAt ?? null,
        stage.endedAt ?? null,
        JSON.stringify(stage.metrics ?? {}),
      )
```

- [ ] **Step 8: Delete the old lie**

Append migration 3 to `src/core/ledger/schema.ts`'s array:

```ts
  `
  -- Every stage row written before this migration carried the *run's* span in
  -- these two columns, so a wall-clock query would report each stage of a run
  -- as taking the whole run. A gap the query can report is better than an
  -- average of two different measurements, so the wrong values go.
  update stages set started_at = null, ended_at = null;
  `,
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm vitest run tests/core/stage-metrics.test.ts tests/core/pipeline.test.ts tests/core/ledger-db.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/core/stages src/core/pipeline/run.ts src/core/ledger tests/core/stage-metrics.test.ts tests/helpers/ledger-fixture.ts
git commit -m "feat: record each stage's own span and its tools' summed metrics"
```

---

### Task 3: The provenance fingerprint, its column, and the backfill

Fact 3 and fact 10. R7.6 needs one indexed key per run.

**Files:**
- Modify: `src/core/ledger/fingerprint.ts` (`provenanceFingerprint`)
- Modify: `src/core/ledger/db.ts` (`Migration` with `backfill`)
- Modify: `src/core/ledger/schema.ts` (migration 4)
- Modify: `src/core/ledger/record.ts` (write the column)
- Modify: `src/core/pipeline/run.ts` (record the *resolved* provenance)
- Create: `tests/core/provenance-fingerprint.test.ts`, `tests/core/ledger-backfill.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `provenanceFingerprint(p: ProvenanceLike): string` (12 hex chars); `runs.provenance_fp` populated for every run, old and new; `Migration = { sql: string; backfill?: (db: DatabaseSync) => void }`. Task 4 filters on the column.

- [ ] **Step 1: Write the failing fingerprint tests**

`tests/core/provenance-fingerprint.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { provenanceFingerprint } from '../../src/core/ledger/fingerprint.js'

const base = {
  baseUrlHost: 'api.deepseek.com',
  models: { ANTHROPIC_MODEL: 'a', ANTHROPIC_DEFAULT_OPUS_MODEL: 'b' },
  authTokenHash: 'sha256:1a2b3c4d',
  analysisModes: { skillspector: 'static' },
}

describe('provenanceFingerprint', () => {
  it('is stable across key insertion order', () => {
    const reordered = {
      analysisModes: { skillspector: 'static' },
      authTokenHash: 'sha256:1a2b3c4d',
      models: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'b', ANTHROPIC_MODEL: 'a' },
      baseUrlHost: 'api.deepseek.com',
    }
    expect(provenanceFingerprint(reordered)).toBe(provenanceFingerprint(base))
  })

  it('changes when a model mapping changes', () => {
    const other = { ...base, models: { ...base.models, ANTHROPIC_MODEL: 'z' } }
    expect(provenanceFingerprint(other)).not.toBe(provenanceFingerprint(base))
  })

  it('changes when a tool changes analysis mode — R4.2b', () => {
    const other = { ...base, analysisModes: { skillspector: 'llm' } }
    expect(provenanceFingerprint(other)).not.toBe(provenanceFingerprint(base))
  })

  it('tolerates an absent field, so an older stored provenance still hashes', () => {
    expect(provenanceFingerprint({}).length).toBe(12)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/core/provenance-fingerprint.test.ts`
Expected: FAIL with "provenanceFingerprint is not a function".

- [ ] **Step 3: Implement it**

Append to `src/core/ledger/fingerprint.ts`:

```ts
/**
 * Structural, not `Provenance` itself: the ledger depends on `adapters` and on
 * nothing else in the engine (design §3), and a value import of `config/env`
 * would make it depend on config to compute a hash.
 */
export interface ProvenanceLike {
  baseUrlHost?: string | null
  models?: Record<string, string | null>
  authTokenHash?: string | null
  analysisModes?: Record<string, string>
}

const sorted = (obj: Record<string, string | null> | undefined): [string, string | null][] =>
  Object.entries(obj ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

/**
 * R7.6's grouping key. Hashed over a **fixed field order** with both maps
 * sorted, because `JSON.stringify` of the object would hash two identical
 * provenances differently for having been built in a different key order — and
 * a grouping key that depends on construction order groups nothing.
 */
export function provenanceFingerprint(p: ProvenanceLike): string {
  const canonical = JSON.stringify([
    p.baseUrlHost ?? null,
    sorted(p.models),
    p.authTokenHash ?? null,
    sorted(p.analysisModes as Record<string, string | null> | undefined),
  ])
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12)
}
```

- [ ] **Step 4: Write the failing backfill test**

`tests/core/ledger-backfill.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { openLedger } from '../../src/core/ledger/db.js'
import { provenanceFingerprint } from '../../src/core/ledger/fingerprint.js'

const PROVENANCE = {
  baseUrlHost: 'api.deepseek.com',
  models: { ANTHROPIC_MODEL: 'a' },
  authTokenHash: 'sha256:dead',
  analysisModes: {},
}

describe('provenance_fp backfill', () => {
  it('fingerprints runs a previous version recorded without the column', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sg-backfill-'))
    const path = join(dir, 'gantry.db')

    // A ledger at schema version 3: every table, no provenance_fp.
    const seed = new DatabaseSync(path)
    seed.exec('create table schema_version (version integer primary key)')
    for (const version of [1, 2, 3]) {
      seed.prepare('insert into schema_version (version) values (?)').run(version)
    }
    seed.exec(`
      create table runs (id text primary key, skill_id text, trigger text,
        started_at text, ended_at text, outcome text, skill_digest text,
        git_commit text, git_dirty integer, provenance_json text,
        tool_lock_json text, sidecar_path text);
    `)
    seed
      .prepare(
        `insert into runs (id, skill_id, trigger, started_at, skill_digest,
                           provenance_json, sidecar_path)
         values ('r1', 'repo/sk', 'test', 'now', 'sha256:a', ?, '/tmp/r1')`,
      )
      .run(JSON.stringify(PROVENANCE))
    seed.close()

    const ledger = openLedger(path)
    const row = ledger.db.prepare('select provenance_fp as fp from runs').get() as { fp: string }
    expect(row.fp).toBe(provenanceFingerprint(PROVENANCE))
    ledger.close()
  })
})
```

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm vitest run tests/core/ledger-backfill.test.ts`
Expected: FAIL — no such column: provenance_fp.

- [ ] **Step 6: Give a migration a backfill**

`src/core/ledger/db.ts`:

```ts
export interface Migration {
  sql: string
  /**
   * Runs in the same version step, after the DDL. For data no query can
   * compute: the provenance fingerprint is a sha256, and SQLite ships no hash
   * function, so the alternative was leaving every pre-existing run outside
   * R7.6's grouping forever.
   */
  backfill?: (db: DatabaseSync) => void
}
```

```ts
  for (let i = applied; i < MIGRATIONS.length; i += 1) {
    const migration = MIGRATIONS[i] as Migration
    db.exec(migration.sql)
    migration.backfill?.(db)
    db.prepare('insert into schema_version (version) values (?)').run(i + 1)
  }
```

- [ ] **Step 7: Convert the array and add migration 4**

In `src/core/ledger/schema.ts`, change the export to `export const MIGRATIONS: readonly Migration[]`, wrap each existing string as `{ sql: \`…\` }`, and append:

```ts
  {
    sql: `
    -- R7.6. Indexed rather than derived at read time: a filter that parses
    -- every row's provenance_json cannot be pushed into the joins the stats
    -- queries do against stages and issues.
    alter table runs add column provenance_fp text;
    create index if not exists idx_runs_provenance on runs(provenance_fp);
    `,
    backfill: (db) => {
      const rows = db.prepare('select id, provenance_json from runs').all() as Array<{
        id: string
        provenance_json: string | null
      }>
      const update = db.prepare('update runs set provenance_fp = ? where id = ?')
      for (const row of rows) {
        let parsed: ProvenanceLike = {}
        try {
          parsed = (JSON.parse(row.provenance_json ?? '{}') ?? {}) as ProvenanceLike
        } catch {
          // A row whose provenance never parsed is fingerprinted as empty
          // rather than skipped: a null column would silently drop the run
          // from every grouped view, which reads as "this run never happened".
        }
        update.run(provenanceFingerprint(parsed), row.id)
      }
    },
  },
```

- [ ] **Step 8: Write the column on every new run**

In `src/core/ledger/record.ts`: add `provenance_fp` to the `runs` insert column list and bind `provenanceFingerprint(JSON.parse(input.provenanceJson) as ProvenanceLike)`.

```ts
    // Derived here rather than taken as a parameter, so the stored JSON and the
    // key runs are grouped by can never describe different provenances.
    const provenanceFp = provenanceFingerprint(
      JSON.parse(input.provenanceJson) as ProvenanceLike,
    )
```

- [ ] **Step 9: Record the resolved provenance**

In `src/core/pipeline/run.ts`, hoist the value `run.json` already gets and give the ledger the same one:

```ts
    // One object for both sinks. run.json got the resolved provenance and the
    // ledger got the bare one, so a fingerprint over the ledger's copy could
    // not see the analysis-mode boundary R4.2b exists to make visible.
    const provenance = withAnalysisModes(input.provenance, analysisModes)
```

Use it in `writeRunJson` and in `recordRun`'s `provenanceJson: JSON.stringify(provenance)`.

- [ ] **Step 10: Run the tests to verify they pass**

Run: `pnpm vitest run tests/core/provenance-fingerprint.test.ts tests/core/ledger-backfill.test.ts tests/core/ledger-db.test.ts tests/core/pipeline.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/core/ledger src/core/pipeline/run.ts tests/core/provenance-fingerprint.test.ts tests/core/ledger-backfill.test.ts
git commit -m "feat: fingerprint each run's provenance and group runs by it"
```

---

### Task 4: `stats.ts` — the five R8.9 query families

Design §10.7 is the contract. Pure SQL plus arithmetic; no fs, no subprocess, no registry.

**Files:**
- Create: `src/core/ledger/stats.ts`
- Modify: `tests/helpers/ledger-fixture.ts` (the two-repo recorder)
- Create: `tests/core/stats.test.ts`
- Modify: `src/core/index.ts` (exports)

**Interfaces:**
- Consumes: `stages.metrics_json`, `stages.started_at`/`ended_at` (Task 2), `runs.provenance_fp` (Task 3).
- Produces: `dashboard(db, filter, historyLimit?): DashboardStats`, `provenanceOptions(db): ProvenanceOption[]`, and the five family functions. Task 6 calls both through the port; Task 8 renders `DashboardStats`.

- [ ] **Step 1: Extend the fixture recorder**

Append to `tests/helpers/ledger-fixture.ts`:

```ts
import { openLedger, type Ledger } from '../../src/core/ledger/db.js'
import { recordRun } from '../../src/core/ledger/record.js'
import type { Metrics, RawFinding, Stage, StageOutcome } from '../../src/core/types.js'

export interface StageSpec {
  stage: Stage
  outcome: StageOutcome
  /** Whole seconds of stage wall clock. */
  seconds?: number
  metrics?: Metrics
  findings?: RawFinding[]
  toolId?: string
}

export interface RunSpec {
  runId: string
  skill: ReturnType<typeof skillFixture>
  stages: StageSpec[]
  provenance?: Record<string, unknown>
  digest?: string
}

/** Sequential ISO instants, so wall clock and run order are both assertable. */
const at = (offset: number): string => new Date(Date.UTC(2026, 7, 3, 10, 0, offset)).toISOString()

export function recordFixtureRun(ledger: Ledger, spec: RunSpec): void {
  let clock = 0
  recordRun(ledger, {
    skill: spec.skill,
    runId: spec.runId,
    trigger: 'test',
    startedAt: at(0),
    endedAt: at(60),
    outcome: spec.stages.at(-1)?.outcome ?? 'passed',
    skillDigest: spec.digest ?? 'sha256:abc',
    git: { commit: null, dirty: false },
    provenanceJson: JSON.stringify(spec.provenance ?? {}),
    toolLockJson: '{}',
    sidecarPath: `/tmp/${spec.runId}`,
    stages: spec.stages.map((stage) => {
      const startedAt = at(clock)
      clock += stage.seconds ?? 1
      return {
        stage: stage.stage,
        outcome: stage.outcome,
        verdict: stage.outcome === 'failed' ? ('failed' as const) : ('passed' as const),
        startedAt,
        endedAt: at(clock),
        metrics: stage.metrics ?? {},
        toolRuns: [
          {
            toolId: stage.toolId ?? 'skillspector',
            toolVersion: '2.5.1',
            outcome: stage.outcome === 'failed' ? ('failed' as const) : ('passed' as const),
            exitCode: 0,
            durationMs: (stage.seconds ?? 1) * 1000,
            errorKind: null,
            artefactDir: `/tmp/${spec.runId}/${stage.stage}`,
            findings: stage.findings ?? [],
            metrics: {},
            summary: '',
          },
        ],
      }
    }),
  })
}

export const memoryLedger = (): Ledger => openLedger(':memory:')
```

- [ ] **Step 2: Write the failing tests**

`tests/core/stats.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { provenanceFingerprint } from '../../src/core/ledger/fingerprint.js'
import { dashboard, provenanceOptions } from '../../src/core/ledger/stats.js'
import { memoryLedger, recordFixtureRun, skillFixture } from '../helpers/ledger-fixture.js'

const ALPHA = skillFixture('alpha', 'declawed')
const BETA = skillFixture('beta', 'spec-lint')
const P1 = { baseUrlHost: 'api.deepseek.com', models: {}, authTokenHash: null, analysisModes: {} }
const P2 = { baseUrlHost: 'api.anthropic.com', models: {}, authTokenHash: null, analysisModes: {} }

const finding = (path: string, ruleClass: string, severity: 'high' | 'low') => ({
  ruleClass: ruleClass as never,
  nativeRuleId: 'X1',
  severity,
  path,
  message: 'm',
})

function seeded() {
  const ledger = memoryLedger()
  recordFixtureRun(ledger, {
    runId: '019283af-0000-7000-8000-000000000001',
    skill: ALPHA,
    provenance: P1,
    stages: [
      { stage: 'validate', outcome: 'passed', seconds: 2 },
      {
        stage: 'evaluate',
        outcome: 'passed',
        seconds: 10,
        metrics: { casesTotal: 6, casesPassed: 5, casesErrored: 0 },
      },
      {
        stage: 'security',
        outcome: 'failed',
        seconds: 4,
        findings: [finding('declawed/SKILL.md', 'prompt-injection', 'high')],
      },
    ],
  })
  recordFixtureRun(ledger, {
    runId: '019283af-0000-7000-8000-000000000002',
    skill: BETA,
    provenance: P2,
    stages: [
      { stage: 'validate', outcome: 'failed', seconds: 6 },
      {
        stage: 'evaluate',
        outcome: 'passed',
        seconds: 20,
        metrics: { casesTotal: 4, casesPassed: 2, casesErrored: 1 },
      },
    ],
  })
  return ledger
}

describe('dashboard — R8.9 across every registered repo', () => {
  it('counts repos, skills and runs across both repos', () => {
    const stats = dashboard(seeded().db, {})
    expect(stats).toMatchObject({ repos: 2, skills: 2, runs: 2 })
  })

  it('reports stage pass rate per stage', () => {
    const stats = dashboard(seeded().db, {})
    expect(stats.stagePassRates).toEqual(
      expect.arrayContaining([
        { stage: 'validate', runs: 2, passed: 1, rate: 0.5 },
        { stage: 'evaluate', runs: 2, passed: 2, rate: 1 },
        { stage: 'security', runs: 1, passed: 0, rate: 0 },
      ]),
    )
  })

  it('reports eval case pass rate from the stage metrics', () => {
    const stats = dashboard(seeded().db, {})
    expect(stats.evalCases).toEqual({
      casesTotal: 10,
      casesPassed: 7,
      casesErrored: 1,
      rate: 0.7,
    })
  })

  it('reports wall clock per stage from the stages own span', () => {
    const stats = dashboard(seeded().db, {})
    const evaluate = stats.wallClock.find((row) => row.stage === 'evaluate')
    expect(evaluate).toEqual({ stage: 'evaluate', runs: 2, medianMs: 15_000, maxMs: 20_000 })
  })

  it('counts open issues by severity and by rule class', () => {
    const stats = dashboard(seeded().db, {})
    expect(stats.openBySeverity).toEqual([{ severity: 'high', count: 1 }])
    expect(stats.openByRuleClass).toEqual([{ ruleClass: 'prompt-injection', count: 1 }])
  })

  it('lists run history newest first', () => {
    const stats = dashboard(seeded().db, {})
    expect(stats.history.map((row) => row.skillId)).toEqual(['beta/spec-lint', 'alpha/declawed'])
  })

  it('narrows to one skill', () => {
    const stats = dashboard(seeded().db, { skillId: 'alpha/declawed' })
    expect(stats.runs).toBe(1)
    expect(stats.evalCases.casesTotal).toBe(6)
  })

  it('narrows to one repo', () => {
    const stats = dashboard(seeded().db, { repoId: 'beta' })
    expect(stats.runs).toBe(1)
    expect(stats.stagePassRates.find((row) => row.stage === 'validate')?.passed).toBe(0)
  })
})

describe('provenance grouping — R7.6', () => {
  it('lists one option per distinct fingerprint with its run count', () => {
    const options = provenanceOptions(seeded().db)
    expect(options).toHaveLength(2)
    expect(options.map((option) => option.baseUrlHost).sort()).toEqual([
      'api.anthropic.com',
      'api.deepseek.com',
    ])
    expect(options.every((option) => option.runs === 1)).toBe(true)
  })

  it('filters every statistic by fingerprint', () => {
    const stats = dashboard(seeded().db, { provenanceFp: provenanceFingerprint(P1) })
    expect(stats.runs).toBe(1)
    expect(stats.evalCases.casesTotal).toBe(6)
    // The issue's last_seen_run belongs to the P1 run, so it survives the filter.
    expect(stats.openBySeverity).toEqual([{ severity: 'high', count: 1 }])
  })

  it('excludes an issue whose last sighting was under another provenance', () => {
    const stats = dashboard(seeded().db, { provenanceFp: provenanceFingerprint(P2) })
    expect(stats.openBySeverity).toEqual([])
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run tests/core/stats.test.ts`
Expected: FAIL — cannot resolve `src/core/ledger/stats.js`.

- [ ] **Step 4: Implement the module**

`src/core/ledger/stats.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite'
import { STAGE_ORDER } from '../workspace/layout.js'
import type { Severity, Stage } from '../types.js'
import type { ProvenanceLike } from './fingerprint.js'

export interface StatsFilter {
  skillId?: string
  repoId?: string
  /** R7.6. */
  provenanceFp?: string
}

export interface StagePassRate {
  stage: Stage
  runs: number
  passed: number
  /** 0–1. `runs` is always > 0 for a row that exists, so this never divides by zero. */
  rate: number
}

export interface StageWallClock {
  stage: Stage
  runs: number
  medianMs: number | null
  maxMs: number | null
}

export interface EvalCaseRate {
  casesTotal: number
  casesPassed: number
  casesErrored: number
  /** null when no evaluate stage has recorded a case, which is not the same as 0. */
  rate: number | null
}

export interface SeverityCount {
  severity: Severity
  count: number
}

export interface RuleClassCount {
  ruleClass: string
  count: number
}

export interface RunHistoryRow {
  runId: string
  skillId: string
  repoId: string
  outcome: string
  startedAt: string
  endedAt: string | null
  provenanceFp: string | null
}

export interface ProvenanceOption {
  fingerprint: string
  baseUrlHost: string | null
  /** The first model mapping, which is what identifies a profile on one row. */
  model: string | null
  analysisModes: string
  runs: number
  firstSeen: string
  lastSeen: string
}

export interface DashboardStats {
  repos: number
  skills: number
  runs: number
  stagePassRates: StagePassRate[]
  wallClock: StageWallClock[]
  evalCases: EvalCaseRate
  openBySeverity: SeverityCount[]
  openByRuleClass: RuleClassCount[]
  history: RunHistoryRow[]
}

/** One filter, three narrowings, so "across every repo" is the same code path. */
function runScope(filter: StatsFilter): { sql: string; params: string[] } {
  const clauses: string[] = []
  const params: string[] = []
  if (filter.skillId !== undefined) {
    clauses.push('r.skill_id = ?')
    params.push(filter.skillId)
  }
  if (filter.repoId !== undefined) {
    clauses.push('k.repo_id = ?')
    params.push(filter.repoId)
  }
  if (filter.provenanceFp !== undefined) {
    clauses.push('r.provenance_fp = ?')
    params.push(filter.provenanceFp)
  }
  return { sql: clauses.length === 0 ? '' : `and ${clauses.join(' and ')}`, params }
}

/**
 * An issue is not a run, so the provenance filter reaches it through its last
 * sighting: "issues as of the runs that used this provider". Dropping the
 * clause instead would show one provider's numbers beside every provider's
 * issues, which is the comparison R7.6 exists to make possible.
 */
function issueScope(filter: StatsFilter): { sql: string; params: string[] } {
  const clauses: string[] = []
  const params: string[] = []
  if (filter.skillId !== undefined) {
    clauses.push('i.skill_id = ?')
    params.push(filter.skillId)
  }
  if (filter.repoId !== undefined) {
    clauses.push('k.repo_id = ?')
    params.push(filter.repoId)
  }
  if (filter.provenanceFp !== undefined) {
    clauses.push(
      `exists (select 1 from runs r2
                where r2.id = i.last_seen_run and r2.provenance_fp = ?)`,
    )
    params.push(filter.provenanceFp)
  }
  return { sql: clauses.length === 0 ? '' : `and ${clauses.join(' and ')}`, params }
}

const STAGE_JOIN = `from stages s
   join runs r on r.id = s.run_id
   join skills k on k.id = r.skill_id
  where 1 = 1`

export function stagePassRates(db: DatabaseSync, filter: StatsFilter): StagePassRate[] {
  const scope = runScope(filter)
  const rows = db
    .prepare(
      `select s.stage as stage, count(*) as runs,
              sum(case when s.outcome = 'passed' then 1 else 0 end) as passed
         ${STAGE_JOIN} ${scope.sql}
        group by s.stage`,
    )
    .all(...scope.params) as Array<{ stage: string; runs: number; passed: number }>

  return STAGE_ORDER.flatMap((stage) => {
    const row = rows.find((candidate) => candidate.stage === stage)
    return row === undefined
      ? []
      : [{ stage, runs: row.runs, passed: row.passed, rate: row.passed / row.runs }]
  })
}

/** Median in TypeScript: SQLite has no percentile function. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
}

export function stageWallClock(db: DatabaseSync, filter: StatsFilter): StageWallClock[] {
  const scope = runScope(filter)
  const rows = db
    .prepare(
      `select s.stage as stage,
              cast(round((julianday(s.ended_at) - julianday(s.started_at)) * 86400000) as integer) as ms
         ${STAGE_JOIN}
           and s.started_at is not null and s.ended_at is not null ${scope.sql}`,
    )
    .all(...scope.params) as Array<{ stage: string; ms: number }>

  return STAGE_ORDER.flatMap((stage) => {
    const durations = rows.filter((row) => row.stage === stage).map((row) => row.ms)
    return durations.length === 0
      ? []
      : [
          {
            stage,
            runs: durations.length,
            medianMs: median(durations),
            maxMs: Math.max(...durations),
          },
        ]
  })
}

export function evalCaseRate(db: DatabaseSync, filter: StatsFilter): EvalCaseRate {
  const scope = runScope(filter)
  const rows = db
    .prepare(
      `select s.metrics_json as metrics
         ${STAGE_JOIN} and s.stage = 'evaluate' ${scope.sql}`,
    )
    .all(...scope.params) as Array<{ metrics: string | null }>

  const total = { casesTotal: 0, casesPassed: 0, casesErrored: 0 }
  for (const row of rows) {
    // Summed here rather than in SQL: the metric key set is a closed union in
    // one place (R1.5), and `json_extract` per key would be a second list of it.
    let metrics: Record<string, number> = {}
    try {
      metrics = (JSON.parse(row.metrics ?? '{}') ?? {}) as Record<string, number>
    } catch {
      continue
    }
    total.casesTotal += metrics.casesTotal ?? 0
    total.casesPassed += metrics.casesPassed ?? 0
    total.casesErrored += metrics.casesErrored ?? 0
  }
  return {
    ...total,
    rate: total.casesTotal === 0 ? null : total.casesPassed / total.casesTotal,
  }
}

const OPEN_STATES = `i.state in ('open', 'acknowledged')`

export function openIssueCounts(
  db: DatabaseSync,
  filter: StatsFilter,
): { bySeverity: SeverityCount[]; byRuleClass: RuleClassCount[] } {
  const scope = issueScope(filter)
  const join = `from issues i join skills k on k.id = i.skill_id where ${OPEN_STATES} ${scope.sql}`

  const bySeverity = db
    .prepare(
      `select i.severity_max as severity, count(*) as count ${join}
        group by i.severity_max
        order by case i.severity_max
                   when 'critical' then 5 when 'high' then 4 when 'medium' then 3
                   when 'low' then 2 else 1 end desc`,
    )
    .all(...scope.params) as SeverityCount[]

  const byRuleClass = db
    .prepare(
      `select i.rule_class as ruleClass, count(*) as count ${join}
        group by i.rule_class order by count desc, i.rule_class`,
    )
    .all(...scope.params) as RuleClassCount[]

  return { bySeverity, byRuleClass }
}

export function runHistory(
  db: DatabaseSync,
  filter: StatsFilter,
  limit = 20,
): RunHistoryRow[] {
  const scope = runScope(filter)
  return db
    .prepare(
      `select r.id as runId, r.skill_id as skillId, k.repo_id as repoId,
              r.outcome as outcome, r.started_at as startedAt, r.ended_at as endedAt,
              r.provenance_fp as provenanceFp
         from runs r join skills k on k.id = r.skill_id
        where 1 = 1 ${scope.sql}
        order by r.id desc limit ?`,
    )
    .all(...scope.params, limit) as RunHistoryRow[]
}

export function provenanceOptions(db: DatabaseSync): ProvenanceOption[] {
  const rows = db
    .prepare(
      `select provenance_fp as fingerprint, count(*) as runs,
              min(started_at) as firstSeen, max(started_at) as lastSeen,
              max(provenance_json) as sample
         from runs where provenance_fp is not null
        group by provenance_fp order by runs desc, lastSeen desc`,
    )
    .all() as Array<{
    fingerprint: string
    runs: number
    firstSeen: string
    lastSeen: string
    sample: string | null
  }>

  return rows.map((row) => {
    let parsed: ProvenanceLike = {}
    try {
      parsed = (JSON.parse(row.sample ?? '{}') ?? {}) as ProvenanceLike
    } catch {
      parsed = {}
    }
    const models = Object.values(parsed.models ?? {}).filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    )
    const modes = Object.entries(parsed.analysisModes ?? {})
      .map(([toolId, mode]) => `${toolId}:${mode}`)
      .sort()
      .join(' ')
    return {
      fingerprint: row.fingerprint,
      baseUrlHost: parsed.baseUrlHost ?? null,
      model: models[0] ?? null,
      analysisModes: modes,
      runs: row.runs,
      firstSeen: row.firstSeen,
      lastSeen: row.lastSeen,
    }
  })
}

export function dashboard(
  db: DatabaseSync,
  filter: StatsFilter,
  historyLimit = 20,
): DashboardStats {
  const scope = runScope(filter)
  const counts = db
    .prepare(
      `select count(distinct k.repo_id) as repos, count(distinct r.skill_id) as skills,
              count(*) as runs
         from runs r join skills k on k.id = r.skill_id
        where 1 = 1 ${scope.sql}`,
    )
    .get(...scope.params) as { repos: number; skills: number; runs: number }
  const open = openIssueCounts(db, filter)

  return {
    ...counts,
    stagePassRates: stagePassRates(db, filter),
    wallClock: stageWallClock(db, filter),
    evalCases: evalCaseRate(db, filter),
    openBySeverity: open.bySeverity,
    openByRuleClass: open.byRuleClass,
    history: runHistory(db, filter, historyLimit),
  }
}
```

- [ ] **Step 5: Export the types the TUI will need**

In `src/core/index.ts`:

```ts
export {
  dashboard,
  evalCaseRate,
  openIssueCounts,
  provenanceOptions,
  runHistory,
  stagePassRates,
  stageWallClock,
  type DashboardStats,
  type EvalCaseRate,
  type ProvenanceOption,
  type RuleClassCount,
  type RunHistoryRow,
  type SeverityCount,
  type StagePassRate,
  type StageWallClock,
  type StatsFilter,
} from './ledger/stats.js'
export { provenanceFingerprint, type ProvenanceLike } from './ledger/fingerprint.js'
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run tests/core/stats.test.ts && pnpm lint`
Expected: PASS, and lint clean (the boundary rules see a core module importing core only).

- [ ] **Step 7: Commit**

```bash
git add src/core/ledger/stats.ts src/core/index.ts tests/core/stats.test.ts tests/helpers/ledger-fixture.ts
git commit -m "feat: answer R8.9's statistics from the ledger, filterable by provenance"
```

---

### Task 5: `issue-queries.ts` and the user transitions

Facts 8 and 9. Cross-repo listing, plus the three user actions design §10.5 now states.

**Files:**
- Modify: `src/core/ledger/issues.ts` (`stateOnUserAction`, `detectorSaysGone`)
- Modify: `src/core/ledger/reconcile.ts` (close on the shared predicate)
- Create: `src/core/ledger/issue-queries.ts`
- Create: `tests/core/issue-queries.test.ts`
- Modify: `src/core/index.ts`

**Interfaces:**
- Consumes: `skillFixture`, `recordFixtureRun`, `memoryLedger` from Task 4's fixture.
- Produces: `listIssues(db, filter): IssueRow[]`, `setIssueState(db, fingerprint, action): IssueState | null`, `stateOnUserAction(current, action): IssueState | null`, `detectorSaysGone(row): boolean`, `type IssueAction = 'acknowledge' | 'wontfix' | 'reopen'`. Task 6 wraps both; Task 9 renders `IssueRow` and dispatches `IssueAction`.

- [ ] **Step 1: Write the failing tests**

`tests/core/issue-queries.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { listIssues, setIssueState } from '../../src/core/ledger/issue-queries.js'
import { stateOnUserAction } from '../../src/core/ledger/issues.js'
import { memoryLedger, recordFixtureRun, skillFixture } from '../helpers/ledger-fixture.js'

const ALPHA = skillFixture('alpha', 'declawed')
const BETA = skillFixture('beta', 'spec-lint')

const finding = (path: string, ruleClass: string, severity: 'high' | 'low', toolId = 'skillspector') => ({
  ruleClass: ruleClass as never,
  nativeRuleId: 'X1',
  severity,
  path,
  message: `${toolId} says so`,
})

function seeded() {
  const ledger = memoryLedger()
  recordFixtureRun(ledger, {
    runId: '019283af-0000-7000-8000-000000000001',
    skill: ALPHA,
    stages: [
      {
        stage: 'security',
        outcome: 'failed',
        findings: [finding('declawed/SKILL.md', 'prompt-injection', 'high')],
      },
    ],
  })
  recordFixtureRun(ledger, {
    runId: '019283af-0000-7000-8000-000000000002',
    skill: BETA,
    stages: [
      {
        stage: 'validate',
        outcome: 'failed',
        toolId: 'skill-lint',
        findings: [finding('spec-lint/SKILL.md', 'metadata-invalid', 'low', 'skill-lint')],
      },
    ],
  })
  return ledger
}

describe('stateOnUserAction — design §10.5', () => {
  it('acknowledges an open issue', () => {
    expect(stateOnUserAction('open', 'acknowledge')).toBe('acknowledged')
  })

  it('refuses to acknowledge a wontfix, which would read as un-suppressing it', () => {
    expect(stateOnUserAction('wontfix', 'acknowledge')).toBeNull()
  })

  it('marks any live or closed issue wontfix', () => {
    expect(stateOnUserAction('open', 'wontfix')).toBe('wontfix')
    expect(stateOnUserAction('acknowledged', 'wontfix')).toBe('wontfix')
    expect(stateOnUserAction('fixed', 'wontfix')).toBe('wontfix')
  })

  it('reopens from every state that is not already open', () => {
    expect(stateOnUserAction('acknowledged', 'reopen')).toBe('open')
    expect(stateOnUserAction('wontfix', 'reopen')).toBe('open')
    expect(stateOnUserAction('fixed', 'reopen')).toBe('open')
    expect(stateOnUserAction('open', 'reopen')).toBeNull()
  })
})

describe('listIssues — across every registered repo', () => {
  it('lists issues from both repos, most severe first', () => {
    const rows = listIssues(seeded().db, {})
    expect(rows.map((row) => row.repoId)).toEqual(['alpha', 'beta'])
    expect(rows[0]).toMatchObject({
      skillId: 'alpha/declawed',
      ruleClass: 'prompt-injection',
      relPath: 'declawed/SKILL.md',
      severity: 'high',
      state: 'open',
      detectors: ['skillspector'],
    })
  })

  it('narrows by repo, by skill, by state and by rule class', () => {
    const db = seeded().db
    expect(listIssues(db, { repoId: 'beta' })).toHaveLength(1)
    expect(listIssues(db, { skillId: 'alpha/declawed' })).toHaveLength(1)
    expect(listIssues(db, { ruleClass: 'metadata-invalid' })).toHaveLength(1)
    expect(listIssues(db, { state: 'wontfix' })).toEqual([])
  })

  it('names the detector that is holding an issue open', () => {
    const rows = listIssues(seeded().db, { skillId: 'alpha/declawed' })
    // The detector reported it and has never since reported a conclusive
    // absence, so it is exactly what reconcile would wait on.
    expect(rows[0]?.blockedBy).toEqual(['skillspector'])
  })
})

describe('setIssueState', () => {
  it('persists an acknowledgement', () => {
    const ledger = seeded()
    const fp = listIssues(ledger.db, { repoId: 'alpha' })[0]?.fingerprint as string
    expect(setIssueState(ledger.db, fp, 'acknowledge')).toBe('acknowledged')
    expect(listIssues(ledger.db, { repoId: 'alpha' })[0]?.state).toBe('acknowledged')
  })

  it('returns null and writes nothing when the transition is not legal', () => {
    const ledger = seeded()
    const fp = listIssues(ledger.db, { repoId: 'alpha' })[0]?.fingerprint as string
    expect(setIssueState(ledger.db, fp, 'reopen')).toBeNull()
    expect(listIssues(ledger.db, { repoId: 'alpha' })[0]?.state).toBe('open')
  })

  it('clears closed_run when it reopens a fixed issue, so the row is not both fixed and open', () => {
    const ledger = seeded()
    const fp = listIssues(ledger.db, { repoId: 'alpha' })[0]?.fingerprint as string
    ledger.db
      .prepare(`update issues set state = 'fixed', closed_run = 'r0' where fingerprint = ?`)
      .run(fp)
    expect(setIssueState(ledger.db, fp, 'reopen')).toBe('open')
    const row = ledger.db
      .prepare('select state, closed_run from issues where fingerprint = ?')
      .get(fp) as { state: string; closed_run: string | null }
    expect(row).toEqual({ state: 'open', closed_run: null })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/core/issue-queries.test.ts`
Expected: FAIL — cannot resolve `issue-queries.js`, `stateOnUserAction` not exported.

- [ ] **Step 3: Add the two decisions**

Append to `src/core/ledger/issues.ts`:

```ts
export type IssueAction = 'acknowledge' | 'wontfix' | 'reopen'

/**
 * The user half of design §10.5. `null` means no legal transition, and the
 * caller writes nothing — a screen that silently no-ops is better than one that
 * can move an issue somewhere the state machine does not describe.
 *
 * `acknowledge` from `wontfix` is refused: a suppression is a stronger
 * statement than triage, and quietly weakening it would lose a decision the
 * user made. `reopen` is the way back.
 */
export function stateOnUserAction(current: IssueState, action: IssueAction): IssueState | null {
  switch (action) {
    case 'acknowledge':
      return current === 'open' ? 'acknowledged' : null
    case 'wontfix':
      return current === 'wontfix' ? null : 'wontfix'
    case 'reopen':
      return current === 'open' ? null : 'open'
  }
}

/**
 * Whether one detector agrees an issue is gone: it has reported a conclusive
 * absence since the last time it reported the issue. Closure is the conjunction
 * of this over every detector (R8.8), and the Issues screen shows the detectors
 * for which it is false — so both read the same predicate rather than two copies
 * that could disagree about which tool is holding an issue open.
 *
 * Run ids are UUIDv7, so lexical order is claim order.
 */
export function detectorSaysGone(row: {
  last_seen_run: string | null
  last_absent_run: string | null
}): boolean {
  return (
    row.last_absent_run !== null &&
    (row.last_seen_run === null || row.last_absent_run > row.last_seen_run)
  )
}
```

- [ ] **Step 4: Have `reconcile` close on the shared predicate**

In `src/core/ledger/reconcile.ts`, import `detectorSaysGone` and replace the inline `allAbsent` expression:

```ts
    const allAbsent = detectors.every(detectorSaysGone)
```

- [ ] **Step 5: Implement the queries**

`src/core/ledger/issue-queries.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite'
import type { Severity } from '../types.js'
import { detectorSaysGone, stateOnUserAction, type IssueAction, type IssueState } from './issues.js'

export interface IssueFilter {
  skillId?: string
  repoId?: string
  /** Omitted means every state; `open` alone is the common triage view. */
  state?: IssueState
  ruleClass?: string
  severity?: Severity
}

export interface IssueRow {
  fingerprint: string
  skillId: string
  repoId: string
  ruleClass: string
  relPath: string
  severity: Severity
  state: IssueState
  occurrenceCount: number
  /** Every tool that has ever detected it, sorted. */
  detectors: string[]
  /** Those that have not since reported a conclusive absence — R8.8's blockers. */
  blockedBy: string[]
  lastSeenRun: string | null
}

const SEVERITY_SQL = `case i.severity_max
    when 'critical' then 5 when 'high' then 4 when 'medium' then 3
    when 'low' then 2 else 1 end`

export function listIssues(db: DatabaseSync, filter: IssueFilter): IssueRow[] {
  const clauses: string[] = []
  const params: string[] = []
  if (filter.skillId !== undefined) {
    clauses.push('i.skill_id = ?')
    params.push(filter.skillId)
  }
  if (filter.repoId !== undefined) {
    clauses.push('k.repo_id = ?')
    params.push(filter.repoId)
  }
  if (filter.state !== undefined) {
    clauses.push('i.state = ?')
    params.push(filter.state)
  }
  if (filter.ruleClass !== undefined) {
    clauses.push('i.rule_class = ?')
    params.push(filter.ruleClass)
  }
  if (filter.severity !== undefined) {
    clauses.push('i.severity_max = ?')
    params.push(filter.severity)
  }

  const rows = db
    .prepare(
      `select i.fingerprint as fingerprint, i.skill_id as skillId, k.repo_id as repoId,
              i.rule_class as ruleClass, i.rel_path as relPath,
              i.severity_max as severity, i.state as state,
              i.occurrence_count as occurrenceCount, i.last_seen_run as lastSeenRun
         from issues i join skills k on k.id = i.skill_id
        where 1 = 1 ${clauses.length === 0 ? '' : `and ${clauses.join(' and ')}`}
        order by ${SEVERITY_SQL} desc, i.skill_id, i.rel_path, i.rule_class`,
    )
    .all(...params) as Array<Omit<IssueRow, 'detectors' | 'blockedBy'>>

  if (rows.length === 0) return []

  // One query for every row's detectors rather than one per row: an Issues
  // screen over a few hundred issues would otherwise open a few hundred
  // statements to draw one frame.
  const detectorRows = db
    .prepare(
      `select issue_fp as fp, tool_id as toolId, last_seen_run, last_absent_run
         from issue_detectors
        where issue_fp in (${rows.map(() => '?').join(',')})
        order by tool_id`,
    )
    .all(...rows.map((row) => row.fingerprint)) as Array<{
    fp: string
    toolId: string
    last_seen_run: string | null
    last_absent_run: string | null
  }>

  return rows.map((row) => {
    const mine = detectorRows.filter((detector) => detector.fp === row.fingerprint)
    return {
      ...row,
      detectors: mine.map((detector) => detector.toolId),
      blockedBy: mine.filter((detector) => !detectorSaysGone(detector)).map((d) => d.toolId),
    }
  })
}

/**
 * R8.10's user transitions. Returns the new state, or null when the action is
 * not legal from the issue's current state, in which case nothing is written.
 */
export function setIssueState(
  db: DatabaseSync,
  fingerprint: string,
  action: IssueAction,
  note?: string,
): IssueState | null {
  const current = db
    .prepare('select state from issues where fingerprint = ?')
    .get(fingerprint) as { state: IssueState } | undefined
  if (current === undefined) return null

  const next = stateOnUserAction(current.state, action)
  if (next === null) return null

  // closed_run is cleared on reopen for the same reason `recordRun` clears it
  // on a redetection: a row that is `open` while still naming the run that
  // closed it makes "when was this last closed" unanswerable.
  db.prepare(
    `update issues
        set state = ?,
            note = coalesce(?, note),
            closed_run = case when ? = 'open' then null else closed_run end
      where fingerprint = ?`,
  ).run(next, note ?? null, next, fingerprint)
  return next
}
```

- [ ] **Step 6: Export through the core index**

```ts
export { listIssues, setIssueState, type IssueFilter, type IssueRow } from './ledger/issue-queries.js'
export {
  detectorSaysGone,
  stateOnUserAction,
  type IssueAction,
  type IssueState,
} from './ledger/issues.js'
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run tests/core/issue-queries.test.ts tests/core/reconcile.test.ts tests/core/issues.test.ts`
Expected: PASS — including the reconcile suite, which now exercises the extracted predicate.

- [ ] **Step 8: Commit**

```bash
git add src/core/ledger tests/core/issue-queries.test.ts
git commit -m "feat: list issues across repos and apply the user state transitions"
```

---

### Task 6: The `GantryViews` port and its CLI implementation

The TUI may not open the ledger and may not spawn. One port, declared by the consumer, implemented where config, the ledger and the doctor probe already meet.

**Files:**
- Modify: `src/tui/views.ts` (the port and `SettingsView`)
- Create: `src/cli/gantry-views.ts`
- Modify: `src/cli/tui-command.ts` (build and pass it)
- Modify: `src/tui/index.tsx`, `src/tui/app.tsx` (accept the prop)
- Create: `tests/cli/gantry-views.test.ts`, `tests/helpers/fake-views.ts`

**Interfaces:**
- Consumes: `dashboard`, `provenanceOptions` (Task 4), `listIssues`, `setIssueState` (Task 5), `doctor` (M3), `loadConfig`, `loadEnvFile`, `appliedRuleMapVersion`.
- Produces: `interface GantryViews` with `dashboard`, `provenances`, `issues`, `actOnIssue`, `tools`, `settings`; `createGantryViews(deps: CliDeps): GantryViews`; `fakeViews(overrides?)` for every later TUI test. Tasks 7–12 consume these.

- [ ] **Step 1: Declare the port**

Append to `src/tui/views.ts`:

```ts
import type {
  DashboardStats,
  DoctorReport,
  IssueAction,
  IssueFilter,
  IssueRow,
  ProvenanceOption,
  StatsFilter,
} from '../core/index.js'

export interface SettingsRepo {
  id: string
  name: string
  path: string
  isGit: boolean
  skills: number
}

export interface SettingsCredential {
  /** The provider label an adapter declares, or the env key for a bare one. */
  label: string
  satisfied: boolean
  detail: string
}

export interface SettingsView {
  home: string
  dbPath: string
  concurrency: number
  repos: SettingsRepo[]
  stageTools: Record<string, readonly string[]>
  credentials: SettingsCredential[]
  /** `.env` mode and presence warnings, verbatim from `loadEnvFile`. */
  envWarnings: string[]
  ruleMap: { applied: number; current: number }
}

/**
 * Everything the screens need and the terminal interface is not allowed to do:
 * open the ledger, and spawn a tool to verify it. Declared here because it is
 * the TUI's requirement; implemented in `src/cli/gantry-views.ts`, which is
 * already the one place config, the lockfile and the ledger meet.
 */
export interface GantryViews {
  dashboard(filter: StatsFilter): Promise<DashboardStats>
  provenances(): Promise<ProvenanceOption[]>
  issues(filter: IssueFilter): Promise<IssueRow[]>
  /** Resolves to the new state, or null when the transition was not legal. */
  actOnIssue(fingerprint: string, action: IssueAction): Promise<string | null>
  tools(): Promise<DoctorReport>
  settings(): Promise<SettingsView>
}
```

- [ ] **Step 2: Write the failing implementation test**

`tests/cli/gantry-views.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openLedger } from '../../src/core/ledger/db.js'
import { createGantryViews } from '../../src/cli/gantry-views.js'
import { recordFixtureRun, skillFixture } from '../helpers/ledger-fixture.js'

async function home() {
  const dir = await mkdtemp(join(tmpdir(), 'sg-views-'))
  await writeFile(
    join(dir, 'config.json'),
    JSON.stringify({
      version: 1,
      repos: [],
      stageTools: { validate: ['skill-lint'], evaluate: [], security: [], optimise: [] },
      concurrency: 2,
      artefactSizeCapBytes: 33_554_432,
      timeoutOverridesMs: {},
      mutationTimeoutMs: 300_000,
    }),
  )
  return dir
}

describe('createGantryViews', () => {
  it('reads statistics and issues out of the ledger the CLI owns', async () => {
    const dir = await home()
    const dbPath = join(dir, 'gantry.db')
    const ledger = openLedger(dbPath)
    recordFixtureRun(ledger, {
      runId: '019283af-0000-7000-8000-000000000001',
      skill: skillFixture('alpha', 'declawed'),
      stages: [
        {
          stage: 'security',
          outcome: 'failed',
          findings: [
            {
              ruleClass: 'prompt-injection' as never,
              nativeRuleId: 'X1',
              severity: 'high',
              path: 'declawed/SKILL.md',
              message: 'm',
            },
          ],
        },
      ],
    })
    ledger.close()

    const views = createGantryViews({ home: dir, dbPath, write: () => undefined })
    expect((await views.dashboard({})).runs).toBe(1)
    const issues = await views.issues({})
    expect(issues).toHaveLength(1)
    expect(await views.actOnIssue(issues[0]!.fingerprint, 'acknowledge')).toBe('acknowledged')
    expect((await views.issues({ state: 'acknowledged' }))).toHaveLength(1)
  })

  it('reports settings without reading a secret value', async () => {
    const dir = await home()
    await writeFile(join(dir, '.env'), 'ANTHROPIC_AUTH_TOKEN=super-secret-value\n', { mode: 0o600 })
    const views = createGantryViews({
      home: dir,
      dbPath: join(dir, 'gantry.db'),
      write: () => undefined,
    })
    const settings = await views.settings()
    expect(settings.concurrency).toBe(2)
    expect(JSON.stringify(settings)).not.toContain('super-secret-value')
  })

  it('closes the ledger it opened for each call', async () => {
    const dir = await home()
    const views = createGantryViews({
      home: dir,
      dbPath: join(dir, 'gantry.db'),
      write: () => undefined,
    })
    // Two calls in a row would throw on a handle left open in WAL mode by the
    // first if the implementation leaked it.
    await views.dashboard({})
    await views.dashboard({})
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run tests/cli/gantry-views.test.ts`
Expected: FAIL — cannot resolve `src/cli/gantry-views.js`.

- [ ] **Step 4: Implement the port**

`src/cli/gantry-views.ts`:

```ts
import { getAdapter } from '../core/adapters/registry.js'
import { loadConfig } from '../core/config/config.js'
import { loadEnvFile } from '../core/config/env.js'
import { discoverSkills } from '../core/discovery/discover.js'
import { openLedger, type Ledger } from '../core/ledger/db.js'
import { listIssues, setIssueState } from '../core/ledger/issue-queries.js'
import { readLifecycleCache } from '../core/ledger/lifecycle.js'
import { appliedRuleMapVersion } from '../core/ledger/rule-map-migration.js'
import { dashboard, provenanceOptions } from '../core/ledger/stats.js'
import { RULE_CLASS_MAP_VERSION } from '../core/adapters/rule-classes.js'
import { doctor } from '../core/tools/doctor.js'
import type { GantryViews, SettingsCredential, SettingsView } from '../tui/views.js'
import { discoverAll, type CliDeps } from './run-command.js'

/**
 * Opened per call and closed straight after, rather than held for the session.
 * A screen refresh is rare and a run's finalisation transaction is not: a
 * long-lived read handle in the same process as the writer is how a WAL reader
 * ends up serving a snapshot from before the run it was opened to display.
 */
function withLedger<T>(dbPath: string, read: (ledger: Ledger) => T): T {
  const ledger = openLedger(dbPath)
  try {
    return read(ledger)
  } finally {
    ledger.close()
  }
}

/**
 * Presence, never a value. A credential set is satisfied when every key of one
 * declared alternative is present and non-empty (R4.2a), which is the same rule
 * the runner classifies row 2 of §8.1 with.
 */
function credentialsOf(
  toolIds: readonly string[],
  vars: Record<string, string>,
): SettingsCredential[] {
  const out: SettingsCredential[] = []
  for (const toolId of toolIds) {
    const requirement = getAdapter(toolId)?.manifest.credentials
    if (requirement === undefined || requirement.kind === 'none') {
      out.push({ label: toolId, satisfied: true, detail: 'no credential required' })
      continue
    }
    const satisfied = requirement.alternatives.filter((alternative) =>
      alternative.required.every((key) => (vars[key] ?? '').length > 0),
    )
    out.push({
      label: toolId,
      satisfied: satisfied.length > 0,
      detail:
        satisfied.length > 0
          ? `via ${satisfied.map((alternative) => alternative.provider).join(', ')}`
          : `needs one of ${requirement.alternatives.map((a) => a.provider).join(', ')}`,
    })
  }
  return out
}

export function createGantryViews(deps: CliDeps): GantryViews {
  return {
    dashboard: async (filter) => withLedger(deps.dbPath, (ledger) => dashboard(ledger.db, filter)),
    provenances: async () => withLedger(deps.dbPath, (ledger) => provenanceOptions(ledger.db)),
    issues: async (filter) => withLedger(deps.dbPath, (ledger) => listIssues(ledger.db, filter)),
    actOnIssue: async (fingerprint, action) =>
      withLedger(deps.dbPath, (ledger) => setIssueState(ledger.db, fingerprint, action)),
    tools: async () => {
      const skills = await discoverAll(await loadConfig(deps.home))
      // R8.14: the report says `rule-map-pending`; only
      // `doctor --migrate-rule-map` resolves it, so nothing here migrates.
      return doctor({
        home: deps.home,
        skills,
        ledgerLifecycle: withLedger(deps.dbPath, (ledger) => readLifecycleCache(ledger.db)),
        ruleMap: withLedger(deps.dbPath, (ledger) => ({
          applied: appliedRuleMapVersion(ledger.db),
          current: RULE_CLASS_MAP_VERSION,
        })),
      })
    },
    settings: async (): Promise<SettingsView> => {
      const config = await loadConfig(deps.home)
      const env = await loadEnvFile(deps.home)
      const repos = []
      for (const repo of config.repos) {
        repos.push({
          id: repo.id,
          name: repo.name,
          path: repo.path,
          isGit: repo.isGit,
          skills: (await discoverSkills(repo).catch(() => [])).length,
        })
      }
      const selected = [...new Set(Object.values(config.stageTools).flat())]
      return {
        home: deps.home,
        dbPath: deps.dbPath,
        concurrency: config.concurrency,
        repos,
        stageTools: config.stageTools,
        credentials: credentialsOf(selected, env.vars),
        envWarnings: env.present ? env.warnings : [`${deps.home}/.env is absent`],
        ruleMap: withLedger(deps.dbPath, (ledger) => ({
          applied: appliedRuleMapVersion(ledger.db),
          current: RULE_CLASS_MAP_VERSION,
        })),
      }
    },
  }
}
```

- [ ] **Step 5: Thread the port to the app**

`src/tui/index.tsx` and `src/tui/app.tsx`: add `views: GantryViews` to the props and pass it through. In `src/cli/tui-command.ts`:

```ts
  await renderApp({
    skills,
    queue,
    stages: resolveStages(config),
    concurrency,
    views: createGantryViews({ home: options.home, dbPath: options.dbPath, write: () => undefined }),
  })
```

`TuiOptions` already carries `home` and `dbPath`, so no signature changes.

- [ ] **Step 6: Write the fake every later TUI test uses**

`tests/helpers/fake-views.ts`:

```ts
import type { DashboardStats, DoctorReport, IssueRow, ProvenanceOption } from '../../src/core/index.js'
import type { GantryViews, SettingsView } from '../../src/tui/views.js'

export const emptyDashboard: DashboardStats = {
  repos: 0,
  skills: 0,
  runs: 0,
  stagePassRates: [],
  wallClock: [],
  evalCases: { casesTotal: 0, casesPassed: 0, casesErrored: 0, rate: null },
  openBySeverity: [],
  openByRuleClass: [],
  history: [],
}

export const emptyDoctor: DoctorReport = { runtimes: [], tools: [], lifecycle: [], failed: false }

/** The shipped shapes, so a fixture cannot drift from what `doctor` returns. */
export const toolFinding = (
  toolId: string,
  kind: DoctorReport['tools'][number]['kind'],
  detail = '',
): DoctorReport['tools'][number] => ({
  toolId,
  kind,
  expectedVersion: null,
  actualVersion: null,
  detail,
})

export const emptySettings: SettingsView = {
  home: '/home/.skillgantry',
  dbPath: '/home/.skillgantry/gantry.db',
  concurrency: 2,
  repos: [],
  stageTools: { validate: [], evaluate: [], security: [], optimise: [] },
  credentials: [],
  envWarnings: [],
  ruleMap: { applied: 1, current: 1 },
}

export interface FakeViews extends GantryViews {
  /** Every action the screens asked for, in order. */
  readonly actions: Array<[string, string]>
}

/** No sqlite, no spawn: the screens are pure functions of what this returns. */
export function fakeViews(overrides: Partial<GantryViews> = {}): FakeViews {
  const actions: Array<[string, string]> = []
  return {
    actions,
    dashboard: async () => emptyDashboard,
    provenances: async (): Promise<ProvenanceOption[]> => [],
    issues: async (): Promise<IssueRow[]> => [],
    actOnIssue: async (fingerprint, action) => {
      actions.push([fingerprint, action])
      return 'acknowledged'
    },
    tools: async () => emptyDoctor,
    settings: async () => emptySettings,
    ...overrides,
  }
}
```

`ToolFinding` carries `expectedVersion` and `actualVersion` beside `kind` and `detail`, and `ToolDriftKind` has seven members including `ok` and `rule-map-pending` — hence the `toolFinding` helper rather than object literals in each test. `emptyDoctor` must type-check against the shipped interface with no cast.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run tests/cli/gantry-views.test.ts tests/cli/tui-command.test.ts && pnpm lint && pnpm build`
Expected: PASS; lint clean, which is the check that `src/tui/**` still imports core only through `src/core/index.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/tui/views.ts src/tui/index.tsx src/tui/app.tsx src/cli/gantry-views.ts src/cli/tui-command.ts tests/cli/gantry-views.test.ts tests/helpers/fake-views.ts
git commit -m "feat: give the terminal interface one port for ledger and doctor reads"
```

---

### Task 7: Screens in the store, and the `:` command palette

R11.3 is "reachable as top-level screens", and design §14 names the palette as how. The store learns a screen and a palette; `app.tsx` routes and loads.

**Files:**
- Modify: `src/tui/store.ts` (screen, palette, view data, filters)
- Create: `src/tui/components/Palette.tsx`
- Modify: `src/tui/app.tsx` (routing, keys, loading)
- Modify: `src/tui/layout.ts` (`screenBodyRows`)
- Modify: `tests/tui/store.test.ts`
- Create: `tests/tui/palette.test.tsx`

**Interfaces:**
- Consumes: `GantryViews` (Task 6), `DashboardStats`, `IssueRow`, `IssueFilter`, `ProvenanceOption`, `StatsFilter`, `DoctorReport`, `SettingsView`.
- Produces: `Screen`, `SCREENS`, `PALETTE_COMMANDS`, `paletteMatches(query)`, `screenBodyRows(layout)`, and the actions Tasks 8–10 dispatch: `set-screen`, `palette-open`, `palette-input`, `palette-move`, `palette-close`, `set-dashboard`, `set-provenances`, `set-stats-filter`, `set-issues`, `select-issue`, `set-issue-filter`, `set-tools`, `set-settings`, `scroll-screen`, `set-screen-row-count`, `refresh-views`, `view-error`.

- [ ] **Step 1: Write the failing store tests**

Append to `tests/tui/store.test.ts`:

```ts
describe('screens and the palette — R11.3', () => {
  it('starts on Work', () => {
    expect(initialState([], 2).screen).toBe('work')
  })

  it('switches screen', () => {
    const state = reducer(initialState([], 2), { type: 'set-screen', screen: 'issues' })
    expect(state.screen).toBe('issues')
  })

  it('filters the command list as the user types, and clamps the selection', () => {
    let state = reducer(initialState([], 2), { type: 'palette-open' })
    expect(state.palette.open).toBe(true)
    state = reducer(state, { type: 'palette-input', query: 'iss' })
    expect(paletteMatches(state.palette.query).map((command) => command.id)).toEqual(['issues'])
    state = reducer(state, { type: 'palette-move', delta: 5 })
    expect(state.palette.selected).toBe(0)
  })

  it('resets the query when it closes, so the next `:` starts clean', () => {
    let state = reducer(initialState([], 2), { type: 'palette-open' })
    state = reducer(state, { type: 'palette-input', query: 'set' })
    state = reducer(state, { type: 'palette-close' })
    expect(state.palette).toEqual({ open: false, query: '', selected: 0 })
  })

  it('clamps the issue selection to the rows it was given', () => {
    let state = reducer(initialState([], 2), {
      type: 'set-issues',
      rows: [{ fingerprint: 'a' }, { fingerprint: 'b' }] as never,
    })
    state = reducer(state, { type: 'select-issue', delta: 9 })
    expect(state.selectedIssue).toBe(1)
  })

  it('drops a stale selection when a filter shortens the list', () => {
    let state = reducer(initialState([], 2), {
      type: 'set-issues',
      rows: [{ fingerprint: 'a' }, { fingerprint: 'b' }] as never,
    })
    state = reducer(state, { type: 'select-issue', delta: 1 })
    state = reducer(state, { type: 'set-issues', rows: [{ fingerprint: 'a' }] as never })
    expect(state.selectedIssue).toBe(0)
  })

  it('resets the scroll offset when the screen changes', () => {
    let state = reducer(initialState([], 2), { type: 'set-screen-row-count', count: 40 })
    state = reducer(state, { type: 'scroll-screen', delta: 5, viewport: 4 })
    expect(state.screenOffset).toBe(5)
    state = reducer(state, { type: 'set-screen', screen: 'tools' })
    expect(state.screenOffset).toBe(0)
  })

  it('clamps the scroll to the last full window, not to the last row', () => {
    let state = reducer(initialState([], 2), { type: 'set-screen-row-count', count: 10 })
    state = reducer(state, { type: 'scroll-screen', delta: 99, viewport: 4 })
    expect(state.screenOffset).toBe(6)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/tui/store.test.ts`
Expected: FAIL — `screen` is not on `AppState` and `set-screen` is not an action.

- [ ] **Step 3: Extend the store**

In `src/tui/store.ts`:

```ts
export const SCREENS = ['work', 'dashboard', 'issues', 'tools', 'settings'] as const
export type Screen = (typeof SCREENS)[number]

export interface PaletteCommand {
  id: string
  label: string
  action: { kind: 'screen'; screen: Screen } | { kind: 'quit' } | { kind: 'refresh' }
}

export const PALETTE_COMMANDS: readonly PaletteCommand[] = [
  ...SCREENS.map((screen) => ({
    id: screen,
    label: `go to ${screen}`,
    action: { kind: 'screen' as const, screen },
  })),
  { id: 'refresh', label: 'reload this screen from the ledger', action: { kind: 'refresh' } },
  { id: 'quit', label: 'quit SkillGantry', action: { kind: 'quit' } },
]

/** Substring on id or label, so `:iss` and `:go to iss` both find Issues. */
export const paletteMatches = (query: string): PaletteCommand[] => {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return [...PALETTE_COMMANDS]
  return PALETTE_COMMANDS.filter(
    (command) => command.id.includes(needle) || command.label.toLowerCase().includes(needle),
  )
}
```

`AppState` gains:

```ts
  screen: Screen
  palette: { open: boolean; query: string; selected: number }
  /**
   * Ledger-backed views. `null` means "not loaded yet", which the screens show
   * as a loading row — distinct from an empty result, which is a real answer
   * and reads as "no runs recorded".
   */
  dashboard: DashboardStats | null
  provenances: ProvenanceOption[]
  statsFilter: StatsFilter
  issues: IssueRow[]
  issueFilter: IssueFilter
  selectedIssue: number
  tools: DoctorReport | null
  settings: SettingsView | null
  /** First visible body row on a row-list screen, moved by `scroll-screen`. */
  screenOffset: number
  /**
   * Body rows the current screen built. The reducer cannot compute it — the row
   * count depends on the terminal width, which only the component knows — and
   * clamping a scroll against a stale count is what let `j` at the bottom of a
   * list walk the offset into the hundreds.
   */
  screenRowCount: number
  /** Set when the port rejected; cleared by the next successful load. */
  viewError: string | null
  /** Bumped by `refresh`, watched by the loading effect. */
  reloads: number
```

`initialState` adds `screen: 'work'`, `palette: { open: false, query: '', selected: 0 }`, `dashboard: null`, `provenances: []`, `statsFilter: {}`, `issues: []`, `issueFilter: {}`, `selectedIssue: 0`, `tools: null`, `settings: null`, `screenOffset: 0`, `screenRowCount: 0`, `viewError: null`, `reloads: 0`.

The new reducer cases:

```ts
    case 'set-screen':
      // The palette closes and the offset resets with the switch: leaving the
      // palette open over the new screen sent the first keystroke there to a
      // filter the user could no longer see, and a carried-over offset opens
      // the next screen scrolled to a row it does not have.
      return {
        ...state,
        screen: action.screen,
        palette: { open: false, query: '', selected: 0 },
        screenOffset: 0,
      }
    case 'palette-open':
      return { ...state, palette: { open: true, query: '', selected: 0 } }
    case 'palette-input':
      return {
        ...state,
        palette: {
          open: true,
          query: action.query,
          selected: clamp(0, paletteMatches(action.query).length),
        },
      }
    case 'palette-move':
      return {
        ...state,
        palette: {
          ...state.palette,
          selected: clamp(
            state.palette.selected + action.delta,
            paletteMatches(state.palette.query).length,
          ),
        },
      }
    case 'palette-close':
      return { ...state, palette: { open: false, query: '', selected: 0 } }
    case 'set-dashboard':
      return { ...state, dashboard: action.stats, viewError: null }
    case 'set-provenances':
      return { ...state, provenances: action.options }
    case 'set-stats-filter':
      // Replaced, not merged: a filter that keeps a stale skillId while the
      // user changes provenance answers a question nobody asked.
      return { ...state, statsFilter: action.filter, dashboard: null, screenOffset: 0 }
    case 'set-issues':
      return {
        ...state,
        issues: action.rows,
        selectedIssue: clamp(state.selectedIssue, action.rows.length),
        viewError: null,
      }
    case 'select-issue':
      return {
        ...state,
        selectedIssue: clamp(state.selectedIssue + action.delta, state.issues.length),
      }
    case 'set-issue-filter':
      return { ...state, issueFilter: action.filter, selectedIssue: 0, screenOffset: 0 }
    case 'set-tools':
      return { ...state, tools: action.report, viewError: null }
    case 'set-settings':
      return { ...state, settings: action.view, viewError: null }
    case 'set-screen-row-count':
      return { ...state, screenRowCount: action.count }
    case 'scroll-screen': {
      // Clamped the way `scroll-review` is: to the last *full* window, so
      // holding `j` cannot drive the offset past the end and leave one row on
      // screen needing as many `k` presses before the view moves again.
      const maxOffset = Math.max(0, state.screenRowCount - Math.max(1, action.viewport))
      return {
        ...state,
        screenOffset: Math.min(maxOffset, Math.max(0, state.screenOffset + action.delta)),
      }
    }
    case 'refresh-views':
      return { ...state, reloads: state.reloads + 1 }
    case 'view-error':
      return { ...state, viewError: action.message }
```

- [ ] **Step 4: Add `screenBodyRows` to the layout**

In `src/tui/layout.ts`:

```ts
/**
 * Rows a full-screen view spends before its first body row: the panel's chrome
 * and title, plus the footer hint the screen prints below it. Same shape as
 * `REVIEW_CHROME_ROWS` and Help's, and here rather than in four components for
 * §14.1's third rule — three panes each re-deriving their own chrome cost is
 * how a panel falls off the bottom when `Panel`'s padding changes.
 */
const SCREEN_CHROME_ROWS = { boxed: 4, bare: 2 } as const

export function screenBodyRows(layout: Layout): number {
  return Math.max(1, layout.rows - SCREEN_CHROME_ROWS[layout.chrome] - 1)
}
```

- [ ] **Step 5: Write the palette component**

`src/tui/components/Palette.tsx`:

```tsx
import { Box, Text } from 'ink'
import { innerWidth, truncate, windowFor, type Layout } from '../layout.js'
import { paletteMatches, type AppState } from '../store.js'
import { Panel } from './Panel.js'

/**
 * Modal, and sized from the layout like every other pane. It shows at most a
 * third of the terminal's rows: the palette is a chooser over seven commands,
 * and a full-height list of them buries the screen it is choosing from.
 */
export function Palette({
  palette,
  layout,
}: {
  palette: AppState['palette']
  layout: Layout
}): React.ReactElement {
  const matches = paletteMatches(palette.query)
  const cols = Math.max(8, innerWidth(layout.columns, layout.chrome))
  const budget = Math.max(1, Math.floor(layout.rows / 3))
  const overflow = matches.length > budget
  const height = overflow ? Math.max(1, budget - 1) : budget
  const { start, end } = windowFor(matches.length, palette.selected, height)

  return (
    <Panel title={`:${palette.query}`} focused chrome={layout.chrome}>
      {matches.length === 0 && (
        <Text dimColor wrap="truncate">
          no command matches
        </Text>
      )}
      {matches.slice(start, end).map((command, offset) => {
        const index = start + offset
        return (
          <Box key={command.id}>
            <Text wrap="truncate" bold={index === palette.selected}>
              {index === palette.selected ? '›' : ' '} <Text color="cyan">{command.id}</Text>{' '}
              <Text dimColor>{truncate(command.label, cols - command.id.length - 4)}</Text>
            </Text>
          </Box>
        )
      })}
      {overflow && (
        <Text dimColor wrap="truncate">
          +{matches.length - (end - start)} more — keep typing
        </Text>
      )}
    </Panel>
  )
}
```

- [ ] **Step 6: Write the failing palette test**

`tests/tui/palette.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { createQueue, type SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeRun } from '../helpers/fake-run.js'
import { fakeViews } from '../helpers/fake-views.js'
import { renderInk } from '../helpers/render-ink.js'

/** What a terminal sends for the escape key. */
const ESC = '\u001b'

function harness() {
  const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('r1').handle })
  const views = fakeViews()
  const ui = renderInk(
    <App
      skills={[] as SkillRef[]}
      queue={queue}
      stages={['security']}
      concurrency={1}
      views={views}
      intervalMs={20}
    />,
  )
  return { ui, views }
}

const openPalette = async (ui: ReturnType<typeof harness>['ui'], typed: string): Promise<void> => {
  await ui.settle()
  ui.stdin.send(':')
  for (const char of typed) ui.stdin.send(char)
  await ui.settle()
}

describe(': command palette', () => {
  it('opens on : and lists every screen', async () => {
    const { ui } = harness()
    await openPalette(ui, '')
    const frame = ui.lastFrame()
    for (const command of ['work', 'dashboard', 'issues', 'tools', 'settings']) {
      expect(frame).toContain(command)
    }
  })

  it('runs the filtered command on enter', async () => {
    const { ui } = harness()
    await openPalette(ui, 'issues')
    ui.stdin.send('\r')
    await ui.settle(40)
    expect(ui.lastFrame()).toContain('Issues')
  })

  it('esc closes it without switching screen', async () => {
    const { ui } = harness()
    await openPalette(ui, 'dash')
    ui.stdin.send(ESC)
    await ui.settle()
    expect(ui.lastFrame()).toContain('Queue')
  })

  it('esc on a screen other than Work returns to Work', async () => {
    const { ui } = harness()
    await openPalette(ui, 'tools')
    ui.stdin.send('\r')
    await ui.settle(40)
    expect(ui.lastFrame()).toContain('Tools')
    ui.stdin.send(ESC)
    await ui.settle()
    expect(ui.lastFrame()).toContain('Queue')
  })
})
```

Add one more case, reusing `tests/tui/review-pane.test.tsx`'s setup verbatim for the pending mutation: with a review pending, `:` leaves the diff on screen and opens no palette. The review pane is the one screen that wins over every modal, because `a` there writes to the user's repo.

- [ ] **Step 7: Route and load in `app.tsx`**

The review pane stays the first branch (M5's deviation 13), so the palette is checked after it:

```tsx
  if (state.pending) return <Work state={state} />
  if (state.palette.open) return <PaletteScreen state={state} />
  switch (state.screen) {
    case 'dashboard':
      return <Dashboard state={state} dispatch={dispatch} />
    case 'issues':
      return <Issues state={state} dispatch={dispatch} />
    case 'tools':
      return <Tools state={state} dispatch={dispatch} />
    case 'settings':
      return <Settings state={state} dispatch={dispatch} />
    default:
      return <Work state={state} />
  }
```

`PaletteScreen` renders `<Palette>` above the footer hint, the way `Work` renders `Help`.

The loading effect, keyed on the screen, its filters and `reloads`:

```tsx
  useEffect(() => {
    if (state.pending) return
    const fail = (err: unknown): void =>
      dispatch({ type: 'view-error', message: (err as Error).message })
    if (state.screen === 'dashboard') {
      void views.dashboard(state.statsFilter).then(
        (stats) => dispatch({ type: 'set-dashboard', stats }),
        fail,
      )
      void views.provenances().then(
        (options) => dispatch({ type: 'set-provenances', options }),
        fail,
      )
    }
    if (state.screen === 'issues') {
      void views.issues(state.issueFilter).then(
        (rows) => dispatch({ type: 'set-issues', rows }),
        fail,
      )
    }
    if (state.screen === 'tools') {
      void views.tools().then((report) => dispatch({ type: 'set-tools', report }), fail)
    }
    if (state.screen === 'settings') {
      void views.settings().then((view) => dispatch({ type: 'set-settings', view }), fail)
    }
  }, [state.screen, state.statsFilter, state.issueFilter, state.reloads])
```

The keymap. The palette is handled directly after the review pane and before `?`. Every existing Work binding (`j`/`k`, `h`/`l`, `space`, `r`, `x`, `1`–`4`, `tab`) gains a `state.screen === 'work'` guard — `r` on the Issues screen must not enqueue a batch, and `x` must not cancel a job the user cannot see.

```tsx
    if (state.palette.open) {
      const matches = paletteMatches(state.palette.query)
      if (key.escape) dispatch({ type: 'palette-close' })
      else if (key.return) {
        const chosen = matches[state.palette.selected]
        if (chosen?.action.kind === 'screen') {
          dispatch({ type: 'set-screen', screen: chosen.action.screen })
        } else if (chosen?.action.kind === 'refresh') {
          dispatch({ type: 'refresh-views' })
          dispatch({ type: 'palette-close' })
        } else if (chosen?.action.kind === 'quit') exit()
        else dispatch({ type: 'palette-close' })
      } else if (key.downArrow || (key.ctrl && input === 'n')) {
        dispatch({ type: 'palette-move', delta: 1 })
      } else if (key.upArrow || (key.ctrl && input === 'p')) {
        dispatch({ type: 'palette-move', delta: -1 })
      } else if (key.backspace || key.delete) {
        dispatch({ type: 'palette-input', query: state.palette.query.slice(0, -1) })
      } else if (plain && input.length > 0) {
        dispatch({ type: 'palette-input', query: state.palette.query + input })
      }
      return
    }
    if (plain && input === ':') {
      dispatch({ type: 'palette-open' })
      return
    }
    // esc anywhere but Work goes home, so a user who palette-jumped by mistake
    // is one keystroke from where they came from.
    if (key.escape && state.screen !== 'work') {
      dispatch({ type: 'set-screen', screen: 'work' })
      return
    }
```

- [ ] **Step 8: Stub the four screens so the palette has somewhere to go**

A working screen with no content yet, not a placeholder: the palette test asserts navigation, and navigation to a screen that does not exist is not navigation. Tasks 8–10 replace the bodies. Four files of this shape, one per screen, with the title and the file name changed:

```tsx
import { Box, Text, useWindowSize } from 'ink'
import { layoutFor, truncate } from '../layout.js'
import type { AppState } from '../store.js'
import { Panel } from './Panel.js'

export function Dashboard({ state: _state }: { state: AppState }): React.ReactElement {
  const { columns, rows } = useWindowSize()
  const layout = layoutFor(columns, rows)
  return (
    <Box flexDirection="column" width={columns}>
      <Panel title="Dashboard" focused chrome={layout.chrome}>
        <Text dimColor wrap="truncate">
          loading…
        </Text>
      </Panel>
      <Text dimColor>{truncate(': commands · esc work · q quit', columns)}</Text>
    </Box>
  )
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm vitest run tests/tui/store.test.ts tests/tui/palette.test.tsx tests/tui/work-screen.test.tsx tests/tui/review-pane.test.tsx`
Expected: PASS — including the review-pane suite, which is what proves the palette did not get in front of a diff.

- [ ] **Step 10: Commit**

```bash
git add src/tui tests/tui/store.test.ts tests/tui/palette.test.tsx
git commit -m "feat: make every top-level screen reachable through a command palette"
```

---

### Task 8: The Dashboard screen

R8.9 rendered, R7.6 filterable. The body is built by a pure function, so the row budget is assertable without Ink.

**Files:**
- Create: `src/tui/rows.ts` (`ScreenRow`, `humanMs`, `dashboardRows`)
- Create: `src/tui/components/ScreenList.tsx`, `src/tui/components/Dashboard.tsx`
- Create: `tests/tui/rows.test.ts`, `tests/tui/dashboard.test.tsx`
- Modify: `src/tui/app.tsx` (the Dashboard keys)

**Interfaces:**
- Consumes: `DashboardStats`, `ProvenanceOption`, `StatsFilter`, `screenBodyRows`, `windowFor`, `truncate`.
- Produces: `type ScreenRow = { text: string; heading?: boolean; dim?: boolean; colour?: string }`, `humanMs(ms)`, `dashboardRows(state, width)`, and `ScreenList` — the one windowing renderer Tasks 8 and 10 share.

- [ ] **Step 1: Write the failing row-builder test**

`tests/tui/rows.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { dashboardRows, humanMs } from '../../src/tui/rows.js'
import { initialState, reducer } from '../../src/tui/store.js'
import { emptyDashboard } from '../helpers/fake-views.js'

const loaded = (stats = emptyDashboard) =>
  reducer(initialState([], 2), { type: 'set-dashboard', stats })

describe('humanMs', () => {
  it('picks the magnitude a stage actually takes', () => {
    expect(humanMs(900)).toBe('900ms')
    expect(humanMs(2_500)).toBe('2.5s')
    expect(humanMs(65_000)).toBe('1m 05s')
    expect(humanMs(null)).toBe('—')
  })
})

describe('dashboardRows', () => {
  it('says it is loading rather than showing zeros', () => {
    expect(dashboardRows(initialState([], 2), 80)[0]?.text).toContain('loading')
  })

  it('distinguishes an empty ledger from an unloaded one', () => {
    expect(dashboardRows(loaded(), 80).map((row) => row.text).join('\n')).toContain(
      'no runs recorded',
    )
  })

  it('renders every R8.9 clause as its own section', () => {
    const rows = dashboardRows(
      loaded({
        ...emptyDashboard,
        repos: 2,
        skills: 3,
        runs: 4,
        stagePassRates: [{ stage: 'validate', runs: 4, passed: 3, rate: 0.75 }],
        wallClock: [{ stage: 'validate', runs: 4, medianMs: 2_500, maxMs: 9_000 }],
        evalCases: { casesTotal: 10, casesPassed: 7, casesErrored: 1, rate: 0.7 },
        openBySeverity: [{ severity: 'high', count: 2 }],
        openByRuleClass: [{ ruleClass: 'prompt-injection', count: 2 }],
        history: [
          {
            runId: '019283af-0000-7000-8000-000000000001',
            skillId: 'alpha/declawed',
            repoId: 'alpha',
            outcome: 'passed',
            startedAt: '2026-08-03T10:00:00.000Z',
            endedAt: '2026-08-03T10:01:00.000Z',
            provenanceFp: 'abc123abc123',
          },
        ],
      }),
      80,
    )
    const text = rows.map((row) => row.text).join('\n')
    for (const expected of [
      'Stage pass rate',
      'validate',
      '75%',
      'Eval cases',
      '7/10',
      'Wall clock',
      '2.5s',
      'Open issues',
      'high',
      'prompt-injection',
      'Run history',
      'alpha/declawed',
    ]) {
      expect(text).toContain(expected)
    }
  })

  it('names the scope, so a filtered screen cannot be mistaken for the whole ledger', () => {
    const state = reducer(loaded({ ...emptyDashboard, runs: 1 }), {
      type: 'set-stats-filter',
      filter: { provenanceFp: 'abc123abc123' },
    })
    const rows = dashboardRows(
      reducer(state, { type: 'set-dashboard', stats: { ...emptyDashboard, runs: 1 } }),
      80,
    )
    expect(rows.map((row) => row.text).join('\n')).toContain('abc123abc123')
  })

  it('never emits a row wider than the width it was given', () => {
    const rows = dashboardRows(
      loaded({
        ...emptyDashboard,
        runs: 1,
        openByRuleClass: [{ ruleClass: 'x'.repeat(200), count: 1 }],
      }),
      40,
    )
    for (const row of rows) expect(row.text.length).toBeLessThanOrEqual(40)
  })

  it('reports the read failure instead of an empty screen', () => {
    const state = reducer(initialState([], 2), { type: 'view-error', message: 'database is locked' })
    expect(dashboardRows(state, 80)[0]?.text).toContain('database is locked')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/tui/rows.test.ts`
Expected: FAIL — cannot resolve `src/tui/rows.js`.

- [ ] **Step 3: Write the row builder**

`src/tui/rows.ts`:

```ts
import { truncate } from './layout.js'
import type { AppState } from './store.js'

export interface ScreenRow {
  text: string
  heading?: boolean
  dim?: boolean
  colour?: string
}

const pct = (rate: number): string => `${Math.round(rate * 100)}%`

/** 900ms, 2.5s, 1m 05s — the three magnitudes a stage actually takes. */
export function humanMs(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1_000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${String(Math.round((ms % 60_000) / 1_000)).padStart(2, '0')}s`
}

const SEVERITY_COLOUR: Record<string, string> = {
  critical: 'red',
  high: 'red',
  medium: 'yellow',
  low: 'gray',
  info: 'gray',
}

/**
 * A flat row list rather than nested boxes, so the screen's whole body is one
 * windowed list. §14.1's first rule then holds by construction: the component
 * renders exactly the rows it was allocated and counts the overflow notice
 * against them, instead of five sections each deciding their own height.
 */
export function dashboardRows(state: AppState, width: number): ScreenRow[] {
  const rows: ScreenRow[] = []
  const line = (text: string, extra: Omit<ScreenRow, 'text'> = {}): void => {
    rows.push({ text: truncate(text, width), ...extra })
  }

  if (state.viewError !== null) {
    line(`ledger read failed: ${state.viewError}`, { colour: 'red' })
    return rows
  }
  const stats = state.dashboard
  if (stats === null) {
    line('loading…', { dim: true })
    return rows
  }

  const scope = state.statsFilter.skillId ?? state.statsFilter.repoId ?? 'every registered repo'
  line(`${stats.repos} repos · ${stats.skills} skills · ${stats.runs} runs`, { dim: true })
  line(`scope ${scope} · provenance ${state.statsFilter.provenanceFp ?? 'all'}`, { dim: true })

  if (stats.runs === 0) {
    line('no runs recorded yet — run a stage and this fills in', { dim: true })
    return rows
  }

  line('Stage pass rate', { heading: true })
  for (const row of stats.stagePassRates) {
    line(`  ${row.stage.padEnd(10)} ${pct(row.rate).padStart(4)}  ${row.passed}/${row.runs}`)
  }

  line('Eval cases', { heading: true })
  line(
    stats.evalCases.rate === null
      ? '  no eval case recorded'
      : `  ${stats.evalCases.casesPassed}/${stats.evalCases.casesTotal} passed (${pct(stats.evalCases.rate)})` +
          (stats.evalCases.casesErrored > 0 ? `, ${stats.evalCases.casesErrored} errored` : ''),
  )

  line('Wall clock', { heading: true })
  for (const row of stats.wallClock) {
    line(`  ${row.stage.padEnd(10)} median ${humanMs(row.medianMs)} · max ${humanMs(row.maxMs)}`)
  }

  line('Open issues', { heading: true })
  if (stats.openBySeverity.length === 0) line('  none open')
  for (const row of stats.openBySeverity) {
    line(`  ${row.severity.padEnd(10)} ${row.count}`, {
      colour: SEVERITY_COLOUR[row.severity] ?? 'gray',
    })
  }
  for (const row of stats.openByRuleClass) {
    line(`  ${row.ruleClass.padEnd(22)} ${row.count}`, { dim: true })
  }

  line('Run history', { heading: true })
  for (const row of stats.history) {
    line(`  ${row.startedAt.slice(0, 16).replace('T', ' ')}  ${row.outcome.padEnd(8)} ${row.skillId}`, {
      colour: row.outcome === 'passed' ? 'green' : row.outcome === 'failed' ? 'red' : 'yellow',
    })
  }
  return rows
}
```

- [ ] **Step 4: Write the shared list renderer**

`src/tui/components/ScreenList.tsx`:

```tsx
import { Box, Text } from 'ink'
import { screenBodyRows, windowFor, type Layout } from '../layout.js'
import type { ScreenRow } from '../rows.js'
import { Panel } from './Panel.js'

/**
 * One windowing renderer for every row-list screen. `offset` is first-visible,
 * and the overflow notice is counted *against* the allocation rather than
 * appended below it — §14.1's first rule, and the exact extra row that used to
 * push Work's footer off an 80x24 frame.
 */
export function ScreenList({
  title,
  hint,
  rows,
  offset,
  layout,
}: {
  title: string
  hint?: string
  rows: readonly ScreenRow[]
  offset: number
  layout: Layout
}): React.ReactElement {
  const budget = screenBodyRows(layout)
  const overflow = rows.length > budget
  const height = overflow ? Math.max(1, budget - 1) : budget
  const { start, end } = windowFor(rows.length, offset, height)

  return (
    <Panel title={title} {...(hint === undefined ? {} : { hint })} focused chrome={layout.chrome}>
      {rows.slice(start, end).map((row, index) => (
        <Box key={`${start + index}`}>
          <Text
            wrap="truncate"
            bold={row.heading === true}
            dimColor={row.dim === true}
            {...(row.colour === undefined ? {} : { color: row.colour })}
          >
            {row.text}
          </Text>
        </Box>
      ))}
      {overflow && (
        <Text dimColor wrap="truncate">
          rows {start + 1}–{end} of {rows.length} · j/k scrolls
        </Text>
      )}
    </Panel>
  )
}
```

- [ ] **Step 5: Write the Dashboard**

`src/tui/components/Dashboard.tsx`:

```tsx
import { useEffect } from 'react'
import { Box, Text, useWindowSize } from 'ink'
import { innerWidth, layoutFor, truncate } from '../layout.js'
import { dashboardRows } from '../rows.js'
import type { Action, AppState } from '../store.js'
import { ScreenList } from './ScreenList.js'

const HINTS = 'j/k scroll · p provenance · s scope · : commands · esc work · q quit'

export function Dashboard({
  state,
  dispatch,
}: {
  state: AppState
  dispatch: (action: Action) => void
}): React.ReactElement {
  const { columns, rows } = useWindowSize()
  const layout = layoutFor(columns, rows)
  const body = dashboardRows(state, Math.max(8, innerWidth(columns, layout.chrome)))

  // The scroll clamp needs the row count, and only this component knows the
  // width the rows were built at, so it reports it rather than the reducer
  // guessing. Kept in an effect so a render never dispatches during render.
  useEffect(() => {
    dispatch({ type: 'set-screen-row-count', count: body.length })
  }, [body.length])

  const provenance = state.provenances.find(
    (option) => option.fingerprint === state.statsFilter.provenanceFp,
  )

  return (
    <Box flexDirection="column" width={columns}>
      <ScreenList
        title="Dashboard"
        hint={
          provenance === undefined
            ? `${state.provenances.length} provenance(s)`
            : `${provenance.baseUrlHost ?? 'no host'} · ${provenance.runs} runs`
        }
        rows={body}
        offset={state.screenOffset}
        layout={layout}
      />
      <Text dimColor>{truncate(HINTS, columns)}</Text>
    </Box>
  )
}
```

- [ ] **Step 6: Add the Dashboard keys**

In `app.tsx`, after the palette block:

```tsx
    if (state.screen === 'dashboard') {
      if (plain && input === 'p') {
        // Cycles through the options and past the end to unfiltered, so the key
        // that applies a filter is also the key that removes it.
        const ids: Array<string | undefined> = [
          undefined,
          ...state.provenances.map((option) => option.fingerprint),
        ]
        const next = ids[(ids.indexOf(state.statsFilter.provenanceFp) + 1) % ids.length]
        dispatch({
          type: 'set-stats-filter',
          filter: next === undefined ? {} : { provenanceFp: next },
        })
      } else if (plain && input === 's') {
        const skillId = state.statsFilter.skillId === undefined ? current?.skillId : undefined
        dispatch({ type: 'set-stats-filter', filter: skillId === undefined ? {} : { skillId } })
      } else if ((plain && input === 'j') || key.downArrow) {
        dispatch({ type: 'scroll-screen', delta: 1, viewport: screenBodyRows(layout) })
      } else if ((plain && input === 'k') || key.upArrow) {
        dispatch({ type: 'scroll-screen', delta: -1, viewport: screenBodyRows(layout) })
      }
      return
    }
```

`layout` here is the one `App` already computes for `reviewDiffRows`.

- [ ] **Step 7: Write the failing screen test**

`tests/tui/dashboard.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { createQueue, type SkillRef, type StatsFilter } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeRun } from '../helpers/fake-run.js'
import { emptyDashboard, fakeViews } from '../helpers/fake-views.js'
import { renderInk } from '../helpers/render-ink.js'
import { skillFixture } from '../helpers/ledger-fixture.js'

const SKILL = skillFixture('alpha', 'declawed') as SkillRef
const OPTIONS = [
  {
    fingerprint: 'aaaaaaaaaaaa',
    baseUrlHost: 'api.deepseek.com',
    model: 'm',
    analysisModes: 'skillspector:static',
    runs: 3,
    firstSeen: '2026-08-01T00:00:00.000Z',
    lastSeen: '2026-08-03T00:00:00.000Z',
  },
]

const STATS = {
  ...emptyDashboard,
  repos: 2,
  skills: 3,
  runs: 4,
  stagePassRates: [{ stage: 'validate' as const, runs: 4, passed: 3, rate: 0.75 }],
  wallClock: [{ stage: 'validate' as const, runs: 4, medianMs: 2_500, maxMs: 9_000 }],
  evalCases: { casesTotal: 10, casesPassed: 7, casesErrored: 0, rate: 0.7 },
  openBySeverity: [{ severity: 'high' as const, count: 2 }],
  openByRuleClass: [{ ruleClass: 'prompt-injection', count: 2 }],
  history: [],
}

async function onDashboard(size = { columns: 100, rows: 30 }) {
  const asked: StatsFilter[] = []
  const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('r1').handle })
  const views = fakeViews({
    dashboard: async (filter) => {
      asked.push(filter)
      // A narrowed filter must visibly change the answer, or the assertion
      // below would pass on a screen that ignored the key.
      return filter.provenanceFp === undefined && filter.skillId === undefined
        ? STATS
        : { ...STATS, repos: 1, skills: 1, runs: 1 }
    },
    provenances: async () => OPTIONS,
  })
  const ui = renderInk(
    <App
      skills={[SKILL]}
      queue={queue}
      stages={['security']}
      concurrency={1}
      views={views}
      intervalMs={20}
    />,
    size,
  )
  await ui.settle()
  ui.stdin.send(':')
  for (const char of 'dashboard') ui.stdin.send(char)
  ui.stdin.send('\r')
  await ui.settle(60)
  return { ui, asked }
}

describe('Dashboard screen — R8.9, R7.6', () => {
  it('renders every R8.9 section', async () => {
    const { ui } = await onDashboard()
    const frame = ui.lastFrame()
    for (const section of [
      'Stage pass rate',
      'Eval cases',
      'Wall clock',
      'Open issues',
      'Run history',
    ]) {
      expect(frame).toContain(section)
    }
  })

  it('p applies a provenance filter and p again removes it', async () => {
    const { ui, asked } = await onDashboard()
    ui.stdin.send('p')
    await ui.settle(60)
    expect(asked.at(-1)).toEqual({ provenanceFp: 'aaaaaaaaaaaa' })
    expect(ui.lastFrame()).toContain('1 repos')
    ui.stdin.send('p')
    await ui.settle(60)
    expect(asked.at(-1)).toEqual({})
    expect(ui.lastFrame()).toContain('2 repos')
  })

  it('s narrows to the selected skill and back', async () => {
    const { ui, asked } = await onDashboard()
    ui.stdin.send('s')
    await ui.settle(60)
    expect(asked.at(-1)).toEqual({ skillId: 'alpha/declawed' })
    ui.stdin.send('s')
    await ui.settle(60)
    expect(asked.at(-1)).toEqual({})
  })

  it('fits an 80x24 and a 50x14 terminal', async () => {
    for (const size of [
      { columns: 80, rows: 24 },
      { columns: 50, rows: 14 },
    ]) {
      const { ui } = await onDashboard(size)
      expect(ui.lastFrame().split('\n').length).toBeLessThanOrEqual(size.rows)
    }
  })
})
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm vitest run tests/tui/rows.test.ts tests/tui/dashboard.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/tui tests/tui/rows.test.ts tests/tui/dashboard.test.tsx
git commit -m "feat: render cross-repo statistics on a Dashboard screen"
```

---

### Task 9: The Issues screen

A cross-repo table with a selection and the three user transitions.

**Files:**
- Create: `src/tui/components/Issues.tsx`
- Create: `tests/tui/issues.test.tsx`
- Modify: `src/tui/app.tsx` (the Issues keys)

**Interfaces:**
- Consumes: `IssueRow`, `IssueFilter`, `IssueAction`, `GantryViews.issues`, `GantryViews.actOnIssue`, `screenBodyRows`, `windowFor`, `truncate`, `truncateMiddle`.
- Produces: nothing later tasks build on beyond the keymap Task 11 documents in `Help.tsx`.

- [ ] **Step 1: Write the failing test**

`tests/tui/issues.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { createQueue, type IssueRow, type SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeRun } from '../helpers/fake-run.js'
import { fakeViews } from '../helpers/fake-views.js'
import { renderInk } from '../helpers/render-ink.js'

const issue = (over: Partial<IssueRow>): IssueRow => ({
  fingerprint: 'fp000000abcd',
  skillId: 'alpha/declawed',
  repoId: 'alpha',
  ruleClass: 'prompt-injection',
  relPath: 'declawed/SKILL.md',
  severity: 'high',
  state: 'open',
  occurrenceCount: 2,
  detectors: ['skillspector', 'skill-scanner'],
  blockedBy: ['skill-scanner'],
  lastSeenRun: '019283af-0000-7000-8000-000000000001',
  ...over,
})

const ROWS = [
  issue({}),
  issue({
    fingerprint: 'fp111111beef',
    skillId: 'beta/spec-lint',
    repoId: 'beta',
    ruleClass: 'metadata-invalid',
    relPath: 'spec-lint/SKILL.md',
    severity: 'low',
    detectors: ['skill-lint'],
    blockedBy: [],
  }),
]

async function onIssues(rows: IssueRow[] = ROWS, size = { columns: 100, rows: 30 }) {
  const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('r1').handle })
  const views = fakeViews({ issues: async () => rows })
  const ui = renderInk(
    <App
      skills={[] as SkillRef[]}
      queue={queue}
      stages={['security']}
      concurrency={1}
      views={views}
      intervalMs={20}
    />,
    size,
  )
  await ui.settle()
  ui.stdin.send(':')
  for (const char of 'issues') ui.stdin.send(char)
  ui.stdin.send('\r')
  await ui.settle(40)
  return { ui, views }
}

describe('Issues screen — R11.3, across every registered repo', () => {
  it('lists issues from both repos with severity, state and path', async () => {
    const { ui } = await onIssues()
    const frame = ui.lastFrame()
    for (const expected of ['alpha/declawed', 'beta/spec-lint', 'prompt-injection', 'high']) {
      expect(frame).toContain(expected)
    }
  })

  it('names the detector holding an issue open, which is the one reconcile waits on', async () => {
    const { ui } = await onIssues()
    expect(ui.lastFrame()).toContain('skill-scanner')
  })

  it('acknowledges the selected issue', async () => {
    const { ui, views } = await onIssues()
    ui.stdin.send('a')
    await ui.settle(40)
    expect(views.actions).toEqual([['fp000000abcd', 'acknowledge']])
  })

  it('marks wontfix and reopens through the same path', async () => {
    const { ui, views } = await onIssues()
    ui.stdin.send('w')
    await ui.settle(40)
    ui.stdin.send('o')
    await ui.settle(40)
    expect(views.actions.map(([, action]) => action)).toEqual(['wontfix', 'reopen'])
  })

  it('acts on the row under the cursor, not the first one', async () => {
    const { ui, views } = await onIssues()
    ui.stdin.send('j')
    await ui.settle()
    ui.stdin.send('a')
    await ui.settle(40)
    expect(views.actions).toEqual([['fp111111beef', 'acknowledge']])
  })

  it('re-reads the list after a transition rather than patching a row in place', async () => {
    // A patched row the filter no longer admits stays on screen and cannot be
    // acted on again, so the transition asks the ledger what it now matches.
    let calls = 0
    const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('r1').handle })
    const views = fakeViews({
      issues: async () => {
        calls += 1
        return ROWS
      },
    })
    const ui = renderInk(
      <App
        skills={[] as SkillRef[]}
        queue={queue}
        stages={['security']}
        concurrency={1}
        views={views}
        intervalMs={20}
      />,
    )
    await ui.settle()
    ui.stdin.send(':')
    for (const char of 'issues') ui.stdin.send(char)
    ui.stdin.send('\r')
    await ui.settle(40)
    const before = calls
    ui.stdin.send('a')
    await ui.settle(60)
    expect(calls).toBeGreaterThan(before)
  })

  it('cycles the state filter', async () => {
    const { ui } = await onIssues()
    ui.stdin.send('f')
    await ui.settle(40)
    expect(ui.lastFrame()).toContain('open')
  })

  it('says so when nothing matches rather than rendering an empty frame', async () => {
    const { ui } = await onIssues([])
    expect(ui.lastFrame()).toContain('no issues')
  })

  it('fits an 80x24 and a 50x14 terminal', async () => {
    for (const size of [
      { columns: 80, rows: 24 },
      { columns: 50, rows: 14 },
    ]) {
      const { ui } = await onIssues(ROWS, size)
      expect(ui.lastFrame().split('\n').length).toBeLessThanOrEqual(size.rows)
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/tui/issues.test.tsx`
Expected: FAIL — the Task 7 stub renders no rows and answers no keys.

- [ ] **Step 3: Write the component**

`src/tui/components/Issues.tsx`:

```tsx
import { Box, Text, useWindowSize } from 'ink'
import {
  innerWidth,
  layoutFor,
  screenBodyRows,
  truncate,
  truncateMiddle,
  windowFor,
} from '../layout.js'
import type { AppState } from '../store.js'
import { Panel } from './Panel.js'

const HINTS = 'j/k move · a ack · w wontfix · o reopen · f filter · : commands · esc work'

const SEVERITY_COLOUR: Record<string, string> = {
  critical: 'red',
  high: 'red',
  medium: 'yellow',
  low: 'gray',
  info: 'gray',
}

/** Paired with the word, so the state survives a monochrome terminal. */
const STATE_MARK: Record<string, string> = {
  open: '●',
  acknowledged: '◐',
  wontfix: '×',
  fixed: '○',
}

export function Issues({ state }: { state: AppState }): React.ReactElement {
  const { columns, rows } = useWindowSize()
  const layout = layoutFor(columns, rows)
  const cols = Math.max(20, innerWidth(columns, layout.chrome))
  const budget = screenBodyRows(layout)
  const overflow = state.issues.length > budget
  const height = overflow ? Math.max(1, budget - 1) : budget
  const { start, end } = windowFor(state.issues.length, state.selectedIssue, height)

  // Fixed left columns, path last: the path is the only field that can be
  // arbitrarily long, so it is the only one that should absorb the truncation.
  const severityWidth = 9
  const stateWidth = 14
  const skillWidth = Math.min(24, Math.max(10, Math.floor(cols * 0.22)))
  const pathWidth = Math.max(8, cols - severityWidth - stateWidth - skillWidth - 4)

  return (
    <Box flexDirection="column" width={columns}>
      <Panel
        title="Issues"
        hint={`${state.issues.length} · ${state.issueFilter.state ?? 'every state'}`}
        focused
        chrome={layout.chrome}
      >
        {state.viewError !== null && (
          <Text color="red" wrap="truncate">
            {truncate(`ledger read failed: ${state.viewError}`, cols)}
          </Text>
        )}
        {state.viewError === null && state.issues.length === 0 && (
          <Text dimColor wrap="truncate">
            no issues match this filter
          </Text>
        )}
        {state.issues.slice(start, end).map((row, offset) => {
          const index = start + offset
          // The detectors that have not since reported a conclusive absence —
          // R8.8's blockers, so "why is this still open" is on the row.
          const blocked = row.blockedBy.length === 0 ? '' : ` ⟂ ${row.blockedBy.join(',')}`
          return (
            <Box key={row.fingerprint}>
              <Text wrap="truncate" bold={index === state.selectedIssue}>
                {index === state.selectedIssue ? '›' : ' '}{' '}
                <Text color={SEVERITY_COLOUR[row.severity] ?? 'gray'}>
                  {row.severity.padEnd(severityWidth)}
                </Text>
                <Text>{`${STATE_MARK[row.state] ?? '?'} ${row.state}`.padEnd(stateWidth)}</Text>
                <Text>{truncate(row.skillId, skillWidth).padEnd(skillWidth)}</Text>
                <Text dimColor>
                  {truncateMiddle(`${row.ruleClass} ${row.relPath}${blocked}`, pathWidth)}
                </Text>
              </Text>
            </Box>
          )
        })}
        {overflow && (
          <Text dimColor wrap="truncate">
            rows {start + 1}–{end} of {state.issues.length}
          </Text>
        )}
      </Panel>
      <Text dimColor>{truncate(HINTS, columns)}</Text>
    </Box>
  )
}
```

- [ ] **Step 4: Add the Issues keys**

In `app.tsx`:

```tsx
    if (state.screen === 'issues') {
      const row = state.issues[state.selectedIssue]
      const act = (action: IssueAction): void => {
        if (!row) return
        // Re-read rather than patch: a locally-patched row the current filter no
        // longer admits stays on screen and cannot be acted on again, and the
        // ledger is the authority for what the transition actually produced.
        void views
          .actOnIssue(row.fingerprint, action)
          .then(() => dispatch({ type: 'refresh-views' }))
          .catch((err: unknown) =>
            dispatch({ type: 'view-error', message: (err as Error).message }),
          )
      }
      if ((plain && input === 'j') || key.downArrow) dispatch({ type: 'select-issue', delta: 1 })
      else if ((plain && input === 'k') || key.upArrow) dispatch({ type: 'select-issue', delta: -1 })
      else if (plain && input === 'a') act('acknowledge')
      else if (plain && input === 'w') act('wontfix')
      else if (plain && input === 'o') act('reopen')
      else if (plain && input === 'f') {
        const states: Array<IssueState | undefined> = [
          undefined,
          'open',
          'acknowledged',
          'wontfix',
          'fixed',
        ]
        const next = states[(states.indexOf(state.issueFilter.state) + 1) % states.length]
        dispatch({ type: 'set-issue-filter', filter: next === undefined ? {} : { state: next } })
      }
      return
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/tui/issues.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tui tests/tui/issues.test.tsx
git commit -m "feat: triage issues across repos from an Issues screen"
```

---

### Task 10: Tools and Settings, the two read-only screens

Both are row lists over data the port already returns, so they share Task 8's `ScreenList` and one test file.

**Files:**
- Modify: `src/tui/rows.ts` (`toolsRows`, `settingsRows`)
- Create: `src/tui/components/Tools.tsx`, `src/tui/components/Settings.tsx`
- Modify: `tests/tui/rows.test.ts`
- Create: `tests/tui/tools-settings.test.tsx`
- Modify: `src/tui/app.tsx` (their keys)

**Interfaces:**
- Consumes: `DoctorReport`, `SettingsView`, `ScreenRow`, `ScreenList`, `screenBodyRows`.
- Produces: `toolsRows(state, width)`, `settingsRows(state, width)`.

- [ ] **Step 1: Write the failing row tests**

Append to `tests/tui/rows.test.ts`. Read `DoctorReport`'s and `ToolFinding`'s real fields from `src/core/tools/doctor.ts` first and build the fixtures from those, not from this plan's guess:

```ts
describe('toolsRows', () => {
  it('lists every runtime and every tool with its drift kind', () => {
    const state = reducer(initialState([], 2), {
      type: 'set-tools',
      report: {
        runtimes: [
          { runtime: 'uv', present: true, version: '0.7.12', installCommand: 'brew install uv' },
          { runtime: 'go', present: false, version: null, installCommand: 'brew install go' },
        ],
        tools: [
          toolFinding('skillspector', 'ok', '2.5.1'),
          toolFinding('skill-up', 'version-drift', 'locked 0.4.0, reports 0.5.0'),
        ],
        lifecycle: [{ skillId: 'alpha/declawed', file: 'deprecated', ledger: 'active' }],
        failed: true,
      },
    })
    const text = toolsRows(state, 80).map((row) => row.text).join('\n')
    expect(text).toContain('uv')
    expect(text).toContain('0.7.12')
    expect(text).toContain('brew install go')
    expect(text).toContain('version-drift')
    expect(text).toContain('lifecycle-drift')
    expect(text).toContain('drift found')
  })

  it('says what resolves a pending rule map rather than resolving it', () => {
    // R8.14: the migration is explicit, and this screen is not a trigger.
    const state = reducer(initialState([], 2), {
      type: 'set-tools',
      report: { runtimes: [], tools: [], lifecycle: [], failed: false },
    })
    expect(toolsRows(state, 80).map((row) => row.text).join('\n')).toContain(
      'doctor --migrate-rule-map',
    )
  })
})

describe('settingsRows', () => {
  it('lists repos, concurrency, credential status and the env warnings', () => {
    const state = reducer(initialState([], 2), {
      type: 'set-settings',
      view: {
        ...emptySettings,
        concurrency: 3,
        repos: [{ id: 'alpha', name: 'alpha', path: '/alpha', isGit: true, skills: 20 }],
        credentials: [{ label: 'skillspector', satisfied: true, detail: 'no credential required' }],
        envWarnings: ['/home/.skillgantry/.env is more permissive than 600 (mode 644)'],
      },
    })
    const text = settingsRows(state, 100).map((row) => row.text).join('\n')
    expect(text).toContain('/alpha')
    expect(text).toContain('20 skills')
    expect(text).toContain('concurrency 3')
    expect(text).toContain('skillspector')
    expect(text).toContain('more permissive than 600')
  })

  it('never renders a credential value', () => {
    const state = reducer(initialState([], 2), {
      type: 'set-settings',
      view: {
        ...emptySettings,
        credentials: [{ label: 'skillspector', satisfied: false, detail: 'needs one of OpenAI' }],
      },
    })
    const text = settingsRows(state, 100).map((row) => row.text).join('\n')
    expect(text).toContain('needs one of OpenAI')
    expect(text).not.toContain('sk-')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/tui/rows.test.ts`
Expected: FAIL — `toolsRows` and `settingsRows` are not exported.

- [ ] **Step 3: Write both row builders**

Append to `src/tui/rows.ts`:

```ts
const DRIFT_COLOUR: Record<string, string> = {
  ok: 'green',
  missing: 'red',
  unverifiable: 'red',
  'version-drift': 'yellow',
  unlocked: 'yellow',
  'integrity-unverified': 'yellow',
}

export function toolsRows(state: AppState, width: number): ScreenRow[] {
  const rows: ScreenRow[] = []
  const line = (text: string, extra: Omit<ScreenRow, 'text'> = {}): void => {
    rows.push({ text: truncate(text, width), ...extra })
  }

  if (state.viewError !== null) {
    line(`doctor failed: ${state.viewError}`, { colour: 'red' })
    return rows
  }
  const report = state.tools
  if (report === null) {
    line('probing runtimes and verifying tools…', { dim: true })
    return rows
  }

  line('Runtimes', { heading: true })
  for (const runtime of report.runtimes) {
    line(
      runtime.present
        ? `  ${runtime.runtime.padEnd(10)} ${runtime.version ?? ''}`
        : `  ${runtime.runtime.padEnd(10)} missing — ${runtime.installCommand}`,
      { colour: runtime.present ? 'green' : 'red' },
    )
  }

  line('Tools', { heading: true })
  if (report.tools.length === 0) line('  nothing locked yet — run the setup wizard', { dim: true })
  for (const tool of report.tools) {
    line(`  ${tool.toolId.padEnd(16)} ${tool.kind}${tool.detail ? `  ${tool.detail}` : ''}`, {
      colour: DRIFT_COLOUR[tool.kind] ?? 'gray',
    })
  }

  if (report.lifecycle.length > 0) {
    line('Lifecycle drift', { heading: true })
    for (const drift of report.lifecycle) {
      // R1.6: the file is the authority, so this is the cache to reconcile, not
      // an error — which is exactly how doctor reports it.
      line(`  ${drift.skillId.padEnd(20)} file ${drift.file}, ledger ${drift.ledger}`, {
        colour: 'yellow',
      })
    }
  }

  line(report.failed ? 'drift found' : 'no drift', {
    colour: report.failed ? 'yellow' : 'green',
  })
  // The migration is explicit (R8.14), so this screen names the command and is
  // not itself a trigger. Stated unconditionally rather than only when pending:
  // a user reading a clean report should still know where the button is.
  line('resolve with: skillgantry doctor --migrate-rule-map', { dim: true })
  return rows
}

export function settingsRows(state: AppState, width: number): ScreenRow[] {
  const rows: ScreenRow[] = []
  const line = (text: string, extra: Omit<ScreenRow, 'text'> = {}): void => {
    rows.push({ text: truncate(text, width), ...extra })
  }

  if (state.viewError !== null) {
    line(`config read failed: ${state.viewError}`, { colour: 'red' })
    return rows
  }
  const view = state.settings
  if (view === null) {
    line('loading…', { dim: true })
    return rows
  }

  line('Repos', { heading: true })
  if (view.repos.length === 0) line('  none registered — skillgantry setup registers one', { dim: true })
  for (const repo of view.repos) {
    line(`  ${repo.id.padEnd(14)} ${repo.skills} skills  ${repo.isGit ? 'git' : 'no git'}  ${repo.path}`)
  }

  line('Execution', { heading: true })
  line(`  concurrency ${view.concurrency}`)
  for (const [stage, tools] of Object.entries(view.stageTools)) {
    line(`  ${stage.padEnd(10)} ${tools.length === 0 ? 'no tool selected' : tools.join(', ')}`, {
      dim: tools.length === 0,
    })
  }

  line('Credentials', { heading: true })
  if (view.credentials.length === 0) line('  no selected tool declares one', { dim: true })
  for (const credential of view.credentials) {
    // Presence and provider label only. R7.3 keeps credential values out of
    // every file SkillGantry writes, and a screen is not an exception.
    line(`  ${credential.label.padEnd(16)} ${credential.satisfied ? 'ok' : 'missing'}  ${credential.detail}`, {
      colour: credential.satisfied ? 'green' : 'yellow',
    })
  }
  for (const warning of view.envWarnings) line(`  ${warning}`, { colour: 'yellow' })

  line('Paths', { heading: true })
  line(`  home    ${view.home}`, { dim: true })
  line(`  ledger  ${view.dbPath}`, { dim: true })
  line(
    `  rule map v${view.ruleMap.applied} applied, v${view.ruleMap.current} shipped`,
    { dim: view.ruleMap.applied === view.ruleMap.current, colour: view.ruleMap.applied === view.ruleMap.current ? undefined : 'yellow' },
  )
  return rows
}
```

The last `line` call passes `colour: undefined` in one branch, which `exactOptionalPropertyTypes` rejects — build the object conditionally, the way `LifecycleRail` already spreads `color`.

- [ ] **Step 4: Write both components**

`src/tui/components/Tools.tsx`:

```tsx
import { useEffect } from 'react'
import { Box, Text, useWindowSize } from 'ink'
import { innerWidth, layoutFor, truncate } from '../layout.js'
import { toolsRows } from '../rows.js'
import type { Action, AppState } from '../store.js'
import { ScreenList } from './ScreenList.js'

const HINTS = 'j/k scroll · r refresh · : commands · esc work · q quit'

export function Tools({
  state,
  dispatch,
}: {
  state: AppState
  dispatch: (action: Action) => void
}): React.ReactElement {
  const { columns, rows } = useWindowSize()
  const layout = layoutFor(columns, rows)
  const body = toolsRows(state, Math.max(8, innerWidth(columns, layout.chrome)))

  useEffect(() => {
    dispatch({ type: 'set-screen-row-count', count: body.length })
  }, [body.length])

  return (
    <Box flexDirection="column" width={columns}>
      <ScreenList
        title="Tools"
        hint={state.tools === null ? 'probing' : state.tools.failed ? 'drift found' : 'verified'}
        rows={body}
        offset={state.screenOffset}
        layout={layout}
      />
      <Text dimColor>{truncate(HINTS, columns)}</Text>
    </Box>
  )
}
```

`src/tui/components/Settings.tsx` is the same file with four values changed. Written out rather than described, because a task's implementer sees only their own task:

```tsx
import { useEffect } from 'react'
import { Box, Text, useWindowSize } from 'ink'
import { innerWidth, layoutFor, truncate } from '../layout.js'
import { settingsRows } from '../rows.js'
import type { Action, AppState } from '../store.js'
import { ScreenList } from './ScreenList.js'

const HINTS = 'j/k scroll · : commands · esc work · q quit'

export function Settings({
  state,
  dispatch,
}: {
  state: AppState
  dispatch: (action: Action) => void
}): React.ReactElement {
  const { columns, rows } = useWindowSize()
  const layout = layoutFor(columns, rows)
  const body = settingsRows(state, Math.max(8, innerWidth(columns, layout.chrome)))

  useEffect(() => {
    dispatch({ type: 'set-screen-row-count', count: body.length })
  }, [body.length])

  return (
    <Box flexDirection="column" width={columns}>
      <ScreenList
        title="Settings"
        hint={`${state.settings?.repos.length ?? 0} repos`}
        rows={body}
        offset={state.screenOffset}
        layout={layout}
      />
      <Text dimColor>{truncate(HINTS, columns)}</Text>
    </Box>
  )
}
```

- [ ] **Step 5: Add their keys**

```tsx
    if (state.screen === 'tools' || state.screen === 'settings') {
      if (plain && input === 'r' && state.screen === 'tools') {
        // A re-probe, not a migration: `tools()` invokes each binary's version
        // argv, which is what R3.9 means by re-verify.
        dispatch({ type: 'refresh-views' })
      } else if ((plain && input === 'j') || key.downArrow) {
        dispatch({ type: 'scroll-screen', delta: 1, viewport: screenBodyRows(layout) })
      } else if ((plain && input === 'k') || key.upArrow) {
        dispatch({ type: 'scroll-screen', delta: -1, viewport: screenBodyRows(layout) })
      }
      return
    }
```

- [ ] **Step 6: Write the screen test**

`tests/tui/tools-settings.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { createQueue, type SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeRun } from '../helpers/fake-run.js'
import { emptyDoctor, emptySettings, fakeViews, toolFinding } from '../helpers/fake-views.js'
import { renderInk } from '../helpers/render-ink.js'

const REPORT = {
  ...emptyDoctor,
  runtimes: [
    { runtime: 'uv' as const, present: true, version: '0.7.12', installCommand: 'brew install uv' },
  ],
  tools: [toolFinding('skillspector', 'ok', '2.5.1')],
}

const VIEW = {
  ...emptySettings,
  concurrency: 3,
  repos: [{ id: 'alpha', name: 'alpha', path: '/alpha', isGit: true, skills: 20 }],
  credentials: [{ label: 'skillspector', satisfied: true, detail: 'no credential required' }],
}

async function screen(name: string, size = { columns: 100, rows: 30 }) {
  let toolsCalls = 0
  const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('r1').handle })
  const views = fakeViews({
    tools: async () => {
      toolsCalls += 1
      return REPORT
    },
    settings: async () => VIEW,
  })
  const ui = renderInk(
    <App
      skills={[] as SkillRef[]}
      queue={queue}
      stages={['security']}
      concurrency={1}
      views={views}
      intervalMs={20}
    />,
    size,
  )
  await ui.settle()
  ui.stdin.send(':')
  for (const char of name) ui.stdin.send(char)
  ui.stdin.send('\r')
  await ui.settle(60)
  return { ui, calls: () => toolsCalls }
}

describe('Tools screen — R3.9 rendered', () => {
  it('lists runtimes and tools', async () => {
    const { ui } = await screen('tools')
    expect(ui.lastFrame()).toContain('Runtimes')
    expect(ui.lastFrame()).toContain('skillspector')
  })

  it('r re-probes', async () => {
    const { ui, calls } = await screen('tools')
    const before = calls()
    ui.stdin.send('r')
    await ui.settle(60)
    expect(calls()).toBeGreaterThan(before)
  })
})

describe('Settings screen', () => {
  it('shows repos, concurrency and credential status', async () => {
    const { ui } = await screen('settings')
    const frame = ui.lastFrame()
    expect(frame).toContain('/alpha')
    expect(frame).toContain('concurrency 3')
    expect(frame).toContain('skillspector')
  })

  it('renders no credential value — R7.3 holds for a screen too', async () => {
    const { ui } = await screen('settings')
    expect(ui.lastFrame()).not.toMatch(/sk-[A-Za-z0-9]/)
  })
})

describe('both screens fit a small terminal', () => {
  it('fits 80x24 and 50x14', async () => {
    for (const name of ['tools', 'settings']) {
      for (const size of [
        { columns: 80, rows: 24 },
        { columns: 50, rows: 14 },
      ]) {
        const { ui } = await screen(name, size)
        expect(ui.lastFrame().split('\n').length).toBeLessThanOrEqual(size.rows)
      }
    }
  })
})
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run tests/tui/rows.test.ts tests/tui/tools-settings.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/tui tests/tui/rows.test.ts tests/tui/tools-settings.test.tsx
git commit -m "feat: show the doctor report and the resolved settings as screens"
```

---

### Task 11: Help, the footer, and the row budget across every screen

Four new full-screen views and eleven new bindings. Design §14.1's rules are the contract, and `layout.test.tsx` is where they are enforced.

**Files:**
- Modify: `src/tui/components/Help.tsx`
- Modify: `tests/tui/layout.test.tsx`

**Interfaces:**
- Consumes: every screen from Tasks 8–10.
- Produces: nothing; this is the task that proves the previous four did not overflow.

- [ ] **Step 1: Extend the layout regression test**

In `tests/tui/layout.test.tsx`, add a case that walks all five screens at every size the file already tests (200×60, 120×40, 100×30, 80×24, 60×20, 50×14) and asserts, for each frame:

```ts
      const lines = ui.lastFrame().split('\n')
      expect(lines.length).toBeLessThanOrEqual(size.rows)
      for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(size.columns)
```

Reach each screen by dispatching through the palette, and seed `fakeViews` with **more rows than any of these terminals can show** — 40 issues, a 30-entry run history, 12 tools — because a budget only holds where there is overflow to truncate.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/tui/layout.test.tsx`
Expected: FAIL on the smallest sizes if any screen appended its overflow notice below its allocation, which is §14.1's first rule and the one this test exists to catch.

- [ ] **Step 3: Fix whatever overflows**

The fix is always the same shape and always in one place: subtract the notice row from the window height in `ScreenList` or `Issues`, never add a row below the panel. If a screen needs a row it has not got at 50×14, it drops content, not chrome.

- [ ] **Step 4: Add the new bindings to help**

In `src/tui/components/Help.tsx`, extend `KEYS`:

```ts
  [':', 'command palette: go to a screen, refresh, quit'],
  ['esc', 'back to Work from any screen'],
  ['p', 'Dashboard: filter by provenance fingerprint'],
  ['s', 'Dashboard: narrow to the selected skill'],
  ['a / w / o', 'Issues: acknowledge, wontfix, reopen'],
  ['f', 'Issues: cycle the state filter'],
  ['r', 'Tools: re-probe runtimes and re-verify every locked tool'],
```

`r` now means two things on two screens — enqueue on Work, refresh on Tools — so both entries name their screen. Help already windows its list and reports what it cut, so the longer list needs no other change; the `+N more` case simply fires on shorter terminals than before, which the layout test covers.

- [ ] **Step 5: Run the whole TUI suite**

Run: `pnpm vitest run tests/tui`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tui/components/Help.tsx tests/tui/layout.test.tsx
git commit -m "fix: keep every screen inside its row budget and document the new keys"
```

---

### Task 12: The M6 acceptance suite

One named test per clause of M6's exit criteria: *Dashboard and Issues render ledger queries across all registered repos.*

**Files:**
- Create: `tests/acceptance/m6.test.tsx`

**Interfaces:**
- Consumes: `createGantryViews` (Task 6), `recordFixtureRun` (Task 4), the four screens.
- Produces: nothing.

- [ ] **Step 1: Write the suite**

`tests/acceptance/m6.test.tsx`. It writes a real config and a real ledger under a temp home, records runs for skills in **two** repos, builds the port with `createGantryViews` — not a fake — and drives the rendered `App`. No subprocess, so it runs in the same second as the rest of the acceptance suite.

```tsx
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createQueue } from '../../src/core/index.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { createGantryViews } from '../../src/cli/gantry-views.js'
import { App } from '../../src/tui/app.js'
import { fakeRun } from '../helpers/fake-run.js'
import { recordFixtureRun, skillFixture } from '../helpers/ledger-fixture.js'
import { renderInk } from '../helpers/render-ink.js'

const ALPHA = skillFixture('alpha', 'declawed')
const BETA = skillFixture('beta', 'spec-lint')
const P1 = { baseUrlHost: 'api.deepseek.com', models: {}, authTokenHash: null, analysisModes: {} }
const P2 = { baseUrlHost: 'api.anthropic.com', models: {}, authTokenHash: null, analysisModes: {} }

async function gantry() {
  const home = await mkdtemp(join(tmpdir(), 'sg-m6-'))
  await writeFile(
    join(home, 'config.json'),
    JSON.stringify({
      version: 1,
      repos: [],
      stageTools: { validate: ['skill-lint'], evaluate: ['skill-up'], security: ['skillspector'], optimise: [] },
      concurrency: 2,
      artefactSizeCapBytes: 33_554_432,
      timeoutOverridesMs: {},
      mutationTimeoutMs: 300_000,
    }),
  )
  const dbPath = join(home, 'gantry.db')
  const ledger = openLedger(dbPath)
  recordFixtureRun(ledger, {
    runId: '019283af-0000-7000-8000-000000000001',
    skill: ALPHA,
    provenance: P1,
    stages: [
      { stage: 'validate', outcome: 'passed', seconds: 2 },
      { stage: 'evaluate', outcome: 'passed', seconds: 10, metrics: { casesTotal: 6, casesPassed: 5 } },
      {
        stage: 'security',
        outcome: 'failed',
        seconds: 4,
        findings: [
          {
            ruleClass: 'prompt-injection' as never,
            nativeRuleId: 'AST1',
            severity: 'high',
            path: 'declawed/SKILL.md',
            message: 'injection',
          },
        ],
      },
    ],
  })
  recordFixtureRun(ledger, {
    runId: '019283af-0000-7000-8000-000000000002',
    skill: BETA,
    provenance: P2,
    stages: [
      {
        stage: 'validate',
        outcome: 'failed',
        seconds: 6,
        toolId: 'skill-lint',
        findings: [
          {
            ruleClass: 'metadata-invalid' as never,
            nativeRuleId: 'R01',
            severity: 'medium',
            path: 'spec-lint/SKILL.md',
            message: 'no description',
          },
        ],
      },
    ],
  })
  ledger.close()

  const views = createGantryViews({ home, dbPath, write: () => undefined })
  const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('r1').handle })
  const ui = renderInk(
    <App skills={[ALPHA, BETA]} queue={queue} stages={['security']} concurrency={2} views={views} intervalMs={20} />,
    { columns: 100, rows: 30 },
  )
  const go = async (screen: string): Promise<void> => {
    ui.stdin.send(':')
    for (const char of screen) ui.stdin.send(char)
    ui.stdin.send('\r')
    await ui.settle(60)
  }
  return { home, dbPath, ui, go, views }
}

describe('M6 exit criteria', () => {
  it('Dashboard renders ledger aggregates across every registered repo', async () => {
    const { ui, go } = await gantry()
    await ui.settle()
    await go('dashboard')
    const frame = ui.lastFrame()
    expect(frame).toContain('2 repos')
    expect(frame).toContain('2 skills')
    expect(frame).toContain('Stage pass rate')
    // R8.9's five clauses, all present on one screen.
    for (const section of ['Eval cases', 'Wall clock', 'Open issues', 'Run history']) {
      expect(frame).toContain(section)
    }
    // Both repos' runs are in the history, which is what "across all repos" means.
    expect(frame).toContain('alpha/declawed')
    expect(frame).toContain('beta/spec-lint')
  })

  it('the provenance filter splits the numbers rather than reordering them — R7.6', async () => {
    const { ui, go } = await gantry()
    await ui.settle()
    await go('dashboard')
    expect(ui.lastFrame()).toContain('2 repos')
    ui.stdin.send('p')
    await ui.settle(60)
    const filtered = ui.lastFrame()
    expect(filtered).toContain('1 repos')
    expect(filtered).not.toContain('provenance all')
  })

  it('Issues lists both repos and a transition survives a reload', async () => {
    const { ui, go, views } = await gantry()
    await ui.settle()
    await go('issues')
    expect(ui.lastFrame()).toContain('alpha/declawed')
    expect(ui.lastFrame()).toContain('beta/spec-lint')
    ui.stdin.send('a')
    await ui.settle(80)
    // Read back through the port, so the assertion is against the ledger and
    // not against the frame the keypress happened to leave behind.
    const acknowledged = await views.issues({ state: 'acknowledged' })
    expect(acknowledged).toHaveLength(1)
    expect(ui.lastFrame()).toContain('acknowledged')
  })

  it('Tools and Settings are reachable and answer from real config', async () => {
    const { ui, go } = await gantry()
    await ui.settle()
    await go('tools')
    expect(ui.lastFrame()).toContain('Runtimes')
    await go('settings')
    expect(ui.lastFrame()).toContain('concurrency 2')
    expect(ui.lastFrame()).toContain('skill-lint')
  })

  it('the terminal interface never opens the ledger itself', async () => {
    // The boundary R13.1 enforces, asserted as a fact about the source rather
    // than as a behaviour: a screen that opened sqlite would still render.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/tui/app.tsx', 'utf8'),
    )
    expect(source).not.toContain('node:sqlite')
    expect(source).not.toContain('openLedger')
  })
})
```

- [ ] **Step 2: Run the suite**

Run: `SG_ACCEPTANCE=1 pnpm vitest run tests/acceptance/m6.test.tsx`
Expected: PASS. `vitest.config.ts` excludes `tests/acceptance/**` unless `SG_ACCEPTANCE=1`, so no config change is needed.

- [ ] **Step 3: Run everything**

Run: `pnpm check`
Expected: lint, build, the offline suite and the whole acceptance suite all pass. If `tests/core/spawn.test.ts > kills the whole process tree on timeout` fails under full-suite load, that is the pre-existing flake plan-m2 and plan-m3 both record; confirm it passes in isolation and leave it.

- [ ] **Step 4: Commit**

```bash
git add tests/acceptance/m6.test.tsx
git commit -m "test: assert M6's exit criteria across two repos in one ledger"
```

---

## Requirement coverage for M6

Every requirement M6 owns, and the task that satisfies it. A requirement with no task is a plan defect.

| Requirement | Task |
|---|---|
| R7.6 statistics groupable and filterable by provenance fingerprint | 3 (`provenanceFingerprint`, the column, the backfill), 4 (`StatsFilter.provenanceFp` on every query, `provenanceOptions`), 8 (`p` cycles the filter and the scope is named on screen), 12 |
| R8.9 statistics per skill and across repos: stage pass rate, eval case pass rate, wall clock per stage, open issues by severity and rule class, run history | 2 (the two columns that made two of the five answerable), 4 (all five queries plus the counts), 8 (all five rendered), 12 |
| R11.3 Dashboard, Issues, Tools and Settings reachable as top-level screens | 7 (the screen field, the palette, the routing), 8 (Dashboard), 9 (Issues), 10 (Tools, Settings), 11 (the row budget on all four), 12 |

**Owned elsewhere but closed here.**

- **R13.7** (M1) has been recorded as an open gap by M3, M4 and M5. Task 1 builds the check and adds the nineteen labels it needs, because M6 is the milestone that edits traceability anyway and the gap has no other future owner.
- **R8.10** (M1) is the issue transition table. Its "user acknowledgement" and "user marks wontfix" rows had no code path until Task 5; the reopen transitions are new and are added to design §10.5 rather than left implicit in a screen.
- **R8.8** (M1) is closure as a conjunction over `issue_detectors`. Task 5 extracts the predicate `reconcile` closes on so the Issues screen names the blocking detector by calling the same function — design §19 predicted this screen would want it.
- **R4.2b** (M1) requires the analysis mode to be recorded in run provenance. Task 3 is what makes the ledger's copy carry it; before, only `run.json` did.
- **R3.9, R12.5a** (M3) are doctor and its drift kinds. Task 10 renders the existing report; it adds no drift kind and resolves none.
- **R1.6** (M5) makes the `skills` lifecycle column a cache. Design §13 says the cache exists so the Issues and Dashboard screens can filter deprecated skills across every repo without reading 76 files; Tasks 8 and 9 are the first consumers.
- **R11.4** (M2) is untouched by design: nothing on the new screens streams, so nothing new goes near the ring buffer.

**Deferred within M6, with reasons.**

- **No headless statistics command.** R8.9 states what the statistics must cover and no requirement gives them a CLI surface; R12.5a and R12.5b name `doctor` and `release` and nothing else. `stats.ts` is a plain module, so a `skillgantry stats --json` is a thin wrapper whenever one is wanted.
- **Settings is read-only.** Design §14 lists "repos, concurrency, credentials status", and registering a repo is `skillgantry setup`'s job (R3.6), which is already a re-enterable state machine. An editable Settings screen would be a second write path to `config.json` with no requirement asking for one.
- **The Dashboard has no time filter.** R8.9 asks for run history, not a date range. `StatsFilter` takes three fields and a `since` would be a fourth with nothing to justify it yet.
- **Issue notes are not editable.** `setIssueState` accepts a note and `issues.note` stores it; typing one needs a text input on the Issues screen, and R8.7 requires the state, not the note.
- **No `optimise → validate` loop, no git commit or tag.** R5.4 and R9.7, deferred by D6 and D9 respectively. Unchanged by M6.

## Known gaps carried forward

- **Stage wall clock and stage metrics start at M6.** Every run recorded by M1–M5 has null stage timings after migration 3 and `{}` metrics, so the Dashboard's wall-clock and eval-case sections describe runs from this milestone onward. There is nothing to backfill: the data was never recorded. A user with months of history sees a partial answer until they run again.
- **A pre-M6 run fingerprints differently from an identical post-M6 one.** The backfill hashes the provenance as stored, and stored provenance before Task 3 carried no `analysisModes`, so an otherwise-identical later run lands in a different provenance group. The boundary is real — the mode genuinely was not recorded — and it is visible rather than silent, which is the direction §7 argues for.
- **The provenance filter on issue counts is "as of the last sighting".** An issue is not a run, so `issueScope` reaches it through `last_seen_run`. An issue last seen under provider A and still open shows up only under A's filter, even if provider B would also find it. The alternative — ignoring the filter for issues — shows one provider's numbers beside every provider's issues.
- **`occurrence_count` still understates by design.** Design §19 already carries this: merge-first identity means three credential findings in one file are one issue with three detections, and the Dashboard's rule-class counts read as "files with a problem of this class". M6 renders the number; it does not change what it means.
- **The Issues screen has no pagination beyond scrolling.** `listIssues` returns every matching row and the screen windows them. A ledger with tens of thousands of issues would build one large array per frame; the reference repos hold tens.
- **Every screen re-reads on refresh, not on change.** There is no ledger change notification, so a run finishing while the Dashboard is open does not update it — `:refresh` or leaving and returning does. Watching the ledger would mean either polling or a notify channel `node:sqlite` does not offer.
- **`createGantryViews` opens and closes the ledger per call.** Correct under a concurrent writer and measurably more expensive than a held handle. At one open per screen refresh that is not worth optimising; at one per keystroke it would be.
- **The palette is the only screen switcher.** Three keystrokes (`:`, a letter or two, enter) to change screen. Direct keys were rejected because Work spends `1`–`4` on its output panels, but a user switching often will feel it.
- **Tools screen refresh spawns.** `r` re-invokes every locked tool's version argv through the port. On a slow machine the screen shows the previous report until it returns, with no in-flight indicator beyond the unchanged frame.
- **The `esc`-to-Work rule shadows nothing today and could later.** `esc` on Dashboard, Issues, Tools or Settings returns to Work; if one of those screens later grows a modal of its own, that modal must consume `esc` before this rule sees it, the way the palette and the review pane already do.

## Deviations found while implementing

*Filled in as the branch lands. A plan is a record of intent; this section records where building against it proved the intent wrong.*

## Changelog

- 2026-08-03 — revision 1, written against design.md revision 3, requirements.md revision 6 and shipped M1–M5. Three ledger defects found by reading the shipped recorder (empty stage metrics, run times in the stage columns, provenance recorded without its analysis modes) are fixed in Tasks 2 and 3 before anything queries them. The design-coverage gap Task 1 closes was measured, not estimated: nineteen requirements carry no `*Satisfies*` label, and the milestone ownership table is already clean at 133 requirements.
