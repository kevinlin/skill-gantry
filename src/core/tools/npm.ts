import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { type Exec, defaultExec } from './exec.js'

export interface NpmInstallSpec {
  id: string
  kind: 'npm-prefix'
  spec: string
  pin: string
  binName: string
}

/**
 * `--prefix` keeps the install inside the tool root; the package.json and lock
 * npm writes there are per-tool and harmless. Nothing touches a user-global
 * prefix, which is R3.1 applied to the second driver.
 */
export async function npmInstall(
  dir: string,
  spec: NpmInstallSpec,
  exec: Exec = defaultExec,
): Promise<string> {
  await mkdir(dir, { recursive: true })
  try {
    await exec('npm', [
      'install',
      '--prefix',
      dir,
      '--no-fund',
      '--no-audit',
      '--loglevel=error',
      `${spec.spec}@${spec.pin}`,
    ])
  } catch (err) {
    const detail = (err as { stderr?: string }).stderr ?? (err as Error).message
    throw new Error(`install failed for ${spec.id}@${spec.pin}: ${detail}`)
  }
  return join(dir, 'node_modules', '.bin', spec.binName)
}
