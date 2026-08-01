import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { RedactionTransform, redactString } from './redaction.js'

export interface RunToolInput {
  bin: string
  argv: string[]
  cwd: string
  /** Directory receiving stdout.log, stderr.log and this tool's artefacts. */
  toolDir: string
  env: NodeJS.ProcessEnv
  secrets: readonly string[]
  artefacts: readonly string[]
  artefactSizeCapBytes: number
  timeoutMs: number
  signal?: AbortSignal
}

export interface RunToolOutput {
  exitCode: number | null
  signalled: NodeJS.Signals | null
  timedOut: boolean
  cancelled: boolean
  /** ENOENT, EACCES and friends: the process never started, so exitCode is meaningless. */
  spawnFailed: boolean
  spawnError: string | null
  durationMs: number
  stdout: string
  stderr: string
  artefacts: Map<string, Buffer>
  missingArtefacts: string[]
  oversizeArtefacts: string[]
}

/**
 * Kills the child's entire process group. Spawning detached puts the child in
 * its own group, so a negative pid reaches every descendant. Killing only the
 * child would leave orphans holding the temp directory open.
 */
function killTree(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      // Already gone.
    }
  }
}

async function loadArtefacts(
  toolDir: string,
  names: readonly string[],
  capBytes: number,
): Promise<Pick<RunToolOutput, 'artefacts' | 'missingArtefacts' | 'oversizeArtefacts'>> {
  const artefacts = new Map<string, Buffer>()
  const missingArtefacts: string[] = []
  const oversizeArtefacts: string[] = []

  for (const name of names) {
    const path = join(toolDir, name)
    try {
      const info = await stat(path)
      if (info.size > capBytes) {
        oversizeArtefacts.push(name)
        continue
      }
      artefacts.set(name, await readFile(path))
    } catch {
      missingArtefacts.push(name)
    }
  }
  return { artefacts, missingArtefacts, oversizeArtefacts }
}

export async function runTool(input: RunToolInput): Promise<RunToolOutput> {
  await mkdir(input.toolDir, { recursive: true })
  const startedAt = Date.now()

  const child = spawn(input.bin, input.argv, {
    cwd: input.cwd,
    env: input.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const capture = { stdout: '', stderr: '' }
  const closed: Promise<void>[] = []

  for (const stream of ['stdout', 'stderr'] as const) {
    const source = child[stream]
    if (!source) continue
    const redactor = new RedactionTransform(input.secrets)
    const sink = createWriteStream(join(input.toolDir, `${stream}.log`))
    source.setEncoding('utf8')
    source.on('data', (chunk: string) => {
      capture[stream] += chunk
    })
    source.pipe(redactor).pipe(sink)
    closed.push(new Promise<void>((resolve) => sink.on('close', () => resolve())))
  }

  let timedOut = false
  let cancelled = false

  const timer = setTimeout(() => {
    timedOut = true
    if (child.pid) killTree(child.pid, 'SIGKILL')
  }, input.timeoutMs)

  const onAbort = (): void => {
    cancelled = true
    if (child.pid) killTree(child.pid, 'SIGKILL')
  }
  input.signal?.addEventListener('abort', onAbort, { once: true })

  let spawnError: string | null = null

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.on('error', (err) => {
        spawnError = err.message
        resolve({ code: null, signal: null })
      })
      child.on('close', (code, signal) => resolve({ code, signal }))
    },
  )

  clearTimeout(timer)
  input.signal?.removeEventListener('abort', onAbort)
  await Promise.all(closed)

  const loaded = await loadArtefacts(input.toolDir, input.artefacts, input.artefactSizeCapBytes)

  return {
    exitCode: timedOut || cancelled ? null : exit.code,
    signalled: exit.signal,
    timedOut,
    cancelled,
    spawnFailed: spawnError !== null,
    spawnError,
    durationMs: Date.now() - startedAt,
    stdout: redactString(capture.stdout, input.secrets),
    stderr: redactString(capture.stderr, input.secrets),
    ...loaded,
  }
}
