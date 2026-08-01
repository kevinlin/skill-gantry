import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Writes an executable shell script into a fresh temp dir and returns its path. */
export async function makeFakeTool(name: string, script: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sg-tool-'))
  const path = join(dir, name)
  await writeFile(path, `#!/bin/sh\n${script}\n`)
  await chmod(path, 0o755)
  return path
}

/** Spawns a long-lived grandchild, writes its pid, then hangs. */
export const GRANDCHILD_SCRIPT = `
sleep 600 &
echo $! > "$1"
sleep 600
`

export const ECHO_ENV_SCRIPT = `
printf 'TOKEN=%s' "$ANTHROPIC_AUTH_TOKEN"
printf 'more output\\n'
printf 'stderr %s\\n' "$ANTHROPIC_AUTH_TOKEN" >&2
`
