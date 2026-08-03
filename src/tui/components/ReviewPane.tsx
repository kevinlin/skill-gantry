import { Box, Text } from 'ink'
import { innerWidth, truncate, windowFor, type Layout } from '../layout.js'
import type { PendingReview } from '../store.js'
import { Panel } from './Panel.js'

/** Rows the frame spends before its first diff line: chrome, scope, footer. */
const CHROME_ROWS = { boxed: 6, bare: 4 } as const

const colour = (line: string): string | undefined =>
  line.startsWith('+') ? 'green' : line.startsWith('-') ? 'red' : line.startsWith('@@') ? 'cyan' : undefined

/**
 * R5.2 in the terminal: authorisation is confirmation of a displayed diff. Sized
 * from the layout like every other pane, and the overflow footnote is counted
 * *against* the allocation rather than appended below it — design §14.1's first
 * rule, learned from the row that pushed the queue panel off an 80x24.
 */
export function ReviewPane({
  pending,
  layout,
}: {
  pending: PendingReview
  layout: Layout
}): React.ReactElement {
  const cols = Math.max(8, innerWidth(layout.columns, layout.chrome))
  const lines = pending.diff.split('\n')
  const budget = Math.max(1, layout.rows - CHROME_ROWS[layout.chrome])
  const { start, end } = windowFor(lines.length, pending.offset, budget - 1)
  const shown = lines.slice(start, end)
  const hidden = lines.length - shown.length

  return (
    <Panel title={`Review — ${pending.stage} writes ${pending.scope.length} path(s)`} focused chrome={layout.chrome}>
      <Text wrap="truncate" dimColor>
        {truncate(pending.scope.join('  '), cols)}
      </Text>
      {shown.map((line, index) => {
        const lineColour = colour(line)
        return (
          <Text
            key={`${start + index}`}
            wrap="truncate"
            {...(lineColour === undefined ? {} : { color: lineColour })}
          >
            {truncate(line, cols)}
          </Text>
        )
      })}
      <Box>
        <Text wrap="truncate">
          {truncate(
            `a apply · d discard · j/k scroll${hidden > 0 ? ` · ${hidden} more line(s)` : ''}`,
            cols,
          )}
        </Text>
      </Box>
    </Panel>
  )
}
