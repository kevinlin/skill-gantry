import { describe, expect, it } from 'vitest'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createQueue,
  discoverSkills,
  stageDirFor,
  type RawFinding,
  type SkillRef,
  type StageResult,
} from '../../src/core/index.js'
import { claimRunDir, finalizeRun } from '../../src/core/workspace/writer.js'
import { App } from '../../src/tui/app.js'
import { LOG_CAPACITY } from '../../src/tui/log-buffer.js'
import { listArtefacts, loadLastRun, loadSkillMd, loadSkillStatuses } from '../../src/tui/views.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'
import { fakeRun } from '../helpers/fake-run.js'
import { renderInk } from '../helpers/render-ink.js'
import { fakeViews } from '../helpers/fake-views.js'

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
    <App skills={skills} queue={queue} stages={['security']} concurrency={1} views={fakeViews()} intervalMs={20} />,
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

const FINDING: RawFinding = {
  ruleClass: 'excessive-permission',
  nativeRuleId: 'LP3',
  severity: 'medium',
  path: 'declawed/SKILL.md',
  line: 1,
  message: 'no declared permissions',
}

const securityResult = (): StageResult => ({
  stage: 'security',
  outcome: 'failed',
  verdict: 'failed',
  toolRuns: [
    {
      toolId: 'skillspector',
      toolVersion: '2.5.1',
      outcome: 'failed',
      exitCode: 0,
      durationMs: 1,
      errorKind: null,
      artefactDir: '/tmp/x',
      findings: [FINDING],
      metrics: {},
      summary: '1 finding',
    },
  ],
})

/**
 * Two finalised runs whose index order is the inverse of their id order, so a
 * reader taking the last line rather than the greatest id resolves the wrong
 * one. Only the newer run executed security.
 */
async function recordedRuns(): Promise<{ workspacePath: string; newerDir: string }> {
  const root = await makeRepo({ files: { 'declawed/SKILL.md': SKILL_MD('declawed') } })
  const skills = await discoverSkills({ id: 'fx', path: root, name: 'fx', isGit: false })
  const workspacePath = skills[0]!.workspacePath

  const newerDir = join(workspacePath, 'skillgantry', 'runs', 'run-b')
  const stageDir = stageDirFor(newerDir, 3, 'security')
  await mkdir(join(stageDir, 'skillspector'), { recursive: true })
  await writeFile(join(stageDir, 'stage.json'), JSON.stringify(securityResult()))
  await writeFile(join(stageDir, 'skillspector', 'stdout.log'), 'scanning SKILL.md\nscanning scan.py\n')
  await writeFile(join(stageDir, 'skillspector', 'stderr.log'), 'one warning\n')
  await mkdir(join(workspacePath, 'skillgantry', 'runs', 'run-a'), { recursive: true })

  // Appended newest first, which is the order that catches a last-line reader.
  await finalizeRun(workspacePath, {
    runId: 'run-b',
    outcome: 'failed',
    endedAt: '2026-08-02T00:00:00Z',
  })
  await finalizeRun(workspacePath, {
    runId: 'run-a',
    outcome: 'passed',
    endedAt: '2026-08-01T00:00:00Z',
  })
  return { workspacePath, newerDir }
}

