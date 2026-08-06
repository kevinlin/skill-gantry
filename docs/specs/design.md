# SkillGantry — Design

**Date:** 2026-08-01
**Status:** revision 3, incorporating [design-review-r2.md](design-review-r2.md)
**Layer:** design (layer 2 of 3: [requirements](requirements.md) → design → plan)
**Traces to:** [requirements.md](requirements.md), [decision-log.md](decision-log.md)

Each section names the requirements it satisfies. Revision 2 closed the twelve findings of the first review; revision 3 closes the eleven of the second. §18 records what changed in each. §18.2 records the three sections M3 planning amended, and §18.3 the six M5's implementation did.

---

## 1. Shape of the system

*Satisfies R1.1–R1.3.*

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

Local installation is `pnpm run install:cli`, which packs the working tree, installs it into `~/.skillgantry/cli` and links `~/.local/bin/skillgantry`, verifying by invocation before reporting success. The prefix is wiped on every run, so the command on PATH always reflects current source. It is a shell script rather than a subcommand because a subcommand cannot perform the first install. `SG_HOME` and `SG_BIN_DIR` override both paths, which is how the acceptance test installs without touching a real home. This is the one place SkillGantry writes outside a directory it owns; R3.1 binds managed tools, not SkillGantry's own binary.

## 3. Module map

*Satisfies R13.1, R13.2.*

Twelve modules under `src/core/`. Rule applied throughout: a module that owns I/O does not also own decisions.

Release is a module, not an adapter: it has no external tool to wrap, so it has no manifest and no `parse`. It does depend on `tools`, because vercel `skills` must be installed for the installability check. Five external tools are installed in total: four adapter-backed, plus vercel `skills`. Revision 2 planned eight adapter-backed tools, one per D7 candidate; M3 dropped four of them after probing — agentskills, SkillOpt and SkillHone are published nowhere installable, and promptfoo drives off a per-skill config no skill carries (decision-log §10).

"Depends on" is a *value* import between modules. A type-only import is not a dependency here — several modules take another's shape without being able to call into it, which is how `runner` runs a tool it never looks up and `workspace` writes a `StageResult` it never builds.

| Module | Job | Depends on | Owns I/O |
|---|---|---|---|
| `config` | Load/save `~/.skillgantry/config.json`; read and mode-check `.env`; build the redaction value set | `discovery` | fs |
| `discovery` | Repo path → `SkillRef[]`; frontmatter parse; git detection; `workspacePath()`; `candidateManifest()`; `skillDigest()`; `materialiseCandidate()` | — | fs |
| `tools` | Tool root, three install drivers, lockfile with resolved executables, verify-by-invocation, doctor | `config`, `discovery` | fs, net, subprocess |
| `adapters` | Four manifest + parse modules; shared SARIF and skill-up parsers; rule-class map | — | **none** |
| `runner` | Spawn one tool: env injection, timeout with process-tree kill, stream redaction, artefact loading, exit classification | — | subprocess, fs |
| `stages` | `StageExecutor` contract; `AdapterStageExecutor`; `ReleaseStageExecutor`; outcome reduction | `adapters`, `discovery`, `ledger`, `queue`, `release`, `runner`, `tools` | — |
| `pipeline` | Stage sequencing, mutation gating, event emission, run finalisation transaction | `adapters`, `config`, `discovery`, `isolation`, `ledger`, `stages`, `workspace` | — |
| `queue` | Bounded worker pool, batch enqueue, cancellation, mutating-stage serialisation | `pipeline` | — |
| `workspace` | Sidecar writer: run dir claim, `run.json`, `stage.json`, per-tool dirs, `latest`, `index.ndjson`, gitignore fix, per-skill finalisation lock | — | fs |
| `isolation` | `MutationSandbox` over a declared path scope; git worktree and snapshot implementations; journalled apply; crash recovery | `discovery`, `tools` | fs, subprocess |
| `ledger` | SQLite schema and migrations, fingerprinting, reconciliation, issue state machine, stats queries | `adapters` | sqlite |
| `release` | Release state machine, version resolution, changelog, archive, evidence bundle, installability check | `discovery`, `isolation`, `ledger`, `tools` | fs, subprocess |

`adapters` depends on nothing else in the engine, and `ledger` on nothing but the rule-class map `reconcile` cannot classify without. That is deliberate: they hold the two subtlest rules in the system and can be tested exhaustively with no mocking, which is what makes M1 a genuine validation of the design.

`stages` reaching `queue` is one import and one direction only: `MUTATING_STAGES`, the set the queue serialises on. It lives there so the queue can serialise a mutating stage without importing a stage executor, and `AdapterStageExecutor` reads the same set rather than declaring a second one that could disagree.

## 4. Discovery, config and identity

*Satisfies R2.1–R2.12.*

### 4.1 Config schema

*Satisfies R7.1, R7.2.*

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

Credentials live outside this file. They are read from a single `~/.skillgantry/.env`, in whatever format the user supplied, and never written back. A mode more permissive than 600 is reported as a warning rather than an error: the file is the user's, so SkillGantry says what is wrong with it and does not change it.

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

Setup is a four-state machine: `probe-runtimes → select-tools → install-and-verify → credentials-and-repo`, plus a terminal `done` the wizard displays. Each state is re-enterable, so `doctor` reuses `probe-runtimes` and `install-and-verify` without the rest.

`credentials-and-repo` is the only state taking free text, so it is the only one where a single letter is not a command. It resolves the typed path through `inspectRepo`, a read-only counterpart to `registerRepo` returning the canonical path, whether it is a directory, whether it is already registered, and how many skills it holds. That verdict is shown before the user commits. An empty directory is a warning and still registrable: registering a repo before authoring its first skill is legitimate. A path that is not a directory is refused, by `registerRepo` as well as by the wizard, because discovery over a missing path otherwise throws from inside `readdir` without naming what the user typed.

`done` is reachable with a registered repo **or** with the repo step explicitly skipped. A verified toolchain is the deliverable; requiring a repo left a user who set up before their skills repo existed with no exit but Ctrl+C.

Presets: **Minimal** is skill-up plus skillspector — the two already present, one evaluate and one security tool. **Recommended** is at most one tool per stage. **Everything** is the whole catalogue. A stage whose D7 candidates are all unavailable has no tool in any preset; that is visible in the wizard rather than papered over. Optimise is that stage: both its candidates are unpublished. Evaluate has one candidate rather than two, because promptfoo needs a per-skill config file no skill carries — decision-log §10.

Every preset includes vercel `skills`, because the release stage cannot run its installability gate without it.

Doctor reports four drift kinds per tool: `missing` (in lock, absent on disk), `unverifiable` (present, will not run), `version-drift` (runs, reports a version other than `resolvedVersion`), and `unlocked` (installed under the tool root but absent from the lock). Three further conditions are reported and do not fail the report: `integrity-unverified`, a lock entry recording `integrity: "none"` per §5.2; `lifecycle-drift` per §13; and `rule-map-pending`, a ledger whose applied rule-map version trails the shipped one per §10.6. None means a tool cannot run. `rule-map-pending` is resolved by `skillgantry doctor --migrate-rule-map`, which is the explicit trigger R8.14 requires — the migration never runs as a side effect of opening the ledger.

Doctor reads the skills it checks and the ledger's lifecycle column as data supplied by its caller, so `tools` needs neither discovery's I/O nor a sqlite dependency.

## 6. Stage execution contract

*Satisfies R4.6–R4.8, R4.10, R4.11, R5.1, R9 dispatch.*

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

*Satisfies R1.5, R4.1–R4.5, R4.12, R4.14, R4.15.*

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
  invoke: {
    argv: string[]
    cwd: 'skillDir' | 'repoRoot'
    /** R4.14. Appended after `argv`, in declaration order. */
    conditionalArgv?: ConditionalArgv[]
  }
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

/**
 * R4.14. An argument group the stage executor appends only when a path exists.
 * Declared, never probed: R4.3 forbids an adapter touching the filesystem.
 */
interface ConditionalArgv {
  /** Same `{skillDir}`/`{repoRoot}`/`{toolDir}` vocabulary as `argv`. */
  whenExists: string
  argv: string[]
}

