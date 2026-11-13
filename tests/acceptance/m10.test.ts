import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, loadToolLock, saveConfig, saveToolLock } from '../../src/core/config/config.js'
import type { ToolLockEntry } from '../../src/core/config/config.js'
import { makeFakeTool } from '../helpers/fake-tool.js'
import { type Headless, makeHeadless } from '../helpers/headless.js'
import { SKILL_MD_FULL } from '../helpers/tmp-repo.js'

/**
 * M10's exit criterion, driven the way an agent drives it: through `main()`,
 * with no terminal, reading nothing but the two streams and the exit code, and
 * taking every next command from the `status` document rather than from this
 * file. A loop that only worked because the test knew which command came next
 * would prove nothing about `next`.
 */

const EVAL_REPORT = join(process.cwd(), 'tests/fixtures/skill-up/declawed-iteration-3.report.json')

const sarif = (suppressed: boolean): string =>
  JSON.stringify({
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'skillspector', version: '2.11.2' } },
        results: [
          {
            ruleId: 'MP2',
            message: { text: 'Context Window Stuffing' },
            level: 'error',
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'scripts/scan.py' },
                  region: { startLine: 3 },
                },
              },
            ],
            ...(suppressed ? { suppressions: [{ kind: 'external', justification: 'accepted' }] } : {}),
          },
        ],
      },
    ],
  })

/** m8's stand-in: the finding is annotated only once the baseline names it. */
const SKILLSPECTOR = `
if [ "$8" = "--baseline" ] && [ -f "$9" ] && grep -q 'id: MP2' "$9"; then
  printf '%s' '${sarif(true)}' > "$7"
else
  printf '%s' '${sarif(false)}' > "$7"
fi
`

const SKILL_LINT = `printf '%s' '{"tool":"skill-lint","schemaVersion":1,"skill":{"files":[]},"findings":[]}'`

/** argv is `run <suite> --format json --output-dir <dir> --iteration 1`. */
const SKILL_UP = `mkdir -p "$6/iteration-1" && cp "${EVAL_REPORT}" "$6/iteration-1/report.json"`

const locked = (installKind: ToolLockEntry['installKind'], version: string, bin: string): ToolLockEntry => ({
  installKind,
  requestedPin: version,
  resolvedVersion: version,
  bin,
  integrity: 'n/a',
  installedAt: '2026-08-01T00:00:00Z',
  verifiedAt: '2026-08-01T00:00:00Z',
})

async function harness(): Promise<Headless> {
  const h = await makeHeadless({
    git: true,
    releaseTool: true,
    repos: [
      {
        'sk/SKILL.md': SKILL_MD_FULL('sk'),
        'sk/scripts/scan.py': 'import re\n\nPATTERN = re.compile(r"a   b", re.VERBOSE)\n',
        'sk/evals/eval.yaml': 'schema_version: v1alpha1\n',
      },
    ],
  })
  const lock = await loadToolLock(h.home)
  await saveToolLock(h.home, {
    ...lock,
    tools: {
      ...lock.tools,
      'skill-lint': locked('npm-prefix', '0.2.0', await makeFakeTool('skill-lint', SKILL_LINT)),
      'skill-up': locked('gh-release', '0.11.0', await makeFakeTool('skill-up', SKILL_UP)),
      skillspector: locked('uv-tool', '2.11.2', await makeFakeTool('skillspector', SKILLSPECTOR)),
    },
  })
  const config = await loadConfig(h.home)
  await saveConfig(h.home, {
    ...config,
    stageTools: { ...config.stageTools, validate: ['skill-lint'], evaluate: ['skill-up'], security: ['skillspector'] },
  })
  return h
}

interface Status {
  skill: { id: string; digest: string }
  gates: Array<{ stage: string; outcome: string | null; runId: string | null; current: boolean }>
  hasEvalSuite: boolean
  issues: { open: number; suppressed: number }
  release: { ready: boolean; blockers: Array<{ code: string }>; dirty: string[]; unchecked: string[] }
  next: Array<{ command: string | null; why: string }>
}

