import { useMemo } from 'react'
import type { ComponentPackageData } from '../../../shared/componentTypes'
import { createBlankCourseProject } from '../../../core/course/createCourseProject'
import { WebCompositionAuthoringContent } from '../../composition/WebCompositionAuthoringContent'
import { buildPublishedCourseV2Payload } from '../../export/course/buildPublishedCourse'
import { bytesToDataUrl } from '../../export/base64'
import { materializeCompositionFragment } from './compositionFragmentPackage'

/** Preview renders the actual portable content through the same composition Player. */
export function CompositionFragmentPreview({ data }: { data: ComponentPackageData }) {
  const result = useMemo(() => {
    try {
      const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
      const materialized = materializeCompositionFragment({ document: project, data, componentPackages: {}, assetFiles: {} })
      const surface = project.surfaces.find(surface => surface.type === 'slide')!
      surface.scenes[0]!.layerItems.push(materialized.item)
      const assetFiles = Object.fromEntries((materialized.resourceChanges.assetFileChanges ?? []).flatMap(change => change.after ? [[change.assetId, change.after]] : []))
      const components = Object.fromEntries((materialized.resourceChanges.componentPackageChanges ?? []).flatMap(change => change.after ? [[change.packageId, change.after]] : []))
      const payload = buildPublishedCourseV2Payload({ project, assetFiles, components })
      const publishedSurface = payload.surfaces.find(surface => surface.type === 'slide')!
      const item = publishedSurface.scenes[0]!.layerItems[0]!
      if (item.kind !== 'composition') throw new Error('片段预览内容类型错误。')
      return { item, components: payload.components,
        assetUrls: Object.fromEntries(Object.entries(assetFiles).map(([id, bytes]) => [id, bytesToDataUrl(bytes, project.assets[id]!.mimeType)])) }
    } catch (error) { return { error: error instanceof Error ? error.message : '片段预览失败。' } }
  }, [data])
  if ('error' in result) return <div role="alert">{result.error}</div>
  const scale = Math.min(480 / result.item.frame.width, 280 / result.item.frame.height)
  return <div aria-label="结构资产实际预览" style={{ width: result.item.frame.width * scale, height: result.item.frame.height * scale, maxWidth: '100%', overflow: 'hidden', border: '1px solid #dde1ea', margin: '12px 0' }}>
    <div style={{ width: result.item.frame.width, height: result.item.frame.height, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
      <WebCompositionAuthoringContent layerItemId={result.item.layerItemId} content={result.item.content} width={result.item.frame.width}
        height={result.item.frame.height} assetUrls={result.assetUrls} components={result.components} interactive={false} />
    </div>
  </div>
}
