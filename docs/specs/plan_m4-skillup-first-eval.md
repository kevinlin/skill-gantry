# SkillGantry M10 Implementation Plan — skill-up's first eval suite

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Status:** revision 1, planned. Written against [design.md](design.md), [design_tui.md](design_tui.md) and [requirements.md](requirements.md) as of shipped M9.

**Goal:** Give the evaluate gate a way to start. skill-up cannot run without `evals/eval.yaml`, most skills carry none, and the gate answers that with `errored`/`missing-artefact` and no next step. Marking `evaluate` on a skill with no suite now opens a surface that hands the maintainer a coding-agent prompt for authoring one. `skill-upper`, the agent skill that owns the templates and the judge guidance that prompt names, becomes a catalogued, installed and verified dependency rather than something the user is assumed to have.

**Architecture:** one catalogue entry and two conditionals in the existing `git-skill` driver; one pure prompt builder in `src/core/stages/` beside the two already there; one doctor condition; one pane generalised from `OptimisePane` and one `r` branch in `src/tui/`; one views-port read and one subcommand in `src/cli/`. No new source root, no ledger change, no adapter, no stage executor. The evaluate stage acquires a pre-flight, not a second run path.

**Tech stack:** everything M1–M9 ship. No new dependency. `git` is invoked through the existing `Exec` seam.

---

## Global Constraints

Everything in [plan_m1.md](plan_m1.md)'s, [plan_m2.md](plan_m2.md)'s, [plan_m3.md](plan_m3.md)'s, [plan_m4.md](plan_m4.md)'s and [plan_m4-skillhone-optimise.md](plan_m4-skillhone-optimise.md)'s Global Constraints still holds. These are the additions.

- Import boundary unchanged: `cli → tui → core`, `src/tui/**` reaches core only through `src/core/index.ts`, no `console` or `process.exit` in `src/core/**`.
- `src/core/tools/**` owns fs, network and subprocess, and MUST NOT open the ledger. The catalogue and driver changes are bound by that rule.
- **The eval bootstrap action writes nothing.** No file under the sidecar, none in the user's repo, none in the tool root beyond the install. The pipeline stays the only writer under `runs/`, the constraint R11.10 and R12.6 already share. The prompt is emitted to stdout headless and copied via OSC 52 in the terminal.
- **skill-upper MUST NOT reach `stageTools`.** It is catalogued `stage: null` for the reason vercel `skills` and SkillHone are: `AdapterStageExecutor.plan()` throws `unknown tool: <id>` on an id the adapter registry does not hold, which would fail every run of that stage.
- **SkillGantry never replaces a skill link it did not create.** `gitSkillInstall` already refuses one, and `detectSkillDirs` already skips a directory that holds the skill. Doctor reports the case and installs nothing, per R3.7's rule.
- No adapter, no `parse`, no rule-class map entry, no `RULE_CLASS_MAP_VERSION` bump. skill-upper reports nothing SkillGantry reads.
- British spelling in identifiers that appear in the specs (`optimise`, `artefact`, `normalise`).
- Conventional Commits, lowercase imperative subject.

## Facts established by reading the repository and the installed tools

Probed 2026-08-10. None of the below is an assumption; the one open question is named at the end.

**1. The adapter's argv fixes the suite's path.** [src/core/adapters/skill-up.ts](../../src/core/adapters/skill-up.ts) invokes `run {skillDir}/evals/eval.yaml --format json --output-dir {toolDir} --iteration 1` and declares one artefact, `iteration-1/report.json`. A suite anywhere else is invisible to the gate, and the declared artefact is what the parser reads.

**2. A failing case is filed at a path the layout has to produce.** [plan_m4.md](plan_m4.md) Task 4 paths eval findings at `<skillRelPath>/evals/cases/<case_id>.yaml`. A repo storing its cases elsewhere gets an issue naming a file that does not exist, recorded there as a display defect. The bootstrap prompt is the first thing able to prevent it, which is why the case layout is a constraint in the body rather than a suggestion.

**3. `skill-up init` does not scaffold a suite.** It writes user config: OTLP defaults, `runtime_kwargs`. Scaffolding in skill-upper's own documented flow is copying `assets/eval.yaml.tmpl` and `assets/case.yaml.tmpl` into the skill and rewriting them. There is no CLI path SkillGantry could drive, which is what makes a prompt handoff the only option rather than the preferred one.

**4. skill-upper ships inside the skill-up repo, at `skills/skill-upper`.** The reference machine's `~/.claude/skills/skill-upper` resolves to `…/alibaba_skill-up/skills/skill-upper`, the same `repo/skills/<name>` shape `gitSkillInstall` already assumes.

