import { parse as parseYaml } from 'yaml'

const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

export interface Frontmatter {
  name: string | null
  version: string | null
  /** R1.6: the file is the authority for lifecycle state; the ledger is a cache. */
  deprecated: boolean
  /** R1.4's optional pointer at the replacement. */
  supersededBy: string | null
  /**
   * R2.5. False when a block is there and could not be read as a mapping. A
   * file declaring nothing is not a file that failed, so an absent block is
   * `true`: without the distinction, a skill nameless because its YAML threw
   * is indistinguishable from one that never named itself, and the only
   * symptom is metadata silently missing everywhere.
   */
  readable: boolean
}

const ABSENT: Frontmatter = {
  name: null,
  version: null,
  deprecated: false,
  supersededBy: null,
  readable: true,
}

const UNPARSABLE: Frontmatter = { ...ABSENT, readable: false }

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

/**
 * Never throws. Absent or malformed frontmatter yields nulls, which is what
 * R2.5 requires: a bad skill must not fail the whole scan.
 */
export function parseFrontmatter(source: string): Frontmatter {
  const match = FRONTMATTER.exec(source)
  if (!match?.[1]) return ABSENT

  let doc: unknown
  try {
    doc = parseYaml(match[1])
  } catch {
    return UNPARSABLE
  }
  if (typeof doc !== 'object' || doc === null) return UNPARSABLE

  const record = doc as Record<string, unknown>
  const metadata =
    typeof record.metadata === 'object' && record.metadata !== null
      ? (record.metadata as Record<string, unknown>)
      : {}

  return {
    name: asString(record.name),
    version: asString(metadata.version),
    deprecated: metadata.deprecated === true,
    supersededBy: asString(metadata.superseded_by),
    readable: true,
  }
}
