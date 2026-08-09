import { Document, isMap, isSeq, parseDocument } from 'yaml'
import type { BaselineSpec } from '../adapters/types.js'

export interface AppendResult {
  text: string
  added: number
  /** Entries the collection already held verbatim. */
  alreadyPresent: number
}

const sameEntry = (a: unknown, b: Record<string, string>): boolean => {
  if (typeof a !== 'object' || a === null) return false
  const left = a as Record<string, unknown>
  const keys = Object.keys(b)
  return Object.keys(left).length === keys.length && keys.every((key) => left[key] === b[key])
}

function appendJson(
  current: string | null,
  spec: BaselineSpec,
  entries: readonly Record<string, string>[],
): AppendResult {
  let doc: unknown
  try {
    doc = current === null ? structuredClone(spec.scaffold) : JSON.parse(current)
  } catch (err) {
    throw new Error(`baseline is not parseable: ${(err as Error).message}`)
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new Error('baseline is not a mapping')
  }
  const map = doc as Record<string, unknown>
  const existing = map[spec.collection] ?? []
  if (!Array.isArray(existing)) {
    throw new Error(`baseline \`${spec.collection}\` is not a sequence`)
  }
  const list = [...(existing as unknown[])]
  let added = 0
  let alreadyPresent = 0
  for (const entry of entries) {
    if (list.some((item) => sameEntry(item, entry))) alreadyPresent += 1
    else {
      list.push(entry)
      added += 1
    }
  }
  if (added === 0 && current !== null) return { text: current, added, alreadyPresent }
  map[spec.collection] = list
  return { text: `${JSON.stringify(map, null, 2)}\n`, added, alreadyPresent }
}

/**
 * R10.12's document half. Through yaml's Document API rather than
 * parse-then-stringify, because the user's comments are the only record of why
 * the entries already there are there, and a rewrite that drops them is a
 * silent edit of their file.
 *
 * `version` is never written. Bumping a legacy v1 rule-only baseline to v2
 * retroactively applies v2's non-empty-reason rule to rules the user wrote
 * before it existed, which can turn a loadable file into an unloadable one.
 */
export function appendEntries(
  current: string | null,
  spec: BaselineSpec,
  entries: readonly Record<string, string>[],
): AppendResult {
  if (spec.document === 'json') return appendJson(current, spec, entries)

  const doc = current === null ? new Document(spec.scaffold) : parseDocument(current)
  if (doc.errors.length > 0) {
    throw new Error(`baseline is not parseable: ${doc.errors[0]?.message ?? 'unknown'}`)
  }
  if (!isMap(doc.contents)) throw new Error('baseline is not a mapping')

  // `true` returns the node rather than its plain JS value, which is what lets
  // the sequence be mutated in place with its comments intact.
  const node: unknown = doc.contents.get(spec.collection, true)
  let added = 0
  let alreadyPresent = 0

  if (node === undefined || node === null) {
    doc.set(spec.collection, doc.createNode(entries))
    return { text: String(doc), added: entries.length, alreadyPresent: 0 }
  }
  if (!isSeq(node)) throw new Error(`baseline \`${spec.collection}\` is not a sequence`)

  for (const entry of entries) {
    if (
      node.items.some((item) => sameEntry((item as { toJSON?: () => unknown }).toJSON?.() ?? item, entry))
    ) {
      alreadyPresent += 1
      continue
    }
    node.add(doc.createNode(entry))
    added += 1
  }
  if (added === 0 && current !== null) return { text: current, added, alreadyPresent }
  return { text: String(doc), added, alreadyPresent }
}
