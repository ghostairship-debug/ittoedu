// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { planSlideTextInsertion } from '../../src/core/tools/slideInsertion'
import { planSlideLightOpacity } from '../../src/core/tools/lightSlideEditing'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { createSlideLightEditingPort } from '../../src/renderer/composition/selection/slideLightEditingPort'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { createCourseStoreHost } from '../helpers/courseStoreHost'
import { formalCourse, formalProject, projectCourse, undoCourse, redoCourse } from '../helpers/triage-t7-courseHost'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import type { EditorTransactionStep } from '../../src/renderer/authoring/editorTransaction'

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
async function harness(options: { locked?: boolean } = {}) {
  const host = await createCourseStoreHost()
  const seeded = fixture()
  if (options.locked) scene(seeded.project).layerItems[0].locked = true
  const documentId = await projectCourse(host, seeded.project)
  let locationId = seeded.locationId, itemId: string | null = seeded.itemId
  let pending = 0
  let beforeCommit: (() => Promise<void>) | null = null
  const committedSteps: EditorTransactionStep[] = []
  let beforeAudioReturn: (() => Promise<void>) | null = null
  let serial = 0
  const port = createSlideLightEditingPort({
    readCurrent: () => {
      const active = useEditorStore.getState().courseDocument.documentId
      if (!active) return null
      const snapshot = formalCourse(host, active)
      if (snapshot.model.kind !== 'course-v9') return null
      return { documentId: active, epoch: snapshot.epoch, project: snapshot.model.project, locationId, itemId, stateId: null, pending }
    },
    createId: () => `m22-${++serial}`,
    async commit(step, target) {
      if (beforeCommit) await beforeCommit()
      const before = formalCourse(host)
      if (before.model.kind !== 'course-v9' || before.epoch !== target.epoch || before.model.project.id !== step.projectId ||
        before.model.project.revision !== step.baseRevision ||
        useEditorStore.getState().courseDocument.documentId !== target.documentId ||
        locationId !== target.locationId || (target.kind === 'object' && itemId !== target.itemId) || pending) return false
      const resources = structuredClone(before.model.resources)
      for (const change of step.resourceChanges.assetFileChanges ?? []) {
        if (change.after) resources.assets[change.assetId] = change.after
        else delete resources.assets[change.assetId]
      }
      const result = await host.api.dispatch({ documentId: target.documentId, epoch: target.epoch, baseRevision: target.expectedRevision,
        actor: 'human', operationId: `m22-op-${++serial}`, mutation: { type: 'command', command: {
          type: 'course.replace', project: { ...step.nextDocument, revision: step.baseRevision }, resources,
        } } })
      if (result.status !== 'applied') throw new Error(JSON.stringify(result))
      committedSteps.push(step)
      return true
    },
    chooseAudio: async () => {
      if (beforeAudioReturn) await beforeAudioReturn()
      return { asset: { id: 'm22-wav', filename: 'click.wav', mimeType: 'audio/wav', kind: 'audio',
        path: 'assets/click.wav', byteLength: 44 }, bytes: new Uint8Array(44) }
    },
  })
  return { host, port, documentId, setSelection: (next: string | null) => { itemId = next }, setLocation: (next: string) => { locationId = next },
    setAudioSelectionHook: (hook: () => Promise<void>) => { beforeAudioReturn = hook },
    setBeforeCommit: (hook: () => Promise<void>) => { beforeCommit = hook }, setPending: (next: number) => { pending = next }, committedSteps }
}

it('M22 commits one light property through the real DocumentSession and saves its value', async () => {
  const { host, port, documentId } = await harness()
  const target = port.captureObject()!
  const command = port.viewObject(target).commands.find(item => item.id === 'slide.opacity.50')!
  const before = formalCourse(host)
  await port.runObject(target, command)
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
  const target = port.captureObject()!
  const page = port.capturePage()!
  const opacity = port.viewObject(target).commands.find(item => item.id === 'slide.opacity.50')!
  const before = formalCourse(host)
  await port.placeAudio(page)
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
  await expect(port.runObject(target, opacity)).rejects.toThrow('选择或文档已改变')
})

it('M22 refuses a captured command after page or document activation changes', async () => {
  const { host, port, setLocation, documentId } = await harness()
  const target = port.captureObject()!
  const command = port.viewObject(target).commands.find(item => item.id === 'slide.opacity.75')!
  setLocation('another-location')
  await expect(port.runObject(target, command)).rejects.toThrow('选择或文档已改变')
  setLocation(target.locationId)
  const before = formalCourse(host, documentId)
  expect(before.undoDepth).toBe(0)
  await host.open(fixture().project)
  await expect(port.runObject(target, command)).rejects.toThrow('选择或文档已改变')
  expect(formalCourse(host, documentId).revision).toBe(before.revision)
})

