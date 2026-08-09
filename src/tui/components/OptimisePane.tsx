import { Box, Text } from 'ink'
import { innerWidth, reviewDiffRows, truncate, truncateMiddle, type Layout } from '../layout.js'
import type { OptimiseSlot } from '../store.js'
import { Panel } from './Panel.js'
import { StatusBar } from './StatusBar.js'

const HINTS = 'y copy · j/k scroll · esc close · q quit'

/**
 * R11.21. It presents R6.12's prompt and does nothing else: no `a`, because
 * there is nothing to apply, and no enqueue, because SkillGantry does not run
 * the optimiser. That is what puts it below every write pane in §14.2's order.
 */
export function OptimisePane({
  optimise,
  flash,
  layout,
}: {
  optimise: OptimiseSlot
  flash: string | null
  layout: Layout
}): React.ReactElement {
  const cols = Math.max(8, innerWidth(layout.columns, layout.chrome))
  const room = reviewDiffRows(layout)
  const overflow = optimise.lines.length > optimise.offset + room
  const shown = optimise.lines.slice(
    optimise.offset,
    optimise.offset + (overflow ? room - 1 : room),
  )
  const hidden = optimise.lines.length - optimise.offset - shown.length

  return (
    <Box flexDirection="column" width={layout.columns}>
      <Panel
        title={`Optimise — ${truncateMiddle(optimise.skillId, Math.max(12, cols - 14))}`}
        focused
        chrome={layout.chrome}
        width={layout.columns}
      >
        {shown.map((line, index) => (
          <Text key={`${optimise.offset + index}`} wrap="truncate">
            {truncate(line, cols)}
          </Text>
        ))}
        {/* §14.1's first rule: the footnote is counted against the allocation
            above, never appended under it. */}
        {hidden > 0 && (
          <Text dimColor wrap="truncate">
            {truncate(`  +${hidden} more line(s) · j/k`, cols)}
          </Text>
        )}
      </Panel>
      <StatusBar hints={flash ?? HINTS} columns={layout.columns} />
    </Box>
  )
}
