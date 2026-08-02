import { describe, expect, it } from 'vitest'
import { openLedger } from '../../src/core/ledger/db.js'
import { fingerprint } from '../../src/core/ledger/fingerprint.js'
import {
  appliedRuleMapVersion,
  migrateRuleMap,
} from '../../src/core/ledger/rule-map-migration.js'
import { RULE_CLASS_MAP_VERSION } from '../../src/core/adapters/rule-classes.js'

const SKILL = 'zapac/architecture-diagram'
const PATH = 'architecture-diagram/scripts/html_to_png.py'

/** Minimal rows: repos, skills and one run, so foreign keys are satisfiable. */
function seed(db: import('node:sqlite').DatabaseSync): void {
  db.exec(`insert into repos (id, path, name, is_git) values ('zapac', '/tmp/zapac', 'zapac', 1)`)
  db.exec(`insert into skills (id, repo_id, name, rel_path) values
           ('${SKILL}', 'zapac', 'architecture-diagram', 'architecture-diagram')`)
  for (const r of ['run-a', 'run-b']) {
    db.exec(`insert into runs (id, skill_id, trigger, started_at, skill_digest, sidecar_path)
             values ('${r}', '${SKILL}', 'test', 'now', 'sha256:x', '/tmp/ws')`)
  }
  db.exec(`insert into stages (run_id, stage, outcome, verdict) values ('run-a', 'security', 'failed', 'failed')`)
  db.exec(`insert into tool_runs (stage_id, tool_id, outcome, artefact_dir)
           values (1, 'skillspector', 'failed', '/tmp/ws/a')`)
  db.exec(`insert into tool_runs (stage_id, tool_id, outcome, artefact_dir)
           values (1, 'skill-lint', 'failed', '/tmp/ws/b')`)
}

function insertIssue(
  db: import('node:sqlite').DatabaseSync,
  ruleClass: string,
  state: string,
  opts: { count: number; toolId: string; toolRunId: number; ordinals: number },
): string {
  const fp = fingerprint(SKILL, PATH, ruleClass as never)
  db.prepare(
    `insert into issues (fingerprint, skill_id, rule_class, rel_path, severity_max, state,
                         occurrence_count, first_seen_run, last_seen_run)
     values (?, ?, ?, ?, 'medium', ?, ?, 'run-a', 'run-b')`,
  ).run(fp, SKILL, ruleClass, PATH, state, opts.count)
  for (let i = 0; i < opts.ordinals; i += 1) {
    db.prepare(
      `insert into issue_detections (issue_fp, tool_run_id, ordinal, native_rule_id,
                                     native_severity, message)
       values (?, ?, ?, 'X', 'medium', 'm')`,
    ).run(fp, opts.toolRunId, i)
  }
  db.prepare(
    `insert into issue_detectors (issue_fp, tool_id, last_seen_run) values (?, ?, 'run-b')`,
  ).run(fp, opts.toolId)
  return fp
}

describe('migrateRuleMap', () => {
  it('reclassifies an unmapped issue that has no collision', () => {
    const { db } = openLedger(':memory:')
    seed(db)
    const oldFp = insertIssue(db, 'unmapped:skillspector:AST4', 'acknowledged', {
      count: 2, toolId: 'skillspector', toolRunId: 1, ordinals: 2,
    })

    const result = migrateRuleMap(db)

    expect(result.reclassified).toBe(1)
    expect(result.merged).toBe(0)
    const newFp = fingerprint(SKILL, PATH, 'unsafe-script')
    const row = db.prepare('select rule_class, state, occurrence_count from issues where fingerprint = ?')
      .get(newFp) as { rule_class: string; state: string; occurrence_count: number }
    expect(row.rule_class).toBe('unsafe-script')
    expect(row.state).toBe('acknowledged')
    expect(db.prepare('select count(*) as n from issues where fingerprint = ?').get(oldFp))
      .toEqual({ n: 0 })
    expect(db.prepare('select count(*) as n from issue_detections where issue_fp = ?').get(newFp))
      .toEqual({ n: 2 })
  })

  it('merges into an existing issue, re-parenting detections without an ordinal collision', () => {
    const { db } = openLedger(':memory:')
    seed(db)
    // skill-lint already mapped R06 to unsafe-script; skillspector's AST4 is
    // about to become the same class on the same path. Both used ordinal 0.
    const target = insertIssue(db, 'unsafe-script', 'open', {
      count: 1, toolId: 'skill-lint', toolRunId: 2, ordinals: 1,
    })
    insertIssue(db, 'unmapped:skillspector:AST4', 'wontfix', {
      count: 2, toolId: 'skillspector', toolRunId: 1, ordinals: 2,
    })

    const result = migrateRuleMap(db)

    expect(result.merged).toBe(1)
    const row = db.prepare(
      'select state, occurrence_count, note from issues where fingerprint = ?',
    ).get(target) as { state: string; occurrence_count: number; note: string | null }
    // wontfix outranks open: the strongest state survives a merge.
    expect(row.state).toBe('wontfix')
    expect(row.occurrence_count).toBe(3)
    // The note names both ends of the move, so it stays legible after a second bump.
    expect(row.note).toMatch(new RegExp(`rule-map v1 -> v${RULE_CLASS_MAP_VERSION}`))
    expect(db.prepare('select count(*) as n from issues').get()).toEqual({ n: 1 })
    expect(db.prepare('select count(*) as n from issue_detections where issue_fp = ?').get(target))
      .toEqual({ n: 3 })
    expect(db.prepare('select count(*) as n from issue_detectors where issue_fp = ?').get(target))
      .toEqual({ n: 2 })
  })

  it('is idempotent and records the version it applied', () => {
    const { db } = openLedger(':memory:')
    seed(db)
    insertIssue(db, 'unmapped:skillspector:AST4', 'open', {
      count: 1, toolId: 'skillspector', toolRunId: 1, ordinals: 1,
    })

    expect(migrateRuleMap(db).applied).toBe(RULE_CLASS_MAP_VERSION)
    expect(appliedRuleMapVersion(db)).toBe(RULE_CLASS_MAP_VERSION)

    const second = migrateRuleMap(db)
    expect(second.reclassified).toBe(0)
    expect(second.merged).toBe(0)
  })

  it('leaves a still-unmapped class alone', () => {
    const { db } = openLedger(':memory:')
    seed(db)
    const fp = insertIssue(db, 'unmapped:skillspector:ZZ9', 'open', {
      count: 1, toolId: 'skillspector', toolRunId: 1, ordinals: 1,
    })
    migrateRuleMap(db)
    expect(db.prepare('select rule_class from issues where fingerprint = ?').get(fp))
      .toEqual({ rule_class: 'unmapped:skillspector:ZZ9' })
  })
})
