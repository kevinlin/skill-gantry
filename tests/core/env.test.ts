import { describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadEnvFile, provenanceOf, withAnalysisModes } from '../../src/core/config/env.js'

const ENV = [
  'ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic',
  'ANTHROPIC_AUTH_TOKEN=sk-testtokenvalue000000000000000000',
  'ANTHROPIC_MODEL=deepseek-v4-pro',
  'ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-v4-pro',
  'ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-pro',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash',
  'CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flash',
  '# a comment',
  '',
].join('\n')

async function homeWithEnv(mode = 0o600): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'sg-env-'))
  await mkdir(home, { recursive: true })
  const file = join(home, '.env')
  await writeFile(file, ENV)
  await chmod(file, mode)
  return home
}

describe('loadEnvFile', () => {
  it('reports absence rather than throwing', async () => {
    const load = await loadEnvFile(await mkdtemp(join(tmpdir(), 'sg-env-')))
    expect(load.present).toBe(false)
    expect(load.secrets).toEqual([])
  })

  it('parses assignments and skips comments and blanks', async () => {
    const load = await loadEnvFile(await homeWithEnv())
    expect(load.vars.ANTHROPIC_MODEL).toBe('deepseek-v4-pro')
    expect(Object.keys(load.vars)).toHaveLength(7)
  })

  it('collects the token as a secret and never the model names', async () => {
    const load = await loadEnvFile(await homeWithEnv())
    expect(load.secrets).toContain('sk-testtokenvalue000000000000000000')
    expect(load.secrets).not.toContain('deepseek-v4-pro')
  })

  it('warns when the mode is looser than 600', async () => {
    const load = await loadEnvFile(await homeWithEnv(0o644))
    expect(load.warnings.join(' ')).toMatch(/permissive/)
  })
})

describe('provenanceOf', () => {
  it('records the host, five model mappings and a token hash but not the token', async () => {
    const { vars } = await loadEnvFile(await homeWithEnv())
    const prov = provenanceOf(vars)
    expect(prov.baseUrlHost).toBe('api.deepseek.com')
    expect(Object.keys(prov.models)).toHaveLength(5)
    expect(prov.authTokenHash).toMatch(/^sha256:[0-9a-f]{8}$/)
    expect(JSON.stringify(prov)).not.toContain('sk-testtokenvalue')
  })

  it('starts with no analysis modes, which only the pipeline can know', () => {
    expect(provenanceOf({}).analysisModes).toEqual({})
    expect(withAnalysisModes(provenanceOf({}), { skillspector: 'static' }).analysisModes).toEqual({
      skillspector: 'static',
    })
  })

  it('yields a null host when no base url is set', () => {
    expect(provenanceOf({}).baseUrlHost).toBeNull()
  })
})
