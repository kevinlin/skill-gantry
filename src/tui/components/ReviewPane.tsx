import { Box, Text } from 'ink'
import { innerWidth, reviewDiffRows, truncate, type Layout } from '../layout.js'
import type { PendingReview } from '../store.js'
import { ACCENT, STATUS } from '../tokens.js'
import { Panel } from './Panel.js'

/**
 * Diff gutters, through the shared vocabulary rather than the three ANSI names
 * a diff conventionally uses: this is the pane whose `a` writes the user's repo,
 * so an added line reading green in whatever the terminal profile calls green —
 * beside a rail rendering `passed` as `#00c853` — is the one screen where a
 * colour has to mean exactly what it means everywhere else. The hunk header
 * takes `ACCENT` for the reason `Panel`'s focused border does: it is the mark
 * saying where to look.
 */
const colour = (line: string): string | undefined =>
  line.startsWith('+')
    ? STATUS.ok
    : line.startsWith('-')
      ? STATUS.bad
      : line.startsWith('@@')
        ? ACCENT
        : undefined

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
  const lines = pending.diff.split('\n')
  // `offset` is the first visible line, not a centred cursor: `windowFor`
  // centres its window on the position given, which meant the first several
  // `j` presses on a long diff moved nothing because the window already
  // spanned the top. A plain slice from `offset` moves on the first press.
  const height = reviewDiffRows(layout)
  // Clamped so the last window is still a full one; clamping to the last line
  // left a single diff line on screen at the bottom of a long diff.
  const start = Math.min(pending.offset, Math.max(0, lines.length - height))
  const end = Math.min(lines.length, start + height)
  const shown = lines.slice(start, end)
  const hidden = lines.length - shown.length

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
