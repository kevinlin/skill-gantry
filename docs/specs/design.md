# SkillGantry — Design

**Date:** 2026-08-01
**Status:** revision 3, incorporating [design-review-r2.md](design-review-r2.md); amended in place through M9
**Layer:** design (layer 2 of 3: [requirements](requirements.md) → design → plan)
**Traces to:** [requirements.md](requirements.md), [decision-log.md](decision-log.md)

Each section names the requirements it satisfies. Revision 2 closed the twelve findings of the first review, revision 3 the eleven of the second, and every milestone since has amended sections in place rather than opening a revision. §18 indexes all of it: which sections each pass touched, and which document holds its reasoning. A bare `§14.x` anywhere below is [design_tui.md](design_tui.md)'s, which holds the terminal interface under its original numbers; every other `§n` is this document's.

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

Local installation is `pnpm run install:cli`, which packs the working tree, installs it into `~/.skillgantry/versions/<version>` and links `~/.local/bin/skillgantry` onto it with one atomic rename, verifying by invocation before reporting success. That version's prefix is wiped on every run, so the command on PATH always reflects current source; sibling versions are retained two deep, which §20 relies on for a rollback. It is a shell script rather than a subcommand because a subcommand cannot perform the first install. `SG_HOME` and `SG_BIN_DIR` override both paths, which is how the acceptance test installs without touching a real home. This is the one place SkillGantry writes outside a directory it owns; R3.1 binds managed tools, not SkillGantry's own binary.

## 3. Module map

*Satisfies R13.1, R13.2.*

Twelve modules under `src/core/`. Rule applied throughout: a module that owns I/O does not also own decisions.

Release is a module, not an adapter: it has no external tool to wrap, so it has no manifest and no `parse`. It does depend on `tools`, because vercel `skills` must be installed for the installability check. Five external tools are installed in total: four adapter-backed, plus vercel `skills`. Revision 2 planned eight adapter-backed tools, one per D7 candidate; M3 dropped four of them after probing — agentskills, SkillOpt and SkillHone are published nowhere installable, and promptfoo drives off a per-skill config no skill carries (decision-log §10).

"Depends on" is a *value* import between modules. A type-only import is not a dependency here — several modules take another's shape without being able to call into it, which is how `runner` runs a tool it never looks up and `workspace` writes a `StageResult` it never builds.

| Module | Job | Depends on | Owns I/O |
|---|---|---|---|
| `config` | Load/save `~/.skillgantry/config.json`; read and mode-check `.env`; build the redaction value set; the pure document transforms of §14.2 | `discovery`, `tools` | fs |
| `discovery` | Repo path → `SkillRef[]`; frontmatter parse; git detection; `workspacePath()`; `candidateManifest()`; `skillDigest()`; `materialiseCandidate()` | — | fs |
| `tools` | Tool root, three install drivers, lockfile with resolved executables, verify-by-invocation, doctor | `config`, `discovery` | fs, net, subprocess |
| `adapters` | Four manifest + parse modules; shared SARIF and skill-up parsers; rule-class map | — | **none** |
| `runner` | Spawn one tool: env injection, timeout with process-tree kill, stream redaction, artefact loading, exit classification | — | subprocess, fs |
| `stages` | `StageExecutor` contract; `AdapterStageExecutor`; `ReleaseStageExecutor`; outcome reduction | `adapters`, `discovery`, `ledger`, `queue`, `release`, `runner`, `tools` | — |
| `pipeline` | Stage sequencing, mutation gating, event emission, run finalisation transaction | `adapters`, `config`, `discovery`, `isolation`, `ledger`, `stages`, `workspace` | — |
| `queue` | Bounded worker pool, batch enqueue, cancellation, mutating-stage serialisation | `pipeline` | — |
| `workspace` | Sidecar writer: run dir claim, `run.json`, `stage.json`, per-tool dirs, `latest`, `index.ndjson`, gitignore fix, per-skill finalisation lock | — | fs |
| `isolation` | `MutationSandbox` over a declared path scope; git worktree and snapshot implementations; journalled apply; crash recovery | `discovery`, `tools` | fs, subprocess |
| `ledger` | SQLite schema and migrations, fingerprinting, reconciliation, issue state machine, stats queries | `adapters`, `workspace` | sqlite |
| `release` | Release state machine, version resolution, changelog, archive, evidence bundle, installability check | `discovery`, `isolation`, `ledger`, `tools` | fs, subprocess |

`adapters` depends on nothing else in the engine, and `ledger` on nothing but the rule-class map `reconcile` cannot classify without and the `STAGE_ORDER` constant `stats` sorts by. That is deliberate: they hold the two subtlest rules in the system and can be tested exhaustively with no mocking, which is what makes M1 a genuine validation of the design. `config` reaching `tools` is the same shape: one import of `stageToolsFor`, so §14.2's staged edit and `registerRepo` cannot disagree about which tools a stage may name.

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
    { "id": "zapac", "path": "/Users/…/zapac-agent-skills", "name": "zapac-agent-skills",
      "isGit": true }
  ],
  "stageTools": {
    "validate": ["skill-lint"],
    "evaluate": ["skill-up"],
    "security": ["skill-scanner", "skillspector"],
    "optimise": []            // no optimise tool is published installable — §5.3
  },
  "concurrency": 2,
  "artefactSizeCapBytes": 33554432,
  "mutationTimeoutMs": 300000,
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
| `.skillgantry-write.tmp` at the candidate root | where §12.5 stages a suppression write; same-directory rename is the only portable atomic recipe, so the file has to sit inside the candidate root, and a run digesting mid-write would otherwise hash it. Unguarded by `rootSkill`, unlike the row above, because the write happens in whichever candidate root holds the baseline |
| `.DS_Store` and `Thumbs.db`, **by basename, at any depth** | filesystem droppings no skill authored and no consumer should receive |

Basename matching is otherwise deliberately gone. Revision 2 excluded "any `snapshot-pre/` directory", which would have let a legitimately named skill directory change without invalidating gate evidence. Snapshots live at `<run>/snapshot-pre/` inside the workspace, so the workspace exclusion already covers them.

The two OS names are the exception, and they are safe for the reason `snapshot-pre` was not: both are reserved by an operating system, so no legitimate skill file carries them. They earn the exception rather than merely surviving it. A repo's `.gitignore` almost always covers them, which put them in the one class the git sandbox could not reproduce — see below — so a `.DS_Store` Finder wrote made every subsequent release of that skill impossible, and every `Thumbs.db` would have done the same on Windows. Excluding them also keeps them out of the archive a consumer installs.

