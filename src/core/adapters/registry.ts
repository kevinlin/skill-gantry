import type { Stage } from '../types.js'
import * as skillLint from './skill-lint.js'
import * as skillUp from './skill-up.js'
import * as skillspector from './skillspector.js'
import type { Adapter } from './types.js'

const ADAPTERS: readonly Adapter[] = [
  { manifest: skillspector.manifest, parse: skillspector.parse },
  { manifest: skillLint.manifest, parse: skillLint.parse },
  { manifest: skillUp.manifest, parse: skillUp.parse },
]

const BY_ID = new Map(ADAPTERS.map((a) => [a.manifest.id, a]))

export function getAdapter(id: string): Adapter | undefined {
  return BY_ID.get(id)
}

export function listAdapters(): readonly Adapter[] {
  return ADAPTERS
}

export function adaptersForStage(stage: Stage): readonly Adapter[] {
  return ADAPTERS.filter((a) => a.manifest.stage === stage)
}
