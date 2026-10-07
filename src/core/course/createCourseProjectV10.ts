import type { CourseProjectV10, JsonValue } from '../../shared/contracts/component-platform/project'
import { TEACHER_CONTROLLER_DEFINITION, createTeacherControllerData, createTeacherControllerFrame } from '../../components/teacher-controller/data'

export function createBlankCourseProjectV10(title = '未命名课件', createId: () => string = () => crypto.randomUUID()): CourseProjectV10 {
  const project: CourseProjectV10 = {
    schemaVersion: 10, id: createId(), revision: 0, title,
    definitions: {}, instances: {}, assets: {}, global: { underlay: [], overlay: [] },
    surfaces: [{ id: createId(), kind: 'slide', title: '第 1 页', childIds: [], designSize: { width: 1280, height: 720 } }],
  }
  const id = createId()
  project.definitions[TEACHER_CONTROLLER_DEFINITION.id] = structuredClone(TEACHER_CONTROLLER_DEFINITION)
  project.instances[id] = { id, definitionId: TEACHER_CONTROLLER_DEFINITION.id, name: '教师控制台',
    data: JSON.parse(JSON.stringify(createTeacherControllerData(project.surfaces[0].designSize))) as JsonValue, frame: createTeacherControllerFrame(project.surfaces[0].designSize) }
  project.global.overlay.push(id)
  return project
}
