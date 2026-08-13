# Changelog

One section per released version, newest first. The client reads this file from the release's own
asset rather than from a branch (R13.9), so a section is immutable once its release is published.

Entries were backfilled from a first-parent walk of `package.json`'s version
(`scripts/changelog-from-history.sh`), then compacted: where a version delivered a milestone, the
entry states what that milestone's plan under [docs/specs/](docs/specs/index.md) set out to do
rather than replaying its commits. Standalone fixes belonging to no plan are listed on their own.

`parseChangelog` reads only the `- ` lines, and the upgrade prompt gives each one row. So a bullet
is a headline that fits a terminal, and the paragraph under it carries the detail.

## 0.6.5 — 2026-08-13
- fix: producer/consumer name mismatch in the checksum

## 0.6.4 — 2026-08-13
- feat: Cut version check window from 24h to 1h

## 0.6.3 — 2026-08-12
- fix: report a credential against the environment the gate reads
- fix(config): derive the api-key form of a gateway credential at spawn
- fix: replace all 36 hand-declaring SkillRef literals with `tests/helpers/skill-ref.ts`
- fix: Two TUI naming fixes: skill label, run label

## 0.6.2 — 2026-08-11
- M1.1 — a run directory named for when the run started (R6.1, R6.4, R6.7)

  [plan](docs/specs/plan_m1.1-timestamped-run-directories.md). A run wrote to a directory named by its
  UUIDv7 id, so `ls` on a workspace was a column of UUIDs and identifying a run meant opening
  `run.json` in each one. The directory is now `2026-08-11_14-32-07` from the start time, suffixed
  `-2` where two runs share a second, and the id still lives in `run.json`. Existing workspaces are
  not migrated and keep resolving: an index record written before the name was recorded is read as a
  run named by its id. `skillgantry fix --run` now takes either handle.

## 0.6.1 — 2026-08-11
- feat(scripts): cut a version with one command

  `pnpm release:version [patch|minor|major]` bumps `package.json` and opens this file's next section,
  seeded from the commits since the last bump by `changelog-from-history.sh --pending` — the same
  range shape and subject filter the backfill uses. It refuses a dirty tree and stops before
  committing, tagging or pushing, since the tag is what publishes and the seeded bullets still need
  editing into terminal-row headlines. Recorded as design_version-check-and-upgrade.md §5.1a.

- docs: compact the changelog against the milestone plans

  Each version that delivered a milestone now states what that milestone's plan set out to do,
  instead of replaying its commit subjects. Bullets are headlines within a terminal row, since the
  upgrade prompt gives each one line; the detail sits in a paragraph the parser drops.

## 0.6.0 — 2026-08-11
- M9 — version check and self-upgrade (R11.24, R12.10, R13.8–R13.12)

  [plan](docs/specs/plan_m9-version-check-and-upgrade.md). Publish SkillGantry from GitHub Releases,
  and have the terminal interface offer — never impose — the newer release it finds at launch,
  installing it into a versioned prefix and relaunching into it. Adds the release workflow with its
  two pre-publish assertions, this changelog and its backfill, the throttled check, `skillgantry
  upgrade`, and doctor's `skillgantry-outdated` condition.

- fix(config): name the version that wrote a document this build cannot read
- fix: add the pnpm workspace file

## 0.5.1 — 2026-08-10
- fix(setup): label each tool with the stage it serves

## 0.5.0 — 2026-08-10
- M7.2 — two-level repo and skill navigation (R11.23)

  [plan](docs/specs/plan_m7.2-repo-skill-navigation.md). Give the list column the level it has
  always claimed — the registered repos above the skills of one repo — under the horizontal key
  pair that was bound nowhere in that zone. Amends R11.11.

## 0.4.3 — 2026-08-10
- No user-facing change.

