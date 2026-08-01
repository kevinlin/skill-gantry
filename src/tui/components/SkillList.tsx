import { Box, Text } from 'ink'
import type { SkillRow, SkillStatus } from '../store.js'

const MARK: Record<SkillStatus, string> = {
  idle: '○',
  running: '◐',
  passed: '●',
  failed: '!',
  errored: '×',
}

const COLOUR: Record<SkillStatus, string> = {
  idle: 'gray',
  running: 'cyan',
  passed: 'green',
  failed: 'red',
  errored: 'yellow',
}

export interface SkillListProps {
  skills: readonly SkillRow[]
  selected: number
  marked: readonly string[]
  focused: boolean
}

export function SkillList({
  skills,
  selected,
  marked,
  focused,
}: SkillListProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      width={24}
      borderStyle="single"
      borderColor={focused ? 'cyan' : 'gray'}
    >
      <Text bold>Skills</Text>
      {skills.map((skill, index) => (
        <Text key={skill.skillId}>
          {index === selected ? '›' : ' '}
          {marked.includes(skill.skillId) ? '*' : ' '}
          <Text color={COLOUR[skill.status]}>{MARK[skill.status]}</Text> {skill.label}
        </Text>
      ))}
    </Box>
  )
}