interface RawFinding {
  ruleClass: RuleClass
  nativeRuleId: string
  severity: Severity
  path: string                     // repo-relative, normalised separators
  line?: number                    // display only, never in the fingerprint
  message: string
  /**
   * R4.15. SARIF 2.1.0 `result.suppressions`. The tool still reported the
   * finding and still believes it; the user's own suppression file says do not
   * act on it. Absent means unsuppressed.
   */
  suppressed?: { justification: string }
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
  invoke: {
    argv: ['scan', '{skillDir}', '--no-llm', '--format', 'sarif',
           '--output', '{toolDir}/findings.sarif'],
    cwd: 'repoRoot',
    conditionalArgv: [
      { whenExists: '{skillDir}/.skillspector-baseline.yaml',
        argv: ['--baseline', '{skillDir}/.skillspector-baseline.yaml'] },
    ],
  },
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

**Conditional argument groups, and why the stat is in `execute()`.** SkillSpector 2.5.1 reads a suppression baseline only when `--baseline <path>` is passed; `.skillspector-baseline.yaml` is merely where `skillspector baseline` writes one, and nothing auto-discovers it. A manifest declares the condition and the stage executor answers it, because R4.3 forbids an adapter touching the filesystem — and because the adapter could not answer it correctly even if it were allowed to. The test runs in `execute()`, against the **substituted** path, never in `plan()`: `plan()` runs before the sandbox re-roots `ctx.skill.dir`, and a repo-root skill's tool is handed a materialised candidate copy rather than the skill directory, so a stat against the manifest's own vocabulary would answer for a directory the tool never sees.

Three rules, each covering a real failure. The test is `isFile()` rather than existence, because `--baseline <dir>` makes skillspector exit 2 with no SARIF written. A non-`ENOENT` stat failure reads as absent, because a baseline the engine cannot stat is one the tool cannot read, and the loud direction — every suppressed finding resurfacing — is the safe one. And the path must carry the substitution vocabulary rather than be a literal relative path: `cwd` is `repoRoot` for this adapter, so a relative path would resolve against the wrong directory.

The group is appended after `argv`, so a manifest ending in a positional argument cannot use one — the group would land past the positional and read as more positionals. Every shipped manifest ends in an option value.

**A suppressed finding crosses the parse boundary annotated, not dropped** (R4.15). `--baseline` does not remove the result; it annotates it with SARIF 2.1.0's `result.suppressions`, so SkillGantry receives both the finding and the user's own justification text. It is one optional field on `RawFinding` rather than a second array on `ToolResult` for two reasons. R8.4's fingerprint is `(skillId, relPath, ruleClass)`, so two findings of one class in one file — one baselined, one not — collapse to one issue, and a split array destroys the pairing §10.4 needs to decide whether that issue is suppressed at all. And the failure shapes are asymmetric: a consumer that forgets a second array never files those findings, so §10.4 sees their fingerprints absent and closes the issues as `fixed`; a consumer that forgets the optional field files the finding exactly as it does today. The feature degrades to "no suppression", never to "issue closed and history lost".

`outcome`, `findings.length` and `metrics.findingsTotal` are unchanged by suppression — the parser's verdict stays "did I see anything", and a count that drops when a user edits a YAML file makes "did this skill improve" unanswerable. `summary` gains the count (`2 findings, 1 suppressed`), which reaches the lifecycle rail and `stage.json` and is the feature's always-on signal that the flag fired.

Two consequences fall out of the baseline file being an ordinary file inside the skill directory. It is part of the candidate manifest (§4.4), so writing or editing it moves the skill digest — which is what makes R9.9 refuse a release whose passing gates were recorded against different bytes (§12.4). And it is therefore inside the release archive, which is correct: a consumer receives the maintainer's accepted-false-positive list along with the skill.

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
| 3b | Mutation apply aborted after authorisation with nothing written (preimage drift, journal failure, sandbox open failure) | `errored` | `mutation-aborted` | no |
| 3c | The apply completed and a later step of the same stage threw | `errored` | `mutation-incomplete` | no |
| 4 | Cancelled (§11.4) | `errored` | `cancelled` | no |
| 5 | Timeout fired, process tree killed | `errored` | `timeout` | no |
| 6 | A declared artefact exceeds the size cap | `errored` | `artefact-too-large` | no |
| 7 | A declared artefact is absent after exit | `errored` | `missing-artefact` | no |
| 8 | `parse` throws, or rejects the artefact as malformed | `errored` | `parse` | no |
| 9 | `parse` returns `errored` | `errored` | `parse` | no |
| 10 | `parse` succeeds, no findings, exit code 0 | `passed` | — | yes |
| 11 | `parse` succeeds, no findings, exit code non-zero | `passed` | — | yes |
| 12 | `parse` succeeds, an unsuppressed finding at or above the fail floor | `failed` | — | yes |
| 12b | `parse` succeeds, unsuppressed findings present, every one below the fail floor | `passed` | — | yes |
| 12c | `parse` succeeds, findings present, none of them unsuppressed | `passed` | — | yes |
| 13 | Spawn itself failed (ENOENT, EACCES) | `errored` | `spawn` | no |

Rows 7 and 8 are ordered so a missing report is classified before the parser is ever handed an empty map; revision 2 left this to whichever error the parser happened to throw. Row 11 is the rule that matters most in practice: a scanner exiting 1 with a clean report has passed, and the parse says so.

Rows 3b and 3c are the two a *stage* rather than a tool produces. R10.11 aborts an apply when a target has drifted since the change set was built, and that is neither a tool failure nor a verdict about the skill: the tools ran and were understood, and then the write was refused. Without the row, `applyMutation` throwing propagated out of the pipeline and the run rejected, discarding the partial evidence R5.13 requires a cancelled or aborted run to keep.

Row 3c exists because the two cases need opposite recovery and one kind could not carry both. The sandbox record is the authority for telling them apart — both strategies mark it `applied` only once the journal is complete — so the split is read off disk rather than inferred from how far the code got. Settling a completed apply as an abort flipped a git sandbox's marker to `discarded` over a written tree, putting it beyond recovery's reach, and on the snapshot strategy restored the pre-tool state over an apply the user had approved. Neither row keeps its stage's tool runs out of the record: an aborted stage carries whatever the tools produced before the abort, and appends its own synthesised run, because R5.13's partial evidence is the point.

Only rows 10 to 12c feed issue reconciliation: the tool actually ran and its output was understood. Every other row leaves the ledger's issue states untouched, which is the fail-safe that stops a crashed or absent scanner from closing everything it once found.

**The fail floor is `medium`.** Revision 3's row 12 read "findings present" with no severity dimension, so an advisory failed a gate as hard as a critical. Observed: skill-lint 0.2.0 over `zapac-agent-skills/declawed` exited 0, called the skill `SAFE`, and reported two `LOW` `R06` findings — "bundled script, review contents carefully" against a `.sh` and a `.py` that are the skill's own content. Validate failed and R5.1 halted the lifecycle on a tool that had found nothing wrong.

`medium` rather than `high`, because §7.1 normalises SARIF `warning → medium` and `medium` is also the fallback for a result carrying no level, while a failing eval case is `medium` under §7.2. A `high` floor would pass most scanner findings and every failing eval case, which is the opposite defect.

Row 12b keeps the findings. They are returned verbatim, so §10.4 files them as issues and reconciles them exactly as row 12's do — a sub-floor finding is tracked and closes when it goes away, it merely stops halting the chain. Dropping the findings instead would make every issue the tool had ever filed look absent, and close all of them.

The floor is a uniform rule over normalised severity, not a reproduction of each tool's own verdict. skill-lint bands a weighted score (`CRITICAL 10 / HIGH 5 / MEDIUM 2 / LOW 1`), so two `LOW`s and one `MEDIUM` both score 2 and one of those crosses the floor while the other does not. Matching every tool's scoring formula would put a per-tool policy in the engine and re-tune it on each upstream release.

The floor is a constant, deliberately not configurable. A per-skill or per-repo threshold would make two runs of one tool incomparable in the ledger, which §10 exists to prevent.

**Rows 12 and 12b read the unsuppressed findings only, and row 12c is what a fully baselined report reaches** (R4.15). The severity comparison runs over `actionableFindings(parsed.findings)` — those carrying no `suppressed` annotation — through a named helper rather than by teaching `highestSeverity` to filter, because a function called "highest severity" that quietly means "highest actionable severity" is precisely the hidden policy this design writes comments against. Row 12b's guard also requires `findings.length > 0`: every shipped parser derives `failed` from `findings.length`, and without the clause a future parser returning `failed` with nothing to point at would be silently downgraded to `passed`.

All three rows keep every finding, suppressed ones included, and all three reconcile. That is the safety property §10.4 depends on: a suppressed finding recorded as *reported* holds its issue open, whereas one dropped here would look absent to every detector and close as `fixed`.

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

Suppression changes nothing here, stated so a reader does not go looking for it: §8.1 has already resolved it into a `ToolOutcome`, and this reduction sees outcomes only.

The chain halts unless the stage outcome is `passed`. The headless exit code is zero only when every executed stage is `passed`. Release refuses on anything other than `passed`.

## 9. Sidecar layout

*Satisfies R4.9, R6.1–R6.8, R7.4, R7.7.*

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
          fix-prompt.md                ← only when the stage produced a finding
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

*Satisfies R7.3, R7.4, R7.4a, R7.7.*

Streams that SkillGantry writes — `stdout.log` and `stderr.log` — pass through `RedactionTransform` before reaching disk. The transform keeps a tail buffer so a secret split across chunk boundaries is still caught, and substitutes `«redacted»`. The placeholder carries no key name: redaction matches on the literal value, and one value may be bound to several keys, so naming one of them would be arbitrary. Values shorter than eight characters are not scrubbed, because at that length a match is more likely to be coincidence than a leak.

Native artefacts written by the tool itself, `snapshot-pre/` contents, and the release evidence bundle are **not** redacted. Redacting a rollback snapshot would make byte-exact restore impossible, and rewriting a tool's own SARIF or JSON risks corrupting it. The scope of R7.4 is therefore streams, not every byte under the sidecar. Mitigations: the workspace root is mode 0700, both workspace patterns are gitignored, and `stage.json` records `redacted: false` for every unredacted artefact so the exposure is visible rather than implicit.

This is a deliberate narrowing of R7.4 from its first draft, chosen over routing tools through a private staging directory. It keeps every artefact in the sidecar, which was the original brief.

One case remains where unredacted artefacts could be re-read by a later tool: a repo-root skill whose workspace sat inside the scanned tree. §4.4 closes it structurally, not this policy. A tool is now pointed at a materialised candidate that contains no workspace, so a prior run's unredacted SARIF is not reachable from any tool's input.

### 9.4 Fix prompt

*Satisfies R6.10, R6.11.*

A stage that reported findings writes `fix-prompt.md` beside its `stage.json`: a prompt for a coding agent that names where the skill is, where each tool's own report is, and what every finding said. Per stage rather than per tool, because a fan-out security stage with two scanners is one job for the agent.

**The trigger is findings, not the outcome.** `buildFixPrompt` returns null unless some tool run carries a finding. §8.1's sub-floor row keeps a finding and passes the tool, and that finding is still filed as an issue — so a `passed` stage with two `low` findings gets a prompt, and an outcome-based trigger would silently drop exactly the case the ledger says is still open.

**The prompt points at the tool's report rather than restating it.** `RawFinding` is a closed six-field record and the shared SARIF parser does not type `properties` at all, so `remediation`, `explanation`, `confidence` and `code_snippet` are dropped on the way in. The raw report is on disk beside `stage.json`; naming its absolute path keeps that evidence reachable without widening the adapter contract, `RawFinding`, or the ledger. Artefact names come from the adapter manifest's declared `artefacts` rather than from a directory listing, so the prompt names what the tool was contracted to write.

The prompt instructs the agent to judge each finding into one of three — correct and worth fixing, correct but the suggested fix does not apply here, false positive — and to stop and report rather than edit code it judges correct. Both findings in the run that motivated this were of the second and third kinds: one named a `permissions` frontmatter field the Agent Skill schema does not have, so writing it would fail validate; the other flagged a run of alignment whitespace inside a `re.VERBOSE` regex. SkillGantry never applies the prompt. It also forbids any write under `*-workspace/` or `.skillgantry-workspace/`, which is the evidence the prompt itself points at.

**Suppressed findings are omitted, and their count is named** (R6.11). The table is built from `actionableFindings`, the survivors are numbered from 1, and one line says how many were left out and why. `buildFixPrompt` returns null when that set is empty, so a fully baselined stage writes no prompt at all. The one instruction a prompt must never give a coding agent is to fix the thing the user has already ruled on — and the omitted count is there so the agent is not left wondering why the tool report it is told to read first lists more findings than the table does. Sub-floor findings are not suppressed, so the paragraph above is untouched.

**It is built from `input.skill`, never `ctx.skill`.** The prompt names where an agent should edit, and `ctx.skill` points into the mutation sandbox or into the materialised candidate's temp directory — neither of which exists after the run. The builder is a pure function in `stages`, which is the only module that adds no §3 edge: it already depends on `adapters` for the manifest lookup, and it already owns no I/O. `workspace` gets a four-line `writeFixPrompt` and no judgement, per §3's own rule that a module owning I/O does not own decisions.

## 10. Ledger

*Satisfies R8.1–R8.12, R8.15.*

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
       first_seen_run, last_seen_run, closed_run, reopened_run,
       suppressed_run,             -- derived cache (R8.15); null = not suppressed
       suppressed_reason)

