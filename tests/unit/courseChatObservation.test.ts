import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createSortComponentPackage } from '@/renderer/recipes/sort-component/package'
import { buildFlowEditorView } from '@/renderer/course/flowEditorView'
import { createCourseAuthoringSession, updateCourseAuthoringSessionRevision } from '@/renderer/authoring/courseAuthoringSession'
import { createCourseChatObservation } from '@/renderer/ui/chat/courseChatObservation'
import { GenerationTaskController } from '@/renderer/authoring/generation/generationTaskController'
import type { DesktopAPI } from '@/shared/ipcTypes'
import { generationCommitReceiptSchema, MAX_GENERATION_TASK_DURATION_MS, type GenerationRequest } from '@/shared/generationContract'

// Observation transport is a unit port; snapshot generation and target construction are real.
const h = vi.hoisted(() => ({ state: undefined as any, capture: vi.fn(), activate: vi.fn(), inspect: vi.fn(), prepare: vi.fn(),
  listeners: new Set<() => void>(), bindings: new Map<string, { committed(receipt: unknown): void }>(), registeredDraft: '[]' }))
vi.mock('@/renderer/store/editorStore', () => ({
  useEditorStore: { getState: () => h.state, subscribe: (listener: () => void) => { h.listeners.add(listener); return () => h.listeners.delete(listener) } },
  selectActiveCourseProjectDocument: (state: any) => state.document,
  selectEffectiveLayerProjection: () => null,
  selectMediaAssetFiles: (state: any) => state.assetFiles,
}))
vi.mock('@/renderer/authoring/generation/authoringObservation', async importOriginal => ({
  ...(await importOriginal<typeof import('@/renderer/authoring/generation/authoringObservation')>()),
  readAuthoringObservationDraftState: () => h.registeredDraft,
  createAuthoringObservationController: () => ({ capture: h.capture, prepareForEdit: h.prepare, dispose() {} }),
}))
vi.mock('@/renderer/authoring/generation/generationImageDiagnostics', async importOriginal => ({
  ...(await importOriginal<typeof import('@/renderer/authoring/generation/generationImageDiagnostics')>()),
  createGenerationImageSourceInspector: () => h.inspect,
}))
beforeEach(() => { vi.clearAllMocks(); h.listeners.clear(); h.bindings.clear(); h.registeredDraft = '[]'; h.inspect.mockImplementation(async request => request) })
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
  h.state = { document, projectPath: owner.projectPath, assetFiles: {}, componentPackages: {}, activateCourseLocation: h.activate,
    bindGenerationTaskRequest: (request: GenerationRequest, ports: { committed(receipt: unknown): void }) => h.bindings.set(request.requestId, ports),
    releaseGenerationTaskRequest: (id: string) => h.bindings.delete(id), isGenerationTaskCommitting: () => false,
    courseAuthoringSession: createCourseAuthoringSession({ locationId: document.startLocationId, surfaceType: 'flow', revision: 0, itemIds: ['old-selection'] }) }
  h.capture.mockImplementation(async (input?: { target?: { locationId: string } }) => {
    const document = h.state.document, session = h.state.courseAuthoringSession
    const location = document.locations.find((value: { id: string }) => value.id === (input?.target?.locationId ?? session.token.locationId))!
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
  it('keeps a newly committed Flow heading inside the frozen document without widening feedback destinations', async () => {
    const { bridge, input } = fixture(), first = await bridge.capture({ ...input, scope: 'page' })
    const document = h.state.document, surface = document.surfaces[0]
    surface.blocks.push({ type: 'heading', id: 'new-heading', level: 2, text: '新小节' })
    document.locations.push({ id: 'new-heading', kind: 'flow-block', blockId: 'new-heading', surfaceId: surface.id, label: '新小节' })
    document.revision = 1
    const created = buildFlowEditorView({ project: document, locationId: document.startLocationId }).blocks.find(block => block.blockId === 'new-heading')!
    const receipt = generationCommitReceiptSchema.parse({ version: 1, requestId: first.requestId, candidateId: crypto.randomUUID(), workspace: input.workspace,
      status: 'committed', beforeRevision: 0, afterRevision: 1, affected: [{ id: 'new-heading', operation: 'created', ownerKey: `surface:${surface.id}`, authoringAddress: created.authoringAddress }], resources: { assetIds: [], packageIds: [] } })
    h.bindings.get(first.requestId)!.committed(receipt)
    const next = await bridge.captureNext(first, receipt)
    expect((next.context as any).pages).toHaveLength(1)
    expect((next.context as any).pages[0].blocks.some((row: any) => row.block.id === 'new-heading')).toBe(true)
    expect(next.destinations.every(destination => document.locations.some((location: { id: string }) => location.id === (destination.kind === 'update' ? destination.target.locationId : destination.scope.locationId)))).toBe(true)
    const stable = (destination: GenerationRequest['destinations'][number]) => {
      const { documentRevision: _revision, sessionGeneration: _generation, revisionPolicy: _policy, ...identity } = destination.kind === 'update' ? destination.target : destination.scope
      return JSON.stringify({ kind: destination.kind, ...identity })
    }
    const allowed = new Set(first.destinations.map(stable))
    expect(next.destinations.every(destination => allowed.has(stable(destination)) || destination.kind === 'update' && destination.target.itemId === 'new-heading')).toBe(true)
    bridge.dispose()
  })

  it('hands a rejected controller stage through real request retirement and binding before the next native turn', async () => {
    const { bridge, input, api } = fixture()
    const initial = await bridge.capture(input), sessionId = crypto.randomUUID()
    let active = initial, turns = 0
    const prepare = vi.fn(), apply = vi.fn()
    vi.mocked(api.localAgent).mockImplementation(async request => {
      if (request.operation === 'file-status') return { enabled: true, fileStatus: { status: 'current', message: 'current' } }
      if (request.operation === 'generate' || request.operation === 'continue') {
        active = request.request; turns++
        if (turns === 2) { expect(bridge.isCurrent(initial)).toBe(false); expect(bridge.isCurrent(active)).toBe(true) }
        return { enabled: true, sessionId }
      }
      if (request.operation === 'read') return { enabled: true, records: [{ version: 1, id: sessionId, adapter: 'codex', workspace: input.workspace, status: 'completed', events: [] }] }
      if (request.operation === 'candidate') return { enabled: true, generationResult: turns === 1
        ? { kind: 'candidate-format-error', requestId: active.requestId, finding: '受控失败：背景接口需要改用合法路径', excerpt: '{}' }
        : { kind: 'answer', requestId: active.requestId } }
      if (request.operation === 'host-result') return { enabled: true }
      throw new Error(`Unexpected ${request.operation}`)
    })
    const controller = new GenerationTaskController({ api, owner: { projectId: input.workspace.projectId, projectPath: 'C:/chat-unit.h5lesson' },
      isCurrent: bridge.isCurrent, currentReason: bridge.currentReason, captureNext: bridge.captureNext, prepare, apply, discard: vi.fn(), onView: vi.fn() })
    await controller.start(initial, 'codex')
    expect(turns).toBe(2)
    expect(controller.current).toMatchObject({ busy: false, phase: 'completed', error: undefined })
    expect(prepare).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled()
    bridge.dispose()
  })
  it('recovers the original goal and frozen page after browsing while taking a fresh revision without importing receipts', async () => {
    const { bridge, input, moveToCurrent } = fixture()
    const first = await bridge.capture(input)
    bridge.invalidate(); moveToCurrent()
    const recovered = await bridge.captureRecovery(first, '继续')
    expect(recovered.instruction).toContain(input.instruction)
    expect(recovered.instruction).toContain('用户明确继续：继续')
    expect(recovered.observation?.locationId).toBe(first.observation?.locationId)
    expect(recovered.documentRevision).toBe(1)
    expect(recovered.context).toMatchObject({ previousResult: null })
    expect(bridge.isCurrent(first)).toBe(false)
    expect(bridge.isCurrent(recovered)).toBe(true)
    expect(h.prepare).toHaveBeenCalledTimes(1)
    bridge.dispose()
  })
  it.each(['stop', 'draft', 'revision', 'workspace'] as const)('rejects real bridge handoff invalidated by %s without launching another turn or binding its late observation', async invalidation => {
    vi.useFakeTimers()
    const { bridge, input, api } = fixture(), initial = await bridge.capture(input), wait = deferred<Awaited<ReturnType<typeof h.capture>>>()
    const original = h.capture.getMockImplementation()!
    const late = await original()
    h.capture.mockImplementation(() => wait.promise)
    let turns = 0
    const sessionId = crypto.randomUUID()
    vi.mocked(api.localAgent).mockImplementation(async request => {
      if (request.operation === 'file-status') return { enabled: true, fileStatus: { status: 'current', message: 'current' } }
      if (request.operation === 'generate' || request.operation === 'continue') { turns++; return { enabled: true, sessionId } }
      if (request.operation === 'read') return { enabled: true, records: [{ version: 1, id: sessionId, adapter: 'codex', workspace: input.workspace, status: 'completed', events: [] }] }
      if (request.operation === 'candidate') return { enabled: true, generationResult: { kind: 'candidate-format-error', requestId: initial.requestId, finding: '受控失败', excerpt: '{}' } }
      if (request.operation === 'host-result' || request.operation === 'cancel') return { enabled: true }
      throw new Error(`Unexpected ${request.operation}`)
    })
    const apply = vi.fn(), controller = new GenerationTaskController({ api, owner: { projectId: input.workspace.projectId, projectPath: 'C:/chat-unit.h5lesson' },
      isCurrent: bridge.isCurrent, currentReason: bridge.currentReason, captureNext: bridge.captureNext, prepare: vi.fn(), apply, discard: vi.fn(), onView: vi.fn() })
    const running = controller.start(initial, 'codex')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.capture).toHaveBeenCalledTimes(2)
    if (invalidation === 'stop') { bridge.invalidate(); await controller.stop() }
    if (invalidation === 'draft') h.registeredDraft = 'new teacher draft'
    if (invalidation === 'revision') h.state.document = { ...h.state.document, revision: 1 }
    if (invalidation === 'workspace') h.state.projectPath = 'C:/other.h5lesson'
    await vi.advanceTimersByTimeAsync(100); await running
    expect(controller.current.phase).toBe(invalidation === 'stop' ? 'cancelled' : 'failed')
    wait.resolve(late); await vi.advanceTimersByTimeAsync(0)
    expect(turns).toBe(1)
    expect(bridge.isCurrent(initial)).toBe(false)
    expect(apply).not.toHaveBeenCalled()
    bridge.dispose()
  })
  it('refuses recovery with missing historical scope or a different workspace', async () => {
    const { bridge, input } = fixture(), first = await bridge.capture(input)
    await expect(bridge.captureRecovery({ ...first, context: {} }, '继续')).rejects.toThrow('旧记录缺少原引用范围')
    await expect(bridge.captureRecovery({ ...first, workspace: { ...first.workspace, normalizedPath: 'c:/other.h5lesson' } }, '继续')).rejects.toThrow('原任务不属于当前工程')
    bridge.dispose()
  })
  it('restores a historical selected Component from snapshot rows without treating its package dependency as another selected item', async () => {
    const f = fixture(), document = createBlankCourseProject({ id: f.input.workspace.projectId, includeDefaultController: false, controls: 'none' }), pkg = createSortComponentPackage()
    const surface = document.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('Expected slide')
    surface.scenes[0]!.layerItems.push({ kind: 'component', layerItemId: 'selected-component', label: 'Selected component', order: 0,
      frame: { mode: 'absolute', x: 50, y: 60, width: 400, height: 300 }, visible: true, locked: false, rotation: 0, opacity: 1,
      hitPolicy: 'auto', playbackInitialVisibility: 'inherit', component: { packageId: pkg.manifest.id, version: pkg.manifest.version }, props: {} })
    document.componentPackages[pkg.manifest.id] = pkg.metadata
    h.state.document = document; h.state.componentPackages = { [pkg.manifest.id]: pkg }
    h.state.courseAuthoringSession = createCourseAuthoringSession({ locationId: document.startLocationId, surfaceType: 'slide', revision: 0, itemIds: ['selected-component'] })
    const first = await f.bridge.capture(f.input)
    expect(first.destinations.some(value => value.kind === 'update' && value.target.itemId === pkg.manifest.id)).toBe(true)
    f.bridge.dispose()
    const reopened = createCourseChatObservation(f.api, { projectId: document.id, projectPath: 'C:/chat-unit.h5lesson' })
    const next = await reopened.captureRecovery(first, '继续')
    expect(next.destinations.some(value => value.kind === 'update' && value.target.itemId === 'selected-component')).toBe(true)
    expect((next.context as any).pages[0].items.map((row: any) => [row.item.layerItemId, row.selected])).toEqual([['selected-component', true]])
    reopened.dispose()
  })
  it.each(['selection', 'page'] as const)('recovers the selected replacement in the latest %s snapshot after a committed stage', async scope => {
    const { bridge, input } = fixture(), first = await bridge.capture({ ...input, scope })
    const surface = h.state.document.surfaces[0]
    surface.blocks = surface.blocks.map((block: any) => block.id === 'old-selection' ? { id: 'replacement-content', type: 'paragraph', text: '替换后的正文' } : block)
    h.state.document.revision = 1
    const oldTarget = first.destinations.find(value => value.kind === 'update' && value.target.itemId === 'old-selection')!
    if (oldTarget.kind !== 'update') throw new Error('Expected target')
    const replacement = buildFlowEditorView({ project: h.state.document, locationId: h.state.document.startLocationId }).blocks.find(block => block.blockId === 'replacement-content')!
    const receipt = generationCommitReceiptSchema.parse({ version: 1, requestId: first.requestId, candidateId: crypto.randomUUID(), workspace: input.workspace,
      status: 'committed', beforeRevision: 0, afterRevision: 1, affected: [{ id: 'old-selection', operation: 'deleted', ownerKey: oldTarget.target.ownerKey, authoringAddress: oldTarget.target.authoringAddress },
        { id: 'replacement-content', operation: 'created', ownerKey: oldTarget.target.ownerKey, authoringAddress: replacement.authoringAddress }], resources: { assetIds: [], packageIds: [] } })
    h.bindings.get(first.requestId)!.committed(receipt)
    const next = await bridge.captureNext(first, receipt)
    const recovered = await bridge.captureRecovery(next, '继续')
    expect((recovered.context as any).pages[0].blocks.filter((row: any) => row.selected).map((row: any) => row.block.id)).toEqual(['replacement-content'])
    expect(recovered.context).toMatchObject({ previousResult: null })
    expect(bridge.isCurrent(first)).toBe(false)
    bridge.dispose()
  })
  it('binds receipts only to the current feedback capture and clears them for a later user request', async () => {
    const { bridge, input } = fixture()
    const first = await bridge.capture(input)
    expect(first.context).toMatchObject({ previousResult: null })
    h.state.document.revision = 1
    h.state.courseAuthoringSession = updateCourseAuthoringSessionRevision(h.state.courseAuthoringSession, 1)
    const receipt = generationCommitReceiptSchema.parse({ version: 1, requestId: first.requestId,
      candidateId: '8e5bd85d-5c65-4ba5-b1d8-e265e159d9af', workspace: input.workspace, status: 'committed',
      beforeRevision: 0, afterRevision: 1, affected: [], resources: { assetIds: [], packageIds: [] } })
    h.bindings.get(first.requestId)!.committed(receipt)
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
    expect(current.destinations[0]).toMatchObject({ kind: 'update', target: { itemId: 'current-selection' } })
    expect(current.destinations.some(value => value.kind === 'update' && value.target.itemId === 'old-selection')).toBe(true)
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
    expect(h.capture).toHaveBeenLastCalledWith(expect.objectContaining({ intent: 'discuss', prepareDrafts: false }))
    expect(current.instruction).toMatch(/明确改变目标时以最新输入为准[\s\S]*不要修改，只和我讨论配色$/)
    expect(h.activate).not.toHaveBeenCalled()
  })
})

