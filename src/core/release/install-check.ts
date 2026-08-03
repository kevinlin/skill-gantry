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
  /**
   * Set only when `ok` is false for a reason that is not the tool's own exit:
   * the binary could not be spawned at all, or was killed for running past its
   * timeout. `ok: false` with this `null` is the tool's own refusal — it ran,
   * read the candidate, and exited non-zero. Design §12.4's classification
   * table treats the two differently (`failed` vs `errored`), and a caller
   * cannot tell them apart from `exitCode` alone: a spawn failure and a
   * timeout both usually leave `exitCode` null too.
   */
  errorKind: 'spawn' | 'timeout' | null
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

  // ExecOptions.env is Record<string, string>, but process.env is
  // Record<string, string | undefined> — filter rather than cast, so an
  // unset variable drops out instead of being asserted into a type it isn't.
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  env.DO_NOT_TRACK = '1'

  try {
    const { stdout, stderr } = await exec(
      input.skillsBin,
      ['add', extracted, '--copy', '--skill', '*', '--agent', 'claude-code', '-y'],
      {
        cwd: destination,
        env,
        timeoutMs: input.timeoutMs ?? 180_000,
      },
    )
    return { ok: true, exitCode: 0, output: `${stdout}${stderr}`, destination, errorKind: null }
  } catch (err) {
    const failure = err as {
      code?: number | string
      killed?: boolean
      message?: string
      stdout?: string | Buffer
      stderr?: string | Buffer
    }
    const output = `${failure.stdout?.toString() ?? ''}${failure.stderr?.toString() ?? ''}`
    // `killed` is Node's own signal for "the timeout fired and the process was
    // sent SIGTERM", checked first because a killed process also usually has
    // no numeric exit code to fall back on. A string `code` (ENOENT, EACCES,
    // ...) is a spawn failure: the process never ran, so there is no exit to
    // report and nothing about the candidate to say `failed` about.
    const errorKind: 'spawn' | 'timeout' | null =
      failure.killed === true ? 'timeout' : typeof failure.code === 'string' ? 'spawn' : null
    return {
      ok: false,
      exitCode: typeof failure.code === 'number' ? failure.code : null,
      output: output.length > 0 ? output : (failure.message ?? ''),
      destination,
      errorKind,
    }
  }
}
