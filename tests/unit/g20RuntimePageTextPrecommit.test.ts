import { beforeEach, expect, it, vi } from 'vitest'

const target = { itemId: 'runtime-1', override: { original: '原文' } }
const updateLegacy = vi.fn()
const submit = vi.fn()
const state = {
  courseDocument: { documentId: 'document-1' },
  captureRuntimeContentTextTarget: vi.fn(() => target),
  submitDynamicFallbackIntent: submit,
  updateRuntimeContentTextAtTarget: updateLegacy,
}
vi.mock('@/renderer/store/editorStore', () => ({
  useEditorStore: { getState: () => state },
  selectActiveCourseProjectDocument: () => ({ id: 'project-1' }),
  selectActiveSceneId: () => 'scene-1',
  selectEditingScope: () => 'scene',
  selectEffectiveLayerProjection: () => ({ locationId: 'location-1', surfaceType: 'slide' }),
}))

const { runtimeLightEditCommands } = await import('@/renderer/composition/runtime/runtimeLightEditCommands')

beforeEach(() => { submit.mockReset(); updateLegacy.mockReset(); state.captureRuntimeContentTextTarget.mockClear() })

it('waits for the combined Main ACK before reporting a page text change', async () => {
  let settle!: (result: { status: 'applied'; receipt: object }) => void
  submit.mockReturnValue({ taskId: 'task-1', settled: new Promise(resolve => { settle = resolve }) })
  const result = runtimeLightEditCommands.setPageText('runtime-1', '原文', '新文')
  expect(submit).toHaveBeenCalledExactlyOnceWith({
    kind: 'runtime.text', documentId: 'document-1', locationId: 'location-1', itemId: 'runtime-1',
    projectId: 'project-1', target, value: '新文',
  })
  expect(updateLegacy).not.toHaveBeenCalled()
  let pending = true
  void result.then(() => { pending = false })
  await Promise.resolve()
  expect(pending).toBe(true)
  settle({ status: 'applied', receipt: {} })
  await expect(result).resolves.toEqual({ ok: true, changed: true })
})

it('reports capture failure without a legacy content commit', async () => {
  submit.mockReturnValue({ taskId: 'task-2', settled: Promise.resolve({ status: 'failed', taskId: 'task-2', reason: '后备图捕获失败' }) })
  await expect(runtimeLightEditCommands.setPageText('runtime-1', '原文', '新文')).resolves.toEqual({ ok: false, reason: '后备图捕获失败' })
  expect(updateLegacy).not.toHaveBeenCalled()
})
