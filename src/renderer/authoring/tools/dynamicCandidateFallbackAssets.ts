import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import { analyzeCourseAssetReferences } from '../../../shared/contracts/course-project-v9/assetReferences'
import type { HistoryResourceState } from '../../store/courseResourceState'
import { readImageDimensions } from '../../project/assetManager'
import { AuthoringToolFailure } from './executeAuthoringTool'

/** A working Runtime does not exercise its fallback. Validate the actual bytes
 * of this admission's fallback dependencies before any candidate can commit. */
export async function validateDynamicCandidateFallbackAssets(project: CourseProjectDocument,
  resources: HistoryResourceState, instanceIds: readonly string[]): Promise<void> {
  const targets = new Set(instanceIds)
  const references = analyzeCourseAssetReferences(project, { componentPackages: resources.componentPackages }).graph
  for (const [assetId, uses] of references) {
    const fallback = uses.find(reference => (reference.kind === 'runtime-fallback' || reference.kind === 'component-fallback')
      && targets.has(reference.layerItemId ?? reference.blockId ?? ''))
    if (!fallback) continue
    const entry = Object.entries(project.assets).find(([key, meta]) => key === assetId || meta.id === assetId)
    try {
      if (!entry || entry[1].kind !== 'image') throw new Error('后备素材不是工程图片')
      const [key, meta] = entry
      const bytes = resources.assetFiles[meta.id] ?? resources.assetFiles[key]
      if (!bytes?.length || bytes.byteLength !== meta.byteLength) throw new Error('后备图片的实际字节缺失或长度不匹配')
      await readImageDimensions(bytes, meta.mimeType)
    } catch (error) {
      throw new AuthoringToolFailure([{ code: 'dynamic-fallback-image-invalid',
        message: `后备图片“${assetId}”不能完整解码：${error instanceof Error ? error.message : String(error)}`,
        path: fallback.path.map(String) }])
    }
  }
}
