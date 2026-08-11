# SkillGantry M4.1 Implementation Plan ? SkillHone and the optimise action

**Status:** revision 2, shipped. Written against [design.md](design.md), [design_tui.md](design_tui.md) and [requirements.md](requirements.md) as of shipped M8. The task breakdown is added by `superpowers:writing-plans`; everything above it is settled.

**Goal:** Give the optimise stage something behind it. SkillHone becomes the catalogue's first non-CLI entry ? a bundle of agent skills installed by clone and per-skill symlink, with its Python dependencies isolated in a managed venv. Marking `optimise` on the rail then opens a surface that hands the maintainer a coding-agent prompt built from the skill's recorded evidence. SkillGantry installs and composes; it never runs the loop and never applies its result.

**Architecture:** one new install driver in `src/core/tools/`, one pure prompt builder in `src/core/stages/`, one pane and one `r` branch in `src/tui/`, one views-port read and one subcommand in `src/cli/`. No new source root, no ledger change, no adapter, no stage executor. The optimise stage acquires an *action*, not a run.

**Tech stack:** everything M1?M8 ship. No new dependency. `git` and `uv` are invoked as external commands through the existing `Exec` seam, matching the rule already applied to every other driver.

---

## Global Constraints

Everything in [plan_m1-engine-and-sidecar.md](plan_m1-engine-and-sidecar.md)'s, [plan_m2-queue-and-tui.md](plan_m2-queue-and-tui.md)'s, [plan_m3-tools-module.md](plan_m3-tools-module.md)'s and [plan_m4-adapters-and-merge.md](plan_m4-adapters-and-merge.md)'s Global Constraints still holds. These are the additions.

- Import boundary unchanged: `cli ? tui ? core`, `src/tui/**` reaches core only through `src/core/index.ts`, no `console` or `process.exit` in `src/core/**`.
- `src/core/tools/**` owns fs, network and subprocess, and MUST NOT open the ledger. The new driver is bound by that rule like the other three.
- The new driver takes an injected `Exec`, so the default `pnpm test` run stays offline. A real clone and a real venv live in the `SG_INTEGRATION` suite.
- **The optimise action writes nothing.** The pipeline stays the only writer under `runs/` ? the constraint R11.10 and R12.6 already share. No `optimise-prompt.md` is written anywhere; the prompt is emitted to stdout headless and copied via OSC 52 in the terminal.
- **SkillHone MUST NOT reach `stageTools`.** `AdapterStageExecutor.plan()` throws `unknown tool: <id>` on an id the adapter registry does not hold, which would fail every run of that stage. `stageToolsFor` already filters through the registry; `stage: null` is what keeps the wizard from writing it there.
- No adapter, no `parse`, no rule-class map entry, no `RULE_CLASS_MAP_VERSION` bump. SkillHone reports nothing SkillGantry reads.
- British spelling in identifiers that appear in the specs (`optimise`).
- Conventional Commits, lowercase imperative subject.

## Facts established by reading the repository

Probed 2026-08-09 against `Tencent/SkillHone` at `7d565839fb4dc74f9c77f09ace660e1c0484e048` (branch `main`, committed 2026-08-09). None of the below is an assumption.

**1. SkillHone is not a CLI.** It is a bundle of six agent skills under `skills/` ? `skillhone`, `skillhone-optimization`, `skillhone-evaluation`, `skillhone-prd`, `skillhone-synthesis`, `forgejo` ? each a `SKILL.md` plus `scripts/`, `references/`, `agents/`. No root `pyproject.toml`, no `setup.py`, no tags, no executable that answers a version argv. [plan_m3-tools-module.md](plan_m3-tools-module.md)'s probe verdict was correct *for a CLI tool* and is superseded only in that sense.

**2. Its documented install is itself an agent prompt.** `docs/install/skillhone.md` instructs an AI assistant to detect the runtime skills directory, copy the skill in, and run `pip install`. The runtime table it probes is `~/.claude`, `~/.codex`, `~/.openclaw`, `~/.hermes`, `~/.lighthouse`, `~/.kimi`, in that order.

