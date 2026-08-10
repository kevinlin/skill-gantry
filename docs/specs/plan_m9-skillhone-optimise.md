# SkillGantry M9 Implementation Plan — SkillHone and the optimise action

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Status:** revision 2, shipped. Written against [design.md](design.md), [design_tui.md](design_tui.md) and [requirements.md](requirements.md) as of shipped M8. The task breakdown is added by `superpowers:writing-plans`; everything above it is settled.

**Goal:** Give the optimise stage something behind it. SkillHone becomes the catalogue's first non-CLI entry — a bundle of agent skills installed by clone and per-skill symlink, with its Python dependencies isolated in a managed venv. Marking `optimise` on the rail then opens a surface that hands the maintainer a coding-agent prompt built from the skill's recorded evidence. SkillGantry installs and composes; it never runs the loop and never applies its result.

**Architecture:** one new install driver in `src/core/tools/`, one pure prompt builder in `src/core/stages/`, one pane and one `r` branch in `src/tui/`, one views-port read and one subcommand in `src/cli/`. No new source root, no ledger change, no adapter, no stage executor. The optimise stage acquires an *action*, not a run.

**Tech stack:** everything M1–M8 ship. No new dependency. `git` and `uv` are invoked as external commands through the existing `Exec` seam, matching the rule already applied to every other driver.

---

## Global Constraints

Everything in [plan_m1.md](plan_m1.md)'s, [plan_m2.md](plan_m2.md)'s, [plan_m3.md](plan_m3.md)'s and [plan_m4.md](plan_m4.md)'s Global Constraints still holds. These are the additions.

- Import boundary unchanged: `cli → tui → core`, `src/tui/**` reaches core only through `src/core/index.ts`, no `console` or `process.exit` in `src/core/**`.
- `src/core/tools/**` owns fs, network and subprocess, and MUST NOT open the ledger. The new driver is bound by that rule like the other three.
- The new driver takes an injected `Exec`, so the default `pnpm test` run stays offline. A real clone and a real venv live in the `SG_INTEGRATION` suite.
- **The optimise action writes nothing.** The pipeline stays the only writer under `runs/` — the constraint R11.10 and R12.6 already share. No `optimise-prompt.md` is written anywhere; the prompt is emitted to stdout headless and copied via OSC 52 in the terminal.
- **SkillHone MUST NOT reach `stageTools`.** `AdapterStageExecutor.plan()` throws `unknown tool: <id>` on an id the adapter registry does not hold, which would fail every run of that stage. `stageToolsFor` already filters through the registry; `stage: null` is what keeps the wizard from writing it there.
- No adapter, no `parse`, no rule-class map entry, no `RULE_CLASS_MAP_VERSION` bump. SkillHone reports nothing SkillGantry reads.
- British spelling in identifiers that appear in the specs (`optimise`).
- Conventional Commits, lowercase imperative subject.

## Facts established by reading the repository

Probed 2026-08-09 against `Tencent/SkillHone` at `7d565839fb4dc74f9c77f09ace660e1c0484e048` (branch `main`, committed 2026-08-09). None of the below is an assumption.

**1. SkillHone is not a CLI.** It is a bundle of six agent skills under `skills/` — `skillhone`, `skillhone-optimization`, `skillhone-evaluation`, `skillhone-prd`, `skillhone-synthesis`, `forgejo` — each a `SKILL.md` plus `scripts/`, `references/`, `agents/`. No root `pyproject.toml`, no `setup.py`, no tags, no executable that answers a version argv. [plan_m3.md](plan_m3.md)'s probe verdict was correct *for a CLI tool* and is superseded only in that sense.

**2. Its documented install is itself an agent prompt.** `docs/install/skillhone.md` instructs an AI assistant to detect the runtime skills directory, copy the skill in, and run `pip install`. The runtime table it probes is `~/.claude`, `~/.codex`, `~/.openclaw`, `~/.hermes`, `~/.lighthouse`, `~/.kimi`, in that order.

**3. Upstream says `cp -r`, not `ln -sf`** — reason given: *"Other skills may already live under `$SKILLS_DIR/` and a symlinked directory would clash with them."* That reason holds for symlinking the parent `skills/` directory and does not hold for a per-skill symlink. This machine has run four per-skill symlinks with no clash.

**4. The scripts crash at import without their dependencies.** `skills/skillhone/assets/requirements.txt` pulls `json5`, `httpx`, `requests`, `GitPython`, `PyYAML`, `tqdm`, `litellm[proxy]==1.94.2`, `claude-agent-sdk` and `anthropic`. Upstream's documented step installs these into the user's **global** interpreter, which R3.1 forbids; upstream explicitly blesses a venv alternative, requiring only that the absolute interpreter path be used for all SkillHone scripts.

**5. `optim.py`, `synth.py` and the eval solver need a `claude` CLI on PATH.** `claude-agent-sdk` shells out to it, so a missing binary does not surface at `pip install` time — it crashes at first run with `FileNotFoundError: claude`.

**6. Its optimisation loop is eval-repo-driven and lands PRs.** The harness separates a public skill repo, a private eval repo (datasets, verifier, synthesis contract), per-item solver workdirs and an observation surface backed by Forgejo or the local filesystem. The loop diagnoses a probe failure and lands a whole-folder change — `SKILL.md`, `scripts/`, `references/` — as one PR gated by a regression eval. SkillGantry models none of that, which is why the handoff is evidence rather than workflow.

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
| requirements.md | § Milestone ownership gains an M9 row. |
| design.md | §5.1a a catalogue kind with no executable · §5.2 a fourth driver row and `git-skill`'s three-fact verification · §5.3 the presets sentence rewritten and two new doctor conditions · **new §9.4a** the optimise prompt |
| design_tui.md | **new §14.10** the optimise surface: the `r` branch, the batch refusal, the mark-clearing rule, the precedence slot |
| decision-log.md | new entry reinstating SkillHone as a skill bundle, superseding §10's omission and D7's "both optimise candidates unpublished" |

Revision 2 adds three more:

| Doc | Change |
|---|---|
| requirements.md | **new R3.10** a catalogued tool's own configuration file, composed from `~/.skillgantry/.env`, never overwritten, recorded in the lock, removed on uninstall, reported by doctor. |
| requirements.md | **R7.3** amended in place: one narrow exception for R3.10's file, with the four conditions that keep "SkillGantry writes no credential of its own" true. Amended rather than suffixed for the reason R3.1 was — the rule is what R7.3 owns. |
| design.md | §5.1 the lock example gains `links` and `config` · §5.3 the doctor-conditions sentence names three more · **new §5.4** tool-owned configuration |

[plan_m3.md](plan_m3.md)'s "Omitted" row stays as written. A deviation record is a point-in-time probe; the decision-log entry is what supersedes it.

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

```ts
{
  id: 'skillhone',
  displayName: 'SkillHone (Tencent)',
  stage: null,
  runtime: 'uv',
  install: {
    kind: 'git-skill',
    repo: 'Tencent/SkillHone',
    pin: '7d565839fb4dc74f9c77f09ace660e1c0484e048',
    skills: ['skillhone', 'skillhone-optimization', 'skillhone-evaluation',
             'skillhone-prd', 'skillhone-synthesis', 'forgejo'],
    requirements: 'skills/skillhone/assets/requirements.txt',
  },
  versionArgv: [],
}
```

`stage: null` is the load-bearing field, and vercel `skills` is its precedent: installed, invoked by a native path, selected by no stage. R3.5b binds every stage-selectable entry to an adapter, and an id the registry does not hold fails the whole run at `plan()`.

The pin is a commit sha because upstream publishes no tags. Reproducibility is the same rule every other pin carries, and git's own object hashing is the integrity check, so the lock records `integrity: "n/a"`.

`versionArgv` is empty because nothing in the bundle answers one. That is what forces `git-skill` to verify differently, below.

**The new variant is declared in `catalogue.ts`, not in `adapters/types.ts`.** `ToolSpec.install` widens to `InstallSpec | GitSkillSpec`; `AdapterManifest.install` keeps the three-kind `InstallSpec` it has. An adapter manifest can never legitimately carry `git-skill` — the tool it describes has no executable to invoke — and widening the shared union would make that nonsense typecheck, weakening the §5.1a test that asserts catalogue and manifest agree for every tool holding both.

**`runtime: 'uv'` because the venv needs the managed uv.** `git` is not added to `Runtime`: §12's sandbox strategies and the provenance reader already assume it unconditionally, so a probe state that could report it missing would be the only place in the system that does. A clone failing on a machine with no git surfaces as an install error naming the command, which is what every other driver does with a missing tool.

### 2. The `git-skill` driver

`src/core/tools/git-skill.ts`, fourth sibling of `uv.ts`, `npm.ts` and `gh-release.ts`, injected `Exec`.

1. **Detect.** Probe upstream's runtime table plus `~/.agents`. **Detection is per directory, not global:** each existing runtime directory where `<dir>/skillhone/SKILL.md` resolves is recorded as already holding SkillHone and is left untouched; the rest are link targets in step 3. A machine with SkillHone in `~/.claude/skills` and an empty `~/.agents/skills` therefore gains links in the second without the first being disturbed. Only when *every* detected directory already holds it does the driver skip straight to step 5.
2. **Clone.** `git clone` into `~/.skillgantry/tools/skillhone/repo`, then `git checkout <pin>`. R3.1 holds — every byte lands under the tool root.
3. **Link.** One symlink per skill directory into every detected runtime directory. Never the parent `skills/`, which is the only reading of upstream's `cp -r` warning that survives its own stated reason. An existing entry that is not a symlink into our tool root is refused and named, never clobbered.
4. **Venv.** `uv venv <toolRoot>/skillhone/.venv`, then `uv pip install -r <repo>/skills/skillhone/assets/requirements.txt`. Upstream's documented install puts `litellm[proxy]`, GitPython and the Anthropic SDK in the user's global interpreter; R3.1 forbids that and upstream blesses the alternative.
5. **Verify and lock.**

```jsonc
"skillhone": {
  "installKind": "git-skill",
  "requestedPin": "7d565839fb4dc74f9c77f09ace660e1c0484e048",
  "resolvedVersion": "7d56583",
  "bin": "…/tools/skillhone/.venv/bin/python",
  "integrity": "n/a",
  "installedAt": "…", "verifiedAt": "…"
}
```

`bin` is the venv interpreter. It is a real executable and the one path the prompt actually needs, so the field keeps its meaning instead of being widened to hold nothing.

**Verification is three facts, not a version string.** `verifyTool`'s semver regex rejects a sha, so `git-skill` checks that `git rev-parse HEAD` equals `resolvedVersion`, that every recorded symlink still resolves into the tool root, and that the venv interpreter runs. That is stronger than a version argv, and it is what gives doctor's existing drift kinds meaning here: `missing` is a vanished clone or a dangling symlink, `unverifiable` is an interpreter that will not run, `version-drift` is HEAD moved off the pin, `unlocked` is a tool root with no lock entry.

The `installKind` enum gains `'git-skill'`. The change is additive, so a lock written before this still parses and `toolLockSchema.version` stays at 1.

**Two further doctor conditions**, non-failing, beside `integrity-unverified`: `skillhone-deps` when a requirements import check fails, and `claude-cli-missing` when `command -v claude` finds nothing. Probed and reported, never installed — R3.7's rule applied to a tool's own runtime dependency rather than to a host runtime.

**Presets.** Recommended and Everything. Not Minimal: a git clone plus a `litellm[proxy]` venv is not what "the two already present" means. Design §5.3's sentence *"Optimise is that stage: both its candidates are unpublished"* becomes false and is rewritten.

**Uninstall gets an explicit path** — unlink every recorded symlink, remove the tool directory, drop the lock entry. Symlinks outlive the clone, and a dangling `~/.claude/skills/skillhone` breaks every agent that scans that directory, which is the cost R3.1 exists to avoid.

**Detection cannot tell our install from someone else's.** Step 1 skips when `SKILL.md` resolves at all, so a pre-existing `cp -r` install is left alone and reported as installed but unmanaged: no sha, no version-drift. Clobbering a user's own install is a worse failure than a weaker doctor line.

