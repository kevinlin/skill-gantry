import { Box, Text } from 'ink'
import { PANELS, type AppState, type SkillRow } from '../store.js'

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
}

export function OutputPane({
  state,
  skill,
  height = VISIBLE,
}: OutputPaneProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" flexGrow={1}>
      <Box>
        {PANELS.map((panel, index) => (
          <Box key={panel} marginRight={1}>
            <Text inverse={state.panel === panel}>
              {index + 1} {TITLE[panel]}
            </Text>
          </Box>
        ))}
      </Box>
      <Body state={state} skill={skill} height={height} />
    </Box>
  )
}

function Body({ state, skill, height }: Required<OutputPaneProps>): React.ReactElement {
  if (state.panel === 'log') {
    return (
      <Box flexDirection="column">
        {state.log.lines.slice(-height).map((line, index) => (
          <Text key={`${index}-${line}`}>{line}</Text>
        ))}
        {state.log.dropped > 0 && (
          <Text dimColor>
            {state.log.dropped} earlier lines dropped — full log under{' '}
            {skill?.runDir ?? skill?.workspacePath ?? 'the run directory'}
          </Text>
        )}
      </Box>
    )
  }

  if (state.panel === 'findings') {
    if (!skill || skill.findings.length === 0) return <Text dimColor>no findings</Text>
    return (
      <Box flexDirection="column">
        {skill.findings.slice(0, height).map((finding, index) => (
          <Text key={`${finding.path}-${finding.nativeRuleId}-${index}`}>
            <Text color="red">{finding.severity}</Text> {finding.ruleClass} {finding.path}{' '}
            {finding.message}
          </Text>
        ))}
      </Box>
    )
  }

  if (state.panel === 'artefacts') {
    if (state.artefacts.length === 0) return <Text dimColor>no artefacts yet</Text>
    return (
      <Box flexDirection="column">
        {state.artefacts.slice(0, height).map((path) => (
          <Text key={path}>{path}</Text>
        ))}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {state.skillMd
        .split('\n')
        .slice(0, height)
        .map((line, index) => (
          <Text key={`${index}-${line}`}>{line}</Text>
        ))}
    </Box>
  )
}