**3. Upstream says `cp -r`, not `ln -sf`** ? reason given: *"Other skills may already live under `$SKILLS_DIR/` and a symlinked directory would clash with them."* That reason holds for symlinking the parent `skills/` directory and does not hold for a per-skill symlink. This machine has run four per-skill symlinks with no clash.

**4. The scripts crash at import without their dependencies.** `skills/skillhone/assets/requirements.txt` pulls `json5`, `httpx`, `requests`, `GitPython`, `PyYAML`, `tqdm`, `litellm[proxy]==1.94.2`, `claude-agent-sdk` and `anthropic`. Upstream's documented step installs these into the user's **global** interpreter, which R3.1 forbids; upstream explicitly blesses a venv alternative, requiring only that the absolute interpreter path be used for all SkillHone scripts.

**5. `optim.py`, `synth.py` and the eval solver need a `claude` CLI on PATH.** `claude-agent-sdk` shells out to it, so a missing binary does not surface at `pip install` time ? it crashes at first run with `FileNotFoundError: claude`.

**6. Its optimisation loop is eval-repo-driven and lands PRs.** The harness separates a public skill repo, a private eval repo (datasets, verifier, synthesis contract), per-item solver workdirs and an observation surface backed by Forgejo or the local filesystem. The loop diagnoses a probe failure and lands a whole-folder change ? `SKILL.md`, `scripts/`, `references/` ? as one PR gated by a regression eval. SkillGantry models none of that, which is why the handoff is evidence rather than workflow.

**7. Upstream carries an execution notice.** Some workflows use Claude Code bypass mode and local `exec`/subprocess calls, and the README advises running them only in an isolated workspace.

## Spec amendments this milestone carries

All land before the code that depends on them, per the repo rule that a spec proven wrong is corrected in the same branch.

| Doc | Change |
|---|---|
| requirements.md | **R3.1** amended in place: a `git-skill` install may create per-skill symlinks in detected runtime skills directories, recorded in the lock and removed on uninstall. Nothing else lands user-global. Amended in place rather than suffixed, for the reason rev 6 gave when it amended R4.13's table: the rule is what R3.1 owns, and a suffixed id would need its own milestone owner under R13.7. |
| requirements.md | **R3.5** carve-out: a D7 tool published as an agent-skill bundle rather than an installable CLI is catalogued under `git-skill` with `stage: null`. Supersedes rev 5's SkillHone omission, which was a verdict about CLI publication. |
| requirements.md | **R3.8** SkillHone joins Recommended and Everything, not Minimal. |
| requirements.md | **R11.20** amended in place: the rail's refusal becomes conditional on the install rather than unconditional. |
| requirements.md | **new R6.12** the optimise prompt, sibling of R6.10, carrying the same never-applies clause. **new R11.21** the terminal surface. **new R12.8** the headless command, which writes nothing. |
| requirements.md | ? Milestone ownership gains an M4.1 row. |
| design.md | ?5.1a a catalogue kind with no executable ? ?5.2 a fourth driver row and `git-skill`'s three-fact verification ? ?5.3 the presets sentence rewritten and two new doctor conditions ? **new ?9.4a** the optimise prompt |
| design_tui.md | **new ?14.10** the optimise surface: the `r` branch, the batch refusal, the mark-clearing rule, the precedence slot |
| decision-log.md | new entry reinstating SkillHone as a skill bundle, superseding ?10's omission and D7's "both optimise candidates unpublished" |

Revision 2 adds three more:

| Doc | Change |
|---|---|
| requirements.md | **new R3.10** a catalogued tool's own configuration file, composed from `~/.skillgantry/.env`, never overwritten, recorded in the lock, removed on uninstall, reported by doctor. |
| requirements.md | **R7.3** amended in place: one narrow exception for R3.10's file, with the four conditions that keep "SkillGantry writes no credential of its own" true. Amended rather than suffixed for the reason R3.1 was ? the rule is what R7.3 owns. |
| design.md | ?5.1 the lock example gains `links` and `config` ? ?5.3 the doctor-conditions sentence names three more ? **new ?5.4** tool-owned configuration |

[plan_m3-tools-module.md](plan_m3-tools-module.md)'s "Omitted" row stays as written. A deviation record is a point-in-time probe; the decision-log entry is what supersedes it.

## File structure

```
src/
  core/
    index.ts                    MODIFIED  git-skill, optimise-prompt exports
    config/schema.ts            MODIFIED  installKind enum gains 'git-skill'
    tools/
      catalogue.ts              MODIFIED  GitSkillSpec, the skillhone ToolSpec, presets
      git-skill.ts              NEW       detect, clone, link, venv, verify, uninstall
      install.ts                MODIFIED  dispatch over four kinds
      doctor.ts                 MODIFIED  skillhone-deps, claude-cli-missing
      setup.ts                  unchanged  the wizard drives installTool, which dispatches;
                                           stageToolsFor filters by adapter registry, so a
                                           stage:null bundle cannot reach stageTools
    stages/
      optimise-prompt.ts        NEW       buildOptimisePrompt, pure
  tui/
    app.tsx                     MODIFIED  the `r` optimise branch, beginOptimise
    views.ts                    MODIFIED  planOptimise on GantryViews
    components/
      OptimisePane.tsx          NEW       sibling of ReleaseTargetPane
  cli/
    gantry-views.ts             MODIFIED  planOptimise implementation
    optimise-command.ts         NEW       skillgantry optimise <skill> [--json]
    run-command.ts              MODIFIED  the optimise subcommand
tests/
  core/     git-skill.test.ts   optimise-prompt.test.ts
  tui/      optimise-pane.test.tsx
  cli/      optimise-command.test.ts
  acceptance/ m9.test.tsx
docs/specs/ requirements.md  design.md  design_tui.md  decision-log.md  index.md
```

---

## Design decisions

### 1. The catalogue entry

`GitSkillSpec { kind: 'git-skill', repo, pin, skills: string[], requirements }` plus `stage: null`, `runtime: 'uv'`, `versionArgv: []` ? see `src/core/tools/catalogue.ts`.

`stage: null` is the load-bearing field, and vercel `skills` is its precedent: installed, invoked by a native path, selected by no stage. R3.5b binds every stage-selectable entry to an adapter, and an id the registry does not hold fails the whole run at `plan()`.

The pin is a commit sha because upstream publishes no tags. Reproducibility is the same rule every other pin carries, and git's own object hashing is the integrity check, so the lock records `integrity: "n/a"`.

`versionArgv` is empty because nothing in the bundle answers one. That is what forces `git-skill` to verify differently, below.

**The new variant is declared in `catalogue.ts`, not in `adapters/types.ts`.** `ToolSpec.install` widens to `InstallSpec | GitSkillSpec`; `AdapterManifest.install` keeps the three-kind `InstallSpec` it has. An adapter manifest can never legitimately carry `git-skill` ? the tool it describes has no executable to invoke ? and widening the shared union would make that nonsense typecheck, weakening the ?5.1a test that asserts catalogue and manifest agree for every tool holding both.

**`runtime: 'uv'` because the venv needs the managed uv.** `git` is not added to `Runtime`: ?12's sandbox strategies and the provenance reader already assume it unconditionally, so a probe state that could report it missing would be the only place in the system that does. A clone failing on a machine with no git surfaces as an install error naming the command, which is what every other driver does with a missing tool.

### 2. The `git-skill` driver

`src/core/tools/git-skill.ts`, fourth sibling of `uv.ts`, `npm.ts` and `gh-release.ts`, injected `Exec`.

