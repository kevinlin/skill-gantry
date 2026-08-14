# Fix prompts for stage findings

## Context

Security run `019fcd9e-eb97-775c-b3ec-abfc705ad05b` over `zapac-agent-skills/declawed` failed with two `medium` findings, and SkillGantry gave the user nowhere to go from there. The stage rail says `failed`, the Findings pane lists two lines, and the next step is entirely manual.

The two findings also show why "just apply the fix" is the wrong default:

- `LP3` / `excessive-permission` at `declawed/SKILL.md:1` — "no declared permissions but code capabilities were detected: file_read". The SARIF `properties.remediation` says add a `permissions` frontmatter field. That field is not in the Agent Skill frontmatter schema, so writing it risks failing the validate stage.
- `MP2` / `prompt-injection` at `declawed/scripts/scan.py:34` — "Context Window Stuffing". The SARIF `properties.finding` is a run of 42 spaces; the line is alignment whitespace inside a `re.VERBOSE` regex. False positive.

Two of two findings are unsafe to apply mechanically. So the deliverable is a generated coding-agent prompt, not a fixer: SkillGantry writes the prompt, the agent judges and edits, the user re-runs the stage.

The prompt points at the tool's own report rather than duplicating it. That is load-bearing, not just tidy. `RawFinding` ([types.ts:140-149](src/core/types.ts#L140-L149)) is a closed six-field record and the shared SARIF parser ([sarif.ts:15-32](src/core/adapters/sarif.ts#L15-L32)) does not even type `properties`, so `remediation`, `explanation`, `confidence` and `code_snippet` are dropped on the way in. The raw `findings.sarif` is on disk beside `stage.json`. Pointing at it keeps that evidence reachable without widening the adapter contract, the ledger, or `RawFinding`.

