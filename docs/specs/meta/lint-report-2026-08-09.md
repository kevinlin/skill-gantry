# Spec Lint Report — 2026-08-09

Profile(s): `default` [auto-detected via `docs/specs/` directory + `CLAUDE.md` explicit pointer]
Specs root: `docs/specs/`

## Summary

- Files scanned: 23 (index: 1, requirements: 1, design: 2, plan: 14, supporting: 3, meta: 2)
- Profile completeness: all expected root artefacts present (`index.md`, `requirements.md`, `design.md`)
- Errors: 0
- Warnings: 0 (1 auto-fixed)
- Info: 3
- Auto-fixed: 9 files renamed, 13 files updated (cross-doc link targets)

## Convention Reference

- Path: `meta/convention.md`
- Status: present (drifted from skill — profiles §4–§9 trimmed, §10–§11 renumbered)
- Active profile: `default` (via `auto` detection)

## Root Index / Registry

- Path: `index.md`
- Status: present
- Files linked: 23 / 23 spec files (including meta)
- All index entries resolve to existing files: yes
- Anchor links verified: `requirements.md#milestone-ownership` ✓, `plan_m6.md#extension-editable-settings` ✓

## Errors

None.

## Warnings

None. The one naming warning (`design-tui.md` → `design_tui.md`) was auto-fixed.

## Info

### Profile detection

- Detected profile: `default` via signal `docs/specs/` directory.
- Confirmed by `CLAUDE.md`: "docs/specs/ holds three layers".

### Convention drift

- `meta/convention.md` differs from the skill's bundled version. Local copy was used for this run.
- Diff summary: local copy retains only §3 (`default` profile) and §10–§11 (cross-profile mapping + customization), omitting §4–§9 (kiro, superpowers, openspec, spec-kit, bmad, gsd). This is a legitimate customization since the project uses only the `default` profile.

### Reverse consistency

- **Design ↔ requirements:** The project enforces this mechanically via `tests/specs/traceability.test.ts` (R13.7): every requirement has exactly one milestone owner and at least one design `*Satisfies*` label. No additional gaps detected by spec-lint.
- **Plan ↔ design:** Plans reference design sections by `§`-number (e.g., "aligned to design.md revision 3"). The coverage is implicit but complete — each plan's changelog records which design sections it amended.

### Auto-fix performed this run

Prior to linting, 8 plan files were renamed from `plan-m*.md` to `plan_m*.md` per user request, plus 1 naming-convention fix:

| Old name | New name |
|---|---|
| `plan-m1.md` | `plan_m1.md` |
| `plan-m2.md` | `plan_m2.md` |
| `plan-m3.md` | `plan_m3.md` |
| `plan-m4.md` | `plan_m4.md` |
| `plan-m5.md` | `plan_m5.md` |
| `plan-m6.md` | `plan_m6.md` |
| `plan-m7.md` | `plan_m7.md` |
| `plan-m8.md` | `plan_m8.md` |
| `design-tui.md` | `design_tui.md` |

Cross-doc references updated in 13 files: `index.md`, `requirements.md`, `design.md`, `decision-log.md`, `plan_m2.md`, `plan_m2-rehydrate-the-last-recorded-run.md`, `plan_m3.md`, `plan_m3-promptfoo-removal.md`, `plan_m4.md`, `plan_m5.md`, `plan_m6.md`, `plan_m6-settings-edit.md`, `plan_m8.md`, `plan_m8-work-screen-navigation.md`, `CLAUDE.md`.

Historical lint report (`meta/lint-report-2026-08-02.md`) left unchanged — it is a point-in-time record.
