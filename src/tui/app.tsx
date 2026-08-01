import { Text } from 'ink'
import type { QueueHandle, SkillRef, Stage } from '../core/index.js'

export interface AppProps {
  skills: readonly SkillRef[]
  queue: QueueHandle
  stages: readonly Stage[]
  concurrency: number
  intervalMs?: number
}

/** Placeholder. Task 10 replaces this with the Work screen. */
export function App(props: AppProps): React.ReactElement {
  return <Text>SkillGantry — {props.skills.length} skills</Text>
}
