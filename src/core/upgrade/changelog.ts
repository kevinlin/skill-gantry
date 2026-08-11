import { compareSemver } from '../release/version.js'
import type { ChangelogEntry } from './types.js'

const HEADING = /^## (\d+\.\d+\.\d+)(?:\s|$)/

/**
 * Sections in document order. A heading that is not a version — `## Unreleased`
 * — opens nothing, so its bullets belong to no entry and are dropped rather
 * than attributed to the section above it.
 */
export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  let open: { version: string; lines: string[] } | null = null

  for (const raw of text.split('\n')) {
    const heading = HEADING.exec(raw)
    if (heading) {
      if (open) entries.push(open)
      open = { version: heading[1] as string, lines: [] }
      continue
    }
    if (raw.startsWith('## ')) {
      if (open) entries.push(open)
      open = null
      continue
    }
    if (open && raw.startsWith('- ')) open.lines.push(raw.slice(2).trim())
  }
  if (open) entries.push(open)
  return entries
}

/** Strictly greater, so re-running a check on the current version shows nothing. */
export function entriesAbove(
  entries: readonly ChangelogEntry[],
  version: string,
): ChangelogEntry[] {
  return entries.filter((entry) => compareSemver(entry.version, version) > 0)
}