it('M22 rejects a captured command after a formal revision changes', async () => {
  const { host, port, documentId } = await harness()
  const oldTarget = port.captureObject()!
  const oldCommand = port.viewObject(oldTarget).commands.find(item => item.id === 'slide.opacity.75')!
  const currentTarget = port.captureObject()!
  const currentCommand = port.viewObject(currentTarget).commands.find(item => item.id === 'slide.opacity.50')!
  await port.runObject(currentTarget, currentCommand)
  const changed = formalCourse(host, documentId)
  expect(changed.revision).toBe(oldTarget.expectedRevision + 1)
  await expect(port.runObject(oldTarget, oldCommand)).rejects.toThrow('选择或文档已改变')
  expect(formalCourse(host, documentId).revision).toBe(changed.revision)
  expect(formalCourse(host, documentId).undoDepth).toBe(changed.undoDepth)
})

it('M22 rejects an old menu after the same document is restored with a new epoch', async () => {
  const { host, port, documentId } = await harness()
  const target = port.captureObject()!
  const command = port.viewObject(target).commands.find(item => item.id === 'slide.opacity.75')!
  const before = formalCourse(host, documentId)
  expect(await useEditorStore.getState().closeCourseDocument(documentId)).toBe(true)
  const restored = await host.api.restore(documentId)
  await useEditorStore.getState().activateCourseDocument(documentId)
  await useEditorStore.getState().drainCourseDocument()
  expect(restored.documentId).toBe(target.documentId)
  expect(restored.epoch).not.toBe(target.epoch)
  expect(restored.revision).toBe(target.expectedRevision)
  expect(restored.model.kind).toBe('course-v9')
  if (restored.model.kind !== 'course-v9') throw new Error('course')
  expect(restored.model.project.id).toBe(target.projectId)
  expect(port.captureObject()?.itemId).toBe(target.itemId)
  await expect(port.runObject(target, command)).rejects.toThrow('选择或文档已改变')
  const after = formalCourse(host, documentId)
  expect(after.revision).toBe(before.revision)
  expect(after.undoDepth).toBe(before.undoDepth)
  expect(scene(formalProject(host, documentId)).layerItems.find(item => item.layerItemId === target.itemId)?.opacity).toBe(1)
})

it('M22 rejects an audio choice that returns after a page and document switch', async () => {
  const { host, port, documentId, setLocation, setAudioSelectionHook } = await harness()
  const target = port.capturePage()!
  const before = formalCourse(host, documentId)
  let newDocumentId: string | null = null
  setAudioSelectionHook(async () => {
    setLocation('another-location')
    await host.open(fixture().project)
    newDocumentId = useEditorStore.getState().courseDocument.documentId
  })
  await expect(port.placeAudio(target)).rejects.toThrow('选择或文档已改变')
  expect(newDocumentId).not.toBe(documentId)
  const original = formalCourse(host, documentId)
  expect(original.revision).toBe(before.revision)
  expect(original.undoDepth).toBe(before.undoDepth)
  expect(original.model.kind).toBe('course-v9')
  if (original.model.kind !== 'course-v9') throw new Error('course')
  expect(original.model.resources.assets['m22-wav']).toBeUndefined()
  const active = formalCourse(host, newDocumentId)
  expect(active.undoDepth).toBe(0)
  expect(active.model.kind).toBe('course-v9')
  if (active.model.kind !== 'course-v9') throw new Error('course')
  expect(active.model.resources.assets['m22-wav']).toBeUndefined()
})

it('M22 shows disabled commands for a locked item and preserves the planner rejection', async () => {
  const { host, port } = await harness({ locked: true })
  const target = port.captureObject()!
  const before = formalCourse(host)
  const view = port.viewObject(target)
  const opacity = view.commands.find(command => command.id === 'slide.opacity.50')!
  const navigation = view.commands.find(command => command.kind === 'location-go')!
  expect(opacity.disabledReason).toContain('锁定')
  expect(navigation.disabledReason).toContain('锁定')
  await expect(port.runObject(target, opacity)).rejects.toThrow('锁定')
  expect(() => planSlideLightOpacity(formalProject(host), target, 0.5)).toThrow('锁定')
  expect(formalCourse(host).revision).toBe(before.revision)
  expect(formalCourse(host).undoDepth).toBe(before.undoDepth)
})

