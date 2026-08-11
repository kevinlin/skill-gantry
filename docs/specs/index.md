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
| [design_tui.md](design_tui.md) | Design | design.md §14 through §14.13, under their own numbers: the Ink store, the responsive row budget, Settings, fix-prompt copy, run rehydration, the Work screen, accepting a finding, the full-length detail view, the release target, the two prompt surfaces, the repo and skill list, and the setup repo step |
| [design_version-check-and-upgrade.md](design_version-check-and-upgrade.md) | Design | design.md §20, under its own numbers: the GitHub Releases publishing contract, `CHANGELOG.md` and its backfill, the versioned install prefix and atomic relink, the throttled launch-time check, and the prompt, subcommand and doctor condition that reach it. Owns M9 |
| [decision-log.md](decision-log.md) | Supporting | D* decisions the requirements derive from |

## Plans

`Shipped, compacted` means the plan has been stripped of its step-by-step how post-implementation and now holds only the why plus its "Deviations found while implementing" section. The code is the how.

| File | Milestone | Status | Description |
|---|---|---|---|
| [plan_m1-engine-and-sidecar.md](plan_m1-engine-and-sidecar.md) | M1 | Shipped, compacted | Engine, adapter contract, one adapter, sidecar, ledger, headless CLI |
| [plan_m1.1-timestamped-run-directories.md](plan_m1.1-timestamped-run-directories.md) | M1.1 | Shipped | A run directory named for its start time rather than its run id (R6.1, R6.4, R6.7 as amended in revision 26; D32): the claim loop that retries the name, the directory name recorded in `index.ndjson`, a recovery scan that returns the directory it found instead of rebuilding one, and `--run` taking either handle |
| [plan_m2-queue-and-tui.md](plan_m2-queue-and-tui.md) | M2 | Shipped, compacted | Queue, Ink TUI Work screen |
| [plan_m2.1-rehydrate-the-last-recorded-run.md](plan_m2.1-rehydrate-the-last-recorded-run.md) | M2.1 | Shipped | Present the selected skill's most recently recorded run without a run this session (R11.10): the sidecar read, the per-skill recorded log, and the reducer's precedence rule |
| [plan_m3-tools-module.md](plan_m3-tools-module.md) | M3 | Shipped | Tools module: catalogue, three drivers, setup wizard, doctor |
| [plan_m3.1-promptfoo-removal.md](plan_m3.1-promptfoo-removal.md) | M3.1 (M4 prereq) | Shipped | Drop promptfoo from the catalogue — it evaluates prompts declared in a config, has no notion of a skill, so it is removed rather than deferred |
| [plan_m3.2-setup-repo-edit.md](plan_m3.2-setup-repo-edit.md) | M3.2 | Shipped | The setup repo step shows and edits what is registered (R3.12): the id-preserving `withRepoPath`, `updateRepo` on the driver, a cursor over the registered list, and a verdict that tells this repo's path from another's |
| [plan_m4-adapters-and-merge.md](plan_m4-adapters-and-merge.md) | M4 | Shipped, compacted | Three remaining adapters, shared parsers, rule-class map, cross-tool merge |
| [plan_m4.1-skillhone-optimise.md](plan_m4.1-skillhone-optimise.md) | M4.1 | Shipped | SkillHone and the optimise action (R3.10, R6.12, R11.21, R12.8; amending R3.1, R3.5, R3.8, R7.3, R11.20): a `git-skill` install driver for a tool published as an agent-skill bundle, its managed venv and per-skill symlinks, the `~/.skillhone/settings.json` that install composes from the credential file, and a rail mark that opens a coding-agent prompt built from recorded evidence instead of enqueuing a run |
| [plan_m4.2-skillup-first-eval.md](plan_m4.2-skillup-first-eval.md) | M4.2 | Shipped | skill-up's first eval suite (R3.11, R6.13, R11.22, R12.9; amending R3.5, R3.8, R11.21): skill-upper catalogued as a `git-skill` bundle with no dependencies, doctor's report of an unmanaged skill link, and a rail mark on `evaluate` that hands over a coding-agent prompt for authoring `evals/` instead of starting a gate that cannot run |
| [plan_m5-mutation-and-release.md](plan_m5-mutation-and-release.md) | M5 | Shipped, compacted | Mutation isolation, journalled apply, release stage, retirement |
| [plan_m5.1-tui-release-target.md](plan_m5.1-tui-release-target.md) | M5.1 | Shipped | Release from the terminal (R11.19, R11.20): the target surface, the `planRelease` port, the rail's runnability guard, and `plan()` inside the stage's failure boundary |
| [plan_m6-screens-and-palette.md](plan_m6-screens-and-palette.md) | M6 | Shipped, compacted; extension planned | Statistics queries, Dashboard, Issues, Tools and Settings screens, the command palette. Extended in place with editable Settings (R11.7, R11.8) — shipped |
| [plan_m6.1-settings-edit.md](plan_m6.1-settings-edit.md) | M6.1 | Shipped | Editable Settings (R11.7, R11.8) — the executable form of plan_m6's Tasks 13–17: pure config transforms, origin reporting, staging, the setup states as a screen, the confirmation pane |
| [plan_m6.2-fix-prompts-for-stage-findings.md](plan_m6.2-fix-prompts-for-stage-findings.md) | M6.2 | Shipped | Coding-agent fix prompt per findings-bearing stage (R6.10, R11.9, R12.6): the builder in `stages`, the pipeline hook, `skillgantry fix`, and `y` on the Work screen |
| [plan_m6.3-respect-skillspector-baseline.md](plan_m6.3-respect-skillspector-baseline.md) | M6.3 | Shipped | Honour a tool's own suppression file (R4.14, R4.15, R6.11, R8.15): conditional argv, `RawFinding.suppressed`, the ledger's derived suppression cache, and the Issues mark |
| [plan_m7-work-screen-overhaul.md](plan_m7-work-screen-overhaul.md) | M7 | Shipped, compacted | Work screen overhaul (R11.11–R11.15, amended R11.9): the D23 palette, a titled panel border that funds the row budget, three focus zones, the Overview card and its height-driven tiers, a Findings cursor with inline evidence, the Issues tab, and `openPath` |
| [plan_m7.1-work-screen-navigation.md](plan_m7.1-work-screen-navigation.md) | M7.1 | Shipped | Work screen navigation and the detail view (R11.18, amended R11.11–R11.14): arrow aliases, a view-selection key that focuses the pane it names, the Issues tab's own cursor, the dashboard key on every Overview tier, and `enter` for a full-length finding or issue |
| [plan_m7.2-repo-skill-navigation.md](plan_m7.2-repo-skill-navigation.md) | M7.2 | Shipped | Two-level repo → skill navigation in the list column (R11.23, amended R11.11): repo groups as contiguous ranges over the flat skill array, the level the entry repo count chooses, the horizontal pair's meaning in the skill-list zone, and a title that names which level is showing |
| [plan_m8-suppress-finding.md](plan_m8-suppress-finding.md) | M8 | Shipped, compacted | Accept a finding from the terminal (R4.16, R8.16, R10.12, R11.16, R11.17, R12.7): a declarative baseline spec on the manifest, a narrow diff-confirm-recheck-rename write path, `s` on the Issues screen and the Findings pane, and the gate re-run the acceptance invalidates |
| [plan_m9-version-check-and-upgrade.md](plan_m9-version-check-and-upgrade.md) | M9 | Shipped | Version check and self-upgrade (R11.24, R12.10, R13.8–R13.12; D30–D31): the release workflow and its two pre-publish assertions, `CHANGELOG.md` and the first-parent backfill, the four `src/core/upgrade/` modules, the versioned prefix and atomic relink, and the prompt, subcommand and doctor condition that reach them |

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
