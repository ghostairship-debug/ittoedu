import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { buildContextPack } from './repo-index/contextPack'
import {
  parseQueryCliArguments,
  RepoIndexQueryEngine,
} from './repo-index/query'

function isWithin(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child))
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`))
}

export function writeContextPackOutput(
  repoRoot: string,
  requestedPath: string,
  markdown: string,
): void {
  const output = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(repoRoot, requestedPath)
  const contexts = resolve(repoRoot, 'repo-index/contexts')
  if (isWithin(repoRoot, output)) {
    if (!isWithin(contexts, output)) {
      throw new Error(
        'Repository-local Context Packs must be written under repo-index/contexts/',
      )
    }
  } else if (!isWithin(resolve(tmpdir()), output)) {
    throw new Error(
      'Absolute Context Pack output must be located under the OS temporary directory.',
    )
  }
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, markdown, 'utf8')
}

export function runQueryCli(args: readonly string[], repoRoot: string): string {
  const parsed = parseQueryCliArguments(args)
  const engine = new RepoIndexQueryEngine({ repoRoot })
  const result = engine.query(parsed.request)
  const pack = buildContextPack(result, engine.invariants, engine.exclusions)
  if (parsed.output) {
    writeContextPackOutput(repoRoot, parsed.output, pack.markdown)
    return 'Context Pack written to the requested temporary output.\n'
  }
  return pack.markdown
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
const thisPath = resolve(fileURLToPath(import.meta.url))
if (invokedPath === thisPath) {
  const repoRoot = resolve(dirname(thisPath), '..')
  try {
    process.stdout.write(runQueryCli(process.argv.slice(2), repoRoot))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
