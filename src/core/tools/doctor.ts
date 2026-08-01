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

async function checkLockedTool(
  toolId: string,
  bin: string,
  expected: string,
  integrity: string,
): Promise<Pick<ToolFinding, 'kind' | 'actualVersion' | 'detail'>> {
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
