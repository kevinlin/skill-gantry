import { describe, expect, it } from 'vitest'
import { MUTATION_COMMANDS, requireCommands } from '../../src/core/isolation/preflight.js'
import type { Exec } from '../../src/core/tools/exec.js'

const present: Exec = async () => ({ stdout: '/usr/bin/thing\n', stderr: '' })
const absentAll: Exec = async () => {
  throw new Error('exit 1')
}

describe('requireCommands', () => {
  it('resolves when every command answers', async () => {
    await expect(requireCommands(['git', 'zip'], present)).resolves.toBeUndefined()
  })

  it('names the first absent command rather than the last failure', async () => {
    const only = new Set(['git'])
    const exec: Exec = async (bin) =>
      only.has(bin) ? { stdout: '/usr/bin/git\n', stderr: '' } : Promise.reject(new Error('exit 1'))
    await expect(requireCommands(['git', 'zip', 'unzip'], exec)).rejects.toThrow(
      'mutating stage needs zip on PATH',
    )
  })

  it('fails on the first of all-absent rather than reporting three errors', async () => {
    await expect(requireCommands(MUTATION_COMMANDS, absentAll)).rejects.toThrow(
      'mutating stage needs git on PATH',
    )
  })

  it('names all three commands a mutating stage needs', () => {
    expect([...MUTATION_COMMANDS]).toEqual(['git', 'zip', 'unzip'])
  })

  it('probes unzip with -v rather than --version, which Info-ZIP mis-parses', async () => {
    const calls: Array<{ bin: string; argv: readonly string[] }> = []
    const exec: Exec = async (bin, argv) => {
      calls.push({ bin, argv })
      return { stdout: '', stderr: '' }
    }
    await requireCommands(MUTATION_COMMANDS, exec)
    expect(calls).toEqual([
      { bin: 'git', argv: ['--version'] },
      { bin: 'zip', argv: ['--version'] },
      { bin: 'unzip', argv: ['-v'] },
    ])
  })
})