**The sandbox must reproduce this manifest, not git's view of it.** The digest, the snapshot and the archive all read the manifest, which walks the filesystem. The git strategy is the one derivation that does not: it builds a worktree at HEAD and seeds it from `git status`, which hides ignored files by default. A candidate file the repo ignores was therefore in the digest the gates recorded and absent from the sandbox, so R9.9 compared two different sets of files and refused — and re-running the gates reproduced the same live digest and refused again, which made the release structurally impossible rather than merely blocked. `dirtyPaths` passes `--ignored` so that class is seeded like any other, and membership is still asked of the manifest, so a path the candidate excludes is reported by git and dropped here. Run `019fe590` is the failure this closes; the two rows above stop its commonest cause becoming a released byte.

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
    },
    "skillhone": {
      "installKind": "git-skill",
      "requestedPin": "7d565839fb4dc74f9c77f09ace660e1c0484e048",
      "resolvedVersion": "7d565839fb4dc74f9c77f09ace660e1c0484e048",
      "bin": "/Users/…/.skillgantry/tools/skillhone/.venv/bin/python",
      "integrity": "n/a",
      "links": ["/Users/…/.claude/skills/skillhone"],
      "config": {
        "path": "/Users/…/.skillhone/settings.json",
        "sha256": "9f2c…",
        "writtenAt": "2026-08-10T11:43:00Z"
      },
      "installedAt": "2026-08-10T11:26:00Z",
      "verifiedAt": "2026-08-10T11:26:04Z"
    }
  }
}
```

`links` and `config` are §5.4's, and both are here for one reason: they are the only writes that land outside the tool root, so the lock is what tells uninstall exactly which bytes to take back. Adding either kept `version` at 1, the schema being additive by construction.

`bin` is the resolved absolute executable. The adapter manifest supplies arguments only; it never has to know how the executable was placed on disk. This closes the first review's observation that `uv-tool` and `gh-release` installs left the executable unidentified.

`integrity` is `"n/a"` for kinds whose package manager already verifies its own download, and for `gh-release` it is `"sha256:<hex>"` or `"none"` per §5.2.

**Milestone split.** M1 builds the `uv-tool` driver, the lock writer and verify-by-invocation only — enough to produce a real managed SkillSpector install that M1's runner can resolve. `npm-prefix`, `gh-release`, presets, the wizard and `doctor` remain M3. Revision 2 put the whole module in M3 while asking M1 to run a real scanner, which it could not do.

### 5.1a Tool catalogue

*Satisfies R3.5, R3.5a, R3.11.*

`src/core/tools/catalogue.ts` holds one `ToolSpec` per installable tool: id, display name, the stage that selects it, the stage it serves, the runtime its driver needs, its install spec and its version argv.

**`stage` and `serves` are two questions, and the entries that answer them differently are the whole point.** `stage` is "may a run select this tool", and is `null` for three entries — vercel `skills`, which release invokes directly, and the two `git-skill` bundles, which have no adapter to parse them. `serves` is "what is this tool for", and every entry has one. They agree wherever `stage` is non-null, which a catalogue test asserts. Reading `stage` where `serves` was meant is how the setup wizard came to label SkillHone a release gate: `null` had exactly one member when the tool list was written, so it fell back to a constant, and the two entries added since inherited vercel `skills`' label. Any surface naming a tool's stage to a user reads `serves`; only `stageToolsFor` reads `stage`.

Installing reads neither. `installTool` takes `InstallableTool`, the id, install spec and version argv that the drivers actually use, so a caller installing a tool the catalogue does not hold — `installAndLock` — has no lifecycle stage to invent for it.

The catalogue exists separately from the adapter registry because installability and runnability are not the same property. Vercel `skills` is installable with no adapter, and M4's three adapters carry parsers for tools M3 already installs. The catalogue is the authority for installing, verifying and locking; the adapter registry is the authority for what a run may select. `AdapterManifest.install` is retained as documentation and kept in step by a test asserting the two agree for every tool holding both.

A consequence the wizard must respect: a selection written into `stageTools` names only tools the adapter registry knows, since `AdapterStageExecutor.plan()` rejects an unknown id and would fail every run of that stage. An installed tool with no adapter is reported as installed and not yet runnable.

A tool D7 names but no public source publishes in installable form is omitted from the catalogue rather than carried as an entry that can only fail. The omissions and the probe output behind each are recorded in [plan_m3-tools-module.md](plan_m3-tools-module.md).

**A catalogue entry need not have an executable.** SkillHone ships as a bundle of agent skills — six `SKILL.md` directories with their scripts and references — and nothing in it answers a version argv. That is the `git-skill` kind, and `stage: null` is what keeps it out of `stageTools`, vercel `skills` being the precedent for an entry installed by the catalogue and selected by no stage. `ToolSpec.install` therefore widens to `InstallSpec | GitSkillSpec` while `AdapterManifest.install` keeps the three-kind `InstallSpec` it has: an adapter manifest can never legitimately carry `git-skill`, because the tool it would describe has no executable to invoke, and widening the shared union would make that nonsense typecheck and weaken the test above that asserts catalogue and manifest agree for every tool holding both.

**And it need not have dependencies either** (R3.11). skill-upper is `SKILL.md`, two `.tmpl` assets, `references/` and its own `evals/` — no `requirements.txt`, no `.py`. So `GitSkillSpec.requirements` becomes optional, and the driver's `uv venv` plus `uv pip install -r` are skipped with it. That the field was mandatory is a fact about SkillHone rather than about the kind: one bundle happened to ship Python, and building an empty venv to satisfy the field would install a runtime the tool never uses and leave `doctor` probing an interpreter no code path reaches.

It ships inside the skill-up repo at `skills/skill-upper`, which is the same `repo/skills/<name>` shape the driver already assumes, and its pin is the **skill-up release tag** rather than a commit sha — unlike SkillHone's, which has no tags to pin. One pin for both halves of one upstream project cannot drift against itself, and guidance documenting flags the locked binary does not have is a worse failure than guidance that lags a skill fix by a release.

Its selection follows skill-up's rather than being offered under its own name (R3.8 as amended): it is that tool's authoring companion, so a preset carrying it alone would install a guide for a binary the machine does not have. `stage: null` for vercel `skills`' and SkillHone's reason, which here is load-bearing twice over — it has no adapter, so reaching `stageTools` would make `AdapterStageExecutor.plan()` throw `unknown tool: skill-upper` and fail every evaluate run.

### 5.2 Install drivers

| Kind | Mechanism | Executable resolution |
|---|---|---|
| `uv-tool` | `uv tool install <requirement>` with `UV_TOOL_DIR=<toolRoot>/<id>` and `UV_TOOL_BIN_DIR=<toolRoot>/<id>/bin` in the child environment, where `<requirement>` is `<spec>==<pin>` for a registry spec and `<spec>@<pin>` for a `git+` spec | `<toolRoot>/<id>/bin/<binName>` |
| `npm-prefix` | `npm install --prefix <toolRoot>/<id> <spec>@<pin>` | `<toolRoot>/<id>/node_modules/.bin/<binName>` |
| `gh-release` | download the asset matching `assetPattern` for tag `<pin>`, verify integrity per `integrity`, extract | declared `binName` inside the extracted tree |
| `git-skill` | `git clone` into `<toolRoot>/<id>/repo` then `git checkout <pin>`; one symlink per bundled skill directory into each detected runtime skills directory; where `requirements` is declared, `uv venv` plus `uv pip install -r <requirements>` into `<toolRoot>/<id>/.venv` | the venv interpreter at `<toolRoot>/<id>/.venv/bin/python`, or — with no `requirements` — the first linked skill directory inside the clone |

**A bundle with no dependencies takes neither the venv nor the interpreter probe** (R3.11). `bin` then records `<toolRoot>/<id>/repo/skills/<first skill>`, which is a path a verification can check and a prompt can name, rather than an empty string or an interpreter that was never built. Recording nothing was the alternative and it is worse in both directions: `checkLockedTool` reads `bin` before it branches, and R6.13's prompt has to tell an agent where the authoring skill is.

`git-skill` verification is three facts rather than a version argv, because `verifyTool`'s semver regex rejects a commit sha and nothing in a skill bundle answers a version argv at all: `git rev-parse HEAD` equals `resolvedVersion`, every recorded symlink resolves into the tool root, and — where one was built — the interpreter runs. That is what gives §5.3's existing drift kinds meaning here — `missing` is a vanished clone or a dangling link, `unverifiable` an interpreter that will not run, `version-drift` a HEAD moved off the pin. The pin is a commit sha because upstream publishes no tags, and git's own object hashing is the integrity check, so the lock records `integrity: "n/a"`.

The symlinks are the one place an install writes outside the tool root, which R3.1 permits only because they are recorded in the lock and removed on uninstall. They are per skill directory, never the parent `skills/`: upstream advises `cp -r` and the reason it gives — other skills already live in that directory — is an argument against linking the parent, not against linking a member. An existing entry that is not a symlink into our tool root is refused and named rather than clobbered, and detection is per directory rather than global, so a machine holding the bundle in one runtime gains links in the others without the first being disturbed. Detection cannot tell our install from someone else's, so a pre-existing copy is left alone and reported as installed but unmanaged — no sha, no drift — because clobbering a user's own install is a worse failure than a weaker doctor line. Uninstall is an explicit path rather than a consequence of deleting the tree: links outlive the clone, and a dangling `~/.claude/skills/skillhone` breaks every agent that scans that directory, which is the cost R3.1 exists to avoid.

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

It also names what is already registered, and can replace one of those entries rather than only appending (R3.12, design_tui.md §14.13). Two things follow in this module. `SetupDriver` gains `updateRepo(repoId, path)` beside `registerRepo`, implemented over `withRepoPath` the way `registerRepo` is implemented over `withRepo` — one `inspectRepo`, the same two refusals by name, one `saveConfig` — so the two write paths cannot disagree about what a valid repo edit is. And `withRepoPath` keeps the entry's **id and its position in the array**, replacing only `path`, `name` and `isGit`: `skills.repo_id` is a foreign key into `repos(id)` (§10.1) and `withRepo` derives an id from the path's basename, so remove-then-add across a directory rename hands the repo a new id and orphans every run and issue recorded under the old one.

What is registered stays out of `SetupState`, which holds what the session decided. The two callers of the wizard hold different documents — `skillgantry setup`'s is on disk, §14.2's screen stages its own — so one snapshot in the reducer would be one field meaning two things, and the reducer would be the place they came to disagree. It is a parameter of the render instead, supplied by whichever caller owns the document.

`done` is reachable with a registered repo **or** with the repo step explicitly skipped. A verified toolchain is the deliverable; requiring a repo left a user who set up before their skills repo existed with no exit but Ctrl+C.

Presets: **Minimal** is skill-up plus skillspector — the two already present, one evaluate and one security tool. **Recommended** is at most one tool per stage. **Everything** is the whole catalogue. A stage whose D7 candidates are all unavailable has no tool in any preset; that is visible in the wizard rather than papered over. Optimise's member is SkillHone, which is published as a skill bundle rather than a CLI — R3.5 as amended — so it joins Recommended and Everything and is absent from Minimal, a git clone plus a `litellm[proxy]` venv not being what "the two already present" means. Evaluate has one candidate rather than two, because promptfoo needs a per-skill config file no skill carries — decision-log §10.

skill-upper is in no preset and on no row of the tool list, and is installed whenever skill-up is (R3.8 as amended). It is a dependent rather than a choice: it exists to author the suites skill-up runs, and a user who selected it alone would have a guide for a binary they do not have. Expanding the install set is therefore a function over the selection rather than a preset entry, so per-stage choice and all three presets pick it up from one rule — a fourth preset listing would be a fourth place to forget it.

Every preset includes vercel `skills`, because the release stage cannot run its installability gate without it.

Doctor reports four drift kinds per tool: `missing` (in lock, absent on disk), `unverifiable` (present, will not run), `version-drift` (runs, reports a version other than `resolvedVersion`), and `unlocked` (installed under the tool root but absent from the lock). Three further conditions are reported and do not fail the report: `integrity-unverified`, a lock entry recording `integrity: "none"` per §5.2; `lifecycle-drift` per §13; `rule-map-pending`, a ledger whose applied rule-map version trails the shipped one per §10.6; `skillhone-deps`, a managed venv whose interpreter cannot import the bundle's requirements; `claude-cli-missing`, no `claude` on PATH, which `claude-agent-sdk` shells out to, so its absence surfaces not at install time but as a `FileNotFoundError` at the optimisation loop's first run; §5.4's three, `skillhone-config-missing`, `skillhone-config-unmanaged` and `skillhone-config-stale`; and `skill-link-unmanaged`, a runtime skills directory holding a bundled skill through a link SkillGantry did not create. Those six are R3.7's probe-and-report rule applied to a tool's own runtime dependency, its own configuration and a directory it shares with the user rather than to a host runtime: named, never installed and never written.

One further condition is reported and does not fail the report: `skillgantry-outdated`, a published release newer than the running build (§20). It names the version available and the command that installs it, `skillgantry upgrade`, and doctor never installs it — R3.7's probe-and-report rule applied to SkillGantry's own binary. It is not a `ToolDriftKind`: SkillGantry is not one of the tools in the lock, and widening that union would put it into every per-tool loop over the kinds. The check runs in `src/cli/` and is passed in as data, exactly as the lifecycle cache already is, so `src/core/tools/` gains no network dependency.

`skill-link-unmanaged` needs a kind of its own because the two states beside it already have one and neither describes it. A catalogued, selected tool with no lock entry is `unlocked`; a link SkillGantry made and something deleted fails `verifyGitSkill` into `missing`. The third is a foreign copy, which *works* — the agent has the skill, it is simply not ours — so it does not fail the report, and its detail names the link, its target, and that removing it and re-running `skillgantry setup` puts the pinned copy in place. Failing a report on a machine that is fine is how a doctor report stops being read, which is the same trade `integrity-unverified` and `lifecycle-drift` already make. None means a tool cannot run. `rule-map-pending` is resolved by `skillgantry doctor --migrate-rule-map`, which is the explicit trigger R8.14 requires — the migration never runs as a side effect of opening the ledger.

One condition is about a skill rather than a tool: `frontmatter-unreadable`, a `SKILL.md` whose frontmatter block is present and would not parse (R2.5). Reported, never failing the report, for the reason the six above are — nothing here stops a tool running. It is a `SkillFinding` on its own array rather than a `ToolDriftKind`, for `skillgantry-outdated`'s reason: a skill is not one of the tools in the lock. It reads no file: `SkillRef.frontmatterReadable` is what discovery saw when it parsed, so doctor filters the skills it was already given. `lifecycleDrift` re-reads because it is comparing the file against the ledger's cache, which is a different question.

Doctor reads the skills it checks and the ledger's lifecycle column as data supplied by its caller, so `tools` needs neither discovery's I/O nor a sqlite dependency.

### 5.4 Tool-owned configuration

*Satisfies R3.10.* R7.3's one exception is written for this section and argued in it; §9.3 keeps R7.3.

§5.2 installs a tool and §5.3 verifies it. SkillHone passed both and could not run: `optim.py`, `new.py` and `synth.py` each print `~/.skillhone/settings.json not found` and exit 1 before they read one environment variable. Every value that file needs was already in `~/.skillgantry/.env`, which the wizard reads one step later for its credential status — so the gap was not knowledge, it was that nothing composed the document. `skillhoneSettings(vars)` composes it and `writeSkillhoneSettings(userHome, doc)` writes it; the first is pure, which is what lets the whole mapping be asserted with no filesystem.

**Why this is not a catalogue field.** `ToolSpec` holds six things and none of them is a settings shape. A declarative `SettingsSpec` would be a schema for one entry, and everything specific about this one argues against generalising it early: the four rules below are all facts about SkillHone's Python, not about tools in general. `AdapterManifest.baseline` is the precedent for the shape a second such tool should introduce — declared per tool, resolved outside the adapter — and the second tool is what should introduce it.

**Four rules taken from the pinned checkout, because a later reader would otherwise re-derive them.** `SKILLHONE_HOME` does not move the file: `optim.py`, `new.py`, `synth.py` and `evaluation/template.py` all hardcode `Path.home()`, and only `status.py` and `seed.py` honour the variable, so relocating it would hide it from the three that need it most. The document is strict JSON: upstream's own `assets/settings.json` is JSON5 with `//` comments and only `status.py` reaches for a json5 parser, so a commented file is one every other reader rejects. A `/` in a model name switches SkillHone onto its LiteLLM loopback proxy, where the proxy's environment is the right operand of the merge and the profile's `env` block is discarded wholesale — so the block is emitted only for a slashless model, where it wins instead, which is the only way `ANTHROPIC_AUTH_TOKEN` reaches the agent at all, the direct branch deriving `ANTHROPIC_API_KEY` and nothing else. And every profile states its `sdk_model_alias`, because `template.py` defaults a missing one to `haiku` while `litellm_proxy.py` defaults the same profile to `opus`, so a profile without one names a model whose `ANTHROPIC_DEFAULT_*` key was never set. Keys the checkout has no reader for — `max_iterations`, `thinking_enabled`, `context_size`, the process-pool family — are not emitted, because configuration that changes nothing is worse than none: it reads as a setting someone tuned.

