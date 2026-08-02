import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface FakeMutatingTool {
  bin: string
}

/**
 * Stands in for an optimise tool: it rewrites `SKILL.md` in the directory it is
 * pointed at and writes a SARIF report so the adapter path is exercised end to
 * end. The point is that it writes *inside the sandbox*, which is the only way
 * to prove `{skillDir}` resolved there.
 */
export async function makeFakeMutatingTool(replacement: string): Promise<FakeMutatingTool> {
  const dir = await mkdtemp(join(tmpdir(), 'sg-mut-tool-'))
  const bin = join(dir, 'fake-optimiser')
  // A heredoc with a quoted delimiter, not `printf '%s' <json-escaped>`: `%s`
  // substitution does not re-expand the backslash escapes JSON.stringify
  // produces, so a printf'd multi-line replacement lands as literal `\n`
  // rather than a newline on both dash and bash.
  await writeFile(
    bin,
    `#!/bin/sh\n# $1 is the skill dir, $2 the tool dir\ncat > "$1/SKILL.md" <<'SKILLGANTRY_EOF'\n${replacement}SKILLGANTRY_EOF\nprintf '{"version":"2.1.0","runs":[{"tool":{"driver":{"name":"fake"}},"results":[]}]}' > "$2/findings.sarif"\necho rewrote SKILL.md\nexit 0\n`,
  )
  await chmod(bin, 0o755)
  return { bin }
}
