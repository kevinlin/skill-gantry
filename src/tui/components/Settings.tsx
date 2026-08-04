import { useEffect } from 'react'
import { Box, Text, useWindowSize } from 'ink'
import { configChanges } from '../../core/index.js'
import { innerWidth, layoutFor, truncate } from '../layout.js'
import { settingsRows } from '../rows.js'
import type { Action, AppState } from '../store.js'
import { ScreenList } from './ScreenList.js'
import { StatusBar } from './StatusBar.js'

const HINTS = 'j/k move · e edit · d remove · c confirm · : commands · esc work · q quit'

export function Settings({
  state,
  dispatch,
}: {
  state: AppState
  dispatch: (action: Action) => void
}): React.ReactElement {
  const { columns, rows } = useWindowSize()
  const layout = layoutFor(columns, rows)
  const width = Math.max(8, innerWidth(columns, layout.chrome))
  const body = settingsRows(state, width)
  const editing = state.editing

  useEffect(() => {
    dispatch({ type: 'set-screen-row-count', count: body.length })
  }, [body.length])

  const staged =
    state.staged === null ? '' : `${countChanges(state)} staged · c confirm`

  return (
    <Box flexDirection="column" width={columns}>
      <ScreenList
        title="Settings"
        hint={staged.length > 0 ? staged : `${state.settings?.repos.length ?? 0} repos`}
        rows={body}
        offset={state.screenOffset}
        layout={layout}
        // The editor takes a row out of the list rather than being appended
        // below it, so the frame never grows past the terminal — §14.1's first
        // rule, which an extra line under a full-height panel breaks.
        reserve={editing === null ? 0 : 1}
      />
      {editing !== null && (
        <Text wrap="truncate" {...(editing.error === null ? {} : { color: 'red' })}>
          {truncate(
            `${editing.field} [${editing.current}] → ${editing.buffer}█${
              editing.error === null ? '  enter stages · esc cancels' : `  ${editing.error}`
            }`,
            columns,
          )}
        </Text>
      )}
      <StatusBar hints={HINTS} columns={columns} />
    </Box>
  )
}

/** The count the hint states, computed the same way the pane will render it. */
function countChanges(state: AppState): number {
  const current = state.settings?.config
  if (!current || state.staged === null) return 0
  return configChanges(current, state.staged).length
}
