import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import { visitProjectDynamicInstances } from '../../../shared/composition/dynamic'
import type { HistoryResourceState } from '../../store/courseResourceState'
import { readImageDimensions } from '../../project/assetManager'
import { AuthoringToolFailure } from './executeAuthoringTool'

/** A working Runtime does not exercise its fallback. Validate the actual bytes
 * of this admission's fallback dependencies before any candidate can commit. */
export async function validateDynamicCandidateFallbackAssets(project: CourseProjectDocument,
  resources: HistoryResourceState, instanceIds: readonly string[], assetResources?: Readonly<Record<string, { url: string; byteLength: number }>>): Promise<void> {
  const targets = new Set(instanceIds)
  const fallbacks: { assetId: string; path: Array<string | number> }[] = []
  visitProjectDynamicInstances(project, entry => {
    if (!targets.has(entry.instanceId)) return
    const assetId = entry.kind === 'runtime' ? entry.runtime.staticFallback?.assetId : entry.componentItem.staticFallbackAssetId
    if (assetId) fallbacks.push({ assetId, path: [...entry.path, ...(entry.kind === 'runtime' ? ['staticFallback', 'assetId'] : ['staticFallbackAssetId'])] })
  })
  for (const { assetId, path } of fallbacks) {
    const entry = Object.entries(project.assets).find(([key, meta]) => key === assetId || meta.id === assetId)
    try {
      if (!entry || entry[1].kind !== 'image') throw new Error('后备素材不是工程图片')
      const [key, meta] = entry
      let bytes = resources.assetFiles[meta.id] ?? resources.assetFiles[key]
      const resource = assetResources?.[meta.id] ?? assetResources?.[key]
      if (!bytes && resource) {
        const response = await fetch(resource.url)
        if (!response.ok) throw new Error('后备图片读取失败')
        bytes = new Uint8Array(await response.arrayBuffer())
      }
      if (!bytes?.length || bytes.byteLength !== meta.byteLength) throw new Error('后备图片的实际字节缺失或长度不匹配')
      await readImageDimensions(bytes, meta.mimeType)
    } catch (error) {
      throw new AuthoringToolFailure([{ code: 'dynamic-fallback-image-invalid',
        message: `后备图片“${assetId}”不能完整解码：${error instanceof Error ? error.message : String(error)}`,
        path: path.map(String) }])
    }
  }
}
