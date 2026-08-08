import { Box, Text } from 'ink'
import { innerWidth, type Layout, truncate, windowFor } from '../layout.js'
import { type AppState, paletteMatches } from '../store.js'
import { ACCENT, overflowNotice } from '../tokens.js'
import { Panel } from './Panel.js'

/**
 * Modal, and sized from the layout like every other pane. It shows at most a
 * third of the terminal's rows: the palette is a chooser over seven commands,
 * and a full-height list of them buries the screen it is choosing from.
 */
export function Palette({
  palette,
  layout,
}: {
  palette: AppState['palette']
  layout: Layout
}): React.ReactElement {
  const matches = paletteMatches(palette.query)
  const cols = Math.max(8, innerWidth(layout.columns, layout.chrome))
  const budget = Math.max(1, Math.floor(layout.rows / 3))
  const overflow = matches.length > budget
  const height = overflow ? Math.max(1, budget - 1) : budget
  const { start, end } = windowFor(matches.length, palette.selected, height)

  return (
    <Panel title={`:${palette.query}`} focused chrome={layout.chrome} width={layout.columns}>
      {matches.length === 0 && (
        <Text dimColor wrap="truncate">
          no command matches
        </Text>
      )}
      {matches.slice(start, end).map((command, offset) => {
        const index = start + offset
        return (
          <Box key={command.id}>
            <Text wrap="truncate" bold={index === palette.selected}>
              {index === palette.selected ? '›' : ' '} <Text color={ACCENT}>{command.id}</Text>{' '}
              <Text dimColor>{truncate(command.label, cols - command.id.length - 4)}</Text>
            </Text>
          </Box>
        )
      })}
      {overflow && (
        <Text dimColor wrap="truncate">
          {overflowNotice(start, end, matches.length, 'keep typing to narrow')}
        </Text>
      )}
    </Panel>
  )
}
