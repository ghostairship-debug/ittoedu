import { componentSurface, componentSurfaces, resolveComponentPresentation, type CourseProjectV10 } from '../../../shared/contracts/component-platform/project'
import type { ComponentExportDocument } from './document/reading'

/** Author and publication share the same container graph; these selectors read no revision or asset bytes. */
export const componentOutputSurface = (document: ComponentExportDocument, containerId: string) => componentSurface(document as CourseProjectV10, containerId)
export const componentOutputSurfaces = (document: ComponentExportDocument) => componentSurfaces(document as CourseProjectV10)

/** Default static delivery covers mapped containers; disclose other owned roots instead of silently losing them. */
export function componentStaticRootOmissions(document: ComponentExportDocument) {
  return document.rootIds.flatMap((id, index) => {
    const instance = document.instances[id]
    if (!instance || instance.container) return []
    const name = instance.name ?? document.definitions[instance.definitionId]?.title ?? id
    return [{ severity: 'warning' as const, code: 'program-root-omitted', instanceId: id, path: ['rootIds', String(index)],
      message: `自主管理程序或非容器内容根“${name}”（${id}）未包含在本次静态输出中；完整运行内容请使用 HTML/Web 包，工程内容与资源已保留。` }]
  })
}

/** Read-only initial author presentation. Published compiled code and asset URLs survive. */
export function componentOutputPresentation<T extends ComponentExportDocument>(document: T, surfaceId: string): T {
  const surface = componentOutputSurface(document, surfaceId)
  const author: CourseProjectV10 = { ...document, schemaVersion: 11, revision: 0, assets: {} }
  const effective = resolveComponentPresentation(author, surfaceId, surface?.presentation?.initialStateId ?? null)
  return { ...document, instances: effective.instances }
}
