import { Box, useWindowSize } from 'ink'
import { innerWidth, layoutFor } from '../layout.js'
import { detailRows, detailTitle } from '../rows.js'
import type { AppState } from '../store.js'
import { ScreenList } from './ScreenList.js'
import { StatusBar } from './StatusBar.js'

/**
 * The keys this view answers. Sixty cells, so it still fits beside the version
 * label at §14.1's 80-column floor — the same budget the Work footer is at
 * capacity against, which is why `enter` never joined that row.
 */
const HINTS = 'o open · y copy · s suppress · j/k scroll · esc close · q quit'

/**
 * R11.18. A full-length view of one finding or one issue.
 *
 * A full-screen replacement rather than an overlay, because nothing in this
 * tree draws over live content and an inset box would be *narrower* than the
 * pane it covered — backwards for the one surface whose job is to stop
 * truncating. It renders through `ScreenList` for the reason every other
 * row-list screen does: the overflow notice is counted against the allocation
 * rather than appended below it, and one windowing renderer cannot disagree
 * with itself about where the last row is.
 */
export function DetailPane({ state }: { state: AppState }): React.ReactElement | null {
  const { columns, rows } = useWindowSize()
  const layout = layoutFor(columns, rows)
  if (state.detail === null) return null
  const body = detailRows(state.detail, Math.max(8, innerWidth(columns, layout.chrome)))

  return (
    <Box flexDirection="column" width={columns}>
      <ScreenList
        title={detailTitle(state.detail)}
        rows={body}
        offset={state.detailOffset}
        layout={layout}
      />
      {/* The flash takes the row rather than adding one, exactly as it does on
          Work (§14.3): `y` here has to be able to report a path it could not
          copy, and an action that can only report success is one the user
          cannot trust. */}
      <StatusBar
        hints={state.flash ?? HINTS}
        columns={columns}
        {...(state.flash === null ? {} : { tone: state.flashTone })}
      />
    </Box>
  )
}
