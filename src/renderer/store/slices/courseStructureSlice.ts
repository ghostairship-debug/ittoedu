import { componentContainers, componentSurfaces } from '../../../shared/contracts/component-platform/project'
import type { EditorStoreKernel } from '../editorStoreKernel'
import type { ComponentEdit } from '../../../shared/contracts/component-platform/operations'
import type { CapturedComponentOperation } from '../../documents/CourseV10DocumentBridge'
import type { CourseEditorDropdownAction, CourseEditorPrimaryAction } from '../../course/courseEditorLayout'
import type { SlideCanvasSize } from '../../../shared/slideCanvas'
import { assertCourseSurfaceRemoval, createCourseSurface, duplicateSurfaceEdits, LAST_COURSE_PAGE_REASON } from '../../../core/course/courseSurfaceStructure'
import { surfaceSettingsEdits } from '../../../core/course/courseSemanticEdits'

export type CourseStructureResult = { readonly ok: boolean; readonly reason?: string; readonly activatedLocationId?: string }
export type CourseStructurePorts = { readActiveLocationId(): string | null }
export { LAST_COURSE_PAGE_REASON, duplicateSurfaceEdits } from '../../../core/course/courseSurfaceStructure'

export function createCourseStructureSlice(kernel: EditorStoreKernel, ports: CourseStructurePorts) {
  const failure = (reason: string): CourseStructureResult => {
    kernel.setFeedback({ errorMessage: reason, statusMessage: null })
    return { ok: false, reason }
  }
  const commit = async (edits: ComponentEdit[], message: string, activatedLocationId?: string, captured?: CapturedComponentOperation): Promise<CourseStructureResult> => {
    try {
      if (edits.length) {
        if (captured) await kernel.editCaptured(captured)
        else await kernel.edit(edits)
      }
      kernel.setFeedback({ errorMessage: null, statusMessage: message })
      return { ok: true, activatedLocationId }
    } catch (error) {
      const reason = error instanceof Error ? error.message : '页面操作失败'
      return failure(reason)
    }
  }
  return {
    async addCourseContent(action: CourseEditorPrimaryAction | CourseEditorDropdownAction, options: { surfaceId?: string } = {}): Promise<CourseStructureResult> {
      const project = kernel.readDocument()
      const kind = action === 'flow-page' ? 'flow' : action === 'spatial-page' ? 'spatial' : 'slide'
      const current = componentContainers(project).find(surface => surface.id === options.surfaceId)
      const surface = createCourseSurface(project, { kind, referenceSurfaceId: current?.id })
      const pages = componentSurfaces(project), currentIndex = pages.findIndex(page => page.id === current?.id)
      const index = action === 'scene' && currentIndex >= 0 ? currentIndex + 1 : pages.length
      return commit([{ type: 'surface.insert', surface, index }], '已新增页面', surface.id)
    },
    addScene(): Promise<CourseStructureResult> {
      const project = kernel.readDocument()
      const surface = componentContainers(project).find(value => value.id === ports.readActiveLocationId())
      return this.addCourseContent(surface?.kind === 'flow' ? 'flow-page' : surface?.kind === 'spatial' ? 'spatial-page' : 'scene', { surfaceId: surface?.id })
    },
    reorderCourseSurfaces(surfaceIds: string[]): Promise<CourseStructureResult> {
      const project = kernel.readDocument()
      if (surfaceIds.length !== componentSurfaces(project).length || new Set(surfaceIds).size !== surfaceIds.length || surfaceIds.some(id => !componentContainers(project).some(s => s.id === id))) return Promise.resolve(failure('页面顺序已改变，请重新拖动'))
      const containers = new Set(surfaceIds), requested = [...surfaceIds]
      const desired = project.rootIds.map(id => containers.has(id) ? requested.shift()! : id)
      const order = [...project.rootIds]
      const edits: ComponentEdit[] = []
      desired.forEach((id, index) => { const previous = order.indexOf(id); if (previous !== index) { edits.push({ type: 'instance.move', instanceId: id, container: { kind: 'project' }, index }); order.splice(previous, 1); order.splice(index, 0, id) } })
      return commit(edits, '已调整页面顺序')
    },
    captureCourseSurfaceDelete(surfaceId: string): CapturedComponentOperation {
      const target = kernel.captureTarget()
      assertCourseSurfaceRemoval(target.project, surfaceId)
      return kernel.capture([{ type: 'surface.remove', surfaceId }], target)
    },
    deleteCourseSurface(surfaceId: string, captured?: CapturedComponentOperation): Promise<CourseStructureResult> {
      if (!captured) {
        try { assertCourseSurfaceRemoval(kernel.readDocument(), surfaceId) }
        catch { return Promise.resolve(failure(LAST_COURSE_PAGE_REASON)) }
      }
      return commit([{ type: 'surface.remove', surfaceId }], '已删除页面', undefined, captured)
    },
    deleteCourseLocation(surfaceId: string, captured?: CapturedComponentOperation): Promise<CourseStructureResult> { return this.deleteCourseSurface(surfaceId, captured) },
    async duplicateCourseLocation(surfaceId: string): Promise<CourseStructureResult> {
      try {
        const target = kernel.captureTarget(), copy = duplicateSurfaceEdits(target.project, surfaceId)
        return await commit(copy.edits, '已复制页面', copy.surfaceId, kernel.capture(copy.edits, { ...target, activeStateId: null }, copy.readPaths))
      } catch (error) { return failure(error instanceof Error ? error.message : '页面复制失败') }
    },
    renameCourseLocation(surfaceId: string, title: string): Promise<CourseStructureResult> { return this.renameCourseSurface(surfaceId, title) },
    renameCourseSurface(surfaceId: string, title: string): Promise<CourseStructureResult> {
      return commit(surfaceSettingsEdits(kernel.readDocument(), surfaceId, { title: title.trim() }), '已重命名')
    },
    resizeSlideCanvas(designSize: SlideCanvasSize): Promise<CourseStructureResult> {
      const edits: ComponentEdit[] = componentSurfaces(kernel.readDocument()).filter(surface => surface.kind === 'slide').map(surface => ({ type: 'surface.designSize.set', surfaceId: surface.id, designSize }))
      return commit(edits, '已修改画布尺寸')
    },
    resizeSlideSceneCanvas(surfaceId: string, _sceneId: string, designSize: SlideCanvasSize | null): Promise<CourseStructureResult> {
      return commit([{ type: 'surface.designSize.set', surfaceId, designSize }], designSize ? '已修改本页尺寸' : '已恢复默认尺寸')
    },
  }
}
