import { describe, expect, it } from 'vitest'
import { buildFixPrompt, type FixPromptInput } from '../../src/core/stages/fix-prompt.js'
import type { StageResult, ToolRunRecord } from '../../src/core/stages/types.js'
import type { RawFinding, SkillRef } from '../../src/core/types.js'
import { skillRef } from '../helpers/skill-ref.js'

const RUN_DIR = '/repo/declawed-workspace/skillgantry/runs/019fcd9e'
const STAGE_DIR = `${RUN_DIR}/03-security`

const skill = (isGit = true): SkillRef =>
  skillRef('zapac/declawed', {
    name: 'declawed',
    version: '1.2.0',
    dir: '/repo/declawed',
    relPath: 'declawed',
    repo: { id: 'zapac', path: '/repo', name: 'zapac-agent-skills', isGit },
    workspacePath: '/repo/declawed-workspace',
  })

/** Modelled on run 019fcd9e: skillspector 2.5.1, LP3 + MP2, both medium. */
const FINDINGS: RawFinding[] = [
  {
    ruleClass: 'excessive-permission',
    nativeRuleId: 'LP3',
    severity: 'medium',
    path: 'declawed/SKILL.md',
    line: 1,
    message: 'no declared permissions but code capabilities were detected: file_read',
  },
  {
    ruleClass: 'prompt-injection',
    nativeRuleId: 'MP2',
    severity: 'medium',
    path: 'declawed/scripts/scan.py',
    line: 34,
    message: 'Context Window Stuffing',
  },
]

const toolRun = (over: Partial<ToolRunRecord> = {}): ToolRunRecord => ({
  toolId: 'skillspector',
  toolVersion: '2.5.1',
  outcome: 'failed',
  exitCode: 1,
  durationMs: 4200,
  errorKind: null,
  artefactDir: `${STAGE_DIR}/skillspector`,
  findings: FINDINGS,
  metrics: {},
  summary: '2 findings',
  ...over,
})

const result = (over: Partial<StageResult> = {}): StageResult => ({
  stage: 'security',
  outcome: 'failed',
  verdict: 'failed',
  toolRuns: [toolRun()],
  ...over,
})

const input = (over: Partial<FixPromptInput> = {}): FixPromptInput => ({
  skill: skill(),
  runId: '019fcd9e-eb97-775c-b3ec-abfc705ad05b',
  stageDir: STAGE_DIR,
  skillDigest: 'sha256:abc123',
  git: { commit: 'e1847a7', dirty: false },
  result: result(),
  ...over,
})

