import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTextComponentData, TEXT_DEFINITION } from '../../src/components/text'
import type { JsonValue } from '../../src/shared/contracts/component-platform/project'
import type { DocumentModel } from '../../src/shared/workbench/document'

/** Shared current owners for selection/grant integration; no Gateway or writer shortcuts. */
export function createCurrentSelectionFixture() {
  const project = createBlankCourseProjectV10('当前选区')
  const surface = project.surfaces[0]
  surface.id = 'page'
  project.definitions[TEXT_DEFINITION.id] = structuredClone(TEXT_DEFINITION)
  const data = (value: string) => JSON.parse(JSON.stringify(createTextComponentData(value))) as JsonValue
  for (const [id, value] of [['scene-text', '基础态正文'], ['scene-other', '另一个对象'], ['global-text', '全局基础对象'],
    ['flow-paragraph', '这是原始可编辑正文。'], ['flow-neighbor', '相邻正文'], ['spatial-label', '空间原文']]) {
    project.instances[id] = { id, definitionId: TEXT_DEFINITION.id, name: id, data: data(value),
      ...(!id.startsWith('flow-') ? { frame: { width: 400, height: 90, transform: [1, 0, 0, 1, 120, 120] } } : {}) }
  }
  surface.childIds.push('scene-text', 'scene-other')
  surface.presentation = { states: [
    { id: 'named-a', title: '命名态 A', overrides: { 'scene-text': { data: data('命名态 A 正文'), frame: { width: 400, height: 90, transform: [1, 0, 0, 1, 160, 120] } } } },
    { id: 'named-b', title: '命名态 B', overrides: { 'scene-text': { data: data('命名态 B 正文'), frame: { width: 400, height: 90, transform: [1, 0, 0, 1, 640, 120] } } } },
  ] }
  project.global.overlay.push('global-text')
  project.surfaces.push({ id: 'flow', kind: 'flow', title: 'Flow', childIds: ['flow-paragraph', 'flow-neighbor'] },
    { id: 'spatial', kind: 'spatial', title: 'Spatial', childIds: ['spatial-label'] })
  const model: Extract<DocumentModel, { kind: 'course-v10' }> = { kind: 'course-v10', project, resources: { assets: {}, components: {} } }
  return { model, project, surface, surfaceId: surface.id }
}
