import type { ComponentSurface, CourseProjectV10 } from '../../shared/contracts/component-platform/project'

export const LAST_COURSE_PAGE_REASON = '这是最后一个页面，不能删除'

/** UI and Agent authoring share the same empty surface defaults. */
export function createCourseSurface(project: CourseProjectV10,
  input: { kind: ComponentSurface['kind']; title?: string; referenceSurfaceId?: string },
  createId: () => string = () => crypto.randomUUID()): ComponentSurface {
  const { kind } = input
  const reference = project.surfaces.find(surface => surface.id === input.referenceSurfaceId)
  const title = input.title === undefined
    ? kind === 'slide' ? '第 ' + (project.surfaces.filter(surface => surface.kind === 'slide').length + 1) + ' 页'
      : kind === 'flow' ? '新流式讲义' : '新无限画布'
    : input.title.trim()
  return { id: createId(), kind, title, childIds: [],
    ...(kind === 'slide' ? { designSize: structuredClone(reference?.designSize ?? { width: 1280, height: 720 }) } : {}),
    ...(kind === 'spatial' ? { spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [] } } : {}) }
}

export function assertCourseSurfaceRemoval(project: CourseProjectV10): void {
  if (project.surfaces.length <= 1) throw new Error(LAST_COURSE_PAGE_REASON)
}
