import { useMemo } from 'react'
import { Box, Text } from 'ink'
import { innerWidth, truncate, truncateMiddle } from '../layout.js'
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
}

/** No title row: the tab strip is the panel's own heading. */
export function OutputPane({
  state,
  skill,
  height = VISIBLE,
  width = 80,
  chrome = 'boxed',
}: OutputPaneProps): React.ReactElement {
  return (
    <Panel
      focused={false}
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
      <Body state={state} skill={skill} height={height} width={width} chrome={chrome} />
    </Panel>
  )
}

function Body({ state, skill, height, width, chrome }: Required<OutputPaneProps>): React.ReactElement {
  // Every pane truncates rather than wraps: one wrapped line pushes the pane
  // past its budget and the panel below it off the screen.
  const cols = Math.max(8, innerWidth(width, chrome))
  // A SKILL.md is tens of kilobytes and changes only when the selection does,
  // but the pane re-renders on every keypress and log flush.
  const skillMdLines = useMemo(() => state.skillMd.split('\n'), [state.skillMd])

  if (state.panel === 'log') {
    // A footnote costs a row like any other. Counting it against `height`
    // rather than adding it below is what keeps the pane inside its budget —
    // one extra row here pushes the queue panel off the bottom of an 80x24.
    const notice = state.log.dropped > 0
    const lines = state.log.lines.slice(-Math.max(1, height - (notice ? 1 : 0)))
    if (lines.length === 0 && !notice) {
      return <Text dimColor>no output yet — select a skill and press r</Text>
    }
    return (
      <Box flexDirection="column">
        {lines.map((line, index) => (
          <Text key={`${index}-${line}`} wrap="truncate">
            {truncate(line, cols)}
          </Text>
        ))}
        {notice && (
          <Text wrap="truncate" dimColor>
            {truncate(
              `${state.log.dropped} earlier lines dropped — full log under ${
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
    const overflow = skill.findings.length > height
    const shown = skill.findings.slice(0, Math.max(1, height - (overflow ? 1 : 0)))
    return (
      <Box flexDirection="column">
        {shown.map((finding, index) => (
          <Text key={`${finding.path}-${finding.nativeRuleId}-${index}`} wrap="truncate">
            <Text color={SEVERITY_COLOUR[finding.severity] ?? 'red'}>{finding.severity}</Text>{' '}
            {truncate(
              `${finding.ruleClass} ${finding.path} ${finding.message}`,
              cols - finding.severity.length - 1,
            )}
          </Text>
        ))}
        {overflow && (
          <Text wrap="truncate" dimColor>
            {truncate(
              overflowNotice(0, shown.length, skill.findings.length, 'a taller window shows more'),
              cols,
            )}
          </Text>
        )}
      </Box>
    )
  }

  if (state.panel === 'artefacts') {
    if (state.artefacts.length === 0) return <Text dimColor>no artefacts yet</Text>
    // Silent before this: a run writing more artefacts than the pane is tall
    // showed the first N and nothing to say there were others, so a user looking
    // for a report the stage did write concluded it had not.
    const overflow = state.artefacts.length > height
    const shown = state.artefacts.slice(0, Math.max(1, height - (overflow ? 1 : 0)))
    return (
      <Box flexDirection="column">
        {shown.map((path) => (
          // Middle truncation: the basename is what identifies an artefact.
          <Text key={path} wrap="truncate">
            {truncateMiddle(path, cols)}
          </Text>
        ))}
        {overflow && (
          <Text wrap="truncate" dimColor>
            {truncate(
              overflowNotice(0, shown.length, state.artefacts.length, 'a taller window shows more'),
              cols,
            )}
          </Text>
        )}
      </Box>
    )
  }

  if (state.skillMd.length === 0) return <Text dimColor>no SKILL.md loaded</Text>
  // A SKILL.md runs to hundreds of lines, so this pane is almost always cut. It
  // said so nowhere, which made a frontmatter-only preview look like the whole
  // file.
  const skillMdOverflow = skillMdLines.length > height
  const skillMdShown = skillMdLines.slice(0, Math.max(1, height - (skillMdOverflow ? 1 : 0)))
  return (
    <Box flexDirection="column">
      {skillMdShown.map((line, index) => (
        <Text key={`${index}-${line}`} wrap="truncate">
          {truncate(line, cols)}
        </Text>
      ))}
      {skillMdOverflow && (
        <Text wrap="truncate" dimColor>
          {truncate(
            overflowNotice(0, skillMdShown.length, skillMdLines.length, 'a taller window shows more'),
            cols,
          )}
        </Text>
      )}
    </Box>
  )
}
