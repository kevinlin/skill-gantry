import { Box, Text } from 'ink'
import { innerWidth, truncate, type Layout } from '../layout.js'
import { ACCENT, overflowNotice } from '../tokens.js'
import { Panel } from './Panel.js'

/**
 * The footer carries five keys; everything else lives here. Two tiers, so a
 * new binding does not have to earn a place on the footer to be discoverable.
 *
 * Ordered by where a key works — everywhere first, then Work, then one group
 * per screen, then the two modals — and every screen-specific row names its
 * screen. Six letters are bound on more than one screen (`r`, `a`, `d`, `e`,
 * `s`, `c`), so a list sorted by anything else asks the reader to hold which
 * `a` is which. Rows that always travel together were merged onto one line for
 * the same reason the budget exists: twenty-four rows did not fit an 80×24
 * terminal, and the five it cut were the global keys at the bottom — a help
 * screen that hid `q`.
 */
const KEYS: readonly (readonly [string, string])[] = [
  ['j / k, ↓ / ↑', 'move or scroll in the focused panel, or a diff'],
  [':', 'command palette: any screen, refresh, quit'],
  ['esc', 'back to Work, or close what is open'],
  ['? / q', 'this help · quit'],
  ['tab, shift-tab', 'Work: focus skills → stages → output → queue'],
  ['h / l', 'Work: move along the lifecycle rail'],
  ['space', 'Work: mark the selected skill or stage'],
  ['r', 'Work: run every marked skill and stage as one batch'],
  ['x', 'Work: cancel the selected job'],
  ['1 – 4', 'Work: Log, Findings, Artefacts, SKILL.md'],
  ['p / s', 'Dashboard: filter by provenance · by selected skill'],
  ['a / w / o, f', 'Issues: acknowledge, wontfix, reopen · cycle filter'],
  ['r', 'Tools: re-probe runtimes, re-verify every locked tool'],
  ['e / d', 'Settings: edit the selected value · remove the repo'],
  ['c', 'Settings: review the staged changes'],
  [':setup', 'the setup wizard, inside the session'],
  ['a / d', 'Review, Confirm: apply · discard, once the diff is up'],
]

const KEY_COLUMN = 16

/**
 * Rows the help screen spends before its first binding: the panel's chrome and
 * title, the footnote, and the closing hint Work prints below it.
 */
const CHROME_ROWS = { boxed: 5, bare: 3 } as const

/**
 * Sized from the layout like every other pane. Drawing its own frame at a fixed
 * size scrolled its own title away on a 50x14 terminal — the exact failure the
 * row budget exists to prevent.
 */
export function Help({ layout }: { layout: Layout }): React.ReactElement {
  const cols = Math.max(8, innerWidth(layout.columns, layout.chrome))
  // A narrow terminal spends less on the key column so the description still
  // has room to say something.
  const keyWidth = Math.min(KEY_COLUMN, Math.max(6, Math.floor(cols / 2)))
  const what = Math.max(4, cols - keyWidth)

  const budget = Math.max(1, layout.rows - CHROME_ROWS[layout.chrome])
  const overflow = KEYS.length > budget
  const shown = KEYS.slice(0, overflow ? Math.max(1, budget - 1) : budget)

  return (
    <Panel title="SkillGantry — keys" focused chrome={layout.chrome}>
      {/* Keyed on both halves: `r` now names two bindings, one per screen, so
          the key alone is no longer unique. */}
      {shown.map(([key, description]) => (
        <Box key={`${key} ${description}`}>
          <Box width={keyWidth} flexShrink={0}>
            <Text wrap="truncate" color={ACCENT}>
              {truncate(key, keyWidth - 1)}
            </Text>
          </Box>
          <Text wrap="truncate">{truncate(description, what)}</Text>
        </Box>
      ))}
      {overflow ? (
        <Text wrap="truncate" dimColor>
          {truncate(
            overflowNotice(0, shown.length, KEYS.length, 'a taller window shows the rest'),
            cols,
          )}
        </Text>
      ) : (
        <Text wrap="truncate" dimColor>
          {truncate('Marking nothing runs the selected skill through every stage.', cols)}
        </Text>
      )}
    </Panel>
  )
}
