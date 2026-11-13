import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createGantryViews } from '../../src/cli/gantry-views.js'
import { commitHint, createQueue } from '../../src/core/index.js'
import type { SkillRef, StageOutcome } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeRun, type FakeRun } from '../helpers/fake-run.js'
import { fakeViews } from '../helpers/fake-views.js'
import { makeHeadless } from '../helpers/headless.js'
import { renderInk, waitForFrame, type InkHarness } from '../helpers/render-ink.js'
import { skillRef } from '../helpers/skill-ref.js'
import { SKILL_MD_FULL } from '../helpers/tmp-repo.js'
import type { GantryViews, ReleaseHintRequest } from '../../src/tui/views.js'

const SCOPE = ['declawed/SKILL.md', 'declawed/CHANGELOG.md', 'versions.json']

const LINES = [
  'git -C /repo add -- declawed/SKILL.md versions.json',
  "git -C /repo commit -m 'release(declawed): 1.1.0' -- declawed/SKILL.md versions.json",
]

interface Session {
  ui: InkHarness
  queue: ReturnType<typeof createQueue>
  runs: FakeRun[]
}

function mount(views: GantryViews, skill: SkillRef, size = { columns: 200, rows: 40 }): Session {
  const runs: FakeRun[] = []
  const queue = createQueue({
    concurrency: 1,
    startRun: () => {
      const run = fakeRun(`run-rel-${runs.length + 1}`)
      runs.push(run)
      return run.handle
    },
  })
  const ui = renderInk(
    <App skills={[skill]} queue={queue} stages={['validate']} concurrency={1} views={views} intervalMs={20} />,
    size,
  )
  return { ui, queue, runs }
}

/** The rail starts on Validate: four `l`s reach Release, and space marks it. */
async function startRelease(s: Session, bump: string, first: boolean): Promise<FakeRun> {
  const before = s.runs.length
  if (first) {
    s.ui.stdin.send('\t')
    await s.ui.settle()
    for (let i = 0; i < 4; i += 1) s.ui.stdin.send('l')
    await s.ui.settle()
  }
  s.ui.stdin.send(' ')
  await s.ui.settle()
  s.ui.stdin.send('r')
  await s.ui.settle(40)
  for (const char of bump) s.ui.stdin.send(char)
  await s.ui.settle()
  s.ui.stdin.send('\r')
  await waitForFrame(s.ui, () => s.runs.length > before)
  return s.runs.at(-1) as FakeRun
}

/** Drives the run to the point a real one reaches, then lands it with `outcome`. */
async function land(
  s: Session,
  run: FakeRun,
  outcome: StageOutcome,
  { pending = true }: { pending?: boolean } = {},
): Promise<void> {
  const runId = `run-rel-${s.runs.indexOf(run) + 1}`
  run.events.push({ type: 'run:start', runId, skillId: 'declawed', stages: ['release'], runDir: `/runs/${runId}` })
  await s.ui.settle(30)
  if (pending) {
    run.events.push({
      type: 'mutation:pending',
      runId,
      stage: 'release',
      requestId: `req-${runId}`,
      diff: '@@ -1 +1 @@\n-1.0.1\n+1.1.0\n',
      scope: SCOPE,
    })
    await s.ui.settle(30)
    run.events.push({
      type: 'mutation:resolved',
      runId,
      stage: 'release',
      requestId: `req-${runId}`,
      action: outcome === 'passed' ? 'apply' : 'discard',
    })
    await s.ui.settle(30)
  }
  run.events.push({ type: 'run:done', runId, outcome, opened: 0, closed: 0, reopened: 0 })
  run.finish({ runId, outcome })
  await s.ui.settle(80)
}

const hinting = (lines: string[], seen: ReleaseHintRequest[]): Partial<GantryViews> => ({
  releaseHint: async (request) => {
    seen.push(request)
    return lines
  },
})

const versioned = skillRef('declawed', { version: '1.0.1', isGit: true })

