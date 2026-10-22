import { expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { createInitialSlideOwnedState, createSlideAuthoringSlice } from '../../src/renderer/store/slices/slideAuthoringSlice'

it('borrows immutable input targets and advances only its accepted operation without cloning untouched facts', async () => {
  const project = createBlankCourseProjectV10('Owned input'), rootId = project.rootIds[0]
  project.definitions.custom = { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } }
  project.instances.text = { id: 'text', definitionId: 'custom', data: { title: 'old' }, frame: { width: 300, height: 80, transform: [1, 0, 0, 1, 0, 0] } }
  project.instances[rootId].childIds!.push('text')
  const h = await createV10StoreHost(project)
  const captureOwned = h.kernel.captureOwnedTarget
  if (!captureOwned) throw new Error('Real authoring kernel must provide owned capture')
  const publicCapture = vi.spyOn(h.kernel, 'captureTarget'), ownedCapture = vi.fn(captureOwned)
  h.kernel.captureOwnedTarget = ownedCapture
  let state = createInitialSlideOwnedState()
  const slice = createSlideAuthoringSlice(h.kernel, { read: () => state, patch: patch => { state = { ...state, ...patch } } })
  try {
    const original = slice.beginSlideDataEdit('text')!.target
    expect(original.project).toBe(h.bridge.read().project)
    expect(publicCapture).not.toHaveBeenCalled()
    expect(ownedCapture).toHaveBeenCalledOnce()
    slice.updateSlideDataDraft({ title: 'first' }, false)
    await slice.commitSlideContentInput()
    const accepted = state.slideContentEdit!.target
    expect(accepted.project).not.toBe(original.project)
    expect(accepted.project.definitions).toBe(original.project.definitions)
    expect(accepted.project.rootIds).toBe(original.project.rootIds)
    expect(accepted.project.instances[rootId]).toBe(original.project.instances[rootId])
    expect(accepted.resources).toBe(original.resources)
    expect(original.project.instances.text.data).toEqual({ title: 'old' })
    slice.updateSlideDataDraft({ title: 'latest' }, false)
    await slice.commitSlideContentInput()
    expect(h.model().project.instances.text.data).toEqual({ title: 'latest' })
    expect(publicCapture).not.toHaveBeenCalled()
    expect(ownedCapture).toHaveBeenCalledOnce()
    await slice.commitTextEdit()
    expect(h.operations).toHaveLength(2)
  } finally { publicCapture.mockRestore(); h.kernel.captureOwnedTarget = captureOwned; h.bridge.dispose() }
})
