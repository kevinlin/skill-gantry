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
