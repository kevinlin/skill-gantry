import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getAdapter } from '../core/adapters/registry.js'
import { RULE_CLASS_MAP_VERSION } from '../core/adapters/rule-classes.js'
import { loadConfig, loadToolLock, saveConfig } from '../core/config/config.js'
import { loadEnvFile } from '../core/config/env.js'
import { discoverSkills } from '../core/discovery/discover.js'
import { type Ledger, openLedger } from '../core/ledger/db.js'
import { issueDetectionRules, listIssues, setIssueState } from '../core/ledger/issue-queries.js'
import { readLifecycleCache } from '../core/ledger/lifecycle.js'
import { appliedRuleMapVersion } from '../core/ledger/rule-map-migration.js'
import { dashboard, provenanceOptions } from '../core/ledger/stats.js'
import { releaseDirtyPaths } from '../core/release/preflight.js'
import { previewSuppression } from '../core/suppress/target.js'
import {
  applySuppression,
  discardSuppression,
  type SuppressionPlan,
} from '../core/suppress/write.js'
import { doctor } from '../core/tools/doctor.js'
import type { SkillRef } from '../core/types.js'
import type { GantryViews, SettingsCredential, SettingsView } from '../tui/views.js'
import { planOptimiseFor } from './optimise-command.js'
import { type CliDeps, discoverAll } from './run-command.js'

/**
 * Opened per call and closed straight after, rather than held for the session.
 * A screen refresh is rare and a run's finalisation transaction is not: a
 * long-lived read handle in the same process as the writer is how a WAL reader
 * ends up serving a snapshot from before the run it was opened to display.
 */
function withLedger<T>(dbPath: string, read: (ledger: Ledger) => T): T {
  const ledger = openLedger(dbPath)
  try {
    return read(ledger)
  } finally {
    ledger.close()
  }
}

/**
 * Presence, never a value. A credential set is satisfied when every key of one
 * declared alternative is present and non-empty (R4.2a), which is the same rule
 * the runner classifies row 2 of §8.1 with.
 */
function credentialsOf(
  toolIds: readonly string[],
  vars: Record<string, string>,
): SettingsCredential[] {
  const out: SettingsCredential[] = []
  for (const toolId of toolIds) {
    const requirement = getAdapter(toolId)?.manifest.credentials
    if (requirement === undefined || requirement.kind === 'none') {
      out.push({ label: toolId, satisfied: true, detail: 'no credential required' })
      continue
    }
    const satisfied = requirement.alternatives.filter((alternative) =>
      alternative.required.every((key) => (vars[key] ?? '').length > 0),
    )
    out.push({
      label: toolId,
      satisfied: satisfied.length > 0,
      detail:
        satisfied.length > 0
          ? `via ${satisfied.map((alternative) => alternative.provider).join(', ')}`
          : `needs one of ${requirement.alternatives.map((a) => a.provider).join(', ')}`,
    })
  }
  return out
}

