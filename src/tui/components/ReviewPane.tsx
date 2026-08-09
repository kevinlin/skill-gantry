import { Box, Text } from 'ink'
import { innerWidth, reviewDiffRows, truncate, type Layout } from '../layout.js'
import type { PendingReview } from '../store.js'
import { diffRows } from './DiffBody.js'
import { Panel } from './Panel.js'

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
  /** A `mutation:pending` that overwrote a slot still holding a different
      request — a resolution the store never saw, not a second concurrent
      review, which the queue and the pipeline both already prevent. */
  displacedReviews?: number
}): React.ReactElement {
  const cols = Math.max(8, innerWidth(layout.columns, layout.chrome))
  // `offset` is the first visible line, not a centred cursor: `windowFor`
  // centres its window on the position given, which meant the first several
  // `j` presses on a long diff moved nothing because the window already
  // spanned the top. A plain slice from `offset` moves on the first press.
  const { rows, hidden } = diffRows(pending.diff, pending.offset, reviewDiffRows(layout), cols)

  const title = `Review — ${pending.stage} writes ${pending.scope.length} path${
    pending.scope.length === 1 ? '' : 's'
  }${
    displacedReviews > 0 ? ` (+${displacedReviews} waiting)` : ''
  }`

  return (
    <Panel title={title} focused chrome={layout.chrome} width={layout.columns}>
      <Text wrap="truncate" dimColor>
        {truncate(pending.scope.join('  '), cols)}
      </Text>
      {rows}
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
