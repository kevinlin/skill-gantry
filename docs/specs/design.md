# SkillGantry — Design

**Date:** 2026-08-01
**Status:** revision 3, incorporating [design-review-r2.md](design-review-r2.md)
**Layer:** design (layer 2 of 3: [requirements](requirements.md) → design → plan)
**Traces to:** [requirements.md](requirements.md), [decision-log.md](decision-log.md)

Each section names the requirements it satisfies. Revision 2 closed the twelve findings of the first review; revision 3 closes the eleven of the second. §18 records what changed in each. §18.2 records the three sections M3 planning amended.

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
| `discovery` | Repo path → `SkillRef[]`; frontmatter parse; git detection; `workspacePath()`; `candidateManifest()`; `skillDigest()`; `materialiseCandidate()` | — | fs |
| `tools` | Tool root, three install drivers, lockfile with resolved executables, verify-by-invocation, doctor | `config` | fs, net, subprocess |
| `adapters` | Eight manifest + parse modules; shared SARIF and skill-up parsers; rule-class map | — | **none** |
| `runner` | Spawn one tool: env injection, timeout with process-tree kill, stream redaction, artefact loading, exit classification | `config`, `tools` | subprocess, fs |
| `stages` | `StageExecutor` contract; `AdapterStageExecutor`; `ReleaseStageExecutor`; outcome reduction | `adapters`, `runner`, `release` | — |
| `pipeline` | Stage sequencing, mutation gating, event emission, run finalisation transaction | `stages`, `workspace`, `isolation`, `ledger` | — |
| `queue` | Bounded worker pool, batch enqueue, cancellation, mutating-stage serialisation | `pipeline` | — |
| `workspace` | Sidecar writer: run dir claim, `run.json`, `stage.json`, per-tool dirs, `latest`, `index.ndjson`, gitignore fix, per-skill finalisation lock | `config`, `discovery` | fs |
| `isolation` | `MutationSandbox` over a declared path scope; git worktree and snapshot implementations; journalled apply | `discovery` | fs, subprocess |
| `ledger` | SQLite schema and migrations, fingerprinting, reconciliation, issue state machine, stats queries | — | sqlite |
| `release` | Release state machine, version resolution, changelog, archive, evidence bundle, installability check | `workspace`, `ledger`, `runner`, `tools`, `discovery` | fs, subprocess |

`adapters` and `ledger` have no dependency on the rest of the engine. That is deliberate: they hold the two subtlest rules in the system and can be tested exhaustively with no mocking, which is what makes M1 a genuine validation of the design.

## 4. Discovery, config and identity

*Satisfies R2.1–R2.12.*

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

Revision 2 accepted a residual risk here: for a repo-root skill the workspace lies inside the directory tools are asked to scan, and findings pathed into it were dropped after the fact by the normaliser. §4.4 removes that risk instead of tolerating it. Post-scan filtering is too late — a model-assisted scanner can read an old unredacted artefact and transmit it before SkillGantry ever sees the finding.

### 4.4 Candidate manifest

*Satisfies R2.8, R2.9, R9.4, R9.9, R10.4.*

One exclusion rule, computed once, used by everything that has to answer "which bytes are this skill". Digesting, packaging, snapshotting all read the same manifest, and for a repo-root skill so does the input a tool is pointed at. Nothing filters after the fact.

```ts
interface CandidateManifest {
  root: string                              // absolute candidate root
  entries: CandidateEntry[]                 // sorted by relPath, POSIX separators
  selfContained: boolean                    // false ⇒ root holds SkillGantry-owned paths
}

type CandidateEntry =
  | { kind: 'file'; relPath: string; exec: boolean }
  | { kind: 'symlink'; relPath: string; target: string }   // never followed
```

`candidateManifest(skill)` walks `skill.dir` and includes every entry except these **exact** SkillGantry-owned or repo-control paths, resolved against the candidate root rather than matched by basename:

| Excluded | Why |
|---|---|
| `workspacePath(skill)` | the sidecar; the only place SkillGantry writes |
| `.git/` | repo metadata, not skill content |
| `<skillName>_*.zip` at the candidate root | release archives, which for a repo-root skill land inside the tree |
| `.gitignore` at the candidate root **of a repo-root skill only** | repo control that SkillGantry itself mutates under R6.6 |

Basename matching is deliberately gone. Revision 2 excluded "any `snapshot-pre/` directory", which would have let a legitimately named skill directory change without invalidating gate evidence. Snapshots live at `<run>/snapshot-pre/` inside the workspace, so the workspace exclusion already covers them.

**Symlinks are hashed, never followed.** A symlink is recorded as its own entry carrying the literal target text, so retargeting a link changes the digest while the link's target is never read, hashed or packaged. A symlink whose target resolves outside the candidate root is a hard error at manifest time, reported as `candidate-escapes-root`; that one rule holds identically across digest, snapshot, change set, rollback and archive, so no stage can follow a link the others refuse.

**Materialisation.** When `selfContained` is false, which today means a repo-root skill, `materialiseCandidate()` copies the manifest into a private temp directory, preserving modes and links, and `{skillDir}` resolves there for the duration of the stage. A tool therefore cannot observe the workspace at all, whether or not it honours an exclusion flag. When `selfContained` is true the manifest is used in place and no copy is made, so the common case costs nothing.

**Ordering.** The R6.6 `.gitignore` fix runs before the manifest is built, so a run never captures a digest that its own gitignore write immediately invalidates. For a repo-root skill that ordering is belt and braces, since the file is excluded from the candidate anyway.

### 4.5 Skill digest

*Satisfies R2.8, R9.9.*

```
skillDigest(skill) = sha256 over candidateManifest(skill).entries, in order:
    file    → relPath ‖ 'f' ‖ (mode & 0o111 ? 1 : 0) ‖ sha256(contents)
    symlink → relPath ‖ 'l' ‖ sha256(target text)
```

