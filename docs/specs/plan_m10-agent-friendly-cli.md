# Plan — M10: a headless surface a coding agent can drive

**Date:** 2026-11-12
**Status:** in progress
**Layer:** plan (layer 3 of 3: [requirements](requirements.md) → [design](design.md) → plan)
**Satisfies:** R3.13, R6.15, R12.11–R12.15; R6.12, R6.13, R12.1 as amended in requirements revision 33
**Design:** [design.md](design.md) §5.5, §9.4, §9.4a, §9.4b, §15, §15.1

---

## Why

0.7.0 could be driven from the Work screen and from nowhere else. Run against a real home with three registered repos, the headless commands showed five gaps:

- `skillgantry fix declawed` printed a Node stack trace and exited `1` — the code R12.2 gives a stage that did not pass — because `declawed` is in two repos. The bin entry had no handler; design §15 said it had.
- Nothing listed the skills, a skill's gate state, its open issues, or whether release would refuse. Every one of those was a screen.
- `skillgantry` and `skillgantry setup` threw from inside Ink without a terminal, which is every agent's shell.
- A repo could be registered only through that wizard.
- The three prompts cited `R6.12` and `R6.13` to a reader who cannot resolve them, the optimise prompt read the newest run alone and so dropped the eval evidence recorded a run earlier, and the fix prompt told the agent to stop one line before telling it what to do next.

## The one idea

**`status` is the document an agent reads between commands, and it answers from release's own code.**

An agent does not need more commands so much as a way to learn what the last one meant. `status` gives it the current digest, each gate's verdict and whether that verdict is about today's bytes, the open issues, every refusal release would meet, and the ordered commands that remove them. The refusals come from `gatherReleasePreconditions`, which `release-stage.ts` now calls instead of assembling the same inputs inline — one gathering, so a status that says ready and a release that refuses cannot both be right about the same tree.

It says ready *to attempt*. The target version, the archive path and the sandbox are decided only once a version is supplied, so `unchecked` names them instead of `ready` covering for them.

Everything else follows from the reader being a program:

1. **`2` means the request could not be carried out**, `1` that it ran and the answer was no. One `error:` line, no stack, a JSON document under `--json`.
2. **`run` defaults to the three gates.**
3. **No terminal, no interface**: the root action and `setup` say so and exit `2`.
4. **`repo add`** is the wizard's `registerRepo` without the wizard.
5. **The prompts say why, cite nothing internal, and end on the two commands that close the loop.** Optimise reads each stage's latest verdict across runs.
6. **The package ships a skill that teaches this**, installed by copy behind a checked marker (§5.5).

## Key files

| Concern | File |
|---|---|
| `main()`, the error contract | `src/cli/index.ts`, `src/cli/main.ts` |
| `list`, `status`, `nextSteps` | `src/cli/list-command.ts`, `src/cli/status-command.ts` |
| `gatherReleasePreconditions` | `src/core/release/` , called from `src/core/stages/release-stage.ts` |
| `repo add`, `skill install`, `skill path` | `src/cli/repo-command.ts`, `src/cli/skill-command.ts` |
| `agent-skill-outdated` | `src/core/tools/doctor.ts` |
| Prompt wording, the shared closing lines | `src/core/stages/*-prompt.ts`, `src/core/stages/prompt-parts.ts` |
| Per-stage evidence | `src/cli/optimise-command.ts` |
| The skill | `skills/skillgantry/` |

## Decisions that are not in the design

- **Dependencies moved first, in the same release.** commander 15, ink 8, vitest 5 and eslint 10 land before the surface is built on them. TypeScript stops at the newest release typescript-eslint supports (`<6.1.0`), and `@types/node` stays on 24 because the engine floor does.
- **Not built:** headless tool installation, headless issue triage, and a batch `run` over a repo. Each is written up, with what it would take, in [docs/research/skillops-workflow-review.md](../research/skillops-workflow-review.md).

## Deviations found while implementing

None yet.
