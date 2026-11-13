# Spec Lint Report — 2026-11-13

Profile(s): `default` [auto-detected via `docs/specs/`]
Specs root: `docs/specs/`
Scope: what requirements revisions 33 and 34 touched (M10, then M11) — `requirements.md`, `design.md`, `design_tui.md`, `design_version-check-and-upgrade.md`, `plan_m10-agent-friendly-cli.md`, `plan_m11-review-follow-ups.md`, `index.md`. The other files were inventoried for the index check only. This replaces the revision 33 report written earlier the same day and keeps its findings.

## Summary

- Files scanned: 7 in scope (1 requirements, 3 design, 2 plans, 1 index); 30 inventoried
- Errors: 7 (one cause, pre-existing)
- Warnings: 0
- Info: 4
- Auto-fixed: 0. Two trace citations were added by hand in revision 33, see Info.

## Convention Reference

- Path: `docs/specs/meta/convention.md`
- Status: present (drifted from skill). The local copy was used.
- Active profile: `auto`, resolved to `default`

## Root Index / Registry

- Path: `docs/specs/index.md`
- Status: present
- Files linked: 29 / 29 spec files, `plan_m11-review-follow-ups.md` included

## Errors

### Dead links

All seven point at two files that are not in the tree. They predate both revisions: the same links are in the index at `2e304f4`. Not fixed here.

- `design.md:4` → `design-review-r2.md` (not found)
- `design.md:1652` → `design-review-r1.md` (not found)
- `design.md:1653` → `design-review-r2.md` (not found)
- `index.md:57` → `design-review-r1.md` (not found)
- `index.md:58` → `design-review-r2.md` (not found)
- `requirements.md:14` → `design-review-r1.md` (not found)
- `requirements.md:15` → `design-review-r2.md` (not found)

Every link revision 34 added resolves, anchors included.

## Warnings

None in scope. Naming, orphans, empty sections and both reverse-consistency checks are clean:

- Design covers requirements, revision 33: R3.13 → §5.5; R6.15, R6.12, R6.13 → §9.4, §9.4a, §9.4b; R12.1, R12.11–R12.15 → §15, §15.1.
- Design covers requirements, revision 34: R11.25 → design_tui §14.15; R11.10 as amended → §14.5; R12.16–R12.19 → §15, §15.1, each cited by id in its own paragraph; R9.7 as amended → §12.4; R12.12 and R12.15 as amended → §15.1; R13.12 as amended → design_version-check-and-upgrade.md §3 and step 7 of the apply. `tests/specs/traceability.test.ts` checks the same through the *Satisfies* labels and passes.
- Plan covers design: `plan_m10-agent-friendly-cli.md` names §5.5, §9.4, §9.4a, §9.4b, §15 and §15.1, with a task row for each. `plan_m11-review-follow-ups.md` names §5.2, §5.3, §12.4, §15, §15.1, §14.5, §14.15 and the upgrade document's §3 and §4.4, and each has a task row (T1 to T4).

## Info

### Trace citations added
- Revision 33: `design.md` §15.1 covered R12.11 and R12.12 through the section's range label only. The `list` and `status` paragraphs cite them by id.

### Convention drift
- `meta/convention.md` differs from the skill's bundled version. Local copy used. Refresh is the maintainer's call.

### Required headings
- Both plans have **Why** and **Tasks** and no **Goal** heading. Every plan in this tree uses **Why**; house style.

### Section numbering
- `design_tui.md` §14.15 holds two things beside the rail: the home on the status line and the release hint in the Log pane. Neither has a requirement id of its own; the hint traces to R9.7 through `design.md` §12.4.

### TODO markers
- None in scope.
