# SkillGantry — Design

**Date:** 2026-08-01
**Status:** revision 2, incorporating [design-review.md](design-review.md)
**Layer:** design (layer 2 of 3: [requirements](requirements.md) → design → plan)
**Traces to:** [requirements.md](requirements.md), [decision-log.md](decision-log.md)

Each section names the requirements it satisfies. Revision 2 closes all twelve review findings; §18 records what changed and why.

---

## 1. Shape of the system

SkillGantry is an engine plus two frontends. The engine discovers skills in registered repos, installs and invokes external CLI tools against them, normalises what those tools emit, writes evidence to each skill's sidecar workspace, and records the result in a local ledger. The TUI and the headless command are both consumers of one typed event stream and one command handle.

```
             ┌──────────────┐        ┌──────────────┐
             │  TUI (Ink)   │        │ headless CLI │
             └──────┬───────┘        └──────┬───────┘
                    │   events ▲  ▼ commands│
                    └───────────┬───────────┘
                          ┌─────┴─────┐
                          │   queue   │
                          └─────┬─────┘
                          ┌─────┴─────┐
              ┌───────────┤ pipeline  ├───────────┐
              │           └─────┬─────┘           │
        ┌─────┴─────┐     ┌─────┴─────┐     ┌─────┴─────┐
        │  runner   │     │ adapters  │     │ isolation │
        │ (spawn +  │────▶│  (pure    │     │ (worktree │
        │ redaction)│     │  parsers) │     │ /snapshot)│
        └─────┬─────┘     └─────┬─────┘     └───────────┘
              │                 │
        ┌─────┴─────┐     ┌─────┴─────┐
        │ workspace │     │  ledger   │
        │ (sidecar) │     │ (SQLite)  │
        └───────────┘     └───────────┘
```

## 2. Package layout

*Satisfies R13.1, R13.5.*

One npm package, three source roots, boundary enforced by an eslint import rule rather than a workspace split.

```
src/core/    engine — no terminal, no process.exit, no console
src/tui/     Ink app; imports core only through src/core/index.ts
src/cli/     bin entry: `skillgantry` (TUI), `skillgantry run …` (headless)
```

Allowed direction: `cli → tui → core`. The lint rule fails the build on any import the other way.

A pnpm workspace was rejected: the goal is a testable boundary, which a folder plus a lint rule delivers. Three packages would add build orchestration and version skew for one maintainer.

Distribution acceptance (R13.5): `npm pack` output is installed into a clean temp prefix in CI and `skillgantry --version` is invoked from it. Packaging is verified, not assumed.

## 3. Module map

*Satisfies R13.1, R13.2.*

Twelve modules under `src/core/`. Rule applied throughout: a module that owns I/O does not also own decisions.

Release is a module, not an adapter: it has no external tool to wrap, so it has no manifest and no `parse`. It does depend on `tools`, because vercel `skills` must be installed for the installability check. Nine external tools are installed in total: eight adapter-backed, plus vercel `skills`.

| Module | Job | Depends on | Owns I/O |
|---|---|---|---|
| `config` | Load/save `~/.skillgantry/config.json`; read and mode-check `.env`; build the redaction value set | — | fs |
| `discovery` | Repo path → `SkillRef[]`; frontmatter parse; git detection; `workspacePath()`; `skillDigest()` | — | fs |
| `tools` | Tool root, three install drivers, lockfile with resolved executables, verify-by-invocation, doctor | `config` | fs, net, subprocess |
| `adapters` | Eight manifest + parse modules; shared SARIF and skill-up parsers; rule-class map | — | **none** |
| `runner` | Spawn one tool: env injection, timeout with process-tree kill, stream redaction, artefact loading, exit classification | `config`, `tools` | subprocess, fs |
| `stages` | `StageExecutor` contract; `AdapterStageExecutor`; `ReleaseStageExecutor`; outcome reduction | `adapters`, `runner`, `release` | — |
| `pipeline` | Stage sequencing, mutation gating, event emission, run finalisation transaction | `stages`, `workspace`, `isolation`, `ledger` | — |
| `queue` | Bounded worker pool, batch enqueue, cancellation, mutating-stage serialisation, per-skill locking | `pipeline` | fs (lockfiles) |
| `workspace` | Sidecar writer: run dir claim, `run.json`, `stage.json`, per-tool dirs, `latest`, `index.ndjson`, gitignore fix | `config`, `discovery` | fs |
| `isolation` | `MutationSandbox` over a declared path scope; git worktree and snapshot implementations; journalled apply | `discovery` | fs, subprocess |
| `ledger` | SQLite schema and migrations, fingerprinting, reconciliation, issue state machine, stats queries | — | sqlite |
| `release` | Release state machine, version resolution, changelog, archive, evidence bundle, installability check | `workspace`, `ledger`, `runner`, `tools`, `discovery` | fs, subprocess |

`adapters` and `ledger` have no dependency on the rest of the engine. That is deliberate: they hold the two subtlest rules in the system and can be tested exhaustively with no mocking, which is what makes M1 a genuine validation of the design.

## 4. Discovery, config and identity

*Satisfies R2.1–R2.8.*

### 4.1 Config schema

`~/.skillgantry/config.json`:

```jsonc
{
  "version": 1,
  "repos": [
    { "id": "zapac", "path": "/Users/…/zapac-agent-skills", "name": "zapac-agent-skills" }
  ],
  "stageTools": {
    "validate": ["skill-lint", "agentskills"],
    "evaluate": ["skill-up"],
    "security": ["skill-scanner", "skillspector"],
    "optimise": ["skillopt"]
  },
  "concurrency": 2,
  "timeoutOverridesMs": { "skill-up": 900000 }
}
```

Repo paths are canonicalised on registration: expanded, resolved through symlinks, trailing separator stripped. Registering a path that canonicalises onto an existing repo is rejected. `id` is a slug derived from the directory name, deduplicated with a numeric suffix.

### 4.2 Discovery algorithm

```
discover(repo):
  if exists(repo.path/SKILL.md):
      return [ skill(id=repo.id, dir=repo.path, rootSkill=true) ]
  for each direct child dir D of repo.path:
      skip if D matches *-workspace/ , starts with '.', or is node_modules
      skip if not exists(D/SKILL.md)
      yield skill(id=`${repo.id}/${basename(D)}`, dir=D, rootSkill=false)
```

Only direct children are examined, so nested `SKILL.md` files inside snapshots or fixtures are unreachable by construction rather than by exclusion list. Frontmatter `name` and `metadata.version` are read; absence is recorded as `null` and never fails the scan.

### 4.3 Workspace path

*Satisfies R6.1, R6.8.*

```
workspacePath(skill) =
    skill.rootSkill ? `${repo.path}/.skillgantry-workspace`
                    : `${repo.path}/${basename(skill.dir)}-workspace`
```

A repo-root skill cannot use the sibling convention, because a sibling of the repo root lies outside the repo and could not be covered by the repo's `.gitignore`. It therefore uses an in-repo dotdirectory. Two guards follow from that: the workspace directory is excluded from `skillDigest()` and from snapshot copies, so it can never recurse into itself, and discovery already skips dotdirectories.

Known residual risk, accepted: for a repo-root skill the workspace lies inside the directory tools are asked to scan. Most scanners skip dotdirectories, and adapters pass an exclusion argument where the tool supports one, but a tool that scans everything may report findings about SkillGantry's own artefacts. Those findings carry paths under the workspace directory and are dropped by the finding normaliser.

### 4.4 Skill digest

*Satisfies R2.8, R9.9.*

```
skillDigest(skill) = sha256 over the sorted list of
    (relPath, mode & 0o111, sha256(contents))
  for every file under skill.dir, excluding:
    the workspace directory, .git/, and any snapshot-pre/ directory
```

For a git repo the run additionally records `gitCommit` (HEAD) and `gitDirty` (whether the skill path has uncommitted changes). The digest, not the commit, is authoritative — it is the only identifier available for the 54 non-git skills.

## 5. Tool management

*Satisfies R3.1–R3.9.*

### 5.1 Tool root and lockfile

```
~/.skillgantry/tools/<toolId>/          isolated install per tool
~/.skillgantry/tools/lock.json
```

```jsonc
{
  "version": 1,
  "tools": {
    "skillspector": {
      "installKind": "uv-tool",
      "requestedPin": "2.3.7",
      "resolvedVersion": "2.3.7",
      "bin": "/Users/…/.skillgantry/tools/skillspector/bin/skillspector",
      "installedAt": "2026-08-01T09:12:03Z",
      "verifiedAt": "2026-08-01T09:12:05Z"
    }
  }
}
```

`bin` is the resolved absolute executable. The adapter manifest supplies arguments only; it never has to know how the executable was placed on disk. This closes the review's observation that `uv-tool` and `gh-release` installs left the executable unidentified.

### 5.2 Install drivers

| Kind | Mechanism | Executable resolution |
|---|---|---|
| `uv-tool` | `uv tool install --tool-dir <toolRoot>/<id> <spec>==<pin>` | scan `<toolRoot>/<id>/bin` for the declared `binName` |
| `npm-prefix` | `npm install --prefix <toolRoot>/<id> <spec>@<pin>` | `<toolRoot>/<id>/node_modules/.bin/<binName>` |
| `gh-release` | download the asset matching `assetPattern` for tag `<pin>`, verify checksum, extract | declared `binName` inside the extracted tree |

### 5.3 Setup and doctor

Setup is a four-state machine: `probe-runtimes → select-tools → install-and-verify → credentials-and-repo`. Each state is re-enterable, so `doctor` reuses `probe-runtimes` and `install-and-verify` without the rest.

Presets: **Minimal** is skill-up plus skillspector — the two already present, one evaluate and one security tool. **Recommended** is one tool per stage: skill-lint, skill-up, skillspector, skillopt. **Everything** is all eight plus vercel `skills`.

Every preset includes vercel `skills`, because the release stage cannot run its installability gate without it.

Doctor reports four drift kinds per tool: `missing` (in lock, absent on disk), `unverifiable` (present, will not run), `version-drift` (runs, reports a version other than `resolvedVersion`), and `unlocked` (installed under the tool root but absent from the lock).

## 6. Stage execution contract

*Satisfies R4.6–R4.8, R5.1, R9 dispatch.*

Adapter-backed stages and the native release stage share one contract, so the pipeline has a single execution path. This closes the review's finding that release had no dispatch route.