1. **Detect.** Probe upstream's runtime table plus `~/.agents`. **Detection is per directory, not global:** each existing runtime directory where `<dir>/skillhone/SKILL.md` resolves is recorded as already holding SkillHone and is left untouched; the rest are link targets in step 3. A machine with SkillHone in `~/.claude/skills` and an empty `~/.agents/skills` therefore gains links in the second without the first being disturbed. Only when *every* detected directory already holds it does the driver skip straight to step 5.
2. **Clone.** `git clone` into `~/.skillgantry/tools/skillhone/repo`, then `git checkout <pin>`. R3.1 holds ? every byte lands under the tool root.
3. **Link.** One symlink per skill directory into every detected runtime directory. Never the parent `skills/`, which is the only reading of upstream's `cp -r` warning that survives its own stated reason. An existing entry that is not a symlink into our tool root is refused and named, never clobbered.
4. **Venv.** `uv venv <toolRoot>/skillhone/.venv`, then `uv pip install -r <repo>/skills/skillhone/assets/requirements.txt`. Upstream's documented install puts `litellm[proxy]`, GitPython and the Anthropic SDK in the user's global interpreter; R3.1 forbids that and upstream blesses the alternative.
5. **Verify and lock.** Lock records `installKind: 'git-skill'`, venv interpreter as `bin`, `integrity: 'n/a'`, commit sha as `resolvedVersion` ? see `src/core/config/schema.ts`.

`bin` is the venv interpreter. It is a real executable and the one path the prompt actually needs, so the field keeps its meaning instead of being widened to hold nothing.

**Verification is three facts, not a version string.** `verifyTool`'s semver regex rejects a sha, so `git-skill` checks that `git rev-parse HEAD` equals `resolvedVersion`, that every recorded symlink still resolves into the tool root, and that the venv interpreter runs. That is stronger than a version argv, and it is what gives doctor's existing drift kinds meaning here: `missing` is a vanished clone or a dangling symlink, `unverifiable` is an interpreter that will not run, `version-drift` is HEAD moved off the pin, `unlocked` is a tool root with no lock entry.

The `installKind` enum gains `'git-skill'`. The change is additive, so a lock written before this still parses and `toolLockSchema.version` stays at 1.

**Two further doctor conditions**, non-failing, beside `integrity-unverified`: `skillhone-deps` when a requirements import check fails, and `claude-cli-missing` when `command -v claude` finds nothing. Probed and reported, never installed ? R3.7's rule applied to a tool's own runtime dependency rather than to a host runtime.

**Presets.** Recommended and Everything. Not Minimal: a git clone plus a `litellm[proxy]` venv is not what "the two already present" means. Design ?5.3's sentence *"Optimise is that stage: both its candidates are unpublished"* becomes false and is rewritten.

**Uninstall gets an explicit path** ? unlink every recorded symlink, remove the tool directory, drop the lock entry. Symlinks outlive the clone, and a dangling `~/.claude/skills/skillhone` breaks every agent that scans that directory, which is the cost R3.1 exists to avoid.

**Detection cannot tell our install from someone else's.** Step 1 skips when `SKILL.md` resolves at all, so a pre-existing `cp -r` install is left alone and reported as installed but unmanaged: no sha, no version-drift. Clobbering a user's own install is a worse failure than a weaker doctor line.

### 3. The optimise surface

The `r` handler in `src/tui/app.tsx` grows a branch beside release's:

```
wanted.includes('release')  ? refuse if mixed, else beginRelease()
wanted.includes('optimise') ? refuse if mixed, else beginOptimise()
```

Same refusal rule and the same reason ?14.9 gives for release: both resolutions of a mixed mark are a lie about what the marks asked for. Same mark-clearing rule too ? the mark clears whenever the surface closes, applied or cancelled, which is the failure runs `019fe5b6` and `019fe5bb` paid for once.

