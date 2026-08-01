import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTool } from '../../src/core/runner/spawn.js'
import { makeFakeTool } from '../helpers/fake-tool.js'

const toolDir = async (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-stream-'))

const base = {
  cwd: process.cwd(),
  env: {} as NodeJS.ProcessEnv,
  secrets: [] as string[],
  artefacts: [] as string[],
  artefactSizeCapBytes: 1024 * 1024,
  timeoutMs: 10_000,
}

describe('streaming output', () => {
  it('delivers chunks before the process exits', async () => {
    const bin = await makeFakeTool('drip', 'echo one; sleep 0.2; echo two; sleep 0.2; echo three')
    const seen: Array<{ at: number; chunk: string }> = []
    const startedAt = Date.now()

    const out = await runTool({
      ...base,
      bin,
      argv: [],
      toolDir: await toolDir(),
      onChunk: (_stream, chunk) => seen.push({ at: Date.now() - startedAt, chunk }),
    })

    expect(seen.length).toBeGreaterThan(1)
    expect(seen[0]!.at).toBeLessThan(out.durationMs)
    expect(seen.map((s) => s.chunk).join('')).toContain('three')
  })

  it('tags the stream each chunk came from', async () => {
    const bin = await makeFakeTool('both', 'echo to-out; echo to-err >&2')
    const streams = new Set<string>()
    await runTool({
      ...base,
      bin,
      argv: [],
      toolDir: await toolDir(),
      onChunk: (stream) => streams.add(stream),
    })
    expect([...streams].sort()).toEqual(['stderr', 'stdout'])
  })

  it('redacts chunks before they leave the runner — R7.4', async () => {
    const secret = 'sk-testtokenvalue000000000000000000'
    const bin = await makeFakeTool('leaky', 'printf "TOKEN=%s\\n" "$ANTHROPIC_AUTH_TOKEN"')
    const chunks: string[] = []
    const dir = await toolDir()

    await runTool({
      ...base,
      bin,
      argv: [],
      toolDir: dir,
      env: { ANTHROPIC_AUTH_TOKEN: secret },
      secrets: [secret],
      onChunk: (_stream, chunk) => chunks.push(chunk),
    })

    expect(chunks.join('')).not.toContain(secret)
    expect(chunks.join('')).toContain('«redacted')
    expect(await readFile(join(dir, 'stdout.log'), 'utf8')).not.toContain(secret)
  })

  it('keeps the full log on disk when the caller keeps nothing — R11.5', async () => {
    const bin = await makeFakeTool(
      'many',
      'i=0; while [ $i -lt 500 ]; do echo "line $i"; i=$((i+1)); done',
    )
    const dir = await toolDir()
    let dropped = 0
    await runTool({
      ...base,
      bin,
      argv: [],
      toolDir: dir,
      onChunk: () => {
        dropped += 1
      },
    })
    const body = await readFile(join(dir, 'stdout.log'), 'utf8')
    expect(body.trim().split('\n')).toHaveLength(500)
    expect(dropped).toBeGreaterThan(0)
  })
})
