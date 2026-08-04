import { Box, Text } from 'ink'
import { type Layout, screenBodyRows, windowFor } from '../layout.js'
import type { ScreenRow } from '../rows.js'
import { Panel } from './Panel.js'

/**
 * One windowing renderer for every row-list screen. `offset` is first-visible,
 * and the overflow notice is counted *against* the allocation rather than
 * appended below it — §14.1's first rule, and the exact extra row that used to
 * push Work's footer off an 80x24 frame.
 */
export function ScreenList({
  title,
  hint,
  rows,
  offset,
  layout,
  reserve = 0,
}: {
  title: string
  hint?: string
  rows: readonly ScreenRow[]
  offset: number
  layout: Layout
  /** Rows the caller renders below this panel, taken out of its allocation. */
  reserve?: number
}): React.ReactElement {
  const budget = Math.max(1, screenBodyRows(layout) - reserve)
  const overflow = rows.length > budget
  const height = overflow ? Math.max(1, budget - 1) : budget
  const { start, end } = windowFor(rows.length, offset, height)

  return (
    <Panel title={title} {...(hint === undefined ? {} : { hint })} focused chrome={layout.chrome}>
      {rows.slice(start, end).map((row, index) => (
        <Box key={`${start + index}`}>
          <Text
            wrap="truncate"
            bold={row.heading === true}
            dimColor={row.dim === true}
            {...(row.colour === undefined ? {} : { color: row.colour })}
          >
            {row.text}
          </Text>
        </Box>
      ))}
      {overflow && (
        <Text dimColor wrap="truncate">
          rows {start + 1}–{end} of {rows.length} · j/k scrolls
        </Text>
      )}
    </Panel>
  )
}