### 3. The optimise surface

The `r` handler in `src/tui/app.tsx` grows a branch beside release's:

```
wanted.includes('release')  → refuse if mixed, else beginRelease()
wanted.includes('optimise') → refuse if mixed, else beginOptimise()
```

Same refusal rule and the same reason §14.9 gives for release: both resolutions of a mixed mark are a lie about what the marks asked for. Same mark-clearing rule too — the mark clears whenever the surface closes, applied or cancelled, which is the failure runs `019fe5b6` and `019fe5bb` paid for once.

**It enqueues nothing.** `beginOptimise` calls `views.planOptimise(skillId)`, dispatches, and `OptimisePane` renders the prompt body. `y` copies through the existing `osc52.ts`, `j`/`k` scroll, `esc` closes. There is no `a`, because there is nothing to apply.

**A multi-skill batch is refused and named.** Release applies one target across marked skills; a prompt naming five skills asks for five unrelated optimisation loops in one paste, and SkillHone's loop is per-skill by construction — one skill repo, one eval repo. One skill, or a refusal that says which.

**Precedence** slots after `ConfirmPane` and before the setup screen. §14.2 orders the modals by what a keystroke can destroy, and this pane's keys destroy nothing: it builds no job and writes no byte.

**R11.20 is amended, not withdrawn.** `runnable` gains `optimise` only when SkillHone is locked. Not installed, and the mark still flashes `skillhone not installed — run skillgantry setup`, using the same guard-then-flash shape `y`, `o` and `s` already use. That preserves exactly what R11.20 was written to prevent while ending the case where the column is permanently dead.

### 4. The prompt builder and the headless command

`src/core/stages/optimise-prompt.ts`, beside `fix-prompt.ts`. Pure, owns no I/O, same register. `stages` rather than a new module even though optimise is no longer a stage: this is the second coding-agent prompt composed from run evidence, and one module composing both is what keeps their shared rules — name the report rather than restate it, omit and count suppressed findings, forbid workspace writes — from being two divergent copies.

```ts
buildOptimisePrompt(input: {
  skill: SkillRef                 // input.skill, never ctx.skill — §9.4's rule
  lastRun: RecordedRun | null     // null is a valid state, named in the body
  evalAssets: readonly string[]   // existing paths under `<skill>/evals/`, repo-relative
  install: {                      // plain fields, not a `tools` type — see below
    interpreter: string
    skillsDir: string
    sha: string
    missing: readonly string[]    // e.g. ['claude CLI', 'GitPython']
  }
}): string
```

The install argument is plain fields rather than a type imported from `tools`, so the builder adds no §3 edge — the property §9.4 records as the reason `fix-prompt.ts` lives here. `src/cli/gantry-views.ts` reads the lock and does the flattening, which is where the ledger and the process table are already reachable.

The body carries the skill directory, repo root, commit and dirty flag, and digest; the last recorded run's id, per-stage outcomes and actionable findings, with suppressed ones omitted and counted per R6.11 and for its reason — the one instruction a prompt must never give a coding agent is to fix what the user has already ruled on; **absolute paths to each tool's own report rather than a restatement of it**, which is §9.4's rule and exists because `RawFinding` is a closed six-field record; the eval assets found under `<skill>/evals/`; the managed interpreter, the SkillHone location and its sha; the handoff to the top-level `skillhone` skill, which dispatches to its own sub-skills; and the constraints — no write under `*-workspace/` or `.skillgantry-workspace/`, plus upstream's own execution notice. Missing dependencies and a missing `claude` CLI are named inline, before the task, so a prompt is never handed over describing a loop that cannot start.

It reuses `actionableFindings`, `newestRunId` and `stageDirFor`, all already exported.

`GantryViews` gains `planOptimise(skillId)` — a read that runs before the user has committed to anything, implemented in `src/cli/gantry-views.ts` because `src/tui/**` may not spawn and this needs `git status` plus the lock. `planSuppression` and `planRelease` are the precedent in shape and in reason.

`skillgantry optimise <skill> [--json]` lives in `src/cli/optimise-command.ts`, modelled on `fix-command.ts`. It writes not one byte, and its exit code reports whether a prompt was produced rather than whether the skill passes — R12.6's meaning, not R12.2's.

### 5. The settings file — revision 2

Revision 1 installed SkillHone and left it unable to start. Three of its four entry points refuse to run without `~/.skillhone/settings.json`, and the first session with SkillGantry ended in a hand-written one. Design §5.4 is the contract; what belongs here is why the four seams are where they are.

**The write hangs off the wizard, not off `installTool`.** `SetupDriver` gains `configure(toolId)`, called from `installAll` after the install loop and before the credential dispatch it already makes. `buildSetupDriver` implements it, which its own doc comment already claimed as the place "config, the lockfile, the install drivers and the credential file meet". Inside `installTool` was the alternative and would have needed a declarative field on `ToolSpec` — a schema for one entry, and `setup-command.ts` passes `installTool` no options today, so the env would have had to be threaded through as well.

**No fifth wizard state.** Composing a file the installer already had every value for is part of installing, and a state of its own would ask the user to walk through a step that decides nothing. It also keeps `SETUP_ORDER`, `canEnter`, `entryBlockedReason` and `Setup.tsx`'s one-entry-per-state `STEPS` map untouched. The outcome is a trailing field on the tool's own install row, beside the existing `failed —` precedent, so the step still costs exactly the rows §14.1 allocated it.

**Only what installed gets configured.** `installAll` collects the ids that succeeded rather than re-reading state a stale closure would have; a row saying a tool's config was written under a row reporting that tool as failed is a lie about the same tool, two lines apart.

**Doctor reports three conditions, and that is what makes never-overwriting affordable.** Absent, unmanaged and stale — the third being the rotated-token case, which is the one a never-overwrite policy would otherwise bury for good. All three sit outside `FAILING`, beside `skillhone-deps`. `DoctorInput` gains `userHome`, defaulted the way `InstallToolOptions.userHome` already is.

**Uninstall removes it, under R3.1's rule for a write outside the tool root.** `gitSkillUninstall` takes the recorded `{ path, sha256 }` and deletes only while the bytes still match — the preimage recheck §12.5 gives the suppress writer, here guarding a delete rather than a write, because the file holds the user's API key.

---

## Tasks

Eight tasks. Each ends with a green `pnpm vitest run <file>` and one commit. Run `pnpm check` before the final commit of Task 8.

### Task 1: The spec amendments every later task builds against

**Files:**
- Modify: `docs/specs/requirements.md`
- Modify: `docs/specs/design.md` §5.1a, §5.2, §5.3, new §9.4a
- Modify: `docs/specs/design_tui.md` new §14.10
- Modify: `docs/specs/decision-log.md`
- Test: `tests/specs/` (existing suite must stay green)

**Interfaces:**
- Consumes: nothing.
- Produces: requirement ids `R6.12`, `R11.21`, `R12.8`; amended `R3.1`, `R3.5`, `R3.8`, `R11.20`. Later tasks cite these ids in code comments and commit messages.

- [ ] **Step 1: Amend R3.1 in place**

Append to R3.1, after its existing sentence:

```markdown
A `git-skill` install MAY additionally create one symlink per bundled skill directory inside each detected agent-runtime skills directory, provided every such link is recorded in the lockfile and removed when the tool is uninstalled. No other install kind may write outside the tool root. *(rev 20)*
```

- [ ] **Step 2: Amend R3.5, R3.8 and R11.20 in place**

R3.5, append:

```markdown
A D7 tool published as an agent-skill bundle rather than an installable CLI MUST be catalogued under the `git-skill` install kind with `stage: null`, since it has no executable to invoke and no adapter to parse it. *(rev 20: supersedes rev 5's SkillHone omission, which was a verdict about CLI publication and not about the tool.)*
```

R3.8, append: `SkillHone MUST appear in Recommended and Everything, and MUST NOT appear in Minimal.` *(rev 20)*

R11.20, replace its second sentence with:

```markdown
A stage with no selected tool, no native executor and no native action MUST refuse the mark, naming the stage and what is missing. Where a native action exists but its tool is not installed, the refusal MUST name the tool and the command that installs it. *(rev 20)*
```

- [ ] **Step 3: Add R6.12, R11.21, R12.8**

```markdown
- **R6.12** SkillGantry MUST be able to produce a coding-agent optimisation prompt for a skill on demand, naming the skill directory, the repo root, the commit and dirty flag, the skill digest, the most recent recorded run's per-stage outcomes and actionable findings, the absolute path of each tool's own report, the eval assets the skill carries, and the installed optimiser's location, pinned revision and managed interpreter. It MUST omit suppressed findings and name how many it omitted. It MUST forbid any write under a workspace directory. It MUST name any missing dependency before the task. SkillGantry MUST NOT run the optimiser and MUST NOT apply its result. *(rev 20)*
- **R11.21** Marking `optimise` on the lifecycle rail MUST open a surface presenting the R6.12 prompt and MUST NOT enqueue a run. Marking it together with any other stage MUST be refused and named. The mark MUST be cleared whenever the surface closes, whether the prompt was copied or the surface cancelled. A multi-skill batch MUST be refused and named. *(rev 20)*
- **R12.8** The R6.12 prompt MUST be obtainable headlessly for a named skill. The command MUST NOT write to the user's repo or to the sidecar. Its exit code MUST report whether a prompt was produced, not whether the skill passes. *(rev 20)*
```

Add the M9 row to § Milestone ownership:

```markdown
| M9 | R3.1, R3.5, R3.8, R6.12, R11.20, R11.21, R12.8 | A clean machine installs SkillHone by clone, per-skill symlink and a managed venv, with nothing landing in the user's global interpreter; doctor reports its three-fact verification and names a missing `claude` CLI without installing it; uninstall leaves no dangling link; marking `optimise` opens a surface that presents a prompt built from the last recorded run and enqueues nothing, refuses a mixed mark and a multi-skill batch by name, and clears its mark on cancel; `skillgantry optimise` prints the same prompt without writing a byte |
```

- [ ] **Step 4: Amend design.md**

§5.1a — append a paragraph stating that a catalogue entry need not have an executable, that `git-skill` is that case, and that `ToolSpec.install` widens to `InstallSpec | GitSkillSpec` while `AdapterManifest.install` keeps the three-kind union.

§5.2 — add the fourth driver row to the table:

```markdown
| `git-skill` | `git clone` into `<toolRoot>/<id>/repo` then `git checkout <pin>`; one symlink per bundled skill directory into each detected runtime skills directory; `uv venv` plus `uv pip install -r <requirements>` into `<toolRoot>/<id>/.venv` | the venv interpreter at `<toolRoot>/<id>/.venv/bin/python` |
```

Then a paragraph: verification is three facts rather than a version argv — `git rev-parse HEAD` equals `resolvedVersion`, every recorded symlink resolves into the tool root, and the interpreter runs — because `verifyTool`'s semver regex rejects a commit sha and nothing in a skill bundle answers a version argv.

§5.3 — replace *"Optimise is that stage: both its candidates are unpublished."* with a sentence naming SkillHone as optimise's member of Recommended and Everything, absent from Minimal because a clone plus a `litellm[proxy]` venv is not what "the two already present" means. Add `skillhone-deps` and `claude-cli-missing` to the non-failing doctor conditions.

New §9.4a — the optimise prompt: its trigger is a user action rather than a run, it writes no file because the pipeline is the only writer under `runs/`, it is built from `input.skill` for §9.4's reason, and it reuses R6.11's suppression rule verbatim.

- [ ] **Step 5: Amend design_tui.md and decision-log.md**

New §14.10 in `design_tui.md`, covering: the `r` branch beside release's, the mixed-mark and batch refusals, the mark-clearing rule and the two runs that motivated it, the precedence slot after `ConfirmPane`, and R11.20's guard becoming conditional on the lock.

New entry in `decision-log.md` reinstating SkillHone as a skill bundle, superseding §10's omission and D7's "both optimise candidates unpublished".

