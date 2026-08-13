# promptfoo Removal Implementation Plan

**Status:** shipped, compacted. Written against [design.md](design.md) revision 3, [requirements.md](requirements.md) revision 4 and shipped M3.

**Goal:** Drop promptfoo from SkillGantry entirely — catalogue entry, preset membership, driver-test fixture and every spec sentence that promises it. Record why, so the removal reads as a decision rather than an omission.

**Architecture:** No production code path changed shape. `CATALOGUE` lost one element, two install-driver tests re-pointed their fixture spec at a surviving npm tool, and one integration workaround disappeared with the tool that needed it. Everything else was spec text.

**Ran before [plan_m4-adapters-and-merge.md](plan_m4-adapters-and-merge.md).** M4 amends R3.5b to name the adapters it actually ships, and doing that arithmetic against a catalogue that still listed promptfoo would have stated a number wrong the moment this plan landed.

## Why promptfoo is dropped, not deferred

Probed 2026-08-01, promptfoo 0.121.20 installed into a scoped npm prefix.

promptfoo evaluates prompts declared in a `promptfooconfig.yaml`. It has no notion of an agent skill, so the config has to name the prompts, providers and assertions for each skill by hand. Neither reference repo contains one — four skills in `zapac-agent-skills` carry `evals/eval.yaml`, which is skill-up's format, and none carries promptfoo's.

That made promptfoo the one catalogued tool an orchestrator cannot orchestrate. Every other tool takes a skill directory as its only input; promptfoo takes a config the maintainer must author per skill and keep in step with the skill by hand. Shipping its adapter would have installed a tool, verified it, locked it, offered it in the wizard, and then produced `errored` on every real skill for want of a file SkillGantry is forbidden to write into the skill directory during a read-only stage.

Deferring instead of removing keeps the promise alive in three spec documents and keeps a `PROMPTFOO_CONFIG_DIR` workaround in the integration suite for a tool nothing will ever parse. The decision is that evaluate is served by skill-up, whose reports already exist on disk in the reference repo, and that promptfoo comes back only if a per-skill config convention emerges.

## Global Constraints

Everything in [plan_m1](plan_m1-engine-and-sidecar.md)'s, [plan_m2](plan_m2-queue-and-tui.md)'s and [plan_m3](plan_m3-tools-module.md)'s Global Constraints still holds. These were the additions:

- The removal is complete or it is not done: no production identifier, spec sentence, preset, test fixture or test comment may name promptfoo when this plan finishes, except inside the two records below.
- **[plan_m3-tools-module.md](plan_m3-tools-module.md) is not edited.** It is a point-in-time record of what M3 probed and shipped, and rewriting it to hide a tool M3 genuinely installed would make the record lie. The decision log carries a forward pointer instead.
- `docs/research/skillops-lifecycles.md` is not edited either, for the same reason: it is upstream research, not a SkillGantry contract.

## Tasks

### Task 1: Record the decision in the spec layer

Amended D7 and D8 in the decision log, corrected its two environment-facts rows, and added the decision as [decision-log.md](decision-log.md) §10 — the one place the reasoning lives, with R3.5 and design §5.3's preset paragraph pointing at it rather than restating it.

### Task 2: Remove the catalogue entry and re-point the two driver tests

`CATALOGUE` dropped to five entries — `skill-lint`, `skill-up`, `skill-scanner`, `skillspector`, `skills`. Both driver tests had used promptfoo purely as a stand-in npm package with a fake pin and a faked `Exec`, so they re-pointed at `skill-lint`, which stays in the catalogue and is genuinely `npm-prefix`. The fictional pin `0.100.0` was kept deliberately: a test asserting a 404 against a version that exists would start passing for the wrong reason if the shipped pin ever changed.

### Task 3: Remove the two consumer-side workarounds and prove the removal is total

`tests/core/install.test.ts` had set `PROMPTFOO_CONFIG_DIR` because promptfoo refuses to open its default database under a test runner; the workaround died with the tool. `tests/cli/setup-command.test.ts` proves `stageToolsFor` writes only tools the adapter registry knows, and promptfoo had been its installable-but-unparsed example — re-pointed at `skill-lint` (and so from `stageTools.evaluate` to `stageTools.validate`) rather than deleted, because deleting it would have left the registry filter untested until [plan_m4](plan_m4-adapters-and-merge.md) Task 8 shipped skill-lint's parser and inverted the assertion. That filter is what stops a run failing with `unknown tool`.

## Requirement coverage

This plan owns no requirement. It amends one, R3.5, whose tool list named promptfoo; every other change follows from that sentence.

| Touched | Why it is not a requirement change |
|---|---|
| D7, D8 | Decisions are the layer requirements derive from; decision-log §10 supersedes the promptfoo half of both and says so |
| R3.5 | The only binding sentence that enumerated promptfoo |
| design §5.3 | Preset prose, describing a catalogue that no longer holds the tool |
| `CATALOGUE` | The catalogue is the install authority (design §5.1a); this is the removal itself |

R3.8's three presets, R3.9's four drift kinds, R4.7's pick-one policy and R4.10's "no selected tool is silently dropped" are all unaffected: none is expressed in terms of how many candidates a stage has.

## Deviations found while implementing

Four, all in the plan's own prose rather than in the change it describes. The code and spec edits landed as written.

- **Task 1 said "five of these eight are not shipping".** Four do not: agentskills, SkillOpt, SkillHone, promptfoo. Four do: skill-lint, skill-up, skill-scanner, SkillSpector. Written as four.
- **Task 3's expected `grep docs/` list named four files; seven carry the word.** It omitted `design.md` and `requirements.md`, which this plan itself amends, and `plan_m4-adapters-and-merge.md`, which cites decision-log §10 in its own rev-5 note on R3.5b. All three are correct mentions, so the expectation was wrong rather than the tree.
- **Task 3's `grep src/ tests/` expected no output, which Task 2 makes unsatisfiable** by mandating a `PRESETS` comment that names promptfoo. The check that holds is the one the Global Constraints actually mean: no identifier, string literal, fixture or test comment names promptfoo. Only the two rationale comments do.
- **`CATALOGUE`'s doc comment said "Two of D7's eight tools are absent."** Already wrong at three before this plan, and the removal made it four. Corrected in the same edit, since the removal is what makes the count visibly wrong. It now names all four and points at the record behind each.

Verified at the time: `pnpm lint`, `pnpm build` and `pnpm acceptance` all passed. `pnpm test` was 337 passed, 1 failed — `spawn.test.ts > kills the whole process tree on timeout`, which failed identically on the base commit under full-suite load and passed on three consecutive isolated runs. Pre-existing timing flake, unrelated. `SG_INTEGRATION=1 pnpm vitest run tests/core/install.test.ts` passed: five catalogued tools installed and verified against real indexes.

## Changelog

- 2026-08-02 — revision 1, written after probing promptfoo 0.121.20 and finding zero per-skill configs across 74 skills in two reference repos.
- 2026-08-02 — shipped. Deviations section added; step checkboxes ticked.
- 2026-08-13 — **Compacted post-implementation.** Removed the step-by-step tasks, before/after edit blocks, verification commands and the self-review. Preserved the goal, the "why dropped not deferred" argument, the global constraints, one paragraph of intent per task, requirement coverage and the deviations. The original is in git history.
