const HEADING = '# Changelog'

/**
 * R9.3. The date is a parameter rather than read from the clock, because a pure
 * function is what lets the release state machine be tested without freezing
 * time.
 */
export function prependChangelogEntry(
  existing: string,
  version: string,
  date: string,
  notes?: string,
): string {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`^##\\s+${escaped}\\b`, 'm').test(existing)) {
    throw new Error(`changelog already has an entry for ${version}`)
  }

  const entry = `## ${version} — ${date}\n\n${notes ? `${notes.trimEnd()}\n` : ''}`
  const trimmed = existing.trimStart()
  if (trimmed.startsWith(HEADING)) {
    const firstBreak = existing.indexOf('\n', existing.indexOf(HEADING))
    const head = existing.slice(0, firstBreak + 1)
    const tail = existing.slice(firstBreak + 1).replace(/^\n+/, '')
    return `${head}\n${entry}\n${tail}`
  }
  return `${HEADING}\n\n${entry}${existing.length > 0 ? `\n${trimmed}` : ''}`
}
