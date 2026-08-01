# SkillGantry — Design

**Date:** 2026-08-01
**Status:** draft for review
**Layer:** design (layer 2 of 3: [requirements](requirements.md) → design → plan)
**Traces to:** [requirements.md](requirements.md), [decision-log.md](decision-log.md)

Each section names the requirements it satisfies.

---

## 1. Shape of the system

SkillGantry is an engine plus two frontends. The engine discovers skills in registered repos, installs and invokes external CLI tools against them, normalises what those tools emit, writes evidence to each skill's sidecar workspace, and records the result in a local ledger. The TUI and the headless command are both consumers of one typed event stream.

```
             ┌──────────────┐        ┌──────────────┐
             │  TUI (Ink)   │        │ headless CLI │
             └──────┬───────┘        └──────┬───────┘
                    │  typed event stream   │
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

## 3. Module map

*Satisfies R13.1, R13.2.*

Eleven modules under `src/core/`. Rule applied throughout: a module that owns I/O does not also own decisions.

Release is a module, not an adapter: it has no external tool to wrap, so it has no manifest and no `parse`. It does depend on `tools`, because vercel `skills` must be installed for the installability check. Nine external tools are installed in total: eight adapter-backed, plus vercel `skills`.

| Module | Job | Depends on | Owns I/O |
|---|---|---|---|
| `config` | Load/save `~/.skillgantry/config.json`; read and mode-check `.env`; build the redaction value set | — | fs |
| `discovery` | Repo path → `SkillRef[]`; frontmatter parse; git detection | — | fs |
| `tools` | Tool root, three install drivers, lockfile, verify-by-invocation, doctor | `config` | fs, net, subprocess |
| `adapters` | Eight manifest + parse modules; shared SARIF and skill-up parsers; rule-class map | — | **none** |
| `runner` | Spawn one tool: env injection, timeout, output tee, redaction, exit classification | `config`, `tools` | subprocess, fs |
| `pipeline` | Stage sequencing, policy resolution, outcome computation, event emission | `adapters`, `runner`, `workspace`, `isolation` | — |
| `queue` | Bounded worker pool, batch enqueue, cancellation, mutating-stage serialisation | `pipeline` | — |
| `workspace` | Sidecar writer: run dir, `run.json`, `stage.json`, artefact collection, `latest`, `index.json`, gitignore fix | `config` | fs |
| `isolation` | `MutationSandbox` interface; git worktree and snapshot implementations | `discovery` | fs, subprocess |
| `ledger` | SQLite schema and migrations, fingerprinting, reconciliation, stats queries | — | sqlite |
| `release` | Atomic version bump, changelog, zip, evidence bundle, installability check via vercel `skills` | `workspace`, `ledger`, `runner`, `tools` | fs, subprocess |

`adapters` and `ledger` have no dependency on the rest of the engine. That is deliberate: they hold the two subtlest rules in the system and can be tested exhaustively with no mocking, which is what makes M1 a genuine validation of the design.

## 4. Adapter contract

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

interface AdapterManifest {
  id: string
  stage: Stage
  policy: 'fan-out' | 'pick-one'
  mutating: boolean
  detects: KnownRuleClass[]        // reconciliation scope — see §6.3
  requiresCredentials: boolean
  install: InstallSpec
  invoke: { argv: string[]; cwd: 'skillDir' | 'repoRoot' }
  versionArgv: string[]
  artefacts: string[]              // relative to the stage dir
  timeoutMs: number
}

type InstallSpec =
  | { kind: 'uv-tool';    spec: string; pin: string }
  | { kind: 'npm-prefix'; spec: string; pin: string; bin: string }
  | { kind: 'gh-release'; repo: string; pin: string; assetPattern: string }

interface ParseContext {
  skill: SkillRef
  stageDir: string
  artefact(name: string): string   // absolute path; throws if the manifest didn't declare it
  stdout: string
  stderr: string
  exitCode: number | null          // null when killed by timeout
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
  outcome: 'passed' | 'failed' | 'errored'
  findings: RawFinding[]
  metrics: Record<string, number>  // durationMs, casesPassed, casesTotal, …
  summary: string                  // one line for the lifecycle rail
}

type Parse = (ctx: ParseContext) => ToolResult
```

