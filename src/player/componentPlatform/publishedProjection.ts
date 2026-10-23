import { componentContainers, resolveComponentPresentation, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { TeacherControllerPort } from '../../shared/contracts/component-platform/teacherController'
import type { PublishedCourseV3 } from '../../shared/contracts/component-platform/published'
import type { DocumentResources } from '../../shared/workbench/document'

/** One read-only P0 projection into R0; never saved as an author document. */
export function publishedComponentModel(payload: PublishedCourseV3) {
  return { kind: 'course-v10' as const, project: { schemaVersion: 11 as const, revision: 0, id: payload.id, title: payload.title,
    definitions: payload.definitions, instances: payload.instances, rootIds: payload.rootIds, entry: payload.entry, global: payload.global,
    background: payload.background, theme: payload.theme, designTokens: payload.designTokens, playback: payload.playback, media: payload.media, logic: payload.logic,
    assets: Object.fromEntries(Object.entries(payload.assets).map(([id, asset]) => { const { url: _url, ...metadata } = asset; return [id, { ...metadata, path: `assets/${encodeURIComponent(id)}` }] })) },
    resources: { assets: {}, components: {} } as DocumentResources }
}

/** One disposable parent-before-child projection for native and compiled players. */
export function resolveModelPlayerPresentation(source: CourseProjectV10, navigation?: TeacherControllerPort): CourseProjectV10 {
  let project = source
  const visited = new Set<string>()
  const present = (id: string) => {
    if (visited.has(id)) return
    visited.add(id)
    const instance = source.instances[id]
    if (instance?.container) {
      const port = navigation?.forContainer?.(id) ?? (navigation?.readLocation() === id ? navigation : undefined)
      const stateId = port?.currentStateId?.()
      if (stateId !== undefined) project = resolveComponentPresentation(project, id, stateId)
    }
    instance?.childIds?.forEach(present)
  }
  for (const id of [...source.rootIds, ...source.global.underlay, ...source.global.overlay]) present(id)
  componentContainers(source).forEach(container => present(container.id))
  return project
}