```ts
interface StageExecutor {
  stage: Stage
  mutating: boolean
  /** Resolve tools and declare every path this stage may write. */
  plan(ctx: StageContext): Promise<StagePlan>
  execute(ctx: StageContext, plan: StagePlan): Promise<StageResult>
}

interface StagePlan {
  toolIds: string[]                 // empty for the native release stage
  policy: 'fan-out' | 'pick-one' | 'native'
  mutationScope: MutationScope      // empty for read-only stages
}

interface MutationScope {
  /** Repo-relative paths, possibly outside the skill directory. */
  paths: string[]
}
```

`AdapterStageExecutor` drives manifests and parsers. `ReleaseStageExecutor` runs the state machine in §12 and declares a mutation scope spanning `<skill>/SKILL.md`, `<skill>/CHANGELOG.md` and, when present, the repo-root `versions.json`.

Selection is resolved **before** the lockfile is consulted. Every selected tool produces a `ToolResult`, including one that is not installed. A selected tool is never silently dropped, which is what R4.6 requires. A stage whose selection is empty is rejected at enqueue time with a validation error, so the zero-tool case never reaches execution.

Fan-out tools run concurrently, capped at two, each in its own artefact directory.

## 7. Adapter contract

*Satisfies R4.1–R4.5.*

```ts
type Stage    = 'validate' | 'evaluate' | 'security' | 'optimise' | 'release'
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

type KnownRuleClass =
  | 'prompt-injection'  | 'credential-access'   | 'unsafe-script'
  | 'data-exfiltration' | 'vulnerable-dep'      | 'excessive-permission'
  | 'metadata-invalid'  | 'structure-invalid'   | 'trigger-quality'
  | 'reference-broken'  | 'eval-failure'        | 'compat-risk'

type RuleClass = KnownRuleClass | `unmapped:${string}`   // `unmapped:<toolId>:<nativeId>`

/** Closed set. Token and cost keys are absent by construction — R1.5. */
type MetricKey =
  | 'durationMs' | 'casesTotal' | 'casesPassed' | 'casesErrored'
  | 'turns' | 'findingsTotal' | 'filesScanned' | 'rulesEvaluated'

interface AdapterManifest {
  id: string
  stage: Stage
  policy: 'fan-out' | 'pick-one'
  mutating: boolean
  detects: KnownRuleClass[]        // reconciliation scope — see §10.4
  requiresCredentials: boolean
  install: InstallSpec
  invoke: { argv: string[]; cwd: 'skillDir' | 'repoRoot' }
  versionArgv: string[]
  artefacts: string[]              // relative to this tool's artefact dir
  binaryArtefacts?: string[]       // subset copied verbatim, never parsed
  timeoutMs: number
}

type InstallSpec =
  | { kind: 'uv-tool';    spec: string; pin: string; binName: string }
  | { kind: 'npm-prefix'; spec: string; pin: string; binName: string }
  | { kind: 'gh-release'; repo: string; pin: string; assetPattern: string; binName: string }

/** Pure input. The runner has already read the files; parse performs no I/O. */
interface ParseContext {
  skill: SkillRef
  artefacts: ReadonlyMap<string, Buffer>   // declared name → bytes
  stdout: string
  stderr: string
  exitCode: number | null                  // null when killed by timeout
  durationMs: number
}

interface RawFinding {
  ruleClass: RuleClass
  nativeRuleId: string
  severity: Severity
  path: string                     // repo-relative, normalised separators
  line?: number                    // display only, never in the fingerprint
  message: string
}

interface ToolResult {
  outcome: ToolOutcome
  findings: RawFinding[]
  metrics: Partial<Record<MetricKey, number>>
  summary: string                  // one line for the lifecycle rail
}

type Parse = (ctx: ParseContext) => ToolResult
```

`ParseContext` carries artefact **bytes**, not paths. Parsers therefore touch no filesystem, and R4.3's claim that the adapters module owns no I/O is now literally true. The runner loads each declared artefact subject to a 32 MiB cap; exceeding it yields `errored` with `error_kind = 'artefact-too-large'` and the file is left in place unparsed.

`{skillDir}`, `{repoRoot}` and `{toolDir}` in `invoke.argv` are substituted at spawn time. When a mutation sandbox is active, `{skillDir}` and `{repoRoot}` resolve inside the sandbox, not the user's working tree.

**Example adapter** (`src/core/adapters/skillspector.ts`), pinned to the version actually installed:

```ts
export const manifest: AdapterManifest = {
  id: 'skillspector',
  stage: 'security',
  policy: 'fan-out',
  mutating: false,
  detects: ['prompt-injection', 'credential-access', 'unsafe-script',
            'data-exfiltration', 'vulnerable-dep', 'excessive-permission'],
  requiresCredentials: false,
  install: { kind: 'uv-tool', spec: 'skillspector', pin: '2.3.7',
             binName: 'skillspector' },
  invoke: { argv: ['scan', '{skillDir}', '--format', 'sarif',
                   '--output', '{toolDir}/findings.sarif'], cwd: 'repoRoot' },
  versionArgv: ['--version'],
  artefacts: ['findings.sarif'],
  timeoutMs: 120_000,
}

export const parse: Parse = (ctx) =>
  parseSarif(ctx.artefacts.get('findings.sarif')!, { toolId: 'skillspector' })
```

### 7.1 Rule-class mapping

*Satisfies R8.3, R8.5.*

`src/core/adapters/rule-classes.ts` maps `(toolId, nativeRuleId)` onto a `KnownRuleClass`. Anything unmapped becomes `unmapped:<toolId>:<nativeRuleId>`, which is tool-scoped and can never merge with another tool's finding. Adding a mapping later merges previously separate issues; §10.5 defines that migration.