**The credential is in the file, and R7.3 says so rather than being quietly bent.** SkillGantry never spawns SkillHone — R6.12 forbids it running the optimiser at all — so for this tool there is no spawn to inject at, and the env-var-name indirection upstream offers (`api_key_env`) would only move the problem to a shell SkillGantry does not own. The exception is therefore narrowed in R7.3 to the tool's own configuration path, so "SkillGantry writes no credential of its own" still holds exactly, and the file is owner-only inside an owner-only directory, the discipline §9.3 already gives the workspace root for the same reason.

**Never overwritten.** An existing file is reported and left, because it holds the user's key and may have been tuned against a gateway this build knows nothing about; backing it up and replacing it was the alternative, and it makes setup a command that edits credentials the user did not ask it to touch. The cost is that a rotated token strands the file, which is exactly why `doctor` reports three conditions and not one: `skillhone-config-missing` is a re-run of setup, `skillhone-config-unmanaged` is a decision only the user can make about their own bytes, and `skillhone-config-stale` is the rotation case — ours, untouched, and no longer what the current `.env` would compose. Without that third one, never-overwriting would mean nothing in the system ever said the file had gone wrong.

**The lock records the digest, never the document.** That is what lets uninstall tell an untouched file from an edited one and delete only the first — R3.1's rule for a write outside the tool root, which `links` already carries, with a preimage recheck on top because here the recheck guards a delete rather than a write. A hash of a credential is not a credential, which is what keeps the lock a file the user can read.

**Nothing renders it.** The wizard's install row names the path, `doctor` names the path, and neither reads a value out of the document. This is not the redaction §9.3 applies to streams; it is a narrower rule, that the one surface which knows where the credential lives never quotes it — and the inline wizard is precisely where that matters, since its frames stay in the user's scrollback by design.

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

*Satisfies R1.5, R4.1–R4.5, R4.12, R4.14, R4.15, R4.16.*

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
  /** R4.16. Absent when the tool has no suppression file of its own. */
  baseline?: BaselineSpec
  timeoutMs: number
}

/**
 * R4.16. Where a tool keeps the findings its user has accepted, and what one
 * accepted finding looks like inside that file. Declarative rather than a
 * function the adapter exports: R4.1 makes an adapter a manifest and a single
 * `parse`, and R4.3 forbids an adapter touching the filesystem at all, so the
 * write lives in `src/core/suppress/` whatever shape the declaration takes.
 */
interface BaselineSpec {
  /** `{skillDir}`/`{repoRoot}` vocabulary — but resolved live, see §12.5. */
  path: string
  document: 'yaml' | 'json'
  /** The sequence one accepted finding is appended to. */
  collection: string
  /** The whole document, written when the file is absent. */
  scaffold: Record<string, unknown>
  /** One entry, in the finding vocabulary, kept separate from the path one. */
  entry: Readonly<Record<string, string>>
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
  /** `integrity` is required, never assumed: §5.2's driver has no checksum without it. */
  | { kind: 'gh-release'; repo: string; pin: string; assetPattern: string;
      binName: string; integrity: Integrity }

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
  baseline: {
    path: BASELINE_PATH,           // the same constant `conditionalArgv` reads
    document: 'yaml',
    collection: 'rules',
    scaffold: { version: 2, rules: [], fingerprints: [] },
    entry: { id: '{ruleIdGlob}', path: '{pathGlob}', reason: '{reason}' },
  },
  timeoutMs: 120_000,
}

export const parse: Parse = (ctx) =>
  // `skillRelPath` is what §7.1 rebases each reported path onto, so a materialised
  // candidate and an in-place one yield identical findings.
  parseSarif(ctx.artefacts.get('findings.sarif')!, {
    toolId: 'skillspector',
    skillRelPath: ctx.skill.relPath,
  })
