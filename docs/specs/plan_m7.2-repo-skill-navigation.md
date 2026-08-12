# M7 extension — Two-level repo → skill navigation

**Status:** shipped.
**Goal:** Give R11.1's list column the level it has always claimed — the registered repos above the skills of one repo — under the horizontal key pair that was bound nowhere in that zone.

**Architecture:** Everything lands in `src/tui/**`. No core contract moves and no port method is added: repo identity is already on `SkillRef.repo` where `initialState` receives it, and a repo is a contiguous range in the flat `state.skills` array because `discoverAll` concatenates one walk per registered repo. Pure `repoGroups`, `repoSummary` and `visibleSkills` in `store.ts` keep every new decision assertable without rendering Ink.

## Specification

Layer 1: [requirements.md](requirements.md) R11.23, plus R11.11 amended in place (rev 24).
Layer 2: [design_tui.md §14.12](design_tui.md), plus the in-place amendment to §14.6's three-zones paragraph.
Decisions: none added. R11.22 added none either; the decision log's last entries are D28–D29 under §13.

## Global Constraints

Everything in [plan_m7-work-screen-overhaul.md](plan_m7-work-screen-overhaul.md)'s Global Constraints still holds. What shaped this change beyond them:

- **Zero layout change.** `layoutFor`, `SKILL_LIST_MIN` and `OVERVIEW_ROWS` are untouched, so §14.1's row budget and every Overview tier boundary hold as they were.
- **Zero downstream change.** `selectedSkill(state)` keeps meaning "the skill the rail and the output pane answer for". Its readers — the rail, the output pane, `y`, `r`, `s`, the lazy `loadLastRun`, the R11.13 scope effect — are all left alone.
- **Zero port change.** No `GantryViews` method, no ledger read, no config read.

## Task Order and Why

The store comes first because everything else reads its three new fields. `SkillList` before the key handler, so the level is visible before it is movable. Specs were committed ahead of the code, per the repo's own precedence rule.

## Critical Files

| Path | Role |
|---|---|
| `src/tui/store.ts` | `RepoRow`, `repoGroups`, `repoSummary`, `visibleSkills`; `repos` / `listLevel` / `selectedRepo`; `select-repo` / `enter-repo` / `leave-repo`; `select-skill`'s clamp |
| `src/tui/components/SkillList.tsx` | two row branches under one `Panel`, the title that names the level |
| `src/tui/app.tsx` | `moveDown`'s skills-zone branch, the `h`/`l` block, `space`'s repo-level refusal |
| `src/tui/components/Work.tsx` | the three props threaded through `SideBySide` and `Stacked` |
| `src/tui/components/Help.tsx` | the `h / l, ← / →` row's description, amended in place |
| `tests/tui/repo-navigation.test.tsx` | R11.23 end to end plus the pure builders |

## Tasks

### Task 1: `repoGroups`, `repoSummary` and the three state fields

`RepoRow` is `{ repoId, label, start, count }` — a range into `state.skills`, valid because `discoverAll` walks repos in `config.repos` order and `discoverSkills` sorts by id inside each. `repoGroups` reads the skills array rather than `config.repos`: the ranges must index the array the cursor indexes, and a registered repo holding no skill has no row to enter. `repoSummary` ranks `running` above every settled outcome and reports the range's worst status, whether any of its skills is marked, and how many there are. `SkillRow` gains nothing — both new actions find a group by range, so a `repoId` on the row would be a second record of one fact.

`listLevel` starts `'repos'` above one repo and `'skills'` at one or none (R11.23).

### Task 2: The three actions, and `select-skill`'s clamp

`select-repo` moves the repo cursor and nothing else — the rail and the pane keep answering for the skill they were answering for. `enter-repo` keeps `selectedSkill` when it is already inside the target range and jumps to `start` when it is not, resetting `outputOffset` and `selectedFinding` only when the index moves. `leave-repo` lands on the group holding the selected skill rather than on the first.

`select-skill` clamps within `visibleSkills(state)` instead of against `state.skills.length`, which is what stops the vertical pair walking out of the repo the title names. `visibleSkills` is that range's one expression, read by this clamp and by `SkillList`'s slice — two derivations of a window is the `j`-stops-short failure §14, §14.5 and §14.6 have each paid for.

### Task 3: `SkillList` renders two levels and names the one it is on

Two row branches inside one unchanged `Panel`, one `windowFor` call, one `GUTTER`. The title is `Repos`, or the repo's label, or `Skills` when there is no repo to name. A repo row spends the mark column it already has on "some skill in here is marked" — the one fact a collapsed level hides — and puts the skill count on the right through `padCells`. No new row anywhere.

### Task 4: `h`/`l` in the skills zone, and `space`'s refusal

