import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createGantryViews } from '../../src/cli/gantry-views.js'
import { createQueue } from '../../src/core/index.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { App } from '../../src/tui/app.js'
import { fakeRun } from '../helpers/fake-run.js'
import { fakeSetupDriver } from '../helpers/fake-views.js'
import { recordFixtureRun, skillFixture } from '../helpers/ledger-fixture.js'
import { renderInk } from '../helpers/render-ink.js'

const ALPHA = skillFixture('alpha', 'declawed')
const BETA = skillFixture('beta', 'spec-lint')
const P1 = { baseUrlHost: 'api.deepseek.com', models: {}, authTokenHash: null, analysisModes: {} }
const P2 = { baseUrlHost: 'api.anthropic.com', models: {}, authTokenHash: null, analysisModes: {} }

async function gantry() {
  const home = await mkdtemp(join(tmpdir(), 'sg-m6-'))
  await writeFile(
    join(home, 'config.json'),
    JSON.stringify({
      version: 1,
      repos: [],
      stageTools: {
        validate: ['skill-lint'],
        evaluate: ['skill-up'],
        security: ['skillspector'],
        optimise: [],
      },
      concurrency: 2,
      artefactSizeCapBytes: 33_554_432,
      timeoutOverridesMs: {},
      mutationTimeoutMs: 300_000,
    }),
  )
  const dbPath = join(home, 'gantry.db')
  const ledger = openLedger(dbPath)
  recordFixtureRun(ledger, {
    runId: '019283af-0000-7000-8000-000000000001',
    skill: ALPHA,
    provenance: P1,
    stages: [
      { stage: 'validate', outcome: 'passed', seconds: 2 },
      {
        stage: 'evaluate',
        outcome: 'passed',
        seconds: 10,
        metrics: { casesTotal: 6, casesPassed: 5 },
      },
      {
        stage: 'security',
        outcome: 'failed',
        seconds: 4,
        findings: [
          {
            ruleClass: 'prompt-injection' as never,
            nativeRuleId: 'AST1',
            severity: 'high',
            path: 'declawed/SKILL.md',
            message: 'injection',
          },
        ],
      },
    ],
  })
  recordFixtureRun(ledger, {
    runId: '019283af-0000-7000-8000-000000000002',
    skill: BETA,
    provenance: P2,
    stages: [
      {
        stage: 'validate',
        outcome: 'failed',
        seconds: 6,
        toolId: 'skill-lint',
        findings: [
          {
            ruleClass: 'metadata-invalid' as never,
            nativeRuleId: 'R01',
            severity: 'medium',
            path: 'spec-lint/SKILL.md',
            message: 'no description',
          },
        ],
      },
    ],
  })
  ledger.close()

  const views = createGantryViews({ home, dbPath, write: () => undefined })
  const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('r1').handle })
  const ui = renderInk(
    <App
      skills={[ALPHA, BETA]}
      queue={queue}
      stages={['security']}
      concurrency={2}
      views={views}
      setup={fakeSetupDriver()}
      intervalMs={20}
    />,
    { columns: 100, rows: 30 },
  )
  const go = async (screen: string): Promise<void> => {
    ui.stdin.send(':')
    for (const char of screen) ui.stdin.send(char)
    ui.stdin.send('\r')
    await ui.settle(60)
  }
  return { home, dbPath, ui, go, views }
}

describe('M6 exit criteria', () => {
  it('Dashboard renders ledger aggregates across every registered repo', async () => {
    const { ui, go } = await gantry()
    await ui.settle()
    await go('dashboard')
    const frame = ui.lastFrame()
    expect(frame).toContain('2 repos')
    expect(frame).toContain('2 skills')
    expect(frame).toContain('Stage pass rate')
    // R8.9's five clauses, all present on one screen.
    for (const section of ['Eval cases', 'Wall clock', 'Open issues', 'Run history']) {
      expect(frame).toContain(section)
    }
    // Both repos' runs are in the history, which is what "across all repos" means.
    expect(frame).toContain('alpha/declawed')
    expect(frame).toContain('beta/spec-lint')
    ui.unmount()
  })

  it('the provenance filter splits the numbers rather than reordering them — R7.6', async () => {
    const { ui, go } = await gantry()
    await ui.settle()
    await go('dashboard')
    expect(ui.lastFrame()).toContain('2 repos')
    ui.stdin.send('p')
    await ui.settle(60)
    const filtered = ui.lastFrame()
    expect(filtered).toContain('1 repos')
    expect(filtered).not.toContain('provenance all')
    ui.unmount()
  })

  it('Issues lists both repos and a transition survives a reload', async () => {
    const { ui, go, views } = await gantry()
    await ui.settle()
    await go('issues')
    expect(ui.lastFrame()).toContain('alpha/declawed')
    expect(ui.lastFrame()).toContain('beta/spec-lint')
    ui.stdin.send('a')
    await ui.settle(80)
    // Read back through the port, so the assertion is against the ledger and
    // not against the frame the keypress happened to leave behind.
    const acknowledged = await views.issues({ state: 'acknowledged' })
    expect(acknowledged).toHaveLength(1)
    expect(ui.lastFrame()).toContain('acknowledged')
    ui.unmount()
  })

  it('Tools and Settings are reachable and answer from real config', async () => {
    const { ui, go } = await gantry()
    await ui.settle()
    await go('tools')
    // Longer than every other wait here: this is the one screen whose port call
    // spawns — `doctor` invokes each runtime's version argv (R3.9) — so 60 ms
    // catches it still probing.
    await ui.settle(3_000)
    expect(ui.lastFrame()).toContain('Runtimes')
    await go('settings')
    expect(ui.lastFrame()).toContain('concurrency 2')
    expect(ui.lastFrame()).toContain('skill-lint')
    ui.unmount()
  })

  it('the terminal interface never opens the ledger itself', async () => {
    // The boundary R13.1 enforces, asserted as a fact about the source rather
    // than as a behaviour: a screen that opened sqlite would still render.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/tui/app.tsx', 'utf8'),
    )
    expect(source).not.toContain('node:sqlite')
    expect(source).not.toContain('openLedger')
  })

  it('edits a setting from the TUI and writes it once', async () => {
    const { home, ui, go } = await gantry()
    await ui.settle()
    const configPath = join(home, 'config.json')
    const before = await readFile(configPath, 'utf8')

    await go('settings')
    for (const key of 'e4\r') ui.stdin.send(key)
    await ui.settle(60)

    // Staged only: R11.8's "not written per keystroke", asserted against bytes.
    expect(await readFile(configPath, 'utf8')).toBe(before)

    ui.stdin.send('c')
    await ui.settle(60)
    // `a` writes through the port, so the frame the assertion reads is one
    // filesystem round trip away, not one render.
    ui.stdin.send('a')
    await ui.settle(200)

    const after = JSON.parse(await readFile(configPath, 'utf8')) as { concurrency: number }
    expect(after.concurrency).toBe(4)
    expect(ui.lastFrame()).not.toContain('staged')
    ui.unmount()
  })

  it('leaves the file byte-identical when the edit is discarded', async () => {
    const { home, ui, go } = await gantry()
    await ui.settle()
    const configPath = join(home, 'config.json')
    const before = await readFile(configPath, 'utf8')

    await go('settings')
    for (const key of 'e4\rcd') ui.stdin.send(key)
    await ui.settle(60)

    expect(await readFile(configPath, 'utf8')).toBe(before)
    ui.unmount()
  })
})