it('M22 edits an empty page background without a selected item', async () => {
  const { host, port, setSelection, committedSteps } = await harness()
  setSelection(null)
  expect(port.captureObject()).toBeNull()
  const page = port.capturePage()!
  expect('itemId' in page).toBe(false)
  const command = port.viewPage(page).commands.find(item => item.id === 'slide.background.dbeafe')!
  const before = formalCourse(host)
  await port.runPage(page, command)
  const after = formalCourse(host)
  expect(after.revision).toBe(before.revision + 1)
  expect(after.undoDepth).toBe(before.undoDepth + 1)
  expect(scene(formalProject(host)).backgroundColor).toBe('#dbeafe')
  expect(committedSteps.at(-1)?.selectionHint).toBeUndefined()
  await undoCourse(host)
  expect(scene(formalProject(host)).backgroundColor).not.toBe('#dbeafe')
})

it('M22 places audio on an empty page and selects the planned button', async () => {
  const { host, port, setSelection, committedSteps } = await harness()
  setSelection(null)
  const page = port.capturePage()!
  const command = port.viewPage(page).commands.find(item => item.kind === 'audio-import')!
  await port.runPage(page, command)
  const placed = formalCourse(host)
  if (placed.model.kind !== 'course-v9') throw new Error('course')
  const button = scene(placed.model.project).layerItems.find(item => item.layerItemId === 'm22-1')
  expect(button).toBeTruthy()
  expect(committedSteps.at(-1)?.selectionHint).toMatchObject({ itemIds: [button?.layerItemId] })
  expect(placed.model.resources.assets['m22-wav']).toHaveLength(44)
  await undoCourse(host)
  expect(formalCourse(host).undoDepth).toBe(0)
  expect(formalProject(host).assets['m22-wav']).toBeUndefined()
})

it('M22 rejects stale page work after same-document epoch changes during media selection', async () => {
  const { host, port, documentId, setSelection, setAudioSelectionHook } = await harness()
  setSelection(null)
  const page = port.capturePage()!
  const before = formalCourse(host, documentId)
  setAudioSelectionHook(async () => {
    expect(await useEditorStore.getState().closeCourseDocument(documentId)).toBe(true)
    await host.api.restore(documentId)
    await useEditorStore.getState().activateCourseDocument(documentId)
  })
  await expect(port.placeAudio(page)).rejects.toThrow('选择或文档已改变')
  const after = formalCourse(host, documentId)
  expect(after.epoch).not.toBe(page.epoch)
  expect(after.revision).toBe(before.revision)
  expect(after.undoDepth).toBe(before.undoDepth)
  if (after.model.kind !== 'course-v9') throw new Error('course')
  expect(after.model.resources.assets['m22-wav']).toBeUndefined()
})

it('M22 refuses a page command when the formal epoch changes while commit waits for ACK', async () => {
  const { host, port, documentId, setSelection, setBeforeCommit } = await harness()
  setSelection(null)
  const page = port.capturePage()!
  const command = port.viewPage(page).commands.find(item => item.id === 'slide.background.dbeafe')!
  const before = formalCourse(host, documentId)
  setBeforeCommit(async () => {
    expect(await useEditorStore.getState().closeCourseDocument(documentId)).toBe(true)
    await host.api.restore(documentId)
    await useEditorStore.getState().activateCourseDocument(documentId)
  })
  await expect(port.runPage(page, command)).rejects.toThrow('修改未提交')
  const after = formalCourse(host, documentId)
  expect(after.epoch).not.toBe(page.epoch)
  expect(after.revision).toBe(before.revision)
  expect(after.undoDepth).toBe(before.undoDepth)
  expect(scene(formalProject(host, documentId)).backgroundColor).not.toBe('#dbeafe')
})

it('M22 blocks capture while pending and refuses a page commit when selection becomes pending before ACK', async () => {
  const { host, port, setSelection, setPending, setBeforeCommit } = await harness()
  setSelection(null)
  const page = port.capturePage()!
  const command = port.viewPage(page).commands.find(item => item.id === 'slide.background.dbeafe')!
  setBeforeCommit(async () => { setPending(1) })
  const before = formalCourse(host)
  await expect(port.runPage(page, command)).rejects.toThrow('修改未提交')
  expect(port.capturePage()).toBeNull()
  expect(port.captureObject()).toBeNull()
  expect(formalCourse(host).revision).toBe(before.revision)
  expect(formalCourse(host).undoDepth).toBe(before.undoDepth)
})