The digest is a function of the manifest and nothing else, so the bytes gated, the bytes snapshotted and the bytes packaged are the same set by construction rather than by three exclusion lists agreeing.

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
      "requestedPin": "v2.5.1",
      "resolvedVersion": "2.5.1",
      "bin": "/Users/…/.skillgantry/tools/skillspector/bin/skillspector",
      "integrity": "n/a",
      "installedAt": "2026-08-01T09:12:03Z",
      "verifiedAt": "2026-08-01T09:12:05Z"
    }
  }
}
```

`bin` is the resolved absolute executable. The adapter manifest supplies arguments only; it never has to know how the executable was placed on disk. This closes the first review's observation that `uv-tool` and `gh-release` installs left the executable unidentified.

`integrity` is `"n/a"` for kinds whose package manager already verifies its own download, and for `gh-release` it is `"sha256:<hex>"` or `"none"` per §5.2.

**Milestone split.** M1 builds the `uv-tool` driver, the lock writer and verify-by-invocation only — enough to produce a real managed SkillSpector install that M1's runner can resolve. `npm-prefix`, `gh-release`, presets, the wizard and `doctor` remain M3. Revision 2 put the whole module in M3 while asking M1 to run a real scanner, which it could not do.

### 5.1a Tool catalogue

*Satisfies R3.5, R3.5a.*

`src/core/tools/catalogue.ts` holds one `ToolSpec` per installable tool: id, display name, the stage that selects it (`null` for vercel `skills`, which release invokes and no stage selects), the runtime its driver needs, its install spec and its version argv.

The catalogue exists separately from the adapter registry because installability and runnability are not the same property. Vercel `skills` is installable with no adapter, and seven adapters arrive in M4 with parsers for tools M3 already installs. The catalogue is the authority for installing, verifying and locking; the adapter registry is the authority for what a run may select. `AdapterManifest.install` is retained as documentation and kept in step by a test asserting the two agree for every tool holding both.

A consequence the wizard must respect: a selection written into `stageTools` names only tools the adapter registry knows, since `AdapterStageExecutor.plan()` rejects an unknown id and would fail every run of that stage. An installed tool with no adapter is reported as installed and not yet runnable.

A tool D7 names but no public source publishes in installable form is omitted from the catalogue rather than carried as an entry that can only fail. The omissions and the probe output behind each are recorded in [plan-m3.md](plan-m3.md).

### 5.2 Install drivers

| Kind | Mechanism | Executable resolution |
|---|---|---|
| `uv-tool` | `uv tool install <requirement>` with `UV_TOOL_DIR=<toolRoot>/<id>` and `UV_TOOL_BIN_DIR=<toolRoot>/<id>/bin` in the child environment, where `<requirement>` is `<spec>==<pin>` for a registry spec and `<spec>@<pin>` for a `git+` spec | `<toolRoot>/<id>/bin/<binName>` |
| `npm-prefix` | `npm install --prefix <toolRoot>/<id> <spec>@<pin>` | `<toolRoot>/<id>/node_modules/.bin/<binName>` |
| `gh-release` | download the asset matching `assetPattern` for tag `<pin>`, verify integrity per `integrity`, extract | declared `binName` inside the extracted tree |

Revision 2 specified `uv tool install --tool-dir <path>`. uv 0.7.12, the version this project targets, rejects that with `unexpected argument '--tool-dir'`; relocation is done through `UV_TOOL_DIR` and `UV_TOOL_BIN_DIR`. Both are set explicitly on the child rather than inherited, so an install can never land in the user's global `~/.local/share/uv/tools`.

`gh-release` integrity is declared, not assumed:

```ts
type Integrity =
  | { kind: 'sha256-asset'; assetPattern: string }   // checksum file published beside the binary
  | { kind: 'sha256-digest'; digest: string }        // digest pinned in the manifest
  | { kind: 'none'; reason: string }                 // upstream publishes nothing verifiable
```

`sha256-asset` and `sha256-digest` fail the install on mismatch. `kind: 'none'` requires a written reason, records `integrity: "none"` in the lock entry, and surfaces a warning in `doctor`, so an unverifiable download is a visible standing condition rather than a silent one. Revision 2 promised checksum verification with no field to carry a checksum; this closes that.

`assetPattern` may carry `{os}` and `{arch}`, substituted from the host before matching — `{os}` from `process.platform`, `{arch}` as `arm64` or `amd64`. A single fixed pattern cannot resolve a per-platform release asset on two machines.

### 5.3 Setup and doctor

Setup is a four-state machine: `probe-runtimes → select-tools → install-and-verify → credentials-and-repo`. Each state is re-enterable, so `doctor` reuses `probe-runtimes` and `install-and-verify` without the rest.

Presets: **Minimal** is skill-up plus skillspector — the two already present, one evaluate and one security tool. **Recommended** is at most one tool per stage. **Everything** is the whole catalogue. A stage whose D7 candidates are all unavailable has no tool in any preset; that is visible in the wizard rather than papered over. Optimise is that stage: both its candidates are unpublished. Evaluate has one candidate rather than two, because promptfoo needs a per-skill config file no skill carries — decision-log §10.

Every preset includes vercel `skills`, because the release stage cannot run its installability gate without it.

Doctor reports four drift kinds per tool: `missing` (in lock, absent on disk), `unverifiable` (present, will not run), `version-drift` (runs, reports a version other than `resolvedVersion`), and `unlocked` (installed under the tool root but absent from the lock). Three further conditions are reported and do not fail the report: `integrity-unverified`, a lock entry recording `integrity: "none"` per §5.2; `lifecycle-drift` per §13; and `rule-map-pending`, a ledger whose applied rule-map version trails the shipped one per §10.6. None means a tool cannot run. `rule-map-pending` is resolved by `skillgantry doctor --migrate-rule-map`, which is the explicit trigger R8.14 requires — the migration never runs as a side effect of opening the ledger.

Doctor reads the skills it checks and the ledger's lifecycle column as data supplied by its caller, so `tools` needs neither discovery's I/O nor a sqlite dependency.

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

`AdapterStageExecutor` drives manifests and parsers. `ReleaseStageExecutor` runs the state machine in §12.4 and declares a mutation scope spanning `<skill>/SKILL.md`, `<skill>/CHANGELOG.md`, the archive at `<repoRoot>/<skillName>_<version>.zip`, and, when present, the repo-root `versions.json`. The archive is in scope because R9.4 makes it an output that must be previewed, journalled and rolled back like any other.

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
  detects: KnownRuleClass[]        // declared scope — widened at runtime, see §10.4
  credentials: CredentialRequirement
  /** Free-form label for how the tool was asked to analyse, recorded in provenance. */
  analysisMode: string
  install: InstallSpec
  invoke: { argv: string[]; cwd: 'skillDir' | 'repoRoot' }
  versionArgv: string[]
  artefacts: string[]              // relative to this tool's artefact dir
  binaryArtefacts?: string[]       // subset copied verbatim, never parsed
  timeoutMs: number
}

/**
 * A boolean cannot express "one of four provider credential sets", which is
 * exactly what SkillSpector needs, so the wizard could neither name the missing
 * value nor tell whether the configured provider was usable.
 */
type CredentialRequirement =
  | { kind: 'none' }
  /** Satisfied when every key of at least one alternative is present and non-empty. */
  | { kind: 'one-of'; alternatives: CredentialSet[] }

interface CredentialSet {
  /** Human label for the wizard, e.g. 'OpenAI'. */
  provider: string
  required: string[]               // env keys that must all be present
  optional?: string[]
  /** Env assignment that selects this provider, when the tool needs one. */
  selects?: Record<string, string>
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

`{skillDir}`, `{repoRoot}` and `{toolDir}` in `invoke.argv` are substituted at spawn time. `{skillDir}` resolves, in order of precedence: inside the mutation sandbox when one is active, then the materialised candidate root when the manifest is not self-contained (§4.4), then the skill directory itself. `{repoRoot}` follows the sandbox the same way. A tool therefore never receives a path that can reach the workspace.

**Example adapter** (`src/core/adapters/skillspector.ts`), pinned to the version actually installed:

```ts
export const manifest: AdapterManifest = {
  id: 'skillspector',
  stage: 'security',
  policy: 'fan-out',
  mutating: false,
  /** Static mode only. The LLM analysers reach further; see the note below. */
  detects: ['prompt-injection', 'credential-access', 'unsafe-script',
            'data-exfiltration', 'excessive-permission'],
  credentials: { kind: 'none' },
  analysisMode: 'static',
  install: { kind: 'uv-tool', spec: 'git+https://github.com/NVIDIA/skillspector.git', pin: 'v2.5.1',
             binName: 'skillspector' },
  invoke: { argv: ['scan', '{skillDir}', '--no-llm', '--format', 'sarif',
                   '--output', '{toolDir}/findings.sarif'], cwd: 'repoRoot' },
  versionArgv: ['--version'],
  artefacts: ['findings.sarif'],
  timeoutMs: 120_000,
}

