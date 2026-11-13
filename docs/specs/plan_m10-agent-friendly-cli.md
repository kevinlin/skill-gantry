# Plan — M10: a headless surface a coding agent can drive

**Date:** 2026-11-12
**Status:** shipped
**Layer:** plan (layer 3 of 3: [requirements](requirements.md) → [design](design.md) → plan)
**Satisfies:** R3.13, R6.15, R12.11–R12.15; R6.12, R6.13, R12.1 as amended in requirements revision 33
**Design:** [design.md](design.md) §5.5, §9.4, §9.4a, §9.4b, §15, §15.1
**Delivers:** SkillGantry 1.0.0 on branch `release/1.0.0`, committed, not pushed, not tagged

---

## Why

0.7.0 could be driven from the Work screen and from nowhere else. Run against a real home with three registered repos and 33 skills, the headless commands showed these gaps:

- `skillgantry fix declawed` printed a Node stack trace and exited `1`, the code R12.2 gives a stage that did not pass, because `declawed` is in two repos. The bin entry had no handler; design §15 said it had.
- Nothing listed the skills, a skill's gate state, its open issues, or whether release would refuse. Every one of those was a screen.
- `skillgantry` and `skillgantry setup` threw from inside Ink without a terminal, which is every agent's shell.
- A repo could be registered only through that wizard.
- `run` required `--stage`; `run`, `release` and `retire` had no `--help` description.
- The three prompts cited `R6.12` and `R6.13` to a reader who cannot resolve them. The optimise prompt read the newest run alone, so for `agent-insights` it showed security and dropped the eval evidence recorded a run earlier. The fix prompt told the agent to stop one line before telling it what to do next.
- Five dependency majors were pending.

## The one idea

**`status` is the document an agent reads between commands, and it answers from release's own code.**

An agent does not need more commands so much as a way to learn what the last one meant. `status` gives it the current digest, each gate's verdict and whether that verdict is about today's bytes, the open issues, every refusal release would meet, and the ordered commands that remove them. The refusals come from `gatherReleasePreconditions`, which `release-stage.ts` now calls instead of assembling the same inputs inline. One gathering, so a status that says ready and a release that refuses cannot both be right about the same tree.

It says ready *to attempt*. The target version, the archive path and the sandbox are decided only once a version is supplied, so `unchecked` names them instead of `ready` covering for them.

Everything else follows from the reader being a program:

1. **`2` means the request could not be carried out**, `1` that it ran and the answer was no. One `error:` line, no stack, a JSON document under `--json`.
2. **`run` defaults to the three gates.**
3. **No terminal, no interface**: the root action and `setup` say so and exit `2`.
4. **`repo add`** is the wizard's `registerRepo` without the wizard.
5. **The prompts say why, cite nothing internal, and end on the two commands that close the loop.** Optimise reads each stage's latest verdict across runs.
6. **The package ships a skill that teaches this**, installed by copy behind a checked marker (§5.5).

## Decisions

Made with the maintainer before work started:

- **Delivery stops at a branch.** Commits on `release/1.0.0`, no push, no tag. The tag is what publishes, and that stays a human step.
- **TypeScript stops at the newest release typescript-eslint supports.** Its peer range is `<6.1.0` even at 8.72.2, so 6.0.x, with TypeScript 7 recorded as held back.
- **`@types/node` stays on 24.** The engine floor and CI are Node 24; 26 would type-check APIs Node 24 lacks.
- **The lockfile stays at `lockfileVersion: '9.0'`**, because CI installs frozen under pnpm 10.

Made in design, and recorded there:

- **`status` exits 0 whenever the document was produced.** Readiness is `release.ready`. `fix`'s divergence from R12.2, for its reason.
- **The error handler lives in `main()` and never in `buildProgram`.** About 13 test assertions drive the program in-process and assert on the rejection.
- **The skill is installed by copy, not by link.** A link into `versions/<v>` dangles after the second upgrade, and a stable link would add a step to the relink §20 calls its whole safety argument.
- **Not built:** headless tool installation, headless issue triage, a batch `run` over a repo. Each is written up, with what it would take, in [docs/research/skillops-workflow-review.md](../research/skillops-workflow-review.md).