**It enqueues nothing.** `beginOptimise` calls `views.planOptimise(skillId)`, dispatches, and `OptimisePane` renders the prompt body. `y` copies through the existing `osc52.ts`, `j`/`k` scroll, `esc` closes. There is no `a`, because there is nothing to apply.

**A multi-skill batch is refused and named.** Release applies one target across marked skills; a prompt naming five skills asks for five unrelated optimisation loops in one paste, and SkillHone's loop is per-skill by construction ? one skill repo, one eval repo. One skill, or a refusal that says which.

**Precedence** slots after `ConfirmPane` and before the setup screen. ?14.2 orders the modals by what a keystroke can destroy, and this pane's keys destroy nothing: it builds no job and writes no byte.

**R11.20 is amended, not withdrawn.** `runnable` gains `optimise` only when SkillHone is locked. Not installed, and the mark still flashes `skillhone not installed ? run skillgantry setup`, using the same guard-then-flash shape `y`, `o` and `s` already use. That preserves exactly what R11.20 was written to prevent while ending the case where the column is permanently dead.

### 4. The prompt builder and the headless command

`src/core/stages/optimise-prompt.ts`, beside `fix-prompt.ts`. Pure, owns no I/O, same register. `stages` rather than a new module even though optimise is no longer a stage: this is the second coding-agent prompt composed from run evidence, and one module composing both is what keeps their shared rules ? name the report rather than restate it, omit and count suppressed findings, forbid workspace writes ? from being two divergent copies.

`buildOptimisePrompt(input: OptimisePromptInput): string` where `OptimisePromptInput { skill: SkillRef, lastRun: { runId, runDir, skillDigest, git, stages } | null, evalAssets: string[], install: { interpreter, skillsDir, sha, missing } }` ? see `src/core/stages/optimise-prompt.ts`.

The install argument is plain fields rather than a type imported from `tools`, so the builder adds no ?3 edge ? the property ?9.4 records as the reason `fix-prompt.ts` lives here. `src/cli/gantry-views.ts` reads the lock and does the flattening, which is where the ledger and the process table are already reachable.

The body carries the skill directory, repo root, commit and dirty flag, and digest; the last recorded run's id, per-stage outcomes and actionable findings, with suppressed ones omitted and counted per R6.11 and for its reason ? the one instruction a prompt must never give a coding agent is to fix what the user has already ruled on; **absolute paths to each tool's own report rather than a restatement of it**, which is ?9.4's rule and exists because `RawFinding` is a closed six-field record; the eval assets found under `<skill>/evals/`; the managed interpreter, the SkillHone location and its sha; the handoff to the top-level `skillhone` skill, which dispatches to its own sub-skills; and the constraints ? no write under `*-workspace/` or `.skillgantry-workspace/`, plus upstream's own execution notice. Missing dependencies and a missing `claude` CLI are named inline, before the task, so a prompt is never handed over describing a loop that cannot start.

It reuses `actionableFindings`, `newestRunId` and `stageDirFor`, all already exported.

`GantryViews` gains `planOptimise(skillId)` ? a read that runs before the user has committed to anything, implemented in `src/cli/gantry-views.ts` because `src/tui/**` may not spawn and this needs `git status` plus the lock. `planSuppression` and `planRelease` are the precedent in shape and in reason.

`skillgantry optimise <skill> [--json]` lives in `src/cli/optimise-command.ts`, modelled on `fix-command.ts`. It writes not one byte, and its exit code reports whether a prompt was produced rather than whether the skill passes ? R12.6's meaning, not R12.2's.

### 5. The settings file ? revision 2

Revision 1 installed SkillHone and left it unable to start. Three of its four entry points refuse to run without `~/.skillhone/settings.json`, and the first session with SkillGantry ended in a hand-written one. Design ?5.4 is the contract; what belongs here is why the four seams are where they are.

