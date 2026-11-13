# Plan — M11: the workflow review's open items

**Date:** 2026-11-13
**Status:** in progress
**Layer:** plan (layer 3 of 3: [requirements](requirements.md) → [design](design.md) → plan)
**Satisfies:** R11.25, R12.16–R12.19; R9.7, R11.10, R12.12, R12.15, R13.12 as amended in requirements revision 34
**Design:** [design.md](design.md) §5.2, §5.3, §12.4, §15, §15.1; [design_tui.md](design_tui.md) §14.5, §14.15; [design_version-check-and-upgrade.md](design_version-check-and-upgrade.md) §3, §4.4
**Delivers:** SkillGantry 1.1.0 on branch `release/1.1.0`, committed, not pushed, not tagged

---

## Why

[docs/research/skillops-workflow-review.md](../research/skillops-workflow-review.md) §2 listed fifteen things 1.0.0 did not do. Each was assessed against the code, the specs and a copy of a real home with three repos and 33 skills. Four things came out of that study that the review did not have:

- **The rail was wrong in a second way.** It showed the newest run and nothing else. `zapac-agent-skills/declawed` read `· passed · · ·` on the rail while `status` reported three verdicts, two of them stale. 1.0.0 fixed the same defect in the optimise prompt and left it on the screen.
- **The git-skill lock bug was live.** `skill-upper`'s lock entry recorded one link while a second link into the tool root sat in `~/.claude/skills`, unrecorded since the 0.7.0 pin bump.
- **`status` suggested a release that could not work.** Five skills declare no version, and `next` told each to run `release --version <patch|minor|major>`, which R9.10 refuses with nothing to bump.
- **An archive was already in the way.** `agent-insights_1.6.4.zip` sat in the repo root with the skill at 1.6.3, where a patch release would meet it and `status` could not see it.

## The one idea

**The screen and the command read one answer.**

M10 made `status` answer from release's own code. M11 makes the rail answer from `status`'s: `gateStatuses` is the mapping `buildStatus` ran inline, and the rail's three gate cells come from it through one new port method. A gate the newest run did not execute shows its latest verdict, and a verdict about bytes that have since changed is marked `~`. The alternative, a second reading of R9.8 over the sidecar, is how the optimise prompt and `status` came to be two implementations of one rule.

The rest of the milestone removes the last things only a terminal could do, each by calling the function the terminal already calls: `run --repo` is the TUI's queue, `issue` is the Issues screen's `setIssueState`, `setup --yes --preset` is the wizard's `SetupDriver`.

## Assessment

| # | Review item | Verdict | What ships |
|---|---|---|---|
| W1 | Stale gates are invisible until release refuses | Accepted, widened | The rail's gate cells show each stage's latest verdict and mark a stale one (R11.25) |
| W2 | One fix invalidates every gate | Deferred | Nothing. It changes R9.9 and §4.4's one-manifest rule and needs its own design review, as the review says |
| W3 | No batch run headlessly | Accepted | `run --repo <id>` (R12.16) |
| W4 | No headless issue triage | Accepted | `issue <fingerprint> <action>` (R12.17). Passing skills in the reference home carried 5 to 16 open issues only the Issues screen could clear |
| W5 | Release stops before the commit | Accepted | A release that applied names the two git commands (R9.7 as amended) |
| W6 | `ready` cannot see the target-dependent checks | Accepted, narrowed | `status --version` decides the target and the archive (R12.19). The sandbox stays undecided: opening one is a write |
| S1 | Tool installation is wizard-only | Accepted | `setup --yes --preset <name>` (R12.18). Never installs a runtime, never writes `.env` |
| S2 | The wizard does not offer the bundled skill | Accepted, in its smallest form | The done step names `skillgantry skill install`. No key, no driver method |
| S3 | `doctor` takes about 15 seconds | Flag declined, goal accepted | No `--quick`. The per-tool checks run concurrently (§5.3) |
| B1 | git-skill reinstall drops its own links | Accepted | Detection per (directory, skill); our own link is re-pointed and recorded (§5.2) |
| B2 | `detectSkillDirs` probes the first skill only | Accepted | Fixed by B1's rule |
| B3 | `fix` and `optimise` each have a private reader | Accepted, small | Partly stale after 1.0.0. One `readJson`, one `RunMetaOnDisk`, one `newestEntry` |
| M1 | The status line does not name the home | Accepted, narrowed | Shown when the home is not the default |
| M2 | `--help` has no grouping | Accepted | Four groups through commander's `helpGroup` |
| M3 | `backup/` is never pruned | Accepted | A snapshot is kept only while its version's prefix is retained (R13.12 as amended) |

