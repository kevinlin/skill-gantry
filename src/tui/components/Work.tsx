import { Box, Text, useWindowSize } from 'ink'
import { MIN_COLUMNS, MIN_ROWS, layoutFor, truncate, type Layout } from '../layout.js'
import { selectedSkill, type AppState } from '../store.js'
import { Help } from './Help.js'
import { LifecycleRail } from './LifecycleRail.js'
import { OutputPane } from './OutputPane.js'
import { QueuePanel } from './QueuePanel.js'
import { ReviewPane } from './ReviewPane.js'
import { SkillList } from './SkillList.js'
import { StatusBar } from './StatusBar.js'

/** Five keys, per the layered discoverability rule; the rest are behind `?`. */
const HINTS = 'j/k move · space mark · r run · x cancel · ? help · q quit'
/** The footer carries only keys this screen answers: `?` is swallowed while a
    review is pending, so advertising help here promised a screen that never came. */
const REVIEW_HINTS = 'a apply · d discard · j/k scroll · esc discard · q quit'

export function Work({ state }: { state: AppState }): React.ReactElement {
  // Re-renders on SIGWINCH, which is the whole point: every pane height below
  // is derived from these two numbers rather than from a constant.
  const { columns, rows } = useWindowSize()
  const layout = layoutFor(columns, rows)

  // Checked before both the too-small screen and help: app.tsx's keymap
  // answers `a`/`d` to whichever mutation is pending regardless of what else
  // is on screen, so the screen showing the diff has to be the one thing that
  // can be in front of it — otherwise `a` authorises a write whose diff the
  // user was never actually shown, R5.2's exact failure mode.
  if (state.pending) {
    return (
      <Box flexDirection="column" width={columns}>
        <ReviewPane pending={state.pending} layout={layout} displacedReviews={state.displacedReviews} />
        <StatusBar hints={REVIEW_HINTS} columns={columns} />
      </Box>
    )
  }

  if (layout.mode === 'too-small') {
    return (
      <Box flexDirection="column">
        <Text color="yellow">Terminal too small.</Text>
        <Text dimColor>
          SkillGantry needs {MIN_COLUMNS}×{MIN_ROWS}; this window is {columns}×{rows}.
        </Text>
      </Box>
    )
  }

  if (state.help) {
    return (
      <Box flexDirection="column" width={columns}>
        <Help layout={layout} />
        <StatusBar hints="esc or ? closes · q quits" columns={columns} />
      </Box>
    )
  }

  return (
    <Box flexDirection="column" width={columns}>
      <Header state={state} layout={layout} />
      {layout.mode === 'narrow' ? (
        <Stacked state={state} layout={layout} />
      ) : (
        <SideBySide state={state} layout={layout} />
      )}
      <QueuePanel
        jobs={state.jobs}
        selected={state.selectedJob}
        concurrency={state.concurrency}
        focused={state.focus === 'queue'}
        rows={layout.queueRows}
        width={columns}
        chrome={layout.chrome}
      />
      <StatusBar hints={HINTS} columns={columns} />
    </Box>
  )
}

/**
 * Context, not keys. The previous header spent 118 characters on a keybinding
 * wall that wrapped to three lines in a 60-column split.
 */
const NAME = 'SkillGantry'

function Header({ state, layout }: { state: AppState; layout: Layout }): React.ReactElement {
  const running = state.jobs.filter((job) => job.state === 'running').length
  const summary = `${state.skills.length} skill${state.skills.length === 1 ? '' : 's'} · ${running}/${state.concurrency} running`
  // Derived from the name rather than a literal 13: the two spaces around it
  // were counted by hand, so renaming the product would have overflowed the row.
  const room = Math.max(0, layout.columns - NAME.length - 2)
  return (
    <Box>
      <Text bold>{NAME}</Text>
      <Text dimColor> {truncate(summary, room)}</Text>
    </Box>
  )
}

function SideBySide({ state, layout }: { state: AppState; layout: Layout }): React.ReactElement {
  const skill = selectedSkill(state)
  const rightWidth = layout.columns - layout.skillListWidth
  return (
    <Box>
      <SkillList
        skills={state.skills}
        selected={state.selectedSkill}
        marked={state.markedSkills}
        focused={state.focus === 'skills'}
        width={layout.skillListWidth}
        height={layout.skillRows}
        chrome={layout.chrome}
      />
      <Box flexDirection="column" flexGrow={1}>
        <LifecycleRail
          skill={skill}
          selected={state.selectedStage}
          marked={state.markedStages}
          focused={state.focus === 'stages'}
          labels={layout.stageLabels}
          chrome={layout.chrome}
        />
        <OutputPane
          state={state}
          skill={skill}
          height={layout.outputHeight}
          width={rightWidth}
          chrome={layout.chrome}
          focused={state.focus === 'output'}
        />
      </Box>
    </Box>
  )
}

/** Below 76 columns the list moves above the rail instead of beside it. */
function Stacked({ state, layout }: { state: AppState; layout: Layout }): React.ReactElement {
  const skill = selectedSkill(state)
  return (
    <Box flexDirection="column">
      <SkillList
        skills={state.skills}
        selected={state.selectedSkill}
        marked={state.markedSkills}
        focused={state.focus === 'skills'}
        width={0}
        height={layout.skillRows}
        chrome={layout.chrome}
      />
      <LifecycleRail
        skill={skill}
        selected={state.selectedStage}
        marked={state.markedStages}
        focused={state.focus === 'stages'}
        labels={layout.stageLabels}
        chrome={layout.chrome}
      />
      <OutputPane
        state={state}
        skill={skill}
        height={layout.outputHeight}
        width={layout.columns}
        chrome={layout.chrome}
        focused={state.focus === 'output'}
      />
    </Box>
  )
}
