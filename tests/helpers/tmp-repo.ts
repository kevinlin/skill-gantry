import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export interface RepoSpec {
  /** Relative path -> file contents. Directories are created as needed. */
  files: Record<string, string>
}

export async function makeRepo(spec: RepoSpec): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'skillgantry-'))
  for (const [rel, contents] of Object.entries(spec.files)) {
    const abs = join(root, rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, contents)
  }
  return root
}

export const SKILL_MD = (name: string, version = '1.0.0'): string =>
  `---\nname: ${name}\nmetadata:\n  version: ${version}\n---\n\n# ${name}\n`
