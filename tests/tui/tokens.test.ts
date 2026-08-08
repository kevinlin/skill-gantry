import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACCENT,
  JOB_COLOUR,
  OUTCOME_COLOUR,
  SEVERITY_COLOUR,
} from '../../src/tui/tokens.js'

/** Every `.ts`/`.tsx` under src/tui, recursively. */
async function tuiSources(): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (path.endsWith('.ts') || path.endsWith('.tsx')) out.push(path)
    }
  }
  await walk('src/tui')
  return out
}

describe('R11.15 colour vocabulary', () => {
  it('uses the D23 palette for the accent and every state', () => {
    expect(ACCENT).toBe('#0070f3')
    expect(OUTCOME_COLOUR.passed).toBe('#00c853')
    expect(OUTCOME_COLOUR.failed).toBe('#ee0000')
    expect(OUTCOME_COLOUR.errored).toBe('#f5a623')
    expect(OUTCOME_COLOUR.degraded).toBe('#f5a623')
    expect(OUTCOME_COLOUR.skipped).toBe('#555555')
    expect(OUTCOME_COLOUR.idle).toBe('#555555')
    expect(OUTCOME_COLOUR.running).toBe(ACCENT)
    expect(SEVERITY_COLOUR.critical).toBe('#ee0000')
    expect(SEVERITY_COLOUR.high).toBe('#ee0000')
    expect(SEVERITY_COLOUR.medium).toBe('#f5a623')
    expect(SEVERITY_COLOUR.low).toBe('#888888')
    expect(SEVERITY_COLOUR.info).toBe('#888888')
    expect(JOB_COLOUR.running).toBe(ACCENT)
  })

  it('every colour is a hex triple, so a named ANSI cannot creep back in', () => {
    const all = [
      ACCENT,
      ...Object.values(OUTCOME_COLOUR),
      ...Object.values(SEVERITY_COLOUR),
      ...Object.values(JOB_COLOUR),
    ]
    for (const colour of all) expect(colour).toMatch(/^#[0-9a-f]{6}$/)
  })

  // R11.15's mechanically checkable half. The terminal's own background is what
  // makes the screen read on a light theme, so painting one is the regression
  // this guards — not a style preference.
  it('paints no background anywhere in src/tui', async () => {
    const offenders: string[] = []
    for (const path of await tuiSources()) {
      const body = await readFile(path, 'utf8')
      if (body.includes('backgroundColor')) offenders.push(path)
    }
    expect(offenders).toEqual([])
  })
})
