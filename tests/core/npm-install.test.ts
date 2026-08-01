import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Exec } from '../../src/core/tools/exec.js'
import { type NpmInstallSpec, npmInstall } from '../../src/core/tools/npm.js'

const SPEC: NpmInstallSpec = {
  id: 'skill-lint',
  kind: 'npm-prefix',
  spec: 'skill-lint',
  pin: '0.100.0',
  binName: 'skill-lint',
}

describe('npmInstall', () => {
  it('installs into the private prefix and resolves the shim there', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sg-npm-'))
    const calls: Array<{ bin: string; argv: readonly string[] }> = []
    const exec: Exec = async (bin, argv) => {
      calls.push({ bin, argv })
      return { stdout: '', stderr: '' }
    }

    const bin = await npmInstall(dir, SPEC, exec)

    expect(bin).toBe(join(dir, 'node_modules', '.bin', 'skill-lint'))
    expect(calls[0]?.bin).toBe('npm')
    expect(calls[0]?.argv).toEqual([
      'install',
      '--prefix',
      dir,
      '--no-fund',
      '--no-audit',
      '--loglevel=error',
      'skill-lint@0.100.0',
    ])
  })

  it('names the tool and the pin when npm fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sg-npm-'))
    const exec: Exec = async () => {
      throw Object.assign(new Error('exit 1'), { stderr: 'E404 Not Found' })
    }
    await expect(npmInstall(dir, SPEC, exec)).rejects.toThrow(
      /install failed for skill-lint@0\.100\.0: E404/,
    )
  })
})