```

**Analysis mode is a declared choice, not a fallback.** SkillSpector 2.5.1's `scan` runs LLM analysis by default and aborts unless one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, an AWS credential chain or `NVIDIA_INFERENCE_KEY` is available, so a manifest declaring no credential and omitting `--no-llm` fails at runtime while the engine believes none is needed.

v1 pins the static mode: `--no-llm`, `credentials: { kind: 'none' }`, and a `detects` set covering only what static analysis reaches. The reason is comparability. LLM-mode findings are nondeterministic, which makes golden fixtures worthless and the two modes' statistics incommensurable, so silently degrading from one to the other is worse than failing. `analysisMode` is copied into `run.json` provenance, so a later mode change is a visible boundary in the stats exactly as a provider change is.

An LLM-mode variant, when it is wanted, is a separate adapter id declaring `credentials: { kind: 'one-of' }` with one `CredentialSet` per provider — NVIDIA, OpenAI, Anthropic — each naming its required key and the `SKILLSPECTOR_PROVIDER` value that selects it.

`detects` for either mode is derived by the fixture-capture script from real output at the pinned version rather than hand-listed, so the declaration and the fixtures cannot drift apart. Under §10.4 a too-narrow `detects` is a completeness hazard, not a correctness one.

**Conditional argument groups, and why the stat is in `execute()`.** SkillSpector 2.5.1 reads a suppression baseline only when `--baseline <path>` is passed; `.skillspector-baseline.yaml` is merely where `skillspector baseline` writes one, and nothing auto-discovers it. A manifest declares the condition and the stage executor answers it, because R4.3 forbids an adapter touching the filesystem — and because the adapter could not answer correctly even if allowed to. The test runs in `execute()` against the **substituted** path, never in `plan()`: `plan()` runs before the sandbox re-roots `ctx.skill.dir`, and a repo-root skill's tool is handed a materialised candidate copy, so a stat against the manifest's own vocabulary would answer for a directory the tool never sees.

Three rules, each covering a real failure. `isFile()` rather than existence, because `--baseline <dir>` makes skillspector exit 2 with no SARIF written. A non-`ENOENT` stat failure reads as absent, because a baseline the engine cannot stat is one the tool cannot read, and the loud direction — every suppressed finding resurfacing — is the safe one. And the path carries the substitution vocabulary rather than being relative, since `cwd` is `repoRoot` here. The group is appended after `argv`, so a manifest ending in a positional argument cannot use one; every shipped manifest ends in an option value.

**A suppressed finding crosses the parse boundary annotated, not dropped** (R4.15). `--baseline` does not remove the result; it annotates it with SARIF 2.1.0's `result.suppressions`, so SkillGantry receives both the finding and the user's own justification. One optional field on `RawFinding` rather than a second array on `ToolResult`, for two reasons. R8.4's fingerprint is `(skillId, relPath, ruleClass)`, so two findings of one class in one file — one baselined, one not — collapse to one issue, and a split array destroys the pairing §10.4 needs to decide whether that issue is suppressed at all. And the failure shapes are asymmetric: a consumer that forgets a second array never files those findings, so §10.4 sees them absent and closes the issues as `fixed`, while a consumer that forgets the optional field files the finding exactly as today. The feature degrades to "no suppression", never to "issue closed and history lost".

`outcome`, `findings.length` and `metrics.findingsTotal` are unchanged by suppression — the parser's verdict stays "did I see anything", and a count that drops when a user edits a YAML file makes "did this skill improve" unanswerable. `summary` gains the count (`2 findings, 1 suppressed`), which reaches the lifecycle rail and `stage.json` and is the feature's always-on signal that the flag fired.

Two consequences fall out of the baseline file being an ordinary file inside the skill directory. It is part of the candidate manifest (§4.4), so writing or editing it moves the skill digest — which is what makes R9.9 refuse a release whose passing gates were recorded against different bytes (§12.4). And it is therefore inside the release archive, which is correct: a consumer receives the maintainer's accepted-false-positive list along with the skill.

**The manifest declares that file so §12.5 can write it** (R4.16). One optional field, fully declarative, and only skillspector has one — `skill-scanner 0.3.3` ships no ignore or baseline flag, `skill-lint` none, and skill-up runs evals. Suppression is therefore refused for three of four tools by name rather than offered and silently ineffective.

**The path shape is the silent failure mode.** skillspector's SARIF reports a skill-relative `uri: scripts/scan.py`, while `RawFinding.path` is repo-relative, rebased onto `skillRelPath` by §7.1. The glob matches against the tool's own path, so `{pathGlob}` carries the skill-relative form; writing the repo-relative one produces a rule that is syntactically valid, loads without complaint and suppresses nothing. For a repo-root skill `skillRelPath` is `.`, so the two coincide.

`{ruleIdGlob}` and `{pathGlob}` are glob-escaped by definition of the token, because skillspector matches rules with `fnmatch`: `*`, `?` and `[` in a substituted value are metacharacters, so a file named `notes[1].md` needs `notes[[]1].md` or the rule matches nothing at all. Escaping as a property of the token is what keeps §12.5's writer tool-agnostic.

**Two literals of one path, so one constant.** `conditionalArgv.whenExists` already carries `{skillDir}/.skillspector-baseline.yaml`, and `baseline.path` must be the same string or the day one of them moves is the day SkillGantry writes a file it no longer passes to the tool. Within an adapter that is a shared `BASELINE_PATH` const; across the registry a test asserts that every manifest declaring a `baseline` has a conditional group whose `whenExists` equals `baseline.path`.

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
| 0 | `plan()` threw, before any tool was considered | `errored` | `plan-failed` | no |
| 1 | Tool not in the lock, or lock entry has no runnable `bin` | `skipped` | `not-installed` | no |
| 2 | `credentials` unsatisfied by the environment | `skipped` | `no-credentials` | no |
| 3 | Mutating stage reached without authorisation | `skipped` | `no-authorisation` | no |
| 3b | Mutation apply aborted after authorisation with nothing written (preimage drift, journal failure, sandbox open failure) | `errored` | `mutation-aborted` | no |
| 3c | The apply completed and a later step of the same stage threw | `errored` | `mutation-incomplete` | no |
| 4 | Cancelled (§11.4) | `errored` | `cancelled` | no |
| 5 | Timeout fired, process tree killed | `errored` | `timeout` | no |
| 6 | A declared artefact exceeds the size cap | `errored` | `artefact-too-large` | no |
| 6b | Spawn itself failed (ENOENT, EACCES) | `errored` | `spawn` | no |
| 7 | A declared artefact is absent after exit | `errored` | `missing-artefact` | no |
| 8 | `parse` throws, or rejects the artefact as malformed | `errored` | `parse` | no |
| 9 | `parse` returns `errored` | `errored` | `parse` | no |
| 10 | `parse` succeeds, no findings, exit code 0 | `passed` | — | yes |
| 11 | `parse` succeeds, no findings, exit code non-zero | `passed` | — | yes |
| 12 | `parse` succeeds, an unsuppressed finding at or above the fail floor | `failed` | — | yes |
| 12b | `parse` succeeds, unsuppressed findings present, every one below the fail floor | `passed` | — | yes |
| 12c | `parse` succeeds, findings present, none of them unsuppressed | `passed` | — | yes |

Rows 7 and 8 are ordered so a missing report is classified before the parser is ever handed an empty map; revision 2 left this to whichever error the parser happened to throw. Row 6b is ordered above 7 for the same reason one step earlier: a tool that never started wrote none of its artefacts, so a spawn failure evaluated after row 7 reports itself as a missing report. Row 11 is the rule that matters most in practice: a scanner exiting 1 with a clean report has passed, and the parse says so.

Row 0 is the third a *stage* rather than a tool produces, and it is first because it is the only one that can fire before a tool selection exists. `executor.plan()` was the one executor call outside the stage loop's try, so its throw escaped to the run's rejection handler: `run:error`, no `stage.json`, no ledger row, and the partial evidence R5.13 requires a run to keep discarded along with it. R4.11 makes that throw reachable by design — an empty tool selection is rejected there — so any caller admitting a stage it should not have finds it, which the terminal interface did on every `optimise` mark before R11.20. Its own kind rather than `mutation-aborted`: that kind's documented meaning is a write refused *after* authorisation, and on this path nothing is built, let alone authorised. No new requirement, for the reason revision 7 gave when this same failure was fixed one call later in the stage — R4.13's enumeration is prefixed "at least", so the table gains a row.

Rows 3b and 3c are the two a *stage* rather than a tool produces once tools are in play. R10.11 aborts an apply when a target has drifted since the change set was built, and that is neither a tool failure nor a verdict about the skill: the tools ran and were understood, and then the write was refused. Without the row, `applyMutation` throwing propagated out of the pipeline and the run rejected, discarding the partial evidence R5.13 requires a cancelled or aborted run to keep.

Row 3c exists because the two cases need opposite recovery and one kind could not carry both. The sandbox record tells them apart — both strategies mark it `applied` only once the journal is complete — so the split is read off disk rather than inferred from how far the code got. Settling a completed apply as an abort flipped a git sandbox's marker to `discarded` over a written tree, putting it beyond recovery's reach, and on the snapshot strategy restored the pre-tool state over an apply the user had approved. Neither row keeps its stage's tool runs out of the record: an aborted stage carries whatever the tools produced before the abort and appends its own synthesised run, because R5.13's partial evidence is the point.

Only rows 10 to 12c feed issue reconciliation: the tool actually ran and its output was understood. Every other row leaves the ledger's issue states untouched, which is the fail-safe that stops a crashed or absent scanner from closing everything it once found.

**The fail floor is `medium`.** A table without a severity dimension failed a gate on an advisory as hard as on a critical: skill-lint 0.2.0 over `declawed` exited 0, called the skill `SAFE`, reported two `LOW` findings against the skill's own scripts, and R5.1 halted the lifecycle on a tool that had found nothing wrong.

`medium` rather than `high`, because §7.1 normalises SARIF `warning → medium`, `medium` is the fallback for a result carrying no level, and a failing eval case is `medium` under §7.2 — a `high` floor would pass most scanner findings and every failing eval case, the opposite defect.

Row 12b keeps its findings verbatim, so §10.4 files and reconciles them exactly as row 12's: a sub-floor finding is tracked and closes when it goes away, it merely stops halting the chain. Dropping them would make every issue that tool had filed look absent and close all of them.

The floor is a uniform rule over normalised severity and a constant. Not each tool's own verdict, because skill-lint bands a weighted score (`CRITICAL 10 / HIGH 5 / MEDIUM 2 / LOW 1`) where two `LOW`s and one `MEDIUM` both total 2 while only one crosses the floor, and matching every tool's formula would put a per-tool policy in the engine to re-tune on each upstream release. Not configurable, because a per-skill or per-repo threshold would make two runs of one tool incomparable in the ledger, which §10 exists to prevent.

**Rows 12 and 12b read the unsuppressed findings only, and row 12c is what a fully baselined report reaches** (R4.15). The severity comparison runs over `actionableFindings(parsed.findings)` — those carrying no `suppressed` annotation — through a named helper rather than by teaching `highestSeverity` to filter, because a function called "highest severity" that quietly means "highest actionable severity" is the hidden policy this design writes comments against. Row 12b also requires `findings.length > 0`: every shipped parser derives `failed` from that length, and without the clause a future parser returning `failed` with nothing to point at would be silently downgraded.

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
      2026-08-11_14-32-07/                 ← the run's start time, not its id
        run.json                           ← where the run id is
        snapshot-pre/                    ← non-git mutation sandbox only
        journal.json                     ← mutation apply journal
        01-validate/
          stage.json                     ← written once, after all tools
          skill-lint/    stdout.log  stderr.log  <native artefacts>
        03-security/
          stage.json
          fix-prompt.md                ← only when the stage produced a finding
          skillspector/  stdout.log  stderr.log  findings.sarif
          skill-scanner/ stdout.log  stderr.log  findings.sarif
        evidence/                        ← release stage only
      latest -> 2026-08-11_14-32-07
      index.ndjson
```

Each tool owns a directory, so two scanners emitting `findings.sarif` cannot collide, and `tool_runs.artefact_dir` identifies exactly one tool's evidence. `stage.json` is written once, after every tool in the stage has finished, and references each tool directory by name.

**The directory name and the run id answer different questions.** The name is the run's start time, because a maintainer identifies a run by `ls` and a UUID names no moment. The id is a UUIDv7 recorded in `run.json`, and it stays the identity everywhere it already was: `runs.id` in the ledger, `index.ndjson`, the `--run` selector, and every "which run is later" comparison. Nothing was moved onto the timestamp, and that is the point — a name at one-second precision ties, a UUIDv7 cannot.

**The split reaches the screen too, and only the screen.** Every surface that names a run to a user names its directory (R6.1): the issue detail's last sighting, the Dashboard's run history, the log pane's path. Each of them takes the name the run *recorded* — `basename(runs.sidecar_path)` for a ledger reader, `IndexEntry.dir` for a sidecar reader — rather than formatting `started_at` through `runDirName` again, because the rebuild cannot know about a `-2` a collision added and reads the instant in the reader's zone rather than the writer's. Nothing about ordering, joining or selecting moves: a query that names a run by its directory still orders on `runs.id`. The Dashboard's history row is the case that shows why both are projected — it is sorted by the id and labelled by the name, and two runs claimed in one second differ only in the first.

Uniqueness is *claimed*, not asserted: the directory is created with exclusive `mkdir`, and a collision retries the **name** as `<base>-2`, `<base>-3`. Retrying the id would be no help, because two runs started in the same second derive the same name from the clock; waiting for the next second instead would stall a run start on a tick. The claim loop is `claimDirIn`, shared with retirement (§13), so the two groups one recovery scan walks are named and claimed the same way.

Because the name is no longer derivable from the id, the index carries it: each record holds `dir` alongside `runId`, and a record without one is read as a run whose directory is named by its id — the rule that held when such records were written. Recovery needs no equivalent: `scanSandboxRecords` enumerates the real directories and returns each with its record, so it never reconstructs a path at all.

### 9.1 Index durability

`index.ndjson` is one JSON object per line — `{ runId, dir, outcome, endedAt }`, `dir` absent on records written before the directory name was recorded. Each record is serialised with its terminating newline and written in a **single** `write()` to a descriptor opened `O_APPEND`, followed by `fsync`, under the per-skill lock. That is the strongest guarantee POSIX offers, and it is not a guarantee of atomicity: a process or power failure can still leave a partial final line. Revision 2 claimed append placement made truncation land on a line boundary, which is not true.

The recovery rule is therefore on the reader, where it belongs. A reader parses line by line and, on a final line that is truncated or invalid JSON, discards it and treats the file as ending at the last newline. An appender that finds the file not ending in a newline writes a leading newline before its record, so one lost record never corrupts the next. A record is a run summary that the run directory already holds in full, so a lost tail line costs an index entry, never evidence.

### 9.2 `latest` and locking

`latest` names the finalised run with the **greatest run id**, and its symlink body is that run's directory. UUIDv7 is time-ordered by claim, so this is one stable field, independent of finish order and of lock acquisition order. Two runs that start in one order and finish in the other therefore agree on `latest` — revision 2 called it deterministic without defining "later", which left exactly that case open. Ordering on the directory name instead would reopen it for the pair that starts in one second. It is rewritten under the per-skill lock via temp-file-and-rename.

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

### 9.4a Optimise prompt

*Satisfies R6.12.*

The second coding-agent prompt composed from run evidence, and it lives in `stages` beside `fix-prompt.ts` even though optimise is no longer a stage: one module composing both is what keeps their shared rules — name the report rather than restate it, omit and count suppressed findings, forbid workspace writes — from becoming two divergent copies.

**Its trigger is a user action, not a run**, so unlike §9.4 there is no file. The prompt is emitted to stdout headlessly and copied through OSC 52 in the terminal; nothing is written anywhere, which is the constraint R11.10 and R12.6 already share and for their reason. That is also why it returns a string always rather than §9.4's nullable: the trigger is a keystroke rather than a findings count, and a refusal is a flash rather than an absent document.

The body names the skill directory, the repo root, the declared version, the commit and dirty flag and the skill digest; the newest recorded run's per-stage outcomes; **the absolute path of each tool's own report rather than a restatement of it**, §9.4's rule and for its reason, `RawFinding` being a closed six-field record; the eval assets found under `<skill>/evals/`; the managed interpreter, the SkillHone location and its sha; the handoff to the top-level `skillhone` skill, which dispatches to its own sub-skills; and the constraints — no write under `*-workspace/` or `.skillgantry-workspace/`, plus upstream's own notice that some of its workflows use bypass mode and local subprocess execution. A missing dependency and a missing `claude` CLI are named **before** the task, so a prompt is never handed over describing a loop that cannot start: that failure otherwise surfaces inside the agent's session rather than in the terminal that produced it. Absent evidence is stated rather than omitted — a section that vanishes reads as a builder that failed.

**Suppressed findings are omitted and counted**, R6.11's rule reused verbatim and for its reason. **It is built from `input.skill`, never `ctx.skill`**, §9.4's rule: there is no run in flight here, but the prompt still names where an agent should edit, and a sandbox path does not survive to be edited. Its install argument is plain fields rather than a type imported from `tools`, so the builder adds no §3 edge — the property §9.4 records as the reason `fix-prompt.ts` lives in `stages` at all. `src/cli/gantry-views.ts` reads the lock and flattens it, which is where the ledger and the process table are already reachable.

### 9.4b Eval bootstrap prompt

*Satisfies R6.13.*

The third coding-agent prompt, and the first composed from the skill's tree rather than from run evidence — because the state it addresses is one where no run can produce evidence. skill-up cannot run without `evals/eval.yaml`, most skills carry none, and the evaluate gate answers that with `errored`/`missing-artefact` and no next step.

**A prompt is the only shape available, not the preferred one.** `skill-up init` writes user configuration — OTLP defaults, `runtime_kwargs` — and scaffolds no suite. The documented flow is copying skill-upper's `assets/eval.yaml.tmpl` and `assets/case.yaml.tmpl` into the skill and rewriting them, which is a judgement about what the skill claims to do. There is no CLI path SkillGantry could drive, so §9.4a's handoff is what remains.

It lives in `stages` beside `fix-prompt.ts` and `optimise-prompt.ts` for §9.4a's stated reason: one module composing all three keeps the rules they share — name the report rather than restate it, forbid workspace writes, name a missing dependency before the task — from becoming three divergent copies. It returns a string always, §9.4a's rule, the trigger being a keystroke rather than a findings count. Its install argument is plain fields rather than a type imported from `tools`, so it adds no §3 edge — the property §9.4 records as the reason `fix-prompt.ts` lives here at all.

**Four constraints in the body are load-bearing, and each says why it is fixed.** The suite's path, because the adapter's argv is `run {skillDir}/evals/eval.yaml …` and a suite anywhere else is invisible to the gate. The case layout, because a failing case is filed as an issue pathed at `<skillRelPath>/evals/cases/<case_id>.yaml`, so cases stored elsewhere yield an issue naming a file that does not exist. `--format json`, because the `v1alpha1` report is what §7.2's shared parser reads. And `rule_based` over `agent_judge` wherever a behaviour admits it, because the suite runs on every evaluate gate and an LLM judge makes every gate a billed, non-deterministic call. Two more repeat rules the other prompts already carry: no write under `*-workspace/` or `.skillgantry-workspace/`, and no edit to anything the skill ships — adding evals is not fixing a skill, and a skill fix is §9.4's prompt.

**The invocation and the artefact name are read from the manifest**, §9.4's rule and for its reason, so a pin bump moves the prompt with it rather than leaving a hand-written argv line describing the previous release.

**Credentials are named as keys, never as values** (R7.3). skill-upper's own step 5 reads `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `QODER_PERSONAL_ACCESS_TOKEN`, or `~/.skill-up/credentials.yaml`, and stops to ask rather than writing a secret into YAML — which is the correct behaviour, so the prompt names which key is wanted and leaves the asking where it is. The engine is the skill's own declaration (`engine: { name: claude_code }` in every reference suite) authenticated by that CLI, which is why §5.3's `claude-cli-missing` probe is a fact this prompt can name.

**No "after" section.** Adding `evals/` moves the skill digest, so R9.9 refuses a release against gates recorded before it. That is a fact about SkillGantry and belongs on a SkillGantry surface, not in a document handed to an agent working in the user's repo.

**Nothing is written.** Unlike §9.4 there is no file, §9.4a's rule: the body goes to stdout headlessly and through OSC 52 in the terminal, and the pipeline stays the only writer under `runs/` — R11.10's and R12.6's shared constraint.

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
     provenance_fp,              -- R7.6 grouping key, indexed (§10.7)
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

**Why not "the most recent detector".** Closing on the tool that owned the most recent detection made completion or insertion order decide ownership, and fan-out tools run concurrently: if the scanner that won passed without the finding while the other errored the issue closed, and had they finished the other way round it survived. Identical runs could disagree. Modelling absence per detecting tool removes ordering entirely — closure is a conjunction over a set, and a set has no order.

The conservative direction is deliberate. An issue two scanners found closes only when both have since run conclusively without it, and one scanner erroring or being deselected holds it open — the same fail-safe, applied per tool rather than to one arbitrarily chosen tool.

**Scope is widened at runtime.** A `manifest.detects` that is too narrow would otherwise mean an issue can never close, the tool not considering its own past finding in scope. Scope is `detects` unioned with every rule class this tool has actually produced for this skill, which covers unmapped classes and a mapped class the manifest forgot alike. `detects` stays useful for presets and the wizard; it is not load-bearing for correctness.

Tool runs with outcome `errored` or `skipped` contribute nothing to any phase, per §8.1. That is also why the suppression writes live here rather than in `record.ts`, which iterates every tool run including the errored ones: this loop has already `continue`d past them, so the fail-safe extends to suppression for free, and an errored or skipped run leaves both columns exactly as the last conclusive run left them.

**Why a suppressed finding is *reported*, not absent.** It joins `reported`, and that is the whole safety property. Recorded as an absence instead, `last_absent_run` would advance, every detector would agree the issue was gone, and phase 2 would set `state = 'fixed'` — the detections and the first-seen run would survive, but the issue would read fixed while not being fixed, and one the user had *acknowledged* would be silently closed by `stateOnAbsence`. Phase 2 does not read the new columns at all: a suppressed sighting blocks closure by advancing `last_seen_run` and by nothing else. Suppression never writes `state`.

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
| run history | `runHistory` | `runs` newest first by run id, each labelled `basename(sidecar_path)` |

`dashboard()` composes all five plus the three counts a header needs. Medians
and the metric sums are computed in TypeScript: SQLite has no median, and
summing JSON in SQL would put the metric key set in two places.

**A row that names a run carries both handles** (R6.1, §9). `IssueRow` projects `lastSeenRun` and `lastSeenRunDir`, `RunHistoryRow` projects `runId` and `runDir`; the first is what everything joins and orders on, the second is what a screen prints. `listIssues` reaches the directory through a **left** join onto `runs` — an inner one would drop an issue whose run row is gone off the audit surface, which is the one place R8.15 says a row must never disappear from — so the pair degrades to a sighting with no name rather than to no sighting. No column was added for it: `runs.sidecar_path` is the claimed directory, written verbatim by the pipeline.

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
  /** A promise, because the id is claimed by exclusive `mkdir` (§9) after run() returns. */
  runId: Promise<string>
  events: AsyncIterable<RunEvent>
  resolveMutation(requestId: string, action: 'apply' | 'discard'): void
  /** Resolves once the run has finalised, so cancellation cannot outrun §5.13's evidence. */
  cancel(reason?: string): Promise<void>
  done: Promise<RunSummary>
}

