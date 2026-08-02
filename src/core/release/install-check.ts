import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { type Exec, defaultExec } from '../tools/exec.js'

export interface InstallCheckInput {
  archivePath: string
  /** `<run>/staging` — extraction and destination both live under it. */
  stagingDir: string
  /** The lock's resolved executable for vercel `skills`. */
  skillsBin: string
  exec?: Exec
  timeoutMs?: number
}

export interface InstallCheckResult {
  ok: boolean
  exitCode: number | null
  output: string
  /** The isolated destination, kept for the evidence bundle. */
  destination: string
}

/**
 * R9.6. The archive is extracted and *that directory* is installed, because
 * vercel `skills` documents git sources and local directories, not zip archives
 * — revision 2's "install the archive" was not executable as written. Extracting
 * first also verifies the same bytes a consumer receives.
 *
 * `--agent claude-code` matters: without it the tool installs to all 75 agents
 * it knows, which is 75 copies of the skill per gate run. The isolated
 * destination is the cwd, verified by probe.
 */
export async function verifyInstallable(input: InstallCheckInput): Promise<InstallCheckResult> {
  const exec = input.exec ?? defaultExec
  const extracted = join(input.stagingDir, 'verify-extract')
  const destination = join(input.stagingDir, 'verify-install')
  await rm(extracted, { recursive: true, force: true })
  await rm(destination, { recursive: true, force: true })
  await mkdir(extracted, { recursive: true })
  await mkdir(destination, { recursive: true })

  await exec('unzip', ['-q', '-o', input.archivePath, '-d', extracted], { timeoutMs: 120_000 })

  try {
    const { stdout, stderr } = await exec(
      input.skillsBin,
      ['add', extracted, '--copy', '--skill', '*', '--agent', 'claude-code', '-y'],
      {
        cwd: destination,
        env: { ...process.env, DO_NOT_TRACK: '1' } as Record<string, string>,
        timeoutMs: input.timeoutMs ?? 180_000,
      },
    )
    return { ok: true, exitCode: 0, output: `${stdout}${stderr}`, destination }
  } catch (err) {
    const failure = err as { code?: number; stdout?: string | Buffer; stderr?: string | Buffer }
    return {
      ok: false,
      exitCode: typeof failure.code === 'number' ? failure.code : null,
      output: `${failure.stdout?.toString() ?? ''}${failure.stderr?.toString() ?? ''}`,
      destination,
    }
  }
}