`{skillDir}`, `{repoRoot}` and `{stageDir}` in `invoke.argv` are substituted at spawn time. When a mutation sandbox is active, `{skillDir}` resolves to the sandbox path, not the user's working tree.

**Example adapter** (`src/core/adapters/skillspector.ts`):

```ts
export const manifest: AdapterManifest = {
  id: 'skillspector',
  stage: 'security',
  policy: 'fan-out',
  mutating: false,
  detects: ['prompt-injection', 'credential-access', 'unsafe-script',
            'data-exfiltration', 'vulnerable-dep', 'excessive-permission'],
  requiresCredentials: false,
  install: { kind: 'uv-tool', spec: 'skillspector', pin: '0.4.2' },  // pinned at setup, mirrored into the lockfile
  invoke: { argv: ['scan', '{skillDir}', '--format', 'sarif',
                   '--output', '{stageDir}/findings.sarif'], cwd: 'repoRoot' },
  versionArgv: ['--version'],
  artefacts: ['findings.sarif'],
  timeoutMs: 120_000,
}

export const parse: Parse = (ctx) =>
  parseSarif(ctx.artefact('findings.sarif'), { toolId: 'skillspector' })
```

### 4.1 Rule-class mapping

*Satisfies R8.3, R8.5.*

A single table, `src/core/adapters/rule-classes.ts`, maps `(toolId, nativeRuleId)` onto a `KnownRuleClass`. Anything unmapped becomes `unmapped:<toolId>:<nativeRuleId>`, which is tool-scoped and therefore can never merge with another tool's finding. Adding a mapping later merges previously separate issues; that is a visible, intended migration, not silent drift.

Severity normalisation for SARIF: `error → high`, `warning → medium`, `note → low`, `none → info`. A tool exposing its own richer scale maps through its adapter.

## 5. Finding identity

*Satisfies R8.4, R8.6.*

```
messageShape = message
                 lowercased
                 numbers            → «n»
                 quoted strings     → «s»
                 path-like tokens   → «p»
                 collapsed whitespace

fingerprint  = sha256(skillId ‖ normalisedRelPath ‖ ruleClass ‖ messageShape).slice(0, 12)
```

Line numbers are excluded, so editing elsewhere in a file does not resurrect triaged issues. Message shape rather than a positional ordinal, so fixing one of three same-class findings in a file does not renumber the survivors.

Known limitation, accepted: two findings of the same rule class in one file whose messages differ only in a number or a quoted string collapse to one issue. In practice such findings are near-duplicates; the alternative reintroduces line-number instability.

## 6. Ledger

*Satisfies R8.1, R8.2, R8.7–R8.9.*

### 6.1 Schema

```sql
repos(id, path UNIQUE, name, is_git, registered_at)

skills(id, repo_id, name, rel_path, current_version,
       lifecycle_state,          -- active | deprecated  (R1.4)
       first_seen, last_seen,
       UNIQUE(repo_id, rel_path))

runs(id, skill_id, trigger, started_at, ended_at, outcome,
     provenance_json,            -- R7.5
     tool_lock_json,             -- R3.3, snapshot for this run
     sidecar_path)

stages(id, run_id, stage, outcome, started_at, ended_at, metrics_json)

tool_runs(id, stage_id, tool_id, tool_version, outcome,
          exit_code, duration_ms, artefact_dir, error_kind)

issues(fingerprint PK, skill_id, rule_class, rel_path, message_shape,
       severity_max, state, note,
       first_seen_run, last_seen_run, closed_run)

issue_detections(issue_fp, tool_run_id, native_rule_id,
                 native_severity, line, message,
                 PRIMARY KEY(issue_fp, tool_run_id))
```

