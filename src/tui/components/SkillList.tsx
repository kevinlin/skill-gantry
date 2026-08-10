import { Text } from 'ink'
import { innerWidth, padCells, truncate, windowFor } from '../layout.js'
import { repoSummary, type ListLevel, type RepoRow, type SkillRow, type SkillStatus } from '../store.js'
import { OUTCOME_COLOUR, STATUS } from '../tokens.js'
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
  /** R11.23. Which level is showing, and the repo level's rows and cursor. */
  level: ListLevel
  repos: readonly RepoRow[]
  selectedRepo: number
  /** 0 means "fill the row", used when the list is stacked above the rail. */
  width?: number
  height?: number
  chrome?: 'boxed' | 'bare'
}

/** Cursor, mark, glyph and two spaces, inside whatever the chrome leaves. */
const GUTTER = 5

/**
 * The count's column, derived from the counts actually on screen rather than
 * reserved: a constant wide enough for three digits took a cell off every repo
 * name on every machine that has fewer than a hundred skills in a repo, which
 * is the reservation §14.6 already paid for once in `overviewRows`' bar. Plus
 * one cell, which is the gap between the name and the number.
 */
const countWidth = (repos: readonly RepoRow[]): number =>
  Math.max(...repos.map((repo) => String(repo.count).length), 0) + 1

export function SkillList({
  skills,
  selected,
  marked,
  focused,
  level,
  repos,
  selectedRepo,
  width = 22,
  height = skills.length,
  chrome = 'boxed',
}: SkillListProps): React.ReactElement {
  const tick = useTicker(skills.some((skill) => skill.status === 'running'))
  const labelWidth = Math.max(4, innerWidth(width > 0 ? width : 40, chrome) - GUTTER)
  const rows = Math.max(1, height)

  if (level === 'repos') {
    return (
      <RepoLevel
        skills={skills}
        marked={marked}
        repos={repos}
        selected={selectedRepo}
        focused={focused}
        labelWidth={labelWidth}
        rows={rows}
        width={width}
        chrome={chrome}
        tick={tick}
      />
    )
  }

  // The skill level shows one repo, so the window and the counts are that
  // repo's (R11.23). With no repos, or one, this is the whole array — which is
  // why a single-repo machine renders exactly what it rendered before.
  const repo = repos.find((row) => selected >= row.start && selected < row.start + row.count)
  const first = repo?.start ?? 0
  const total = repo?.count ?? skills.length
  const window = windowFor(total, selected - first, rows)
  const hidden = total - (window.end - window.start)

  // The overflow count rides the title rather than taking a row of its own:
  // a panel that is one row taller than its budget pushes the next one off.
  const hint = [
    total === 0 ? '' : `${selected - first + 1}/${total}`,
    marked.length > 0 ? `${marked.length} marked` : '',
    hidden > 0 ? `+${hidden} more` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    // The title names the level (R11.23), which is the whole "where am I"
    // affordance and costs nothing: §14.6 already put a titled panel's heading
    // in its top border. `Skills` only when there is no repo to name.
    <Panel
      title={repo?.label ?? 'Skills'}
      hint={hint}
      focused={focused}
      chrome={chrome}
      width={width}
    >
      {skills.length === 0 && (
        <Text wrap="truncate" dimColor>
          no skills — register a repo
        </Text>
      )}
      {skills.slice(first + window.start, first + window.end).map((skill, offset) => {
        const index = first + window.start + offset
        return (
          // Reverse video over a padded label, not bold alone. The earlier note
          // here said an inverse block "only covers the label, so a short name
          // left the highlight ragged" — true, and `padCells` is the fix rather
          // than a reason to go without (R11.15).
          <Text
            key={skill.skillId}
            wrap="truncate"
            inverse={index === selected}
            bold={index === selected}
          >
            {index === selected ? '▸' : ' '}
            {marked.includes(skill.skillId) ? '*' : ' '}
            <Text color={OUTCOME_COLOUR[skill.status] ?? STATUS.muted}>
              {skill.status === 'running'
                ? TURNING[tick % TURNING.length]
                : MARK[skill.status]}
            </Text>{' '}
            {index === selected
              ? padCells(truncate(skill.label, labelWidth), labelWidth)
              : truncate(skill.label, labelWidth)}
          </Text>
        )
      })}
    </Panel>
  )
}

/**
 * R11.23's first level. The same frame, the same gutter and the same windowing
 * as the skill level — the only new content is the skill count, and the mark
 * column now says "some skill in here is marked", which is the one fact
 * collapsing a repo costs the user and the one cell that was already paid for.
 */
function RepoLevel({
  skills,
  marked,
  repos,
  selected,
  focused,
  labelWidth,
  rows,
  width,
  chrome,
  tick,
}: {
  skills: readonly SkillRow[]
  marked: readonly string[]
  repos: readonly RepoRow[]
  selected: number
  focused: boolean
  labelWidth: number
  rows: number
  width: number
  chrome: 'boxed' | 'bare'
  tick: number
}): React.ReactElement {
  const { start, end } = windowFor(repos.length, selected, rows)
  const hidden = repos.length - (end - start)
  // The name gives way to the count, not the other way round: a repo with no
  // number beside it is a row that has stopped answering what the level is for.
  const nameWidth = Math.max(4, labelWidth - countWidth(repos))

  const hint = [
    repos.length === 0 ? '' : `${selected + 1}/${repos.length}`,
    hidden > 0 ? `+${hidden} more` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Panel title="Repos" hint={hint} focused={focused} chrome={chrome} width={width}>
      {repos.length === 0 && (
        <Text wrap="truncate" dimColor>
          no repos — register one with :setup
        </Text>
      )}
      {repos.slice(start, end).map((repo, offset) => {
        const index = start + offset
        const summary = repoSummary(skills, marked, repo)
        // `padCells` right-pads, so the name takes its column and the count is
        // left-padded into the rest — digits being one cell each, `padStart` is
        // safe here in a way it would not be for a name.
        const label =
          padCells(truncate(repo.label, nameWidth), nameWidth) +
          String(summary.count).padStart(labelWidth - nameWidth)
        return (
          <Text
            key={repo.repoId}
            wrap="truncate"
            inverse={index === selected}
            bold={index === selected}
          >
            {index === selected ? '▸' : ' '}
            {summary.marked ? '*' : ' '}
            <Text color={OUTCOME_COLOUR[summary.status] ?? STATUS.muted}>
              {summary.status === 'running' ? TURNING[tick % TURNING.length] : MARK[summary.status]}
            </Text>{' '}
            {padCells(label, labelWidth)}
          </Text>
        )
      })}
    </Panel>
  )
}
