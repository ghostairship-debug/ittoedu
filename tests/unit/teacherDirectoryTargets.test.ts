import { expect, it } from 'vitest'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DOCUMENT_BLOCK_DEFINITION } from '../../src/components/document-block'
import { createComponentSpatialCameraPort } from '../../src/player/surfaces/spatial/componentSpatialAdapter'
import { teacherControllerActionSchema } from '../../src/shared/contracts/component-platform/teacherController'
import { createTeacherControllerHudGeometry, projectTeacherControllerInstances, restoreTeacherControllerFrameEdits, teacherControllerReferenceSize } from '../../src/shared/teacherControllerViewportGeometry'

it('derives the existing state/camera/body targets and executes Flow targets and page start on the one owner', async () => {
  const project = createBlankCourseProjectV10(), slide = project.surfaces[0]
  slide.presentation = { states: [{ id: 'state-a', title: '展开证明', overrides: {} }] }
  project.definitions[DOCUMENT_BLOCK_DEFINITION.id] = DOCUMENT_BLOCK_DEFINITION
  const text = (value: string) => ({ inlines: [{ type: 'text', text: value }] })
  project.instances.section = { id: 'section', definitionId: DOCUMENT_BLOCK_DEFINITION.id, data: { type: 'section', title: text('第一章'), collapsedByDefault: true }, childIds: ['heading'] }
  project.instances.heading = { id: 'heading', definitionId: DOCUMENT_BLOCK_DEFINITION.id, data: { type: 'heading', level: 2, content: text('具体问题') } }
  project.surfaces.push({ id: 'flow', title: '讲义', kind: 'flow', childIds: ['section'] },
    { id: 'space', title: '空间', kind: 'spatial', childIds: [], spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [{ id: 'camera', title: '实验镜头', pose: { x: 50, y: 60, zoom: 1 } }] } })
  let active = slide.id, selectedState: string | null = null
  const visits: Array<string | null> = []
  const owner = new ComponentNavigationOwner({ project: () => project, surfaceId: () => active, select: id => { active = id }, selectState: id => { selectedState = id } })
  const camera = createComponentSpatialCameraPort({ x: 0, y: 0, zoom: 1 })
  owner.registerCamera('space', camera)
  owner.registerObservation('flow', { readZoom: () => 1, setZoom() {}, reset() {}, goToInstance: id => { visits.push(id); return true } })
  try {
    const scenes = owner.read().scenes
    expect(scenes[0].targets?.[0].action).toEqual({ type: 'scene.go', sceneId: slide.id, targetStateId: 'state-a' })
    expect(scenes[1].targets?.map(target => [target.name, target.depth])).toEqual([['第一章', 0], ['具体问题', 1]])
    const heading = scenes[1].targets![1].action
    expect(teacherControllerActionSchema.parse(heading)).toEqual(heading)
    expect(await owner.teacherPort().execute(heading)).toBe(true); expect(active).toBe('flow'); expect(visits).toEqual(['heading'])
    expect(await owner.teacherPort().execute({ type: 'scene.go', sceneId: 'flow' })).toBe(true); expect(visits).toEqual(['heading', null])
    expect(await owner.teacherPort().execute(scenes[0].targets![0].action)).toBe(true); expect(selectedState).toBe('state-a')
    expect(await owner.teacherPort().execute(scenes[2].targets![0].action)).toBe(true); expect(camera.read()).toEqual({ x: 50, y: 60, zoom: 1 })
  } finally { owner.dispose(); camera.dispose() }
})

it('shrinks the default visible footprint while preserving the formal right anchor and saved drag geometry', () => {
  const project = createBlankCourseProjectV10(), id = project.global.overlay[0], original = project.instances[id].frame!
  const data = project.instances[id].data as Record<string, any>
  data.defaultCollapsed = false
  const hud = createTeacherControllerHudGeometry({ referenceSize: teacherControllerReferenceSize(project), viewportRect: { x: 0, y: 0, width: 1280, height: 720 } })
  const full = projectTeacherControllerInstances(project, hud).instances[id].frame!
  data.buttons = data.buttons.map((button: any) => ({ ...button, visible: ['previous', 'next', 'directory'].includes(button.id) }))
  const saved = structuredClone(project), display = projectTeacherControllerInstances(project, hud), frame = display.instances[id].frame!
  expect(frame.width).toBeLessThan(full.width)
  expect(frame.transform[4] + frame.width).toBe(original.transform[4] + original.width)
  const moved = { ...frame, transform: [...frame.transform] as typeof frame.transform }; moved.transform[4] += 40; moved.transform[5] -= 30
  const [edit] = restoreTeacherControllerFrameEdits([{ type: 'frame.set', instanceId: id, frame: moved }], project, display, hud)
  if (edit.type !== 'frame.set') throw Error('Expected formal frame edit')
  expect(edit.frame).toEqual({ ...original, transform: [1, 0, 0, 1, original.transform[4] + 40, original.transform[5] - 30] })
  expect(project).toEqual(saved)
})