- [ ] **Step 6: Verify the spec suite still passes**

Run: `pnpm vitest run tests/specs`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add docs/specs
git commit -m "docs(specs): amend R3.1, R3.5, R3.8 and R11.20 for a bundled optimiser

Add R6.12, R11.21 and R12.8, design.md §9.4a and design_tui.md §14.10."
```

---

### Task 2: The catalogue entry and the widened install union

**Files:**
- Modify: `src/core/tools/catalogue.ts`
- Modify: `src/core/config/schema.ts:31`
- Test: `tests/core/catalogue.test.ts`

**Interfaces:**
- Consumes: `ToolSpec`, `PRESETS`, `RELEASE_TOOL_ID` from Task 1's unchanged code.
- Produces:

```ts
export interface GitSkillSpec {
  kind: 'git-skill'
  /** `owner/name`, cloned over https. */
  repo: string
  /** A commit sha — upstream publishes no tags. */
  pin: string
  /** Directory names under the repo's `skills/`, each symlinked individually. */
  skills: readonly string[]
  /** Repo-relative path to the pip requirements file. */
  requirements: string
}
export const SKILLHONE_TOOL_ID = 'skillhone'
```

and `ToolSpec.install: InstallSpec | GitSkillSpec`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/catalogue.test.ts — append to the existing describe block
import { PRESETS, SKILLHONE_TOOL_ID, catalogueEntry } from '../../src/core/tools/catalogue.js'

describe('the skillhone entry', () => {
  it('is installable but selectable by no stage', () => {
    const spec = catalogueEntry(SKILLHONE_TOOL_ID)
    expect(spec?.install.kind).toBe('git-skill')
    // R3.5b: an id the adapter registry does not hold fails every run of the
    // stage that selects it, so a bundle with no parser must reach no stage.
    expect(spec?.stage).toBeNull()
    expect(spec?.versionArgv).toEqual([])
  })

  it('pins a commit sha, because upstream publishes no tags', () => {
    const spec = catalogueEntry(SKILLHONE_TOOL_ID)
    if (spec?.install.kind !== 'git-skill') throw new Error('wrong kind')
    expect(spec.install.pin).toMatch(/^[0-9a-f]{40}$/)
    expect(spec.install.skills).toContain('skillhone-optimization')
    expect(spec.install.requirements).toBe('skills/skillhone/assets/requirements.txt')
  })

  it('joins Recommended and Everything but not Minimal', () => {
    expect(PRESETS.minimal).not.toContain(SKILLHONE_TOOL_ID)
    expect(PRESETS.recommended).toContain(SKILLHONE_TOOL_ID)
    expect(PRESETS.everything).toContain(SKILLHONE_TOOL_ID)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/core/catalogue.test.ts`
Expected: FAIL — `catalogueEntry` returns `undefined`, and `SKILLHONE_TOOL_ID` is not exported.

- [ ] **Step 3: Add the union member and the entry**

In `src/core/tools/catalogue.ts`, above `ToolSpec`:

```ts
/**
 * A tool published as a bundle of agent skills rather than an executable. It is
 * declared here and not in `adapters/types.ts` because an adapter manifest can
 * never legitimately carry it — the tool it would describe has no executable to
 * invoke — and widening the shared union would make that nonsense typecheck,
 * weakening the §5.1a test that asserts catalogue and manifest agree.
 */
export interface GitSkillSpec {
  kind: 'git-skill'
  repo: string
  pin: string
  skills: readonly string[]
  requirements: string
}
```

Change `ToolSpec.install` to `InstallSpec | GitSkillSpec`, then append to `CATALOGUE`:

```ts
  {
    id: SKILLHONE_TOOL_ID,
    displayName: 'SkillHone (Tencent)',
    // The venv is built with the managed uv. `git` is not a declared runtime:
    // §12's sandbox strategies already assume it unconditionally, so a probe
    // state that could report it missing would be the only one in the system.
    runtime: 'uv',
    stage: null,
    install: {
      kind: 'git-skill',
      repo: 'Tencent/SkillHone',
      pin: '7d565839fb4dc74f9c77f09ace660e1c0484e048',
      skills: [
        'skillhone',
        'skillhone-optimization',
        'skillhone-evaluation',
        'skillhone-prd',
        'skillhone-synthesis',
        'forgejo',
      ],
      requirements: 'skills/skillhone/assets/requirements.txt',
    },
    // Nothing in a skill bundle answers a version argv, which is what forces
    // `git-skill` to verify by three facts instead — design §5.2.
    versionArgv: [],
  },
```

with `export const SKILLHONE_TOOL_ID = 'skillhone'` beside `RELEASE_TOOL_ID`, and `SKILLHONE_TOOL_ID` added to `PRESETS.recommended`.

Rewrite the `PRESETS` doc comment's line *"Optimise has no member: both of D7's optimise candidates are unpublished."* to:

```
 * Optimise's member is SkillHone, which is published as a skill bundle rather
 * than a CLI — R3.5 as amended. Minimal omits it: a clone plus a litellm[proxy]
 * venv is not what "the two already present" means.
```

- [ ] **Step 4: Widen the lock enum**

`src/core/config/schema.ts:31`:

```ts
  // Additive: a lock written before `git-skill` existed still parses, so
  // `toolLockSchema.version` stays at 1.
  installKind: z.enum(['uv-tool', 'npm-prefix', 'gh-release', 'git-skill']),
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/core/catalogue.test.ts && pnpm build`
Expected: PASS, and `tsc` reports the `drive()` switch in `install.ts` is now non-exhaustive — Task 4 closes it. If `tsc` is clean, the union was widened in the wrong place.

- [ ] **Step 6: Commit**

```bash
git add src/core/tools/catalogue.ts src/core/config/schema.ts tests/core/catalogue.test.ts
git commit -m "feat(tools): catalogue SkillHone as a git-skill bundle

R3.5 as amended: a tool published as agent skills rather than a CLI is
catalogued with stage null, since it has no executable and no adapter."
```

---

### Task 3: The `git-skill` driver

**Files:**
- Create: `src/core/tools/git-skill.ts`
- Test: `tests/core/git-skill.test.ts`

**Interfaces:**
- Consumes: `GitSkillSpec` and `SKILLHONE_TOOL_ID` from Task 2; `Exec` from `src/core/tools/exec.ts`.
- Produces:

```ts
export const RUNTIME_SKILL_DIRS: readonly string[]   // ['.claude', '.codex', '.openclaw', '.hermes', '.lighthouse', '.kimi', '.agents']
export interface GitSkillInstall { bin: string; links: string[]; sha: string }
export function detectSkillDirs(home: string, spec: GitSkillSpec): Promise<{ dir: string; holds: boolean }[]>
export function gitSkillInstall(dir: string, spec: GitSkillSpec & { id: string }, exec: Exec, userHome: string): Promise<GitSkillInstall>
export function verifyGitSkill(dir: string, links: readonly string[], sha: string, exec: Exec): Promise<string>
export function gitSkillUninstall(dir: string, links: readonly string[]): Promise<void>
```

`links` are absolute paths of the symlinks created, recorded so uninstall can remove exactly what was made.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/git-skill.test.ts
import { mkdir, mkdtemp, readlink, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Exec } from '../../src/core/tools/exec.js'
import {
  detectSkillDirs,
  gitSkillInstall,
  gitSkillUninstall,
  verifyGitSkill,
} from '../../src/core/tools/git-skill.js'
import type { GitSkillSpec } from '../../src/core/tools/catalogue.js'

const SPEC: GitSkillSpec & { id: string } = {
  id: 'skillhone',
  kind: 'git-skill',
  repo: 'Tencent/SkillHone',
  pin: 'a'.repeat(40),
  skills: ['skillhone', 'skillhone-optimization'],
  requirements: 'skills/skillhone/assets/requirements.txt',
}

