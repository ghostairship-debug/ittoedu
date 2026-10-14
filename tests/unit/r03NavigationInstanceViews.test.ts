import { expect, it, vi } from 'vitest'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTeacherControllerData, TEACHER_CONTROLLER_DEFINITION } from '../../src/components/teacher-controller/data'
import { createTeacherControllerHudGeometry, projectTeacherControllerInstances, isViewportComponent } from '../../src/shared/teacherControllerViewportGeometry'
import { courseProjectV10Schema } from '../../src/shared/contracts/component-platform'
import { restoreComponentElementEdits, readComponentElementFields } from '../../src/core/drivers/course/elementFields'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'

it('R03 separates two ordinary control views while sharing guarded course facts and preserving author frames', async () => {
  const project = createBlankCourseProjectV10()
  expect(project.global.overlay).toEqual([])
  project.surfaces.push({ id: 'second', kind: 'flow', title: 'Second', childIds: [] })
  project.logic = { courseState: [], navigationGuards: [{ id: 'guard', effect: 'block', toSurfaceIds: ['second'], match: 'all', conditions: [], message: 'Locked' }] }
  project.definitions.controls = { id: 'controls', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default { mount() {} }' } }
  project.definitions[TEACHER_CONTROLLER_DEFINITION.id] = TEACHER_CONTROLLER_DEFINITION
  for (const [id, y] of [['a', 30], ['b', 180]] as const) {
    project.instances[id] = { id, definitionId: 'controls', viewportPinned: true, data: {}, frame: { width: 220, height: 60, transform: [1, 0, 0, 1, 40, y] } }
    project.global.overlay.push(id)
  }
  project.instances.teacher = { id: 'teacher', definitionId: TEACHER_CONTROLLER_DEFINITION.id, data: JSON.parse(JSON.stringify(createTeacherControllerData())) }
  project.global.overlay.push('teacher')
  let surfaceId = project.surfaces[0].id
  const owner = new ComponentNavigationOwner({ project: () => project, surfaceId: () => surfaceId, select: id => { surfaceId = id }, viewportBounds: () => ({ left: 0, top: 0, right: 1280, bottom: 720 }) })
  const a = owner.forInstance('a'), b = owner.forInstance('b'), changed = vi.fn(), semantic = vi.fn(), other = vi.fn()
  owner.subscribePlacement(changed); a.subscribe(semantic); b.subscribe(other)
  a.moveBy(90, 25)
  expect(a.placement?.()).toEqual({ x: 90, y: 25 }); expect(b.placement?.()).toEqual({ x: 0, y: 0 })
  expect(changed).toHaveBeenCalledOnce(); expect(semantic).not.toHaveBeenCalled(); expect(other).not.toHaveBeenCalled()
  a.setCollapsed(true)
  expect(a.read().collapsed).toBe(true); expect(b.read().collapsed).toBe(false); expect(other).not.toHaveBeenCalled()
  expect(await a.execute({ type: 'scene.go', sceneId: 'second' })).toBe(false)
  expect(await owner.teacherPort().forInstance!('a').execute({ type: 'scene.go', sceneId: 'second' })).toBe(false)
  expect(await owner.teacherPort().forInstance!('teacher').execute({ type: 'scene.go', sceneId: 'second' })).toBe(true)
  expect(a.read().locationId).toBe('second'); expect(b.read().locationId).toBe('second')
  const display = projectTeacherControllerInstances(project, createTeacherControllerHudGeometry({ referenceSize: { width: 1280, height: 720 }, viewportRect: { x: 0, y: 0, width: 1280, height: 720 } }), owner)
  expect(display.instances.a.frame?.transform.slice(4)).toEqual([130, 55]); expect(display.instances.b.frame?.transform.slice(4)).toEqual([40, 180])
  expect(project.instances.a.frame?.transform.slice(4)).toEqual([40, 30])
  expect(projectTeacherControllerInstances(project, createTeacherControllerHudGeometry({ referenceSize: { width: 1280, height: 720 }, viewportRect: { x: 0, y: 0, width: 1280, height: 720 } }), owner.editorPort()).instances.a.frame).toEqual(display.instances.a.frame)
  const reopened = courseProjectV10Schema.parse(JSON.parse(JSON.stringify(project)))
  expect(isViewportComponent(reopened, 'a')).toBe(true)
  owner.dispose()
})

it('restores an absent viewport intent through the AI change-card inverse for ordinary and teacher instances', () => {
  const project = createBlankCourseProjectV10()
  project.definitions.control = { id: 'control', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } }
  project.definitions[TEACHER_CONTROLLER_DEFINITION.id] = TEACHER_CONTROLLER_DEFINITION
  for (const [id, definitionId] of [['ordinary', 'control'], ['teacher', TEACHER_CONTROLLER_DEFINITION.id]]) {
    project.instances[id] = { id, definitionId, data: {}, frame: { width: 200, height: 60, transform: [1, 0, 0, 1, 0, 0] } }; project.global.overlay.push(id)
    const before = readComponentElementFields(project, id)!
    const changed = applyComponentOperation(project, captureComponentOperation(project, [{ type: 'instance.patch', instanceId: id, patch: { viewportPinned: id === 'ordinary' } }]))
    const edits = restoreComponentElementEdits(changed, id, { '["viewportPinned"]': before['["viewportPinned"]'] })
    const restored = applyComponentOperation(changed, captureComponentOperation(changed, edits))
    expect(restored.instances[id]).not.toHaveProperty('viewportPinned')
    expect(isViewportComponent(restored, id)).toBe(id === 'teacher')
  }
})
