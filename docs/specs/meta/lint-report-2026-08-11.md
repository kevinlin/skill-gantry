# Spec Lint Report — 2026-08-11

Profile(s): `default` [auto-detected via `docs/specs/` directory; confirmed by CLAUDE.md]
Specs root: `docs/specs/`

## Summary

- Files scanned: 28 (1 index, 1 requirements, 2 design, 19 plan, 3 supporting, 2 meta)
- Profile completeness: 3/3 root artefacts present (index.md, requirements.md, design.md)
- Errors: 11
- Warnings: 0
- Info: 4
- Auto-fixed: 10

## Convention Reference

- Path: `meta/convention.md`
- Status: present (drifted from skill — §4–§9 trimmed, an intentional customization)
- Active profile: `default`

## Root Index / Registry

- Path: `index.md`
- Status: present
- Files linked: 27 / 27 spec files (index does not list itself)
- Dead row removed: `meta/lint-report-2026-08-02.md` (replaced by 2026-08-11 entry)

## Errors

### Dead links

- `plan_m3-setup-repo-edit.md:11` → `plan_m9.md` (not found — M9 work lives in `plan_m4-skillhone-optimise.md`, not a standalone plan file). **Not auto-fixed** — requires editorial decision on whether to link to `plan_m4-skillhone-optimise.md` or remove the link.

~~`index.md:58` → `meta/lint-report-2026-08-02.md`~~ **Auto-fixed:** dead row replaced by 2026-08-11 entry.

~~9 repo-root-relative links in `plan_m6-fix-prompts-for-stage-findings.md` and `plan_m6-respect-skillspector-baseline.md`~~ **Auto-fixed:** `docs/specs/design.md` → `design.md`, `docs/specs/requirements.md` → `requirements.md`.

### Index / registry drift

~~`meta/lint-report-2026-08-02.md` exists in the index Meta table but not on disk.~~ **Auto-fixed.**

## Warnings

### Orphan specs

None. Every file on disk is referenced from `index.md`.

### Naming

Clean. All files follow the `default` profile's naming rules. `decision-log.md` and `design-review-r*.md` are deliberately classified as Supporting / Reviews in the index, outside the three standard artifact types.

### Reverse consistency — design ↔ requirements

Clean at the structural level. design.md §17 provides an explicit traceability table mapping every R* group (R1–R13) to design sections. The mapping is machine-checked by `tests/specs/traceability.test.ts` — a requirement claimed by no section, or a section claiming a non-existent requirement, fails the build. No structural gap found.

### Reverse consistency — plan ↔ design

Clean at the structural level. Every plan traces to specific design sections in its header (`Layer 2:` references) and lists its requirement coverage in a dedicated section. design.md §18 records which sections each milestone amended and which plan document holds the reasoning. The bidirectional traceability is maintained through the project's own spec test infrastructure.

### Empty sections

None found across all 28 files.

## Info

### Profile detection

- Detected profile: `default` via signal `docs/specs/` directory.
- CLAUDE.md explicitly names `docs/specs/` as the spec root ("**docs/specs/index.md is the only catalogue**").

### Convention drift

- `meta/convention.md` differs from the skill's bundled version. §4–§9 (kiro, superpowers, openspec, spec-kit, bmad, gsd) were trimmed — a valid customization for a single-profile project. §10 and §11 renumbered accordingly. Local copy was used for this run.

### TODO markers

- `plan_m1.md:308`: "No task contains TBD, TODO" — completeness assertion, not an open marker.
- `plan_m3.md:180`: "No task says TBD" — completeness assertion, not an open marker.
- `plan_m3-promptfoo-removal.md:487`: "No step says TBD" — completeness assertion, not an open marker.
- `plan_m4-skillup-first-eval.md:205`: "no task says TBD" — completeness assertion, not an open marker.

All four are assertions of plan completeness. No actual open TODO markers in the spec tree.

### Plan heading conventions

The `default` profile suggests plan files have a **Goal** heading and either **File Structure** or **Tasks**. This project uses a consistent alternative:

- **Goal:** 15/19 plans use `**Goal:**` bold text rather than a `## Goal` heading. 4 extension plans (`plan_m2-rehydrate-the-last-recorded-run`, `plan_m5-tui-release-target`, `plan_m6-fix-prompts-for-stage-findings`, `plan_m6-respect-skillspector-baseline`) use a Context → Design → Sequencing shape and omit a goal statement.
- **Tasks:** 15/19 plans have a `## Tasks`, `## File structure`, or `## Implementation Tasks` section. The same 4 extension plans above use sequenced steps instead.

The `**Goal:**` convention is consistent and deliberate; the 4 extension plans follow an alternate shape that predates the convention. Neither is a defect.

### Duplicate section number

- `design_tui.md:390` — `### 14.12 The repo and skill list`
- `design_tui.md:416` — `### 14.12 The setup repo step`

Two sections share the number `14.12`. The second is likely `14.13`. No link currently targets a `14.12` anchor, so no dead link results, but the numbering is inconsistent with the rest of the document's sequential scheme.

### Flat spec structure

All 19 plan files, both design files, and the 3 supporting files live at the specs root with no module subdirectories. The `default` convention's example tree uses one folder per module, but a flat layout is a valid choice for a project where milestones (not modules) are the primary organizational axis, and the index provides the grouping the folders would.