describe('chat observation preparation lifecycle', () => {
  it('freezes the original target before file preparation and permits browsing and selecting another page', async () => {
    const { bridge, input, later, api } = fixture(), target = bridge.freezeTarget(), delayed = deferred<any>()
    vi.mocked(api.localAgent).mockImplementationOnce(() => delayed.promise)
    const pending = bridge.capture({ ...input, target })
    h.state.courseAuthoringSession = createCourseAuthoringSession({ locationId: later.startLocationId, surfaceType: 'flow', revision: 0, itemIds: ['current-selection'] })
    for (const listener of h.listeners) listener()
    delayed.resolve({ enabled: true, fileStatus: { status: 'current' } })
    const request = await pending
    expect(request.observation?.locationId).toBe(target.locationId)
    expect(request.destinations[0]).toMatchObject({ kind: 'update', target: { itemId: 'old-selection' } })
    expect(bridge.isCurrent(request)).toBe(true)
    const next = await bridge.captureNext(request)
    expect(next.observation?.locationId).toBe(target.locationId)
    expect(h.capture).toHaveBeenLastCalledWith(expect.objectContaining({ target, prepareDrafts: false }))
    expect(h.prepare).toHaveBeenCalledTimes(1)
    expect(h.activate).not.toHaveBeenCalled()
  })

  it.each(['initial', 'repair', 'after-receipt'] as const)('rejects another page image during %s instead of combining it with frozen structure', async stage => {
    const { bridge, input, later } = fixture(), target = bridge.freezeTarget()
    const first = stage === 'initial' ? undefined : await bridge.capture({ ...input, target })
    let receipt: ReturnType<typeof generationCommitReceiptSchema.parse> | undefined
    if (stage === 'after-receipt') {
      h.state.document.revision = 1
      receipt = generationCommitReceiptSchema.parse({ version: 1, requestId: first!.requestId, candidateId: crypto.randomUUID(),
        workspace: input.workspace, status: 'committed', beforeRevision: 0, afterRevision: 1, affected: [], resources: { assetIds: [], packageIds: [] } })
      h.bindings.get(first!.requestId)!.committed(receipt)
    }
    h.state.courseAuthoringSession = createCourseAuthoringSession({ locationId: later.startLocationId, surfaceType: 'flow', revision: h.state.document.revision, itemIds: ['current-selection'] })
    const captureCurrentPage = h.capture.getMockImplementation()!
    h.capture.mockImplementationOnce(() => captureCurrentPage())
    await expect(first ? bridge.captureNext(first, receipt) : bridge.capture({ ...input, target })).rejects.toThrow('结构与画面的位置或呈现状态不一致')
    expect(h.activate).not.toHaveBeenCalled()
    expect(h.prepare).toHaveBeenCalledTimes(stage === 'initial' ? 0 : 1)
  })

  it.each(['v9ContentEdit', 'flowTextEdit', 'spatialContentEdit', 'previewBackgroundColor'] as const)('permanently invalidates on %s changes while preserving the teacher draft', async field => {
    const { bridge, input } = fixture(), request = await bridge.capture(input)
    const draft = { kind: field === 'flowTextEdit' ? 'chart' : 'formula', source: '教师草稿', composing: true }
    h.state[field] = draft
    for (const listener of h.listeners) listener()
    expect(bridge.currentReason(request)).toContain('当前草稿已保留')
    expect(h.state[field]).toBe(draft)
    h.state[field] = null
    expect(bridge.isCurrent(request)).toBe(false)
    expect(h.prepare).toHaveBeenCalledTimes(1)
  })

  it('ends a hanging observation promptly when a registered local IME draft changes', async () => {
    vi.useFakeTimers()
    const { bridge, input } = fixture(), delayed = deferred<any>()
    h.capture.mockImplementationOnce(() => delayed.promise)
    const pending = bridge.capture(input).catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    h.registeredDraft = JSON.stringify([{ value: '尚未确认的输入法文字', composing: true }])
    await vi.advanceTimersByTimeAsync(100)
    expect(await pending).toMatchObject({ message: expect.stringContaining('当前草稿已保留') })
    expect(h.registeredDraft).toContain('尚未确认')
    expect(h.prepare).toHaveBeenCalledTimes(1)
    expect(h.bindings.size).toBe(0)
  })

  it.each(['document', 'resources', 'save-as', 'close'] as const)('rejects %s changes before starting the frozen observation', async change => {
    const { bridge, input } = fixture(), target = bridge.freezeTarget()
    if (change === 'document') h.state.document = { ...h.state.document, revision: 1 }
    if (change === 'resources') h.state.assetFiles = { image: new Uint8Array([9]) }
    if (change === 'save-as') h.state.projectPath = 'C:/another.h5lesson'
    if (change === 'close') h.state.courseAuthoringSession = null
    for (const listener of h.listeners) listener()
    await expect(bridge.capture({ ...input, target })).rejects.toThrow('stale：')
    expect(h.capture).not.toHaveBeenCalled()
  })

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

  it('does not revive an old target with a supplied receipt after a changed document and failed fresh capture', async () => {
    const { bridge, input, moveToCurrent } = fixture()
    const first = await bridge.capture(input)
    moveToCurrent()
    h.inspect.mockRejectedValueOnce(new Error('图片预检失败'))
    await expect(bridge.capture({ ...input, instruction: '不能保存的失败任务' })).rejects.toThrow('图片预检失败')
    const receipt = generationCommitReceiptSchema.parse({ version: 1, requestId: first.requestId,
      candidateId: '8e5bd85d-5c65-4ba5-b1d8-e265e159d9af', workspace: input.workspace, status: 'committed',
      beforeRevision: 0, afterRevision: 1, affected: [], resources: { assetIds: [], packageIds: [] } })
    await expect(bridge.captureNext(first, receipt)).rejects.toThrow('缺少本任务的实际提交回执')
    expect(bridge.isCurrent(first)).toBe(false)
  })

  it('retains successfully tracked created locations after a later capture fails', async () => {
    const { bridge, input, later } = fixture()
    const first = await bridge.capture({ ...input, scope: 'page' })
    h.state.document.revision = 1
    h.state.courseAuthoringSession = updateCourseAuthoringSessionRevision(h.state.courseAuthoringSession, 1)
    const receipt = generationCommitReceiptSchema.parse({ version: 1, requestId: first.requestId,
      candidateId: '8e5bd85d-5c65-4ba5-b1d8-e265e159d9af', workspace: input.workspace, status: 'committed',
      beforeRevision: 0, afterRevision: 1, affected: [{ operation: 'created', id: later.startLocationId, ownerKey: 'global', authoringAddress: `locations/${later.startLocationId}` }], resources: { assetIds: [], packageIds: [] } })
    h.bindings.get(first.requestId)!.committed(receipt)
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