describe('R9.7 the release hint reaches the Log pane', () => {
  it('writes the two commit lines when a release applies, with no source prefix', async () => {
    const seen: ReleaseHintRequest[] = []
    const s = mount(fakeViews(hinting(LINES, seen), [versioned]), versioned)
    await s.ui.settle()

    const run = await startRelease(s, 'minor', true)
    await land(s, run, 'passed')

    await waitForFrame(s.ui, (frame) => frame.includes(LINES[1] as string))
    const frame = s.ui.lastFrame()
    expect(frame).toContain(LINES[0])
    expect(frame).toContain(LINES[1])
    // SkillGantry composed these; `release │ …` would credit them to the tool.
    expect(frame).not.toContain('release │ git')
    s.ui.unmount()
    s.queue.close()
  })

  it('asks with the review’s scope, the ref the job was built from and the resolved version', async () => {
    const seen: ReleaseHintRequest[] = []
    const fresh = skillRef('declawed', { version: '2.0.0', isGit: true })
    const s = mount(fakeViews(hinting(LINES, seen), [fresh]), versioned)
    await s.ui.settle()

    const run = await startRelease(s, 'minor', true)
    await land(s, run, 'passed')

    // `minor` of the freshly read 2.0.0, not the launch-time 1.0.1 and not the
    // bump level the user typed: resolving it against the written file would bump twice.
    expect(seen).toEqual([{ skill: fresh, version: '2.1.0', scope: SCOPE }])
    s.ui.unmount()
    s.queue.close()
  })

  it('writes nothing for a release that did not apply', async () => {
    const seen: ReleaseHintRequest[] = []
    const s = mount(fakeViews(hinting(LINES, seen), [versioned]), versioned)
    await s.ui.settle()

    const run = await startRelease(s, 'minor', true)
    // Discarded at the review: the stage ends `skipped` and nothing was written.
    await land(s, run, 'skipped')

    expect(seen).toEqual([])
    expect(s.ui.lastFrame()).not.toContain('git -C')
    s.ui.unmount()
    s.queue.close()
  })

  it('writes nothing for a release that failed', async () => {
    const seen: ReleaseHintRequest[] = []
    const s = mount(fakeViews(hinting(LINES, seen), [versioned]), versioned)
    await s.ui.settle()

    const run = await startRelease(s, 'minor', true)
    await land(s, run, 'failed')

    expect(seen).toEqual([])
    expect(s.ui.lastFrame()).not.toContain('git -C')
    s.ui.unmount()
    s.queue.close()
  })

  it('writes nothing when the job never reached a review, so there is no scope', async () => {
    const seen: ReleaseHintRequest[] = []
    const s = mount(fakeViews(hinting(LINES, seen), [versioned]), versioned)
    await s.ui.settle()

    const run = await startRelease(s, 'minor', true)
    await land(s, run, 'passed', { pending: false })

    expect(seen).toEqual([])
    s.ui.unmount()
    s.queue.close()
  })

  it('adds nothing when the port has no hint to give, as for a repo that is not git-backed', async () => {
    const seen: ReleaseHintRequest[] = []
    const s = mount(fakeViews(hinting([], seen), [versioned]), versioned)
    await s.ui.settle()

    const run = await startRelease(s, 'minor', true)
    await land(s, run, 'passed')

    expect(seen).toHaveLength(1)
    expect(s.ui.lastFrame()).not.toContain('git -C')
    expect(s.ui.lastFrame()).not.toContain('commit -m')
    s.ui.unmount()
    s.queue.close()
  })

  it('does not carry a failed release’s target into the next release of the same skill', async () => {
    const seen: ReleaseHintRequest[] = []
    const s = mount(fakeViews(hinting(LINES, seen), [versioned]), versioned)
    await s.ui.settle()

    const first = await startRelease(s, 'patch', true)
    await land(s, first, 'failed')
    const second = await startRelease(s, 'minor', false)
    await land(s, second, 'passed')

    expect(seen.map((request) => request.version)).toEqual(['1.1.0'])
    s.ui.unmount()
    s.queue.close()
  })

  it('says why in the Log pane when the hint cannot be composed, rather than writing a wrong one', async () => {
    const s = mount(
      fakeViews(
        {
          releaseHint: async () => {
            throw new Error('git is not installed')
          },
        },
        [versioned],
      ),
      versioned,
    )
    await s.ui.settle()

    const run = await startRelease(s, 'minor', true)
    await land(s, run, 'passed')

    await waitForFrame(s.ui, (frame) => frame.includes('git is not installed'))
    expect(s.ui.lastFrame()).toContain('commit hint unavailable · git is not installed')
    s.ui.unmount()
    s.queue.close()
  })
})

