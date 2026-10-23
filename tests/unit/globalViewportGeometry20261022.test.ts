import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import type { ComponentFrame, ComponentInstance } from '../../src/shared/contracts/component-platform'
import { frameCorners } from '../../src/core/components/geometry'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { createTeacherControllerHudGeometry, projectTeacherControllerInstances, restoreTeacherControllerFrameEdits, teacherControllerViewportFrame } from '../../src/shared/teacherControllerViewportGeometry'

function fixture() {
  const project = createBlankCourseProjectV10()
  project.definitions.paint = { id: 'paint', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } }
  const add = (id: string, plane: 'underlay' | 'overlay', style: ComponentInstance['style'], frame: ComponentFrame = { width: 1280, height: 4096, transform: [1, 0, 0, 1, 0, 0] }) => {
    project.instances[id] = { id, definitionId: 'paint', viewportPinned: true, data: {}, style, frame }
    project.global[plane].push(id)
  }
  add('background', 'underlay', { width: '100%', height: '100%' })
  add('overlay-paint', 'overlay', { width: '100%', height: '100%', 'pointer-events': 'none' })
  add('navigation', 'overlay', { width: '100%' }, { width: 1280, height: 48, transform: [1, 0, 0, 1, 0, 0] })
  add('ordinary', 'overlay', {}, { width: 220, height: 60, transform: [1, 0, 0, 1, 1200, 700] })
  return project
}

it.each([1440, 1550, 390])('uses the same complete %ipx viewport for interactive and painted global layers', width => {
  const project = fixture(), saved = structuredClone(project), height = 844
  const geometry = createTeacherControllerHudGeometry({ referenceSize: { width: 1280, height: 720 },
    viewportRect: { x: 23, y: 17, width, height } })
  const display = projectTeacherControllerInstances(project, geometry)
  for (const id of ['background', 'overlay-paint']) {
    expect(display.instances[id].frame).toEqual({ width, height, transform: [1, 0, 0, 1, 23, 17] })
  }
  expect(display.instances.navigation.frame).toEqual({ width, height: 48, transform: [1, 0, 0, 1, 23, 17] })
  const corners = frameCorners(display.instances.ordinary.frame!)
  expect(Math.min(...corners.map(point => point.x))).toBeGreaterThanOrEqual(23)
  expect(Math.max(...corners.map(point => point.x))).toBeLessThanOrEqual(23 + width)
  expect(Math.max(...corners.map(point => point.y))).toBeLessThanOrEqual(17 + height)
  expect(project).toEqual(saved)
  for (const id of project.rootIds) expect(display.instances[id]).toBe(project.instances[id])
})

it('changing pointer handling or global plane does not move or shrink the canvas', () => {
  const project = fixture()
  const geometry = createTeacherControllerHudGeometry({ referenceSize: { width: 1280, height: 720 },
    viewportRect: { x: 0, y: 0, width: 1440, height: 900 } })
  const shown = projectTeacherControllerInstances(project, geometry)
  expect(shown.instances.background.frame?.width).toBe(1440)
  expect(shown.instances.background.frame?.height).toBe(900)
  expect(shown.instances.navigation.frame?.width).toBe(1440)
  project.instances.navigation.style!.pointerEvents = 'none'
  expect(projectTeacherControllerInstances(project, geometry).instances.navigation.frame).toEqual(shown.instances.navigation.frame)
  project.global.overlay = project.global.overlay.filter(id => id !== 'navigation')
  project.global.underlay.push('navigation')
  expect(projectTeacherControllerInstances(project, geometry).instances.navigation.frame).toEqual(shown.instances.navigation.frame)
})

it('round trips author edits through one projection and CSS pixel movement for stretched controls', () => {
  const project = fixture()
  project.instances.background.frame = { width: 200, height: 80, transform: [1, 0, 0, 1, 300, 200] }
  project.instances.background.style = {}
  const geometry = createTeacherControllerHudGeometry({ referenceSize: { width: 1280, height: 720 },
    viewportRect: { x: 20, y: 30, width: 1000, height: 600 } })
  const shown = projectTeacherControllerInstances(project, geometry)
  const edits = ['background', 'ordinary', 'navigation'].map(instanceId => {
    const frame = structuredClone(shown.instances[instanceId].frame!)
    frame.transform[5] += instanceId === 'navigation' ? 20 : -20
    return { type: 'frame.set' as const, instanceId, frame }
  })
  const restored = restoreTeacherControllerFrameEdits(edits, project, shown, geometry)
  const next = { ...project, instances: { ...project.instances } }
  for (const edit of restored) {
    if (edit.type !== 'frame.set') throw Error('Expected author frame edit')
    expect(edit.frame?.width).toBe(project.instances[edit.instanceId].frame?.width)
    next.instances[edit.instanceId] = { ...project.instances[edit.instanceId], frame: edit.frame! }
  }
  const displayedAgain = projectTeacherControllerInstances(next, geometry)
  for (const id of ['background', 'ordinary', 'navigation']) {
    expect(displayedAgain.instances[id].frame!.transform[5]).toBeCloseTo(shown.instances[id].frame!.transform[5] + (id === 'navigation' ? 20 : -20))
  }
  const nav = restored.find(edit => edit.type === 'frame.set' && edit.instanceId === 'navigation')!
  expect(nav.type === 'frame.set' && nav.frame!.transform[5]).toBe(20)
})

