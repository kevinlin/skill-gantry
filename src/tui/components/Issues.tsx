import { Box, Text, useWindowSize } from 'ink'
import {
  innerWidth,
  layoutFor,
  screenBodyRows,
  truncate,
  truncateMiddle,
  windowFor,
} from '../layout.js'
import type { AppState } from '../store.js'
import { SEVERITY_COLOUR, overflowNotice } from '../tokens.js'
import { Panel } from './Panel.js'

// `q quit` included because `q` does quit from here: every other screen's
// footer said so and this one did not, which made the key look screen-specific.
const HINTS =
  'j/k move · a ack · w wontfix · o reopen · f filter · : commands · esc work · q quit'

/** Paired with the word, so the state survives a monochrome terminal. */
const STATE_MARK: Record<string, string> = {
  open: '●',
  acknowledged: '◐',
  wontfix: '×',
  fixed: '○',
}

export function Issues({ state }: { state: AppState }): React.ReactElement {
  const { columns, rows } = useWindowSize()
  const layout = layoutFor(columns, rows)
  const cols = Math.max(20, innerWidth(columns, layout.chrome))
  const budget = screenBodyRows(layout)
  const overflow = state.issues.length > budget
  const height = overflow ? Math.max(1, budget - 1) : budget
  const { start, end } = windowFor(state.issues.length, state.selectedIssue, height)

  // Fixed left columns, path last: the path is the only field that can be
  // arbitrarily long, so it is the only one that should absorb the truncation.
  const severityWidth = 9
  const stateWidth = 14
  const skillWidth = Math.min(24, Math.max(10, Math.floor(cols * 0.22)))
  // The rule class gets its own column rather than sharing the path's: the path
  // is elided from the head so its basename survives, which ate the rule class
  // when the two shared one field — and the rule class is what names the issue.
  const ruleWidth = Math.min(18, Math.max(8, Math.floor(cols * 0.2)))
  const pathWidth = Math.max(8, cols - severityWidth - stateWidth - skillWidth - ruleWidth - 4)

  return (
    <Box flexDirection="column" width={columns}>
      <Panel
        title="Issues"
        hint={`${state.issues.length} · ${state.issueFilter.state ?? 'every state'}`}
        focused
        chrome={layout.chrome}
      >
        {state.viewError !== null && (
          <Text color="red" wrap="truncate">
            {truncate(`ledger read failed: ${state.viewError}`, cols)}
          </Text>
        )}
        {state.viewError === null && state.issues.length === 0 && (
          <Text dimColor wrap="truncate">
            no issues match this filter
          </Text>
        )}
        {state.issues.slice(start, end).map((row, offset) => {
          const index = start + offset
          // The detectors that have not since reported a conclusive absence —
          // R8.8's blockers, so "why is this still open" is on the row.
          const blocked = row.blockedBy.length === 0 ? '' : ` ⟂ ${row.blockedBy.join(',')}`
          return (
            <Box key={row.fingerprint}>
              <Text wrap="truncate" bold={index === state.selectedIssue}>
                {index === state.selectedIssue ? '›' : ' '}{' '}
                <Text color={SEVERITY_COLOUR[row.severity] ?? 'gray'}>
                  {row.severity.padEnd(severityWidth)}
                </Text>
                <Text>{`${STATE_MARK[row.state] ?? '?'} ${row.state}`.padEnd(stateWidth)}</Text>
                <Text>{truncate(row.skillId, skillWidth).padEnd(skillWidth)}</Text>
                <Text>{truncate(row.ruleClass, ruleWidth).padEnd(ruleWidth)}</Text>
                <Text dimColor>{truncateMiddle(`${row.relPath}${blocked}`, pathWidth)}</Text>
              </Text>
            </Box>
          )
        })}
        {overflow && (
          <Text dimColor wrap="truncate">
            {overflowNotice(start, end, state.issues.length, 'j/k moves')}
          </Text>
        )}
      </Panel>
      <Text dimColor>{truncate(HINTS, columns)}</Text>
    </Box>
  )
}