/** Records argv and stands in for git and uv; materialises what a clone would. */
const fakeExec = (repoDir: string, calls: string[][]): Exec => {
  return async (bin, argv) => {
    calls.push([bin, ...argv])
    if (bin === 'git' && argv[0] === 'clone') {
      for (const name of SPEC.skills) await mkdir(join(repoDir, 'skills', name), { recursive: true })
      await mkdir(join(repoDir, 'skills', 'skillhone', 'assets'), { recursive: true })
      await writeFile(join(repoDir, 'skills', 'skillhone', 'assets', 'requirements.txt'), 'PyYAML\n')
      for (const name of SPEC.skills) {
        await writeFile(join(repoDir, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`)
      }
    }
    if (bin === 'git' && argv.includes('rev-parse')) return { stdout: `${SPEC.pin}\n`, stderr: '' }
    return { stdout: '', stderr: '' }
  }
}

describe('detectSkillDirs', () => {
  it('reports per directory, so one holding the bundle does not skip the others', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    await mkdir(join(home, '.claude', 'skills', 'skillhone'), { recursive: true })
    await writeFile(join(home, '.claude', 'skills', 'skillhone', 'SKILL.md'), '---\n---\n')
    await mkdir(join(home, '.agents', 'skills'), { recursive: true })

    const found = await detectSkillDirs(home, SPEC)

    expect(found).toEqual([
      { dir: join(home, '.claude', 'skills'), holds: true },
      { dir: join(home, '.agents', 'skills'), holds: false },
    ])
  })
})

describe('gitSkillInstall', () => {
  it('clones at the pin, links each skill, and builds the venv under the tool root', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    await mkdir(join(home, '.agents', 'skills'), { recursive: true })
    const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))
    const calls: string[][] = []

    const out = await gitSkillInstall(dir, SPEC, fakeExec(join(dir, 'repo'), calls), home)

    expect(calls[0]).toEqual([
      'git',
      'clone',
      'https://github.com/Tencent/SkillHone.git',
      join(dir, 'repo'),
    ])
    expect(calls[1]).toEqual(['git', '-C', join(dir, 'repo'), 'checkout', SPEC.pin])
    // R3.1: uv builds the venv under the tool root, never the user's global
    // interpreter — upstream's own install does the latter.
    expect(calls).toContainEqual(['uv', 'venv', join(dir, '.venv')])
    expect(out.bin).toBe(join(dir, '.venv', 'bin', 'python'))
    expect(out.sha).toBe(SPEC.pin)

    const link = join(home, '.agents', 'skills', 'skillhone-optimization')
    expect(out.links).toContain(link)
    expect(await readlink(link)).toBe(join(dir, 'repo', 'skills', 'skillhone-optimization'))
  })

  it('refuses an existing entry that is not our symlink, rather than clobbering it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    await mkdir(join(home, '.agents', 'skills', 'skillhone-optimization'), { recursive: true })
    const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))

    await expect(gitSkillInstall(dir, SPEC, fakeExec(join(dir, 'repo'), []), home)).rejects.toThrow(
      /skillhone-optimization already exists/,
    )
  })
})

describe('verifyGitSkill', () => {
  it('fails when a recorded link has gone dangling', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))
    await mkdir(join(home, 'skills'), { recursive: true })
    const link = join(home, 'skills', 'skillhone')
    await symlink(join(dir, 'repo', 'skills', 'skillhone'), link)

    const exec: Exec = async () => ({ stdout: `${SPEC.pin}\n`, stderr: '' })

    await expect(verifyGitSkill(dir, [link], SPEC.pin, exec)).rejects.toThrow(/does not resolve/)
  })

  it('fails when HEAD has moved off the pin', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))
    const exec: Exec = async () => ({ stdout: `${'b'.repeat(40)}\n`, stderr: '' })

    await expect(verifyGitSkill(dir, [], SPEC.pin, exec)).rejects.toThrow(/HEAD is/)
  })
})

describe('gitSkillUninstall', () => {
  it('removes every recorded link, because a dangling one breaks every agent scanning that directory', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
    const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))
    await mkdir(join(home, 'skills'), { recursive: true })
    const link = join(home, 'skills', 'skillhone')
    await symlink(join(dir, 'repo', 'skills', 'skillhone'), link)

    await gitSkillUninstall(dir, [link])

    await expect(readlink(link)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/core/git-skill.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/tools/git-skill.js'`.

- [ ] **Step 3: Write the driver**

```ts
// src/core/tools/git-skill.ts
import { lstat, mkdir, readlink, rm, stat, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { GitSkillSpec } from './catalogue.js'
import type { Exec } from './exec.js'

/**
 * Upstream's documented runtime table, plus `.agents` which this project's
 * reference machine uses. Probed in order; every existing one is a link target,
 * because a maintainer running two runtimes wants the bundle in both.
 */
export const RUNTIME_SKILL_DIRS: readonly string[] = [
  '.claude',
  '.codex',
  '.openclaw',
  '.hermes',
  '.lighthouse',
  '.kimi',
  '.agents',
]

export interface GitSkillInstall {
  bin: string
  links: string[]
  sha: string
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Per directory, not global: a machine holding the bundle in `~/.claude/skills`
 * and nothing in `~/.agents/skills` needs links in the second without the first
 * being touched. Answering this globally is what would leave one runtime short.
 */
export async function detectSkillDirs(
  home: string,
  spec: GitSkillSpec,
): Promise<{ dir: string; holds: boolean }[]> {
  const found: { dir: string; holds: boolean }[] = []
  const probe = spec.skills[0] ?? 'skillhone'
  for (const runtime of RUNTIME_SKILL_DIRS) {
    const dir = join(home, runtime, 'skills')
    if (!(await exists(dir))) continue
    found.push({ dir, holds: await exists(join(dir, probe, 'SKILL.md')) })
  }
  return found
}

const repoUrl = (repo: string): string => `https://github.com/${repo}.git`

export async function gitSkillInstall(
  dir: string,
  spec: GitSkillSpec & { id: string },
  exec: Exec,
  userHome: string,
): Promise<GitSkillInstall> {
  const repoDir = join(dir, 'repo')
  const venv = join(dir, '.venv')
  const interpreter = join(venv, 'bin', 'python')

  const targets = await detectSkillDirs(userHome, spec)
  // Refused before the clone: a dozen megabytes fetched and then rejected is a
  // worse first run than a refusal that costs nothing.
  for (const target of targets.filter((entry) => !entry.holds)) {
    for (const name of spec.skills) {
      const link = join(target.dir, name)
      if (!(await exists(link))) continue
      let current: string | null = null
      try {
        current = (await lstat(link)).isSymbolicLink() ? await readlink(link) : null
      } catch {
        current = null
      }
      if (current === null || !current.startsWith(dir)) {
        throw new Error(`${link} already exists and is not managed by SkillGantry`)
      }
    }
  }

  if (!(await exists(repoDir))) {
    await mkdir(dir, { recursive: true })
    await exec('git', ['clone', repoUrl(spec.repo), repoDir])
  }
  await exec('git', ['-C', repoDir, 'checkout', spec.pin])
  const head = await exec('git', ['-C', repoDir, 'rev-parse', 'HEAD'])
  const sha = head.stdout.trim()

  const links: string[] = []
  for (const target of targets.filter((entry) => !entry.holds)) {
    for (const name of spec.skills) {
      const link = join(target.dir, name)
      // Per skill directory, never the parent `skills/`. Upstream advises
      // `cp -r`, and the reason it gives — other skills already live in the
      // directory — is an argument against linking the parent, not a member.
      if (await exists(link)) await unlink(link)
      await symlink(join(repoDir, 'skills', name), link)
      links.push(link)
    }
  }

  await exec('uv', ['venv', venv])
  await exec('uv', [
    'pip',
    'install',
    '--python',
    interpreter,
    '-r',
    join(repoDir, spec.requirements),
  ])

  return { bin: interpreter, links, sha }
}

/**
 * Three facts, because nothing in the bundle answers a version argv and
 * `verifyTool`'s semver regex rejects a commit sha. Returns the sha, which is
 * what the lock records as `resolvedVersion`.
 */
export async function verifyGitSkill(
  dir: string,
  links: readonly string[],
  sha: string,
  exec: Exec,
): Promise<string> {
  const repoDir = join(dir, 'repo')
  const head = (await exec('git', ['-C', repoDir, 'rev-parse', 'HEAD'])).stdout.trim()
  if (head !== sha) throw new Error(`${repoDir} HEAD is ${head}, locked ${sha}`)
  for (const link of links) {
    if (!(await exists(link))) throw new Error(`${link} does not resolve`)
  }
  await exec(join(dir, '.venv', 'bin', 'python'), ['--version'])
  return sha
}

/**
 * Links outlive the clone, and a dangling `~/.claude/skills/skillhone` breaks
 * every agent that scans that directory — the cost R3.1 exists to avoid, so
 * removal is an explicit path rather than a consequence of deleting the tree.
 */
export async function gitSkillUninstall(dir: string, links: readonly string[]): Promise<void> {
  for (const link of links) {
    try {
      await unlink(link)
    } catch {
      // Already gone is the outcome asked for.
    }
  }
  await rm(dir, { recursive: true, force: true })
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/core/git-skill.test.ts`
Expected: PASS, six cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/tools/git-skill.ts tests/core/git-skill.test.ts
git commit -m "feat(tools): add the git-skill install driver

Clone at a pinned sha under the tool root, symlink each bundled skill
into every detected runtime skills directory, and build the venv with
the managed uv rather than the user's global interpreter (R3.1)."
```

---

### Task 4: Install dispatch, the lock entry, and doctor's two conditions

**Files:**
- Modify: `src/core/tools/install.ts`
- Modify: `src/core/tools/doctor.ts`
- Modify: `src/core/index.ts`
- Test: `tests/core/install-dispatch.test.ts`, `tests/core/doctor.test.ts`

**Interfaces:**
- Consumes: `gitSkillInstall`, `verifyGitSkill`, `GitSkillInstall` from Task 3.
- Produces: `ToolLockEntry.links?: readonly string[]` on the lock schema; `ToolDriftKind` gains `'skillhone-deps' | 'claude-cli-missing'`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/install-dispatch.test.ts — append
it('locks a git-skill install by its sha and records its links', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
  await mkdir(join(home, '.agents', 'skills'), { recursive: true })
  const sha = 'c'.repeat(40)
  const exec: Exec = async (bin, argv) => {
    if (bin === 'git' && argv[0] === 'clone') {
      const repoDir = argv[2] as string
      await mkdir(join(repoDir, 'skills', 'skillhone'), { recursive: true })
      await writeFile(join(repoDir, 'skills', 'skillhone', 'SKILL.md'), '---\n---\n')
    }
    if (argv.includes('rev-parse')) return { stdout: `${sha}\n`, stderr: '' }
    return { stdout: '', stderr: '' }
  }

  const entry = await installTool(
    home,
    {
      id: 'skillhone',
      displayName: 'SkillHone',
      stage: null,
      runtime: 'uv',
      install: {
        kind: 'git-skill',
        repo: 'Tencent/SkillHone',
        pin: sha,
        skills: ['skillhone'],
        requirements: 'skills/skillhone/assets/requirements.txt',
      },
      versionArgv: [],
    },
    { exec },
  )

  expect(entry.installKind).toBe('git-skill')
  // The sha, not a semver: `verifyTool` is bypassed entirely for this kind.
  expect(entry.resolvedVersion).toBe(sha)
  expect(entry.bin).toBe(join(toolRoot(home), 'skillhone', '.venv', 'bin', 'python'))
  expect(entry.integrity).toBe('n/a')
  expect(entry.links).toEqual([join(home, '.agents', 'skills', 'skillhone')])
})
```

```ts
// tests/core/doctor.test.ts — append
it('names a missing claude CLI without offering to install it', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
  await seedGitSkillLock(home) // helper written in Step 3 of this task
  const exec: Exec = async (bin) => {
    if (bin === 'command' || bin === 'which') throw new Error('not found')
    return { stdout: '', stderr: '' }
  }

  const report = await doctor({
    home,
    skills: [],
    ledgerLifecycle: new Map(),
    ruleMap: { applied: 1, current: 1 },
    exec,
  })

  const finding = report.tools.find((row) => row.kind === 'claude-cli-missing')
  expect(finding?.detail).toContain('npm install -g @anthropic-ai/claude-code')
  // R3.7's rule, applied to a tool's own runtime dependency: reported, never
  // installed, and never a reason the report fails.
  expect(report.failed).toBe(false)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/core/install-dispatch.test.ts tests/core/doctor.test.ts`
Expected: FAIL — `drive()` has no `git-skill` case, and `claude-cli-missing` is not a `ToolDriftKind`.

- [ ] **Step 3: Add the lock field and the dispatch branch**

`src/core/config/schema.ts`, inside `toolLockEntrySchema`:

```ts
  /** Absolute symlink paths a `git-skill` install created, so uninstall removes exactly them. */
  links: z.array(z.string()).optional(),
```

`src/core/tools/install.ts` — `drive()` returns the links and sha too, so `installTool` can skip `verifyTool`:

```ts
async function drive(
  dir: string,
  spec: ToolSpec,
  options: InstallToolOptions,
): Promise<{ bin: string; integrity: string; links?: string[]; resolvedVersion?: string }> {
  switch (spec.install.kind) {
    // …existing three cases unchanged…
    case 'git-skill': {
      // git's own object hashing is the integrity check, so there is nothing
      // for us to re-verify — the same reasoning `uv-tool` records.
      const out = await gitSkillInstall(
        dir,
        { id: spec.id, ...spec.install },
        options.exec ?? defaultExec,
        options.userHome ?? homedir(),
      )
      return { integrity: 'n/a', bin: out.bin, links: out.links, resolvedVersion: out.sha }
    }
  }
}
```

and in `installTool`:

```ts
  const { bin, integrity, links, resolvedVersion: driven } = await drive(dir, spec, options)
  const installedAt = new Date().toISOString()

  // A skill bundle has no executable that answers a version argv, so the driver
  // resolves its own identity — the commit sha — and `verifyTool`'s semver
  // regex is bypassed rather than loosened for every other tool.
  const resolvedVersion = driven ?? (await verifyTool({ bin }, spec.versionArgv))

  const entry: ToolLockEntry = {
    installKind: spec.install.kind,
    requestedPin: spec.install.pin,
    resolvedVersion,
    bin,
    integrity,
    ...(links ? { links } : {}),
    installedAt,
    verifiedAt: new Date().toISOString(),
  }
```

Add `userHome?: string` to `InstallToolOptions`, defaulting to `homedir()`, so tests point the link targets at a temp home.

- [ ] **Step 4: Add doctor's branch and two conditions**

In `src/core/tools/doctor.ts`, extend `ToolDriftKind` with `'skillhone-deps' | 'claude-cli-missing'` — neither added to `FAILING`.

`checkLockedTool`'s four scalar parameters cannot express this branch, which needs `installKind` and `links`, so widen it to take the whole entry plus what it cannot derive:

```ts
async function checkLockedTool(
  toolId: string,
  entry: ToolLockEntry,
  home: string,
  exec: Exec,
): Promise<Pick<ToolFinding, 'kind' | 'actualVersion' | 'detail'>> {
  if (entry.installKind === 'git-skill') {
    try {
      const sha = await verifyGitSkill(
        join(toolRoot(home), toolId),
        entry.links ?? [],
        entry.resolvedVersion,
        exec,
      )
      return { kind: 'ok', actualVersion: sha, detail: '' }
    } catch (err) {
      const message = (err as Error).message
      // A moved HEAD is drift the user can reconcile; a dangling link or a dead
      // interpreter is a bundle that cannot be used at all.
      if (message.includes('HEAD is')) {
        return { kind: 'version-drift', actualVersion: null, detail: message }
      }
      return {
        kind: message.includes('does not resolve') ? 'missing' : 'unverifiable',
        actualVersion: null,
        detail: message,
      }
    }
  }
  // …the existing body, reading entry.bin, entry.resolvedVersion, entry.integrity…
}
```

and update its one call site in `doctor()`:

```ts
    const checked = await checkLockedTool(toolId, entry, input.home, input.exec ?? defaultExec)
```

Then, after the lock loop in `doctor()`, one probe per condition:

```ts
  const bundle = lock.tools[SKILLHONE_TOOL_ID]
  if (bundle) {
    // R3.7's rule extended from host runtimes to a tool's own runtime
    // dependency: probed and named, never installed, never failing the report.
    try {
      await (input.exec ?? defaultExec)(bundle.bin, ['-c', 'import git, yaml, litellm'])
    } catch {
      tools.push({
        toolId: SKILLHONE_TOOL_ID,
        kind: 'skillhone-deps',
        expectedVersion: null,
        actualVersion: null,
        detail: 're-run `skillgantry setup` to rebuild the managed venv',
      })
    }
    try {
      await (input.exec ?? defaultExec)('command', ['-v', 'claude'])
    } catch {
      tools.push({
        toolId: SKILLHONE_TOOL_ID,
        kind: 'claude-cli-missing',
        expectedVersion: null,
        actualVersion: null,
        detail:
          'claude-agent-sdk shells out to it, so optim.py fails at first run — ' +
          'npm install -g @anthropic-ai/claude-code',
      })
    }
  }
```

- [ ] **Step 5a: Export the new surface**

`src/core/index.ts`, beside the existing tools exports:

```ts
export {
  RUNTIME_SKILL_DIRS,
  detectSkillDirs,
  gitSkillUninstall,
  type GitSkillInstall,
} from './tools/git-skill.js'
export { SKILLHONE_TOOL_ID, type GitSkillSpec } from './tools/catalogue.js'
```

- [ ] **Step 6: Prove the wizard needs no change**

Add one case to `tests/core/setup.test.ts`:

```ts
it('offers SkillHone for install but never writes it into stageTools', () => {
  const selected = expandPreset('recommended').map((spec) => spec.id)
  expect(selected).toContain(SKILLHONE_TOOL_ID)
  // `AdapterStageExecutor.plan()` throws `unknown tool: <id>` on an id the
  // registry does not hold, which fails every run of that stage. `stage: null`
  // plus stageToolsFor's registry filter is what keeps it out.
  const stageTools = stageToolsFor(selected)
  expect(Object.values(stageTools).flat()).not.toContain(SKILLHONE_TOOL_ID)
})
```

If this fails, `setup.ts` does need a change and the file-structure note above is wrong — fix the note and the code together.

- [ ] **Step 7: Run the tests**

Run: `pnpm vitest run tests/core && pnpm build`
Expected: PASS, `tsc` clean — the non-exhaustive switch from Task 2 is now closed.

- [ ] **Step 7: Commit**

```bash
git add src/core/tools src/core/config/schema.ts src/core/index.ts tests/core
git commit -m "feat(tools): dispatch and verify git-skill installs

The driver resolves its own identity, so verifyTool's semver regex is
bypassed for this kind rather than loosened for every other tool. Doctor
gains skillhone-deps and claude-cli-missing, both non-failing."
```

---

### Task 5: `buildOptimisePrompt`

**Files:**
- Create: `src/core/stages/optimise-prompt.ts`
- Modify: `src/core/index.ts`
- Test: `tests/core/optimise-prompt.test.ts`

**Interfaces:**
- Consumes: `SkillRef` from `src/core/types.ts`, `actionableFindings` from `src/core/stages/outcome.ts`, `StageResult` from `src/core/stages/types.ts`.
- Produces:

```ts
export interface OptimisePromptInput {
  skill: SkillRef
  lastRun: {
    runId: string
    runDir: string
    skillDigest: string
    git: { commit: string | null; dirty: boolean }
    stages: Array<{ stage: Stage; result: StageResult }>
  } | null
  evalAssets: readonly string[]
  install: { interpreter: string; skillsDir: string; sha: string; missing: readonly string[] }
}
export function buildOptimisePrompt(input: OptimisePromptInput): string
```

Returns a string always — unlike `buildFixPrompt`'s nullable return, because the trigger here is a user keystroke rather than a findings count, and a refusal is a flash rather than an absent document.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/optimise-prompt.test.ts
import { describe, expect, it } from 'vitest'
import { buildOptimisePrompt } from '../../src/core/stages/optimise-prompt.js'
import type { SkillRef } from '../../src/core/types.js'

const SKILL: SkillRef = {
  id: 'zapac/declawed',
  name: 'declawed',
  version: '1.2.0',
  dir: '/repo/declawed',
  relPath: 'declawed',
  workspacePath: '/repo/declawed-workspace',
  repo: { id: 'zapac', path: '/repo' },
} as SkillRef

const INSTALL = {
  interpreter: '/tools/skillhone/.venv/bin/python',
  skillsDir: '/home/.claude/skills',
  sha: '7d56583',
  missing: [] as string[],
}

describe('buildOptimisePrompt', () => {
  it('names the skill, the interpreter and the workspace prohibition with no recorded run', () => {
    const body = buildOptimisePrompt({
      skill: SKILL,
      lastRun: null,
      evalAssets: [],
      install: INSTALL,
    })

    expect(body).toContain('/repo/declawed')
    expect(body).toContain('/tools/skillhone/.venv/bin/python')
    expect(body).toContain('*-workspace/')
    // Absent evidence is stated, never omitted: a section that vanishes reads
    // as a builder that failed.
    expect(body).toContain('no recorded run')
  })

  it('omits suppressed findings and says how many, per R6.11', () => {
    const body = buildOptimisePrompt({
      skill: SKILL,
      lastRun: {
        runId: '019fe5c3',
        runDir: '/repo/declawed-workspace/skillgantry/runs/019fe5c3',
        skillDigest: 'sha256:7f3a',
        git: { commit: 'a1b2c3d', dirty: false },
        stages: [
          {
            stage: 'security',
            result: {
              stage: 'security',
              outcome: 'failed',
              toolRuns: [
                {
                  toolId: 'skillspector',
                  outcome: 'failed',
                  artefactDir: '/runs/019fe5c3/03-security/skillspector',
                  findings: [
                    { ruleClass: 'prompt-injection', severity: 'high', path: 'SKILL.md',
                      message: 'interpolates untrusted text', nativeRuleId: 'P2', suppressed: false },
                    { ruleClass: 'unsafe-script', severity: 'medium', path: 'scripts/scan.py',
                      message: 'alignment whitespace', nativeRuleId: 'MP2', suppressed: true },
                  ],
                },
              ],
            },
          },
        ],
      } as never,
      evalAssets: ['declawed/evals/eval.yaml'],
      install: INSTALL,
    })

    expect(body).toContain('prompt-injection')
    expect(body).not.toContain('alignment whitespace')
    expect(body).toContain('1 suppressed finding')
    // §9.4's rule: point at the report, do not restate it.
    expect(body).toContain('/runs/019fe5c3/03-security/skillspector')
    expect(body).toContain('declawed/evals/eval.yaml')
  })

  it('names a missing dependency before the task, so no prompt describes a loop that cannot start', () => {
    const body = buildOptimisePrompt({
      skill: SKILL,
      lastRun: null,
      evalAssets: [],
      install: { ...INSTALL, missing: ['claude CLI'] },
    })

    expect(body.indexOf('claude CLI')).toBeLessThan(body.indexOf('## Task'))
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/core/optimise-prompt.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/stages/optimise-prompt.js'`.

- [ ] **Step 3: Write the builder**

```ts
// src/core/stages/optimise-prompt.ts
import { join } from 'node:path'
import type { SkillRef, Stage } from '../types.js'
import { actionableFindings } from './outcome.js'
import type { StageResult } from './types.js'

export interface OptimisePromptInput {
  /**
   * The user's real skill, never `ctx.skill` — §9.4's rule. There is no run in
   * flight here, but the rule is the same one: the prompt names where an agent
   * should edit, and a sandbox path does not survive to be edited.
   */
  skill: SkillRef
  lastRun: {
    runId: string
    runDir: string
    skillDigest: string
    git: { commit: string | null; dirty: boolean }
    stages: Array<{ stage: Stage; result: StageResult }>
  } | null
  /** Repo-relative paths that exist under `<skill>/evals/`. */
  evalAssets: readonly string[]
  /**
   * Plain fields rather than a type from `tools`, so this module adds no §3
   * edge — the property §9.4 records as the reason `fix-prompt.ts` lives here.
   */
  install: { interpreter: string; skillsDir: string; sha: string; missing: readonly string[] }
}

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()

export function buildOptimisePrompt(input: OptimisePromptInput): string {
  const { skill, lastRun, install } = input
  const lines: string[] = [`# Optimise: ${skill.name}`, '']

  lines.push(`- Skill directory: \`${skill.dir}\``)
  lines.push(`- Repo root: \`${skill.repo.path}\``)
  lines.push(`- Declared version: ${skill.version ?? 'none'}`)
  lines.push(`- SkillHone: \`${install.skillsDir}\` at \`${install.sha}\``)
  lines.push(`- Run its scripts with: \`${install.interpreter}\``)
  if (input.evalAssets.length > 0) {
    lines.push(`- Eval assets: ${input.evalAssets.map((path) => `\`${path}\``).join(', ')}`)
  } else {
    lines.push('- Eval assets: none under `evals/` — seed one before measuring')
  }
  lines.push('')

  if (install.missing.length > 0) {
    // Before the task, never after: a prompt describing a loop that cannot
    // start is worse than no prompt, because the failure surfaces inside the
    // agent's session rather than in the terminal that produced it.
    lines.push(`> Missing: ${install.missing.join(', ')}. Resolve these first.`, '')
  }

  if (lastRun === null) {
    lines.push('## Recorded evidence', '', 'There is no recorded run for this skill yet.', '')
  } else {
    lines.push('## Recorded evidence', '')
    lines.push(
      `Run \`${lastRun.runId}\` · digest \`${lastRun.skillDigest}\` · ` +
        `commit \`${lastRun.git.commit ?? 'none'}\`${lastRun.git.dirty ? ' (dirty)' : ''}`,
      '',
    )
    let suppressed = 0
    for (const { stage, result } of lastRun.stages) {
      lines.push(`### ${stage} — \`${result.outcome}\``, '')
      const all = result.toolRuns.flatMap((run) => run.findings)
      suppressed += all.length - actionableFindings(all).length
      for (const run of result.toolRuns) {
        // §9.4's rule: name the report, do not restate it. `RawFinding` is a
        // closed six-field record, so remediation and explanation are only ever
        // in the tool's own artefacts.
        lines.push(`- **${run.toolId}** \`${run.outcome}\` — report: \`${run.artefactDir}\``)
      }
      const findings = actionableFindings(all)
      if (findings.length > 0) {
        lines.push('', '| severity | rule class | location | message |', '|---|---|---|---|')
        for (const finding of findings) {
          lines.push(
            `| ${finding.severity} | ${finding.ruleClass} | ${cell(finding.path)} | ${cell(finding.message)} |`,
          )
        }
      }
      lines.push('')
    }
    if (suppressed > 0) {
      // R6.11's rule and its reason: never tell an agent to fix what the user
      // has already ruled on, and say how many were left out so the tool report
      // listing more than the table does not read as a mismatch.
      lines.push(
        `${suppressed} suppressed finding(s) are omitted — the skill's own baseline file accepted them.`,
        '',
      )
    }
  }

  lines.push('## Task', '')
  lines.push(
    `Use the \`skillhone\` skill to optimise the skill at \`${skill.dir}\`. ` +
      'It dispatches to its own sub-skills; read its SKILL.md before choosing one.',
    '',
  )
  lines.push('## Constraints', '')
  lines.push(
    `- Never write under \`*-workspace/\` or \`.skillgantry-workspace/\` — that is SkillGantry's evidence, including the reports named above.`,
  )
  lines.push(
    '- Judge each finding before changing anything, and stop and report rather than edit code you judge correct.',
  )
  lines.push(
    '- SkillHone workflows may use bypass mode and local subprocess execution. Run them only in a workspace you are willing to lose.',
  )
  lines.push(`- Nothing here has been applied. SkillGantry does not run the optimiser (R6.12).`)

  return `${lines.join('\n')}\n`
}
```

- [ ] **Step 4: Export it**

`src/core/index.ts`, beside `buildFixPrompt`:

```ts
export { buildOptimisePrompt, type OptimisePromptInput } from './stages/optimise-prompt.js'
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/core/optimise-prompt.test.ts`
Expected: PASS, three cases.

- [ ] **Step 6: Commit**

```bash
git add src/core/stages/optimise-prompt.ts src/core/index.ts tests/core/optimise-prompt.test.ts
git commit -m "feat(stages): build the coding-agent optimisation prompt

R6.12. Evidence handoff, not workflow: it names each tool's own report
rather than restating it, omits suppressed findings and counts them per
R6.11, and never applies anything."
```

---

### Task 6: `planOptimise` on the views port, and `skillgantry optimise`

**Files:**
- Modify: `src/tui/views.ts`
- Modify: `src/cli/gantry-views.ts`
- Create: `src/cli/optimise-command.ts`
- Modify: `src/cli/run-command.ts:260`
- Test: `tests/cli/optimise-command.test.ts`

**Interfaces:**
- Consumes: `buildOptimisePrompt`, `OptimisePromptInput` from Task 5; `SKILLHONE_TOOL_ID` from Task 2. **Not** `loadLastRun` — it returns `LastRunStage[]` (`{stage, outcome, summary, findings: FindingRow[]}`) and carries neither `skillDigest` nor `git`, so this command reads `run.json` and each `stage.json` itself, exactly as `fix-command.ts:139-152` does.
- Produces:

```ts
// src/tui/views.ts
export interface OptimisePreviewView {
  skill: SkillRef
  /** The finished R6.12 body — the pane renders it and decides nothing. */
  prompt: string
  missing: readonly string[]
}
// on GantryViews
planOptimise(skillId: string): Promise<OptimisePreviewView>

// src/cli/optimise-command.ts
export interface OptimiseOptions { json?: boolean }
export async function runOptimise(deps: CliDeps, selector: string, opts: OptimiseOptions): Promise<number>
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/optimise-command.test.ts
import { readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { runOptimise } from '../../src/cli/optimise-command.js'
import { makeCliFixture } from '../helpers/tmp-repo.js'

describe('skillgantry optimise', () => {
  it('prints a prompt and writes not one byte', async () => {
    const fixture = await makeCliFixture()
    const before = await readdir(fixture.runsRoot).catch(() => [])
    const out: string[] = []
    const deps = { ...fixture.deps, write: (line: string) => out.push(line) }

    const code = await runOptimise(deps, 'declawed', {})

    expect(code).toBe(0)
    expect(out.join('\n')).toContain('# Optimise: declawed')
    // R11.10 and R12.6's shared constraint: the pipeline is the only writer
    // under runs/. A screen or a command that answers for a run must not
    // rewrite that run's evidence.
    expect(await readdir(fixture.runsRoot).catch(() => [])).toEqual(before)
  })

  it('exits non-zero and names the tool when SkillHone is not installed', async () => {
    const fixture = await makeCliFixture({ lockTools: [] })
    const code = await runOptimise(fixture.deps, 'declawed', {})

    expect(code).toBe(2)
  })
})
```

If `makeCliFixture` does not exist in `tests/helpers/tmp-repo.ts`, write it in this task: a temp home with `config.json`, one skill repo containing `declawed/SKILL.md`, an optional seeded `tools/lock.json`, and a `CliDeps` pointing at both.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/cli/optimise-command.test.ts`
Expected: FAIL — `Cannot find module '../../src/cli/optimise-command.js'`.

- [ ] **Step 3: Declare the port method**

In `src/tui/views.ts`, beside `ReleasePreviewView`:

```ts
/**
 * R11.21's pre-flight. The port returns the finished body rather than its
 * ingredients: assembling it needs the lock, `git status` and the sidecar, and
 * `src/tui/**` may not spawn for the first two. The pane renders; it decides
 * nothing — `planRelease` and `planSuppression` are the precedent in both
 * shape and reason.
 */
export interface OptimisePreviewView {
  skill: SkillRef
  prompt: string
  missing: readonly string[]
}
```

and add `planOptimise(skillId: string): Promise<OptimisePreviewView>` to `GantryViews`.

- [ ] **Step 4: Implement the shared assembly and the port**

Create `src/cli/optimise-command.ts` with the assembly both callers use:

```ts
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  SKILLHONE_TOOL_ID,
  STAGE_ORDER,
  buildOptimisePrompt,
  loadToolLock,
  readIndex,
  runsRoot,
  stageDirFor,
  type OptimisePromptInput,
  type SkillRef,
  type Stage,
  type StageResult,
} from '../core/index.js'
import { selectSkill, type CliDeps } from './run-command.js'

const EVAL_CANDIDATES = ['evals/eval.yaml', 'evals/cases', 'evals']

interface RunMetaOnDisk {
  runId: string
  skillDigest: string
  git: { commit: string | null; dirty: boolean }
}

const readJson = async <T>(path: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

/**
 * The greatest run id in the index, never the `latest` symlink, which is absent
 * mid-write — §14.5's resolution rule, and `fix-command.ts`'s.
 */
const newestRun = async (skill: SkillRef): Promise<string | null> => {
  const entries = await readIndex(skill.workspacePath).catch(() => [])
  const ids = entries.map((entry) => entry.runId).sort()
  return ids[ids.length - 1] ?? null
}

/** Absent is the common case, so a missing path is data rather than an error. */
const existing = async (skill: SkillRef): Promise<string[]> => {
  const found: string[] = []
  for (const rel of EVAL_CANDIDATES) {
    try {
      await access(join(skill.dir, rel))
      found.push(join(skill.relPath, rel))
    } catch {
      // not carried by this skill
    }
  }
  return found
}

export interface OptimisePlan {
  skill: SkillRef
  prompt: string
  missing: readonly string[]
}

/**
 * The one assembly, shared by the port and the subcommand, so the pane and the
 * headless output can never disagree about what was handed over.
 */
export async function planOptimiseFor(home: string, skill: SkillRef): Promise<OptimisePlan> {
  const lock = await loadToolLock(home)
  const entry = lock.tools[SKILLHONE_TOOL_ID]
  if (entry === undefined) {
    throw new Error(`${SKILLHONE_TOOL_ID} is not installed — run \`skillgantry setup\``)
  }

  const missing: string[] = []
  try {
    await access(entry.bin)
  } catch {
    missing.push('the managed interpreter')
  }

  // Read the sidecar the way `fix-command.ts` does rather than through
  // `loadLastRun`: that one is shaped for the rail — LastRunStage carries an
  // outcome and flattened FindingRows — and carries neither the digest nor the
  // git state R6.12 requires the prompt to name.
  const runId = await newestRun(skill)
  let lastRun: OptimisePromptInput['lastRun'] = null
  if (runId !== null) {
    const runDir = join(runsRoot(skill.workspacePath), runId)
    const meta = await readJson<RunMetaOnDisk>(join(runDir, 'run.json'))
    if (meta !== null) {
      const stages: Array<{ stage: Stage; result: StageResult }> = []
      for (const [index, stage] of STAGE_ORDER.entries()) {
        const result = await readJson<StageResult>(
          join(stageDirFor(runDir, index + 1, stage), 'stage.json'),
        )
        // A run executes the stages it was asked for, so an absent summary is
        // the ordinary case for the others rather than a failed read.
        if (result !== null) stages.push({ stage, result })
      }
      lastRun = { runId, runDir, skillDigest: meta.skillDigest, git: meta.git, stages }
    }
  }

  const input: OptimisePromptInput = {
    skill,
    lastRun,
    evalAssets: await existing(skill),
    install: {
      interpreter: entry.bin,
      // The first recorded link is the runtime directory a maintainer will
      // recognise; the bin is the fallback when SkillHone was already present
      // and no link was ours to make.
      skillsDir: entry.links?.[0] ?? entry.bin,
      sha: entry.resolvedVersion,
      missing,
    },
  }
  return { skill, prompt: buildOptimisePrompt(input), missing }
}

export interface OptimiseOptions {
  json?: boolean
}

export async function runOptimise(
  deps: CliDeps,
  selector: string,
  opts: OptimiseOptions,
): Promise<number> {
  const { skill } = await selectSkill(deps.home, selector)
  let plan: OptimisePlan
  try {
    plan = await planOptimiseFor(deps.home, skill)
  } catch (err) {
    deps.write(`${(err as Error).message}\n`)
    return 2
  }
  deps.write(opts.json === true ? `${JSON.stringify(plan, null, 2)}\n` : plan.prompt)
  return 0
}
```

Then in `src/cli/gantry-views.ts`, beside `planRelease`:

```ts
    planOptimise: async (skillId) => {
      const skill = await skillById(skillId)
      return planOptimiseFor(deps.home, skill)
    },
```

- [ ] **Step 5: Register the subcommand**

`src/cli/run-command.ts`, after the `fix` registration at line 260:

```ts
  program
    .command('optimise')
    .description('print the coding-agent optimisation prompt for a skill')
    .argument('<skill>', 'skill id or bare name')
    .option('--json', 'emit one JSON document')
    .action(async (selector: string, opts: OptimiseOptions) => {
      // R12.8, sharing R12.6's meaning: the code answers "is there a prompt on
      // stdout", not "did the skill pass". Reusing R12.2's meaning would make a
      // clean skill and an uninstalled optimiser indistinguishable.
      program.exitCode = await runOptimise(deps, selector, opts)
    })
```

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run tests/cli && pnpm build`
Expected: PASS. `tsc` will flag `tests/helpers/fake-views.ts` as missing `planOptimise` — add a stub there returning a fixed `OptimisePreviewView`.

- [ ] **Step 7: Commit**

```bash
git add src/cli src/tui/views.ts tests/cli tests/helpers
git commit -m "feat(cli): add skillgantry optimise and planOptimise

R12.8. One assembly shared by the port and the subcommand, so the pane
and the headless output cannot disagree. Writes nothing under runs/ —
the constraint R11.10 and R12.6 already share."
```

---

### Task 7: The Work-screen surface

**Files:**
- Create: `src/tui/components/OptimisePane.tsx`
- Modify: `src/tui/store.ts` (state slot, three actions)
- Modify: `src/tui/app.tsx:936` (the mark guard), `:1006` (the `r` branch), `:1044` (the render order)
- Test: `tests/tui/optimise-pane.test.tsx`

**Interfaces:**
- Consumes: `OptimisePreviewView` from Task 6; `Panel`, `StatusBar`, `innerWidth`, `reviewDiffRows`, `truncate` from the existing TUI modules; `osc52(text): string | null` from `src/tui/osc52.ts` — there is no `copyToClipboard`; the caller writes the sequence itself, as `app.tsx:519-526` already does.
- Produces:

```ts
export interface OptimiseSlot {
  skillId: string
  prompt: string
  lines: readonly string[]
  offset: number
}
// store actions
| { type: 'begin-optimise'; skillId: string; prompt: string }
| { type: 'scroll-optimise'; delta: number; viewport: number }
| { type: 'end-optimise' }
```

`AppProps` gains `optimiseReady: boolean`, set by `src/cli/tui-command.ts` from the lock it already opens.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/tui/optimise-pane.test.tsx
import { describe, expect, it } from 'vitest'
import { renderInk } from '../helpers/render-ink.js'
import { fakeViews } from '../helpers/fake-views.js'
import { App } from '../../src/tui/app.js'

describe('the optimise surface', () => {
  it('opens on r and enqueues nothing', async () => {
    const enqueued: unknown[] = []
    const app = await renderInk(
      <App {...baseProps({ optimiseReady: true, onEnqueue: (s) => enqueued.push(s) })} />,
    )
    await app.press('l', 'l', 'l')      // rail: validate → evaluate → security → optimise
    await app.press(' ')                 // mark it
    await app.press('r')

    expect(app.lastFrame()).toContain('Optimise')
    expect(app.lastFrame()).toContain('# Optimise:')
    expect(enqueued).toEqual([])
  })

  it('refuses a mixed mark by name', async () => {
    const app = await renderInk(<App {...baseProps({ optimiseReady: true })} />)
    await app.press('l', 'l', 'l', ' ') // optimise
    await app.press('h', ' ')            // security too
    await app.press('r')

    // Both resolutions of a mixed mark lie about what the marks asked for —
    // the same refusal release carries, for the same reason.
    expect(app.lastFrame()).toContain('optimise runs on its own')
  })

  it('clears the mark when the surface is cancelled', async () => {
    const app = await renderInk(<App {...baseProps({ optimiseReady: true })} />)
    await app.press('l', 'l', 'l', ' ', 'r')
    await app.press('')            // esc

    // The release mark surviving esc is the bug runs 019fe5b6 and 019fe5bb
    // paid for; this surface must not reintroduce it.
    expect(app.lastFrame()).not.toContain('# Optimise:')
    expect(app.lastFrame()).not.toContain('1 marked')
  })

  it('refuses the mark when SkillHone is not installed', async () => {
    const app = await renderInk(<App {...baseProps({ optimiseReady: false })} />)
    await app.press('l', 'l', 'l', ' ')

    expect(app.lastFrame()).toContain('skillhone not installed')
  })

  it('refuses a multi-skill batch by name', async () => {
    const app = await renderInk(<App {...baseProps({ optimiseReady: true })} />)
    await app.press(' ')                 // mark the first skill
    await app.press('j', ' ')            // and the second
    await app.press('\t')                // focus the work zone
    await app.press('l', 'l', 'l', ' ', 'r')

    expect(app.lastFrame()).toContain('one skill at a time')
  })
})
```

`baseProps` lives in this file, because `tests/tui/` has no shared fixture and each suite builds its own:

```tsx
import { fakeViews } from '../helpers/fake-views.js'
import { skillRef } from '../helpers/skill-ref.js'

const PROMPT = '# Optimise: declawed\n\n- Skill directory: `/repo/declawed`\n'

const baseProps = (over: { optimiseReady: boolean; onEnqueue?: (s: unknown) => void }) => ({
  skills: [skillRef('declawed'), skillRef('gap-analysis')],
  queue: {
    enqueue: (specs: unknown) => over.onEnqueue?.(specs),
    snapshot: () => [],
    cancelJob: async () => undefined,
    subscribe: () => () => undefined,
  } as never,
  stages: ['validate', 'evaluate', 'security'] as const,
  concurrency: 2,
  views: {
    ...fakeViews(),
    planOptimise: async (skillId: string) => ({
      skill: skillRef('declawed'),
      prompt: PROMPT,
      missing: [],
    }),
  },
  setup: {} as never,
  intervalMs: 5,
  optimiseReady: over.optimiseReady,
})
```

Match `queue`'s and `setup`'s real shapes against whichever `tests/tui/` suite already constructs them; the two `as never` casts stand in only for the members these cases never touch.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/tui/optimise-pane.test.tsx`
Expected: FAIL — the frame shows the Work screen; no pane exists.

- [ ] **Step 3: Add the state slot and actions**

In `src/tui/store.ts`, beside `ReleaseSlot`:

```ts
export interface OptimiseSlot {
  skillId: string
  /** The finished R6.12 body, for the clipboard. */
  prompt: string
  /** Split once, because the pane renders it and the scroll clamp counts it. */
  lines: readonly string[]
  offset: number
}
```

`AppState` gains `optimise: OptimiseSlot | null`, initialised `null`. Three cases:

```ts
    case 'begin-optimise': {
      const lines = action.prompt.split('\n')
      return { ...state, optimise: { skillId: action.skillId, prompt: action.prompt, lines, offset: 0 } }
    }
    case 'scroll-optimise': {
      const slot = state.optimise
      if (slot === null) return state
      const max = Math.max(0, slot.lines.length - action.viewport)
      return { ...state, optimise: { ...slot, offset: Math.min(max, Math.max(0, slot.offset + action.delta)) } }
    }
    case 'end-optimise':
      // The mark goes with the surface. A mark that survives `esc` means the
      // next `r` reopens this pane over whatever has been marked since, with
      // nothing on screen naming the keystroke that would free the user.
      return { ...state, optimise: null, markedStages: [], markedSkills: [] }
```

- [ ] **Step 4: Write the pane**

```tsx
// src/tui/components/OptimisePane.tsx
import { Box, Text } from 'ink'
import { innerWidth, reviewDiffRows, truncate, truncateMiddle, type Layout } from '../layout.js'
import type { OptimiseSlot } from '../store.js'
import { Panel } from './Panel.js'
import { StatusBar } from './StatusBar.js'

const HINTS = 'y copy · j/k scroll · esc close · q quit'

/**
 * R11.21. It presents R6.12's prompt and does nothing else: no `a`, because
 * there is nothing to apply, and no enqueue, because SkillGantry does not run
 * the optimiser. That is what puts it below every write pane in §14.2's order.
 */
export function OptimisePane({
  optimise,
  flash,
  layout,
}: {
  optimise: OptimiseSlot
  flash: string | null
  layout: Layout
}): React.ReactElement {
  const cols = Math.max(8, innerWidth(layout.columns, layout.chrome))
  const room = reviewDiffRows(layout)
  const overflow = optimise.lines.length > optimise.offset + room
  const shown = optimise.lines.slice(optimise.offset, optimise.offset + (overflow ? room - 1 : room))
  const hidden = optimise.lines.length - optimise.offset - shown.length

  return (
    <Box flexDirection="column" width={layout.columns}>
      <Panel
        title={`Optimise — ${truncateMiddle(optimise.skillId, Math.max(12, cols - 14))}`}
        focused
        chrome={layout.chrome}
        width={layout.columns}
      >
        {shown.map((line, index) => (
          <Text key={`${optimise.offset + index}`} wrap="truncate">
            {truncate(line, cols)}
          </Text>
        ))}
        {/* §14.1's first rule: the footnote is counted against the allocation
            above, never appended under it. */}
        {hidden > 0 && (
          <Text dimColor wrap="truncate">
            {truncate(`  +${hidden} more line(s) · j/k`, cols)}
          </Text>
        )}
      </Panel>
      <StatusBar hints={flash ?? HINTS} columns={layout.columns} />
    </Box>
  )
}
```

- [ ] **Step 5: Wire the guard, the `r` branch and the render order**

`src/tui/app.tsx` — the mark guard at line 936 becomes:

```ts
        const marking = STAGE_ORDER[state.selectedStage] as Stage
        if (marking === 'optimise') {
          // R11.20 as amended: optimise has a native *action*, not an executor,
          // so its runnability is a fact about the lock rather than about the
          // configuration. The refusal names the tool and the way out.
          if (!optimiseReady) {
            flash('skillhone not installed · run `skillgantry setup`')
            return
          }
        } else if (!isNativeStage(marking) && !stages.includes(marking)) {
          flash(`${marking} has no tool selected · configure one in Settings`)
          return
        }
```

The `r` branch, immediately after the `release` block at line 1020:

```ts
      // R11.21. Optimise opens a surface and enqueues nothing: SkillGantry
      // composes the prompt and hands it over, and R6.12 forbids it running the
      // optimiser. Its own batch for release's reason — a mixed mark cannot be
      // resolved either way without lying about what was asked for.
      if (wanted.includes('optimise')) {
        if (wanted.length > 1) {
          flash('optimise runs on its own — unmark it, or unmark the other stages')
          return
        }
        const ids = chosen.filter((id): id is string => id !== undefined)
        // One skill: SkillHone's loop is per-skill by construction, one skill
        // repo against one eval repo, so a prompt naming five is five loops in
        // one paste.
        if (ids.length > 1) {
          flash('optimise takes one skill at a time — unmark the others')
          return
        }
        const only = ids[0]
        if (only !== undefined) {
          void views.planOptimise(only).then(
            (preview) => dispatch({ type: 'begin-optimise', skillId: only, prompt: preview.prompt }),
            (err: unknown) => flash((err as Error).message, 'bad'),
          )
        }
        return
      }
```

A key block above the release block's, for the pane's own keys:

```ts
    if (state.optimise) {
      const slot = state.optimise
      if (key.escape) dispatch({ type: 'end-optimise' })
      else if (plain && input === 'y') {
        const seq = osc52(slot.prompt)
        if (seq === null) {
          // An action able to report only success is the failure §14.3 exists
          // to prevent, and a prompt over the cap is exactly that case.
          flash(`too large to copy · ${slot.skillId}`)
        } else {
          // Not Ink's `write()` from the same hook: that writes above the app
          // and forces a clear-and-re-render, flickering the frame for a
          // sequence that renders nothing.
          stdout.write(seq)
          flash(`optimise prompt copied · ${slot.skillId}`)
        }
      } else if ((plain && input === 'j') || key.downArrow) {
        dispatch({ type: 'scroll-optimise', delta: 1, viewport: reviewRows })
      } else if ((plain && input === 'k') || key.upArrow) {
        dispatch({ type: 'scroll-optimise', delta: -1, viewport: reviewRows })
      }
      return
    }
```

placed **after** the `state.confirm` block and **before** the palette's, matching the render order below.

The render order at line 1044, after the `ConfirmPane` branch:

```tsx
  // §14.2 orders the modals by what a keystroke can destroy, and this pane's
  // keys destroy nothing: it builds no job and writes no byte. Below the three
  // write panes, above the palette.
  if (state.optimise) {
    return <OptimisePane optimise={state.optimise} flash={state.flash?.message ?? null} layout={layout} />
  }
```

Add `optimiseReady: boolean` to `AppProps` and destructure it in `App`; set it in `src/cli/tui-command.ts` from the lock it already loads: `optimiseReady: SKILLHONE_TOOL_ID in lock.tools`.

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run tests/tui && pnpm build`
Expected: PASS, five cases. `tsc` will flag every existing `<App …>` construction missing `optimiseReady` — add `optimiseReady: false` to the shared test fixture rather than to each call site.

- [ ] **Step 7: Commit**

```bash
git add src/tui tests/tui
git commit -m "feat(tui): open an optimise surface from the rail mark

R11.21. `r` seeing optimise opens a pane instead of enqueuing, refuses a
mixed mark and a multi-skill batch by name, and clears the mark whenever
the surface closes. R11.20's refusal becomes conditional on the lock."
```

---

### Task 8: The M9 acceptance suite

**Files:**
- Create: `tests/acceptance/m9.test.tsx`
- Modify: `tests/core/install.test.ts` (the `SG_INTEGRATION` matrix)
- Test: itself

**Interfaces:**
- Consumes: everything from Tasks 2–7.
- Produces: nothing.

- [ ] **Step 1: Write one named case per exit-criterion clause**

```tsx
// tests/acceptance/m9.test.tsx
import { mkdir, mkdtemp, readdir, readlink, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { doctor } from '../../src/core/tools/doctor.js'
import { installTool, toolRoot } from '../../src/core/tools/install.js'
import { gitSkillUninstall } from '../../src/core/tools/git-skill.js'
import { SKILLHONE_TOOL_ID, catalogueEntry } from '../../src/core/tools/catalogue.js'
import type { Exec } from '../../src/core/tools/exec.js'
import { runOptimise } from '../../src/cli/optimise-command.js'
import { makeCliFixture } from '../helpers/tmp-repo.js'

const SHA = 'c'.repeat(40)

/** Materialises what a clone would leave, so nothing here reaches the network. */
const bundleExec = (calls: string[][]): Exec => async (bin, argv) => {
  calls.push([bin, ...argv])
  if (bin === 'git' && argv[0] === 'clone') {
    const repoDir = argv[2] as string
    for (const name of catalogueEntry(SKILLHONE_TOOL_ID)?.install.kind === 'git-skill'
      ? (catalogueEntry(SKILLHONE_TOOL_ID)?.install as { skills: string[] }).skills
      : []) {
      await mkdir(join(repoDir, 'skills', name), { recursive: true })
      await writeFile(join(repoDir, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`)
    }
  }
  if (argv.includes('rev-parse')) return { stdout: `${SHA}\n`, stderr: '' }
  return { stdout: '', stderr: '' }
}

const seedHome = async (): Promise<string> => {
  const home = await mkdtemp(join(tmpdir(), 'sg-m9-'))
  await mkdir(join(home, '.claude', 'skills'), { recursive: true })
  await mkdir(join(home, '.agents', 'skills'), { recursive: true })
  return home
}

describe('M9 exit criteria', () => {
  it('installs by clone, per-skill symlink and a managed venv, with nothing global', async () => {
    const userHome = await seedHome()
    const sgHome = await mkdtemp(join(tmpdir(), 'sg-root-'))
    const spec = catalogueEntry(SKILLHONE_TOOL_ID)
    if (spec === undefined) throw new Error('skillhone is not catalogued')
    const calls: string[][] = []

    const entry = await installTool(sgHome, { ...spec, install: { ...spec.install, pin: SHA } }, {
      exec: bundleExec(calls),
      userHome,
    })

    const dir = join(toolRoot(sgHome), SKILLHONE_TOOL_ID)
    // R3.1: the venv is under the tool root, and no `pip install` ever ran
    // against an interpreter outside it — which is what upstream's own
    // documented install does.
    expect(entry.bin).toBe(join(dir, '.venv', 'bin', 'python'))
    expect(calls.filter(([bin]) => bin === 'pip')).toEqual([])
    for (const call of calls.filter(([bin, sub]) => bin === 'uv' && sub === 'pip')) {
      expect(call).toContain(join(dir, '.venv', 'bin', 'python'))
    }
    // Both runtimes, each link per skill, every target inside the tool root.
    expect(entry.links?.some((link) => link.includes('.claude'))).toBe(true)
    expect(entry.links?.some((link) => link.includes('.agents'))).toBe(true)
    for (const link of entry.links ?? []) expect(await readlink(link)).toContain(dir)
  })

  it('uninstall leaves no dangling link', async () => {
    const userHome = await seedHome()
    const sgHome = await mkdtemp(join(tmpdir(), 'sg-root-'))
    const spec = catalogueEntry(SKILLHONE_TOOL_ID)
    if (spec === undefined) throw new Error('skillhone is not catalogued')
    const entry = await installTool(sgHome, { ...spec, install: { ...spec.install, pin: SHA } }, {
      exec: bundleExec([]),
      userHome,
    })

    await gitSkillUninstall(join(toolRoot(sgHome), SKILLHONE_TOOL_ID), entry.links ?? [])

    // A dangling link breaks every agent that scans that directory, which is
    // the cost R3.1 exists to avoid.
    for (const link of entry.links ?? []) await expect(stat(link)).rejects.toThrow()
    expect(await readdir(join(userHome, '.claude', 'skills'))).toEqual([])
  })

  it('doctor names a missing claude CLI and does not fail the report', async () => {
    const userHome = await seedHome()
    const sgHome = await mkdtemp(join(tmpdir(), 'sg-root-'))
    const spec = catalogueEntry(SKILLHONE_TOOL_ID)
    if (spec === undefined) throw new Error('skillhone is not catalogued')
    await installTool(sgHome, { ...spec, install: { ...spec.install, pin: SHA } }, {
      exec: bundleExec([]),
      userHome,
    })

    const exec: Exec = async (bin, argv) => {
      if (bin === 'command' && argv[1] === 'claude') throw new Error('not found')
      if (argv.includes('rev-parse')) return { stdout: `${SHA}\n`, stderr: '' }
      return { stdout: '', stderr: '' }
    }
    const report = await doctor({
      home: sgHome,
      skills: [],
      ledgerLifecycle: new Map(),
      ruleMap: { applied: 1, current: 1 },
      exec,
    })

    expect(report.tools.find((row) => row.kind === 'claude-cli-missing')?.detail).toContain(
      '@anthropic-ai/claude-code',
    )
    // R3.7's rule: reported, never installed, and never a reason a tool cannot run.
    expect(report.failed).toBe(false)
  })

  it('skillgantry optimise prints the prompt, names each tool report, and writes not one byte', async () => {
    const fixture = await makeCliFixture({ seedRun: 'suppressed-and-actionable' })
    const before = await readdir(fixture.runsRoot)
    const out: string[] = []

    const code = await runOptimise({ ...fixture.deps, write: (s: string) => out.push(s) }, 'declawed', {})
    const body = out.join('')

    expect(code).toBe(0)
    expect(body).toContain('# Optimise: declawed')
    // §9.4's rule, at this prompt too: name the report, do not restate it.
    expect(body).toContain(join(fixture.runsRoot, fixture.runId, '03-security', 'skillspector'))
    // R6.11: never tell an agent to fix what the user has already ruled on.
    expect(body).toContain('1 suppressed finding')
    expect(body).not.toContain('alignment whitespace')
    // R11.10 and R12.6's shared constraint.
    expect(await readdir(fixture.runsRoot)).toEqual(before)
  })
})
```

`makeCliFixture` gains a `seedRun` option in this task: it writes `run.json` plus a `03-security/stage.json` holding one actionable and one suppressed finding, and a `skillspector/` artefact directory beside it, then returns `runId` and `runsRoot`. The Work-screen clauses of the exit criteria are already covered by Task 7's five cases against a real `App` render, so they are not duplicated here — `tests/acceptance/` exists for the paths a unit test cannot reach, and a second frame assertion is not one of them.

- [ ] **Step 2: Extend the integration matrix**

In `tests/core/install.test.ts`, add a case behind `SG_INTEGRATION=1` that really clones `Tencent/SkillHone` at the catalogued pin, builds the venv, and asserts `verifyGitSkill` passes. Assert the user's global `site-packages` is byte-identical before and after, capturing its state first — the same correction plan_m3 Task 11 records for the uv path, and for the same reason: asserting a path "does not exist" passes on a clean machine for a reason unrelated to the rule.

- [ ] **Step 3: Run the whole check**

Run: `pnpm check`
Expected: lint, build, test and acceptance all PASS.

- [ ] **Step 4: Update the plan's status and commit**

Change this file's **Status** line to `revision 1, shipped` and add a Changelog entry.

```bash
git add tests docs/specs/plan_m9-skillhone-optimise.md
git commit -m "test(acceptance): cover the M9 exit criteria

One named case per clause: install and uninstall, doctor's non-failing
conditions, the rail surface that enqueues nothing, the headless command
that writes nothing, and the prompt's suppression rule."
```

---

## Requirement coverage for M9

| Requirement | Covered by |
|---|---|
| R3.1 (amended) symlinks recorded and removable | §2 link and uninstall steps |
| R3.5 (amended) bundle carve-out, `stage: null` | §1 |
| R3.8 SkillHone in Recommended and Everything | §2 presets |
| R6.12 (new) the optimise prompt, never applied | §4 |
| R11.20 (amended) refusal conditional on the install | §3 |
| R11.21 (new) the terminal surface | §3 |
| R12.8 (new) the headless command, writes nothing | §4 |
| R3.10 (new) the tool-owned configuration file | §5 |
| R7.3 (amended) the one exception, and its four conditions | §5 |

**Owned elsewhere but shaped here.** R3.2's native install mechanism gains a fourth driver. R3.6's `install-and-verify` state now covers a tool with no version argv. R3.7's probe-and-report rule extends from host runtimes to a tool's own runtime dependency. R3.9's four drift kinds are re-grounded on `git-skill`'s three facts. R6.11's suppression rule is reused verbatim by the new prompt. R11.10 and R12.6's "the pipeline is the only writer under `runs/`" is what makes the prompt file-less.

## Known gaps carried forward

- **SkillHone's loop needs an eval repo SkillGantry has no concept of.** The prompt names `<skill>/evals/` when it exists — skill-up's M4 convention — but SkillHone's own eval repo is a different shape: private datasets, a verifier, a synthesis contract. First real use decides whether the evidence handoff is enough or whether a config field for an eval repo is needed.
- **SkillHone writes the user's repo outside §12.** No sandbox, no diff, no journal, because a pasted coding agent is doing the writing. It is the same handoff R6.10 already makes, and it is self-healing for release: the skill digest moves, so R9.9 forces the gates to re-run before anything can be released.
- **A commit-sha pin goes stale silently.** Upstream ships no tags, so nothing signals a newer sha. Doctor's `version-drift` catches only HEAD moving locally.
- **`~/.agents/skills` is not in upstream's runtime table.** Included because this machine uses it. If it turns out to be host-specific, the cost is one wasted symlink.
- **The venv is heavy.** `litellm[proxy]` and the Anthropic SDK make the first install minutes long and hundreds of megabytes.
- **An unmanaged pre-existing install reports weakly** — installed, no sha, no drift detection. See §2.
- **R13.7's mechanical coverage check still does not exist.** Carried since M3; this milestone edits the ownership table by hand like every one before it.

## Deviations found while implementing

- **The M9 ownership row claims only the new ids.** The brief listed R3.1, R3.5, R3.8 and R11.20 beside R6.12, R11.21 and R12.8, but those four are owned by M1, M3, M3 and M5, and `tests/specs/traceability.test.ts` fails a requirement claimed twice. Amending a requirement in place does not move its owner — that is what "amended in place" means — so the row is `R6.12, R11.21, R12.8`.
- **A sixth catalogue entry broke the wizard's row budget.** `Setup` rendered the whole catalogue and the whole selection unwindowed, so the frame reached 15 rows on a 50×14 terminal — §14.1's first rule, failing in `tests/tui/layout.test.tsx`. `setupBodyRows(rows, extras)` in `layout.ts` now decides the budget and both lists window against it with a counted footnote. The wizard had simply never had enough entries to overflow before.
- **`catalogue.test.ts`'s "every entry has a version argv" invariant is now conditional.** A `git-skill` bundle answers no argv by construction, which is the whole reason §5.2 verifies it by three facts, so asserting one would make the invariant describe a tool rather than a rule.
- **`stageToolsFor` takes an injected `isRunnable`.** The brief's wizard test called it with one argument. It is asserted with the permissive predicate instead, which is the stronger claim: `stage: null` keeps SkillHone out even where the runnable filter would not have caught it.
- **`RawFinding.suppressed` is `{ justification }`, not a boolean.** The brief's prompt fixture used `suppressed: false` / `true`; absent means unsuppressed, so both would have counted as suppressed and the actionable table would have been empty.
- **Link presence is checked with `lstat`, not `stat`.** A dangling symlink still occupies the name, so `symlink()` over it throws `EEXIST`; checking through `stat` would have skipped it and turned a link we could replace into a failed install.
- **`checkLockedTool` takes the whole lock entry.** As the brief predicted, its four scalars could not express the branch — it needs `installKind` and `links`.
- **`state.flash` is a plain string.** The brief's render branch read `state.flash?.message`.
- **The `SG_INTEGRATION` loop over `CATALOGUE` needed a redirected `userHome`.** `git-skill` is the one kind that writes outside the tool root, and the loop would otherwise have put real symlinks in the machine's own `~/.claude/skills`.
- **`makeCliFixture` did not exist** and was written in Task 6, as the brief allowed for.
- **The R11.20 case in `release-target.test.tsx` was amended, not deleted.** It still proves the mark does not land; what changed is which refusal it names.

## Changelog

- 2026-08-10 — revision 2, shipped. `~/.skillhone/settings.json` composed from `~/.skillgantry/.env` when SkillHone installs, at mode 600 inside a 700 directory; an existing file is never overwritten; the path and a digest are recorded in the lock, removed on uninstall while the bytes still match, and reported by doctor as absent, unmanaged or stale. R3.10 added and R7.3 amended in place with one narrow exception, since SkillGantry does not spawn the tool it is configuring and so has no spawn to inject at. Design §5.4 is the contract; §5.1 and §5.3 amended.
- 2026-08-10 — revision 1, shipped. Eight tasks, `pnpm check` green: 1102 unit tests, 52 acceptance.
- 2026-08-09 — revision 1, design brief. Written after reading `Tencent/SkillHone` at `7d56583`, its install guide, its requirements file and the `skillhone-optimization` skill. Task breakdown pending `superpowers:writing-plans`.
