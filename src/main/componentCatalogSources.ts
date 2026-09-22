import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { BUILT_IN_COMPONENT_CATALOG_DIRECTORY, trustForManagedCatalogDigest } from '../shared/builtInComponentCatalog'
import type { ComponentCatalogTrust } from '../shared/componentCatalog'

/** Built-ins always come from the application. External directories are additive. */
export async function defaultComponentCatalogSources(
  appRoot: string,
  externalDirectory = process.env.COURSEWARE_COMPONENTS_DIR,
): Promise<Array<{ path: string; trust: ComponentCatalogTrust }>> {
  const builtInRoot = path.resolve(appRoot, BUILT_IN_COMPONENT_CATALOG_DIRECTORY)
  let trust: ComponentCatalogTrust = 'prompt'
  try {
    const bytes = await fs.readFile(path.join(builtInRoot, 'catalog.json'))
    trust = trustForManagedCatalogDigest(createHash('sha256').update(bytes).digest('hex'))
  } catch {
    // Keep the source so the scanner reports a missing built-in library.
  }
  const sources = [{ path: builtInRoot, trust }]
  if (externalDirectory) {
    const externalRoot = path.resolve(externalDirectory)
    const samePath = process.platform === 'win32'
      ? externalRoot.toLowerCase() === builtInRoot.toLowerCase()
      : externalRoot === builtInRoot
    if (!samePath) {
      try {
        if ((await fs.stat(path.join(externalRoot, 'catalog.json'))).isFile()) {
          sources.push({ path: externalRoot, trust: 'prompt' })
        }
      } catch { /* An unavailable optional external source does not hide built-ins. */ }
    }
  }
  return sources
}
