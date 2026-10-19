import type { CourseProjectV10 } from '../../shared/contracts/component-platform/project'

export function createBlankCourseProjectV10(title = '未命名课件', createId: () => string = () => crypto.randomUUID()): CourseProjectV10 {
  const project: CourseProjectV10 = {
    schemaVersion: 10, id: createId(), revision: 0, title,
    playback: { controls: 'none', keyboardNavigation: true,
      presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] } },
    definitions: {}, instances: {}, assets: {}, global: { underlay: [], overlay: [] },
    surfaces: [{ id: createId(), kind: 'slide', title: '第 1 页', childIds: [], designSize: { width: 1280, height: 720 } }],
  }
  return project
}