The ledger stores no raw tool output. `tool_runs.artefact_dir` points at the sidecar, which holds the evidence.

### 6.2 Provenance

`run.json` in the sidecar mirrors two ledger columns as separate top-level keys. `provenance` maps to `runs.provenance_json`, `toolLock` to `runs.tool_lock_json`; neither duplicates the other.

```json
{
  "runId": "2026-08-01T0912-7f3a",
  "skillId": "zapac/declawed",
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
  "toolLock": { "skillspector": "0.4.2" }
}
```

The token itself never appears. The hash exists only so a key change is detectable when comparing runs.

### 6.3 Reconciliation

*Satisfies R8.8.*

Runs once, after a run completes:

```
for each toolRun in this run where outcome ∈ {passed, failed}:
    detectable ← manifest(toolRun.tool_id).detects
    reported   ← fingerprints this toolRun produced
    candidates ← open issues for this skill where
                   rule_class ∈ detectable
                   AND the issue's most recent detection came from this tool
    for each issue in candidates \ reported:
        issue.state ← 'fixed'; issue.closed_run ← run.id
```

Tool runs with outcome `errored` are skipped entirely, which is what prevents a crashed scanner from closing every issue it ever found. Issues in state `wontfix` are never auto-closed and never re-opened; a fresh detection updates `last_seen_run` only.

## 7. Sidecar layout

*Satisfies R6.1–R6.6.*

```
declawed-workspace/
  iteration-1/                        ← pre-existing, read-only
  iteration-3/
  skillgantry/
    runs/
      2026-08-01T0912-7f3a/
        run.json
        snapshot-pre/                 ← non-git mutation sandbox only
        01-validate/   stdout.log  stage.json  <native artefacts>
        02-evaluate/   stdout.log  stage.json  report.json
        03-security/   stdout.log  stage.json  findings.sarif
        evidence/                     ← release stage only
      latest -> 2026-08-01T0912-7f3a
      index.json
```

Run id is `<ISO minute>-<4 hex>`: sortable, collision-safe within a minute, filesystem-safe.

`stage.json` holds the `ToolResult` per tool plus the computed stage outcome, so a sidecar is self-describing when copied without the ledger.

`index.json` is an append-only summary (run id, timestamps, stage outcomes, issue delta) so the TUI can list history without opening every run directory.

## 8. Execution

*Satisfies R5.1–R5.10, R13.2.*

### 8.1 Event stream

`pipeline.run()` returns an async iterable of discriminated-union events. Nothing in `core` writes to a terminal.

```
run:start        { runId, skillId, stages, sidecarPath }
stage:start      { runId, stage, tools }
tool:start       { runId, stage, toolId, toolVersion }
tool:output      { runId, stage, toolId, chunk, stream }
tool:done        { runId, stage, toolId, result }
stage:done       { runId, stage, outcome, findingCount }
mutation:pending { runId, stage, diff }              ← blocks until resolved
mutation:resolved{ runId, stage, action }            ← apply | discard
run:done         { runId, outcome, issueDelta }
```

### 8.2 Sequence

1. `queue` worker takes a job and calls `pipeline.run(skill, stages, opts)`
2. `workspace.createRun()` → run id, sidecar directory, `run.json` with provenance and tool lock
3. Per stage: resolve selected tools from config intersected with the lockfile; read policy from their manifests
4. If the stage is mutating, `isolation.open(skill)` first; `{skillDir}` resolves into the sandbox
5. Per tool: `runner.spawn()` → output tees to the ring buffer and to `stdout.log` through the redaction transform → `adapters.parse()` → `stage.json` written
6. Stage outcome computed from tool outcomes; the chain halts unless it is `passed`
7. A mutating stage emits `mutation:pending` and blocks; on `apply` the sandbox writes through, on `discard` it rolls back
8. `workspace.finalizeRun()` → `index.json`, `latest`
9. `ledger.record()` → fingerprint, upsert issues and detections, reconcile