describe('R6.10 buildFixPrompt', () => {
  it('names every mandated element', () => {
    const body = buildFixPrompt(input())
    expect(body).not.toBeNull()
    const text = body as string

    expect(text).toContain('# Fix the security findings on zapac/declawed')
    expect(text).toContain('/repo/declawed')
    expect(text).toContain('/repo')
    expect(text).toContain('e1847a7')
    expect(text).toContain('(clean)')
    expect(text).toContain('sha256:abc123')
    expect(text).toContain('019fcd9e-eb97-775c-b3ec-abfc705ad05b')
    expect(text).toContain(`${STAGE_DIR}/stage.json`)
    // The tool's own report, named from the adapter manifest's declared artefacts.
    expect(text).toContain(`${STAGE_DIR}/skillspector/findings.sarif`)
    expect(text).toContain('skillspector** 2.5.1')
  })

  it('renders one table row per finding, with native id and location', () => {
    const text = buildFixPrompt(input()) as string
    expect(text).toContain('| 1 | medium | excessive-permission | LP3 | `declawed/SKILL.md:1` |')
    expect(text).toContain('| 2 | medium | prompt-injection | MP2 | `declawed/scripts/scan.py:34` |')
  })

  it('carries the four judgement instructions and the exact re-verify line', () => {
    const text = buildFixPrompt(input()) as string
    expect(text).toContain('properties.remediation')
    expect(text).toContain('false positive')
    expect(text).toContain('stop and report')
    expect(text).toContain('.skillgantry-workspace/')
    expect(text).toContain('`skillgantry run zapac/declawed --stage security`')
  })

  it('is null when no tool run reported a finding', () => {
    const clean = result({
      outcome: 'passed',
      verdict: 'passed',
      toolRuns: [toolRun({ outcome: 'passed', exitCode: 0, findings: [] })],
    })
    expect(buildFixPrompt(input({ result: clean }))).toBeNull()
  })

  it('is non-null for a §8.1 sub-floor stage that passed', () => {
    const subFloor = result({
      outcome: 'passed',
      verdict: 'passed',
      toolRuns: [
        toolRun({
          outcome: 'passed',
          exitCode: 0,
          findings: [{ ...(FINDINGS[0] as RawFinding), severity: 'low' }],
        }),
      ],
    })
    const text = buildFixPrompt(input({ result: subFloor })) as string
    expect(text).toContain('passed with 1 finding(s)')
    expect(text).toContain('severity `low`')
  })

  it('escapes a pipe in a message so the table survives', () => {
    const piped = result({
      toolRuns: [
        toolRun({
          findings: [{ ...(FINDINGS[0] as RawFinding), message: 'matched a | b\nover two lines' }],
        }),
      ],
    })
    const row = (buildFixPrompt(input({ result: piped })) as string)
      .split('\n')
      .find((l) => l.startsWith('| 1 |')) as string
    expect(row).toContain('matched a \\| b over two lines')
    // Six cells means seven *unescaped* delimiters; the escaped one is content.
    expect(row.split(/(?<!\\)\|/)).toHaveLength(8)
  })

  it('omits the Commit row entirely for a non-git repo', () => {
    const text = buildFixPrompt(
      input({ skill: skill(false), git: { commit: null, dirty: false } }),
    ) as string
    expect(text).not.toContain('| Commit |')
    expect(text).toContain('| Skill digest |')
  })

  it('marks a dirty tree, so the agent knows what it is editing', () => {
    const text = buildFixPrompt(input({ git: { commit: 'e1847a7', dirty: true } })) as string
    expect(text).toContain('dirty — uncommitted changes present')
  })

  it('says the picture is partial when a tool errored without findings', () => {
    const mixed = result({
      outcome: 'degraded',
      toolRuns: [
        toolRun(),
        toolRun({
          toolId: 'skill-scanner',
          outcome: 'errored',
          errorKind: 'timeout',
          findings: [],
          summary: 'timed out after 120s',
          artefactDir: `${STAGE_DIR}/skill-scanner`,
        }),
      ],
    })
    const text = buildFixPrompt(input({ result: mixed })) as string
    expect(text).toContain('did not complete')
    expect(text).toContain('timed out after 120s')
  })

  it('names the artefact directory when no adapter is registered', () => {
    const unknown = result({
      toolRuns: [toolRun({ toolId: 'mystery', artefactDir: `${STAGE_DIR}/mystery` })],
    })
    const text = buildFixPrompt(input({ result: unknown, lookup: () => undefined })) as string
    expect(text).toContain('declared artefacts unknown')
    expect(text).toContain(`${STAGE_DIR}/mystery`)
  })
})

describe('R6.11 suppressed findings', () => {
  const suppress = (f: RawFinding): RawFinding => ({
    ...f,
    suppressed: { justification: 'accepted false positive' },
  })

  it('writes none when every finding is suppressed', () => {
    const run = toolRun({ findings: FINDINGS.map(suppress), outcome: 'passed' })
    expect(buildFixPrompt(input({ result: result({ toolRuns: [run], outcome: 'passed' }) }))).toBeNull()
  })

  it('omits the suppressed rows, renumbers the survivors, and names the count', () => {
    const run = toolRun({ findings: [suppress(FINDINGS[0] as RawFinding), FINDINGS[1] as RawFinding] })
    const text = buildFixPrompt(input({ result: result({ toolRuns: [run] }) })) as string

    expect(text).toContain('| 1 | medium | prompt-injection')
    expect(text).not.toContain('| 2 |')
    expect(text).not.toContain('LP3')
    expect(text).toContain('MP2')
    expect(text).toContain('1 further finding(s) are suppressed')
    // The header counts what the table holds, not what the tool reported.
    expect(text).toContain('with 1 finding(s)')
  })

  it('says nothing about suppression when there is none', () => {
    expect(buildFixPrompt(input()) as string).not.toContain('suppressed')
  })

  it('still writes one for a sub-floor passed stage — suppression is not severity', () => {
    const low = FINDINGS.map((f) => ({ ...f, severity: 'low' as const }))
    const run = toolRun({ findings: low, outcome: 'passed' })
    expect(buildFixPrompt(input({ result: result({ toolRuns: [run], outcome: 'passed' }) }))).not.toBeNull()
  })
})
