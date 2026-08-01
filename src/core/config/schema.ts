import { z } from 'zod'

export const repoSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  name: z.string().min(1),
  isGit: z.boolean(),
})

export const stageToolsSchema = z.object({
  validate: z.array(z.string()).default([]),
  evaluate: z.array(z.string()).default([]),
  security: z.array(z.string()).default([]),
  optimise: z.array(z.string()).default([]),
})

export const configSchema = z.object({
  version: z.literal(1),
  repos: z.array(repoSchema).default([]),
  stageTools: stageToolsSchema,
  concurrency: z.number().int().min(1).max(16),
  artefactSizeCapBytes: z.number().int().min(1),
  timeoutOverridesMs: z.record(z.string(), z.number().int().min(1)).default({}),
  /** R5.14: a prompt nobody answers discards after this long. */
  mutationTimeoutMs: z.number().int().min(1_000).default(300_000),
})

export type GantryConfig = z.infer<typeof configSchema>

export const toolLockEntrySchema = z.object({
  installKind: z.enum(['uv-tool', 'npm-prefix', 'gh-release']),
  requestedPin: z.string(),
  resolvedVersion: z.string(),
  bin: z.string().min(1),
  /** 'n/a' when the package manager verified its own download, else 'sha256:…' or 'none'. */
  integrity: z.string().min(1).default('n/a'),
  installedAt: z.string(),
  verifiedAt: z.string().nullable(),
})

export const toolLockSchema = z.object({
  version: z.literal(1),
  tools: z.record(z.string(), toolLockEntrySchema).default({}),
})

export type ToolLockEntry = z.infer<typeof toolLockEntrySchema>
export type ToolLock = z.infer<typeof toolLockSchema>