export function createGantryViews(deps: CliDeps): GantryViews {
  // Held between `planSuppression` and `applySuppression` rather than travelling
  // through React state: a `SuppressionPlan` carries absolute paths and a
  // preimage hash that no component renders, and the recheck those exist for
  // has to run against the plan the diff was built from.
  let staged: SuppressionPlan[] = []

  /**
   * Re-discovered on every call rather than taken from the caller, for the
   * reason `ReleasePreviewView.skill` states: the frontmatter version in the
   * terminal's memory is the one it launched with.
   */
  const skillById = async (id: string): Promise<SkillRef> => {
    const skill = (await discoverAll(await loadConfig(deps.home))).find(
      (candidate) => candidate.id === id,
    )
    if (skill === undefined) throw new Error(`no skill ${id}`)
    return skill
  }

  return {
    dashboard: async (filter) => withLedger(deps.dbPath, (ledger) => dashboard(ledger.db, filter)),
    provenances: async () => withLedger(deps.dbPath, (ledger) => provenanceOptions(ledger.db)),
    issues: async (filter) => withLedger(deps.dbPath, (ledger) => listIssues(ledger.db, filter)),
    actOnIssue: async (fingerprint, action) =>
      withLedger(deps.dbPath, (ledger) => setIssueState(ledger.db, fingerprint, action)),
    tools: async () => {
      const skills = await discoverAll(await loadConfig(deps.home))
      // R8.14: the report says `rule-map-pending`; only
      // `doctor --migrate-rule-map` resolves it, so nothing here migrates.
      return doctor({
        home: deps.home,
        skills,
        ledgerLifecycle: withLedger(deps.dbPath, (ledger) => readLifecycleCache(ledger.db)),
        ruleMap: withLedger(deps.dbPath, (ledger) => ({
          applied: appliedRuleMapVersion(ledger.db),
          current: RULE_CLASS_MAP_VERSION,
        })),
      })
    },
    settings: async (): Promise<SettingsView> => {
      const config = await loadConfig(deps.home)
      const env = await loadEnvFile(deps.home)
      const repos = []
      for (const repo of config.repos) {
        repos.push({
          id: repo.id,
          name: repo.name,
          path: repo.path,
          isGit: repo.isGit,
          skills: (await discoverSkills(repo).catch(() => [])).length,
        })
      }
      const selected = [...new Set(Object.values(config.stageTools).flat())]
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
      return {
        home: deps.home,
        dbPath: deps.dbPath,
        configPath: join(deps.home, 'config.json'),
        envPath: join(deps.home, '.env'),
        lockPath: join(deps.home, 'tools', 'lock.json'),
        config,
        presentKeys,
        concurrency: config.concurrency,
        repos,
        stageTools: config.stageTools,
        lockedTools,
        toolTimeouts,
        credentials: credentialsOf(selected, env.vars),
        envWarnings: env.present ? env.warnings : [`${deps.home}/.env is absent`],
        ruleMap: withLedger(deps.dbPath, (ledger) => ({
          applied: appliedRuleMapVersion(ledger.db),
          current: RULE_CLASS_MAP_VERSION,
        })),
      }
    },
    applyConfig: async (next) => {
      // `saveConfig` runs `configSchema.parse` before it writes, so an invalid
      // document never reaches disk even if a caller skipped staging validation.
      await saveConfig(deps.home, next)
    },
    planRelease: async (skillId) => {
      const skill = await skillById(skillId)
      return { skill, dirty: await releaseDirtyPaths(skill) }
    },
    planOptimise: async (skillId) => {
      const skill = await skillById(skillId)
      return planOptimiseFor(deps.home, skill)
    },
    planSuppression: async (request) => {
      const skill = await skillById(request.skillId)

      const { rules, stillReporting } =
        request.kind === 'issue'
          ? withLedger(deps.dbPath, (ledger) => {
              const row = listIssues(ledger.db, { skillId: skill.id }).find(
                (issue) => issue.fingerprint === request.fingerprint,
              )
              if (row === undefined) throw new Error(`no issue ${request.fingerprint}`)
              return {
                rules: issueDetectionRules(ledger.db, request.fingerprint),
                stillReporting: row.blockedBy,
              }
            })
          : {
              rules: [
                {
                  toolId: request.toolId,
                  nativeRuleId: request.nativeRuleId,
                  relPath: request.relPath,
                },
              ],
              stillReporting: [request.toolId],
            }

      const preview = await previewSuppression({
        skill,
        reason: request.reason,
        rules,
        stillReporting,
      })
      staged = preview.plans
      // Rejected rather than returned empty: the pane must never open with
      // nothing to confirm, and the refusal has to name the tool (R11.16).
      if (preview.plans.length === 0) {
        const named =
          preview.uncovered.length > 0
            ? `${preview.uncovered.join(', ')} declares no baseline`
            : 'no detecting tool declares a baseline'
        throw new Error(named)
      }
      const plan = preview.plans[0] as SuppressionPlan
      return {
        label: preview.plans.map((one) => one.label).join(', '),
        diff: preview.plans.map((one) => one.diff).join('\n'),
        uncovered: preview.uncovered,
        alreadyPresent: preview.plans.every((one) => one.added === 0) && plan.alreadyPresent > 0,
      }
    },
    applySuppression: async () => {
      for (const plan of staged) await applySuppression(plan)
      staged = []
    },
    discardSuppression: async () => {
      for (const plan of staged) await discardSuppression(plan)
      staged = []
    },
    openPath: async (path) => {
      // Per-platform opener, detached and fully un-piped: the child outlives
      // this call by design, and inheriting our stdio would let it write over
      // the alternate screen Ink owns.
      const command =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'explorer'
            : 'xdg-open'
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, [path], { detached: true, stdio: 'ignore' })
        child.once('error', reject)
        // Resolved on spawn rather than on exit: `open` returns immediately on
        // macOS but `xdg-open` can block for the lifetime of the viewer, and a
        // promise the TUI awaits must not be held open by a file manager.
        child.once('spawn', () => {
          child.unref()
          resolve()
        })
      })
    },
  }
}