SARIF severity normalisation: `error → high`, `warning → medium`, `note → low`, `none → info`.

Findings whose path resolves inside a workspace directory are dropped by the normaliser, which is the guard for §4.3's residual risk.

## 8. Outcome model

*Satisfies R5.1, R5.11.*

```ts
type ToolOutcome  = 'passed' | 'failed' | 'errored' | 'skipped'
type StageOutcome = 'passed' | 'failed' | 'degraded' | 'errored' | 'skipped'
```

Reduction over the non-empty multiset of tool outcomes in a stage, using two axes:

```
ran      = count(passed) + count(failed)
complete = count(errored) == 0 && count(skipped) == 0
verdict  = count(failed) > 0 ? 'failed' : 'passed'

StageOutcome =
    complete            → verdict
  : ran > 0             → 'degraded'      // carries verdict in metrics
  : count(errored) > 0  → 'errored'
  : otherwise           → 'skipped'
```

This is total: every non-empty combination of the four tool outcomes maps to exactly one stage outcome. Worked cases the review called out — `failed + errored → degraded`, `passed + skipped → degraded`, `failed + skipped → degraded`, `errored + skipped → errored`.

A `pick-one` stage has exactly one tool, so its stage outcome equals that tool's outcome and `degraded` cannot arise.

The chain halts unless the stage outcome is `passed`. The headless exit code is zero only when every executed stage is `passed`. Release refuses on anything other than `passed`.

## 9. Sidecar layout

*Satisfies R6.1–R6.8, R7.4, R7.7.*

```
declawed-workspace/                      (mode 0700)
  iteration-1/                           ← pre-existing, read-only
  iteration-3/
  skillgantry/
    runs/
      019283af-6c21-7b3e-9f04-1d2e3f4a5b6c/
        run.json
        snapshot-pre/                    ← non-git mutation sandbox only
        journal.json                     ← mutation apply journal
        01-validate/
          stage.json                     ← written once, after all tools
          skill-lint/    stdout.log  stderr.log  <native artefacts>
          agentskills/   stdout.log  stderr.log  <native artefacts>
        03-security/
          stage.json
          skillspector/  stdout.log  stderr.log  findings.sarif
          skill-scanner/ stdout.log  stderr.log  findings.sarif
        evidence/                        ← release stage only
      latest -> 019283af-…
      index.ndjson
```

Each tool owns a directory, so two scanners emitting `findings.sarif` cannot collide, and `tool_runs.artefact_dir` identifies exactly one tool's evidence. `stage.json` is written once, after every tool in the stage has finished, and references each tool directory by name.

Run id is a UUIDv7: time-ordered like the old timestamp form, but with no collision assertion to defend. Uniqueness is *claimed*, not asserted — the run directory is created with exclusive `mkdir`, and a collision retries with a fresh id.

`index.ndjson` is one JSON object per line, appended with `O_APPEND` under the per-skill lock. It is genuinely append-only, so a crash truncates at a line boundary rather than corrupting a whole document. `latest` is rewritten under the same lock via temp-file-and-rename.

The workspace root is created mode 0700, and SkillGantry ensures `*-workspace/` and `.skillgantry-workspace/` are both in the repo's `.gitignore`.

### 9.1 Secret handling in artefacts

*Satisfies R7.3, R7.4, R7.7.*

Streams that SkillGantry writes — `stdout.log` and `stderr.log` — pass through `RedactionTransform` before reaching disk. The transform keeps a tail buffer so a secret split across chunk boundaries is still caught, and substitutes `«redacted:NAME»`.

Native artefacts written by the tool itself, `snapshot-pre/` contents, and the release evidence bundle are **not** redacted. Redacting a rollback snapshot would make byte-exact restore impossible, and rewriting a tool's own SARIF or JSON risks corrupting it. The scope of R7.4 is therefore streams, not every byte under the sidecar. Mitigations: the workspace root is mode 0700, both workspace patterns are gitignored, and `stage.json` records `redacted: false` for every unredacted artefact so the exposure is visible rather than implicit.

This is a deliberate narrowing of R7.4 from its first draft, chosen over routing tools through a private staging directory. It keeps every artefact in the sidecar, which was the original brief.

## 10. Ledger

*Satisfies R8.1–R8.12.*

### 10.1 Schema

```sql
repos(id, path UNIQUE, name, is_git, registered_at)

skills(id, repo_id, name, rel_path, current_version,
       lifecycle_state,            -- active | deprecated   (R1.4)
       deprecated_at, superseded_by,
       first_seen, last_seen,
       UNIQUE(repo_id, rel_path))

runs(id, skill_id, trigger, started_at, ended_at, outcome,
     skill_digest,               -- R9.9 gate binding
     git_commit, git_dirty,      -- null for non-git repos
     provenance_json,            -- R7.5
     tool_lock_json,             -- R3.3, snapshot for this run
     sidecar_path)

stages(id, run_id, stage, outcome, verdict, started_at, ended_at, metrics_json)

tool_runs(id, stage_id, tool_id, tool_version, outcome,
          exit_code, duration_ms, artefact_dir, error_kind)

issues(fingerprint PK, skill_id, rule_class, rel_path,
       severity_max, state, note, occurrence_count,
       first_seen_run, last_seen_run, closed_run, reopened_run)

issue_detections(issue_fp, tool_run_id, ordinal,
                 native_rule_id, native_severity, line, message,
                 PRIMARY KEY(issue_fp, tool_run_id, ordinal))
```