**The write hangs off the wizard, not off `installTool`.** `SetupDriver` gains `configure(toolId)`, called from `installAll` after the install loop and before the credential dispatch it already makes. `buildSetupDriver` implements it, which its own doc comment already claimed as the place "config, the lockfile, the install drivers and the credential file meet". Inside `installTool` was the alternative and would have needed a declarative field on `ToolSpec` ? a schema for one entry, and `setup-command.ts` passes `installTool` no options today, so the env would have had to be threaded through as well.

**No fifth wizard state.** Composing a file the installer already had every value for is part of installing, and a state of its own would ask the user to walk through a step that decides nothing. It also keeps `SETUP_ORDER`, `canEnter`, `entryBlockedReason` and `Setup.tsx`'s one-entry-per-state `STEPS` map untouched. The outcome is a trailing field on the tool's own install row, beside the existing `failed ?` precedent, so the step still costs exactly the rows ?14.1 allocated it.

**Only what installed gets configured.** `installAll` collects the ids that succeeded rather than re-reading state a stale closure would have; a row saying a tool's config was written under a row reporting that tool as failed is a lie about the same tool, two lines apart.

**Doctor reports three conditions, and that is what makes never-overwriting affordable.** Absent, unmanaged and stale ? the third being the rotated-token case, which is the one a never-overwrite policy would otherwise bury for good. All three sit outside `FAILING`, beside `skillhone-deps`. `DoctorInput` gains `userHome`, defaulted the way `InstallToolOptions.userHome` already is.

**Uninstall removes it, under R3.1's rule for a write outside the tool root.** `gitSkillUninstall` takes the recorded `{ path, sha256 }` and deletes only while the bytes still match ? the preimage recheck ?12.5 gives the suppress writer, here guarding a delete rather than a write, because the file holds the user's API key.

---

## Tasks

### Task 1: The spec amendments every later task builds against

Amended R3.1, R3.5, R3.8 and R11.20 in place; added R6.12, R11.21 and R12.8 with the M4.1 milestone-ownership row. Amended design.md ?5.1a, ?5.2, ?5.3, added ?9.4a. Added design_tui.md ?14.10 and a decision-log entry reinstating SkillHone as a skill bundle, superseding ?10's omission.

### Task 2: The catalogue entry and the widened install union

Added `GitSkillSpec` to `src/core/tools/catalogue.ts` with `ToolSpec.install` widened to `InstallSpec | GitSkillSpec`. Added the `skillhone` entry with `stage: null` and `versionArgv: []`. Widened the lock's `installKind` enum in `src/core/config/schema.ts` to include `'git-skill'`. Added SkillHone to `PRESETS.recommended` and `PRESETS.everything`.

### Task 3: The `git-skill` driver

Created `src/core/tools/git-skill.ts` ? the fourth install driver, taking an injected `Exec`. Detects runtime skill directories per-directory, clones at a pinned sha, creates per-skill symlinks into each detected runtime, and builds a managed venv with `uv`. Verifies by three facts (HEAD matches pin, symlinks resolve, interpreter runs) rather than a version argv, because `verifyTool`'s semver regex rejects a commit sha.

### Task 4: Install dispatch, the lock entry, and doctor's two conditions

Extended `drive()` in `install.ts` with the `git-skill` case, bypassing `verifyTool`'s semver regex ? the driver resolves its own identity (the commit sha) so the regex is bypassed for this kind rather than loosened for every other tool. Added `links` to `ToolLockEntry`. Widened `checkLockedTool` to take the whole entry. Added `skillhone-deps` and `claude-cli-missing` doctor conditions, both non-failing per R3.7's rule extended from host runtimes to a tool's own runtime dependency.

### Task 5: `buildOptimisePrompt`

Created `src/core/stages/optimise-prompt.ts` ? a pure prompt builder beside `fix-prompt.ts`, in `stages` rather than a new module so the two coding-agent prompts share their rules in one place. Names the skill directory, repo root, commit, digest, last run's per-stage outcomes and actionable findings (pointing at each tool's own report per ?9.4 rather than restating it), eval assets, and the managed interpreter. Omits suppressed findings and counts them per R6.11.