## 0.4.2 — 2026-08-10
- M4.2 — skill-up's first eval suite (R3.11, R6.13, R11.22, R12.9)

  [plan](docs/specs/plan_m4.2-skillup-first-eval.md). Give the evaluate gate a way to start. Marking
  `evaluate` on a skill with no `evals/eval.yaml` now opens a surface that hands the maintainer a
  coding-agent prompt for authoring one, and `skill-upper` — which owns the templates and judge
  guidance that prompt names — becomes a catalogued, installed and verified `git-skill` bundle
  rather than something the user is assumed to have.

- M3.2 — the setup repo step shows and edits what is registered (R3.12)

  [plan](docs/specs/plan_m3.2-setup-repo-edit.md). The `credentials-and-repo` state names every repo
  already registered and can replace a selected repo's path in place, keeping that repo's identifier
  so its recorded runs and issues follow the change. A clean machine's frame does not change.

## 0.4.1 — 2026-08-10
- feat(setup): compose the SkillHone settings file at install time

  M4.1 continued: `~/.skillhone/settings.json` is written from the credential file during install.

- ui: colour for state; the terminal's own for surface

## 0.4.0 — 2026-08-10
- M4.1 — SkillHone and the optimise action (R3.10, R6.12, R11.21, R12.8)

  [plan](docs/specs/plan_m4.1-skillhone-optimise.md). Give the optimise stage something behind it.
  SkillHone becomes the catalogue's first non-CLI entry — a bundle of agent skills installed by
  clone and per-skill symlink, with its Python dependencies isolated in a managed venv. Marking
  `optimise` on the rail opens a surface that hands the maintainer a coding-agent prompt built from
  the skill's recorded evidence. SkillGantry installs and composes; it never runs the loop and never
  applies its result.

- fix(core): stop a cancelled gate superseding the pass it never contradicted
- fix(tui): stop a marked release swallowing the stage that would unblock it

## 0.3.3 — 2026-08-09
- M5.1 — collect the release target before enqueuing the job (R11.19, R11.20)

  [plan](docs/specs/plan_m5.1-tui-release-target.md). Release never infers a target version, so a
  release marked from the Work screen failed in 90ms with nothing to release. Adds the target
  surface, the `planRelease` port, the rail's runnability guard, and `plan()` inside the stage's
  failure boundary.

- fix(core): reproduce the candidate manifest in the git sandbox
- fix(specs): correct a spec-test path assertion

## 0.3.2 — 2026-08-09
- M7.1 — Work screen navigation and the detail view (R11.18)

  [plan](docs/specs/plan_m7.1-work-screen-navigation.md). Every movement key acts on the zone that
  owns it, both arrow pairs work where the letter pairs do, the Dashboard key is advertised wherever
  the Overview card renders, and `enter` opens the selected finding or issue at the length its tool
  wrote it. Amends R11.11–R11.14.

## 0.3.1 — 2026-08-09
- M8 — accept a finding as a false positive from the terminal

  [plan](docs/specs/plan_m8-suppress-finding.md). R4.16, R8.16, R10.12, R11.16, R11.17, R12.7. A maintainer who has judged a finding a false
  positive can accept it from the Issues screen or the Findings pane, see the exact bytes that will
  land in their repo before they land, and re-run the gates the acceptance invalidated — without
  leaving the terminal and without hand-editing YAML. Adds a declarative baseline spec on the
  adapter manifest and a narrow diff-confirm-recheck-rename write path.

- ui: polish pass

## 0.3.0 — 2026-08-09
- M7 — Work screen overhaul (R11.11–R11.15)

  [plan](docs/specs/plan_m7-work-screen-overhaul.md). Make the Work screen answer the daily loop end
  to end — act on a finding, see the statistics, and have every movement key belong to a focus zone
  — without leaving the screen or breaking the 80×24 floor. Adds the D23 palette, a titled panel
  border that funds the row budget, three focus zones, the Overview card and its height-driven
  tiers, a Findings cursor with inline evidence, the Issues tab, and `openPath`. Amends R11.9.

- M6.3 — respect a tool's suppression baseline (R4.14, R4.15, R6.11, R8.15)

  [plan](docs/specs/plan_m6.3-respect-skillspector-baseline.md). skillspector takes `--baseline` and
  never auto-discovers the file, so a repo's accepted false positives were re-reported and re-filed
  as open issues. Adds conditional argv, `RawFinding.suppressed`, the ledger's derived suppression
  cache, and the Issues mark.

