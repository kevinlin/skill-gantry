import { Box, Text } from 'ink'
import { innerWidth, truncate, type Layout } from '../layout.js'
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
  displacedReviews = 0,
}: {
  pending: PendingReview
  layout: Layout
  /** Another `mutation:pending` this review silently replaced. Known gap: R5.12
      needs a queue of pendings, not a count, but a count is at least visible. */
  displacedReviews?: number
}): React.ReactElement {
  const cols = Math.max(8, innerWidth(layout.columns, layout.chrome))
  const lines = pending.diff.split('\n')
  const budget = Math.max(1, layout.rows - CHROME_ROWS[layout.chrome])
  // `offset` is the first visible line, not a centred cursor: `windowFor`
  // centres its window on the position given, which meant the first several
  // `j` presses on a long diff moved nothing because the window already
  // spanned the top. A plain slice from `offset` moves on the first press.
  const height = Math.max(1, budget - 1)
  const start = Math.min(pending.offset, Math.max(0, lines.length - 1))
  const end = Math.min(lines.length, start + height)
  const shown = lines.slice(start, end)
  const hidden = lines.length - shown.length

  const title = `Review — ${pending.stage} writes ${pending.scope.length} path(s)${
    displacedReviews > 0 ? ` (+${displacedReviews} waiting)` : ''
  }`

  return (
    <Panel title={title} focused chrome={layout.chrome}>
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
            `a apply · d discard · j/k scroll${hidden > 0 ? ` · ${hidden} hidden` : ''}`,
            cols,
          )}
        </Text>
      </Box>
    </Panel>
  )
}