**5. skill-upper has no Python.** Its tree is `SKILL.md`, `README.md`, `assets/*.tmpl`, `references/` and its own `evals/`. No `requirements.txt`, no `.py`. `GitSkillSpec.requirements` is currently mandatory and the driver unconditionally runs `uv venv` plus `uv pip install -r`, so a bundle with no dependencies cannot be expressed today.

**6. skill-upper's step 5 is credentials, and they are the user's.** It reads `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `QODER_PERSONAL_ACCESS_TOKEN`, or `~/.skill-up/credentials.yaml`, and it stops and asks rather than writing secrets into YAML. R7.3 forbids SkillGantry writing credentials, so the prompt names key *names* only and never a value, the same line R7.4's redaction rule draws.

**7. The engine is declared by the skill, not by SkillGantry.** `evals/eval.yaml` carries `engine: { name: claude_code }` in every reference skill, and skill-up resolves that CLI's own authentication, which is [plan_m4.md](plan_m4.md)'s known gap. Doctor already probes for a missing `claude` with `exec('command', ['-v', 'claude'])` and reports `claude-cli-missing` without installing it, so the prompt has a checked fact to name.

**8. `OptimisePane` is already this surface.** Title, scrolled prompt lines, `y` copy, `j`/`k`, `esc`; a slot of `{ skillId, prompt, lines, offset }`; precedence after `ConfirmPane` and before the setup screen. Nothing in it is about optimisation except its title and the mark it clears.

**Open probe, owned by Task 2:** that `skills/skill-upper/SKILL.md` exists in `alibaba/skill-up` at tag `v0.7.0`. The path is confirmed on a working checkout; the *tag* is not. If v0.7.0 predates the skill, pin the earliest tag carrying it and record the deviation, per plan_m3's rule that every pin is probed against its real index before it is written.

## Spec amendments this milestone carries

All land in Task 1, before the code that depends on them, per the repo rule that a spec proven wrong is corrected in the same branch.

| Doc | Change |
|---|---|
| requirements.md | **new R3.11**: install `skill-upper` by clone and per-skill symlink into every runtime skills directory present; never replace a link SkillGantry did not create; verify the links resolve; doctor reports an absent, dangling or unmanaged installation and names the command that fixes it, installing nothing. |
| requirements.md | **new R6.13**: the eval bootstrap prompt. What it names, that a missing dependency is named before the task, that it forbids writes under a workspace directory and edits to the skill's shipped files, and that SkillGantry MUST NOT author eval files and MUST NOT run the suite. |
| requirements.md | **new R11.22**: the terminal surface. The pre-flight at `r`, the refusal of a mixed mark, the palette entry, the mark-clearing rule, and the refusal when skill-upper is unreachable. |
| requirements.md | **new R12.9**: the headless command, which writes nothing, and whose exit code reports whether a prompt was produced rather than whether the skill passes. |
| requirements.md | **R3.5** amended in place: the `git-skill` carve-out covers a bundle with no runtime dependencies, so `requirements` is optional. **R3.8** amended in place: skill-upper is installed with skill-up rather than by preset name, being that tool's authoring companion and useless without it. **R11.21** amended in place for the shared pane. |
| requirements.md | § Milestone ownership gains an M10 row. R13.7's check is mechanical, so an unowned id fails the build. |
| design.md | §5.1a skill-upper as a catalogue member with no executable and no dependencies · §5.2 `git-skill` with an optional requirements file, and what `bin` records when there is no interpreter · §5.3 the new doctor condition · **new §9.4b** the eval bootstrap prompt, beside §9.4a · §15 `skillgantry evals` · §17 the M10 row |
| design_tui.md | **new §14.11** the eval bootstrap surface: the pre-flight at `r`, the three outcomes, the palette entry, the shared prompt pane, the precedence slot |
| index.md | a row for this plan |
| CLAUDE.md | "§15 is the CLI surface: six subcommands" is stale. Nine today, ten after this |

## Critical Files — Summary

| Path | Role |
|---|---|
| `src/core/tools/catalogue.ts` | skill-upper entry; `GitSkillSpec.requirements` optional |
| `src/core/tools/git-skill.ts` | skip the venv and the interpreter probe when there are no requirements |
| `src/core/tools/setup.ts` | skill-upper follows skill-up into the install set |
| `src/core/tools/doctor.ts` | `skill-link-unmanaged`, non-failing |
| `src/core/stages/eval-prompt.ts` | NEW: `buildEvalPrompt`, pure, beside `fix-prompt.ts` and `optimise-prompt.ts` |
| `src/cli/skill-evals.ts` | NEW: one definition of what an eval asset is, shared by two commands |
| `src/cli/evals-command.ts` | NEW: `planEvalsFor` + `runEvals`, the assembly shared by the port and the subcommand |
| `src/cli/gantry-views.ts` | `planEvals` |
| `src/tui/store.ts` | `PromptSlot`, renamed prompt actions, the `:evals` palette command |
| `src/tui/components/PromptPane.tsx` | NEW, replaces `OptimisePane.tsx` |
| `src/tui/app.tsx` | the `r` pre-flight, the palette action, the render branch |
| `tests/acceptance/m10.test.ts` | one named case per exit-criterion clause |

---

## Tasks

### Task 1: The spec amendments this plan builds against

**Scope.** Every row of the table above, in `requirements.md`, `design.md`, `design_tui.md`, `index.md` and `CLAUDE.md`. Write R3.11, R6.13, R11.22 and R12.9 in the register the surrounding requirements use, each naming the decision it derives from and, where the check is not self-evident, how to verify it. Add the M10 ownership row and its exit criteria.

**Verify.** `pnpm vitest run tests/specs` passes with the four new ids owned exactly once, and every `§n` this plan cites resolves to a section that exists.

### Task 2: Probe upstream, then catalogue skill-upper

**Scope.** Confirm `skills/skill-upper/SKILL.md` exists in `alibaba/skill-up` at `v0.7.0`; if not, find the earliest tag that carries it and record the deviation below. Add the catalogue entry: `stage: null`, `runtime: 'git'`, `install: { kind: 'git-skill', repo: 'alibaba/skill-up', pin: '<tag>', skills: ['skill-upper'] }`, `versionArgv: []`. Make `GitSkillSpec.requirements` optional.

The pin is the skill-up release tag rather than a commit sha, unlike SkillHone's. Guidance that documents flags the locked binary does not have is worse than guidance that lags a skill fix, and one pin for both halves of one upstream project cannot drift against itself.

**Verify.** `tests/core/catalogue.test.ts`: the entry is present, `stage` is null so `stageToolsFor` can never return it, and the pin matches the skill-up adapter's manifest pin.

### Task 3: A git-skill bundle with no dependencies

**Scope.** In `git-skill.ts`, skip `uv venv` and `uv pip install -r` when `spec.requirements` is absent, and skip `verifyGitSkill`'s interpreter probe on the same condition. Record `bin` as the linked skill directory inside the clone (`repo/skills/<first skill>`) when there is no interpreter: a path verification can check and the prompt can name. Everything else in the driver is untouched, including the refusal to overwrite an unmanaged link, the pre-clone check, the per-skill symlink, the HEAD-matches-pin verification, and the uninstall that removes exactly the links it made.

**Verify.** `tests/core/git-skill.test.ts`: a spec with no `requirements` installs, links and verifies with no `uv` invocation reaching the injected `Exec`; one with requirements is unchanged; uninstall leaves no link behind.

### Task 4: Setup installs skill-upper with skill-up

**Scope.** In `setup.ts`, add skill-upper to the install set whenever skill-up is in the selection, and only then. It never enters `stageTools`: `stageToolsFor` already filters through the adapter registry, and `stage: null` is what keeps the wizard from writing it there.

**Verify.** `tests/core/setup.test.ts`: selecting skill-up installs both, deselecting it installs neither, and `stageToolsFor` output is unchanged in both cases.

### Task 5: Doctor reports the three states and names the fix

**Scope.** Add `skill-link-unmanaged` to `ToolDriftKind`, outside `FAILING`. The two failing states need no new code. A catalogued, selected tool with no lock entry is already `unlocked`, and a dangling link already fails `verifyGitSkill` into `unverifiable`. The new one fires when a runtime skills directory holds the skill through a link SkillGantry did not create, and its detail names the link, its target, and that removing it and re-running `skillgantry setup` puts the pinned copy in place.

Non-failing, because a foreign copy works: the agent has skill-upper, just not ours. Failing the report on a machine that is fine is how a doctor report stops being read.

**Verify.** `tests/core/doctor.test.ts`: the three states from one fixture home, `report.failed` false for the unmanaged case and true for the other two, and no filesystem write in any of them.

### Task 6: The prompt builder

**Scope.** `src/core/stages/eval-prompt.ts`, pure, beside `fix-prompt.ts` and `optimise-prompt.ts`. One module composing all three is what keeps their shared rules from becoming three divergent copies. `buildEvalPrompt(input)` returns a string always, per §9.4a's rule: the trigger is a keystroke, so a refusal is a flash rather than an absent document.

The body names the skill directory, the repo root, `SKILL.md`, the declared version, the eval assets found under `evals/` or their absence, the locked skill-up binary and pin, and the skill-upper location. Then any missing dependency, before the task. Then the task: use skill-upper, author `evals/eval.yaml` and one case per behaviour under `evals/cases/<case-id>.yaml`, validate, stop and report. Then the constraints. The argv line and the declared artefact name are read from the skill-up manifest rather than written out, so a pin bump moves the prompt with it, per §9.4's rule that artefact names come from the manifest and not from a directory listing.

Four constraints are load-bearing and each names why in the body: the suite's exact path, because the adapter's argv is fixed; the case layout, because a failing case is filed as an issue pathed at that file; `--format json`'s `v1alpha1` report, because that is what the shared parser reads; and `rule_based` over `agent_judge`, because the suite runs on every evaluate gate. Two more repeat rules the other prompts already carry: no write under `*-workspace/` or `.skillgantry-workspace/`, and no edit to anything the skill ships, since adding evals is not fixing a skill and a skill fix is a separate prompt.

No "after" section. The digest consequence of adding `evals/` is the user's business and belongs on a SkillGantry surface, not in the agent's document.

Its install argument is plain fields rather than a type imported from `tools`, so the builder adds no §3 edge, the property §9.4 records as the reason `fix-prompt.ts` lives in `stages` at all.

**Verify.** `tests/core/eval-prompt.test.ts`: bodies with and without an existing suite, the argv line tracking a mutated manifest fixture, a missing `claude` CLI named before the task heading rather than after it, and no path by which a credential value can reach the body.

### Task 7: `planEvalsFor` and `skillgantry evals`

**Scope.** `src/cli/skill-evals.ts` lifts `evalAssetsOf` out of `optimise-command.ts` so both commands share one definition of an eval asset, and adds `hasEvalSuite`, which tests for `evals/eval.yaml` specifically: the file the argv names, not the directory.

`src/cli/evals-command.ts` mirrors `optimise-command.ts`. `planEvalsFor(home, skill)` is the one assembly shared by the port and the subcommand, so the pane and the headless output can never disagree about what was handed over. It reads the lock for skill-up, resolves skill-upper's reachability through `detectSkillDirs(userHome, spec).some(d => d.holds)`, which is true for a managed link and for a foreign one since either means the agent can follow step 1, probes for `claude`, and rejects when skill-up is not locked or skill-upper is reachable nowhere, naming the tool and `skillgantry setup`.

`runEvals` prints the body alone by default so `skillgantry evals declawed | pbcopy` works, and one document under `--json`. Its exit code answers "is there a prompt on stdout", which is `fix`'s and `optimise`'s divergence from R12.2 and for their reason.

**Verify.** `tests/cli/evals-command.test.ts`: prompt on stdout and exit 0; a `--json` document; non-zero with the tool named when skill-up is unlocked and when skill-upper is unreachable; and a repo tree plus sidecar byte-identical before and after every case.

### Task 8: The views port

**Scope.** `planEvals(skillId): Promise<EvalPreviewView>` on `GantryViews`, implemented in `gantry-views.ts` over `planEvalsFor`. `EvalPreviewView` carries the finished body, `hasSuite`, and the missing-dependency list. The port returns the finished document rather than its ingredients, so the pane renders and decides nothing. `tests/helpers/fake-views.ts` gains it.

**Verify.** `pnpm build`, and the boundary test: `src/tui/**` still reaches core only through `src/core/index.ts` and spawns nothing.

### Task 9: One prompt pane, two kinds

**Scope.** `OptimiseSlot` becomes `PromptSlot` with `kind: 'optimise' | 'evals'` and a title. `begin-optimise` / `scroll-optimise` / `end-optimise` become `begin-prompt` / `scroll-prompt` / `end-prompt`, and `end-prompt` clears the mark for the kind's stage. `OptimisePane.tsx` becomes `PromptPane.tsx`, taking its title from the slot. `DiffBody`, shared by `ReviewPane` and `SuppressPane`, is the precedent, and the reason is the one `tokens.ts` records from when five modules each owned severity colour.

Precedence is unchanged. One slot, one render branch, still after `ConfirmPane` and before the setup screen, since neither kind destroys anything.

**Verify.** The M9 optimise cases in `tests/tui/` pass unchanged against the renamed slot, and the pane renders inside its allocation at 80×24 and 50×14 for both kinds.

### Task 10: The pre-flight at `r`, and the palette entry

**Scope.** One async pre-flight in the `r` handler, beside release's and optimise's branches. When `evaluate` is among the wanted stages and exactly one skill is chosen, `planEvals` resolves first:

| Marks | Suite | Behaviour |
|---|---|---|
| `evaluate` ∈ wanted, one skill | present | enqueue exactly as today |
| `evaluate` alone, one skill | absent | open the prompt surface, enqueue nothing |
| `evaluate` with other stages, one skill | absent | refuse and name: `<skill> has no eval suite · unmark the others to compose one` |
| `evaluate` ∈ wanted, several skills | — | enqueue as today |

The enqueue tail of the handler is lifted into a local function so the suite-present path and the ordinary path are one call rather than two copies. Refusing the mixed mark before the run is R4.11's own rule, which requires that rejection before the run starts rather than inside it, and R11.20's principle that the rail refuses what it cannot run.

`:evals` joins `PALETTE_COMMANDS` with a fourth `action` kind beside `screen`, `quit` and `refresh`, and opens the same surface for the selected skill whatever the suite state, which is what makes extending an existing suite reachable. The mark clears whenever the surface closes, copied or cancelled, per §14.10's rule and for its reason: a mark surviving `esc` reopens the pane over whatever has been marked since, with nothing on screen naming the keystroke that would free the user.

**Verify.** `tests/tui/`: the four rows above, the palette entry, the mark cleared on `esc` and on copy, the refusal flash when skill-upper is unreachable, and a suite-present skill still enqueuing with the same batch shape R5.5 defines.

### Task 11: Acceptance and the real install

**Scope.** `tests/acceptance/m10.test.ts`, one named case per exit-criterion clause, over a fixture skill with no `evals/`: the rail mark opens a surface and the queue stays empty; a mixed mark is refused by name; `skillgantry evals` prints the same body and writes not one byte; doctor reports an unmanaged link without failing and without touching it. Extend the `SG_INTEGRATION` matrix with the real clone, so that `alibaba/skill-up` at the pinned tag installs, links and verifies with nothing landing in a user-global location (R3.1).

**Verify.** `pnpm check`, then `SG_INTEGRATION=1 pnpm test:integration`.

---

## Requirement coverage for M10

| Requirement | Task |
|---|---|
| R3.11 skill-upper installed by clone and symlink, never replacing an unmanaged link, verified, and reported by doctor | 2 (catalogue), 3 (driver), 4 (setup), 5 (doctor), 11 (real install) |
| R6.13 the eval bootstrap prompt | 6 (builder), 7 (assembly) |
| R11.22 the terminal surface | 9 (pane), 10 (pre-flight, palette, refusals) |
| R12.9 the headless command | 7 |

**Owned elsewhere but shaped here.** R3.1 (M1) now covers a second `git-skill` install, landing under the tool root and in detected runtime skill directories and nowhere else. R3.5 and R3.8 (M3) gain a catalogue member whose selection follows another tool's. R3.7 (M3) takes a fourth reported condition under its probe-and-report rule. R3.9 (M3) gains a non-failing drift kind. R7.3 (M1) is why the prompt names credential keys and never a value. R11.20 and R11.21 (M5, M9) each take a second member: the rail's refusal vocabulary, and the prompt pane.

## Known gaps carried forward

- **A multi-skill batch is not pre-checked.** Any suite-less skill in it still errors at evaluate, exactly as today. Per-skill bootstrap is per-skill by construction, and N port reads to build N prompts nobody asked for is the wrong trade. `:evals` on the selected skill is the recovery.
- **Guidance is pinned.** A skill-upper fix released between tags does not reach the managed copy until the pin moves. That is the cost of keeping guidance and binary in step, and it is the trade every other pin in the catalogue makes.
- **Nothing verifies what the agent wrote** until the next evaluate run. `skill-up validate` inside the prompt is the cheap first check; the gate is the real one.
- **skill-up still cannot be `skipped` for want of credentials**, which is [plan_m4.md](plan_m4.md)'s gap, untouched. Its engine is declared in the skill's own `eval.yaml` and authenticated by that CLI, so a missing engine lands as `errored`/`missing-artefact`. The prompt names the `claude` CLI when it is absent, which is the part of that gap a prompt can close.

## Self-review

Every requirement in the M10 row maps to a task, and no task says TBD. The one unprobed fact, that `skills/skill-upper` exists at tag `v0.7.0`, is named as such and owned by Task 2, which records a deviation if the probe comes back otherwise. Type signatures crossing tasks (`GitSkillSpec`, `EvalPreviewView`, `PromptSlot`) are stated once and consumed consistently. Eleven tasks, one deliverable: a skill with no evals stops being a gate that errors, and becomes a keystroke that hands over the prompt for fixing it.

## Deviations found while implementing

_None yet._

## Changelog

- 2026-08-10 — revision 1, written against shipped M9.