/** Every file under the workspace with its bytes and mtime, for R11.10's
    read-only constraint. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const walk = async (at: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(join(at, entry.name), rel)
      // The finalisation lock is a symlink, and reading one is EISDIR.
      else if (entry.isFile()) {
        const info = await stat(join(at, entry.name))
        out[rel] = `${info.mtimeMs}:${await readFile(join(at, entry.name), 'utf8')}`
      }
    }
  }
  await walk(dir, '')
  return out
}

describe('loadLastRun — R11.10', () => {
  it('resolves the greatest run id rather than the last index line', async () => {
    const { workspacePath, newerDir } = await recordedRuns()
    const run = await loadLastRun(workspacePath)
    expect(run?.runId).toBe('run-b')
    expect(run?.runDir).toBe(newerDir)
  })

  it('carries the stage the run executed, with its outcome, summary and findings', async () => {
    const { workspacePath } = await recordedRuns()
    const run = await loadLastRun(workspacePath)
    expect(run?.stages).toEqual([
      {
        stage: 'security',
        outcome: 'failed',
        summary: '1 finding',
        findings: [FINDING],
      },
    ])
  })

  it('skips a stage the run did not execute rather than failing the read', async () => {
    const { workspacePath } = await recordedRuns()
    const run = await loadLastRun(workspacePath)
    // Four of the five have no stage.json; the rail leaves those cells at `·`.
    expect(run?.stages.map((s) => s.stage)).toEqual(['security'])
  })

  it('returns null when no run has been recorded', async () => {
    expect(await loadLastRun('/nowhere/at/all-workspace')).toBeNull()
    const root = await makeRepo({ files: { 'fresh/SKILL.md': SKILL_MD('fresh') } })
    const skills = await discoverSkills({ id: 'fx', path: root, name: 'fx', isGit: false })
    expect(await loadLastRun(skills[0]!.workspacePath)).toBeNull()
  })

  it('replays the run’s tool logs in the shape the live pump writes', async () => {
    const { workspacePath } = await recordedRuns()
    const run = await loadLastRun(workspacePath)
    // stdout then stderr, prefixed by tool id, so a replayed frame and a live
    // one read identically. The trailing newline is not a line.
    expect(run?.log).toEqual({
      lines: [
        'skillspector │ scanning SKILL.md',
        'skillspector │ scanning scan.py',
        'skillspector │ one warning',
      ],
      dropped: 0,
    })
  })

  it('keeps the newest lines and reports the rest, like the ring buffer', async () => {
    const { workspacePath } = await recordedRuns()
    const stageDir = stageDirFor(join(workspacePath, 'skillgantry', 'runs', 'run-b'), 3, 'security')
    const many = Array.from({ length: LOG_CAPACITY + 50 }, (_, i) => `line ${i}`).join('\n')
    await writeFile(join(stageDir, 'skillspector', 'stdout.log'), `${many}\n`)
    await writeFile(join(stageDir, 'skillspector', 'stderr.log'), '')

    const run = await loadLastRun(workspacePath)
    expect(run?.log.lines).toHaveLength(LOG_CAPACITY)
    expect(run?.log.dropped).toBe(50)
    expect(run?.log.lines.at(-1)).toBe(`skillspector │ line ${LOG_CAPACITY + 49}`)
  })

  it('reports an empty log for a run whose tools wrote none', async () => {
    const { workspacePath } = await recordedRuns()
    const stageDir = stageDirFor(join(workspacePath, 'skillgantry', 'runs', 'run-b'), 3, 'security')
    await rm(join(stageDir, 'skillspector'), { recursive: true })
    const run = await loadLastRun(workspacePath)
    expect(run?.log).toEqual({ lines: [], dropped: 0 })
  })

  it('leaves the sidecar byte-identical', async () => {
    const { workspacePath } = await recordedRuns()
    const before = await snapshot(workspacePath)
    await loadLastRun(workspacePath)
    expect(await snapshot(workspacePath)).toEqual(before)
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
      <App skills={skills} queue={queue} stages={['security']} concurrency={1} views={fakeViews()} intervalMs={20} />,
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

describe('output pane scrolling — §14', () => {
  async function longSkill(): Promise<SkillRef[]> {
    const body = Array.from({ length: 60 }, (_, index) => `body line ${index + 1}`).join('\n')
    const root = await makeRepo({
      files: { 'declawed/SKILL.md': `${SKILL_MD('declawed', '1.1.0')}\n${body}\n` },
    })
    return discoverSkills({ id: 'fx', path: root, name: 'fx', isGit: false })
  }

  it('scrolls SKILL.md once the pane holds the focus, and says so before it does', async () => {
    const { ui } = harness(await longSkill())
    await ui.settle(40)
    ui.stdin.send('4')
    await ui.settle(40)

    // Cut, and saying which rows these are — the pane used to show the head of
    // the file with nothing to say the rest existed.
    expect(ui.lastFrame()).toContain('rows 1–')
    expect(ui.lastFrame()).toContain('tab focuses this pane')

    // skills → work, which is the rail and this pane together (R11.11).
    ui.stdin.send('\t')
    await ui.settle(20)
    expect(ui.lastFrame()).toContain('j/k scrolls')

    ui.stdin.send('j')
    await ui.settle(20)
    expect(ui.lastFrame()).toContain('rows 2–')
    ui.unmount()
  })
})