The ledger stores no raw tool output; `tool_runs.artefact_dir` points at the sidecar, which holds the evidence.

`issue_detections` carries an `ordinal` so one tool reporting several occurrences that collapse to one issue produces several rows rather than violating the primary key.

### 10.2 Provenance

`run.json` mirrors ledger columns as sibling top-level keys, none duplicating another:

```json
{
  "runId": "019283af-6c21-7b3e-9f04-1d2e3f4a5b6c",
  "skillId": "zapac/declawed",
  "skillDigest": "sha256:9c1f…",
  "git": { "commit": "e1847a7", "dirty": false },
  "provenance": {
    "baseUrlHost": "api.deepseek.com",
    "models": {
      "ANTHROPIC_MODEL": "…",
      "ANTHROPIC_DEFAULT_OPUS_MODEL": "…",
      "ANTHROPIC_DEFAULT_SONNET_MODEL": "…",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL": "…",
      "CLAUDE_CODE_SUBAGENT_MODEL": "…"
    },
    "authTokenHash": "sha256:1a2b3c4d"
  },
  "toolLock": { "skillspector": "2.3.7" }
}
```

### 10.3 Finding identity

*Satisfies R8.4, R8.6. Supersedes the message-shape scheme in revision 1.*

```
fingerprint = sha256(skillId ‖ normalisedRelPath ‖ ruleClass).slice(0, 12)
```

One issue means "this file has a problem of this class". Every occurrence, from every tool, is a detection row carrying its own line, native rule id, native severity and message. `occurrence_count` is the number of distinct detections in the most recent run that reported it.

Revision 1 added a `messageShape` component, which the review correctly showed cannot satisfy R8.6: two scanners describing one problem in different words produce different shapes and therefore two issues. Cross-tool merging and per-occurrence separation cannot both hold without a semantic key neither tool provides, so merging wins and occurrences move into the detections table.

Accepted consequence: three distinct credential findings in one file are one issue with three detections. The issue count reads as "files with a problem of class X", not "occurrences of X".

### 10.4 Reconciliation

*Satisfies R8.8, R8.12.*

Runs once, inside the same transaction that records the run:

```
for each toolRun in this run where outcome ∈ {passed, failed}:
    scope      ← manifest(toolRun.tool_id).detects
                   ∪ { unmapped:<toolRun.tool_id>:* }
    reported   ← fingerprints this toolRun produced
    candidates ← issues for this skill where
                   state ∈ {open, acknowledged}
                   AND rule_class ∈ scope
                   AND the issue's most recent detection came from this tool
    for each issue in candidates \ reported:
        transition(issue, 'fixed', closed_run = run.id)
```

Two corrections from the review. The scope now includes the tool's own `unmapped:` classes, so an unmapped finding can close rather than staying open forever. Candidates now include `acknowledged`, so acknowledging an issue no longer prevents it from ever resolving.

Tool runs with outcome `errored` or `skipped` are excluded, which is what stops a crashed or absent scanner from closing everything it once found.

### 10.5 Issue state machine

*Satisfies R8.7, R8.10.*

| From | Event | To | Notes |
|---|---|---|---|
| — | first detection | `open` | `first_seen_run` set |
| `open` | detected again | `open` | `last_seen_run`, `occurrence_count` updated |
| `open` | absent, detecting tool `passed`/`failed` | `fixed` | `closed_run` set |
| `open` | user acknowledges | `acknowledged` | |
| `open` | user marks wontfix | `wontfix` | |
| `acknowledged` | detected again | `acknowledged` | `last_seen_run` updated |
| `acknowledged` | absent, detecting tool ok | `fixed` | |
| `wontfix` | detected again | `wontfix` | `last_seen_run` updated only |
| `wontfix` | absent | `wontfix` | never auto-closes |
| `fixed` | detected again | `open` | `reopened_run` set, `closed_run` cleared |
| any | detecting tool `errored`/`skipped` | unchanged | the fail-safe |
| any | rule-map migration | merged | §10.6 |

### 10.6 Rule-map migration

Adding a mapping turns `unmapped:<tool>:<id>` into a `KnownRuleClass`, which changes fingerprints. Migration is explicit, versioned with the rule map, and runs inside one transaction: recompute affected fingerprints, merge issues that now collide, re-parent their detections, take the strongest state by precedence `wontfix > acknowledged > open > fixed`, and write a migration note onto the surviving issue. It is never implicit.

## 11. Run lifecycle, commands and cancellation

*Satisfies R5.2–R5.10, R5.12, R12.4, R13.2.*

### 11.1 Handles

`pipeline.run()` returns a bidirectional handle rather than a bare iterable, which is what lets a frontend resolve a blocked mutation.

```ts
interface RunHandle {
  runId: string
  events: AsyncIterable<RunEvent>
  resolveMutation(requestId: string, action: 'apply' | 'discard'): void
  cancel(reason?: string): Promise<void>
}

interface QueueHandle {
  enqueue(jobs: JobSpec[]): string[]          // job ids
  snapshot(): QueueSnapshot                   // queued, running, completed
  cancelJob(jobId: string): Promise<void>
  events: AsyncIterable<QueueEvent>           // job:queued|started|done|cancelled
}
```