## Decisions

Made with the maintainer before work started:

- **Delivery stops at a branch.** Commits on `release/1.1.0`, no push, no tag.
- **`setup --yes --preset` is in.** It reverses R12.15's rationale, which kept installation with the wizard. Without it `run --repo` has no use in CI, where there is no terminal to install from.
- **No `doctor --quick`.** A second report in which `ok` means "present" is a weaker contract than a faster first one.

Made in design, and recorded there:

- **The stale mark is `~` in the cell's leading space, with the word dimmed.** No column changes width, so the 80×24 floor is untouched.
- **A cell the newest run did execute keeps that run's outcome.** A cancelled run must not show an older pass in its place (§14.15).
- **An archive already in the tree is `dirty`, not a blocker.** That is what `openSandbox` makes of it, and `--allow-dirty` is the user's call for it as for every other path there.
- **The selection is written only when every tool of the preset is usable.** The wizard cannot leave its install step otherwise.
- **The commit hint carries its paths on the commit as well as on the add**, so work staged for another skill is not swept in.
- **No tag is suggested after a release.** The reference repo has none, and a multi-skill repo's scheme is its maintainer's.
- **A lock entry written under the old git-skill rule heals at the next install.** Nothing rewrites a lock outside an install.

## Tasks

Run through the agent-handoff flow: the driver plans, splits and reviews every diff in full; a worker executes each delegated row as a background job. Identities are roles from the maintainer's own config.

| id | owner | task | acceptance | depends | state |
|---|---|---|---|---|---|
| T0 | driver | Spec amendments and this plan, committed before implementation | `pnpm vitest run tests/specs` passes | - | |
| T1 | fast_worker | `gateStatuses` extraction, `status --version`, version-less `next`, `issue`, the release hint, help groups | `pnpm check` green; status and release agree over a target; every new exit code tested | T0 | |
| T2 | fast_worker | `run --repo` over the shared queue wiring, `setup --yes --preset` over `buildSetupDriver` | `pnpm check` green; batch exit codes tested; setup driven offline with an injected driver | T1 | |
| T3 | fast_worker | The git-skill rule with a reinstall test, concurrent doctor, backup prune, reader dedupe; in a worktree | `pnpm check` green; a reinstall records every own link; existing doctor tests pass untouched | T0 | |
| T4 | fast_worker | The rail's gate cells and the stale mark, the home on the status line, the wizard's done line, the release hint in the Log pane | `pnpm check` green; frames at 80×24 and wide; a suppression marks the cells without a relaunch | T2, T3 | |
| T5 | driver | The bundled skill and its reference, README, `CLAUDE.md`; `declawed` pass | the version pin test passes; the skill's floor reads 1.1.0 | T4 | |
| T6 | driver | `tests/acceptance/m11.test.ts` | passes under `pnpm acceptance` | T4 | |
| T7 | driver | The review's §2 marked with these verdicts and `spec-lint`, committed; then `pnpm release:version minor` on the clean tree, the hand-edited 1.1.0 section, final `pnpm check`, commit | `pnpm check` green on the final commit; an install with a temp `SG_HOME` and `SG_BIN_DIR` prints 1.1.0 | T5, T6 | |

- T1, T2 and T4 share `src/cli/run-command.ts` and `src/cli/tui-command.ts` and run one at a time. T3 runs beside T1 in a worktree and is collected as a patch before T4 starts, because T3 moves `newestEntry` out of `src/tui/views.ts` and T4 edits that file.
- Workers do not commit. The driver commits each row after reading its whole diff against the row's brief.

