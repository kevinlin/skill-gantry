import { Box, Text } from 'ink'
import { innerWidth, reviewDiffRows, truncate, truncateMiddle, type Layout } from '../layout.js'
import type { SuppressSlot } from '../store.js'
import { STATUS } from '../tokens.js'
import { diffRows } from './DiffBody.js'
import { Panel } from './Panel.js'
import { StatusBar } from './StatusBar.js'

const HINTS = 'a apply · d discard · t then-run · j/k scroll · esc cancel'

/** The three stages R5.1 chains. `optimise` and `release` are not gates. */
const GATE_COUNT = 3

export function SuppressPane({
  suppress,
  layout,
}: {
  suppress: SuppressSlot
  layout: Layout
}): React.ReactElement {
  const cols = Math.max(8, innerWidth(layout.columns, layout.chrome))
  // Every footnote is counted *against* the allocation, never appended below
  // it — §14.1's first rule, learned from the row that pushed the queue panel
  // off an 80x24. The reason row and the then-run row are always there; the
  // other two are conditional, and each costs the diff a row when it appears.
  const staleGates = suppress.thenRun !== 'none' && suppress.stages.length < GATE_COUNT
  const footnotes = 2 + (suppress.uncovered.length > 0 ? 1 : 0) + (staleGates ? 1 : 0)
  const { rows } = diffRows(
    suppress.diff,
    suppress.offset,
    Math.max(1, reviewDiffRows(layout) - footnotes),
    cols,
  )

  return (
    <Box flexDirection="column" width={layout.columns}>
      <Panel
        title={`Suppress — ${suppress.toolId} · ${truncateMiddle(
          suppress.relPath,
          Math.max(12, cols - 16),
        )}`}
        focused
        chrome={layout.chrome}
        width={layout.columns}
      >
        {rows}
        <Text wrap="truncate" inverse={suppress.editingReason}>
          {truncate(`reason ${suppress.reason}`, cols)}
        </Text>
        {suppress.uncovered.length > 0 && (
          <Text color={STATUS.warn} wrap="truncate">
            {truncate(
              `also reported by ${suppress.uncovered.join(', ')}, which declares no baseline — the gate will still fail`,
              cols,
            )}
          </Text>
        )}
        <Text dimColor wrap="truncate">
          {truncate(
            suppress.thenRun === 'none'
              ? 'then run: nothing · t cycles'
              : `then run: ${suppress.stages.join(', ')} · t cycles`,
            cols,
          )}
        </Text>
        {/* Keyed on the *resolved* set, not the toggle's label: "resume" already
            covers all three gates when validate is the failure, and a warning
            that release will refuse would then be false. */}
        {staleGates && (
          <Text dimColor wrap="truncate">
            {truncate('recorded gates passed against the previous bytes', cols)}
          </Text>
        )}
      </Panel>
      <StatusBar hints={suppress.error ?? HINTS} columns={layout.columns} />
    </Box>
  )
}
