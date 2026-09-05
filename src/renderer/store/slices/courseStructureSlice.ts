import type { EditorStoreKernel } from '../editorStoreKernel'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import { MAX_PROJECT_SCENES } from '../../../shared/constants'
import {
  addCourseFlowPage,
  addCourseScene,
  addCourseSlidePage,
  addCourseSpatialPage,
  deleteCourseLocation as applyDeleteCourseLocation,
  deleteCourseSurface as applyDeleteCourseSurface,
  moveCourseSlideScene as applyMoveCourseSlideScene,
  reorderCourseSurfaces as applyReorderCourseSurfaces,
  type CourseLocationCommandResult,
} from '../../course/courseLocationCommands'
import {
  updateCourseBackground as applyCourseBackgroundUpdate,
  type CourseBackgroundPatch,
} from '../../course/courseBackgroundCommands'
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