interface QueueHandle {
  enqueue(jobs: JobSpec[]): string[]          // job ids
  snapshot(): QueueSnapshot                   // queued, running, completed
  cancelJob(jobId: string): Promise<void>
  /** R5.12 routed by job: a frontend knows its job id, and the run id only appears on the stream. */
  resolveMutation(jobId: string, requestId: string, action: 'apply' | 'discard'): void
  events: AsyncIterable<QueueEvent>
  idle(): Promise<void>                       // resolves when nothing is queued or running
  close(): void
}

type QueueEvent =
  | { type: 'job:queued' | 'job:started' | 'job:done' | 'job:failed' | 'job:cancelled'
      job: JobRecord }
  /** Every run event, tagged, so one stream drives one store. */
  | { type: 'run:event'; jobId: string; event: RunEvent }
```

### 11.2 Events

```
run:start        { runId, skillId, stages, runDir }
stage:start      { runId, stage, toolIds }
tool:start       { runId, stage, toolId }
tool:output      { runId, stage, toolId, stream, chunk }
tool:done        { runId, stage, toolId, result: ToolRunRecord }
stage:done       { runId, stage, outcome, result: StageResult }
mutation:pending { runId, stage, requestId, diff, scope }
mutation:resolved{ runId, stage, requestId, action }
run:done         { runId, outcome, opened, closed, reopened }
run:cancelled    { runId, phase, reason }
run:error        { runId, message }
```

`stage:done` and `tool:done` carry the whole record rather than a projection of it: `verdict`, the finding count and the artefact directory are all fields a frontend needs, and each one hoisted into the payload is a contract change the day a fifth is wanted. §14.6's per-finding stage and tool attribution costs no event change for exactly that reason. `run:done` carries the issue delta as three flat counts, which is what `RunSummary` holds.

`mutation:pending` carries a `requestId` that `resolveMutation` correlates against. A pending mutation that is never resolved times out after `mutationTimeoutMs` and discards. `run:error` is the terminal event for a run that threw before it could finalise; every other failure is carried as an outcome.

### 11.3 Sequence

1. `queue` worker takes the job and calls `pipeline.run()`. Read-only runs against one skill proceed in parallel; only finalisation is serialised, per §9.2
2. `workspace.claimRun()` → exclusive `mkdir` on a directory named for the start time
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

**Where startup is.** `src/cli/` scans registered workspaces on every launch — before the Work screen, before a headless run — for records still in `state: active`, and prints one line per unresolved record naming `skillgantry recover`, which offers restore from `snapshotDir`. It does not block the launch: an old marker the user has decided to leave alone must not make the tool unusable. What does block is a *new* mutating run against a skill that holds an unresolved record, which refuses, because applying a second mutation over an unrecovered first is how a compensating rollback stops being able to compensate. The git strategy writes the same record; its recovery is cheaper, since the working tree was never touched and recovery is a worktree prune.

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

Everything is built and proven inside the sandbox, and the user's tree is touched once, at the end, when nothing is left that can fail on its own merits. The order it replaced — apply, then package, then verify — made a packaging or installability failure undo a change already live in the user's repo, and left the archive, a required output under R9.4, in neither the mutation scope nor the journal, so an aborted release could leave a zip behind while claiming to have rolled back.

```
validate-preconditions → resolve-target-version → stage-candidate-edits
  → package-in-sandbox → verify-install → build-change-set → preview-diff
  → await-confirmation → recheck-preimages → apply → record-evidence → done

