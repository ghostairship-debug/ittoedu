import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createTextNode } from '../../src/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import type { DocumentModel } from '../../src/shared/workbench/document'
/** No assets, runtime or model calls. Reusable through CourseV9Driver.serialize for the real GUI gate. */
export function createNamedSelectionFixture() {
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces[0]
  if (surface.type !== 'slide') throw new Error('slide fixture')
  const scene = surface.scenes[0], locationId = project.locations[0].id
  const text = (id: string, value: string, x: number, y: number, order: number) => {
    const item = sceneNodeToCourseLayerItem(createTextNode({ id, text: value, x, y, width: 400, height: 90, style: { overflow: 'fixed', fontSize: 32 } }))
    item.order = order; item.label = value; return item
  }
  scene.layerItems = [text('scene-text', '基础态正文', 120, 120, 1), text('scene-other', '另一个对象', 120, 280, 2)]
  scene.presentation = { initialStateId: 'named-a', states: [
    { id: 'named-a', name: '命名态 A', layerItemOverrides: { 'scene-text': { nativeData: { text: '命名态 A 正文' }, frame: { x: 160 } } } },
    { id: 'named-b', name: '命名态 B', layerItemOverrides: { 'scene-text': { nativeData: { text: '命名态 B 正文' }, frame: { x: 640 } } } },
  ] }
  project.globalLayerItems = [{ item: text('global-text', '全局基础对象', 50, 560, 3), plane: 'overlay', visibility: { mode: 'all', locationIds: [] } }]
  surface.surfaceLayerItems = [{ item: text('surface-text', '表面基础对象', 650, 560, 4), visibility: { mode: 'all', locationIds: [] } }]
  const model: Extract<DocumentModel, { kind: 'course-v9' }> = { kind: 'course-v9', project, resources: { assets: {}, components: {} } }
  return { model, locationId, scene, surface }
}
