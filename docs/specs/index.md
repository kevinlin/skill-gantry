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
| [decision-log.md](decision-log.md) | Supporting | D* decisions the requirements derive from |

## Plans

`Shipped, compacted` means the plan has been stripped of its step-by-step how post-implementation and now holds only the why plus its "Deviations found while implementing" section. The code is the how.

| File | Milestone | Status | Description |
|---|---|---|---|
| [plan-m1.md](plan-m1.md) | M1 | Shipped, compacted | Engine, adapter contract, one adapter, sidecar, ledger, headless CLI |
| [plan-m2.md](plan-m2.md) | M2 | Shipped, compacted | Queue, Ink TUI Work screen |
| [plan-m3.md](plan-m3.md) | M3 | Shipped | Tools module: catalogue, three drivers, setup wizard, doctor |
| [plan-m4.md](plan-m4.md) | M4 | Shipped, compacted | Three remaining adapters, shared parsers, rule-class map, cross-tool merge |
| [plan-m5.md](plan-m5.md) | M5 | Shipped, compacted | Mutation isolation, journalled apply, release stage, retirement |
| [plan-m6.md](plan-m6.md) | M6 | Shipped, compacted; extension planned | Statistics queries, Dashboard, Issues, Tools and Settings screens, the command palette. Extended in place with editable Settings (R11.7, R11.8) — shipped |
| [plan-m6-settings-edit.md](plan-m6-settings-edit.md) | M6 (extension) | Shipped | Editable Settings (R11.7, R11.8) — the executable form of plan-m6's Tasks 13–17: pure config transforms, origin reporting, staging, the setup states as a screen, the confirmation pane |
| [plan_m6-fix-prompts-for-stage-findings.md](plan_m6-fix-prompts-for-stage-findings.md) | M6 (extension) | Shipped | Coding-agent fix prompt per findings-bearing stage (R6.10, R11.9, R12.6): the builder in `stages`, the pipeline hook, `skillgantry fix`, and `y` on the Work screen |
| [plan_m6-respect-skillspector-baseline.md](plan_m6-respect-skillspector-baseline.md) | M6 (extension) | Shipped | Honour a tool's own suppression file (R4.14, R4.15, R6.11, R8.15): conditional argv, `RawFinding.suppressed`, the ledger's derived suppression cache, and the Issues mark |
| [plan-m7.md](plan-m7.md) | M7 | Planned | Work screen overhaul (R11.11–R11.15, amended R11.9): the D23 palette, a titled panel border that funds the row budget, three focus zones, the Overview card and its height-driven tiers, a Findings cursor with inline evidence, the Issues tab, and `openPath` |
| [plan_m3-promptfoo-removal.md](plan_m3-promptfoo-removal.md) | M3 (M4 prereq) | Shipped | Drop promptfoo from the catalogue — it evaluates prompts declared in a config, has no notion of a skill, so it is removed rather than deferred |

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
