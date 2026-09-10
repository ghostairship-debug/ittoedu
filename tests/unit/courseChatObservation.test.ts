import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createCourseAuthoringSession, updateCourseAuthoringSessionRevision } from '@/renderer/authoring/courseAuthoringSession'
import { createCourseChatObservation } from '@/renderer/ui/chat/courseChatObservation'
import type { DesktopAPI } from '@/shared/ipcTypes'
import { generationCommitReceiptSchema, MAX_GENERATION_TASK_DURATION_MS, type GenerationRequest } from '@/shared/generationContract'

// Observation transport is a unit port; snapshot generation and target construction are real.
const h = vi.hoisted(() => ({ state: undefined as any, capture: vi.fn(), activate: vi.fn(), inspect: vi.fn() }))
vi.mock('@/renderer/store/editorStore', () => ({
  useEditorStore: { getState: () => h.state },
  selectActiveCourseProjectDocument: (state: any) => state.document,
  selectEffectiveLayerProjection: () => null,
  selectMediaAssetFiles: () => ({}),
}))
vi.mock('@/renderer/authoring/generation/authoringObservation', () => ({
  createAuthoringObservationController: () => ({ capture: h.capture, dispose() {} }),
}))
vi.mock('@/renderer/authoring/generation/generationImageDiagnostics', async importOriginal => ({
  ...(await importOriginal<typeof import('@/renderer/authoring/generation/generationImageDiagnostics')>()),
  createGenerationImageSourceInspector: () => h.inspect,
}))
beforeEach(() => { vi.clearAllMocks(); h.inspect.mockImplementation(async request => request) })
afterEach(() => vi.useRealTimers())
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

function fixture() {
  const document = createBlankFlowCourseProject(), later = createBlankFlowCourseProject()
  document.surfaces.push(...later.surfaces); document.locations.push(...later.locations)
  const first = document.surfaces[0]!, second = document.surfaces[1]!
  if (first.type !== 'flow' || second.type !== 'flow') throw new Error('Flow required')
  first.blocks.push({ type: 'paragraph', id: 'old-selection', text: '旧正文' })
  second.blocks.push({ type: 'paragraph', id: 'current-selection', text: '手改后的正文' })
  const owner = { projectId: document.id, projectPath: 'C:/chat-unit.h5lesson' }
  h.state = { document, projectPath: owner.projectPath, componentPackages: {}, activateCourseLocation: h.activate,
    courseAuthoringSession: createCourseAuthoringSession({ locationId: document.startLocationId, surfaceType: 'flow', revision: 0, itemIds: ['old-selection'] }) }
  h.capture.mockImplementation(async () => {
    const session = h.state.courseAuthoringSession, location = document.locations.find(value => value.id === session.token.locationId)!
    return { document, resourceFiles: [], observation: { documentRevision: document.revision,
      sessionGeneration: session.token.generation, draftEpoch: 0, viewEpoch: 0, runtime: null,
      surfaceId: location.surfaceId, locationId: location.id, stateId: null, source: 'authoring', capturedAt: 1,
      files: [{ fileId: 'current-frame', relativePath: 'frame.png', mediaType: 'image/png', byteLength: 1, role: 'image' }] } }
  })
  const api = { localAgent: vi.fn(async () => ({ enabled: true, fileStatus: { status: 'current' } })) } as unknown as DesktopAPI
  const bridge = createCourseChatObservation(api, owner)
  const input = { workspace: { version: 1 as const, projectId: document.id, normalizedPath: 'c:/chat-unit.h5lesson' },
    scope: 'selection' as const, instruction: '把所选对象改为橙色', purpose: 'local-edit' as const, intent: 'edit' as const }
  function moveToCurrent() {
    document.revision = 1
    h.state.courseAuthoringSession = createCourseAuthoringSession({ locationId: later.startLocationId, surfaceType: 'flow', revision: 1, itemIds: ['current-selection'] })
  }
  return { bridge, input, moveToCurrent, later, api }
}

