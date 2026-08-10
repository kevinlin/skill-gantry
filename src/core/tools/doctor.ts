import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadToolLock } from '../config/config.js'
import { loadEnvFile } from '../config/env.js'
import { parseFrontmatter } from '../discovery/frontmatter.js'
import type { LifecycleState } from '../ledger/lifecycle.js'
import type { SkillRef } from '../types.js'
import type { ToolLockEntry } from '../config/schema.js'
import { CATALOGUE, SKILLHONE_TOOL_ID, catalogueEntry } from './catalogue.js'
import { type Exec, defaultExec } from './exec.js'
import { verifyGitSkill } from './git-skill.js'
import { toolRoot, verifyTool } from './install.js'
import { type RuntimeStatus, probeRuntimes, runtimesFor } from './runtimes.js'
import {
  serialiseSkillhoneSettings,
  settingsDigest,
  skillhoneSettings,
  skillhoneSettingsPath,
} from './skillhone-settings.js'

export type ToolDriftKind =
  | 'ok'
  | 'missing'
  | 'unverifiable'
  | 'version-drift'
  | 'unlocked'
  | 'integrity-unverified'
  | 'rule-map-pending'
  // R3.7's probe-and-report rule, extended from a host runtime to a tool's own
  // runtime dependency: named, never installed, never failing the report.
  | 'skillhone-deps'
  | 'claude-cli-missing'
  // R3.10's three, on the same rule: reported, never written. Three and not one
  // because the recovery differs — an absent file is a re-run of setup, an
  // unmanaged one is a decision only the user can make about their own bytes,
  // and a stale one is a credential that moved after the file was composed.
  | 'skillhone-config-missing'
  | 'skillhone-config-unmanaged'
  | 'skillhone-config-stale'

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
  /**
   * Supplied by src/cli: `tools` must not open the ledger, which is the same
   * rule that keeps queue out of it. `applied` is the ledger's recorded rule-map
   * version, `current` is RULE_CLASS_MAP_VERSION from the shipped build.
   */
  ruleMap: { applied: number; current: number }
  /**
   * Where a tool's own configuration directory lives (R3.10). Injected for the
   * reason and with the default `InstallToolOptions.userHome` already uses, so
   * a test can point the check at a temp home.
   */
  userHome?: string
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

