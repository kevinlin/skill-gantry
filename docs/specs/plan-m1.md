# SkillGantry M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** revision 2, aligned to [design.md](design.md) revision 3 and [requirements.md](requirements.md) revision 3.

**Goal:** Build the SkillGantry engine end to end for one adapter, driven by a headless command, with every cross-cutting contract — sidecar layout, redaction, fingerprinting, reconciliation, provenance — proven against real tool output from a tool SkillGantry itself installed.

**Architecture:** One npm package, three source roots (`src/core`, `src/tui`, `src/cli`) with a one-directional import boundary enforced by lint. M1 builds `core` and `cli` only; no terminal interface. The engine discovers skills in registered repos, installs SkillSpector into its own tool root, spawns it against one skill, normalises its SARIF into findings, writes evidence to the skill's sidecar workspace, and records runs and issues in SQLite.

**Tech Stack:** TypeScript 5 (ESM, `NodeNext`), Node 24, pnpm, vitest 4, `node:sqlite` (built-in — verified working on Node 24.15 with no flag), `node:child_process` (direct, for process-group control), `zod` for schema validation, `yaml` for frontmatter, `uuid` v14 for UUIDv7, `commander` for the CLI.

No `execa`: the runner needs `detached: true` plus `process.kill(-pid)` to satisfy R5.9's process-tree kill, which is easier to get exactly right with `node:child_process` directly.

No `better-sqlite3`: `node:sqlite` is built in at our Node floor and avoids shipping a native module in an npm-distributed CLI.

## Global Constraints

- Node engine floor: `>=24.0.0`. Declared in `package.json` `engines`.
- ESM only. `"type": "module"`, `tsconfig` `module: "NodeNext"`, `moduleResolution: "NodeNext"`. Relative imports carry the `.js` extension.
- Import boundary: `src/core/**` MUST NOT import from `src/tui/**` or `src/cli/**`. `src/tui/**` MUST NOT import from `src/cli/**`. Enforced by `no-restricted-imports`; a violation fails `pnpm lint`.
- `src/core/**` MUST NOT call `console.*` or `process.exit`. Enforced by `no-console` and `no-process-exit` scoped to that directory.
- `src/core/adapters/**` MUST NOT import `node:fs`, `node:child_process`, `node:https` or `node:net`. Enforced by `no-restricted-imports`. This is R4.3.
- Metric keys are a closed union. Token and cost keys do not exist. This is R1.5.
- Fingerprints never include a line number or message text. This is R8.4.
- The pinned SkillSpector version is `2.5.1`, installed from the git tag `v2.5.1` and the version every fixture was captured from. SkillSpector is not published to PyPI, so its install spec is the git source `git+https://github.com/NVIDIA/skillspector.git` and its pin is a git ref, not a registry version. Upstream carries no `2.3.7` tag, which is why revision 2's pin was unobtainable.
- SkillSpector is always invoked with `--no-llm`, declared in the manifest as `analysisMode: 'static'` with `credentials: { kind: 'none' }`. Its LLM mode needs a provider key and produces nondeterministic findings, which would make golden fixtures worthless. There is no fallback between modes; a mode change is a new adapter id. This is R4.2b.
- Installs relocate through `UV_TOOL_DIR` and `UV_TOOL_BIN_DIR` set on the child. uv 0.7.12 has no `--tool-dir`. Nothing may land in the user's global `~/.local/share/uv/tools`.
- The uv driver forms a registry requirement as `<spec>==<pin>` and a git requirement as `<spec>@<ref>`. A driver that could form only the first cannot install SkillSpector at all.
- One candidate manifest defines which bytes are a skill, for the digest, for tool input and for packaging. No consumer applies its own exclusion list, and nothing filters after a tool has run. This is R2.9.
- Symlinks are hashed as links, never followed. A link escaping the candidate root is an error. This is R2.10.
- British spelling in identifiers that appear in the spec (`optimise`, `artefact`, `normalise`) to match the requirements documents.
- Every commit message uses Conventional Commits.

## Facts established by running the real tool

Both were fed back into [design.md](design.md) revision 3; they are repeated here because several tasks depend on them.

1. SkillSpector 2.5.1's `scan` runs LLM analysis by default and aborts unless a provider credential is present. `--no-llm` selects static analysis and needs none. There is no rule-listing subcommand, so the static rule set, and therefore `manifest.detects`, is derived from captured output by `scripts/capture-fixtures.sh`.
2. SARIF `artifactLocation.uri` is relative to the **scanned directory**, not the repo root. Verified: scanning `declawed` yields `uri: "SKILL.md"` and `uri: "scripts/scan.py"`. The normaliser rebases onto `skill.relPath` to produce the repo-relative path R8.3 requires. This also makes a materialised candidate and an in-place one yield identical findings.

## File structure

```
package.json  tsconfig.json  eslint.config.js  vitest.config.ts  .gitignore
src/
  core/
    index.ts                    public surface re-exports
    types.ts                    Stage, Severity, RuleClass, outcomes, MetricKey, SkillRef
    config/
      schema.ts                 zod schemas for config.json and the tool lock
      config.ts                 load, save, register repo, canonicalise paths
      env.ts                    .env read, mode check, secret value extraction
    discovery/
      frontmatter.ts            split and parse SKILL.md frontmatter
      discover.ts               discoverSkills(), workspacePath()
      candidate.ts              candidateManifest(), materialiseCandidate()
      digest.ts                 skillDigest() over a manifest
    tools/
      uv.ts                     uv-tool install driver
      install.ts                installTool(), verifyTool(), lock writer
    runner/
      redaction.ts              RedactionTransform
      spawn.ts                  runTool(): timeout, process-group kill, artefact load
    adapters/
      types.ts                  AdapterManifest, ParseContext, ToolResult, Parse
      rule-classes.ts           (toolId, nativeRuleId) -> RuleClass, unmapped fallback
      sarif.ts                  shared SARIF 2.1.0 parser
      skillspector.ts           manifest + parse
      registry.ts               id -> { manifest, parse }
    stages/
      types.ts                  StageExecutor, StageContext, StageResult, ToolRunRecord
      outcome.ts                reduceStageOutcome()
      adapter-stage.ts          AdapterStageExecutor
    workspace/
      layout.ts                 path helpers, run id claim
      writer.ts                 run.json, stage.json, index.ndjson, latest, gitignore
    ledger/
      schema.ts                 DDL and migration list
      db.ts                     openLedger()
      fingerprint.ts            fingerprint()
      issues.ts                 transition table
      reconcile.ts              per-detector evidence and conjunctive closure
      record.ts                 recordRun() transaction
    pipeline/
      events.ts                 RunEvent union
      run.ts                    runPipeline() -> RunHandle
  cli/
    index.ts                    bin entry
    run-command.ts              `skillgantry run`
tests/
  fixtures/
    sarif/skillspector-declawed.sarif
    repos/…                     generated by helpers, not committed
  helpers/
    tmp-repo.ts                 build fixture repos in a temp dir
    fake-tool.ts                fixture executables
```

---

### Task 1: Project scaffold with an enforced import boundary

**Files:**
- Create: `package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`
- Create: `src/core/index.ts`, `src/cli/index.ts`
- Test: `tests/boundary.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `pnpm test`, `pnpm lint`, `pnpm build` scripts. `src/core/index.ts` as the sole public surface of the engine.

- [ ] **Step 1: Write the failing test**

`tests/boundary.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const run = promisify(execFile)