## Tasks

Run through the agent-handoff flow: the driver plans, splits and reviews every diff in full; a worker executes each delegated row as a background job. Identities are roles from the maintainer's own config, not vendors.

| id | owner | task | acceptance | depends | state |
|---|---|---|---|---|---|
| T0 | driver | Spec amendments and this plan, committed before implementation | `pnpm vitest run tests/specs` passes | - | done `6f055b8` |
| T1 | fast_worker | Dependency upgrade per the decisions above | `pnpm check` green; `pnpm outdated` lists only typescript and @types/node; frozen install works under pnpm 10 | T0 | done `b5a8104` |
| T2 | fast_worker | `list`, `status`, `run` default stages, `repo add`, the error contract in `main()`, the non-TTY refusal, help text, `gatherReleasePreconditions` | `pnpm check` green; existing release tests pass untouched; unit tests for `next` ordering; status/release agreement tested through the release pipeline | T1 | done `6cade28`, one fix round |
| T3 | fast_worker | Prompt changes with driver wording; per-stage optimise evidence; `evals` lists files only | `pnpm check` green; driver regenerates the three prompts for a real skill and reads them | T2 | done `12175fb` |
| T4 | fast_worker | `skill install` / `skill path` with the marker rule, doctor's `agent-skill-outdated`, packaging tests, the release-script line, against a placeholder SKILL.md | `pnpm check` green; the tarball assertion passes | T2 | done |
| T5 | driver | Write the bundled skill and its reference; `declawed` pass | skill-lint verdict SAFE; the dogfood run below | T3, T4 | done |
| T6 | driver | `tests/acceptance/m10.test.ts`: never-run to released by following `status.next` alone, the error contract, the install refusals | passes under `pnpm acceptance` | T3, T4 | done |
| T7 | driver | Run the acceptance suite against the final release candidate | every acceptance test passes on the final commit | T5, T6, T9 | done |
| T8 | driver | Workflow review, README section, `CLAUDE.md`; `spec-lint` and `declawed` passes | spec-lint clean; traceability test green | T5 | done |
| T9 | driver | `pnpm release:version major`, hand-edit the 1.0.0 changelog section into headlines, final `pnpm check`, commit | an install with a temp `SG_HOME` **and** a temp `SG_BIN_DIR` prints 1.0.0 | T8 | done |

- T1 → T2 → T3 run one at a time in the main tree: they share `src/cli/run-command.ts` and each needs a clean `pnpm check`. T4 runs in parallel in a worktree and is collected as a patch.
- Workers do not commit. The driver commits each row after reading its whole diff against the row's brief.
- The driver pauses only for something destructive or irreversible, a real scope change, or something only the maintainer can supply.

## Verification

- `pnpm check` after every row and on the final commit.
- **Against a copy of the real home** (`config.json` and `gantry.db` copied, `tools/` symlinked, no `.env`), so nothing of the maintainer's is written: `list`; `status` for a real skill; `fix declawed` exits `2` with one line; the suggested `fix --run` prints a prompt; the three regenerated prompts read through.
- **Dogfood in a disposable repo.** The bundled skill copied in as a direct child (discovery reads only the root and its children), a temp home with the real tool lock and an explicit stage selection, then `repo add`, `list`, `run`, `status --json`, following `next` until release-ready or a named blocker. Security may come back `errored` without credentials; that is reported as such, never as passed.
- `echo | skillgantry` exits `2` with the pointer line.
- `skill install --dir <temp>` twice, then against an unmarked directory and a symlink.

## What the independent review changed

The plan had one read-only review by the deep_reasoner identity before any work started. Six blocking findings and two advisory, all accepted, none declined:

