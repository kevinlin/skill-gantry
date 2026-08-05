import { Text } from 'ink'
import { innerWidth, truncate, windowFor } from '../layout.js'
import type { SkillRow, SkillStatus } from '../store.js'
import { OUTCOME_COLOUR } from '../tokens.js'
import { useTicker } from '../use-ticker.js'
import { Panel } from './Panel.js'

/** Glyph and colour both carry the status: the screen reads in monochrome. */
const MARK: Record<SkillStatus, string> = {
  idle: '○',
  running: '◐',
  passed: '●',
  failed: '!',
  errored: '×',
}

/**
 * The running mark turns. A stage takes minutes and its log can go quiet for
 * most of them, so on a still screen the only difference between working and
 * hung was a glyph that also sits still. Turning the mark the list already uses
 * rather than adding a spinner beside it keeps the column one cell wide and
 * keeps the shape the user learned; the first phase is the resting `◐`, so a
 * terminal that never repaints loses nothing.
 */
const TURNING = ['◐', '◓', '◑', '◒'] as const

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
  const tick = useTicker(skills.some((skill) => skill.status === 'running'))
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
            <Text color={OUTCOME_COLOUR[skill.status] ?? 'gray'}>
              {skill.status === 'running'
                ? TURNING[tick % TURNING.length]
                : MARK[skill.status]}
            </Text>{' '}
            {truncate(skill.label, labelWidth)}
          </Text>
        )
      })}
    </Panel>
  )
}
