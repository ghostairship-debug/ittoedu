// @vitest-environment node
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultComponentCatalogSources } from '../../src/main/componentCatalogSources'
import { scanComponentCatalogDirectory, readCatalogComponentPackage } from '../../src/main/componentCatalogScanner'
import { BUILT_IN_COMPONENT_CATALOG_DIRECTORY } from '../../src/shared/builtInComponentCatalog'
import { importComponentPackage } from '../../src/core/drivers/codecs/importComponentPackage'

const repositoryRoot = path.resolve(__dirname, '../..')
const temporaryRoots: string[] = []
afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'built-in-components-'))
  temporaryRoots.push(root)
  return root
}

describe('application-owned built-in component catalog', () => {
  it('loads and imports all four packages from a relocated application without an external catalog', async () => {
    const root = await temporaryRoot()
    const appRoot = path.join(root, 'relocated application')
    await cp(path.join(repositoryRoot, BUILT_IN_COMPONENT_CATALOG_DIRECTORY), path.join(appRoot, BUILT_IN_COMPONENT_CATALOG_DIRECTORY), { recursive: true })
    const sources = await defaultComponentCatalogSources(appRoot, path.join(root, 'missing-external'))
    expect(sources).toEqual([{ path: path.join(appRoot, BUILT_IN_COMPONENT_CATALOG_DIRECTORY), trust: 'built-in' }])
    const catalog = await scanComponentCatalogDirectory(sources[0]!.path, sources[0]!.trust)
    expect(catalog.issues).toEqual([])
    expect(catalog.packages).toHaveLength(4)
    for (const pkg of catalog.packages) {
      expect(pkg.thumbnailDataUrl).toMatch(/^data:image\/svg\+xml;base64,/)
      const file = await readCatalogComponentPackage(catalog, pkg.packageId, pkg.version)
      expect(importComponentPackage(file.bytes).manifest.id).toBe(pkg.packageId)
    }
  })

  it('keeps an external clone additive and separate from built-in identity', async () => {
    const external = await temporaryRoot()
    await writeFile(path.join(external, 'catalog.json'), await readFile(path.join(repositoryRoot, BUILT_IN_COMPONENT_CATALOG_DIRECTORY, 'catalog.json')))
    const sources = await defaultComponentCatalogSources(repositoryRoot, external)
    expect(sources).toHaveLength(2)
    expect(sources[0]!.trust).toBe('built-in')
    expect(sources[1]).toEqual({ path: external, trust: 'prompt' })
    expect(await defaultComponentCatalogSources(repositoryRoot, sources[0]!.path)).toEqual([sources[0]])
  })

  it('reports a missing bundled catalog instead of silently reading the old sibling repository', async () => {
    const root = await temporaryRoot()
    const sibling = path.join(root, 'courseware-components')
    await mkdir(sibling)
    await writeFile(path.join(sibling, 'catalog.json'), '{"catalogVersion":1,"name":"Old sibling","packages":[]}')
    const sources = await defaultComponentCatalogSources(path.join(root, 'app'), '')
    expect(sources).toEqual([{ path: path.join(root, 'app', BUILT_IN_COMPONENT_CATALOG_DIRECTORY), trust: 'prompt' }])
    await expect(scanComponentCatalogDirectory(sources[0]!.path, sources[0]!.trust)).rejects.toThrow()
  })
})