## Verification

- `pnpm check` after every row and on the final commit.
- **Against a copy of the real home** (`config.json` and `gantry.db` copied, `tools/` symlinked, no `.env`): `status` for `declawed` beside a pty capture of the Work screen, where the rail must agree gate for gate; `status agent-insights --version patch` lists the archive as uncommitted; `status` on a version-less skill suggests a semver; `--help` shows four groups.
- `skillgantry doctor` timed three times before and three times after against the same home copy, the six numbers recorded below; a unit test asserts every tool check has started before the first resolves, and that findings keep lock order when they resolve out of it.
- **A disposable repo with stand-in tools:** `run --repo` exits `1` with one failing skill and `0` without; an `issue` round trip; a release prints two git lines that run as printed.
- `setup --yes --preset minimal` under `SG_INTEGRATION=1` only, against a temp `SG_HOME` **and** a temp agent home, asserting that nothing under the real `~/.claude`, `~/.codex` or `~/.agents` changed. The default suite stays offline.
- The `declawed` skill run over the bundled skill, its reference, this plan and the 1.1.0 changelog section; its re-scan reporting no remaining tell is the evidence.

## What the independent review changed

The plan had one read-only review by the deep_reasoner identity before any work started. Five blocking findings and four advisory, all accepted, none declined:

1. **A temp `SG_HOME` does not isolate a real install.** `buildSetupDriver` took a `userHome` and never passed it to `installTool`, so a `git-skill` install linked into the maintainer's own agent directories. It is forwarded, and the integration test isolates both homes.
2. **The commit hint could commit someone else's staged work.** Release permits unrelated staged changes, and a bare `git commit` takes the whole index. The commit line carries the paths.
3. **`archive-present` was a refusal release does not make.** Release treats an existing archive as a dirty scope path under `--allow-dirty`. `status --version` reports it in `dirty`, through the same preview.
4. **The rail's rule was incomplete.** "Cannot disagree" contradicted keeping a cancelled run's cell. §14.15 now states the one place the rail shows more than `status`, which run a filled cell came from and what `y` does there, when the read is repeated, and that a late read never lands on a live row. R11.10 joined the amendments.
5. **"Gate stages only" read as applying to every `run`.** It is `run --repo`'s. The single-skill path keeps R12.4's recorded skip, and the shared queue wiring takes `authorised` from its caller.
6. *(advisory)* **Headless setup's failure and output were unspecified.** §15.1 states the order, what a failure leaves, the document and the exit codes.
7. *(advisory)* **"Our own link" and "the same two" were loose.** One predicate with a path-segment boundary, shared with doctor; snapshots kept by membership in the retained set.
8. *(advisory)* **The reader dedupe changes behaviour unless a policy is chosen.** Strict by default; `optimise` keeps its tolerance at its call sites, with a regression test for corrupt historical evidence.
9. *(advisory)* **T7 would have met the version script with a dirty tree.** The documentation is committed first.

## Key files

| Concern | File |
|---|---|
| `gateStatuses`, `status --version`, `nextSteps` | `src/cli/status-command.ts` |
| `run --repo`, the shared queue wiring | `src/cli/run-command.ts`, `src/cli/tui-command.ts` |
| `issue` | `src/cli/issue-command.ts` |
| `setup --yes --preset` | `src/cli/setup-command.ts` |
| `commitHint` | `src/core/release/`, `src/cli/release-command.ts` |
| The git-skill rule | `src/core/tools/git-skill.ts` |
| Concurrent doctor | `src/core/tools/doctor.ts` |
| Backup prune | `src/core/upgrade/apply.ts` |
| The rail | `src/tui/views.ts`, `src/tui/store.ts`, `src/tui/components/LifecycleRail.tsx`, `src/cli/gantry-views.ts` |
| Acceptance | `tests/acceptance/m11.test.ts` |

## Deviations found while implementing

(Written as the rows land.)
