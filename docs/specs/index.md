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
| [plan_m3-promptfoo-removal.md](plan_m3-promptfoo-removal.md) | M3 (M4 prereq) | Shipped | Drop promptfoo from the catalogue — it evaluates prompts declared in a config, has no notion of a skill, so it is removed rather than deferred |

M6 (dashboard) has no plan document yet.

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
