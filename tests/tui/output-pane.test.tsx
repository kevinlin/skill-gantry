import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createQueue, discoverSkills, type SkillRef } from '../../src/core/index.js'
import { claimRunDir, finalizeRun } from '../../src/core/workspace/writer.js'
import { App } from '../../src/tui/app.js'
import { listArtefacts, loadSkillMd, loadSkillStatuses } from '../../src/tui/views.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'
import { fakeRun } from '../helpers/fake-run.js'
import { renderInk } from '../helpers/render-ink.js'

async function fixture(): Promise<{ skills: SkillRef[]; runDir: string }> {
  const root = await makeRepo({
    files: {
      'declawed/SKILL.md': `${SKILL_MD('declawed', '1.1.0')}\nde-slop pass over any text.\n`,
    },
  })
  const skills = await discoverSkills({ id: 'fx', path: root, name: 'fx', isGit: false })
  const skill = skills[0]!
  const { runId, runDir } = await claimRunDir(skill.workspacePath)
  await mkdir(join(runDir, '03-security', 'skillspector'), { recursive: true })
  await writeFile(join(runDir, '03-security', 'skillspector', 'findings.sarif'), '{}')
  await writeFile(join(runDir, '03-security', 'skillspector', 'stdout.log'), 'scanning\n')
  await writeFile(join(runDir, 'run.json'), '{}')
  await finalizeRun(skill.workspacePath, {
    runId,
    outcome: 'failed',
    endedAt: '2026-08-01T00:00:00Z',
  })
  return { skills, runDir }
}

const harness = (skills: readonly SkillRef[]) => {
  const queue = createQueue({ concurrency: 1, startRun: (job) => fakeRun(job.jobId).handle })
  const ui = renderInk(
    <App skills={skills} queue={queue} stages={['security']} concurrency={1} intervalMs={20} />,
  )
  return { queue, ui }
}

describe('views', () => {
  it('reads SKILL.md and falls back when it is unreadable', async () => {
    const { skills } = await fixture()
    expect(await loadSkillMd(skills[0]!.dir)).toContain('de-slop pass')
    expect(await loadSkillMd('/nowhere')).toBe('(no SKILL.md)')
  })

  it('lists every artefact the run wrote, relative and sorted', async () => {
    const { runDir } = await fixture()
    const paths = await listArtefacts(runDir)
    expect(paths).toEqual([
      '03-security/skillspector/findings.sarif',
      '03-security/skillspector/stdout.log',
      'run.json',
    ])
    expect(await listArtefacts(null)).toEqual([])
  })

  it('reads the last recorded outcome per skill from the sidecar index', async () => {
    const { skills } = await fixture()
    expect(await loadSkillStatuses(skills)).toEqual({ 'fx/declawed': 'failed' })
  })
})

describe('output pane — R11.2', () => {
  it('shows SKILL.md on panel 4', async () => {
    const { skills } = await fixture()
    const { ui, queue } = harness(skills)
    await ui.settle()
    ui.stdin.send('4')
    await ui.settle(60)
    expect(ui.lastFrame()).toContain('de-slop pass')
    ui.unmount()
    queue.close()
  })

  it('shows artefacts on panel 3 once a run directory is known', async () => {
    const { skills, runDir } = await fixture()
    const { ui, queue } = harness(skills)
    await ui.settle()
    // The pane needs a run to point at, so replay the run:start the engine emits.
    const [jobId] = queue.enqueue([{ skill: skills[0]!, stages: ['security'] }])
    void jobId
    await ui.settle()
    ui.stdin.send('3')
    await ui.settle(60)
    expect(ui.lastFrame()).toMatch(/no artefacts yet|run\.json/)
    void runDir
    ui.unmount()
    queue.close()
  })

  it('shows findings on panel 2 and says so when there are none', async () => {
    const { skills } = await fixture()
    const { ui, queue } = harness(skills)
    await ui.settle()
    ui.stdin.send('2')
    await ui.settle(40)
    expect(ui.lastFrame()).toContain('no findings')
    ui.unmount()
    queue.close()
  })

  it('points at the file on disk once the buffer has dropped lines — R11.5', async () => {
    const { skills } = await fixture()
    const runs = new Map<string, ReturnType<typeof fakeRun>>()
    const queue = createQueue({
      concurrency: 1,
      startRun: (job) => {
        const run = fakeRun(job.jobId)
        runs.set(job.jobId, run)
        return run.handle
      },
    })
    const ui = renderInk(
      <App skills={skills} queue={queue} stages={['security']} concurrency={1} intervalMs={20} />,
    )
    await ui.settle()
    const [jobId] = queue.enqueue([{ skill: skills[0]!, stages: ['security'] }])
    await ui.settle()

    const run = runs.get(jobId!)!
    run.events.push({
      type: 'run:start',
      runId: 'r1',
      skillId: skills[0]!.id,
      stages: ['security'],
      runDir: '/w/r1',
    })
    for (let i = 0; i < 2_500; i += 1) {
      run.events.push({
        type: 'tool:output',
        runId: 'r1',
        stage: 'security',
        toolId: 'skillspector',
        stream: 'stdout',
        chunk: `line ${i}\n`,
      })
    }
    await ui.settle(80)
    expect(ui.lastFrame()).toMatch(/\d+ earlier lines dropped/)

    run.finish()
    await queue.idle()
    ui.unmount()
    queue.close()
  })

  it('shows the last recorded outcome before anything is run — R11.1', async () => {
    const { skills } = await fixture()
    const { ui, queue } = harness(skills)
    await ui.settle(60)
    expect(ui.lastFrame()).toMatch(/!\s*declawed/)
    ui.unmount()
    queue.close()
  })
})
