import { Box, Text } from 'ink'
import { innerWidth, reviewDiffRows, truncate, truncateMiddle, type Layout } from '../layout.js'
import { PROMPT_TITLE, type PromptSlot } from '../store.js'
import { Panel } from './Panel.js'
import { StatusBar } from './StatusBar.js'

const HINTS = 'y copy · j/k scroll · esc close · q quit'

/**
 * R11.21 and R11.22. It presents a coding-agent prompt and does nothing else:
 * no `a`, because there is nothing to apply, and no enqueue, because
 * SkillGantry neither runs the optimiser nor authors an eval suite. That is
 * what puts it below every write pane in §14.2's order.
 *
 * One component for both kinds, taking its title from the slot. Nothing here
 * was ever about optimisation — `DiffBody`, shared by `ReviewPane` and
 * `SuppressPane`, is the precedent and the reason.
 */
export function PromptPane({
  prompt,
  flash,
  layout,
}: {
  prompt: PromptSlot
  flash: string | null
  layout: Layout
}): React.ReactElement {
  const cols = Math.max(8, innerWidth(layout.columns, layout.chrome))
  const room = reviewDiffRows(layout)
  const overflow = prompt.lines.length > prompt.offset + room
  const shown = prompt.lines.slice(prompt.offset, prompt.offset + (overflow ? room - 1 : room))
  const hidden = prompt.lines.length - prompt.offset - shown.length

  return (
    <Box flexDirection="column" width={layout.columns}>
      <Panel
        title={`${PROMPT_TITLE[prompt.kind]} — ${truncateMiddle(prompt.skillId, Math.max(12, cols - 14))}`}
        focused
        chrome={layout.chrome}
        width={layout.columns}
      >
        {shown.map((line, index) => (
          <Text key={`${prompt.offset + index}`} wrap="truncate">
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
