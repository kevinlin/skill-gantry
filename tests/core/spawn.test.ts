import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTool, type RunToolInput, type RunToolOutput } from '../../src/core/runner/spawn.js'
import { ECHO_ENV_SCRIPT, GRANDCHILD_SCRIPT, makeFakeTool } from '../helpers/fake-tool.js'

const SECRET = 'sk-testtokenvalue000000000000000000'
const toolDir = async (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-td-'))

const base = {
  cwd: process.cwd(),
  env: {} as NodeJS.ProcessEnv,
  secrets: [] as string[],
  artefacts: [] as string[],
  artefactSizeCapBytes: 1024 * 1024,
  timeoutMs: 5_000,
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function runUntilTimeout(input: RunToolInput, readyOutput: string): Promise<RunToolOutput> {
  const ready = Promise.withResolvers<void>()
  const controller = new AbortController()
  let stdout = ''
  // Keep subprocess I/O real, but do not let the deadline race shell startup.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const run = runTool({
    ...input,
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    onChunk: (stream, chunk) => {
      if (stream !== 'stdout') return
      stdout += chunk
      if (stdout.includes(readyOutput)) ready.resolve()
    },
  })
  try {
    await Promise.race([
      ready.promise,
      run.then(() => {
        throw new Error(`Tool exited before emitting ${JSON.stringify(readyOutput)}`)
      }),
    ])
    await vi.advanceTimersByTimeAsync(input.timeoutMs)
    return await run
  } finally {
    controller.abort()
    vi.useRealTimers()
    await run
  }
}

describe('runTool', () => {
  it('captures stdout, stderr and the exit code', async () => {
    const bin = await makeFakeTool('ok', 'echo out; echo err >&2; exit 0')
    const out = await runTool({ ...base, bin, argv: [], toolDir: await toolDir() })
    expect(out.exitCode).toBe(0)
    expect(out.stdout.trim()).toBe('out')
    expect(out.stderr.trim()).toBe('err')
    expect(out.timedOut).toBe(false)
  })

  it('reports a non-zero exit without throwing', async () => {
    const bin = await makeFakeTool('bad', 'exit 3')
    expect((await runTool({ ...base, bin, argv: [], toolDir: await toolDir() })).exitCode).toBe(3)
  })

  it('writes redacted logs to disk', async () => {
    const bin = await makeFakeTool('leaky', ECHO_ENV_SCRIPT)
    const dir = await toolDir()
    const out = await runTool({
      ...base,
      bin,
      argv: [],
      toolDir: dir,
      env: { ANTHROPIC_AUTH_TOKEN: SECRET },
      secrets: [SECRET],
    })
    const stdoutLog = await readFile(join(dir, 'stdout.log'), 'utf8')
    const stderrLog = await readFile(join(dir, 'stderr.log'), 'utf8')
    expect(stdoutLog).not.toContain(SECRET)
    expect(stderrLog).not.toContain(SECRET)
    expect(stdoutLog).toContain('«redacted»')
    expect(out.stdout).not.toContain(SECRET)
  })

  it('kills the whole process tree on timeout', async () => {
    const pidFile = join(await toolDir(), 'grandchild.pid')
    const bin = await makeFakeTool('hang', GRANDCHILD_SCRIPT)
    const out = await runUntilTimeout({
      ...base,
      bin,
      argv: [pidFile],
      toolDir: await toolDir(),
    }, 'ready\n')
    expect(out.timedOut).toBe(true)
    expect(out.cancelled).toBe(false)
    expect(out.exitCode).toBeNull()

    const pid = Number((await readFile(pidFile, 'utf8')).trim())
    expect(Number.isInteger(pid)).toBe(true)
    expect(pid).toBeGreaterThan(0)
    await expect.poll(() => alive(pid), { timeout: 5_000 }).toBe(false)
  })

  it('preserves partial output written before the timeout', async () => {
    const bin = await makeFakeTool('partial', 'echo before-hang; exec sleep 600')
    const dir = await toolDir()
    const out = await runUntilTimeout({ ...base, bin, argv: [], toolDir: dir }, 'before-hang\n')
    expect(out.timedOut).toBe(true)
    expect(out.cancelled).toBe(false)
    expect(out.stdout).toContain('before-hang')
    expect(await readFile(join(dir, 'stdout.log'), 'utf8')).toContain('before-hang')
  })

  it('loads declared artefacts as bytes', async () => {
    const dir = await toolDir()
    const bin = await makeFakeTool('writer', `printf '{"a":1}' > "$1"`)
    const out = await runTool({
      ...base,
      bin,
      argv: [join(dir, 'report.json')],
      toolDir: dir,
      artefacts: ['report.json'],
    })
    expect(out.artefacts.get('report.json')?.toString()).toBe('{"a":1}')
    expect(out.missingArtefacts).toEqual([])
  })

  it('reports a declared artefact that was never written', async () => {
    const bin = await makeFakeTool('nowrite', 'exit 0')
    const out = await runTool({
      ...base,
      bin,
      argv: [],
      toolDir: await toolDir(),
      artefacts: ['report.json'],
    })
    expect(out.missingArtefacts).toEqual(['report.json'])
  })

  it('refuses to load an artefact over the size cap', async () => {
    const dir = await toolDir()
    await writeFile(join(dir, 'big.json'), 'x'.repeat(2048))
    const bin = await makeFakeTool('noop', 'exit 0')
    const out = await runTool({
      ...base,
      bin,
      argv: [],
      toolDir: dir,
      artefacts: ['big.json'],
      artefactSizeCapBytes: 1024,
    })
    expect(out.oversizeArtefacts).toEqual(['big.json'])
    expect(out.artefacts.has('big.json')).toBe(false)
  })
})
