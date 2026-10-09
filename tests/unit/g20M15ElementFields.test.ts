import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTextComponentData, TEXT_DEFINITION } from '../../src/components/text'
import { textComponentDataSchema } from '../../src/components/text/data'
import { elementChangeUnits, elementUnitLabel, readComponentElementFields, readComponentStateElementFields, readComponentStateOverrideRoots, restoreComponentElementEdits, restoreComponentStateElementEdits } from '../../src/core/drivers/course/elementFields'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { resolveComponentPresentation } from '../../src/shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'
const key = (...path: string[]) => JSON.stringify(path)
function fixture() {
  const project = createBlankCourseProjectV10('字段撤销'), surfaceId = project.surfaces[0].id
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.a = { id: 'a', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('标题'))), frame: { width: 160, height: 60, transform: [1, 0, 0, 1, 40, 40] } }
  project.surfaces[0].childIds = ['a']; project.surfaces[0].presentation = { states: [{ id: 'base', title: '初始', overrides: {} }, { id: 'open', title: '展开', overrides: { a: { style: { opacity: .5 } } } }] }
  return { project, surfaceId }
}
const apply = (project: ReturnType<typeof fixture>['project'], edits: ComponentEdit[]) => applyComponentOperation(project, captureComponentOperation(project, edits))
it('restores only changed component content units and preserves a later teacher frame', () => {
  const { project } = fixture(), before = readComponentElementFields(project, 'a')!
  expect(readComponentElementFields(project, 'missing')).toBeNull()
  expect(before[key('id')]).toBeUndefined(); expect(before[key('definitionId')]).toBeUndefined()
  const data = textComponentDataSchema.parse(project.instances.a.data)
  data.content = { inlines: [{ type: 'text', text: '新标题', style: { bold: true } }] }; data.appearance.color = '#dc2626'
  const after = apply(project, [{ type: 'data.set', instanceId: 'a', path: [], value: JSON.parse(JSON.stringify(data)) }])
  const units = elementChangeUnits(before, readComponentElementFields(after, 'a')!)
  expect(units.map(elementUnitLabel)).toContain('文字颜色')
  expect(units).toContainEqual([key('data', 'content', 'inlines')])
  const moved = apply(after, [{ type: 'frame.set', instanceId: 'a', frame: { ...after.instances.a.frame!, transform: [1, 0, 0, 1, 300, 40] } }])
  const restored = apply(moved, restoreComponentElementEdits(moved, 'a', Object.fromEntries(units.flat().map(field => [field, before[field]]))))
  expect(restored.instances.a.data).toEqual(project.instances.a.data)
  expect(restored.instances.a.frame?.transform).toEqual([1, 0, 0, 1, 300, 40])
  expect(after.instances.a.data).toEqual(data)
})
it('restores named-state content inheritance and removes emptied authored slots without affecting base or another state', () => {
  const { project, surfaceId } = fixture(), before = readComponentStateElementFields(project, surfaceId, 'base', 'a')!, roots = readComponentStateOverrideRoots(project, surfaceId, 'base', 'a')
  expect(roots).toEqual({})
  const changed = structuredClone(project), data = textComponentDataSchema.parse(project.instances.a.data)
  data.appearance.color = '#dc2626'
  changed.surfaces[0].presentation!.states[0].overrides.a = { data: JSON.parse(JSON.stringify(data)), visible: false, frame: { width: 160, height: 60, transform: [1, 0, 0, 1, 90, 40] } }
  const units = elementChangeUnits(before, readComponentStateElementFields(changed, surfaceId, 'base', 'a')!)
  const inverse = Object.fromEntries(units.flat().map(field => [field, before[field]]))
  const restored = apply(changed, restoreComponentStateElementEdits(changed, surfaceId, 'base', 'a', inverse, new Set([key('a', 'data')])))
  expect(restored.surfaces[0].presentation!.states[0].overrides).toEqual({})
  expect(restored.instances.a).toEqual(project.instances.a)
  expect(resolveComponentPresentation(restored, surfaceId, 'base').instances.a).toEqual(project.instances.a)
  expect(restored.surfaces[0].presentation!.states[1]).toEqual(project.surfaces[0].presentation!.states[1])
  expect(readComponentStateElementFields(project, surfaceId, 'missing', 'a')).toBeNull()
  expect(changed.surfaces[0].presentation!.states[0].overrides.a.visible).toBe(false)
})
