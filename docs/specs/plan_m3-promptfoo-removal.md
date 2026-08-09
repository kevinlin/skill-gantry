# promptfoo Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** revision 1, written against [design.md](design.md) revision 3, [requirements.md](requirements.md) revision 4 and shipped M3.

**Goal:** Drop promptfoo from SkillGantry entirely: catalogue entry, preset membership, driver-test fixture and every spec sentence that promises it. Record why, so the removal reads as a decision rather than an omission.

**Architecture:** No production code path changes shape. `CATALOGUE` loses one element, two install-driver tests re-point their fixture spec at a surviving npm tool, and one integration workaround disappears with the tool that needed it. Everything else is spec text.

**Tech Stack:** unchanged.

**Runs before [plan_m4.md](plan_m4.md).** M4 amends R3.5b to name the adapters it actually ships. Doing that arithmetic against a catalogue that still lists promptfoo would state a number that is wrong the moment this plan lands.

## Why promptfoo is dropped, not deferred

Probed 2026-08-01, promptfoo 0.121.20 installed into a scoped npm prefix.

promptfoo evaluates prompts declared in a `promptfooconfig.yaml`. It has no notion of an agent skill, so the config has to name the prompts, providers and assertions for each skill by hand. Neither reference repo contains one:

```
$ find ~/dev/ai-sdlc/zapac-agent-skills ~/.claude/skills -maxdepth 3 -iname 'promptfoo*'
(no output — 20 skills in one repo, 54 in the other, zero configs)
```

Four skills in `zapac-agent-skills` carry `evals/eval.yaml`, which is skill-up's format. None carries promptfoo's.

That makes promptfoo the one catalogued tool an orchestrator cannot orchestrate. Every other tool takes a skill directory as its only input; promptfoo takes a config the maintainer must author per skill and keep in step with the skill by hand. Shipping its adapter would install a tool, verify it, lock it, offer it in the wizard, and then produce `errored` on every real skill for want of a file SkillGantry is forbidden to write into the skill directory during a read-only stage.

Deferring instead of removing keeps the promise alive in three spec documents and keeps a `PROMPTFOO_CONFIG_DIR` workaround in the integration suite for a tool nothing will ever parse. The decision is that evaluate is served by skill-up, whose reports already exist on disk in the reference repo, and that promptfoo comes back only if a per-skill config convention emerges.

## Global Constraints

