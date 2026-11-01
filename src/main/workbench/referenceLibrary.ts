import { realpathSync } from 'node:fs'
import path from 'node:path'

/** Main's existing bundled-reference location. A development app path is a Skill
 * substitution source, never an implicit grant to read the application/repository. */
export function workbenchReferenceLibrary(input: { isPackaged: boolean; resourcesPath: string; appPath: string }): {
  referenceRoot: string; readOnlyRoots: readonly string[]
} {
  const referenceRoot = input.isPackaged ? path.join(input.resourcesPath, 'reference-library') : input.appPath
  if (!input.isPackaged) return { referenceRoot, readOnlyRoots: [] }
  // Resolve both trusted package roots once. Missing/invalid bundled resources do
  // not grant the resources directory, another application directory, or a link target outside it.
  try {
    const resources = realpathSync(input.resourcesPath), actual = realpathSync(referenceRoot)
    const relative = path.relative(resources, actual)
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      return { referenceRoot, readOnlyRoots: [] }
    return { referenceRoot: actual, readOnlyRoots: [actual] }
  } catch { return { referenceRoot, readOnlyRoots: [] } }
}