### Task 6: `planOptimise` on the views port, and `skillgantry optimise`

Declared `OptimisePreviewView` and `planOptimise` on `GantryViews`. Created `src/cli/optimise-command.ts` with `planOptimiseFor` shared by the port and the subcommand, so the pane and the headless output can never disagree about what was handed over. Registered the `optimise` subcommand in `run-command.ts`. The command writes nothing and its exit code reports whether a prompt was produced (R12.6's meaning, not R12.2's).

### Task 7: The Work-screen surface

Created `src/tui/components/OptimisePane.tsx` and its three-action state slot (`begin-optimise`, `scroll-optimise`, `end-optimise`) in `store.ts`. Wired the `r` branch in `app.tsx` to open the pane instead of enqueuing, with the mixed-mark and multi-skill-batch refusals. Made R11.20's mark refusal conditional on the lock via `optimiseReady: boolean` on `AppProps`. The mark clears whenever the surface closes ? the same fix release carries, for the same two runs that paid for it.

### Task 8: The M4.1 acceptance suite

Created `tests/acceptance/m9.test.tsx` with one named case per exit-criterion clause: install by clone and per-skill symlink with nothing global, uninstall leaving no dangling link, doctor naming a missing `claude` CLI without failing the report, and the headless command printing the prompt and writing not one byte. Extended the `SG_INTEGRATION` matrix with a real clone and venv test asserting the user's global `site-packages` is byte-identical before and after.

---

## Requirement coverage for M4.1

| Requirement | Covered by |
|---|---|
| R3.1 (amended) symlinks recorded and removable | ?2 link and uninstall steps |
| R3.5 (amended) bundle carve-out, `stage: null` | ?1 |
| R3.8 SkillHone in Recommended and Everything | ?2 presets |
| R6.12 (new) the optimise prompt, never applied | ?4 |
| R11.20 (amended) refusal conditional on the install | ?3 |
| R11.21 (new) the terminal surface | ?3 |
| R12.8 (new) the headless command, writes nothing | ?4 |
| R3.10 (new) the tool-owned configuration file | ?5 |
| R7.3 (amended) the one exception, and its four conditions | ?5 |

**Owned elsewhere but shaped here.** R3.2's native install mechanism gains a fourth driver. R3.6's `install-and-verify` state now covers a tool with no version argv. R3.7's probe-and-report rule extends from host runtimes to a tool's own runtime dependency. R3.9's four drift kinds are re-grounded on `git-skill`'s three facts. R6.11's suppression rule is reused verbatim by the new prompt. R11.10 and R12.6's "the pipeline is the only writer under `runs/`" is what makes the prompt file-less.

## Known gaps carried forward

- **SkillHone's loop needs an eval repo SkillGantry has no concept of.** The prompt names `<skill>/evals/` when it exists ? skill-up's M4 convention ? but SkillHone's own eval repo is a different shape: private datasets, a verifier, a synthesis contract. First real use decides whether the evidence handoff is enough or whether a config field for an eval repo is needed.
- **SkillHone writes the user's repo outside ?12.** No sandbox, no diff, no journal, because a pasted coding agent is doing the writing. It is the same handoff R6.10 already makes, and it is self-healing for release: the skill digest moves, so R9.9 forces the gates to re-run before anything can be released.
- **A commit-sha pin goes stale silently.** Upstream ships no tags, so nothing signals a newer sha. Doctor's `version-drift` catches only HEAD moving locally.
- **`~/.agents/skills` is not in upstream's runtime table.** Included because this machine uses it. If it turns out to be host-specific, the cost is one wasted symlink.
- **The venv is heavy.** `litellm[proxy]` and the Anthropic SDK make the first install minutes long and hundreds of megabytes.
- **An unmanaged pre-existing install reports weakly** ? installed, no sha, no drift detection. See ?2.
- **R13.7's mechanical coverage check still does not exist.** Carried since M3; this milestone edits the ownership table by hand like every one before it.

