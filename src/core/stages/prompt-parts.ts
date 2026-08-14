import { resolveBaselinePath } from '../adapters/paths.js'
import { getAdapter } from '../adapters/registry.js'
import type { RawFinding, SkillRef } from '../types.js'
import { isActionable } from './outcome.js'
import type { ToolRunRecord } from './types.js'

/**
 * The manifest fields a prompt reads. Injectable so a test need not register an
 * adapter, and narrowed to what is read so a fake cannot drift from the real
 * one in a field nothing here consults.
 */
export type ManifestLookup = (
  id: string,
) => { manifest: { artefacts: readonly string[]; baseline?: { path: string } } } | undefined

/** A message goes into a markdown table cell, so its two breaking characters go. */
export const cell = (text: string): string =>
  text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()

/** One actionable finding with the tool that reported it. */
export interface AttributedFinding {
  toolId: string
  finding: RawFinding
}

/**
 * The rows a prompt renders, paired with their detecting tool rather than
 * flattened away: `RawFinding` carries no toolId, so a merged fan-out table used
 * to leave the agent unable to tell which scanner's report it was being told to
 * read (R6.14). `omitted` is R6.11's count — findings the tool itself reported
 * as suppressed, which a prompt names but never lists.
 */
export function attributedRows(toolRuns: readonly ToolRunRecord[]): {
  rows: AttributedFinding[]
  omitted: number
} {
  const rows: AttributedFinding[] = []
  let omitted = 0
  for (const run of toolRuns) {
    for (const finding of run.findings) {
      if (isActionable(finding)) rows.push({ toolId: run.toolId, finding })
      else omitted += 1
    }
  }
  return { rows, omitted }
}

/** One finding as the prompt's own table numbered it. */
export interface SuppressibleFinding {
  /** The label the table gave it — `2`, or `security finding 2` across stages. */
  label: string
  toolId: string
  nativeRuleId: string
  /** Repo-relative, exactly as the table shows it. */
  path: string
}

/**
 * Single-quoted so a rule id or path with a space survives the shell, and
 * close-reopen escaped so one with an apostrophe does too. Correct by
 * construction rather than by survey: rule ids are `LP3`/`MP2`-shaped today, but
 * `path` is a filename the user chose, and an unterminated quote here is a
 * command line an agent runs against the user's own repo.
 *
 * It cannot protect `--reason`. The agent replaces that placeholder with its own
 * prose and does its own quoting, so the escaping an apostrophe there needs is
 * the agent's to apply.
 */
const arg = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

/**
 * R6.14's block: name the tool's own suppression file and the exact command
 * that records one finding in it. Empty when no listed finding's tool declares
 * one — the axis is the detecting tool, never the stage, because R4.16 makes
 * `baseline` optional and `skillgantry suppress` exits non-zero having written
 * nothing for a tool that declares none.
 */
export function suppressSection(
  skill: SkillRef,
  findings: readonly SuppressibleFinding[],
  lookup?: ManifestLookup,
): string[] {
  const resolve = lookup ?? getAdapter
  const recordable: SuppressibleFinding[] = []
  const uncovered: SuppressibleFinding[] = []
  // Per tool rather than per finding, and the one accumulator that is not a
  // projection of the others: the file list is one line per tool.
  const baselines = new Map<string, string>()

  for (const finding of findings) {
    const spec = resolve(finding.toolId)?.manifest.baseline
    if (spec === undefined) {
      uncovered.push(finding)
      continue
    }
    baselines.set(finding.toolId, resolveBaselinePath(skill, spec.path))
    recordable.push(finding)
  }

  if (recordable.length === 0) return []

  const files = [...baselines]
    .map(([toolId, path]) => `\`${toolId}\` keeps its own suppression file at \`${path}\``)
    .join('; ')

  const lines = [
    '## If a finding is a false positive',
    '',
    `${files}. Record a finding there only once you have confirmed it is wrong, one finding at a time, giving the reason you reached that judgement:`,
    '',
    ...recordable.map(
      (finding) =>
        `- ${finding.label} — \`skillgantry suppress ${skill.id} --tool ${finding.toolId} --rule ${arg(finding.nativeRuleId)} --path ${arg(finding.path)} --reason ${arg('<why this finding is wrong>')} --yes\``,
    ),
    '',
    "The command creates the file when it is absent, prints the diff before it writes, and does nothing when the entry is already there. Do not run the tool's own baseline command: it accepts everything the tool currently reports, including the findings you have not fixed yet.",
  ]

  if (uncovered.length > 0) {
    // Two conditions, not one: a single label implies a single tool, but a
    // single tool does not imply a single label — two findings can come from
    // the same baseline-less tool.
    const oneLabel = uncovered.length === 1
    const tools = [...new Set(uncovered.map((f) => f.toolId))]
    lines.push(
      '',
      `${uncovered.map((f) => f.label).join(', ')} came from ${tools.map((id) => `\`${id}\``).join(', ')}, which ${tools.length === 1 ? 'declares' : 'declare'} no suppression file. Fix ${oneLabel ? 'it' : 'them'} or report ${oneLabel ? 'it' : 'them'}; there is nothing to record.`,
    )
  }

  return lines
}
