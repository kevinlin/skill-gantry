import { describe, expect, it } from 'vitest'
import { createQueue, type SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeRun } from '../helpers/fake-run.js'
import { fakeViews } from '../helpers/fake-views.js'
import { renderInk } from '../helpers/render-ink.js'

/**
 * R11.11, rev 15. Nothing in the suite had ever sent an arrow key, so the eight
 * blocks that alias `↑`/`↓` onto `j`/`k` were unproven and the two new
 * horizontal aliases would have been too. A terminal delivers an arrow as a
 * three-byte CSI sequence in one read, so each is sent as one string — the
 * bracketed-paste case in `setup-wizard.test.tsx` is the precedent that a
 * multi-byte sequence reaches Ink through the fake stdin at all.
 */
const UP = '\x1b[A'
const DOWN = '\x1b[B'
const RIGHT = '\x1b[C'
const LEFT = '\x1b[D'

const skill = (id: string): SkillRef => ({
  id,
  name: id,
  version: '1.0.0',
  dir: `/repo/${id}`,
  relPath: id,
  repo: { id: 'fx', path: '/repo', name: 'fx', isGit: false },
  rootSkill: false,
  frontmatterReadable: true,
  workspacePath: `/repo/${id}-workspace`,
  deprecated: false,
  supersededBy: null,
})

const SKILLS = [skill('declawed'), skill('spec-lint')]

function harness() {
  const queue = createQueue({
    concurrency: 2,
    startRun: (job) => fakeRun(`run-${job.skillId}`).handle,
  })
  const ui = renderInk(
    <App
      skills={SKILLS}
      queue={queue}
      // R11.20 refuses a mark on an unconfigured stage, and this suite marks
      // the rail's first stage to prove the arrows moved it.
      stages={['validate', 'evaluate', 'security']}
      concurrency={2}
      views={fakeViews()}
      intervalMs={20}
    />,
    { columns: 100, rows: 30 },
  )
  return { queue, ui }
}

describe('R11.11 arrow keys alias the letter pairs', () => {
  // Same observable `focus-zones.test.tsx` uses: the rail marks its selection
  // with `underline` and `bold`, which a `debug` frame writes as plain text, so
  // the `*` the mark key leaves is what the frame can actually answer.
  it('moves the rail right and back with the horizontal arrows', async () => {
    const { ui, queue } = harness()
    await ui.settle()
    ui.stdin.send('\t')
    await ui.settle()
    ui.stdin.send(RIGHT)
    await ui.settle()
    ui.stdin.send(' ')
    await ui.settle()
    expect(ui.lastFrame()).toContain('*Evaluate')

    ui.stdin.send(LEFT)
    await ui.settle()
    ui.stdin.send(' ')
    await ui.settle()
    expect(ui.lastFrame()).toContain('*Validate')
    ui.unmount()
    queue.close()
  })

  it('leaves the rail alone when the horizontal arrow is pressed outside the work zone', async () => {
    const { ui, queue } = harness()
    await ui.settle()
    ui.stdin.send(RIGHT)
    await ui.settle()
    ui.stdin.send('\t')
    await ui.settle()
    ui.stdin.send(' ')
    await ui.settle()
    expect(ui.lastFrame()).toContain('*Validate')
    expect(ui.lastFrame()).not.toContain('*Evaluate')
    ui.unmount()
    queue.close()
  })

  it('moves the skill list down and back with the vertical arrows', async () => {
    const { ui, queue } = harness()
    await ui.settle()
    ui.stdin.send(DOWN)
    await ui.settle()
    expect(ui.lastFrame()).toMatch(/▸\s*[○◐●!×]\s*spec-lint/)

    ui.stdin.send(UP)
    await ui.settle()
    expect(ui.lastFrame()).toMatch(/▸\s*[○◐●!×]\s*declawed/)
    ui.unmount()
    queue.close()
  })
})
