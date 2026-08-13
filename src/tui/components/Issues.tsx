import { Box, Text, useWindowSize } from 'ink'
import { innerWidth, layoutFor, screenBodyRows, truncate, windowFor } from '../layout.js'
import { issueRows } from '../rows.js'
import type { AppState } from '../store.js'
import { SEVERITY_COLOUR, STATUS, overflowNotice } from '../tokens.js'
import { Panel } from './Panel.js'
import { StatusBar, footer } from './StatusBar.js'

// `q quit` included because `q` does quit from here: every other screen's
// footer said so and this one did not, which made the key look screen-specific.
const HINTS =
  'j/k move · a ack · w wontfix · o reopen · f filter · : commands · esc work · q quit'

export function Issues({ state }: { state: AppState }): React.ReactElement {
  const { columns, rows } = useWindowSize()
  const layout = layoutFor(columns, rows)
  const cols = Math.max(20, innerWidth(columns, layout.chrome))
  const budget = screenBodyRows(layout)
  const overflow = state.issues.length > budget
  const height = overflow ? Math.max(1, budget - 1) : budget
  const { start, end } = windowFor(state.issues.length, state.selectedIssue, height)

  const suppressedCount = state.issues.filter((row) => row.suppressed).length

  return (
    <Box flexDirection="column" width={columns}>
      <Panel
        title="Issues"
        // R11.18 advertised on the title row, which costs no body row. An
        // action row under the selection would put the rendered row count out
        // of step with `windowFor`'s issue count two lines below — the `j`
        // stops short of the end failure — and §14.3 already refused to pay the
        // budget permanently for a static hint. The footer is not an option
        // either: it measures 83 cells and already truncates at 80.
        hint={`${state.issues.length} · ${state.issueFilter.state ?? 'every state'}${
          suppressedCount === 0 ? '' : ` · ${suppressedCount} suppressed`
        } · enter details`}
        focused
        chrome={layout.chrome}
        width={columns}
      >
        {state.viewError !== null && (
          <Text color={STATUS.bad} wrap="truncate">
            {truncate(`ledger read failed: ${state.viewError}`, cols)}
          </Text>
        )}
        {state.viewError === null && state.issues.length === 0 && (
          <Text dimColor wrap="truncate">
            no issues match this filter
          </Text>
        )}
        {/* R11.13: one builder for this screen and the Work screen's Issues
            tab. Two renderers of one issue is the divergence `tokens.ts`
            already records from when five modules owned severity colour. */}
        {issueRows(state.issues, state.selectedIssue, cols)
          .slice(start, end)
          .map((row) => (
            <Text
              key={row.fingerprint}
              wrap="truncate"
              inverse={row.selected}
              bold={row.selected}
              dimColor={row.suppressed}
            >
              <Text color={SEVERITY_COLOUR[row.severity] ?? STATUS.secondary}>{row.text}</Text>
            </Text>
          ))}
        {overflow && (
          <Text dimColor wrap="truncate">
            {overflowNotice(start, end, state.issues.length, 'j/k moves')}
          </Text>
        )}
      </Panel>
      <StatusBar {...footer(state, HINTS)} columns={columns} />
    </Box>
  )
}
