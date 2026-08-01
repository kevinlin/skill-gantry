import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './schema.js'

export interface Ledger {
  db: DatabaseSync
  close(): void
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
    db.exec(MIGRATIONS[i] as string)
    db.prepare('insert into schema_version (version) values (?)').run(i + 1)
  }

  return { db, close: () => db.close() }
}
