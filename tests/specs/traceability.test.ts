import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const ID = /^R\d+\.\d+[a-z]?$/
const RANGE = /^(R\d+\.\d+[a-z]?)[–-](R\d+\.\d+[a-z]?)$/
const GROUP = /^R(\d+)$/

/** Declaration order is the authority: `R6.1–R6.8` covers R6.9 because
    requirements.md declares R6.9 first, and a numeric expansion reports a
    gap that is not there. */
function declaredIds(requirements: string): string[] {
  return [...requirements.matchAll(/^- \*\*(R\d+\.\d+[a-z]?)\*\*/gm)].map((m) => m[1] as string)
}

function expand(token: string, ids: readonly string[]): string[] {
  const range = RANGE.exec(token)
  if (range) {
    const from = ids.indexOf(range[1] as string)
    const to = ids.indexOf(range[2] as string)
    if (from === -1 || to === -1 || to < from) throw new Error(`unresolvable range: ${token}`)
    return ids.slice(from, to + 1)
  }
  const group = GROUP.exec(token)
  if (group) return ids.filter((id) => id.startsWith(`R${group[1] as string}.`))
  if (!ID.test(token)) throw new Error(`unparsable requirement token: ${token}`)
  if (!ids.includes(token)) throw new Error(`unknown requirement: ${token}`)
  return [token]
}

/** A label may carry prose after its ids — §10.3 ends in a sentence and §6
    says `R9 dispatch` — so each comma-separated token contributes its first
    word only, trailing periods stripped. */
const tokensOf = (body: string): string[] =>
  body
    .split(',')
    .map((part) => (part.trim().split(/\s+/)[0] ?? '').replace(/\.+$/, ''))
    .filter((token) => token.length > 0)

describe('R13.7 traceability', () => {
  it('gives every requirement exactly one milestone owner', async () => {
    const requirements = await readFile('docs/specs/requirements.md', 'utf8')
    const ids = declaredIds(requirements)
    expect(ids.length).toBeGreaterThan(100)

    const owner = new Map<string, string>()
    const twice: string[] = []
    // `M\d+(?:\.\d+)?`, not `M\d`: the milestone reached sub-numbering at M4.1, and a
    // single-digit class silently matched no row at all rather than failing.
    for (const row of requirements.matchAll(/^\| (M\d+(?:\.\d+)?) \| ([^|]+) \|/gm)) {
      const milestone = row[1] as string
      for (const token of tokensOf(row[2] as string)) {
        for (const id of expand(token, ids)) {
          if (owner.has(id)) twice.push(`${id}: ${owner.get(id) as string} and ${milestone}`)
          owner.set(id, milestone)
        }
      }
    }

    expect(twice).toEqual([])
    expect(ids.filter((id) => !owner.has(id))).toEqual([])
  })

  it('has a design section claiming every requirement, and claims none that does not exist', async () => {
    const requirements = await readFile('docs/specs/requirements.md', 'utf8')
    // The design layer is two files: §14 was split into design_tui.md when
    // design.md passed 1600 lines. Both are read and their labels unioned, so
    // where a section lives cannot change whether its requirement is claimed.
    const design = (
      await Promise.all(
        ['docs/specs/design.md', 'docs/specs/design_tui.md'].map((path) => readFile(path, 'utf8')),
      )
    ).join('\n')
    const ids = declaredIds(requirements)

    const claimed = new Set<string>()
    for (const label of design.matchAll(/^\*Satisfies ([^*]+)\*/gm)) {
      for (const token of tokensOf(label[1] as string)) {
        for (const id of expand(token, ids)) claimed.add(id)
      }
    }

    expect(ids.filter((id) => !claimed.has(id))).toEqual([])
    expect([...claimed].filter((id) => !ids.includes(id))).toEqual([])
  })
})

/**
 * The header stated the revision and so did the running paragraph, and nothing
 * checked that the two agreed — so the header sat at "revision 3" while the
 * body reached 24, and every reader who trusted the front matter was reading a
 * document twenty-one revisions out of date. Two records of one fact is the
 * duplication the milestone table's own note refuses; this is the check that
 * makes them one.
 */
describe('the requirements front matter', () => {
  it('states the revision the body has actually reached', async () => {
    const requirements = await readFile('docs/specs/requirements.md', 'utf8')
    const header = /^\*\*Status:\*\* revision (\d+)/m.exec(requirements)
    expect(header).not.toBeNull()

    // Every amendment marker in the body, which is where a revision is spent.
    const marked = [...requirements.matchAll(/\(rev (\d+)\)/g)].map((m) => Number(m[1]))
    expect(marked.length).toBeGreaterThan(0)
    expect(Number(header?.[1])).toBe(Math.max(...marked))
  })
})
