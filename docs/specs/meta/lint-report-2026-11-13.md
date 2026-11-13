# Spec Lint Report — 2026-11-13

Profile(s): `default` [auto-detected via `docs/specs/`]
Specs root: `docs/specs/`
Scope: what requirements revision 33 / M10 touched — `requirements.md`, `design.md`, `plan_m10-agent-friendly-cli.md`, `index.md`. The other 25 files were inventoried for the index check only.

## Summary

- Files scanned: 4 in scope (1 requirements, 1 design, 1 plan, 1 index); 29 inventoried
- Errors: 7 (one cause, pre-existing)
- Warnings: 0
- Info: 3
- Auto-fixed: 0. Two trace citations added by hand, see Info.

## Convention Reference

- Path: `docs/specs/meta/convention.md`
- Status: present (drifted from skill). The local copy was used.
- Active profile: `auto`, resolved to `default`

## Root Index / Registry

- Path: `docs/specs/index.md`
- Status: present
- Files linked: 28 / 28 spec files, `plan_m10-agent-friendly-cli.md` included

## Errors

### Dead links

All seven point at two files that are not in the tree. They predate revision 33: the same links are in the index at `2e304f4`, before this work began. Not fixed here.

- `design.md:4` → `design-review-r2.md` (not found)
- `design.md:1630` → `design-review-r1.md` (not found)
- `design.md:1631` → `design-review-r2.md` (not found)
- `index.md:56` → `design-review-r1.md` (not found)
- `index.md:57` → `design-review-r2.md` (not found)
- `requirements.md:14` → `design-review-r1.md` (not found)
- `requirements.md:15` → `design-review-r2.md` (not found)

## Warnings

None in scope. Naming, orphans, empty sections and both reverse-consistency checks are clean:

- Design covers requirements: R3.13 → §5.5; R6.15, R6.12, R6.13 → §9.4, §9.4a, §9.4b; R12.1, R12.11–R12.15 → §15, §15.1. `tests/specs/traceability.test.ts` checks the same through the *Satisfies* labels.
- Plan covers design: `plan_m10-agent-friendly-cli.md` names §5.5, §9.4, §9.4a, §9.4b, §15 and §15.1, and its task table has a row for each.

## Info

### Trace citations added
- `design.md` §15.1 covered R12.11 and R12.12 through the section's range label only. The `list` and `status` paragraphs now cite them by id.

### Convention drift
- `meta/convention.md` differs from the skill's bundled version. Local copy used. Refresh is the maintainer's call.

### Required headings
- `plan_m10-agent-friendly-cli.md` has **Why** and **Tasks** and no **Goal** heading. Every plan in this tree uses **Why**; house style.

### TODO markers
- None in scope.
