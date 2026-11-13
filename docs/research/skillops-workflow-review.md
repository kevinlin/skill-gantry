# SkillOps workflow and UX review

**Date:** 2026-11-12
**Against:** SkillGantry 0.7.0 as installed, a home with three registered repos and 33 skills, and `zapac-agent-skills` as the reference skill repo
**Method:** ran every headless command and the terminal interface against that home; read the three generated prompts as the agent that receives them; read design §9.4, §12 and §15

Short, in bullets. Part 1 is what 1.0.0 changed as a result. Part 2 is what it did not, with what each would take. Part 3 is what 1.1.0 then did with part 2.

## 1. Found and fixed in 1.0.0

- **A failed lookup was a stack trace and exit 1.** `skillgantry fix declawed` failed this way because two repos hold a `declawed`. Exit 1 is also "a stage did not pass", so a script could not tell them apart. Now one `error:` line and exit 2 (R12.13).
- **Nothing headless said where a skill stood.** Gate state, open issues and release readiness were screens. Now `list` and `status` (R12.11, R12.12).
- **`status` says what to do next.** The Work screen shows state and leaves the next move to the reader. An agent needs the move. `next` is ordered and each entry carries its reason.
- **The interface crashed without a terminal.** Ink threw from inside the renderer. Now a one-line refusal naming the headless commands (R12.14).
- **Registering a repo needed the wizard.** Now `repo add` (R12.15).
- **`run` needed `--stage`.** Now defaults to the three gates.
- **The optimise prompt lost evidence.** It read the newest run only. For `agent-insights` the newest run was security alone, so the recorded eval results were missing from the one prompt meant to improve them. Now each stage's latest verdict across runs, marked when it is about older files.
- **Prompts cited `R6.12` and `R6.13`** to a reader who cannot look them up, and gave no reason for the work. The fix prompt said "stop and report" one line above "record the false positive". Reworded (R6.15).
- **No document taught the loop.** Now a bundled skill and `skill install` (R3.13).

## 2. Not done, worth doing

Ordered by how much each would help the daily loop.

### Workflow

- **Stale gates are invisible until release refuses.** Any edit moves the digest, and a suppression is an edit, so accepting one false positive makes all three gates stale. The Work screen rail still shows `passed`. `status` now reports it; the rail should too, with a distinct mark for "passed, but against older files".
- **One fix invalidates every gate.** After a security-only change the user re-runs validate and evaluate too, and evaluate is minutes and money. Worth considering: a gate declares which paths it reads, and a change outside them leaves its verdict current. This is a real design change to R9.9 and needs its own review.
- **No batch run headlessly.** `run` takes one skill. A repo sweep is a shell loop today. `run --repo <id>` through the existing queue would cover it, and CI is the obvious consumer.
- **No headless issue triage.** Acknowledge, wontfix and reopen exist only on the Issues screen. `setIssueState` is already the whole engine; a command is small. Left out because release does not read issue state, so it is not on the path to a release.
- **Release stops before the commit.** By design (R9.7). The user then has a dirty tree with a version bump, a changelog entry and an archive, and no prompt for what comes next. `release` could end by printing the two commands, or the TUI could offer them.
- **`ready` cannot see the three target-dependent checks.** `status --version patch` could run them without releasing. A dry run in everything but name.

### Setup

- **Tool installation is wizard-only.** An agent on a clean machine can go no further than telling the user to run `skillgantry setup`. A `setup --yes --preset <name>` is about 40 lines of sequencing over functions that exist. Left out: it needs the network, minutes, and a credential file that a person should write.
- **The wizard does not offer the bundled skill.** `skill install` exists; the last wizard step is where a new user would expect it.
- **`doctor` takes about 15 seconds** on a healthy machine, because it re-verifies every tool by running it. A `--quick` that checks the lock and the links without invoking anything would make it usable as a preflight.

### Bugs noticed while reading, not fixed here

- **git-skill reinstall drops its own links from the lock.** After a pin bump, `gitSkillInstall` skips any skills directory that already holds the skill, including the ones holding its own link from the previous install. The new lock entry records only links created this time, often none. Verify and uninstall then no longer know about the earlier links. `src/core/tools/git-skill.ts:74-123`; no test covers a reinstall.
- **`detectSkillDirs` probes only the first skill of a bundle** (`:58-70`). A bundle whose first skill is present and whose others are missing is treated as fully installed.
- **`fix` and `optimise` each have a private "newest run" reader** with different error handling (`src/cli/fix-command.ts:37,73`, `src/cli/optimise-command.ts:25,39`). One swallows every error, the other only a missing file.

### Smaller things

- The Work screen's status line says `v0.7.0` but not which home it is reading. With `SG_HOME` set for a test, it is easy to act on the wrong ledger.
- `--help` lists commands alphabetically by registration order with no grouping. Three groups would read better: look (`list`, `status`, `doctor`), act (`run`, `fix`, `evals`, `optimise`, `suppress`), ship (`release`, `retire`, `recover`).
- `~/.skillgantry/backup/` holds five old versions that nothing prunes.

## 3. What 1.1.0 did with part 2

Each item was assessed against the code and a copy of a real home. The reasoning is in [plan_m11-review-follow-ups.md](../specs/plan_m11-review-follow-ups.md).

### Workflow

- **Stale gates on the rail: done, and widened.** The rail also showed only the newest run. A skill whose gates passed in three runs read `· passed ·`. Gate cells now show each stage's latest verdict and mark a stale one `~` (R11.25).
- **One fix invalidates every gate: deferred.** It changes R9.9 and the one-manifest rule of design §4.4. It still needs its own review.
- **Batch run: done.** `run --repo <repoId>` (R12.16).
- **Headless issue triage: done.** `issue <fingerprint> <acknowledge|wontfix|reopen>` (R12.17).
- **Release stops before the commit: done.** A release that applied prints the `git add` and `git commit` for the files it changed (R9.7).
- **`ready` cannot see the target checks: done for two of three.** `status --version` decides the target and the archive. The sandbox stays undecided, because opening one is a write (R12.19).

### Setup

- **Wizard-only installation: done.** `setup --yes --preset <name>`. It never installs a runtime and never writes `.env` (R12.18).
- **The wizard does not offer the bundled skill: done, in its smallest form.** The done step names `skillgantry skill install`.
- **`doctor --quick`: declined.** The checks run concurrently instead, so plain `doctor` is the faster one and `ok` still means the tool ran.

### Bugs

- **git-skill reinstall drops its links: fixed.** Found live: one lock entry recorded one of the two links it owned.
- **`detectSkillDirs` probes the first skill only: fixed** by the same per-skill rule.
- **Private readers in `fix` and `optimise`: merged.** One strict reader; `optimise` keeps its tolerance where it calls it.

### Smaller things

- **The home on the status line: done**, shown when it is not the default.
- **`--help` grouping: done.** Look, act, ship, set up.
- **`backup/` pruning: done.** A snapshot goes when its version's prefix does.
