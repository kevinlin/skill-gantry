import { Box, Text } from 'ink'
import type { JobRecord } from '../../core/index.js'
import { innerWidth, truncate, windowFor } from '../layout.js'
import { JOB_COLOUR } from '../tokens.js'
import { Panel } from './Panel.js'

/** Paired with the word, so the state survives a monochrome terminal. */
const MARK: Record<JobRecord['state'], string> = {
  queued: '⋯',
  running: '▶',
  done: '●',
  failed: '!',
  cancelled: '×',
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
  const { start, end } = windowFor(jobs.length, selected, Math.max(1, rows))
  const hidden = jobs.length - (end - start)
  const cols = Math.max(12, innerWidth(width, chrome))

  const hint = [
    `${active}/${concurrency} running`,
    pending > 0 ? `${pending} waiting` : '',
    hidden > 0 ? `+${hidden} more` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Panel title="Queue" hint={hint} focused={focused} chrome={chrome}>
      {jobs.length === 0 && (
        <Text wrap="truncate" dimColor>
          nothing queued
        </Text>
      )}
      {jobs.slice(start, end).map((job, offset) => {
        const index = start + offset
        return (
          <Box key={job.jobId}>
            <Text wrap="truncate" bold={index === selected}>
              {index === selected ? '›' : ' '}{' '}
              <Text color={JOB_COLOUR[job.state]}>
                {MARK[job.state]} {job.state}
              </Text>{' '}
              {truncate(`${job.skillId} ${job.stages.join(',')}`, cols - job.state.length - 5)}
            </Text>
          </Box>
        )
      })}
    </Panel>
  )
}