## 0.2.2 — 2026-08-05
- M2.1 — rehydrate the last recorded run on the Work screen (R11.10)

  [plan](docs/specs/plan_m2.1-rehydrate-the-last-recorded-run.md). Relaunching against a skill with
  recorded runs showed an empty rail, empty Findings and `no run this session`, while every byte of
  that evidence sat on disk. The screen now presents the selected skill's most recently recorded run
  and replays its tool output in the Log pane.

## 0.2.1 — 2026-08-05
- M6.2 — a fix prompt per findings-bearing stage (R6.10, R11.9, R12.6)

  [plan](docs/specs/plan_m6.2-fix-prompts-for-stage-findings.md). Findings are routinely unsafe to
  apply mechanically — one remediation wanted a frontmatter field that would fail validate, the
  other was a false positive — so the deliverable is a generated prompt, not a fixer. SkillGantry
  writes the prompt, the agent judges and edits, the user re-runs the stage. Adds the builder in
  `stages`, the pipeline hook, `skillgantry fix`, and `y` on the Work screen.

- feat: name the running version in the status bar
- ui: delight pass; make the output pane readable

## 0.2.0 — 2026-08-05
- M2 — queue and terminal interface

  [plan](docs/specs/plan_m2-queue-and-tui.md). A queue and a terminal interface over the M1 engine:
  batch enqueue with a bounded worker pool, a command path that cancels and resolves, and a Work
  screen that renders live state without holding log text in React.

- M3 — the tools module

  [plan](docs/specs/plan_m3-tools-module.md). External tools become installable, verifiable and
  lockable through three drivers; a re-enterable setup wizard takes a clean machine from no runtime
  to a verified toolchain, a registered repo and a written selection; `doctor` re-verifies the lock
  and reports every drift kind. Includes
  [M3.1](docs/specs/plan_m3.1-promptfoo-removal.md) — promptfoo dropped entirely, since it evaluates
  prompts declared in a config and has no notion of a skill.

- M4 — the remaining adapters and the cross-tool merge

  [plan](docs/specs/plan_m4-adapters-and-merge.md). Three adapters join skillspector, the rule-class
  map gains twenty entries and with them the versioned migration M1 deferred, and two tools
  reporting one problem in one file resolve to one issue with two detections — closing only when
  both agree it is gone.

- M5 — mutation isolation and release

  [plan](docs/specs/plan_m5-mutation-and-release.md). Let SkillGantry write to the user's repo
  without ever being able to lose their work: two mutation sandboxes behind one interface, a
  journalled apply with a preimage recheck, and crash recovery from a marker written before the
  first byte moves. On top of that the release stage — package, prove the archive installs, then
  touch the working tree once — plus retirement through the same path.

- M6 — screens and the command palette

  [plan](docs/specs/plan_m6-screens-and-palette.md). Turn five milestones of recorded evidence into
  answers: cross-repo statistics out of the ledger, an Issues table a maintainer can triage from,
  the four top-level screens design §14 named, and a palette that reaches all of them. Extended by
  [M6.1](docs/specs/plan_m6.1-settings-edit.md) (R11.7, R11.8) — Settings names every setting, its
  value and the file that holds it, and an edit reaches disk only as a confirmed change set.

## 0.1.0 — 2026-08-01
- M1 — the engine and the sidecar

  [plan](docs/specs/plan_m1-engine-and-sidecar.md). The SkillGantry engine end to end for one
  adapter, driven by a headless command, with every cross-cutting contract — sidecar layout,
  redaction, fingerprinting, reconciliation, provenance — proven against real tool output from a
  tool SkillGantry itself installed. Discovery and the candidate digest, the runner with its
  process-tree kill, the adapter contract and rule-class map, the stage outcome reduction, the
  locked append-only sidecar, the SQLite ledger with scoped reconciliation and issue transitions,
  and `skillgantry run` with JSON output and exit codes.
