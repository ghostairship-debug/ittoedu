import { readFileSync } from 'node:fs'
import path from 'node:path'

/** Generated once with Electron output and carried by the final package. */
export const BUILD_INFO: { buildId: string; builtAt: string; revision: string } = (() => {
  try {
    const value = JSON.parse(readFileSync(path.join(__dirname, 'build-info.json'), 'utf8'))
    if (typeof value.buildId === 'string' && typeof value.builtAt === 'string' && typeof value.revision === 'string') return value
  } catch { /* Source/unit runs have not produced a packaged build. */ }
  return { buildId: 'source-unbuilt', builtAt: '', revision: 'unbuilt' }
})()
