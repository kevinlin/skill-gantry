import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  readIndex,
  type DashboardStats,
  type DoctorReport,
  type GantryConfig,
  type IssueAction,
  type IssueFilter,
  type IssueRow,
  type ProvenanceOption,
  type SkillRef,
  type StatsFilter,
} from '../core/index.js'

export async function loadSkillMd(dir: string): Promise<string> {
  try {
    return await readFile(join(dir, 'SKILL.md'), 'utf8')
  } catch {
    return '(no SKILL.md)'
  }
}

/** Every file the run wrote, relative to the run directory, sorted. */
export async function listArtefacts(runDir: string | null): Promise<string[]> {
  if (!runDir) return []
  const out: string[] = []
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel)
      else out.push(rel)
    }
  }
  try {
    await walk(runDir, '')
  } catch {
    return []
  }
  return out.sort()
}

/**
 * Last recorded outcome per skill, read from each sidecar index rather than
 * the ledger: cross-repo ledger aggregates are M6, and the index is already
 * the per-skill record.
 */
export async function loadSkillStatuses(
  skills: readonly SkillRef[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const skill of skills) {
    const entries = await readIndex(skill.workspacePath).catch(() => [])
    const newest = entries.reduce<string | null>(
      (max, entry) => (max === null || entry.runId > max ? entry.runId : max),
      null,
    )
    const latest = entries.find((entry) => entry.runId === newest)
    if (latest) out[skill.id] = latest.outcome
  }
  return out
}

export interface SettingsRepo {
  id: string
  name: string
  path: string
  isGit: boolean
  skills: number
}

export interface SettingsCredential {
  /** The provider label an adapter declares, or the env key for a bare one. */
  label: string
  satisfied: boolean
  detail: string
}

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
  /** `.env` mode and presence warnings, verbatim from `loadEnvFile`. */
  envWarnings: string[]
  ruleMap: { applied: number; current: number }
}

/**
 * Everything the screens need and the terminal interface is not allowed to do:
 * open the ledger, and spawn a tool to verify it. Declared here because it is
 * the TUI's requirement; implemented in `src/cli/gantry-views.ts`, which is
 * already the one place config, the lockfile and the ledger meet.
 */
export interface GantryViews {
  dashboard(filter: StatsFilter): Promise<DashboardStats>
  provenances(): Promise<ProvenanceOption[]>
  issues(filter: IssueFilter): Promise<IssueRow[]>
  /** Resolves to the new state, or null when the transition was not legal. */
  actOnIssue(fingerprint: string, action: IssueAction): Promise<string | null>
  tools(): Promise<DoctorReport>
  settings(): Promise<SettingsView>
  /** Validates the whole document and writes it once — the only write path. */
  applyConfig(next: GantryConfig): Promise<void>
}
