import { Box, Text, useInput, useStdout } from 'ink'
import { ACCENT, STATUS } from './tokens.js'
import { Panel } from './components/Panel.js'
import { truncate } from './layout.js'

export interface UpgradeAppProps {
  fromVersion: string
  toVersion: string
  publishedAt: string
  entries: readonly { version: string; lines: readonly string[] }[]
  installPath: string
  onAnswer: (answer: 'upgrade' | 'skip') => void
}

/** Frame, header, blank, the two footer rows, and the panel's own two edges. */
const CHROME_ROWS = 8
const MIN_WIDTH = 40
const MIN_NOTE_ROWS = 1

/** `2026-08-14T10:00:00Z` → `2026-08-14`; anything else renders as it arrived. */
const releasedOn = (iso: string): string => iso.slice(0, 10)

/**
 * §14.13. Props in, one answer out. No filesystem, no spawn, no ledger — the
 * caller in `src/cli/` did the check and acts on the answer.
 */
export function UpgradeApp({
  fromVersion,
  toVersion,
  publishedAt,
  entries,
  installPath,
  onAnswer,
}: UpgradeAppProps): React.ReactElement {
  const { stdout } = useStdout()
  const columns = Math.max(MIN_WIDTH, stdout?.columns ?? 80)
  const rows = stdout?.rows ?? 24
  const width = Math.min(columns, 78)
  const inner = width - 4

  // Two keys, and deliberately no third: `n` already reaches the main screen,
  // so a quit key here exists only to be hit by mistake (R11.24).
  useInput((input) => {
    if (input === 'y') onAnswer('upgrade')
    else if (input === 'n') onAnswer('skip')
  })

  // The frame and the footer take their rows first; the notes take what is
  // left and report what they dropped, the shape the Findings pane already
  // uses (§14.1: the footnote is spent out of the allocation, never below it).
  const flat = entries.flatMap((entry) => [
    { kind: 'version' as const, text: entry.version },
    ...entry.lines.map((line) => ({ kind: 'line' as const, text: line })),
  ])
  const room = Math.max(MIN_NOTE_ROWS, rows - CHROME_ROWS)
  const shown = flat.length <= room ? flat : flat.slice(0, Math.max(MIN_NOTE_ROWS, room - 1))
  const dropped = flat.length - shown.length

  return (
    <Panel focused chrome="boxed" title="upgrade available" width={width}>
      <Text wrap="truncate">
        <Text color={ACCENT}>{fromVersion}</Text>
        <Text color={STATUS.secondary}>{'  ->  '}</Text>
        <Text color={ACCENT} bold>
          {toVersion}
        </Text>
        {publishedAt.length === 0 ? null : (
          <Text color={STATUS.secondary}>{`   released ${releasedOn(publishedAt)}`}</Text>
        )}
      </Text>
      <Text> </Text>
      <Box flexDirection="column">
        {shown.map((row, index) =>
          row.kind === 'version' ? (
            <Text key={`v-${row.text}-${String(index)}`} bold>
              {truncate(row.text, inner)}
            </Text>
          ) : (
            <Text key={`l-${row.text}-${String(index)}`} color={STATUS.secondary}>
              {truncate(`- ${row.text}`, inner)}
            </Text>
          ),
        )}
        {dropped > 0 && <Text color={STATUS.muted}>{`… ${String(dropped)} more`}</Text>}
      </Box>
      <Text> </Text>
      <Text wrap="truncate" color={STATUS.secondary}>
        {truncate(`installs to ${installPath}`, inner)}
      </Text>
      <Text wrap="truncate">
        <Text color={STATUS.secondary}>and relaunches. </Text>
        <Text color={ACCENT}>y</Text>
        <Text color={STATUS.secondary}> upgrade </Text>
        <Text color={ACCENT}>n</Text>
        <Text color={STATUS.secondary}> skip</Text>
      </Text>
    </Panel>
  )
}
