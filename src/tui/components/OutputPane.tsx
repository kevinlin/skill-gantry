import { useMemo } from 'react'
import { Box, Text } from 'ink'
import { innerWidth, truncate, truncateMiddle } from '../layout.js'
import { logDropped, logLines, outputWindow } from '../rows.js'
import { PANELS, type AppState, type SkillRow } from '../store.js'
import { ACCENT, SEVERITY_COLOUR, overflowNotice } from '../tokens.js'
import { Panel } from './Panel.js'

const TITLE: Record<(typeof PANELS)[number], string> = {
  log: 'Log',
  findings: 'Findings',
  artefacts: 'Artefacts',
  skill: 'SKILL.md',
}

/** Rows the pane body can show; the ring buffer holds far more than this. */
const VISIBLE = 12

export interface OutputPaneProps {
  state: AppState
  skill: SkillRow | undefined
  height?: number
  width?: number
  chrome?: 'boxed' | 'bare'
  /** A focus stop like the other three panels: `j`/`k` scroll the tab that is up. */
  focused?: boolean
}

/** No title row: the tab strip is the panel's own heading. */
export function OutputPane({
  state,
  skill,
  height = VISIBLE,
  width = 80,
  chrome = 'boxed',
  focused = false,
}: OutputPaneProps): React.ReactElement {
  return (
    <Panel
      focused={focused}
      chrome={chrome}
      grow
      // The rail above owns this edge. Two adjacent boxes each drawing their
      // own horizontal rule spent two rows on one seam.
      borderTop={false}
    >
      <Box>
        {PANELS.map((panel, index) => (
          <Box key={panel} marginRight={2} flexShrink={0}>
            <Text wrap="truncate" bold={state.panel === panel} dimColor={state.panel !== panel}>
              {/* Spread rather than an explicit undefined, which
                  exactOptionalPropertyTypes rejects for an optional prop. */}
              <Text {...(state.panel === panel ? { color: ACCENT } : {})}>{index + 1}</Text>{' '}
              {TITLE[panel]}
            </Text>
          </Box>
        ))}
      </Box>
      <Body
        state={state}
        skill={skill}
        height={height}
        width={width}
        chrome={chrome}
        focused={focused}
      />
    </Panel>
  )
}

function Body({
  state,
  skill,
  height,
  width,
  chrome,
  focused,
}: Required<OutputPaneProps>): React.ReactElement {
  // Every pane truncates rather than wraps: one wrapped line pushes the pane
  // past its budget and the panel below it off the screen.
  const cols = Math.max(8, innerWidth(width, chrome))
  // A SKILL.md is tens of kilobytes and changes only when the selection does,
  // but the pane re-renders on every keypress and log flush.
  const skillMdLines = useMemo(() => state.skillMd.split('\n'), [state.skillMd])
  // Both footnotes below cost a row like any other, and `outputWindow` has
  // already taken them out of the count — counting them against the allocation
  // rather than adding them under it is what keeps the queue panel on an 80x24.
  const view = outputWindow(state, skill, height)

  // The recovery differs by whether the keys are live: telling a user to press
  // `j` while the focus is on the skill list describes a key that does something
  // else entirely.
  const notice = view.overflow ? (
    <Text wrap="truncate" dimColor>
      {truncate(
        overflowNotice(
          view.start,
          view.end,
          view.total,
          focused ? 'j/k scrolls' : 'tab focuses this pane',
        ),
        cols,
      )}
    </Text>
  ) : null

  if (state.panel === 'log') {
    const lines = logLines(state, skill).slice(view.start, view.end)
    if (lines.length === 0 && !view.dropped) {
      // A rehydrated run whose tools wrote no log at all still has a directory
      // to name; a skill that has never run has neither. The path is cut, not
      // the sentence: eliding the middle of the whole row loses the words that
      // say why the pane is empty.
      return (
        <Text dimColor wrap="truncate">
          {skill?.runDir
            ? `no recorded output — run directory ${truncateMiddle(skill.runDir, Math.max(12, cols - 34))}`
            : 'no output yet — select a skill and press r'}
        </Text>
      )
    }
    return (
      <Box flexDirection="column">
        {lines.map((line, index) => (
          <Text key={`${view.start + index}-${line}`} wrap="truncate">
            {truncate(line, cols)}
          </Text>
        ))}
        {notice}
        {view.dropped && (
          <Text wrap="truncate" dimColor>
            {truncate(
              `${logDropped(state, skill)} earlier lines dropped — full log under ${
                skill?.runDir ?? skill?.workspacePath ?? 'the run directory'
              }`,
              cols,
            )}
          </Text>
        )}
      </Box>
    )
  }

  if (state.panel === 'findings') {
    if (!skill || skill.findings.length === 0) return <Text dimColor>no findings</Text>
    return (
      <Box flexDirection="column">
        {skill.findings.slice(view.start, view.end).map((finding, index) => (
          <Text
            key={`${view.start + index}-${finding.path}-${finding.nativeRuleId}`}
            wrap="truncate"
          >
            <Text color={SEVERITY_COLOUR[finding.severity] ?? 'red'}>{finding.severity}</Text>{' '}
            {truncate(
              `${finding.ruleClass} ${finding.path} ${finding.message}`,
              cols - finding.severity.length - 1,
            )}
          </Text>
        ))}
        {notice}
      </Box>
    )
  }

  if (state.panel === 'artefacts') {
    if (state.artefacts.length === 0) return <Text dimColor>no artefacts yet</Text>
    return (
      <Box flexDirection="column">
        {state.artefacts.slice(view.start, view.end).map((path) => (
          // Middle truncation: the basename is what identifies an artefact.
          <Text key={path} wrap="truncate">
            {truncateMiddle(path, cols)}
          </Text>
        ))}
        {notice}
      </Box>
    )
  }

  if (state.skillMd.length === 0) return <Text dimColor>no SKILL.md loaded</Text>
  return (
    <Box flexDirection="column">
      {skillMdLines.slice(view.start, view.end).map((line, index) => (
        <Text key={`${view.start + index}-${line}`} wrap="truncate">
          {truncate(line, cols)}
        </Text>
      ))}
      {notice}
    </Box>
  )
}
