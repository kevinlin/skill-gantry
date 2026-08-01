import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** A driver that hangs must not hang the wizard, so every call carries a ceiling. */
export const EXEC_TIMEOUT_MS = 300_000

export interface ExecResult {
  stdout: string
  stderr: string
}

export interface ExecOptions {
  env?: Record<string, string>
  cwd?: string
  timeoutMs?: number
}

/** Injected by tests so the default suite stays offline. */
export type Exec = (
  bin: string,
  argv: readonly string[],
  options?: ExecOptions,
) => Promise<ExecResult>

export const defaultExec: Exec = async (bin, argv, options = {}) => {
  const res = await run(bin, [...argv], {
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeoutMs ?? EXEC_TIMEOUT_MS,
    ...(options.env ? { env: options.env } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
  })
  return { stdout: res.stdout.toString(), stderr: res.stderr.toString() }
}
