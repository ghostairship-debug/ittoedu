import type { CourseProjectDocument } from '../courseProjectTypes'
import {
  courseProjectLayerItemIds,
  finalizeCourseProjectHealthFindings,
  visitCourseLayerItems,
} from './internal'
import type {
  CourseProjectHealthArchiveFiles,
  CourseProjectHealthFinding,
  CourseProjectHealthFindingDraft,
} from './types'

export function collectCourseProjectRuntimeHealth(
  project: CourseProjectDocument,
  _archiveFiles: CourseProjectHealthArchiveFiles,
): CourseProjectHealthFinding[] {
  const drafts: CourseProjectHealthFindingDraft[] = []
  // V9 authoring validates Runtime bindings against the project-wide stable-ID
  // universe. Published Course V2 preserves the reference but does not define a
  // narrower owner-visibility contract, so only genuinely absent IDs are errors.
  const availableIds = courseProjectLayerItemIds(project)
  visitCourseLayerItems(project, (visit) => {
    if (visit.item.kind !== 'runtime') return
    const { runtime } = visit.item
    if (runtime.enabled && !runtime.staticFallback) {
      drafts.push({
        severity: 'warning',
        code: 'runtime-static-fallback-missing',
        message: '已启用的运行时没有 staticFallback，静态导出、缩略图或运行时失败时可能无可用画面。',
        path: [...visit.path, 'runtime', 'staticFallback'],
        layerItemId: visit.item.layerItemId,
        ...('surfaceId' in visit.owner ? { surfaceId: visit.owner.surfaceId } : {}),
      })
    }
    Object.entries(runtime.nodeBindings ?? {}).forEach(([bindingKey, layerItemId]) => {
      if (availableIds.has(layerItemId)) return
      drafts.push({
        severity: 'error',
        code: 'runtime-node-reference-missing',
        message: `运行时节点绑定“${bindingKey}”引用了工程中不存在的图层“${layerItemId}”。`,
        path: [...visit.path, 'runtime', 'nodeBindings', bindingKey],
        layerItemId: visit.item.layerItemId,
        ...('surfaceId' in visit.owner ? { surfaceId: visit.owner.surfaceId } : {}),
      })
    })
  })
  return finalizeCourseProjectHealthFindings(project, drafts)
}
