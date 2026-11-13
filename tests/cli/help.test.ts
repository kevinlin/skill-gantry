import { describe, expect, it } from 'vitest'
import type { Command } from 'commander'
import { buildProgram, resolveSkill } from '../../src/cli/run-command.js'
import { makeHeadless } from '../helpers/headless.js'
import { skillRef } from '../helpers/skill-ref.js'

const walk = (command: Command, trail: string[] = []): Array<{ path: string; command: Command }> =>
  command.commands.flatMap((child) => [
    { path: [...trail, child.name()].join(' '), command: child },
    ...walk(child, [...trail, child.name()]),
  ])

describe('skillgantry --help', () => {
  it('describes every command, at every depth', async () => {
    const h = await makeHeadless()
    const program = buildProgram(h.deps)
    const undescribed = walk(program)
      .filter(({ command }) => command.description().trim() === '')
      .map(({ path }) => path)
    expect(undescribed).toEqual([])
  })

  it('lists the headless commands with their descriptions on the help screen', async () => {
    const h = await makeHeadless()
    expect(await h.run(['--help'])).toBe(0)
    const text = h.out.join('\n')
    // A command line carrying only its name and arguments is an undescribed one.
    const commandLines = text.split('\n').filter((line) => /^\s{2}[a-z]/.test(line))
    for (const name of ['list', 'status', 'run', 'release', 'retire', 'repo']) {
      expect(commandLines.some((line) => line.trim().startsWith(name))).toBe(true)
    }
    for (const line of commandLines) expect(line.trim().split(/\s{2,}/).length).toBeGreaterThan(1)
  })

  it('groups the commands as look, act, ship and set up, in that order', async () => {
    const h = await makeHeadless()
    expect(await h.run(['--help'])).toBe(0)

    // A heading is the one unindented line ending in a colon; the commands
    // beneath it are the indented lines up to the next blank one.
    const groups: Array<[string, string[]]> = []
    for (const line of h.out.join('\n').split('\n')) {
      const heading = /^([A-Z][A-Za-z ]*):$/.exec(line)
      if (heading) groups.push([heading[1] as string, []])
      const command = /^ {2}([a-z]\S*)/.exec(line)
      if (command) groups.at(-1)?.[1].push(command[1] as string)
    }

    // A stray `Commands:` heading would be a command registered with no group.
    expect(groups.filter(([heading]) => heading !== 'Options')).toEqual([
      ['Look', ['list', 'status', 'doctor']],
      ['Act', ['run', 'fix', 'evals', 'optimise', 'suppress', 'issue']],
      ['Ship', ['release', 'retire', 'recover']],
      ['Set up', ['setup', 'repo', 'skill', 'upgrade']],
    ])
  })

  it('leaves no command of ours outside a group', async () => {
    const h = await makeHeadless()
    const ungrouped = buildProgram(h.deps)
      .commands.filter((command) => command.helpGroup() === '')
      .map((command) => command.name())
    expect(ungrouped).toEqual([])
  })

  it('says what run does without --stage', async () => {
    const h = await makeHeadless()
    expect(await h.run(['run', '--help'])).toBe(0)
    // commander wraps the option's description, so compare it unwrapped.
    expect(h.out.join('\n').replace(/\s+/g, ' ')).toContain('default: validate, evaluate and security')
  })
})

describe('resolveSkill', () => {
  const two = [
    skillRef('a/dup', { name: 'dup' }),
    skillRef('b/dup', { name: 'dup' }),
  ]

  it('ends the ambiguity error with a hint to use the full id', () => {
    expect(() => resolveSkill(two, 'dup')).toThrow(
      'ambiguous skill "dup": a/dup, b/dup; use the full <repoId>/<name> id',
    )
  })

  it('gives the same hint when the ambiguity is between declared names', () => {
    const roots = [skillRef('r1', { name: 'tool' }), skillRef('r2', { name: 'tool' })]
    expect(() => resolveSkill(roots, 'tool')).toThrow(/ambiguous skill "tool": r1, r2; use the full <repoId>\/<name> id$/)
  })
})
