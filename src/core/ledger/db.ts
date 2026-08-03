import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './schema.js'

export interface Ledger {
  db: DatabaseSync
  close(): void
}

export interface Migration {
  sql: string
  /**
   * Runs in the same version step, after the DDL. For data no query can
   * compute: the provenance fingerprint is a sha256, and SQLite ships no hash
   * function, so the alternative was leaving every pre-existing run outside
   * R7.6's grouping forever.
   */
  backfill?: (db: DatabaseSync) => void
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
    const migration = MIGRATIONS[i] as Migration
    db.exec(migration.sql)
    migration.backfill?.(db)
    db.prepare('insert into schema_version (version) values (?)').run(i + 1)
  }

  return { db, close: () => db.close() }
}
