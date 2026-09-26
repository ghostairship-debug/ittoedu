import type { EditorStoreKernel } from '../editorStoreKernel'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import { MAX_PROJECT_SCENES } from '../../../shared/constants'
import { courseProjectDocumentSchema } from '../../../shared/courseProjectSchema'
import { resizeCourseSlideCanvas } from '../../../core/course/resizeSlideCanvas'
import { courseSlideCanvas, isValidSlideCanvas, sameSlideCanvas, type SlideCanvasSize } from '../../../shared/slideCanvas'
import {
  addCourseFlowPage,
  addCourseScene,
  addCourseSlidePage,
  addCourseSpatialPage,
  deleteCourseLocation as applyDeleteCourseLocation,
  deleteCourseSurface as applyDeleteCourseSurface,
  duplicateCourseLocation as applyDuplicateCourseLocation,
  renameCourseLocation as applyRenameCourseLocation,
  renameCourseSurface as applyRenameCourseSurface,
  moveCourseSlideScene as applyMoveCourseSlideScene,
  reorderCourseSurfaces as applyReorderCourseSurfaces,
  type CourseLocationCommandResult,
} from '../../../core/tools/courseLocations'
import {
  updateCourseBackground as applyCourseBackgroundUpdate,
  type CourseBackgroundPatch,
} from '../../../core/tools/courseBackground'
import {
  deriveCourseEditorLayout,
  type CourseEditorDropdownAction,
  type CourseEditorPrimaryAction,
} from '../../course/courseEditorLayout'

export type CourseStructureResult = {
  readonly ok: boolean
  readonly reason?: string
  readonly activatedLocationId?: string
}

export type CourseStructurePorts = {
  readActiveLocationId(): string | null
}

