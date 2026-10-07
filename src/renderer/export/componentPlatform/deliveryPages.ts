import type { ComponentSurface } from '../../../shared/contracts/component-platform/project'
import type { ExportPageOptions } from '../../../shared/workbench/toolPorts'

export interface ComponentDeliveryPage { id: string; surfaceId: string; title: string; spatialFrameId?: string }

/** Expand the author's existing surface/camera order, then apply the captured output choice. */
export function componentDeliveryPages(surfaces: readonly ComponentSurface[], pageIds?: ExportPageOptions['pageIds']): ComponentDeliveryPage[] {
  const pages = surfaces.flatMap(surface => surface.kind === 'spatial' && surface.spatial?.frames.length
    ? surface.spatial.frames.map(frame => ({ id: `${surface.id}:${frame.id}`, surfaceId: surface.id,
      title: frame.title ?? surface.title, spatialFrameId: frame.id }))
    : [{ id: surface.id, surfaceId: surface.id, title: surface.title }])
  if (!pageIds) return pages
  const selected: ComponentDeliveryPage[] = [], seen = new Set<string>()
  for (const id of pageIds) {
    const matches = pages.filter(page => page.id === id || page.surfaceId === id)
    if (!matches.length) throw new Error(`选择的导出页面不存在：${id}`)
    for (const page of matches) {
      if (seen.has(page.id)) continue
      seen.add(page.id); selected.push(page)
    }
  }
  if (!selected.length) throw new Error('没有选择可导出的页面')
  return selected
}

