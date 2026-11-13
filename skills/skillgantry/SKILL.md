---
name: skillgantry
description: >
  Drive SkillGantry's headless CLI to fortify an agent skill and get it ready
  to release: run the validate, evaluate and security gates, work through what
  they find, write a missing eval suite, and cut the release. Use when the user
  asks to check, harden, fortify or gate a skill, to fix or triage a skill's
  findings, to see whether a skill is ready to ship, or to release one, and
  whenever they mention skillgantry or SkillOps.
metadata:
  version: 1.1.0
---

# SkillGantry

SkillGantry runs lint, eval and security tools against an agent skill and records what they find. It refuses to release a skill whose gates have not passed against its current files. You drive it from the shell. It never edits a skill for you: it tells you what is wrong, and the fixing is your work.

One command tells you where a skill stands and what to do next:

```bash
skillgantry status <skill> --json
```

Read `next` in that document, do the first entry, and ask again. That loop is the whole workflow. The rest of this file is what each step means and where judgement is needed.

## Before you start

1. `skillgantry --version` must print 1.1.0 or later. If the command is missing, stop and tell the user; you cannot install it.
2. `skillgantry list` shows every skill SkillGantry knows. Use the full id it prints (`<repo>/<name>`). A bare name fails when two repos hold the same one.
3. If the skill's repo is not listed, register it: `skillgantry repo add <path-to-repo>`.
4. If a gate reports a tool that is not installed, the machine needs its tools. Tell the user. They can run `skillgantry setup` in a terminal, or ask you to run `skillgantry setup --yes --preset <minimal|recommended|everything>`. Run that only when they ask and name the preset: it installs software and rewrites which tool each stage uses. Run it without `--yes` first to show them what it would install. It never installs a runtime (`uv`, `npm`) and never writes credentials; if it names either as missing, pass that on.

## The loop

```bash
skillgantry status <skill> --json     # where it stands, and next[]
skillgantry run <skill>               # validate, evaluate, security
```

`run` with no `--stage` runs the three gates. `--stage security` runs one. Exit 1 means a gate did not pass. That is a result, and `status` will tell you which.

The evaluate gate runs the skill's eval suite through a model. It can take minutes and it costs the user money. Say so before the first run of it in a session.

Then take what `next` names:

| `next` says | What you do |
|---|---|
| `skillgantry evals <skill>` | The skill has no eval suite, so evaluate cannot pass. The command prints a prompt. Follow it: you write `evals/eval.yaml` and its cases. |
| `skillgantry run <skill> --stage …` | A gate has never run, or it ran against older files. Run it. |
| `skillgantry fix <skill> --stage <s> --run <id>` | A gate failed. The command prints a prompt listing each finding and where the tool's own report is. Follow it. |
| `skillgantry recover` | An earlier release was interrupted. Show the user its output and let them choose. |
| an entry with no command | Something only a person can settle, such as two files disagreeing on the version. Report it and stop. |
| `skillgantry release <skill> --version … --yes` | Every gate passed against the current files. See "Releasing". |

For a skill that declares no version, `next` asks for `--version <semver>`. There is nothing for `patch` to bump, so the user has to name the first version.

Any edit to the skill, including a new eval or a suppression, changes its digest. Gates recorded before the edit then count as stale, and `status` will send you back to `run`. This is expected. Finish your edits, then run the gates once.

## Working through findings

The `fix` prompt is the authority for a stage's findings; do what it says. The parts that need judgement:

- Read the tool's own report, at the path the prompt names, before deciding anything. The table in the prompt is a summary.
- Put each finding in one of three: right and worth fixing; right, but the suggested fix does not apply; a false positive.
- Fix the first kind with the smallest change that removes the cause.
- Leave correct code alone. An open finding is better than a skill quietly broken to satisfy a scanner. Report it and move on.
- Record a false positive only after you have confirmed it. Use the `skillgantry suppress …` line the prompt gives you, one finding at a time, and give a real reason. Never run a scanner's own baseline command: it accepts everything, including what you have not fixed.

Tell the user which findings you left open and why. Whether to release with them open is their decision.

An open finding stays in the issue count until someone rules on it. When the user agrees one is right but will not be fixed, record that with `skillgantry issue <fingerprint> wontfix`. The fingerprint is in `issues.items` in the status document. `acknowledge` marks one as seen and still open, and `reopen` undoes either. This is triage, and the gates do not read it. Do not use it to make a number go down.

## Releasing

`release.ready: true` means the gates and preconditions are clear. Three things are checked only once a version is given, listed under `release.unchecked`, so a release can still refuse.

Before you run it:

- Ask the user for the bump (`patch`, `minor`, `major`) or an exact version. SkillGantry will not infer one, and neither should you.
- Check that target without writing anything: `skillgantry status <skill> --version <target> --json`. A target that does not resolve comes back as the blocker `target-invalid`. An archive of that version already in the repo shows up in `release.dirty`. Only `sandbox` is left under `release.unchecked`.
- If `release.dirty` lists paths, tell the user. Add `--allow-dirty` only if they say so.

```bash
skillgantry release <skill> --version patch --yes --notes "what changed"
```

It prints the diff, then writes the version into `SKILL.md` and `versions.json`, adds a changelog entry, and builds `<name>_<version>.zip` at the repo root. It does not commit, tag or push. In a git repo it ends by printing two commands, a `git add` and a `git commit`, each limited to the files the release changed. Show them to the user and run them only if asked.

## Rules that always hold

- Never write under `*-workspace/` or `.skillgantry-workspace/`. That is the recorded evidence.
- `release`, `retire` and `suppress` change the user's repo. Each prints its diff first and needs `--yes`. Do not pass `--yes` to `release` or `retire` unless the user asked for that action.
- Never read, print or edit `~/.skillgantry/.env`. If a gate reports a missing credential, name the key to the user and let them add it.
- One skill at a time. Finish the loop for one before starting the next. `skillgantry run --repo <repoId>` sweeps every skill in a repo. Use it only when the user asks for a sweep. With the default stages it runs every skill's eval suite, which is slow and costs money, so offer `--stage validate,security` first.
- Exit code 0 means done. 1 means it ran and the answer was no. 2 means the request could not be carried out, and one `error:` line says why. Fix the request on 2. Do not retry it unchanged.

## Other commands

- `skillgantry optimise <skill>` prints a prompt for improving a skill that already passes. Use it when the user asks for a better skill, not for a releasable one.
- `skillgantry doctor` checks the installed tools. Run it when a gate reports `errored` or `degraded` without findings.
- `skillgantry retire <skill>` marks a skill deprecated. Only on request.

JSON shapes for `status` and `list`, every command's flags and the exit-code table are in [references/cli.md](references/cli.md).