export const parse: Parse = (ctx) =>
  parseSarif(ctx.artefacts.get('findings.sarif')!, { toolId: 'skillspector' })
```

**Analysis mode is a declared choice, not a fallback.** SkillSpector 2.5.1's `scan` runs LLM analysis by default and aborts unless one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, an AWS credential chain or `NVIDIA_INFERENCE_KEY` is available. Revision 2's example declared `requiresCredentials: false` and omitted `--no-llm`, so the M1 slice would have failed at runtime while the engine believed no credential was needed.

v1 pins the static mode: `--no-llm`, `credentials: { kind: 'none' }`, and a `detects` set covering only what static analysis reaches. The reason is comparability. LLM-mode findings are nondeterministic, which makes golden fixtures worthless and makes the two modes' statistics incommensurable, so silently degrading from one to the other is worse than failing. `analysisMode` is copied into `run.json` provenance, so a later mode change appears as a visible boundary in the stats exactly as a provider change does.

An LLM-mode variant is a separate adapter id when it is wanted, declaring:

```ts
credentials: {
  kind: 'one-of',
  alternatives: [
    { provider: 'NVIDIA', required: ['NVIDIA_INFERENCE_KEY'],
      selects: { SKILLSPECTOR_PROVIDER: 'nv_inference' } },
    { provider: 'OpenAI', required: ['OPENAI_API_KEY'], optional: ['OPENAI_BASE_URL'],
      selects: { SKILLSPECTOR_PROVIDER: 'openai' } },
    { provider: 'Anthropic', required: ['ANTHROPIC_API_KEY'],
      selects: { SKILLSPECTOR_PROVIDER: 'anthropic' } },
  ],
}
```

`detects` for either mode is derived by the fixture-capture script from real output at the pinned version, not hand-listed, so the declaration and the fixtures cannot drift apart. Under §10.4 a too-narrow `detects` is no longer a correctness hazard, only a completeness one.

### 7.1 Rule-class mapping

*Satisfies R8.3, R8.5.*

`src/core/adapters/rule-classes.ts` maps `(toolId, nativeRuleId)` onto a `KnownRuleClass`. Anything unmapped becomes `unmapped:<toolId>:<nativeRuleId>`, which is tool-scoped and can never merge with another tool's finding. Adding a mapping later merges previously separate issues; §10.5 defines that migration.

SARIF severity normalisation: `error → high`, `warning → medium`, `note → low`, `none → info`.

Path normalisation: a tool reports paths relative to the directory it was pointed at, which is the candidate root, not the repo root. Verified against SkillSpector 2.5.1, which scanning `declawed` emits `uri: "SKILL.md"` and `uri: "scripts/scan.py"`. The normaliser rebases each path onto `skill.relPath` to produce the repo-relative form R8.3 requires, so a materialised candidate and an in-place one yield identical findings.

Findings whose path still resolves inside a workspace directory are dropped. Under §4.4 no tool can see the workspace at all, so this is a backstop against a tool inventing a path, not the guard it was in revision 2.

### 7.2 Shared eval-report parser

*Satisfies R4.4.*

`src/core/adapters/eval-report.ts` parses skill-up's `schema_version: "v1alpha1"` report into a `ToolResult`, so any evaluate adapter emitting that schema needs no bespoke parsing. It is the second of the two shared parsers R4.4 requires; §7.1's neighbour `sarif.ts` is the first.

Mapping:

| Report field | Becomes |
|---|---|
| `case_results[].status` | `PASS` contributes nothing; anything else is one `RawFinding` of class `eval-failure` |
| `case_results[].case_id` | the finding's path, as `<skillRelPath>/evals/cases/<case_id>.yaml` |
| `case_results[].title` and `grading.assertion_results[].evidence` | the finding message |
| `case_results[].status` counts | `casesTotal`, `casesPassed`, `casesErrored` |
| `case_results[].turns`, summed | `turns` |
| `input_tokens`, `output_tokens`, `total_tokens` | **dropped** |

A case result carries no file path, so the finding's path is derived from the case id under skill-up's own layout convention. The alternative, pathing every failure at `evals/eval.yaml`, would collapse a whole failing suite into one issue and make "which case regressed" unanswerable from the ledger — R8.4's identity is `(skillId, relPath, ruleClass)`, so the path is the only field that can separate them. The cost is that a repo storing its cases elsewhere gets an issue pathed at a file that does not exist: a display defect, not an identity one, since the fingerprint stays stable and per-case.

Token fields are dropped rather than mapped, because `MetricKey` has no key that could hold them. That is R1.5 enforced by construction — `coerceMetrics` throws on an unknown key, so a parser forwarding them fails its own test.

## 8. Outcome model

*Satisfies R4.13, R5.1, R5.11.*

```ts
type ToolOutcome  = 'passed' | 'failed' | 'errored' | 'skipped'
type StageOutcome = 'passed' | 'failed' | 'degraded' | 'errored' | 'skipped'
```

### 8.1 Tool-outcome classification

Revision 1 carried a failure policy; revision 2 dropped it while keeping the stage reduction that consumes its output. The reduction is total but starts one step too late, so this restores the missing step.

**The governing rule: a successful, schema-valid parse is authoritative, and the exit code is fallback evidence only.** Linters and scanners routinely exit non-zero precisely because they found something, so treating exit status as primary would convert valid findings into errors.

Evaluated in order; the first row that matches wins.

| # | Condition | `ToolOutcome` | `error_kind` | Reconciles? |
|---|---|---|---|---|
| 1 | Tool not in the lock, or lock entry has no runnable `bin` | `skipped` | `not-installed` | no |
| 2 | `credentials` unsatisfied by the environment | `skipped` | `no-credentials` | no |
| 3 | Mutating stage reached without authorisation | `skipped` | `no-authorisation` | no |
| 4 | Cancelled (§11.4) | `errored` | `cancelled` | no |
| 5 | Timeout fired, process tree killed | `errored` | `timeout` | no |
| 6 | A declared artefact exceeds the size cap | `errored` | `artefact-too-large` | no |
| 7 | A declared artefact is absent after exit | `errored` | `missing-artefact` | no |
| 8 | `parse` throws, or rejects the artefact as malformed | `errored` | `parse` | no |
| 9 | `parse` returns `errored` | `errored` | `parse` | no |
| 10 | `parse` succeeds, no findings, exit code 0 | `passed` | — | yes |
| 11 | `parse` succeeds, no findings, exit code non-zero | `passed` | — | yes |
| 12 | `parse` succeeds, findings present | `failed` | — | yes |
| 13 | Spawn itself failed (ENOENT, EACCES) | `errored` | `spawn` | no |

Rows 7 and 8 are ordered so a missing report is classified before the parser is ever handed an empty map; revision 2 left this to whichever error the parser happened to throw. Row 11 is the rule that matters most in practice: a scanner exiting 1 with a clean report has passed, and the parse says so.

Only rows 10 to 12 feed issue reconciliation: the tool actually ran and its output was understood. Every other row leaves the ledger's issue states untouched, which is the fail-safe that stops a crashed or absent scanner from closing everything it once found.

The parser's own verdict is confined to `passed | failed | errored`; `skipped` is producible only by the executor, since a tool that never ran has no parser to speak for it.

### 8.2 Stage reduction

Reduction over the non-empty multiset of tool outcomes in a stage, using two axes:

```
ran      = count(passed) + count(failed)
complete = count(errored) == 0 && count(skipped) == 0
verdict  = count(failed) > 0 ? 'failed' : 'passed'