1. **A temp `SG_HOME` does not protect the installed CLI.** `install:cli` still relinks `~/.local/bin/skillgantry` unless `SG_BIN_DIR` is set too. T9 sets both.
2. **Sharing the gatherer cannot promise that `status` and `release` agree.** Release also refuses on an absent release tool, a bad target, a dirty archive and a sandbox that will not open. So `ready` means ready to attempt, `unchecked` names what a target decides, an absent release tool is a blocker, the gatherer returns its evidence, and agreement is tested through the release pipeline.
3. **`next` could send `fix` to the wrong run.** Gates are selected per stage, `fix` defaults per run. Every suggested `fix` carries `--run <gate.runId>`, and `next` is defined for degraded, deprecated, version disagreement and dirty.
4. **Replacing an installed skill was underspecified.** `rename` will not replace a non-empty directory. §5.5 now states two renames, a marker validated by content, a symlink refused, and an interrupted swap completed by the next install.
5. **A catch in `main()` alone misses commander's own exits**, and `optimise` and `evals` already used `2`. `exitOverride` goes on every command; help and version still exit `0`; those two print the JSON document under `--json`.
6. **The dogfood run as planned could not work.** Registering this repo does not discover `skills/skillgantry/`, and a fresh home has no stage selection. Hence the disposable repo above.
7. *(advisory)* **Final verification came too early.** T7 now runs on the final release candidate, after the skill is written and the version is bumped.
8. *(advisory)* **Stored fix prompts keep their old wording.** `fix` prints a `fix-prompt.md` on disk as written. R6.15 and §9.4 say so.

## Key files

| Concern | File |
|---|---|
| `main()`, the error contract | `src/cli/main.ts`, `src/cli/errors.ts`, `src/cli/index.ts` |
| `list`, `status`, `nextSteps` | `src/cli/list-command.ts`, `src/cli/status-command.ts` |
| `gatherReleasePreconditions` | `src/core/release/gather.ts`, called from `src/core/stages/release-stage.ts` |
| `repo add`, `skill install`, `skill path` | `src/cli/repo-command.ts`, `src/cli/skill-command.ts` |
| `agent-skill-outdated` | `src/core/tools/doctor.ts` |
| Prompt wording, the shared closing lines | `src/core/stages/*-prompt.ts`, `src/core/stages/prompt-parts.ts` |
| Per-stage evidence | `src/cli/optimise-command.ts` |
| The skill | `skills/skillgantry/` |
| Acceptance | `tests/acceptance/m10.test.ts`, `tests/helpers/headless.ts` |

## Deviations found while implementing

- **No independent acceptance job ran.** The plan gave the acceptance gate to a separate e2e identity. Its job failed at launch: the installed GitHub Copilot CLI (1.0.109) rejects `--no-remote`, a flag the handoff script always passes to copilot jobs as a guard against session export. The flag was not stripped. The driver wrote the suite instead, which keeps it independent of the implementing worker, and runs it itself; there is no `verdict.json`.
- **A stale failed gate is re-run, not fixed.** The plan sent every gate not passed on current bytes to `fix`. A failure recorded against other bytes is stale before it is anything else, so `next` names a re-run for it and `fix` only for what the current bytes failed.
- **`next` could dead-end.** The first build left `release-tool-missing` and `manifest-unreadable` as blockers with no entry. Each now has a `command: null` entry, and a test builds every blocker code as the only blocker and asserts `next` is non-empty.
- **Bare `skillgantry repo` exited 0.** commander uses one code for help that was asked for and help shown because a subcommand was missing. They are told apart by the error's own exit code.
- **`stdinIsTTY` is filled in by `main()`, not by the actions.** An in-process caller that injects `startTui` has already decided there is a terminal, and vitest's stdin is not one.
- **An uncommitted corrupt `versions.json` is seen by `status` and not by `release`.** Release reads its sandbox, a worktree at HEAD. `status` reads the live tree and reports the blocker, with the file also listed as dirty. The disagreement is in the safe direction and was left.
- **The bundled skill has no eval suite.** Run through its own gates in a disposable repo, it passed validate and passed security after one confirmed false positive (a scanner reading a list of prohibitions as session persistence) was recorded in its suppression file. `status` then names `evals` as the next step. Writing and running a suite is a billed model call, which this milestone had no go-ahead for, so by SkillGantry's own rule the skill is not release-ready and M10's exit criterion claims validate only.
- **`agent-skill-outdated` is a `ToolDriftKind`**, not a caller-supplied finding like `skillgantry-outdated`. It reads a file and needs no network. §5.5 says so.
- **`CliDeps` gained `userHome`.** Without it the existing doctor CLI tests read the developer's real `~/.claude`.
- **Ink 8 resolves `waitUntilExit` from a write callback.** The test double dropped the callback, so every "did not exit" assertion had been passing whether or not the app quit. Fixed in `tests/helpers/render-ink.tsx`.

