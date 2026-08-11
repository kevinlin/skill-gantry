# Spec Lint Report — 2026-08-11

Profile(s): `default` [confirmed via CLAUDE.md explicit pointer + `docs/specs/` directory signal]
Specs root: `docs/specs/`

## Summary

- Files scanned: 29 (3 root specs, 2 design extensions, 1 supporting, 18 plans, 2 reviews, 1 index, 2 meta)
- Profile completeness: 29/29 expected artefacts present (all files linked from index)
- Errors: 0
- Warnings: 0
- Info: 2
- Auto-fixed: 3

## Convention Reference

- Path: `meta/convention.md`
- Status: present (in-sync with skill)
- Active profile: `default` (via `active_profile: auto` → detected)

## Root Index / Registry

- Path: `index.md`
- Status: present
- Files linked: 27 / 27 spec files on disk (excluding index itself and meta/)

## Errors

None.

## Warnings

None.

## Auto-fixed this run

1. **Dead link (index.md → `meta/lint-report-2026-08-09.md`):** removed the row pointing at a deleted file.
2. **Dead link (index.md → `meta/lint-report-2026-08-11.md`):** this report's creation resolves it.
3. **Duplicate section number (design_tui.md):** "The setup repo step" renumbered from `### 14.12` to `### 14.13`. Updated all cross-references in `index.md`, `plan_m3.2-setup-repo-edit.md`, `design.md` and `design_version-check-and-upgrade.md`.

## Info

### Profile detection

- Detected profile: `default` via signal `docs/specs/` directory.
- Confirmed by: `CLAUDE.md` explicit reference "docs/specs/ holds three layers."

### Stub indicators

- `plan_m9-version-check-and-upgrade.md:1498` — "Deviations found while implementing" is an intentional placeholder for a plan with status `Planned`. Content will be filled during implementation.

## Checks with no findings

| Check | Status |
|---|---|
| 5.1 Naming convention | Clean — all files follow `<artifact>_<topic>.md` or are recognised root/supporting types |
| 5.2 Dead cross-doc links | Clean (post-fix) |
| 5.3 Orphan specs | Clean — every file on disk is linked from `index.md` |
| 5.4 Empty sections | Clean — no heading has zero content before the next peer heading |
| 5.5 Open-ended TODO markers | Clean — all `TBD` occurrences are metalinguistic ("No task says TBD") |
| 5.6 Frontmatter / required headings | Clean — no frontmatter convention in this tree; plan files have Goal + Tasks structure |
| 5.7 Registry drift | Clean (post-fix) |
| 5.8 Reverse consistency: design ↔ requirements | Clean — design.md §17 traces every R-group to its section(s) |
| 5.9 Reverse consistency: plan ↔ design | Clean — every plan's "Specification" or header traces to design sections |