describe('chat observation refresh', () => {
  it('binds receipts only to the current feedback capture and clears them for a later user request', async () => {
    const { bridge, input } = fixture()
    const first = await bridge.capture(input)
    expect(first.context).toMatchObject({ previousResult: null })
    h.state.document.revision = 1
    h.state.courseAuthoringSession = updateCourseAuthoringSessionRevision(h.state.courseAuthoringSession, 1)
    const receipt = generationCommitReceiptSchema.parse({ version: 1, requestId: first.requestId,
      candidateId: '8e5bd85d-5c65-4ba5-b1d8-e265e159d9af', workspace: input.workspace, status: 'committed',
      beforeRevision: 0, afterRevision: 1, affected: [], resources: { assetIds: [], packageIds: [] } })
    const feedback = await bridge.captureNext(first, receipt)
    expect(feedback.context).toMatchObject({ previousResult: receipt })
    const next = await bridge.capture({ ...input, instruction: '再调整当前内容' })
    expect(next.context).toMatchObject({ previousResult: null })
    expect(next.documentRevision).toBe(1)
  })
  it('preserves original and accepted instructions while capturing the current Owner location, selection and revision', async () => {
    const { bridge, input, moveToCurrent, later } = fixture()
    await bridge.capture(input)
    bridge.rememberUserInput('保留文字内容')
    bridge.rememberUserInput('取消橙色，改为蓝色')
    moveToCurrent()
    const current = await bridge.refreshFromUser('位置以我现在手改后的为准', 'edit')
    expect(current.instruction).toContain(input.instruction)
    expect(current.instruction).toContain('保留文字内容')
    expect(current.instruction).toContain('取消橙色，改为蓝色')
    expect(current.instruction).toMatch(/仅更新引用不撤销原任务[\s\S]*位置以我现在手改后的为准$/)
    expect(current.documentRevision).toBe(1)
    expect(current.observation?.locationId).toBe(later.startLocationId)
    expect(current.destinations.filter(value => value.kind === 'update').map(value => value.target.itemId)).toEqual(['current-selection'])
    expect(JSON.stringify(current.context)).toContain('手改后的正文')
    expect(JSON.stringify(current.context)).not.toContain('旧正文')
    expect(h.activate).not.toHaveBeenCalled()
  })
  it('retains the resolved discussion boundary when the user replaces the editing request', async () => {
    const { bridge, input, moveToCurrent } = fixture()
    await bridge.capture(input); moveToCurrent()
    const current = await bridge.refreshFromUser('不要修改，只和我讨论配色', 'discuss')
    expect(current.intent).toBe('discuss')
    expect(current.expectedResult).toBe('auto')
    expect(h.capture).toHaveBeenLastCalledWith({ intent: 'discuss' })
    expect(current.instruction).toMatch(/明确改变目标时以最新输入为准[\s\S]*不要修改，只和我讨论配色$/)
    expect(h.activate).not.toHaveBeenCalled()
  })
})

