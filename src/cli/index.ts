#!/usr/bin/env node
import { buildProgram, defaultDeps } from './run-command.js'

const program = buildProgram(defaultDeps())
await program.parseAsync(process.argv)
process.exitCode = program.exitCode ?? 0