StageOutcome =
    complete            → verdict
  : ran > 0             → 'degraded'
  : count(errored) > 0  → 'errored'
  : otherwise           → 'skipped'
```

`verdict` is a field of the stage result in its own right, carried on `StageResult` and in the `stages.verdict` column, not a metric. Revision 2 said `degraded` "carries verdict in metrics", which a closed, numeric-only `MetricKey` cannot hold. It matters for `degraded`: the stage did not complete, but the tools that did run either found something or did not, and a frontend needs both facts.

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

### 9.1 Index durability

`index.ndjson` is one JSON object per line. Each record is serialised with its terminating newline and written in a **single** `write()` to a descriptor opened `O_APPEND`, followed by `fsync`, under the per-skill lock. That is the strongest guarantee POSIX offers, and it is not a guarantee of atomicity: a process or power failure can still leave a partial final line. Revision 2 claimed append placement made truncation land on a line boundary, which is not true.

The recovery rule is therefore on the reader, where it belongs. A reader parses line by line and, on a final line that is truncated or invalid JSON, discards it and treats the file as ending at the last newline. An appender that finds the file not ending in a newline writes a leading newline before its record, so one lost record never corrupts the next. A record is a run summary that the run directory already holds in full, so a lost tail line costs an index entry, never evidence.

### 9.2 `latest` and locking

`latest` names the finalised run with the **greatest run id**. UUIDv7 is time-ordered by claim, so this is one stable field, independent of finish order and of lock acquisition order. Two runs that start in one order and finish in the other therefore agree on `latest` — revision 2 called it deterministic without defining "later", which left exactly that case open. It is rewritten under the per-skill lock via temp-file-and-rename.

The per-skill lock is an **advisory OS lock held on an open descriptor**, so the kernel releases it when the holding process dies. A crashed run cannot leave a lock that blocks future work, which a plain lockfile can. Where the platform cannot provide one, the fallback is a lockfile carrying holder pid and a heartbeat mtime, with a stale threshold of three heartbeat intervals after which a waiter may break and reclaim it; breaking is logged. The lock covers the finalisation critical section only, meaning the index append and the `latest` rewrite, not the run itself, so concurrent read-only runs against one skill proceed in parallel and serialise only at the end.

The workspace root is created mode 0700, and SkillGantry ensures `*-workspace/` and `.skillgantry-workspace/` are both in the repo's `.gitignore`.

### 9.3 Secret handling in artefacts

*Satisfies R7.3, R7.4, R7.7.*

Streams that SkillGantry writes — `stdout.log` and `stderr.log` — pass through `RedactionTransform` before reaching disk. The transform keeps a tail buffer so a secret split across chunk boundaries is still caught, and substitutes `«redacted»`. The placeholder carries no key name: redaction matches on the literal value, and one value may be bound to several keys, so naming one of them would be arbitrary. Values shorter than eight characters are not scrubbed, because at that length a match is more likely to be coincidence than a leak.

Native artefacts written by the tool itself, `snapshot-pre/` contents, and the release evidence bundle are **not** redacted. Redacting a rollback snapshot would make byte-exact restore impossible, and rewriting a tool's own SARIF or JSON risks corrupting it. The scope of R7.4 is therefore streams, not every byte under the sidecar. Mitigations: the workspace root is mode 0700, both workspace patterns are gitignored, and `stage.json` records `redacted: false` for every unredacted artefact so the exposure is visible rather than implicit.

This is a deliberate narrowing of R7.4 from its first draft, chosen over routing tools through a private staging directory. It keeps every artefact in the sidecar, which was the original brief.

One case remains where unredacted artefacts could be re-read by a later tool: a repo-root skill whose workspace sat inside the scanned tree. §4.4 closes it structurally, not this policy. A tool is now pointed at a materialised candidate that contains no workspace, so a prior run's unredacted SARIF is not reachable from any tool's input.

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

issue_detectors(issue_fp, tool_id,          -- one row per tool that has ever detected it
                last_seen_run,              -- last run in which this tool reported it
                last_absent_run,            -- last conclusive run in which it did not
                PRIMARY KEY(issue_fp, tool_id))
```

