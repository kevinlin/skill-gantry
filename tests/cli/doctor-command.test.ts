import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveToolLock } from '../../src/core/config/config.js'
import { buildProgram, type CliDeps } from '../../src/cli/run-command.js'

async function deps(): Promise<{ deps: CliDeps; lines: string[] }> {
  const home = await mkdtemp(join(tmpdir(), 'sg-doctor-cli-'))
  const lines: string[] = []
  return { deps: { home, dbPath: ':memory:', write: (line) => lines.push(line) }, lines }
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
})