issue_detections(issue_fp, tool_run_id, ordinal,
                 native_rule_id, native_severity, line, message,
                 PRIMARY KEY(issue_fp, tool_run_id, ordinal))

issue_detectors(issue_fp, tool_id,          -- one row per tool that has ever detected it
                last_seen_run,              -- last run in which this tool reported it
                last_absent_run,            -- last conclusive run in which it did not
                suppressed_run,             -- that sighting was wholly suppressed (R8.15)
                suppressed_reason,          -- the tool's own justification text
                PRIMARY KEY(issue_fp, tool_id))
```

`issue_detectors` is what makes closure deterministic under concurrent fan-out; §10.4 explains why a single "most recent detector" could not be.

**The four suppression columns are a derived cache, and the skill's own suppression file is the authority** (R8.15) — R1.6's pattern, adopted here for R1.6's reason: the file edit and the ledger transaction cannot be made atomic, so one of them has to be named the truth. Every conclusive tool run recomputes them; migration 5 adds them with no backfill and no default, because every pre-existing row *was* unsuppressed and a backfill would be the ledger inventing a decision the user never made.

Two levels because the question has two, exactly the shape `issue_detectors` already has for closure: evidence per tool, decision as a conjunction over the set. A detector row is suppressed when `suppressed_run` is non-null *and equal to* `last_seen_run` — an equality rather than a presence test, so a pair left behind by an older sighting degrades to unsuppressed rather than outliving the sighting it describes. Nothing is stored on `issue_detections`: R8.2 makes the SARIF artefact the per-occurrence evidence, and an unread column is maintenance with no reader.

Suppression is a column, never a `state`, so R8.7's "exactly one state" survives. It and `wontfix` are orthogonal by construction: both hide, deleting a baseline entry unsuppresses but leaves the `wontfix`, and reopening a `wontfix` leaves the suppression.

The ledger stores no raw tool output; `tool_runs.artefact_dir` points at the sidecar, which holds the evidence.

`issue_detections` carries an `ordinal` so one tool reporting several occurrences that collapse to one issue produces several rows rather than violating the primary key.

### 10.2 Provenance

*Satisfies R7.5.*

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

*Satisfies R8.4, R8.6, R8.13. Supersedes the message-shape scheme in revision 1.*

```
fingerprint = sha256(skillId ‖ normalisedRelPath ‖ ruleClass).slice(0, 12)
```

One issue means "this file has a problem of this class". Every occurrence, from every tool, is a detection row carrying its own line, native rule id, native severity and message. `occurrence_count` is the number of detections recorded across **every** tool run of the most recent run that reported the issue. Per tool run would be ambiguous under fan-out: two tools reporting one issue would leave the count at whichever tool finished last, so the number would depend on scheduling. Summing over the run makes it the answer to "how many times was this seen last time we looked", independent of how many tools looked.

Revision 1 added a `messageShape` component, which the review correctly showed cannot satisfy R8.6: two scanners describing one problem in different words produce different shapes and therefore two issues. Cross-tool merging and per-occurrence separation cannot both hold without a semantic key neither tool provides, so merging wins and occurrences move into the detections table.

Accepted consequence: three distinct credential findings in one file are one issue with three detections. The issue count reads as "files with a problem of class X", not "occurrences of X".

`occurrence_count` counts suppressed occurrences too. The definition above is "how many times was this seen last time we looked", and the tool did see them — the user's suppression file is a decision about acting on a finding, not a claim that it was not reported. `severity_max` likewise still rises on a suppressed finding and stays monotone: severity is a property of the finding, suppression a property of the user's decision about it. This is also why one baselined occurrence cannot hide an issue: a fingerprint counts as suppressed for a tool run only when **every** occurrence of it in that run was suppressed.

### 10.4 Reconciliation

*Satisfies R8.8, R8.12, R8.15.*

Runs once, inside the same transaction that records the run. Two phases: each conclusive tool records what it did and did not see, then an issue closes only when **every** tool that has ever detected it agrees it is gone.

```
# phase 1 — per-tool evidence
for each toolRun in this run where outcome ∈ {passed, failed}:
    scope    ← manifest(toolRun.tool_id).detects
                 ∪ { rule classes this tool has previously produced for this skill }
    reported ← fingerprints this toolRun produced          # suppressed ones included
    suppressed ← { fp ∈ reported : every occurrence of fp in this toolRun was suppressed }
    for fp in reported:
        upsert issue_detectors(fp, tool_id, last_seen_run = run.id,
                               suppressed_run    = fp ∈ suppressed ? run.id : null,
                               suppressed_reason = fp ∈ suppressed ? justification : null)
    for fp in (issues for this skill with rule_class ∈ scope
               AND an issue_detectors row for this tool) \ reported:
        update issue_detectors(fp, tool_id, last_absent_run = run.id,
                               suppressed_run = null, suppressed_reason = null)

# phase 2 — closure
for each issue for this skill where state ∈ {open, acknowledged}:
    if every row in issue_detectors(issue.fp) has
           last_absent_run set AND (last_seen_run is null OR last_absent_run > last_seen_run):
        transition(issue, 'fixed', closed_run = run.id)

# phase 3 — recompute the issue-level suppression cache
for each fp phase 1 touched:                               # every issue, not only the candidates
    voters ← rows of issue_detectors(fp) that do not say gone
    issues(fp).suppressed ← voters ≠ ∅ AND every voter is suppressed
```

**Why not "the most recent detector".** Revision 2 closed an issue when the tool owning its most recent detection reported a conclusive absence. Fan-out tools run concurrently, so two detections from one run have no defined order, and completion or insertion order decided ownership. If the winning scanner passed without the finding while the other errored, the issue closed; had they finished the other way round it survived. Identical runs could disagree. Modelling absence per detecting tool removes ordering from the decision entirely: closure is a conjunction over a set, and a set has no order.

The conservative direction is deliberate. An issue that two scanners found closes only when both have since run conclusively without it. One scanner erroring or being deselected holds the issue open, which is the same fail-safe as before, now applied per tool rather than to one arbitrarily chosen tool.

**Scope is widened at runtime.** `manifest.detects` is a declaration, and a declaration that is too narrow used to mean an issue could never close — the tool would not consider its own past finding in scope. Scope is therefore `detects` unioned with every rule class this tool has actually produced for this skill, which subsumes revision 2's separate `unmapped:` clause and also covers a mapped class the manifest forgot to list. `detects` remains useful for presets and for the wizard; it is no longer load-bearing for correctness.

Tool runs with outcome `errored` or `skipped` contribute nothing to any phase, per §8.1. That is also why the suppression writes live here rather than in `record.ts`: `record.ts` iterates every tool run including the errored ones, and this loop has already `continue`d past them, so the existing fail-safe extends to suppression for free. An errored or skipped run leaves both columns exactly as the last conclusive run left them.

**Why a suppressed finding is *reported*, not absent.** It joins `reported`, which falls out of phase 1 with no change to its first loop and is the whole safety property. Were a suppressed sighting recorded as an absence instead, `last_absent_run` would advance, every detector would agree the issue was gone, and phase 2 would set `state = 'fixed'`. The history would survive literally — the detections and the first-seen run are still there — but the issue would read `fixed` while not being fixed, and an issue the user had *acknowledged* would be silently closed by `stateOnAbsence`. Phase 2 itself is unchanged and does not read the new columns: a suppressed sighting blocks closure by advancing `last_seen_run`, and by nothing else. Suppression never writes `state`.

**The clear is structural, not a second code path.** Both columns are bound in the same upsert that advances `last_seen_run` — to the run id when the sighting was wholly suppressed, to `null` when it was not — so there is no clear path a caller can forget to call. The absent branch nulls them too, so a detector row reads honestly on its own.

**The per-issue conjunction is the twin of the closure conjunction**, and it is what stops a tool-scoped baseline speaking for a tool that was never consulted: an issue reads as suppressed only when every detector *still reporting it* reports it suppressed, and a detector that says gone has no vote. skillspector's baseline therefore cannot hide a finding skill-scanner is still reporting plainly beside it. Phase 3 recomputes over **every** fingerprint phase 1 touched rather than only phase 2's `open`/`acknowledged` candidates, because restricting it would freeze a `wontfix` issue's flag forever, and `wontfix` rows appear on the Issues screen. It is exported as `recomputeIssueSuppression(db, fp)` because §10.6's migration must call it too — a second copy of the conjunction is how the two would come to disagree.

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
| `acknowledged` | user marks wontfix | `wontfix` | triage may harden after the fact |
| `fixed` | user marks wontfix | `wontfix` | suppresses a recurrence before it happens |
| `acknowledged` | user reopens | `open` | undoes an acknowledgement |
| `wontfix` | user reopens | `open` | the only way back out of a suppression |
| `fixed` | user reopens | `open` | re-triage without waiting for a redetection |
| `acknowledged` | detected again | `acknowledged` | `last_seen_run` updated |
| `acknowledged` | absent from every detecting tool, all conclusive | `fixed` | |
| `wontfix` | detected again | `wontfix` | `last_seen_run` updated only |
| `wontfix` | absent | `wontfix` | never auto-closes |
| `fixed` | detected again | `open` | `reopened_run` set, `closed_run` cleared |
| any | detecting tool `errored`/`skipped` | unchanged | the fail-safe |
| any | detected by a tool that never has before | unchanged | a new `issue_detectors` row joins the closure conjunction |
| any | detected again, every occurrence suppressed | unchanged | `last_seen_run` advances; the suppression columns are set, no `state` is written |
| any | detected again, unsuppressed after a suppressed sighting | unchanged | the suppression columns are cleared by the same upsert |
| any | rule-map migration | merged | §10.6 |

The last two rows are not states. Suppression is a pair of columns (§10.1), so it composes with each row above rather than replacing one. `wontfix` was considered and rejected as the mechanism: §10.5 makes it sticky and reversible only by explicit user action, so deleting a baseline entry would leave the issue suppressed forever, and the Issues screen could not tell a maintainer's standing decision from a scanner's current one.

### 10.6 Rule-map migration

*Satisfies R8.14.*

Adding a mapping turns `unmapped:<tool>:<id>` into a `KnownRuleClass`, which changes fingerprints. Migration is explicit, versioned with the rule map, and runs inside one transaction: recompute affected fingerprints, merge issues that now collide, re-parent their detections and their `issue_detectors` rows, taking the later `last_seen_run` and the later `last_absent_run` per tool, take the strongest state by precedence `wontfix > acknowledged > open > fixed`, and write a migration note onto the surviving issue. It is never implicit.

`fold()` names the detector columns explicitly in both its select and its insert, so the suppression pair has to be carried deliberately: left alone, a merge would drop the pair on insert and keep the target's stale pair on update. Both are taken from whichever row's `last_seen_run` won, which preserves §10.1's equality invariant — a pair whose `suppressed_run` no longer matches the merged `last_seen_run` degrades to unsuppressed rather than outliving its sighting. `recomputeIssueSuppression` then runs on the surviving fingerprint. No `RULE_CLASS_MAP_VERSION` bump: the rule map itself has not changed.

### 10.7 Statistics queries

*Satisfies R7.6, R8.9.*

`src/core/ledger/stats.ts` answers R8.9's five questions with SQL and nothing
else: no fs, no subprocess, no adapter registry. Every query takes the same
filter, so "this skill", "this repo" and "across every registered repo" are one
code path with a narrower `where` clause rather than three queries.

```ts
interface StatsFilter {
  skillId?: string
  repoId?: string
  /** R7.6: the run's provenance fingerprint, §10.2. */
  provenanceFp?: string
}
```

| R8.9 clause | Query | Source |
|---|---|---|
| stage pass rate | `stagePassRates` | `stages.outcome` grouped by `stages.stage` |
| eval case pass rate | `evalCaseRate` | `casesTotal` / `casesPassed` / `casesErrored` from `stages.metrics_json` where `stage = 'evaluate'` |
| wall-clock per stage | `stageWallClock` | `stages.ended_at − stages.started_at`, median and max |
| open issue counts by severity and rule class | `openIssueCounts` | `issues` in state `open` or `acknowledged` and not suppressed, grouped twice, plus a sibling count of the suppressed ones |
| run history | `runHistory` | `runs` newest first by run id |

`dashboard()` composes all five plus the three counts a header needs. Medians
and the metric sums are computed in TypeScript: SQLite has no median, and
summing JSON in SQL would put the metric key set in two places.

**Counts exclude suppressed issues; listings do not** (R8.15). An issue the user has baselined is one they have decided about, and counting it would keep the Dashboard's open number from ever falling for anyone who uses a baseline — which is that number's entire job. `listIssues` keeps them, projects the tool's justification from the row it already selects, sorts them last, and offers an optional `suppressed` filter that narrows both ways; omitting it returns both, so an existing caller is unchanged. The Issues screen is the audit surface, and a suppression hidden there is a suppression that cannot be falsified.

**Wall clock is the stage's own span, not its tools'.** `durationMs` is
deliberately absent from `stages.metrics_json`: fan-out tools run concurrently,
so summing their durations overstates the stage, and `started_at`/`ended_at`
is the one field that cannot. Stage rows recorded before this section existed
carried the *run's* span in those columns, so migration 3 nulls them — a wall
clock that silently averages a stage's span with its run's is worse than a gap
the query can report as one.

**Stage metrics are the sum of their tool runs' count-like metrics**, reduced by
`reduceStageMetrics` in `stages/outcome.ts` and stamped onto the `StageResult`
by the pipeline, in one place, so an aborted stage (§8.1 rows 3b and 3c) carries
them too.

**R7.6's grouping key is a fingerprint over provenance, not the provenance
blob.** `provenanceFingerprint()` in `ledger/fingerprint.ts` hashes a **fixed
field order** — base URL host, model mappings sorted by key, auth token hash,
analysis modes sorted by key — because `JSON.stringify` over an object would
make two identical provenances hash differently for having been built in a
different key order. It is stored on `runs.provenance_fp`, indexed, so a filter
is a `where` clause rather than a scan that parses every row's JSON. The
fingerprint covers `analysisModes` for the reason §7 gives: a mode change makes
statistics incomparable, so it must show up as a boundary exactly as a provider
change does.

## 11. Run lifecycle, commands and cancellation

*Satisfies R5.2–R5.10, R5.12–R5.14, R12.4, R13.2.*

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
  strategy: 'git-worktree' | 'snapshot'
  workRoot: string                          // repo root inside the sandbox
  resolve(repoRelPath: string): string
  changeSet(): Promise<ChangeSet>
  apply(changeSet: ChangeSet): Promise<void>
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
  preimages: Preimage[]                     // what each target looked like here
}
```