export function createCourseStructureSlice(
  kernel: EditorStoreKernel,
  ports: CourseStructurePorts,
) {
  const persistCourseProjectCommand = (
    result: CourseLocationCommandResult,
    extra: { statusMessage?: string | null } = {},
  ): CourseStructureResult => {
    if (!result.ok) {
      if (result.reason) {
        kernel.setFeedback({ errorMessage: result.reason, statusMessage: null })
      }
      return { ok: false, reason: result.reason }
    }
    kernel.persistDocument(result.project, {
      ...extra,
      historyEntry: true,
    })
    return {
      ok: true,
      activatedLocationId: result.activatedLocationId,
    }
  }

  return {
    persistCourseProjectCommand,

    addCourseContent(
      action: CourseEditorPrimaryAction | CourseEditorDropdownAction,
      options: { surfaceId?: string } = {},
    ): CourseStructureResult {
      const project = kernel.tryReadDocument()
      if (!project) return { ok: false, reason: '当前会话没有课程工程' }
      const expectedRevision = project.revision
      let result: CourseLocationCommandResult
      if (action === 'scene') {
        if (!options.surfaceId) {
          kernel.setFeedback({ errorMessage: '找不到当前 Slide 表面', statusMessage: null })
          return { ok: false, reason: '找不到当前 Slide 表面' }
        }
        const slideSurface = project.surfaces.find(
          (surface) => surface.id === options.surfaceId && surface.type === 'slide',
        )
        const sceneCount = slideSurface?.type === 'slide' ? slideSurface.scenes.length : 0
        if (sceneCount >= MAX_PROJECT_SCENES) {
          const errorMessage = `工程已达到 ${MAX_PROJECT_SCENES} 个场景上限。请删除不需要的场景后再试。`
          kernel.setFeedback({ errorMessage, statusMessage: null })
          return { ok: false, reason: errorMessage }
        }
        result = addCourseScene(project, {
          surfaceId: options.surfaceId,
          title: `场景 ${sceneCount + 1}`,
          expectedRevision,
        })
      } else if (action === 'slide-page') {
        result = addCourseSlidePage(project, { expectedRevision })
      } else if (action === 'flow-page') {
        result = addCourseFlowPage(project, { expectedRevision })
      } else {
        result = addCourseSpatialPage(project, { expectedRevision })
      }
      if (!result.ok) {
        kernel.setFeedback({ errorMessage: result.reason, statusMessage: null })
        return { ok: false, reason: result.reason }
      }
      const statusMessage = action === 'scene'
        ? '已新建场景'
        : action === 'slide-page'
          ? '已新增演示页面'
          : action === 'flow-page'
            ? '已新增流式讲义'
            : '已新增无限画布'
      return persistCourseProjectCommand(result, { statusMessage })
    },

    addScene(): CourseStructureResult {
      const project = kernel.tryReadDocument()
      if (!project) return { ok: false, reason: '当前会话没有课程工程' }
      const layout = deriveCourseEditorLayout(project, ports.readActiveLocationId() ?? undefined)
      if (layout.primary.action === 'scene' && layout.primary.surfaceId) {
        return this.addCourseContent('scene', { surfaceId: layout.primary.surfaceId })
      }
      return this.addCourseContent(layout.primary.action)
    },

    reorderCourseSurfaces(surfaceIds: string[]): CourseStructureResult {
      const project = kernel.tryReadDocument()
      if (!project) return { ok: false, reason: '当前会话没有课程工程' }
      return persistCourseProjectCommand(applyReorderCourseSurfaces(project, surfaceIds, {
        expectedRevision: project.revision,
        activeLocationId: ports.readActiveLocationId() ?? undefined,
      }))
    },

    deleteCourseSurface(surfaceId: string): CourseStructureResult {
      const project = kernel.tryReadDocument()
      if (!project) return { ok: false, reason: '当前会话没有课程工程' }
      const activeLocationId = ports.readActiveLocationId() ?? undefined
      const result = applyDeleteCourseSurface(project, surfaceId, {
        expectedRevision: project.revision,
        activeLocationId,
      })
      if (!result.ok) {
        kernel.setFeedback({ errorMessage: result.reason, statusMessage: null })
        return { ok: false, reason: result.reason }
      }
      return persistCourseProjectCommand(result, { statusMessage: '已删除页面' })
    },

    moveCourseSlideScene(
      locationId: string,
      targetSurfaceId: string,
      toIndex?: number,
    ): CourseStructureResult {
      const project = kernel.tryReadDocument()
      if (!project) return { ok: false, reason: '当前会话没有课程工程' }
      const result = applyMoveCourseSlideScene(project, locationId, targetSurfaceId, {
        expectedRevision: project.revision,
        toIndex,
        activeLocationId: ports.readActiveLocationId() ?? undefined,
      })
      if (!result.ok) {
        kernel.setFeedback({ errorMessage: result.reason, statusMessage: null })
        return { ok: false, reason: result.reason }
      }
      return persistCourseProjectCommand(result, { statusMessage: '已调整演示页面' })
    },

    deleteCourseLocation(locationId: string): CourseStructureResult {
      const project = kernel.tryReadDocument()
      if (!project) return { ok: false, reason: '当前会话没有课程工程' }
      const result = applyDeleteCourseLocation(project, locationId, {
        expectedRevision: project.revision,
        activeLocationId: ports.readActiveLocationId() ?? undefined,
      })
      if (!result.ok) {
        kernel.setFeedback({ errorMessage: result.reason, statusMessage: null })
        return { ok: false, reason: result.reason }
      }
      return persistCourseProjectCommand(result, { statusMessage: '场景已删除' })
    },

    /** Copies a Slide scene right after itself (M21 page bar); the caller activates the copy. */
    duplicateCourseLocation(locationId: string): CourseStructureResult {
      const project = kernel.tryReadDocument()
      if (!project) return { ok: false, reason: '当前会话没有课程工程' }
      return persistCourseProjectCommand(applyDuplicateCourseLocation(project, locationId, {
        expectedRevision: project.revision,
      }), { statusMessage: '已复制场景' })
    },

    renameCourseLocation(locationId: string, label: string): CourseStructureResult {
      const project = kernel.tryReadDocument()
      if (!project) return { ok: false, reason: '当前会话没有课程工程' }
      return persistCourseProjectCommand(applyRenameCourseLocation(project, locationId, label, {
        expectedRevision: project.revision,
      }), { statusMessage: '已重命名' })
    },

    /** Renames a whole page (a Flow or Spatial surface, or a Slide page group). */
    renameCourseSurface(surfaceId: string, name: string): CourseStructureResult {
      const project = kernel.tryReadDocument()
      if (!project) return { ok: false, reason: '当前会话没有课程工程' }
      let next: CourseProjectDocument
      try {
        next = applyRenameCourseSurface(project, surfaceId, name.trim())
      } catch (error) {
        const reason = error instanceof Error && error.message ? '名称无效或页面已不存在' : '重命名失败'
        kernel.setFeedback({ errorMessage: reason, statusMessage: null })
        return { ok: false, reason }
      }
      if (next === project) return { ok: true }
      kernel.persistDocument(next, { historyEntry: true, statusMessage: '已重命名' })
      return { ok: true }
    },

    resizeSlideCanvas(next: SlideCanvasSize): CourseStructureResult {
      const project = kernel.tryReadDocument()
      if (!project) return { ok: false, reason: '当前会话没有课程工程' }
      if (!isValidSlideCanvas(next)) {
        kernel.setFeedback({ errorMessage: '画布宽高须为 320–8192 的整数', statusMessage: null })
        return { ok: false, reason: '画布尺寸无效' }
      }
      if (sameSlideCanvas(courseSlideCanvas(project), next)) return { ok: true }
      const resized = resizeCourseSlideCanvas(project, next)
      const committed = courseProjectDocumentSchema.parse({
        ...resized,
        revision: project.revision + 1,
        updatedAt: new Date().toISOString(),
      })
      const saved = kernel.persistDocument(committed, {
        historyEntry: true,
        statusMessage: '已修改画布尺寸',
      })
      if (!saved) {
        kernel.setFeedback({ errorMessage: '当前页面不能修改画布尺寸', statusMessage: null })
        return { ok: false, reason: '当前页面不能修改画布尺寸' }
      }
      return { ok: true }
    },

    updateCourseBackground(patch: CourseBackgroundPatch): CourseStructureResult {
      const project = kernel.tryReadDocument()
      if (!project) return { ok: false, reason: '当前会话没有课程工程' }
      const result = applyCourseBackgroundUpdate(project, patch, {
        expectedRevision: project.revision,
      })
      if (!result.ok) {
        kernel.setFeedback({ errorMessage: result.reason, statusMessage: null })
        return { ok: false, reason: result.reason }
      }
      if (!result.historyEntry) return { ok: true }
      kernel.persistDocument(result.project, {
        historyEntry: true,
        statusMessage: '已更新课程背景',
      })
      return { ok: true }
    },
  }
}