`issue_detectors` is what makes closure deterministic under concurrent fan-out; §10.4 explains why a single "most recent detector" could not be.

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
    "authTokenHash": "sha256:1a2b3c4d",
    "analysisModes": { "skillspector": "static" }
  },
  "toolLock": { "skillspector": "2.5.1" }
}
```

### 10.3 Finding identity

*Satisfies R8.4, R8.6. Supersedes the message-shape scheme in revision 1.*

```
fingerprint = sha256(skillId ‖ normalisedRelPath ‖ ruleClass).slice(0, 12)
```

One issue means "this file has a problem of this class". Every occurrence, from every tool, is a detection row carrying its own line, native rule id, native severity and message. `occurrence_count` is the number of detections recorded across **every** tool run of the most recent run that reported the issue. Per tool run would be ambiguous under fan-out: two tools reporting one issue would leave the count at whichever tool finished last, so the number would depend on scheduling. Summing over the run makes it the answer to "how many times was this seen last time we looked", independent of how many tools looked.

Revision 1 added a `messageShape` component, which the review correctly showed cannot satisfy R8.6: two scanners describing one problem in different words produce different shapes and therefore two issues. Cross-tool merging and per-occurrence separation cannot both hold without a semantic key neither tool provides, so merging wins and occurrences move into the detections table.

Accepted consequence: three distinct credential findings in one file are one issue with three detections. The issue count reads as "files with a problem of class X", not "occurrences of X".

### 10.4 Reconciliation

*Satisfies R8.8, R8.12.*

Runs once, inside the same transaction that records the run. Two phases: each conclusive tool records what it did and did not see, then an issue closes only when **every** tool that has ever detected it agrees it is gone.

```
# phase 1 — per-tool evidence
for each toolRun in this run where outcome ∈ {passed, failed}:
    scope    ← manifest(toolRun.tool_id).detects
                 ∪ { rule classes this tool has previously produced for this skill }
    reported ← fingerprints this toolRun produced
    for fp in reported:
        upsert issue_detectors(fp, tool_id, last_seen_run = run.id)
    for fp in (issues for this skill with rule_class ∈ scope
               AND an issue_detectors row for this tool) \ reported:
        update issue_detectors(fp, tool_id, last_absent_run = run.id)

# phase 2 — closure
for each issue for this skill where state ∈ {open, acknowledged}:
    if every row in issue_detectors(issue.fp) has
           last_absent_run set AND (last_seen_run is null OR last_absent_run > last_seen_run):
        transition(issue, 'fixed', closed_run = run.id)
