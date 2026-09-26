import { expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { elementChangeUnits, elementUnitLabel, readElementFields, writeElementFields } from '../../src/core/drivers/course/elementFields'
import { createTextNode } from '../../src/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'

// M15: an element card's undo restores only the fields its request changed, one unit at a time.
function course(): CourseProjectDocument {
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('slide surface')
  const scene = surface.scenes[0]!
  scene.layerItems = [sceneNodeToCourseLayerItem(createTextNode({ id: 'a', text: '标题', x: 40, y: 40 }), 1)]
  scene.presentation = { initialStateId: 'base', states: [
    { id: 'base', name: '初始', layerItemOverrides: {} },
    { id: 'open', name: '展开', layerItemOverrides: { a: { opacity: 0.5 } } },
  ] }
  return project
}
const item = (project: CourseProjectDocument) => {
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('slide surface')
  const found = surface.scenes[0]!.layerItems[0]!
  if (found.kind !== 'native' || found.content.nativeType !== 'text') throw new Error('text')
  return { item: found, data: found.content.data, states: surface.scenes[0]!.presentation!.states }
}
const key = (...path: string[]) => JSON.stringify(path)

it('M15 reads an object with its named-state overrides, groups text with its runs, and restores only the given fields', () => {
  const before = course()
  const fields = readElementFields(before, 'a')!
  expect(fields[key('item', 'frame', 'x')]).toBe(40)
  expect(fields[key('item', 'content', 'data', 'text')]).toBe('标题')
  expect(fields[key('state', 'open', 'opacity')]).toBe(0.5)
  expect(fields[key('item', 'layerItemId')]).toBeUndefined()

  // The request: new words, a new colour in the base, a new frame offset in a named state.
  const after = structuredClone(before)
  const { data: changed, states } = item(after)
  changed.text = '新标题'
  changed.style.color = '#dc2626'
  states[1]!.layerItemOverrides.a = { opacity: 0.5, frame: { x: 90 } }
  const units = elementChangeUnits(fields, readElementFields(after, 'a')!)
  expect(units.map(elementUnitLabel).sort()).toEqual(['命名态中的位置', '文字', '文字颜色'].sort())
  // Text and runs are one unit: restoring the words restores the runs with them.
  expect(units.find(unit => unit.includes(key('item', 'content', 'data', 'text')))).toEqual(expect.arrayContaining([key('item', 'content', 'data', 'runs')]))

  // Later the teacher moves the object; undoing the request keeps the move.
  item(after).item.frame.x = 300
  const undone = writeElementFields(after, 'a', Object.fromEntries(units.flat().map(field => [field, fields[field]])))
  const restored = item(undone)
  expect(restored.data.text).toBe('标题')
  expect(restored.data.style.color).toBe(item(before).data.style.color)
  expect(restored.item.frame.x).toBe(300)
  // The named state's added frame override is removed again, not left as an empty object.
  expect(restored.states[1]!.layerItemOverrides.a).toEqual({ opacity: 0.5 })
  expect(item(after).data.text).toBe('新标题')
})

it('M15 drops a named-state override that an undo empties and leaves components to the editor undo', () => {
  const before = course()
  const after = structuredClone(before)
  item(after).states[0]!.layerItemOverrides.a = { visible: false }
  const fields = readElementFields(before, 'a')!
  const units = elementChangeUnits(fields, readElementFields(after, 'a')!)
  expect(units).toEqual([[key('state', 'base', 'visible')]])
  const undone = writeElementFields(after, 'a', { [key('state', 'base', 'visible')]: undefined })
  expect(item(undone).states[0]!.layerItemOverrides).toEqual({})
  expect(readElementFields(before, 'missing')).toBeNull()
})
