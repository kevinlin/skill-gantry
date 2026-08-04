import { useEffect } from 'react'
import { Box, useWindowSize } from 'ink'
import { innerWidth, layoutFor } from '../layout.js'
import { toolsRows } from '../rows.js'
import type { Action, AppState } from '../store.js'
import { ScreenList } from './ScreenList.js'
import { StatusBar } from './StatusBar.js'

const HINTS = 'j/k scroll · r refresh · : commands · esc work · q quit'

export function Tools({
  state,
  dispatch,
}: {
  state: AppState
  dispatch: (action: Action) => void
}): React.ReactElement {
  const { columns, rows } = useWindowSize()
  const layout = layoutFor(columns, rows)
  const body = toolsRows(state, Math.max(8, innerWidth(columns, layout.chrome)))

  useEffect(() => {
    dispatch({ type: 'set-screen-row-count', count: body.length })
  }, [body.length])

  return (
    <Box flexDirection="column" width={columns}>
      <ScreenList
        title="Tools"
        hint={state.tools === null ? 'probing' : state.tools.failed ? 'drift found' : 'verified'}
        rows={body}
        offset={state.screenOffset}
        layout={layout}
      />
      <StatusBar hints={HINTS} columns={columns} />
    </Box>
  )
}
