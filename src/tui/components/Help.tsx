import { Box, Text } from 'ink'
import { innerWidth, truncate, type Layout } from '../layout.js'
import { Panel } from './Panel.js'

/**
 * The footer carries five keys; everything else lives here. Two tiers, so a
 * new binding does not have to earn a place on the footer to be discoverable.
 */
const KEYS: readonly (readonly [string, string])[] = [
  ['j / k, ↓ / ↑', 'move within the focused panel, or scroll a pending mutation'],
  ['h / l', 'move along the lifecycle rail'],
  ['tab, shift-tab', 'cycle focus: skills → stages → queue'],
  ['space', 'mark the selected skill or stage'],
  ['r', 'Work: run every marked skill and stage as one batch'],
  ['x', 'cancel the selected job'],
  [':', 'command palette: go to a screen, refresh, quit'],
  ['esc', 'back to Work from any screen'],
  ['p', 'Dashboard: filter by provenance fingerprint'],
  ['s', 'Dashboard: narrow to the selected skill'],
  ['a / w / o', 'Issues: acknowledge, wontfix, reopen'],
  ['f', 'Issues: cycle the state filter'],
  ['r', 'Tools: re-probe runtimes and re-verify every locked tool'],
  ['1 – 4', 'Log, Findings, Artefacts, SKILL.md'],
  ['a', 'apply a pending mutation, once its diff is reviewed'],
  ['d, esc', 'discard a pending mutation'],
  ['?', 'this help'],
  ['esc', 'close help'],
  ['q', 'quit'],
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
            <Text wrap="truncate" color="cyan">
              {truncate(key, keyWidth - 1)}
            </Text>
          </Box>
          <Text wrap="truncate">{truncate(description, what)}</Text>
        </Box>
      ))}
      {overflow ? (
        <Text wrap="truncate" dimColor>
          +{KEYS.length - shown.length} more — a taller window shows them all
        </Text>
      ) : (
        <Text wrap="truncate" dimColor>
          {truncate('Marking nothing runs the selected skill through every stage.', cols)}
        </Text>
      )}
    </Panel>
  )
}