Everything in [plan_m1.md's Global Constraints](plan_m1.md), [plan_m2.md's](plan_m2.md) and [plan_m3.md's](plan_m3.md) still holds. These are the additions.

- The removal is complete or it is not done: no production identifier, spec sentence, preset, test fixture or test comment may name promptfoo when this plan finishes, except inside [plan_m3.md](plan_m3.md).
- **[plan_m3.md](plan_m3.md) is not edited.** It is a point-in-time record of what M3 probed and shipped, and rewriting it to hide a tool M3 genuinely installed would make the record lie. Task 1 adds a forward pointer to this document from the decision log instead.
- `docs/research/skillops-lifecycles.md` is not edited either, for the same reason: it is upstream research, not a SkillGantry contract.
- Conventional Commits, lowercase imperative subject describing the behaviour change.

## File structure

```
docs/specs/
  decision-log.md            MODIFIED  D7, D8, environment facts table, new §10
  requirements.md            MODIFIED  R3.5 tool list
  design.md                  MODIFIED  §5.3 preset paragraph
  plan_m3-promptfoo-removal.md  NEW       this file
src/core/tools/
  catalogue.ts               MODIFIED  entry removed
tests/core/
  npm-install.test.ts        MODIFIED  fixture spec re-pointed at skill-lint
  install-dispatch.test.ts   MODIFIED  fixture spec re-pointed at skill-lint
  install.test.ts            MODIFIED  PROMPTFOO_CONFIG_DIR workaround removed
tests/cli/
  setup-command.test.ts      MODIFIED  non-runnable-tool case re-pointed at skill-lint
```

---

## Tasks

### Task 1: Record the decision in the spec layer

**Files:**
- Modify: `docs/specs/decision-log.md:27`, `:29`, `:81`, `:88`, and a new `## 10` section at the end
- Modify: `docs/specs/requirements.md:54` (R3.5)
- Modify: `docs/specs/design.md` §5.3, the presets paragraph
- Test: `tests/core/design-example.test.ts` (existing spec test must still pass)

**Interfaces:**
- Consumes: nothing.
- Produces: the spec text Task 2 deletes code against. No TypeScript symbol.

- [x] **Step 1: Amend D7 in the decision log**

In `docs/specs/decision-log.md`, replace the first line of D7's body:

```markdown
Validate: skill-lint, agentskills. Evaluate: skill-up, promptfoo. Security: skill-scanner (Cisco), SkillSpector (NVIDIA). Optimise: SkillOpt, SkillHone. Release: native, so eight tool adapters in total. Counting vercel `skills`, which the native release stage invokes for its installability check, nine external tools are installed.
```

with:

```markdown
Validate: skill-lint, agentskills. Evaluate: skill-up, promptfoo. Security: skill-scanner (Cisco), SkillSpector (NVIDIA). Optimise: SkillOpt, SkillHone. Release: native, so eight tool adapters in total. Counting vercel `skills`, which the native release stage invokes for its installability check, nine external tools are installed.
*Superseded in part:* five of these eight are not shipping. M3 found agentskills, SkillOpt and SkillHone unpublished in installable form (probe output in [plan_m3.md](plan_m3.md)); promptfoo is removed by §10 below. The catalogue is the record of what exists, not this paragraph.
```

- [x] **Step 2: Amend D8's evaluate policy**

Replace this line in D8's bullet list:

```markdown
- Evaluate: **pick one**: skill-up default, promptfoo selectable.
```

with:

```markdown
- Evaluate: **pick one**: skill-up. The policy is what matters and it is unchanged — two eval harnesses measure different things and averaging their scores is meaningless — but skill-up is the only harness that survived probing, so "pick one" has one candidate. See §10.
```

- [x] **Step 3: Correct the two environment-facts rows**

Line 27, the "Not installed" row, drops promptfoo:

```markdown
| Not installed | `skill-lint`, `skill-scanner`, `SkillOpt`, `SkillHone`, `skillhub`, vercel `skills`, `agentskills` |
```

Line 29, the "Tool languages" row, drops it too:

```markdown
| Tool languages | TS/npm: skill-lint, vercel skills · Go: skill-up · Python/pyproject: skill-scanner, SkillSpector, SkillOpt, SkillHone, agentskills · **Java: skillhub** |
```

- [x] **Step 4: Add the decision as a new section**

Append to `docs/specs/decision-log.md`, after §9:

```markdown
## 10. promptfoo removed from the catalogue

**Date:** 2026-08-02. Supersedes the promptfoo half of D7 and D8.

promptfoo evaluates prompts declared in a per-project `promptfooconfig.yaml`. It has no concept of an agent skill, so a maintainer must author and maintain one config per skill. Probing on 2026-08-01 found zero such configs across both reference repos, 20 skills in `zapac-agent-skills` and 54 in `~/.claude/skills`, while four skills already carry skill-up's `evals/eval.yaml`.

*Why removed rather than deferred:* every other catalogued tool takes a skill directory as its only input, which is what makes a skill orchestrator possible. promptfoo takes a file SkillGantry cannot supply: writing one into the skill directory would be a mutation during a read-only stage, and generating one from `evals/` is a feature no requirement asks for. Its adapter would therefore have installed, verified and locked a tool that reports `errored` against every real skill. Carrying it as "installable, not yet runnable" would have left that promise standing in three spec documents and a `PROMPTFOO_CONFIG_DIR` workaround in the integration suite indefinitely.

*Consequence:* evaluate has exactly one tool, skill-up. D8's pick-one policy is unchanged and is enforced by `AdapterStageExecutor.plan()`, which rejects a selection of more than one tool for a `pick-one` stage regardless of how many candidates exist.

*Reversible:* if a per-skill promptfoo config convention emerges in the skills ecosystem, the tool returns as a catalogue entry plus an adapter, and nothing else about the design has to move.
```

- [x] **Step 5: Amend R3.5's tool list**

In `docs/specs/requirements.md`, R3.5 currently enumerates the eight D7 tools. Replace its first sentence:

```markdown
- **R3.5** SkillGantry MUST ship a catalogue entry for each of the eight tools of D7 — skill-lint and agentskills (validate), skill-up and promptfoo (evaluate), skill-scanner and SkillSpector (security), SkillOpt and SkillHone (optimise) — carrying the install spec, runtime and version argv needed to install, verify and lock it.
```

with:

```markdown
- **R3.5** SkillGantry MUST ship a catalogue entry for each D7 tool that a public index publishes in installable, skill-directory-driven form — skill-lint (validate), skill-up (evaluate), skill-scanner and SkillSpector (security) — carrying the install spec, runtime and version argv needed to install, verify and lock it. A D7 tool that no index publishes, or that cannot take a skill directory as its input, MUST be omitted from the catalogue with its probe output recorded rather than carried as an entry that can only fail.
```

Leave the rest of R3.5 (the adapter-gating sentence, the release-is-native sentence and the rev 4 note) untouched, and append to its rev note:

```markdown
 *(rev 5: agentskills, SkillOpt and SkillHone unpublished — plan_m3.md; promptfoo needs a per-skill config no repo has — decision-log §10.)*
```

- [x] **Step 6: Amend design §5.3's preset paragraph**

In `docs/specs/design.md` §5.3, replace:

```markdown
Presets: **Minimal** is skill-up plus skillspector — the two already present, one evaluate and one security tool. **Recommended** is at most one tool per stage. **Everything** is the whole catalogue. A stage whose D7 candidates are both uninstallable has no tool in any preset; that is visible in the wizard rather than papered over.
```

with:

```markdown
Presets: **Minimal** is skill-up plus skillspector — the two already present, one evaluate and one security tool. **Recommended** is at most one tool per stage. **Everything** is the whole catalogue. A stage whose D7 candidates are all unavailable has no tool in any preset; that is visible in the wizard rather than papered over. Optimise is that stage: both its candidates are unpublished. Evaluate has one candidate rather than two, because promptfoo needs a per-skill config file no skill carries — decision-log §10.
```

- [x] **Step 7: Verify no spec sentence still promises promptfoo**

Run:

```bash
grep -rn "promptfoo\|Promptfoo\|PROMPTFOO" docs/specs/ | grep -v 'plan_m3.md' | grep -v 'plan_m3-promptfoo-removal.md'
```

Expected: only the two intended mentions — decision-log §10 and the D7/D8/§5.3 sentences that explain the removal. No sentence anywhere may still say promptfoo *will* ship.

- [x] **Step 8: Verify the spec test still passes**

Run: `pnpm vitest run tests/core/design-example.test.ts`
Expected: PASS. This test reads `design.md` §7's skillspector example, which Task 1 does not touch; it is run here to prove the edits did not corrupt the document's structure.

- [x] **Step 9: Commit**

```bash
git add docs/specs/decision-log.md docs/specs/requirements.md docs/specs/design.md docs/specs/plan_m3-promptfoo-removal.md
git commit -m "docs: remove promptfoo from the tool catalogue contract

promptfoo evaluates prompts declared in a per-project promptfooconfig.yaml
and has no concept of a skill. Neither reference repo carries one config
across 74 skills, so its adapter would have errored on every real input.
Recorded as decision-log section 10; R3.5 and design 5.3 amended to match.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Remove the catalogue entry and re-point the two driver tests

**Files:**
- Modify: `src/core/tools/catalogue.ts:51-58`
- Modify: `tests/core/npm-install.test.ts:8-14`, `:28`, `:36`, `:46`
- Modify: `tests/core/install-dispatch.test.ts:12-19`, `:28-31`, `:41`, `:47`, `:61`

**Interfaces:**
- Consumes: nothing new. `CATALOGUE`, `ToolSpec`, `NpmInstallSpec`, `npmInstall(dir, spec, exec)`, `installTool(home, spec, options)` all keep their current signatures.
- Produces: a `CATALOGUE` of five entries — `skill-lint`, `skill-up`, `skill-scanner`, `skillspector`, `skills`.

Both driver tests use promptfoo purely as a stand-in npm package with a fake pin and a faked `Exec`; neither reaches the network. They re-point at `skill-lint`, which stays in the catalogue, is genuinely `npm-prefix`, and keeps the fake pin `0.100.0` so the 404 assertion still describes an unobtainable version.

- [x] **Step 1: Run the two driver tests and record that they pass before the change**

Run: `pnpm vitest run tests/core/npm-install.test.ts tests/core/install-dispatch.test.ts`
Expected: PASS, 4 tests. These are the tests Step 3 rewrites; a green baseline is what makes a later failure attributable to the rewrite.

- [x] **Step 2: Delete the catalogue entry**

In `src/core/tools/catalogue.ts`, delete this element of `CATALOGUE` entirely:

```ts
  {
    id: 'promptfoo',
    displayName: 'promptfoo',
    stage: 'evaluate',
    runtime: 'npm',
    install: { kind: 'npm-prefix', spec: 'promptfoo', pin: '0.121.20', binName: 'promptfoo' },
    versionArgv: ['--version'],
  },
```

Then amend the `PRESETS` doc comment, which currently ends:

```ts
 * Optimise has no member: both of D7's optimise candidates are uninstallable.
 */
```

to:

```ts
 * Optimise has no member: both of D7's optimise candidates are unpublished.
 * Evaluate has one candidate rather than two — promptfoo needs a per-skill
 * promptfooconfig.yaml that no skill in either reference repo carries, so it
 * would install and then error on every real input. Decision-log section 10.
 */
```

`PRESETS.minimal` and `PRESETS.recommended` do not name promptfoo and need no edit; `PRESETS.everything` is `catalogueIds()` and follows the array.

- [x] **Step 3: Re-point `npm-install.test.ts` at skill-lint**

Replace the `SPEC` constant and the two assertions that quote the id:

```ts
const SPEC: NpmInstallSpec = {
  id: 'skill-lint',
  kind: 'npm-prefix',
  spec: 'skill-lint',
  pin: '0.100.0',
  binName: 'skill-lint',
}
```

In the first case, the resolved shim and the argv:

```ts
    expect(bin).toBe(join(dir, 'node_modules', '.bin', 'skill-lint'))
    expect(calls[0]?.bin).toBe('npm')
    expect(calls[0]?.argv).toEqual([
      'install',
      '--prefix',
      dir,
      '--no-fund',
      '--no-audit',
      '--loglevel=error',
      'skill-lint@0.100.0',
    ])
```

In the second case, the failure message:

```ts
    await expect(npmInstall(dir, SPEC, exec)).rejects.toThrow(
      /install failed for skill-lint@0\.100\.0: E404/,
    )
```

The pin stays the fictional `0.100.0` deliberately: the real catalogue pin is `0.2.0`, and a test asserting a 404 against a version that exists would start passing for the wrong reason if the shipped pin ever changed.

- [x] **Step 4: Re-point `install-dispatch.test.ts` at skill-lint**

Replace the `NPM_TOOL` fixture:

```ts
const NPM_TOOL: ToolSpec = {
  id: 'skill-lint',
  displayName: 'skill-lint',
  stage: 'validate',
  runtime: 'npm',
  install: { kind: 'npm-prefix', spec: 'skill-lint', pin: '0.100.0', binName: 'skill-lint' },
  versionArgv: ['--version'],
}
```

Rename the shim the fake npm writes, so `verifyTool` finds an executable that answers with a semver:

```ts
    const shim = join(prefix, 'node_modules', '.bin', 'skill-lint')
    await writeFile(shim, '#!/bin/sh\necho "skill-lint 0.100.0"\n')
```

And the three assertions that name the tool:

```ts
    expect(entry.bin.startsWith(join(toolRoot(h), 'skill-lint'))).toBe(true)
```

```ts
    expect(lock.tools['skill-lint']?.bin).toBe(entry.bin)
```

```ts
    expect((await loadToolLock(h)).tools['skill-lint']).toBeUndefined()
```

Note the bracket form: `skill-lint` is not a valid dotted property name.

- [x] **Step 5: Run the two driver tests plus the catalogue suite**

Run: `pnpm vitest run tests/core/npm-install.test.ts tests/core/install-dispatch.test.ts tests/core/catalogue.test.ts`
Expected: PASS. `catalogue.test.ts` asserts preset nesting, unique ids and at most one tool per stage in `recommended`; none of those hold a count, so removing an entry must not disturb them.

- [x] **Step 6: Commit**

```bash
git add src/core/tools/catalogue.ts tests/core/npm-install.test.ts tests/core/install-dispatch.test.ts
git commit -m "feat(tools): drop promptfoo from the catalogue

Its per-skill promptfooconfig.yaml is input SkillGantry cannot supply
without writing into a skill directory during a read-only stage, and no
skill in either reference repo carries one. The two install-driver tests
used it only as a stand-in npm package and now use skill-lint.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Remove the two consumer-side workarounds and prove the removal is total

**Files:**
- Modify: `tests/core/install.test.ts:65-73` (the `PROMPTFOO_CONFIG_DIR` workaround)
- Modify: `tests/cli/setup-command.test.ts:81-89`

**Interfaces:**
- Consumes: `CATALOGUE` of five entries from Task 2; `buildSetupDriver(home)` and `stageToolsFor` unchanged.
- Produces: nothing new.

- [x] **Step 1: Delete the integration-suite workaround**

`tests/core/install.test.ts` sets `PROMPTFOO_CONFIG_DIR` before looping over the catalogue, because promptfoo refuses to open its default database under a test runner. With the tool gone the workaround is dead. Replace the opening of the real-index case:

```ts
describe('installTool against real indexes', () => {
  it('installs every catalogued tool into the tool root and verifies it', async () => {
    // promptfoo refuses to open its default database when it detects a test
    // process, and verifyTool spawns with the ambient environment, so vitest's
    // own markers reach it. Pointing it at a scratch directory is a property of
    // running this under a test runner, not of the driver.
    process.env.PROMPTFOO_CONFIG_DIR = await mkdtemp(join(tmpdir(), 'sg-promptfoo-'))

    for (const spec of CATALOGUE) {
```

with:

```ts
describe('installTool against real indexes', () => {
  it('installs every catalogued tool into the tool root and verifies it', async () => {
    for (const spec of CATALOGUE) {
```

Then remove `mkdtemp` from that file's `node:fs/promises` import and `tmpdir` from its `node:os` import **only if** no other case in the file still uses them. Check first:

```bash
grep -n 'mkdtemp\|tmpdir' tests/core/install.test.ts
```

`home()` in that file is built from `mkdtemp`/`tmpdir`, so both almost certainly stay. Leave the imports alone if the grep shows any surviving use — an unused-import lint error and a wrongly-deleted import are both failures, and the grep distinguishes them.

- [x] **Step 2: Re-point the setup-driver test's non-runnable tool**

`tests/cli/setup-command.test.ts` proves `stageToolsFor` writes only tools the adapter registry knows, using promptfoo as the installable-but-unparsed example. skill-lint is that example until M4 gives it a parser. Replace the case body:

```ts
    await driver.saveSelection(['skillspector', 'skill-lint'])
    await driver.registerRepo(root)

    const config = await loadConfig(h)
    expect(config.stageTools.security).toEqual(['skillspector'])
    // skill-lint installs in M3 and gains its parser in M4, so it must not be
    // selected yet: AdapterStageExecutor.plan() throws on an unknown id.
    expect(config.stageTools.validate).toEqual([])
```

Note the assertion moves from `stageTools.evaluate` to `stageTools.validate`, because skill-lint is a validate tool where promptfoo was an evaluate one.

**This case is scheduled to invert.** [plan_m4.md](plan_m4.md) Task 8 ships skill-lint's parser, at which point `stageTools.validate` becomes `['skill-lint']` and this assertion is rewritten there. It is left as a `[]` assertion here rather than deleted. Deleting it would leave the registry filter untested between the two plans, and that filter is what stops a run failing with `unknown tool`.

- [x] **Step 3: Run the affected suites**

Run: `pnpm vitest run tests/cli/setup-command.test.ts tests/core/setup.test.ts tests/core/doctor.test.ts`
Expected: PASS. `install.test.ts` is excluded from the default run because it needs `SG_INTEGRATION=1`, so Step 1's edit is verified by Step 5, not here.

- [x] **Step 4: Prove the removal is total**

Run:

```bash
grep -rni "promptfoo" src/ tests/ package.json README.md 2>/dev/null
```

Expected: **no output.** Any hit is an incomplete removal — fix it before continuing.

Then confirm the only surviving mentions are the two intentional records:

```bash
grep -rln "promptfoo" docs/ | sort
```

Expected exactly:

```
docs/research/skillops-lifecycles.md
docs/specs/decision-log.md
docs/specs/plan_m3.md
docs/specs/plan_m3-promptfoo-removal.md
```

`skillops-lifecycles.md` is upstream research and `plan_m3.md` is a point-in-time record of what M3 genuinely installed; neither is a contract, and rewriting either would make the record dishonest.

- [x] **Step 5: Run the full gate**

Run: `pnpm check`
Expected: lint, build, test and acceptance all pass.

Then, if network is available:

Run: `SG_INTEGRATION=1 pnpm vitest run tests/core/install.test.ts`
Expected: PASS, five tools installed and verified against real indexes with no `PROMPTFOO_CONFIG_DIR` in sight. If network is unavailable, record that this step was not run rather than reporting it green.

- [x] **Step 6: Commit**

```bash
git add tests/core/install.test.ts tests/cli/setup-command.test.ts
git commit -m "test: drop the promptfoo workarounds its removal made dead

The integration suite no longer needs PROMPTFOO_CONFIG_DIR, and the
setup-driver test uses skill-lint as its installed-but-unparsed example
until M4 ships that parser.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Requirement coverage

This plan owns no requirement. It amends one, R3.5, whose tool list named promptfoo, and that amendment is Task 1 Step 5. Every other change follows from that sentence.

| Touched | Where | Why it is not a requirement change |
|---|---|---|
| D7, D8 | Task 1 Steps 1–2 | Decisions are the layer requirements derive from; §10 supersedes the promptfoo half of both and says so |
| R3.5 | Task 1 Step 5 | The only binding sentence that enumerated promptfoo |
| design §5.3 | Task 1 Step 6 | Preset prose, describing a catalogue that no longer holds the tool |
| `CATALOGUE` | Task 2 Step 2 | The catalogue is the install authority (design §5.1a); this is the removal itself |

R3.8's three presets, R3.9's four drift kinds, R4.7's pick-one policy and R4.10's "no selected tool is silently dropped" are all unaffected: none is expressed in terms of how many candidates a stage has.

## Self-review

**Spec coverage.** One sentence promised promptfoo as a binding requirement (R3.5) and two decisions named it (D7, D8). All three are amended, and the reason is recorded once, in decision-log §10, with the other documents pointing at it rather than restating it.

**Placeholders.** No step says TBD, "similar to", or "handle the rest". Every edit shows the before text and the after text. Every verification step states the command and the expected result, including the two greps whose expected output is nothing.

**Type consistency.** `NpmInstallSpec` and `ToolSpec` keep their shapes; only literal values change. `lock.tools.promptfoo` becomes `lock.tools['skill-lint']` because the new id is not a valid dotted property name — the one place the rename is not mechanical, and Task 2 Step 4 calls it out.

**Scope.** Three tasks. One production file loses seven lines; everything else is spec text and test fixtures. No driver, no adapter, no schema and no CLI surface changes behaviour.

## Deviations found while implementing

Four, all in the plan's own prose rather than in the change it describes. The code and spec edits landed as written.

- **Task 1 Step 1 said "five of these eight are not shipping".** Four do not: agentskills, SkillOpt, SkillHone, promptfoo. Four do: skill-lint, skill-up, skill-scanner, SkillSpector. Written as four.
- **Task 3 Step 4's expected `grep docs/` list named four files; seven carry the word.** It omitted `design.md` and `requirements.md`, which this plan itself amends in Task 1, and `plan_m4.md`, which cites decision-log §10 in its own rev-5 note on R3.5b. All three are correct mentions, so the expectation was wrong rather than the tree.
- **Task 3 Step 4's `grep src/ tests/` expected no output, which its own Task 2 Step 2 makes unsatisfiable** by mandating a `PRESETS` comment that names promptfoo. The check that holds is the one the Global Constraints actually mean: no identifier, string literal, fixture or test comment names promptfoo. Only the two rationale comments do.
- **`CATALOGUE`'s doc comment said "Two of D7's eight tools are absent."** Already wrong at three before this plan, and the removal makes it four. Corrected in the same edit, since the removal is what makes the count visibly wrong. It now names all four and points at the record behind each.

Verified: `pnpm lint`, `pnpm build` and `pnpm acceptance` all pass. `pnpm test` is 337 passed, 1 failed — `spawn.test.ts > kills the whole process tree on timeout`, which fails identically on the base commit under full-suite load and passes on three consecutive isolated runs. Pre-existing timing flake, unrelated to this change. `SG_INTEGRATION=1 pnpm vitest run tests/core/install.test.ts` passes: five catalogued tools installed and verified against real indexes.

## Changelog

- 2026-08-02 — revision 1, written after probing promptfoo 0.121.20 and finding zero per-skill configs across 74 skills in two reference repos.
- 2026-08-02 — shipped. Deviations section added; step checkboxes ticked.
