# SkillGantry M6 Extension — Editable Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** implemented and shipped 2026-08-04, on branch `feat/m6-settings-edit`. Written against [design.md](design.md) §14.2, [requirements.md](requirements.md) revision 8 (R11.7, R11.8) and shipped M1–M6. Owned by M6; the summary of these tasks lives in [plan-m6.md § Extension: editable Settings](plan-m6.md#extension-editable-settings), which this document is the executable form of.

**Goal:** The Settings screen names every setting, its value and the file that holds it, and lets a user change any configurable field from the TUI — through the setup states that already own tool selection and repo registration, and through one staged document that reaches disk only as a confirmed change set.

**Architecture:** One staged `GantryConfig` lives in the TUI store. Three edit paths mutate it (the setup states as a screen, an inline value editor, repo removal), all through pure transforms in a new `src/core/config/edit.ts`. Nothing writes until the user confirms a semantic change list, at which point the single new port method `GantryViews.applyConfig` validates the whole document and saves it once. The wizard is reused, not reimplemented: its input handling and effect calls move into a `useSetupSession` hook that both `skillgantry setup` and the new in-TUI screen drive with different callbacks.

**Tech Stack:** everything M1–M6 shipped, and no new npm dependency. Zod validates, `node:sqlite` is untouched, the change list is a hand-written pure function over two config objects.

## Global Constraints

Everything in [plan-m1.md's Global Constraints](plan-m1.md), [plan-m2.md's](plan-m2.md), [plan-m3.md's](plan-m3.md), [plan-m4.md's](plan-m4.md), [plan-m5.md's](plan-m5.md) and [plan-m6.md's](plan-m6.md) still holds. These are the ones this work can violate.

- **One write path to `config.json`.** Every edit path mutates a staged `GantryConfig` in the store. `GantryViews.applyConfig` is the only thing that writes, and it runs `configSchema.parse` over the whole document first.
- **The setup states are not reimplemented.** `setupReducer`, `SETUP_ORDER`, `canEnter`, `entryBlockedReason` and `Setup.tsx` are shared with `skillgantry setup`. Any change to them keeps both callers working.
- **No credential ever enters a change set.** R7.3. `.env` is view-only: not staged, not diffed, not written. Credential rows carry presence and provider label only, never a value.
- **`src/tui/**` may not spawn and may not open the ledger.** Installs reach it through `SetupDriver`; the config write through `GantryViews.applyConfig`. The transforms and the change list are pure and arrive through `src/core/index.ts`.
- **Import boundary:** `cli → tui → core`; `src/tui/**` reaches core **only** through `src/core/index.ts`; no `console` or `process.exit` in `src/core/**`.
- **§14.1's row budget holds on both new full-screen views.** A panel renders exactly the rows it was allocated; an overflow count is counted *against* that allocation, never appended below it; text truncates and never wraps; pane sizes are decided in `src/tui/layout.ts` and nowhere else.
- **Applying rebinds nothing already running.** `startTui` and `createQueue` keep their launch-time snapshot. No task adds a live-reload path.
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` are all on. Build a conditional property rather than passing `undefined`.
- ESM only, `NodeNext`; relative imports carry the `.js` extension, in `.tsx` too.
- British spelling in identifiers that appear in the specs (`optimise`, `artefact`, `normalise`).
- Conventional Commits, lowercase imperative subject describing the behaviour change.
- `pnpm check` (lint, build, test, acceptance) passes before the branch is done.

---

## File structure

```
src/
  core/
    config/
      edit.ts                    NEW       withRepo, withoutRepo, withStageTools,
                                           withScalar, configChanges — the decisions
      config.ts                  MODIFIED  registerRepo delegates to withRepo
    tools/
      setup.ts                   MODIFIED  initialSetupState(seed), SetupDriver.installedTools
    index.ts                     MODIFIED  export the edit surface
  tui/
    views.ts                     MODIFIED  SettingsView origins, applyConfig on the port
    rows.ts                      MODIFIED  settingsRows: grouped by file, cursor, actions
    store.ts                     MODIFIED  staged config, cursor, editor buffer, confirm,
                                           SCREENS gains 'setup'
    use-setup-session.ts         NEW       the wizard's input + effects, shared by both callers
    setup-app.tsx                MODIFIED  thin wrapper over the hook
    app.tsx                      MODIFIED  setup screen, edit keys, modal precedence
    components/
      Settings.tsx               MODIFIED  cursor, editor line, staged count
      ConfirmPane.tsx            NEW       the change list under §14.1's budget
      Help.tsx                   MODIFIED  the new bindings
  cli/
    gantry-views.ts              MODIFIED  origins, lockedTools, applyConfig
    tui-command.ts               MODIFIED  passes a SetupDriver into renderApp
tests/
  core/
    config-edit.test.ts          NEW       transforms + configChanges
    config.test.ts               MODIFIED  registerRepo parity after the refactor
    setup.test.ts                MODIFIED  seeded initial state
  tui/
    rows.test.ts                 MODIFIED  settings rows: origins, groups, actions
    settings-edit.test.tsx       NEW       staging, editor, confirm, discard
    setup-wizard.test.tsx        MODIFIED  the hook refactor keeps the wizard working
    layout.test.tsx              MODIFIED  two new views in the budget walk
  cli/
    gantry-views.test.ts         MODIFIED  origin reporting and applyConfig
  acceptance/
    m6.test.tsx                  MODIFIED  edit-and-apply against a real config file
docs/specs/
  plan-m6.md                     MODIFIED  extension section points here
  index.md                       MODIFIED  this file listed
```

---

## Tasks

### Task 13: The pure config transforms and the change list

**Files:**
- Create: `src/core/config/edit.ts`
- Modify: `src/core/config/config.ts` (`registerRepo`), `src/core/index.ts`
- Test: `tests/core/config-edit.test.ts`, `tests/core/config.test.ts`

**Interfaces:**
- Consumes: `GantryConfig`, `configSchema` from `src/core/config/schema.ts`; `stageToolsFor` from `src/core/tools/setup.ts`.
- Produces:
  - `type ScalarField = 'concurrency' | 'artefactSizeCapBytes' | 'mutationTimeoutMs' | \`timeoutOverridesMs.${string}\``
  - `interface ConfigChange { kind: 'add' | 'remove' | 'change'; path: string; before: string | null; after: string | null }`
  - `withRepo(config: GantryConfig, entry: { path: string; isGit: boolean }): GantryConfig`
  - `withoutRepo(config: GantryConfig, repoId: string): GantryConfig`
  - `withStageTools(config: GantryConfig, selected: readonly string[], isRunnable: (id: string) => boolean): GantryConfig`
  - `withScalar(config: GantryConfig, field: ScalarField, raw: string): GantryConfig`
  - `configChanges(current: GantryConfig, staged: GantryConfig): ConfigChange[]`

- [ ] **Step 1: Write the failing tests for the repo transforms**

Create `tests/core/config-edit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/core/config/config.js'
import {
  configChanges,
  withRepo,
  withScalar,
  withStageTools,
  withoutRepo,
} from '../../src/core/config/edit.js'

const base = { ...DEFAULT_CONFIG, repos: [] }

describe('withRepo', () => {
  it('derives the id from the directory name and records git-ness', () => {
    const next = withRepo(base, { path: '/tmp/zapac-agent-skills', isGit: true })
    expect(next.repos).toEqual([
      {
        id: 'zapac-agent-skills',
        path: '/tmp/zapac-agent-skills',
        name: 'zapac-agent-skills',
        isGit: true,
      },
    ])
  })

  it('deduplicates a colliding id with a numeric suffix', () => {
    const one = withRepo(base, { path: '/a/skills', isGit: false })
    const two = withRepo(one, { path: '/b/skills', isGit: false })
    expect(two.repos.map((r) => r.id)).toEqual(['skills', 'skills-2'])
  })

  it('rejects a path already registered, naming it', () => {
    const one = withRepo(base, { path: '/a/skills', isGit: false })
    expect(() => withRepo(one, { path: '/a/skills', isGit: false })).toThrow(
      'already registered: /a/skills',
    )
  })

  it('leaves the input untouched', () => {
    withRepo(base, { path: '/a/skills', isGit: false })
    expect(base.repos).toEqual([])
  })
})

describe('withoutRepo', () => {
  it('removes the named repo and nothing else', () => {
    const two = withRepo(withRepo(base, { path: '/a/x', isGit: false }), {
      path: '/b/y',
      isGit: false,
    })
    expect(withoutRepo(two, 'x').repos.map((r) => r.id)).toEqual(['y'])
  })

  it('is a no-op for an id that is not registered', () => {
    expect(withoutRepo(base, 'nope').repos).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail for the right reason**

Run: `pnpm vitest run tests/core/config-edit.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/config/edit.js"`.