any state before apply → abort  (discard the sandbox; nothing to compensate)
apply or later         → abort  (compensating rollback via the journal)
```

**Preconditions.** The skill is not deprecated, per the authority rule in §13. The most recent validate, evaluate and security stage outcomes are all `passed`. Each of those runs' `skill_digest` equals the candidate's current digest — the R9.9 binding that stops evidence from an older state authorising a newer release. When `versions.json` exists, its entry and the frontmatter version already agree.

"Most recent" means most recent *verdict* (R9.8). `latestGateOutcomes` steps over a stage whose outcome is `errored` or `skipped` — §8.2's two `ran == 0` cases, where not one tool in the stage spoke about the skill — and reports the last run of that stage that did reach one, or nothing if there is none. `degraded` is not stepped over: some of its tools ran, and one of them may have failed. This is §8.1's fail-safe applied one layer up. That section keeps the same rows out of reconciliation so a crashed or absent scanner cannot close everything it once found; without the rule here, a cancelled re-run *created* a refusal instead, superseding the pass it never contradicted. A user who ran all three gates to green at 08:30, cancelled an evaluate re-run 22 seconds in at 08:41, and released four times over the next 20 minutes was refused `evaluate last reported errored` every time, against bytes a completed gate had already cleared (runs `019fe59f` through `019fe5c3`). R9.9 is what makes stepping over safe rather than lax: the outcome carries the digest it was recorded against, so once the bytes move the last verdict is against the old ones and the digest check refuses.

A fully suppressed security stage reports `passed` (§8.1 row 12c), so these preconditions permit the release, and a baseline is a gate override in effect. That is intended, and R9.9 stops it being a retroactive one: the baseline file is inside the candidate manifest, so writing or editing it moves the digest, and the binding above refuses a release whose passing gates were recorded against the bytes from before. You cannot baseline past a gate that has already passed, only baseline and re-run the gates. The audit trail is threefold: the SARIF `suppressions` annotation on disk, `issue_detectors.suppressed_reason` in the ledger, and the baseline file inside the archive the consumer receives.

**Target version.** Supplied explicitly as a semver, or as a bump level (`major` / `minor` / `patch`) applied to the current frontmatter version. Never inferred silently.

**Stage-candidate-edits.** Inside the sandbox: `SKILL.md` frontmatter version, `CHANGELOG.md` section prepended, and `versions.json` when it exists. Manifest handling is unchanged — when no repo-root `versions.json` exists, the case for all 54 skills in `~/.claude/skills`, release updates only `SKILL.md` and records `"manifest": "none"`. SkillGantry never creates one.

**Package-in-sandbox.** The archive is built from `candidateManifest()` over the **sandbox** skill directory, so its contents are exactly the digested set: no workspace, no `.git/`, no earlier release archive, and not the archive being written, since it is produced outside the candidate root and only moved into place at apply. It goes to `<run>/staging/<skillName>_<version>.zip`, with its SHA-256 recorded.

**Verify-install.** The staged archive is extracted into a second temporary directory, and vercel `skills` is invoked **against that extracted local directory** in copy mode, non-interactively, with an isolated destination. Installing the zip itself is not executable as written: the tool documents git sources and local directories, not archives. Extract-then-install-directory works either way and verifies the same bytes the consumer will receive. Failure aborts, and since nothing has been applied, abort is a sandbox discard.

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

The two are §8.1's rows 3b and 3c, and they call for opposite recovery — see §8.1, which states the failure once.

A refusal is `failed` with no `error_kind`, because the gate ran and understood the skill — the same distinction §8.1's governing rule draws between a verdict and an error. A tool run with no adapter touches no issue: `reconcile.ts` tolerates a tool it has no rule-class map for, so this `skills` tool run never enters reconciliation.

Git commit and tag are offered as a separate confirmed action after `done`. `apply()` never commits.

### 12.5 The narrow write path

*Satisfies R8.16, R10.12.*

`src/core/suppress/` writes one file the user's repo can see: the suppression baseline §7's manifest declares. It is the third and last thing in SkillGantry that writes outside the sidecar, and it does not use §12.1–§12.3.

```
read live bytes, or take `scaffold` when absent   → preimage: sha256, null when absent
parse through yaml's Document API                 → comments and key order survive
refuse a non-mapping document, or a `collection` that is not a sequence
append the entry; never touch `version`
stop if an identical entry is already present
write <candidateRoot>/.skillgantry-write.tmp, fsync
unifiedDiffFor(live, tmp, label)                  → the same renderer both sandboxes use
await authorisation                               → the pane, or --yes
re-hash live against the preimage                 → abort naming the path on any mismatch
rename tmp over the target, fsync the directory
```

**What is omitted, and why each.** §12's machinery answers problems this write does not have. The sandbox exists because a *tool* writes the live tree over minutes across many paths; here SkillGantry composes one file's bytes itself. The journal exists because POSIX has no multi-file atomic write, and one rename is atomic, so there is no partial state to compensate. The active-sandbox record covers a crash during tool execution or while awaiting approval, and nothing is modified until the rename fires. The dirty-skill guard is the odd one out: it exists because a worktree starts at HEAD and would hide uncommitted work, and there is no worktree — the append merges into the user's current bytes by construction.

**What is kept, and why each.** The diff before the write, because that is the standing rule for every byte SkillGantry puts in a user's repo. The preimage recheck, because the window between preview and confirm is exactly R10.11's window and widens with however long the user reads. The atomic rename, because a half-written baseline is one the tool exits 2 on. And the abort covers absent-became-present too: a preimage of `null` that finds a file at recheck means someone created the baseline while the diff sat on screen.

**`{skillDir}` resolves live here, deliberately unlike §7's conditional-argv stat**, which resolves against the tool-facing path. A repo-root skill's tool reads a materialised candidate copy (§4.4), so a write resolved the tool's way would land in a temp directory and be discarded with it. Same token, opposite answer, and it carries a comment in the code because it reads as a bug otherwise.

**The temp file is in the candidate root, and §4.4 excludes it.** Same-directory rename is the only portable atomic recipe, and reusing one staged file for both the diff and the write means the bytes reviewed are the bytes renamed rather than a second render that could differ. Release solved the same problem the same way for `<skillName>_*.zip`.

**`version` is never touched.** A legacy v1 rule-only baseline stays v1. skillspector loads it with a warning; bumping it to 2 retroactively applies the non-empty-reason rule to rules the user wrote before that rule existed, and can turn a loadable file into an unloadable one.

**The identical-entry stop.** Without it, accepting one finding twice stacks duplicate rules in the user's repo and nothing downstream would notice.

**The ledger is not written here** (R8.16). R8.15 keeps the file the authority and the suppression columns a derived cache recomputed on conclusive tool runs, so the `⊘` mark appears only after the re-run — which is why §14.7's confirmation says so, and why an acceptance offers to enqueue the gates it invalidated rather than leaving the user to discover R9.9's refusal later.

## 13. Retirement

*Satisfies R1.4, R1.6.*

Retirement writes `metadata.deprecated: true` into `SKILL.md` frontmatter through the ordinary mutation path of declared scope, diff preview, confirmation and journal, and mirrors `lifecycle_state`, `deprecated_at` and an optional `superseded_by` into the `skills` row. Gates still run against a deprecated skill; it simply cannot be released. Reversal clears the same fields by the same route.

**`SKILL.md` frontmatter is authoritative. The ledger columns are a derived cache.** Two writes across a file mutation and a separate SQLite transaction cannot be made atomic, so revision 2's arrangement left it undefined which copy release should believe after a crash between them. Naming an authority makes the question unanswerable rather than merely answered:

- Discovery reads `metadata.deprecated` from frontmatter and reconciles the `skills` row to it on every scan, so a stale ledger self-heals on the next discovery rather than needing recovery.
- Release preconditions read the **frontmatter of the release candidate**, never the ledger, so a lagging cache can neither block a legitimate release nor permit a forbidden one.
- Reversal is one file write; the ledger follows on discovery.
- A mismatch is not an error state. It is reported in `doctor` as `lifecycle-drift` and resolved by reconciling to the file.

**Invocation.** `skillgantry retire <skill> [--undo] [--superseded-by <id>] [--yes] [--json] [--allow-dirty]`. Retirement is not one of the five stages, so it does not run through the pipeline; it runs the same declared-scope, diff-preview, confirmation and journal path directly, with its sandbox and journal under `<workspacePath>/skillgantry/retire/<dir>/`, named and claimed the way a run directory is (§9). That directory shape is deliberate: startup recovery scans for `sandbox.json` under the workspace, so an interrupted retirement is recovered by the same code as an interrupted release, with no special case.

The cache still earns its place: the Issues and Dashboard screens filter deprecated skills across every registered repo without reading 76 files.

## 14. Terminal interface

Specified in [design_tui.md](design_tui.md), which holds §14 through §14.6 under their own numbers: the store and render discipline, the responsive layout and its row budget, Settings, the fix-prompt copy, the queue's progress reporting, run rehydration and the Work screen overhaul. It is a separate file because it is a fifth of this document and no engine change reads it.

## 15. Headless interface

*Satisfies R12.1–R12.4, R12.5a, R12.5b, R12.6, R12.7, R12.8, R12.9, R12.10.*

```
skillgantry run <skill> --stage validate,evaluate,security [--json] [--yes]
skillgantry doctor [--json] [--migrate-rule-map]
skillgantry setup
skillgantry release <skill> --version <semver|major|minor|patch>
                            [--yes] [--json] [--allow-dirty] [--notes <text>]
skillgantry retire <skill> [--undo] [--superseded-by <id>]
                           [--yes] [--json] [--allow-dirty]
skillgantry recover [--restore <runId>] [--forget <runId>] [--json]
skillgantry fix <skill> [--stage <stage>] [--run <id-or-dir>] [--json]
skillgantry suppress <skill> --tool <id> --rule <nativeRuleId> --path <skillRelPath>
                             --reason <text> [--yes] [--json]
