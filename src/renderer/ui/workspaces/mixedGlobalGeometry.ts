import type { ComponentEdit, ComponentFrame, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import { componentParentMatrix } from '../../../core/drivers/courseV10Operations'
import { invertMatrix, multiplyMatrices, type AffineMatrix } from '../../../core/components/geometry'
import { courseGeometryEdits, type CourseGeometryIntent } from '../../../core/course/courseGeometryEdits'
import { isViewportComponent, projectTeacherControllerInstances, restoreTeacherControllerFrameEdits,
  type TeacherControllerHudGeometry, type TeacherControllerDisplayPort } from '../../../shared/teacherControllerViewportGeometry'

export const MIXED_GLOBAL_GEOMETRY = 'course-mixed-global-geometry'
export interface MixedGlobalGeometryRequest {
  documentId: string; surfaceId: string | null; project: CourseProjectV10; instanceIds: readonly string[]; intent: CourseGeometryIntent
  edits?: ComponentEdit[]
}
export function requestMixedGlobalGeometry(request: MixedGlobalGeometryRequest): ComponentEdit[] | undefined {
  if (typeof window === 'undefined' || !request.instanceIds.some(id => isViewportComponent(request.project, id))
    || request.instanceIds.every(id => isViewportComponent(request.project, id))) return undefined
  window.dispatchEvent(new CustomEvent(MIXED_GLOBAL_GEOMETRY, { detail: request }))
  return request.edits
}

/** One temporary viewport projection, then the existing HUD inverse and content inverse in the same batch. */
export function mixedGlobalGeometryEdits(project: CourseProjectV10, instanceIds: readonly string[], intent: CourseGeometryIntent,
  contentToViewport: AffineMatrix, hud: TeacherControllerHudGeometry, port?: TeacherControllerDisplayPort): ComponentEdit[] {
  const display = projectTeacherControllerInstances(project, hud, port)
  const instances = { ...display.instances }, maps = new Map<string, AffineMatrix>()
  for (const id of instanceIds) {
    const instance = project.instances[id]
    if (!instance?.frame || isViewportComponent(project, id)) continue
    const parent = componentParentMatrix(project, id)
    const map = multiplyMatrices(multiplyMatrices(invertMatrix(parent), contentToViewport), parent)
    maps.set(id, map); instances[id] = { ...instance, frame: { ...instance.frame, transform: [...multiplyMatrices(map, instance.frame.transform)] as ComponentFrame['transform'] } }
  }
  const shown = { ...display, instances }
  const edits = courseGeometryEdits(shown, instanceIds, intent).map(edit => {
    const map = edit.type === 'frame.set' ? maps.get(edit.instanceId) : undefined
    return map && edit.type === 'frame.set' && edit.frame ? { ...edit, frame: { ...edit.frame, transform: [...multiplyMatrices(invertMatrix(map), edit.frame.transform)] as ComponentFrame['transform'] } } : edit
  })
  return restoreTeacherControllerFrameEdits(edits, project, shown, hud, port?.placement?.(), port)
}
