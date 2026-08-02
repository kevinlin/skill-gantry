import { useEffect, useReducer, useRef } from 'react'
import { useApp, useInput } from 'ink'
import type { QueueHandle, SkillRef, Stage } from '../core/index.js'
import { Work } from './components/Work.js'
import { LogPump } from './log-buffer.js'
import { PANELS, initialState, reducer, selectedSkill } from './store.js'
import { listArtefacts, loadSkillMd, loadSkillStatuses } from './views.js'

export interface AppProps {
  skills: readonly SkillRef[]
  queue: QueueHandle
  /** Stages enqueued when the user has marked none. */
  stages: readonly Stage[]
  concurrency: number
  /** Flush interval, lowered in tests. */
  intervalMs?: number
}

export function App({
  skills,
  queue,
  stages,
  concurrency,
  intervalMs,
}: AppProps): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, skills, (list) => initialState(list, concurrency))
  const { exit } = useApp()
  const byId = useRef(new Map(skills.map((skill) => [skill.id, skill])))

  const pump = useRef<LogPump | null>(null)
  if (pump.current === null) {
    pump.current = new LogPump({
      ...(intervalMs === undefined ? {} : { intervalMs }),
      onFlush: (lines, dropped) => dispatch({ type: 'log-flush', lines, dropped }),
    })
  }

  useEffect(() => {
    const active = pump.current
    active?.start()
    let live = true
    void (async () => {
      for await (const event of queue.events) {
        if (!live) break
        // Log text goes to the buffer, never through the reducer — R11.4.
        if (event.type === 'run:event' && event.event.type === 'tool:output') {
          active?.write(event.event.toolId, event.event.chunk)
        } else {
          dispatch({ type: 'queue-event', event })
        }
      }
    })()
    return () => {
      live = false
      active?.stop()
    }
  }, [queue])

  useEffect(() => {
    void loadSkillStatuses(skills).then((statuses) => dispatch({ type: 'set-statuses', statuses }))
  }, [skills])

  const current = selectedSkill(state)
  useEffect(() => {
    if (!current) return
    if (state.panel === 'skill') {
      void loadSkillMd(current.dir).then((body) => dispatch({ type: 'set-skill-md', body }))
    }
    if (state.panel === 'artefacts') {
      void listArtefacts(current.runDir).then((paths) => dispatch({ type: 'set-artefacts', paths }))
    }
  }, [state.panel, current?.skillId, current?.runDir])

  useInput((input, key) => {
    if (input === 'q') {
      exit()
      return
    }
    if (input === '?') {
      dispatch({ type: 'toggle-help' })
      return
    }
    // Help is modal: swallowing movement while it is open keeps the selection
    // where the user left it rather than scrolling a screen they cannot see.
    if (state.help) {
      if (key.escape) dispatch({ type: 'toggle-help', open: false })
      return
    }
    if (key.tab) {
      dispatch({ type: 'cycle-focus', delta: key.shift ? -1 : 1 })
      return
    }
    if (input >= '1' && input <= '4') {
      dispatch({ type: 'set-panel', panel: PANELS[Number(input) - 1]! })
      return
    }
    if (input === 'j' || key.downArrow) {
      dispatch(
        state.focus === 'queue'
          ? { type: 'select-job', delta: 1 }
          : { type: 'select-skill', delta: 1 },
      )
      return
    }
    if (input === 'k' || key.upArrow) {
      dispatch(
        state.focus === 'queue'
          ? { type: 'select-job', delta: -1 }
          : { type: 'select-skill', delta: -1 },
      )
      return
    }
    if (input === 'h') {
      dispatch({ type: 'select-stage', delta: -1 })
      return
    }
    if (input === 'l') {
      dispatch({ type: 'select-stage', delta: 1 })
      return
    }
    if (input === ' ') {
      dispatch(
        state.focus === 'stages' ? { type: 'toggle-stage-mark' } : { type: 'toggle-skill-mark' },
      )
      return
    }
    if (input === 'r') {
      // R5.5: every marked skill and stage becomes one batch, one call.
      const chosen = state.markedSkills.length > 0 ? state.markedSkills : [current?.skillId]
      const wanted = state.markedStages.length > 0 ? state.markedStages : stages
      const specs = chosen
        .flatMap((id) => (id ? [byId.current.get(id)] : []))
        .flatMap((skill) => (skill ? [{ skill, stages: wanted }] : []))
      if (specs.length > 0) queue.enqueue(specs)
      dispatch({ type: 'clear-marks' })
      return
    }
    if (input === 'x') {
      const job = state.jobs[state.selectedJob]
      if (job) void queue.cancelJob(job.jobId)
    }
  })

  return <Work state={state} />
}
