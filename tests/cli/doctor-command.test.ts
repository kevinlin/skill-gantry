import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveToolLock } from '../../src/core/config/config.js'
import { RULE_CLASS_MAP_VERSION, appliedRuleMapVersion, openLedger } from '../../src/core/index.js'
import { buildProgram, type CliDeps } from '../../src/cli/run-command.js'
import { formatDoctor } from '../../src/cli/doctor-command.js'

async function deps(): Promise<{ deps: CliDeps; lines: string[] }> {
  const home = await mkdtemp(join(tmpdir(), 'sg-doctor-cli-'))
  const lines: string[] = []
  return {
    deps: {
      home,
      dbPath: ':memory:',
      write: (line) => lines.push(line),
      // §5.3's condition reaches the release index; the default suite is
      // offline, so the seam stands in for it.
      upgradeCheck: async () => null,
    },
    lines,
  }
}

describe('skillgantry doctor', () => {
  it('exits non-zero and names the drift when a locked tool is gone', async () => {
    const { deps: d, lines } = await deps()
    await saveToolLock(d.home, {
      version: 1,
      tools: {
        alpha: {
          installKind: 'uv-tool',
          requestedPin: 'v1',
          resolvedVersion: '1.0.0',
          bin: '/nonexistent/alpha',
          integrity: 'n/a',
          installedAt: '2026-08-01T00:00:00Z',
          verifiedAt: '2026-08-01T00:00:00Z',
        },
      },
    })
    const program = buildProgram(d)
    await program.parseAsync(['node', 'skillgantry', 'doctor'])
    expect(program.exitCode).toBe(1)
    expect(lines.join('\n')).toMatch(/alpha\s+missing/)
  })

  it('emits one JSON object with --json', async () => {
    const { deps: d, lines } = await deps()
    await saveToolLock(d.home, { version: 1, tools: {} })
    const program = buildProgram(d)
    await program.parseAsync(['node', 'skillgantry', 'doctor', '--json'])
    const report = JSON.parse(lines.join('')) as { tools: unknown[]; failed: boolean }
    expect(report.failed).toBe(false)
    expect(Array.isArray(report.tools)).toBe(true)
    expect(program.exitCode).toBe(0)
  })

  it('applies a pending rule-map migration only when asked', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-doctor-cli-'))
    // A file, not ':memory:': the point of the test is that the applied version
    // survives the process that applied it.
    const dbPath = join(home, 'gantry.db')
    const lines: string[] = []
    const d: CliDeps = { home, dbPath, write: (line) => lines.push(line) }
    await saveToolLock(home, { version: 1, tools: {} })

    await buildProgram(d).parseAsync(['node', 'skillgantry', 'doctor'])
    expect(lines.join('\n')).toMatch(/rule-class map v1 applied/)
    const before = openLedger(dbPath)
    expect(appliedRuleMapVersion(before.db)).toBe(1)
    before.close()

    lines.length = 0
    await buildProgram(d).parseAsync(['node', 'skillgantry', 'doctor', '--migrate-rule-map'])
    expect(lines.join('\n')).toMatch(/reclassified/)
    const after = openLedger(dbPath)
    expect(appliedRuleMapVersion(after.db)).toBe(RULE_CLASS_MAP_VERSION)
    after.close()
    expect(lines.join('\n')).not.toMatch(/rule-map-pending/)
  })
})

describe('formatDoctor and skillgantry-outdated', () => {
  const empty = { runtimes: [], tools: [], lifecycle: [], skills: [], failed: false }

  it('names the available version and the command that installs it', () => {
    const rendered = formatDoctor({
      ...empty,
      upgrade: { current: '0.5.1', latest: '0.6.0' },
    }).join('\n')
    expect(rendered).toContain('skillgantry-outdated')
    expect(rendered).toContain('0.5.1')
    expect(rendered).toContain('0.6.0')
    expect(rendered).toContain('skillgantry upgrade')
    expect(rendered).toContain('doctor: no drift')
  })

  // R3.7's probe-and-report rule: reported, never installed, and never the
  // reason a machine that is otherwise fine reads as broken.
  it('omits the line entirely when there is nothing to report', () => {
    expect(formatDoctor({ ...empty, upgrade: null }).join('\n')).not.toContain(
      'skillgantry-outdated',
    )
  })
})
