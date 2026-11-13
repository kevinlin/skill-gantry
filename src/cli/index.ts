#!/usr/bin/env node
import { main } from './main.js'
import { defaultDeps } from './run-command.js'

process.exitCode = await main(process.argv, defaultDeps())
