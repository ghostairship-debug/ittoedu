// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { planSlideTextInsertion } from '../../src/core/tools/slideInsertion'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { createSlideLightEditingPort } from '../../src/renderer/composition/selection/slideLightEditingPort'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { createCourseStoreHost } from '../helpers/courseStoreHost'
import { formalCourse, formalProject, projectCourse, undoCourse, redoCourse } from '../helpers/triage-t7-courseHost'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'

function scene(project: CourseProjectDocument) {
  const slide = project.surfaces[0]
  if (slide.type !== 'slide') throw new Error('slide')
  return slide.scenes[0]
}

function fixture() {
  const blank = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const locationId = blank.locations[0].id
  const inserted = planSlideTextInsertion(blank, { scope: 'scene', selection: { locationId, stateId: null } }, { id: 'm22-button', text: '按钮' })
  return { project: inserted.project, locationId, itemId: inserted.itemId }
}

/** Test wiring uses the real Main DocumentSession; product wiring is owned by editorStore composition. */
async function harness() {
  const host = await createCourseStoreHost()
  const seeded = fixture()
  const documentId = await projectCourse(host, seeded.project)
  let locationId = seeded.locationId, itemId = seeded.itemId
  let serial = 0
  const port = createSlideLightEditingPort({
    readCurrent: () => {
      const active = useEditorStore.getState().courseDocument.documentId
      if (!active) return null
      return { documentId: active, project: formalProject(host, active), locationId, itemId, stateId: null }
    },
    createId: () => `m22-${++serial}`,
    async commit(step, target) {
      const before = formalCourse(host)
      if (before.model.kind !== 'course-v9' || before.model.project.id !== step.projectId ||
        before.model.project.revision !== step.baseRevision ||
        useEditorStore.getState().courseDocument.documentId !== target.documentId ||
        locationId !== target.locationId || itemId !== target.itemId) return false
      const resources = structuredClone(before.model.resources)
      for (const change of step.resourceChanges.assetFileChanges ?? []) {
        if (change.after) resources.assets[change.assetId] = change.after
        else delete resources.assets[change.assetId]
      }
      const result = await host.api.dispatch({ documentId, epoch: before.epoch, baseRevision: before.revision,
        actor: 'human', operationId: `m22-op-${++serial}`, mutation: { type: 'command', command: {
          type: 'course.replace', project: { ...step.nextDocument, revision: step.baseRevision }, resources,
        } } })
      if (result.status !== 'applied') throw new Error(JSON.stringify(result))
      return true
    },
    chooseAudio: async () => ({ asset: { id: 'm22-wav', filename: 'click.wav', mimeType: 'audio/wav', kind: 'audio',
      path: 'assets/click.wav', byteLength: 44 }, bytes: new Uint8Array(44) }),
  })
  return { host, port, documentId, setSelection: (next: string) => { itemId = next }, setLocation: (next: string) => { locationId = next } }
}

it('M22 commits one light property through the real DocumentSession and saves its value', async () => {
  const { host, port, documentId } = await harness()
  const target = port.capture()!
  const command = port.view(target).commands.find(item => item.id === 'slide.opacity.50')!
  const before = formalCourse(host)
  await port.run(target, command)
  const after = formalCourse(host)
  expect(after.revision).toBe(before.revision + 1)
  expect(after.undoDepth).toBe(before.undoDepth + 1)
  expect(scene(formalProject(host)).layerItems.find(item => item.layerItemId === target.itemId)?.opacity).toBe(0.5)
  await undoCourse(host)
  expect(scene(formalProject(host)).layerItems.find(item => item.layerItemId === target.itemId)?.opacity).toBe(1)
  await redoCourse(host)
  await host.api.save(documentId, 'm22-saved.h5lesson')
  const saved = formalCourse(host)
  if (saved.model.kind !== 'course-v9') throw new Error('course')
  const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: saved.model.project,
    assetFiles: saved.model.resources.assets, componentFiles: saved.model.resources.components }))
  expect(scene(reopened.project).layerItems.find(item => item.layerItemId === target.itemId)?.opacity).toBe(0.5)
})

it('M22 places audio as one document/resource history entry and rejects a stale selection', async () => {
  const { host, port, setSelection } = await harness()
  const target = port.capture()!
  const opacity = port.view(target).commands.find(item => item.id === 'slide.opacity.50')!
  const before = formalCourse(host)
  await port.placeAudio(target)
  const placed = formalCourse(host)
  expect(placed.revision).toBe(before.revision + 1)
  expect(placed.undoDepth).toBe(before.undoDepth + 1)
  if (placed.model.kind !== 'course-v9') throw new Error('course')
  expect(placed.model.resources.assets['m22-wav']).toHaveLength(44)
  expect(placed.model.project.assets['m22-wav']).toBeTruthy()
  const slide = placed.model.project.surfaces[0]
  if (slide.type !== 'slide') throw new Error('slide')
  expect(slide.scenes[0].layerItems).toHaveLength(2)
  expect(slide.scenes[0].interactions).toHaveLength(1)
  await undoCourse(host)
  const undone = formalCourse(host)
  if (undone.model.kind !== 'course-v9') throw new Error('course')
  expect(undone.model.project.assets['m22-wav']).toBeUndefined()
  expect(undone.model.resources.assets['m22-wav']).toBeUndefined()
  await redoCourse(host)
  const restored = formalCourse(host)
  if (restored.model.kind !== 'course-v9') throw new Error('course')
  expect(restored.model.resources.assets['m22-wav']).toHaveLength(44)
  const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: restored.model.project,
    assetFiles: restored.model.resources.assets, componentFiles: restored.model.resources.components }))
  expect(reopened.assetFiles['m22-wav']).toHaveLength(44)
  expect(scene(reopened.project).interactions).toHaveLength(1)
  setSelection('some-other-item')
  await expect(port.run(target, opacity)).rejects.toThrow('选择或文档已改变')
})

it('M22 refuses a captured command after page or document activation changes', async () => {
  const { host, port, setLocation, documentId } = await harness()
  const target = port.capture()!
  const command = port.view(target).commands.find(item => item.id === 'slide.opacity.75')!
  setLocation('another-location')
  await expect(port.run(target, command)).rejects.toThrow('选择或文档已改变')
  setLocation(target.locationId)
  const before = formalCourse(host, documentId)
  expect(before.undoDepth).toBe(0)
  await host.open(fixture().project)
  await expect(port.run(target, command)).rejects.toThrow('选择或文档已改变')
  expect(formalCourse(host, documentId).revision).toBe(before.revision)
})
