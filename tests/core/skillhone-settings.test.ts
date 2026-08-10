import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  serialiseSkillhoneSettings,
  settingsDigest,
  skillhoneSettings,
  skillhoneSettingsPath,
  writeSkillhoneSettings,
} from '../../src/core/tools/skillhone-settings.js'

const TOKEN = 'sk-0123456789abcdef0123456789abcdef'

const ENV: Record<string, string> = {
  ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
  ANTHROPIC_AUTH_TOKEN: TOKEN,
  ANTHROPIC_MODEL: 'deepseek-v4-flash',
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-flash',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-flash',
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
}

const without = (key: string): Record<string, string> =>
  Object.fromEntries(Object.entries(ENV).filter(([name]) => name !== key))

const userHome = (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-skillhone-'))

describe('composing the settings document', () => {
  it('maps every role from ~/.skillgantry/.env', () => {
    const settings = skillhoneSettings(ENV)!
    expect(settings.api_key).toBe(TOKEN)
    expect(settings.improver).toMatchObject({
      api_key: TOKEN,
      api_base: 'https://api.deepseek.com/anthropic',
      model: 'deepseek-v4-flash',
      sdk_model_alias: 'opus',
    })
    expect(settings.executor.sdk_model_alias).toBe('haiku')
    expect(settings.synthesis.sdk_model_alias).toBe('sonnet')
  })

  it('states an alias on every role', () => {
    // template.py defaults a missing alias to haiku and litellm_proxy.py to
    // opus, so a profile without one is told to use a model whose
    // ANTHROPIC_DEFAULT_* key was never set.
    const settings = skillhoneSettings(ENV)!
    for (const role of [settings.improver, settings.executor, settings.synthesis]) {
      expect(role.sdk_model_alias).toBeTruthy()
    }
  })

  it('falls back to ANTHROPIC_MODEL for a role with no default of its own', () => {
    const settings = skillhoneSettings({
      ANTHROPIC_BASE_URL: 'https://gateway.test/anthropic',
      ANTHROPIC_AUTH_TOKEN: TOKEN,
      ANTHROPIC_MODEL: 'one-model',
    })!
    expect(settings.improver.model).toBe('one-model')
    expect(settings.executor.model).toBe('one-model')
    expect(settings.synthesis.model).toBe('one-model')
  })

  it('accepts ANTHROPIC_API_KEY when no auth token is set', () => {
    const settings = skillhoneSettings({ ...without('ANTHROPIC_AUTH_TOKEN'), ANTHROPIC_API_KEY: TOKEN })!
    expect(settings.api_key).toBe(TOKEN)
  })

  it('returns null when the env cannot produce a usable configuration', () => {
    expect(skillhoneSettings(without('ANTHROPIC_AUTH_TOKEN'))).toBeNull()
    expect(skillhoneSettings(without('ANTHROPIC_BASE_URL'))).toBeNull()
    // A base URL and a token, and no model to point any role at.
    expect(skillhoneSettings({ ANTHROPIC_BASE_URL: 'x', ANTHROPIC_AUTH_TOKEN: TOKEN })).toBeNull()
    expect(skillhoneSettings({})).toBeNull()
  })

  it('carries the bearer token in the env block, which the direct branch cannot derive', () => {
    // agent_env_for's slashless branch sets ANTHROPIC_API_KEY and nothing else,
    // so a token gateway is reachable only through the block that wins there.
    const env = skillhoneSettings(ENV)!.improver.env!
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(TOKEN)
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.deepseek.com/anthropic')
    expect(env.ANTHROPIC_MODEL).toBe('opus')
    expect(env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS).toBe('1')
  })

  it('omits the env block for a slashed model, which the proxy would discard', () => {
    const settings = skillhoneSettings({
      ...ENV,
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'anthropic/claude-opus-4-5',
    })!
    expect(settings.improver.env).toBeUndefined()
    // The slashless roles keep theirs: the branch is per profile, not per file.
    expect(settings.executor.env).toBeDefined()
  })

  it('emits no key the pinned checkout has no reader for', () => {
    const text = serialiseSkillhoneSettings(skillhoneSettings(ENV)!)
    for (const dead of [
      'max_iterations',
      'thinking_enabled',
      'context_size',
      'enable_process_pool',
      'temperature',
      'top_p',
      'top_k',
    ]) {
      expect(text).not.toContain(dead)
    }
  })

  it('serialises as strict JSON, which is all every reader but status.py parses', () => {
    const text = serialiseSkillhoneSettings(skillhoneSettings(ENV)!)
    // A leading `//`, not the one in every https URL: upstream's own template
    // is JSON5 and only status.py can read it.
    expect(text.split('\n').filter((line) => line.trimStart().startsWith('//'))).toEqual([])
    expect(text).not.toMatch(/,\s*[}\]]/)
    expect(text.endsWith('\n')).toBe(true)
    expect(() => JSON.parse(text)).not.toThrow()
  })
})

describe('writing the settings file', () => {
  it('writes owner-only inside an owner-only directory', async () => {
    const h = await userHome()
    const outcome = await writeSkillhoneSettings(h, skillhoneSettings(ENV)!)
    expect(outcome.kind).toBe('written')

    const path = skillhoneSettingsPath(h)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(join(h, '.skillhone'))).mode & 0o777).toBe(0o700)
  })

  it('reports a digest over the exact bytes on disk', async () => {
    const h = await userHome()
    const outcome = await writeSkillhoneSettings(h, skillhoneSettings(ENV)!)
    if (outcome.kind !== 'written') throw new Error('expected a write')
    expect(settingsDigest(await readFile(outcome.path, 'utf8'))).toBe(outcome.sha256)
  })

  it('leaves an existing file untouched', async () => {
    const h = await userHome()
    await mkdir(join(h, '.skillhone'), { recursive: true })
    await writeFile(skillhoneSettingsPath(h), '{"hand":"written"}\n')

    const outcome = await writeSkillhoneSettings(h, skillhoneSettings(ENV)!)
    expect(outcome.kind).toBe('exists')
    expect(await readFile(skillhoneSettingsPath(h), 'utf8')).toBe('{"hand":"written"}\n')
  })

  it('leaves no temp file behind', async () => {
    const h = await userHome()
    await writeSkillhoneSettings(h, skillhoneSettings(ENV)!)
    await expect(stat(`${skillhoneSettingsPath(h)}.tmp`)).rejects.toThrow()
  })
})
