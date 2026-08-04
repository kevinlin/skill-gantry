import { useEffect } from 'react'
import { Box, useWindowSize } from 'ink'
import { innerWidth, layoutFor } from '../layout.js'
import { dashboardRows } from '../rows.js'
import type { Action, AppState } from '../store.js'
import { ScreenList } from './ScreenList.js'
import { StatusBar } from './StatusBar.js'

const HINTS = 'j/k scroll · p provenance · s scope · : commands · esc work · q quit'

export function Dashboard({
  state,
  dispatch,
}: {
  state: AppState
  dispatch: (action: Action) => void
}): React.ReactElement {
  const { columns, rows } = useWindowSize()
  const layout = layoutFor(columns, rows)
  const body = dashboardRows(state, Math.max(8, innerWidth(columns, layout.chrome)))

  // The scroll clamp needs the row count, and only this component knows the
  // width the rows were built at, so it reports it rather than the reducer
  // guessing. Kept in an effect so a render never dispatches during render.
  useEffect(() => {
    dispatch({ type: 'set-screen-row-count', count: body.length })
  }, [body.length])

  const provenance = state.provenances.find(
    (option) => option.fingerprint === state.statsFilter.provenanceFp,
  )

  return (
    <Box flexDirection="column" width={columns}>
      <ScreenList
        title="Dashboard"
        hint={
          provenance === undefined
            ? `${state.provenances.length} provenance${state.provenances.length === 1 ? '' : 's'}`
            : `${provenance.baseUrlHost ?? 'no host'} · ${provenance.runs} runs`
        }
        rows={body}
        offset={state.screenOffset}
        layout={layout}
      />
      <StatusBar hints={HINTS} columns={columns} />
    </Box>
  )
}
