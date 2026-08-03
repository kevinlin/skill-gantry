import { useEffect } from 'react'
import { Box, Text, useWindowSize } from 'ink'
import { innerWidth, layoutFor, truncate } from '../layout.js'
import { settingsRows } from '../rows.js'
import type { Action, AppState } from '../store.js'
import { ScreenList } from './ScreenList.js'

const HINTS = 'j/k scroll · : commands · esc work · q quit'

export function Settings({
  state,
  dispatch,
}: {
  state: AppState
  dispatch: (action: Action) => void
}): React.ReactElement {
  const { columns, rows } = useWindowSize()
  const layout = layoutFor(columns, rows)
  const body = settingsRows(state, Math.max(8, innerWidth(columns, layout.chrome)))

  useEffect(() => {
    dispatch({ type: 'set-screen-row-count', count: body.length })
  }, [body.length])

  return (
    <Box flexDirection="column" width={columns}>
      <ScreenList
        title="Settings"
        hint={`${state.settings?.repos.length ?? 0} repos`}
        rows={body}
        offset={state.screenOffset}
        layout={layout}
      />
      <Text dimColor>{truncate(HINTS, columns)}</Text>
    </Box>
  )
}