async function checkLockedTool(
  toolId: string,
  entry: ToolLockEntry,
  home: string,
  exec: Exec,
): Promise<Pick<ToolFinding, 'kind' | 'actualVersion' | 'detail'>> {
  // Three facts rather than a version argv — §5.2 — because `verifyTool`'s
  // semver regex rejects a commit sha and a skill bundle answers no argv.
  if (entry.installKind === 'git-skill') {
    try {
      const sha = await verifyGitSkill(
        join(toolRoot(home), toolId),
        entry.links ?? [],
        entry.resolvedVersion,
        exec,
      )
      return { kind: 'ok', actualVersion: sha, detail: '' }
    } catch (err) {
      const message = (err as Error).message
      // A moved HEAD is drift the user can reconcile; a dangling link or a dead
      // interpreter is a bundle that cannot be used at all.
      if (message.includes('HEAD is')) {
        return { kind: 'version-drift', actualVersion: null, detail: message }
      }
      return {
        kind: message.includes('does not resolve') ? 'missing' : 'unverifiable',
        actualVersion: null,
        detail: message,
      }
    }
  }

  const { bin, resolvedVersion: expected, integrity } = entry
  if (!(await isFile(bin))) {
    return { kind: 'missing', actualVersion: null, detail: `${bin} is gone` }
  }
  let actual: string
  try {
    actual = await verifyTool({ bin }, catalogueEntry(toolId)?.versionArgv ?? ['--version'])
  } catch (err) {
    return {
      kind: 'unverifiable',
      actualVersion: null,
      detail: (err as Error).message,
    }
  }
  if (actual !== expected) {
    return {
      kind: 'version-drift',
      actualVersion: actual,
      detail: `locked ${expected}, reports ${actual}`,
    }
  }
  if (integrity === 'none') {
    return {
      kind: 'integrity-unverified',
      actualVersion: actual,
      detail: 'installed from an asset with no published checksum',
    }
  }
  return { kind: 'ok', actualVersion: actual, detail: '' }
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

/**
 * R3.10's three conditions, decided by comparing digests. Neither the file's
 * bytes nor the document the current `.env` would compose leaves this function:
 * both hold the user's credential, and which of three states the file is in is
 * a question a hash answers.
 */
async function checkSkillhoneConfig(
  home: string,
  userHome: string,
  entry: ToolLockEntry,
): Promise<Omit<ToolFinding, 'toolId'> | null> {
  const path = entry.config?.path ?? skillhoneSettingsPath(userHome)
  const blank = { expectedVersion: null, actualVersion: null }

  const current = await readFile(path, 'utf8').then(
    (text) => text,
    () => null,
  )
  if (current === null) {
    return {
      ...blank,
      kind: 'skillhone-config-missing',
      detail: `${path} is absent — optim.py exits before it reads anything; re-run \`skillgantry setup\``,
    }
  }

  const onDisk = settingsDigest(current)
  if (entry.config === undefined || entry.config.sha256 !== onDisk) {
    return {
      ...blank,
      kind: 'skillhone-config-unmanaged',
      detail: `${path} was not written by SkillGantry — delete it and re-run \`skillgantry setup\` to adopt the managed one`,
    }
  }

  // Ours and untouched, so the only thing left that can be wrong is the source:
  // a rotated token or a changed base URL leaves a file that authenticates
  // against nothing, and never-overwrite means nothing else would ever say so.
  const settings = skillhoneSettings((await loadEnvFile(home)).vars)
  if (settings && settingsDigest(serialiseSkillhoneSettings(settings)) !== onDisk) {
    return {
      ...blank,
      kind: 'skillhone-config-stale',
      detail: `${path} no longer matches ~/.skillgantry/.env — delete it and re-run \`skillgantry setup\``,
    }
  }
  return null
}

export async function doctor(input: DoctorInput): Promise<DoctorReport> {
  const lock = await loadToolLock(input.home)

  const exec = input.exec ?? defaultExec

  const tools: ToolFinding[] = []
  for (const [toolId, entry] of Object.entries(lock.tools)) {
    const checked = await checkLockedTool(toolId, entry, input.home, exec)
    tools.push({ toolId, expectedVersion: entry.resolvedVersion, ...checked })
  }

  const bundle = lock.tools[SKILLHONE_TOOL_ID]
  if (bundle) {
    // R3.7's rule extended from host runtimes to a tool's own runtime
    // dependency: probed and named, never installed, never failing the report.
    try {
      await exec(bundle.bin, ['-c', 'import git, yaml, litellm'])
    } catch {
      tools.push({
        toolId: SKILLHONE_TOOL_ID,
        kind: 'skillhone-deps',
        expectedVersion: null,
        actualVersion: null,
        detail: 're-run `skillgantry setup` to rebuild the managed venv',
      })
    }
    try {
      await exec('command', ['-v', 'claude'])
    } catch {
      tools.push({
        toolId: SKILLHONE_TOOL_ID,
        kind: 'claude-cli-missing',
        expectedVersion: null,
        actualVersion: null,
        detail:
          'claude-agent-sdk shells out to it, so optim.py fails at first run — ' +
          'npm install -g @anthropic-ai/claude-code',
      })
    }
    const config = await checkSkillhoneConfig(
      input.home,
      input.userHome ?? homedir(),
      bundle,
    )
    if (config) tools.push({ toolId: SKILLHONE_TOOL_ID, ...config })
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

  // Beside integrity-unverified and lifecycle-drift: a standing condition to
  // surface, not a reason a tool cannot run. R8.14 keeps the fix explicit.
  if (input.ruleMap.applied < input.ruleMap.current) {
    tools.push({
      toolId: '(ledger)',
      kind: 'rule-map-pending',
      expectedVersion: String(input.ruleMap.current),
      actualVersion: String(input.ruleMap.applied),
      detail:
        `rule-class map v${input.ruleMap.applied} applied, v${input.ruleMap.current} shipped — ` +
        'run `skillgantry doctor --migrate-rule-map`',
    })
  }

  return {
    runtimes: await probeRuntimes(runtimesFor(CATALOGUE), exec),
    tools,
    lifecycle: await lifecycleDrift(input.skills, input.ledgerLifecycle),
    failed: tools.some((finding) => FAILING.has(finding.kind)),
  }
}