async function status(h: Headless): Promise<Status> {
  h.out.length = 0
  expect(await h.run(['status', 'sk', '--json'])).toBe(0)
  return h.json<Status>()
}

/** A `next` command as the argv an agent would type, minus the binary. */
const argvOf = (command: string): string[] => {
  expect(command.startsWith('skillgantry ')).toBe(true)
  return command.split(' ').slice(1)
}

async function follow(h: Headless, command: string | null): Promise<number> {
  expect(command).not.toBeNull()
  h.out.length = 0
  return h.run(argvOf(command as string))
}

describe('M10: an agent drives a skill from never-run to released', () => {
  it('reaches a release by following status.next and nothing else', async () => {
    const h = await harness()
    const repo = h.repos[0] as string

    // list names the skill by the id every other command takes.
    expect(await h.run(['list', '--json'])).toBe(0)
    const listed = h.json<{ skills: Array<{ id: string; gates: Record<string, string | null> }> }>()
    expect(listed.skills).toHaveLength(1)
    expect(listed.skills[0]?.gates).toEqual({ validate: null, evaluate: null, security: null })

    // Never ran: every gate absent, and the one thing to do is run them.
    let doc = await status(h)
    expect(doc.gates.map((g) => g.outcome)).toEqual([null, null, null])
    expect(doc.release.ready).toBe(false)
    expect(doc.next[0]?.command).toBe(`skillgantry run ${doc.skill.id} --stage validate,evaluate,security`)

    // The run fails on security. Exit 1: it ran, and the answer was no.
    expect(await follow(h, doc.next[0]?.command ?? null)).toBe(1)

    doc = await status(h)
    expect(doc.gates.map((g) => [g.stage, g.outcome, g.current])).toEqual([
      ['validate', 'passed', true],
      ['evaluate', 'passed', true],
      ['security', 'failed', true],
    ])
    expect(doc.issues.open).toBe(1)
    const security = doc.gates[2]
    const fix = doc.next.find((step) => step.command?.includes(' fix '))
    expect(fix?.command).toBe(
      `skillgantry fix ${doc.skill.id} --stage security --run ${security?.runId}`,
    )

    // The suggested command prints a prompt, and the prompt carries the exact
    // suppress line for the finding.
    expect(await follow(h, fix?.command ?? null)).toBe(0)
    const prompt = h.out.join('\n')
    expect(prompt).toContain('# Fix the security findings')
    const suppress = /`(skillgantry suppress [^`]+)`/.exec(prompt)?.[1]
    expect(suppress).toContain("--rule 'MP2'")

    // The agent judged it a false positive and records it, with its reason.
    h.out.length = 0
    expect(
      await h.run([
        'suppress', doc.skill.id, '--tool', 'skillspector', '--rule', 'MP2',
        '--path', 'sk/scripts/scan.py', '--reason', 'alignment whitespace inside re.VERBOSE', '--yes',
      ]),
    ).toBe(0)

    // The suppression file is part of the skill, so every verdict is now about
    // other bytes — and status says so instead of leaving release to refuse.
    const before = doc.skill.digest
    doc = await status(h)
    expect(doc.skill.digest).not.toBe(before)
    expect(doc.gates.map((g) => g.current)).toEqual([false, false, false])
    expect(doc.release.blockers.map((b) => b.code)).toContain('digest-mismatch')
    expect(doc.next[0]?.command).toBe(`skillgantry run ${doc.skill.id} --stage validate,evaluate,security`)

    expect(await follow(h, doc.next[0]?.command ?? null)).toBe(0)

    doc = await status(h)
    expect(doc.release).toMatchObject({ ready: true, blockers: [] })
    expect(doc.release.unchecked).toEqual(['target-version', 'archive', 'sandbox'])
    expect(doc.issues).toMatchObject({ open: 0, suppressed: 1 })
    // The baseline is uncommitted, which status reports and release needs told.
    expect(doc.release.dirty).toContain('sk/.skillspector-baseline.yaml')
    expect(doc.next).toHaveLength(1)
    expect(doc.next[0]?.command).toBe(
      `skillgantry release ${doc.skill.id} --version <patch|minor|major> --yes`,
    )
    expect(doc.next[0]?.why).toContain('--allow-dirty')

    // The one placeholder is the one input release will not infer.
    h.out.length = 0
    const release = argvOf((doc.next[0]?.command as string).replace('<patch|minor|major>', 'patch'))
    expect(await h.run([...release, '--allow-dirty'])).toBe(0)
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('1.0.1')
    expect((await stat(join(repo, 'sk_1.0.1.zip'))).size).toBeGreaterThan(0)
    expect(h.err).toEqual([])
  }, 60_000)

  it('answers every request it cannot carry out with one line and exit 2', async () => {
    const h = await harness()

    expect(await h.run(['status', 'nope', '--json'])).toBe(2)
    expect(h.err).toEqual(['error: no skill matching "nope"'])
    expect(h.json()).toEqual({ error: { message: 'no skill matching "nope"' } })

    h.err.length = 0
    expect(await h.run(['list', '--bogus'])).toBe(2)
    expect(h.err).toHaveLength(1)

    for (const args of [[], ['setup']]) {
      h.err.length = 0
      expect(await h.run(args, { stdinIsTTY: false })).toBe(2)
      expect(h.err).toHaveLength(1)
      expect(h.err[0]).toContain('skillgantry status <skill>')
    }
  })

  it('installs the bundled skill only over what it wrote', async () => {
    const h = await harness()
    const skills = await mkdtemp(join(tmpdir(), 'sg-agent-skills-'))

    expect(await h.run(['skill', 'path'])).toBe(0)
    const bundled = h.out.at(-1) as string
    expect((await stat(join(bundled, 'SKILL.md'))).isFile()).toBe(true)

    h.out.length = 0
    expect(await h.run(['skill', 'install', '--dir', skills, '--json'])).toBe(0)
    const first = h.json<{ installed: Array<{ path: string; replaced: boolean }> }>()
    expect(first.installed).toEqual([expect.objectContaining({ path: join(skills, 'skillgantry'), replaced: false })])
    expect(await readFile(join(skills, 'skillgantry/SKILL.md'), 'utf8')).toBe(
      await readFile(join(bundled, 'SKILL.md'), 'utf8'),
    )

    h.out.length = 0
    expect(await h.run(['skill', 'install', '--dir', skills, '--json'])).toBe(0)
    expect(h.json<{ installed: Array<{ replaced: boolean }> }>().installed[0]?.replaced).toBe(true)

    // Someone else's directory of the same name is refused, and left alone.
    const foreign = await mkdtemp(join(tmpdir(), 'sg-agent-skills-'))
    await mkdir(join(foreign, 'skillgantry'))
    await writeFile(join(foreign, 'skillgantry/SKILL.md'), 'mine\n')
    h.err.length = 0
    expect(await h.run(['skill', 'install', '--dir', foreign])).toBe(2)
    expect(h.err[0]).toContain(join(foreign, 'skillgantry'))
    expect(await readFile(join(foreign, 'skillgantry/SKILL.md'), 'utf8')).toBe('mine\n')

    // A symlink is refused without being followed.
    const linked = await mkdtemp(join(tmpdir(), 'sg-agent-skills-'))
    await symlink(join(foreign, 'skillgantry'), join(linked, 'skillgantry'))
    expect(await h.run(['skill', 'install', '--dir', linked])).toBe(2)
    expect(await readFile(join(foreign, 'skillgantry/SKILL.md'), 'utf8')).toBe('mine\n')
  })
})
