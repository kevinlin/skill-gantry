import { Box, Text } from 'ink'
import { STAGE_ORDER, type Stage } from '../../core/index.js'
import type { SkillRow } from '../store.js'

const LABEL: Record<Stage, string> = {
  validate: 'Validate',
  evaluate: 'Evaluate',
  security: 'Security',
  optimise: 'Optimise',
  release: 'Release',
}

export interface LifecycleRailProps {
  skill: SkillRow | undefined
  selected: number
  marked: readonly Stage[]
  focused: boolean
}

export function LifecycleRail({
  skill,
  selected,
  marked,
  focused,
}: LifecycleRailProps): React.ReactElement {
  return (
    <Box borderStyle="single" borderColor={focused ? 'cyan' : 'gray'} flexDirection="column">
      <Box>
        {STAGE_ORDER.map((stage, index) => (
          <Box key={stage} marginRight={1}>
            {/* Spread rather than `color={… : undefined}`: exactOptionalPropertyTypes
                rejects an explicit undefined for an optional prop. */}
            <Text underline={index === selected} {...(marked.includes(stage) ? { color: 'cyan' } : {})}>
              {marked.includes(stage) ? '*' : ' '}
              {LABEL[stage]}
            </Text>
          </Box>
        ))}
      </Box>
      <Box>
        {STAGE_ORDER.map((stage) => {
          const cell = skill?.stages[stage]
          const text = cell?.running === true ? 'running' : (cell?.outcome ?? '·')
          return (
            <Box key={stage} marginRight={1} width={LABEL[stage].length + 1}>
              <Text dimColor>{text}</Text>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
