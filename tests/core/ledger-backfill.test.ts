import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { openLedger } from '../../src/core/ledger/db.js'
import { provenanceFingerprint } from '../../src/core/ledger/fingerprint.js'

const PROVENANCE = {
  baseUrlHost: 'api.deepseek.com',
  models: { ANTHROPIC_MODEL: 'a' },
  authTokenHash: 'sha256:dead',
  analysisModes: {},
}

describe('provenance_fp backfill', () => {
  it('fingerprints runs a previous version recorded without the column', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sg-backfill-'))
    const path = join(dir, 'gantry.db')

    // A ledger at schema version 3: every table, no provenance_fp.
    const seed = new DatabaseSync(path)
    seed.exec('create table schema_version (version integer primary key)')
    for (const version of [1, 2, 3]) {
      seed.prepare('insert into schema_version (version) values (?)').run(version)
    }
    seed.exec(`
      create table runs (id text primary key, skill_id text, trigger text,
        started_at text, ended_at text, outcome text, skill_digest text,
        git_commit text, git_dirty integer, provenance_json text,
        tool_lock_json text, sidecar_path text);
      -- Migration 5 alters these, so a partial fixture has to carry them.
      create table issues (fingerprint text primary key, skill_id text, rule_class text,
        rel_path text, severity_max text, state text, note text, occurrence_count integer,
        first_seen_run text, last_seen_run text, closed_run text, reopened_run text);
      create table issue_detectors (issue_fp text, tool_id text, last_seen_run text,
        last_absent_run text, primary key (issue_fp, tool_id));
    `)
    seed
      .prepare(
        `insert into runs (id, skill_id, trigger, started_at, skill_digest,
                           provenance_json, sidecar_path)
         values ('r1', 'repo/sk', 'test', 'now', 'sha256:a', ?, '/tmp/r1')`,
      )
      .run(JSON.stringify(PROVENANCE))
    seed.close()

    const ledger = openLedger(path)
    const row = ledger.db.prepare('select provenance_fp as fp from runs').get() as { fp: string }
    expect(row.fp).toBe(provenanceFingerprint(PROVENANCE))
    ledger.close()
  })
})

describe('migration 5 — suppression columns (R8.15)', () => {
  it('adds all four as null and invents no suppression', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sg-suppress-'))
    const path = join(dir, 'gantry.db')

    // A ledger at schema version 4: issues and detectors, no suppression pair.
    const seed = new DatabaseSync(path)
    seed.exec('create table schema_version (version integer primary key)')
    for (const version of [1, 2, 3, 4]) {
      seed.prepare('insert into schema_version (version) values (?)').run(version)
    }
    seed.exec(`
      create table issues (fingerprint text primary key, skill_id text, rule_class text,
        rel_path text, severity_max text, state text, note text, occurrence_count integer,
        first_seen_run text, last_seen_run text, closed_run text, reopened_run text);
      create table issue_detectors (issue_fp text, tool_id text, last_seen_run text,
        last_absent_run text, primary key (issue_fp, tool_id));
      insert into issues values ('fp1', 'repo/sk', 'unsafe-script', 'a.py', 'high',
        'open', null, 3, 'r1', 'r2', null, null);
      insert into issue_detectors values ('fp1', 'skillspector', 'r2', null);
    `)
    seed.close()

    const ledger = openLedger(path)
    try {
      expect(ledger.db.prepare('select * from issues').get()).toMatchObject({
        fingerprint: 'fp1',
        occurrence_count: 3,
        first_seen_run: 'r1',
        state: 'open',
        suppressed_run: null,
        suppressed_reason: null,
      })
      expect(ledger.db.prepare('select * from issue_detectors').get()).toMatchObject({
        tool_id: 'skillspector',
        last_seen_run: 'r2',
        suppressed_run: null,
        suppressed_reason: null,
      })
    } finally {
      ledger.close()
    }
  })
})
