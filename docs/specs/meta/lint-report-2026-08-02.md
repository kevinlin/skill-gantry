# Spec Lint Report — 2026-08-02

Profile(s): `default` [auto-detected via `docs/specs/` directory]
Specs root: `docs/specs/`

## Summary

- Files scanned: 11 (3 root specs, 6 plans, 2 reviews)
- Profile completeness: 10/11 expected artefacts present (missing: `index.md`)
- Errors: 10 (3 dead intra-spec links, 5 dead source-code links, 1 self-referencing link, 1 missing index)
- Warnings: 6 (5 naming, 1 orphan)
- Info: 2 (convention seeded, no TODO markers)
- Auto-fixed: 10

## Convention Reference

- Path: `meta/convention.md`
- Status: seeded this run
- Active profile: `default`

## Root Index / Registry

- Path: `index.md`
- Status: scaffolded this run
- Files linked: 11 / 11 spec files

## Errors (auto-fixed)

### Dead links — intra-spec (`design-review-2.md` → `design-review-r2.md`)

All three were the same typo, referencing `design-review-2.md` instead of the actual filename `design-review-r2.md`.

- `requirements.md:4` → `design-review-2.md` (not found) — **fixed** → `design-review-r2.md`
- `decision-log.md:257` → `design-review-2.md` (not found) — **fixed** → `design-review-r2.md`
- `plan-m1.md:316` → `design-review-2.md` (not found) — **fixed** → `design-review-r2.md`

### Dead links — repo-root-relative paths used as file-relative

`plan_install-as-terminal-command.md` used paths relative to the repo root instead of relative to `docs/specs/`. All resolved after prepending `../../`.

- `plan_install-as-terminal-command.md:21` → `scripts/capture-fixtures.sh` — **fixed** → `../../scripts/capture-fixtures.sh`
- `plan_install-as-terminal-command.md:31` → `src/core/tools/install.ts#L22` — **fixed** → `../../src/core/tools/install.ts#L22`
- `plan_install-as-terminal-command.md:32` → `src/core/tools/runtimes.ts` — **fixed** → `../../src/core/tools/runtimes.ts`
- `plan_install-as-terminal-command.md:49` → `tests/acceptance/packaging.test.ts` — **fixed** → `../../tests/acceptance/packaging.test.ts`
- `plan_install-as-terminal-command.md:49` → `vitest.config.ts` — **fixed** → `../../vitest.config.ts`
- `plan_install-as-terminal-command.md:60` → `docs/specs/design.md` — **fixed** → `design.md`
- `plan_install-as-terminal-command.md:61` → `CLAUDE.md` — **fixed** → `../../CLAUDE.md`

### Missing root index

- `index.md` did not exist — **fixed** → scaffolded with full inventory

## Warnings

### Naming

Five plan files use a hyphen between the artifact type and the topic. The `default` profile convention is `plan_<topic>.md` (underscore separator).

- `plan-m1.md`: non-canonical name. Suggested rename: `plan_m1.md`. Rule: default — §3.5.
- `plan-m2.md`: non-canonical name. Suggested rename: `plan_m2.md`.
- `plan-m3.md`: non-canonical name. Suggested rename: `plan_m3.md`.
- `plan-m4.md`: non-canonical name. Suggested rename: `plan_m4.md`.
- `plan-promptfoo-removal.md`: non-canonical name. Suggested rename: `plan_promptfoo-removal.md`.

Note: these are established legacy names with many inbound cross-references. Renaming requires confirmation (changes git history, breaks external links).

### Orphan specs

- `plan_install-as-terminal-command.md`: no inbound references from any other spec file. Suggest linking from `index.md` (done in scaffold).

## Info

### Profile detection

- Detected profile: `default` via signal `docs/specs/` directory.
- Confirmed by `CLAUDE.md` explicit pointer: "docs/specs/ holds three layers".

### Convention seeded

- `meta/convention.md` was missing and has been seeded from the skill's bundled version.

### TODO markers

- None found. Three files mention "TBD" or "TODO" only in the context of a "no placeholders" self-review assertion.

### Reverse consistency — design ↔ requirements

- **Coverage is complete.** Design §17 provides an explicit traceability table mapping every requirement group to design sections. The `*Satisfies …*` labels in each section are machine-checked per the spec test.

### Reverse consistency — plan ↔ design

- **Milestones M1–M4 are covered** by their respective plan files.
- **Milestones M5 (isolation, release, retirement) and M6 (Dashboard, Issues screens) have no plan file yet.** This is expected: they are future milestones.
- `plan_install-as-terminal-command.md` covers design §2 (local installation) and §16 (test strategy).

### Empty sections

- None found. All headings carry substantive content.