`moveDown` routes the vertical pair to `select-repo` at the repo level. The `h`/`l` block gains a skills-zone branch above its early return: inward enters, but only from the repo level; outward always leaves. `l` at the skill level is inert, there being nothing deeper. `space` at the repo level refuses and names the recovery from one constant, in the guard-then-flash shape `y`, `o` and `s` use.

### Task 5: The help row, and not the footer

`Help.tsx`'s `h / l, ← / →` row is amended in place, so the binding list's row count and its 80×24 fit are unchanged. The footer is deliberately untouched: §14.3 measured `HINTS` at 67 columns and an eighth pair costs `q quit`.

### Task 6: Tests

`tests/tui/repo-navigation.test.tsx`, over `skillRef(id, over)` from `tests/helpers/skill-ref.ts` — a second repo is one `Partial<SkillRef>` override, and that helper exists so a second literal cannot go stale.

Every pre-existing fixture puts all its skills in one repo, so `listLevel` starts `'skills'` everywhere and no shipped frame moves. The two cases that press `l`/`→` from the skills zone and assert the rail did not move — `focus-zones.test.tsx` and `arrow-keys.test.tsx` — stay green only because `l` at the skill level is inert, which is the check that the design is right rather than the tests being lenient.

## Requirement coverage

| Requirement | Task |
|---|---|
| R11.23 two levels, entry level by repo count, level named | 1, 3 |
| R11.23 horizontal pair moves between levels, repo level always reachable | 4 |
| R11.23 vertical pair does not leave the showing repo | 2 |
| R11.23 repo row carries count, worst status, marked | 1, 3 |
| R11.23 repo cursor changes no skill selection | 2 |
| R11.23 no change to any panel's row allocation | 3, 5 |
| R11.11 amended — the horizontal pair's meaning per zone | 4 |

## Deviations found while implementing

All three came out of measuring a rendered frame rather than reasoning from the box model, which is the same source as every deviation `plan_m7-work-screen-overhaul.md` records.

**1. The count column is derived, not reserved.** The first cut gave it a constant four cells, wide enough for three digits. At the 22-cell column the whole 76–109 band uses, that leaves nine cells for the name, so `skills-lab` elided on a machine with ten skills in it — a cell taken off every repo name to hold a digit almost nobody has. It is now `max(len(count)) + 1` over the repos on screen, which gives the name eleven cells at that width. This is `plan_m7-work-screen-overhaul.md`'s deviation 5 arriving a second time: a reserved constant beside a derived width is a column that overruns the moment the content is ordinary.

**2. Neither level pads itself to its allocation, so the two render different heights.** The row-budget case asserted the repo level's frame height *equals* the skill level's. It does not: `Panel` renders the rows it is handed, so three repos draw a shorter box than four skills — which the skill list has always done whenever a repo holds fewer skills than `skillRows`. The claim that matters is that neither level exceeds the terminal and the repo level is never the taller of the two, since a level taller than its neighbour is what pushes the panel below it off the bottom. Asserted that way, plus a direct case that the repo level windows against its allocation and reports the overflow through the title.

**3. Two assertions read text the 22-cell column elides** — the full repo name, and the `+3 more` hint in the title. Both are §14.1's second rule working rather than something to widen, so the cases assert at a width that holds them and the narrow case asserts the elision. `plan_m7-work-screen-overhaul.md`'s deviation 8 records the identical mistake against the suppressed-issue mark.

**Not a deviation, recorded so it is not mistaken for one.** `package.json` was at 0.4.3 rather than the 0.4.2 the plan named — `0774126` is an ancestor of `HEAD` while `efb528c` reads 0.4.2, a merge-ordering artefact. The 0.5.0 target is unchanged.

## Changelog

- 2026-08-10 — Written and shipped.
- 2026-08-12 — **A skill row carried its repo id.** One row rendered `zapac-agent-skills/zuhlk…` under a group header already reading `zapac-agent-skills`, because `toRow` fell back `label: skill.name ?? skill.id` and `skill.id` is qualified. The skill was `zuhlke-slides`, whose `SKILL.md` description holds an unquoted `: `, so YAML reads a nested mapping and throws; `parseFrontmatter` swallows it per R2.5 and returns a null name. The label now falls back to `basename(skill.dir)`, which the level above cannot duplicate.

  The parse failure itself was the second half. It also nulls `metadata.version`, so a skill declaring 2.2.0 resolved a release target as "no current version", and nothing on any surface said why. `Frontmatter` gains `readable`, false only when a block is present and will not read as a mapping — an absent block is a file that declares nothing, not one that failed. `SkillRef.frontmatterReadable` carries it, and doctor reports `frontmatter-unreadable` from the flag without reading a file, on both its surfaces, without failing the report.

  Requirements revision 27 amends R2.5 and R11.23 in place, adding no id. Design §5.3 and design_tui.md §14.12 carry the two rules.

  One thing surfaced that was not the reported bug: `basename` is `node:path` inside `src/tui/store.ts`, which the import boundary allows — the TUI may touch fs — and the label is now the only place the store reads a path.
