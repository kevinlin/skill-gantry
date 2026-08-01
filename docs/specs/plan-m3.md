# SkillGantry M3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** revision 1, aligned to [design.md](design.md) revision 3, [requirements.md](requirements.md) revision 3, [plan-m1.md](plan-m1.md) revision 2 and shipped M2.

**Goal:** Complete the `tools` module. Nine external tools become installable, verifiable and lockable through three drivers; a re-enterable setup wizard takes a clean machine from no runtime to a verified toolchain, a registered repo and a written selection; `doctor` re-verifies the lock and reports every drift kind.

**Architecture:** M3 adds six modules to `src/core/tools/`, one Ink screen pair to `src/tui/`, and two subcommands to `src/cli/`. The engine keeps owning decisions and I/O separately: `catalogue.ts` and `setup.ts` are pure, the three drivers own subprocess and network, and the wizard renders a state machine it cannot advance without calling an injected driver. No M1 or M2 interface changes shape.

**Tech Stack:** everything M1 and M2 ship. No new dependency. `fetch` is the Node 24 global; `tar` and `unzip` are invoked as external commands rather than adding an archive library, matching the "prefer mature tools" rule already applied to `git` and `uv`.

## Global Constraints

Everything in [plan-m1.md's Global Constraints](plan-m1.md) and [plan-m2.md's](plan-m2.md) still holds. These are the additions.

- Node engine floor `>=24.0.0`; ESM only, `NodeNext`; relative imports carry `.js`, in `.tsx` too.
- Import boundary unchanged: `cli → tui → core`, `src/tui/**` reaches core only through `src/core/index.ts`, no `console` or `process.exit` in `src/core/**`, no `node:fs` / `node:child_process` / `node:https` / `node:net` in `src/core/adapters/**`.
- `src/core/tools/**` owns fs, network and subprocess. It MUST NOT open the ledger. Doctor's lifecycle check therefore receives ledger state as data from `src/cli/`, which is the same rule that keeps `queue` out of the ledger.
- **The catalogue is the install authority; the adapter registry is the run authority.** A tool may be installed and locked with no adapter. It MUST NOT reach `stageTools`, because `AdapterStageExecutor.plan()` throws `unknown tool: <id>` on an id the registry does not hold, which would fail the whole run.
- Every install lands under `~/.skillgantry/tools/<toolId>/` and nothing lands in a user-global location. This is R3.1, already proven for `uv-tool` in M1, and now binding on two more drivers.
- A `gh-release` install verifies integrity before the binary is used, and `integrity: 'none'` requires a written reason (R3.2b).
- No tool is written into the lock before its executable has answered its version argv. M1's rule, unchanged, now shared by three drivers.
- The wizard NEVER installs a runtime. R3.7 is satisfied by having no code path that could: `probeRuntimes` invokes version argv and nothing else.
- New drivers take an injected `Exec` (and `fetch`) seam so the default `pnpm test` run stays offline. Real installs live in the `SG_INTEGRATION` suite.
- Timeouts: every driver invocation goes through `Exec`, which carries a default 300 s ceiling. An install that hangs must not hang the wizard.
- British spelling in identifiers that appear in the specs (`optimise`, `artefact`, `normalise`).
- Conventional Commits, lowercase imperative subject.

## Spec amendments this milestone carries

Both are amended in this branch, before the code that depends on them, per the repo rule that a spec proven wrong is corrected rather than left to diverge.

**1. R3.5 cannot mean "eight adapters" in M3.** R3.5 as written requires eight adapters, and R4.1 defines an adapter as a manifest *and* a `parse`. But design §17 assigns the remaining seven adapters to M4, M4's exit criteria are about merging their findings, and R3.5a requires installing vercel `skills`, which has no adapter at all and therefore proves install specs cannot live only in adapter manifests. Shipping seven stub parsers to satisfy the literal wording would make seven tools selectable whose output nothing can read.

Split it:

- **R3.5** (M3) — SkillGantry MUST ship a catalogue entry for each of the eight tools named in D7, and for the tool of R3.5a, sufficient to install, verify and lock it. A catalogue entry MUST NOT be selectable for a run until an adapter supplies its `parse`.
- **R3.5b** (M4, new) — SkillGantry MUST ship a manifest and `parse` for the seven adapters M1 did not, each fixture-tested per R13.3.

**2. `assetPattern` needs platform tokens.** A single fixed pattern cannot resolve a Go release asset on two machines. §5.2 gains: `{os}` and `{arch}` in `assetPattern` are substituted from the host before matching, `{os}` from `process.platform` and `{arch}` as `arm64` or `amd64`.

Both amendments land in Task 1, along with the `doctor` finding kinds §5.3 implies but does not name, and the §17 milestone-modules rows.

## Facts established by reading the shipped code

Repeated here because several tasks depend on them.

1. `installAndLock(home, uvSpec, versionArgv)` in [install.ts](../../src/core/tools/install.ts) is `uv-tool`-only and writes the lock entry after `verifyTool` succeeds. `tests/core/install.test.ts` calls it with a literal spec object. Task 5 keeps that signature working by delegating, so the M1 integration test needs no edit.
2. `verifyTool` requires a semver-shaped substring in combined stdout+stderr. A tool printing only `v1.2` fails verification and doctor will call it `unverifiable`. Recorded as a known gap.
3. `toolLockEntrySchema` already accepts all three `installKind` values and carries `integrity`, so M3 adds no lock-schema migration.
4. `AdapterStageExecutor.plan()` throws on an id absent from the adapter registry. This is why the wizard filters `stageTools`.
5. `parseFrontmatter` returns `{ name, version }` and four assertions in `tests/core/frontmatter.test.ts` compare the whole object with `toEqual`. Adding `deprecated` breaks those four; Task 6 updates them.
6. `buildProgram(deps)` in [run-command.ts](../../src/cli/run-command.ts) owns the whole commander program, including the root action that launches the TUI. `CliDeps.startTui` is the test seam; Task 10 adds `startSetup` beside it.
7. `renderInk` in `tests/helpers/render-ink.tsx` drives Ink with a fake TTY and `debug: true`, so a wizard frame is directly assertable.

## File structure

```
src/
  core/
    index.ts                    MODIFIED  catalogue, presets, setup, doctor, runtime exports
    discovery/
      frontmatter.ts            MODIFIED  deprecated flag, for doctor's lifecycle check
    tools/
      exec.ts                   NEW       Exec seam, defaultExec with a timeout
      catalogue.ts              NEW       ToolSpec × 9, PRESETS, lookups
      runtimes.ts               NEW       probeRuntimes(), official install commands
      npm.ts                    NEW       npm-prefix driver
      gh-release.ts             NEW       gh-release driver, integrity, extraction
      install.ts                MODIFIED  installTool() dispatch over three kinds
      doctor.ts                 NEW       drift report
      setup.ts                  NEW       setup state machine, SetupDriver, stageToolsFor
      uv.ts                     unchanged
  tui/
    index.tsx                   MODIFIED  renderSetup()
    setup-app.tsx               NEW       SetupApp: input, driver calls, state
    components/
      Setup.tsx                 NEW       pure render of SetupState
  cli/
    run-command.ts              MODIFIED  doctor + setup subcommands, first-run routing
    doctor-command.ts           NEW       skillgantry doctor [--json]
    setup-command.ts            NEW       driver wiring, startSetup
tests/
  helpers/
    fake-release.ts             NEW       local http server serving a release + checksums
  core/
    catalogue.test.ts           npm-install.test.ts     gh-release.test.ts
    runtimes.test.ts            install-dispatch.test.ts
    doctor.test.ts              setup.test.ts
  tui/
    setup-wizard.test.tsx
  cli/
    doctor-command.test.ts      setup-command.test.ts
  acceptance/
    m3.test.tsx
docs/specs/
  requirements.md               MODIFIED  R3.5 split, R3.5b added, ownership table
  design.md                     MODIFIED  §5.1a catalogue, §5.2 tokens, §5.3 kinds, §17
```

---

## Tasks

### Task 1: Tool catalogue, presets and the spec amendments they require

**Files:**
- Create: `src/core/tools/catalogue.ts`
- Test: `tests/core/catalogue.test.ts`
- Modify: `docs/specs/requirements.md`, `docs/specs/design.md`

**Interfaces:**
- Consumes: `InstallSpec` from `src/core/adapters/types.ts`, `Stage` from `src/core/types.ts`.
- Produces: `Runtime`, `ToolSpec`, `RELEASE_TOOL_ID`, `CATALOGUE`, `PRESETS`, `PresetName`, `catalogueEntry(id)`, `catalogueIds()`, `toolsForStage(stage)`, `expandPreset(name)`.

- [ ] **Step 1: Amend the two spec documents**

In `requirements.md`, replace R3.5 and insert R3.5b directly after R3.5a:

```markdown
- **R3.5** SkillGantry MUST ship a catalogue entry for each of the eight tools of D7 — skill-lint and agentskills (validate), skill-up and promptfoo (evaluate), skill-scanner and SkillSpector (security), SkillOpt and SkillHone (optimise) — carrying the install spec, runtime and version argv needed to install, verify and lock it. A catalogue entry MUST NOT be selectable for a run until an adapter supplies its `parse`. Release is a native stage rather than an adapter. (D7, D9) *(rev 4, M3 planning: R4.1 defines an adapter as manifest plus `parse`, so "ship eight adapters" claimed M4's parsers for M3, and R3.5a's tool has no adapter at all.)*
- **R3.5b** SkillGantry MUST ship a manifest and `parse` for the seven adapters M1 did not, each fixture-tested per R13.3. *(rev 4, split from R3.5)*
```

In the milestone ownership table, change M3's owned column to `R3.2, R3.2b, R3.5, R3.5a, R3.6–R3.9, R12.5a` (unchanged text, R3.5 now narrower) and M4's to `R3.5b, R4.6–R4.8`.

In `design.md`, insert §5.1a after §5.1:

```markdown
### 5.1a Tool catalogue

*Satisfies R3.5, R3.5a.*

`src/core/tools/catalogue.ts` holds one `ToolSpec` per installable tool: id, display name, the stage that selects it (`null` for vercel `skills`, which release invokes and no stage selects), the runtime its driver needs, its install spec and its version argv.

The catalogue exists separately from the adapter registry because installability and runnability are not the same property. Vercel `skills` is installable with no adapter, and seven adapters arrive in M4 with parsers for tools M3 already installs. The catalogue is the authority for installing, verifying and locking; the adapter registry is the authority for what a run may select. `AdapterManifest.install` is retained as documentation and kept in step by a test asserting the two agree for every tool holding both.

A consequence the wizard must respect: a selection written into `stageTools` names a tool the adapter registry knows, since `AdapterStageExecutor.plan()` rejects an unknown id. An installed tool with no adapter is reported as installed and not yet runnable.
```

Append to §5.2, after the `Integrity` block: `` `assetPattern` may carry `{os}` and `{arch}`, substituted from the host before matching — `{os}` from `process.platform`, `{arch}` as `arm64` or `amd64`. A single fixed pattern cannot resolve a per-platform release asset on two machines. ``

Extend §5.3's doctor paragraph: `` Two further conditions are reported and do not fail the report: `integrity-unverified`, a lock entry recording `integrity: "none"` per §5.2, and `lifecycle-drift` per §13. ``

In §17's milestone-modules table, change M3's cell to ``` `tools` completed: catalogue, `npm-prefix`, `gh-release`, presets, setup wizard, doctor ``` and M4's to `The seven remaining adapters and their parsers, fan-out policy, cross-tool merge`.

- [ ] **Step 2: Probe the nine tools and record what they actually are**

The identity and pin of every tool but SkillSpector is unknown to this plan, and M1 already shipped once with a pin (`2.3.7`) that upstream never carried. So the catalogue is written from probe output, not from memory. For each tool run the recipe for its language, from D-log line 29:

| Tool | Language / kind | Probe |
|---|---|---|
| skill-lint | TypeScript, `npm-prefix` | `npm view skill-lint version`; on 404 try the scoped name, then `npm search skill-lint` |
| promptfoo | TypeScript, `npm-prefix` | `npm view promptfoo version` |
| skills (vercel) | TypeScript, `npm-prefix` | `npm view skills version`; on 404 `npm view @vercel/skills version` |
| skill-up | Go, `gh-release` | `gh release view --repo <owner>/skill-up --json tagName,assets`; find the repo with `gh search repos skill-up` |
| skill-scanner | Python, `uv-tool` | `uv pip index versions skill-scanner`; if absent, `git ls-remote --tags <repo>` and pin a tag, as SkillSpector does |
| SkillSpector | Python, `uv-tool` | already known: copy from `src/core/adapters/skillspector.ts` |
| agentskills | Python, `uv-tool` | `uv pip index versions agentskills` |
| SkillOpt | Python, `uv-tool` | `uv pip index versions skillopt`, then `git ls-remote --tags` |
| SkillHone | Python, `uv-tool` | `uv pip index versions skillhone`, then `git ls-remote --tags` |

Record, per tool: the command run, its output, and the resulting entry. Determine `versionArgv` by invoking the installed binary — `--version` for most, `version` for some Go tools.

**A tool that cannot be resolved from a public source is a spec problem, not an implementation one.** Omit it from `CATALOGUE`, record it under "Deviations found while implementing" at the foot of this plan with the probe output that showed it absent, and continue. The preset tests below are properties, not id lists, so they stay green with a shorter catalogue.

- [ ] **Step 3: Write the failing test**

