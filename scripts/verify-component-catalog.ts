import { BUILT_IN_COMPONENT_CATALOG_DIRECTORY } from '../src/shared/builtInComponentCatalog'
import path from 'node:path'
import { scanComponentCatalogDirectory, readCatalogComponentPackage } from '../src/main/componentCatalogScanner'
import { executeComponentRuntime } from '../src/renderer/components/executeComponentRuntime'
import { importComponentPackage } from '../src/renderer/components/importComponentPackage'

async function main(): Promise<void> {
  const catalogRoot = path.resolve(process.cwd(), BUILT_IN_COMPONENT_CATALOG_DIRECTORY)

  const catalog = await scanComponentCatalogDirectory(catalogRoot, 'prompt')
  if (catalog.packages.length !== 4) {
    throw new Error(`当前目录必须精确包含 4 个组件，实际为 ${catalog.packages.length}`)
  }
  if (catalog.issues.length > 0) {
    throw new Error(`组件目录完整性问题：${catalog.issues.map((issue) => issue.message).join('\n')}`)
  }

  for (const entry of catalog.packages) {
    if (entry.quality !== 'experimental') {
      throw new Error(`${entry.packageId} 在完整产品验收前不得超过 experimental`)
    }
    if (entry.license?.status !== 'unknown' || (entry.releaseBlockers?.length ?? 0) === 0) {
      throw new Error(`${entry.packageId} 没有保留许可/发布阻断状态`)
    }
    const file = await readCatalogComponentPackage(
      catalog,
      entry.packageId,
      entry.version,
    )
    const imported = importComponentPackage(file.bytes, {
      expectedId: entry.packageId,
      expectedVersion: entry.version,
    })
    if (
      imported.manifest.schemaVersion !== 4 ||
      imported.manifest.runtimeApiVersion !== 4 ||
      imported.manifest.renderMode !== entry.renderMode
    ) {
      throw new Error(`${entry.packageId} 的目录协议与实际 Manifest 不一致`)
    }
    if (
      imported.manifest.supportedScopes.length !== entry.supportedScopes.length ||
      imported.manifest.supportedScopes.some((scope) => !entry.supportedScopes.includes(scope))
    ) {
      throw new Error(`${entry.packageId} 的作用域元数据与包不一致`)
    }
    const definition = executeComponentRuntime(imported.runtimeSource, entry.packageId)
    if (definition.runtimeApiVersion !== 4) {
      throw new Error(`${entry.packageId} 没有注册 Component Runtime API 4 定义`)
    }
    for (const property of imported.manifest.editor?.properties ?? []) {
      if (
        property.type === 'number' &&
        property.unit === 'px' &&
        /(?:font|hanzi|pinyin|title|legend|caption|body|step|eyebrow)Size$/i.test(property.key) &&
        (property.min ?? 0) < 22
      ) {
        throw new Error(`${entry.packageId} 的 ${property.key} 仍允许低于 22 px`)
      }
    }
  }

  console.log('已验证随软件分发的内置目录中 4 个 experimental Component API 4 包、哈希、作用域与 22 px 字号下限')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