### 11.2 Events

```
run:start        { runId, skillId, stages, sidecarPath, skillDigest }
stage:start      { runId, stage, toolIds }
tool:start       { runId, stage, toolId, toolVersion }
tool:output      { runId, stage, toolId, chunk, stream }
tool:done        { runId, stage, toolId, result }
stage:done       { runId, stage, outcome, verdict, findingCount }
mutation:pending { runId, stage, requestId, diff, scope }
mutation:resolved{ runId, stage, requestId, action }
run:done         { runId, outcome, issueDelta }
run:cancelled    { runId, phase, reason }
```

`mutation:pending` carries a `requestId` that `resolveMutation` correlates against. A pending mutation that is never resolved times out after a configurable interval and discards.

### 11.3 Sequence

1. `queue` worker takes the job, acquires the per-skill lock, calls `pipeline.run()`
2. `workspace.claimRun()` → exclusive `mkdir` on a UUIDv7 directory; `run.json` written with provenance, tool lock and skill digest
3. Per stage: `executor.plan()` resolves the selection and declares the mutation scope
4. Mutating stage → `isolation.open(scope)`; paths resolve inside the sandbox
5. Per tool: `runner.spawn()` → streams tee to the ring buffer and to `stdout.log`/`stderr.log` through the redactor → declared artefacts loaded into memory → `parse()` → `ToolResult`
6. `stage.json` written once; stage outcome reduced per §8; the chain halts unless `passed`
7. Mutating stage emits `mutation:pending` and blocks on `resolveMutation`
8. `workspace.finalizeRun()` → `index.ndjson` append, `latest` rewrite, both under the lock
9. `ledger.recordRun()` — one transaction covering runs, stages, tool_runs, issues, detections and reconciliation. `pipeline` owns this call and this transaction boundary

### 11.4 Cancellation

| Cancelled while | Behaviour |
|---|---|
| Queued, not started | Job removed; no run directory; `job:cancelled` emitted |
| Tool running | Process tree killed; tool `errored` with `error_kind = 'cancelled'`; partial log kept; run finalised so evidence survives |
| Awaiting mutation approval | Treated as `discard`; sandbox rolled back; stage `skipped`; run finalised |
| During finalisation | Not cancellable; finalisation completes |

### 11.5 Headless confirmation

R5.2 requires confirmation to follow a diff preview. In the TUI that is literal. In headless mode `--yes` is **prior authorisation**, and the diff is still computed and emitted to stdout immediately before the write, so the ordering requirement holds and the diff is always on record. Without `--yes` a mutating stage is `skipped` with `error_kind = 'no-authorisation'`. R5.2 carries this exception explicitly rather than leaving the two requirements in tension.

## 12. Mutation isolation and release

*Satisfies R9.1–R9.10, R10.1–R10.8.*

### 12.1 Scope-aware sandbox

Revision 1 scoped the sandbox to the skill directory, which the review showed cannot express a release: `versions.json` lives at the repo root.

```ts
interface MutationSandbox {
  workRoot: string                          // repo root inside the sandbox
  resolve(repoRelPath: string): string
  changeSet(): Promise<ChangeSet>
  apply(): Promise<void>
  discard(): Promise<void>
  dispose(): Promise<void>
}

interface ChangeSet {
  entries: Array<{
    path: string
    kind: 'added' | 'modified' | 'deleted' | 'renamed' | 'mode-changed'
    from?: string                           // renames
    mode?: number
    binary: boolean
  }>
  unifiedDiff: string                       // text entries only, for preview
}
```

**`GitWorktreeSandbox`**: `git worktree add --detach <tmp> HEAD` materialises the whole repo, so repo-root files are in scope. `changeSet()` combines `git status --porcelain=v1 -z` with `git diff --binary`, restricted to the declared scope paths, so adds, deletes, renames, mode changes and binary files are all represented — none of which a scoped text diff could express.

**`SnapshotSandbox`**: copies every declared scope path into `<run>/snapshot-pre/`, preserving modes. Tools operate on the real tree. `changeSet()` compares live against the snapshot; `discard()` restores it. The workspace directory and `.git` are excluded from the copy, which is what prevents a repo-root skill from snapshotting its own workspace recursively.

### 12.2 Journalled apply

POSIX offers no multi-file atomic write, so the design does not claim atomicity. `apply()` writes a journal first, then proceeds:

```
journal.json  ← { runId, stage, entries: [{path, priorSha, priorMode, priorBytesRef}] }
for each entry: write temp file in the same directory, fsync, rename over target
fsync the containing directories
mark the journal complete
```

A crash leaves a journal marked incomplete. On next launch SkillGantry detects it and offers compensating rollback from the recorded prior bytes. This is a documented compensating-transaction model, not an atomicity guarantee.

### 12.3 Release state machine

```
validate-preconditions → resolve-target-version → build-change-set
  → preview-diff → await-confirmation → apply → package
  → verify-install → record-evidence → done

any state → abort  (compensating rollback via the journal)
```

**Preconditions.** The skill is not `deprecated`. The most recent validate, evaluate and security stage outcomes are all `passed`. Each of those runs' `skill_digest` equals the candidate's current digest — this is the R9.9 binding that stops evidence from an older state authorising a newer release. When `versions.json` exists, its entry and the frontmatter version already agree.

**Target version.** Supplied explicitly as a semver, or as a bump level (`major` / `minor` / `patch`) applied to the current frontmatter version. Never inferred silently.

