import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACCENT,
  JOB_COLOUR,
  OUTCOME_COLOUR,
  SEVERITY_COLOUR,
  STATUS,
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
    expect(ACCENT).toBe('#22d3ee')
    expect(OUTCOME_COLOUR.passed).toBe('#00c853')
    expect(OUTCOME_COLOUR.failed).toBe('#ee0000')
    expect(OUTCOME_COLOUR.errored).toBe('#f5a623')
    expect(OUTCOME_COLOUR.degraded).toBe('#f5a623')
    expect(OUTCOME_COLOUR.skipped).toBe('#6b6b6b')
    expect(OUTCOME_COLOUR.idle).toBe('#6b6b6b')
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
      ...Object.values(STATUS),
      ...Object.values(OUTCOME_COLOUR),
      ...Object.values(SEVERITY_COLOUR),
      ...Object.values(JOB_COLOUR),
    ]
    for (const colour of all) expect(colour).toMatch(/^#[0-9a-f]{6}$/)
  })

  // `ok`/`warn`/`bad` are the same three values `passed`/`errored`/`failed`
  // carry on purpose: a tool that failed to install and a stage that failed are
  // one thing to a reader. Asserted rather than left to the definition, because
  // the way they drift apart is someone nudging one of the five.
  it('states a condition in one colour wherever it appears', () => {
    expect(STATUS.ok).toBe(OUTCOME_COLOUR.passed)
    expect(STATUS.warn).toBe(OUTCOME_COLOUR.errored)
    expect(STATUS.bad).toBe(OUTCOME_COLOUR.failed)
    expect(STATUS.bad).toBe(SEVERITY_COLOUR.critical)
    expect(STATUS.secondary).toBe(SEVERITY_COLOUR.low)
    expect(STATUS.muted).toBe(OUTCOME_COLOUR.skipped)
  })

  /**
   * The half of D23 the value assertions above could never reach. They proved
   * this module's own palette was hex and said nothing about what the screens
   * passed to Ink — which is how fifteen `color="red"` and `colour: 'yellow'`
   * call sites lived in `Setup`, `Issues`, `Settings`, `Work`, `StatusBar` and
   * `rows.ts`, one of them a whole second severity map (`DRIFT_COLOUR`), while
   * the suite stayed green. A name resolves to whatever the user's terminal
   * theme decided it means, so those sites rendered one condition in two colours
   * depending on which screen it appeared on.
   */
  it('passes no named ANSI colour to Ink anywhere in src/tui', async () => {
    // Matched on the *quoted name*, not on the prop, so a name reached through a
    // ternary (`color={done ? 'green' : 'gray'}`) or parked in a lookup map
    // (`DRIFT_COLOUR`) is caught too — both of which is where these actually
    // were. A bare `STATUS.bad` or `ACCENT` is an identifier, never a quoted
    // word, so the quotes are the whole discriminator.
    const ANSI =
      /(['"])(?:black|red|green|yellow|blue|magenta|cyan|white|gray|grey)(?:Bright)?\1/g
    const offenders: string[] = []
    for (const path of await tuiSources()) {
      if (path.endsWith('tokens.ts')) continue
      // Comments stripped first: every one of these sites now carries a note
      // naming the colour it used to be, and a guard its own explanation trips
      // is one the next person deletes the explanation to satisfy.
      const body = (await readFile(path, 'utf8'))
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
      for (const [match] of body.matchAll(ANSI)) offenders.push(`${path}: ${match}`)
      // A hex spelled outside this module is the same defect one step later:
      // `Panel`, `Issues` and `rows.ts` each wrote `#555555` or `#888888` by
      // hand, so changing what "inert" looks like meant finding four files.
      for (const [match] of body.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
        offenders.push(`${path}: ${match}`)
      }
    }
    expect(offenders).toEqual([])
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
