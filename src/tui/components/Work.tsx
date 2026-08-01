import { Box, Text } from 'ink'
import { selectedSkill, type AppState } from '../store.js'
import { LifecycleRail } from './LifecycleRail.js'
import { OutputPane } from './OutputPane.js'
import { QueuePanel } from './QueuePanel.js'
import { SkillList } from './SkillList.js'

export function Work({ state }: { state: AppState }): React.ReactElement {
  const skill = selectedSkill(state)
  return (
    <Box flexDirection="column">
      <Text bold>
        SkillGantry — Work — concurrency {state.concurrency} — j/k skills, h/l stages, space marks, r
        runs, x cancels, tab focus, 1-4 panes, q quits
      </Text>
      <Box>
        <SkillList
          skills={state.skills}
          selected={state.selectedSkill}
          marked={state.markedSkills}
          focused={state.focus === 'skills'}
        />
        <Box flexDirection="column" flexGrow={1}>
          <LifecycleRail
            skill={skill}
            selected={state.selectedStage}
            marked={state.markedStages}
            focused={state.focus === 'stages'}
          />
          <OutputPane state={state} skill={skill} />
        </Box>
      </Box>
      <QueuePanel
        jobs={state.jobs}
        selected={state.selectedJob}
        concurrency={state.concurrency}
        focused={state.focus === 'queue'}
      />
    </Box>
  )
}