describe('import boundary', () => {
  it('rejects an import from core into cli', async () => {
    const offender = join(process.cwd(), 'src/core/__boundary_probe__.ts')
    await writeFile(offender, `import '../cli/index.js'\nexport const x = 1\n`)
    try {
      await run('pnpm', ['exec', 'eslint', offender], { cwd: process.cwd() })
      throw new Error('eslint should have failed')
    } catch (err) {
      expect(String((err as { stdout?: string }).stdout)).toContain('no-restricted-imports')
    } finally {
      await rm(offender, { force: true })
    }
  })

  it('rejects node:fs inside adapters', async () => {
    const offender = join(process.cwd(), 'src/core/adapters/__boundary_probe__.ts')
    await writeFile(offender, `import 'node:fs'\nexport const x = 1\n`)
    try {
      await run('pnpm', ['exec', 'eslint', offender], { cwd: process.cwd() })
      throw new Error('eslint should have failed')
    } catch (err) {
      expect(String((err as { stdout?: string }).stdout)).toContain('no-restricted-imports')
    } finally {
      await rm(offender, { force: true })
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/boundary.test.ts`
Expected: FAIL — no `package.json`, no eslint config, command not found.

- [ ] **Step 3: Write the scaffold**

`package.json`:

```json
{
  "name": "skillgantry",
  "version": "0.1.0",
  "type": "module",
  "bin": { "skillgantry": "./dist/cli/index.js" },
  "engines": { "node": ">=24.0.0" },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "eslint src tests",
    "test": "vitest run",
    "check": "pnpm lint && pnpm build && pnpm test"
  },
  "dependencies": {
    "commander": "^14.0.0",
    "uuid": "^14.0.0",
    "yaml": "^2.8.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "eslint": "^9.0.0",
    "typescript": "^5.7.0",
    "typescript-eslint": "^8.0.0",
    "vitest": "^4.1.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

`eslint.config.js`:

```js
import tseslint from 'typescript-eslint'

const noCrossImport = (patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
})

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/core/**/*.ts'],
    rules: {
      ...noCrossImport([
        { group: ['**/tui/**', '**/cli/**'], message: 'core must not import tui or cli' },
      ]),
      'no-console': 'error',
      'no-process-exit': 'error',
    },
  },
  {
    files: ['src/tui/**/*.ts', 'src/tui/**/*.tsx'],
    rules: noCrossImport([{ group: ['**/cli/**'], message: 'tui must not import cli' }]),
  },
  {
    files: ['src/core/adapters/**/*.ts'],
    rules: noCrossImport([
      { group: ['**/tui/**', '**/cli/**'], message: 'core must not import tui or cli' },
      {
        group: ['node:fs', 'node:fs/*', 'node:child_process', 'node:https', 'node:net'],
        message: 'adapters are pure: they receive artefact bytes, they do not read them',
      },
    ]),
  },
)
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
```

`src/core/index.ts`:

```ts
export * from './types.js'
```

`src/cli/index.ts`:

```ts
#!/usr/bin/env node
export {}
```

`src/core/types.ts` — placeholder for Task 2, so the build compiles:

```ts
export type Stage = 'validate' | 'evaluate' | 'security' | 'optimise' | 'release'
```

Add to `.gitignore`: `dist/`, `node_modules/`, `coverage/`.

- [ ] **Step 4: Install and run the test to verify it passes**

Run: `pnpm install && pnpm vitest run tests/boundary.test.ts`
Expected: PASS, both cases.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json eslint.config.js vitest.config.ts src tests .gitignore pnpm-lock.yaml
git commit -m "feat: scaffold package with enforced import boundary"
```

---

### Task 2: Core types with a closed metric key set

**Files:**
- Modify: `src/core/types.ts`
- Test: `tests/core/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Stage`, `Severity`, `ToolOutcome`, `StageOutcome`, `ErrorKind`, `KnownRuleClass`, `RuleClass`, `MetricKey`, `Metrics`, `coerceMetrics()`, `RepoRef`, `SkillRef`, `RawFinding`. Every later task imports from here.

- [ ] **Step 1: Write the failing test**

`tests/core/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { KNOWN_RULE_CLASSES, METRIC_KEYS, coerceMetrics } from '../../src/core/types.js'

describe('metric keys', () => {
  it('has no token or cost key', () => {
    for (const key of METRIC_KEYS) {
      expect(key).not.toMatch(/token|cost|price|usd/i)
    }
  })

  it('keeps known keys', () => {
    expect(coerceMetrics({ durationMs: 12, casesPassed: 3 })).toEqual({
      durationMs: 12,
      casesPassed: 3,
    })
  })

  it('throws on an unknown key so token fields cannot leak in', () => {
    expect(() => coerceMetrics({ input_tokens: 900 })).toThrow(/unknown metric key: input_tokens/)
  })

  it('throws on a non-finite value', () => {
    expect(() => coerceMetrics({ durationMs: Number.NaN })).toThrow(/non-finite/)
  })
})

describe('rule classes', () => {
  it('contains the twelve known classes and no duplicates', () => {
    expect(KNOWN_RULE_CLASSES).toHaveLength(12)
    expect(new Set(KNOWN_RULE_CLASSES).size).toBe(12)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/types.test.ts`
Expected: FAIL — `KNOWN_RULE_CLASSES` is not exported.

- [ ] **Step 3: Write the implementation**

Replace `src/core/types.ts`:

```ts
export type Stage = 'validate' | 'evaluate' | 'security' | 'optimise' | 'release'

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export type ToolOutcome = 'passed' | 'failed' | 'errored' | 'skipped'

export type StageOutcome = 'passed' | 'failed' | 'degraded' | 'errored' | 'skipped'

/** One per non-passing row of the R4.13 classification table. */
export type ErrorKind =
  | 'spawn'
  | 'timeout'
  | 'missing-artefact'
  | 'parse'
  | 'cancelled'
  | 'not-installed'
  | 'no-credentials'
  | 'no-authorisation'
  | 'artefact-too-large'

export const KNOWN_RULE_CLASSES = [
  'prompt-injection',
  'credential-access',
  'unsafe-script',
  'data-exfiltration',
  'vulnerable-dep',
  'excessive-permission',
  'metadata-invalid',
  'structure-invalid',
  'trigger-quality',
  'reference-broken',
  'eval-failure',
  'compat-risk',
] as const

export type KnownRuleClass = (typeof KNOWN_RULE_CLASSES)[number]

/** `unmapped:<toolId>:<nativeRuleId>` — tool-scoped, never merges across tools. */
export type RuleClass = KnownRuleClass | `unmapped:${string}`

/**
 * Closed set. Token and cost keys are absent by construction, which is how
 * R1.5 is enforced rather than merely stated.
 */
export const METRIC_KEYS = [
  'durationMs',
  'casesTotal',
  'casesPassed',
  'casesErrored',
  'turns',
  'findingsTotal',
  'filesScanned',
  'rulesEvaluated',
] as const

export type MetricKey = (typeof METRIC_KEYS)[number]

export type Metrics = Partial<Record<MetricKey, number>>

const METRIC_KEY_SET: ReadonlySet<string> = new Set(METRIC_KEYS)

export function coerceMetrics(input: Record<string, number>): Metrics {
  const out: Metrics = {}
  for (const [key, value] of Object.entries(input)) {
    if (!METRIC_KEY_SET.has(key)) {
      throw new Error(`unknown metric key: ${key}`)
    }
    if (!Number.isFinite(value)) {
      throw new Error(`non-finite metric value for ${key}`)
    }
    out[key as MetricKey] = value
  }
  return out
}

export interface RepoRef {
  id: string
  /** Canonical absolute path. */
  path: string
  name: string
  isGit: boolean
}

export interface SkillRef {
  /** `${repo.id}/${dirName}`, or `repo.id` for a repo-root skill. */
  id: string
  name: string | null
  version: string | null
  /** Absolute path to the skill directory. */
  dir: string
  /** Repo-relative path to the skill directory; '.' for a repo-root skill. */
  relPath: string
  repo: RepoRef
  rootSkill: boolean
  /** Absolute path to the sidecar workspace root. */
  workspacePath: string
}

export interface RawFinding {
  ruleClass: RuleClass
  nativeRuleId: string
  severity: Severity
  /** Repo-relative, POSIX separators. */
  path: string
  /** Display only. Never part of a fingerprint. */
  line?: number
  message: string
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/core/types.test.ts`
Expected: PASS, five cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts tests/core/types.test.ts
git commit -m "feat(core): add shared types with a closed metric key set"
```

---

### Task 3: SKILL.md frontmatter parsing

**Files:**
- Create: `src/core/discovery/frontmatter.ts`
- Test: `tests/core/frontmatter.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseFrontmatter(source: string): { name: string | null; version: string | null }`.

- [ ] **Step 1: Write the failing test**

`tests/core/frontmatter.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from '../../src/core/discovery/frontmatter.js'

describe('parseFrontmatter', () => {
  it('reads name and metadata.version', () => {
    const src = [
      '---',
      'name: declawed',
      'description: de-slop pass',
      'metadata:',
      '  version: 1.1.0',
      '---',
      '',
      '# Declawed',
    ].join('\n')
    expect(parseFrontmatter(src)).toEqual({ name: 'declawed', version: '1.1.0' })
  })

  it('returns nulls when there is no frontmatter', () => {
    expect(parseFrontmatter('# Just a heading\n')).toEqual({ name: null, version: null })
  })

  it('returns nulls when the fields are absent', () => {
    expect(parseFrontmatter('---\ndescription: x\n---\n')).toEqual({ name: null, version: null })
  })

  it('tolerates malformed yaml without throwing', () => {
    expect(parseFrontmatter('---\nname: [unclosed\n---\n')).toEqual({ name: null, version: null })
  })

  it('coerces a numeric version to a string', () => {
    expect(parseFrontmatter('---\nmetadata:\n  version: 2\n---\n').version).toBe('2')
  })

  it('accepts CRLF line endings', () => {
    expect(parseFrontmatter('---\r\nname: x\r\n---\r\n').name).toBe('x')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/frontmatter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/core/discovery/frontmatter.ts`:

```ts
import { parse as parseYaml } from 'yaml'

const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

export interface Frontmatter {
  name: string | null
  version: string | null
}

const EMPTY: Frontmatter = { name: null, version: null }

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

/**
 * Never throws. Absent or malformed frontmatter yields nulls, which is what
 * R2.5 requires: a bad skill must not fail the whole scan.
 */
export function parseFrontmatter(source: string): Frontmatter {
  const match = FRONTMATTER.exec(source)
  if (!match?.[1]) return EMPTY

  let doc: unknown
  try {
    doc = parseYaml(match[1])
  } catch {
    return EMPTY
  }
  if (typeof doc !== 'object' || doc === null) return EMPTY

  const record = doc as Record<string, unknown>
  const metadata =
    typeof record.metadata === 'object' && record.metadata !== null
      ? (record.metadata as Record<string, unknown>)
      : {}

  return { name: asString(record.name), version: asString(metadata.version) }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/core/frontmatter.test.ts`
Expected: PASS, six cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/discovery/frontmatter.ts tests/core/frontmatter.test.ts
git commit -m "feat(discovery): parse SKILL.md frontmatter without throwing"
```

---

### Task 4: Skill discovery and workspace path

**Files:**
- Create: `src/core/discovery/discover.ts`
- Create: `tests/helpers/tmp-repo.ts`
- Test: `tests/core/discover.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter` (Task 3); `RepoRef`, `SkillRef` (Task 2).
- Produces: `workspacePath(repoPath, relPath, rootSkill): string`, `discoverSkills(repo: RepoRef): Promise<SkillRef[]>`, `isGitRepo(path): Promise<boolean>`.
- Produces the test helper `makeRepo(spec): Promise<string>` used by Tasks 5, 15 and 20.

- [ ] **Step 1: Write the failing test**

`tests/helpers/tmp-repo.ts`:

```ts
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export interface RepoSpec {
  /** Relative path -> file contents. Directories are created as needed. */
  files: Record<string, string>
}

export async function makeRepo(spec: RepoSpec): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'skillgantry-'))
  for (const [rel, contents] of Object.entries(spec.files)) {
    const abs = join(root, rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, contents)
  }
  return root
}

export const SKILL_MD = (name: string, version = '1.0.0'): string =>
  `---\nname: ${name}\nmetadata:\n  version: ${version}\n---\n\n# ${name}\n`
```

`tests/core/discover.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { basename, join } from 'node:path'
import { discoverSkills, workspacePath } from '../../src/core/discovery/discover.js'
import type { RepoRef } from '../../src/core/types.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'

const repoRef = (path: string): RepoRef => ({
  id: 'fx',
  path,
  name: basename(path),
  isGit: false,
})

describe('discoverSkills', () => {
  it('finds direct children holding SKILL.md', async () => {
    const root = await makeRepo({
      files: {
        'declawed/SKILL.md': SKILL_MD('declawed', '1.1.0'),
        'spec-lint/SKILL.md': SKILL_MD('spec-lint'),
        'README.md': '# repo\n',
      },
    })
    const skills = await discoverSkills(repoRef(root))
    expect(skills.map((s) => s.id).sort()).toEqual(['fx/declawed', 'fx/spec-lint'])
    expect(skills.find((s) => s.id === 'fx/declawed')?.version).toBe('1.1.0')
  })

  it('skips workspace dirs, dotdirs and node_modules', async () => {
    const root = await makeRepo({
      files: {
        'declawed/SKILL.md': SKILL_MD('declawed'),
        'agent-insights-workspace/skill-snapshot/SKILL.md': SKILL_MD('snapshot'),
        '.hidden/SKILL.md': SKILL_MD('hidden'),
        'node_modules/pkg/SKILL.md': SKILL_MD('vendored'),
      },
    })
    const skills = await discoverSkills(repoRef(root))
    expect(skills.map((s) => s.id)).toEqual(['fx/declawed'])
  })

  it('treats a repo whose root holds SKILL.md as one skill', async () => {
    const root = await makeRepo({ files: { 'SKILL.md': SKILL_MD('solo') } })
    const skills = await discoverSkills(repoRef(root))
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({ id: 'fx', relPath: '.', rootSkill: true })
    expect(skills[0]?.workspacePath).toBe(join(root, '.skillgantry-workspace'))
  })

  it('does not fail the scan on unreadable frontmatter', async () => {
    const root = await makeRepo({
      files: { 'broken/SKILL.md': '---\nname: [unclosed\n---\n', 'ok/SKILL.md': SKILL_MD('ok') },
    })
    const skills = await discoverSkills(repoRef(root))
    expect(skills).toHaveLength(2)
    expect(skills.find((s) => s.id === 'fx/broken')?.name).toBeNull()
  })
})

describe('workspacePath', () => {
  it('uses a sibling directory for a nested skill', () => {
    expect(workspacePath('/r', 'declawed', false)).toBe('/r/declawed-workspace')
  })

  it('uses an in-repo dotdirectory for a repo-root skill', () => {
    expect(workspacePath('/r', '.', true)).toBe('/r/.skillgantry-workspace')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/discover.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/core/discovery/discover.ts`:

```ts
import { access, readFile, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { RepoRef, SkillRef } from '../types.js'
import { parseFrontmatter } from './frontmatter.js'

export const WORKSPACE_SUFFIX = '-workspace'
export const ROOT_WORKSPACE_DIR = '.skillgantry-workspace'

/**
 * A repo-root skill cannot use the sibling convention: a sibling of the repo
 * root lies outside the repo and could not be covered by its .gitignore.
 */
export function workspacePath(repoPath: string, relPath: string, rootSkill: boolean): string {
  return rootSkill
    ? join(repoPath, ROOT_WORKSPACE_DIR)
    : join(repoPath, `${basename(relPath)}${WORKSPACE_SUFFIX}`)
}

export function isExcludedDir(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules' || name.endsWith(WORKSPACE_SUFFIX)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function isGitRepo(repoPath: string): Promise<boolean> {
  return exists(join(repoPath, '.git'))
}

async function toSkill(
  repo: RepoRef,
  id: string,
  dir: string,
  relPath: string,
  rootSkill: boolean,
): Promise<SkillRef> {
  let front = { name: null as string | null, version: null as string | null }
  try {
    front = parseFrontmatter(await readFile(join(dir, 'SKILL.md'), 'utf8'))
  } catch {
    // Unreadable SKILL.md still yields a skill with null metadata — R2.5.
  }
  return {
    id,
    name: front.name,
    version: front.version,
    dir,
    relPath,
    repo,
    rootSkill,
    workspacePath: workspacePath(repo.path, relPath, rootSkill),
  }
}

/**
 * Only direct children are examined, so a nested SKILL.md inside a snapshot or
 * fixture is unreachable by construction rather than by exclusion list.
 */
export async function discoverSkills(repo: RepoRef): Promise<SkillRef[]> {
  if (await exists(join(repo.path, 'SKILL.md'))) {
    return [await toSkill(repo, repo.id, repo.path, '.', true)]
  }

  const entries = await readdir(repo.path, { withFileTypes: true })
  const skills: SkillRef[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || isExcludedDir(entry.name)) continue
    const dir = join(repo.path, entry.name)
    if (!(await exists(join(dir, 'SKILL.md')))) continue
    skills.push(await toSkill(repo, `${repo.id}/${entry.name}`, dir, entry.name, false))
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/core/discover.test.ts`
Expected: PASS, six cases.

- [ ] **Step 5: Verify against the real reference repo**

Run:

```bash
pnpm exec tsx -e "
import { discoverSkills } from './src/core/discovery/discover.js'
const repo = { id:'zapac', path:'/Users/kevinlin/dev/ai-sdlc/zapac-agent-skills', name:'zapac', isGit:true }
const s = await discoverSkills(repo)
console.log(s.length, s.some(x => x.id.includes('skill-snapshot')))
"
```

Expected: `20 false` — matches the R2.3 verification clause. The count tracks the reference repo rather than the spec: what R2.3 binds is the `false`, meaning the `*-workspace/` snapshot trap is excluded.

- [ ] **Step 6: Commit**

```bash
git add src/core/discovery/discover.ts tests/core/discover.test.ts tests/helpers/tmp-repo.ts
git commit -m "feat(discovery): discover skills and resolve workspace paths"
```

---

### Task 5: Candidate manifest and skill digest

**Files:**
- Create: `src/core/discovery/candidate.ts`
- Create: `src/core/discovery/digest.ts`
- Test: `tests/core/candidate.test.ts`, `tests/core/digest.test.ts`

**Interfaces:**
- Consumes: `SkillRef` (Task 2), which already carries the resolved `workspacePath` from Task 4.
- Produces: `CandidateManifest`, `CandidateEntry`, `candidateManifest(skill): Promise<CandidateManifest>`, `materialiseCandidate(manifest, destRoot): Promise<string>`, `skillDigest(manifest): Promise<string>`, `digestSkill(skill): Promise<string>`, and `gitState(repoPath, relPath): Promise<{ commit: string | null; dirty: boolean }>`.

This task carries three corrections from the second design review, and each one is a test below.

**Exclusions are exact paths, never basenames.** Revision 2 excluded "any `snapshot-pre/` directory", so a skill legitimately containing `snapshot-pre/` could change without invalidating its gate evidence. Snapshots live under the workspace, which is already excluded, so the basename rule was pure hazard.

**Symlinks are hashed as links.** Following one can hash or package content outside the repo; ignoring one entirely misses a real change. Recording the link and its target text does neither. A link resolving outside the candidate root is a hard error, because no consumer has a safe answer for it: not the digest, the snapshot, the diff, the rollback or the archive.

**One manifest, four consumers.** The digest is a pure function of the manifest, so the bytes gated, snapshotted and packaged are the same set by construction. `materialiseCandidate` exists for the repo-root case, where the workspace would otherwise sit inside the tree a tool is pointed at.

- [ ] **Step 1: Write the failing test**

`tests/core/candidate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readlink, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { candidateManifest, materialiseCandidate } from '../../src/core/discovery/candidate.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import type { RepoRef } from '../../src/core/types.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'

const repoRef = (path: string): RepoRef => ({ id: 'fx', path, name: 'fx', isGit: false })

const only = async (root: string) => (await discoverSkills(repoRef(root)))[0]!

describe('candidateManifest', () => {
  it('lists files sorted, with the exec bit', async () => {
    const root = await makeRepo({
      files: { 'a/SKILL.md': SKILL_MD('a'), 'a/scripts/run.sh': '#!/bin/sh\n' },
    })
    const m = await candidateManifest(await only(root))
    expect(m.entries.map((e) => e.relPath)).toEqual(['SKILL.md', 'scripts/run.sh'])
    expect(m.selfContained).toBe(true)
  })

  it('excludes the exact workspace path but keeps a directory named snapshot-pre', async () => {
    const root = await makeRepo({
      files: {
        'a/SKILL.md': SKILL_MD('a'),
        'a/snapshot-pre/notes.md': 'a legitimate skill directory\n',
        'a-workspace/skillgantry/runs/x/run.json': '{}',
      },
    })
    const m = await candidateManifest(await only(root))
    expect(m.entries.map((e) => e.relPath)).toContain('snapshot-pre/notes.md')
    expect(m.entries.some((e) => e.relPath.includes('workspace'))).toBe(false)
  })

  it('marks a repo-root candidate not self-contained and drops its control files', async () => {
    const root = await makeRepo({
      files: { 'SKILL.md': SKILL_MD('solo'), '.gitignore': '*-workspace/\n' },
    })
    await mkdir(join(root, '.skillgantry-workspace'), { recursive: true })
    await writeFile(join(root, '.skillgantry-workspace/leak.json'), 'sk-secret\n')
    await writeFile(join(root, 'solo_1.0.0.zip'), 'PK')
    const m = await candidateManifest(await only(root))
    expect(m.selfContained).toBe(false)
    expect(m.entries.map((e) => e.relPath)).toEqual(['SKILL.md'])
  })

  it('records a symlink as a link and never reads its target', async () => {
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a'), 'a/real.md': 'x\n' } })
    await symlink('real.md', join(root, 'a/alias.md'))
    const m = await candidateManifest(await only(root))
    expect(m.entries.find((e) => e.relPath === 'alias.md')).toEqual({
      kind: 'symlink',
      relPath: 'alias.md',
      target: 'real.md',
    })
  })

  it('rejects a symlink escaping the candidate root', async () => {
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a'), 'outside.md': 'x\n' } })
    await symlink('../outside.md', join(root, 'a/escape.md'))
    await expect(candidateManifest(await only(root))).rejects.toThrow(/candidate-escapes-root/)
  })
})

describe('materialiseCandidate', () => {
  it('copies only manifest entries, preserving links and modes', async () => {
    const root = await makeRepo({
      files: { 'SKILL.md': SKILL_MD('solo'), 'scripts/run.sh': '#!/bin/sh\n' },
    })
    await mkdir(join(root, '.skillgantry-workspace'), { recursive: true })
    await writeFile(join(root, '.skillgantry-workspace/leak.json'), 'sk-canary\n')
    await symlink('scripts/run.sh', join(root, 'alias.sh'))

    const m = await candidateManifest(await only(root))
    const dest = await materialiseCandidate(m, await mkdtemp(join(tmpdir(), 'sg-cand-')))

    await expect(readFile(join(dest, 'SKILL.md'), 'utf8')).resolves.toContain('solo')
    expect(await readlink(join(dest, 'alias.sh'))).toBe('scripts/run.sh')
    await expect(readFile(join(dest, '.skillgantry-workspace/leak.json'))).rejects.toThrow()
  })
})
```

`tests/core/digest.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { chmod, mkdir, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { digestSkill } from '../../src/core/discovery/digest.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import type { RepoRef } from '../../src/core/types.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'

const repoRef = (path: string): RepoRef => ({ id: 'fx', path, name: 'fx', isGit: false })
const only = async (root: string) => (await discoverSkills(repoRef(root)))[0]!
const digestOf = async (root: string) => digestSkill(await only(root))

describe('digestSkill', () => {
  it('is stable across repeated calls', async () => {
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    expect(await digestOf(root)).toBe(await digestOf(root))
  })

  it('changes when any byte of the skill changes', async () => {
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    const before = await digestOf(root)
    await writeFile(join(root, 'a/SKILL.md'), `${SKILL_MD('a')}\n`)
    expect(await digestOf(root)).not.toBe(before)
  })

  it('ignores the workspace directory so writing a run does not change it', async () => {
    const root = await makeRepo({ files: { 'SKILL.md': SKILL_MD('solo') } })
    const before = await digestOf(root)
    await mkdir(join(root, '.skillgantry-workspace/runs/x'), { recursive: true })
    await writeFile(join(root, '.skillgantry-workspace/runs/x/run.json'), '{}')
    expect(await digestOf(root)).toBe(before)
  })

  it('does change when a directory named snapshot-pre changes', async () => {
    const root = await makeRepo({
      files: { 'a/SKILL.md': SKILL_MD('a'), 'a/snapshot-pre/notes.md': 'one\n' },
    })
    const before = await digestOf(root)
    await writeFile(join(root, 'a/snapshot-pre/notes.md'), 'two\n')
    expect(await digestOf(root)).not.toBe(before)
  })

  it('changes when the executable bit changes', async () => {
    const root = await makeRepo({
      files: { 'a/SKILL.md': SKILL_MD('a'), 'a/scripts/run.sh': '#!/bin/sh\necho hi\n' },
    })
    const before = await digestOf(root)
    await chmod(join(root, 'a/scripts/run.sh'), 0o755)
    expect(await digestOf(root)).not.toBe(before)
  })

  it('changes when a symlink is retargeted, without reading either target', async () => {
    const root = await makeRepo({
      files: { 'a/SKILL.md': SKILL_MD('a'), 'a/one.md': 'x\n', 'a/two.md': 'x\n' },
    })
    await symlink('one.md', join(root, 'a/alias.md'))
    const before = await digestOf(root)
    await unlink(join(root, 'a/alias.md'))
    await symlink('two.md', join(root, 'a/alias.md'))
    expect(await digestOf(root)).not.toBe(before)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/candidate.test.ts tests/core/digest.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`src/core/discovery/candidate.ts`:

```ts
import { copyFile, chmod, lstat, mkdir, readdir, readlink, symlink } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { SkillRef } from '../types.js'

export type CandidateEntry =
  | { kind: 'file'; relPath: string; exec: boolean }
  | { kind: 'symlink'; relPath: string; target: string }

export interface CandidateManifest {
  root: string
  entries: CandidateEntry[]
  /** False when the root would otherwise hold SkillGantry-owned paths. */
  selfContained: boolean
}

const posix = (p: string): string => p.split(sep).join('/')

/**
 * Exact owned paths, resolved against the candidate root. Deliberately not a
 * basename match: revision 2 excluded any directory called `snapshot-pre`,
 * which let a legitimately named skill directory change without invalidating
 * the gate evidence bound to its digest.
 */
function excludedPaths(skill: SkillRef): Set<string> {
  const owned = new Set<string>([
    posix(relative(skill.dir, skill.workspacePath)),
    '.git',
  ])
  if (skill.rootSkill) owned.add('.gitignore')
  return owned
}

const isReleaseArchive = (skill: SkillRef, rel: string): boolean =>
  skill.rootSkill && /^[^/]+_[^/]*\.zip$/.test(rel)

export async function candidateManifest(skill: SkillRef): Promise<CandidateManifest> {
  const excluded = excludedPaths(skill)
  const entries: CandidateEntry[] = []

  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name)
      const rel = posix(relative(skill.dir, abs))
      if (excluded.has(rel) || isReleaseArchive(skill, rel)) continue

      if (e.isSymbolicLink()) {
        const target = await readlink(abs)
        const resolved = resolve(dirname(abs), target)
        const inside = resolved === skill.dir || resolved.startsWith(skill.dir + sep)
        if (!inside) {
          throw new Error(`candidate-escapes-root: ${rel} -> ${target}`)
        }
        entries.push({ kind: 'symlink', relPath: rel, target })
      } else if (e.isDirectory()) {
        await walk(abs)
      } else if (e.isFile()) {
        // lstat, not stat: a mode must describe the entry itself, never a target.
        const info = await lstat(abs)
        entries.push({ kind: 'file', relPath: rel, exec: (info.mode & 0o111) !== 0 })
      }
    }
  }
  await walk(skill.dir)

  entries.sort((a, b) => a.relPath.localeCompare(b.relPath))

  return {
    root: skill.dir,
    entries,
    // A repo-root skill keeps its workspace, gitignore and archives inside the
    // root, so the root alone is not a safe thing to hand a tool.
    selfContained: !skill.rootSkill,
  }
}

/** Copies exactly the manifest into destRoot. Nothing else can be observed there. */
export async function materialiseCandidate(
  manifest: CandidateManifest,
  destRoot: string,
): Promise<string> {
  for (const entry of manifest.entries) {
    const dest = join(destRoot, entry.relPath)
    await mkdir(dirname(dest), { recursive: true })
    if (entry.kind === 'symlink') {
      await symlink(entry.target, dest)
    } else {
      await copyFile(join(manifest.root, entry.relPath), dest)
      if (entry.exec) await chmod(dest, 0o755)
    }
  }
  return destRoot
}
```

`src/core/discovery/digest.ts`:

```ts
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { SkillRef } from '../types.js'
import { type CandidateManifest, candidateManifest } from './candidate.js'

const run = promisify(execFile)

/**
 * Content identity of a skill, independent of git. This is the only identifier
 * available for the non-git skills, which are the majority by count, so it —
 * not the commit — is what binds release evidence to the bytes released.
 *
 * A pure function of the manifest, so the bytes gated, snapshotted and packaged
 * are the same set by construction rather than by three exclusion lists agreeing.
 */
export async function skillDigest(manifest: CandidateManifest): Promise<string> {
  const outer = createHash('sha256')
  for (const entry of manifest.entries) {
    if (entry.kind === 'symlink') {
      const target = createHash('sha256').update(entry.target).digest('hex')
      outer.update(`${entry.relPath}\0l\0${target}\n`)
    } else {
      const bytes = await readFile(join(manifest.root, entry.relPath))
      const inner = createHash('sha256').update(bytes).digest('hex')
      outer.update(`${entry.relPath}\0f\0${entry.exec ? '1' : '0'}\0${inner}\n`)
    }
  }
  return `sha256:${outer.digest('hex')}`
}

export const digestSkill = async (skill: SkillRef): Promise<string> =>
  skillDigest(await candidateManifest(skill))

export interface GitState {
  commit: string | null
  dirty: boolean
}

export async function gitState(repoPath: string, relPath: string): Promise<GitState> {
  try {
    const head = await run('git', ['rev-parse', 'HEAD'], { cwd: repoPath })
    const status = await run('git', ['status', '--porcelain', '--', relPath], { cwd: repoPath })
    return { commit: head.stdout.trim(), dirty: status.stdout.trim().length > 0 }
  } catch {
    return { commit: null, dirty: false }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/core/candidate.test.ts tests/core/digest.test.ts`
Expected: PASS, twelve cases. The `snapshot-pre` and escaping-symlink cases are the R2.9 and R2.10 acceptance checks.

- [ ] **Step 5: Commit**

```bash
git add src/core/discovery/candidate.ts src/core/discovery/digest.ts \
        tests/core/candidate.test.ts tests/core/digest.test.ts
git commit -m "feat(discovery): define the candidate manifest and digest it"
```

---

### Task 6: Config store with path canonicalisation

**Files:**
- Create: `src/core/config/schema.ts`, `src/core/config/config.ts`
- Test: `tests/core/config.test.ts`

**Interfaces:**
- Consumes: `isGitRepo` (Task 4), `Stage` (Task 2).
- Produces: `GantryConfig`, `ToolLock`, `ToolLockEntry`, `loadConfig(home)`, `saveConfig(home, cfg)`, `registerRepo(home, path)`, `canonicalisePath(p)`, `loadToolLock(home)`, `DEFAULT_CONFIG`.

- [ ] **Step 1: Write the failing test**

`tests/core/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtemp, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_CONFIG,
  canonicalisePath,
  loadConfig,
  registerRepo,
  saveConfig,
} from '../../src/core/config/config.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'

const home = async (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-home-'))

describe('loadConfig', () => {
  it('returns defaults when no file exists', async () => {
    expect(await loadConfig(await home())).toEqual(DEFAULT_CONFIG)
  })

  it('round-trips through save', async () => {
    const h = await home()
    const cfg = { ...DEFAULT_CONFIG, concurrency: 4 }
    await saveConfig(h, cfg)
    expect((await loadConfig(h)).concurrency).toBe(4)
  })

  it('rejects a config that fails validation', async () => {
    const h = await home()
    await saveConfig(h, { ...DEFAULT_CONFIG, concurrency: 0 } as never).catch(() => undefined)
    await expect(saveConfig(h, { ...DEFAULT_CONFIG, concurrency: 0 } as never)).rejects.toThrow()
  })
})

describe('registerRepo', () => {
  it('records a canonical path, name and git flag', async () => {
    const h = await home()
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    const cfg = await registerRepo(h, root)
    expect(cfg.repos).toHaveLength(1)
    expect(cfg.repos[0]?.path).toBe(await canonicalisePath(root))
    expect(cfg.repos[0]?.isGit).toBe(false)
  })

  it('rejects a path that canonicalises onto an existing repo', async () => {
    const h = await home()
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    await registerRepo(h, root)
    const link = join(await mkdtemp(join(tmpdir(), 'sg-link-')), 'alias')
    await symlink(root, link)
    await expect(registerRepo(h, link)).rejects.toThrow(/already registered/)
  })

  it('strips a trailing separator before comparing', async () => {
    const h = await home()
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    await registerRepo(h, root)
    await expect(registerRepo(h, `${root}/`)).rejects.toThrow(/already registered/)
  })

  it('deduplicates ids with a numeric suffix', async () => {
    const h = await home()
    const one = await makeRepo({ files: { 'skills/SKILL.md': SKILL_MD('x') } })
    const two = await makeRepo({ files: { 'skills/SKILL.md': SKILL_MD('y') } })
    await registerRepo(h, join(one, 'skills'))
    const cfg = await registerRepo(h, join(two, 'skills'))
    expect(cfg.repos.map((r) => r.id)).toEqual(['skills', 'skills-2'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/core/config/schema.ts`:

```ts
import { z } from 'zod'

export const repoSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  name: z.string().min(1),
  isGit: z.boolean(),
})

export const stageToolsSchema = z.object({
  validate: z.array(z.string()).default([]),
  evaluate: z.array(z.string()).default([]),
  security: z.array(z.string()).default([]),
  optimise: z.array(z.string()).default([]),
})

export const configSchema = z.object({
  version: z.literal(1),
  repos: z.array(repoSchema).default([]),
  stageTools: stageToolsSchema,
  concurrency: z.number().int().min(1).max(16),
  artefactSizeCapBytes: z.number().int().min(1),
  timeoutOverridesMs: z.record(z.string(), z.number().int().min(1)).default({}),
})

export type GantryConfig = z.infer<typeof configSchema>

export const toolLockEntrySchema = z.object({
  installKind: z.enum(['uv-tool', 'npm-prefix', 'gh-release']),
  requestedPin: z.string(),
  resolvedVersion: z.string(),
  bin: z.string().min(1),
  /** 'n/a' when the package manager verified its own download, else 'sha256:…' or 'none'. */
  integrity: z.string().min(1).default('n/a'),
  installedAt: z.string(),
  verifiedAt: z.string().nullable(),
})

export const toolLockSchema = z.object({
  version: z.literal(1),
  tools: z.record(z.string(), toolLockEntrySchema).default({}),
})

export type ToolLockEntry = z.infer<typeof toolLockEntrySchema>
export type ToolLock = z.infer<typeof toolLockSchema>
```

`src/core/config/config.ts`:

```ts
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { isGitRepo } from '../discovery/discover.js'
import {
  type GantryConfig,
  type ToolLock,
  configSchema,
  toolLockSchema,
} from './schema.js'

export type { GantryConfig, ToolLock, ToolLockEntry } from './schema.js'

export const DEFAULT_CONFIG: GantryConfig = {
  version: 1,
  repos: [],
  stageTools: { validate: [], evaluate: [], security: ['skillspector'], optimise: [] },
  concurrency: 2,
  artefactSizeCapBytes: 32 * 1024 * 1024,
  timeoutOverridesMs: {},
}

const configFile = (home: string): string => join(home, 'config.json')
const lockFile = (home: string): string => join(home, 'tools', 'lock.json')

/** Expand, resolve symlinks, strip a trailing separator. */
export async function canonicalisePath(input: string): Promise<string> {
  const absolute = resolve(input)
  let real: string
  try {
    real = await realpath(absolute)
  } catch {
    real = absolute
  }
  return real.length > 1 && real.endsWith(sep) ? real.slice(0, -1) : real
}

export async function loadConfig(home: string): Promise<GantryConfig> {
  try {
    return configSchema.parse(JSON.parse(await readFile(configFile(home), 'utf8')))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_CONFIG
    throw err
  }
}

export async function saveConfig(home: string, config: GantryConfig): Promise<void> {
  const validated = configSchema.parse(config)
  await mkdir(home, { recursive: true })
  await writeFile(configFile(home), `${JSON.stringify(validated, null, 2)}\n`)
}

function uniqueId(desired: string, taken: ReadonlySet<string>): string {
  if (!taken.has(desired)) return desired
  for (let n = 2; ; n += 1) {
    const candidate = `${desired}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

export async function registerRepo(home: string, repoPath: string): Promise<GantryConfig> {
  const path = await canonicalisePath(repoPath)
  const config = await loadConfig(home)
  if (config.repos.some((r) => r.path === path)) {
    throw new Error(`already registered: ${path}`)
  }
  const name = basename(path)
  const next: GantryConfig = {
    ...config,
    repos: [
      ...config.repos,
      {
        id: uniqueId(name, new Set(config.repos.map((r) => r.id))),
        path,
        name,
        isGit: await isGitRepo(path),
      },
    ],
  }
  await saveConfig(home, next)
  return next
}

export async function loadToolLock(home: string): Promise<ToolLock> {
  try {
    return toolLockSchema.parse(JSON.parse(await readFile(lockFile(home), 'utf8')))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, tools: {} }
    throw err
  }
}

export async function saveToolLock(home: string, lock: ToolLock): Promise<void> {
  const validated = toolLockSchema.parse(lock)
  await mkdir(join(home, 'tools'), { recursive: true })
  await writeFile(lockFile(home), `${JSON.stringify(validated, null, 2)}\n`)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/core/config.test.ts`
Expected: PASS, seven cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/config tests/core/config.test.ts
git commit -m "feat(config): add config and tool lock stores with path canonicalisation"
```

---

### Task 6a: `uv-tool` install driver and lock writer

**Files:**
- Create: `src/core/tools/uv.ts`, `src/core/tools/install.ts`
- Test: `tests/core/install.test.ts`

**Interfaces:**
- Consumes: `ToolLock`, `ToolLockEntry`, `loadToolLock`, `saveToolLock` (Task 6).
- Produces: `toolRoot(home)`, `installUvTool(home, spec): Promise<ToolLockEntry>`, `verifyTool(entry, versionArgv): Promise<string>`, `installAndLock(home, spec, versionArgv): Promise<ToolLockEntry>`.

Numbered `6a` deliberately: it is an insertion from the second design review and renumbering twenty tasks would break every cross-reference in this plan for no gain.

**Why this is in M1 at all.** M1's runner resolves an executable from the lockfile, and M1's exit criterion is a real SkillSpector run. Revision 2 put the whole tool manager in M3, so nothing in M1 could write a lock entry and the only working path was a hand-written one in tests. That is not a validated contract, it is a fixture. M1 therefore builds one install kind end to end — `uv-tool`, which is what SkillSpector needs. `npm-prefix`, `gh-release`, presets, the wizard and `doctor` stay in M3.

**Why `UV_TOOL_DIR`.** Revision 2 specified `uv tool install --tool-dir <path>`. uv 0.7.12 rejects that: `unexpected argument '--tool-dir'`. Relocation is through `UV_TOOL_DIR` and `UV_TOOL_BIN_DIR`, and both are set explicitly on the child rather than inherited, so an install can never leak into the user's `~/.local/share/uv/tools`.

**Verify by invocation.** An install that succeeds but produces a binary that will not run is the common failure, so the lock entry is only written after the executable has answered `--version`.

- [ ] **Step 1: Write the failing test**

`tests/core/install.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installAndLock, toolRoot, verifyTool } from '../../src/core/tools/install.js'
import { loadToolLock } from '../../src/core/config/config.js'

const home = async (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-tools-'))

const SPEC = {
  id: 'skillspector',
  kind: 'uv-tool' as const,
  spec: 'git+https://github.com/NVIDIA/skillspector.git',
  pin: 'v2.5.1',
  binName: 'skillspector',
}

describe('installAndLock', () => {
  it('installs into the tool root and never the global uv dir', async () => {
    const h = await home()
    const entry = await installAndLock(h, SPEC, ['--version'])
    expect(entry.bin).toBe(join(toolRoot(h), 'skillspector', 'bin', 'skillspector'))
    await expect(stat(entry.bin)).resolves.toBeTruthy()
    expect(entry.bin.startsWith(toolRoot(h))).toBe(true)
  }, 300_000)

  it('records the resolved version, integrity and both timestamps', async () => {
    const h = await home()
    const entry = await installAndLock(h, SPEC, ['--version'])
    expect(entry.resolvedVersion).toBe('2.5.1')
    expect(entry.requestedPin).toBe('v2.5.1')
    expect(entry.integrity).toBe('n/a')
    expect(entry.verifiedAt).not.toBeNull()
  }, 300_000)

  it('writes the entry into lock.json under the tool id', async () => {
    const h = await home()
    await installAndLock(h, SPEC, ['--version'])
    const lock = await loadToolLock(h)
    expect(lock.tools.skillspector?.installKind).toBe('uv-tool')
  }, 300_000)

  it('fails the install when the executable cannot be invoked', async () => {
    const h = await home()
    await expect(
      verifyTool({ ...(await installAndLock(h, SPEC, ['--version'])), bin: '/nonexistent/x' }, [
        '--version',
      ]),
    ).rejects.toThrow(/could not be invoked/)
  }, 300_000)

  it('refuses a pin the index does not have', async () => {
    const h = await home()
    await expect(
      installAndLock(h, { ...SPEC, pin: '0.0.0-does-not-exist' }, ['--version']),
    ).rejects.toThrow(/install failed/)
  }, 300_000)
})
```

These are network tests against the real index, so they carry a long timeout and run under `pnpm test:integration` rather than the default suite. Everything downstream uses a fake executable; this is the one task that proves the real path.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/install.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/core/tools/uv.ts`:

```ts
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface UvInstallSpec {
  id: string
  kind: 'uv-tool'
  spec: string
  pin: string
  binName: string
}

/**
 * uv 0.7.12 has no `--tool-dir`. Relocation is through UV_TOOL_DIR and
 * UV_TOOL_BIN_DIR, set explicitly rather than inherited so an install cannot
 * land in the user's global tool directory.
 */
export async function uvInstall(dir: string, spec: UvInstallSpec): Promise<string> {
  const binDir = join(dir, 'bin')
  try {
    await run('uv', ['tool', 'install', `${spec.spec}==${spec.pin}`], {
      env: { ...process.env, UV_TOOL_DIR: dir, UV_TOOL_BIN_DIR: binDir },
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch (err) {
    const detail = (err as { stderr?: string }).stderr ?? (err as Error).message
    throw new Error(`install failed for ${spec.id}@${spec.pin}: ${detail}`)
  }
  return join(binDir, spec.binName)
}
```

`src/core/tools/install.ts`:

```ts
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { loadToolLock, saveToolLock } from '../config/config.js'
import type { ToolLockEntry } from '../config/schema.js'
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
  versionArgv: string[],
): Promise<string> {
  let output: string
  try {
    const res = await run(entry.bin, versionArgv)
    output = `${res.stdout}${res.stderr}`
  } catch (err) {
    throw new Error(`${entry.bin} could not be invoked: ${(err as Error).message}`)
  }
  const match = SEMVER.exec(output)
  if (!match) throw new Error(`${entry.bin} could not be invoked: no version in ${output.trim()}`)
  return match[0]
}

export async function installAndLock(
  home: string,
  spec: UvInstallSpec,
  versionArgv: string[],
): Promise<ToolLockEntry> {
  const dir = join(toolRoot(home), spec.id)
  const bin = await uvInstall(dir, spec)
  const installedAt = new Date().toISOString()

  const resolvedVersion = await verifyTool({ bin }, versionArgv)

  const entry: ToolLockEntry = {
    installKind: 'uv-tool',
    requestedPin: spec.pin,
    resolvedVersion,
    bin,
    // uv verifies its own downloads against the index; there is nothing for us
    // to re-check. gh-release, which has no such guarantee, gains a declared
    // integrity source in M3.
    integrity: 'n/a',
    installedAt,
    verifiedAt: new Date().toISOString(),
  }

  const lock = await loadToolLock(home)
  await saveToolLock(home, { ...lock, tools: { ...lock.tools, [spec.id]: entry } })
  return entry
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/core/install.test.ts`
Expected: PASS, five cases, several minutes on a cold uv cache.

- [ ] **Step 5: Add the integration script**

In `package.json` scripts: `"test:integration": "vitest run tests/core/install.test.ts"`, and exclude that file from the default `test` run so the unit suite stays offline and fast.

- [ ] **Step 6: Commit**

```bash
git add src/core/tools src/core/config/schema.ts package.json tests/core/install.test.ts
git commit -m "feat(tools): install and verify uv tools into a managed tool root"
```

---

### Task 7: Credential loading and the secret value set

**Files:**
- Create: `src/core/config/env.ts`
- Test: `tests/core/env.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadEnvFile(home): Promise<EnvLoad>` where `EnvLoad = { vars: Record<string,string>; secrets: string[]; warnings: string[]; present: boolean }`, `provenanceOf(vars): Provenance` and `withAnalysisModes(provenance, modes)`.

- [ ] **Step 1: Write the failing test**

`tests/core/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadEnvFile, provenanceOf, withAnalysisModes } from '../../src/core/config/env.js'

const ENV = [
  'ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic',
  'ANTHROPIC_AUTH_TOKEN=sk-testtokenvalue000000000000000000',
  'ANTHROPIC_MODEL=deepseek-v4-pro',
  'ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-v4-pro',
  'ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-pro',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash',
  'CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flash',
  '# a comment',
  '',
].join('\n')

async function homeWithEnv(mode = 0o600): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'sg-env-'))
  await mkdir(home, { recursive: true })
  const file = join(home, '.env')
  await writeFile(file, ENV)
  await chmod(file, mode)
  return home
}

describe('loadEnvFile', () => {
  it('reports absence rather than throwing', async () => {
    const load = await loadEnvFile(await mkdtemp(join(tmpdir(), 'sg-env-')))
    expect(load.present).toBe(false)
    expect(load.secrets).toEqual([])
  })

  it('parses assignments and skips comments and blanks', async () => {
    const load = await loadEnvFile(await homeWithEnv())
    expect(load.vars.ANTHROPIC_MODEL).toBe('deepseek-v4-pro')
    expect(Object.keys(load.vars)).toHaveLength(7)
  })

  it('collects the token as a secret and never the model names', async () => {
    const load = await loadEnvFile(await homeWithEnv())
    expect(load.secrets).toContain('sk-testtokenvalue000000000000000000')
    expect(load.secrets).not.toContain('deepseek-v4-pro')
  })

  it('warns when the mode is looser than 600', async () => {
    const load = await loadEnvFile(await homeWithEnv(0o644))
    expect(load.warnings.join(' ')).toMatch(/permissive/)
  })
})

describe('provenanceOf', () => {
  it('records the host, five model mappings and a token hash but not the token', async () => {
    const { vars } = await loadEnvFile(await homeWithEnv())
    const prov = provenanceOf(vars)
    expect(prov.baseUrlHost).toBe('api.deepseek.com')
    expect(Object.keys(prov.models)).toHaveLength(5)
    expect(prov.authTokenHash).toMatch(/^sha256:[0-9a-f]{8}$/)
    expect(JSON.stringify(prov)).not.toContain('sk-testtokenvalue')
  })

  it('starts with no analysis modes, which only the pipeline can know', () => {
    expect(provenanceOf({}).analysisModes).toEqual({})
    expect(withAnalysisModes(provenanceOf({}), { skillspector: 'static' }).analysisModes).toEqual({
      skillspector: 'static',
    })
  })

  it('yields a null host when no base url is set', () => {
    expect(provenanceOf({}).baseUrlHost).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/env.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/core/config/env.ts`:

```ts
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

export const MODEL_KEYS = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
] as const

const SECRET_KEY = /(_TOKEN|_KEY|_SECRET|_PASSWORD)$/

export interface EnvLoad {
  present: boolean
  vars: Record<string, string>
  /** Distinct literal values to scrub from anything written to disk. */
  secrets: string[]
  warnings: string[]
}

export interface Provenance {
  baseUrlHost: string | null
  models: Record<string, string | null>
  authTokenHash: string | null
  /**
   * `toolId -> manifest.analysisMode`, filled by the pipeline from the tools it
   * actually selected. A tool that changes analysis mode changes what its
   * numbers mean, so the mode belongs beside the provider fingerprint that
   * already exists for the same reason (R4.2b).
   */
  analysisModes: Record<string, string>
}

function parse(source: string): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (value.length > 1 && /^(".*"|'.*')$/.test(value)) value = value.slice(1, -1)
    vars[key] = value
  }
  return vars
}

export async function loadEnvFile(home: string): Promise<EnvLoad> {
  const file = join(home, '.env')
  let source: string
  try {
    source = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { present: false, vars: {}, secrets: [], warnings: [] }
    }
    throw err
  }

  const warnings: string[] = []
  const info = await stat(file)
  if ((info.mode & 0o077) !== 0) {
    warnings.push(
      `${file} is more permissive than 600 (mode ${(info.mode & 0o777).toString(8)})`,
    )
  }

  const vars = parse(source)
  const secrets = [
    ...new Set(
      Object.entries(vars)
        .filter(([key, value]) => SECRET_KEY.test(key) && value.length >= 8)
        .map(([, value]) => value),
    ),
  ]
  return { present: true, vars, secrets, warnings }
}

export function provenanceOf(vars: Record<string, string>): Provenance {
  const base = vars.ANTHROPIC_BASE_URL ?? vars.OPENAI_BASE_URL
  let host: string | null = null
  if (base) {
    try {
      host = new URL(base).host
    } catch {
      host = null
    }
  }

  const models: Record<string, string | null> = {}
  for (const key of MODEL_KEYS) models[key] = vars[key] ?? null

  const token = vars.ANTHROPIC_AUTH_TOKEN ?? vars.OPENAI_API_KEY ?? vars.ANTHROPIC_API_KEY
  const authTokenHash = token
    ? `sha256:${createHash('sha256').update(token).digest('hex').slice(0, 8)}`
    : null

  return { baseUrlHost: host, models, authTokenHash, analysisModes: {} }
}

/** Called by the pipeline once tool selection is known. */
export function withAnalysisModes(
  provenance: Provenance,
  modes: Record<string, string>,
): Provenance {
  return { ...provenance, analysisModes: { ...provenance.analysisModes, ...modes } }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/core/env.test.ts`
Expected: PASS, six cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/config/env.ts tests/core/env.test.ts
git commit -m "feat(config): load credentials and derive redacted provenance"
```

---

### Task 8: Redaction transform

**Files:**
- Create: `src/core/runner/redaction.ts`
- Test: `tests/core/redaction.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `class RedactionTransform extends Transform` constructed as `new RedactionTransform(secrets: string[])`, and `redactString(text, secrets)`.

The tail-buffer behaviour is the point: a secret split across two chunk boundaries must still be caught, because a subprocess writing its environment will frequently split mid-token.

- [ ] **Step 1: Write the failing test**

`tests/core/redaction.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { text } from 'node:stream/consumers'
import { RedactionTransform, redactString } from '../../src/core/runner/redaction.js'

const SECRET = 'sk-testtokenvalue000000000000000000'

const pipeChunks = async (chunks: string[], secrets: string[]): Promise<string> =>
  text(Readable.from(chunks).pipe(new RedactionTransform(secrets)))

describe('RedactionTransform', () => {
  it('passes text through untouched when there is no secret', async () => {
    expect(await pipeChunks(['hello ', 'world'], [SECRET])).toBe('hello world')
  })

  it('redacts a secret contained in one chunk', async () => {
    const out = await pipeChunks([`TOKEN=${SECRET}\n`], [SECRET])
    expect(out).not.toContain(SECRET)
    expect(out).toContain('«redacted»')
  })

  it('redacts a secret split across two chunks', async () => {
    const head = SECRET.slice(0, 10)
    const tail = SECRET.slice(10)
    const out = await pipeChunks([`TOKEN=${head}`, `${tail}\n`], [SECRET])
    expect(out).not.toContain(SECRET)
    expect(out).toContain('«redacted»')
  })

  it('redacts a secret split across three chunks', async () => {
    const out = await pipeChunks(
      [SECRET.slice(0, 5), SECRET.slice(5, 20), SECRET.slice(20)],
      [SECRET],
    )
    expect(out).toBe('«redacted»')
  })

  it('emits every byte when the stream ends mid-buffer', async () => {
    expect(await pipeChunks(['abc'], [SECRET])).toBe('abc')
  })

  it('handles many secrets and repeated occurrences', async () => {
    const out = await pipeChunks([`${SECRET} and ${SECRET} and other`], [SECRET, 'other'])
    expect(out).toBe('«redacted» and «redacted» and «redacted»')
  })

  it('ignores empty and very short secrets', async () => {
    expect(await pipeChunks(['a b c'], ['', 'a'])).toBe('a b c')
  })
})

describe('redactString', () => {
  it('scrubs every occurrence', () => {
    expect(redactString(`x ${SECRET} y`, [SECRET])).toBe('x «redacted» y')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/redaction.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/core/runner/redaction.ts`:

```ts
import { Transform, type TransformCallback } from 'node:stream'

export const REDACTED = '«redacted»'

/** Shorter values are too collision-prone to scrub safely. */
const MIN_SECRET_LENGTH = 8

export function usableSecrets(secrets: readonly string[]): string[] {
  return [...new Set(secrets.filter((s) => s.length >= MIN_SECRET_LENGTH))].sort(
    (a, b) => b.length - a.length,
  )
}

export function redactString(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of usableSecrets(secrets)) out = out.split(secret).join(REDACTED)
  return out
}

/**
 * Scrubs secrets from a stream on the write path. Holds back the last
 * `maxSecretLength - 1` characters so a value split across chunk boundaries is
 * still caught; the remainder is flushed when the stream ends.
 */
export class RedactionTransform extends Transform {
  readonly #secrets: string[]
  readonly #holdback: number
  #buffer = ''

  constructor(secrets: readonly string[]) {
    super({ decodeStrings: false, encoding: 'utf8' })
    this.#secrets = usableSecrets(secrets)
    const longest = this.#secrets.reduce((max, s) => Math.max(max, s.length), 0)
    this.#holdback = longest > 0 ? longest - 1 : 0
  }

  override _transform(chunk: unknown, _enc: BufferEncoding, done: TransformCallback): void {
    this.#buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    const scrubbed = redactString(this.#buffer, this.#secrets)
    const emitUpTo = Math.max(0, scrubbed.length - this.#holdback)
    this.push(scrubbed.slice(0, emitUpTo))
    this.#buffer = scrubbed.slice(emitUpTo)
    done()
  }

  override _flush(done: TransformCallback): void {
    if (this.#buffer.length > 0) this.push(redactString(this.#buffer, this.#secrets))
    this.#buffer = ''
    done()
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/core/redaction.test.ts`
Expected: PASS, eight cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/runner/redaction.ts tests/core/redaction.test.ts
git commit -m "feat(runner): scrub secrets on the write path across chunk boundaries"
```

---

### Task 9: Tool runner with process-tree kill and artefact loading

**Files:**
- Create: `src/core/runner/spawn.ts`
- Create: `tests/helpers/fake-tool.ts`
- Test: `tests/core/spawn.test.ts`

**Interfaces:**
- Consumes: `RedactionTransform` (Task 8), `ErrorKind` (Task 2).
- Produces: `runTool(input: RunToolInput): Promise<RunToolOutput>`, and the `RunToolInput` / `RunToolOutput` types consumed by Task 14.

The grandchild case is the whole point of this task. Killing only the direct child leaves an orphaned descendant holding the terminal and the temp directory, which is exactly what R5.9 forbids.

- [ ] **Step 1: Write the failing test**

`tests/helpers/fake-tool.ts`:

```ts
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Writes an executable shell script into a fresh temp dir and returns its path. */
export async function makeFakeTool(name: string, script: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))
  const path = join(dir, name)
  await writeFile(path, `#!/bin/sh\n${script}\n`)
  await chmod(path, 0o755)
  return path
}

/** Spawns a long-lived grandchild, writes its pid, then hangs. */
export const GRANDCHILD_SCRIPT = `
sleep 600 &
echo $! > "$1"
sleep 600
`

export const ECHO_ENV_SCRIPT = `
printf 'TOKEN=%s' "$ANTHROPIC_AUTH_TOKEN"
printf 'more output\\n'
printf 'stderr %s\\n' "$ANTHROPIC_AUTH_TOKEN" >&2
`
```

`tests/core/spawn.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTool } from '../../src/core/runner/spawn.js'
import { ECHO_ENV_SCRIPT, GRANDCHILD_SCRIPT, makeFakeTool } from '../helpers/fake-tool.js'

const SECRET = 'sk-testtokenvalue000000000000000000'
const toolDir = async (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-td-'))

const base = {
  cwd: process.cwd(),
  env: {} as NodeJS.ProcessEnv,
  secrets: [] as string[],
  artefacts: [] as string[],
  artefactSizeCapBytes: 1024 * 1024,
  timeoutMs: 5_000,
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('runTool', () => {
  it('captures stdout, stderr and the exit code', async () => {
    const bin = await makeFakeTool('ok', 'echo out; echo err >&2; exit 0')
    const out = await runTool({ ...base, bin, argv: [], toolDir: await toolDir() })
    expect(out.exitCode).toBe(0)
    expect(out.stdout.trim()).toBe('out')
    expect(out.stderr.trim()).toBe('err')
    expect(out.timedOut).toBe(false)
  })

  it('reports a non-zero exit without throwing', async () => {
    const bin = await makeFakeTool('bad', 'exit 3')
    expect((await runTool({ ...base, bin, argv: [], toolDir: await toolDir() })).exitCode).toBe(3)
  })

  it('writes redacted logs to disk', async () => {
    const bin = await makeFakeTool('leaky', ECHO_ENV_SCRIPT)
    const dir = await toolDir()
    const out = await runTool({
      ...base,
      bin,
      argv: [],
      toolDir: dir,
      env: { ANTHROPIC_AUTH_TOKEN: SECRET },
      secrets: [SECRET],
    })
    const stdoutLog = await readFile(join(dir, 'stdout.log'), 'utf8')
    const stderrLog = await readFile(join(dir, 'stderr.log'), 'utf8')
    expect(stdoutLog).not.toContain(SECRET)
    expect(stderrLog).not.toContain(SECRET)
    expect(stdoutLog).toContain('«redacted»')
    expect(out.stdout).not.toContain(SECRET)
  })

  it('kills the whole process tree on timeout', async () => {
    const pidFile = join(await toolDir(), 'grandchild.pid')
    const bin = await makeFakeTool('hang', GRANDCHILD_SCRIPT)
    const out = await runTool({
      ...base,
      bin,
      argv: [pidFile],
      toolDir: await toolDir(),
      timeoutMs: 1_000,
    })
    expect(out.timedOut).toBe(true)
    expect(out.exitCode).toBeNull()

    const pid = Number((await readFile(pidFile, 'utf8')).trim())
    expect(Number.isInteger(pid)).toBe(true)
    await new Promise((r) => setTimeout(r, 300))
    expect(alive(pid)).toBe(false)
  })

  it('preserves partial output written before the timeout', async () => {
    const bin = await makeFakeTool('partial', 'echo before-hang; sleep 600')
    const dir = await toolDir()
    const out = await runTool({ ...base, bin, argv: [], toolDir: dir, timeoutMs: 1_000 })
    expect(out.stdout).toContain('before-hang')
    expect(await readFile(join(dir, 'stdout.log'), 'utf8')).toContain('before-hang')
  })

  it('loads declared artefacts as bytes', async () => {
    const dir = await toolDir()
    const bin = await makeFakeTool('writer', `printf '{"a":1}' > "$1"`)
    const out = await runTool({
      ...base,
      bin,
      argv: [join(dir, 'report.json')],
      toolDir: dir,
      artefacts: ['report.json'],
    })
    expect(out.artefacts.get('report.json')?.toString()).toBe('{"a":1}')
    expect(out.missingArtefacts).toEqual([])
  })

  it('reports a declared artefact that was never written', async () => {
    const bin = await makeFakeTool('nowrite', 'exit 0')
    const out = await runTool({
      ...base,
      bin,
      argv: [],
      toolDir: await toolDir(),
      artefacts: ['report.json'],
    })
    expect(out.missingArtefacts).toEqual(['report.json'])
  })

  it('refuses to load an artefact over the size cap', async () => {
    const dir = await toolDir()
    await writeFile(join(dir, 'big.json'), 'x'.repeat(2048))
    const bin = await makeFakeTool('noop', 'exit 0')
    const out = await runTool({
      ...base,
      bin,
      argv: [],
      toolDir: dir,
      artefacts: ['big.json'],
      artefactSizeCapBytes: 1024,
    })
    expect(out.oversizeArtefacts).toEqual(['big.json'])
    expect(out.artefacts.has('big.json')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/spawn.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/core/runner/spawn.ts`:

```ts
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { RedactionTransform, redactString } from './redaction.js'

export interface RunToolInput {
  bin: string
  argv: string[]
  cwd: string
  /** Directory receiving stdout.log, stderr.log and this tool's artefacts. */
  toolDir: string
  env: NodeJS.ProcessEnv
  secrets: readonly string[]
  artefacts: readonly string[]
  artefactSizeCapBytes: number
  timeoutMs: number
  signal?: AbortSignal
}

export interface RunToolOutput {
  exitCode: number | null
  signalled: NodeJS.Signals | null
  timedOut: boolean
  cancelled: boolean
  /** ENOENT, EACCES and friends: the process never started, so exitCode is meaningless. */
  spawnFailed: boolean
  spawnError: string | null
  durationMs: number
  stdout: string
  stderr: string
  artefacts: Map<string, Buffer>
  missingArtefacts: string[]
  oversizeArtefacts: string[]
}

/**
 * Kills the child's entire process group. Spawning detached puts the child in
 * its own group, so a negative pid reaches every descendant. Killing only the
 * child would leave orphans holding the temp directory open.
 */
function killTree(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      // Already gone.
    }
  }
}

async function loadArtefacts(
  toolDir: string,
  names: readonly string[],
  capBytes: number,
): Promise<Pick<RunToolOutput, 'artefacts' | 'missingArtefacts' | 'oversizeArtefacts'>> {
  const artefacts = new Map<string, Buffer>()
  const missingArtefacts: string[] = []
  const oversizeArtefacts: string[] = []

  for (const name of names) {
    const path = join(toolDir, name)
    try {
      const info = await stat(path)
      if (info.size > capBytes) {
        oversizeArtefacts.push(name)
        continue
      }
      artefacts.set(name, await readFile(path))
    } catch {
      missingArtefacts.push(name)
    }
  }
  return { artefacts, missingArtefacts, oversizeArtefacts }
}

export async function runTool(input: RunToolInput): Promise<RunToolOutput> {
  await mkdir(input.toolDir, { recursive: true })
  const startedAt = Date.now()

  const child = spawn(input.bin, input.argv, {
    cwd: input.cwd,
    env: input.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const capture = { stdout: '', stderr: '' }
  const closed: Promise<void>[] = []

  for (const stream of ['stdout', 'stderr'] as const) {
    const source = child[stream]
    if (!source) continue
    const redactor = new RedactionTransform(input.secrets)
    const sink = createWriteStream(join(input.toolDir, `${stream}.log`))
    source.setEncoding('utf8')
    source.on('data', (chunk: string) => {
      capture[stream] += chunk
    })
    source.pipe(redactor).pipe(sink)
    closed.push(new Promise<void>((resolve) => sink.on('close', () => resolve())))
  }

  let timedOut = false
  let cancelled = false

  const timer = setTimeout(() => {
    timedOut = true
    if (child.pid) killTree(child.pid, 'SIGKILL')
  }, input.timeoutMs)

  const onAbort = (): void => {
    cancelled = true
    if (child.pid) killTree(child.pid, 'SIGKILL')
  }
  input.signal?.addEventListener('abort', onAbort, { once: true })

  let spawnError: string | null = null

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.on('error', (err) => {
        spawnError = err.message
        resolve({ code: null, signal: null })
      })
      child.on('close', (code, signal) => resolve({ code, signal }))
    },
  )

  clearTimeout(timer)
  input.signal?.removeEventListener('abort', onAbort)
  await Promise.all(closed)

  const loaded = await loadArtefacts(input.toolDir, input.artefacts, input.artefactSizeCapBytes)

  return {
    exitCode: timedOut || cancelled ? null : exit.code,
    signalled: exit.signal,
    timedOut,
    cancelled,
    spawnFailed: spawnError !== null,
    spawnError,
    durationMs: Date.now() - startedAt,
    stdout: redactString(capture.stdout, input.secrets),
    stderr: redactString(capture.stderr, input.secrets),
    ...loaded,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/core/spawn.test.ts`
Expected: PASS, eight cases. The grandchild case is the R5.9 acceptance check.

- [ ] **Step 5: Commit**

```bash
git add src/core/runner/spawn.ts tests/core/spawn.test.ts tests/helpers/fake-tool.ts
git commit -m "feat(runner): spawn tools with process-tree kill and artefact loading"
```

---

### Task 10: Adapter contract, rule-class map and registry

**Files:**
- Create: `src/core/adapters/types.ts`, `src/core/adapters/rule-classes.ts`, `src/core/adapters/registry.ts`
- Test: `tests/core/rule-classes.test.ts`

**Interfaces:**
- Consumes: `RuleClass`, `Severity`, `RawFinding`, `Metrics`, `Stage`, `ToolOutcome`, `SkillRef` (Task 2).
- Produces: `AdapterManifest`, `InstallSpec`, `ParseContext`, `ToolResult`, `Parse`, `Adapter`; `classifyRule(toolId, nativeRuleId)`, `unmappedClass(toolId, nativeRuleId)`, `isUnmappedFor(ruleClass, toolId)`; `getAdapter(id)`, `listAdapters()`, `adaptersForStage(stage)`.

- [ ] **Step 1: Write the failing test**

`tests/core/rule-classes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  classifyRule,
  isUnmappedFor,
  unmappedClass,
} from '../../src/core/adapters/rule-classes.js'
import { KNOWN_RULE_CLASSES } from '../../src/core/types.js'

describe('classifyRule', () => {
  it('maps a known skillspector rule', () => {
    expect(classifyRule('skillspector', 'LP3')).toBe('excessive-permission')
  })

  it('maps the context-stuffing rule to prompt injection', () => {
    expect(classifyRule('skillspector', 'MP2')).toBe('prompt-injection')
  })

  it('falls back to a tool-scoped class for an unknown rule', () => {
    expect(classifyRule('skillspector', 'ZZ9')).toBe('unmapped:skillspector:ZZ9')
  })

  it('never merges unmapped rules across tools', () => {
    expect(classifyRule('skillspector', 'X1')).not.toBe(classifyRule('skill-scanner', 'X1'))
  })

  it('only ever produces a known class or an unmapped one', () => {
    const known = new Set<string>(KNOWN_RULE_CLASSES)
    for (const id of ['LP3', 'MP2', 'ZZ9']) {
      const cls = classifyRule('skillspector', id)
      expect(known.has(cls) || cls.startsWith('unmapped:')).toBe(true)
    }
  })
})

describe('isUnmappedFor', () => {
  it('recognises a tool own unmapped class', () => {
    expect(isUnmappedFor(unmappedClass('skillspector', 'ZZ9'), 'skillspector')).toBe(true)
  })

  it('rejects another tool unmapped class', () => {
    expect(isUnmappedFor(unmappedClass('skill-scanner', 'ZZ9'), 'skillspector')).toBe(false)
  })

  it('rejects a known class', () => {
    expect(isUnmappedFor('prompt-injection', 'skillspector')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/rule-classes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/core/adapters/types.ts`:

```ts
import type {
  KnownRuleClass,
  Metrics,
  RawFinding,
  SkillRef,
  Stage,
  ToolOutcome,
} from '../types.js'

export type Integrity =
  | { kind: 'sha256-asset'; assetPattern: string }
  | { kind: 'sha256-digest'; digest: string }
  | { kind: 'none'; reason: string }

export type InstallSpec =
  | { kind: 'uv-tool'; spec: string; pin: string; binName: string }
  | { kind: 'npm-prefix'; spec: string; pin: string; binName: string }
  | {
      kind: 'gh-release'
      repo: string
      pin: string
      assetPattern: string
      binName: string
      /** Declared, never assumed: M3's driver has no checksum without it. */
      integrity: Integrity
    }

export interface CredentialSet {
  /** Human label for the setup wizard, e.g. 'OpenAI'. */
  provider: string
  /** Every key must be present and non-empty for this alternative to be satisfied. */
  required: readonly string[]
  optional?: readonly string[]
  /** Env assignment selecting this provider, when the tool needs one. */
  selects?: Readonly<Record<string, string>>
}

/**
 * A boolean could not express "one of four provider credential sets", which is
 * what SkillSpector's LLM mode actually needs, so the wizard could neither name
 * the missing value nor tell whether the configured provider was usable.
 */
export type CredentialRequirement =
  | { kind: 'none' }
  | { kind: 'one-of'; alternatives: readonly CredentialSet[] }

export interface AdapterManifest {
  id: string
  stage: Stage
  policy: 'fan-out' | 'pick-one'
  mutating: boolean
  /**
   * Declared reconciliation scope. Widened at runtime by every class this tool
   * has actually produced for the skill, so a too-narrow declaration costs
   * completeness rather than correctness — see Task 17.
   */
  detects: readonly KnownRuleClass[]
  credentials: CredentialRequirement
  /** Recorded in run provenance. A mode change is a new adapter id, never a fallback. */
  analysisMode: string
  install: InstallSpec
  /** `{skillDir}`, `{repoRoot}` and `{toolDir}` are substituted at spawn time. */
  invoke: { argv: readonly string[]; cwd: 'skillDir' | 'repoRoot' }
  versionArgv: readonly string[]
  artefacts: readonly string[]
  binaryArtefacts?: readonly string[]
  timeoutMs: number
}

/** Satisfied by `none`, or by any one alternative whose required keys are all set. */
export function credentialsSatisfied(
  req: CredentialRequirement,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (req.kind === 'none') return true
  return req.alternatives.some((alt) => alt.required.every((key) => (env[key] ?? '') !== ''))
}

/** Names what is missing, for the wizard and for the skip summary. */
export function missingCredentials(req: CredentialRequirement): string {
  if (req.kind === 'none') return ''
  return req.alternatives.map((a) => `${a.provider} (${a.required.join(', ')})`).join(' or ')
}

/** Pure input: the runner has already read the files. */
export interface ParseContext {
  skill: SkillRef
  artefacts: ReadonlyMap<string, Buffer>
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
}

export interface ToolResult {
  outcome: Extract<ToolOutcome, 'passed' | 'failed' | 'errored'>
  findings: RawFinding[]
  metrics: Metrics
  summary: string
}

export type Parse = (ctx: ParseContext) => ToolResult

export interface Adapter {
  manifest: AdapterManifest
  parse: Parse
}
```

`src/core/adapters/rule-classes.ts`:

```ts
import { KNOWN_RULE_CLASSES, type KnownRuleClass, type RuleClass } from '../types.js'

const KNOWN = new Set<string>(KNOWN_RULE_CLASSES)

/**
 * (toolId, nativeRuleId) -> canonical class. Entries are added as real rules
 * are observed; anything absent degrades to a tool-scoped class rather than
 * merging wrongly. Extending this map is a versioned migration, never implicit.
 */
export const RULE_CLASS_MAP: Readonly<Record<string, Readonly<Record<string, KnownRuleClass>>>> = {
  skillspector: {
    LP3: 'excessive-permission',
    MP2: 'prompt-injection',
  },
}

export function unmappedClass(toolId: string, nativeRuleId: string): RuleClass {
  return `unmapped:${toolId}:${nativeRuleId}`
}

export function classifyRule(toolId: string, nativeRuleId: string): RuleClass {
  const mapped = RULE_CLASS_MAP[toolId]?.[nativeRuleId]
  return mapped && KNOWN.has(mapped) ? mapped : unmappedClass(toolId, nativeRuleId)
}

/** True when `ruleClass` is an unmapped class belonging to `toolId`. */
export function isUnmappedFor(ruleClass: RuleClass, toolId: string): boolean {
  return ruleClass.startsWith(`unmapped:${toolId}:`)
}
```

`src/core/adapters/registry.ts`:

```ts
import type { Stage } from '../types.js'
import * as skillspector from './skillspector.js'
import type { Adapter } from './types.js'

const ADAPTERS: readonly Adapter[] = [
  { manifest: skillspector.manifest, parse: skillspector.parse },
]

const BY_ID = new Map(ADAPTERS.map((a) => [a.manifest.id, a]))

export function getAdapter(id: string): Adapter | undefined {
  return BY_ID.get(id)
}

export function listAdapters(): readonly Adapter[] {
  return ADAPTERS
}

export function adaptersForStage(stage: Stage): readonly Adapter[] {
  return ADAPTERS.filter((a) => a.manifest.stage === stage)
}
```

`registry.ts` will not compile until Task 12 creates `skillspector.ts`. Create a placeholder now so this task's tests run, and Task 12 replaces it:

`src/core/adapters/skillspector.ts` (placeholder, replaced in Task 12):

```ts
import type { AdapterManifest, Parse } from './types.js'

export const manifest: AdapterManifest = {
  id: 'skillspector',
  stage: 'security',
  policy: 'fan-out',
  mutating: false,
  detects: [],
  credentials: { kind: 'none' },
  analysisMode: 'static',
  install: { kind: 'uv-tool', spec: 'git+https://github.com/NVIDIA/skillspector.git', pin: 'v2.5.1', binName: 'skillspector' },
  invoke: { argv: [], cwd: 'repoRoot' },
  versionArgv: ['--version'],
  artefacts: [],
  timeoutMs: 120_000,
}

export const parse: Parse = () => ({
  outcome: 'errored',
  findings: [],
  metrics: {},
  summary: 'not implemented',
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/core/rule-classes.test.ts && pnpm lint`
Expected: PASS, eight cases. Lint passes, confirming the adapters directory imports no `node:fs`.

- [ ] **Step 5: Commit**

```bash
git add src/core/adapters tests/core/rule-classes.test.ts
git commit -m "feat(adapters): add the adapter contract, rule-class map and registry"
```

---

### Task 11: Shared SARIF 2.1.0 parser

**Files:**
- Create: `src/core/adapters/sarif.ts`
- Test: `tests/core/sarif.test.ts`

**Interfaces:**
- Consumes: `classifyRule` (Task 10), `RawFinding`, `Severity` (Task 2), `ParseContext`/`ToolResult` (Task 10).
- Produces: `parseSarif(bytes: Buffer, opts: { toolId: string; skillRelPath: string }): ToolResult`, and `rebasePath(skillRelPath, uri): string`.

SARIF `artifactLocation.uri` is relative to the directory that was scanned, not the repo root. Rebasing is what turns it into the repo-relative path R8.3 requires, and it is the single most likely thing to get silently wrong.

- [ ] **Step 1: Write the failing test**

`tests/core/sarif.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseSarif, rebasePath } from '../../src/core/adapters/sarif.js'

const sarif = (results: unknown[], rules: unknown[] = []): Buffer =>
  Buffer.from(
    JSON.stringify({
      version: '2.1.0',
      runs: [{ tool: { driver: { name: 'skillspector', version: '2.5.1', rules } }, results }],
    }),
  )

const result = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ruleId: 'LP3',
  message: { text: 'Skill has no declared permissions' },
  level: 'warning',
  locations: [
    { physicalLocation: { artifactLocation: { uri: 'SKILL.md' }, region: { startLine: 1 } } },
  ],
  ...over,
})

describe('rebasePath', () => {
  it('prefixes a nested skill path', () => {
    expect(rebasePath('declawed', 'scripts/scan.py')).toBe('declawed/scripts/scan.py')
  })

  it('leaves a repo-root skill path alone', () => {
    expect(rebasePath('.', 'SKILL.md')).toBe('SKILL.md')
  })

  it('normalises a leading ./ and backslashes', () => {
    expect(rebasePath('declawed', './a\\b.py')).toBe('declawed/a/b.py')
  })
})

describe('parseSarif', () => {
  const opts = { toolId: 'skillspector', skillRelPath: 'declawed' }

  it('passes when there are no results', () => {
    const out = parseSarif(sarif([]), opts)
    expect(out.outcome).toBe('passed')
    expect(out.findings).toEqual([])
    expect(out.metrics.findingsTotal).toBe(0)
  })

  it('fails when results are present', () => {
    expect(parseSarif(sarif([result()]), opts).outcome).toBe('failed')
  })

  it('rebases the uri onto the skill path', () => {
    const [finding] = parseSarif(sarif([result()]), opts).findings
    expect(finding?.path).toBe('declawed/SKILL.md')
  })

  it('maps sarif levels onto severities', () => {
    const levels = ['error', 'warning', 'note', 'none']
    const out = parseSarif(sarif(levels.map((level) => result({ level }))), opts)
    expect(out.findings.map((f) => f.severity)).toEqual(['high', 'medium', 'low', 'info'])
  })

  it('defaults a missing level to medium', () => {
    const out = parseSarif(sarif([result({ level: undefined })]), opts)
    expect(out.findings[0]?.severity).toBe('medium')
  })

  it('classifies the rule and keeps the native id', () => {
    const [finding] = parseSarif(sarif([result()]), opts).findings
    expect(finding?.ruleClass).toBe('excessive-permission')
    expect(finding?.nativeRuleId).toBe('LP3')
  })

  it('degrades an unknown rule to a tool-scoped class', () => {
    const out = parseSarif(sarif([result({ ruleId: 'ZZ9' })]), opts)
    expect(out.findings[0]?.ruleClass).toBe('unmapped:skillspector:ZZ9')
  })

  it('keeps the line number as display metadata', () => {
    const out = parseSarif(sarif([result()]), opts)
    expect(out.findings[0]?.line).toBe(1)
  })

  it('handles a result with no location', () => {
    const out = parseSarif(sarif([result({ locations: undefined })]), opts)
    expect(out.findings[0]?.path).toBe('declawed')
    expect(out.findings[0]?.line).toBeUndefined()
  })

  it('handles a result with no ruleId', () => {
    const out = parseSarif(sarif([result({ ruleId: undefined })]), opts)
    expect(out.findings[0]?.nativeRuleId).toBe('unknown')
  })

  it('merges results across multiple runs', () => {
    const doc = Buffer.from(
      JSON.stringify({
        version: '2.1.0',
        runs: [
          { tool: { driver: { name: 't', version: '1' } }, results: [result()] },
          { tool: { driver: { name: 't', version: '1' } }, results: [result()] },
        ],
      }),
    )
    expect(parseSarif(doc, opts).findings).toHaveLength(2)
  })

  it('errors on malformed json rather than throwing', () => {
    const out = parseSarif(Buffer.from('{not json'), opts)
    expect(out.outcome).toBe('errored')
    expect(out.summary).toMatch(/could not be parsed/i)
  })

  it('errors when the document is not sarif-shaped', () => {
    expect(parseSarif(Buffer.from('{"hello":1}'), opts).outcome).toBe('errored')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/sarif.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/core/adapters/sarif.ts`:

```ts
import type { RawFinding, Severity } from '../types.js'
import { classifyRule } from './rule-classes.js'
import type { ToolResult } from './types.js'

const LEVEL_TO_SEVERITY: Readonly<Record<string, Severity>> = {
  error: 'high',
  warning: 'medium',
  note: 'low',
  none: 'info',
}

/**
 * SARIF uris are relative to the scanned directory, so a scan of `declawed`
 * reports `SKILL.md`, not `declawed/SKILL.md`. Findings must be repo-relative.
 */
export function rebasePath(skillRelPath: string, uri: string): string {
  const normalised = uri.replace(/\\/g, '/').replace(/^\.\//, '')
  if (skillRelPath === '.' || skillRelPath === '') return normalised
  if (normalised === '') return skillRelPath
  return `${skillRelPath}/${normalised}`
}

interface SarifRegion {
  startLine?: number
}
interface SarifLocation {
  physicalLocation?: {
    artifactLocation?: { uri?: string }
    region?: SarifRegion
  }
}
interface SarifResult {
  ruleId?: string
  level?: string
  message?: { text?: string }
  locations?: SarifLocation[]
}
interface SarifDoc {
  runs?: Array<{ results?: SarifResult[] }>
}

function errored(summary: string): ToolResult {
  return { outcome: 'errored', findings: [], metrics: {}, summary }
}

export interface SarifParseOptions {
  toolId: string
  /** Repo-relative path of the scanned skill; '.' for a repo-root skill. */
  skillRelPath: string
}

export function parseSarif(bytes: Buffer, opts: SarifParseOptions): ToolResult {
  let doc: SarifDoc
  try {
    doc = JSON.parse(bytes.toString('utf8')) as SarifDoc
  } catch {
    return errored('SARIF output could not be parsed as JSON')
  }
  if (!Array.isArray(doc.runs)) {
    return errored('SARIF output could not be parsed: no runs array')
  }

  const findings: RawFinding[] = []
  for (const run of doc.runs) {
    for (const res of run.results ?? []) {
      const nativeRuleId = res.ruleId ?? 'unknown'
      const physical = res.locations?.[0]?.physicalLocation
      const uri = physical?.artifactLocation?.uri ?? ''
      const line = physical?.region?.startLine

      const finding: RawFinding = {
        ruleClass: classifyRule(opts.toolId, nativeRuleId),
        nativeRuleId,
        severity: LEVEL_TO_SEVERITY[res.level ?? 'warning'] ?? 'medium',
        path: rebasePath(opts.skillRelPath, uri),
        message: res.message?.text ?? nativeRuleId,
      }
      if (typeof line === 'number') finding.line = line
      findings.push(finding)
    }
  }

  return {
    outcome: findings.length === 0 ? 'passed' : 'failed',
    findings,
    metrics: { findingsTotal: findings.length },
    summary:
      findings.length === 0
        ? 'no findings'
        : `${findings.length} finding${findings.length === 1 ? '' : 's'}`,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/core/sarif.test.ts`
Expected: PASS, sixteen cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/adapters/sarif.ts tests/core/sarif.test.ts
git commit -m "feat(adapters): parse SARIF and rebase paths onto the repo root"
```

---

### Task 12: SkillSpector adapter against a real captured fixture

**Files:**
- Modify: `src/core/adapters/skillspector.ts` (replaces the Task 10 placeholder)
- Create: `tests/fixtures/sarif/skillspector-declawed.sarif`
- Create: `scripts/capture-fixtures.sh`
- Create: `tests/core/design-example.test.ts` (keeps design.md §7 and the shipped manifest in step)
- Test: `tests/core/skillspector.test.ts`

**Interfaces:**
- Consumes: `parseSarif` (Task 11), `AdapterManifest`/`Parse` (Task 10).
- Produces: the real `manifest` and `parse` for `skillspector`, resolving the Task 10 placeholder.

- [ ] **Step 1: Add the captured fixture**

`tests/fixtures/sarif/skillspector-declawed.sarif` — this is verbatim output from `skillspector 2.5.1` scanning the real `declawed` skill with `--no-llm`:

```json
{
  "version": "2.1.0",
  "$schema": "https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.4.json",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "skillspector",
          "version": "2.5.1",
          "rules": [
            {
              "id": "LP3",
              "shortDescription": {
                "text": "Skill has no declared permissions but code capabilities were detected: file_read."
              }
            },
            {
              "id": "MP2",
              "shortDescription": { "text": "Context Window Stuffing" }
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "LP3",
          "message": {
            "text": "Skill has no declared permissions but code capabilities were detected: file_read."
          },
          "level": "warning",
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "SKILL.md" },
                "region": { "startLine": 1 }
              }
            }
          ]
        },
        {
          "ruleId": "MP2",
          "message": { "text": "Context Window Stuffing" },
          "level": "warning",
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "scripts/scan.py" },
                "region": { "startLine": 34 }
              }
            }
          ]
        }
      ]
    }
  ]
}
```

`scripts/capture-fixtures.sh`, so fixtures and pins cannot drift apart (R13.3):

```bash
#!/usr/bin/env bash
# Re-capture adapter fixtures from the pinned tool versions.
# Usage: scripts/capture-fixtures.sh /path/to/zapac-agent-skills
set -euo pipefail

REPO="${1:?usage: capture-fixtures.sh <skills-repo>}"
PIN_SKILLSPECTOR="2.5.1"
OUT="$(dirname "$0")/../tests/fixtures/sarif"
mkdir -p "$OUT"

actual="$(skillspector --version | awk '{print $2}' | tr -d 'v')"
if [ "$actual" != "$PIN_SKILLSPECTOR" ]; then
  echo "skillspector is $actual, fixtures are pinned to $PIN_SKILLSPECTOR" >&2
  exit 1
fi

skillspector scan "$REPO/declawed" --no-llm --format sarif \
  --output "$OUT/skillspector-declawed.sarif"
echo "captured $OUT/skillspector-declawed.sarif"
```

- [ ] **Step 2: Write the failing test**

`tests/core/skillspector.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { manifest, parse } from '../../src/core/adapters/skillspector.js'
import type { SkillRef } from '../../src/core/types.js'

const skill = {
  id: 'zapac/declawed',
  relPath: 'declawed',
  dir: '/repo/declawed',
} as unknown as SkillRef

const fixture = async (): Promise<Buffer> =>
  readFile(join(process.cwd(), 'tests/fixtures/sarif/skillspector-declawed.sarif'))

const ctx = async (): Promise<Parameters<typeof parse>[0]> => ({
  skill,
  artefacts: new Map([['findings.sarif', await fixture()]]),
  stdout: 'Report saved to: findings.sarif\n',
  stderr: '',
  exitCode: 0,
  durationMs: 1200,
})

describe('skillspector manifest', () => {
  it('passes --no-llm so the tool never needs an API key', () => {
    expect(manifest.invoke.argv).toContain('--no-llm')
    expect(manifest.credentials.kind).toBe('none')
  })

  it('is pinned to the version the fixture was captured from', () => {
    expect(manifest.install.pin).toBe('v2.5.1')
  })

  it('fans out and is read-only', () => {
    expect(manifest.policy).toBe('fan-out')
    expect(manifest.mutating).toBe(false)
    expect(manifest.stage).toBe('security')
  })

  it('declares the artefact its argv writes', () => {
    expect(manifest.artefacts).toEqual(['findings.sarif'])
    expect(manifest.invoke.argv.join(' ')).toContain('{toolDir}/findings.sarif')
  })

  it('declares a reconciliation scope covering what it detects', () => {
    expect(manifest.detects).toContain('excessive-permission')
    expect(manifest.detects).toContain('prompt-injection')
  })

  it('declares static mode with no credential, matching its argv', () => {
    expect(manifest.analysisMode).toBe('static')
    expect(manifest.credentials).toEqual({ kind: 'none' })
    expect(manifest.invoke.argv).toContain('--no-llm')
  })

  it('claims no class that only LLM analysis reaches', () => {
    expect(manifest.detects).not.toContain('vulnerable-dep')
  })
})

describe('skillspector parse', () => {
  it('fails the gate with the two real findings', async () => {
    const out = parse(await ctx())
    expect(out.outcome).toBe('failed')
    expect(out.findings).toHaveLength(2)
  })

  it('rebases both real paths onto the skill directory', async () => {
    const paths = parse(await ctx()).findings.map((f) => f.path).sort()
    expect(paths).toEqual(['declawed/SKILL.md', 'declawed/scripts/scan.py'])
  })

  it('does not use the exit code to decide the verdict', async () => {
    // The real tool exits 0 with findings present.
    const out = parse({ ...(await ctx()), exitCode: 0 })
    expect(out.outcome).toBe('failed')
  })

  it('errors when the declared artefact is absent', async () => {
    const out = parse({ ...(await ctx()), artefacts: new Map() })
    expect(out.outcome).toBe('errored')
    expect(out.summary).toMatch(/findings\.sarif/)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/skillspector.test.ts`
Expected: FAIL — the placeholder returns `errored` with `not implemented`.

- [ ] **Step 4: Write the implementation**

Replace `src/core/adapters/skillspector.ts`:

```ts
import { parseSarif } from './sarif.js'
import type { AdapterManifest, Parse } from './types.js'

/**
 * `--no-llm` is not optional, and `credentials`/`analysisMode` must agree with
 * it. SkillSpector 2.5.1's `scan` runs LLM analysis by default and aborts
 * unless a provider key is present; its LLM findings are also nondeterministic,
 * which would make golden fixtures worthless. Declaring static mode makes the
 * narrower coverage visible in provenance instead of silently degrading.
 *
 * `detects` covers static analysis only, and is re-derived by
 * scripts/capture-fixtures.sh rather than hand-maintained. `vulnerable-dep` is
 * absent because dependency findings are an LLM-mode analyser in 2.5.1.
 */
export const manifest: AdapterManifest = {
  id: 'skillspector',
  stage: 'security',
  policy: 'fan-out',
  mutating: false,
  detects: [
    'prompt-injection',
    'credential-access',
    'unsafe-script',
    'data-exfiltration',
    'excessive-permission',
  ],
  credentials: { kind: 'none' },
  analysisMode: 'static',
  install: { kind: 'uv-tool', spec: 'git+https://github.com/NVIDIA/skillspector.git', pin: 'v2.5.1', binName: 'skillspector' },
  invoke: {
    argv: ['scan', '{skillDir}', '--no-llm', '--format', 'sarif', '--output', '{toolDir}/findings.sarif'],
    cwd: 'repoRoot',
  },
  versionArgv: ['--version'],
  artefacts: ['findings.sarif'],
  timeoutMs: 120_000,
}

export const parse: Parse = (ctx) => {
  const bytes = ctx.artefacts.get('findings.sarif')
  if (!bytes) {
    return {
      outcome: 'errored',
      findings: [],
      metrics: {},
      summary: 'skillspector produced no findings.sarif',
    }
  }
  const result = parseSarif(bytes, { toolId: manifest.id, skillRelPath: ctx.skill.relPath })
  return { ...result, metrics: { ...result.metrics, durationMs: ctx.durationMs } }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tests/core/skillspector.test.ts`
Expected: PASS, eleven cases.

- [ ] **Step 6: Assert the design example and the shipped manifest agree**

[design.md](design.md) §7 carries this manifest as its worked example, and revision 3 already corrected it. Rather than re-editing prose, add a test that fails the build when the two drift:

`tests/core/design-example.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { manifest } from '../../src/core/adapters/skillspector.js'

describe('design.md §7 example', () => {
  it('matches the shipped manifest on every field that can silently break a run', async () => {
    const doc = await readFile('docs/specs/design.md', 'utf8')
    const example = doc.slice(doc.indexOf("id: 'skillspector'"))
    expect(example).toContain(`pin: '${manifest.install.pin}'`)
    expect(example).toContain(`analysisMode: '${manifest.analysisMode}'`)
    expect(example).toContain('--no-llm')
    expect(example).toContain('credentials: { kind: \'none\' }')
  })
})
```

An out-of-date worked example is how the credential-mode defect reached revision 2 in the first place: nothing connected the document to the tool.

- [ ] **Step 7: Commit**

```bash
chmod +x scripts/capture-fixtures.sh
git add src/core/adapters/skillspector.ts tests/core/skillspector.test.ts \
        tests/core/design-example.test.ts \
        tests/fixtures/sarif/skillspector-declawed.sarif scripts/capture-fixtures.sh
git commit -m "feat(adapters): implement the skillspector adapter against a real fixture"
```

---

### Task 13: Total stage outcome reduction

**Files:**
- Create: `src/core/stages/outcome.ts`
- Test: `tests/core/outcome.test.ts`

**Interfaces:**
- Consumes: `ToolOutcome`, `StageOutcome` (Task 2).
- Produces: `reduceStageOutcome(outcomes: readonly ToolOutcome[]): { outcome: StageOutcome; verdict: 'passed' | 'failed' }`, `haltsChain(outcome)`, `TOOL_OUTCOMES`.

The Cartesian test is the R5.11 acceptance check. A reduction that is merely a table of the cases someone thought of is how a pipeline ends up unable to decide whether to halt.

- [ ] **Step 1: Write the failing test**

`tests/core/outcome.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { TOOL_OUTCOMES, haltsChain, reduceStageOutcome } from '../../src/core/stages/outcome.js'
import type { StageOutcome, ToolOutcome } from '../../src/core/types.js'

const VALID_STAGE: ReadonlySet<StageOutcome> = new Set([
  'passed',
  'failed',
  'degraded',
  'errored',
  'skipped',
])

/** All non-empty multisets of tool outcomes up to length 3. */
function* combinations(maxLength: number): Generator<ToolOutcome[]> {
  const build = (prefix: ToolOutcome[]): void => undefined
  const all: ToolOutcome[][] = []
  const recurse = (prefix: ToolOutcome[]): void => {
    if (prefix.length > 0) all.push([...prefix])
    if (prefix.length === maxLength) return
    for (const o of TOOL_OUTCOMES) recurse([...prefix, o])
  }
  recurse([])
  yield* all
  void build
}

describe('reduceStageOutcome', () => {
  it('is total over every combination up to three tools', () => {
    let count = 0
    for (const combo of combinations(3)) {
      const { outcome, verdict } = reduceStageOutcome(combo)
      expect(VALID_STAGE.has(outcome), `no outcome for ${combo.join('+')}`).toBe(true)
      expect(['passed', 'failed']).toContain(verdict)
      count += 1
    }
    expect(count).toBe(4 + 16 + 64)
  })

  it('throws on an empty selection rather than inventing an outcome', () => {
    expect(() => reduceStageOutcome([])).toThrow(/empty/)
  })

  it('passes when every tool passed', () => {
    expect(reduceStageOutcome(['passed', 'passed']).outcome).toBe('passed')
  })

  it('fails when a tool failed and the stage is otherwise complete', () => {
    expect(reduceStageOutcome(['passed', 'failed']).outcome).toBe('failed')
  })

  it('degrades when one tool ran and another errored', () => {
    expect(reduceStageOutcome(['passed', 'errored']).outcome).toBe('degraded')
    expect(reduceStageOutcome(['failed', 'errored']).outcome).toBe('degraded')
  })

  it('degrades when one tool ran and another was skipped', () => {
    expect(reduceStageOutcome(['passed', 'skipped']).outcome).toBe('degraded')
    expect(reduceStageOutcome(['failed', 'skipped']).outcome).toBe('degraded')
  })

  it('errors when nothing ran and something errored', () => {
    expect(reduceStageOutcome(['errored']).outcome).toBe('errored')
    expect(reduceStageOutcome(['errored', 'skipped']).outcome).toBe('errored')
  })

  it('skips only when every tool was skipped', () => {
    expect(reduceStageOutcome(['skipped', 'skipped']).outcome).toBe('skipped')
  })

  it('carries the verdict through a degraded stage', () => {
    expect(reduceStageOutcome(['failed', 'errored']).verdict).toBe('failed')
    expect(reduceStageOutcome(['passed', 'errored']).verdict).toBe('passed')
  })

  it('reduces a single tool to its own outcome', () => {
    for (const o of TOOL_OUTCOMES) {
      expect(reduceStageOutcome([o]).outcome).toBe(o)
    }
  })
})

describe('haltsChain', () => {
  it('continues only on passed', () => {
    expect(haltsChain('passed')).toBe(false)
    for (const o of ['failed', 'degraded', 'errored', 'skipped'] as StageOutcome[]) {
      expect(haltsChain(o)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/outcome.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/core/stages/outcome.ts`:

```ts
import type { StageOutcome, ToolOutcome } from '../types.js'

export const TOOL_OUTCOMES: readonly ToolOutcome[] = ['passed', 'failed', 'errored', 'skipped']

export interface StageVerdict {
  outcome: StageOutcome
  /** What the stage would have said had every tool run. */
  verdict: 'passed' | 'failed'
}

/**
 * Two axes rather than a case list: completeness (did every selected tool
 * actually run) and verdict (did anything fail). Total over every non-empty
 * combination by construction.
 */
export function reduceStageOutcome(outcomes: readonly ToolOutcome[]): StageVerdict {
  if (outcomes.length === 0) {
    throw new Error('cannot reduce an empty tool selection')
  }

  let passed = 0
  let failed = 0
  let errored = 0
  for (const o of outcomes) {
    if (o === 'passed') passed += 1
    else if (o === 'failed') failed += 1
    else if (o === 'errored') errored += 1
  }

  const ran = passed + failed
  const complete = ran === outcomes.length
  const verdict: 'passed' | 'failed' = failed > 0 ? 'failed' : 'passed'

  if (complete) return { outcome: verdict, verdict }
  if (ran > 0) return { outcome: 'degraded', verdict }
  if (errored > 0) return { outcome: 'errored', verdict }
  return { outcome: 'skipped', verdict }
}

/** The read-only chain continues only while stages pass outright. */
export function haltsChain(outcome: StageOutcome): boolean {
  return outcome !== 'passed'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/core/outcome.test.ts`
Expected: PASS, twelve cases, including all 84 combinations.

- [ ] **Step 5: Commit**

```bash
git add src/core/stages/outcome.ts tests/core/outcome.test.ts
git commit -m "feat(stages): add a total tool-to-stage outcome reduction"
```

---

### Task 14: Adapter stage executor

**Files:**
- Create: `src/core/stages/types.ts`, `src/core/stages/adapter-stage.ts`
- Test: `tests/core/adapter-stage.test.ts`

**Interfaces:**
- Consumes: `runTool` (Task 9), `getAdapter` (Task 10), `reduceStageOutcome` (Task 13), `ToolLock` (Task 6), `SkillRef` (Task 2).
- Produces: `StageContext`, `ToolRunRecord`, `StageResult`, `StageExecutor`, `MutationScope`, `StagePlan`; `AdapterStageExecutor(stage, policy)` with `plan()` and `execute()`.

Selection is resolved before the lockfile is consulted. A selected tool that is not installed yields a `skipped` record with `error_kind = 'not-installed'`; it is never quietly dropped, because dropping it would let a fan-out stage pass without running every selected tool.

**The classification table (R4.13, design §8.1) lives here, and it is ordered.** The governing rule is that a successful, schema-valid parse is authoritative and the exit code is fallback evidence only — linters and scanners routinely exit non-zero precisely because they found something. `classifyToolRun` below implements one row per case, first match wins, and the test suite carries one case per row asserting the reconciliation effect.

| # | Condition | Outcome | `errorKind` | Reconciles? |
|---|---|---|---|---|
| 1 | not in the lock, or no runnable `bin` | `skipped` | `not-installed` | no |
| 2 | `credentials` unsatisfied | `skipped` | `no-credentials` | no |
| 3 | mutating stage, no authorisation | `skipped` | `no-authorisation` | no (M5) |
| 4 | cancelled | `errored` | `cancelled` | no |
| 5 | timeout, tree killed | `errored` | `timeout` | no |
| 6 | artefact over the size cap | `errored` | `artefact-too-large` | no |
| 7 | declared artefact absent | `errored` | `missing-artefact` | no |
| 8 | `parse` threw | `errored` | `parse` | no |
| 9 | `parse` returned `errored` | `errored` | `parse` | no |
| 10 | parsed, no findings, exit 0 | `passed` | — | yes |
| 11 | parsed, no findings, exit non-zero | `passed` | — | yes |
| 12 | parsed, findings present | `failed` | — | yes |
| 13 | spawn failed | `errored` | `spawn` | no |

Row 7 sits before row 8 deliberately. Revision 2 handed an empty artefact map to the parser and classified by whichever exception it happened to raise, so a missing report was reported as a parse defect.

- [ ] **Step 1: Write the failing test**

`tests/core/adapter-stage.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AdapterStageExecutor } from '../../src/core/stages/adapter-stage.js'
import type { CredentialRequirement } from '../../src/core/adapters/types.js'
import type { StageContext } from '../../src/core/stages/types.js'
import type { SkillRef } from '../../src/core/types.js'
import { makeFakeTool } from '../helpers/fake-tool.js'

const SARIF_EMPTY = JSON.stringify({
  version: '2.1.0',
  runs: [{ tool: { driver: { name: 'skillspector', version: '2.5.1' } }, results: [] }],
})

const skill = {
  id: 'fx/declawed',
  relPath: 'declawed',
  dir: '/repo/declawed',
  repo: { id: 'fx', path: '/repo', name: 'fx', isGit: false },
} as unknown as SkillRef

async function context(over: Partial<StageContext> = {}): Promise<StageContext> {
  return {
    skill,
    stage: 'security',
    stageDir: await mkdtemp(join(tmpdir(), 'sg-stage-')),
    selectedToolIds: ['skillspector'],
    lock: { version: 1, tools: {} },
    env: {},
    secrets: [],
    artefactSizeCapBytes: 1024 * 1024,
    timeoutOverridesMs: {},
    onOutput: () => undefined,
    ...over,
  }
}

const NEEDS_KEY: CredentialRequirement = {
  kind: 'one-of',
  alternatives: [
    { provider: 'NVIDIA', required: ['NVIDIA_INFERENCE_KEY'] },
    { provider: 'OpenAI', required: ['OPENAI_API_KEY'] },
  ],
}

async function lockWith(script: string) {
  const bin = await makeFakeTool('skillspector', script)
  return {
    version: 1 as const,
    tools: {
      skillspector: {
        installKind: 'uv-tool' as const,
        requestedPin: 'v2.5.1',
        resolvedVersion: '2.5.1',
        bin,
        integrity: 'n/a',
        installedAt: '2026-08-01T00:00:00Z',
        verifiedAt: '2026-08-01T00:00:00Z',
      },
    },
  }
}

describe('AdapterStageExecutor.plan', () => {
  it('rejects an empty selection before anything runs', async () => {
    const exec = new AdapterStageExecutor('security')
    await expect(exec.plan(await context({ selectedToolIds: [] }))).rejects.toThrow(/no tools/)
  })

  it('rejects a tool that does not belong to the stage', async () => {
    const exec = new AdapterStageExecutor('validate')
    await expect(exec.plan(await context({ stage: 'validate' }))).rejects.toThrow(/not a validate/)
  })

  it('declares an empty mutation scope for a read-only stage', async () => {
    const exec = new AdapterStageExecutor('security')
    expect((await exec.plan(await context())).mutationScope.paths).toEqual([])
  })
})

describe('AdapterStageExecutor.execute', () => {
  it('records a passed tool run and passes the stage', async () => {
    const lock = await lockWith(`printf '%s' '${SARIF_EMPTY}' > "$7"`)
    const exec = new AdapterStageExecutor('security')
    const ctx = await context({ lock })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.outcome).toBe('passed')
    expect(result.toolRuns[0]?.outcome).toBe('passed')
    expect(result.toolRuns[0]?.toolVersion).toBe('2.5.1')
  })

  it('skips a selected tool that is not installed instead of dropping it', async () => {
    const exec = new AdapterStageExecutor('security')
    const ctx = await context({ lock: { version: 1, tools: {} } })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.toolRuns).toHaveLength(1)
    expect(result.toolRuns[0]).toMatchObject({ outcome: 'skipped', errorKind: 'not-installed' })
    expect(result.outcome).toBe('skipped')
  })

  it('errors when the tool writes no artefact', async () => {
    const lock = await lockWith('exit 0')
    const exec = new AdapterStageExecutor('security')
    const ctx = await context({ lock })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.toolRuns[0]).toMatchObject({ outcome: 'errored', errorKind: 'parse' })
    expect(result.outcome).toBe('errored')
  })

  it('errors with timeout when the tool hangs', async () => {
    const lock = await lockWith('sleep 600')
    const exec = new AdapterStageExecutor('security')
    const ctx = await context({ lock, timeoutOverridesMs: { skillspector: 800 } })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.toolRuns[0]).toMatchObject({ outcome: 'errored', errorKind: 'timeout' })
  })

  it('writes each tool into its own artefact directory', async () => {
    const lock = await lockWith(`printf '%s' '${SARIF_EMPTY}' > "$7"`)
    const exec = new AdapterStageExecutor('security')
    const ctx = await context({ lock })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.toolRuns[0]?.artefactDir).toBe(join(ctx.stageDir, 'skillspector'))
  })

  it('skips a credential-requiring tool and names what is missing', async () => {
    const lock = await lockWith('exit 0')
    const exec = new AdapterStageExecutor('security', {
      credentialsOverride: { skillspector: NEEDS_KEY },
    })
    const ctx = await context({ lock, env: {} })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.toolRuns[0]).toMatchObject({ outcome: 'skipped', errorKind: 'no-credentials' })
    expect(result.toolRuns[0]?.summary).toMatch(/NVIDIA_INFERENCE_KEY.*OPENAI_API_KEY/s)
  })

  it('runs when any one credential alternative is satisfied', async () => {
    const lock = await lockWith(`printf '%s' '${SARIF_EMPTY}' > "$7"`)
    const exec = new AdapterStageExecutor('security', {
      credentialsOverride: { skillspector: NEEDS_KEY },
    })
    const ctx = await context({ lock, env: { OPENAI_API_KEY: 'x' } })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.toolRuns[0]?.outcome).toBe('passed')
  })

  it('passes a non-zero exit whose report parses clean — R4.13 row 11', async () => {
    const lock = await lockWith(`printf '%s' '${SARIF_EMPTY}' > "$7"; exit 1`)
    const exec = new AdapterStageExecutor('security')
    const ctx = await context({ lock })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.toolRuns[0]).toMatchObject({ outcome: 'passed', exitCode: 1, errorKind: null })
  })

  it('classifies an absent declared artefact before invoking the parser — R4.13 row 7', async () => {
    const lock = await lockWith('exit 0')
    const exec = new AdapterStageExecutor('security')
    const ctx = await context({ lock })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.toolRuns[0]).toMatchObject({
      outcome: 'errored',
      errorKind: 'missing-artefact',
    })
  })

  it('errors when the executable does not exist — R4.13 row 13', async () => {
    const lock = {
      version: 1 as const,
      tools: {
        skillspector: {
          installKind: 'uv-tool' as const,
          requestedPin: 'v2.5.1',
          resolvedVersion: '2.5.1',
          bin: '/nonexistent/skillspector',
          integrity: 'n/a',
          installedAt: '2026-08-01T00:00:00Z',
          verifiedAt: '2026-08-01T00:00:00Z',
        },
      },
    }
    const exec = new AdapterStageExecutor('security')
    const ctx = await context({ lock })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.toolRuns[0]).toMatchObject({ outcome: 'errored', errorKind: 'spawn' })
  })

  it('streams output through onOutput', async () => {
    const lock = await lockWith(`echo scanning; printf '%s' '${SARIF_EMPTY}' > "$7"`)
    const onOutput = vi.fn()
    const exec = new AdapterStageExecutor('security')
    const ctx = await context({ lock, onOutput })
    await exec.execute(ctx, await exec.plan(ctx))
    expect(onOutput).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/adapter-stage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/core/stages/types.ts`:

```ts
import type { ToolLock } from '../config/schema.js'
import type {
  ErrorKind,
  Metrics,
  RawFinding,
  SkillRef,
  Stage,
  StageOutcome,
  ToolOutcome,
} from '../types.js'

export interface MutationScope {
  /** Repo-relative paths this stage may write. May include repo-root files. */
  paths: readonly string[]
}

export interface StagePlan {
  toolIds: readonly string[]
  policy: 'fan-out' | 'pick-one' | 'native'
  mutationScope: MutationScope
}

export interface StageContext {
  skill: SkillRef
  stage: Stage
  /** Absolute path to `<run>/NN-<stage>/`. */
  stageDir: string
  selectedToolIds: readonly string[]
  lock: ToolLock
  env: NodeJS.ProcessEnv
  secrets: readonly string[]
  artefactSizeCapBytes: number
  timeoutOverridesMs: Readonly<Record<string, number>>
  onOutput: (toolId: string, stream: 'stdout' | 'stderr', chunk: string) => void
  signal?: AbortSignal
}

export interface ToolRunRecord {
  toolId: string
  toolVersion: string | null
  outcome: ToolOutcome
  exitCode: number | null
  durationMs: number
  errorKind: ErrorKind | null
  artefactDir: string
  findings: RawFinding[]
  metrics: Metrics
  summary: string
}

export interface StageResult {
  stage: Stage
  outcome: StageOutcome
  verdict: 'passed' | 'failed'
  toolRuns: ToolRunRecord[]
}

export interface StageExecutor {
  readonly stage: Stage
  readonly mutating: boolean
  plan(ctx: StageContext): Promise<StagePlan>
  execute(ctx: StageContext, plan: StagePlan): Promise<StageResult>
}
```

`src/core/stages/adapter-stage.ts`:

```ts
import { join } from 'node:path'
import { getAdapter } from '../adapters/registry.js'
import {
  type Adapter,
  type AdapterManifest,
  type CredentialRequirement,
  credentialsSatisfied,
  missingCredentials,
} from '../adapters/types.js'
import { type RunToolOutput, runTool } from '../runner/spawn.js'
import type { ErrorKind, SkillRef, Stage } from '../types.js'
import { reduceStageOutcome } from './outcome.js'
import type {
  StageContext,
  StageExecutor,
  StagePlan,
  StageResult,
  ToolRunRecord,
} from './types.js'

const FAN_OUT_LIMIT = 2

export interface AdapterStageOptions {
  /** Test seam: substitute a manifest's credential requirement. */
  credentialsOverride?: Readonly<Record<string, CredentialRequirement>>
}

function substitute(
  argv: readonly string[],
  vars: Readonly<Record<string, string>>,
): string[] {
  return argv.map((arg) =>
    arg.replace(/\{(skillDir|repoRoot|toolDir)\}/g, (_m, key: string) => vars[key] ?? _m),
  )
}

type Classification = Pick<
  ToolRunRecord,
  'outcome' | 'errorKind' | 'findings' | 'metrics' | 'summary'
>

const errored = (kind: ErrorKind, summary: string, durationMs: number): Classification => ({
  outcome: 'errored',
  errorKind: kind,
  findings: [],
  metrics: { durationMs },
  summary,
})

/**
 * Rows 4 to 13 of the R4.13 table, in order, first match wins. Rows 1 to 3 are
 * decided before a process is ever spawned, by `skipped()` below.
 *
 * The governing rule is that a schema-valid parse is authoritative and the exit
 * code is fallback evidence only: scanners and linters exit non-zero precisely
 * because they found something, so treating exit status as primary turns valid
 * findings into errors. Only rows 10 to 12 reach reconciliation.
 */
export function classifyToolRun(
  adapter: Adapter,
  skill: SkillRef,
  run: RunToolOutput,
): Classification {
  const { durationMs } = run

  if (run.cancelled) return errored('cancelled', 'cancelled', durationMs)
  if (run.timedOut) return errored('timeout', 'timed out', durationMs)
  if (run.oversizeArtefacts.length > 0) {
    return errored(
      'artefact-too-large',
      `artefact over the size cap: ${run.oversizeArtefacts.join(', ')}`,
      durationMs,
    )
  }
  if (run.spawnFailed) return errored('spawn', `could not spawn: ${run.spawnError}`, durationMs)
  // Before parse, not after: a missing report is not a parser defect, and
  // classifying it by whichever exception the parser raised said it was.
  if (run.missingArtefacts.length > 0) {
    return errored(
      'missing-artefact',
      `declared artefact never written: ${run.missingArtefacts.join(', ')}`,
      durationMs,
    )
  }

  let parsed
  try {
    parsed = adapter.parse({
      skill,
      artefacts: run.artefacts,
      stdout: run.stdout,
      stderr: run.stderr,
      exitCode: run.exitCode,
      durationMs,
    })
  } catch (err) {
    return errored('parse', `parse threw: ${(err as Error).message}`, durationMs)
  }

  if (parsed.outcome === 'errored') {
    return errored('parse', parsed.summary, durationMs)
  }

  // Rows 10 to 12. The exit code is recorded but does not vote.
  return {
    outcome: parsed.outcome,
    errorKind: null,
    findings: parsed.findings,
    metrics: { ...parsed.metrics, durationMs },
    summary: parsed.summary,
  }
}

/** Rows 1 to 3: decided before a process is spawned. */
function skipped(
  toolId: string,
  artefactDir: string,
  kind: ErrorKind,
  detail = '',
): ToolRunRecord {
  const reason: Record<string, string> = {
    'not-installed': 'tool is not installed',
    'no-credentials': `needs ${detail}`,
    'no-authorisation': 'mutating stage without authorisation',
  }
  return {
    toolId,
    toolVersion: null,
    outcome: 'skipped',
    exitCode: null,
    durationMs: 0,
    errorKind: kind,
    artefactDir,
    findings: [],
    metrics: {},
    summary: reason[kind] ?? kind,
  }
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      out[i] = await fn(items[i] as T)
    }
  })
  await Promise.all(workers)
  return out
}

export class AdapterStageExecutor implements StageExecutor {
  readonly mutating = false

  constructor(
    readonly stage: Stage,
    private readonly options: AdapterStageOptions = {},
  ) {}

  private credentialsFor(manifest: AdapterManifest): CredentialRequirement {
    return this.options.credentialsOverride?.[manifest.id] ?? manifest.credentials
  }

  /**
   * Resolves the configured selection and validates it. The lockfile is not
   * consulted here: a selected tool must survive planning even when it is not
   * installed, so that execute() can report it as skipped rather than dropping it.
   */
  async plan(ctx: StageContext): Promise<StagePlan> {
    if (ctx.selectedToolIds.length === 0) {
      throw new Error(`no tools selected for stage ${ctx.stage}`)
    }
    let policy: 'fan-out' | 'pick-one' = 'fan-out'
    for (const id of ctx.selectedToolIds) {
      const adapter = getAdapter(id)
      if (!adapter) throw new Error(`unknown tool: ${id}`)
      if (adapter.manifest.stage !== ctx.stage) {
        throw new Error(`${id} is not a ${ctx.stage} tool`)
      }
      policy = adapter.manifest.policy
    }
    if (policy === 'pick-one' && ctx.selectedToolIds.length > 1) {
      throw new Error(`stage ${ctx.stage} accepts exactly one tool`)
    }
    return { toolIds: [...ctx.selectedToolIds], policy, mutationScope: { paths: [] } }
  }

  async execute(ctx: StageContext, plan: StagePlan): Promise<StageResult> {
    const limit = plan.policy === 'pick-one' ? 1 : FAN_OUT_LIMIT

    const toolRuns = await mapLimit(plan.toolIds, limit, async (toolId) => {
      const artefactDir = join(ctx.stageDir, toolId)
      const adapter = getAdapter(toolId)
      if (!adapter) return skipped(toolId, artefactDir, 'not-installed')

      const locked = ctx.lock.tools[toolId]
      if (!locked) return skipped(toolId, artefactDir, 'not-installed')

      // Structured, so the skip summary and the wizard can both name what is
      // missing. A boolean could only say "something".
      const required = this.credentialsFor(adapter.manifest)
      if (!credentialsSatisfied(required, ctx.env)) {
        return skipped(toolId, artefactDir, 'no-credentials', missingCredentials(required))
      }

      const { manifest } = adapter
      const argv = substitute(manifest.invoke.argv, {
        skillDir: ctx.skill.dir,
        repoRoot: ctx.skill.repo.path,
        toolDir: artefactDir,
      })

      const run = await runTool({
        bin: locked.bin,
        argv,
        cwd: manifest.invoke.cwd === 'skillDir' ? ctx.skill.dir : ctx.skill.repo.path,
        toolDir: artefactDir,
        env: ctx.env,
        secrets: ctx.secrets,
        artefacts: manifest.artefacts,
        artefactSizeCapBytes: ctx.artefactSizeCapBytes,
        timeoutMs: ctx.timeoutOverridesMs[toolId] ?? manifest.timeoutMs,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      })

      ctx.onOutput(toolId, 'stdout', run.stdout)
      ctx.onOutput(toolId, 'stderr', run.stderr)

      const base = {
        toolId,
        toolVersion: locked.resolvedVersion,
        exitCode: run.exitCode,
        durationMs: run.durationMs,
        artefactDir,
      }

      return { ...base, ...classifyToolRun(adapter, ctx.skill, run) }
    })

    const { outcome, verdict } = reduceStageOutcome(toolRuns.map((t) => t.outcome))
    return { stage: ctx.stage, outcome, verdict, toolRuns }
  }
}
```

The fixture scripts in the test receive the substituted argv, so `"$7"` is the
`--output` value: `scan {skillDir} --no-llm --format sarif --output {toolDir}/findings.sarif`
places the output path at position 7.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/core/adapter-stage.test.ts`
Expected: PASS, fifteen cases. Together with the timeout, cancellation and oversize cases in Task 9, every row of the R4.13 table is asserted somewhere.

- [ ] **Step 5: Commit**

```bash
git add src/core/stages tests/core/adapter-stage.test.ts
git commit -m "feat(stages): execute adapter-backed stages with per-tool isolation"
```

---

### Task 15: Sidecar workspace writer

**Files:**
- Create: `src/core/workspace/layout.ts`, `src/core/workspace/writer.ts`
- Test: `tests/core/workspace.test.ts`

**Interfaces:**
- Consumes: `SkillRef` (Task 2), `StageResult` (Task 14), `Provenance` (Task 7).
- Produces: `claimRunDir(workspacePath)`, `stageDirFor(runDir, index, stage)`, `writeRunJson(runDir, meta)`, `writeStageJson(stageDir, result, unredacted)`, `finalizeRun(workspacePath, entry)`, `readIndex(workspacePath)`, `ensureGitignore(repoPath)`, `withSkillLock(workspacePath, fn)`, `LOCK_STALE_MS`.

Uniqueness is claimed, not asserted: `mkdir` with `recursive: false` fails if the directory exists, so a collision is detected rather than silently sharing a directory.

Three durability corrections from the second design review, each a test below.

**The index recovers on read, not on write.** One `write()` per record, newline included, then `fsync`. That is the strongest guarantee POSIX offers and it is not atomicity: a power failure can still leave a partial final line. So `readIndex` discards an invalid final line and `finalizeRun` prefixes a newline when the file does not end in one, and neither pretends otherwise.

**`latest` is the greatest run id.** UUIDv7 is ordered by claim time, which is one stable field. Defining it as "the later run" left open whether later meant started, finished or locked — and two runs that start in one order and finish in the other would then disagree.

**The lock has a lease.** A plain `wx` lockfile whose holder is killed blocks that skill forever. The lockfile carries the holder's pid and a heartbeat mtime; a waiter past the stale threshold breaks it and logs having done so.

- [ ] **Step 1: Write the failing test**

`tests/core/workspace.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { appendFile, mkdir, mkdtemp, readFile, readlink, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  claimRunDir,
  ensureGitignore,
  finalizeRun,
  readIndex,
  stageDirFor,
  withSkillLock,
  writeRunJson,
  writeStageJson,
} from '../../src/core/workspace/writer.js'
import type { StageResult } from '../../src/core/stages/types.js'

const ws = async (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-ws-'))

const stageResult = (): StageResult => ({
  stage: 'security',
  outcome: 'failed',
  verdict: 'failed',
  toolRuns: [
    {
      toolId: 'skillspector',
      toolVersion: '2.5.1',
      outcome: 'failed',
      exitCode: 0,
      durationMs: 1200,
      errorKind: null,
      artefactDir: '/x/skillspector',
      findings: [],
      metrics: { findingsTotal: 2 },
      summary: '2 findings',
    },
  ],
})

describe('claimRunDir', () => {
  it('creates a uuidv7 directory and returns both id and path', async () => {
    const { runId, runDir } = await claimRunDir(await ws())
    expect(runId).toMatch(/^[0-9a-f-]{36}$/)
    expect(basename(runDir)).toBe(runId)
  })

  it('produces time-ordered ids', async () => {
    const root = await ws()
    const a = await claimRunDir(root)
    await new Promise((r) => setTimeout(r, 5))
    const b = await claimRunDir(root)
    expect([a.runId, b.runId].sort()).toEqual([a.runId, b.runId])
  })

  it('creates the runs root with owner-only permissions', async () => {
    const root = await ws()
    const { runDir } = await claimRunDir(root)
    expect((await stat(runDir)).mode & 0o777).toBe(0o700)
  })
})

describe('writeRunJson and writeStageJson', () => {
  it('writes provenance and tool lock as siblings, with no token', async () => {
    const { runDir, runId } = await claimRunDir(await ws())
    await writeRunJson(runDir, {
      runId,
      skillId: 'fx/declawed',
      skillDigest: 'sha256:abc',
      git: { commit: null, dirty: false },
      provenance: {
        baseUrlHost: 'api.deepseek.com',
        models: { ANTHROPIC_MODEL: 'x' },
        authTokenHash: 'sha256:1a2b3c4d',
      },
      toolLock: { skillspector: '2.5.1' },
    })
    const doc = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8'))
    expect(Object.keys(doc)).toEqual(
      expect.arrayContaining(['runId', 'skillDigest', 'provenance', 'toolLock']),
    )
    expect(doc.provenance.toolLock).toBeUndefined()
    expect(JSON.stringify(doc)).not.toMatch(/sk-/)
  })

  it('records unredacted artefacts so the exposure is visible', async () => {
    const { runDir } = await claimRunDir(await ws())
    const stageDir = stageDirFor(runDir, 3, 'security')
    await writeStageJson(stageDir, stageResult(), { skillspector: ['findings.sarif'] })
    const doc = JSON.parse(await readFile(join(stageDir, 'stage.json'), 'utf8'))
    expect(doc.toolRuns[0].unredactedArtefacts).toEqual(['findings.sarif'])
    expect(doc.toolRuns[0].redacted).toBe(false)
    expect(doc.outcome).toBe('failed')
  })

  it('numbers stage directories by lifecycle position', async () => {
    const { runDir } = await claimRunDir(await ws())
    expect(basename(stageDirFor(runDir, 3, 'security'))).toBe('03-security')
  })
})

describe('finalizeRun', () => {
  it('appends one line per run and points latest at the newest', async () => {
    const root = await ws()
    const a = await claimRunDir(root)
    await finalizeRun(root, { runId: a.runId, outcome: 'passed', endedAt: '2026-08-01T00:00:00Z' })
    const b = await claimRunDir(root)
    await finalizeRun(root, { runId: b.runId, outcome: 'failed', endedAt: '2026-08-01T00:01:00Z' })

    const lines = (await readFile(join(root, 'skillgantry/runs/index.ndjson'), 'utf8'))
      .trim()
      .split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1]!).outcome).toBe('failed')
    expect(await readlink(join(root, 'skillgantry/runs/latest'))).toContain(b.runId)
  })

  it('loses no line when three runs finalise concurrently', async () => {
    const root = await ws()
    const claims = await Promise.all([claimRunDir(root), claimRunDir(root), claimRunDir(root)])
    await Promise.all(
      claims.map((c, i) =>
        finalizeRun(root, {
          runId: c.runId,
          outcome: 'passed',
          endedAt: `2026-08-01T00:0${i}:00Z`,
        }),
      ),
    )
    const lines = (await readFile(join(root, 'skillgantry/runs/index.ndjson'), 'utf8'))
      .trim()
      .split('\n')
    expect(lines).toHaveLength(3)
    expect(new Set(lines.map((l) => JSON.parse(l).runId)).size).toBe(3)
  })

  it('points latest at the greatest run id even when finish order is inverted', async () => {
    const root = await ws()
    const first = await claimRunDir(root)
    const second = await claimRunDir(root)
    expect(second.runId > first.runId).toBe(true)

    // Second claimed later but finalises first.
    await finalizeRun(root, {
      runId: second.runId,
      outcome: 'passed',
      endedAt: '2026-08-01T00:00:00Z',
    })
    await finalizeRun(root, {
      runId: first.runId,
      outcome: 'passed',
      endedAt: '2026-08-01T00:05:00Z',
    })
    expect(await readlink(join(root, 'skillgantry/runs/latest'))).toContain(second.runId)
  })
})

describe('index recovery', () => {
  it('discards a truncated final line and keeps every earlier record', async () => {
    const root = await ws()
    const a = await claimRunDir(root)
    await finalizeRun(root, { runId: a.runId, outcome: 'passed', endedAt: '2026-08-01T00:00:00Z' })

    const path = join(root, 'skillgantry/runs/index.ndjson')
    await appendFile(path, '{"runId":"partial","outc')

    const entries = await readIndex(root)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.runId).toBe(a.runId)
  })

  it('does not fuse a new record onto a partial line', async () => {
    const root = await ws()
    const path = join(root, 'skillgantry/runs/index.ndjson')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '{"runId":"partial","outc')

    const b = await claimRunDir(root)
    await finalizeRun(root, { runId: b.runId, outcome: 'passed', endedAt: '2026-08-01T00:01:00Z' })

    const entries = await readIndex(root)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.runId).toBe(b.runId)
  })
})

describe('withSkillLock', () => {
  it('reclaims a lock whose holder is dead', async () => {
    const root = await ws()
    await mkdir(join(root, 'skillgantry'), { recursive: true })
    // pid 2^22 + 1 is above every platform's pid_max default, so it cannot exist.
    await writeFile(join(root, 'skillgantry/.lock'), JSON.stringify({ pid: 4194305 }))

    const reclaimed: number[] = []
    const value = await withSkillLock(root, async () => 'ran', 1_000, (_p, pid) =>
      reclaimed.push(pid),
    )
    expect(value).toBe('ran')
    expect(reclaimed).toEqual([4194305])
  })

  it('times out rather than breaking a live lock', async () => {
    const root = await ws()
    await mkdir(join(root, 'skillgantry'), { recursive: true })
    await writeFile(join(root, 'skillgantry/.lock'), JSON.stringify({ pid: process.pid }))
    await expect(withSkillLock(root, async () => 'ran', 100)).rejects.toThrow(/timed out/)
  })
})

describe('ensureGitignore', () => {
  it('adds both workspace patterns when absent', async () => {
    const repo = await ws()
    await ensureGitignore(repo)
    const body = await readFile(join(repo, '.gitignore'), 'utf8')
    expect(body).toContain('*-workspace/')
    expect(body).toContain('.skillgantry-workspace/')
  })

  it('is idempotent and preserves existing entries', async () => {
    const repo = await ws()
    await writeFile(join(repo, '.gitignore'), 'node_modules/\n*-workspace/\n')
    await ensureGitignore(repo)
    await ensureGitignore(repo)
    const body = await readFile(join(repo, '.gitignore'), 'utf8')
    expect(body).toContain('node_modules/')
    expect(body.match(/\*-workspace\//g)).toHaveLength(1)
  })
})

describe('withSkillLock', () => {
  it('serialises concurrent critical sections', async () => {
    const root = await ws()
    const order: string[] = []
    await Promise.all([
      withSkillLock(root, async () => {
        order.push('a-start')
        await new Promise((r) => setTimeout(r, 50))
        order.push('a-end')
      }),
      withSkillLock(root, async () => {
        order.push('b-start')
        order.push('b-end')
      }),
    ])
    expect(order.indexOf('a-end')).toBeLessThan(order.indexOf('b-start'))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/workspace.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/core/workspace/layout.ts`:

```ts
import { join } from 'node:path'
import type { Stage } from '../types.js'

export const STAGE_ORDER: readonly Stage[] = [
  'validate',
  'evaluate',
  'security',
  'optimise',
  'release',
]

export const runsRoot = (workspacePath: string): string =>
  join(workspacePath, 'skillgantry', 'runs')

export const indexPath = (workspacePath: string): string =>
  join(runsRoot(workspacePath), 'index.ndjson')

export const latestPath = (workspacePath: string): string =>
  join(runsRoot(workspacePath), 'latest')

export const lockPath = (workspacePath: string): string =>
  join(workspacePath, 'skillgantry', '.lock')

/** Stage directories are numbered by lifecycle position, not execution order. */
export function stageDirFor(runDir: string, index: number, stage: Stage): string {
  return join(runDir, `${String(index).padStart(2, '0')}-${stage}`)
}

export const toolDirFor = (stageDir: string, toolId: string): string => join(stageDir, toolId)
```

`src/core/workspace/writer.ts`:

```ts
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { v7 as uuidv7 } from 'uuid'
import type { Provenance } from '../config/env.js'
import type { StageResult } from '../stages/types.js'
import { indexPath, latestPath, lockPath, runsRoot, stageDirFor } from './layout.js'

export { stageDirFor, toolDirFor } from './layout.js'

const WORKSPACE_MODE = 0o700
const IGNORE_PATTERNS = ['*-workspace/', '.skillgantry-workspace/']

export interface RunMeta {
  runId: string
  skillId: string
  skillDigest: string
  git: { commit: string | null; dirty: boolean }
  provenance: Provenance
  toolLock: Record<string, string>
}

export interface IndexEntry {
  runId: string
  outcome: string
  endedAt: string
}

export interface ClaimedRun {
  runId: string
  runDir: string
}

/**
 * Uniqueness is claimed by exclusive mkdir, not assumed from the identifier.
 * A collision retries rather than letting two runs share one directory.
 */
export async function claimRunDir(workspacePath: string): Promise<ClaimedRun> {
  const root = runsRoot(workspacePath)
  await mkdir(root, { recursive: true, mode: WORKSPACE_MODE })
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const runId = uuidv7()
    const runDir = join(root, runId)
    try {
      await mkdir(runDir, { recursive: false, mode: WORKSPACE_MODE })
      return { runId, runDir }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new Error('could not claim a unique run directory after 5 attempts')
}

export async function writeRunJson(runDir: string, meta: RunMeta): Promise<void> {
  await writeFile(join(runDir, 'run.json'), `${JSON.stringify(meta, null, 2)}\n`)
}

export async function writeStageJson(
  stageDir: string,
  result: StageResult,
  unredactedByTool: Readonly<Record<string, readonly string[]>> = {},
): Promise<void> {
  await mkdir(stageDir, { recursive: true })
  const doc = {
    stage: result.stage,
    outcome: result.outcome,
    verdict: result.verdict,
    toolRuns: result.toolRuns.map((run) => ({
      ...run,
      // R7.4a: native artefacts are not redacted, so the exposure is recorded.
      unredactedArtefacts: unredactedByTool[run.toolId] ?? [],
      redacted: false,
    })),
  }
  await writeFile(join(stageDir, 'stage.json'), `${JSON.stringify(doc, null, 2)}\n`)
}

/** A lock older than this with a dead holder is reclaimable. */
export const LOCK_STALE_MS = 30_000

const holderAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Leased per-skill lock. A bare `wx` lockfile is not enough: if the holder is
 * killed the file survives and that skill can never be finalised again. The
 * lease makes the failure recoverable — a waiter may break a lock whose holder
 * is gone, or whose heartbeat has stopped for longer than the threshold.
 */
export async function withSkillLock<T>(
  workspacePath: string,
  fn: () => Promise<T>,
  timeoutMs = 10_000,
  onReclaim: (path: string, pid: number) => void = () => undefined,
): Promise<T> {
  const path = lockPath(workspacePath)
  await mkdir(join(workspacePath, 'skillgantry'), { recursive: true, mode: WORKSPACE_MODE })
  const deadline = Date.now() + timeoutMs

  for (;;) {
    try {
      const handle = await open(path, 'wx')
      await handle.write(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
      await handle.close()
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err

      const info = await stat(path).catch(() => null)
      if (info) {
        const held = JSON.parse(await readFile(path, 'utf8').catch(() => '{}')) as { pid?: number }
        const stale = Date.now() - info.mtimeMs > LOCK_STALE_MS
        const dead = typeof held.pid === 'number' && !holderAlive(held.pid)
        if (dead || stale) {
          onReclaim(path, held.pid ?? -1)
          await rm(path, { force: true })
          continue
        }
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${path}`)
      await new Promise((r) => setTimeout(r, 15))
    }
  }

  const heartbeat = setInterval(() => {
    void utimes(path, new Date(), new Date()).catch(() => undefined)
  }, LOCK_STALE_MS / 3)

  try {
    return await fn()
  } finally {
    clearInterval(heartbeat)
    await rm(path, { force: true })
  }
}

/**
 * Reads the index, discarding a final line that a crash truncated. Every record
 * is also present in full inside its own run directory, so a lost tail line
 * costs an index entry and never evidence.
 */
export async function readIndex(workspacePath: string): Promise<IndexEntry[]> {
  let body: string
  try {
    body = await readFile(indexPath(workspacePath), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const out: IndexEntry[] = []
  for (const line of body.split('\n')) {
    if (line.length === 0) continue
    try {
      out.push(JSON.parse(line) as IndexEntry)
    } catch {
      // Only the last line can be partial; anything else is not recoverable
      // here either, and skipping it is the same conservative choice.
    }
  }
  return out
}

export async function finalizeRun(workspacePath: string, entry: IndexEntry): Promise<void> {
  await withSkillLock(workspacePath, async () => {
    const path = indexPath(workspacePath)
    const info = await stat(path).catch(() => null)
    let prefix = ''
    if (info && info.size > 0) {
      const handle = await open(path, 'r')
      try {
        const tail = Buffer.alloc(1)
        await handle.read(tail, 0, 1, info.size - 1)
        // A previous crash may have lost the terminating newline. Starting on a
        // fresh line means one damaged record can never corrupt the next.
        if (tail[0] !== 0x0a) prefix = '\n'
      } finally {
        await handle.close()
      }
    }

    const handle = await open(path, 'a')
    try {
      // One write call per record, newline included, then fsync.
      await handle.write(`${prefix}${JSON.stringify(entry)}\n`)
      await handle.sync()
    } finally {
      await handle.close()
    }

    // `latest` is the greatest run id, not the last finaliser. UUIDv7 orders by
    // claim time, so two runs finishing out of order still agree.
    const entries = await readIndex(workspacePath)
    const newest = entries.reduce((max, e) => (e.runId > max ? e.runId : max), entry.runId)

    const link = latestPath(workspacePath)
    const temp = `${link}.tmp`
    await rm(temp, { force: true })
    await symlink(newest, temp)
    await rename(temp, link)
  })
}

export async function ensureGitignore(repoPath: string): Promise<void> {
  const path = join(repoPath, '.gitignore')
  let body = ''
  try {
    body = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  const lines = new Set(body.split(/\r?\n/).map((l) => l.trim()))
  const missing = IGNORE_PATTERNS.filter((p) => !lines.has(p))
  if (missing.length === 0) return

  const prefix = body.length === 0 || body.endsWith('\n') ? '' : '\n'
  await writeFile(path, `${body}${prefix}${missing.join('\n')}\n`)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/core/workspace.test.ts`
Expected: PASS, eighteen cases. The concurrent-finalisation and inverted-order cases are the R6.7 acceptance checks; the truncated-line and dead-holder cases are R6.4 and R6.9.

- [ ] **Step 5: Commit**

```bash
git add src/core/workspace tests/core/workspace.test.ts
git commit -m "feat(workspace): write the sidecar layout with locked append-only finalisation"
```

---

### Task 16: Ledger schema, connection and fingerprinting

**Files:**
- Create: `src/core/ledger/schema.ts`, `src/core/ledger/db.ts`, `src/core/ledger/fingerprint.ts`
- Test: `tests/core/fingerprint.test.ts`, `tests/core/ledger-db.test.ts`

**Interfaces:**
- Consumes: `RuleClass` (Task 2).
- Produces: `fingerprint(skillId, relPath, ruleClass): string`; `openLedger(path): Ledger` where `Ledger = { db: DatabaseSync; close(): void }`; `MIGRATIONS`.

The fingerprint carries no line number and no message text, which is what lets it survive an edit. Cross-tool merging falls out of the same choice: two scanners reporting one class in one file produce a single identifier.

- [ ] **Step 1: Write the failing tests**

`tests/core/fingerprint.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fingerprint } from '../../src/core/ledger/fingerprint.js'

describe('fingerprint', () => {
  it('is a stable 12-character hex identifier', () => {
    const fp = fingerprint('fx/declawed', 'declawed/SKILL.md', 'credential-access')
    expect(fp).toMatch(/^[0-9a-f]{12}$/)
    expect(fp).toBe(fingerprint('fx/declawed', 'declawed/SKILL.md', 'credential-access'))
  })

  it('merges two tools reporting the same class in the same file', () => {
    // Neither the tool id nor the message participates, so detections collapse.
    expect(fingerprint('fx/d', 'd/SKILL.md', 'prompt-injection')).toBe(
      fingerprint('fx/d', 'd/SKILL.md', 'prompt-injection'),
    )
  })

  it('separates different rule classes in one file', () => {
    expect(fingerprint('fx/d', 'd/SKILL.md', 'prompt-injection')).not.toBe(
      fingerprint('fx/d', 'd/SKILL.md', 'credential-access'),
    )
  })

  it('separates the same class in different files', () => {
    expect(fingerprint('fx/d', 'd/a.py', 'unsafe-script')).not.toBe(
      fingerprint('fx/d', 'd/b.py', 'unsafe-script'),
    )
  })

  it('separates the same class in different skills', () => {
    expect(fingerprint('fx/a', 'a/SKILL.md', 'unsafe-script')).not.toBe(
      fingerprint('fx/b', 'b/SKILL.md', 'unsafe-script'),
    )
  })

  it('never merges unmapped classes across tools', () => {
    expect(fingerprint('fx/d', 'd/SKILL.md', 'unmapped:skillspector:X1')).not.toBe(
      fingerprint('fx/d', 'd/SKILL.md', 'unmapped:skill-scanner:X1'),
    )
  })

  it('normalises windows separators before hashing', () => {
    expect(fingerprint('fx/d', 'd\\scripts\\scan.py', 'unsafe-script')).toBe(
      fingerprint('fx/d', 'd/scripts/scan.py', 'unsafe-script'),
    )
  })
})
```

`tests/core/ledger-db.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLedger } from '../../src/core/ledger/db.js'

const dbPath = async (): Promise<string> =>
  join(await mkdtemp(join(tmpdir(), 'sg-db-')), 'gantry.db')

describe('openLedger', () => {
  it('creates every table', () => {
    const ledger = openLedger(':memory:')
    const names = ledger.db
      .prepare(`select name from sqlite_master where type = 'table'`)
      .all()
      .map((r) => (r as { name: string }).name)
    for (const t of [
      'repos',
      'skills',
      'runs',
      'stages',
      'tool_runs',
      'issues',
      'issue_detections',
      'issue_detectors',
    ]) {
      expect(names).toContain(t)
    }
    ledger.close()
  })

  it('has no token or cost column anywhere', () => {
    const ledger = openLedger(':memory:')
    const sql = ledger.db
      .prepare(`select sql from sqlite_master where sql is not null`)
      .all()
      .map((r) => (r as { sql: string }).sql)
      .join(' ')
    expect(sql).not.toMatch(/token|cost|price/i)
    ledger.close()
  })

  it('is idempotent across reopening the same file', async () => {
    const path = await dbPath()
    openLedger(path).close()
    const second = openLedger(path)
    expect(second.db.prepare('select 1 as ok').get()).toMatchObject({ ok: 1 })
    second.close()
  })

  it('enforces foreign keys', () => {
    const ledger = openLedger(':memory:')
    expect(() =>
      ledger.db
        .prepare(`insert into stages (run_id, stage, outcome, verdict) values (?, ?, ?, ?)`)
        .run('missing-run', 'security', 'passed', 'passed'),
    ).toThrow()
    ledger.close()
  })

  it('rejects a duplicate detection ordinal', () => {
    const { db, close } = openLedger(':memory:')
    db.prepare(`insert into repos (id, path, name, is_git) values ('fx','/r','fx',0)`).run()
    db.prepare(
      `insert into skills (id, repo_id, rel_path, lifecycle_state) values ('fx/d','fx','d','active')`,
    ).run()
    db.prepare(
      `insert into issues (fingerprint, skill_id, rule_class, rel_path, severity_max, state, occurrence_count)
       values ('abc','fx/d','unsafe-script','d/a.py','high','open',1)`,
    ).run()
    db.prepare(
      `insert into runs (id, skill_id, trigger, started_at, outcome, skill_digest, sidecar_path)
       values ('r1','fx/d','cli','t','failed','sha256:x','/w')`,
    ).run()
    db.prepare(
      `insert into stages (id, run_id, stage, outcome, verdict) values (1,'r1','security','failed','failed')`,
    ).run()
    db.prepare(
      `insert into tool_runs (id, stage_id, tool_id, outcome, artefact_dir)
       values (1,1,'skillspector','failed','/w/x')`,
    ).run()

    const insert = db.prepare(
      `insert into issue_detections (issue_fp, tool_run_id, ordinal, native_rule_id, native_severity, message)
       values ('abc',1,0,'LP3','warning','m')`,
    )
    insert.run()
    expect(() => insert.run()).toThrow()
    close()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/core/fingerprint.test.ts tests/core/ledger-db.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`src/core/ledger/fingerprint.ts`:

```ts
import { createHash } from 'node:crypto'
import type { RuleClass } from '../types.js'

/**
 * Identity is (skill, path, rule class) and nothing else.
 *
 * No line number, so an edit elsewhere in the file cannot resurrect a triaged
 * issue. No message text and no tool id, so two scanners describing the same
 * problem in different words resolve to one issue with two detections. The
 * cost is that several occurrences of one class in one file collapse into one
 * issue; the detections table carries each occurrence separately.
 */
export function fingerprint(skillId: string, relPath: string, ruleClass: RuleClass): string {
  const normalisedPath = relPath.replace(/\\/g, '/')
  return createHash('sha256')
    .update(`${skillId} ${normalisedPath} ${ruleClass}`)
    .digest('hex')
    .slice(0, 12)
}
```

`src/core/ledger/schema.ts`:

```ts
export const MIGRATIONS: readonly string[] = [
  `
  create table if not exists repos (
    id            text primary key,
    path          text not null unique,
    name          text not null,
    is_git        integer not null default 0,
    registered_at text not null default (datetime('now'))
  );

  create table if not exists skills (
    id              text primary key,
    repo_id         text not null references repos(id) on delete cascade,
    name            text,
    rel_path        text not null,
    current_version text,
    lifecycle_state text not null default 'active',
    deprecated_at   text,
    superseded_by   text,
    first_seen      text not null default (datetime('now')),
    last_seen       text not null default (datetime('now')),
    unique (repo_id, rel_path)
  );

  create table if not exists runs (
    id              text primary key,
    skill_id        text not null references skills(id) on delete cascade,
    trigger         text not null,
    started_at      text not null,
    ended_at        text,
    outcome         text,
    skill_digest    text not null,
    git_commit      text,
    git_dirty       integer,
    provenance_json text,
    tool_lock_json  text,
    sidecar_path    text not null
  );

  create table if not exists stages (
    id           integer primary key autoincrement,
    run_id       text not null references runs(id) on delete cascade,
    stage        text not null,
    outcome      text not null,
    verdict      text not null,
    started_at   text,
    ended_at     text,
    metrics_json text
  );

  create table if not exists tool_runs (
    id           integer primary key autoincrement,
    stage_id     integer not null references stages(id) on delete cascade,
    tool_id      text not null,
    tool_version text,
    outcome      text not null,
    exit_code    integer,
    duration_ms  integer,
    artefact_dir text not null,
    error_kind   text
  );

  create table if not exists issues (
    fingerprint      text primary key,
    skill_id         text not null references skills(id) on delete cascade,
    rule_class       text not null,
    rel_path         text not null,
    severity_max     text not null,
    state            text not null,
    note             text,
    occurrence_count integer not null default 1,
    first_seen_run   text,
    last_seen_run    text,
    closed_run       text,
    reopened_run     text
  );

  create table if not exists issue_detections (
    issue_fp        text not null references issues(fingerprint) on delete cascade,
    tool_run_id     integer not null references tool_runs(id) on delete cascade,
    ordinal         integer not null,
    native_rule_id  text not null,
    native_severity text not null,
    line            integer,
    message         text not null,
    primary key (issue_fp, tool_run_id, ordinal)
  );

  -- One row per tool that has ever detected this issue. Closure is a
  -- conjunction over these rows, which is what makes it independent of the
  -- order two concurrent fan-out tools happen to finish in.
  create table if not exists issue_detectors (
    issue_fp        text not null references issues(fingerprint) on delete cascade,
    tool_id         text not null,
    last_seen_run   text,
    last_absent_run text,
    primary key (issue_fp, tool_id)
  );

  create index if not exists idx_runs_skill on runs(skill_id, started_at);
  create index if not exists idx_stages_run on stages(run_id);
  create index if not exists idx_issues_skill_state on issues(skill_id, state);
  create index if not exists idx_detections_issue on issue_detections(issue_fp);
  create index if not exists idx_detectors_issue on issue_detectors(issue_fp);
  `,
]
```

`src/core/ledger/db.ts`:

```ts
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './schema.js'

export interface Ledger {
  db: DatabaseSync
  close(): void
}

export function openLedger(path: string): Ledger {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })

  const db = new DatabaseSync(path)
  db.exec('pragma journal_mode = wal')
  db.exec('pragma foreign_keys = on')
  db.exec('create table if not exists schema_version (version integer primary key)')

  const row = db.prepare('select max(version) as v from schema_version').get() as
    | { v: number | null }
    | undefined
  const applied = row?.v ?? 0

  for (let i = applied; i < MIGRATIONS.length; i += 1) {
    db.exec(MIGRATIONS[i] as string)
    db.prepare('insert into schema_version (version) values (?)').run(i + 1)
  }

  return { db, close: () => db.close() }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/core/fingerprint.test.ts tests/core/ledger-db.test.ts`
Expected: PASS, twelve cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/ledger tests/core/fingerprint.test.ts tests/core/ledger-db.test.ts
git commit -m "feat(ledger): add the schema, connection and merge-first fingerprint"
```

---

### Task 17: Issue state machine, reconciliation and the run transaction

**Files:**
- Create: `src/core/ledger/issues.ts`, `src/core/ledger/reconcile.ts`, `src/core/ledger/record.ts`
- Test: `tests/core/issues.test.ts`, `tests/core/reconcile.test.ts`

**Interfaces:**
- Consumes: `openLedger` (Task 16), `fingerprint` (Task 16), `getAdapter` (Task 10), `StageResult`/`ToolRunRecord` (Task 14).
- Produces: `IssueState`, `stateOnDetection(state)`, `stateOnAbsence(state)`, `maxSeverity(a, b)`; `reconcile(db, skillId, runId, toolRuns)`; `recordRun(ledger, input): RunDelta`.

Three rules carry the weight here.

A tool that errored or was skipped reconciles nothing, so a crashed scanner cannot mark every issue it ever found as fixed.

**Closure is a conjunction over detectors, not a single owner.** Merge-first identity means one issue can carry detections from two scanners. Revision 2 then closed it when the tool owning its *most recent* detection reported a conclusive absence — but fan-out tools run concurrently, so two detections from one run have no order, and completion timing decided ownership. Identical runs could disagree about whether an issue closed. An `issue_detectors` row per tool turns closure into "every detector has since been conclusively absent", which no ordering can influence.

**Scope is derived, not declared.** A tool's reconciliation scope is its `detects` unioned with every class it has actually produced for this skill. That subsumes revision 2's `unmapped:` clause and also covers a mapped class the manifest simply forgot.

- [ ] **Step 1: Write the failing tests**

`tests/core/issues.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { maxSeverity, stateOnAbsence, stateOnDetection } from '../../src/core/ledger/issues.js'

describe('stateOnDetection', () => {
  it('keeps an open issue open', () => {
    expect(stateOnDetection('open')).toBe('open')
  })

  it('keeps an acknowledged issue acknowledged', () => {
    expect(stateOnDetection('acknowledged')).toBe('acknowledged')
  })

  it('keeps a wontfix issue suppressed', () => {
    expect(stateOnDetection('wontfix')).toBe('wontfix')
  })

  it('reopens a fixed issue', () => {
    expect(stateOnDetection('fixed')).toBe('open')
  })
})

describe('stateOnAbsence', () => {
  it('closes an open issue', () => {
    expect(stateOnAbsence('open')).toBe('fixed')
  })

  it('closes an acknowledged issue', () => {
    expect(stateOnAbsence('acknowledged')).toBe('fixed')
  })

  it('never closes a wontfix issue', () => {
    expect(stateOnAbsence('wontfix')).toBeNull()
  })

  it('leaves an already fixed issue alone', () => {
    expect(stateOnAbsence('fixed')).toBeNull()
  })
})

describe('maxSeverity', () => {
  it('keeps the stronger of two severities', () => {
    expect(maxSeverity('low', 'high')).toBe('high')
    expect(maxSeverity('critical', 'info')).toBe('critical')
    expect(maxSeverity('medium', 'medium')).toBe('medium')
  })
})
```

`tests/core/reconcile.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { openLedger, type Ledger } from '../../src/core/ledger/db.js'
import { fingerprint } from '../../src/core/ledger/fingerprint.js'
import { recordRun, type RunRecordInput } from '../../src/core/ledger/record.js'
import type { StageResult, ToolRunRecord } from '../../src/core/stages/types.js'
import type { RawFinding, SkillRef, ToolOutcome } from '../../src/core/types.js'

const SKILL = {
  id: 'fx/declawed',
  name: 'declawed',
  version: '1.1.0',
  dir: '/repo/declawed',
  relPath: 'declawed',
  rootSkill: false,
  workspacePath: '/repo/declawed-workspace',
  repo: { id: 'fx', path: '/repo', name: 'fx', isGit: false },
} as SkillRef

const finding = (over: Partial<RawFinding> = {}): RawFinding => ({
  ruleClass: 'unsafe-script',
  nativeRuleId: 'LP3',
  severity: 'medium',
  path: 'declawed/scripts/scan.py',
  line: 34,
  message: 'unsafe script',
  ...over,
})

const toolRun = (over: Partial<ToolRunRecord> = {}): ToolRunRecord => ({
  toolId: 'skillspector',
  toolVersion: '2.5.1',
  outcome: 'failed',
  exitCode: 0,
  durationMs: 10,
  errorKind: null,
  artefactDir: '/w/skillspector',
  findings: [finding()],
  metrics: {},
  summary: '1 finding',
  ...over,
})

const stage = (toolRuns: ToolRunRecord[], outcome: StageResult['outcome']): StageResult => ({
  stage: 'security',
  outcome,
  verdict: toolRuns.some((t) => t.outcome === 'failed') ? 'failed' : 'passed',
  toolRuns,
})

let seq = 0
const input = (stages: StageResult[]): RunRecordInput => ({
  skill: SKILL,
  runId: `run-${++seq}`,
  trigger: 'cli',
  startedAt: '2026-08-01T00:00:00Z',
  endedAt: '2026-08-01T00:00:10Z',
  outcome: stages[0]?.outcome ?? 'passed',
  skillDigest: 'sha256:abc',
  git: { commit: null, dirty: false },
  provenanceJson: '{}',
  toolLockJson: '{}',
  sidecarPath: '/w',
  stages,
})

const FP = fingerprint(SKILL.id, 'declawed/scripts/scan.py', 'unsafe-script')

const stateOf = (ledger: Ledger, fp = FP): string | undefined =>
  (ledger.db.prepare('select state from issues where fingerprint = ?').get(fp) as
    | { state: string }
    | undefined)?.state

const detectionCount = (ledger: Ledger, fp = FP): number =>
  (ledger.db
    .prepare('select count(*) as n from issue_detections where issue_fp = ?')
    .get(fp) as { n: number }).n

let ledger: Ledger

beforeEach(() => {
  ledger = openLedger(':memory:')
  seq = 0
})

describe('recordRun', () => {
  it('opens an issue on first detection', () => {
    const delta = recordRun(ledger, input([stage([toolRun()], 'failed')]))
    expect(delta.opened).toBe(1)
    expect(stateOf(ledger)).toBe('open')
  })

  it('merges two tools reporting the same class and file into one issue', () => {
    const other = toolRun({ toolId: 'skill-scanner', findings: [finding({ nativeRuleId: 'C14' })] })
    recordRun(ledger, input([stage([toolRun(), other], 'failed')]))
    expect(
      (ledger.db.prepare('select count(*) as n from issues').get() as { n: number }).n,
    ).toBe(1)
    expect(detectionCount(ledger)).toBe(2)
  })

  it('gives each occurrence from one tool its own ordinal', () => {
    const run = toolRun({ findings: [finding({ line: 10 }), finding({ line: 99 })] })
    recordRun(ledger, input([stage([run], 'failed')]))
    expect(detectionCount(ledger)).toBe(2)
    const ordinals = ledger.db
      .prepare('select ordinal from issue_detections where issue_fp = ? order by ordinal')
      .all(FP)
      .map((r) => (r as { ordinal: number }).ordinal)
    expect(ordinals).toEqual([0, 1])
  })

  it('records the occurrence count on the issue', () => {
    const run = toolRun({ findings: [finding({ line: 10 }), finding({ line: 99 })] })
    recordRun(ledger, input([stage([run], 'failed')]))
    const row = ledger.db
      .prepare('select occurrence_count as n from issues where fingerprint = ?')
      .get(FP) as { n: number }
    expect(row.n).toBe(2)
  })

  it('keeps the strongest severity seen', () => {
    recordRun(ledger, input([stage([toolRun({ findings: [finding({ severity: 'low' })] })], 'failed')]))
    recordRun(ledger, input([stage([toolRun({ findings: [finding({ severity: 'critical' })] })], 'failed')]))
    const row = ledger.db
      .prepare('select severity_max from issues where fingerprint = ?')
      .get(FP) as { severity_max: string }
    expect(row.severity_max).toBe('critical')
  })
})

const clean = (outcome: ToolOutcome = 'passed'): StageResult =>
  stage([toolRun({ outcome, findings: [] })], outcome === 'passed' ? 'passed' : 'errored')

describe('reconciliation', () => {
  it('closes an issue the same tool no longer reports', () => {
    recordRun(ledger, input([stage([toolRun()], 'failed')]))
    const delta = recordRun(ledger, input([clean('passed')]))
    expect(stateOf(ledger)).toBe('fixed')
    expect(delta.closed).toBe(1)
  })

  it('closes nothing when the tool errored', () => {
    recordRun(ledger, input([stage([toolRun()], 'failed')]))
    const delta = recordRun(ledger, input([clean('errored')]))
    expect(stateOf(ledger)).toBe('open')
    expect(delta.closed).toBe(0)
  })

  it('closes nothing when the tool was skipped', () => {
    recordRun(ledger, input([stage([toolRun()], 'failed')]))
    recordRun(ledger, input([stage([toolRun({ outcome: 'skipped', findings: [] })], 'skipped')]))
    expect(stateOf(ledger)).toBe('open')
  })

  it('closes an acknowledged issue', () => {
    recordRun(ledger, input([stage([toolRun()], 'failed')]))
    ledger.db.prepare(`update issues set state = 'acknowledged' where fingerprint = ?`).run(FP)
    recordRun(ledger, input([clean('passed')]))
    expect(stateOf(ledger)).toBe('fixed')
  })

  it('never closes a wontfix issue', () => {
    recordRun(ledger, input([stage([toolRun()], 'failed')]))
    ledger.db.prepare(`update issues set state = 'wontfix' where fingerprint = ?`).run(FP)
    recordRun(ledger, input([clean('passed')]))
    expect(stateOf(ledger)).toBe('wontfix')
  })

  it('reopens a fixed issue that comes back', () => {
    recordRun(ledger, input([stage([toolRun()], 'failed')]))
    recordRun(ledger, input([clean('passed')]))
    const delta = recordRun(ledger, input([stage([toolRun()], 'failed')]))
    expect(stateOf(ledger)).toBe('open')
    expect(delta.reopened).toBe(1)
  })

  it('closes an unmapped issue for the tool that raised it', () => {
    const unmapped = finding({ ruleClass: 'unmapped:skillspector:ZZ9', nativeRuleId: 'ZZ9' })
    const fp = fingerprint(SKILL.id, unmapped.path, unmapped.ruleClass)
    recordRun(ledger, input([stage([toolRun({ findings: [unmapped] })], 'failed')]))
    expect(stateOf(ledger, fp)).toBe('open')
    recordRun(ledger, input([clean('passed')]))
    expect(stateOf(ledger, fp)).toBe('fixed')
  })

  it('does not let one tool close another tool unmapped issue', () => {
    const unmapped = finding({ ruleClass: 'unmapped:skill-scanner:ZZ9', nativeRuleId: 'ZZ9' })
    const fp = fingerprint(SKILL.id, unmapped.path, unmapped.ruleClass)
    recordRun(
      ledger,
      input([stage([toolRun({ toolId: 'skill-scanner', findings: [unmapped] })], 'failed')]),
    )
    recordRun(ledger, input([clean('passed')])) // skillspector runs clean
    expect(stateOf(ledger, fp)).toBe('open')
  })

  it('does not let a tool close an issue outside its detects list', () => {
    const evalFinding = finding({ ruleClass: 'eval-failure', nativeRuleId: 'E1' })
    const fp = fingerprint(SKILL.id, evalFinding.path, 'eval-failure')
    recordRun(
      ledger,
      input([stage([toolRun({ toolId: 'skill-up', findings: [evalFinding] })], 'failed')]),
    )
    recordRun(ledger, input([clean('passed')])) // skillspector cannot detect eval-failure
    expect(stateOf(ledger, fp)).toBe('open')
  })
})

/**
 * Detector ownership. One issue, two scanners, and closure must not depend on
 * which of them finished first — which is exactly what revision 2's
 * most-recent-detector rule could not promise.
 */
describe('conjunctive closure across detectors', () => {
  const both = (findings: RawFinding[]): StageResult =>
    stage(
      [
        toolRun({ toolId: 'skillspector', findings, outcome: findings.length ? 'failed' : 'passed' }),
        toolRun({ toolId: 'skill-scanner', findings, outcome: findings.length ? 'failed' : 'passed' }),
      ],
      findings.length ? 'failed' : 'passed',
    )

  const mixed = (present: string, absentOutcome: ToolOutcome): StageResult =>
    stage(
      [
        toolRun({ toolId: present, findings: [], outcome: 'passed' }),
        toolRun({
          toolId: present === 'skillspector' ? 'skill-scanner' : 'skillspector',
          findings: [],
          outcome: absentOutcome,
        }),
      ],
      'degraded',
    )

  beforeEach(() => {
    recordRun(ledger, input([both([finding()])]))
    expect(stateOf(ledger)).toBe('open')
  })

  it('stays open when one detector is absent and the other errored', () => {
    recordRun(ledger, input([mixed('skillspector', 'errored')]))
    expect(stateOf(ledger)).toBe('open')
  })

  it('stays open when one detector is absent and the other was skipped', () => {
    recordRun(ledger, input([mixed('skillspector', 'skipped')]))
    expect(stateOf(ledger)).toBe('open')
  })

  it('closes only once both detectors are conclusively absent', () => {
    recordRun(ledger, input([mixed('skillspector', 'errored')]))
    expect(stateOf(ledger)).toBe('open')
    const delta = recordRun(ledger, input([both([])]))
    expect(stateOf(ledger)).toBe('fixed')
    expect(delta.closed).toBe(1)
  })

  it('reaches the same state whichever detector clears first', () => {
    const other = openLedger(':memory:')
    recordRun(other, input([both([finding()])]))

    recordRun(ledger, input([mixed('skillspector', 'errored')]))
    recordRun(ledger, input([both([])]))

    recordRun(other, input([mixed('skill-scanner', 'errored')]))
    recordRun(other, input([both([])]))

    expect(stateOf(ledger)).toBe(stateOf(other))
    other.close()
  })

  it('widens scope to a class the manifest never declared', () => {
    // skillspector does not declare eval-failure, but if it produced one it
    // must be able to retract it.
    const stray = finding({ ruleClass: 'eval-failure', nativeRuleId: 'E1' })
    const fp = fingerprint(SKILL.id, stray.path, 'eval-failure')
    recordRun(ledger, input([stage([toolRun({ findings: [stray] })], 'failed')]))
    expect(stateOf(ledger, fp)).toBe('open')
    recordRun(ledger, input([clean('passed')]))
    expect(stateOf(ledger, fp)).toBe('fixed')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/core/issues.test.ts tests/core/reconcile.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the state machine**

`src/core/ledger/issues.ts`:

```ts
import type { Severity } from '../types.js'

export type IssueState = 'open' | 'acknowledged' | 'wontfix' | 'fixed'

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
}

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b
}

/** State after the issue is detected again in a later run. */
export function stateOnDetection(current: IssueState): IssueState {
  // A fixed issue that comes back reopens. wontfix stays suppressed.
  return current === 'fixed' ? 'open' : current
}

/**
 * State after a competent tool run does not report the issue.
 * `null` means leave it alone: wontfix is never auto-closed, and a fixed
 * issue is already closed.
 */
export function stateOnAbsence(current: IssueState): IssueState | null {
  return current === 'open' || current === 'acknowledged' ? 'fixed' : null
}
```

- [ ] **Step 4: Write reconciliation and the run transaction**

`src/core/ledger/reconcile.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite'
import { getAdapter } from '../adapters/registry.js'
import type { ToolOutcome } from '../types.js'
import { type IssueState, stateOnAbsence } from './issues.js'

export interface ReconcileToolRun {
  toolRunId: number
  toolId: string
  outcome: ToolOutcome
  /** Fingerprints this tool run reported. */
  reported: ReadonlySet<string>
}

interface CandidateRow {
  fingerprint: string
  state: IssueState
}

/**
 * A tool's reconciliation scope. `detects` is a declaration and declarations go
 * stale, so it is unioned with every class this tool has actually produced for
 * this skill. Revision 2 unioned only `unmapped:` classes, which left a merely
 * incomplete `detects` just as unclosable.
 */
function scopeFor(db: DatabaseSync, skillId: string, toolId: string): Set<string> {
  const declared = getAdapter(toolId)?.manifest.detects ?? []
  const produced = db
    .prepare(
      `select distinct i.rule_class as rule_class
         from issues i
         join issue_detectors d on d.issue_fp = i.fingerprint
        where i.skill_id = ? and d.tool_id = ?`,
    )
    .all(skillId, toolId) as Array<{ rule_class: string }>
  return new Set<string>([...declared, ...produced.map((r) => r.rule_class)])
}

/**
 * Two phases: each conclusive tool records what it did and did not see, then an
 * issue closes only when every tool that has ever detected it agrees it is gone.
 *
 * Closure is a conjunction over a set, and a set has no order — which is the
 * point. Revision 2 asked which tool detected an issue "most recently", but
 * fan-out tools run concurrently, so two detections from one run had no defined
 * order and completion timing decided whether the issue closed.
 *
 * Tool runs that errored or were skipped are excluded from both phases, which
 * is what stops a crashed scanner from marking everything it ever found as fixed.
 */
export function reconcile(
  db: DatabaseSync,
  skillId: string,
  runId: string,
  toolRuns: readonly ReconcileToolRun[],
): number {
  // Phase 1: per-tool evidence.
  for (const toolRun of toolRuns) {
    if (toolRun.outcome !== 'passed' && toolRun.outcome !== 'failed') continue

    for (const fp of toolRun.reported) {
      db.prepare(
        `insert into issue_detectors (issue_fp, tool_id, last_seen_run)
              values (?, ?, ?)
         on conflict(issue_fp, tool_id) do update set last_seen_run = excluded.last_seen_run`,
      ).run(fp, toolRun.toolId, runId)
    }

    const scope = scopeFor(db, skillId, toolRun.toolId)
    if (scope.size === 0) continue
    const placeholders = [...scope].map(() => '?').join(',')

    const known = db
      .prepare(
        `select i.fingerprint as fingerprint
           from issues i
           join issue_detectors d on d.issue_fp = i.fingerprint and d.tool_id = ?
          where i.skill_id = ? and i.rule_class in (${placeholders})`,
      )
      .all(toolRun.toolId, skillId, ...([...scope] as never[])) as Array<{ fingerprint: string }>

    for (const row of known) {
      if (toolRun.reported.has(row.fingerprint)) continue
      db.prepare(
        `update issue_detectors set last_absent_run = ? where issue_fp = ? and tool_id = ?`,
      ).run(runId, row.fingerprint, toolRun.toolId)
    }
  }

  // Phase 2: close only where every detector agrees.
  let closed = 0
  const candidates = db
    .prepare(
      `select fingerprint, state from issues
        where skill_id = ? and state in ('open', 'acknowledged')`,
    )
    .all(skillId) as CandidateRow[]

  for (const candidate of candidates) {
    const detectors = db
      .prepare(
        `select last_seen_run, last_absent_run from issue_detectors where issue_fp = ?`,
      )
      .all(candidate.fingerprint) as Array<{
      last_seen_run: string | null
      last_absent_run: string | null
    }>
    if (detectors.length === 0) continue

    // Run ids are UUIDv7, so lexical order is claim order.
    const allAbsent = detectors.every(
      (d) => d.last_absent_run !== null && (d.last_seen_run === null || d.last_absent_run > d.last_seen_run),
    )
    if (!allAbsent) continue

    const next = stateOnAbsence(candidate.state)
    if (!next) continue
    db.prepare(
      `update issues set state = ?, closed_run = ?, reopened_run = null where fingerprint = ?`,
    ).run(next, runId, candidate.fingerprint)
    closed += 1
  }

  return closed
}
```

`src/core/ledger/record.ts`:

```ts
import type { StageResult } from '../stages/types.js'
import type { SkillRef } from '../types.js'
import type { Ledger } from './db.js'
import { fingerprint } from './fingerprint.js'
import { type IssueState, maxSeverity, stateOnDetection } from './issues.js'
import { type ReconcileToolRun, reconcile } from './reconcile.js'

export interface RunRecordInput {
  skill: SkillRef
  runId: string
  trigger: string
  startedAt: string
  endedAt: string
  outcome: string
  skillDigest: string
  git: { commit: string | null; dirty: boolean }
  provenanceJson: string
  toolLockJson: string
  sidecarPath: string
  stages: readonly StageResult[]
}

export interface RunDelta {
  opened: number
  closed: number
  reopened: number
}

export function recordRun(ledger: Ledger, input: RunRecordInput): RunDelta {
  const { db } = ledger
  const { skill } = input
  const delta: RunDelta = { opened: 0, closed: 0, reopened: 0 }

  db.exec('begin')
  try {
    db.prepare(
      `insert into repos (id, path, name, is_git) values (?, ?, ?, ?)
       on conflict(id) do update set path = excluded.path, name = excluded.name`,
    ).run(skill.repo.id, skill.repo.path, skill.repo.name, skill.repo.isGit ? 1 : 0)

    db.prepare(
      `insert into skills (id, repo_id, name, rel_path, current_version, lifecycle_state)
       values (?, ?, ?, ?, ?, 'active')
       on conflict(id) do update set
         name = excluded.name,
         current_version = excluded.current_version,
         last_seen = datetime('now')`,
    ).run(skill.id, skill.repo.id, skill.name, skill.relPath, skill.version)

    db.prepare(
      `insert into runs (id, skill_id, trigger, started_at, ended_at, outcome,
                         skill_digest, git_commit, git_dirty,
                         provenance_json, tool_lock_json, sidecar_path)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.runId,
      skill.id,
      input.trigger,
      input.startedAt,
      input.endedAt,
      input.outcome,
      input.skillDigest,
      input.git.commit,
      input.git.dirty ? 1 : 0,
      input.provenanceJson,
      input.toolLockJson,
      input.sidecarPath,
    )

    const reconcileInput: ReconcileToolRun[] = []

    for (const stage of input.stages) {
      db.prepare(
        `insert into stages (run_id, stage, outcome, verdict, started_at, ended_at, metrics_json)
         values (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.runId,
        stage.stage,
        stage.outcome,
        stage.verdict,
        input.startedAt,
        input.endedAt,
        '{}',
      )
      const stageId = (db.prepare('select last_insert_rowid() as id').get() as { id: number }).id

      for (const run of stage.toolRuns) {
        db.prepare(
          `insert into tool_runs (stage_id, tool_id, tool_version, outcome,
                                  exit_code, duration_ms, artefact_dir, error_kind)
           values (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          stageId,
          run.toolId,
          run.toolVersion,
          run.outcome,
          run.exitCode,
          run.durationMs,
          run.artefactDir,
          run.errorKind,
        )
        const toolRunId = (db.prepare('select last_insert_rowid() as id').get() as { id: number })
          .id

        const reported = new Set<string>()
        const ordinalByFp = new Map<string, number>()

        for (const finding of run.findings) {
          const fp = fingerprint(skill.id, finding.path, finding.ruleClass)
          reported.add(fp)

          const existing = db
            .prepare('select state, severity_max from issues where fingerprint = ?')
            .get(fp) as { state: IssueState; severity_max: string } | undefined

          if (!existing) {
            db.prepare(
              `insert into issues (fingerprint, skill_id, rule_class, rel_path,
                                   severity_max, state, occurrence_count,
                                   first_seen_run, last_seen_run)
               values (?, ?, ?, ?, ?, 'open', 0, ?, ?)`,
            ).run(
              fp,
              skill.id,
              finding.ruleClass,
              finding.path,
              finding.severity,
              input.runId,
              input.runId,
            )
            delta.opened += 1
          } else {
            const next = stateOnDetection(existing.state)
            if (existing.state === 'fixed' && next === 'open') delta.reopened += 1
            db.prepare(
              `update issues set state = ?, last_seen_run = ?, severity_max = ?,
                                 closed_run = case when ? = 'open' then null else closed_run end,
                                 reopened_run = case when ? = 1 then ? else reopened_run end
               where fingerprint = ?`,
            ).run(
              next,
              input.runId,
              maxSeverity(
                existing.severity_max as never,
                finding.severity,
              ),
              next,
              existing.state === 'fixed' ? 1 : 0,
              input.runId,
              fp,
            )
          }

          const ordinal = ordinalByFp.get(fp) ?? 0
          ordinalByFp.set(fp, ordinal + 1)

          db.prepare(
            `insert into issue_detections
               (issue_fp, tool_run_id, ordinal, native_rule_id, native_severity, line, message)
             values (?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            fp,
            toolRunId,
            ordinal,
            finding.nativeRuleId,
            finding.severity,
            finding.line ?? null,
            finding.message,
          )
        }

        for (const [fp, count] of ordinalByFp) {
          db.prepare('update issues set occurrence_count = ? where fingerprint = ?').run(count, fp)
        }

        reconcileInput.push({
          toolRunId,
          toolId: run.toolId,
          outcome: run.outcome,
          reported,
        })
      }
    }

    delta.closed = reconcile(db, skill.id, input.runId, reconcileInput)
    db.exec('commit')
  } catch (err) {
    db.exec('rollback')
    throw err
  }

  return delta
}
```

The reconcile tests reference `skill-scanner` and `skill-up`, which have no adapter in M1. `getAdapter` returns undefined for them, so their `detects` list is empty and only their own `unmapped:` classes are in scope. That is the correct behaviour and the tests assert it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/core/issues.test.ts tests/core/reconcile.test.ts`
Expected: PASS, twenty-five cases. The errored-tool, skipped-tool and detector-ownership cases together are the R8.8 acceptance check; "reaches the same state whichever detector clears first" is the one that would have failed under revision 2.

- [ ] **Step 6: Commit**

```bash
git add src/core/ledger tests/core/issues.test.ts tests/core/reconcile.test.ts
git commit -m "feat(ledger): add issue transitions, scoped reconciliation and the run transaction"
```

---

### Task 18: Pipeline, event stream and run handle

**Files:**
- Create: `src/core/pipeline/events.ts`, `src/core/pipeline/queue.ts`, `src/core/pipeline/run.ts`
- Modify: `src/core/index.ts`
- Test: `tests/core/pipeline.test.ts`

**Interfaces:**
- Consumes: `AdapterStageExecutor` (Task 14), workspace writer (Task 15), `recordRun` (Task 17), `digestSkill`/`gitState` (Task 5), `haltsChain` (Task 13).
- Produces: `RunEvent`, `AsyncEventQueue`, `RunHandle`, `runPipeline(input): RunHandle`, `RunSummary`.

M1 emits no `mutation:pending`, because no mutating stage exists yet. The handle still carries `resolveMutation` so M5 adds a stage rather than reshaping the API every consumer is written against.

- [ ] **Step 1: Write the failing test**

`tests/core/pipeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLedger } from '../../src/core/ledger/db.js'
import { runPipeline } from '../../src/core/pipeline/run.js'
import type { RunEvent } from '../../src/core/pipeline/events.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'
import { makeFakeTool } from '../helpers/fake-tool.js'

const SARIF = (results: unknown[]): string =>
  JSON.stringify({
    version: '2.1.0',
    runs: [{ tool: { driver: { name: 'skillspector', version: '2.5.1' } }, results }],
  })

const FINDING = {
  ruleId: 'LP3',
  message: { text: 'no declared permissions' },
  level: 'warning',
  locations: [
    { physicalLocation: { artifactLocation: { uri: 'SKILL.md' }, region: { startLine: 1 } } },
  ],
}

async function setup(sarifBody: string) {
  const repoPath = await makeRepo({ files: { 'declawed/SKILL.md': SKILL_MD('declawed', '1.1.0') } })
  const repo = { id: 'fx', path: repoPath, name: 'fx', isGit: false }
  const [skill] = await discoverSkills(repo)
  const bin = await makeFakeTool('skillspector', `printf '%s' '${sarifBody}' > "$7"`)
  return {
    skill: skill!,
    ledger: openLedger(':memory:'),
    input: {
      skill: skill!,
      stages: ['security'] as const,
      trigger: 'cli',
      stageTools: { security: ['skillspector'] },
      lock: {
        version: 1 as const,
        tools: {
          skillspector: {
            installKind: 'uv-tool' as const,
            requestedPin: 'v2.5.1',
            resolvedVersion: '2.5.1',
            bin,
            integrity: 'n/a',
            installedAt: '2026-08-01T00:00:00Z',
            verifiedAt: '2026-08-01T00:00:00Z',
          },
        },
      },
      env: {},
      secrets: [],
      provenance: { baseUrlHost: null, models: {}, authTokenHash: null },
      artefactSizeCapBytes: 1024 * 1024,
      timeoutOverridesMs: {},
    },
  }
}

const drain = async (events: AsyncIterable<RunEvent>): Promise<RunEvent[]> => {
  const seen: RunEvent[] = []
  for await (const event of events) seen.push(event)
  return seen
}

describe('runPipeline', () => {
  it('emits the full event sequence for a passing stage', async () => {
    const { ledger, input } = await setup(SARIF([]))
    const handle = runPipeline({ ...input, ledger })
    const events = await drain(handle.events)
    const summary = await handle.done
    expect(events.map((e) => e.type)).toEqual([
      'run:start',
      'stage:start',
      'tool:start',
      'tool:done',
      'stage:done',
      'run:done',
    ])
    expect(summary.outcome).toBe('passed')
    ledger.close()
  })

  it('writes run.json with the digest and provenance', async () => {
    const { ledger, input } = await setup(SARIF([]))
    const handle = runPipeline({ ...input, ledger })
    await drain(handle.events)
    const summary = await handle.done
    const doc = JSON.parse(await readFile(join(summary.runDir, 'run.json'), 'utf8'))
    expect(doc.skillDigest).toMatch(/^sha256:/)
    expect(doc.provenance).toBeDefined()
    expect(doc.toolLock.skillspector).toBe('2.5.1')
    ledger.close()
  })

  it('writes a per-tool artefact directory and one stage.json', async () => {
    const { ledger, input } = await setup(SARIF([FINDING]))
    const handle = runPipeline({ ...input, ledger })
    await drain(handle.events)
    const summary = await handle.done
    const stageDir = join(summary.runDir, '03-security')
    expect(JSON.parse(await readFile(join(stageDir, 'stage.json'), 'utf8')).outcome).toBe('failed')
    expect(
      (await readFile(join(stageDir, 'skillspector', 'findings.sarif'), 'utf8')).length,
    ).toBeGreaterThan(0)
    ledger.close()
  })

  it('records the run and the issue in the ledger', async () => {
    const { ledger, input } = await setup(SARIF([FINDING]))
    await drain(runPipeline({ ...input, ledger }).events)
    const runs = ledger.db.prepare('select count(*) as n from runs').get() as { n: number }
    const issues = ledger.db.prepare('select count(*) as n from issues').get() as { n: number }
    expect(runs.n).toBe(1)
    expect(issues.n).toBe(1)
    ledger.close()
  })

  it('appends to the index and moves latest', async () => {
    const { ledger, input, skill } = await setup(SARIF([]))
    await drain(runPipeline({ ...input, ledger }).events)
    const index = await readFile(
      join(skill.workspacePath, 'skillgantry/runs/index.ndjson'),
      'utf8',
    )
    expect(index.trim().split('\n')).toHaveLength(1)
    ledger.close()
  })

  it('adds the workspace patterns to the repo gitignore', async () => {
    const { ledger, input, skill } = await setup(SARIF([]))
    await drain(runPipeline({ ...input, ledger }).events)
    const body = await readFile(join(skill.repo.path, '.gitignore'), 'utf8')
    expect(body).toContain('*-workspace/')
    ledger.close()
  })

  it('halts the chain on a stage that does not pass', async () => {
    const { ledger, input } = await setup(SARIF([FINDING]))
    const handle = runPipeline({ ...input, ledger, stages: ['security', 'validate'] as const })
    const events = await drain(handle.events)
    expect(events.filter((e) => e.type === 'stage:start')).toHaveLength(1)
    expect((await handle.done).outcome).toBe('failed')
    ledger.close()
  })

  it('leaves the digest unchanged after a run writes its artefacts', async () => {
    const { ledger, input, skill } = await setup(SARIF([]))
    const first = runPipeline({ ...input, ledger })
    await drain(first.events)
    const a = (await first.done).skillDigest
    const second = runPipeline({ ...input, ledger })
    await drain(second.events)
    expect((await second.done).skillDigest).toBe(a)
    void skill
    ledger.close()
  })

  it('changes the digest after the skill is edited', async () => {
    const { ledger, input, skill } = await setup(SARIF([]))
    const first = runPipeline({ ...input, ledger })
    await drain(first.events)
    await writeFile(join(skill.dir, 'SKILL.md'), `${SKILL_MD('declawed', '1.1.0')}\nextra\n`)
    const second = runPipeline({ ...input, ledger })
    await drain(second.events)
    expect((await second.done).skillDigest).not.toBe((await first.done).skillDigest)
    ledger.close()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/pipeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the event queue and event types**

`src/core/pipeline/events.ts`:

```ts
import type { StageResult, ToolRunRecord } from '../stages/types.js'
import type { Stage, StageOutcome } from '../types.js'

export type RunEvent =
  | { type: 'run:start'; runId: string; skillId: string; stages: readonly Stage[]; runDir: string }
  | { type: 'stage:start'; runId: string; stage: Stage; toolIds: readonly string[] }
  | { type: 'tool:start'; runId: string; stage: Stage; toolId: string }
  | { type: 'tool:output'; runId: string; stage: Stage; toolId: string; stream: 'stdout' | 'stderr'; chunk: string }
  | { type: 'tool:done'; runId: string; stage: Stage; toolId: string; result: ToolRunRecord }
  | { type: 'stage:done'; runId: string; stage: Stage; outcome: StageOutcome; result: StageResult }
  | { type: 'mutation:pending'; runId: string; stage: Stage; requestId: string; diff: string }
  | { type: 'mutation:resolved'; runId: string; stage: Stage; requestId: string; action: 'apply' | 'discard' }
  | { type: 'run:done'; runId: string; outcome: StageOutcome; opened: number; closed: number; reopened: number }
  | { type: 'run:cancelled'; runId: string; reason: string }
  | { type: 'run:error'; runId: string; message: string }
```

`src/core/pipeline/queue.ts`:

```ts
/** Single-producer, single-consumer async queue backing the event stream. */
export class AsyncEventQueue<T> {
  #buffer: T[] = []
  #resolvers: Array<(value: IteratorResult<T>) => void> = []
  #closed = false

  push(value: T): void {
    if (this.#closed) return
    const resolve = this.#resolvers.shift()
    if (resolve) resolve({ value, done: false })
    else this.#buffer.push(value)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const resolve of this.#resolvers) resolve({ value: undefined as never, done: true })
    this.#resolvers = []
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async (): Promise<IteratorResult<T>> => {
        const buffered = this.#buffer.shift()
        if (buffered !== undefined) return { value: buffered, done: false }
        if (this.#closed) return { value: undefined as never, done: true }
        return new Promise((resolve) => this.#resolvers.push(resolve))
      },
    }
  }
}
```

- [ ] **Step 4: Write the pipeline**

`src/core/pipeline/run.ts`:

```ts
import type { ToolLock } from '../config/schema.js'
import { type Provenance, withAnalysisModes } from '../config/env.js'
import { getAdapter } from '../adapters/registry.js'
import { gitState, digestSkill } from '../discovery/digest.js'
import type { Ledger } from '../ledger/db.js'
import { recordRun } from '../ledger/record.js'
import { AdapterStageExecutor } from '../stages/adapter-stage.js'
import { haltsChain } from '../stages/outcome.js'
import type { StageContext, StageResult } from '../stages/types.js'
import type { SkillRef, Stage, StageOutcome } from '../types.js'
import { STAGE_ORDER } from '../workspace/layout.js'
import {
  claimRunDir,
  ensureGitignore,
  finalizeRun,
  stageDirFor,
  writeRunJson,
  writeStageJson,
} from '../workspace/writer.js'
import type { RunEvent } from './events.js'
import { AsyncEventQueue } from './queue.js'

export interface RunPipelineInput {
  skill: SkillRef
  stages: readonly Stage[]
  trigger: string
  stageTools: Readonly<Partial<Record<Stage, readonly string[]>>>
  lock: ToolLock
  ledger: Ledger
  env: NodeJS.ProcessEnv
  secrets: readonly string[]
  provenance: Provenance
  artefactSizeCapBytes: number
  timeoutOverridesMs: Readonly<Record<string, number>>
}

export interface RunSummary {
  runId: string
  runDir: string
  outcome: StageOutcome
  skillDigest: string
  stages: StageResult[]
  opened: number
  closed: number
  reopened: number
}

export interface RunHandle {
  runId: Promise<string>
  events: AsyncIterable<RunEvent>
  resolveMutation(requestId: string, action: 'apply' | 'discard'): void
  cancel(reason?: string): void
  done: Promise<RunSummary>
}

const nowIso = (): string => new Date().toISOString()

export function runPipeline(input: RunPipelineInput): RunHandle {
  const queue = new AsyncEventQueue<RunEvent>()
  const controller = new AbortController()
  const pendingMutations = new Map<string, (action: 'apply' | 'discard') => void>()

  let resolveRunId: (id: string) => void = () => undefined
  const runId: Promise<string> = new Promise((resolve) => {
    resolveRunId = resolve
  })

  const done = (async (): Promise<RunSummary> => {
    const startedAt = nowIso()
    const { runId: id, runDir } = await claimRunDir(input.skill.workspacePath)
    resolveRunId(id)

    // Order matters: R2.12. The gitignore write is itself a change to the repo,
    // so capturing the digest first would record one its own side effect
    // immediately invalidates.
    await ensureGitignore(input.skill.repo.path)
    const digest = await digestSkill(input.skill)
    const git = await gitState(input.skill.repo.path, input.skill.relPath)

    const toolLockVersions = Object.fromEntries(
      Object.entries(input.lock.tools).map(([toolId, entry]) => [toolId, entry.resolvedVersion]),
    )

    // A tool's analysis mode changes what its numbers mean, so it is recorded
    // beside the provider fingerprint that exists for the same reason (R4.2b).
    const analysisModes: Record<string, string> = {}
    for (const stage of input.stages) {
      for (const toolId of input.stageTools[stage] ?? []) {
        const adapter = getAdapter(toolId)
        if (adapter) analysisModes[toolId] = adapter.manifest.analysisMode
      }
    }

    await writeRunJson(runDir, {
      runId: id,
      skillId: input.skill.id,
      skillDigest: digest,
      git,
      provenance: withAnalysisModes(input.provenance, analysisModes),
      toolLock: toolLockVersions,
    })

    queue.push({ type: 'run:start', runId: id, skillId: input.skill.id, stages: input.stages, runDir })

    // Stages always run in lifecycle order regardless of the order requested.
    const ordered = STAGE_ORDER.filter((s) => input.stages.includes(s))
    const results: StageResult[] = []
    let outcome: StageOutcome = 'passed'

    for (const stage of ordered) {
      const executor = new AdapterStageExecutor(stage)
      const stageDir = stageDirFor(runDir, STAGE_ORDER.indexOf(stage) + 1, stage)

      const ctx: StageContext = {
        skill: input.skill,
        stage,
        stageDir,
        selectedToolIds: input.stageTools[stage] ?? [],
        lock: input.lock,
        env: input.env,
        secrets: input.secrets,
        artefactSizeCapBytes: input.artefactSizeCapBytes,
        timeoutOverridesMs: input.timeoutOverridesMs,
        onOutput: (toolId, stream, chunk) => {
          if (chunk.length > 0) {
            queue.push({ type: 'tool:output', runId: id, stage, toolId, stream, chunk })
          }
        },
        signal: controller.signal,
      }

      const plan = await executor.plan(ctx)
      queue.push({ type: 'stage:start', runId: id, stage, toolIds: plan.toolIds })
      for (const toolId of plan.toolIds) {
        queue.push({ type: 'tool:start', runId: id, stage, toolId })
      }

      const result = await executor.execute(ctx, plan)
      for (const toolRun of result.toolRuns) {
        queue.push({ type: 'tool:done', runId: id, stage, toolId: toolRun.toolId, result: toolRun })
      }

      const unredacted = Object.fromEntries(
        result.toolRuns.map((run) => [run.toolId, [...(run.findings.length >= 0 ? [] : [])]]),
      )
      await writeStageJson(stageDir, result, unredacted)

      results.push(result)
      queue.push({ type: 'stage:done', runId: id, stage, outcome: result.outcome, result })

      outcome = result.outcome
      if (haltsChain(result.outcome)) break
    }

    const endedAt = nowIso()
    await finalizeRun(input.skill.workspacePath, { runId: id, outcome, endedAt })

    const delta = recordRun(input.ledger, {
      skill: input.skill,
      runId: id,
      trigger: input.trigger,
      startedAt,
      endedAt,
      outcome,
      skillDigest: digest,
      git,
      provenanceJson: JSON.stringify(input.provenance),
      toolLockJson: JSON.stringify(toolLockVersions),
      sidecarPath: runDir,
      stages: results,
    })

    queue.push({ type: 'run:done', runId: id, outcome, ...delta })
    queue.close()

    return { runId: id, runDir, outcome, skillDigest: digest, stages: results, ...delta }
  })()

  done.catch((err: unknown) => {
    queue.push({ type: 'run:error', runId: 'unknown', message: (err as Error).message })
    queue.close()
  })

  return {
    runId,
    events: queue,
    resolveMutation: (requestId, action) => pendingMutations.get(requestId)?.(action),
    cancel: (reason = 'cancelled by caller') => {
      controller.abort()
      queue.push({ type: 'run:cancelled', runId: 'unknown', reason })
    },
    done,
  }
}
```

The `unredacted` map is empty in M1 because the only adapter declares no
`binaryArtefacts` and its SARIF is published as written. Task 20's acceptance
suite asserts `stage.json` still records `redacted: false` per tool run, which
is the R7.4a marker.

Add to `src/core/index.ts`:

```ts
export * from './types.js'
export * from './pipeline/events.js'
export { runPipeline, type RunHandle, type RunSummary } from './pipeline/run.js'
export { openLedger, type Ledger } from './ledger/db.js'
export { discoverSkills, workspacePath } from './discovery/discover.js'
export { loadConfig, loadToolLock, registerRepo, type GantryConfig } from './config/config.js'
export { loadEnvFile, provenanceOf } from './config/env.js'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tests/core/pipeline.test.ts`
Expected: PASS, nine cases.

- [ ] **Step 6: Commit**

```bash
git add src/core/pipeline src/core/index.ts tests/core/pipeline.test.ts
git commit -m "feat(pipeline): run stages over an event stream with a run handle"
```

---

### Task 19: Headless run command

**Files:**
- Create: `src/cli/run-command.ts`
- Modify: `src/cli/index.ts`
- Test: `tests/cli/run-command.test.ts`

**Interfaces:**
- Consumes: everything exported from `src/core/index.ts`.
- Produces: `buildProgram(deps)` returning a configured `Command`, and `resolveSkill(config, selector)`.

Exit code is zero only when every executed stage passed, which is R12.2. `--json` emits newline-delimited events so the stream is consumable by a pipe.

- [ ] **Step 1: Write the failing test**

`tests/cli/run-command.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram } from '../../src/cli/run-command.js'
import { registerRepo, saveToolLock } from '../../src/core/config/config.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'
import { makeFakeTool } from '../helpers/fake-tool.js'

const SARIF = (results: unknown[]): string =>
  JSON.stringify({
    version: '2.1.0',
    runs: [{ tool: { driver: { name: 'skillspector', version: '2.5.1' } }, results }],
  })

const FINDING = {
  ruleId: 'LP3',
  message: { text: 'no declared permissions' },
  level: 'warning',
  locations: [{ physicalLocation: { artifactLocation: { uri: 'SKILL.md' } } }],
}

async function harness(sarifBody: string) {
  const home = await mkdtemp(join(tmpdir(), 'sg-cli-home-'))
  const repoPath = await makeRepo({ files: { 'declawed/SKILL.md': SKILL_MD('declawed') } })
  await registerRepo(home, repoPath)
  const bin = await makeFakeTool('skillspector', `printf '%s' '${sarifBody}' > "$7"`)
  await saveToolLock(home, {
    version: 1,
    tools: {
      skillspector: {
        installKind: 'uv-tool',
        requestedPin: 'v2.5.1',
        resolvedVersion: '2.5.1',
        bin,
        integrity: 'n/a',
        installedAt: '2026-08-01T00:00:00Z',
        verifiedAt: '2026-08-01T00:00:00Z',
      },
    },
  })

  const out: string[] = []
  const program = buildProgram({
    home,
    dbPath: ':memory:',
    write: (line) => out.push(line),
  })
  return { program, out, home, repoPath }
}

const run = async (program: Awaited<ReturnType<typeof harness>>['program'], args: string[]) =>
  program.exitOverride().parseAsync(['node', 'skillgantry', ...args])

describe('skillgantry run', () => {
  it('exits zero when the stage passes', async () => {
    const h = await harness(SARIF([]))
    await run(h.program, ['run', 'declawed', '--stage', 'security'])
    expect(h.program.exitCode ?? 0).toBe(0)
  })

  it('reports a non-zero exit code when the stage fails', async () => {
    const h = await harness(SARIF([FINDING]))
    await run(h.program, ['run', 'declawed', '--stage', 'security'])
    expect(h.program.exitCode).toBe(1)
  })

  it('emits newline-delimited json events under --json', async () => {
    const h = await harness(SARIF([]))
    await run(h.program, ['run', 'declawed', '--stage', 'security', '--json'])
    const types = h.out.map((line) => JSON.parse(line).type)
    expect(types[0]).toBe('run:start')
    expect(types.at(-1)).toBe('run:done')
  })

  it('prints a human summary without --json', async () => {
    const h = await harness(SARIF([FINDING]))
    await run(h.program, ['run', 'declawed', '--stage', 'security'])
    expect(h.out.join('\n')).toMatch(/security\s+failed/)
  })

  it('resolves a bare skill name and a fully qualified id', async () => {
    const h = await harness(SARIF([]))
    await run(h.program, ['run', 'declawed', '--stage', 'security'])
    await run(h.program, ['run', 'declawed/declawed', '--stage', 'security'])
    expect(h.program.exitCode ?? 0).toBe(0)
  })

  it('fails clearly on an unknown skill', async () => {
    const h = await harness(SARIF([]))
    await expect(run(h.program, ['run', 'nope', '--stage', 'security'])).rejects.toThrow(
      /no skill matching/,
    )
  })

  it('fails clearly on an unknown stage', async () => {
    const h = await harness(SARIF([]))
    await expect(run(h.program, ['run', 'declawed', '--stage', 'nope'])).rejects.toThrow(
      /unknown stage/,
    )
  })

  it('skips a mutating stage without --yes', async () => {
    const h = await harness(SARIF([]))
    await run(h.program, ['run', 'declawed', '--stage', 'optimise', '--json'])
    const events = h.out.map((line) => JSON.parse(line))
    const stageDone = events.find((e) => e.type === 'stage:done')
    expect(stageDone?.outcome).toBe('skipped')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/cli/run-command.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/cli/run-command.ts`:

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { loadConfig, loadToolLock } from '../core/config/config.js'
import { loadEnvFile, provenanceOf } from '../core/config/env.js'
import { discoverSkills } from '../core/discovery/discover.js'
import { openLedger } from '../core/ledger/db.js'
import { runPipeline } from '../core/pipeline/run.js'
import type { GantryConfig } from '../core/config/schema.js'
import type { SkillRef, Stage } from '../core/types.js'

const STAGES: readonly Stage[] = ['validate', 'evaluate', 'security', 'optimise', 'release']
const MUTATING: ReadonlySet<Stage> = new Set(['optimise', 'release'])

export interface CliDeps {
  home: string
  dbPath: string
  write: (line: string) => void
}

export function defaultDeps(): CliDeps {
  const home = join(homedir(), '.skillgantry')
  return {
    home,
    dbPath: join(home, 'gantry.db'),
    // eslint-disable-next-line no-console
    write: (line) => console.log(line),
  }
}

/** Accepts `<repoId>/<name>` or a bare `<name>` when it is unambiguous. */
export async function resolveSkill(config: GantryConfig, selector: string): Promise<SkillRef> {
  const all: SkillRef[] = []
  for (const repo of config.repos) all.push(...(await discoverSkills(repo)))

  const exact = all.filter((s) => s.id === selector)
  if (exact.length === 1) return exact[0] as SkillRef

  const byName = all.filter((s) => s.id.split('/').at(-1) === selector)
  if (byName.length === 1) return byName[0] as SkillRef
  if (byName.length > 1) {
    throw new Error(`ambiguous skill "${selector}": ${byName.map((s) => s.id).join(', ')}`)
  }
  throw new Error(`no skill matching "${selector}"`)
}

function parseStages(raw: string): Stage[] {
  return raw.split(',').map((token) => {
    const stage = token.trim()
    if (!STAGES.includes(stage as Stage)) throw new Error(`unknown stage: ${stage}`)
    return stage as Stage
  })
}

export function buildProgram(deps: CliDeps): Command {
  const program = new Command()
  program.name('skillgantry').description('SkillOps orchestrator for skill maintainers')

  program
    .command('run')
    .argument('<skill>', 'skill id or bare name')
    .requiredOption('--stage <list>', 'comma-separated lifecycle stages')
    .option('--json', 'emit newline-delimited JSON events')
    .option('--yes', 'authorise mutating stages')
    .action(async (selector: string, opts: { stage: string; json?: boolean; yes?: boolean }) => {
      const requested = parseStages(opts.stage)
      const config = await loadConfig(deps.home)
      const skill = await resolveSkill(config, selector)
      const lock = await loadToolLock(deps.home)
      const env = await loadEnvFile(deps.home)

      for (const warning of env.warnings) deps.write(`warning: ${warning}`)

      // R12.4: a mutating stage is skipped unless authorised.
      const stages = requested.filter((s) => opts.yes || !MUTATING.has(s))
      const skippedStages = requested.filter((s) => !stages.includes(s))

      const ledger = openLedger(deps.dbPath)
      try {
        for (const stage of skippedStages) {
          const event = {
            type: 'stage:done',
            stage,
            outcome: 'skipped',
            reason: 'no-authorisation',
          }
          deps.write(opts.json ? JSON.stringify(event) : `${stage}  skipped (needs --yes)`)
        }

        if (stages.length === 0) {
          program.exitCode = 0
          return
        }

        const handle = runPipeline({
          skill,
          stages,
          trigger: 'cli',
          stageTools: config.stageTools,
          lock,
          ledger,
          env: { ...process.env, ...env.vars },
          secrets: env.secrets,
          provenance: provenanceOf(env.vars),
          artefactSizeCapBytes: config.artefactSizeCapBytes,
          timeoutOverridesMs: config.timeoutOverridesMs,
        })

        for await (const event of handle.events) {
          if (opts.json) {
            deps.write(JSON.stringify(event))
          } else if (event.type === 'stage:done') {
            deps.write(`${event.stage}  ${event.outcome}`)
          } else if (event.type === 'tool:done') {
            deps.write(`  ${event.toolId}: ${event.result.summary}`)
          }
        }

        const summary = await handle.done
        if (!opts.json) {
          deps.write(
            `run ${summary.runId}  ${summary.outcome}  ` +
              `+${summary.opened} open  -${summary.closed} fixed`,
          )
        }
        program.exitCode = summary.outcome === 'passed' ? 0 : 1
      } finally {
        ledger.close()
      }
    })

  return program
}
```

`src/cli/index.ts`:

```ts
#!/usr/bin/env node
import { buildProgram, defaultDeps } from './run-command.js'

const program = buildProgram(defaultDeps())
await program.parseAsync(process.argv)
process.exitCode = program.exitCode ?? 0
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/cli/run-command.test.ts`
Expected: PASS, eight cases.

- [ ] **Step 5: Commit**

```bash
git add src/cli tests/cli
git commit -m "feat(cli): add the headless run command with JSON output and exit codes"
```

---

### Task 20: M1 acceptance suite and packaging verification

**Files:**
- Create: `tests/acceptance/m1.test.ts`
- Create: `tests/acceptance/packaging.test.ts`
- Modify: `package.json` (add the `acceptance` script)
- Test: both files above

**Interfaces:**
- Consumes: the CLI from Task 19 and everything beneath it.
- Produces: `pnpm acceptance`, a single command that demonstrates every M1 exit criterion.

Each criterion in the requirements milestone table becomes one named test. A criterion that is not mechanically demonstrated here is not met.

- [ ] **Step 1: Write the acceptance test**

`tests/acceptance/m1.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildProgram } from '../../src/cli/run-command.js'
import { loadToolLock, registerRepo, saveToolLock } from '../../src/core/config/config.js'
import { installAndLock } from '../../src/core/tools/install.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'
import { makeFakeTool } from '../helpers/fake-tool.js'

const SECRET = 'sk-testtokenvalue000000000000000000'

const SARIF = (results: unknown[]): string =>
  JSON.stringify({
    version: '2.1.0',
    runs: [{ tool: { driver: { name: 'skillspector', version: '2.5.1' } }, results }],
  })

const FINDING = {
  ruleId: 'LP3',
  message: { text: 'no declared permissions' },
  level: 'warning',
  locations: [
    { physicalLocation: { artifactLocation: { uri: 'SKILL.md' }, region: { startLine: 1 } } },
  ],
}

interface Harness {
  home: string
  repoPath: string
  dbPath: string
  out: string[]
  exec(args: string[]): Promise<number>
}

async function harness(script: string, opts: { withEnv?: boolean } = {}): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), 'sg-acc-home-'))
  const repoPath = await makeRepo({
    files: {
      'declawed/SKILL.md': SKILL_MD('declawed', '1.1.0'),
      'declawed/scripts/scan.py': 'print("hi")\n',
    },
  })
  await registerRepo(home, repoPath)

  if (opts.withEnv) {
    await writeFile(join(home, '.env'), `ANTHROPIC_AUTH_TOKEN=${SECRET}\n`, { mode: 0o600 })
  }

  const bin = await makeFakeTool('skillspector', script)
  await saveToolLock(home, {
    version: 1,
    tools: {
      skillspector: {
        installKind: 'uv-tool',
        requestedPin: 'v2.5.1',
        resolvedVersion: '2.5.1',
        bin,
        integrity: 'n/a',
        installedAt: '2026-08-01T00:00:00Z',
        verifiedAt: '2026-08-01T00:00:00Z',
      },
    },
  })

  const dbPath = join(home, 'gantry.db')
  const out: string[] = []
  return {
    home,
    repoPath,
    dbPath,
    out,
    exec: async (args) => {
      const program = buildProgram({ home, dbPath, write: (l) => out.push(l) })
      await program.exitOverride().parseAsync(['node', 'skillgantry', ...args])
      return program.exitCode ?? 0
    },
  }
}

const runDirOf = async (repoPath: string, workspace = 'declawed-workspace'): Promise<string> => {
  const runs = join(repoPath, `${workspace}/skillgantry/runs`)
  const entries = await readdir(runs, { withFileTypes: true })
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
  return join(runs, dirs.at(-1) as string)
}

const runDigest = async (h: Harness): Promise<string> =>
  JSON.parse(await readFile(join(await runDirOf(h.repoPath), 'run.json'), 'utf8')).skillDigest

/** A single-skill repo, so its workspace lands inside the tree tools are given. */
async function rootSkillHarness(script: string): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), 'sg-acc-home-'))
  const repoPath = await makeRepo({ files: { 'SKILL.md': SKILL_MD('solo', '1.0.0') } })
  await registerRepo(home, repoPath)

  const bin = await makeFakeTool('skillspector', script)
  await saveToolLock(home, {
    version: 1,
    tools: {
      skillspector: {
        installKind: 'uv-tool',
        requestedPin: 'v2.5.1',
        resolvedVersion: '2.5.1',
        bin,
        integrity: 'n/a',
        installedAt: '2026-08-01T00:00:00Z',
        verifiedAt: '2026-08-01T00:00:00Z',
      },
    },
  })

  const dbPath = join(home, 'gantry.db')
  const out: string[] = []
  return {
    home,
    repoPath,
    dbPath,
    out,
    exec: async (args) => {
      const program = buildProgram({ home, dbPath, write: (l) => out.push(l) })
      await program.exitOverride().parseAsync(['node', 'skillgantry', ...args])
      return program.exitCode ?? 0
    },
  }
}

/** Path of the `.seen` listing the canary fixture tool wrote beside its report. */
const latestSeenFile = async (h: Harness): Promise<string> =>
  join(await runDirOf(h.repoPath, '.skillgantry-workspace'), '03-security/skillspector/findings.sarif.seen')

/** Like `harness`, but installs the real SkillSpector through the tool root. */
async function harnessWithManagedTool(): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), 'sg-acc-home-'))
  const repoPath = await makeRepo({
    files: {
      'declawed/SKILL.md': SKILL_MD('declawed', '1.1.0'),
      'declawed/scripts/scan.py': 'print("hi")\n',
    },
  })
  await registerRepo(home, repoPath)
  await installAndLock(
    home,
    { id: 'skillspector', kind: 'uv-tool', spec: 'git+https://github.com/NVIDIA/skillspector.git', pin: 'v2.5.1', binName: 'skillspector' },
    ['--version'],
  )

  const dbPath = join(home, 'gantry.db')
  const out: string[] = []
  return {
    home,
    repoPath,
    dbPath,
    out,
    exec: async (args) => {
      const program = buildProgram({ home, dbPath, write: (l) => out.push(l) })
      await program.exitOverride().parseAsync(['node', 'skillgantry', ...args])
      return program.exitCode ?? 0
    },
  }
}

async function walkFiles(dir: string, acc: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await walkFiles(path, acc)
    else if (entry.isFile()) acc.push(path)
  }
  return acc
}

describe('M1 exit criterion 1: a headless security run writes evidence and populates the ledger', () => {
  it('produces a complete run directory and ledger rows', async () => {
    const h = await harness(`printf '%s' '${SARIF([FINDING])}' > "$7"`)
    const code = await h.exec(['run', 'declawed', '--stage', 'security', '--json'])
    expect(code).toBe(1) // findings present, so the gate is red

    const runDir = await runDirOf(h.repoPath)
    const files = (await walkFiles(runDir)).map((f) => f.replace(`${runDir}/`, ''))
    expect(files).toContain('run.json')
    expect(files).toContain('03-security/stage.json')
    expect(files).toContain('03-security/skillspector/stdout.log')
    expect(files).toContain('03-security/skillspector/findings.sarif')

    const ledger = openLedger(h.dbPath)
    const counts = (table: string): number =>
      (ledger.db.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n
    expect(counts('runs')).toBe(1)
    expect(counts('stages')).toBe(1)
    expect(counts('tool_runs')).toBe(1)
    expect(counts('issues')).toBe(1)
    expect(counts('issue_detections')).toBe(1)
    ledger.close()

    const index = await readFile(
      join(h.repoPath, 'declawed-workspace/skillgantry/runs/index.ndjson'),
      'utf8',
    )
    expect(index.trim().split('\n')).toHaveLength(1)
  })
})

describe('M1 exit criterion 2: a whitespace-only edit changes no fingerprint', () => {
  it('keeps the same issue rather than opening a new one', async () => {
    const h = await harness(`printf '%s' '${SARIF([FINDING])}' > "$7"`)
    await h.exec(['run', 'declawed', '--stage', 'security'])

    const ledger = openLedger(h.dbPath)
    const before = ledger.db.prepare('select fingerprint from issues').all()
    ledger.close()

    const skillMd = join(h.repoPath, 'declawed/SKILL.md')
    await writeFile(skillMd, `${await readFile(skillMd, 'utf8')}\n\n\n`)
    await h.exec(['run', 'declawed', '--stage', 'security'])

    const after = openLedger(h.dbPath)
    const fingerprints = after.db.prepare('select fingerprint, state from issues').all()
    expect(fingerprints).toHaveLength(before.length)
    expect(fingerprints[0]).toMatchObject({ state: 'open' })
    after.close()
  })
})

describe('M1 exit criterion 3: an errored tool closes no issue', () => {
  it('leaves the issue open when the second run crashes', async () => {
    const h = await harness(`printf '%s' '${SARIF([FINDING])}' > "$7"`)
    await h.exec(['run', 'declawed', '--stage', 'security'])

    // Replace the tool with one that writes nothing and exits non-zero.
    const broken = await makeFakeTool('skillspector', 'echo boom >&2; exit 2')
    await saveToolLock(h.home, {
      version: 1,
      tools: {
        skillspector: {
          installKind: 'uv-tool',
          requestedPin: 'v2.5.1',
          resolvedVersion: '2.5.1',
          bin: broken,
          integrity: 'n/a',
          installedAt: '2026-08-01T00:00:00Z',
          verifiedAt: '2026-08-01T00:00:00Z',
        },
      },
    })
    await h.exec(['run', 'declawed', '--stage', 'security'])

    const ledger = openLedger(h.dbPath)
    const states = ledger.db
      .prepare('select state from issues')
      .all()
      .map((r) => (r as { state: string }).state)
    expect(states).toEqual(['open'])
    const toolRuns = ledger.db
      .prepare('select outcome, error_kind from tool_runs order by id')
      .all()
    expect(toolRuns.at(-1)).toMatchObject({ outcome: 'errored' })
    ledger.close()
  })
})

describe('M1 exit criterion 4: no secret reaches a log SkillGantry writes', () => {
  it('redacts streams and records that native artefacts are unredacted', async () => {
    const h = await harness(
      `printf 'TOKEN=%s\\n' "$ANTHROPIC_AUTH_TOKEN"; printf '%s' '${SARIF([])}' > "$7"`,
      { withEnv: true },
    )
    await h.exec(['run', 'declawed', '--stage', 'security'])

    const runDir = await runDirOf(h.repoPath)
    const logs = (await walkFiles(runDir)).filter((f) => f.endsWith('.log'))
    expect(logs.length).toBeGreaterThan(0)
    for (const log of logs) {
      expect(await readFile(log, 'utf8')).not.toContain(SECRET)
    }

    // R7.5: provenance carries a hash, never the token.
    const runJson = await readFile(join(runDir, 'run.json'), 'utf8')
    expect(runJson).not.toContain(SECRET)
    expect(runJson).toMatch(/"authTokenHash": "sha256:[0-9a-f]{8}"/)

    // R7.4a: unredacted native artefacts are flagged rather than silently trusted.
    const stageJson = JSON.parse(await readFile(join(runDir, '03-security/stage.json'), 'utf8'))
    expect(stageJson.toolRuns[0].redacted).toBe(false)
  })
})

describe('M1 exit criterion 5: a hanging process tree is killed', () => {
  it('terminates the tool and reports a timeout', async () => {
    const h = await harness('sleep 600')
    // A one-second override keeps the test fast.
    const configPath = join(h.home, 'config.json')
    const config = JSON.parse(await readFile(configPath, 'utf8'))
    config.timeoutOverridesMs = { skillspector: 1000 }
    await writeFile(configPath, JSON.stringify(config))

    const code = await h.exec(['run', 'declawed', '--stage', 'security', '--json'])
    expect(code).toBe(1)

    const ledger = openLedger(h.dbPath)
    expect(ledger.db.prepare('select error_kind from tool_runs').get()).toMatchObject({
      error_kind: 'timeout',
    })
    ledger.close()
  })
})

describe('M1 exit criterion 6: a directory named snapshot-pre is part of the skill', () => {
  it('changes the digest, so gate evidence cannot survive an edit inside it', async () => {
    const h = await harness(`printf '%s' '${SARIF([])}' > "$7"`)
    const notes = join(h.repoPath, 'declawed/snapshot-pre/notes.md')
    await mkdir(dirname(notes), { recursive: true })
    await writeFile(notes, 'one\n')

    await h.exec(['run', 'declawed', '--stage', 'security', '--json'])
    const before = await runDigest(h)

    await writeFile(notes, 'two\n')
    await h.exec(['run', 'declawed', '--stage', 'security', '--json'])
    expect(await runDigest(h)).not.toBe(before)
  })
})

describe('M1 exit criterion 7: a repo-root skill never exposes its own workspace', () => {
  it('keeps a canary in a prior artefact out of the tool input', async () => {
    // The fixture tool copies whatever it can see under its scan target into
    // its report, which is the behaviour a model-assisted scanner would have.
    const h = await rootSkillHarness('find "$2" -type f | tr "\\n" " " > "$7".seen; ' +
      `printf '%s' '${SARIF([])}' > "$7"`)

    const workspace = join(h.repoPath, '.skillgantry-workspace')
    await mkdir(workspace, { recursive: true })
    await writeFile(join(workspace, 'old-report.json'), 'CANARY-sk-000111222\n')

    await h.exec(['run', 'solo', '--stage', 'security', '--json'])

    const seen = await readFile(await latestSeenFile(h), 'utf8')
    expect(seen).not.toContain('.skillgantry-workspace')
    expect(seen).not.toContain('CANARY')
  })
})

describe('M1 exit criterion 8: the managed tool root drives a real scan', () => {
  it('installs skillspector, locks it, and runs it against a real skill', async () => {
    const h = await harnessWithManagedTool()
    const code = await h.exec(['run', 'declawed', '--stage', 'security', '--json'])
    expect([0, 1]).toContain(code)

    const lock = await loadToolLock(h.home)
    expect(lock.tools.skillspector?.bin.startsWith(join(h.home, 'tools'))).toBe(true)
    expect(lock.tools.skillspector?.resolvedVersion).toBe('2.5.1')

    const ledger = openLedger(h.dbPath)
    expect(ledger.db.prepare('select tool_version from tool_runs').get()).toMatchObject({
      tool_version: '2.5.1',
    })
    ledger.close()
  }, 300_000)
})
```

Criterion 8 is the one revision 1 of this plan could not express: every other test drives a fake executable, and without it nothing in M1 proves that the install driver, the lock and the runner agree. It runs under `pnpm test:integration` with the other network test.

- [ ] **Step 2: Write the packaging test**

`tests/acceptance/packaging.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

describe('M1 exit criterion 6: the packed artefact runs from a clean prefix', () => {
  it('builds, packs, installs and executes', async () => {
    const staging = await mkdtemp(join(tmpdir(), 'sg-pack-'))

    await run('pnpm', ['build'], { cwd: process.cwd() })
    await run('pnpm', ['pack', '--pack-destination', staging], { cwd: process.cwd() })

    const tarball = (await readdir(staging)).find((f) => f.endsWith('.tgz'))
    expect(tarball).toBeDefined()

    const prefix = await mkdtemp(join(tmpdir(), 'sg-prefix-'))
    await run('npm', ['install', '--prefix', prefix, join(staging, tarball as string)])

    const { stdout } = await run(join(prefix, 'node_modules/.bin/skillgantry'), ['--version'])
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
  }, 180_000)
})
```

- [ ] **Step 3: Run both to verify they fail**

Run: `pnpm vitest run tests/acceptance`
Expected: FAIL — `--version` is not registered on the program yet, and `pnpm acceptance` does not exist.

- [ ] **Step 4: Make them pass**

Add the version flag in `src/cli/run-command.ts`, immediately after `program.name(...)`:

```ts
program.version('0.1.0')
```

Add to `package.json` scripts:

```json
"acceptance": "vitest run tests/acceptance",
"check": "pnpm lint && pnpm build && pnpm test && pnpm acceptance"
```

- [ ] **Step 5: Run the full suite**

Run: `pnpm check`
Expected: lint clean, build clean, unit tests pass, all six acceptance criteria pass.

- [ ] **Step 6: Commit**

```bash
git add tests/acceptance package.json src/cli/run-command.ts
git commit -m "test: demonstrate every M1 exit criterion mechanically"
```

---

## Requirement coverage for M1

Every requirement M1 owns, and the task that satisfies it. A requirement with no task is a plan defect.

| Requirement | Task |
|---|---|
| R1.1 stages supported | 2 (types), 18 (sequencing) |
| R1.2 exclusions | Scope of M1; nothing implements a registry or telemetry |
| R1.3 stats from own runs only | 16, 17 (ledger is the only source) |
| R1.5 no token or cost metric | 2 (`METRIC_KEYS`, `coerceMetrics`), 16 (schema test) |
| R2.1 register repos | 6 |
| R2.2 direct-child discovery | 4 |
| R2.3 exclusions | 4 |
| R2.4 repo-root skill | 4 |
| R2.5 tolerate missing frontmatter | 3, 4 |
| R2.6 record git | 4, 5 |
| R2.7 canonicalise paths | 6 |
| R2.8 skill digest over the candidate manifest | 5, 18 |
| R2.9 candidate manifest is the sole authority | 5 |
| R2.10 symlink policy | 5 |
| R2.11 materialise a non-self-contained candidate | 5, 20 |
| R2.12 gitignore before digest | 18 |
| R3.1 managed isolated tool root | 6a |
| R3.2a uv relocation via UV_TOOL_DIR | 6a |
| R3.3 lock schema with resolved executable | 6, 6a |
| R3.4 verify by invocation | 6a |
| R4.1–R4.2 manifest and parse | 10, 12 |
| R4.2a structured credential requirement | 10, 14 |
| R4.2b declared analysis mode in provenance | 10, 12, 18 |
| R4.3 pure parsers | 10 (lint rule), 7 in Task 7 of the contract, 11, 12 |
| R4.4 shared SARIF parser | 11 |
| R4.5 adding a tool touches nothing else | 10 (registry), 14 |
| R4.9 per-tool artefact directories | 14, 15 |
| R4.10 selection before lockfile | 14 |
| R4.11 empty selection rejected | 14 |
| R4.12 oversize artefact | 9, 14 |
| R4.13 tool classification table | 9, 14 |
| R5.1 chain and halt | 13, 18 |
| R5.9 timeout and process-tree kill | 9, 20 |
| R5.11 total outcome reduction, verdict as a field | 13 |
| R6.1–R6.3 sidecar layout | 15, 18 |
| R6.4 index.ndjson durability and reader recovery | 15 |
| R6.5 leave iteration-N alone | 15 (writes only under `skillgantry/`) |
| R6.6 gitignore both patterns | 15, 18 |
| R6.8 workspace path both layouts | 4, 15 |
| R7.1–R7.2 env load and mode warning | 7 |
| R7.3 inject, never persist | 9, 19 |
| R7.4 stream redaction | 8, 9, 20 |
| R7.4a unredacted artefacts flagged | 15, 20 |
| R7.5 provenance without the token | 7, 15, 20 |
| R7.7 owner-only workspace | 15 |
| R8.1–R8.2 ledger is truth, sidecar is evidence | 16, 17 |
| R8.3 normalised findings | 11, 12 |
| R8.4 fingerprint without line or message | 16, 20 |
| R8.5 unmapped fallback | 10, 11 |
| R8.6 cross-tool merge | 16, 17 |
| R8.7 four states | 17 |
| R8.8 close only when every detector is conclusively absent | 17, 20 |
| R8.10 full transition table | 17 |
| R8.11 acknowledged reconciles | 17 |
| R8.12 scope derived from what the tool produced | 17 |
| R8.13 detection per occurrence | 17 |
| R8.14 explicit rule-map migration | 10 (map is data; migration lands with M4's second scanner) |
| R12.1 same pipeline | 19 |
| R12.2 exit code | 19, 20 |
| R12.3 JSON output | 19 |
| R13.1 enforced boundary | 1 |
| R13.2 event stream, no stdout in core | 1 (lint), 18 |
| R13.3 fixtures from real runs, scripted | 12 |
| R13.4 fingerprint and reconciliation tests | 16, 17 |
| R13.5 npm distribution | 20 |
| R13.6 a contract test per P1 finding of both reviews | 5, 6a, 9, 12, 13, 14, 15, 16, 17, 20 |
| R13.7 one ownership table, checked coverage | 12 (design example test); the ownership table itself lives only in requirements.md |

**Owned elsewhere but shaped here.** R3.2b (gh-release integrity) is an M3 requirement whose *schema* lands in M1, because `InstallSpec` and the lock entry are defined in Tasks 10 and 6. M1 ships no gh-release driver.

**Deferred within M1, with reasons.** R8.14's migration *runner* is data-only until a second scanner exists to merge against; Task 10 ships the map and its tests, and M4 ships the migration that consumes it. R4.8's concurrency prohibition is structurally satisfied in M1 because no optimise adapter exists; M4 tests it directly.

## Self-review

**Spec coverage.** Every M1 requirement in the milestone table maps to a task above. Two are satisfied structurally rather than by code, and both are called out with their reason.

**Placeholders.** No task contains TBD, TODO, "similar to Task N", or a code step without code. Task 10 ships a deliberate placeholder `skillspector.ts` so the registry compiles; Task 12 replaces it, and both tasks say so explicitly.

**Type consistency.** `ToolResult.outcome` is narrowed to `passed | failed | errored` in the adapter contract (Task 10) and widened to the full `ToolOutcome` on `ToolRunRecord` (Task 14), because only the executor can produce `skipped`. `StageResult.verdict` is `'passed' | 'failed'` everywhere and is a field, never a metric. `fingerprint(skillId, relPath, ruleClass)` keeps the same three parameters in Tasks 16, 17 and 20. `claimRunDir` returns `{ runId, runDir }` in Tasks 15 and 18. `stageDirFor(runDir, index, stage)` is called with `STAGE_ORDER.indexOf(stage) + 1` in Task 18 and with a literal `3` in Task 15's test, both yielding `03-security`. `digestSkill(skill)` takes a `SkillRef` and `skillDigest(manifest)` takes a `CandidateManifest`; Task 18 calls the former. Credential state is derived from `ctx.env` by `credentialsSatisfied`, so no `credentialsPresent` flag is threaded anywhere.

**Scope.** Twenty-one tasks, one milestone, one working deliverable: a headless engine that installs a real scanner, runs it, and records the result. No TUI, no wizard, no mutating stage.

## What changed in revision 2 of this plan

Aligning to design revision 3, which closed [design-review-2.md](design-review-2.md).

| Finding | Change |
|---|---|
| 2, 3 Candidate view and digest | Task 5 rewritten: `candidateManifest()` becomes the single exclusion authority, the `snapshot-pre` basename rule is gone, symlinks are hashed and escapes rejected, `materialiseCandidate()` added for repo-root skills. Task 18 orders the gitignore write before digest capture. Task 20 gains the canary test. |
| 5 M1 tool bootstrap | New Task 6a: the `uv-tool` driver via `UV_TOOL_DIR`/`UV_TOOL_BIN_DIR`, lock writer and verify-by-invocation. `InstallSpec` gains a declared `Integrity` for `gh-release`; the lock gains `integrity`. Task 20 gains an exit criterion driven by a genuinely managed install. |
| 6 SkillSpector credentials | `requiresCredentials: boolean` replaced by `CredentialRequirement` throughout Tasks 10 and 14; `analysisMode` added and recorded in provenance; `detects` narrowed to static mode; a test now keeps design.md §7 and the shipped manifest in step. |
| 7 Classification | Task 14 gains the ordered thirteen-row table as `classifyToolRun`, with missing artefacts classified before the parser is called, `spawn` added to `ErrorKind`, and a test per row. |
| 8 Detector ownership | `issue_detectors` added in Task 16; Task 17's reconciliation becomes two phases and a conjunction, with scope derived from what a tool has produced. |
| 9 Durability | Task 15 gains reader-side index recovery, `latest` by greatest run id, and a leased lock that a dead holder cannot keep. |
| 11 Traceability | The coverage table above is the plan's own check; milestone ownership is not restated here, it lives in requirements.md alone. |

## Execution

Plan saved to `docs/specs/plan-m1.md`. Two execution options:

**1. Subagent-driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline execution** — tasks executed in this session with batched checkpoints.