describe('R9.7 the hint over a real repo, through the real port', () => {
  async function scene(git: boolean) {
    const h = await makeHeadless({
      git,
      repos: [{ 'sk/SKILL.md': SKILL_MD_FULL('sk'), 'versions.json': '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n' }],
    })
    const [skill] = await h.skills()
    // What the release would have written, left uncommitted for git to report.
    await writeFile(join(skill!.dir, 'SKILL.md'), `${SKILL_MD_FULL('sk')}\nreleased\n`)
    await writeFile(join(skill!.repo.path, 'versions.json'), '{\n  "skills": {\n    "sk": "1.0.1"\n  }\n}\n')
    return { h, skill: skill! }
  }

  async function release(skill: SkillRef, views: GantryViews): Promise<Session> {
    const s = mount(views, skill)
    await s.ui.settle()
    s.ui.stdin.send('\t')
    await s.ui.settle()
    for (let i = 0; i < 4; i += 1) s.ui.stdin.send('l')
    await s.ui.settle()
    s.ui.stdin.send(' ')
    await s.ui.settle()
    s.ui.stdin.send('r')
    await s.ui.settle(80)
    for (const char of 'patch') s.ui.stdin.send(char)
    await s.ui.settle()
    s.ui.stdin.send('\r')
    await waitForFrame(s.ui, () => s.runs.length === 1)
    const run = s.runs[0] as FakeRun
    run.events.push({ type: 'run:start', runId: 'run-rel-1', skillId: skill.id, stages: ['release'], runDir: '/r' })
    await s.ui.settle(30)
    run.events.push({
      type: 'mutation:pending',
      runId: 'run-rel-1',
      stage: 'release',
      requestId: 'req',
      diff: '',
      // CHANGELOG.md is in the scope and was never written, so git does not report it.
      scope: ['sk/SKILL.md', 'sk/CHANGELOG.md', 'versions.json'],
    })
    await s.ui.settle(30)
    run.events.push({ type: 'mutation:resolved', runId: 'run-rel-1', stage: 'release', requestId: 'req', action: 'apply' })
    run.events.push({ type: 'run:done', runId: 'run-rel-1', outcome: 'passed', opened: 0, closed: 0, reopened: 0 })
    run.finish({ runId: 'run-rel-1', outcome: 'passed' })
    return s
  }

  it('holds the add and the commit, over the paths git reports changed, after the release applies', async () => {
    const { h, skill } = await scene(true)
    const s = await release(skill, createGantryViews(h.deps))
    const [add, commit] = commitHint({
      repo: skill.repo.path,
      name: 'sk',
      version: '1.0.1',
      paths: ['sk/SKILL.md', 'versions.json'],
    })
    await waitForFrame(s.ui, (frame) => frame.includes(commit as string), 100)

    const frame = s.ui.lastFrame()
    expect(frame).toContain(add)
    expect(frame).toContain(commit)
    expect(frame).not.toContain('CHANGELOG.md')
    s.ui.unmount()
    s.queue.close()
  }, 30_000)

  it('holds nothing extra for a repo that is not git-backed', async () => {
    const { h, skill } = await scene(false)
    const s = await release(skill, createGantryViews(h.deps))
    await s.ui.settle(300)

    expect(s.ui.lastFrame()).not.toContain('git -C')
    expect(s.ui.lastFrame()).not.toContain('commit -m')
    s.ui.unmount()
    s.queue.close()
  }, 30_000)
})