`tests/core/catalogue.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  CATALOGUE,
  PRESETS,
  RELEASE_TOOL_ID,
  catalogueEntry,
  catalogueIds,
  expandPreset,
  toolsForStage,
} from '../../src/core/tools/catalogue.js'
import { getAdapter } from '../../src/core/adapters/registry.js'

describe('catalogue', () => {
  it('holds the release installer, which no stage selects', () => {
    const skills = catalogueEntry(RELEASE_TOOL_ID)
    expect(skills?.stage).toBeNull()
  })

  it('gives every entry a runtime, an install spec and a version argv', () => {
    for (const spec of CATALOGUE) {
      expect(['uv', 'npm', 'none']).toContain(spec.runtime)
      expect(spec.install.pin.length).toBeGreaterThan(0)
      expect(spec.versionArgv.length).toBeGreaterThan(0)
      expect(spec.displayName.length).toBeGreaterThan(0)
    }
  })

  it('uses ids that are unique', () => {
    expect(new Set(catalogueIds()).size).toBe(CATALOGUE.length)
  })

  // The manifest keeps its own install spec for documentation; drift between
  // the two would install one version and record another.
  it('agrees with every adapter manifest that carries an install spec', () => {
    for (const spec of CATALOGUE) {
      const adapter = getAdapter(spec.id)
      if (!adapter) continue
      expect(adapter.manifest.install).toEqual(spec.install)
      expect(adapter.manifest.versionArgv).toEqual(spec.versionArgv)
    }
  })
})

describe('presets', () => {
  it('includes the release installer in all three — R3.8', () => {
    for (const name of ['minimal', 'recommended', 'everything'] as const) {
      expect(expandPreset(name).map((s) => s.id)).toContain(RELEASE_TOOL_ID)
    }
  })

  it('names only catalogued tools', () => {
    const ids = new Set(catalogueIds())
    for (const preset of Object.values(PRESETS)) {
      for (const id of preset) expect(ids.has(id)).toBe(true)
    }
  })

  it('nests minimal in recommended in everything', () => {
    const [min, rec, all] = [PRESETS.minimal, PRESETS.recommended, PRESETS.everything]
    for (const id of min) expect(rec).toContain(id)
    for (const id of rec) expect(all).toContain(id)
  })

  it('gives recommended at most one tool per stage', () => {
    const stages = expandPreset('recommended')
      .map((s) => s.stage)
      .filter((s): s is NonNullable<typeof s> => s !== null)
    expect(new Set(stages).size).toBe(stages.length)
  })

  it('makes everything the whole catalogue', () => {
    expect([...PRESETS.everything].sort()).toEqual([...catalogueIds()].sort())
  })

  it('offers per-stage choice', () => {
    expect(toolsForStage('security').map((s) => s.id)).toContain('skillspector')
  })
})
```

- [ ] **Step 4: Run it and watch it fail**

Run: `pnpm vitest run tests/core/catalogue.test.ts`
Expected: FAIL, cannot resolve `src/core/tools/catalogue.js`.

- [ ] **Step 5: Write the catalogue**

`src/core/tools/catalogue.ts`. The SkillSpector entry is shown complete because it is known; the other entries take the same shape with the values Step 2 probed.

```ts
import type { InstallSpec } from '../adapters/types.js'
import type { Stage } from '../types.js'

/** The runtime a tool's install driver needs on the host. */
export type Runtime = 'uv' | 'npm' | 'none'

export interface ToolSpec {
  id: string
  displayName: string
  /** null for the release installer: it is invoked by a stage, selected by none. */
  stage: Stage | null
  runtime: Runtime
  install: InstallSpec
  versionArgv: readonly string[]
}

/** R3.5a: release cannot run its installability gate without this one. */
export const RELEASE_TOOL_ID = 'skills'

export const CATALOGUE: readonly ToolSpec[] = [
  {
    id: 'skillspector',
    displayName: 'SkillSpector (NVIDIA)',
    stage: 'security',
    runtime: 'uv',
    install: {
      kind: 'uv-tool',
      spec: 'git+https://github.com/NVIDIA/skillspector.git',
      pin: 'v2.5.1',
      binName: 'skillspector',
    },
    versionArgv: ['--version'],
  },
  // …eight further entries from Task 1 Step 2, same shape. `gh-release` entries
  // additionally carry `assetPattern` and `integrity`.
]

const BY_ID = new Map(CATALOGUE.map((spec) => [spec.id, spec]))

export function catalogueEntry(id: string): ToolSpec | undefined {
  return BY_ID.get(id)
}

export function catalogueIds(): readonly string[] {
  return CATALOGUE.map((spec) => spec.id)
}

export function toolsForStage(stage: Stage): readonly ToolSpec[] {
  return CATALOGUE.filter((spec) => spec.stage === stage)
}

export type PresetName = 'minimal' | 'recommended' | 'everything'

/**
 * Minimal is the two tools already on the reference machine; Recommended is one
 * per stage; Everything is the catalogue. All three carry the release installer,
 * because a preset that omits it produces a toolchain release cannot gate.
 */
export const PRESETS: Readonly<Record<PresetName, readonly string[]>> = {
  minimal: ['skill-up', 'skillspector', RELEASE_TOOL_ID],
  recommended: ['skill-lint', 'skill-up', 'skillspector', 'skillopt', RELEASE_TOOL_ID],
  everything: catalogueIds(),
}

export function expandPreset(name: PresetName): readonly ToolSpec[] {
  return PRESETS[name].flatMap((id) => {
    const spec = catalogueEntry(id)
    return spec ? [spec] : []
  })
}
```

If Step 2 found a preset member unresolvable, drop that id from `PRESETS` in the same edit, so `expandPreset` never silently shrinks a preset the user was shown.

- [ ] **Step 6: Run the tests and the whole suite**

Run: `pnpm vitest run tests/core/catalogue.test.ts && pnpm lint && pnpm build`
Expected: PASS, clean lint, clean build.

- [ ] **Step 7: Commit**

```bash
git add src/core/tools/catalogue.ts tests/core/catalogue.test.ts docs/specs/requirements.md docs/specs/design.md
git commit -m "feat(tools): catalogue the nine installable tools and their presets

Splits R3.5 so M3 owns installability and M4 owns parsers, and records the
platform tokens a gh-release asset pattern needs."
```

---

### Task 2: The exec seam and runtime probing

**Files:**
- Create: `src/core/tools/exec.ts`, `src/core/tools/runtimes.ts`
- Test: `tests/core/runtimes.test.ts`

**Interfaces:**
- Consumes: `Runtime` from `catalogue.ts`.
- Produces: `ExecResult`, `Exec`, `defaultExec`, `EXEC_TIMEOUT_MS`; `RuntimeStatus`, `RUNTIME_PROBE`, `INSTALL_COMMAND`, `probeRuntimes(needed, exec?)`, `runtimesFor(specs)`.

- [ ] **Step 1: Write the failing test**

`tests/core/runtimes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { catalogueEntry } from '../../src/core/tools/catalogue.js'
import type { Exec } from '../../src/core/tools/exec.js'
import { INSTALL_COMMAND, probeRuntimes, runtimesFor } from '../../src/core/tools/runtimes.js'

const present: Exec = async (bin) => ({ stdout: `${bin} 1.2.3`, stderr: '' })
const absent: Exec = async (bin) => {
  throw Object.assign(new Error(`spawn ${bin} ENOENT`), { code: 'ENOENT' })
}

describe('probeRuntimes', () => {
  it('reports a present runtime with its version', async () => {
    const [uv] = await probeRuntimes(['uv'], present)
    expect(uv).toMatchObject({ runtime: 'uv', present: true, version: '1.2.3' })
  })

  it('reports a missing runtime with the official install command — R3.7', async () => {
    const [uv] = await probeRuntimes(['uv'], absent)
    expect(uv?.present).toBe(false)
    expect(uv?.installCommand).toBe(INSTALL_COMMAND.uv)
  })

  // R3.7 is satisfied structurally: there is no code path that installs.
  it('invokes nothing but the version argv', async () => {
    const calls: string[][] = []
    const record: Exec = async (bin, argv) => {
      calls.push([bin, ...argv])
      return { stdout: '9.9.9', stderr: '' }
    }
    await probeRuntimes(['uv', 'npm'], record)
    expect(calls).toEqual([
      ['uv', '--version'],
      ['npm', '--version'],
    ])
  })

  it('never probes the none runtime', async () => {
    expect(await probeRuntimes(['none'], absent)).toEqual([])
  })

  it('deduplicates', async () => {
    expect(await probeRuntimes(['npm', 'npm'], present)).toHaveLength(1)
  })
})

describe('runtimesFor', () => {
  it('derives the distinct runtimes a selection needs', () => {
    const spector = catalogueEntry('skillspector')
    expect(spector).toBeDefined()
    expect(runtimesFor([spector!])).toEqual(['uv'])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/core/runtimes.test.ts`
Expected: FAIL, cannot resolve `src/core/tools/exec.js`.

- [ ] **Step 3: Write the exec seam**

`src/core/tools/exec.ts`:

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** A driver that hangs must not hang the wizard, so every call carries a ceiling. */
export const EXEC_TIMEOUT_MS = 300_000

export interface ExecResult {
  stdout: string
  stderr: string
}

export interface ExecOptions {
  env?: Record<string, string>
  cwd?: string
  timeoutMs?: number
}

/** Injected by tests so the default suite stays offline. */
export type Exec = (
  bin: string,
  argv: readonly string[],
  options?: ExecOptions,
) => Promise<ExecResult>

