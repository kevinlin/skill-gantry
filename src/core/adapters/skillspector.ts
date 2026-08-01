import type { AdapterManifest, Parse } from './types.js'

export const manifest: AdapterManifest = {
  id: 'skillspector',
  stage: 'security',
  policy: 'fan-out',
  mutating: false,
  detects: [],
  credentials: { kind: 'none' },
  analysisMode: 'static',
  install: {
    kind: 'uv-tool',
    spec: 'git+https://github.com/NVIDIA/skillspector.git',
    pin: 'v2.5.1',
    binName: 'skillspector',
  },
  invoke: { argv: [], cwd: 'repoRoot' },
  versionArgv: ['--version'],
  artefacts: [],
  timeoutMs: 120_000,
}

export const parse: Parse = () => ({
  outcome: 'errored',
  findings: [],
  metrics: {},
  summary: 'not implemented',
})