`apply` takes the change set rather than re-deriving one, which is what makes R10.11's recheck compare against the values captured at preview: a set derived at apply would compare the tree against itself and never see drift. The preimages travel with it for the same reason.

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
  "repoPath": "…", "skillId": "…",
  "skillRelPath": "declawed",              // '.' for a repo-root skill
  "rootSkill": false,
  "snapshotDir": "…/snapshot-pre",         // empty for the git strategy
  "workRoot": "…",                         // the sandbox root, so recovery can prune it
  "preimages": [{ "path": "…", "sha256": "…", "mode": 33188 }],
  "openedAt": "…"
}
```

The last five fields are what let recovery run with no live `SkillRef` — a record outlives the run that discovered it, and re-running discovery to recover from a crash would make recovery depend on the config still naming the repo. `skillRelPath` and `rootSkill` are not redundant with `skillId`: `restoreSnapshot` filters the live side through the candidate manifest, so without them it could not tell which live files the snapshot deliberately never captured, and a repo-root restore deleted the repo's `.gitignore` and any stale archive.

`stage` is a plain string, not one of the five: retirement writes the same record under `retire/`, which is what lets one recovery path serve both (§13).

**Where startup is.** `src/cli/` detects on every launch — before the Work screen, before a headless run — and prints one line per unresolved record naming `skillgantry recover`. It does not block the launch: an old marker the user has decided to leave alone must not make the tool unusable. What does block is a *new* mutating run against a skill that holds an unresolved record, which refuses, because applying a second mutation over an unrecovered first is how a compensating rollback stops being able to compensate.

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

A fully suppressed security stage reports `passed` (§8.1 row 12c), so these preconditions permit the release — and a baseline is therefore a gate override in effect. That is intended, and R9.9 is what stops it being a retroactive one: the baseline file is an ordinary file inside the candidate manifest, so writing or editing it moves the skill digest, and the digest binding above refuses a release whose passing gates were recorded against the bytes from before. You cannot baseline your way past a gate that has already passed; you can only baseline and then re-run the gates, which is the visible, recorded path. `release/preconditions.ts` needs no change. The audit trail is threefold: the SARIF `suppressions` annotation on disk, `issue_detectors.suppressed_reason` in the ledger, and the baseline file itself inside the archive the consumer receives.

**Target version.** Supplied explicitly as a semver, or as a bump level (`major` / `minor` / `patch`) applied to the current frontmatter version. Never inferred silently.

**Stage-candidate-edits.** Inside the sandbox: `SKILL.md` frontmatter version, `CHANGELOG.md` section prepended, and `versions.json` when it exists. Manifest handling is unchanged — when no repo-root `versions.json` exists, the case for all 54 skills in `~/.claude/skills`, release updates only `SKILL.md` and records `"manifest": "none"`. SkillGantry never creates one.

**Package-in-sandbox.** The archive is built from `candidateManifest()` over the **sandbox** skill directory, so its contents are exactly the digested set: no workspace, no `.git/`, no earlier release archive, and, the case revision 2 could not answer, not the archive being written, since it is produced outside the candidate root and only moved into place at apply. It is written to `<run>/staging/<skillName>_<version>.zip` and its SHA-256 recorded.

**Verify-install.** The staged archive is extracted into a second temporary directory, and vercel `skills` is invoked **against that extracted local directory** in copy mode, non-interactively, with an isolated destination. Revision 2 said "install the archive via vercel `skills`", which is not executable as written: the tool documents git sources and local directories, not zip archives. Extract-then-install-directory works either way, and it verifies the same bytes the consumer will receive. Failure aborts, and since nothing has been applied, abort is a sandbox discard.

**Change set and apply.** The change set covers the scoped files **and the archive**, whose target is `<repoRoot>/<skillName>_<version>.zip`, so the archive is previewed in the diff, journalled with the others, and removed by a compensating rollback. Apply moves the staged archive into place as one journal entry.

**Evidence.** `<run>/evidence/` holds the validate result, eval report, merged security findings, the tool lockfile, the skill digest, the manifest mode, the candidate manifest and the archive SHA-256.

**Tool-run classification.** `StageResult` carries no message of its own, and `reduceStageOutcome` throws on an empty tool-run list, so `ReleaseStageExecutor` synthesises exactly one `ToolRunRecord` under `RELEASE_TOOL_ID` — the one external tool the stage invokes.

Evaluated in order, like §8.1's table; the first row that matches wins.

| # | Situation | `ToolOutcome` | `error_kind` |
|---|---|---|---|
| 1 | Not authorised (headless without `--yes`) | `skipped` | `no-authorisation` |
| 2 | vercel `skills` absent from the lock | `skipped` | `not-installed` |
| 3 | No target version supplied, or one that does not resolve against the frontmatter version (R9.10) | `failed` | — |
| 4 | No sandbox was opened for the stage | `errored` | `mutation-aborted` |
| 5 | `versions.json` exists but does not read as `{"skills": {…}}` | `failed` | — |
| 6 | A precondition refused (deprecated, gate, digest, version disagreement, unresolved mutation) | `failed` | — |
| 7 | The installability check exited non-zero | `failed` | — |
| 8 | `zip` / `unzip` / `skills` could not be invoked | `errored` | `spawn` |
| 9 | Packaging or the check timed out | `errored` | `timeout` |
| 10 | Anything else thrown while staging, packaging or verifying | `errored` | `mutation-aborted` |
| 11 | Staged, packaged and proven installable | `passed` | — |

Rows 3 to 5 precede the preconditions deliberately: each is a question about the *request* rather than about the skill, and answering "your `versions.json` is unparseable" as a generic gate refusal told the user nothing they could act on. Row 4 is unreachable in the shipped pipeline — `plan()` declares an empty scope for a request that cannot resolve a version, so no sandbox is opened for `execute` to refuse in — and it is stated anyway, because a `StageResult` is what the executor owes its caller in every branch.

**Row 11 is `passed` before the apply, not after it.** The executor's job ends at a verified staging directory; the write itself is the pipeline's, through `gateMutation`. So the tool run says the release was *proven releasable*, and whether the bytes then reached the user's tree is carried by the two rows below, which the pipeline writes over the stage result:

| Situation | `ToolOutcome` | `error_kind` |
|---|---|---|
| The apply was refused with nothing written — preimage drift (R10.11), a journal that could not be written, a sandbox that could not be opened, or a non-process failure raised inside the stage | `errored` | `mutation-aborted` |
| The apply completed and something after it threw — the evidence bundle is the reachable case | `errored` | `mutation-incomplete` |

The two are §8.1's rows 3b and 3c, and they call for opposite recovery, which is why `mutation-aborted` cannot cover both: nothing is compensated for an apply that completed, and treating one as the other either flips a sandbox marker to `discarded` over a written tree, so recovery never offers it again, or restores a pre-tool snapshot over an apply the user approved.

A refusal is `failed` with no `error_kind`, because the gate ran and understood the skill — the same distinction §8.1's governing rule draws between a verdict and an error. A tool run with no adapter touches no issue: `reconcile.ts` tolerates a tool it has no rule-class map for, so this `skills` tool run never enters reconciliation.

Git commit and tag are offered as a separate confirmed action after `done`. `apply()` never commits.

## 13. Retirement

*Satisfies R1.4, R1.6.*

Retirement writes `metadata.deprecated: true` into `SKILL.md` frontmatter through the ordinary mutation path of declared scope, diff preview, confirmation and journal, and mirrors `lifecycle_state`, `deprecated_at` and an optional `superseded_by` into the `skills` row. Gates still run against a deprecated skill; it simply cannot be released. Reversal clears the same fields by the same route.

**`SKILL.md` frontmatter is authoritative. The ledger columns are a derived cache.** Two writes across a file mutation and a separate SQLite transaction cannot be made atomic, so revision 2's arrangement left it undefined which copy release should believe after a crash between them. Naming an authority makes the question unanswerable rather than merely answered:

- Discovery reads `metadata.deprecated` from frontmatter and reconciles the `skills` row to it on every scan, so a stale ledger self-heals on the next discovery rather than needing recovery.
- Release preconditions read the **frontmatter of the release candidate**, never the ledger, so a lagging cache can neither block a legitimate release nor permit a forbidden one.
- Reversal is one file write; the ledger follows on discovery.
- A mismatch is not an error state. It is reported in `doctor` as `lifecycle-drift` and resolved by reconciling to the file.

**Invocation.** `skillgantry retire <skill> [--undo] [--superseded-by <id>] [--yes] [--json] [--allow-dirty]`. Retirement is not one of the five stages, so it does not run through the pipeline; it runs the same declared-scope, diff-preview, confirmation and journal path directly, with its sandbox and journal under `<workspacePath>/skillgantry/retire/<id>/`. That directory shape is deliberate: startup recovery scans for `sandbox.json` under the workspace, so an interrupted retirement is recovered by the same code as an interrupted release, with no special case.

The cache still earns its place: the Issues and Dashboard screens filter deprecated skills across every registered repo without reading 76 files.

## 14. Terminal interface

*Satisfies R11.1–R11.6.*

One store fed exclusively by core events; Ink components are pure functions of it. Commands flow back through `RunHandle` and `QueueHandle`.

```
SkillGantry 8 skills · 1/2 running
┌────────────────────┐┌────────────────────────────────────────────────────────┐
│ Skills 1/8 · 1 ma… ││  Validate  Evaluate  Security  Optimise  Release       │
│ › ● declawed       ││  passed    failed    running   ·         ·             │
│   ○ gap-analysis   │└────────────────────────────────────────────────────────┘
│  *! spec-lint      ││ 1 Log  2 Findings  3 Artefacts  4 SKILL.md             │
│   ○ zuhlke-slide…  ││ skillspector: scanning declawed/scripts/scan.py        │
└────────────────────┘└────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────────┐
│ Queue 1/2 running · 2 waiting · +1 more                                      │
│ › ▶ running declawed validate,security                                       │
└──────────────────────────────────────────────────────────────────────────────┘
j/k move · space mark · r run · x cancel · ? help · q quit
```

Render discipline, the whole mitigation for choosing Ink: `tool:output` chunks enter a per-tool-run ring buffer of 2000 lines held **outside** React. A 100 ms tick copies the visible window into state. Every other pane re-renders only on discrete state change. Log text never enters component state line by line.

The output pane is a focus stop like the other three panels — the cycle is skills → stages → output → queue, in the order they sit on the screen — and `j`/`k` scroll whichever tab is up. `AppState.outputOffset` is the first visible row, or `null` for "wherever this tab naturally sits": the top of a findings, artefact or SKILL.md list, the newest line of the log. Null rather than a number because an offset pinned at the tail stops being the tail the moment the next line lands, so a log scrolled back to its newest line resumes following instead of freezing one line short. Scrolling the log reads the same flushed window R11.4 already puts in state and adds no path from the ring buffer into React. `outputWindow()` in `src/tui/rows.ts` is the one place the window is derived, because the pane renders against it and the key handler clamps against it — two derivations of that arithmetic is how `j` stops moving several rows before the end and every further press does nothing.

Screens: Work (above), Dashboard (ledger aggregates), Issues (cross-repo table with state transitions), Tools (install, pin, verify, doctor), Settings (repos, concurrency, credentials status). Vim-style movement, `?` for help, `:` for a command palette. The queue is a panel on Work, showing `QueueHandle.snapshot()` with per-job cancel.

The palette is the screen switcher: `:` opens it, typing filters the command
list, `enter` runs the selection and `esc` cancels. Direct keys were rejected
because Work already spends `1`–`4` on its output panels, and a second digit
scheme reading differently per screen is how a keymap becomes unguessable.
`esc` on any screen other than Work returns to Work.

**A suppressed issue is marked, never hidden** (R8.15). The Issues row carries `⊘ suppressed: <reason>` on its trailing field, beside the existing `⟂ blockers` precedent, and renders dimmed; the panel title gains `· N suppressed`. Zero new rows, zero new keys — §14.1's budget is what that constraint exists for — and the mark survives `truncateMiddle`, which elides the head. The glyph is paired with the word, so a monochrome terminal loses nothing. A suppressed finding in the Work screen's Findings pane carries the same glyph on its existing row. No new requirement covers either: R11.3 puts the Issues screen on the map and R8.15's listing clause says what must appear on it.

Dashboard, Issues, Tools and Settings each render one `Panel` whose body is
windowed against `layout.rows` by `screenBodyRows()`, so §14.1's four rules
hold on them the way they hold on Work and on help. Dashboard, Tools and
Settings build their bodies as a flat list of rows through pure functions in
`src/tui/rows.ts`, which is what lets the row budget be asserted without
rendering Ink.

#### 14.1 Responsive layout

`layoutFor(columns, rows)` in `src/tui/layout.ts` is the single place pane sizes are decided, and it is pure: `Work` reads `useWindowSize()` and passes the result down. Nothing in the tree carries a fixed height. The fixed sizes it replaced (a 12-row log, a 5-row queue, a 24-cell skill column) rendered 26 rows into an 80×24 window and scrolled the header away.

Three modes, by terminal width, with the skill list, rail and pane visible in all of them (R11.1):

| Mode | Width | Layout |
|---|---|---|
| `standard` | ≥ 110 | list beside the rail, 18% of the width as the column, 26–34 cells |
| `standard` | 76–109 | as above, 22-cell column |
| `narrow` | 50–75 | list stacked above the rail, borders dropped |
| `too-small` | < 50 or < 14 rows | the required size, and nothing else |

The two width bands above 76 differ only in how much width the skill column gets, so they are one mode. `mode` names the branches `Work` actually takes; a fourth name that no code read invited a `mode === 'wide'` branch that would have meant nothing.

Narrow drops the borders rather than the panels. Four bordered boxes cost fifteen rows of chrome in a stacked column, which leaves nothing for content in a 60×20 split; titles alone cost eight. That is what `chrome: 'boxed' | 'bare'` selects, and `Panel` is the one component that reads it.

Four rules keep a frame inside its budget, each learned from a row that overflowed it:

- **Every panel renders exactly the rows it was allocated.** An overflow count (`+5 more`) or a footnote (`4 earlier lines dropped`) is counted *against* that allocation, never appended below it. One extra row pushes the panel beneath it off the bottom.
- **Text truncates, never wraps.** Content rows carry `wrap="truncate"`, and labels are cut with `truncate()`, which measures cells through `string-width` so a CJK skill name cannot overflow its column by its own width. `truncateMiddle()` is its head-elided twin, for paths whose basename is what identifies them.
- **What the chrome costs is `layout.ts`'s to know, not each pane's.** `innerWidth(width, chrome)` is the single expression of `Panel`'s border and padding. Three panes each re-deriving `width - 4` meant a change to `Panel`'s padding would silently truncate every label to the wrong width, with nothing failing.
- **The rail and the output pane share one horizontal rule** (`borderTop={false}`), because two adjacent boxes each drawing their own spent two rows on one seam.

Every full-screen view obeys the budget, including the help screen: it renders through `Panel`, windows its binding list against `layout.rows`, and reports what it cut. Drawing its own fixed-size frame scrolled its own title away on a 50×14 terminal. The wizard is the one view sized independently — it is inline rather than full-screen — but its width is still a `layout.ts` decision (`setupWidth`), never a constant in the component.

Discoverability is layered rather than crammed into the header: a five-key footer hint bar, `?` for the full binding list. The old header spent 118 characters on keys and wrapped to three lines in a 60-column split. That footer is one component, `StatusBar`, rendered by every screen: the keys on the left, `v<version>` on the right, and no screen composing its own — eight hand-rolled copies of the same row is how the Issues footer came to omit `q quit` while `q` quit from there. The version rides that row rather than taking one of its own, and is dropped whole when the keys will not fit beside it, since truncating the keys to make room defeats what the footer is for. It is read from `package.json` through `core/version.ts`, which is also what `skillgantry --version` reports; the literal it replaced had drifted two minor versions behind the manifest. The Work screen renders on the alternate screen so a session does not bury the user's scrollback; `skillgantry setup` stays inline, because it is summon-choose-exit and its result should remain in scrollback. §14.2 renders the same wizard a second time as a full screen inside the session, where the alternate screen and the row budget both apply — the states and the component are shared, the framing is the caller's.

#### 14.2 Settings: viewing and editing the configuration

*Satisfies R11.7, R11.8.*

M6 shipped Settings read-only and recorded why: an editable screen would be a second write path to `config.json` with no requirement asking for one. R11.8 is that requirement, and the "second write path" is what this section is arranged to prevent — there is one staged document, one validation, one write.

**The view names the file, not just the value.** Rows are grouped by the file that holds them, and every editable value carries its origin: the file, a built-in default, or a session override.

```
Repos                            ~/.skillgantry/config.json
  zapac        20 skills  git    /Users/…/zapac-agent-skills
