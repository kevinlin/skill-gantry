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
| [design_tui.md](design_tui.md) | Design | design.md §14 through §14.14, under their own numbers: the Ink store, the responsive row budget, Settings, fix-prompt copy, the queue's progress reporting, run rehydration, the Work screen, accepting a finding, the full-length detail view, the release target, the two prompt surfaces, the repo and skill list, the setup repo step, and the upgrade prompt |
| [design_version-check-and-upgrade.md](design_version-check-and-upgrade.md) | Design | design.md §20, under its own numbers: the GitHub Releases publishing contract, `CHANGELOG.md` and its backfill, the versioned install prefix and atomic relink, the throttled launch-time check, and the prompt, subcommand and doctor condition that reach it. Owns M9 |
| [decision-log.md](decision-log.md) | Supporting | D* decisions the requirements derive from |

## Plans

`Shipped, compacted` means the plan has been stripped of its step-by-step how post-implementation and now holds only the why plus its "Deviations found while implementing" section. The code is the how.

Every plan is shipped. The description names what the plan covers and the requirements it owns; open the plan for the why.

| File | Milestone | Status | Covers |
|---|---|---|---|
| [plan_m1-engine-and-sidecar.md](plan_m1-engine-and-sidecar.md) | M1 | Compacted | Engine, adapter contract, one adapter, sidecar, ledger, headless CLI |
| [plan_m1.1-timestamped-run-directories.md](plan_m1.1-timestamped-run-directories.md) | M1.1 | — | A run directory named for its start time rather than its run id (R6.1, R6.4, R6.7 rev 26; D32) |
| [plan_m2-queue-and-tui.md](plan_m2-queue-and-tui.md) | M2 | Compacted | Queue, Ink TUI Work screen |
| [plan_m2.1-rehydrate-the-last-recorded-run.md](plan_m2.1-rehydrate-the-last-recorded-run.md) | M2.1 | — | The selected skill's last recorded run, presented without a run this session (R11.10) |
| [plan_m3-tools-module.md](plan_m3-tools-module.md) | M3 | — | Tools module: catalogue, three drivers, setup wizard, doctor |
| [plan_m3.1-promptfoo-removal.md](plan_m3.1-promptfoo-removal.md) | M3.1 (M4 prereq) | Compacted | Dropping promptfoo from the catalogue: it evaluates prompts declared in a config and has no notion of a skill |
| [plan_m3.2-setup-repo-edit.md](plan_m3.2-setup-repo-edit.md) | M3.2 | — | The setup repo step shows and edits what is registered, keeping each repo's id (R3.12) |
| [plan_m4-adapters-and-merge.md](plan_m4-adapters-and-merge.md) | M4 | Compacted | Three remaining adapters, shared parsers, rule-class map, cross-tool merge |
| [plan_m4.1-skillhone-optimise.md](plan_m4.1-skillhone-optimise.md) | M4.1 | — | SkillHone as a `git-skill` bundle, its composed settings file, and the optimise prompt surface (R3.10, R6.12, R11.21, R12.8) |
| [plan_m4.2-skillup-first-eval.md](plan_m4.2-skillup-first-eval.md) | M4.2 | — | skill-upper, the eval bootstrap prompt, and the spawn's gateway-credential composition (R3.11, R6.13, R11.22, R12.9; R7.3 rev 28) |
| [plan_m5-mutation-and-release.md](plan_m5-mutation-and-release.md) | M5 | Compacted | Mutation isolation, journalled apply, release stage, retirement |
| [plan_m5.1-tui-release-target.md](plan_m5.1-tui-release-target.md) | M5.1 | — | Release from the terminal: the target surface, `planRelease`, and the rail's runnability guard (R11.19, R11.20) |
| [plan_m6-screens-and-palette.md](plan_m6-screens-and-palette.md) | M6 | Compacted | Statistics queries, Dashboard, Issues, Tools and Settings screens, the command palette |
| [plan_m6.1-settings-edit.md](plan_m6.1-settings-edit.md) | M6.1 | — | Editable Settings: pure config transforms, origin reporting, staging, the confirmation pane (R11.7, R11.8) |
| [plan_m6.2-fix-prompts-for-stage-findings.md](plan_m6.2-fix-prompts-for-stage-findings.md) | M6.2 | — | A coding-agent fix prompt per findings-bearing stage (R6.10, R11.9, R12.6) |
| [plan_m6.3-respect-skillspector-baseline.md](plan_m6.3-respect-skillspector-baseline.md) | M6.3 | — | Honouring a tool's own suppression file, read-side (R4.14, R4.15, R6.11, R8.15) |
| [plan_m7-work-screen-overhaul.md](plan_m7-work-screen-overhaul.md) | M7 | Compacted | Work screen overhaul: the D23 palette, three focus zones, the Overview card, a Findings cursor (R11.11–R11.15) |
| [plan_m7.1-work-screen-navigation.md](plan_m7.1-work-screen-navigation.md) | M7.1 | — | Work screen navigation and the full-length detail view (R11.18; R11.11–R11.14 rev 15) |
| [plan_m7.2-repo-skill-navigation.md](plan_m7.2-repo-skill-navigation.md) | M7.2 | — | Two-level repo → skill navigation in the list column (R11.23; R11.11 rev 24) |
| [plan_m8-suppress-finding.md](plan_m8-suppress-finding.md) | M8 | Compacted | Accepting a finding from the terminal, write-side (R4.16, R8.16, R10.12, R11.16–R11.17, R12.7) |
| [plan_m9-version-check-and-upgrade.md](plan_m9-version-check-and-upgrade.md) | M9 | Compacted | Version check and self-upgrade (R11.24, R12.10, R13.8–R13.12; D30–D31) |

## Reviews (historical)

| File | Description |
|---|---|
| [design-review-r1.md](design-review-r1.md) | First design review; 12 findings, all resolved in design revision 2 |
| [design-review-r2.md](design-review-r2.md) | Second design review; 11 findings, all resolved in design revision 3 |

## Meta

| File | Description |
|---|---|
| [meta/convention.md](meta/convention.md) | Naming and structure convention reference (used by spec-lint) |
| [meta/lint-report-2026-08-11.md](meta/lint-report-2026-08-11.md) | spec-lint findings, 2026-08-11. Point-in-time; not a contract |