Scope, already decided: prompt only (SkillGantry never writes the user's repo for this); both TUI and headless; one prompt per stage that produced findings; written to the sidecar automatically, with an OSC-52 clipboard key in the TUI and the path always shown as the fallback.

## Design

### The builder lives in `stages`, and design §3 does not change

`src/core/stages/fix-prompt.ts`, a pure function:

```ts
export interface FixPromptInput {
  skill: SkillRef            // the user's real skill — never the candidate or the sandbox
  runId: string
  stageDir: string           // absolute <run>/NN-<stage>
  skillDigest: string
  git: { commit: string | null; dirty: boolean }
  result: StageResult
}
/** Null when no tool run reported a finding — the trigger, in the one pure place. */
export function buildFixPrompt(input: FixPromptInput): string | null
```

- `workspace` is excluded by §3's own rule — it owns fs, so it must not own decisions, and a template full of judgement instructions is a decision. It gets a four-line `writeFixPrompt` and nothing else.
- `adapters` is excluded by R4.1: manifests, `parse`, and the shared parsers R4.4 puts there. Its value is depending on nothing.
- A thirteenth module is excluded because a §3 row records a dependency edge and an I/O ownership, and this adds neither that `stages` does not already have. `stages` is already `Owns I/O: —`.
- `stages` is the only home that adds no edge. The builder wants `getAdapter(toolId)?.manifest.artefacts` so it can name `findings.sarif` by its declared name rather than listing a directory, and `stages` already depends on `adapters`. Putting it in `workspace` would force `workspace → stages` and `workspace → adapters`.
- `pipeline` composes: it already depends on both.

One path helper beside `stageDirFor` in [layout.ts:23-25](src/core/workspace/layout.ts#L23-L25), which has `STAGE_ORDER` in scope, so three callers cannot disagree about the filename:

```ts
export const fixPromptPathFor = (runDir: string, stage: Stage): string =>
  join(stageDirFor(runDir, STAGE_ORDER.indexOf(stage) + 1, stage), 'fix-prompt.md')
```

Re-export from [src/core/index.ts](src/core/index.ts) beside `STAGE_ORDER` — `src/tui/**` may reach core only through that file.

### The prompt

Sections, in order. Values in brackets come from `FixPromptInput`.

1. **Title** — `# Fix the <stage> findings on <skill.id>`, then one line stating the stage outcome, the finding count and the highest severity (`maxSeverity`, [types.ts:19-21](src/core/types.ts#L19-L21)).
2. **Where things are** — a two-column table: skill dir (`skill.dir`), repo root (`skill.repo.path`), commit + `(clean)` / `(dirty — uncommitted changes present)` (row omitted entirely when `git.commit === null`), skill digest, run id, absolute `stage.json` path.
3. **Tool reports** — one bullet per tool run: `<toolId> <version> (<analysisMode>)` and the absolute path of each declared artefact, `join(toolRun.artefactDir, name)` for `name` in the adapter manifest's `artefacts`. `artefactDir` is already absolute ([stages/types.ts:67](src/core/stages/types.ts#L67)). Falls back to naming `artefactDir` when no adapter is registered. A tool run that errored with no findings gets a line saying so, so the agent knows the picture is partial.
4. **Findings table** — `# | Severity | Rule class | Native id | Location | Message`. Locations are repo-relative (`path:line`, or `path` alone when `line` is absent — it is optional). Messages are table-escaped: `|` → `\|`, newlines → spaces. One sentence after the table noting that SARIF locations are skill-relative while these are repo-relative.
5. **Do this** — six numbered instructions, all constant text:
   1. Read the tool report before the table. Name `properties.explanation`, `.remediation`, `.confidence`, `.code_snippet` and say why they are missing from the table.
   2. Judge each finding into one of three: correct and worth fixing; correct but the suggested fix does not apply here; false positive.
   3. Fix only what was judged correct, smallest change that removes the cause.
   4. Stop and report rather than edit correct code — an open finding beats a quietly broken skill.
   5. Never write under `*-workspace/` or `.skillgantry-workspace/`; that is the run evidence this prompt points at.
   6. Re-verify with the exact `skillgantry run <skill.id> --stage <stage>` line, noting that a deliberately unfixed finding staying open is expected.
6. **Report back** — one line per finding: number, judgement, what changed or why not.

### Where the file goes

`fix-prompt.md`, beside `stage.json` in the stage directory. Per stage, not per tool — a fan-out security stage with two scanners is one job for the agent.

Design §9's tree ([design.md:577-598](design.md#L577-L598)) gains one line:

```
        03-security/
          stage.json
          fix-prompt.md                ← only when the stage produced a finding
          skillspector/  stdout.log  stderr.log  findings.sarif
```

**Trigger:** `buildFixPrompt` returns `null` unless `result.toolRuns.some(r => r.findings.length > 0)`. Findings-based, not outcome-based, because §8.1 row 12b keeps sub-floor findings and passes the tool, and those findings are still filed as issues — a `passed` stage with two `low` findings gets a prompt.

**One hook**, in [run.ts:447](src/core/pipeline/run.ts#L447) right after `writeStageJson(stageDir, result)`:

```ts
await writeStageJson(stageDir, result)
// The prompt names where a coding agent should edit, so it takes `input.skill`
// and not `ctx.skill`: the latter points into the mutation sandbox or into the
// materialised candidate's temp dir, neither of which survives this call.
const prompt = buildFixPrompt({ skill: input.skill, runId: id, stageDir, skillDigest: digest, git, result })
if (prompt !== null) await writeFixPrompt(stageDir, prompt)
```

The sandbox-open-failure path at [run.ts:389](src/core/pipeline/run.ts#L389) is deliberately **not** hooked: `abortedStage` is called there without `executed` ([run.ts:110-137](src/core/pipeline/run.ts#L110-L137)), so its single synthetic tool run carries `findings: []` by construction. A second hook there would be dead code a later reader would "fix" into something wrong. The catch path at [run.ts:410-439](src/core/pipeline/run.ts#L410-L439) *does* pass `executed`, so a row-3b abort whose tools already reported findings still writes a prompt — through `:447`, the same hook.

`writeFixPrompt(stageDir, body)` goes in [writer.ts](src/core/workspace/writer.ts) beside `writeStageJson` ([:68-86](src/core/workspace/writer.ts#L68-L86)): `mkdir` + `writeFile`, no decisions.

### The headless subcommand

```
skillgantry fix <skill> [--stage <stage>] [--run <id>] [--json]
```

`src/cli/fix-command.ts` exporting `runFix(deps, selector, opts): Promise<number>`, wired in [run-command.ts](src/cli/run-command.ts) beside `recover` ([:235-243](src/cli/run-command.ts#L235-L243)), following the `runRelease`/`runRetire` idiom of returning an exit code the action assigns to `program.exitCode`.

- **Skill** via the existing `selectSkill(deps.home, selector)` ([run-command.ts:63-70](src/cli/run-command.ts#L63-L70)).
- **Run**: `--run <id>`, else the greatest run id from `readIndex(skill.workspacePath)` — already exported from `src/core/index.ts` and already the idiom in [views.ts:53-58](src/tui/views.ts#L53-L58). Not the `latest` symlink (absent mid-write), and not the ledger's `runs.sidecar_path`: R8.2 makes the sidecar the evidence, the command already names its skill so no cross-skill query is needed, and a run whose ledger row failed still has complete evidence on disk. Opening the ledger buys nothing here.
- **Emission**: read `fixPromptPathFor(runDir, stage)`. If the file is absent but that stage's `stage.json` carries findings, regenerate in memory from `stage.json` + `run.json` + the resolved `SkillRef`, marked `onDisk: false`. The command never writes — the pipeline stays the only writer. This is what makes it answer for run `019fcd9e`, which predates the feature.
- **Stage scope**: `--stage` validated against `STAGES` the way `parseStages` does ([run-command.ts:94-100](src/cli/run-command.ts#L94-L100)); a stage absent from the run throws naming it. No `--stage` with exactly one prompted stage prints that one; with more than one, print `<stage>  <path>` per line plus `pass --stage <name> to print one` — the refuse-on-ambiguity shape `resolveSkill` already uses.
- **Output**: default prints the body alone, so `skillgantry fix declawed --stage security | pbcopy` works. `--json` prints one document (like `doctor --json`, not `run`'s ndjson — there is no event stream): `{ skillId, runId, runDir, prompts: [{ stage, path, onDisk, findings, highestSeverity, body }] }`.
- **Exit codes**: `0` when something actionable was produced; `1` when the run resolved and nothing in scope carried a finding, printing `no findings in run <id> — nothing to fix`. Unknown skill / run id / stage rejects and reaches [src/cli/index.ts:5](src/cli/index.ts#L5) like every other command's errors. The code answers "is there a prompt on stdout", not "did the skill pass" — a deliberate divergence from R12.2's meaning for `run`, since a clean skill is not a failure here.

### The TUI action

**`y` on the Work screen, acting on the lifecycle rail's selected stage.** `y` is unbound today (verified against [app.tsx](src/tui/app.tsx) and [Help.tsx:19-37](src/tui/components/Help.tsx#L19-L37)) and is the vim yank verb.

The rail's stage, not a Findings-pane selection: the pane has no per-finding cursor ([OutputPane.tsx:134-153](src/tui/components/OutputPane.tsx#L134-L153)), and `SkillRow.findings` accumulates across every stage of the run ([store.ts:404](src/tui/store.ts#L404)), so a finding on screen cannot be attributed to a stage. The rail already carries a selection moved by `h`/`l` ([app.tsx:496-503](src/tui/app.tsx#L496-L503)), so `y` works from any output tab.

Placed in `useInput` as a new block immediately before the `r` handler at [app.tsx:510](src/tui/app.tsx#L510) — after the Work gate at `:479`, so every documented modal still wins and nothing above it moves.

| State | Result |
|---|---|
| no selected skill | nothing |
| `SkillRow.runDir === null` | flash `no run this session — skillgantry fix <skillId> --stage <stage>` |
| selected stage reported 0 findings | flash `<stage> found nothing — no prompt` |
| file missing (`ENOENT`) | flash `not written yet · <path>` |
| ok | write the OSC-52 sequence, flash `copied · <path>` |
| body over the size cap | flash `too large to copy · <path>` — never claims a copy that did not happen |

One new store field: `StageCell` ([store.ts:69-73](src/tui/store.ts#L69-L73)) gains `findings: number`, initialised `0` in `emptyStages` and set in the `stage:done` case ([store.ts:408-411](src/tui/store.ts#L408-L411)) from `event.result.toolRuns`. `stage:done` already carries the whole `StageResult`, so no event contract changes.

**The OSC-52 write belongs in `src/tui/`.** The escape must reach the terminal Ink currently owns — alternate screen, raw mode, the stream Ink was constructed with. `src/cli/tui-command.ts` hands control away at `startTui` and has no live handle on the keystroke. The lint rules ban `console`/`process.exit` in **core**, not stdout writes in the renderer; writing stdout is what `src/tui/` is. Split so the encoding is testable without a terminal:

- `src/tui/osc52.ts` — pure: `` `]52;c;${Buffer.from(text, 'utf8').toString('base64')}` ``, returning `null` above a size cap. UTF-8 explicitly, not `binary` — a non-ASCII character in a finding message would otherwise corrupt the payload.
- `app.tsx` — `const { stdout } = useStdout()` then `stdout.write(seq)`. **Not** Ink's `write()` helper from the same hook: that writes above the app and forces a clear-and-re-render, flickering the frame for a sequence that renders nothing.
- `readFixPrompt(path)` in [views.ts](src/tui/views.ts) beside `loadSkillMd` ([:16-22](src/tui/views.ts#L16-L22)) and `listArtefacts` ([:25-41](src/tui/views.ts#L25-L41)) — the TUI's existing fs corner. Async, so the handler dispatches the flash on resolution, the shape `views.applyConfig` already uses at [app.tsx:276-289](src/tui/app.tsx#L276-L289).

**The path is surfaced at zero row cost (§14.1).** `AppState` gains `flash: string | null`; [Work.tsx:75](src/tui/components/Work.tsx#L75) passes `state.flash ?? HINTS` to `StatusBar`. The footer already occupies that row on every screen, so the budget is unchanged. The flash is cleared by the next keypress — a `clear-flash` dispatch as the first statement in `useInput` when `state.flash !== null`, no timer, which keeps the TUI tests deterministic. The path is cut with `truncateMiddle` ([layout.ts:188](src/tui/layout.ts#L188)) so the basename survives.

**The Findings pane gets no footer row.** `outputWindow()` ([rows.ts:64-77](src/tui/rows.ts#L64-L77)) is the single derivation the pane renders against and the key handler clamps against, and it already spends rows on `overflow` and `dropped`. A third footnote would have to be threaded through it and would cost the findings list a row on every render — paying the budget permanently for a static hint, which is what §14.1's first rule exists to stop.

**`HINTS` ([Work.tsx:13](src/tui/components/Work.tsx#L13)) is left alone.** It is already six pairs at 55 columns and [StatusBar.tsx:28](src/tui/components/StatusBar.tsx#L28) drops the version when hints + version exceed the width. A seventh pair would truncate the keys, the exact defect that comment records. Discoverability comes from the documented second tier: one row in `Help.tsx`'s `KEYS`, `['y', 'Work: copy the fix prompt for the selected stage']`. That takes `KEYS` to 18; the budget at 80×24 is 19 ([Help.tsx:59](src/tui/components/Help.tsx#L59)), and at 50×14 it already overflows and reports it.

## Spec amendments

Amend in this branch — the specs are the source of truth and code follows them.

**requirements.md** — preamble gains a revision-9 sentence. Three ids, each declared at the **end** of its section, because ranges expand in declaration order and an id inserted inside `R6.1–R6.6` or `R12.1–R12.3` would be silently swallowed by M1's range.

- **R6.10**, after R6.8 ([:122](requirements.md#L122)) — a stage that produced at least one finding MUST write a coding-agent fix prompt beside its `stage.json` naming the skill dir, repo root, commit and dirty flag, digest, every tool report, the `stage.json`, and each finding's severity / rule class / native id / location / message; MUST instruct the agent to read the tool's report before editing and judge each finding's validity; MUST instruct it to stop and report rather than change code it judges correct; MUST forbid any write under a workspace directory. SkillGantry MUST NOT apply the prompt itself. *Rationale:* the six-field record drops the SARIF `properties` a scanner uses to explain and qualify a finding, and both findings in run `019fcd9e` were unsafe to apply. *Verify:* a zero-finding stage writes none; a row-12b `passed` stage writes one; the prompt names the real skill dir rather than a materialised candidate.
- **R11.9**, after R11.8 ([:216](requirements.md#L216)) — the Work screen MUST offer one key that copies the selected stage's fix prompt via OSC 52 and MUST display the path whether or not the copy was emitted, naming which of the three unavailable cases applies; the action MUST NOT change any panel's row allocation. *Rationale:* Terminal.app and tmux without passthrough ignore OSC 52 silently, so an action reporting only success is one a user cannot trust.
- **R12.6**, after R12.5b ([:225](requirements.md#L225)) — a fix prompt MUST be obtainable headlessly for a recorded run, defaulting to the most recent finalised run and accepting an explicit run id and stage; MUST NOT write to the repo or the sidecar; its exit code MUST report whether a prompt was produced, not whether the skill passed. *Rationale:* R12.2 binds `run`'s code to stage outcomes, and reusing that meaning would make a clean skill indistinguishable from a failed lookup.

**Milestone ownership** ([:254](requirements.md#L254)) — M6's row becomes `R6.10, R7.6, R8.9, R11.3, R11.7, R11.8, R11.9, R12.6`, exit criteria extended by one clause. M6 is the precedent: rev 8 extended this same shipped row with R11.7/R11.8. Appending leaves M1's `R6.1–R6.6` and `R12.1–R12.3`, M2's R11 ranges and M3/M5's explicit R12 ids untouched.

**design.md**

| Section | Change |
|---|---|
| §9 tree ([:577-598](design.md#L577-L598)) | add the `fix-prompt.md` line |
| new §9.4 "Fix prompt" | `*Satisfies R6.10.*` — filename, findings-based trigger, why row 12b counts, why it points at the report, why `input.skill` and not `ctx.skill` |
| new §14.3 "Copying a fix prompt" | `*Satisfies R11.9.*` — `y`, its place in the precedence order, the OSC-52 sequence and why the write lives in `src/tui/`, the StatusBar flash, why the Findings pane gains no footnote |
| §15 ([:1201-1213](design.md#L1201-L1213)) | label gains `R12.6`; command block gains the `fix` line; a paragraph on the exit-code divergence and on resolving from the sidecar rather than the ledger |
| §16 | four new rows |
| §17 ([:1277](design.md#L1277)) | `R6 artefacts` → `9, 9.1, 9.2, 9.4` |
| §3 | **no change** — the point of choosing `stages` |
| new §18.4 | one row, matching §18.1–§18.3's shape |

Note: the traceability test collects design claims into a `Set` ([traceability.test.ts:65-73](tests/specs/traceability.test.ts#L65-L73)), so it enforces at-least-one claiming section, not exactly one. Exactly-one is enforced for milestone ownership alone ([:47-58](tests/specs/traceability.test.ts#L47-L58)).

## Tests

| Target | Method | Guards |
|---|---|---|
| `buildFixPrompt` | `tests/core/fix-prompt.test.ts`, pure, over a fixture `StageResult` modelled on `019fcd9e` (skillspector 2.5.1, LP3 + MP2, both `medium`) | every mandated element present — skill dir, repo root, commit + dirty, digest, the `findings.sarif` path, the `stage.json` path, one table row per finding, the four constant instructions, the exact re-verify line; `null` for a zero-finding result; non-null for a row-12b `passed` stage; a message containing `\|` does not break the table; the Commit row is absent for a non-git repo |
| the trigger, through the pipeline | `tests/core/pipeline-fix-prompt.test.ts`, `tests/helpers/fake-executor.ts` | zero-finding stage writes no `fix-prompt.md`; one-finding stage writes exactly one beside `stage.json`; the `:389` sandbox-failure path writes none; a row-3b abort whose tools had reported findings still writes one via `:447`; the prompt names `input.skill.dir`, not the materialised-candidate temp dir |
| `skillgantry fix`, in process | `tests/cli/fix-command.test.ts` — `buildProgram` with a collecting `deps.write` over a fabricated sidecar (`tests/helpers/tmp-repo.ts`) | default picks the greatest run id from `index.ndjson`; `--run` overrides; `--stage` restricts; two prompted stages with no `--stage` list rather than concatenate; a clean run exits 1 saying why; unknown run id fails naming it; `--json` parses as one document; a missing file with a findings-bearing `stage.json` regenerates marked `onDisk: false`; **the sidecar is byte-identical afterwards** |
| `skillgantry fix`, second process | `tests/helpers/child.ts` | R12.6's exit-code contract survives [src/cli/index.ts:6](src/cli/index.ts#L6) — 0 with a prompt, 1 on a clean run — which asserting on `program.exitCode` in process cannot prove |
| the `y` binding | `tests/tui/fix-prompt-key.test.tsx`, `renderInk`, fake queue pushing `run:start` then `stage:done` with two findings, real temp `fix-prompt.md` | frames contain `]52;c;` + the base64 of the file's bytes (`FakeStdout.write` records every write); the StatusBar shows the path; the frame's row count is unchanged by the keypress; `runDir` null gives the CLI fallback and writes no escape; zero-finding stage writes nothing |
| `osc52` | `tests/tui/osc52.test.ts`, pure | exact byte shape `ESC ] 52 ; c ; <base64> BEL`; UTF-8 so a non-ASCII message round-trips; oversized returns `null` so the caller cannot report a copy that never happened |
| traceability | `tests/specs/traceability.test.ts`, unchanged | run it **immediately after the requirements edit, before the design edit**, so a range that swallowed a new id fails rather than assigning a wrong owner |

## Sequencing

1. Specs first — requirements.md, then `pnpm vitest run tests/specs`, then design.md.
2. `fixPromptPathFor` in `workspace/layout.ts`; export from `core/index.ts`.
3. `stages/fix-prompt.ts` + its unit test. (Independent of 2.)
4. `writeFixPrompt` in `workspace/writer.ts`; hook at `run.ts:447`; pipeline test. (Needs 3.)
5. `cli/fix-command.ts` + wiring + both CLI tests. (Needs 2, 3, 4.)
6. TUI: `osc52.ts`, `views.readFixPrompt`, `StageCell.findings` + `AppState.flash` in `store.ts`, the `y` block in `app.tsx`, `Work.tsx`'s StatusBar argument, one `Help.tsx` row, both TUI tests. (Needs 2, 4.)

Steps 5 and 6 are independent of each other.

## Verification

End to end, against the real repo that produced the motivating run:

```bash
pnpm check                       # lint && build && test && acceptance

# regenerate for the historical run — proves the no-file path
pnpm build && node dist/cli/index.js fix declawed --stage security --run 019fcd9e-eb97-775c-b3ec-abfc705ad05b

# a fresh run writes the file at the source
node dist/cli/index.js run declawed --stage security
ls ~/…/declawed-workspace/skillgantry/runs/<new>/03-security/fix-prompt.md

# clean run: no prompt, exit 1
node dist/cli/index.js fix <a-skill-with-no-findings>; echo $?

# sidecar untouched by the read path
shasum -a 256 -r <run>/03-security/*  > /tmp/before
node dist/cli/index.js fix declawed --stage security > /dev/null
shasum -a 256 -r <run>/03-security/*  | diff - /tmp/before
```

Then in the TUI: run `security` on `declawed`, press `y` on the rail's Security cell, confirm the status row shows `copied · …/03-security/fix-prompt.md`, paste into a coding agent and check it reaches the SARIF. Press `y` with no run started this session and confirm the fallback names the CLI command. Resize to 50×14 and press `y` again to confirm the frame's row count is unchanged.

## Deviations found while implementing

| Planned | Shipped | Why |
|---|---|---|
| `buildFixPrompt` reads the registry directly | `FixPromptInput` gains an optional `lookup` | Matches `AdapterStageExecutor`'s existing seam, and lets the no-adapter branch be tested without registering a fake adapter |
| `fix-command.ts` mirrors the stage-directory numbering | `stageDirFor` exported from `src/core/index.ts` and reused | The plan's own reason for `fixPromptPathFor` — three callers must not disagree — applies to the directory name as much as the filename |
| The `y` handler dispatches its failure through `fail` | Dispatches a flash naming the error | `fail` is scoped inside the views effect, and R11.9 wants the reason on the status row rather than in `viewError` |
| — | `tests/cli/fix-exit-code.test.ts` spawns its own child rather than using `tests/helpers/child.ts` | That helper returns stdout and rejects on a non-zero exit, which is exactly the signal R12.6's second case has to observe |
| The prompt lists tool reports only | A tool that errored with no findings also gets a line saying the picture is partial | A degraded fan-out stage otherwise hands the agent a findings table that silently omits a scanner's whole contribution |

One pre-existing flake seen while verifying, unrelated to this branch: `tests/core/spawn.test.ts > kills the whole process tree on timeout` fails intermittently under a full parallel run when the grandchild has not yet written its pid file, and passes standalone.

## Changelog

- 2026-08-14 — **The prompt now tells the agent how to accept a false positive (R6.14).**

  **The gap.** The prompt asks the agent to sort each finding into one of three classes: correct and worth fixing, correct but the tool's suggested fix does not apply here, or a false positive. It then gives an action for the first class only. The other two get "stop and report". So every false positive cost the maintainer a full manual round trip: read the agent's report, re-run the stage, watch the same finding come back, accept it by hand.

  `skillgantry suppress` has done that accept since M8. It creates the detecting tool's own suppression file when it is missing, prints the diff, and lands the change through one atomic rename. The prompt simply never mentioned it. Nothing about that write path changed here. It belongs to [plan_m8](plan_m8-suppress-finding.md), and honouring the file on the next run belongs to [plan_m6.3](plan_m6.3-respect-skillspector-baseline.md). All that changed is that the prompt now names the command.

  **What the prompt emits.** For each finding whose detecting tool declares a suppression file, one ready-to-run line with the rule id and path already filled in and only the reason left as a placeholder:

  ```
  - finding 2 — `skillgantry suppress zapac/declawed --tool skillspector --rule 'MP2' --path 'declawed/scripts/scan.py' --reason '<why this finding is wrong>' --yes`
  ```

  Findings whose tool declares no such file are named separately, as ones the prompt cannot record.

  Three decisions behind that shape are worth keeping.

  1. **It keys on the detecting tool, not on the stage.** R4.16 makes the suppression file an optional manifest declaration, and only skillspector declares one today. Run `skillgantry suppress` against a tool that declares none (skill-scanner, skill-up, skill-lint) and it exits non-zero having written nothing. A single blanket instruction in the prompt would therefore hand the agent a command that fails for most tools, which is why the block is generated per finding from the manifest rather than written as constant text. Nothing in any prompt branches on the stage.
  2. **One entry per confirmed finding, never a wholesale baseline.** A scanner's own `baseline` subcommand rewrites the file from everything it currently reports, including the true positives the agent has not fixed yet. An instruction that said only "create a baseline" would invite exactly the write that buries real defects behind a passing gate, so the prompt spells out the per-finding command and says not to run the tool's own.
  3. **The findings table gained a Tool column.** `RawFinding` carries no `toolId`, and the builder flattens every tool's findings into one list. On a fan-out security stage with two scanners, the merged table therefore left the agent unable to tell which tool's report it was being told to read — even though instruction 1 tells it to read that report first. The builder had the attribution all along; only the rendering discarded it. Recovering it is also what lets each emitted command name the right `--tool`.

  **Where the code lives.** The shared block is `src/core/stages/prompt-parts.ts`, composed by both the fix prompt and the optimise prompt, along with the table-cell escaper and the finding-to-tool attribution both of them render from. `stages` is the one home that adds no §3 dependency edge: it already depends on `adapters` for the manifest, whereas reaching into `suppress/` would have added one. `{skillDir}` resolution moved to `adapters/paths.ts` beside the `BaselineSpec` that defines the vocabulary, so the write path and the prompts substitute through one function — a second substituter is how one comes to print a literal `{token}` at the agent it is instructing while the other writes the real file. Rule 6 is composed from that one module; rules 1–5 and 7 are still honoured per prompt rather than shared, so design §9.4's "one module composes all three" describes rule 6 and the rendering it needs, not yet the whole list. §9.4 gains a seventh shared rule. §9.4b satisfies it vacuously, since the eval bootstrap prompt renders no findings at all. The optimise-prompt half is recorded in [plan_m4.1](plan_m4.1-skillhone-optimise.md).