- [ ] **Step 3: Write the repo transforms**

Create `src/core/config/edit.ts`:

```ts
import { basename } from 'node:path'
import { type GantryConfig, configSchema } from './schema.js'

/**
 * The decisions over a config document, kept out of the module that owns the
 * file. `registerRepo` and the TUI's staged edit both route through these, so
 * the two cannot disagree about what a valid change is — which is exactly what
 * a second write path would have produced.
 */

function uniqueId(desired: string, taken: ReadonlySet<string>): string {
  if (!taken.has(desired)) return desired
  for (let n = 2; ; n += 1) {
    const candidate = `${desired}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

export function withRepo(
  config: GantryConfig,
  entry: { path: string; isGit: boolean },
): GantryConfig {
  if (config.repos.some((repo) => repo.path === entry.path)) {
    throw new Error(`already registered: ${entry.path}`)
  }
  const name = basename(entry.path)
  return {
    ...config,
    repos: [
      ...config.repos,
      {
        id: uniqueId(name, new Set(config.repos.map((repo) => repo.id))),
        path: entry.path,
        name,
        isGit: entry.isGit,
      },
    ],
  }
}

export function withoutRepo(config: GantryConfig, repoId: string): GantryConfig {
  return { ...config, repos: config.repos.filter((repo) => repo.id !== repoId) }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run tests/core/config-edit.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing tests for `withStageTools` and `withScalar`**

Append to `tests/core/config-edit.test.ts`:

```ts
describe('withStageTools', () => {
  it('files each selected tool under its catalogue stage', () => {
    const next = withStageTools(base, ['skill-lint', 'skillspector'], () => true)
    expect(next.stageTools.validate).toEqual(['skill-lint'])
    expect(next.stageTools.security).toEqual(['skillspector'])
  })

  it('drops a tool the adapter registry does not know', () => {
    // R3.5b: a selection naming an unrunnable tool fails every run of that
    // stage, so it never reaches the config in the first place.
    const next = withStageTools(base, ['skill-lint', 'skills'], (id) => id !== 'skills')
    expect(Object.values(next.stageTools).flat()).toEqual(['skill-lint'])
  })
})

describe('withScalar', () => {
  it('parses and stores a whole number', () => {
    expect(withScalar(base, 'concurrency', '4').concurrency).toBe(4)
  })

  it('refuses a value the schema rejects, quoting the schema message', () => {
    expect(() => withScalar(base, 'concurrency', '99')).toThrow(/concurrency/)
  })

  it('refuses a value that is not a whole number', () => {
    expect(() => withScalar(base, 'concurrency', '2.5')).toThrow('not a whole number: 2.5')
  })

  it('stages a per-tool timeout override', () => {
    expect(withScalar(base, 'timeoutOverridesMs.skill-up', '900000').timeoutOverridesMs).toEqual({
      'skill-up': 900000,
    })
  })

  it('removes an override when the value is cleared', () => {
    const withOverride = withScalar(base, 'timeoutOverridesMs.skill-up', '900000')
    expect(withScalar(withOverride, 'timeoutOverridesMs.skill-up', '').timeoutOverridesMs).toEqual(
      {},
    )
  })
})
```

- [ ] **Step 6: Run and confirm they fail**

Run: `pnpm vitest run tests/core/config-edit.test.ts`
Expected: FAIL — `withStageTools is not a function`.

- [ ] **Step 7: Implement `withStageTools` and `withScalar`**

Append to `src/core/config/edit.ts`:

```ts
import { stageToolsFor } from '../tools/setup.js'

export function withStageTools(
  config: GantryConfig,
  selected: readonly string[],
  isRunnable: (toolId: string) => boolean,
): GantryConfig {
  return { ...config, stageTools: stageToolsFor(selected, isRunnable) }
}

const OVERRIDE_PREFIX = 'timeoutOverridesMs.'

export type ScalarField =
  | 'concurrency'
  | 'artefactSizeCapBytes'
  | 'mutationTimeoutMs'
  | `${typeof OVERRIDE_PREFIX}${string}`

/**
 * `raw` is what the user typed, so both halves of the rejection matter: the
 * parse names the text back, and the schema names the bound it broke. Staging a
 * value the schema would reject on apply is how an editor turns a typo into a
 * config file that no longer loads.
 */
export function withScalar(
  config: GantryConfig,
  field: ScalarField,
  raw: string,
): GantryConfig {
  const trimmed = raw.trim()
  const next = { ...config }

  if (field.startsWith(OVERRIDE_PREFIX)) {
    const toolId = field.slice(OVERRIDE_PREFIX.length)
    const overrides = { ...config.timeoutOverridesMs }
    if (trimmed.length === 0) delete overrides[toolId]
    else overrides[toolId] = wholeNumber(trimmed)
    next.timeoutOverridesMs = overrides
  } else {
    // A switch rather than `next[field] = …`: writing through a union-typed key
    // is rejected under `strict`, because TypeScript cannot prove the value fits
    // every member of the union.
    const value = wholeNumber(trimmed)
    switch (field) {
      case 'concurrency':
        next.concurrency = value
        break
      case 'artefactSizeCapBytes':
        next.artefactSizeCapBytes = value
        break
      case 'mutationTimeoutMs':
        next.mutationTimeoutMs = value
        break
    }
  }

  return configSchema.parse(next)
}

function wholeNumber(raw: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value)) throw new Error(`not a whole number: ${raw}`)
  return value
}
```

Zod's message already names the field and the bound, so no rewrapping: `configSchema.parse` throws a `ZodError` whose `message` contains `concurrency`, which is what Step 5's regex asserts.

- [ ] **Step 8: Run and confirm they pass**

Run: `pnpm vitest run tests/core/config-edit.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 9: Write the failing tests for `configChanges`**

Append to `tests/core/config-edit.test.ts`:

```ts
describe('configChanges', () => {
  it('reports nothing for an untouched config', () => {
    expect(configChanges(base, base)).toEqual([])
  })

  it('reports a scalar change with both values rendered', () => {
    expect(configChanges(base, withScalar(base, 'concurrency', '4'))).toEqual([
      { kind: 'change', path: 'concurrency', before: '2', after: '4' },
    ])
  })

  it('reports a repo addition by id and path', () => {
    expect(configChanges(base, withRepo(base, { path: '/a/skills', isGit: true }))).toEqual([
      { kind: 'add', path: 'repos[skills]', before: null, after: '/a/skills' },
    ])
  })

  it('reports a repo removal', () => {
    const one = withRepo(base, { path: '/a/skills', isGit: true })
    expect(configChanges(one, withoutRepo(one, 'skills'))).toEqual([
      { kind: 'remove', path: 'repos[skills]', before: '/a/skills', after: null },
    ])
  })

  it('reports a stage tool list as one row, not one row per tool', () => {
    const next = withStageTools(base, ['skill-lint', 'skillspector'], () => true)
    const validate = configChanges(base, next).find((c) => c.path === 'stageTools.validate')
    expect(validate).toEqual({
      kind: 'change',
      path: 'stageTools.validate',
      before: '(none)',
      after: 'skill-lint',
    })
  })

  it('reports an override added, changed and removed', () => {
    const added = withScalar(base, 'timeoutOverridesMs.skill-up', '900000')
    expect(configChanges(base, added)).toEqual([
      {
        kind: 'add',
        path: 'timeoutOverridesMs.skill-up',
        before: null,
        after: '900000',
      },
    ])
    expect(configChanges(added, base)).toEqual([
      {
        kind: 'remove',
        path: 'timeoutOverridesMs.skill-up',
        before: '900000',
        after: null,
      },
    ])
  })

  it('reports every changed field of a multi-field edit', () => {
    const next = withScalar(withRepo(base, { path: '/a/skills', isGit: true }), 'concurrency', '4')
    expect(configChanges(base, next).map((c) => c.path)).toEqual([
      'repos[skills]',
      'concurrency',
    ])
  })
})
```

- [ ] **Step 10: Run and confirm they fail**

Run: `pnpm vitest run tests/core/config-edit.test.ts -t configChanges`
Expected: FAIL — `configChanges is not a function`.

- [ ] **Step 11: Implement `configChanges`**

Append to `src/core/config/edit.ts`:

```ts
export interface ConfigChange {
  kind: 'add' | 'remove' | 'change'
  /** Dotted field path: `concurrency`, `stageTools.validate`, `repos[zapac]`. */
  path: string
  before: string | null
  after: string | null
}

const SCALARS = ['concurrency', 'artefactSizeCapBytes', 'mutationTimeoutMs'] as const

/**
 * Field-level rather than textual. A line diff over the serialised document
 * reports an array edit as a block move, which is not the change the user made,
 * and `unifiedDiffFor` spawns — which `src/tui/**` may not.
 *
 * Emitted in document order: repos, stage tools, scalars, overrides. A stable
 * order is what lets the confirmation pane be asserted at all.
 */
export function configChanges(current: GantryConfig, staged: GantryConfig): ConfigChange[] {
  const out: ConfigChange[] = []

  const currentRepos = new Map(current.repos.map((repo) => [repo.id, repo]))
  const stagedRepos = new Map(staged.repos.map((repo) => [repo.id, repo]))
  for (const [id, repo] of stagedRepos) {
    if (!currentRepos.has(id)) {
      out.push({ kind: 'add', path: `repos[${id}]`, before: null, after: repo.path })
    }
  }
  for (const [id, repo] of currentRepos) {
    if (!stagedRepos.has(id)) {
      out.push({ kind: 'remove', path: `repos[${id}]`, before: repo.path, after: null })
    }
  }

  for (const stage of Object.keys(staged.stageTools) as Array<keyof GantryConfig['stageTools']>) {
    const before = current.stageTools[stage].join(', ')
    const after = staged.stageTools[stage].join(', ')
    if (before === after) continue
    out.push({
      kind: 'change',
      path: `stageTools.${stage}`,
      before: before.length === 0 ? '(none)' : before,
      after: after.length === 0 ? '(none)' : after,
    })
  }

  for (const field of SCALARS) {
    if (current[field] === staged[field]) continue
    out.push({
      kind: 'change',
      path: field,
      before: String(current[field]),
      after: String(staged[field]),
    })
  }

  const toolIds = new Set([
    ...Object.keys(current.timeoutOverridesMs),
    ...Object.keys(staged.timeoutOverridesMs),
  ])
  for (const toolId of [...toolIds].sort()) {
    const before = current.timeoutOverridesMs[toolId]
    const after = staged.timeoutOverridesMs[toolId]
    if (before === after) continue
    out.push({
      kind: before === undefined ? 'add' : after === undefined ? 'remove' : 'change',
      path: `timeoutOverridesMs.${toolId}`,
      before: before === undefined ? null : String(before),
      after: after === undefined ? null : String(after),
    })
  }

  return out
}
```

- [ ] **Step 12: Run and confirm they pass**

Run: `pnpm vitest run tests/core/config-edit.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 13: Refactor `registerRepo` onto `withRepo` and prove parity**

In `src/core/config/config.ts`, replace the body that builds the repo entry:

```ts
export async function registerRepo(home: string, repoPath: string): Promise<GantryConfig> {
  // The same read the wizard's preview uses, so the verdict it showed and the
  // rule that accepts the path cannot drift apart.
  const { resolved: path, isDirectory, alreadyRegistered } = await inspectRepo(home, repoPath)
  if (alreadyRegistered) throw new Error(`already registered: ${path}`)
  // Discovery over a missing path throws deep in readdir; refusing here names
  // the path the user actually typed instead.
  if (!isDirectory) throw new Error(`no such directory: ${path}`)

  const config = await loadConfig(home)
  // The id and duplicate rules live in `withRepo` so the staged edit path and
  // this one cannot disagree about what registering means.
  const next = withRepo(config, { path, isGit: await isGitRepo(path) })
  await saveConfig(home, next)
  return next
}
```

Delete the now-orphaned local `uniqueId` from `config.ts` and add `import { withRepo } from './edit.js'`.

Append to `tests/core/config.test.ts`, using the file's own `home()` helper (a local `mkdtemp`) and `makeRepo` from `../helpers/tmp-repo.js`, both already imported there:

```ts
it('registers through the same rules the staged path uses', async () => {
  const h = await home()
  const repo = await makeRepo({ alpha: SKILL_MD })
  const written = await registerRepo(h, repo)
  const entry = written.repos[0]!
  const staged = withRepo(DEFAULT_CONFIG, { path: entry.path, isGit: entry.isGit })

  expect(written.repos).toEqual(staged.repos)
})
```

Add `withRepo` to the file's import from `../../src/core/config/edit.js`. Check `makeRepo`'s actual signature in `tests/helpers/tmp-repo.ts` and match the call the existing `registerRepo` cases in this file already make, rather than inventing a second calling convention.

- [ ] **Step 14: Run the config suite**

Run: `pnpm vitest run tests/core/config.test.ts tests/core/config-edit.test.ts`
Expected: PASS, no regression in the existing `registerRepo` cases.

- [ ] **Step 15: Export the surface and build**

In `src/core/index.ts` add:

```ts
export {
  configChanges,
  withRepo,
  withScalar,
  withStageTools,
  withoutRepo,
  type ConfigChange,
  type ScalarField,
} from './config/edit.js'
```

Run: `pnpm build && pnpm lint`
Expected: both clean.

- [ ] **Step 16: Commit**

```bash
git add src/core/config/edit.ts src/core/config/config.ts src/core/index.ts \
        tests/core/config-edit.test.ts tests/core/config.test.ts
git commit -m "feat: add pure config transforms and a semantic change list (R11.8)"
```

---

### Task 14: The view tells the truth about origin

**Files:**
- Modify: `src/tui/views.ts` (`SettingsView`), `src/cli/gantry-views.ts`, `src/tui/rows.ts` (`settingsRows`, `ScreenRow`)
- Test: `tests/cli/gantry-views.test.ts`, `tests/tui/rows.test.ts`

**Interfaces:**
- Consumes: Task 13's `ScalarField`.
- Produces:
  - `SettingsView` gains `configPath: string`, `envPath: string`, `lockPath: string`, `config: GantryConfig`, `presentKeys: readonly string[]`, `lockedTools: readonly string[]`, `toolTimeouts: Array<{ toolId: string; defaultMs: number }>`.
  - `type SettingsAction = { kind: 'edit-scalar'; field: ScalarField; current: string } | { kind: 'remove-repo'; repoId: string } | { kind: 'open-setup' }`
  - `ScreenRow` gains `action?: SettingsAction`.
  - `settingsRows(state: AppState, width: number): ScreenRow[]` renders from `state.staged ?? state.settings.config`.

- [ ] **Step 1: Write the failing test for origin reporting**

Append to `tests/cli/gantry-views.test.ts`:

```ts
it('reports which config keys the file actually holds', async () => {
  const home = await tmpHome()
  await writeFile(
    join(home, 'config.json'),
    JSON.stringify({ version: 1, stageTools: { validate: [], evaluate: [], security: [], optimise: [] }, concurrency: 4, artefactSizeCapBytes: 1024 }),
  )
  const view = await createGantryViews({ home, dbPath: join(home, 'gantry.db'), write: () => undefined }).settings()

  expect(view.presentKeys).toContain('concurrency')
  // Absent from the file, filled by the schema: the screen must be able to say
  // "default" rather than showing a number nobody wrote.
  expect(view.presentKeys).not.toContain('mutationTimeoutMs')
  expect(view.configPath).toBe(join(home, 'config.json'))
})

it('reports no present keys when the file does not exist', async () => {
  const home = await tmpHome()
  const view = await createGantryViews({ home, dbPath: join(home, 'gantry.db'), write: () => undefined }).settings()
  expect(view.presentKeys).toEqual([])
})
```

Reuse the file's existing `tmpHome()` helper; if it has none, add one that `mkdtemp`s under the scratch directory the other CLI tests use.

- [ ] **Step 2: Run and confirm it fails**

Run: `pnpm vitest run tests/cli/gantry-views.test.ts -t 'config keys'`
Expected: FAIL — `presentKeys` is undefined.

- [ ] **Step 3: Extend `SettingsView` and implement origin reporting**

In `src/tui/views.ts`:

```ts
import type { GantryConfig } from '../core/index.js'

export interface SettingsView {
  home: string
  dbPath: string
  /** Named so a row can say which file holds it — R11.7. */
  configPath: string
  envPath: string
  lockPath: string
  /** The loaded document, so the screen can stage edits against it. */
  config: GantryConfig
  /**
   * Top-level keys the file literally held. `loadConfig` fills a default for
   * every absent key, so without this a written 2 and a defaulted 2 are the
   * same number and the screen cannot tell a user which file to edit.
   */
  presentKeys: readonly string[]
  concurrency: number
  repos: SettingsRepo[]
  stageTools: Record<string, readonly string[]>
  /** Installed and verified per the lockfile; seeds the setup screen. */
  lockedTools: readonly string[]
  /** The adapter's declared timeout per selected tool, before any override. */
  toolTimeouts: Array<{ toolId: string; defaultMs: number }>
  credentials: SettingsCredential[]
  envWarnings: string[]
  ruleMap: { applied: number; current: number }
}

export interface GantryViews {
  // …existing six methods…
  /** Validates the whole document and writes it once — the only write path. */
  applyConfig(next: GantryConfig): Promise<void>
}
```

In `src/cli/gantry-views.ts`, inside `settings()`:

```ts
// A second, raw read: `loadConfig` parses through the schema and the schema
// substitutes a default for every absent key, so the parsed document cannot
// answer "did the user write this?".
const presentKeys = await readFile(join(deps.home, 'config.json'), 'utf8').then(
  (text) => Object.keys(JSON.parse(text) as Record<string, unknown>),
  () => [] as string[],
)
const lock = await loadToolLock(deps.home)
const lockedTools = Object.entries(lock.tools)
  .filter(([, entry]) => entry.verifiedAt !== null)
  .map(([id]) => id)
const toolTimeouts = selected.flatMap((toolId) => {
  const manifest = getAdapter(toolId)?.manifest
  return manifest ? [{ toolId, defaultMs: manifest.timeoutMs }] : []
})
```

and add `configPath`, `envPath`, `lockPath`, `config`, `presentKeys`, `lockedTools`, `toolTimeouts` to the returned object. Add `applyConfig` to the returned port:

```ts
applyConfig: async (next) => {
  // `saveConfig` runs `configSchema.parse` before it writes, so an invalid
  // document never reaches disk even if a caller skipped staging validation.
  await saveConfig(deps.home, next)
},
```

Update `tests/helpers/fake-views.ts`'s `emptySettings` with the new fields and add `applyConfig: async () => undefined` to `fakeViews`.

- [ ] **Step 4: Run and confirm it passes**

Run: `pnpm vitest run tests/cli/gantry-views.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing row tests**

Append to `tests/tui/rows.test.ts`. The file already imports `settingsRows`, `initialState`, `reducer` and `emptySettings`; it builds screen state by dispatching into the real reducer (`const loaded = (stats) => reducer(initialState([], 2), …)`), so these follow that shape rather than hand-building an `AppState`:

```ts
describe('settingsRows', () => {
  const VIEW = { ...emptySettings, configPath: '/h/config.json', envPath: '/h/.env' }
  const withView = (view = VIEW, concurrency = 2) =>
    reducer(initialState([], concurrency), { type: 'set-settings', view })
  const find = (rows: ScreenRow[], needle: string) =>
    rows.find((row) => row.text.includes(needle))

  it('names the holding file on every group heading', () => {
    const headings = settingsRows(withView(), 80)
      .filter((row) => row.heading === true)
      .map((row) => row.text)
    expect(headings.some((text) => text.includes('/h/config.json'))).toBe(true)
    expect(headings.some((text) => text.includes('/h/.env'))).toBe(true)
  })

  it('marks a value the file does not hold as a default', () => {
    const rows = settingsRows(withView({ ...VIEW, presentKeys: [] }), 80)
    expect(find(rows, 'concurrency')?.text).toContain('default')
  })

  it('marks a value the file holds with the file name', () => {
    const rows = settingsRows(withView({ ...VIEW, presentKeys: ['concurrency'] }), 80)
    expect(find(rows, 'concurrency')?.text).toContain('config.json')
  })

  it('shows a session override beside the stored value', () => {
    // The view carries the stored 4; the app was launched with --concurrency 2.
    const rows = settingsRows(withView({ ...VIEW, concurrency: 4 }, 2), 80)
    expect(find(rows, 'concurrency')?.text).toContain('session 2')
  })

  it('gives an editable row an action and a credential row none', () => {
    const rows = settingsRows(
      withView({
        ...VIEW,
        credentials: [{ label: 'skillspector', satisfied: true, detail: 'via anthropic' }],
      }),
      80,
    )
    expect(find(rows, 'concurrency')?.action).toEqual({
      kind: 'edit-scalar',
      field: 'concurrency',
      current: '2',
    })
    // R7.3: a credential is never editable, so its row carries no action at all
    // rather than an action that refuses.
    expect(find(rows, 'skillspector')?.action).toBeUndefined()
  })

  it('renders staged values, not the loaded ones', () => {
    const state = reducer(withView(), {
      type: 'stage-scalar-for-test',
      config: withScalar(VIEW.config, 'concurrency', '8'),
    })
    expect(find(settingsRows(state, 80), 'concurrency')?.text).toContain('8')
  })
})
```

The last case needs staging, which Task 15 builds. Write the first five now; add the sixth in Task 15 Step 4, replacing `stage-scalar-for-test` with the real `begin-edit` → `edit-input` → `stage-edit` sequence that task introduces. Do not add a test-only action to the store.

- [ ] **Step 6: Run and confirm they fail**

Run: `pnpm vitest run tests/tui/rows.test.ts -t settingsRows`
Expected: FAIL — headings carry no path, `action` is undefined.

- [ ] **Step 7: Rewrite `settingsRows`**

In `src/tui/rows.ts`, add the action type and rewrite the builder. Keep it pure and flat — that is what lets the row budget be asserted without Ink.

```ts
import type { ScalarField } from '../core/index.js'

export type SettingsAction =
  | { kind: 'edit-scalar'; field: ScalarField; current: string }
  | { kind: 'remove-repo'; repoId: string }
  | { kind: 'open-setup' }

export interface ScreenRow {
  text: string
  heading?: boolean
  dim?: boolean
  colour?: string
  /** Present only on rows the user can act on; the cursor visits these alone. */
  action?: SettingsAction
}
```

`settingsRows` reads `const config = state.staged ?? view.config`, renders the four groups of design §14.2 with the holding file on each heading, and appends the origin token to each editable row: `config.json` when `view.presentKeys` includes the key, `default` otherwise, plus `(session <n>)` on `concurrency` when `state.concurrency !== config.concurrency`. Every actionable row is prefixed `›` when its index equals the cursor's target and two spaces otherwise, the way `Setup.tsx` marks its selection.

Row order is fixed: Repos (one per repo, then an `open-setup` row labelled `+ add a repo`), Execution (`concurrency`, `artefact cap`, `mutation timeout`, then one `open-setup` row per stage carrying its tool list, then one row per entry of `view.toolTimeouts` carrying the effective timeout), Credentials (no actions), Paths.

- [ ] **Step 8: Run and confirm they pass**

Run: `pnpm vitest run tests/tui/rows.test.ts`
Expected: PASS, including the existing dashboard and tools row cases.

- [ ] **Step 9: Commit**

```bash
git add src/tui/views.ts src/tui/rows.ts src/cli/gantry-views.ts tests/helpers/fake-views.ts \
        tests/cli/gantry-views.test.ts tests/tui/rows.test.ts
git commit -m "feat: report each setting's holding file and origin on the settings screen (R11.7)"
```

---

### Task 15: Staging, the value editor and repo removal

**Files:**
- Modify: `src/tui/store.ts`, `src/tui/components/Settings.tsx`, `src/tui/app.tsx`
- Test: `tests/tui/settings-edit.test.tsx`, `tests/tui/store.test.ts`

**Interfaces:**
- Consumes: Task 13's `withScalar` / `withoutRepo` / `configChanges`; Task 14's `SettingsAction`, `SettingsView.config`, `GantryViews.applyConfig`.
- Produces: `AppState` gains `staged: GantryConfig | null`, `settingsCursor: number`, `editing: { field: ScalarField; buffer: string; error: string | null } | null`, `confirm: boolean`. Actions `settings-cursor`, `begin-edit`, `edit-input`, `stage-edit`, `cancel-edit`, `stage-remove-repo`, `stage-selection`, `stage-repo`, `open-confirm`, `close-confirm`, `discard-staged`.

- [ ] **Step 1: Write the failing store tests**

Append to `tests/tui/store.test.ts`:

```ts
describe('config staging', () => {
  const loaded = { ...emptySettings }
  const withSettings = (): AppState =>
    reducer(initialState([], 2), { type: 'set-settings', view: loaded })

  it('stages a scalar edit without touching the loaded view', () => {
    let state = reducer(withSettings(), {
      type: 'begin-edit',
      field: 'concurrency',
      current: '2',
    })
    state = reducer(state, { type: 'edit-input', buffer: '4' })
    state = reducer(state, { type: 'stage-edit' })

    expect(state.staged?.concurrency).toBe(4)
    expect(state.settings?.config.concurrency).toBe(2)
    expect(state.editing).toBeNull()
  })

  it('keeps the editor open and names the error when the value is invalid', () => {
    let state = reducer(withSettings(), { type: 'begin-edit', field: 'concurrency', current: '2' })
    state = reducer(state, { type: 'edit-input', buffer: '99' })
    state = reducer(state, { type: 'stage-edit' })

    expect(state.staged).toBeNull()
    expect(state.editing?.error).toMatch(/concurrency/)
  })

  it('stages a second edit on top of the first', () => {
    let state = reducer(withSettings(), { type: 'begin-edit', field: 'concurrency', current: '2' })
    state = reducer(state, { type: 'edit-input', buffer: '4' })
    state = reducer(state, { type: 'stage-edit' })
    state = reducer(state, {
      type: 'begin-edit',
      field: 'mutationTimeoutMs',
      current: '300000',
    })
    state = reducer(state, { type: 'edit-input', buffer: '60000' })
    state = reducer(state, { type: 'stage-edit' })

    expect(state.staged?.concurrency).toBe(4)
    expect(state.staged?.mutationTimeoutMs).toBe(60000)
  })

  it('drops every staged edit on discard', () => {
    let state = reducer(withSettings(), { type: 'begin-edit', field: 'concurrency', current: '2' })
    state = reducer(state, { type: 'edit-input', buffer: '4' })
    state = reducer(state, { type: 'stage-edit' })
    expect(reducer(state, { type: 'discard-staged' }).staged).toBeNull()
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `pnpm vitest run tests/tui/store.test.ts -t 'config staging'`
Expected: FAIL — the action types do not exist.

- [ ] **Step 3: Extend the store**

In `src/tui/store.ts` add the state fields (initialised `staged: null`, `settingsCursor: 0`, `editing: null`, `confirm: false`), the action union members, and the reducer cases. The transforms are pure, so the reducer calls them directly rather than asking a component to precompute:

```ts
case 'stage-edit': {
  const editing = state.editing
  const base = state.staged ?? state.settings?.config
  if (!editing || !base) return state
  try {
    return { ...state, staged: withScalar(base, editing.field, editing.buffer), editing: null }
  } catch (err) {
    // The editor stays open holding what the user typed: closing it on a
    // rejection throws away the value they were half way through fixing.
    return { ...state, editing: { ...editing, error: (err as Error).message } }
  }
}
```

`stage-remove-repo` applies `withoutRepo`, `stage-selection` applies `withStageTools`, `stage-repo` applies `withRepo` — each over `state.staged ?? state.settings.config`, each returning `state` unchanged when no settings view has loaded.

- [ ] **Step 4: Run and confirm they pass**

Run: `pnpm vitest run tests/tui/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing screen test**

Create `tests/tui/settings-edit.test.tsx`. `renderInk(node, size)` is synchronous and returns `{ frames, lastFrame(), stdin, unmount, settle }` — there is no `type()`; keys go in through `stdin.send()` and a frame settles with `await ui.settle()`. `tests/tui/tools-settings.test.tsx` already mounts `App` with `fakeViews` and a `createQueue`/`fakeRun` pair; mirror its `screen()` helper rather than inventing a second harness.

```tsx
import { describe, expect, it } from 'vitest'
import { createQueue, type SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeRun } from '../helpers/fake-run.js'
import { emptySettings, fakeSetupDriver, fakeViews } from '../helpers/fake-views.js'
import { renderInk } from '../helpers/render-ink.js'

const VIEW = { ...emptySettings, configPath: '/h/config.json' }

/** Mounts the app, drives the palette to Settings, and returns the harness. */
async function settingsScreen(views = fakeViews({ settings: async () => VIEW })) {
  const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('r1').handle })
  const ui = renderInk(
    <App
      skills={[] as SkillRef[]}
      queue={queue}
      stages={['security']}
      concurrency={2}
      views={views}
      setup={fakeSetupDriver()}
      intervalMs={20}
    />,
  )
  await type(ui, ':settings\r')
  return ui
}

/** One character at a time, the way a terminal delivers them. */
async function type(ui: { stdin: { send: (s: string) => void }; settle: () => Promise<void> }, keys: string) {
  for (const key of keys) ui.stdin.send(key)
  await ui.settle()
}

describe('Settings editing', () => {
  it('stages an edit and writes nothing until apply', async () => {
    const applied: unknown[] = []
    const ui = await settingsScreen(
      fakeViews({
        settings: async () => VIEW,
        applyConfig: async (next) => {
          applied.push(next)
        },
      }),
    )

    await type(ui, 'e4\r')
    expect(ui.lastFrame()).toContain('1 staged')
    expect(applied).toEqual([])

    await type(ui, 'c')
    expect(ui.lastFrame()).toContain('concurrency')
    expect(ui.lastFrame()).toContain('2 → 4')

    await type(ui, 'a')
    expect(applied).toHaveLength(1)
  })

  it('discards a staged edit and applies nothing', async () => {
    const applied: unknown[] = []
    const ui = await settingsScreen(
      fakeViews({ settings: async () => VIEW, applyConfig: async (next) => void applied.push(next) }),
    )

    await type(ui, 'e8\rcd')

    expect(applied).toEqual([])
    expect(ui.lastFrame()).not.toContain('staged')
  })

  it('shows the schema rejection and stages nothing', async () => {
    const ui = await settingsScreen()
    await type(ui, 'e99\r')

    expect(ui.lastFrame()).toMatch(/concurrency/)
    expect(ui.lastFrame()).not.toContain('1 staged')
  })
})
```

`fakeSetupDriver()` does not exist yet — Task 16 Step 7 adds it to `tests/helpers/fake-views.ts`. Add the minimal version now (every method resolving an empty or absent result) so this file compiles, and let Task 16 fill it in.

- [ ] **Step 6: Run and confirm they fail**

Run: `pnpm vitest run tests/tui/settings-edit.test.tsx`
Expected: FAIL — `e` does nothing on the Settings screen.

- [ ] **Step 7: Wire the keys and the editor line**

In `src/tui/app.tsx`'s `settings` branch: `j`/`k` move `settings-cursor` when nothing is being edited; `e` dispatches `begin-edit` from the selected row's `edit-scalar` action; `d` dispatches `stage-remove-repo` from a `remove-repo` action; `c` dispatches `open-confirm` when `state.staged !== null`. While `state.editing !== null` every printable key appends to the buffer, `backspace` trims it, `enter` dispatches `stage-edit` and `esc` dispatches `cancel-edit` — text entry is handled before any single-letter command, for the reason `setup-app.tsx` already documents: a value contains digits and a path contains letters, and either would otherwise steer the screen.

In `src/tui/components/Settings.tsx`: render the editor as one line below the list when `state.editing !== null`, showing the label, the buffer, an inverse cursor block and the error when present; put `N staged · c confirm` in the panel `hint` so it is never invisible; append `e edit · d remove · c confirm` to the footer.

- [ ] **Step 8: Run and confirm they pass**

Run: `pnpm vitest run tests/tui/settings-edit.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/tui/store.ts src/tui/components/Settings.tsx src/tui/app.tsx \
        tests/tui/store.test.ts tests/tui/settings-edit.test.tsx
git commit -m "feat: stage settings edits in the store without writing config (R11.8)"
```

---

### Task 16: The setup states as a screen

**Files:**
- Create: `src/tui/use-setup-session.ts`
- Modify: `src/tui/setup-app.tsx`, `src/tui/app.tsx`, `src/tui/store.ts` (`SCREENS`), `src/core/tools/setup.ts`, `src/cli/setup-command.ts`, `src/cli/tui-command.ts`
- Test: `tests/tui/setup-wizard.test.tsx`, `tests/core/setup.test.ts`

**Interfaces:**
- Consumes: `SetupDriver`, `setupReducer`, `SETUP_ORDER`, `entryBlockedReason`; Task 15's `stage-selection` and `stage-repo` actions.
- Produces:
  - `initialSetupState(seed?: { selected?: readonly string[]; installed?: Readonly<Record<string, InstallState>> }): SetupState`
  - `SetupDriver` gains `installedTools(): Promise<readonly string[]>`
  - `useSetupSession(options: { driver: SetupDriver; seed?: …; onSelection: (ids: readonly string[]) => void; onRepo: (entry: { path: string; isGit: boolean }) => void; onExit: () => void }): { state: SetupState; cursor: number; path: string; inspection: RepoInspection | null; error: string | null }`
  - `AppProps` gains `setup: SetupDriver`.

- [ ] **Step 1: Write the failing seeding test**

Append to `tests/core/setup.test.ts`:

```ts
it('seeds the selection so a re-entered wizard shows the current toolchain', () => {
  const state = initialSetupState({ selected: ['skill-lint', 'skillspector'] })
  expect(state.selected).toEqual(['skill-lint', 'skillspector'])
  expect(state.state).toBe('probe-runtimes')
})

it('marks a seeded install as ok so re-entry does not reinstall it', () => {
  const state = initialSetupState({ selected: ['skill-lint'], installed: { 'skill-lint': 'ok' } })
  // R3.6's gate is "every selected tool has to install before this step"; a tool
  // already locked and verified satisfies it without a second install.
  expect(entryBlockedReason(state, 'credentials-and-repo')).toBeNull()
})

it('still starts empty when nothing is seeded', () => {
  expect(initialSetupState().selected).toEqual([])
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `pnpm vitest run tests/core/setup.test.ts -t seed`
Expected: FAIL — `initialSetupState` takes no argument.

- [ ] **Step 3: Add the seed**

In `src/core/tools/setup.ts`:

```ts
/**
 * `seed` is what a re-entered wizard starts from. Without it the screen renders
 * a configured machine as having no tool selected, and an unchanged walk
 * through it would clear every stage.
 */
export function initialSetupState(seed?: {
  selected?: readonly string[]
  installed?: Readonly<Record<string, InstallState>>
}): SetupState {
  return {
    state: 'probe-runtimes',
    runtimes: [],
    selected: seed?.selected ?? [],
    installed: seed?.installed ?? {},
    errors: {},
    repoPath: null,
    repoSkipped: false,
    credentials: null,
  }
}
```

Add `installedTools(): Promise<readonly string[]>` to `SetupDriver` and implement it in `buildSetupDriver`:

```ts
installedTools: async () => {
  const lock = await loadToolLock(home)
  // Verified, not merely present: an entry that will not run is exactly what
  // doctor calls `unverifiable`, and reinstalling it is the right answer.
  return Object.entries(lock.tools)
    .filter(([, entry]) => entry.verifiedAt !== null)
    .map(([id]) => id)
},
```

- [ ] **Step 4: Run and confirm they pass**

Run: `pnpm vitest run tests/core/setup.test.ts`
Expected: PASS.

- [ ] **Step 5: Extract the wizard session hook**

Create `src/tui/use-setup-session.ts` holding everything `setup-app.tsx` currently owns between `useReducer` and the returned element: the probe effect, the sequence-guarded inspect debounce, `installAll`, `advance`, `back`, `usePaste` and `useInput`. Two behavioural changes, both required by re-entry:

```ts
// Already installed and verified, so the step reports it rather than repeating
// it: changing one tool otherwise reinstalls the whole selection.
const installAll = async (ids: readonly string[]): Promise<void> => {
  const already = new Set(await driver.installedTools())
  for (const id of ids) {
    if (already.has(id)) {
      dispatch({ type: 'installed', toolId: id })
      continue
    }
    dispatch({ type: 'installing', toolId: id })
    try {
      await driver.install(id)
      dispatch({ type: 'installed', toolId: id })
    } catch (err) {
      dispatch({ type: 'install-failed', toolId: id, error: (err as Error).message })
    }
  }
  onSelection(ids)
  dispatch({ type: 'credentials', ...(await driver.credentialStatus()) })
}
```

`onSelection` and `onRepo` replace the direct `driver.saveSelection` and `driver.registerRepo` calls, which is the seam the confirmation gate needs. `onExit` replaces `useApp().exit()`, so the in-TUI screen returns to Settings rather than killing the session.

Rewrite `src/tui/setup-app.tsx` as the thin wrapper:

```tsx
export function SetupApp({ driver }: SetupAppProps): React.ReactElement {
  const { exit } = useApp()
  const session = useSetupSession({
    driver,
    onSelection: (ids) => void driver.saveSelection(ids),
    onRepo: (entry) => void driver.registerRepo(entry.path),
    onExit: exit,
  })
  return <Setup {...session} draftPath={session.path} />
}
```

`SetupDriver.registerRepo` keeps its `(path: string)` signature for this caller; the hook passes `entry.path`.

- [ ] **Step 6: Prove the wizard still works**

Run: `pnpm vitest run tests/tui/setup-wizard.test.tsx tests/cli/setup-command.test.ts`
Expected: PASS with no test edits. If a test needed editing, the refactor changed behaviour — revisit rather than adapt the test.

- [ ] **Step 7: Write the failing test for the screen**

Append to `tests/tui/settings-edit.test.tsx`:

```tsx
it('opens the setup screen seeded with the current selection', async () => {
  const view = {
    ...VIEW,
    config: {
      ...VIEW.config,
      stageTools: { validate: ['skill-lint'], evaluate: [], security: [], optimise: [] },
    },
    lockedTools: ['skill-lint'],
  }
  const ui = await settingsScreen(fakeViews({ settings: async () => view }))

  await type(ui, ':setup\r')

  // Seeded, so the tool the config already names arrives marked rather than
  // rendering a configured machine as having nothing selected.
  expect(ui.lastFrame()).toContain('skill-lint')
  expect(ui.lastFrame()).toMatch(/\*\s*skill-lint/)
})

it('stages the selection the wizard produced without writing it', async () => {
  const applied: unknown[] = []
  const driver = fakeSetupDriver()
  const ui = await settingsScreen(
    fakeViews({ settings: async () => VIEW, applyConfig: async (next) => void applied.push(next) }),
  )

  await type(ui, ':setup\r')
  // 1 selects the minimal preset, enter advances through install to the repo step.
  await type(ui, '1\r\r')

  expect(applied).toEqual([])
  expect(driver.saved).toEqual([])
})
```

`:` reaches the palette straight from Settings: `app.tsx` handles it before any per-screen branch, so no `esc` is needed first. Keep that ordering when Task 15 adds the edit keys — `:` must stay reachable while the editor is closed, and must not fire while it is open, because a colon is a character a user can legitimately type.

Add `fakeSetupDriver()` to `tests/helpers/fake-views.ts`: a `SetupDriver` whose `probe` resolves one present runtime, `installedTools` resolves `[]`, `install` resolves, `credentialStatus` resolves `{ present: false, warnings: [] }`, `inspectRepo` resolves a directory verdict with `isGit: true`, and `saveSelection` / `registerRepo` push onto exported `saved` / `registered` arrays so a test can assert they were *not* called. No spawn, no filesystem.

- [ ] **Step 8: Run and confirm it fails**

Run: `pnpm vitest run tests/tui/settings-edit.test.tsx -t 'setup screen'`
Expected: FAIL — `:setup` is not a screen.

- [ ] **Step 9: Add the screen**

Add `'setup'` to `SCREENS` in `src/tui/store.ts` — `PALETTE_COMMANDS` maps over `SCREENS`, so `:setup` gets its palette entry with no second registration. Add `setup: SetupDriver` to `AppProps`. In `app.tsx` render a `SetupScreen` for `screen === 'setup'` that calls `useSetupSession` with:

- `seed`: `{ selected: [...new Set([...Object.values(config.stageTools).flat(), ...view.lockedTools])], installed: Object.fromEntries(view.lockedTools.map((id) => [id, 'ok' as const])) }`, over `state.staged ?? view.config`.
- `onSelection`: `dispatch({ type: 'stage-selection', selected })`
- `onRepo`: `dispatch({ type: 'stage-repo', entry })`
- `onExit`: `dispatch({ type: 'set-screen', screen: 'settings' })`

`app.tsx`'s own `useInput` returns early while `screen === 'setup'`, so the hook's handler is the only one acting.

The screen's `onRepo` needs `isGit`, which `RepoInspection` does not carry. Add `isGit: boolean` to `RepoInspection` in `src/core/config/config.ts`, populated from the `isGitRepo(resolved)` call `registerRepo` already makes; `inspectRepo` gains that one call for a directory. The wizard already shows the inspection verdict, so nothing else changes.

- [ ] **Step 10: Run and confirm it passes**

Run: `pnpm vitest run tests/tui/settings-edit.test.tsx`
Expected: PASS.

- [ ] **Step 11: Wire the driver into the TUI command**

In `src/cli/tui-command.ts`, `import { buildSetupDriver } from './setup-command.js'` and pass `setup: buildSetupDriver(options.home)` into `renderApp`.

Run: `pnpm vitest run tests/cli/tui-command.test.ts && pnpm build && pnpm lint`
Expected: all clean.

- [ ] **Step 12: Commit**

```bash
git add src/tui/use-setup-session.ts src/tui/setup-app.tsx src/tui/app.tsx src/tui/store.ts \
        src/core/tools/setup.ts src/core/config/config.ts src/cli/setup-command.ts \
        src/cli/tui-command.ts tests/core/setup.test.ts tests/tui/settings-edit.test.tsx \
        tests/helpers/fake-views.ts
git commit -m "feat: run the setup states as a TUI screen that stages its result (R11.8)"
```

---

### Task 17: The confirmation pane, modal precedence and the budget

**Files:**
- Create: `src/tui/components/ConfirmPane.tsx`
- Modify: `src/tui/app.tsx`, `src/tui/components/Help.tsx`, `src/tui/layout.ts`
- Test: `tests/tui/settings-edit.test.tsx`, `tests/tui/layout.test.tsx`, `tests/acceptance/m6.test.tsx`

**Interfaces:**
- Consumes: Task 13's `configChanges` and `ConfigChange`; Task 15's `confirm` flag and `discard-staged`; Task 14's `GantryViews.applyConfig`.
- Produces: `ConfirmPane({ changes, configPath, offset, layout }): React.ReactElement`.

- [ ] **Step 1: Write the failing pane test**

Append to `tests/tui/settings-edit.test.tsx`:

```tsx
it('renders one row per change, names the file and states the restart', async () => {
  const ui = await settingsScreen()
  await type(ui, 'e4\rc')

  const frame = ui.lastFrame()
  expect(frame).toContain('config.json')
  expect(frame).toContain('concurrency')
  expect(frame).toContain('2 → 4')
  expect(frame).toContain('next launch')
  expect(frame).toContain('a apply · d discard')
})

it('says what a repo removal does and does not delete', async () => {
  const view = {
    ...VIEW,
    repos: [{ id: 'alpha', name: 'alpha', path: '/alpha', isGit: true, skills: 20 }],
    config: {
      ...VIEW.config,
      repos: [{ id: 'alpha', name: 'alpha', path: '/alpha', isGit: true }],
    },
  }
  const ui = await settingsScreen(fakeViews({ settings: async () => view }))
  // j to the repo row, d to stage its removal, c to confirm.
  await type(ui, 'jdc')

  expect(ui.lastFrame()).toContain('repos[alpha]')
  // "Remove" over a path reads as a delete unless the pane says otherwise.
  expect(ui.lastFrame()).toContain('workspaces and recorded runs are kept')
})

it('keeps the mutation review in front of the confirmation', async () => {
  // The review's `a` writes the user's repo; the config pane's writes
  // ~/.skillgantry/config.json. Precedence is ordered by what a keystroke costs.
  const ui = await settingsScreen()
  await type(ui, 'e4\rc')
  // Same seam `tests/tui/review-pane.test.tsx` uses: a mutation:pending event
  // pushed through the queue, not a new test hook.
  pushPendingMutation(queue, { diff: '--- a\n+++ b\n', scope: ['SKILL.md'] })
  await ui.settle()

  expect(ui.lastFrame()).toContain('Review —')
  expect(ui.lastFrame()).not.toContain('a apply · d discard · j/k scroll')
})
```

`settingsScreen` currently discards its queue; return it alongside the harness so this last case can push into it. Copy the pending-mutation event shape verbatim from `tests/tui/review-pane.test.tsx` rather than reconstructing it.

- [ ] **Step 2: Run and confirm they fail**

Run: `pnpm vitest run tests/tui/settings-edit.test.tsx -t 'one row per change'`
Expected: FAIL — nothing renders on `c`.

- [ ] **Step 3: Build `ConfirmPane`**

Create `src/tui/components/ConfirmPane.tsx`:

```tsx
import { Box, Text } from 'ink'
import type { ConfigChange } from '../../core/index.js'
import { innerWidth, screenBodyRows, truncate, truncateMiddle, type Layout } from '../layout.js'
import { Panel } from './Panel.js'

const GLYPH: Record<ConfigChange['kind'], string> = { add: '+', remove: '-', change: '~' }
const COLOUR: Record<ConfigChange['kind'], string> = {
  add: 'green',
  remove: 'red',
  change: 'yellow',
}

/**
 * R11.8 in the terminal: the change set is what the user authorises, and it is
 * field-level rather than textual because a line diff of a JSON document reports
 * an array edit as a block move. Sized from the layout like every other pane,
 * and the overflow notice is counted *against* the allocation rather than
 * appended below it — §14.1's first rule.
 */
export function ConfirmPane({
  changes,
  configPath,
  offset,
  layout,
}: {
  changes: readonly ConfigChange[]
  configPath: string
  offset: number
  layout: Layout
}): React.ReactElement {
  const cols = Math.max(8, innerWidth(layout.columns, layout.chrome))
  // Two rows spent on the footer and the restart notice, so the window is what
  // is left rather than the whole budget.
  const height = Math.max(1, screenBodyRows(layout) - 2)
  const start = Math.min(offset, Math.max(0, changes.length - height))
  const shown = changes.slice(start, Math.min(changes.length, start + height))
  const hidden = changes.length - shown.length
  // Removing a repo takes it out of the config and nothing else; without saying
  // so, "remove" over a path reads as a delete of the directory it names.
  const removesRepo = changes.some(
    (change) => change.kind === 'remove' && change.path.startsWith('repos['),
  )

  return (
    <Panel
      title={`Confirm — ${truncateMiddle(configPath, Math.max(8, cols - 12))}`}
      hint={`${changes.length} change${changes.length === 1 ? '' : 's'}`}
      focused
      chrome={layout.chrome}
    >
      {shown.map((change, index) => (
        <Text key={`${start + index}`} wrap="truncate" color={COLOUR[change.kind]}>
          {truncate(
            `${GLYPH[change.kind]} ${change.path.padEnd(28)} ${
              change.kind === 'add'
                ? (change.after ?? '')
                : change.kind === 'remove'
                  ? (change.before ?? '')
                  : `${change.before ?? ''} → ${change.after ?? ''}`
            }`,
            cols,
          )}
        </Text>
      ))}
      <Text dimColor wrap="truncate">
        {truncate(
          removesRepo
            ? 'takes effect on the next launch · workspaces and recorded runs are kept'
            : 'every change takes effect on the next launch',
          cols,
        )}
      </Text>
      <Box>
        <Text wrap="truncate">
          {truncate(
            `a apply · d discard · j/k scroll${hidden > 0 ? ` · ${hidden} hidden` : ''}`,
            cols,
          )}
        </Text>
      </Box>
    </Panel>
  )
}
```

- [ ] **Step 4: Route it in `app.tsx`**

Add the branch after `state.pending` and before the palette, in both the key handler and the render:

```tsx
// The review pane stays the first branch: it is the one screen that wins over
// every modal, because `a` on it writes to the user's repo. The config
// confirmation is second for the same reason one step down — its `a` writes
// ~/.skillgantry/config.json.
if (state.pending) return <Work state={state} />
if (state.confirm && state.staged) {
  return (
    <ConfirmPane
      changes={configChanges(state.settings!.config, state.staged)}
      configPath={state.settings!.configPath}
      offset={state.screenOffset}
      layout={layout}
    />
  )
}
```

In the key handler, the confirm branch handles `a` (call `views.applyConfig(state.staged)`, then `discard-staged`, `close-confirm` and `refresh-views`; on rejection dispatch `view-error` and leave the staging intact), `d` and `esc` (`close-confirm`), and `j`/`k` (`scroll-screen`).

Use a non-null local rather than `!` if lint objects; the branch has already narrowed both fields.

- [ ] **Step 5: Run and confirm they pass**

Run: `pnpm vitest run tests/tui/settings-edit.test.tsx`
Expected: PASS.

- [ ] **Step 6: Add the bindings to help and extend the layout walk**

In `src/tui/components/Help.tsx` add: `e` edit the selected setting, `d` remove the selected repo, `c` confirm staged changes, `a` apply, `:setup` open the setup wizard. Help keys its rows on key plus description, so the repeated letters are fine.

In `tests/tui/layout.test.tsx` add the setup screen and the confirmation pane to the walk, each with enough content to overflow: a staged config carrying ten changes, and the wizard on `select-tools` with the whole catalogue.

- [ ] **Step 7: Run the layout regression**

Run: `pnpm vitest run tests/tui/layout.test.tsx`
Expected: PASS at every size from 200×60 down to 50×14 — no frame taller than its terminal.

- [ ] **Step 8: Write the failing acceptance case**

Append to `tests/acceptance/m6.test.tsx`. That file already has a `gantry()` helper that `mkdtemp`s a home, writes a real `config.json`, opens a real ledger and records fixture runs, and it mounts `App` with `createGantryViews` and `renderInk`. Extend `gantry()` to also return `home`, and reuse the file's existing mount rather than adding a second one. Keystrokes go through `ui.stdin.send`, as in Task 15.

```tsx
it('edits a setting from the TUI and writes it once', async () => {
  const { home, ui } = await gantry()
  const configPath = join(home, 'config.json')
  const before = await readFile(configPath, 'utf8')

  for (const key of ':settings\re4\r') ui.stdin.send(key)
  await ui.settle()

  // Staged only: R11.8's "not written per keystroke", asserted against bytes.
  expect(await readFile(configPath, 'utf8')).toBe(before)

  for (const key of 'ca') ui.stdin.send(key)
  await ui.settle()

  const after = JSON.parse(await readFile(configPath, 'utf8')) as { concurrency: number }
  expect(after.concurrency).toBe(4)
  expect(ui.lastFrame()).not.toContain('staged')
})

it('leaves the file byte-identical when the edit is discarded', async () => {
  const { home, ui } = await gantry()
  const configPath = join(home, 'config.json')
  const before = await readFile(configPath, 'utf8')

  for (const key of ':settings\re4\rcd') ui.stdin.send(key)
  await ui.settle()

  expect(await readFile(configPath, 'utf8')).toBe(before)
})
```

`gantry()`'s config sets `concurrency: 2`, so `e4` moves it to 4. Add `readFile` to the file's `node:fs/promises` import.

- [ ] **Step 9: Run the acceptance suite**

Run: `SG_ACCEPTANCE=1 pnpm vitest run tests/acceptance/m6.test.tsx`
Expected: PASS, both new cases included.

- [ ] **Step 10: Run the whole check**

Run: `pnpm check`
Expected: lint, build, test and acceptance all clean.

- [ ] **Step 11: Commit**

```bash
git add src/tui/components/ConfirmPane.tsx src/tui/components/Help.tsx src/tui/app.tsx \
        tests/tui/settings-edit.test.tsx tests/tui/layout.test.tsx tests/acceptance/m6.test.tsx
git commit -m "feat: gate settings edits behind a confirmed change set (R11.7, R11.8)"
```

---

## Requirement coverage

| Requirement | Task |
|---|---|
| R11.7 every setting, its value, its holding file, its origin | 14 (origin through the port, groups and origin tokens in the rows), 17 (acceptance) |
| R11.8 staged edits, confirmed change set, one validated write, wizard reuse, no credential editing | 13 (transforms, change list), 15 (staging, editor, removal), 16 (the setup states reused through one hook), 17 (the pane, precedence, acceptance) |

## Deviations found while implementing

- **No `+ add a repo` row.** Task 14 Step 7 put an `open-setup` row at the end of the Repos group. Design §14.2's own mock has no such row, and it made the first actionable row depend on how many repos are registered — so `e` on a freshly-loaded screen edited `concurrency` on one machine and did nothing on another. Adding a repo is `:setup`, which the empty-state line now says. Repos with no entries render a dim hint instead.
- **The editor's buffer starts empty.** The plan's `begin-edit` seeded it with the current value, which makes the first keystroke append: `e4` over a `2` staged `24`. `editing` carries `current` for the prompt (`concurrency [2] → 4`) and `buffer` starts empty, which is what makes the plan's own `e4\r` keystrokes mean what they say.
- **`hasAdapter` is exported from `src/core/index.ts`.** `stage-selection` applies `withStageTools`, which needs R3.5b's runnable predicate, and `src/tui/**` may not import `core/adapters/registry.js` directly. `setup-command.ts` had been spelling the same rule as `getAdapter(id) !== undefined`.
- **`useSetupSession` inspects before handing the entry to its caller, and `onRepo` may reject.** The hook cannot call `driver.registerRepo` itself — the screen stages instead of writing — but it still owns the error path R3.6 needs, so it inspects for the resolved path and `isGit`, awaits `onRepo`, and turns a rejection into the message the wizard already displayed. `SetupDriver.registerRepo` keeps its `(path)` signature for `skillgantry setup`.
- **`ScreenList` gained a `reserve` prop.** The editor line is a row below the panel, and §14.1 forbids appending it: the panel now gives that row up rather than the frame growing past the terminal.
- **The confirm branch closes the editor ref on `enter`.** Keys arriving in the same tick as the enter — the `c` in `e4\rc` — belong to the screen, not to a field already submitted. The sync effect reopens it in the one case where staging refused the value.
- **Two test fixtures had to be re-stated, not adapted.** `SettingsView` now carries the document the rows render, so a fixture setting `concurrency: 3` on the view alone described a config that no `createGantryViews` result could produce. The affected cases in `tests/tui/rows.test.ts` and `tests/tui/tools-settings.test.tsx` set both.
- **The acceptance apply needs its own settle.** `a` writes through the port, so the assertion is one filesystem round trip away rather than one render; the two keystrokes are sent separately.
