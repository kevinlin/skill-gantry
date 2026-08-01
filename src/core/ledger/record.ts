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
        const toolRunId = (db.prepare('select last_insert_rowid() as id').get() as { id: number }).id

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
              maxSeverity(existing.severity_max as never, finding.severity),
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
