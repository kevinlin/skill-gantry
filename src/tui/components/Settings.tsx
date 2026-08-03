import { Box, Text, useWindowSize } from 'ink'
import { layoutFor, truncate } from '../layout.js'
import type { AppState } from '../store.js'
import { Panel } from './Panel.js'

export function Settings({ state }: { state: AppState }): React.ReactElement {
  const { columns, rows } = useWindowSize()
  const layout = layoutFor(columns, rows)
  return (
    <Box flexDirection="column" width={columns}>
      <Panel title="Settings" focused chrome={layout.chrome}>
        <Text dimColor wrap="truncate">
          {state.viewError ?? 'loading…'}
        </Text>
      </Panel>
      <Text dimColor>{truncate(': commands · esc work · q quit', columns)}</Text>
    </Box>
  )
}
