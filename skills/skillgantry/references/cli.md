# SkillGantry CLI reference

Read this when you need a flag, a JSON field or an exit code. The loop itself is in `SKILL.md`.

A skill is named `<repoId>/<name>`, as `skillgantry list` prints it. A bare `<name>` works only when one repo holds it.

## Commands

| Command | What it does | Writes to the user's repo |
|---|---|---|
| `list [--json]` | Every skill, its last recorded gate verdicts, its open issue count | no |
| `status <skill> [--version <target>] [--json]` | Where one skill stands and what to do next. With `--version`, also checks that release target | no |
| `run <skill> [--stage <list>] [--json]` | Runs stages and records evidence. Default: `validate,evaluate,security` | evidence under `<name>-workspace/` only |
| `run --repo <repoId> [--stage <list>] [--json]` | The same over every skill in one repo, gate stages only, several at a time | evidence only |
| `fix <skill> [--stage <s>] [--run <id>] [--json]` | Prints the prompt for a stage's findings | no |
| `evals <skill> [--json]` | Prints the prompt for writing or extending the eval suite | no |
| `optimise <skill> [--json]` | Prints the prompt for improving a skill | no |
| `suppress <skill> --tool <id> --rule <id> --path <p> --reason <text> --yes` | Records one confirmed false positive in the tool's own suppression file | yes, one file |
| `issue <fingerprint> <acknowledge\|wontfix\|reopen> [--json]` | Triage: moves one issue between open, acknowledged and wontfix | no |
| `release <skill> --version <semver or patch/minor/major> --yes [--notes <text>] [--allow-dirty]` | Bumps the version, writes the changelog entry, builds the archive | yes |
| `retire <skill> [--undo] [--superseded-by <id>] --yes` | Sets or clears the deprecation in `SKILL.md` | yes |
| `recover [--restore <runId>] [--forget <runId>]` | Reports or resolves an interrupted release | `--restore` does |
| `repo add <path> [--json]` | Registers a skill repo | no |
| `doctor [--json]` | Re-verifies every installed tool | no |
| `setup --yes --preset <minimal\|recommended\|everything> [--json]` | Installs a preset's tools and sets the stage selection, no terminal needed. Without `--yes`: reports and installs nothing | no |
| `skill install [--dir <path>]` | Installs this skill into an agent's skills directory | no |

A bare `setup` and a bare `skillgantry` open a terminal interface. They refuse with exit 2 when there is no terminal. Ask the user to run them.

Without `--yes`, `suppress`, `release` and `retire` print the diff and write nothing.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Done. For `fix`, `evals`, `optimise`: a prompt is on stdout. For `status`: the document was produced, whatever it says |
| 1 | It ran and the answer was no. `run`, `release`: a stage did not pass. `run --repo`: at least one skill did not pass. `fix`: nothing to fix in that run. `issue`: that move is not allowed from the issue's state. `setup --preset`: nothing was changed, or a tool failed to install |
| 2 | The request could not be carried out: unknown or ambiguous skill, bad option, missing tool, no terminal. One `error:` line on stderr says why |

`suppress` also uses 3 (the tool keeps no suppression file), 4 (already recorded) and 5 (`--yes` missing, nothing written). `upgrade` has its own codes.

With `--json`, an error is also printed to stdout as `{"error":{"message":"…"}}`.

## `status --json`

```json
{
  "skill": { "id": "repo/name", "name": "name", "repoId": "repo", "dir": "/abs/path",
             "repoPath": "/abs/repo", "version": "1.2.0", "deprecated": false, "digest": "sha256:…" },
  "gates": [
    { "stage": "validate", "outcome": "passed", "runId": "…", "runDir": "/abs/run/dir", "current": true },
    { "stage": "evaluate", "outcome": null,     "runId": null, "runDir": null,          "current": false },
    { "stage": "security", "outcome": "failed", "runId": "…", "runDir": "/abs/run/dir", "current": true }
  ],
  "hasEvalSuite": true,
  "issues": { "open": 2, "suppressed": 7,
              "bySeverity": [ { "severity": "high", "count": 1 } ],
              "items": [ { "fingerprint": "…", "severity": "high", "ruleClass": "…",
                           "path": "name/file.md", "state": "open", "detectors": ["skillspector"] } ] },
  "release": { "ready": false,
               "blockers": [ { "code": "gate-not-passed", "message": "…" } ],
               "dirty": [],
               "unchecked": ["target-version", "archive", "sandbox"],
               "target": { "requested": "patch", "resolved": "1.2.1" } },
  "next": [ { "command": "skillgantry fix repo/name --stage security --run …", "why": "…" } ]
}
```

- `gates` always has the three stages. `outcome: null` means the stage has never reached a verdict.
- `current: false` means the verdict is about older files. It does not count towards a release until the stage is re-run.
- `outcome` is `passed`, `failed` or `degraded`. `degraded` means a tool did not complete; re-run it, and run `doctor` if it repeats.
- `release.ready` means ready to attempt. The checks under `unchecked` run only when a version is given.
- `release.target` is present only with `--version`. `resolved` is the version a release would write, or `null` when the target does not resolve. With `--version`, `unchecked` is `["sandbox"]` and the release command in `next` carries the resolved version.
- `release.dirty` lists uncommitted paths in the release scope. With `--version` that includes an archive of the target version already in the repo, even one git ignores. `status` does not count them as blockers. `release` refuses them unless you pass `--allow-dirty`.
- A `next` entry with `"command": null` needs a person.

Blocker codes: `gate-missing`, `gate-not-passed`, `digest-mismatch`, `deprecated`, `version-disagreement`, `manifest-unreadable`, `interrupted-mutation`, `release-tool-missing`, and with `--version`, `target-invalid`.

## `list --json`

```json
{ "skills": [ { "id": "repo/name", "name": "name", "repoId": "repo", "dir": "/abs/path",
                "version": "1.2.0", "deprecated": false,
                "gates": { "validate": "passed", "evaluate": null, "security": "failed" },
                "openIssues": 2 } ] }
```

Verdicts here are the last ones recorded and may be about older files. `status` is the command that checks.

## `run --json`

One JSON object per line, as events: `run:start`, `stage:start`, `tool:done`, `stage:done` (with `outcome`), `run:done`. For a yes-or-no answer, read the exit code or call `status` afterwards.

With `--repo`, each line is `{"skillId":"repo/name","event":{…}}` and the last line is `{"summary":{"skills":3,"passed":2,"notPassed":["repo/name"]}}`.

## `issue --json` and `setup --json`

`issue` prints `{"fingerprint":"…","state":"wontfix"}`: the state the issue is in now, whether or not it moved. The exit code says which.

`setup --preset` prints one document:

```json
{ "preset": "minimal", "applied": true,
  "runtimes": [ { "runtime": "uv", "present": true, "installCommand": "…" } ],
  "tools": [ { "id": "skill-up", "state": "installed" } ],
  "credentials": { "present": false, "warnings": [] } }
```

`state` is `installed`, `present` (already there), `failed` (with `error`) or `would-install` (no `--yes`). `applied` is true only when every tool is usable and the stage selection was written. `credentials.present: false` means `~/.skillgantry/.env` is missing: tell the user, do not create it.

## Where evidence lives

`<skill-name>-workspace/skillgantry/runs/<date_time>/` beside the skill, one directory per run, with each tool's own report inside its stage directory. Read it freely. Never write there.