**Manifest handling.** When repo-root `versions.json` exists, R9.1's dual write applies, including the refuse-on-mismatch guard. When it does not exist — the case for all 54 skills in `~/.claude/skills` — release updates only `SKILL.md`, records `"manifest": "none"` in the evidence bundle, and proceeds. SkillGantry never creates a `versions.json`.

**Outputs.** Changelog at `<skillDir>/CHANGELOG.md`, new section prepended, created if absent. Archive at `<repoRoot>/<skillName>_<version>.zip`, matching the existing convention. Evidence bundle at `<run>/evidence/` containing the validate result, eval report, merged security findings, the tool lockfile, the skill digest and the manifest mode.

**Verify-install.** The archive is installed into a temporary directory via vercel `skills`; failure aborts and rolls back through the journal.

Git commit and tag are offered as a separate confirmed action after `done`. `apply()` never commits.

## 13. Retirement

*Satisfies R1.4.*

Retirement sets `skills.lifecycle_state = 'deprecated'`, records `deprecated_at` and an optional `superseded_by`, and writes `metadata.deprecated: true` into `SKILL.md` frontmatter through the ordinary mutation path — declared scope, diff preview, confirmation, journal. Release preconditions reject a deprecated skill. Gates still run, so a deprecated skill can be scanned; it simply cannot be released. Reversal clears the same fields by the same route.

## 14. Terminal interface

*Satisfies R11.1–R11.5.*

One store fed exclusively by core events; Ink components are pure functions of it. Commands flow back through `RunHandle` and `QueueHandle`.

```
┌─ SkillGantry ─ zapac-agent-skills ─ [1]Work [2]Dash [3]Issues [4]Tools ┐
│ declawed     ● │ Validate ── Evaluate ── Security ── Optimise ── Release│
│ gap-analysis ○ │    ok         8/10       3 high       ·          ·     │
│ spec-lint    ! │────────────────────────────────────────────────────────│
│ zuhlke-slides○ │ Log │ Findings │ Artefacts │ SKILL.md                  │
│ rfp-daily    ○ │ skillspector: scanning declawed/scripts/scan.py…       │
│                │ cisco: 2 findings (1 high, 1 medium)                   │
└────────────────┴────────────────────────────────────────────────────────┘
```

Render discipline, the whole mitigation for choosing Ink: `tool:output` chunks enter a per-tool-run ring buffer of 2000 lines held **outside** React. A 100 ms tick copies the visible window into state. Every other pane re-renders only on discrete state change. Log text never enters component state line by line.

Screens: Work (above), Dashboard (ledger aggregates), Issues (cross-repo table with state transitions), Tools (install, pin, verify, doctor), Settings (repos, concurrency, credentials status). Vim-style movement, `?` for help, `:` for a command palette. The queue is a panel on Work, showing `QueueHandle.snapshot()` with per-job cancel.

## 15. Headless interface

*Satisfies R12.1–R12.4.*

```
skillgantry run <skill> [--repo <path>] --stage validate,evaluate,security
                        [--json] [--yes] [--concurrency N]
skillgantry doctor [--json]
skillgantry release <skill> --version <semver|major|minor|patch> [--yes]
```

Consumes the same event stream, rendering line output or newline-delimited JSON. Exits non-zero when any executed stage outcome is not `passed`. Mutating stages are skipped without `--yes`; with it, the diff is emitted before the write.

## 16. Test strategy

*Satisfies R13.3, R13.4.*

| Target | Method | Guards |
|---|---|---|
| `adapters` | Golden fixtures captured from real runs at the pinned versions; pure bytes → `ToolResult` | Upstream schema drift; the highest-value suite |
| `ledger` | In-memory SQLite; fingerprint stability under whitespace and line-shift edits; every row of the §10.5 transition table; unmapped-class closure; rule-map migration merge | The subtlest rules in the design |
| Reconciliation fail-safe | A run whose security tool `errored`, and one where it is `skipped` | Neither closes any issue |
| Cross-tool merge | Paired real SARIF fixtures from **both** scanners on one fixture skill | One issue, two detections — the R8.6 contract |
| `stages` | Full Cartesian outcome matrix over the four tool outcomes | §8 reduction is total |
| `pipeline` | Fake executors; fail-fast; mutation gating; cancellation in all four phases of §11.4 | Sequencing with no subprocess |
| `runner` | Fixture process that **spawns a grandchild**, then times out | No surviving descendant after the timeout fires — R5.9 |
| Redaction | Fixture tool echoing a secret to stdout, to stderr, and split across chunk boundaries | Streams redacted; `stage.json` records `redacted: false` for the native artefact |
| Fan-out collision | Two fixture tools both writing `findings.sarif` | Separate tool directories; both survive |
| `isolation` | Git and non-git fixtures; add, delete, rename, mode change, binary file; crash between journal and rename | Change sets complete; compensating rollback works |
| Release | Git and non-git transactions changing `SKILL.md`, root `versions.json`, changelog and archive; apply, discard, crash recovery; digest mismatch rejection; missing-manifest path | The one stage that writes to the user's repo |
| Concurrency | Two runs finalising one skill simultaneously | No lost index line, deterministic `latest`, no run-id collision |
| `discovery` | Fixture trees with the `*-workspace/` snapshot trap, a repo-root skill, and a symlinked repo path | R2.3, R2.4, §4.1 canonicalisation |
| Repo-root skill | Discovery → read-only stage → snapshot → rollback → gitignore check | §4.3 end to end, no recursive copy |
| Packaging | `npm pack`, install into a clean prefix, invoke `--version` | R13.5 |
| `tui` | `ink-testing-library` on the Work screen | Smoke level only |