describe('chat observation preparation lifecycle', () => {
  it('expires a hanging capture without binding its late result and permits a fresh capture', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const { bridge, input } = fixture()
    const nativeCapture = h.capture.getMockImplementation()!, delayed = deferred<any>()
    const lateValue = await nativeCapture()
    h.capture.mockImplementationOnce(() => delayed.promise)
    const pending = bridge.capture(input).catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.capture).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(MAX_GENERATION_TASK_DURATION_MS)
    expect(await pending).toMatchObject({ message: expect.stringContaining('20分钟执行期限已到') })
    expect(() => bridge.instructionWithUserInput('继续')).toThrow('当前任务引用已关闭')
    delayed.resolve(lateValue)
    await vi.advanceTimersByTimeAsync(0)
    expect(() => bridge.instructionWithUserInput('继续')).toThrow('当前任务引用已关闭')
    const fresh = await bridge.capture({ ...input, instruction: '新的任务' })
    expect(fresh.instruction).toBe('新的任务')
    expect(fresh.execution?.startedAt).toBe(1000 + MAX_GENERATION_TASK_DURATION_MS)
  })

  it.each(['file-status', 'capture', 'inspection'] as const)('ignores a superseded late %s result without overwriting the new task', async stage => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const { bridge, input, api } = fixture()
    const delayed = deferred<any>()
    let lateValue: any
    if (stage === 'file-status') {
      lateValue = { enabled: true, fileStatus: { status: 'current' } }
      vi.mocked(api.localAgent).mockImplementationOnce(() => delayed.promise)
    } else if (stage === 'capture') {
      lateValue = await h.capture.getMockImplementation()!()
      h.capture.mockImplementationOnce(() => delayed.promise)
    } else h.inspect.mockImplementationOnce(request => { lateValue = request; return delayed.promise })
    const old = bridge.capture({ ...input, instruction: '旧的任务' }).catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    const fresh = await bridge.capture({ ...input, instruction: '新的任务' })
    expect(await old).toMatchObject({ message: expect.stringContaining('任务已停止或重新开始') })
    delayed.resolve(lateValue)
    await vi.advanceTimersByTimeAsync(0)
    expect(bridge.instructionWithUserInput('继续')).toContain('新的任务')
    expect(bridge.instructionWithUserInput('继续')).not.toContain('旧的任务')
    const feedback = await bridge.captureNext(fresh)
    expect(feedback.instruction).toBe('新的任务')
  })

  it('invalidates a stopped capture immediately without permanently disposing the observation bridge', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const { bridge, input } = fixture()
    const delayed = deferred<any>(), lateValue = await h.capture.getMockImplementation()!()
    h.capture.mockImplementationOnce(() => delayed.promise)
    const old = bridge.capture({ ...input, instruction: '已停止的任务' }).catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    bridge.invalidate()
    expect(await old).toMatchObject({ message: expect.stringContaining('任务已停止或重新开始') })
    const fresh = await bridge.capture({ ...input, instruction: '停止后的新任务' })
    delayed.resolve(lateValue)
    await vi.advanceTimersByTimeAsync(0)
    expect(fresh.instruction).toBe('停止后的新任务')
    expect(bridge.instructionWithUserInput('继续')).not.toContain('已停止的任务')
  })

  it('keeps the previous selection and location when a new capture fails image inspection', async () => {
    const { bridge, input, moveToCurrent } = fixture()
    const first = await bridge.capture(input)
    moveToCurrent()
    h.inspect.mockRejectedValueOnce(new Error('图片预检失败'))
    await expect(bridge.capture({ ...input, instruction: '不能保存的失败任务' })).rejects.toThrow('图片预检失败')
    const receipt = generationCommitReceiptSchema.parse({ version: 1, requestId: first.requestId,
      candidateId: '8e5bd85d-5c65-4ba5-b1d8-e265e159d9af', workspace: input.workspace, status: 'committed',
      beforeRevision: 0, afterRevision: 1, affected: [], resources: { assetIds: [], packageIds: [] } })
    const feedback = await bridge.captureNext(first, receipt)
    expect(feedback.instruction).toBe(input.instruction)
    expect(feedback.destinations.filter(value => value.kind === 'update').map(value => value.target.itemId)).toEqual(['old-selection'])
    expect(JSON.stringify(feedback.context)).toContain('旧正文')
    expect(JSON.stringify(feedback.context)).not.toContain('手改后的正文')
  })

  it('retains successfully tracked created locations after a later capture fails', async () => {
    const { bridge, input, later } = fixture()
    const first = await bridge.capture({ ...input, scope: 'page' })
    h.state.document.revision = 1
    h.state.courseAuthoringSession = updateCourseAuthoringSessionRevision(h.state.courseAuthoringSession, 1)
    const receipt = generationCommitReceiptSchema.parse({ version: 1, requestId: first.requestId,
      candidateId: '8e5bd85d-5c65-4ba5-b1d8-e265e159d9af', workspace: input.workspace, status: 'committed',
      beforeRevision: 0, afterRevision: 1, affected: [{ operation: 'created', id: later.startLocationId, ownerKey: 'global', authoringAddress: `locations/${later.startLocationId}` }], resources: { assetIds: [], packageIds: [] } })
    const afterCreation = await bridge.captureNext(first, receipt)
    expect(JSON.stringify(afterCreation.context)).toContain('current-selection')
    h.inspect.mockRejectedValueOnce(new Error('图片预检失败'))
    await expect(bridge.capture({ ...input, scope: 'page', instruction: '不能保存的失败任务' })).rejects.toThrow('图片预检失败')
    const next = await bridge.captureNext(afterCreation)
    expect(next.instruction).toBe(input.instruction)
    expect(JSON.stringify(next.context)).toContain('current-selection')
  })

  it('keeps the original feedback deadline and gives a new user observation a fresh execution budget', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const { bridge, input } = fixture()
    const first = await bridge.capture(input)
    await vi.advanceTimersByTimeAsync(5000)
    const next = await bridge.captureNext(first)
    expect(next.execution).toEqual(first.execution)
    await vi.advanceTimersByTimeAsync(MAX_GENERATION_TASK_DURATION_MS - 5000)
    await expect(bridge.captureNext(next)).rejects.toThrow('20分钟执行期限已到')
    const fresh = await bridge.refreshFromUser('以最新要求继续', 'edit')
    expect(fresh.execution).toEqual({ version: 1, startedAt: Date.now(), deadlineAt: Date.now() + MAX_GENERATION_TASK_DURATION_MS })
    const supplied: NonNullable<GenerationRequest['execution']> = { version: 1, startedAt: Date.now() - 10, deadlineAt: Date.now() + 1000 }
    expect((await bridge.refreshFromUser('再次补充', 'edit', supplied)).execution).toEqual(supplied)
  })
})
