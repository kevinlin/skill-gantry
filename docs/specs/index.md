# SkillGantry — Specification Index

Navigation map for the specification tree. Grouped by layer, then by milestone.

**This file is the only catalogue of the spec tree.** `CLAUDE.md` states how the layers rank and how to amend them; it does not list the files. Add a spec, add a row here.

Which milestone owns which requirement is a separate question, answered only by [requirements.md § Milestone ownership](requirements.md). The `Status` column below tracks documents, not requirements.

---

## Root specs

| File | Layer | Description |
|---|---|---|
| [requirements.md](requirements.md) | Requirements | Numbered R* requirements with milestone ownership table |
| [design.md](design.md) | Design | Module map, stage contract, outcome model, ledger schema, sidecar layout |
| [design_tui.md](design_tui.md) | Design | design.md §14 through §14.8, under their own numbers: the Ink store, the responsive row budget, Settings, fix-prompt copy, run rehydration, the Work screen, accepting a finding, the full-length detail view |
| [decision-log.md](decision-log.md) | Supporting | D* decisions the requirements derive from |

## Plans

`Shipped, compacted` means the plan has been stripped of its step-by-step how post-implementation and now holds only the why plus its "Deviations found while implementing" section. The code is the how.

| File | Milestone | Status | Description |
|---|---|---|---|
| [plan_m1.md](plan_m1.md) | M1 | Shipped, compacted | Engine, adapter contract, one adapter, sidecar, ledger, headless CLI |
| [plan_m2.md](plan_m2.md) | M2 | Shipped, compacted | Queue, Ink TUI Work screen |
| [plan_m2-rehydrate-the-last-recorded-run.md](plan_m2-rehydrate-the-last-recorded-run.md) | M2 (extension) | Shipped | Present the selected skill's most recently recorded run without a run this session (R11.10): the sidecar read, the per-skill recorded log, and the reducer's precedence rule |
| [plan_m3.md](plan_m3.md) | M3 | Shipped | Tools module: catalogue, three drivers, setup wizard, doctor |
| [plan_m3-promptfoo-removal.md](plan_m3-promptfoo-removal.md) | M3 (M4 prereq) | Shipped | Drop promptfoo from the catalogue — it evaluates prompts declared in a config, has no notion of a skill, so it is removed rather than deferred |
| [plan_m4.md](plan_m4.md) | M4 | Shipped, compacted | Three remaining adapters, shared parsers, rule-class map, cross-tool merge |
| [plan_m5.md](plan_m5.md) | M5 | Shipped, compacted | Mutation isolation, journalled apply, release stage, retirement |
| [plan_m6.md](plan_m6.md) | M6 | Shipped, compacted; extension planned | Statistics queries, Dashboard, Issues, Tools and Settings screens, the command palette. Extended in place with editable Settings (R11.7, R11.8) — shipped |
| [plan_m6-settings-edit.md](plan_m6-settings-edit.md) | M6 (extension) | Shipped | Editable Settings (R11.7, R11.8) — the executable form of plan_m6's Tasks 13–17: pure config transforms, origin reporting, staging, the setup states as a screen, the confirmation pane |
| [plan_m6-fix-prompts-for-stage-findings.md](plan_m6-fix-prompts-for-stage-findings.md) | M6 (extension) | Shipped | Coding-agent fix prompt per findings-bearing stage (R6.10, R11.9, R12.6): the builder in `stages`, the pipeline hook, `skillgantry fix`, and `y` on the Work screen |
| [plan_m6-respect-skillspector-baseline.md](plan_m6-respect-skillspector-baseline.md) | M6 (extension) | Shipped | Honour a tool's own suppression file (R4.14, R4.15, R6.11, R8.15): conditional argv, `RawFinding.suppressed`, the ledger's derived suppression cache, and the Issues mark |
| [plan_m7.md](plan_m7.md) | M7 | Shipped, compacted | Work screen overhaul (R11.11–R11.15, amended R11.9): the D23 palette, a titled panel border that funds the row budget, three focus zones, the Overview card and its height-driven tiers, a Findings cursor with inline evidence, the Issues tab, and `openPath` |
| [plan_m7-work-screen-navigation.md](plan_m7-work-screen-navigation.md) | M7 (extension) | Shipped | Work screen navigation and the detail view (R11.18, amended R11.11–R11.14): arrow aliases, a view-selection key that focuses the pane it names, the Issues tab's own cursor, the dashboard key on every Overview tier, and `enter` for a full-length finding or issue |
| [plan_m8.md](plan_m8.md) | M8 | Shipped | Accept a finding from the terminal (R4.16, R8.16, R10.12, R11.16, R11.17, R12.7): a declarative baseline spec on the manifest, a narrow diff-confirm-recheck-rename write path, `s` on the Issues screen and the Findings pane, and the gate re-run the acceptance invalidates |

## Reviews (historical)

| File | Description |
|---|---|
| [design-review-r1.md](design-review-r1.md) | First design review; 12 findings, all resolved in design revision 2 |
| [design-review-r2.md](design-review-r2.md) | Second design review; 11 findings, all resolved in design revision 3 |

## Meta

| File | Description |
|---|---|
| [meta/convention.md](meta/convention.md) | Naming and structure convention reference (used by spec-lint) |
| [meta/lint-report-2026-08-02.md](meta/lint-report-2026-08-02.md) | spec-lint findings, 2026-08-02. Point-in-time; not a contract |
| [meta/lint-report-2026-08-09.md](meta/lint-report-2026-08-09.md) | spec-lint findings, 2026-08-09. Point-in-time; not a contract |
