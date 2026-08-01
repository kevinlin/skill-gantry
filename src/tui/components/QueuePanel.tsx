import { Box, Text } from 'ink'
import type { JobRecord } from '../../core/index.js'

const COLOUR: Record<JobRecord['state'], string> = {
  queued: 'gray',
  running: 'cyan',
  done: 'green',
  failed: 'red',
  cancelled: 'yellow',
}

export interface QueuePanelProps {
  jobs: readonly JobRecord[]
  selected: number
  concurrency: number
  focused: boolean
  rows?: number
}

export function QueuePanel({
  jobs,
  selected,
  concurrency,
  focused,
  rows = 5,
}: QueuePanelProps): React.ReactElement {
  const active = jobs.filter((job) => job.state === 'running').length
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={focused ? 'cyan' : 'gray'}>
      <Text bold>
        Queue {active}/{concurrency} running — x cancels
      </Text>
      {jobs.length === 0 && <Text dimColor>nothing queued</Text>}
      {jobs.slice(-rows).map((job, index) => (
        <Text key={job.jobId}>
          {index + Math.max(0, jobs.length - rows) === selected ? '›' : ' '}{' '}
          <Text color={COLOUR[job.state]}>{job.state}</Text> {job.skillId}{' '}
          <Text dimColor>{job.stages.join(',')}</Text>
        </Text>
      ))}
    </Box>
  )
}