export const defaultExec: Exec = async (bin, argv, options = {}) => {
  const res = await run(bin, [...argv], {
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeoutMs ?? EXEC_TIMEOUT_MS,
    ...(options.env ? { env: options.env } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
  })
  return { stdout: res.stdout.toString(), stderr: res.stderr.toString() }
}
```

- [ ] **Step 4: Write the probe**

`src/core/tools/runtimes.ts`:

```ts
import type { Runtime, ToolSpec } from './catalogue.js'
import { type Exec, defaultExec } from './exec.js'

const SEMVER = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/

export const RUNTIME_PROBE: Readonly<Record<Exclude<Runtime, 'none'>, readonly string[]>> = {
  uv: ['--version'],
  npm: ['--version'],
}

/**
 * Displayed, never run. R3.7 forbids installing a runtime without explicit
 * confirmation, and the strongest way to honour that is to own no install path.
 */
export const INSTALL_COMMAND: Readonly<Record<Exclude<Runtime, 'none'>, string>> = {
  uv: 'curl -LsSf https://astral.sh/uv/install.sh | sh',
  npm: 'install Node 24 from https://nodejs.org — npm ships with it',
}

export interface RuntimeStatus {
  runtime: Exclude<Runtime, 'none'>
  present: boolean
  version: string | null
  installCommand: string
}

export function runtimesFor(specs: readonly ToolSpec[]): readonly Runtime[] {
  return [...new Set(specs.map((spec) => spec.runtime))]
}

export async function probeRuntimes(
  needed: readonly Runtime[],
  exec: Exec = defaultExec,
): Promise<RuntimeStatus[]> {
  const wanted = [...new Set(needed)].filter(
    (runtime): runtime is Exclude<Runtime, 'none'> => runtime !== 'none',
  )
  const statuses: RuntimeStatus[] = []
  for (const runtime of wanted) {
    let version: string | null = null
    try {
      const { stdout, stderr } = await exec(runtime, RUNTIME_PROBE[runtime], { timeoutMs: 15_000 })
      version = SEMVER.exec(`${stdout}${stderr}`)?.[0] ?? null
    } catch {
      version = null
    }
    statuses.push({
      runtime,
      present: version !== null,
      version,
      installCommand: INSTALL_COMMAND[runtime],
    })
  }
  return statuses
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/core/runtimes.test.ts && pnpm lint`
Expected: PASS, clean lint.

- [ ] **Step 6: Commit**

```bash
git add src/core/tools/exec.ts src/core/tools/runtimes.ts tests/core/runtimes.test.ts
git commit -m "feat(tools): probe runtimes and name their official install command"
```

---

### Task 3: The npm-prefix install driver

**Files:**
- Create: `src/core/tools/npm.ts`
- Test: `tests/core/npm-install.test.ts`

**Interfaces:**
- Consumes: `Exec` from `exec.ts`.
- Produces: `NpmInstallSpec`, `npmInstall(dir, spec, exec?)` returning the resolved absolute bin path.

- [ ] **Step 1: Write the failing test**

`tests/core/npm-install.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Exec } from '../../src/core/tools/exec.js'
import { type NpmInstallSpec, npmInstall } from '../../src/core/tools/npm.js'

const SPEC: NpmInstallSpec = {
  id: 'promptfoo',
  kind: 'npm-prefix',
  spec: 'promptfoo',
  pin: '0.100.0',
  binName: 'promptfoo',
}

describe('npmInstall', () => {
  it('installs into the private prefix and resolves the shim there', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sg-npm-'))
    const calls: Array<{ bin: string; argv: readonly string[] }> = []
    const exec: Exec = async (bin, argv) => {
      calls.push({ bin, argv })
      return { stdout: '', stderr: '' }
    }

    const bin = await npmInstall(dir, SPEC, exec)

    expect(bin).toBe(join(dir, 'node_modules', '.bin', 'promptfoo'))
    expect(calls[0]?.bin).toBe('npm')
    expect(calls[0]?.argv).toEqual([
      'install',
      '--prefix',
      dir,
      '--no-fund',
      '--no-audit',
      '--loglevel=error',
      'promptfoo@0.100.0',
    ])
  })

  it('names the tool and the pin when npm fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sg-npm-'))
    const exec: Exec = async () => {
      throw Object.assign(new Error('exit 1'), { stderr: 'E404 Not Found' })
    }
    await expect(npmInstall(dir, SPEC, exec)).rejects.toThrow(
      /install failed for promptfoo@0\.100\.0: E404/,
    )
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/core/npm-install.test.ts`
Expected: FAIL, cannot resolve `src/core/tools/npm.js`.

- [ ] **Step 3: Write the driver**

`src/core/tools/npm.ts`:

```ts
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { type Exec, defaultExec } from './exec.js'

export interface NpmInstallSpec {
  id: string
  kind: 'npm-prefix'
  spec: string
  pin: string
  binName: string
}

/**
 * `--prefix` keeps the install inside the tool root; the package.json and lock
 * npm writes there are per-tool and harmless. Nothing touches a user-global
 * prefix, which is R3.1 applied to the second driver.
 */
export async function npmInstall(
  dir: string,
  spec: NpmInstallSpec,
  exec: Exec = defaultExec,
): Promise<string> {
  await mkdir(dir, { recursive: true })
  try {
    await exec('npm', [
      'install',
      '--prefix',
      dir,
      '--no-fund',
      '--no-audit',
      '--loglevel=error',
      `${spec.spec}@${spec.pin}`,
    ])
  } catch (err) {
    const detail = (err as { stderr?: string }).stderr ?? (err as Error).message
    throw new Error(`install failed for ${spec.id}@${spec.pin}: ${detail}`)
  }
  return join(dir, 'node_modules', '.bin', spec.binName)
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/core/npm-install.test.ts && pnpm lint`
Expected: PASS, clean lint.

- [ ] **Step 5: Commit**

```bash
git add src/core/tools/npm.ts tests/core/npm-install.test.ts
git commit -m "feat(tools): add the npm-prefix install driver"
```

---

### Task 4: The gh-release driver, with declared integrity

**Files:**
- Create: `src/core/tools/gh-release.ts`, `tests/helpers/fake-release.ts`
- Test: `tests/core/gh-release.test.ts`

**Interfaces:**
- Consumes: `Exec` from `exec.ts`, `Integrity` from `src/core/adapters/types.ts`.
- Produces: `GhReleaseInstallSpec`, `GhReleaseOptions`, `resolveAssetPattern(pattern, platform, arch)`, `ghReleaseInstall(dir, spec, options?)` returning `{ bin, integrity }`.
- Test helper produces: `startFakeRelease({ repo, tag, assets })` returning `{ apiBase, close }`.

- [ ] **Step 1: Write the release-server helper**

`tests/helpers/fake-release.ts`:

```ts
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FakeAsset {
  name: string
  body: Buffer
}

export interface FakeRelease {
  repo: string
  tag: string
  assets: readonly FakeAsset[]
}

export interface FakeReleaseHandle {
  apiBase: string
  close: () => Promise<void>
}

export const sha256 = (body: Buffer): string => createHash('sha256').update(body).digest('hex')

/**
 * Serves the two endpoints the driver uses — the release-by-tag JSON and each
 * asset's download URL — so integrity and extraction are testable offline.
 */
export async function startFakeRelease(release: FakeRelease): Promise<FakeReleaseHandle> {
  let base = ''
  const server: Server = createServer((req, res) => {
    const url = req.url ?? ''
    if (url === `/repos/${release.repo}/releases/tags/${release.tag}`) {
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          tag_name: release.tag,
          assets: release.assets.map((asset) => ({
            name: asset.name,
            browser_download_url: `${base}/download/${asset.name}`,
          })),
        }),
      )
      return
    }
    const asset = release.assets.find((a) => url === `/download/${a.name}`)
    if (asset) {
      res.setHeader('content-type', 'application/octet-stream')
      res.end(asset.body)
      return
    }
    res.statusCode = 404
    res.end('not found')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  base = `http://127.0.0.1:${port}`
  return {
    apiBase: base,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
```

- [ ] **Step 2: Write the failing test**

`tests/core/gh-release.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile, chmod, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  type GhReleaseInstallSpec,
  ghReleaseInstall,
  resolveAssetPattern,
} from '../../src/core/tools/gh-release.js'
import { sha256, startFakeRelease } from '../helpers/fake-release.js'

const run = promisify(execFile)

/** A tar.gz holding one executable, built the way a real release publishes one. */
async function tarball(binName: string): Promise<Buffer> {
  const stage = await mkdtemp(join(tmpdir(), 'sg-rel-'))
  await mkdir(join(stage, 'pkg'), { recursive: true })
  const bin = join(stage, 'pkg', binName)
  await writeFile(bin, '#!/bin/sh\necho "skill-up 0.4.2"\n')
  await chmod(bin, 0o755)
  await run('tar', ['-czf', join(stage, 'asset.tar.gz'), '-C', join(stage, 'pkg'), binName])
  return readFile(join(stage, 'asset.tar.gz'))
}

const spec = (over: Partial<GhReleaseInstallSpec> = {}): GhReleaseInstallSpec => ({
  id: 'skill-up',
  kind: 'gh-release',
  repo: 'acme/skill-up',
  pin: 'v0.4.2',
  assetPattern: 'skill-up_.*\\.tar\\.gz',
  binName: 'skill-up',
  integrity: { kind: 'none', reason: 'upstream publishes no checksums' },
  ...over,
})

describe('resolveAssetPattern', () => {
  it('substitutes host tokens before matching', () => {
    expect(resolveAssetPattern('sk_{os}_{arch}\\.tar\\.gz', 'darwin', 'arm64')).toBe(
      'sk_darwin_arm64\\.tar\\.gz',
    )
    expect(resolveAssetPattern('sk_{os}_{arch}\\.tar\\.gz', 'linux', 'x64')).toBe(
      'sk_linux_amd64\\.tar\\.gz',
    )
  })
})

describe('ghReleaseInstall', () => {
  it('extracts the asset and resolves the declared binary', async () => {
    const body = await tarball('skill-up')
    const release = await startFakeRelease({
      repo: 'acme/skill-up',
      tag: 'v0.4.2',
      assets: [{ name: 'skill-up_darwin_arm64.tar.gz', body }],
    })
    const dir = await mkdtemp(join(tmpdir(), 'sg-gh-'))
    try {
      const out = await ghReleaseInstall(dir, spec(), { apiBase: release.apiBase })
      expect(out.bin.startsWith(dir)).toBe(true)
      expect((await run(out.bin, [])).stdout).toContain('skill-up 0.4.2')
      expect(out.integrity).toBe('none')
    } finally {
      await release.close()
    }
  })

  it('accepts a matching pinned digest', async () => {
    const body = await tarball('skill-up')
    const release = await startFakeRelease({
      repo: 'acme/skill-up',
      tag: 'v0.4.2',
      assets: [{ name: 'skill-up_darwin_arm64.tar.gz', body }],
    })
    const dir = await mkdtemp(join(tmpdir(), 'sg-gh-'))
    try {
      const out = await ghReleaseInstall(
        dir,
        spec({ integrity: { kind: 'sha256-digest', digest: sha256(body) } }),
        { apiBase: release.apiBase },
      )
      expect(out.integrity).toBe(`sha256:${sha256(body)}`)
    } finally {
      await release.close()
    }
  })

  it('fails the install on a digest mismatch — R3.2b', async () => {
    const body = await tarball('skill-up')
    const release = await startFakeRelease({
      repo: 'acme/skill-up',
      tag: 'v0.4.2',
      assets: [{ name: 'skill-up_darwin_arm64.tar.gz', body }],
    })
    const dir = await mkdtemp(join(tmpdir(), 'sg-gh-'))
    try {
      await expect(
        ghReleaseInstall(dir, spec({ integrity: { kind: 'sha256-digest', digest: 'a'.repeat(64) } }), {
          apiBase: release.apiBase,
        }),
      ).rejects.toThrow(/integrity mismatch/)
    } finally {
      await release.close()
    }
  })

  it('verifies against a published checksum asset', async () => {
    const body = await tarball('skill-up')
    const name = 'skill-up_darwin_arm64.tar.gz'
    const sums = Buffer.from(`${sha256(body)}  ${name}\n0000  other.tar.gz\n`)
    const release = await startFakeRelease({
      repo: 'acme/skill-up',
      tag: 'v0.4.2',
      assets: [
        { name, body },
        { name: 'checksums.txt', body: sums },
      ],
    })
    const dir = await mkdtemp(join(tmpdir(), 'sg-gh-'))
    try {
      const out = await ghReleaseInstall(
        dir,
        spec({ integrity: { kind: 'sha256-asset', assetPattern: 'checksums\\.txt' } }),
        { apiBase: release.apiBase },
      )
      expect(out.integrity).toBe(`sha256:${sha256(body)}`)
    } finally {
      await release.close()
    }
  })

  it('names the pattern when no asset matches', async () => {
    const release = await startFakeRelease({ repo: 'acme/skill-up', tag: 'v0.4.2', assets: [] })
    const dir = await mkdtemp(join(tmpdir(), 'sg-gh-'))
    try {
      await expect(ghReleaseInstall(dir, spec(), { apiBase: release.apiBase })).rejects.toThrow(
        /no asset matching/,
      )
    } finally {
      await release.close()
    }
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm vitest run tests/core/gh-release.test.ts`
Expected: FAIL, cannot resolve `src/core/tools/gh-release.js`.

- [ ] **Step 4: Write the driver**

`src/core/tools/gh-release.ts`:

```ts
import { createHash } from 'node:crypto'
import { chmod, mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Integrity } from '../adapters/types.js'
import { type Exec, defaultExec } from './exec.js'

export interface GhReleaseInstallSpec {
  id: string
  kind: 'gh-release'
  repo: string
  pin: string
  assetPattern: string
  binName: string
  integrity: Integrity
}

export interface GhReleaseOptions {
  /** Overridden in tests to point at a local server. */
  apiBase?: string
  fetchImpl?: typeof fetch
  exec?: Exec
}

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

/** A fixed pattern cannot match a per-platform asset on two machines. */
export function resolveAssetPattern(pattern: string, platform: string, arch: string): string {
  return pattern
    .replaceAll('{os}', platform)
    .replaceAll('{arch}', arch === 'arm64' ? 'arm64' : 'amd64')
}

async function download(url: string, fetchImpl: typeof fetch): Promise<Buffer> {
  const res = await fetchImpl(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`download failed: ${url} returned ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

const hash = (body: Buffer): string => createHash('sha256').update(body).digest('hex')

/**
 * `none` is a recorded standing condition rather than a silent one: it needs a
 * written reason, lands in the lock as `"none"`, and doctor surfaces it.
 */
async function verifyIntegrity(
  spec: GhReleaseInstallSpec,
  assetName: string,
  body: Buffer,
  assets: readonly ReleaseAsset[],
  fetchImpl: typeof fetch,
): Promise<string> {
  const actual = hash(body)
  if (spec.integrity.kind === 'none') return 'none'
  if (spec.integrity.kind === 'sha256-digest') {
    if (actual !== spec.integrity.digest) {
      throw new Error(
        `integrity mismatch for ${spec.id}@${spec.pin}: expected ${spec.integrity.digest}, got ${actual}`,
      )
    }
    return `sha256:${actual}`
  }
  const pattern = new RegExp(spec.integrity.assetPattern)
  const sumsAsset = assets.find((asset) => pattern.test(asset.name))
  if (!sumsAsset) {
    throw new Error(`no checksum asset matching ${spec.integrity.assetPattern} on ${spec.pin}`)
  }
  const sums = (await download(sumsAsset.browser_download_url, fetchImpl)).toString('utf8')
  const line = sums
    .split('\n')
    .map((raw) => raw.trim().split(/\s+/))
    .find((parts) => parts[1] === assetName || parts[1] === `*${assetName}`)
  if (!line?.[0]) throw new Error(`${sumsAsset.name} carries no entry for ${assetName}`)
  if (line[0] !== actual) {
    throw new Error(`integrity mismatch for ${spec.id}@${spec.pin}: expected ${line[0]}, got ${actual}`)
  }
  return `sha256:${actual}`
}

/** Depth-limited: release layouts are flat or one directory deep. */
async function findBin(root: string, binName: string, depth = 3): Promise<string | null> {
  const direct = join(root, binName)
  try {
    if ((await stat(direct)).isFile()) return direct
  } catch {
    // keep walking
  }
  if (depth === 0) return null
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const found = await findBin(join(root, entry.name), binName, depth - 1)
    if (found) return found
  }
  return null
}

export async function ghReleaseInstall(
  dir: string,
  spec: GhReleaseInstallSpec,
  options: GhReleaseOptions = {},
): Promise<{ bin: string; integrity: string }> {
  const apiBase = options.apiBase ?? 'https://api.github.com'
  const fetchImpl = options.fetchImpl ?? fetch
  const exec = options.exec ?? defaultExec

  const res = await fetchImpl(`${apiBase}/repos/${spec.repo}/releases/tags/${spec.pin}`, {
    headers: { accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`install failed for ${spec.id}@${spec.pin}: release lookup ${res.status}`)
  const { assets = [] } = (await res.json()) as { assets?: ReleaseAsset[] }

  const pattern = new RegExp(resolveAssetPattern(spec.assetPattern, process.platform, process.arch))
  const asset = assets.find((candidate) => pattern.test(candidate.name))
  if (!asset) {
    throw new Error(`no asset matching ${pattern.source} on ${spec.repo}@${spec.pin}`)
  }

  const body = await download(asset.browser_download_url, fetchImpl)
  const integrity = await verifyIntegrity(spec, asset.name, body, assets, fetchImpl)

  const extractRoot = join(dir, 'extract')
  const binDir = join(dir, 'bin')
  await mkdir(extractRoot, { recursive: true })
  await mkdir(binDir, { recursive: true })

  if (/\.(tar\.gz|tgz)$/.test(asset.name)) {
    const archive = join(dir, asset.name)
    await writeFile(archive, body)
    await exec('tar', ['-xzf', archive, '-C', extractRoot])
  } else if (asset.name.endsWith('.zip')) {
    const archive = join(dir, asset.name)
    await writeFile(archive, body)
    await exec('unzip', ['-q', '-o', archive, '-d', extractRoot])
  } else {
    // A bare binary asset, which some Go releases publish.
    await writeFile(join(extractRoot, spec.binName), body)
  }

  const found = await findBin(extractRoot, spec.binName)
  if (!found) throw new Error(`${asset.name} contains no ${spec.binName}`)
  const bin = join(binDir, spec.binName)
  await rename(found, bin)
  await chmod(bin, 0o755)
  return { bin, integrity }
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/core/gh-release.test.ts && pnpm lint`
Expected: PASS, clean lint.

- [ ] **Step 6: Commit**

```bash
git add src/core/tools/gh-release.ts tests/core/gh-release.test.ts tests/helpers/fake-release.ts
git commit -m "feat(tools): add the gh-release driver with declared integrity

R3.2b: a checksum asset or a pinned digest fails the install on mismatch, and
'none' is recorded rather than assumed."
```

---

### Task 5: Install dispatch over the three kinds

**Files:**
- Modify: `src/core/tools/install.ts`
- Test: `tests/core/install-dispatch.test.ts`

**Interfaces:**
- Consumes: `ToolSpec`/`catalogueEntry` from `catalogue.ts`, `uvInstall`, `npmInstall`, `ghReleaseInstall`, `Exec`.
- Produces: `installTool(home, spec, options?)` returning `ToolLockEntry`; `InstallToolOptions`; `toolRoot`, `verifyTool`, `installAndLock` unchanged in signature.

- [ ] **Step 1: Write the failing test**

`tests/core/install-dispatch.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtemp, chmod, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadToolLock } from '../../src/core/config/config.js'
import type { ToolSpec } from '../../src/core/tools/catalogue.js'
import type { Exec } from '../../src/core/tools/exec.js'
import { installTool, toolRoot } from '../../src/core/tools/install.js'

const home = (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-dispatch-'))

const NPM_TOOL: ToolSpec = {
  id: 'promptfoo',
  displayName: 'promptfoo',
  stage: 'evaluate',
  runtime: 'npm',
  install: { kind: 'npm-prefix', spec: 'promptfoo', pin: '0.100.0', binName: 'promptfoo' },
  versionArgv: ['--version'],
}

/** Stands in for npm: writes the shim the driver is about to resolve. */
const fakeNpm = (dir: () => string): Exec => async (bin, argv) => {
  if (bin !== 'npm') throw new Error(`unexpected ${bin}`)
  const prefix = argv[argv.indexOf('--prefix') + 1] as string
  await mkdir(join(prefix, 'node_modules', '.bin'), { recursive: true })
  const shim = join(prefix, 'node_modules', '.bin', 'promptfoo')
  await writeFile(shim, '#!/bin/sh\necho "promptfoo 0.100.0"\n')
  await chmod(shim, 0o755)
  void dir
  return { stdout: '', stderr: '' }
}

describe('installTool', () => {
  it('installs an npm-prefix tool under the tool root and locks it', async () => {
    const h = await home()
    const entry = await installTool(h, NPM_TOOL, { exec: fakeNpm(() => h) })

    expect(entry.installKind).toBe('npm-prefix')
    expect(entry.bin.startsWith(join(toolRoot(h), 'promptfoo'))).toBe(true)
    expect(entry.resolvedVersion).toBe('0.100.0')
    expect(entry.integrity).toBe('n/a')
    expect(entry.verifiedAt).not.toBeNull()

    const lock = await loadToolLock(h)
    expect(lock.tools.promptfoo?.bin).toBe(entry.bin)
  })

  it('writes no lock entry when verification fails', async () => {
    const h = await home()
    const brokenNpm: Exec = async (bin, argv) => {
      if (bin !== 'npm') throw new Error(`unexpected ${bin}`)
      const prefix = argv[argv.indexOf('--prefix') + 1] as string
      await mkdir(join(prefix, 'node_modules', '.bin'), { recursive: true })
      return { stdout: '', stderr: '' }
    }
    await expect(installTool(h, NPM_TOOL, { exec: brokenNpm })).rejects.toThrow(
      /could not be invoked/,
    )
    expect((await loadToolLock(h)).tools.promptfoo).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/core/install-dispatch.test.ts`
Expected: FAIL, `installTool` is not exported.

- [ ] **Step 3: Rewrite install.ts around the dispatch**

Replace the body of `src/core/tools/install.ts` with the following. `toolRoot` and `verifyTool` are unchanged; `installAndLock` becomes a wrapper so `tests/core/install.test.ts` needs no edit.

```ts
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { loadToolLock, saveToolLock } from '../config/config.js'
import type { ToolLockEntry } from '../config/schema.js'
import type { ToolSpec } from './catalogue.js'
import type { Exec } from './exec.js'
import { type GhReleaseOptions, ghReleaseInstall } from './gh-release.js'
import { npmInstall } from './npm.js'
import { type UvInstallSpec, uvInstall } from './uv.js'

const run = promisify(execFile)

export const toolRoot = (home: string): string => join(home, 'tools')

const SEMVER = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/

/**
 * An install that succeeds but leaves an unrunnable binary is the common
 * failure, so the lock entry is written only after the executable answers.
 */
export async function verifyTool(
  entry: Pick<ToolLockEntry, 'bin'>,
  versionArgv: readonly string[],
): Promise<string> {
  let output: string
  try {
    const res = await run(entry.bin, [...versionArgv])
    output = `${res.stdout}${res.stderr}`
  } catch (err) {
    throw new Error(`${entry.bin} could not be invoked: ${(err as Error).message}`)
  }
  const match = SEMVER.exec(output)
  if (!match) throw new Error(`${entry.bin} could not be invoked: no version in ${output.trim()}`)
  return match[0]
}

export interface InstallToolOptions extends GhReleaseOptions {
  exec?: Exec
}

/** Where a driver placed the executable, and what integrity it could prove. */
async function drive(
  dir: string,
  spec: ToolSpec,
  options: InstallToolOptions,
): Promise<{ bin: string; integrity: string }> {
  switch (spec.install.kind) {
    case 'uv-tool':
      return {
        // uv verifies its own downloads against the index; there is nothing for
        // us to re-check.
        integrity: 'n/a',
        bin: await uvInstall(dir, { id: spec.id, ...spec.install }),
      }
    case 'npm-prefix':
      return {
        integrity: 'n/a',
        bin: await npmInstall(dir, { id: spec.id, ...spec.install }, options.exec),
      }
    case 'gh-release':
      return ghReleaseInstall(dir, { id: spec.id, ...spec.install }, options)
  }
}

export async function installTool(
  home: string,
  spec: ToolSpec,
  options: InstallToolOptions = {},
): Promise<ToolLockEntry> {
  const dir = join(toolRoot(home), spec.id)
  const { bin, integrity } = await drive(dir, spec, options)
  const installedAt = new Date().toISOString()

  const resolvedVersion = await verifyTool({ bin }, spec.versionArgv)

  const entry: ToolLockEntry = {
    installKind: spec.install.kind,
    requestedPin: spec.install.pin,
    resolvedVersion,
    bin,
    integrity,
    installedAt,
    verifiedAt: new Date().toISOString(),
  }

  const lock = await loadToolLock(home)
  await saveToolLock(home, { ...lock, tools: { ...lock.tools, [spec.id]: entry } })
  return entry
}

/** M1's entry point, kept so its integration test needs no edit. */
export async function installAndLock(
  home: string,
  spec: UvInstallSpec,
  versionArgv: readonly string[],
): Promise<ToolLockEntry> {
  return installTool(home, {
    id: spec.id,
    displayName: spec.id,
    stage: null,
    runtime: 'uv',
    install: { kind: 'uv-tool', spec: spec.spec, pin: spec.pin, binName: spec.binName },
    versionArgv,
  })
}
```

- [ ] **Step 4: Run the tests, including M1's**

Run: `pnpm vitest run tests/core/install-dispatch.test.ts && pnpm lint && pnpm build && pnpm test`
Expected: PASS everywhere. `tests/core/install.test.ts` stays excluded without `SG_INTEGRATION`; Task 11 runs it.

- [ ] **Step 5: Commit**

```bash
git add src/core/tools/install.ts tests/core/install-dispatch.test.ts
git commit -m "feat(tools): dispatch installs over all three kinds

R3.2: each tool installs through its native mechanism, and the lock entry is
written only after verification, whichever driver placed the executable."
```

---

### Task 6: The doctor engine

**Files:**
- Create: `src/core/tools/doctor.ts`
- Modify: `src/core/discovery/frontmatter.ts`, `tests/core/frontmatter.test.ts`
- Test: `tests/core/doctor.test.ts`

**Interfaces:**
- Consumes: `loadToolLock`, `catalogueEntry`, `CATALOGUE`, `probeRuntimes`, `runtimesFor`, `toolRoot`, `verifyTool`, `parseFrontmatter`, `SkillRef`.
- Produces: `ToolDriftKind`, `ToolFinding`, `LifecycleFinding`, `LifecycleState`, `DoctorReport`, `DoctorInput`, `doctor(input)`. `DoctorInput` takes discovered `skills` and a `ledgerLifecycle` map, so `tools` needs neither discovery's I/O nor sqlite.
- Also produces: `Frontmatter.deprecated: boolean`.

- [ ] **Step 1: Write the failing test**

`tests/core/doctor.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveToolLock } from '../../src/core/config/config.js'
import type { ToolLockEntry } from '../../src/core/config/schema.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { CATALOGUE } from '../../src/core/tools/catalogue.js'
import { doctor } from '../../src/core/tools/doctor.js'
import { toolRoot } from '../../src/core/tools/install.js'
import { runtimesFor } from '../../src/core/tools/runtimes.js'
import { makeRepo, SKILL_MD } from '../helpers/tmp-repo.js'

const entry = (over: Partial<ToolLockEntry> = {}): ToolLockEntry => ({
  installKind: 'uv-tool',
  requestedPin: 'v1.0.0',
  resolvedVersion: '1.0.0',
  bin: '/nonexistent/bin',
  integrity: 'n/a',
  installedAt: '2026-08-01T00:00:00Z',
  verifiedAt: '2026-08-01T00:00:00Z',
  ...over,
})

async function fakeBin(dir: string, name: string, body: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const path = join(dir, name)
  await writeFile(path, `#!/bin/sh\n${body}\n`)
  await chmod(path, 0o755)
  return path
}

const home = (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-doctor-'))

describe('doctor', () => {
  it('reports a lock entry whose binary is gone as missing', async () => {
    const h = await home()
    await saveToolLock(h, { version: 1, tools: { alpha: entry() } })
    const report = await doctor({ home: h, skills: [], ledgerLifecycle: new Map() })
    expect(report.tools.find((t) => t.toolId === 'alpha')?.kind).toBe('missing')
    expect(report.failed).toBe(true)
  })

  it('reports a binary that will not run as unverifiable', async () => {
    const h = await home()
    const bin = await fakeBin(join(toolRoot(h), 'beta', 'bin'), 'beta', 'exit 1')
    await saveToolLock(h, { version: 1, tools: { beta: entry({ bin }) } })
    const report = await doctor({ home: h, skills: [], ledgerLifecycle: new Map() })
    expect(report.tools.find((t) => t.toolId === 'beta')?.kind).toBe('unverifiable')
  })

  it('reports a different reported version as version-drift', async () => {
    const h = await home()
    const bin = await fakeBin(join(toolRoot(h), 'gamma', 'bin'), 'gamma', 'echo "gamma 2.0.0"')
    await saveToolLock(h, { version: 1, tools: { gamma: entry({ bin }) } })
    const report = await doctor({ home: h, skills: [], ledgerLifecycle: new Map() })
    const found = report.tools.find((t) => t.toolId === 'gamma')
    expect(found).toMatchObject({ kind: 'version-drift', expectedVersion: '1.0.0', actualVersion: '2.0.0' })
  })

  it('reports a directory under the tool root with no lock entry as unlocked', async () => {
    const h = await home()
    await mkdir(join(toolRoot(h), 'delta'), { recursive: true })
    await saveToolLock(h, { version: 1, tools: {} })
    const report = await doctor({ home: h, skills: [], ledgerLifecycle: new Map() })
    expect(report.tools.find((t) => t.toolId === 'delta')?.kind).toBe('unlocked')
  })

  it("surfaces integrity 'none' as a warning that does not fail the report — R3.2b", async () => {
    const h = await home()
    const bin = await fakeBin(join(toolRoot(h), 'epsilon', 'bin'), 'epsilon', 'echo "1.0.0"')
    await saveToolLock(h, {
      version: 1,
      tools: { epsilon: entry({ bin, installKind: 'gh-release', integrity: 'none' }) },
    })
    const report = await doctor({ home: h, skills: [], ledgerLifecycle: new Map() })
    expect(report.tools.find((t) => t.toolId === 'epsilon')?.kind).toBe('integrity-unverified')
    expect(report.failed).toBe(false)
  })

  it('reports lifecycle drift between frontmatter and the ledger cache', async () => {
    const h = await home()
    await saveToolLock(h, { version: 1, tools: {} })
    const root = await makeRepo({
      files: {
        'declawed/SKILL.md': `---\nname: declawed\nmetadata:\n  version: 1.0.0\n  deprecated: true\n---\n`,
        'gap/SKILL.md': SKILL_MD('gap'),
      },
    })
    const skills = await discoverSkills({ id: 'r', path: root, name: 'r', isGit: false })
    const report = await doctor({
      home: h,
      skills,
      ledgerLifecycle: new Map([
        ['r/declawed', 'active'],
        ['r/gap', 'active'],
      ]),
    })
    expect(report.lifecycle).toEqual([
      { skillId: 'r/declawed', file: 'deprecated', ledger: 'active' },
    ])
    // A cache the file disagrees with is drift to report, not an error — R1.6.
    expect(report.failed).toBe(false)
  })

  it('probes exactly the runtimes the catalogue needs', async () => {
    const h = await home()
    await saveToolLock(h, { version: 1, tools: {} })
    const report = await doctor({
      home: h,
      skills: [],
      ledgerLifecycle: new Map(),
      exec: async (bin) => ({ stdout: `${bin} 1.0.0`, stderr: '' }),
    })
    const expected = runtimesFor(CATALOGUE).filter((runtime) => runtime !== 'none')
    expect(report.runtimes.map((r) => r.runtime).sort()).toEqual([...expected].sort())
    expect(report.runtimes.every((r) => r.present)).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/core/doctor.test.ts`
Expected: FAIL, cannot resolve `src/core/tools/doctor.js`.

- [ ] **Step 3: Teach the frontmatter parser about deprecation**

In `src/core/discovery/frontmatter.ts`, extend the interface, the `EMPTY` constant and the return:

```ts
export interface Frontmatter {
  name: string | null
  version: string | null
  /** R1.6: the file is the authority for lifecycle state; the ledger is a cache. */
  deprecated: boolean
}

const EMPTY: Frontmatter = { name: null, version: null, deprecated: false }
```

and the final return becomes:

```ts
  return {
    name: asString(record.name),
    version: asString(metadata.version),
    deprecated: metadata.deprecated === true,
  }
```

Then update the four whole-object assertions in `tests/core/frontmatter.test.ts` to include `deprecated: false`, and add one case:

```ts
  it('reads metadata.deprecated', () => {
    const src = '---\nname: x\nmetadata:\n  deprecated: true\n---\n'
    expect(parseFrontmatter(src)).toEqual({ name: 'x', version: null, deprecated: true })
  })
```

- [ ] **Step 4: Write the doctor engine**

`src/core/tools/doctor.ts`:

```ts
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { loadToolLock } from '../config/config.js'
import { parseFrontmatter } from '../discovery/frontmatter.js'
import type { SkillRef } from '../types.js'
import { CATALOGUE, catalogueEntry } from './catalogue.js'
import type { Exec } from './exec.js'
import { toolRoot, verifyTool } from './install.js'
import { type RuntimeStatus, probeRuntimes, runtimesFor } from './runtimes.js'

export type ToolDriftKind =
  | 'ok'
  | 'missing'
  | 'unverifiable'
  | 'version-drift'
  | 'unlocked'
  | 'integrity-unverified'

/** The four kinds R3.9 names are the ones that fail the report. */
const FAILING: ReadonlySet<ToolDriftKind> = new Set<ToolDriftKind>([
  'missing',
  'unverifiable',
  'version-drift',
  'unlocked',
])

export interface ToolFinding {
  toolId: string
  kind: ToolDriftKind
  expectedVersion: string | null
  actualVersion: string | null
  detail: string
}

export type LifecycleState = 'active' | 'deprecated'

export interface LifecycleFinding {
  skillId: string
  file: LifecycleState
  ledger: LifecycleState
}

export interface DoctorReport {
  runtimes: RuntimeStatus[]
  tools: ToolFinding[]
  lifecycle: LifecycleFinding[]
  failed: boolean
}

export interface DoctorInput {
  home: string
  /** Discovered by the caller, so `tools` needs neither discovery's I/O nor the ledger. */
  skills: readonly SkillRef[]
  ledgerLifecycle: ReadonlyMap<string, LifecycleState>
  exec?: Exec
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function installedDirs(home: string): Promise<string[]> {
  try {
    const entries = await readdir(toolRoot(home), { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

async function checkLockedTool(toolId: string, bin: string, expected: string, integrity: string) {
  if (!(await isFile(bin))) {
    return { kind: 'missing' as ToolDriftKind, actualVersion: null, detail: `${bin} is gone` }
  }
  let actual: string
  try {
    actual = await verifyTool({ bin }, catalogueEntry(toolId)?.versionArgv ?? ['--version'])
  } catch (err) {
    return {
      kind: 'unverifiable' as ToolDriftKind,
      actualVersion: null,
      detail: (err as Error).message,
    }
  }
  if (actual !== expected) {
    return {
      kind: 'version-drift' as ToolDriftKind,
      actualVersion: actual,
      detail: `locked ${expected}, reports ${actual}`,
    }
  }
  if (integrity === 'none') {
    return {
      kind: 'integrity-unverified' as ToolDriftKind,
      actualVersion: actual,
      detail: 'installed from an asset with no published checksum',
    }
  }
  return { kind: 'ok' as ToolDriftKind, actualVersion: actual, detail: '' }
}

/**
 * Frontmatter is the authority and the ledger a cache, so a divergence is drift
 * to report rather than an error to raise — R1.6. Reconciling the cache is M5's.
 */
async function lifecycleDrift(
  skills: readonly SkillRef[],
  cache: ReadonlyMap<string, LifecycleState>,
): Promise<LifecycleFinding[]> {
  const findings: LifecycleFinding[] = []
  for (const skill of skills) {
    const cached = cache.get(skill.id)
    if (!cached) continue
    let deprecated = false
    try {
      deprecated = parseFrontmatter(await readFile(join(skill.dir, 'SKILL.md'), 'utf8')).deprecated
    } catch {
      continue
    }
    const file: LifecycleState = deprecated ? 'deprecated' : 'active'
    if (file !== cached) findings.push({ skillId: skill.id, file, ledger: cached })
  }
  return findings
}

export async function doctor(input: DoctorInput): Promise<DoctorReport> {
  const lock = await loadToolLock(input.home)

  const tools: ToolFinding[] = []
  for (const [toolId, entry] of Object.entries(lock.tools)) {
    const checked = await checkLockedTool(toolId, entry.bin, entry.resolvedVersion, entry.integrity)
    tools.push({ toolId, expectedVersion: entry.resolvedVersion, ...checked })
  }

  for (const dir of await installedDirs(input.home)) {
    if (lock.tools[dir]) continue
    tools.push({
      toolId: dir,
      kind: 'unlocked',
      expectedVersion: null,
      actualVersion: null,
      detail: 'installed under the tool root but absent from the lock',
    })
  }

  return {
    runtimes: await probeRuntimes(runtimesFor(CATALOGUE), input.exec),
    tools,
    lifecycle: await lifecycleDrift(input.skills, input.ledgerLifecycle),
    failed: tools.some((finding) => FAILING.has(finding.kind)),
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/core/doctor.test.ts tests/core/frontmatter.test.ts && pnpm lint && pnpm test`
Expected: PASS everywhere.

- [ ] **Step 6: Commit**

```bash
git add src/core/tools/doctor.ts src/core/discovery/frontmatter.ts tests/core/doctor.test.ts tests/core/frontmatter.test.ts
git commit -m "feat(tools): report every drift kind from the lock and the tool root

R3.9's four kinds fail the report; an unverifiable checksum and lifecycle drift
are reported without failing, since neither means a tool cannot run."
```

---

### Task 7: `skillgantry doctor [--json]`

**Files:**
- Create: `src/cli/doctor-command.ts`
- Modify: `src/cli/run-command.ts`, `src/core/index.ts`
- Test: `tests/cli/doctor-command.test.ts`

**Interfaces:**
- Consumes: `doctor`, `DoctorReport` from core; `CliDeps`, `GantryProgram` from `run-command.ts`.
- Produces: `runDoctor(deps, opts)` returning `DoctorReport`; `formatDoctor(report)` returning lines.

- [ ] **Step 1: Export the M3 surface from core**

Append to `src/core/index.ts`:

```ts
export {
  CATALOGUE,
  PRESETS,
  RELEASE_TOOL_ID,
  catalogueEntry,
  catalogueIds,
  expandPreset,
  toolsForStage,
  type PresetName,
  type Runtime,
  type ToolSpec,
} from './tools/catalogue.js'
export { installTool, toolRoot, verifyTool } from './tools/install.js'
export {
  INSTALL_COMMAND,
  probeRuntimes,
  runtimesFor,
  type RuntimeStatus,
} from './tools/runtimes.js'
export {
  doctor,
  type DoctorInput,
  type DoctorReport,
  type LifecycleFinding,
  type LifecycleState,
  type ToolDriftKind,
  type ToolFinding,
} from './tools/doctor.js'
export { canonicalisePath, saveConfig, saveToolLock } from './config/config.js'
```

`loadConfig`, `loadToolLock` and `registerRepo` are already exported from `./config/config.js` on the existing line 6; re-exporting one of them again is a duplicate-export build error. `setup.ts` does not exist until Task 8, so its export block lands there.

- [ ] **Step 2: Write the failing test**

`tests/cli/doctor-command.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveToolLock } from '../../src/core/config/config.js'
import { buildProgram, type CliDeps } from '../../src/cli/run-command.js'

async function deps(): Promise<{ deps: CliDeps; lines: string[] }> {
  const home = await mkdtemp(join(tmpdir(), 'sg-doctor-cli-'))
  const lines: string[] = []
  return { deps: { home, dbPath: ':memory:', write: (line) => lines.push(line) }, lines }
}

describe('skillgantry doctor', () => {
  it('exits non-zero and names the drift when a locked tool is gone', async () => {
    const { deps: d, lines } = await deps()
    await saveToolLock(d.home, {
      version: 1,
      tools: {
        alpha: {
          installKind: 'uv-tool',
          requestedPin: 'v1',
          resolvedVersion: '1.0.0',
          bin: '/nonexistent/alpha',
          integrity: 'n/a',
          installedAt: '2026-08-01T00:00:00Z',
          verifiedAt: '2026-08-01T00:00:00Z',
        },
      },
    })
    const program = buildProgram(d)
    await program.parseAsync(['node', 'skillgantry', 'doctor'])
    expect(program.exitCode).toBe(1)
    expect(lines.join('\n')).toMatch(/alpha\s+missing/)
  })

  it('emits one JSON object with --json', async () => {
    const { deps: d, lines } = await deps()
    await saveToolLock(d.home, { version: 1, tools: {} })
    const program = buildProgram(d)
    await program.parseAsync(['node', 'skillgantry', 'doctor', '--json'])
    const report = JSON.parse(lines.join('')) as { tools: unknown[]; failed: boolean }
    expect(report.failed).toBe(false)
    expect(Array.isArray(report.tools)).toBe(true)
    expect(program.exitCode).toBe(0)
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm vitest run tests/cli/doctor-command.test.ts`
Expected: FAIL, `error: unknown command 'doctor'`.

- [ ] **Step 4: Write the command**

`src/cli/doctor-command.ts`:

```ts
import {
  discoverSkills,
  doctor,
  loadConfig,
  openLedger,
  type DoctorReport,
  type LifecycleState,
  type SkillRef,
} from '../core/index.js'
import type { CliDeps } from './run-command.js'

/** The ledger is read here, not in `tools`, which owns no sqlite dependency. */
function lifecycleCache(dbPath: string): ReadonlyMap<string, LifecycleState> {
  const ledger = openLedger(dbPath)
  try {
    const rows = ledger.db
      .prepare('select id, lifecycle_state as state from skills')
      .all() as Array<{ id: string; state: string }>
    return new Map(
      rows.map((row) => [row.id, row.state === 'deprecated' ? 'deprecated' : 'active'] as const),
    )
  } finally {
    ledger.close()
  }
}

export function formatDoctor(report: DoctorReport): string[] {
  const lines: string[] = []
  for (const runtime of report.runtimes) {
    lines.push(
      runtime.present
        ? `runtime ${runtime.runtime}  ${runtime.version}`
        : `runtime ${runtime.runtime}  missing — install with: ${runtime.installCommand}`,
    )
  }
  for (const tool of report.tools) {
    const detail = tool.detail ? `  ${tool.detail}` : ''
    lines.push(`${tool.toolId.padEnd(16)}${tool.kind}${detail}`)
  }
  for (const drift of report.lifecycle) {
    lines.push(`${drift.skillId.padEnd(16)}lifecycle-drift  file ${drift.file}, ledger ${drift.ledger}`)
  }
  lines.push(report.failed ? 'doctor: drift found' : 'doctor: no drift')
  return lines
}

export async function runDoctor(deps: CliDeps, opts: { json?: boolean }): Promise<DoctorReport> {
  const config = await loadConfig(deps.home)
  const skills: SkillRef[] = []
  for (const repo of config.repos) skills.push(...(await discoverSkills(repo)))
  const report = await doctor({
    home: deps.home,
    skills,
    ledgerLifecycle: lifecycleCache(deps.dbPath),
  })
  if (opts.json) deps.write(JSON.stringify(report))
  else for (const line of formatDoctor(report)) deps.write(line)
  return report
}
```

- [ ] **Step 5: Register it**

In `src/cli/run-command.ts`, add the import and the subcommand before the root `.option`/`.action` pair:

```ts
import { runDoctor } from './doctor-command.js'
```

```ts
  program
    .command('doctor')
    .description('re-verify every locked tool and report drift')
    .option('--json', 'emit one JSON report')
    .action(async (opts: { json?: boolean }) => {
      const report = await runDoctor(deps, opts)
      program.exitCode = report.failed ? 1 : 0
    })
```

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run tests/cli/doctor-command.test.ts && pnpm lint && pnpm build && pnpm test`
Expected: PASS everywhere.

- [ ] **Step 7: Commit**

```bash
git add src/cli/doctor-command.ts src/cli/run-command.ts src/core/index.ts tests/cli/doctor-command.test.ts
git commit -m "feat(cli): add the doctor subcommand

R12.5a. Exits non-zero on the four drift kinds that stop a tool running, zero
when the only findings are an unverifiable checksum or lifecycle drift."
```

---

### Task 8: The setup state machine

**Files:**
- Create: `src/core/tools/setup.ts`
- Modify: `src/core/index.ts`
- Test: `tests/core/setup.test.ts`

**Interfaces:**
- Consumes: `catalogueEntry`, `expandPreset`, `PRESETS`, `PresetName`, `ToolSpec`, `RuntimeStatus`, `runtimesFor`, `Stage`, `GantryConfig`.
- Produces: `SetupStateName`, `SETUP_ORDER`, `SetupState`, `InstallState`, `SetupAction`, `initialSetupState()`, `setupReducer(state, action)`, `canEnter(state, target)`, `missingRuntimesFor(selected, runtimes)`, `stageToolsFor(selected, isRunnable)`, `SetupDriver`.

- [ ] **Step 1: Write the failing test**

`tests/core/setup.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  SETUP_ORDER,
  canEnter,
  initialSetupState,
  missingRuntimesFor,
  setupReducer,
  stageToolsFor,
} from '../../src/core/tools/setup.js'
import type { RuntimeStatus } from '../../src/core/tools/runtimes.js'

const probed: RuntimeStatus[] = [
  { runtime: 'uv', present: true, version: '0.7.12', installCommand: 'x' },
  { runtime: 'npm', present: false, version: null, installCommand: 'y' },
]

describe('setup state machine', () => {
  it('orders the four states of R3.6', () => {
    expect(SETUP_ORDER).toEqual([
      'probe-runtimes',
      'select-tools',
      'install-and-verify',
      'credentials-and-repo',
      'done',
    ])
  })

  it('advances only once its state has what the next one needs', () => {
    let state = initialSetupState()
    expect(canEnter(state, 'select-tools')).toBe(false)
    state = setupReducer(state, { type: 'probed', runtimes: probed })
    expect(canEnter(state, 'select-tools')).toBe(true)
    expect(canEnter(state, 'install-and-verify')).toBe(false)
    state = setupReducer(state, { type: 'preset', name: 'minimal' })
    expect(canEnter(state, 'install-and-verify')).toBe(true)
  })

  // R3.6: doctor re-enters probe and install without the rest, and a user who
  // backs out of installing must be able to reselect.
  it('lets any state be re-entered once its prerequisite holds', () => {
    let state = initialSetupState()
    state = setupReducer(state, { type: 'probed', runtimes: probed })
    state = setupReducer(state, { type: 'preset', name: 'minimal' })
    state = setupReducer(state, { type: 'enter', state: 'install-and-verify' })
    state = setupReducer(state, { type: 'enter', state: 'select-tools' })
    expect(state.state).toBe('select-tools')
    expect(state.selected.length).toBeGreaterThan(0)
  })

  it('refuses to enter a state whose prerequisite is unmet', () => {
    const state = setupReducer(initialSetupState(), { type: 'enter', state: 'install-and-verify' })
    expect(state.state).toBe('probe-runtimes')
  })

  it('toggles a tool for per-stage choice — R3.8', () => {
    let state = setupReducer(initialSetupState(), { type: 'probed', runtimes: probed })
    state = setupReducer(state, { type: 'toggle', toolId: 'skillspector' })
    expect(state.selected).toContain('skillspector')
    state = setupReducer(state, { type: 'toggle', toolId: 'skillspector' })
    expect(state.selected).not.toContain('skillspector')
  })

  it('records install progress and failure per tool', () => {
    let state = setupReducer(initialSetupState(), { type: 'probed', runtimes: probed })
    state = setupReducer(state, { type: 'preset', name: 'minimal' })
    state = setupReducer(state, { type: 'installing', toolId: 'skillspector' })
    expect(state.installed.skillspector).toBe('installing')
    state = setupReducer(state, { type: 'installed', toolId: 'skillspector' })
    expect(state.installed.skillspector).toBe('ok')
    state = setupReducer(state, { type: 'install-failed', toolId: 'skill-up', error: 'boom' })
    expect(state.installed['skill-up']).toBe('failed')
    expect(state.errors['skill-up']).toBe('boom')
  })

  it('names the runtimes a selection needs but the host lacks — R3.7', () => {
    const missing = missingRuntimesFor(['skillspector'], [
      { runtime: 'uv', present: false, version: null, installCommand: 'curl … | sh' },
    ])
    expect(missing.map((r) => r.installCommand)).toEqual(['curl … | sh'])
  })
})

describe('stageToolsFor', () => {
  // AdapterStageExecutor.plan() throws on an id the registry does not hold, so
  // an installed tool with no parser must not reach stageTools.
  it('writes only runnable tools into the selection', () => {
    const tools = stageToolsFor(['skillspector', 'skill-lint'], (id) => id === 'skillspector')
    expect(tools.security).toEqual(['skillspector'])
    expect(tools.validate).toEqual([])
  })

  it('never writes the release installer, which no stage selects', () => {
    const tools = stageToolsFor(['skills'], () => true)
    expect(Object.values(tools).flat()).not.toContain('skills')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/core/setup.test.ts`
Expected: FAIL, cannot resolve `src/core/tools/setup.js`.

- [ ] **Step 3: Write the machine**

`src/core/tools/setup.ts`:

```ts
import type { GantryConfig } from '../config/schema.js'
import type { Stage } from '../types.js'
import { PRESETS, type PresetName, catalogueEntry } from './catalogue.js'
import { type RuntimeStatus, runtimesFor } from './runtimes.js'

export type SetupStateName =
  | 'probe-runtimes'
  | 'select-tools'
  | 'install-and-verify'
  | 'credentials-and-repo'
  | 'done'

export const SETUP_ORDER: readonly SetupStateName[] = [
  'probe-runtimes',
  'select-tools',
  'install-and-verify',
  'credentials-and-repo',
  'done',
]

export type InstallState = 'pending' | 'installing' | 'ok' | 'failed'

export interface SetupState {
  state: SetupStateName
  runtimes: readonly RuntimeStatus[]
  selected: readonly string[]
  installed: Readonly<Record<string, InstallState>>
  errors: Readonly<Record<string, string>>
  repoPath: string | null
  credentials: { present: boolean; warnings: readonly string[] } | null
}

export function initialSetupState(): SetupState {
  return {
    state: 'probe-runtimes',
    runtimes: [],
    selected: [],
    installed: {},
    errors: {},
    repoPath: null,
    credentials: null,
  }
}

export type SetupAction =
  | { type: 'probed'; runtimes: readonly RuntimeStatus[] }
  | { type: 'preset'; name: PresetName }
  | { type: 'toggle'; toolId: string }
  | { type: 'installing'; toolId: string }
  | { type: 'installed'; toolId: string }
  | { type: 'install-failed'; toolId: string; error: string }
  | { type: 'credentials'; present: boolean; warnings: readonly string[] }
  | { type: 'repo'; path: string }
  | { type: 'enter'; state: SetupStateName }

/**
 * Each state is independently re-enterable, which R3.6 requires and doctor
 * relies on: it reuses probe-runtimes and install-and-verify alone. Entry is
 * gated on the prerequisite rather than on having visited the previous state,
 * so backing out of an install to reselect keeps the selection.
 */
export function canEnter(state: SetupState, target: SetupStateName): boolean {
  switch (target) {
    case 'probe-runtimes':
      return true
    case 'select-tools':
      return state.runtimes.length > 0
    case 'install-and-verify':
      return state.selected.length > 0
    case 'credentials-and-repo':
      return state.selected.every((id) => state.installed[id] === 'ok')
    case 'done':
      return state.repoPath !== null
  }
}

export function setupReducer(state: SetupState, action: SetupAction): SetupState {
  switch (action.type) {
    case 'probed':
      return { ...state, runtimes: action.runtimes }
    case 'preset':
      return { ...state, selected: PRESETS[action.name], installed: {}, errors: {} }
    case 'toggle': {
      const selected = state.selected.includes(action.toolId)
        ? state.selected.filter((id) => id !== action.toolId)
        : [...state.selected, action.toolId]
      return { ...state, selected }
    }
    case 'installing':
      return { ...state, installed: { ...state.installed, [action.toolId]: 'installing' } }
    case 'installed':
      return { ...state, installed: { ...state.installed, [action.toolId]: 'ok' } }
    case 'install-failed':
      return {
        ...state,
        installed: { ...state.installed, [action.toolId]: 'failed' },
        errors: { ...state.errors, [action.toolId]: action.error },
      }
    case 'credentials':
      return { ...state, credentials: { present: action.present, warnings: action.warnings } }
    case 'repo':
      return { ...state, repoPath: action.path }
    case 'enter':
      return canEnter(state, action.state) ? { ...state, state: action.state } : state
  }
}

/** R3.7: named so the wizard can show the official command, never run it. */
export function missingRuntimesFor(
  selected: readonly string[],
  runtimes: readonly RuntimeStatus[],
): readonly RuntimeStatus[] {
  const needed = new Set(
    runtimesFor(selected.flatMap((id) => (catalogueEntry(id) ? [catalogueEntry(id)!] : []))),
  )
  return runtimes.filter((status) => needed.has(status.runtime) && !status.present)
}

const RUNNABLE_STAGES: readonly Stage[] = ['validate', 'evaluate', 'security', 'optimise']

/**
 * A selection is what a run may pick, so it holds only tools the adapter
 * registry knows: `AdapterStageExecutor.plan()` throws on an unknown id, which
 * would fail every run of that stage. An installed tool without a parser is
 * reported as installed and not yet runnable.
 */
export function stageToolsFor(
  selected: readonly string[],
  isRunnable: (toolId: string) => boolean,
): GantryConfig['stageTools'] {
  const tools = { validate: [], evaluate: [], security: [], optimise: [] } as {
    [K in (typeof RUNNABLE_STAGES)[number]]: string[]
  }
  for (const id of selected) {
    const spec = catalogueEntry(id)
    if (!spec?.stage || !isRunnable(id)) continue
    if (!RUNNABLE_STAGES.includes(spec.stage)) continue
    tools[spec.stage as (typeof RUNNABLE_STAGES)[number]].push(id)
  }
  return tools
}

/** The effects the wizard is not allowed to own; wired in src/cli. */
export interface SetupDriver {
  probe(): Promise<readonly RuntimeStatus[]>
  install(toolId: string): Promise<void>
  saveSelection(selected: readonly string[]): Promise<void>
  credentialStatus(): Promise<{ present: boolean; warnings: readonly string[] }>
  registerRepo(path: string): Promise<void>
}
```

- [ ] **Step 4: Export it**

Append to `src/core/index.ts`:

```ts
export {
  SETUP_ORDER,
  canEnter,
  initialSetupState,
  missingRuntimesFor,
  setupReducer,
  stageToolsFor,
  type InstallState,
  type SetupAction,
  type SetupDriver,
  type SetupState,
  type SetupStateName,
} from './tools/setup.js'
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/core/setup.test.ts && pnpm lint && pnpm build`
Expected: PASS, clean lint and build.

- [ ] **Step 6: Commit**

```bash
git add src/core/tools/setup.ts src/core/index.ts tests/core/setup.test.ts
git commit -m "feat(tools): add the re-enterable setup state machine

R3.6's four states gate on prerequisites rather than on history, so doctor can
re-enter probe and install alone and a user can back out to reselect."
```

---

### Task 9: The wizard screens

**Files:**
- Create: `src/tui/components/Setup.tsx`, `src/tui/setup-app.tsx`
- Modify: `src/tui/index.tsx`
- Test: `tests/tui/setup-wizard.test.tsx`

**Interfaces:**
- Consumes: `SetupState`, `SetupDriver`, `setupReducer`, `initialSetupState`, `canEnter`, `missingRuntimesFor`, `CATALOGUE`, `PRESETS` — all through `src/core/index.js`.
- Produces: `Setup({ state, cursor })`, `SetupApp({ driver, intervalMs? })`, `renderSetup(props)`.

- [ ] **Step 1: Write the failing test**

`tests/tui/setup-wizard.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { renderInk } from '../helpers/render-ink.js'
import { SetupApp } from '../../src/tui/setup-app.js'
import type { SetupDriver } from '../../src/core/index.js'

function fakeDriver(over: Partial<SetupDriver> = {}): { driver: SetupDriver; installed: string[] } {
  const installed: string[] = []
  const driver: SetupDriver = {
    probe: async () => [
      { runtime: 'uv', present: true, version: '0.7.12', installCommand: 'curl uv | sh' },
      { runtime: 'npm', present: true, version: '11.0.0', installCommand: 'nodejs.org' },
    ],
    install: async (toolId) => {
      installed.push(toolId)
    },
    saveSelection: async () => {},
    credentialStatus: async () => ({ present: true, warnings: [] }),
    registerRepo: async () => {},
    ...over,
  }
  return { driver, installed }
}

describe('setup wizard', () => {
  it('probes on mount and shows each runtime', async () => {
    const { driver } = fakeDriver()
    const ink = renderInk(<SetupApp driver={driver} />)
    await ink.settle(40)
    expect(ink.lastFrame()).toContain('uv')
    expect(ink.lastFrame()).toContain('0.7.12')
    ink.unmount()
  })

  it('shows the official install command for a missing runtime and never installs it', async () => {
    const { driver } = fakeDriver({
      probe: async () => [
        { runtime: 'uv', present: false, version: null, installCommand: 'curl -LsSf … | sh' },
      ],
    })
    const ink = renderInk(<SetupApp driver={driver} />)
    await ink.settle(40)
    expect(ink.lastFrame()).toContain('curl -LsSf … | sh')
    ink.unmount()
  })

  it('takes a preset and installs every tool in it', async () => {
    const { driver, installed } = fakeDriver()
    const ink = renderInk(<SetupApp driver={driver} />)
    await ink.settle(40)
    ink.stdin.send('\r') // probe-runtimes -> select-tools
    await ink.settle(20)
    ink.stdin.send('1') // minimal preset
    await ink.settle(20)
    ink.stdin.send('\r') // select-tools -> install-and-verify, which installs
    await ink.settle(120)
    expect(installed).toContain('skillspector')
    ink.unmount()
  })

  it('reports a failed install without leaving the state', async () => {
    const { driver } = fakeDriver({
      install: async (toolId) => {
        throw new Error(`no such pin for ${toolId}`)
      },
    })
    const ink = renderInk(<SetupApp driver={driver} />)
    await ink.settle(40)
    ink.stdin.send('\r')
    await ink.settle(20)
    ink.stdin.send('1')
    await ink.settle(20)
    ink.stdin.send('\r')
    await ink.settle(120)
    expect(ink.lastFrame()).toContain('failed')
    expect(ink.lastFrame()).toContain('no such pin')
    ink.unmount()
  })

  it('goes back to reselect without losing the selection', async () => {
    const { driver } = fakeDriver()
    const ink = renderInk(<SetupApp driver={driver} />)
    await ink.settle(40)
    ink.stdin.send('\r')
    await ink.settle(20)
    ink.stdin.send('1')
    await ink.settle(20)
    ink.stdin.send('\r')
    await ink.settle(120)
    ink.stdin.send('b')
    await ink.settle(20)
    expect(ink.lastFrame()).toContain('Select tools')
    ink.unmount()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/tui/setup-wizard.test.tsx`
Expected: FAIL, cannot resolve `src/tui/setup-app.js`.

- [ ] **Step 3: Write the pure renderer**

`src/tui/components/Setup.tsx`:

```tsx
import { Box, Text } from 'ink'
import { CATALOGUE, missingRuntimesFor, type SetupState } from '../../core/index.js'

const TITLE: Record<SetupState['state'], string> = {
  'probe-runtimes': 'Runtimes',
  'select-tools': 'Select tools',
  'install-and-verify': 'Install and verify',
  'credentials-and-repo': 'Credentials and repo',
  done: 'Done',
}

const MARK: Record<string, string> = { pending: '·', installing: '◐', ok: '●', failed: '×' }

export interface SetupProps {
  state: SetupState
  cursor: number
}

export function Setup({ state, cursor }: SetupProps): React.ReactElement {
  const missing = missingRuntimesFor(state.selected, state.runtimes)
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      <Text bold>
        SkillGantry setup — {TITLE[state.state]} ({state.state})
      </Text>

      {state.state === 'probe-runtimes' &&
        state.runtimes.map((runtime) => (
          <Text key={runtime.runtime}>
            {runtime.present ? '●' : '×'} {runtime.runtime}{' '}
            {runtime.present ? (
              <Text color="green">{runtime.version}</Text>
            ) : (
              // R3.7: shown, never run.
              <Text color="yellow">missing — install with: {runtime.installCommand}</Text>
            )}
          </Text>
        ))}

      {state.state === 'select-tools' && (
        <Box flexDirection="column">
          <Text dimColor>1 minimal · 2 recommended · 3 everything · space toggles</Text>
          {CATALOGUE.map((spec, index) => (
            <Text key={spec.id}>
              {index === cursor ? '›' : ' '}
              {state.selected.includes(spec.id) ? '*' : ' '} {spec.displayName}{' '}
              <Text dimColor>({spec.stage ?? 'release gate'})</Text>
            </Text>
          ))}
        </Box>
      )}

      {state.state === 'install-and-verify' &&
        state.selected.map((id) => (
          <Text key={id}>
            {MARK[state.installed[id] ?? 'pending']} {id}
            {state.installed[id] === 'failed' ? (
              <Text color="red"> failed — {state.errors[id]}</Text>
            ) : null}
          </Text>
        ))}

      {state.state === 'credentials-and-repo' && (
        <Box flexDirection="column">
          <Text>
            credentials: {state.credentials?.present ? '~/.skillgantry/.env found' : 'no .env yet'}
          </Text>
          {(state.credentials?.warnings ?? []).map((warning) => (
            <Text key={warning} color="yellow">
              {warning}
            </Text>
          ))}
          <Text>repo: {state.repoPath ?? 'type a path, then enter'}</Text>
          <Text dimColor>while typing a path, esc goes back — letters are text, not commands</Text>
        </Box>
      )}

      {state.state === 'done' && <Text color="green">Toolchain verified. Press q to leave.</Text>}

      {missing.length > 0 && (
        <Text color="yellow">
          {missing.length} runtime(s) missing for this selection — install them and press p
        </Text>
      )}
      <Text dimColor>enter advance · b back · p re-probe · q quit</Text>
    </Box>
  )
}
```

- [ ] **Step 4: Write the shell that owns the driver**

`src/tui/setup-app.tsx`:

```tsx
import { useEffect, useReducer, useState } from 'react'
import { useApp, useInput } from 'ink'
import {
  CATALOGUE,
  SETUP_ORDER,
  canEnter,
  initialSetupState,
  setupReducer,
  type SetupDriver,
  type SetupStateName,
} from '../core/index.js'
import { Setup } from './components/Setup.js'

export interface SetupAppProps {
  driver: SetupDriver
}

const PRESET_KEY: Record<string, 'minimal' | 'recommended' | 'everything'> = {
  '1': 'minimal',
  '2': 'recommended',
  '3': 'everything',
}

export function SetupApp({ driver }: SetupAppProps): React.ReactElement {
  const [state, dispatch] = useReducer(setupReducer, undefined, initialSetupState)
  const [cursor, setCursor] = useState(0)
  const [path, setPath] = useState('')
  const { exit } = useApp()

  const probe = (): void => {
    void driver.probe().then((runtimes) => dispatch({ type: 'probed', runtimes }))
  }

  useEffect(probe, [driver])

  /** Sequential: two package managers writing one tool root is not worth it. */
  const installAll = async (ids: readonly string[]): Promise<void> => {
    for (const id of ids) {
      dispatch({ type: 'installing', toolId: id })
      try {
        await driver.install(id)
        dispatch({ type: 'installed', toolId: id })
      } catch (err) {
        dispatch({ type: 'install-failed', toolId: id, error: (err as Error).message })
      }
    }
    await driver.saveSelection(ids)
    const credentials = await driver.credentialStatus()
    dispatch({ type: 'credentials', ...credentials })
  }

  const advance = (): void => {
    const next = SETUP_ORDER[SETUP_ORDER.indexOf(state.state) + 1] as SetupStateName | undefined
    if (!next) return
    if (next === 'install-and-verify' && canEnter(state, next)) {
      dispatch({ type: 'enter', state: next })
      void installAll(state.selected)
      return
    }
    if (next === 'done' && path.length > 0) {
      void driver.registerRepo(path).then(() => {
        dispatch({ type: 'repo', path })
        dispatch({ type: 'enter', state: 'done' })
      })
      return
    }
    dispatch({ type: 'enter', state: next })
  }

  const back = (): void => {
    const previous = SETUP_ORDER[Math.max(0, SETUP_ORDER.indexOf(state.state) - 1)] as SetupStateName
    dispatch({ type: 'enter', state: previous })
  }

  useInput((input, key) => {
    // Text entry is handled before any single-letter command, because a repo
    // path contains 'b', 'p' and 'q' and would otherwise steer the wizard.
    if (state.state === 'credentials-and-repo') {
      if (key.return) advance()
      else if (key.escape) back()
      else if (key.backspace || key.delete) setPath((p) => p.slice(0, -1))
      else if (input.length === 1 && !key.ctrl && !key.meta) setPath((p) => p + input)
      return
    }
    if (input === 'q') {
      exit()
      return
    }
    if (input === 'p') {
      probe()
      return
    }
    if (input === 'b') {
      back()
      return
    }
    if (key.return) {
      advance()
      return
    }
    if (state.state === 'select-tools') {
      // Bound to a local first: an element access on a non-literal key is not
      // narrowed under noUncheckedIndexedAccess.
      const preset = PRESET_KEY[input]
      if (preset) {
        dispatch({ type: 'preset', name: preset })
        return
      }
      if (input === 'j' || key.downArrow) {
        setCursor((c) => Math.min(CATALOGUE.length - 1, c + 1))
        return
      }
      if (input === 'k' || key.upArrow) {
        setCursor((c) => Math.max(0, c - 1))
        return
      }
      if (input === ' ') {
        const spec = CATALOGUE[cursor]
        if (spec) dispatch({ type: 'toggle', toolId: spec.id })
      }
    }
  })

  return <Setup state={state} cursor={cursor} />
}
```

- [ ] **Step 5: Export the renderer**

Append to `src/tui/index.tsx`:

```tsx
import { SetupApp, type SetupAppProps } from './setup-app.js'

/** Resolves when the user leaves the wizard. The caller owns the driver. */
export async function renderSetup(props: SetupAppProps): Promise<void> {
  const instance = render(<SetupApp {...props} />)
  await instance.waitUntilExit()
}

export type { SetupAppProps } from './setup-app.js'
```

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run tests/tui/setup-wizard.test.tsx && pnpm lint && pnpm build`
Expected: PASS, clean lint (in particular no deep core import from `src/tui/**`), clean build.

- [ ] **Step 7: Commit**

```bash
git add src/tui/components/Setup.tsx src/tui/setup-app.tsx src/tui/index.tsx tests/tui/setup-wizard.test.tsx
git commit -m "feat(tui): add the setup wizard over the four setup states

The wizard renders state and calls an injected driver; it owns no install path,
which is how R3.7's no-silent-runtime-install rule is enforced structurally."
```

---

### Task 10: Wire setup into the CLI, and route first run to it

**Files:**
- Create: `src/cli/setup-command.ts`
- Modify: `src/cli/run-command.ts`
- Test: `tests/cli/setup-command.test.ts`

**Interfaces:**
- Consumes: `installTool`, `catalogueEntry`, `probeRuntimes`, `runtimesFor`, `CATALOGUE`, `loadConfig`, `saveConfig`, `loadEnvFile`, `registerRepo`, `stageToolsFor`, `getAdapter` — via `src/core/index.js`.
- Produces: `buildSetupDriver(home)`, `startSetup(options: SetupOptions)`, `needsSetup(home)`; `CliDeps.startSetup?` seam.

- [ ] **Step 1: Write the failing test**

`tests/cli/setup-command.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, mkdir, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, saveConfig, saveToolLock, DEFAULT_CONFIG } from '../../src/core/config/config.js'
import { buildProgram, type CliDeps } from '../../src/cli/run-command.js'
import { buildSetupDriver, needsSetup } from '../../src/cli/setup-command.js'
import { makeRepo, SKILL_MD } from '../helpers/tmp-repo.js'

const home = (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-setup-cli-'))

describe('first-run routing', () => {
  it('launches setup when nothing is registered and nothing is locked', async () => {
    const h = await home()
    expect(await needsSetup(h)).toBe(true)
  })

  it('does not launch setup once a repo is registered', async () => {
    const h = await home()
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    await saveConfig(h, {
      ...DEFAULT_CONFIG,
      repos: [{ id: 'r', path: root, name: 'r', isGit: false }],
    })
    expect(await needsSetup(h)).toBe(false)
  })

  it('routes the bare command to setup on a clean machine and to the TUI otherwise', async () => {
    const h = await home()
    const calls: string[] = []
    const deps: CliDeps = {
      home: h,
      dbPath: ':memory:',
      write: () => {},
      startTui: async () => {
        calls.push('tui')
      },
      startSetup: async () => {
        calls.push('setup')
      },
    }
    await buildProgram(deps).parseAsync(['node', 'skillgantry'])
    expect(calls).toEqual(['setup'])

    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    await saveConfig(h, {
      ...DEFAULT_CONFIG,
      repos: [{ id: 'r', path: root, name: 'r', isGit: false }],
    })
    await buildProgram(deps).parseAsync(['node', 'skillgantry'])
    expect(calls).toEqual(['setup', 'tui'])
  })

  it('enters the wizard explicitly even when setup is complete', async () => {
    const h = await home()
    await saveToolLock(h, { version: 1, tools: {} })
    const calls: string[] = []
    const deps: CliDeps = {
      home: h,
      dbPath: ':memory:',
      write: () => {},
      startTui: async () => calls.push('tui') as unknown as void,
      startSetup: async () => calls.push('setup') as unknown as void,
    }
    await buildProgram(deps).parseAsync(['node', 'skillgantry', 'setup'])
    expect(calls).toEqual(['setup'])
  })
})

describe('setup driver', () => {
  it('writes a selection holding only runnable tools, and registers the repo', async () => {
    const h = await home()
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    const driver = buildSetupDriver(h)

    await driver.saveSelection(['skillspector', 'promptfoo'])
    await driver.registerRepo(root)

    const config = await loadConfig(h)
    expect(config.stageTools.security).toEqual(['skillspector'])
    // promptfoo installs in M3 and gains its parser in M4, so it must not be
    // selected: AdapterStageExecutor.plan() throws on an unknown id.
    expect(config.stageTools.evaluate).toEqual([])
    expect(config.repos.map((r) => r.name)).toEqual([root.split('/').at(-1)])
  })

  it('reports the credential file and its mode warning', async () => {
    const h = await home()
    await mkdir(h, { recursive: true })
    const file = join(h, '.env')
    await writeFile(file, 'ANTHROPIC_AUTH_TOKEN=0123456789abcdef\n')
    await chmod(file, 0o644)
    const status = await buildSetupDriver(h).credentialStatus()
    expect(status.present).toBe(true)
    expect(status.warnings.join(' ')).toMatch(/more permissive than 600/)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/cli/setup-command.test.ts`
Expected: FAIL, cannot resolve `src/cli/setup-command.js`.

- [ ] **Step 3: Write the wiring**

`src/cli/setup-command.ts`:

```ts
import { getAdapter } from '../core/adapters/registry.js'
import {
  CATALOGUE,
  catalogueEntry,
  installTool,
  loadConfig,
  loadEnvFile,
  loadToolLock,
  probeRuntimes,
  registerRepo,
  runtimesFor,
  saveConfig,
  stageToolsFor,
  type SetupDriver,
} from '../core/index.js'
import { renderSetup } from '../tui/index.js'

export interface SetupOptions {
  home: string
}

/** A clean machine has no repo and no locked tool. */
export async function needsSetup(home: string): Promise<boolean> {
  const [config, lock] = await Promise.all([loadConfig(home), loadToolLock(home)])
  return config.repos.length === 0 && Object.keys(lock.tools).length === 0
}

/**
 * The single place config, the lockfile, the install drivers and the credential
 * file meet — the same role `tui-command.ts` plays for the Work screen, and the
 * reason `src/tui/**` needs neither subprocess nor sqlite.
 */
export function buildSetupDriver(home: string): SetupDriver {
  return {
    probe: () => probeRuntimes(runtimesFor(CATALOGUE)),

    install: async (toolId) => {
      const spec = catalogueEntry(toolId)
      if (!spec) throw new Error(`not in the catalogue: ${toolId}`)
      await installTool(home, spec)
    },

    saveSelection: async (selected) => {
      const config = await loadConfig(home)
      await saveConfig(home, {
        ...config,
        stageTools: stageToolsFor(selected, (id) => getAdapter(id) !== undefined),
      })
    },

    credentialStatus: async () => {
      const env = await loadEnvFile(home)
      return { present: env.present, warnings: env.warnings }
    },

    registerRepo: async (path) => {
      await registerRepo(home, path)
    },
  }
}

export async function startSetup(options: SetupOptions): Promise<void> {
  await renderSetup({ driver: buildSetupDriver(options.home) })
}
```

- [ ] **Step 4: Register the subcommand and route the bare invocation**

In `src/cli/run-command.ts`:

```ts
import { needsSetup, startSetup, type SetupOptions } from './setup-command.js'
```

Extend `CliDeps`:

```ts
  /** Test seam. Defaults to the real wizard. */
  startSetup?: (options: SetupOptions) => Promise<void>
```

Add the subcommand beside `doctor`:

```ts
  program
    .command('setup')
    .description('probe runtimes, install tools, write credentials and register a repo')
    .action(async () => {
      await (deps.startSetup ?? startSetup)({ home: deps.home })
    })
```

and replace the root action body so a clean machine lands in the wizard:

```ts
    .action(async (opts: { concurrency?: number }) => {
      // Commander runs this only when no subcommand matched. R3.6 calls this
      // first-run setup, and a Work screen over no repos and no tools is empty.
      if (await needsSetup(deps.home)) {
        await (deps.startSetup ?? startSetup)({ home: deps.home })
        return
      }
      const launch = deps.startTui ?? startTui
      await launch({
        home: deps.home,
        dbPath: deps.dbPath,
        ...(opts.concurrency === undefined ? {} : { concurrency: opts.concurrency }),
      })
    })
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/cli && pnpm lint && pnpm build && pnpm test`
Expected: PASS everywhere, including M2's `tests/cli/tui-command.test.ts`, which registers a repo before asserting the launch.

If `tui-command.test.ts` now lands in the wizard, its fixture has no repo. Fix the test by registering its fixture repo in the config it builds, not by weakening `needsSetup` — the routing rule is the deliverable.

- [ ] **Step 6: Commit**

```bash
git add src/cli/setup-command.ts src/cli/run-command.ts tests/cli/setup-command.test.ts
git commit -m "feat(cli): add the setup subcommand and route first run to it

The driver is the only place installs, config and the credential file meet, and
a selection is filtered through the adapter registry so no run can pick a tool
whose output nothing parses."
```

---

### Task 11: M3 acceptance suite and the real-install matrix

**Files:**
- Create: `tests/acceptance/m3.test.tsx`
- Modify: `vitest.config.ts`, `package.json`, `tests/core/install.test.ts`
- Test: itself

**Interfaces:**
- Consumes: everything above.
- Produces: `pnpm acceptance` covering both M3 exit criteria; `pnpm test:integration` covering all three drivers against real indexes.

- [ ] **Step 1: Write the acceptance suite**

`tests/acceptance/m3.test.tsx`. One test per exit criterion in the requirements milestone table.

```tsx
import { describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_CONFIG,
  loadConfig,
  loadToolLock,
  saveConfig,
  saveToolLock,
} from '../../src/core/config/config.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { toolRoot } from '../../src/core/tools/install.js'
import type { SetupDriver } from '../../src/core/index.js'
import { doctor } from '../../src/core/tools/doctor.js'
import { SetupApp } from '../../src/tui/setup-app.js'
import { renderInk } from '../helpers/render-ink.js'
import { makeRepo, SKILL_MD } from '../helpers/tmp-repo.js'
import { buildSetupDriver } from '../../src/cli/setup-command.js'

const home = (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-m3-'))

async function fakeInstalled(h: string, toolId: string, version: string): Promise<string> {
  const dir = join(toolRoot(h), toolId, 'bin')
  await mkdir(dir, { recursive: true })
  const bin = join(dir, toolId)
  await writeFile(bin, `#!/bin/sh\necho "${toolId} ${version}"\n`)
  await chmod(bin, 0o755)
  return bin
}

describe('M3 exit criterion: a clean machine reaches a verified toolchain through the wizard alone', () => {
  it('probes, selects a preset, installs, verifies, writes the selection and registers a repo', async () => {
    const h = await home()
    const repo = await makeRepo({ files: { 'declawed/SKILL.md': SKILL_MD('declawed') } })

    // Only the network is stubbed: config, the lock, verification and the state
    // machine are the real ones.
    const real = buildSetupDriver(h)
    const driver: SetupDriver = {
      ...real,
      probe: async () => [
        { runtime: 'uv', present: true, version: '0.7.12', installCommand: 'x' },
        { runtime: 'npm', present: true, version: '11.0.0', installCommand: 'y' },
      ],
      install: async (toolId) => {
        const bin = await fakeInstalled(h, toolId, '1.0.0')
        const lock = await loadToolLock(h)
        await saveToolLock(h, {
          ...lock,
          tools: {
            ...lock.tools,
            [toolId]: {
              installKind: 'uv-tool',
              requestedPin: 'v1.0.0',
              resolvedVersion: '1.0.0',
              bin,
              integrity: 'n/a',
              installedAt: new Date().toISOString(),
              verifiedAt: new Date().toISOString(),
            },
          },
        })
      },
    }

    const ink = renderInk(<SetupApp driver={driver} />)
    await ink.settle(40)
    ink.stdin.send('\r')
    await ink.settle(20)
    ink.stdin.send('1')
    await ink.settle(20)
    ink.stdin.send('\r')
    await ink.settle(200)
    ink.stdin.send('\r')
    await ink.settle(40)
    for (const ch of repo) ink.stdin.send(ch)
    await ink.settle(60)
    ink.stdin.send('\r')
    await ink.settle(80)

    const lock = await loadToolLock(h)
    expect(Object.keys(lock.tools)).toContain('skillspector')
    for (const entry of Object.values(lock.tools)) {
      expect(entry.verifiedAt).not.toBeNull()
      expect(entry.bin.startsWith(toolRoot(h))).toBe(true)
    }

    const config = await loadConfig(h)
    expect(config.repos).toHaveLength(1)
    expect(config.stageTools.security).toEqual(['skillspector'])

    const report = await doctor({
      home: h,
      skills: await discoverSkills(config.repos[0]!),
      ledgerLifecycle: new Map(),
    })
    expect(report.failed).toBe(false)
    ink.unmount()
  })
})

describe('M3 exit criterion: doctor reports all four drift kinds plus integrity and lifecycle drift', () => {
  it('reports six conditions from one home', async () => {
    const h = await home()
    const good = await fakeInstalled(h, 'gamma', '2.0.0')
    const broken = await fakeInstalled(h, 'beta', '1.0.0')
    await writeFile(broken, '#!/bin/sh\nexit 1\n')
    await chmod(broken, 0o755)
    const unverified = await fakeInstalled(h, 'epsilon', '1.0.0')
    await mkdir(join(toolRoot(h), 'delta'), { recursive: true })

    const stub = (bin: string, integrity = 'n/a') => ({
      installKind: 'uv-tool' as const,
      requestedPin: 'v1.0.0',
      resolvedVersion: '1.0.0',
      bin,
      integrity,
      installedAt: '2026-08-01T00:00:00Z',
      verifiedAt: '2026-08-01T00:00:00Z',
    })

    await saveToolLock(h, {
      version: 1,
      tools: {
        alpha: stub('/nonexistent/alpha'),
        beta: stub(broken),
        gamma: stub(good),
        epsilon: stub(unverified, 'none'),
      },
    })

    const repo = await makeRepo({
      files: {
        'declawed/SKILL.md':
          '---\nname: declawed\nmetadata:\n  version: 1.0.0\n  deprecated: true\n---\n',
      },
    })
    const repoRef = { id: 'r', path: repo, name: 'r', isGit: false }
    await saveConfig(h, { ...DEFAULT_CONFIG, repos: [repoRef] })

    const report = await doctor({
      home: h,
      skills: await discoverSkills(repoRef),
      ledgerLifecycle: new Map([['r/declawed', 'active']]),
    })

    const kind = (id: string) => report.tools.find((t) => t.toolId === id)?.kind
    expect(kind('alpha')).toBe('missing')
    expect(kind('beta')).toBe('unverifiable')
    expect(kind('gamma')).toBe('version-drift')
    expect(kind('delta')).toBe('unlocked')
    expect(kind('epsilon')).toBe('integrity-unverified')
    expect(report.lifecycle).toEqual([
      { skillId: 'r/declawed', file: 'deprecated', ledger: 'active' },
    ])
    expect(report.failed).toBe(true)
  })
})
```

- [ ] **Step 2: Run the acceptance suite**

Run: `pnpm acceptance`
Expected: PASS, M1 and M2 suites included and still green.

- [ ] **Step 3: Extend the integration suite to all three drivers**

Append to `tests/core/install.test.ts` one case per remaining driver, using the catalogue rather than literals so a pin correction in Task 1 flows through:

```ts
import { catalogueEntry } from '../../src/core/tools/catalogue.js'
import { installTool } from '../../src/core/tools/install.js'

describe('installTool against real indexes', () => {
  it('installs every catalogued tool into the tool root and verifies it', async () => {
    for (const spec of CATALOGUE) {
      const h = await home()
      const entry = await installTool(h, spec)
      expect(entry.bin.startsWith(toolRoot(h))).toBe(true)
      expect(entry.resolvedVersion.length).toBeGreaterThan(0)
      if (spec.install.kind === 'gh-release' && spec.install.integrity.kind !== 'none') {
        expect(entry.integrity.startsWith('sha256:')).toBe(true)
      }
    }
  }, 900_000)

  it('leaves nothing in the user-global uv tool directory', async () => {
    const spec = catalogueEntry('skillspector')
    const h = await home()
    await installTool(h, spec!)
    await expect(stat(join(process.env.HOME ?? '', '.local/share/uv/tools/skillspector'))).rejects.toThrow()
  }, 300_000)
})
```

- [ ] **Step 4: Widen the integration script**

In `package.json`, change `test:integration` so the whole install suite runs:

```json
"test:integration": "SG_INTEGRATION=1 SG_ACCEPTANCE=1 vitest run tests/core/install.test.ts tests/acceptance"
```

- [ ] **Step 5: Run everything**

Run: `pnpm check`
Expected: lint, build, offline tests and acceptance all pass.

Then, on a machine with network: `pnpm test:integration`. Every catalogue entry must install and verify. A tool that fails here is a wrong pin or a wrong identity — correct the catalogue and rerun. A tool that cannot be made to install goes in the Deviations section below and out of `CATALOGUE` and `PRESETS`.

- [ ] **Step 6: Commit**

```bash
git add tests/acceptance/m3.test.tsx tests/core/install.test.ts vitest.config.ts package.json
git commit -m "test: demonstrate every M3 exit criterion

The wizard reaches a verified toolchain over real config, lock and verification
with only the network stubbed; doctor reports six conditions from one home; the
integration suite installs every catalogued tool for real."
```

---

## Requirement coverage for M3

Every requirement M3 owns, and the task that satisfies it. A requirement with no task is a plan defect.

| Requirement | Task |
|---|---|
| R3.2 native install mechanism per language | 3 (npm-prefix), 4 (gh-release), 5 (dispatch), 11 (real installs) |
| R3.2b declared gh-release integrity, mismatch fails, `none` recorded and surfaced | 4 (driver and its four integrity cases), 5 (integrity into the lock), 6 (`integrity-unverified`) |
| R3.5 catalogue entry per tool, installable and verifiable | 1 (catalogue and amendment), 5, 11 |
| R3.5a vercel `skills` installed, nine in total | 1 (`RELEASE_TOOL_ID`, in every preset), 11 |
| R3.6 four re-enterable setup states | 8 (machine and `canEnter`), 9 (wizard), 10 (first-run routing) |
| R3.7 missing runtime shows its official command, never installs | 2 (`INSTALL_COMMAND`, probe-only), 8 (`missingRuntimesFor`), 9 (the frame that shows it) |
| R3.8 Minimal, Recommended, Everything plus per-stage choice | 1 (`PRESETS` and their properties), 9 (`1`/`2`/`3` and space-toggle) |
| R3.9 doctor re-verifies and reports four drift kinds | 6 (engine), 7 (subcommand), 11 (all four in one report) |
| R12.5a `doctor` as a headless subcommand | 7 |

**Owned elsewhere but shaped here.** R1.6's authority rule is M5's; M3 implements only the `lifecycle-drift` *report* §13 assigns to doctor, and adds the `deprecated` frontmatter field that reconciliation will need (Task 6). R3.1, R3.3 and R3.4 are M1's and are extended, not restated: two more drivers now land under the tool root, write a resolved `bin`, and verify by invocation before locking. R4.5's "adding a tool touches nothing else" is M1's and is exercised here — nine tools install with no change to pipeline, runner, ledger or the Work screen.

**Deferred within M3, with reasons.** The seven remaining parsers are R3.5b and M4's, per the Task 1 amendment. Doctor does not offer to repair drift; R3.9 requires reporting, and repair is re-entering `install-and-verify`, which the wizard already does. The Tools top-level screen is R11.3 and M6; the wizard is reached by `skillgantry setup` and by first run.

## Known gaps carried forward

Recorded so they are not mistaken for oversights.

- **A tool whose `--version` prints no patch component fails verification.** `verifyTool`'s semver regex is M1's, and doctor will label such a tool `unverifiable`. If Task 1's probe finds one, widen the regex in that task and say so here.
- **`stageTools` after a preset holds only skillspector.** Everything else installs in M3 and becomes selectable in M4 with R3.5b. The wizard says so; the acceptance test asserts it.
- **Sequential installs.** The wizard installs one tool at a time. Two package managers writing one tool root concurrently buys seconds and costs a class of failure that is tedious to reproduce.
- **No credential *writing*.** R3.6's fourth state is "write credentials and register a repo"; the wizard reports `.env` presence and its mode warning and registers the repo, but does not write secrets. R7.3 forbids SkillGantry writing credentials to any file, so the state can only ever report on a file the user owns.
- **R13.7's mechanical coverage check does not exist yet.** M1's coverage table lists it as satisfied by the design-example test, which checks one manifest against one design section. Task 1 edits the ownership table by hand, so that gap now matters more; it belongs to whichever milestone next touches traceability.

## Self-review

**Spec coverage.** Every requirement in the M3 row of the ownership table maps to a task. R3.5 required an amendment before it could be implemented at all; the amendment, its rationale and the new R3.5b are in Task 1 rather than assumed.

**Placeholders.** One task deliberately produces data this plan cannot know: Task 1 Step 2 probes the nine tools' real identities and pins. It carries the exact command per tool, the shape of a completed entry, and a defined failure path, and its definition of done is a passing real install in Task 11. Everything else ships code as written. No task says TBD, "similar to Task N", or "add appropriate error handling".

**Type consistency.** `ToolSpec` is defined in Task 1 and consumed unchanged in Tasks 2, 5, 6, 8 and 10. `Exec` is defined once in Task 2 and injected in Tasks 3, 4, 5 and 6. `installTool(home, spec, options)` keeps that signature in Tasks 5, 10 and 11; `installAndLock(home, uvSpec, versionArgv)` keeps M1's. `verifyTool(entry, versionArgv)` widens its second parameter to `readonly string[]` in Task 5, which is source-compatible with M1's caller. `RuntimeStatus` is produced by Task 2 and consumed by Tasks 6, 8 and 9. `SetupDriver` is declared in core in Task 8, implemented in Task 10, faked in Tasks 9 and 11. `doctor(input)` takes `DoctorInput` in Tasks 6, 7 and 11, and `ledgerLifecycle` is a `ReadonlyMap` in all three. `stageToolsFor(selected, isRunnable)` takes the same two parameters in Tasks 8 and 10.

**Scope.** Eleven tasks, one milestone, one deliverable: `skillgantry` on a clean machine walks a user to a verified toolchain, and `skillgantry doctor` tells them when it has drifted.

## Deviations found while implementing

Recorded during execution, as plan-m1 and plan-m2 do.

### Task 1 Step 2 — three of D7's tools are not installable, so the catalogue holds six

Probe date 2026-08-01. `uv pip index versions` does not exist in uv 0.7.12 (`error: unrecognized subcommand 'index'`), so PyPI was probed through `https://pypi.org/pypi/<name>/json` instead.

| Tool | Probe result | Catalogue entry |
|---|---|---|
| skill-lint | `npm view skill-lint version` → `0.2.0`, repo `LichAmnesia/skill-lint`, bin `skill-lint`; installed into a temp prefix, `--version` → `0.2.0` | `npm-prefix`, pin `0.2.0` |
| promptfoo | `npm view promptfoo version` → `0.121.20`, bins `promptfoo`, `pf` | `npm-prefix`, pin `0.121.20` |
| skills (vercel) | `npm view skills version` → `1.5.21`, repo `vercel-labs/skills`, bin `skills`; `--version` → `1.5.21`. `@vercel/skills` is 404 | `npm-prefix`, pin `1.5.21`, `stage: null` |
| skill-up | `gh search` → `alibaba/skill-up` (Go). Latest release `v0.7.0` publishes `skill-up_0.7.0_{os}_{arch}.tar.gz` for darwin/linux/windows × amd64/arm64 plus `skill-up_0.7.0_checksums.txt`; README documents `skill-up --version` | `gh-release`, pin `v0.7.0`, integrity `sha256-asset` |
| skill-scanner | PyPI `0.3.3`, summary "Security scanner for detecting and remediating malicious AI agent skills"; installed via `uv tool install skill-scanner==0.3.3`, bins `skill-scanner` and `skillscan`, `--version` → `0.3.3` | `uv-tool`, pin `0.3.3` |
| SkillSpector | known; copied verbatim from `src/core/adapters/skillspector.ts`. `git ls-remote --tags NVIDIA/skillspector` confirms `v2.5.1` | `uv-tool`, pin `v2.5.1` |
| **SkillOpt** | PyPI `0.2.0`, `microsoft/SkillOpt`. Installed successfully, but its three entry points — `skillopt-train`, `skillopt-eval`, `skillopt-sleep` — are argparse research scripts and **none accepts `--version`**: each answers with a usage error. There is no unified `skillopt` executable. **Omitted** | none |
| **SkillHone** | Not on PyPI, not on npm. `Tencent/SkillHone` is a skills-and-docs repo: no `pyproject.toml`, no `setup.py`, no tags. **Omitted** | none |
| **agentskills** | Not on PyPI, not on npm (`npm view agentskills` → 404). `agentskills/agentskills` is the specification/docs repo: `package.json` is `"private": true` with one `dev` script, no `bin`, no tags. **Omitted** | none |

Consequences, all recorded in the specs rather than left implicit:

- Optimise has no catalogued tool, so no preset carries one. §5.3's preset paragraph was rewritten accordingly; the previous wording named `skillopt` and "all eight".
- Verify-by-invocation is what rejected SkillOpt. A tool whose executables cannot answer a version argv cannot be locked, since M1's rule is that no lock entry is written before the executable answers. Carrying it would have made every wizard run show a failed install.
- `promptfoo --version` was not probed by installing it; the package is large and its `--version` flag is long-standing. Task 11's integration run is what confirms it.


## Changelog

- 2026-08-01 — revision 1, written against design.md revision 3 and requirements.md revision 3.
