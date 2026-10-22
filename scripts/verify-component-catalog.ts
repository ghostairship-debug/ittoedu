import { BUILT_IN_COMPONENT_CATALOG_DIRECTORY } from '../src/shared/builtInComponentCatalog'
import path from 'node:path'
import { scanComponentCatalogDirectory, readCatalogComponentPackage } from '../src/main/componentCatalogScanner'
import { importComponentLibraryArchive } from '../src/core/components/library/archive'

async function main(): Promise<void> {
  const catalogRoot = path.resolve(process.cwd(), BUILT_IN_COMPONENT_CATALOG_DIRECTORY)
  const catalog = await scanComponentCatalogDirectory(catalogRoot, 'prompt')
  const unreadable = catalog.issues.filter(issue => issue.code === 'package-unreadable')
  if (unreadable.length > 0) {
    throw new Error(`组件包无法读取：${unreadable.map(issue => issue.message).join('\n')}`)
  }
  if (catalog.packages.length === 0) throw new Error('内置目录没有可读取的当前组件库条目')
  for (const issue of catalog.issues) console.warn(issue.message)

  for (const entry of catalog.packages) {
    const file = await readCatalogComponentPackage(catalog, entry.packageId, entry.version)
    // Use the same archive reader as component-library import, including its
    // identity, definition/instance graph and declared resource checks.
    const imported = importComponentLibraryArchive(file.bytes)
    // Earlier library archives are normalized by this single read boundary.
    // Compare the current consumed entry with current discovery metadata.
    if (imported.entry.schemaVersion !== entry.componentSchemaVersion || entry.componentSchemaVersion !== 2 || entry.runtimeApiVersion !== 5) {
      throw new Error(`${entry.packageId} 的目录协议、当前组件库 / Component API 5 不一致`)
    }
  }

  console.log(`已通过当前组件库 reader 验证 ${catalog.packages.length} 个 Project 11 / Component API 5 条目`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
