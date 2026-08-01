import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram } from '../../src/cli/run-command.js'
import { resolveStages } from '../../src/cli/tui-command.js'
import { DEFAULT_CONFIG } from '../../src/core/config/config.js'

const home = async (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-home-'))

describe('resolveStages', () => {
  it('offers only stages with a tool selected', () => {
    expect(
      resolveStages({
        ...DEFAULT_CONFIG,
        stageTools: { validate: [], evaluate: [], security: ['skillspector'], optimise: [] },
      }),
    ).toEqual(['security'])
  })

  it('keeps lifecycle order', () => {
    expect(
      resolveStages({
        ...DEFAULT_CONFIG,
        stageTools: {
          validate: ['skill-lint'],
          evaluate: [],
          security: ['skillspector'],
          optimise: [],
        },
      }),
    ).toEqual(['validate', 'security'])
  })
})

describe('default command', () => {
  it('starts the terminal interface when no subcommand is given', async () => {
    const startTui = vi.fn(async () => undefined)
    const h = await home()
    const program = buildProgram({
      home: h,
      dbPath: join(h, 'gantry.db'),
      write: () => {},
      startTui,
    })
    await program.parseAsync(['node', 'skillgantry'])
    expect(startTui).toHaveBeenCalledWith(
      expect.objectContaining({ home: h, dbPath: join(h, 'gantry.db') }),
    )
  })

  it('passes --concurrency through', async () => {
    const startTui = vi.fn(async () => undefined)
    const h = await home()
    const program = buildProgram({
      home: h,
      dbPath: join(h, 'gantry.db'),
      write: () => {},
      startTui,
    })
    await program.parseAsync(['node', 'skillgantry', '--concurrency', '4'])
    expect(startTui).toHaveBeenCalledWith(expect.objectContaining({ concurrency: 4 }))
  })

  it('leaves the run subcommand alone', async () => {
    const startTui = vi.fn(async () => undefined)
    const h = await home()
    await writeFile(join(h, 'config.json'), JSON.stringify(DEFAULT_CONFIG))
    const program = buildProgram({
      home: h,
      dbPath: join(h, 'gantry.db'),
      write: () => {},
      startTui,
    })
    await expect(
      program.parseAsync(['node', 'skillgantry', 'run', 'nothing', '--stage', 'security']),
    ).rejects.toThrow(/no skill matching/)
    expect(startTui).not.toHaveBeenCalled()
  })
})
