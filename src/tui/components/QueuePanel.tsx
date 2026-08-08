import { Box, Text } from 'ink'
import type { JobRecord } from '../../core/index.js'
import { innerWidth, padCells, truncate, windowFor } from '../layout.js'
import { humanMs } from '../rows.js'
import { VERDICT_WIDTH, jobVerdict } from '../tokens.js'
import { useTicker } from '../use-ticker.js'
import { Panel } from './Panel.js'

/** Paired with the word, so the state survives a monochrome terminal. */
const MARK: Record<JobRecord['state'], string> = {
  queued: '⋯',
  running: '▶',
  done: '●',
  failed: '!',
  cancelled: '×',
}

/** `humanMs`'s widest output, `99m 59s`. */
const TIME_WIDTH = 7

/**
 * How long this job has been at it, or what it cost. A stage run is minutes
 * long and its log can go silent for most of them, so a queue row that says
 * only `running` leaves the user with no way to tell work from a hang.
 *
 * A job that has not started shows nothing rather than its time in the queue:
 * twenty rows each counting how long they have waited is noise around the one
 * or two rows that are actually doing something.
 */
function jobMs(job: JobRecord, now: number): number | null {
  if (job.startedAt === null) return null
  const ended = job.endedAt === null ? now : Date.parse(job.endedAt)
  return Math.max(0, ended - Date.parse(job.startedAt))
}

export interface QueuePanelProps {
  jobs: readonly JobRecord[]
  selected: number
  concurrency: number
  focused: boolean
  rows?: number
  width?: number
  chrome?: 'boxed' | 'bare'
}

export function QueuePanel({
  jobs,
  selected,
  concurrency,
  focused,
  rows = 5,
  width = 80,
  chrome = 'boxed',
}: QueuePanelProps): React.ReactElement {
  const active = jobs.filter((job) => job.state === 'running').length
  const pending = jobs.filter((job) => job.state === 'queued').length
  // Only while something is running: a finished job's time is fixed, and an
  // idle queue has nothing to count.
  useTicker(active > 0)
  const now = Date.now()
  const { start, end } = windowFor(jobs.length, selected, Math.max(1, rows))
  const hidden = jobs.length - (end - start)
  const cols = Math.max(12, innerWidth(width, chrome))
  // Cursor, space, mark, space, then the two fixed columns and the gap before
  // the time. What is left is the label's, and it is the same on every row —
  // which is the whole reason the time column can be read as a column.
  const labelWidth = Math.max(6, cols - 4 - VERDICT_WIDTH - 1 - TIME_WIDTH)

  const hint = [
    `${active}/${concurrency} running`,
    pending > 0 ? `${pending} waiting` : '',
    hidden > 0 ? `+${hidden} more` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Panel title="Queue" hint={hint} focused={focused} chrome={chrome} width={width}>
      {jobs.length === 0 && (
        <Text wrap="truncate" dimColor>
          nothing queued — space marks a skill, r runs it
        </Text>
      )}
      {jobs.slice(start, end).map((job, offset) => {
        const index = start + offset
        const ms = jobMs(job, now)
        const verdict = jobVerdict(job)
        return (
          <Box key={job.jobId}>
            <Text wrap="truncate" bold={index === selected}>
              {index === selected ? '›' : ' '}{' '}
              <Text color={verdict.colour}>
                {MARK[job.state]} {padCells(verdict.label, VERDICT_WIDTH)}
              </Text>{' '}
              {padCells(
                truncate(`${job.skillId} ${job.stages.join(',')}`, labelWidth),
                labelWidth,
              )}
              <Text dimColor>{(ms === null ? '' : humanMs(ms)).padStart(TIME_WIDTH)}</Text>
            </Text>
          </Box>
        )
      })}
    </Panel>
  )
}
