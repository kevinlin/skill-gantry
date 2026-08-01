import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface UvInstallSpec {
  id: string
  kind: 'uv-tool'
  spec: string
  pin: string
  binName: string
}

/**
 * A registry spec pins with `==`; a git spec pins with `@<ref>`. SkillSpector is
 * published only as a git source, so a driver that could form just the registry
 * requirement could not install the one tool M1 exists to run.
 */
export function requirement(spec: UvInstallSpec): string {
  return spec.spec.startsWith('git+') ? `${spec.spec}@${spec.pin}` : `${spec.spec}==${spec.pin}`
}

/**
 * uv 0.7.12 has no `--tool-dir`. Relocation is through UV_TOOL_DIR and
 * UV_TOOL_BIN_DIR, set explicitly rather than inherited so an install cannot
 * land in the user's global tool directory.
 */
export async function uvInstall(dir: string, spec: UvInstallSpec): Promise<string> {
  const binDir = join(dir, 'bin')
  try {
    await run('uv', ['tool', 'install', requirement(spec)], {
      env: { ...process.env, UV_TOOL_DIR: dir, UV_TOOL_BIN_DIR: binDir },
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch (err) {
    const detail = (err as { stderr?: string }).stderr ?? (err as Error).message
    throw new Error(`install failed for ${spec.id}@${spec.pin}: ${detail}`)
  }
  return join(binDir, spec.binName)
}
