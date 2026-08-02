import { Text } from 'ink'
import { innerWidth, truncate, windowFor } from '../layout.js'
import type { SkillRow, SkillStatus } from '../store.js'
import { Panel } from './Panel.js'

/** Glyph and colour both carry the status: the screen reads in monochrome. */
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
  /** 0 means "fill the row", used when the list is stacked above the rail. */
  width?: number
  height?: number
  chrome?: 'boxed' | 'bare'
}

export function SkillList({
  skills,
  selected,
  marked,
  focused,
  width = 22,
  height = skills.length,
  chrome = 'boxed',
}: SkillListProps): React.ReactElement {
  const { start, end } = windowFor(skills.length, selected, Math.max(1, height))
  const hidden = skills.length - (end - start)
  // Cursor, mark, glyph and two spaces, inside whatever the chrome leaves.
  const GUTTER = 5
  const labelWidth = Math.max(4, innerWidth(width > 0 ? width : 40, chrome) - GUTTER)

  // The overflow count rides the title rather than taking a row of its own:
  // a panel that is one row taller than its budget pushes the next one off.
  const hint = [
    skills.length === 0 ? '' : `${selected + 1}/${skills.length}`,
    marked.length > 0 ? `${marked.length} marked` : '',
    hidden > 0 ? `+${hidden} more` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Panel title="Skills" hint={hint} focused={focused} chrome={chrome} width={width}>
      {skills.length === 0 && (
        <Text wrap="truncate" dimColor>
          no skills — register a repo
        </Text>
      )}
      {skills.slice(start, end).map((skill, offset) => {
        const index = start + offset
        return (
          // Cursor glyph plus weight, not reverse video: an inverse block only
          // covers the label, so a short name left the highlight ragged.
          <Text key={skill.skillId} wrap="truncate" bold={index === selected}>
            {index === selected ? '›' : ' '}
            {marked.includes(skill.skillId) ? '*' : ' '}
            <Text color={COLOUR[skill.status]}>{MARK[skill.status]}</Text>{' '}
            {truncate(skill.label, labelWidth)}
          </Text>
        )
      })}
    </Panel>
  )
}
