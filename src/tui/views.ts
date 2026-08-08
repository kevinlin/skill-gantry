import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  STAGE_ORDER,
  readIndex,
  runsRoot,
  stageDirFor,
  toolDirFor,
  type DashboardStats,
  type DoctorReport,
  type GantryConfig,
  type IndexEntry,
  type IssueAction,
  type IssueFilter,
  type IssueRow,
  type ProvenanceOption,
  type SkillRef,
  type Stage,
  type StageOutcome,
  type StageResult,
  type StatsFilter,
} from '../core/index.js'
import { LOG_CAPACITY } from './log-buffer.js'
import type { FindingRow } from './store.js'

export async function loadSkillMd(dir: string): Promise<string> {
  try {
    return await readFile(join(dir, 'SKILL.md'), 'utf8')
  } catch {
    return '(no SKILL.md)'
  }
}

/**
 * R11.9. Null when the pipeline has not written one — a stage that found
 * nothing, or a run from before R6.10 — which the caller reports as a path the
 * user can still reach with `skillgantry fix`, never as a failed copy.
 */
export async function readFixPrompt(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
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
 * The greatest run id, never the `latest` symlink — which is absent mid-write
 * (§9.2). One function rather than the same reduce in both readers below,
 * because two copies is how they come to disagree about which run is newest.
 */
const newestRunId = (entries: readonly IndexEntry[]): string | null =>
  entries.reduce<string | null>(
    (max, entry) => (max === null || entry.runId > max ? entry.runId : max),
    null,
  )

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
    const newest = newestRunId(entries)
    const latest = entries.find((entry) => entry.runId === newest)
    if (latest) out[skill.id] = latest.outcome
  }
  return out
}

export interface LastRunStage {
  stage: Stage
  outcome: StageOutcome
  summary: string
  /**
   * Attributed the way a live run's are (R11.14). Flattening `toolRuns` into
   * bare findings here would make a rehydrated finding the one kind the
   * Findings pane could not open the evidence for.
   */
  findings: FindingRow[]
}

export interface LastRun {
  runId: string
  runDir: string
  /** Only stages the run executed; the rest stay `·` on the rail. */
  stages: LastRunStage[]
  /**
   * The run's own tool logs, in the `<toolId> │ <line>` shape the live pump
   * writes, so a replayed frame and a live one read identically. Capped at the
   * ring buffer's capacity for the same reason the buffer has one.
   */
  log: { lines: string[]; dropped: number }
}

/**
 * Both streams of one tool run, stdout before stderr. Their true interleaving
 * is not recoverable — the pipeline writes them as two files — so this is
 * ordered rather than merged, which is the honest reading of what is on disk.
 */
async function toolLogLines(stageDir: string, toolId: string): Promise<string[]> {
  const out: string[] = []
  for (const stream of ['stdout.log', 'stderr.log']) {
    const body = await readFile(join(toolDirFor(stageDir, toolId), stream), 'utf8').catch(() => null)
    if (body === null) continue
    for (const line of body.split('\n')) {
      // A trailing newline yields a final empty part that is not a line.
      if (line.length > 0) out.push(`${toolId} │ ${line}`)
    }
  }
  return out
}

/**
 * R11.10. The newest recorded run's evidence, read from the sidecar rather
 * than the ledger: R8.2 makes the sidecar the evidence, the caller already
 * names its skill, and `src/tui/**` may not open the ledger. Read-only — the
 * pipeline stays the only writer under `runs/`.
 */
export async function loadLastRun(workspacePath: string): Promise<LastRun | null> {
  const entries = await readIndex(workspacePath).catch(() => [])
  const runId = newestRunId(entries)
  if (runId === null) return null
  const runDir = join(runsRoot(workspacePath), runId)

  const stages: LastRunStage[] = []
  const lines: string[] = []
  for (const [index, stage] of STAGE_ORDER.entries()) {
    const stageDir = stageDirFor(runDir, index + 1, stage)
    const path = join(stageDir, 'stage.json')
    // A run executes the stages it was asked for, so a missing summary is the
    // ordinary case for the other four — not a failure to read the run.
    const raw = await readFile(path, 'utf8').catch(() => null)
    if (raw === null) continue
    let result: StageResult
    try {
      result = JSON.parse(raw) as StageResult
    } catch {
      continue
    }
    for (const run of result.toolRuns) lines.push(...(await toolLogLines(stageDir, run.toolId)))
    stages.push({
      stage,
      outcome: result.outcome,
      // The tool summaries, where a live run's cell shows the tool ids it
      // started with — the same row saying what it now knows.
      summary: result.toolRuns.map((run) => run.summary).join(', '),
      findings: result.toolRuns.flatMap((run) =>
        run.findings.map((finding) => ({
          finding,
          stage,
          toolId: run.toolId,
          artefactDir: run.artefactDir,
        })),
      ),
    })
  }
  // Newest kept, oldest dropped, reported — the ring buffer's own policy, so a
  // replayed log and a live one overflow the same way and say so the same way.
  const dropped = Math.max(0, lines.length - LOG_CAPACITY)
  return { runId, runDir, stages, log: { lines: lines.slice(dropped), dropped } }
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
  /**
   * Hands a path to the host's default viewer. On the port and not in the
   * renderer because `src/tui/**` may not spawn — and on `GantryViews` rather
   * than a second port because this interface is already the terminal
   * interface's one injected dependency, and already carries writes in
   * `actOnIssue` and `applyConfig`. It is the TUI's port, not the ledger's.
   */
  openPath(path: string): Promise<void>
}