### 8.3 Outcome computation

| Tool outcomes within a stage | Stage outcome |
|---|---|
| all `passed` | `passed` |
| at least one `failed`, none `errored` | `failed` |
| at least one `passed`, at least one `errored` | `degraded` |
| all `errored` | `errored` |
| all `skipped` | `skipped` |

Release is fail-closed: it refuses on anything other than `passed`.

### 8.4 Queue

Worker pool of size `config.concurrency` (default 2). Mutating jobs take an exclusive lock, so they never overlap with each other or with a read-only job on the same skill. Cancellation kills the process tree, marks the in-flight tool run `errored` with `error_kind = 'cancelled'`, and finalises the run so its partial evidence survives.

## 9. Failure handling

*Satisfies R5.9, R8.8.*

**Governing rule: a successful parse is authoritative; exit code is only a fallback signal.** Linters and scanners routinely exit non-zero precisely because they found something, so exit code alone cannot distinguish "gate red" from "tool broke".

| Condition | Outcome | `error_kind` | Issue effect | Retained |
|---|---|---|---|---|
| Parse succeeds, no findings | `passed` | — | reconcile | `stage.json` + native artefacts |
| Parse succeeds, findings present | `failed` | — | reconcile | same |
| Non-zero exit, nothing parseable | `errored` | `exit` | none | `stdout.log` |
| Timeout | `errored` | `timeout` | none | partial `stdout.log` |
| Declared artefact missing | `errored` | `missing-artefact` | none | `stdout.log` |
| `parse()` throws | `errored` | `parse` | none | raw artefact kept for triage |
| Cancelled by user | `errored` | `cancelled` | none | partial `stdout.log` |
| Tool absent from lockfile | `skipped` | `not-installed` | none | — |
| Credentials required, `.env` missing | `skipped` | `no-credentials` | none | — |

## 10. Mutation isolation

*Satisfies R10.1–R10.7.*

```ts
interface MutationSandbox {
  workDir: string                      // where tools operate
  diff(): Promise<UnifiedDiff>
  apply(): Promise<void>
  discard(): Promise<void>
  dispose(): Promise<void>
}
```

**`GitWorktreeSandbox`**: `git worktree add --detach <tmp> HEAD`; `workDir` is `<tmp>/<skillRelPath>`; `diff()` is `git diff` scoped to that path; `apply()` copies changed files into the real working tree without committing or merging; `dispose()` removes the worktree.

**`SnapshotSandbox`**: copies the skill directory to `<run>/snapshot-pre/`; `workDir` is the real skill directory; `diff()` compares live against the snapshot; `discard()` restores from it.

One asymmetry, named rather than hidden: the worktree strategy mutates a copy, so `discard()` is a no-op on the user's files and a crash is harmless. The snapshot strategy mutates the original, so `discard()` is a genuine restore and a crash mid-write leaves the skill dirty until rollback. The interface is identical; the risk profile is not.

The R10.3 dirty-skill guard exists because a worktree starts at HEAD: uncommitted work would be absent from the tool's input and missing from the resulting diff.

## 11. Credentials and redaction

*Satisfies R7.1–R7.6.*

`config` reads `~/.skillgantry/.env`, warns if the mode is looser than 600, and builds a redaction set from every value that looks secret: `ANTHROPIC_AUTH_TOKEN`, `*_API_KEY`, `*_TOKEN`, and any value matching a high-entropy key pattern.

`runner` pipes both child streams through a `RedactionTransform` before anything reaches disk. The transform holds a small tail buffer so a secret split across chunk boundaries is still caught, and replaces each hit with `«redacted:NAME»`. Redaction sits on the **write** path, not the render path, so the invariant holds for the headless command, the ring buffer and the sidecar alike.