skillgantry suppress <skill> --fingerprint <fp> --reason <text> [--yes] [--json]
skillgantry optimise <skill> [--json]
skillgantry evals <skill> [--json]
skillgantry upgrade [--yes] [--json] [--check]
skillgantry [--concurrency <n>]                    # no subcommand: the TUI
```

A skill is named by `<repoId>/<name>`, by a bare name when that is unambiguous, or by the `name` its frontmatter declares — which is what a repo-root skill is usually called, since its id comes from the directory. There is no `--repo` filter; the selector already disambiguates.

`--concurrency` belongs to the root action alone, because it sizes the worker pool for a session and a headless `run` executes one skill. Root `--version` and `release --version` are distinct options on distinct commands; commander only keeps them apart under `enablePositionalOptions`, without which the root swallows the argument before the subcommand is reached.

Consumes the same event stream, rendering line output or newline-delimited JSON. Exits non-zero when any executed stage outcome is not `passed`. Mutating stages are skipped without `--yes`; with it, the diff is emitted before the write.

Every launch, headless or not, first scans for an unresolved mutation record and prints one `warning:` line per record naming `skillgantry recover` (§12.2). It never blocks the launch.

`fix` prints the §9.4 prompt for a recorded run. Its default output is the body alone, so `skillgantry fix declawed --stage security | pbcopy` works; `--json` prints one document rather than `run`'s ndjson, since there is no event stream to follow. With no `--stage` and exactly one stage carrying a prompt it prints that one, and with more than one it lists `<stage>  <path>` and refuses — the same shape the skill selector uses for an ambiguous name.

**Its exit code answers "is there a prompt on stdout", not "did the skill pass"** — `0` when one was produced, `1` when the run resolved and nothing in scope carried a finding. This is a deliberate divergence from R12.2's meaning for `run`: reusing that meaning would make a clean skill and a failed lookup indistinguishable. An unknown skill, run id or stage rejects and reaches the top-level handler like every other command's errors.

**Suppression reaches the headless surface additively.** `run --json` carries `ToolRunRecord` on `tool:done`, so each suppressed finding gains one optional key: no new event, no version bump. `RunDelta` is deliberately not extended — a `suppressed` counter would keep six files in step for a number the stage summary already puts on the rail and the Issues screen answers afterwards. `fix` gains one exit case: a run whose findings are all suppressed exits `1` saying so rather than `0` with an empty table, and `--json` reports `findings` (actionable) and `suppressed` as siblings.

`suppress` writes one rule into the tool's own baseline through §12.5 (R12.7). It takes either an explicit `--tool`/`--rule`/`--path` triple or a `--fingerprint` it resolves against the ledger the way the Issues screen does. `--yes` is prior authorisation with the diff emitted to output immediately before the write, R12.4's rule for every mutating headless path; without it the diff prints, nothing is written, and the exit is non-zero. **Its exit code reports whether a suppression was written, never whether the skill passes** — `fix`'s precedent, for its reason: reusing R12.2's meaning would make a clean skill indistinguishable from a failed lookup. Distinct non-zero codes separate the cases a script would act on differently: a bad request, no detecting tool declaring a baseline, an entry already present, and authorisation withheld.

`optimise` prints the §9.4a prompt for a named skill (R12.8). Its default output is the body alone, so `skillgantry optimise declawed | pbcopy` works, and `--json` prints one document carrying the body beside the missing-dependency list. It takes no run id and no stage, unlike `fix`: the prompt is about the skill's current state rather than about one recorded stage, and it resolves the newest run itself. **Its exit code answers "is there a prompt on stdout"** — `fix`'s divergence from R12.2, for its reason — so an uninstalled SkillHone exits non-zero naming the tool and the command that installs it, while a skill with no recorded run still exits `0` with a prompt that says so. It writes not one byte, which is R11.10's and R12.6's shared constraint: the pipeline stays the only writer under `runs/`.

`evals` prints the §9.4b prompt for a named skill (R12.9). `optimise`'s shape and its reasons throughout: the body alone by default so `skillgantry evals declawed | pbcopy` works, one document under `--json`, no run id and no stage because the prompt is about the skill's current tree, and an exit code answering "is there a prompt on stdout" — so an unlocked skill-up or an unreachable skill-upper exits non-zero naming the tool and `skillgantry setup`, while a skill that already carries a suite exits `0` with a prompt for extending it. It writes not one byte, to the repo or to the sidecar.

There is no `--then-run`, unlike §14.7's toggle. The shell composes `suppress && run`, and duplicating stage selection into a second command is how the two come to disagree.

**It resolves the run from the sidecar, not the ledger.** The default is the greatest run id in `index.ndjson` — not the `latest` symlink, which is absent mid-write, and not `runs.sidecar_path`, because R8.2 makes the sidecar the evidence, the command already names its skill so no cross-skill query is needed, and a run whose ledger row failed still has complete evidence on disk. `--run` accepts either the run id or the directory name, matching the id first: the directory is the handle a maintainer can see in `ls`, the id is the one `run.json` and the ledger record, and matching the id first means a directory named like an id cannot make the argument ambiguous. When the prompt file is absent but that stage's `stage.json` carries findings, `fix` rebuilds it in memory and marks it `onDisk: false`; it never writes, so the pipeline stays the only writer and runs recorded before §9.4 existed are answerable without rewriting their evidence.

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
| `isolation` | Git and non-git fixtures over all five change kinds, dirty-override seeding, a user edit between preview and apply, and an incomplete journal replay — unit level, against a fabricated `sandbox.json` (`tests/core/isolation-*.test.ts`). The two crash cases, during the mutating tool and while awaiting approval, run for real in a second process (`tests/acceptance/m5.test.ts`), because a fabricated record cannot prove startup recovery finds a marker nothing wrote on purpose | Change sets complete; compensating rollback works; `sandbox.json` drives startup restore; `preimage-drift` aborts |
| Release | Git and non-git transactions through `skillgantry release` itself (`tests/acceptance/m5.test.ts`): dirty guard and override, preimage drift, digest-mismatch refusal, the no-manifest path, packaging and installability failure, a deprecated skill, and the release tool run reconciling no issue. Crash recovery is the `isolation` row's, since `openSandbox` is the same call either stage makes | The one stage that writes to the user's repo; a failed gate leaves no repo-root archive and no live file change |
| Mutation preflight | `git`, `zip`, `unzip` absent one at a time | A missing command fails before `sandbox.json` is written, naming the command |
| Concurrency | Two runs finalising one skill simultaneously, including inverse start/finish order; a truncated final index line; a lock whose holder died | No lost index line, `latest` by greatest run id, no run-id collision, no permanently held lock |
| `discovery` | Fixture trees with the `*-workspace/` snapshot trap, a repo-root skill, and a symlinked repo path | R2.3, R2.4, §4.1 canonicalisation |
| Candidate manifest | A skill directory legitimately named `snapshot-pre/`; an internal symlink; a symlink escaping the candidate root; a prior release archive at the candidate root | Only exact owned paths excluded; links hashed not followed; escape rejected — §4.4 |
| Repo-root skill | Discovery → read-only stage → snapshot → rollback → gitignore check, with a **canary secret planted in a prior native artefact** | Neither a fixture scanner nor the archive can observe the canary; no recursive copy — §4.4 |
| Packaging | `npm pack`, install into a clean prefix, invoke `--version` | R13.5 |
| Local install | `scripts/install-cli.sh` over an overridden `SG_HOME`/`SG_BIN_DIR`, run twice | Linked binary answers `--version`, resolves inside the overridden home, survives a re-run, and leaves the user's own `~/.local/bin` link untouched — §2 |
| `tui` | `tests/helpers/render-ink.tsx`, a fake TTY at `debug: true`, for what can only be read off a frame; every pure decision — `layoutFor`, `rows.ts`, the reducer, `osc52` — asserted directly instead | The row budget, the tier boundaries and the key routing are arithmetic, and arithmetic asserted through a renderer breaks when the chrome moves |
| Statistics queries | In-memory SQLite, runs recorded across two repos; each R8.9 clause per skill, per repo and unfiltered; the same set filtered by provenance fingerprint | R8.9 is answerable at all, and R7.6 splits the numbers rather than reordering them |
| Issue queries and user transitions | `listIssues` across two repos with each filter; every row of §10.5's user-action rows; `blockedBy` against a two-detector issue where one has reported absence | Triage cannot invent a transition the state machine forbids; the blocking detector is the one `reconcile` would close on |
| Traceability | `tests/specs/traceability.test.ts` parses both documents | R13.7: a requirement owned twice, owned never, claimed by no section, or claimed and absent fails the build |
| Screen row budget | Every screen rendered at 80×24 and 50×14 | §14.1's first rule, on every full-screen view including help and the inline wizard |
| Config transforms | `withRepo`, `withoutRepo`, `withStageTools`, `withScalar` and `configChanges` as pure functions; id uniqueness and duplicate rejection asserted against `registerRepo`'s own result | The staged path and the live path cannot disagree about what a valid config is — §14.2 |
| `buildFixPrompt` | Pure, over a fixture `StageResult` modelled on the motivating run — two `medium` findings from one scanner | Every mandated element present; null for a zero-finding result; non-null for a §8.1 sub-floor `passed` stage; a `\|` in a message does not break the table; no Commit row for a non-git repo — R6.10 |
| Fix-prompt trigger | Through `pipeline/run.ts` with fake executors | A zero-finding stage writes no file; a one-finding stage writes exactly one beside `stage.json`; the sandbox-open-failure path writes none; a §8.1 row-3b abort whose tools had reported findings still writes one; the prompt names the real skill dir, not the materialised candidate |
| `skillgantry fix` | `buildProgram` with a collecting writer over a fabricated sidecar, plus one run in a second process | Default picks the greatest run id; `--run` and `--stage` restrict; two prompted stages list rather than concatenate; a clean run exits 1 saying why; `--json` is one document; a missing file with findings regenerates marked `onDisk: false`; **the sidecar is byte-identical afterwards**; the exit-code contract survives the process boundary — R12.6 |
| `y` and OSC 52 | `renderInk` with a fake queue and a real temp prompt file; `osc52` asserted as pure bytes | The frame carries the base64 of the file's bytes; the StatusBar shows the path; the frame's row count is unchanged by the keypress; each unavailable case names its reason and emits no escape; UTF-8 round-trips and an oversized body returns null — R11.9 |
| SARIF suppressions | Hand-built documents plus a golden fixture captured with `--baseline` pointed at the reference repo's own `declawed/.skillspector-baseline.yaml` | An empty `suppressions` array and an absent one are both unsuppressed; `rejected` and `underReview` do not suppress and an absent `status` does; a missing justification yields `''`; `findingsTotal` and `outcome` are unchanged by suppression; a diff against the unbaselined capture leaves only `result.suppressions` and the nondeterministic `properties.findingId`, so upstream moving anything else fails the suite — R4.15 |
| Conditional argv | Fake tool through `AdapterStageExecutor.execute` | Absent file → no flag; present → the flag carrying the **substituted** path; a directory at that path does not fire it; against a re-rooted `ctx.skill.dir` the flag names the materialised candidate — R4.14 |
| Suppression classification | `classifyToolRun` over parsed results | Every at-or-above-floor finding suppressed → `passed` with all findings retained; suppressed `high` + live `low` → `passed` via row 12b; suppressed `low` + live `high` → `failed`; a parser returning `failed` with zero findings is still `failed` — §8.1 rows 12, 12b, 12c |
| Suppression cache | In-memory SQLite through `recordRun` and `reconcile` | A suppressed fingerprint joins `reported`, advances `last_seen_run`, closes nothing and writes no `state`; the next unsuppressed sighting nulls both columns with the history intact; two fan-out detectors with one suppressing leave the issue unsuppressed in either finish order; a detector that says gone has no vote; one of two occurrences suppressed does not suppress; `errored` and `skipped` runs leave both columns untouched; a v4 database migrates with no backfill — R8.15 |
| Settings edit | Origin labels over a config with absent keys and a `--concurrency` override; a staged edit with no write; a schema-invalid value refused; discard leaving the file byte-identical; apply writing once and re-reading; the credential rows offering no edit | R11.7 and R11.8, without a terminal |
| Focus zones | The reducer's cycle, then each movement and marking key driven through `renderInk` from each zone | Exactly three zones in screen order; the horizontal pair leaves the rail alone from the skill list; `space` marks a skill in one zone and a stage in the next; `x` acts only on the queue — R11.11 |
| Overview tiers | `layoutFor` and `overviewRows` as pure functions across the whole size range, plus one render at 80×24 and 50×14 | The chosen tier leaves `SKILL_LIST_MIN` rows in the list and returns exactly the rows it gives up; no card in `narrow`; the frame never exceeds the terminal. Over the function, never at a named size, so a change to what the chrome costs moves the boundary without breaking a test — R11.12 |
| Issues tab and screen | `issueRows()` driven by both surfaces; the scope cycle against `IssueFilter` | One issue renders identically in both; the three scopes resolve to the existing per-skill, per-repo and unfiltered queries; no transition key is bound on the tab, and `o` stays the Issues screen's — R11.13 |
| Finding attribution and evidence | `findingRows()` over a reducer state built from real `stage:done` events; `o` through a fake `openPath` | Stage and tool survive the event into the row; the selected finding's detail sits inside the allocation at both sizes; the report opens through the injected port, so no test spawns; `y` yields that finding's stage's prompt whatever the rail points at — R11.14, R11.9 as amended |
| Baseline declaration | The registry, over every manifest declaring one | The declared path, document, collection, scaffold and entry shape; a `conditionalArgv` whose `whenExists` equals `baseline.path`, so the file written is the file passed to the tool; the three tools with no baseline leave it undeclared — R4.16 |
| Entry substitution | `suppressionEntry`, `skillRelative` and `globEscape` as pure functions | Every token resolves and an unknown one throws; `{pathGlob}` is skill-relative and not repo-relative; `*`, `?` and `[` escape to single-member classes; a repo-root skill's path is unchanged; a sibling directory sharing the skill's name is not stripped — R4.16 |
| Document append | `appendEntries` over YAML and JSON documents | Comments and key order survive a round trip; a non-mapping document and a non-sequence collection are refused; `version` is unchanged on a v1 file; an absent file takes the scaffold; an identical entry is a no-op — §12.5 |
| Suppression write | Real fixture skills through discovery, so `dir` and `relPath` are discovery's own | Nothing is touched before apply; the staged bytes are exactly the bytes renamed; preimage drift aborts naming the path and absent-became-present aborts too; discard leaves neither file; `.skillgantry-write.tmp` is excluded from the digest — R10.12 |
| Target resolution | `previewSuppression` over multi-detector rule sets | A tool with a baseline plans a write; one without is named as uncovered only while it is still reporting; several rule ids for one tool fold into one plan; no baseline anywhere plans nothing — R11.16 |
| `skillgantry suppress` | `buildProgram` with a collecting writer | Without `--yes` the diff prints and the file is byte-identical; with it the diff precedes the write in the output; an empty reason, a baseline-less tool and an entry already present each exit non-zero with their own code; `--json` is one document — R12.7 |
| `SuppressPane` and the toggle | `renderInk` at 80×24 and 50×14, plus `resumedGates` asserted directly | The title names the tool and the file; the uncovered warning and the stale-gate line each appear only in their own case; the resolved chain is contiguous from the first non-passing gate; three passing gates resolve to empty and start the toggle on every gate; the frame's row count is unchanged — R11.16, R11.17 |
| Suppression round trip | A fake tool branching on `--baseline`, through the whole CLI (`tests/acceptance/m8.test.ts`) | The gate fails, `suppress` writes the rule, the re-run passes, the issue reads suppressed and still `open` with its history, and deleting the entry brings the finding back |
| The written rule matches | A real installed skillspector, twice over a real skill (`SG_INTEGRATION=1`) | The rule SkillGantry wrote is one the tool's own `fnmatch` matches. The acceptance tier cannot prove this: its fake tool branches on whether the flag arrived, which is a different question from whether the rule inside the file matches, and a wrong path shape loads cleanly and suppresses nothing |
| Palette and titled border | `tokens.ts` asserted as data, plus a source scan over `src/tui/**`; `Panel`'s title row measured against the box beneath it | Every token is a hex triple and no background or body foreground is set anywhere in the tree; the title row and its box agree to the cell, so no corner tears; the saved row reaches the layout budget — R11.15, §14.6 |
| Upgrade check | An injected `fetchImpl` serving a canned `releases/latest` and changelog asset | The throttle skips the request and still answers from the cache; a failed request records nothing, so it buys no silence; a decline sticks for its version and lapses for the one above it; `force` ignores both; a missing asset is `unreachable`, never a throw — R13.11 |
| Upgrade apply | A fake `Exec` standing in for npm, so every assertion is about ordering rather than about npm | A checksum mismatch and a post-install version mismatch each leave the link resolving where it did and no `versions/<new>`; the snapshot precedes the relink; retention is exactly two; the legacy flat prefix goes only after a successful relink — R13.12 |
| Upgrade eligibility | Fixture homes with a link into the versioned prefix, into the legacy one, and a development tree | Ours is adopted, a foreign tree is refused by name, and an entry point that is not a symlink is refused because there is nothing to swing — R13.10 |
| Upgrade end to end | A real `install-cli.sh`, a second `npm pack` at a bumped version served from a local `http` server, driven through the installed link (`tests/acceptance/m9.test.ts`) | The link resolves into `versions/<new>`, the binary reports the new version, the previous prefix survives and `backup/<old>/config.json` was written |
| Upgrade crash safety | The same upgrade paused inside the window before the relink and killed with `SIGKILL` (`tests/acceptance/m9.test.ts`) | The link is intact and the binary still reports the **old** version. A unit test can only fabricate this state; killing a real child is what proves the ordering — the `isolation` row's rule, applied to our own binary |

Fixture capture is a scripted, repeatable step tied to the pinned tool versions, so fixtures and pins cannot drift apart.

## 17. Traceability

*Satisfies R13.7.*

**Milestone ownership lives in exactly one place: the table in [requirements.md](requirements.md#milestone-ownership).** Revision 2 kept a second copy here, and the two drifted — R5.12 was M2 there and M5 here, while the headless mutation and subcommand requirements were M5 there and M1 here. A duplicated table is not traceability, it is two claims. This section maps requirements to design sections only; the milestone column is deliberately gone.

| Requirement group | Design section |
|---|---|
| R1.1–R1.3, R1.5 | 1, 7 (`MetricKey`) |
| R1.4, R1.6 retirement | 13 |
| R2 discovery, config, candidate, digest | 4 |
| R3 tool management | 5, 5.4 |
| R4 adapters and classification | 6, 7, 7.1, 8.1 |
| R5.1, R5.9, R5.11 | 8.2, 11.3 |
| R5.2, R5.12–R5.14, R12.4 | 11.1, 11.4, 11.5 |
| R5.3–R5.8, R5.10 queue | 11.1, 11.4 |
| R6 artefacts | 9, 9.1, 9.2, 9.4, 9.4a, 9.4b |
| R7 credentials and redaction | 9.3, 10.2 |
| R8 ledger and issues | 10 |
| R9 release | 12.4 |
| R10 mutation safety | 12.1, 12.2, 12.3, 12.5 |
| R11 terminal interface | [design_tui.md](design_tui.md) 14, 14.1, 14.2, 14.3, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 14.11 |
| R11.24 the upgrade prompt | [design_tui.md](design_tui.md) 14.14 |
| R12 headless | 15 |
| R12.10 `skillgantry upgrade` | 15 |
| R13 quality and distribution | 2, 16 |
| R13.8–R13.12 release contract, changelog, versioned prefix, check and apply | 20, 5.3, 15 |

The mapping is checkable rather than asserted: every `*Satisfies …*` label in this document is parsed by a spec test, unioned, and compared against the requirement ids in requirements.md. A requirement claimed by no section, or a section claiming a requirement that does not exist, fails the build. That is what caught §12 claiming R9.1–R9.10 while implementing R9.11, and §14 and §15 omitting R11.6 and the release subcommand.

Which modules each milestone built is not repeated here: [index.md](index.md) catalogues the plans, and each plan records what it shipped.

## 18. Change history

Every pass below is recorded in full somewhere else — the two reviews are their own documents, and each milestone's deviations are the last section of its plan. What changed is in the sections above; this table says which sections a pass touched and where its reasoning lives, so neither is restated here.

| Pass | What it settled | Record |
|---|---|---|
| Revision 2 | Twelve findings: release as a dispatchable stage (§6, §12.1), the redaction boundary (§9.3), fan-out artefact collisions (§9), the outcome model (§8), the command path (§11.1, §11.4), identity and reconciliation (§10.3–§10.5), the repo-root sidecar (§4.3), gates bound to bytes (§4.4, §12.4), the finalisation race (§9.1, §9.2), `ParseContext` bytes and the closed `MetricKey` (§7), the coverage gaps that became §4, §5, §13 and §17, and a contract test per P1 finding (§16) | [design-review-r1.md](design-review-r1.md) |
| Revision 3 | Eleven findings: the archive inside the release transaction (§12.4), a repo-root skill able to scan its own workspace (§4.4), digest omissions and symlink policy (§4.4, §4.5), the mutation recovery gaps before apply (§12.2), M1's inability to bootstrap its own tool plus `gh-release` integrity (§5.1, §5.2), SkillSpector's credential mode (§7), the tool-outcome table restored (§8.1), nondeterministic detector ownership (§10.1, §10.4), NDJSON and lock durability overstated (§9.1, §9.2), retirement with no named authority (§13), and milestone ownership leaving this document (§17) | [design-review-r2.md](design-review-r2.md) |
| M3 planning | R3.5 split into a catalogue entry and an adapter, making the catalogue the install authority and the registry the run authority (§5.1a); `{os}` and `{arch}` in `assetPattern`, since one fixed pattern cannot resolve a per-platform asset (§5.2); doctor's two reporting-but-not-failing conditions and where its inputs come from (§5.3) | [plan_m3-tools-module.md](plan_m3-tools-module.md) |
| M5 | Six amendments taken from building against it: `mutation-incomplete` as its own row, because an apply that wrote nothing and one that completed call for opposite recovery (§8.1, §12.4); the release table re-derived from the shipped branches (§12.4); `MutationSandbox` and `sandbox.json` reshaped so recovery needs no live `SkillRef` (§12.1, §12.2); §3's tool count and dependency column; §15's command list; and the journal's symlink rule (§12.3) | [plan_m5-mutation-and-release.md](plan_m5-mutation-and-release.md) |
| M6 | A generated coding-agent prompt as the deliverable for a stage that found something, rather than a fixer (§9.4, §14.3, §15); then a tool's own suppression file honoured from argv to Issues screen (§7, §8.1, §9.4, §10.1, §10.4–§10.7, §12.4, §14, §15) | [plan_m6.2-fix-prompts-for-stage-findings.md](plan_m6.2-fix-prompts-for-stage-findings.md), [plan_m6.3-respect-skillspector-baseline.md](plan_m6.3-respect-skillspector-baseline.md) |
| M7 | The Work screen overhaul (§14.6), plus the in-place corrections to §14, §14.1 and §14.3 that measuring a rendered frame forced | [plan_m7-work-screen-overhaul.md](plan_m7-work-screen-overhaul.md) |
| M8 | Writing the file M6 taught SkillGantry to read: a declared baseline on the manifest (§7), a narrow write path that keeps the diff, the preimage recheck and the atomic rename while omitting the sandbox, the journal and the crash marker with a reason each (§12.5, §4.4), and the two surfaces that reach it (§14.7, §15) | [plan_m8-suppress-finding.md](plan_m8-suppress-finding.md) |
| M7 extension | Navigation, and the surface a truncating pane cannot be: a key that moves focus to what it selects rather than acting at a distance, both arrow pairs as aliases, the Issues tab's own cursor and a tagged query response, the dashboard key on every Overview tier that renders, and a full-length view of one finding or one issue (§14.2, §14.6, §14.8) | [plan_m7.1-work-screen-navigation.md](plan_m7.1-work-screen-navigation.md) |
| M4.1 | SkillHone catalogued as a skill bundle rather than a CLI, which gave the optimise stage something behind it: the `git-skill` install kind and its three-fact verification (§5.1, §5.2, §5.3), the R6.12 prompt (§9.4a), the surface that presents it (§14.10) and the subcommand that prints it (§15); then, in revision 2, the configuration file that install left uncomposed (§5.1, §5.3, §5.4) | [plan_m4.1-skillhone-optimise.md](plan_m4.1-skillhone-optimise.md) |
| M4.2 | A way for the evaluate gate to start: skill-upper catalogued as a `git-skill` bundle with no dependencies at all (§5.1a, §5.2), doctor's report of a skill link that is not ours (§5.3), the eval bootstrap prompt (§9.4b), the pane it shares with optimise and the pre-flight that opens it (§14.11), and the subcommand that prints it (§15) | [plan_m4.2-skillup-first-eval.md](plan_m4.2-skillup-first-eval.md) |
| M9 | Distribution became a thing the product does rather than a thing the maintainer does: a release contract with two pre-publish assertions, a changelog the client reads from the release's own asset, versioned install prefixes adopted by one atomic rename, and the launch-time offer that uses them (§20, §5.3, §15, §14.14) | [plan_m9-version-check-and-upgrade.md](plan_m9-version-check-and-upgrade.md) |
| M1.1 | A run directory named for the moment it started rather than for its own id, which meant separating the name a maintainer reads from the identity everything joins on: the claim loop retrying the name, the index carrying it, recovery returning the directory it scanned instead of rebuilding one, and `--run` taking either handle (§9, §9.1, §9.2, §11.3, §13, §15); then the half that was left out — the screen, which still named a run by its id (§9, §10.3, design_tui.md §14.8) | [plan_m1.1-timestamped-run-directories.md](plan_m1.1-timestamped-run-directories.md) |
| M7.2 | Two levels in the list column, repos above the skills of one repo (design_tui.md §14.12); then the row label that undid it, a skill with no parseable frontmatter falling back to its qualified id, and the doctor condition that says why it has no name (§5.3, design_tui.md §14.12) | [plan_m7.2-repo-skill-navigation.md](plan_m7.2-repo-skill-navigation.md) |

## 19. Risks carried into implementation

Still open. Two the first draft carried are closed and gone: the adapter contract shaped by Python tooling, which M4 disproved by shipping a TypeScript and a Go tool through it unchanged, and SARIF dialect differences between the two scanners, now fixture-tested against both.

| Risk | Mitigation |
|---|---|
| Merge-first identity understates occurrence counts | `occurrence_count` and per-detection rows preserve the detail; revisit if the Issues screen proves it insufficient |
| Unredacted native artefacts under the sidecar | 0700, gitignored, `redacted: false` recorded; no tool's input can reach them (§4.4); revisit if a scanner is found to echo credentials into its own report |
| Materialising a candidate costs a copy per run for repo-root skills | Only non-self-contained candidates are copied, which is the repo-root case alone; the reference repo copies nothing |
| Static-mode SkillSpector detects less than LLM mode | Declared in `detects` and `analysisMode` and recorded in provenance; an LLM-mode adapter is a separate id, never a silent fallback |
| Conservative closure holds issues open when one scanner is unavailable | Intended: the fail-safe direction. `issue_detectors` makes the reason visible per tool, so the Issues screen can name the detector blocking closure |
| Rule-class map goes stale | Unmapped findings degrade to tool-scoped classes; migration is explicit and versioned (§10.6) |
| Ink responsiveness under sustained output | Ring buffer outside React plus fixed-interval flush; R11.4 is a measurable acceptance test |
| Upstream tools are young and will change output | Golden fixtures tied to pins with a scripted refresh; parse failure degrades to `errored` with the artefact retained, never to a wrong result |

## 20. Version check and upgrade

*Satisfies R13.8–R13.12.*

Specified in [design_version-check-and-upgrade.md](design_version-check-and-upgrade.md): the GitHub Releases publishing contract and its two pre-publish assertions, `CHANGELOG.md` and the first-parent walk that backfills it, the versioned install prefix and the atomic relink that adopts one, the throttled launch-time check, and the three surfaces that reach it — the prompt (§14.14), `skillgantry upgrade` (§15) and doctor's `skillgantry-outdated` (§5.3).

It is numbered 20 rather than inserted beside §13, because §16–§19 are cited by id from the plans and from `tests/specs/`, and renumbering them to make room would invalidate every one of those citations to buy nothing but adjacency. It is a separate file for [design_tui.md](design_tui.md)'s reason: no other section reads it.
