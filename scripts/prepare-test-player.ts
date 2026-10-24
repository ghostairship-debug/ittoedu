import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { TestProject } from 'vitest/node'

/** A test that reads the production bundle declares its prerequisite in its header.
 * Vitest has already selected paths (including CLI filters/excludes/shards) here.
 * Preparation runs once in the parent, never in competing test workers. */
export default async function preparePlayerBundles(project: TestProject) {
  for (const filename of project.vitest.state.getPaths()) {
    const source = await readFile(filename, 'utf8')
    const declaration = /^\/\/ @requires-player-bundle(?: ([A-Z_]+)=([^\s]+))?\s*$/m.exec(source)
    if (!declaration || declaration[1] && process.env[declaration[1]] !== declaration[2]) continue
    const { prepareSourceLaunch } = await import(pathToFileURL(resolve('scripts/prepare-source-launch.mjs')).href)
    await prepareSourceLaunch(project.config.root, undefined, ['player'])
    return
  }
}