## Changelog

- 2026-11-12 — Written.
- 2026-11-13 — Shipped as 1.0.0.
- 2026-11-13 — **The bundled skill sets an installed copy of the skill under test aside before the gates run, and puts it back when the work stops.** Skill text only: `skills/skillgantry/SKILL.md`, no command, no flag, no change to the `status` document.
  - **Why.** The evaluate gate starts an agent on the host, and that agent can load whatever is installed there. On the maintainer's machine `~/.claude/skills/declawed` is a link into a second checkout, not the registered one. An eval could then be scored against bytes the digest does not cover, and a baseline run without the skill would still have it.
  - **What the skill now says.**
    - Pre-flight step 5, before the first `run`: look for `<name>` in `~/.claude/skills`, in the working project's `.claude/skills` and in the skill repo's `.claude/skills`. Move each hit into a `skills_disabled` directory beside the `skills` it was in, and tell the user.
    - Put it back on every exit: released, blocked or abandoned. A new rule under "Rules that always hold" and a line at the end of "Releasing" repeat it.
    - Read-only requests (`status`, `list`) skip the step.
  - **Decisions.**
    - **No new command.** The mechanism is one `mv`. A subcommand would be one more path that writes under the user's home, and it would need its own safety argument. An agent does the same thing in a line.
    - **A real directory that resolves to `skill.dir` is left alone.** `~/.claude/skills` is itself a registered repo for some users; the decision log counts 54 skills there. Moving the entry would take the skill away from SkillGantry. A symlink is always safe to move: the link goes, the target stays.
    - **An existing `skills_disabled/<name>` is never overwritten and never assumed to be ours.** An interrupted session leaves one, and so does a user who disabled the skill on purpose. Only the user can say which.
    - **A symlink goes back as it was.** That is the re-link. When its target is another checkout, the skill says that checkout still holds the old version; updating it is whatever syncs that checkout.
    - **A copy is updated only from a release archive, and only on the user's yes.** `<repoPath>/<name>_<version>.zip` is unpacked at the install path. The old copy is deleted after the new `SKILL.md` is there. Unreleased edits never reach an installed copy. The archive's entries are relative to the skill root (`packageCandidate` zips from inside the materialised tree), so `unzip -d <skills>/<name>` gives the right shape.
  - **Verification.** The set-aside and both put-back paths were rehearsed in a scratch directory: an absolute link, a relative link, and a copy replaced from an archive built the way `packageCandidate` builds one. No evaluate run was compared with and without an installed copy. The contamination is argued from how skill-up runs on the host, and it has not been measured.
  - **Left as is.**
    - No version bump. The text ships with the next release, and until then `doctor` will not call a 1.1.0 copy outdated, because `agent-skill-outdated` compares marker versions only.
    - Requirements and design are unchanged. R3.13 and §5.5 say how the skill is shipped and installed, not what it teaches.
    - A session that dies between the move and the put-back leaves the skill disabled. The next session's pre-flight finds it and asks.
    - `skillgantry` itself is the exception to replacing a copy from an archive. The new copy would have no `.skillgantry-bundled.json`, so a later `skill install` refuses it. For that one skill the right put-back is the old copy moved back, then `skillgantry skill install`.