```

**Why not "the most recent detector".** Revision 2 closed an issue when the tool owning its most recent detection reported a conclusive absence. Fan-out tools run concurrently, so two detections from one run have no defined order, and completion or insertion order decided ownership. If the winning scanner passed without the finding while the other errored, the issue closed; had they finished the other way round it survived. Identical runs could disagree. Modelling absence per detecting tool removes ordering from the decision entirely: closure is a conjunction over a set, and a set has no order.

The conservative direction is deliberate. An issue that two scanners found closes only when both have since run conclusively without it. One scanner erroring or being deselected holds the issue open, which is the same fail-safe as before, now applied per tool rather than to one arbitrarily chosen tool.

**Scope is widened at runtime.** `manifest.detects` is a declaration, and a declaration that is too narrow used to mean an issue could never close — the tool would not consider its own past finding in scope. Scope is therefore `detects` unioned with every rule class this tool has actually produced for this skill, which subsumes revision 2's separate `unmapped:` clause and also covers a mapped class the manifest forgot to list. `detects` remains useful for presets and for the wizard; it is no longer load-bearing for correctness.

Tool runs with outcome `errored` or `skipped` contribute nothing to either phase, per §8.1.

### 10.5 Issue state machine

*Satisfies R8.7, R8.10.*

| From | Event | To | Notes |
|---|---|---|---|
| — | first detection | `open` | `first_seen_run` set |
| `open` | detected again | `open` | `last_seen_run`, `occurrence_count` updated |
| `open` | absent from **every** detecting tool, all conclusive | `fixed` | `closed_run` set |
| `open` | absent from one detecting tool, another still reports it or was inconclusive | `open` | that detector's `last_absent_run` advances |
| `open` | user acknowledges | `acknowledged` | |
| `open` | user marks wontfix | `wontfix` | |
| `acknowledged` | detected again | `acknowledged` | `last_seen_run` updated |
| `acknowledged` | absent from every detecting tool, all conclusive | `fixed` | |
| `wontfix` | detected again | `wontfix` | `last_seen_run` updated only |
| `wontfix` | absent | `wontfix` | never auto-closes |
| `fixed` | detected again | `open` | `reopened_run` set, `closed_run` cleared |
| any | detecting tool `errored`/`skipped` | unchanged | the fail-safe |
| any | detected by a tool that never has before | unchanged | a new `issue_detectors` row joins the closure conjunction |
| any | rule-map migration | merged | §10.6 |

### 10.6 Rule-map migration

Adding a mapping turns `unmapped:<tool>:<id>` into a `KnownRuleClass`, which changes fingerprints. Migration is explicit, versioned with the rule map, and runs inside one transaction: recompute affected fingerprints, merge issues that now collide, re-parent their detections and their `issue_detectors` rows, taking the later `last_seen_run` and the later `last_absent_run` per tool, take the strongest state by precedence `wontfix > acknowledged > open > fixed`, and write a migration note onto the surviving issue. It is never implicit.

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

1. `queue` worker takes the job and calls `pipeline.run()`. Read-only runs against one skill proceed in parallel; only finalisation is serialised, per §9.2
2. `workspace.claimRun()` → exclusive `mkdir` on a UUIDv7 directory
3. `workspace.ensureGitignore()`, **then** `discovery.candidateManifest()` and `skillDigest()`. That order is R2.12: the gitignore write is itself a repo change, so digesting first would record one its own side effect invalidates
4. `run.json` written with the tool lock, the skill digest, and provenance including each selected tool's `analysisMode`
5. Per stage: `executor.plan()` resolves the selection and declares the mutation scope
6. Mutating stage → `isolation.open(scope)`; sandbox record written before any tool starts; paths resolve inside the sandbox. Otherwise, if the manifest is not self-contained, `materialiseCandidate()` and `{skillDir}` resolves there
7. Per tool: `runner.spawn()` → streams tee to the ring buffer and to `stdout.log`/`stderr.log` through the redactor → declared artefacts loaded into memory → classification per §8.1 → `ToolResult`
8. `stage.json` written once; stage outcome reduced per §8.2; the chain halts unless `passed`
9. Mutating stage emits `mutation:pending`, blocks on `resolveMutation`, rechecks preimages, then applies
10. `workspace.finalizeRun()` → `index.ndjson` append and `latest` rewrite, both under the per-skill lock
11. `ledger.recordRun()` — one transaction covering runs, stages, tool_runs, issues, detections, detectors and reconciliation. `pipeline` owns this call and this transaction boundary

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

*Satisfies R9.1–R9.11, R10.1–R10.11.*

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

**`SnapshotSandbox`**: copies every declared scope path into `<run>/snapshot-pre/`, preserving modes and links per §4.4. Tools operate on the real tree. `changeSet()` compares live against the snapshot; `discard()` restores it. The candidate manifest's exclusions govern the copy, which is what prevents a repo-root skill from snapshotting its own workspace recursively.

### 12.2 Dirty override and pre-apply recovery

Three holes in revision 2's recovery model, all of them windows before `apply()` writes its journal.

**Dirty override (R10.3).** The guard exists because a worktree starts at HEAD, so uncommitted work would be invisible to the tool and absent from the resulting diff. Overriding it in revision 2 did neither of the two things that would make the override safe. It now does both: after `git worktree add --detach HEAD`, every declared scope path that is dirty is **seeded** into the worktree from the user's working tree, and its preimage, content hash and mode, is recorded in the sandbox record. The tool therefore sees the user's actual bytes, and the change set is computed against them rather than against HEAD.

**Preimage recheck (R10.11).** Immediately before `apply()` writes anything, every target path's current content hash is compared against the preimage captured when the change set was built. A mismatch aborts with `preimage-drift`, naming the paths. Without this, a user editing a file while the diff sat awaiting approval would have that edit silently overwritten — a window that widens with `mutation:pending`'s configurable timeout.

**Active-sandbox record (R10.10).** A `SnapshotSandbox` lets the tool write the real tree, so a crash during optimiser execution or while awaiting approval leaves the skill partially modified with no journal, because the journal is only written at apply. Before any mutating tool starts, the sandbox writes `<run>/sandbox.json`:

```jsonc
{
  "runId": "…", "stage": "optimise", "strategy": "snapshot",
  "state": "active",                       // active | applied | discarded
  "scope": ["declawed/SKILL.md", "…"],
  "snapshotDir": "…/snapshot-pre",
  "preimages": [{ "path": "…", "sha256": "…", "mode": 33188 }],
  "openedAt": "…"
}
```

On launch SkillGantry scans registered workspaces for records still in `state: active`, reports each as an interrupted mutation, and offers restore from `snapshotDir`. The git strategy writes the same record; its recovery is cheaper, since the working tree was never touched and recovery is a worktree prune.

### 12.3 Journalled apply

POSIX offers no multi-file atomic write, so the design does not claim atomicity. `apply()` writes a journal first, then proceeds:

```
journal.json  ← { runId, stage, entries: [{path, priorSha, priorMode, priorBytesRef}] }
for each entry: write temp file in the same directory, fsync, rename over target
fsync the containing directories
mark the journal complete
```

A crash leaves a journal marked incomplete. On next launch SkillGantry detects it and offers compensating rollback from the recorded prior bytes. This is a documented compensating-transaction model, not an atomicity guarantee.

### 12.4 Release state machine

Revision 2 ordered this `apply → package → verify-install`, which released first and checked afterwards. A packaging or installability failure then had to undo a change already live in the user's repo, and the archive, a required output under R9.4, was in neither the mutation scope nor the journal, so an aborted release could leave a zip behind while claiming to have rolled back.

The order is inverted. Everything is built and proven inside the sandbox; the user's tree is touched once, at the end, when there is nothing left that can fail on its own merits.

```
validate-preconditions → resolve-target-version → stage-candidate-edits
  → package-in-sandbox → verify-install → build-change-set → preview-diff
  → await-confirmation → recheck-preimages → apply → record-evidence → done

