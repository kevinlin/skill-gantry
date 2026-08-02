const BLOCK = /^(﻿?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/

/**
 * Line edits, not a YAML round trip. Re-serialising would reorder keys, drop
 * comments and re-quote strings, so the diff the user is asked to approve would
 * carry changes nobody requested — and R10.8's review is only useful if every
 * line in it is a line release meant to write.
 */
function editBlock(source: string, edit: (lines: string[]) => string[]): string {
  const match = BLOCK.exec(source)
  if (!match) throw new Error('no frontmatter: refusing to invent one')
  const [, open, body, close] = match as unknown as [string, string, string, string]
  const edited = edit(body.split(/\r?\n/)).join('\n')
  return `${open}${edited}${close}${source.slice(match[0].length)}`
}

/** Index of a key inside the `metadata:` mapping, or -1. */
function findInMetadata(lines: readonly string[], key: string): number {
  const start = lines.findIndex((line) => /^metadata:\s*$/.test(line))
  if (start === -1) return -1
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] as string
    if (line.length > 0 && !/^\s/.test(line)) break
    if (new RegExp(`^\\s+${key}:`).test(line)) return i
  }
  return -1
}

function setMetadataKey(lines: string[], key: string, value: string): string[] {
  const existing = findInMetadata(lines, key)
  if (existing !== -1) {
    const indent = /^(\s+)/.exec(lines[existing] as string)?.[1] ?? '  '
    lines[existing] = `${indent}${key}: ${value}`
    return lines
  }
  const start = lines.findIndex((line) => /^metadata:\s*$/.test(line))
  if (start === -1) return [...lines, 'metadata:', `  ${key}: ${value}`]
  lines.splice(start + 1, 0, `  ${key}: ${value}`)
  return lines
}

function removeMetadataKey(lines: string[], key: string): string[] {
  const at = findInMetadata(lines, key)
  if (at !== -1) lines.splice(at, 1)
  return lines
}

export function setFrontmatterVersion(source: string, version: string): string {
  return editBlock(source, (lines) => setMetadataKey(lines, 'version', version))
}

/** R1.4's metadata, written through the ordinary mutation path (design §13). */
export function setDeprecated(source: string, value: boolean, supersededBy?: string): string {
  return editBlock(source, (lines) => {
    if (!value) return removeMetadataKey(removeMetadataKey(lines, 'deprecated'), 'superseded_by')
    const withFlag = setMetadataKey(lines, 'deprecated', 'true')
    return supersededBy === undefined
      ? removeMetadataKey(withFlag, 'superseded_by')
      : setMetadataKey(withFlag, 'superseded_by', supersededBy)
  })
}
