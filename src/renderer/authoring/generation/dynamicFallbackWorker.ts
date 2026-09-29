import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import { locateCourseLayer } from '../../../core/drivers/course/layerProperties'
import { parseComponentPackageFiles } from '../../../core/drivers/codecs/importComponentPackage'
import { buildPublishedCourseV2Payload } from '../../export/course/buildPublishedCourse'
import { capturePublishedCourseV2Stage } from '../../export/playerCapture'
import { installBundledFontFaces } from '../../../shared/fonts/installBundledFontFaces'
import { ensureBundledFonts } from '../../../shared/fonts/ensureBundledFonts'

export interface DynamicFallbackWorkerInput {
  readonly project: CourseProjectDocument
  readonly projectId: string
  readonly revision: number
  readonly locationId: string
  readonly surfaceId: string
  readonly itemId: string
  readonly assets: Record<string, string>
  readonly assetResources: Record<string, { url: string; byteLength: number }>
  readonly components: Record<string, Record<string, string>>
}

export interface DynamicFallbackWorkerResult {
  readonly projectId: string
  readonly revision: number
  readonly locationId: string
  readonly surfaceId: string
  readonly itemId: string
  readonly dataUrl: string
}

function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0))
}

/** Runs only in Main's isolated, no-preload Published capture window. */
export async function renderDynamicFallbackCandidate(input: DynamicFallbackWorkerInput): Promise<DynamicFallbackWorkerResult> {
  const location = input.project.locations.find(value => value.id === input.locationId)
  const surface = location && input.project.surfaces.find(value => value.id === location.surfaceId)
  const located = locateCourseLayer(input.project, input.itemId)
  if (input.project.id !== input.projectId || input.project.revision !== input.revision
    || !location || !surface || location.surfaceId !== input.surfaceId || !located || located.item.kind === 'native'
    || located.source !== 'global' && located.surfaceId !== surface.id) throw new Error('候选截图目标身份不匹配')
  if (surface.type === 'spatial-2d') throw new Error('Spatial 暂不支持精确图层静态后备截图')
  installBundledFontFaces()
  await ensureBundledFonts()
  const assetFiles = Object.fromEntries(Object.entries(input.assets).map(([id, bytes]) => [id, decode(bytes)]))
  const components = Object.fromEntries(Object.entries(input.components).map(([key, files]) =>
    [key, parseComponentPackageFiles(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, decode(bytes)])))]))
  const payload = buildPublishedCourseV2Payload({ project: input.project, assetFiles,
    assetResources: input.assetResources, components })
  const dataUrl = await capturePublishedCourseV2Stage({ payload, locationId: input.locationId,
    surfaceId: input.surfaceId, layerItemId: input.itemId, includeGlobalLayerItems: true })
  if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('候选图层截图没有返回 PNG')
  return { projectId: input.projectId, revision: input.revision, locationId: input.locationId,
    surfaceId: input.surfaceId, itemId: input.itemId, dataUrl }
}

Object.defineProperty(window, '__COURSEWARE_DYNAMIC_FALLBACK_RUN__', {
  configurable: false, writable: false,
  value: (encoded: string) => renderDynamicFallbackCandidate(
    JSON.parse(new TextDecoder().decode(decode(encoded))) as DynamicFallbackWorkerInput),
})