Credentials are passed to children through the spawn environment only. SkillGantry writes no credential to any file it creates.

## 12. Terminal interface

*Satisfies R11.1–R11.5.*

One store fed exclusively by core events; Ink components are pure functions of it.

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

Render discipline, which is the whole mitigation for choosing Ink: `tool:output` chunks go into a per-tool-run ring buffer of 2000 lines held **outside** React. A 100 ms tick copies the visible window into state. Every other pane re-renders only on discrete state change. Log text never enters component state line by line.

Screens: Work (above), Dashboard (ledger aggregates), Issues (cross-repo table with state transitions), Tools (install, pin, verify, doctor), Settings (repos, concurrency, credentials status). Vim-style movement, `?` for help, `:` for a command palette.

## 13. Headless interface

*Satisfies R12.1–R12.4.*

```
skillgantry run <skill> [--repo <path>] --stage validate,evaluate,security
                        [--json] [--yes] [--concurrency N]
```

Consumes the same event stream, renders it as line output or newline-delimited JSON. Exits non-zero when any stage outcome is not `passed`. Mutating stages are skipped without `--yes`.

## 14. Test strategy

*Satisfies R13.3, R13.4.*

| Target | Method | Guards |
|---|---|---|
| `adapters` | Golden fixtures captured from real `zapac-agent-skills` runs; pure input → output | Upstream schema drift; the highest-value suite |
| `ledger` | In-memory SQLite; fingerprint stability under whitespace and line-shift edits; reconciliation including an errored tool | The two subtlest rules in the design |
| `pipeline` | Fake adapters and fake runner; full outcome matrix; fail-fast; mutating-stage gating | Sequencing logic, with no subprocess |
| `runner` | Real subprocesses against fixture scripts: exit codes, sleep-to-timeout, an env-echoing script | Redaction verified rather than assumed |
| `isolation` | Real git and non-git repo fixtures in tmp | Apply and rollback on both strategies |
| `release` | Version-sync invariant including the mismatch refusal | The one stage that writes to the user's repo |
| `discovery` | Fixture trees including the `*-workspace/` snapshot trap and a single-skill repo | R2.3 and R2.4 |
| `tui` | `ink-testing-library` on the Work screen | Smoke level only |

Fixture capture is a scripted, repeatable step so fixtures can be refreshed when a tool is upgraded.

## 15. Milestone mapping

| Milestone | Modules built | Design sections |
|---|---|---|
| M1 | `config`, `discovery`, `adapters` (skillspector only), `runner`, `pipeline`, `workspace`, `ledger`, headless CLI | 2–9, 11, 13, 14 |
| M2 | `src/tui/` Work screen | 12 |
| M3 | `tools` + setup wizard | 3, 4 (install specs) |
| M4 | Remaining seven tool adapters, fan-out policy | 4, 4.1, 8.3 |
| M5 | `isolation`, `release`, mutating-stage gate | 10, and release in 3 |
| M6 | Dashboard and Issues screens | 6, 12 |

## 16. Risks carried into implementation

| Risk | Mitigation |
|---|---|
| Adapter contract shaped by Python tooling; five of the eight tool adapters are Python, and M1 validates against one of them | Pull skill-lint (TypeScript, different output shape) forward if M4 planning shows contract strain |
| Rule-class map goes stale as tools evolve | Unmapped findings degrade to tool-scoped classes rather than merging wrongly; the map is data with its own tests |
| SARIF dialect differences between the two scanners | Shared parser is fixture-tested against both tools' real output before fan-out merging is enabled in M4 |
| Ink responsiveness under sustained output | Ring buffer outside React plus fixed-interval flush; R11.4 is a measurable acceptance test, not an aspiration |
| Upstream tools are young and will change their output | Golden fixtures with a scripted refresh; parse failure degrades to `errored` with the raw artefact retained, never to a wrong result |