Execution                        ~/.skillgantry/config.json
  concurrency        4           config.json  (session 2, via --concurrency)
  artefact cap       32 MiB      default
  mutation timeout   5m 00s      config.json
  validate           skill-lint  config.json
Credentials                      ~/.skillgantry/.env          read-only
  skillspector       ok  via anthropic
Ledger and tools                 ~/.skillgantry/gantry.db, tools/lock.json
```

Origin costs a second read of the raw file, because `loadConfig` parses through the schema and the schema substitutes a default for every absent key — by the time the config reaches a screen, a value the user wrote and a value nobody wrote are the same number. `settings()` therefore reports which top-level keys were literally present. Without it the screen invites a user to edit a file that does not contain the setting they are looking at.

**Three edit paths, one staged document.** Every path writes into a staged `GantryConfig` held in the app store, seeded from the loaded one. Nothing touches disk until the change set is confirmed.

| Path | Key | Covers |
|---|---|---|
| The setup states, as a screen | `:setup`, or from a Settings row | `stageTools`, `repos` additions |
| Inline value editor | `e` on a selected row | `concurrency`, `artefactSizeCapBytes`, `mutationTimeoutMs`, `timeoutOverridesMs` |
| Repo removal | `d` on a repo row | `repos` removals |

`version` is not editable: it is the schema's own literal, and a user who could change it could only make the file unloadable. `timeoutOverridesMs` is a record rather than a scalar, so the screen renders one row per selected tool carrying its effective timeout — the adapter's default or the override — and editing that row stages an override while clearing it removes the key. A record with no row per key would let a user see an override and have no way to take it back off.

The setup states are the same `setupReducer` and the same `Setup` component `skillgantry setup` renders; `Screen` gains `setup`, so the palette entry follows from the screen list rather than being a second registration. Two things follow from re-entering a wizard that was written to run once on a clean machine. Its initial state is seeded from the current selection, because an empty `selected` renders as "no tool chosen" and makes an unchanged pass through the screen look like a request to clear every stage. And its install step marks a tool already locked at its pinned version and already verified as `ok` without reinstalling it, because changing one tool otherwise reinstalls the whole selection. Both apply to the inline wizard too: the second is a fix there, not a divergence.

Removal takes the repo out of the configuration and nothing else. Workspaces, sidecar evidence and ledger rows survive, so re-registering the same path finds its history — and the confirmation says so, because "remove" over a path is otherwise read as a delete.

**The change set is semantic, not textual.** `unifiedDiffFor` spawns, and `src/tui/**` may not; more to the point a line diff of a JSON document reports an array edit as a block move, which is not what the user did. `configChanges(current, staged)` is pure, lives in core, and emits one row per changed field:

```ts
interface ConfigChange {
  kind: 'add' | 'remove' | 'change'
  /** Dotted field path, e.g. `stageTools.validate`, `repos[zapac]`. */
  path: string
  before: string | null
  after: string | null
}
```

There is no per-row "needs a restart" flag, because today it would be `true` on every row: `startTui` closes over the tool selection, the lock, the environment and the caps, `createQueue` captures the pool size, and the skill list is resolved once — so no field is rebindable mid-session. The pane states it once, over the whole change set, which is what R11.8 asks for while the answer is uniform. A field that later becomes live-rebindable is what would reintroduce the flag, and it would then carry information instead of restating a constant on every line.

The confirm pane is a sibling of `ReviewPane`, not a generalisation of it: both are `Panel` bodies under §14.1's budget, but one renders diff text and the other renders change rows, so a shared component would be a switch with two disjoint halves. `a` applies, `d` discards, `j`/`k` scroll — the same three keys the mutation review already trains.

**What the gate does not cover.** Installing a tool spawns an installer and writes `tools/lock.json` before any configuration changes, and no confirmation can undo that. The change set covers `config.json` alone, and says which file it covers in its title. `.env` is neither staged nor rendered into a change row (R7.3), which is why credentials are a view-only group rather than an editable one that refuses.

**Applying rebinds nothing that is already running.** `startTui` resolves `stageTools`, the lock, the environment, the caps and the pool size once and closes over them, and a queued job carries the plan it was admitted under. A run whose provenance and tool lock were recorded under one configuration and executed under another would make the ledger's own record untrue, which is a worse failure than waiting for a restart. So apply writes the file, re-reads it into the view, and marks each change that the session will not honour until relaunch.

**Where the decisions live.** The transforms are decisions over a document, so they stay out of the module that owns the file: `withRepo`, `withoutRepo`, `withStageTools` and `withScalar` are pure functions in core, `registerRepo` becomes its filesystem half plus a call to `withRepo`, and the staged path and the live path can no longer disagree about id uniqueness or duplicate rejection. The terminal interface reaches the write through one new port method, `applyConfig(next)`, which validates and saves; the transforms and `configChanges` are pure and need no port.

Modal precedence is fixed and ordered by what a keystroke can destroy: the mutation review first, because its `a` writes the user's repo; then the config confirmation; then the setup screen; then the palette; then help.

### 14.3 Copying a fix prompt

*Satisfies R11.9.*

`y` on the Work screen copies the §9.4 fix prompt for the **lifecycle rail's selected stage** — the vim yank verb, unbound before this. It sits in `useInput` after the Work-screen gate and before the `r` handler, so every modal above still wins its keystroke.

The rail's stage and not a Findings-pane selection, because the pane has no per-finding cursor and `SkillRow.findings` accumulates across every stage of the run, so a finding on screen cannot be attributed to a stage at all. The rail already carries a selection moved by `h`/`l`, which also makes `y` work from any output tab. `StageCell` therefore gains a `findings` count, set from the `stage:done` event that already carries the whole `StageResult` — no event contract changes.

**The OSC 52 write lives in `src/tui/`.** The escape has to reach the terminal Ink currently owns — alternate screen, raw mode, the stream Ink was constructed with — and `src/cli/tui-command.ts` hands control away at `startTui` with no live handle on the keystroke. The lint rules ban `console` and `process.exit` in **core**, not stdout writes in the renderer; writing stdout is what the renderer is. Encoding is split into a pure `osc52.ts` so the byte shape is testable without a terminal, base64 over **UTF-8** explicitly — a non-ASCII character in a finding message corrupts a `binary` payload. It returns null above a size cap so the caller can never report a copy that did not happen. The write goes through `useStdout().stdout.write`, not Ink's `write()` helper from the same hook: that one writes above the app and forces a clear-and-re-render, flickering the frame for a sequence that renders nothing.

**The path is surfaced at zero row cost.** Terminal.app, and tmux without passthrough, discard OSC 52 silently, so an action reporting only success is one the user cannot trust. `AppState` gains a `flash` that the Work screen passes to `StatusBar` in place of the hint text — the footer already occupies that row on every screen, so §14.1's budget is unchanged. It names the path in each of the unavailable cases too: no recorded run, a stage that found nothing, a file not written yet, a body over the cap. The first case used to read "no run this session" and offer the `skillgantry fix` command line as a fallback; §14.5 now presents a recorded run, so what remains is a skill that has never run at all — where that command would exit non-zero too. It says `press r` instead. The flash clears on the next keypress rather than on a timer, which keeps the TUI tests deterministic, and the path is cut with `truncateMiddle` so the basename survives.

The Findings pane gains **no** footer row. `outputWindow()` is the single derivation the pane renders against and the key handler clamps against, and it already spends rows on `overflow` and `dropped`; a third footnote would cost the findings list a row on every render — paying the budget permanently for a static hint, which is what §14.1's first rule exists to stop. `HINTS` does carry `y copy`, as the seventh pair. The first cut of this left it out on the grounds that a seventh pair truncates the keys, which measured wrong: seven pairs is 67 columns, and `StatusBar` only drops the version once hints plus version exceed the width, so at §14.1's 80-column floor the whole row still fits with the version beside it. What truncation would cost is the tail, `q quit`, and that is the bound on an eighth pair rather than an argument against this one. The help screen's `KEYS` row stays as the second tier.

### 14.4 Watching a run, and being told when it lands

*Serves R11.6's queue panel and the fourth product principle: the maintainer is watching a long-running process.*

A real eval iteration ran 1m54s, and a stage's log can go silent for most of that. Everything below is bought at zero row cost, because §14.1's budget does not relax for reassurance.

**The queue row says how long.** `JobRecord` already carries `startedAt` and `endedAt`, so a running job counts up and a finished one holds what it cost — no new state, no core change. The verdict word gets a fixed column (`VERDICT_WIDTH`, derived from the two colour maps rather than counted by hand) so the time lands in one place down the panel, and the label is padded with `padCells`, which measures cells: `padEnd` counts code units, so a CJK skill name was padded to half the column it needed and pushed every value right of it out of line. A job that has not started shows nothing rather than its time in the queue — twenty rows each counting how long they have waited is noise around the one that is working.

**The row names the verdict, not the job's lifecycle.** The pool ends every run that *completed* as `done`, a security stage that found criticals included, so a row rendering `job.state` painted that run green while the rail one panel up said `failed` — one condition under two names in two colours on one screen. `jobVerdict()` in `tokens.ts` is the single resolution: state for anything that has not finished and for a run that threw (`failed` as a state means the run itself failed, which no stage outcome describes), outcome for anything that did.

**The running mark turns.** `SkillList` rotates the `◐` it already uses rather than adding a spinner beside it, so the column stays one cell and the learned shape is unchanged; phase 0 is the resting glyph, so a terminal that never repaints loses nothing. `useTicker(active)` runs an interval **only while something is running** — one left alive on an idle screen re-renders the whole Work tree forever to animate nothing — `unref`s it so `q` never waits on a decoration, and restarts from zero each time it wakes, which is what lets a test assert on the first frame without holding the clock.

**A settled queue reports itself in the footer.** The same row §14.3 established, for the same reason. It is raised when the queue *empties*, not per job: a batch of twenty reporting twenty times would hide the footer's five keys for the whole run, and what the user left the terminal to find out is whether it all passed. One job reports in full — verdict, elapsed, finding count, run directory — because that is the case where the evidence has a single address to name (principle 1); a batch reports a tally by verdict in a fixed worst-first order. Verdict again, never state, or a batch that found criticals reads as `4 passed`. Verdict first and the path last, since `StatusBar` cuts from the end and a narrow terminal should lose the address before it loses the answer. `flashTone` rides with the message and is only ever set with it, so the two cannot describe different events; it uses the same green and red `OUTCOME_COLOUR` gives the rail.

### 14.5 Rehydrating the last recorded run

*Satisfies R11.10.*

Every field of `SkillRow` but one was a pure function of the session's queue event stream, so relaunching against a skill with four recorded runs rendered an empty rail, an empty findings list, an empty artefact list and a `y` that refused. `loadSkillStatuses` was the single launch-time read, and it fed the skill-list glyph alone — which is what made the empty rail beside a red `!` read as a bug rather than as a blank slate.

**The sidecar, not the ledger.** R8.2 makes the sidecar the evidence and the ledger a queryable index of it; the screen already knows which skill is selected, so no cross-skill query is needed; and `src/tui/**` may not open the ledger at all. Same reasoning `skillgantry fix` records, and the same resolution rule: the greatest run id in `index.ndjson`, never the `latest` symlink, which is absent mid-write. `newestRunId()` in `views.ts` is that rule's one expression, called by both `loadSkillStatuses` and `loadLastRun`.

**Lazily, per selected skill.** One index read plus at most five `stage.json` reads, on selection. Eagerly at launch over 54 skills is 270 reads to fill four rows on screen. It matches the SKILL.md and artefact panes, which already load on selection, and re-uses their effect's shape.

**The reducer holds the precedence rule, not the effect.** The read is async, so an `r` pressed while it is in flight must not have its live run clobbered by a response that resolves after `run:start`. `run:start` sets `activeRunId` and `runDir` together, so `set-last-run` refusing a row where either is set is both R11.10's precedence rule and that race guard, in one condition evaluated at dispatch time rather than at read time. `status` is left alone: `set-statuses` already owns it from the same index.

**The Log pane replays per skill, not through the buffer.** The first cut left it unreplayed and named the run's directory instead, on the grounds that `state.log` is one session-wide ring buffer shared by every skill while everything above is per-skill — so seeding it is ambiguous the moment one skill is running and another is selected. A shipped run showed why that is not a boundary a user can read: four panes had loaded and the fifth named a path, which looks like a pane that failed.

The ambiguity is real and the fix is to not use the buffer. `SkillRow` carries `recordedLog` and a `rehydrated` flag; `logLines(state, skill)` in `rows.ts` resolves which of the two the pane is showing, and `run:start` clears both, which is where the live buffer takes the pane back. Because the recorded lines never enter `state.log`, a skill that has not run this session cannot display whichever skill did — and R11.4 is untouched, since no new path runs from the ring buffer into React.

`logLines` and `logDropped` sit beside `outputWindow` for its reason: the pane renders against those lines and the key handler clamps against their count, so a second derivation is how `j` comes to stop short of the end. The replay carries the tool-id prefix the pump writes, so a recorded frame and a live one read identically; it is capped at `LOG_CAPACITY` keeping the newest and reporting the rest through the footnote R11.5 already spends a row on; and the two streams are ordered stdout-then-stderr per tool rather than merged, because the pipeline writes them as two files and their true interleaving is not on disk. The empty case now means the run's tools wrote no log at all, and still names the directory.

Read-only throughout. The pipeline stays the only writer under `runs/`, which is the constraint R11.10 shares with R12.6 and for the same reason: a screen that answers for a run must not rewrite that run's evidence.

## 15. Headless interface

*Satisfies R12.1–R12.4, R12.5a, R12.5b, R12.6.*

```
skillgantry run <skill> --stage validate,evaluate,security [--json] [--yes]
skillgantry doctor [--json] [--migrate-rule-map]
skillgantry setup
skillgantry release <skill> --version <semver|major|minor|patch>
                            [--yes] [--json] [--allow-dirty] [--notes <text>]
skillgantry retire <skill> [--undo] [--superseded-by <id>]
                           [--yes] [--json] [--allow-dirty]
skillgantry recover [--restore <runId>] [--forget <runId>] [--json]
skillgantry fix <skill> [--stage <stage>] [--run <id>] [--json]
skillgantry [--concurrency <n>]                    # no subcommand: the TUI
```

A skill is named by `<repoId>/<name>`, by a bare name when that is unambiguous, or by the `name` its frontmatter declares — which is what a repo-root skill is usually called, since its id comes from the directory. There is no `--repo` filter: revision 2 listed one, nothing required it, and the selector already disambiguates.

`--concurrency` belongs to the root action alone, because it sizes the worker pool for a session and a headless `run` executes one skill. Root `--version` and `release --version` are distinct options on distinct commands; commander only keeps them apart under `enablePositionalOptions`, without which the root swallows the argument before the subcommand is reached.

Consumes the same event stream, rendering line output or newline-delimited JSON. Exits non-zero when any executed stage outcome is not `passed`. Mutating stages are skipped without `--yes`; with it, the diff is emitted before the write.

Every launch, headless or not, first scans for an unresolved mutation record and prints one `warning:` line per record naming `skillgantry recover` (§12.2). It never blocks the launch.

`fix` prints the §9.4 prompt for a recorded run. Its default output is the body alone, so `skillgantry fix declawed --stage security | pbcopy` works; `--json` prints one document rather than `run`'s ndjson, since there is no event stream to follow. With no `--stage` and exactly one stage carrying a prompt it prints that one, and with more than one it lists `<stage>  <path>` and refuses — the same shape the skill selector uses for an ambiguous name.

**Its exit code answers "is there a prompt on stdout", not "did the skill pass"** — `0` when one was produced, `1` when the run resolved and nothing in scope carried a finding. This is a deliberate divergence from R12.2's meaning for `run`: reusing that meaning would make a clean skill and a failed lookup indistinguishable. An unknown skill, run id or stage rejects and reaches the top-level handler like every other command's errors.

**Suppression reaches the headless surface additively.** `run --json` carries `ToolRunRecord` on `tool:done`, so each suppressed finding simply gains one optional key: no new event, no version bump. `RunDelta` is deliberately not extended — a `suppressed` counter would mean editing six files kept in step for a number the stage summary already puts on the rail during the run and the Issues screen already answers after it. `fix` gains one exit case: a run whose findings are all suppressed exits `1` saying so, rather than `0` with an empty table, and `--json` reports `findings` (actionable) and `suppressed` as siblings.

**It resolves the run from the sidecar, not the ledger.** The default is the greatest run id in `index.ndjson` — not the `latest` symlink, which is absent mid-write, and not `runs.sidecar_path`, because R8.2 makes the sidecar the evidence, the command already names its skill so no cross-skill query is needed, and a run whose ledger row failed still has complete evidence on disk. When the prompt file is absent but that stage's `stage.json` carries findings, `fix` rebuilds it in memory and marks it `onDisk: false`; it never writes, so the pipeline stays the only writer and runs recorded before §9.4 existed are answerable without rewriting their evidence.

## 16. Test strategy

*Satisfies R13.3, R13.4, R13.6.*

| Target | Method | Guards |
|---|---|---|
| `adapters` | Golden fixtures captured from real runs at the pinned versions; pure bytes → `ToolResult` | Upstream schema drift; the highest-value suite |
| SkillSpector manifest | Clean-environment smoke test invoking the exact manifest argv, no provider key set | The declared `credentials`/`analysisMode` pair is the one the tool actually accepts |
| Tool classification | One case per row of the §8.1 table, each asserting the reconciliation effect | A non-zero exit with a clean report passes; a sub-floor finding passes and stays filed; nothing else closes an issue |
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
| `isolation` | Git and non-git fixtures, each exercising all five change kinds (add, delete, rename, mode change, binary file); dirty override seeding; a concurrent user edit between preview and apply; an incomplete journal replay — all against a fabricated `sandbox.json`, at the unit level (`tests/core/isolation-*.test.ts`). Crash during the mutating tool and crash while awaiting approval instead run for real, in a second process (`tests/acceptance/m5.test.ts`, reusing M2's `tests/helpers/child.ts`), because a fabricated record cannot prove startup recovery finds a marker nothing wrote on purpose | Change sets complete; compensating rollback works; `sandbox.json` drives startup restore; `preimage-drift` aborts |
| Release | Git and non-git transactions through `skillgantry release` itself (`tests/acceptance/m5.test.ts`): the dirty-skill guard and its override; preimage drift between preview and approval; digest-mismatch refusal naming R9.9; the no-manifest path recording `manifestMode: none`; packaging failure and installability failure, each leaving no repo-root archive and no live change; a deprecated skill's gates-still-run-but-refuse path; the release tool run reconciling no issue. Crash recovery on the release path is covered by the `isolation` row above, since `openSandbox` is the same call either stage makes | The one stage that writes to the user's repo; a failed gate leaves no repo-root archive and no live file change |
| Mutation preflight | `git`, `zip`, `unzip` absent one at a time | A missing command fails before `sandbox.json` is written, naming the command |
| Concurrency | Two runs finalising one skill simultaneously, including inverse start/finish order; a truncated final index line; a lock whose holder died | No lost index line, `latest` by greatest run id, no run-id collision, no permanently held lock |
| `discovery` | Fixture trees with the `*-workspace/` snapshot trap, a repo-root skill, and a symlinked repo path | R2.3, R2.4, §4.1 canonicalisation |
| Candidate manifest | A skill directory legitimately named `snapshot-pre/`; an internal symlink; a symlink escaping the candidate root; a prior release archive at the candidate root | Only exact owned paths excluded; links hashed not followed; escape rejected — §4.4 |
| Repo-root skill | Discovery → read-only stage → snapshot → rollback → gitignore check, with a **canary secret planted in a prior native artefact** | Neither a fixture scanner nor the archive can observe the canary; no recursive copy — §4.4 |
| Packaging | `npm pack`, install into a clean prefix, invoke `--version` | R13.5 |
| Local install | `scripts/install-cli.sh` over an overridden `SG_HOME`/`SG_BIN_DIR`, run twice | Linked binary answers `--version`, resolves inside the overridden home, survives a re-run, and leaves the user's own `~/.local/bin` link untouched — §2 |
| `tui` | `ink-testing-library` on the Work screen | Smoke level only |
| Statistics queries | In-memory SQLite, runs recorded across two repos; each R8.9 clause per skill, per repo and unfiltered; the same set filtered by provenance fingerprint | R8.9 is answerable at all, and R7.6 splits the numbers rather than reordering them |
| Issue queries and user transitions | `listIssues` across two repos with each filter; every row of §10.5's user-action rows; `blockedBy` against a two-detector issue where one has reported absence | Triage cannot invent a transition the state machine forbids; the blocking detector is the one `reconcile` would close on |
| Traceability | `tests/specs/traceability.test.ts` parses both documents | R13.7: a requirement owned twice, owned never, claimed by no section, or claimed and absent fails the build |
| Screen row budget | Every screen rendered at 80×24 and 50×14 | §14.1's first rule on four new full-screen views |
| Config transforms | `withRepo`, `withoutRepo`, `withStageTools`, `withScalar` and `configChanges` as pure functions; id uniqueness and duplicate rejection asserted against `registerRepo`'s own result | The staged path and the live path cannot disagree about what a valid config is — §14.2 |
| `buildFixPrompt` | Pure, over a fixture `StageResult` modelled on the motivating run — two `medium` findings from one scanner | Every mandated element present; null for a zero-finding result; non-null for a §8.1 sub-floor `passed` stage; a `\|` in a message does not break the table; no Commit row for a non-git repo — R6.10 |
| Fix-prompt trigger | Through `pipeline/run.ts` with fake executors | A zero-finding stage writes no file; a one-finding stage writes exactly one beside `stage.json`; the sandbox-open-failure path writes none; a §8.1 row-3b abort whose tools had reported findings still writes one; the prompt names the real skill dir, not the materialised candidate |
| `skillgantry fix` | `buildProgram` with a collecting writer over a fabricated sidecar, plus one run in a second process | Default picks the greatest run id; `--run` and `--stage` override and restrict; two prompted stages list rather than concatenate; a clean run exits 1 saying why; `--json` parses as one document; a missing file with findings regenerates marked `onDisk: false`; **the sidecar is byte-identical afterwards**; the exit-code contract survives the process boundary — R12.6 |
| `y` and OSC 52 | `renderInk` with a fake queue and a real temp prompt file; `osc52` asserted as pure bytes | The frame carries the base64 of the file's bytes; the StatusBar shows the path; the frame's row count is unchanged by the keypress; each unavailable case names its reason and emits no escape; UTF-8 round-trips and an oversized body returns null — R11.9 |
| SARIF suppressions | Hand-built documents plus a golden fixture captured with `--baseline` pointed at the reference repo's own `declawed/.skillspector-baseline.yaml` | An empty `suppressions` array and an absent one are both unsuppressed; `rejected` and `underReview` do not suppress and an absent `status` does; a missing justification yields `''`; `findingsTotal` still counts every result and `outcome` is still `failed`; a diff test asserts the only deltas from the unbaselined capture are `result.suppressions` and the nondeterministic `properties.findingId`, so upstream moving anything else fails the suite — R4.15 |
| Conditional argv | Fake tool through `AdapterStageExecutor.execute` | Absent file → no flag; present → the flag carrying the **substituted** path; a directory at that path does not fire it; against a re-rooted `ctx.skill.dir` the flag names the materialised candidate — R4.14 |
| Suppression classification | `classifyToolRun` over parsed results | Every at-or-above-floor finding suppressed → `passed` with all findings retained; suppressed `high` + live `low` → `passed` via row 12b; suppressed `low` + live `high` → `failed`; a parser returning `failed` with zero findings is still `failed` — §8.1 rows 12, 12b, 12c |
| Suppression cache | In-memory SQLite through `recordRun` and `reconcile` | A suppressed fingerprint joins `reported`, advances `last_seen_run`, closes nothing and writes no `state`; the next unsuppressed sighting nulls both columns with `first_seen_run`, `occurrence_count` and every detection row intact; two fan-out detectors with one suppressing leave the issue unsuppressed in either finish order and both suppressing make it suppressed; a detector that says gone has no vote; one tool reporting two occurrences with one suppressed does not suppress; an `errored` and a `skipped` run each leave both columns untouched; a v4 database migrates with all four columns null and no backfill — R8.15 |
| Settings edit | Origin labels over a config with absent keys and a `--concurrency` override; a staged edit with no write; a schema-invalid value refused; discard leaving the file byte-identical; apply writing once and re-reading; the credential rows offering no edit | R11.7 and R11.8, without a terminal |

Fixture capture is a scripted, repeatable step tied to the pinned tool versions, so fixtures and pins cannot drift apart.

## 17. Traceability

*Satisfies R13.7.*

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
| R6 artefacts | 9, 9.1, 9.2, 9.4 |
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
| M5 | `isolation`, `release`, `stages/mutation.ts` + `stages/release-stage.ts`, `ledger/gates.ts` + `ledger/lifecycle.ts`, retirement, the mutating-stage gate, the TUI review pane |
| M6 | `ledger/stats.ts`, `ledger/issue-queries.ts`, Dashboard, Issues, Tools and Settings screens, the command palette, `tui/rows.ts`, the `GantryViews` port; then `config/edit.ts` (the pure transforms and `configChanges`), the setup screen, the inline value editor and the config confirmation pane |

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

## 18.3 What changed while M5 was implemented

Amendments this document took from building against it, each corrected in the branch that proved it wrong rather than left to drift. Recorded in [plan-m5.md](plan-m5.md).

| Problem | Resolution |
|---|---|
| One abort kind could not describe both an apply that wrote nothing and one that completed before a later step threw, though the two call for opposite recovery | §8.1 gains row 3c, `mutation-incomplete`, read off the sandbox record rather than inferred from how far the code got; §12.4 states both |
| §12.4's table named an outcome the executor cannot reach and omitted five it can, and read `passed` as "applied" though the executor's `passed` means "staged and proven installable" — the write is the pipeline's | Table re-derived from the shipped branches, ordered first-match-wins, with the apply's own two outcomes stated separately below it |
| §12.1's `MutationSandbox` and §12.2's `sandbox.json` were written before recovery had to work without a live `SkillRef` | `apply` takes the change set, `ChangeSet` carries preimages, and the record carries the five fields recovery rebuilds a `SkillRef` from |
| §3 still counted eight adapter-backed tools, and its "Depends on" column predated `isolation`, `release` and the module moves M4 and M5 made | Counts corrected to the four shipped adapters; the column re-derived from real value imports, with type-only imports named as non-dependencies |
| §15 listed a `--repo` filter nothing required or shipped, and omitted the flags that did | Command list re-derived from the shipped program, including where `--concurrency` and `--version` actually live |
| The journal read through symlinks, so an apply wrote a regular file over a user's link and a rollback restored a copy of its target — the one place in the system not already following §4.4's link rule | Links are hashed by target string and put back as links, keyed off the `S_IFLNK` bit the recorded mode already carries |

## 18.4 What changed while M6 was implemented

Recorded in [plan_m6-fix-prompts-for-stage-findings.md](plan_m6-fix-prompts-for-stage-findings.md).

| Problem | Resolution |
|---|---|
| A failed stage left the user with a finding list and no next step, and the two findings that prompted this were both unsafe to apply mechanically — one named a frontmatter field the schema does not have, the other flagged alignment whitespace inside a regex | R6.10, R11.9 and R12.6: the deliverable is a generated coding-agent prompt, not a fixer. It points at the tool's own report because `RawFinding`'s six fields drop the SARIF `properties` that explain and qualify a finding (§9.4, §14.3, §15) |

## 18.5 Respecting a tool's own suppression file

Recorded in [plan_m6-respect-skillspector-baseline.md](plan_m6-respect-skillspector-baseline.md).

| Problem | Resolution |
|---|---|
| A security run failed a gate on a finding the user had accepted in `declawed/.skillspector-baseline.yaml` 76 seconds earlier. skillspector 2.5.1 supports baselines; nothing auto-discovers the file, and SkillGantry's argv was a frozen literal with no `--baseline` flag | R4.14's `ConditionalArgv`: a manifest declares an argument group appended only when a path exists, and the stage executor answers the condition in `execute()` against the substituted path, because `plan()` runs before the sandbox re-roots `skillDir` and a repo-root skill's tool is handed a materialised candidate (§7) |
| The flag does not drop the result — it annotates it with SARIF `result.suppressions` — and the shared parser ignored the field, so the finding still failed the gate and still filed an open issue | R4.15: one optional field on `RawFinding`, not a second array on `ToolResult`, because R8.4 collapses a baselined and an unbaselined finding of one class in one file to a single issue, and a forgotten second array closes issues silently while a forgotten optional field files the finding exactly as today (§7, §8.1 row 12c) |
| Nothing in the ledger could say "reported, and the user has ruled on it" — `wontfix` is sticky, and dropping the finding in the parser would close the issue as `fixed` and make an accepted false positive indistinguishable from a real fix | R8.15: four columns as a derived cache over the skill's own file, on R1.6's pattern and for R1.6's reason. A suppressed sighting is *reported*, so it holds its issue open; the conjunction is per issue over the detectors still reporting it, so a tool-scoped baseline cannot speak for a scanner that was never consulted (§10.1, §10.4, §10.5, §10.6) |
| A prompt built from every finding would tell a coding agent to fix the thing the user had just ruled on | R6.11: the table is built from the actionable set, the omitted count is named, and a fully suppressed stage writes no prompt (§9.4) |

## 19. Risks carried into implementation

| Risk | Mitigation |
|---|---|
| Adapter contract shaped by Python tooling; two of the four shipped adapters are Python, and M1 validated against one | Closed in M4: skill-lint (TypeScript) and skill-up (Go) both ship, and the contract took neither |
| Merge-first identity understates occurrence counts | `occurrence_count` and per-detection rows preserve the detail; revisit if the Issues screen proves it insufficient |
| Unredacted native artefacts under the sidecar | 0700, gitignored, `redacted: false` recorded; no tool's input can reach them (§4.4); revisit if a scanner is found to echo credentials into its own report |
| Materialising a candidate costs a copy per run for repo-root skills | Only non-self-contained candidates are copied, which is the repo-root case alone; the 22-skill reference repo copies nothing |
| Static-mode SkillSpector detects less than LLM mode | Declared honestly in `detects` and `analysisMode`, recorded in provenance; an LLM-mode adapter is a separate id, never a silent fallback |
| Conservative closure holds issues open when one scanner is unavailable | Intended: the fail-safe direction. `issue_detectors` makes the reason visible per tool, so the Issues screen can show which detector is blocking closure |
| Rule-class map goes stale | Unmapped findings degrade to tool-scoped classes; migration is explicit and versioned |
| SARIF dialect differences between the two scanners | Shared parser fixture-tested against both tools' real output before fan-out merging is enabled in M4 |
| Ink responsiveness under sustained output | Ring buffer outside React plus fixed-interval flush; R11.4 is a measurable acceptance test |
| Upstream tools are young and will change output | Golden fixtures tied to pins with a scripted refresh; parse failure degrades to `errored` with the artefact retained, never to a wrong result |