it('leaves non-pinned global frames outside the viewport projection', () => {
  const project = fixture()
  project.instances.background.viewportPinned = false
  const shown = projectTeacherControllerInstances(project, createTeacherControllerHudGeometry({ referenceSize: { width: 1280, height: 720 },
    viewportRect: { x: 0, y: 0, width: 390, height: 844 } }))
  expect(shown.instances.background).toBe(project.instances.background)
})

it.each(['navigation', 'background'])('retains viewport sizing through affine edit, drag and reopen for %s', instanceId => {
  const project = fixture(), geometry = createTeacherControllerHudGeometry({ referenceSize: { width: 1280, height: 720 },
    viewportRect: { x: 20, y: 30, width: 1000, height: 600 } })
  for (const matrix of [[.8, 0, 0, .8, 60, 70], [0, .4, -.4, 0, 250, 80], [1.2, 0, 0, 1.2, 20, 30]] as ComponentFrame['transform'][]) {
    const display = projectTeacherControllerInstances(project, geometry), before = display.instances[instanceId].frame!
    const requested = { ...before, transform: matrix }
    const [edit] = restoreTeacherControllerFrameEdits([{ type: 'frame.set', instanceId, frame: requested }], project, display, geometry)
    if (edit.type !== 'frame.set') throw Error('Expected frame edit')
    const next = structuredClone(project); next.instances[instanceId].frame = edit.frame!
    const shown = projectTeacherControllerInstances(next, geometry).instances[instanceId].frame!
    const local = { ...requested, transform: [...matrix] as ComponentFrame['transform'] }; local.transform[4] -= 20; local.transform[5] -= 30
    const expected = teacherControllerViewportFrame(local, geometry.viewportRect)
    expected.transform[4] += 20; expected.transform[5] += 30
    expect(shown.width).toBeCloseTo(expected.width)
    expect(shown.height).toBeCloseTo(expected.height)
    shown.transform.forEach((value, index) => expect(value).toBeCloseTo(expected.transform[index]))
    expect(next.instances[instanceId].frame!.width).toBe(project.instances[instanceId].frame!.width)
    const moved = structuredClone(shown); moved.transform[4] += 10; moved.transform[5] += 10
    const [drag] = restoreTeacherControllerFrameEdits([{ type: 'frame.set', instanceId, frame: moved }], next,
      projectTeacherControllerInstances(next, geometry), geometry)
    if (drag.type !== 'frame.set') throw Error('Expected drag edit')
    const reopened = structuredClone(next); reopened.instances[instanceId].frame = drag.frame!
    const result = projectTeacherControllerInstances(reopened, geometry).instances[instanceId].frame!
    expect(result.transform[0]).toBeCloseTo(shown.transform[0])
    expect(result.transform[3]).toBeCloseTo(shown.transform[3])
  }
})

it('runtime dragging starts from the same clamped viewport frame as painting without changing author data', () => {
  const project = fixture(), saved = structuredClone(project)
  project.instances.navigation.frame!.transform[5] = 700
  const original = structuredClone(project)
  const owner = new ComponentNavigationOwner({ project: () => project, surfaceId: () => project.rootIds[0], select: () => true,
    viewportBounds: () => ({ left: 0, top: 0, right: 1000, bottom: 600 }) })
  const geometry = createTeacherControllerHudGeometry({ referenceSize: { width: 1280, height: 720 }, viewportRect: { x: 0, y: 0, width: 1000, height: 600 } })
  const port = owner.forInstance('navigation'), before = projectTeacherControllerInstances(project, geometry, owner).instances.navigation.frame!
  expect(before.transform[5]).toBe(552)
  port.moveBy(0, -20)
  const after = projectTeacherControllerInstances(project, geometry, owner).instances.navigation.frame!
  expect(after.transform[5]).toBe(532)
  expect(after.width).toBe(before.width)
  expect(project).toEqual(original)
  owner.dispose()
  expect(saved.instances.navigation.frame!.transform[5]).toBe(0)
})