any state before apply → abort  (discard the sandbox; nothing to compensate)
apply or later         → abort  (compensating rollback via the journal)
```

**Preconditions.** The skill is not deprecated, per the authority rule in §13. The most recent validate, evaluate and security stage outcomes are all `passed`. Each of those runs' `skill_digest` equals the candidate's current digest — the R9.9 binding that stops evidence from an older state authorising a newer release. When `versions.json` exists, its entry and the frontmatter version already agree.

**Target version.** Supplied explicitly as a semver, or as a bump level (`major` / `minor` / `patch`) applied to the current frontmatter version. Never inferred silently.

**Stage-candidate-edits.** Inside the sandbox: `SKILL.md` frontmatter version, `CHANGELOG.md` section prepended, and `versions.json` when it exists. Manifest handling is unchanged — when no repo-root `versions.json` exists, the case for all 54 skills in `~/.claude/skills`, release updates only `SKILL.md` and records `"manifest": "none"`. SkillGantry never creates one.

**Package-in-sandbox.** The archive is built from `candidateManifest()` over the **sandbox** skill directory, so its contents are exactly the digested set: no workspace, no `.git/`, no earlier release archive, and, the case revision 2 could not answer, not the archive being written, since it is produced outside the candidate root and only moved into place at apply. It is written to `<run>/staging/<skillName>_<version>.zip` and its SHA-256 recorded.

**Verify-install.** The staged archive is extracted into a second temporary directory, and vercel `skills` is invoked **against that extracted local directory** in copy mode, non-interactively, with an isolated destination. Revision 2 said "install the archive via vercel `skills`", which is not executable as written: the tool documents git sources and local directories, not zip archives. Extract-then-install-directory works either way, and it verifies the same bytes the consumer will receive. Failure aborts, and since nothing has been applied, abort is a sandbox discard.

**Change set and apply.** The change set covers the scoped files **and the archive**, whose target is `<repoRoot>/<skillName>_<version>.zip`, so the archive is previewed in the diff, journalled with the others, and removed by a compensating rollback. Apply moves the staged archive into place as one journal entry.

**Evidence.** `<run>/evidence/` holds the validate result, eval report, merged security findings, the tool lockfile, the skill digest, the manifest mode, the candidate manifest and the archive SHA-256.

Git commit and tag are offered as a separate confirmed action after `done`. `apply()` never commits.

## 13. Retirement

*Satisfies R1.4, R1.6.*

Retirement writes `metadata.deprecated: true` into `SKILL.md` frontmatter through the ordinary mutation path of declared scope, diff preview, confirmation and journal, and mirrors `lifecycle_state`, `deprecated_at` and an optional `superseded_by` into the `skills` row. Gates still run against a deprecated skill; it simply cannot be released. Reversal clears the same fields by the same route.

**`SKILL.md` frontmatter is authoritative. The ledger columns are a derived cache.** Two writes across a file mutation and a separate SQLite transaction cannot be made atomic, so revision 2's arrangement left it undefined which copy release should believe after a crash between them. Naming an authority makes the question unanswerable rather than merely answered:

- Discovery reads `metadata.deprecated` from frontmatter and reconciles the `skills` row to it on every scan, so a stale ledger self-heals on the next discovery rather than needing recovery.
- Release preconditions read the **frontmatter of the release candidate**, never the ledger, so a lagging cache can neither block a legitimate release nor permit a forbidden one.
- Reversal is one file write; the ledger follows on discovery.
- A mismatch is not an error state. It is reported in `doctor` as `lifecycle-drift` and resolved by reconciling to the file.

The cache still earns its place: the Issues and Dashboard screens filter deprecated skills across every registered repo without reading 76 files.

## 14. Terminal interface

*Satisfies R11.1–R11.6.*

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

*Satisfies R12.1–R12.4, R12.5a, R12.5b.*

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
| SkillSpector manifest | Clean-environment smoke test invoking the exact manifest argv, no provider key set | The declared `credentials`/`analysisMode` pair is the one the tool actually accepts |
| Tool classification | One case per row of the §8.1 table, each asserting the reconciliation effect | A non-zero exit with a clean report passes; nothing else closes an issue |
| Install drivers | `uv-tool` install into a scoped `UV_TOOL_DIR` at the pinned version; `gh-release` integrity mismatch, and `kind: 'none'` recorded | The uv invocation runs on the pinned runtime; a bad checksum fails the install |
| `ledger` | In-memory SQLite; fingerprint stability under whitespace and line-shift edits; every row of the §10.5 transition table; unmapped-class closure; rule-map migration merge including `issue_detectors` | The subtlest rules in the design |
| Reconciliation fail-safe | A run whose security tool `errored`, and one where it is `skipped` | Neither closes any issue |
| Detector ownership | Two prior detectors, then pass-absent + error, pass-absent + skip, and both absent | Closure only on the third; independent of completion order — §10.4 |
| Cross-tool merge | Paired real SARIF fixtures from **both** scanners on one fixture skill | One issue, two detections — the R8.6 contract |
| `stages` | Full Cartesian outcome matrix over the four tool outcomes | §8.2 reduction is total; `verdict` survives `degraded` |
| `pipeline` | Fake executors; fail-fast; mutation gating; cancellation in all four phases of §11.4 | Sequencing with no subprocess |
| `runner` | Fixture process that **spawns a grandchild**, then times out | No surviving descendant after the timeout fires — R5.9 |
| Redaction | Fixture tool echoing a secret to stdout, to stderr, and split across chunk boundaries | Streams redacted; `stage.json` records `redacted: false` for the native artefact |
| Fan-out collision | Two fixture tools both writing `findings.sarif` | Separate tool directories; both survive |
| `isolation` | Git and non-git fixtures; add, delete, rename, mode change, binary file; crash between journal and rename; crash **during the mutating tool**; crash while awaiting approval; dirty override; a concurrent user edit between preview and apply | Change sets complete; compensating rollback works; `sandbox.json` drives startup restore; `preimage-drift` aborts |
| Release | Git and non-git transactions changing `SKILL.md`, root `versions.json`, changelog and archive; apply, discard, crash recovery; digest mismatch rejection; missing-manifest path; **packaging failure and installability failure** | The one stage that writes to the user's repo; a failed gate leaves no repo-root archive and no live file change |
| Concurrency | Two runs finalising one skill simultaneously, including inverse start/finish order; a truncated final index line; a lock whose holder died | No lost index line, `latest` by greatest run id, no run-id collision, no permanently held lock |
| `discovery` | Fixture trees with the `*-workspace/` snapshot trap, a repo-root skill, and a symlinked repo path | R2.3, R2.4, §4.1 canonicalisation |
| Candidate manifest | A skill directory legitimately named `snapshot-pre/`; an internal symlink; a symlink escaping the candidate root; a prior release archive at the candidate root | Only exact owned paths excluded; links hashed not followed; escape rejected — §4.4 |
| Repo-root skill | Discovery → read-only stage → snapshot → rollback → gitignore check, with a **canary secret planted in a prior native artefact** | Neither a fixture scanner nor the archive can observe the canary; no recursive copy — §4.4 |
| Packaging | `npm pack`, install into a clean prefix, invoke `--version` | R13.5 |
| `tui` | `ink-testing-library` on the Work screen | Smoke level only |

Fixture capture is a scripted, repeatable step tied to the pinned tool versions, so fixtures and pins cannot drift apart.

## 17. Traceability

**Milestone ownership lives in exactly one place: the table in [requirements.md](requirements.md#milestone-ownership).** Revision 2 kept a second copy here, and the two drifted — R5.12 was M2 there and M5 here, while the headless mutation and subcommand requirements were M5 there and M1 here. A duplicated table is not traceability, it is two claims. This section maps requirements to design sections only; the milestone column is deliberately gone.

| Requirement group | Design section |
|---|---|
| R1.1–R1.3, R1.5 | 1, 7 (`MetricKey`) |
| R1.4, R1.6 retirement | 13 |
| R2 discovery, config, candidate, digest | 4 |
| R3 tool management | 5 |
| R4 adapters and classification | 6, 7, 7.1, 8.1 |
| R5.1, R5.9, R5.11 | 8.2, 11.3 |
| R5.2, R5.12–R5.14, R12.4 | 11.1, 11.4, 11.5 |
| R5.3–R5.8, R5.10 queue | 11.1, 11.4 |
| R6 artefacts | 9, 9.1, 9.2 |
| R7 credentials and redaction | 9.3, 10.2 |
| R8 ledger and issues | 10 |
| R9 release | 12.4 |
| R10 mutation safety | 12.1, 12.2, 12.3 |
| R11 terminal interface | 14 |
| R12 headless | 15 |
| R13 quality and distribution | 2, 16 |

The mapping is checkable rather than asserted: every `*Satisfies …*` label in this document is parsed by a spec test, unioned, and compared against the requirement ids in requirements.md. A requirement claimed by no section, or a section claiming a requirement that does not exist, fails the build. That is what caught §12 claiming R9.1–R9.10 while implementing R9.11, and §14 and §15 omitting R11.6 and the release subcommand.

| Milestone | Modules built |
|---|---|
| M1 | `config`, `discovery` (incl. candidate manifest), `tools` (`uv-tool` driver, lock writer, verify), `adapters` (skillspector only), `runner`, `stages`, `pipeline`, `workspace`, `ledger`, headless CLI |
| M2 | `queue`, `src/tui/` Work screen with the queue panel |
| M3 | `tools` completed: catalogue, `npm-prefix`, `gh-release`, presets, setup wizard, doctor |
| M4 | The three remaining selectable adapters and their parsers, the shared `v1alpha1` parser, the rule-class map and its versioned migration, fan-out policy, cross-tool merge |
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
| Drift | SkillSpector pin corrected to 2.5.1, the installed version |

## 18.1 What changed in revision 3

Closing [design-review-r2.md](design-review-r2.md). Seven P1 and four P2 findings, all accepted.

| Review finding | Resolution |
|---|---|
| 1 Archive outside the release transaction | Order inverted to package → verify → apply; archive built in `<run>/staging/`, included in the change set and journal; installability verified by extracting and installing a local directory; archive SHA-256 in the evidence bundle (§12.4) |
| 2 Repo-root skill can scan its own workspace | Candidate manifest as the single exclusion authority; materialised for non-self-contained candidates so no tool is ever pointed at a tree containing the workspace; canary test (§4.4, §9.3, §16) |
| 3 Digest omissions and no symlink policy | Digest derived from the manifest; exact owned-path exclusions replace basename matching; symlinks hashed never followed, escapes rejected; gitignore fix ordered before capture (§4.4, §4.5) |
| 4 Mutation recovery gaps | Dirty override seeds the worktree and records preimages; `sandbox.json` written before any mutating tool starts, driving startup recovery; preimage recheck immediately before apply (§12.2) |
| 5 M1 cannot bootstrap its tool | `uv-tool` driver, lock writer and verify move into M1; uv relocation via `UV_TOOL_DIR`/`UV_TOOL_BIN_DIR`; `gh-release` gains a declared `Integrity` (§5.1, §5.2, §17) |
| 6 SkillSpector credential mode wrong | `--no-llm` in the manifest, `credentials: { kind: 'none' }`, static-mode `detects`; boolean replaced by `CredentialRequirement` expressing alternative provider key sets; `analysisMode` in provenance (§7) |
| 7 Tool-result failure policy removed | Thirteen-row classification table restored, parse-authoritative, with the reconciliation effect per row (§8.1) |
| 8 Nondeterministic detector ownership | `issue_detectors` table; closure is a conjunction over every detecting tool, so completion order cannot decide it; scope widened to classes the tool has actually produced (§10.1, §10.4) |
| 9 NDJSON and lock durability overstated | One write per record plus fsync, reader-side truncated-tail recovery; `latest` defined as greatest run id; advisory OS lock that dies with its holder, with a documented stale-lease fallback (§9.1, §9.2) |
| 10 Retirement has no authority | `SKILL.md` frontmatter authoritative, ledger a cache reconciled on discovery; release reads the candidate's frontmatter; mismatch is `doctor` drift, not an error (§13) |
| 11 Traceability conflicts | Milestone ownership lives only in requirements.md; §17 maps to sections and is checked by a spec test; `verdict` is a stage field, not a metric; satisfaction labels corrected (§8.2, §17) |

## 18.2 What changed in M3 planning

Two problems this document could not have caught before a plan tried to build against it. Both are recorded in [plan-m3.md](plan-m3.md).

| Problem | Resolution |
|---|---|
| R3.5 required eight adapters in M3, but R4.1 defines an adapter as manifest plus `parse`, §17 gives the remaining seven parsers to M4, and R3.5a's tool has no adapter at all | R3.5 split into R3.5 (catalogue entry, installable and verifiable) and R3.5b (manifest and `parse`, M4); the catalogue becomes the install authority and the adapter registry the run authority (§5.1a) |
| A single fixed `assetPattern` cannot resolve a per-platform release asset on two machines | `{os}` and `{arch}` tokens, substituted from the host before matching (§5.2) |

Also made explicit rather than implied: the two doctor conditions that report without failing, and where doctor's skill and ledger inputs come from (§5.3).

## 19. Risks carried into implementation

| Risk | Mitigation |
|---|---|
| Adapter contract shaped by Python tooling; five of the eight tool adapters are Python, and M1 validates against one | Pull skill-lint (TypeScript, different output shape) forward if M4 planning shows contract strain |
| Merge-first identity understates occurrence counts | `occurrence_count` and per-detection rows preserve the detail; revisit if the Issues screen proves it insufficient |
| Unredacted native artefacts under the sidecar | 0700, gitignored, `redacted: false` recorded; no tool's input can reach them (§4.4); revisit if a scanner is found to echo credentials into its own report |
| Materialising a candidate costs a copy per run for repo-root skills | Only non-self-contained candidates are copied, which is the repo-root case alone; the 22-skill reference repo copies nothing |
| Static-mode SkillSpector detects less than LLM mode | Declared honestly in `detects` and `analysisMode`, recorded in provenance; an LLM-mode adapter is a separate id, never a silent fallback |
| Conservative closure holds issues open when one scanner is unavailable | Intended: the fail-safe direction. `issue_detectors` makes the reason visible per tool, so the Issues screen can show which detector is blocking closure |
| Rule-class map goes stale | Unmapped findings degrade to tool-scoped classes; migration is explicit and versioned |
| SARIF dialect differences between the two scanners | Shared parser fixture-tested against both tools' real output before fan-out merging is enabled in M4 |
| Ink responsiveness under sustained output | Ring buffer outside React plus fixed-interval flush; R11.4 is a measurable acceptance test |
| Upstream tools are young and will change output | Golden fixtures tied to pins with a scripted refresh; parse failure degrades to `errored` with the artefact retained, never to a wrong result |
