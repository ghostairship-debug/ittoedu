import { performance } from 'node:perf_hooks'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  checkRepoIndex,
  generateRepoIndexToDirectory,
  writeRepoIndex,
} from './repo-index/generator'

interface CliOptions {
  check: boolean
  outputDirectory?: string
}

function parseOptions(args: readonly string[]): CliOptions {
  let check = false
  let outputDirectory: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--check') {
      check = true
      continue
    }
    if (argument === '--output') {
      outputDirectory = args[index + 1]
      if (!outputDirectory) {
        throw new Error('--output requires a directory')
      }
      index += 1
      continue
    }
    throw new Error(`Unknown repo-index option: ${argument}`)
  }
  if (check && outputDirectory) {
    throw new Error('--check and --output cannot be used together')
  }
  return { check, ...(outputDirectory ? { outputDirectory } : {}) }
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const options = parseOptions(process.argv.slice(2))
const startedAt = performance.now()

if (options.check) {
  const result = checkRepoIndex(repoRoot)
  const elapsedMs = performance.now() - startedAt
  if (!result.ok) {
    console.error('repo-index check failed', {
      ...result.difference,
      elapsedMs: Number(elapsedMs.toFixed(1)),
    })
    process.exitCode = 1
  } else {
    console.log('repo-index check passed', {
      ...result.summary,
      elapsedMs: Number(elapsedMs.toFixed(1)),
    })
  }
} else {
  const summary = options.outputDirectory
    ? generateRepoIndexToDirectory(repoRoot, resolve(repoRoot, options.outputDirectory))
    : writeRepoIndex(repoRoot)
  console.log('repo-index generated', {
    ...summary,
    elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
  })
}