Fixture capture is a scripted, repeatable step tied to the pinned tool versions, so fixtures and pins cannot drift apart.

## 17. Traceability and milestones

*Satisfies R11 coverage concern from the review.*

Exactly one milestone owns each requirement group.

| Requirement group | Design section | Owning milestone |
|---|---|---|
| R1.1–R1.3, R1.5 | 1, 7 (`MetricKey`) | M1 |
| R1.4 retirement | 13 | M5 |
| R2 discovery, config, digest | 4 | M1 |
| R3 tool management | 5 | M3 |
| R4 adapters | 6, 7, 7.1 | M1 (contract, one adapter) · M4 (remaining seven, fan-out) |
| R5.1, R5.9, R5.11 | 8, 11.3 | M1 |
| R5.2, R5.12, R12.4 | 11.1, 11.5 | M5 |
| R5.3–R5.8, R5.10 queue | 11.1, 11.4 | M2 |
| R6 artefacts | 9 | M1 · R6.7 concurrency in M2 |
| R7 credentials and redaction | 9.1, 10.2 | M1 |
| R8 ledger and issues | 10 | M1 · R8.9 statistics in M6 |
| R9 release | 12.3 | M5 |
| R10 mutation safety | 12.1, 12.2 | M5 |
| R11 terminal interface | 14 | M2 · Dashboard and Issues in M6 |
| R12 headless | 15 | M1 |
| R13 quality and distribution | 2, 16 | M1 · R13.5 packaging in M1 |

| Milestone | Modules built |
|---|---|
| M1 | `config`, `discovery`, `adapters` (skillspector only), `runner`, `stages`, `pipeline`, `workspace`, `ledger`, headless CLI |
| M2 | `queue`, `src/tui/` Work screen with the queue panel |
| M3 | `tools`, setup wizard, doctor |
| M4 | Remaining seven adapters, fan-out policy, cross-tool merge |
| M5 | `isolation`, `release`, retirement, mutating-stage gate |
| M6 | Dashboard and Issues screens, statistics queries |

## 18. What changed in revision 2

| Review finding | Resolution |
|---|---|
| 1 Release cannot be expressed | `StageExecutor` contract (§6); scope-aware sandbox spanning repo root (§12.1); journalled apply (§12.2) |
| 2 Redaction boundary | R7.4 narrowed to streams; native artefacts and snapshots unredacted, mode 0700, gitignored, flagged in `stage.json` (§9.1) |
| 3 Fan-out collisions | Per-tool artefact directories; one stage-level `stage.json` (§9) |
| 4 Outcome model | Explicit `ToolOutcome`/`StageOutcome` and a total reduction; selection resolved before the lockfile (§6, §8) |
| 5 No command path | `RunHandle` and `QueueHandle`; cancellation table (§11.1, §11.4) |
| 6 Identity and reconciliation | Merge-first fingerprint (§10.3); unmapped classes in scope, `acknowledged` reconciles (§10.4); full state machine (§10.5); detection ordinal (§10.1) |
| 7 Repo-root sidecar | `workspacePath()` with the dotdirectory rule and its guards (§4.3) |
| 8 Gates not bound to bytes | `skillDigest` on every run; release precondition requires a match; complete release state machine (§4.4, §12.3) |
| 9 Finalisation race | Per-skill lock, UUIDv7 claimed by exclusive `mkdir`, append-only `index.ndjson` (§9) |
| 10 Boundary inconsistencies | `ParseContext` carries bytes; `bin` in the lock; closed `MetricKey` set; `ledger` owned by `pipeline` (§7, §5.1, §3) |
| 11 Coverage gaps | New sections 4, 5, 13; traceability matrix (§17) |
| 12 Verification gaps | Contract test per P1 finding (§16) |
| Drift | SkillSpector pin corrected to 2.3.7, the installed version |

## 19. Risks carried into implementation

| Risk | Mitigation |
|---|---|
| Adapter contract shaped by Python tooling; five of the eight tool adapters are Python, and M1 validates against one | Pull skill-lint (TypeScript, different output shape) forward if M4 planning shows contract strain |
| Merge-first identity understates occurrence counts | `occurrence_count` and per-detection rows preserve the detail; revisit if the Issues screen proves it insufficient |
| Unredacted native artefacts under the sidecar | 0700, gitignored, `redacted: false` recorded; revisit if a scanner is found to echo credentials into its own report |
| Repo-root workspace inside the scanned tree | Dotdirectory, adapter-level excludes where supported, normaliser drops findings pathed into the workspace |
| Rule-class map goes stale | Unmapped findings degrade to tool-scoped classes; migration is explicit and versioned |
| SARIF dialect differences between the two scanners | Shared parser fixture-tested against both tools' real output before fan-out merging is enabled in M4 |
| Ink responsiveness under sustained output | Ring buffer outside React plus fixed-interval flush; R11.4 is a measurable acceptance test |
| Upstream tools are young and will change output | Golden fixtures tied to pins with a scripted refresh; parse failure degrades to `errored` with the artefact retained, never to a wrong result |