## Deviations found while implementing

- **The M4.1 ownership row claims only the new ids.** The brief listed R3.1, R3.5, R3.8 and R11.20 beside R6.12, R11.21 and R12.8, but those four are owned by M1, M3, M3 and M5, and `tests/specs/traceability.test.ts` fails a requirement claimed twice. Amending a requirement in place does not move its owner ? that is what "amended in place" means ? so the row is `R6.12, R11.21, R12.8`.
- **A sixth catalogue entry broke the wizard's row budget.** `Setup` rendered the whole catalogue and the whole selection unwindowed, so the frame reached 15 rows on a 50?14 terminal ? ?14.1's first rule, failing in `tests/tui/layout.test.tsx`. `setupBodyRows(rows, extras)` in `layout.ts` now decides the budget and both lists window against it with a counted footnote. The wizard had simply never had enough entries to overflow before.
- **`catalogue.test.ts`'s "every entry has a version argv" invariant is now conditional.** A `git-skill` bundle answers no argv by construction, which is the whole reason ?5.2 verifies it by three facts, so asserting one would make the invariant describe a tool rather than a rule.
- **`stageToolsFor` takes an injected `isRunnable`.** The brief's wizard test called it with one argument. It is asserted with the permissive predicate instead, which is the stronger claim: `stage: null` keeps SkillHone out even where the runnable filter would not have caught it.
- **`RawFinding.suppressed` is `{ justification }`, not a boolean.** The brief's prompt fixture used `suppressed: false` / `true`; absent means unsuppressed, so both would have counted as suppressed and the actionable table would have been empty.
- **Link presence is checked with `lstat`, not `stat`.** A dangling symlink still occupies the name, so `symlink()` over it throws `EEXIST`; checking through `stat` would have skipped it and turned a link we could replace into a failed install.
- **`checkLockedTool` takes the whole lock entry.** As the brief predicted, its four scalars could not express the branch ? it needs `installKind` and `links`.
- **`state.flash` is a plain string.** The brief's render branch read `state.flash?.message`.
- **The `SG_INTEGRATION` loop over `CATALOGUE` needed a redirected `userHome`.** `git-skill` is the one kind that writes outside the tool root, and the loop would otherwise have put real symlinks in the machine's own `~/.claude/skills`.
- **`makeCliFixture` did not exist** and was written in Task 6, as the brief allowed for.
- **The R11.20 case in `release-target.test.tsx` was amended, not deleted.** It still proves the mark does not land; what changed is which refusal it names.

## Changelog

- 2026-08-10 ? **Compacted post-implementation.** Removed step-by-step tasks, file-by-file diffs, code snippets, test listings, and verification commands now that the feature has shipped. Preserved Goal, Global Constraints, Facts, Spec Amendments, Design Decisions, File Structure, Requirement Coverage, Known Gaps, and Deviations. Original plan recoverable via git history.
- 2026-08-10 ? revision 2, shipped. `~/.skillhone/settings.json` composed from `~/.skillgantry/.env` when SkillHone installs, at mode 600 inside a 700 directory; an existing file is never overwritten; the path and a digest are recorded in the lock, removed on uninstall while the bytes still match, and reported by doctor as absent, unmanaged or stale. R3.10 added and R7.3 amended in place with one narrow exception, since SkillGantry does not spawn the tool it is configuring and so has no spawn to inject at. Design ?5.4 is the contract; ?5.1 and ?5.3 amended.
- 2026-08-10 ? revision 1, shipped. Eight tasks, `pnpm check` green: 1102 unit tests, 52 acceptance.
- 2026-08-09 ? revision 1, design brief. Written after reading `Tencent/SkillHone` at `7d56583`, its install guide, its requirements file and the `skillhone-optimization` skill. Task breakdown pending `superpowers:writing-plans`.
