import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { defaultSkillsDir, installAgentSkill, locateBundledSkill } from '../core/index.js'
import type { CliDeps } from './run-command.js'

export interface SkillInstallOptions {
  dir?: string
  json?: boolean
}

/**
 * R3.13, §5.5. The two destinations are not symmetric. The default is a
 * directory SkillGantry is entitled to create — a machine that has never run
 * Claude Code has no `~/.claude/skills`, and asking the user to make it first
 * is a dead end for an agent. `--dir` is something the caller named, so one
 * that does not exist is a mistyped path, and creating it would hide that.
 *
 * Every refusal is a throw, which `main()` turns into one `error:` line and
 * exit `2`; printing here would be a second spelling of it.
 */
export async function runSkillInstall(deps: CliDeps, opts: SkillInstallOptions): Promise<void> {
  let skillsDir: string
  if (opts.dir === undefined) {
    skillsDir = defaultSkillsDir(deps.userHome ?? homedir())
    await mkdir(skillsDir, { recursive: true })
  } else {
    skillsDir = resolve(opts.dir)
  }

  const installed = await installAgentSkill({ skillsDir })

  if (opts.json === true) {
    deps.write(JSON.stringify({ installed: [installed] }))
    return
  }
  deps.write(
    `${installed.replaced ? 'replaced' : 'installed'} ${installed.path} (skillgantry ${installed.version})`,
  )
}

/** For an agent that reads a file rather than loading a skill. */
export async function runSkillPath(deps: CliDeps): Promise<void> {
  deps.write(await locateBundledSkill())
}
