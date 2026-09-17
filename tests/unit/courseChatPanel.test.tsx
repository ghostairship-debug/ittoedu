import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CourseChatPanel } from '@/renderer/ui/chat/CourseChatPanel'
import { GenerationCandidatePreparationError, DEFAULT_GENERATION_TASK_DURATION_MS } from '@/shared/generationContract'
import type { DynamicBehaviorObservation } from '@/shared/dynamicBehaviorObservation'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createCourseAuthoringSession } from '@/renderer/authoring/courseAuthoringSession'
import { createTextNode } from '@/renderer/project/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { selectFlowEditorBlocks, enterFlowTextEditing } from '@/renderer/course/flowEditorSlice'
import { captureGenerationSnapshot } from '@/renderer/authoring/generation/generationSnapshot'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'

// Exercise the real form/send branching with controller and observation unit ports.
// No native CLI, screenshot, live project commit or acceptance is claimed here.
const h = vi.hoisted(() => ({ view: {} as any, onView: undefined as any, capture: vi.fn(), starts: [] as any[], startCalls: [] as any[],
  cumulative: '', terminal: {} as any, current: true, input: vi.fn(), remember: vi.fn(), invalidate: vi.fn(), stop: vi.fn(), store: {} as any,
  controllerPorts: undefined as any, recovery: vi.fn(), captureNext: vi.fn(), freeze: vi.fn(), bridges: [] as any[], controllers: [] as any[] }))
vi.mock('@/renderer/store/editorStore', () => ({
  useEditorStore: Object.assign((selector: any) => selector(h.store), { getState: () => h.store }),
  selectActiveCourseProjectDocument: (state: any) => state.document ?? null,
}))
vi.mock('@/renderer/ui/chat/courseChatObservation', async importOriginal => ({ ...(await importOriginal<typeof import('@/renderer/ui/chat/courseChatObservation')>()), createCourseChatObservation: () => {
  // Observation disposal is terminal in the real port. A remount needs a new owner.
  const bridge = { disposed: false,
  async capture(input: any) {
    if (bridge.disposed) throw new Error('stale：任务已停止或重新开始')
    const result = await h.capture(input)
    if (bridge.disposed) throw new Error('stale：任务已停止或重新开始')
    return result
  },
  isCurrent: () => !bridge.disposed && h.current, currentReason: () => h.current ? null : 'stale：课件已改变',
  captureRecovery: h.recovery, freezeTarget: h.freeze, dispose() { bridge.disposed = true }, invalidate: h.invalidate, fileCurrent() {}, captureNext: h.captureNext,
  instructionWithUserInput: (text: string) => `${h.cumulative}\n\n用户最新输入（优先于此前要求）：${text}`,
  rememberUserInput: (text: string) => { h.remember(text); h.cumulative += `\n${text}` },
  refreshFromUser: async (text: string, intent: string, execution: unknown, target: unknown, scope: unknown) => bridge.capture({ instruction: `${h.cumulative}\n${text}`, intent, execution, target, scope }),
  }
  h.bridges.push(bridge)
  return bridge
} }))
vi.mock('@/renderer/authoring/generation/generationTaskController', () => ({ GenerationTaskController: class {
  constructor(ports: any) { h.onView = ports.onView; h.controllerPorts = ports; h.controllers.push(ports) }
  get current() { return h.view }
  async start(request: any, adapter: any, resumeId?: string, userMessage?: string) {
    h.starts.push(request)
    h.startCalls.push({ request, adapter, resumeId, userMessage })
    h.view = { busy: false, phase: 'failed', error: 'stale：工程或任务已改变，未应用的修改已丢弃', notice: '', events: [],
      request, sessionId: 'native-session', record: { id: 'native-session', adapter: 'claude', status: 'completed', events: [],
        task: { taskId: 'task-1', epoch: 1, turnId: 'turn-1' } }, ...h.terminal }
    if (h.view.record && !h.view.record.generationRequest) h.view.record.generationRequest = request
    h.current = false; h.onView(h.view)
  }
  async input(input: any, options?: any) { return h.input(input, options) }
  async stop() { await h.stop() }
} }))
beforeEach(() => {
  vi.clearAllMocks(); h.starts = []; h.startCalls = []; h.cumulative = ''; h.terminal = {}; h.current = true; h.store = {}; h.view = {}; h.controllerPorts = undefined; h.bridges = []; h.controllers = []
  h.input.mockResolvedValue({ status: 'accepted' })
  h.stop.mockResolvedValue(undefined)
  h.captureNext.mockResolvedValue(undefined)
  h.recovery.mockImplementation(async (previous, text, execution) => ({ ...previous, instruction: `${previous.instruction}\n用户明确继续：${text}`, execution, context: { reference: 'page' } }))
  h.freeze.mockImplementation(() => ({ anchorId: 'send-time-target', locationId: h.store.courseAuthoringSession?.token.locationId ?? 'location',
    surfaceId: h.store.document?.surfaces[0]?.id ?? 'surface', stateId: null,
    selectedIds: [...(h.store.courseAuthoringSession?.itemIds ?? [])], sessionToken: { ...h.store.courseAuthoringSession?.token } }))
  h.capture.mockImplementation(async (input: any) => { h.cumulative = input.instruction; return { ...input, requestId: `request-${h.starts.length}`, destinations: [] } })
  window.desktopAPI = { localAgent: vi.fn(async (input: any) => input.operation === 'workspace'
    ? { enabled: true, workspace: { version: 1, projectId: 'chat-unit', normalizedPath: 'c:/chat.h5lesson' } }
    : input.operation === 'read' ? { records: [{ id: 'native-session', workspace: { version: 1, projectId: 'chat-unit', normalizedPath: 'c:/chat.h5lesson' }, externalSessionId: 'confirmed-native' }] } : { records: [] }),
  materials: vi.fn(async () => []), loadComponentCatalog: vi.fn(async () => ({ packages: [] })) } as any
})
afterEach(() => { cleanup(); vi.useRealTimers() })
async function send(text: string, count: number) {
  fireEvent.change(screen.getByLabelText('发送给创作助手'), { target: { value: text } })
  fireEvent.submit(screen.getByLabelText('发送给创作助手').closest('form')!)
  await waitFor(() => expect(h.starts).toHaveLength(count))
}
function mount() { return render(<CourseChatPanel projectId="chat-unit" projectPath="C:/chat.h5lesson" onClose={() => {}} />) }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
async function submitPreparation(text: string) {
  fireEvent.change(screen.getByLabelText('发送给创作助手'), { target: { value: text } })
  fireEvent.submit(screen.getByLabelText('发送给创作助手').closest('form')!)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}

describe('chat reference defaults and send-time target', () => {
  it('sends the selected resource budget and displays the authoritative extended deadline', async () => {
    slideFixture(); mount()
    expect(screen.getByLabelText('本次时间预算')).toHaveValue('20')
    fireEvent.change(screen.getByLabelText('本次时间预算'), { target: { value: '60' } })
    await send('把标题改成实验记录', 1)
    const request = h.starts[0]
    expect(request.execution.deadlineAt - request.execution.startedAt).toBe(60 * 60000)
    h.current = true
    const task = { ...h.view.record.task, startedAt: request.execution.startedAt, deadlineAt: request.execution.deadlineAt + 20 * 60000 }
    await act(async () => { h.view = { ...h.view, busy: true, phase: 'running', error: undefined, record: { ...h.view.record, task } }; h.onView(h.view) })
    expect(screen.getByText(/本任务剩余约 80 分钟/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '增加20分钟' }))
    await waitFor(() => expect(h.input).toHaveBeenCalledWith(expect.objectContaining({ kind: 'extend-budget', minutes: 20, taskId: task.taskId, epoch: task.epoch }), { preservePreview: true }))
    expect(h.starts).toHaveLength(1)
    expect(h.stop).not.toHaveBeenCalled()
    expect(screen.getByLabelText('输入用途')).toHaveValue('correct')
  })
  it('captures current lesson documents from the preparation port without requiring duplicated textarea confirmations', async () => {
    slideFixture()
    const original = window.desktopAPI!.localAgent
    const confirmedDocuments = { teachingPlan: '# 当前真实策划', presentationScript: '# 当前真实脚本' }
    window.desktopAPI!.localAgent = vi.fn(async input => input.operation === 'lesson-prepare-generation' ? { enabled: true, lessonGeneration: { confirmedDocuments } } : original(input)) as any
    render(<CourseChatPanel projectId="chat-unit" projectPath="C:/chat.h5lesson" lessonWorkspace={{ version: 1, kind: 'lesson', lessonId: '11111111-1111-4111-8111-111111111111', conversationId: '22222222-2222-4222-8222-222222222222', normalizedDirectory: 'c:/lesson' }} onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText('生成包含多个片段的完整课件'))
    expect(screen.queryByLabelText('教学策划 Markdown')).toBeNull()
    await send('请生成整课', 1)
    expect(h.capture).toHaveBeenCalledWith(expect.objectContaining({ confirmedDocuments, purpose: 'whole-course' }))
    expect(window.desktopAPI!.materials).not.toHaveBeenCalled()
  })
  it('keeps lesson generation input when current file confirmation is rejected before capture', async () => {
    slideFixture()
    const original = window.desktopAPI!.localAgent
    window.desktopAPI!.localAgent = vi.fn(async input => {
      if (input.operation === 'lesson-prepare-generation') throw new Error('教学策划已修改，请重新确认')
      return original(input)
    }) as any
    render(<CourseChatPanel projectId="chat-unit" projectPath="C:/chat.h5lesson" lessonWorkspace={{ version: 1, kind: 'lesson', lessonId: '11111111-1111-4111-8111-111111111111', conversationId: '22222222-2222-4222-8222-222222222222', normalizedDirectory: 'c:/lesson' }} onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText('生成包含多个片段的完整课件'))
    fireEvent.change(screen.getByLabelText('发送给创作助手'), { target: { value: '请生成整课' } })
    fireEvent.submit(screen.getByLabelText('发送给创作助手').closest('form')!)
    await screen.findByText('教学策划已修改，请重新确认')
    expect(screen.getByLabelText('发送给创作助手')).toHaveValue('请生成整课')
    expect(h.capture).not.toHaveBeenCalled(); expect(h.starts).toHaveLength(0)
  })
  function slideFixture() {
    const document = createBlankCourseProject({ id: 'chat-unit' }), surface = document.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('Slide required')
    surface.scenes[0]!.layerItems.push(...['first', 'second'].map((id, index) => sceneNodeToCourseLayerItem(createTextNode({ id, name: `标题${index + 1}` }), index)))
    h.store = { document, courseAuthoringSession: createCourseAuthoringSession({ locationId: document.startLocationId,
      surfaceType: 'slide', revision: document.revision, itemIds: ['first'] }) }
    return document
  }
  const scope = () => (screen.getByLabelText('本轮引用') as HTMLSelectElement).value

  it('blocks sending while model selection is saving and sends once after it succeeds', async () => {
    slideFixture()
    const saved = deferred<any>(), original = window.desktopAPI!.localAgent
    const caps = { version: 1, adapter: 'codex', cliVersion: 'fixture', currentSource: 'native-config',
      models: [{ id: 'astra', label: 'Astra', resolvedModel: 'astra', image: 'supported', effort: { kind: 'supported', values: ['medium', 'xhigh'], default: 'medium' } }],
      current: { model: 'astra', resolvedModel: 'astra', effort: 'xhigh' },
      input: { image: 'supported', readFile: 'supported', question: 'structured', correction: 'active-turn', cancel: 'supported' } }
    window.desktopAPI!.localAgent = vi.fn(async input => input.operation === 'capabilities' ? { enabled: true, capabilities: caps }
      : input.operation === 'configure' ? saved.promise : original(input)) as any
    mount()
    await waitFor(() => expect(screen.getByLabelText('强度')).toHaveValue('xhigh'))
    expect(screen.getByText('新任务原生默认：astra · xhigh')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('强度'), { target: { value: 'medium' } })
    fireEvent.change(screen.getByLabelText('发送给创作助手'), { target: { value: '修改标题' } })
    expect(screen.getByRole('button', { name: '正在保存配置…' })).toBeDisabled()
    fireEvent.submit(screen.getByLabelText('发送给创作助手').closest('form')!)
    expect(h.starts).toHaveLength(0)
    await act(async () => { saved.resolve({ enabled: true, capabilities: { ...caps,
      selectedConfiguration: { model: 'astra', effort: 'medium' }, requestedConfiguration: { model: 'astra', effort: 'medium' } } }) })
    await send('修改标题', 1)
  })

  it('keeps the selected focus while accepting a page background instruction', async () => {
    slideFixture(); mount()
    fireEvent.change(screen.getByLabelText('发送给创作助手'), { target: { value: '帮我在本页插入一个卡通小狗的图片作为背景' } })
    expect(scope()).toBe('selection')
    fireEvent.change(screen.getByLabelText('本轮引用'), { target: { value: 'selection' } })
    expect(screen.queryByText(/指令要求修改本页背景/)).toBeNull()
    await send('帮我在本页插入一个卡通小狗的图片作为背景', 1)
    expect(h.capture).toHaveBeenCalledWith(expect.objectContaining({ scope: 'selection' }))
  })


  it('preserves manual scope through selection changes, clearing and revision changes until the user chooses again', () => {
    const document = slideFixture(), mounted = mount()
    const rerender = () => mounted.rerender(<CourseChatPanel projectId="chat-unit" projectPath="C:/chat.h5lesson" onClose={() => {}} />)
    expect(scope()).toBe('selection')
    expect(screen.getByLabelText('本轮引用摘要')).toHaveTextContent('标题1')
    fireEvent.change(screen.getByLabelText('本轮引用'), { target: { value: 'course' } })
    h.store.document = { ...document, revision: 1 }
    h.store.courseAuthoringSession = { ...h.store.courseAuthoringSession, token: { ...h.store.courseAuthoringSession.token, revision: 1, generation: 9 } }
    rerender()
    fireEvent.focus(screen.getByLabelText('发送给创作助手'))
    fireEvent.change(screen.getByLabelText('发送给创作助手'), { target: { value: '保留我的范围' } })
    fireEvent.focus(screen.getByLabelText('应用方式'))
    fireEvent.blur(window)
    expect(scope()).toBe('course')
    expect(h.store.courseAuthoringSession.itemIds).toEqual(['first'])
    h.store.courseAuthoringSession = { ...h.store.courseAuthoringSession, itemIds: ['second'] }; rerender()
    expect(scope()).toBe('course')
    fireEvent.change(screen.getByLabelText('本轮引用'), { target: { value: 'page' } })
    rerender(); expect(scope()).toBe('page')
    h.store.courseAuthoringSession = { ...h.store.courseAuthoringSession, itemIds: [] }; rerender()
    expect(scope()).toBe('page')
    h.store.courseAuthoringSession = { ...h.store.courseAuthoringSession, itemIds: ['first'] }; rerender()
    expect(scope()).toBe('page')
  })

  it('can send with an empty reference selection because it does not restrict editing', async () => {
    const document = slideFixture(), mounted = mount()
    fireEvent.change(screen.getByLabelText('本轮引用'), { target: { value: 'selection' } })
    h.store.courseAuthoringSession = { ...h.store.courseAuthoringSession, itemIds: [],
      token: { ...h.store.courseAuthoringSession.token, generation: 2 } }
    mounted.rerender(<CourseChatPanel projectId="chat-unit" projectPath="C:/chat.h5lesson" onClose={() => {}} />)
    expect(scope()).toBe('selection')
    expect(screen.getByLabelText('本轮引用摘要')).toHaveTextContent('未选择对象')
    h.capture.mockImplementation(async input => captureGenerationSnapshot({ ...input, document, applyPolicy: 'preview',
      workspace: { version: 1, projectId: 'chat-unit', normalizedPath: 'c:/chat.h5lesson' },
      sessionToken: input.target.sessionToken, selectedIds: input.target.selectedIds,
      projection: projectEffectiveLayers({ project: document, locationId: document.startLocationId }) }))
    fireEvent.change(screen.getByLabelText('发送给创作助手'), { target: { value: '把所选标题改为红色' } })
    fireEvent.submit(screen.getByLabelText('发送给创作助手').closest('form')!)
    await waitFor(() => expect(h.capture).toHaveBeenCalled())
    await expect(h.capture.mock.results[0]!.value).resolves.toBeDefined()
    await waitFor(() => expect(h.starts).toHaveLength(1))
    expect(h.capture).toHaveBeenCalledWith(expect.objectContaining({ scope: 'selection', target: expect.objectContaining({ selectedIds: [] }) }))
    expect(h.starts).toHaveLength(1)
    expect(scope()).toBe('selection')
  })

  it('updates automatic scope when selection clears and resets explicit scope on workspace changes', () => {
    slideFixture(); const mounted = mount()
    expect(scope()).toBe('selection')
    h.store.courseAuthoringSession = { ...h.store.courseAuthoringSession, itemIds: [] }
    mounted.rerender(<CourseChatPanel projectId="chat-unit" projectPath="C:/chat.h5lesson" onClose={() => {}} />)
    expect(scope()).toBe('page')
    fireEvent.change(screen.getByLabelText('本轮引用'), { target: { value: 'selection' } })
    mounted.rerender(<CourseChatPanel projectId="chat-unit" projectPath="C:/saved-as.h5lesson" onClose={() => {}} />)
    expect(scope()).toBe('page')
    h.store.courseAuthoringSession = { ...h.store.courseAuthoringSession, itemIds: ['second'] }
    mounted.rerender(<CourseChatPanel projectId="chat-unit" projectPath="C:/saved-as.h5lesson" onClose={() => {}} />)
    expect(scope()).toBe('selection')
    fireEvent.change(screen.getByLabelText('本轮引用'), { target: { value: 'course' } })
    mounted.rerender(<CourseChatPanel projectId="another-project" projectPath="C:/saved-as.h5lesson" onClose={() => {}} />)
    expect(scope()).toBe('selection')
  })

  it('uses formal Flow body selection while preserving manual scope across text-range changes', async () => {
    const document = createBlankFlowCourseProject({ id: 'chat-unit' }), surface = document.surfaces[0]!
    if (surface.type !== 'flow') throw new Error('Flow required')
    surface.blocks.push({ type: 'paragraph', id: 'paragraph-one', content: { inlines: [{ type: 'text', text: '原生讲义正文' }] } })
    h.store = { document, courseAuthoringSession: createCourseAuthoringSession({ locationId: document.startLocationId,
      surfaceType: 'flow', revision: document.revision, itemIds: ['paragraph-one'] }),
      flowSession: { selection: selectFlowEditorBlocks(document, document.startLocationId, ['paragraph-one']) } }
    const mounted = mount()
    expect(scope()).toBe('selection')
    expect(screen.getByLabelText('本轮引用摘要')).toHaveTextContent('原生讲义正文')
    fireEvent.change(screen.getByLabelText('本轮引用'), { target: { value: 'page' } })
    h.store.flowSession = { selection: enterFlowTextEditing(document, h.store.flowSession.selection, { blockId: 'paragraph-one', start: 0, end: 2 }) }
    mounted.rerender(<CourseChatPanel projectId="chat-unit" projectPath="C:/chat.h5lesson" onClose={() => {}} />)
    expect(scope()).toBe('page')
    fireEvent.change(screen.getByLabelText('本轮引用'), { target: { value: 'selection' } })
    expect(scope()).toBe('selection')
    await send('改写所选正文', 1)
    expect(h.starts[0]).toMatchObject({ scope: 'selection', purpose: 'local-edit', target: { selectedIds: ['paragraph-one'] } })
  })

  it('freezes scope and target before preparation waits and keeps their summary while browsing another selection', async () => {
    const document = slideFixture(), later = createBlankFlowCourseProject()
    document.surfaces.push(...later.surfaces); document.locations.push(...later.locations)
    const delayed = deferred<any>(), api = window.desktopAPI!, localAgent = vi.mocked(api.localAgent), nativeOperate = localAgent.getMockImplementation()!
    localAgent.mockImplementation(input => input.operation === 'workspace' ? delayed.promise : nativeOperate(input))
    h.terminal = { busy: true, phase: 'running', error: undefined }
    const mounted = mount()
    fireEvent.change(screen.getByLabelText('发送给创作助手'), { target: { value: '修改原标题' } })
    fireEvent.submit(screen.getByLabelText('发送给创作助手').closest('form')!)
    expect(h.freeze).toHaveBeenCalledTimes(1)
    h.store.courseAuthoringSession = createCourseAuthoringSession({ locationId: later.startLocationId, surfaceType: 'flow', revision: document.revision, itemIds: [] })
    mounted.rerender(<CourseChatPanel projectId="chat-unit" projectPath="C:/chat.h5lesson" onClose={() => {}} />)
    expect(scope()).toBe('selection')
    expect(screen.getByLabelText('本轮引用摘要')).toHaveTextContent('标题1')
    expect(h.capture).not.toHaveBeenCalled()
    await act(async () => { delayed.resolve({ workspace: { version: 1, projectId: 'chat-unit', normalizedPath: 'c:/chat.h5lesson' } }) })
    await waitFor(() => expect(h.starts).toHaveLength(1))
    expect(h.starts[0]).toMatchObject({ scope: 'selection', target: { locationId: document.startLocationId, selectedIds: ['first'] } })
    expect(scope()).toBe('selection')
    expect(screen.getByLabelText('本轮引用摘要')).toHaveTextContent('标题1')
    await act(async () => { h.view = { ...h.view, busy: false, phase: 'completed' }; h.onView(h.view) })
    expect(scope()).toBe('page')
    expect(screen.getByLabelText('本轮引用摘要')).not.toHaveTextContent('标题1')
  })
})

describe('chat observation owner lifecycle', () => {
  it('refreshes a failed session row from Main cancellation without losing its diagnosis or overwriting a newer task', async () => {
    vi.useFakeTimers()
    const running = { id: 'native-session', adapter: 'codex', status: 'running', events: [],
      task: { taskId: 'task-1', epoch: 1, turnId: 'turn-1', status: 'running' } }
    const cancelled = { ...running, status: 'cancelled', task: { ...running.task, epoch: running.task.epoch + 1, status: 'cancelled' } }
    const late = deferred<any>(), reads = vi.fn().mockResolvedValueOnce({ records: [running] })
      .mockResolvedValueOnce({ records: [cancelled] }).mockImplementationOnce(() => late.promise)
    const localAgent = vi.mocked(window.desktopAPI!.localAgent), nativeOperate = localAgent.getMockImplementation()!
    localAgent.mockImplementation(input => input.operation === 'read' ? reads(input) : nativeOperate(input))
    h.terminal = { busy: true, phase: 'running', error: undefined, record: running }
    mount(); await submitPreparation('修改原标题')
    await act(async () => {
      h.view = { ...h.view, busy: false, phase: 'failed', notice: '本任务未完成，课件未应用本轮候选', error: 'stale：另一页草稿已保留' }
      h.onView(h.view)
    })
    expect(screen.getByRole('button', { name: '停止' })).toBeDisabled()
    expect(screen.getByRole('option', { name: /codex · 对话 1 · 运行中/ })).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(screen.getByRole('option', { name: /codex · 对话 1 · 已停止/ })).toBeTruthy()
    expect(screen.getByText('课件或任务已变化，本次未应用的修改已丢弃。请核对当前内容，再发送要求或明确继续。')).toHaveAttribute('role', 'alert')
    expect(screen.getByText('本任务未完成，课件未应用本轮候选')).toHaveAttribute('role', 'status')
    expect(h.view.record.task.status).toBe('running')
    await act(async () => { h.view = { ...h.view }; h.onView(h.view) })
    expect(reads).toHaveBeenCalledTimes(3)
    await act(async () => {
      h.view = { ...h.view, busy: true, phase: 'running', error: undefined, notice: '新任务运行中',
        request: { ...h.view.request, requestId: 'new-request' }, record: { ...running, task: { ...running.task, taskId: 'task-2', epoch: 2 } } }
      h.onView(h.view)
    })
    await act(async () => { late.resolve({ records: [cancelled] }); await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByRole('option', { name: /codex · 对话 1 · 运行中/ })).toBeTruthy()
    expect(screen.queryByRole('option', { name: /已停止/ })).toBeNull()
    expect(screen.getByText(/^新任务运行中/)).toHaveAttribute('role', 'status')
    expect(reads).toHaveBeenCalledTimes(3)
  })

  it('sends after StrictMode effect replay without reusing a disposed observation or accepting its late view', async () => {
    render(<StrictMode><CourseChatPanel projectId="chat-unit" projectPath="C:/chat.h5lesson" onClose={() => {}} /></StrictMode>)
    await send('讨论当前标题', 1)
    expect(h.bridges.at(-1).disposed).toBe(false)
    expect(h.bridges.slice(0, -1).every(bridge => bridge.disposed)).toBe(true)
    expect(h.capture).toHaveBeenCalledTimes(1)
    await act(async () => { h.controllers[0].onView({ busy: true, phase: 'running', notice: '旧观察迟到回调', events: [] }) })
    expect(screen.queryByText('旧观察迟到回调')).toBeNull()
    expect(screen.getByRole('button', { name: '停止' })).toBeDisabled()
  })

  it.each([false, true])('disposes pending capture on unmount and sends only the fresh remount task (StrictMode=%s)', async strict => {
    const delayed = deferred<any>()
    h.capture.mockImplementationOnce(() => delayed.promise)
    const panel = <CourseChatPanel projectId="chat-unit" projectPath="C:/chat.h5lesson" onClose={() => {}} />
    const first = render(strict ? <StrictMode>{panel}</StrictMode> : panel)
    fireEvent.change(screen.getByLabelText('发送给创作助手'), { target: { value: '旧任务' } })
    fireEvent.submit(screen.getByLabelText('发送给创作助手').closest('form')!)
    await waitFor(() => expect(h.capture).toHaveBeenCalledTimes(1))
    const previous = h.capture.mock.calls[0]![0]
    first.unmount()
    expect(h.bridges.every(bridge => bridge.disposed)).toBe(true)
    render(strict ? <StrictMode>{panel}</StrictMode> : panel)
    await send('新任务', 1)
    await act(async () => { delayed.resolve({ ...previous, requestId: 'late-old-request', destinations: [] }) })
    expect(h.starts.map(request => request.instruction)).toEqual(['新任务'])
    expect(h.bridges.at(-1).disposed).toBe(false)
  })

  it('discards the old owner capture after a keyed workspace switch and starts only the new owner task', async () => {
    const delayed = deferred<any>(), localAgent = vi.mocked(window.desktopAPI!.localAgent), nativeOperate = localAgent.getMockImplementation()!
    localAgent.mockImplementation(input => input.operation === 'workspace'
      ? Promise.resolve({ enabled: true, workspace: { version: 1, projectId: input.projectId, normalizedPath: input.projectPath.toLowerCase() } })
      : nativeOperate(input))
    h.capture.mockImplementationOnce(() => delayed.promise)
    const panel = (path: string) => <StrictMode><CourseChatPanel key={path} projectId="chat-unit" projectPath={path} onClose={() => {}} /></StrictMode>
    const mounted = render(panel('C:/chat.h5lesson'))
    fireEvent.change(screen.getByLabelText('发送给创作助手'), { target: { value: '旧工程任务' } })
    fireEvent.submit(screen.getByLabelText('发送给创作助手').closest('form')!)
    await waitFor(() => expect(h.capture).toHaveBeenCalledTimes(1))
    const previous = h.capture.mock.calls[0]![0], oldBridges = [...h.bridges]
    mounted.rerender(panel('C:/other.h5lesson'))
    expect(oldBridges.every(bridge => bridge.disposed)).toBe(true)
    await send('新工程任务', 1)
    await act(async () => { delayed.resolve({ ...previous, requestId: 'late-old-owner', destinations: [] }) })
    expect(h.starts).toHaveLength(1)
    expect(h.starts[0]).toMatchObject({ instruction: '新工程任务', workspace: { normalizedPath: 'c:/other.h5lesson' } })
    expect(h.controllerPorts.owner.projectPath).toBe('C:/other.h5lesson')
  })
})

describe('chat failed preparation evidence', () => {
  function evidence(instanceId: string): DynamicBehaviorObservation {
    return { version: 1, status: 'observed', mode: 'full-admission', projectId: 'chat-unit', documentRevision: 1,
      locationId: 'location', stateId: null, instanceIds: [instanceId], sourceIdentities: { [instanceId]: 'source-identity' },
      actions: ['update-inputs'], elapsedMs: 3, semanticVerdict: 'requires-review',
      frames: [1, 2, 3].map(index => ({ phase: 'running', elapsedMs: index, capturedAt: index, stateVersion: index,
        publicState: { [instanceId]: { count: index } }, width: 1, height: 1, dataUrl: `data:image/png;base64,${'A'.repeat(30_000)}` })) }
  }
  function failure(instanceId: string) {
    return new GenerationCandidatePreparationError({ version: 1, stage: 'dynamic-admission',
      diagnostics: [{ code: 'dynamic-host-failed', message: `${instanceId} failed after sampling`, path: ['instances', instanceId, 'update'] }],
      assetIds: [], packageIds: [], behaviorEvidence: [evidence(instanceId)] })
  }

  it('passes all failed preparation frames to the next observation and rethrows the original error', async () => {
    const error = failure('failed-instance')
    h.store.prepareGenerationCandidate = vi.fn().mockRejectedValue(error)
    mount(); await send('修复这个互动', 1)
    const request = h.starts[0]
    await expect(h.controllerPorts.prepare(request, {})).rejects.toBe(error)
    await h.controllerPorts.captureNext(request)
    expect(h.captureNext).toHaveBeenLastCalledWith(request, undefined, error.failure.behaviorEvidence)
    expect(JSON.stringify(h.captureNext.mock.calls.at(-1)![2]).length).toBeGreaterThan(80_000)
  })

  it('keeps successful evidence and clears it if the active preparation fails without structured evidence', async () => {
    const prepared = { behaviorEvidence: [evidence('successful-instance')] }, error = new Error('No behavior frames were captured')
    h.store.prepareGenerationCandidate = vi.fn().mockResolvedValueOnce(prepared).mockRejectedValueOnce(error)
    mount(); await send('修复这个互动', 1)
    const request = h.starts[0]
    await expect(h.controllerPorts.prepare(request, {})).resolves.toBe(prepared)
    await h.controllerPorts.captureNext(request)
    expect(h.captureNext).toHaveBeenLastCalledWith(request, undefined, prepared.behaviorEvidence)
    await expect(h.controllerPorts.prepare(request, {})).rejects.toBe(error)
    await h.controllerPorts.captureNext(request)
    expect(h.captureNext).toHaveBeenLastCalledWith(request, undefined, [])
  })

  it('clears failed evidence on request change and ignores a late failure from the previous request', async () => {
    const oldError = failure('old-instance'), currentError = failure('current-instance'), delayed = deferred<void>()
    h.store.prepareGenerationCandidate = vi.fn().mockRejectedValueOnce(oldError)
      .mockImplementationOnce(async () => { await delayed.promise; throw oldError }).mockRejectedValueOnce(currentError)
    mount(); await send('修复旧互动', 1)
    const previous = h.starts[0]
    await expect(h.controllerPorts.prepare(previous, {})).rejects.toBe(oldError)
    await h.controllerPorts.captureNext(previous)
    expect(h.captureNext).toHaveBeenLastCalledWith(previous, undefined, oldError.failure.behaviorEvidence)
    const late = h.controllerPorts.prepare(previous, {}).catch((error: unknown) => error)
    await send('改为修复当前互动', 2)
    const current = h.starts[1]
    await h.controllerPorts.captureNext(current)
    expect(h.captureNext).toHaveBeenLastCalledWith(current, undefined, [])
    await expect(h.controllerPorts.prepare(current, {})).rejects.toBe(currentError)
    delayed.resolve(); expect(await late).toBe(oldError)
    await h.controllerPorts.captureNext(current)
    expect(h.captureNext).toHaveBeenLastCalledWith(current, undefined, currentError.failure.behaviorEvidence)
  })
})

describe('chat idle send after a stale task', () => {
  it('keeps the real local repair request in edit despite its rejected quoted approach', async () => {
    const instruction = String.raw`我已实际播放检查了刚保存的修改，按钮仍不正确：点击总结页“回看探究记录”后停在了“2｜先预测，再操作开关”，没有进入原来的流式探究记录页。失败截图：D:\果铃工作台\output\r19-final-20260917\teacher-review\review-record-return-runs\2026-09-16T23-32-29-611Z-39024\failure.png

请不要再用“先跳实验、再自动推进”的绕行或延时方案。把总结页这一处回看入口换成软件里的普通可编辑跳转按钮，明确指向现有“3｜探究记录：把现象变成证据”流式讲义。按钮文字仍为“回看探究记录”，位置与外观尽量保持原样，点击一次直接到原页面；不能新增或复制记录页，不能改其他已通过内容，也不能保留两个同名入口。

原四框必须仍是同一组，原来的预测、记录和三轮观察都要保留。保持六个位置和四份教学文档不变。

这轮局部修改正式应用后就结束并说明结果，由我在当前软件完成实际点击与保存重开的独立验收；不用另建检查工程或继续寻找别的编辑器环境。`
    mount()
    fireEvent.change(screen.getByLabelText('意图'), { target: { value: 'edit' } })
    await send(instruction, 1)
    expect(h.starts[0].intent).toBe('edit')
    expect(h.starts[0].instruction).toBe(instruction)
  })
  it.each([
    ['plan', '我想让这个标题在课堂投影时更醒目、容易看清，文字内容保持不变。请结合当前页面给出调整方案，先不要修改。', 'plan'],
    ['plan', '不要修改，只和我讨论配色', 'discuss'],
    ['edit', '不要修改，只说明当前标题的情况', 'discuss'],
    ['edit', '先给出方案，不要修改课件。', 'plan'],
    ['edit', '先计划，再按我确认的内容修改。', 'plan'],
    ['edit', '先和我讨论配色。', 'discuss'],
    ['edit', '先别修改，说明当前标题的情况。', 'discuss'],
  ])('respects selected %s and the read-only request %s', async (selected, instruction, expected) => {
    mount()
    fireEvent.change(screen.getByLabelText('意图'), { target: { value: selected } })
    await send(instruction, 1)
    expect(h.starts[0].intent).toBe(expected)
  })
  it.each([
    '先问我标题要改成什么，等我回答后再修改。',
    '先问我标题要改成什么。等我回答后再修改。',
  ])('defers an edit until a confirmed native session can resume after the user answers: %s', async firstInstruction => {
    h.terminal = { phase: 'completed', error: undefined }
    mount()
    await send(firstInstruction, 1)
    expect(h.starts[0].intent).toBe('discuss')
    expect((screen.getByLabelText('意图') as HTMLSelectElement).value).toBe('edit')

    await send('标题改成“周期的秘密”', 2)
    expect(h.starts[1].intent).toBe('edit')
    expect(h.starts[1].instruction).toBe('标题改成“周期的秘密”')
    expect(h.startCalls[1]).toMatchObject({ resumeId: 'native-session' })
    expect(window.desktopAPI!.localAgent).toHaveBeenCalledWith(expect.objectContaining({ operation: 'read', sessionId: 'native-session' }))
  })
  it('keeps an explicitly selected discussion through a deferred-edit conversation', async () => {
    h.terminal = { phase: 'completed', error: undefined }
    mount()
    fireEvent.change(screen.getByLabelText('意图'), { target: { value: 'discuss' } })
    await send('先问我标题要改成什么，等我回答后再修改。', 1)
    expect(h.starts[0].intent).toBe('discuss')
    expect((screen.getByLabelText('意图') as HTMLSelectElement).value).toBe('discuss')

    await send('标题改成“周期的秘密”', 2)
    expect(h.starts[1].intent).toBe('discuss')
    expect(h.starts[1].instruction).toBe('标题改成“周期的秘密”')
  })
  it('keeps an ordinary direct edit as an edit', async () => {
    mount()
    await send('把标题改成“周期的秘密”', 1)
    expect(h.starts[0].intent).toBe('edit')
  })
  it('uses the selected edit intent when reissuing an automatic discussion', async () => {
    h.terminal = { busy: true, phase: 'running', error: undefined }
    mount()
    await send('先问我标题要改成什么，等我回答后再修改。', 1)
    expect(h.starts[0].intent).toBe('discuss')

    await send('标题改成“周期的秘密”', 2)
    expect(h.starts[1].intent).toBe('edit')
    expect(h.startCalls[1]).toMatchObject({ resumeId: 'native-session' })
  })
  it('starts a fresh user request without treating the selected native session old host result as current feedback', async () => {
    const historicalResult = { status: 'committed', summary: '此前字号已放大至44', requestId: 'old-request' }
    h.terminal = { phase: 'completed', error: undefined, receipt: { status: 'committed' },
      record: { id: 'native-session', adapter: 'claude', status: 'completed', events: [], hostResult: historicalResult } }
    mount(); await send('把这个标题放大', 1); await send('把这个标题再放大一点', 2)
    expect(h.starts[1].instruction).toBe('把这个标题再放大一点')
    expect(h.capture.mock.calls[1][0]).not.toHaveProperty('previousResult')
    expect(window.desktopAPI!.localAgent).toHaveBeenCalledWith(expect.objectContaining({ operation: 'read', sessionId: 'native-session' }))
  })
  it('continues the unresolved goal after the old turn ended and uses the current reference controls', async () => {
    mount(); await send('把蓝色方块改为橙色', 1)
    fireEvent.change(screen.getByLabelText('本轮引用'), { target: { value: 'selection' } })
    await send('以我现在手改的位置为准', 2)
    expect(h.starts[1].instruction).toContain('把蓝色方块改为橙色')
    expect(h.starts[1].instruction).toMatch(/以我现在手改的位置为准$/)
    expect(h.starts[1].scope).toBe('selection')
  })
  it.each([
    { phase: 'completed', error: undefined },
    { phase: 'cancelled', error: 'stale：已停止' },
    { phase: 'failed', error: '网络连接失败' },
    { phase: 'failed', receipt: { status: 'committed' } },
  ])('does not bind an ordinary idle send to the previous goal: %j', async terminal => {
    h.terminal = terminal; mount(); await send('之前的任务', 1); await send('新建一页介绍月球', 2)
    expect(h.starts[1].instruction).toBe('新建一页介绍月球')
  })
  it('keeps accepted in-flight input if a later manual edit ends the task before the correction arrives', async () => {
    h.terminal = { busy: true, phase: 'running', error: undefined }
    mount(); await send('把方块改为橙色', 1)
    h.current = true
    fireEvent.change(screen.getByLabelText('发送给创作助手'), { target: { value: '保留文字内容' } })
    fireEvent.submit(screen.getByLabelText('发送给创作助手').closest('form')!)
    await waitFor(() => expect(h.remember).toHaveBeenCalledWith('保留文字内容'))
    await act(async () => { h.current = false; h.view = { ...h.view, busy: false, phase: 'failed', error: 'stale：课件已改变' }; h.onView(h.view) })
    h.terminal = {}; await send('以现在的位置为准', 2)
    expect(h.starts[1].instruction).toContain('把方块改为橙色')
    expect(h.starts[1].instruction).toContain('保留文字内容')
    expect(h.starts[1].instruction).toMatch(/以现在的位置为准$/)
  })
  it('gives an explicit discussion request priority after a stale editing task', async () => {
    mount(); await send('把方块改为橙色', 1); await send('不要修改，只和我讨论配色', 2)
    expect(h.starts[1].intent).toBe('discuss')
    expect(h.starts[1].instruction).toMatch(/不要修改，只和我讨论配色$/)
  })
})

describe('chat initial preparation budget', () => {
  it.each(['workspace', 'materials', 'catalog', 'capture', 'resume'] as const)('expires a hanging %s stage and ignores its late result', async stage => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const delayed = deferred<any>()
    const api = window.desktopAPI!, localAgent = vi.mocked(api.localAgent), nativeOperate = localAgent.getMockImplementation()!
    const material = { id: 'material-one', title: '材料一' }
    if (stage === 'materials') vi.mocked(api.materials).mockImplementation(async input => input.operation === 'search' ? [material] as any : delayed.promise)
    h.terminal = { phase: 'completed', error: undefined }
    mount()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    if (stage === 'resume') await submitPreparation('先完成一轮')
    const startCount = h.starts.length
    if (stage === 'workspace') localAgent.mockImplementation(input => input.operation === 'workspace' ? delayed.promise : nativeOperate(input))
    if (stage === 'catalog') vi.mocked(api.loadComponentCatalog).mockImplementationOnce(() => delayed.promise)
    if (stage === 'capture') h.capture.mockImplementationOnce(() => delayed.promise)
    if (stage === 'resume') localAgent.mockImplementation(input => input.operation === 'read' ? delayed.promise : nativeOperate(input))
    if (stage === 'materials') fireEvent.click(screen.getByLabelText('材料一'))
    await submitPreparation('准备本轮任务')
    expect(screen.getByText(/本任务剩余约 20 分钟/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '停止' })).not.toBeDisabled()
    await act(async () => { await vi.advanceTimersByTimeAsync(DEFAULT_GENERATION_TASK_DURATION_MS) })
    expect(screen.getByText(/本次处理超时，尚未完成/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '停止' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled()
    expect(h.starts).toHaveLength(startCount)
    delayed.resolve(stage === 'workspace' ? { workspace: { version: 1, projectId: 'chat-unit', normalizedPath: 'c:/chat.h5lesson' } }
      : stage === 'materials' ? [material] : stage === 'catalog' ? { packages: [] } : stage === 'resume' ? { records: [{ workspace: { version: 1, projectId: 'chat-unit', normalizedPath: 'c:/chat.h5lesson' }, externalSessionId: 'confirmed-native' }] }
        : { ...h.capture.mock.calls.at(-1)![0], requestId: 'late-request', destinations: [] })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(h.starts).toHaveLength(startCount)
  })

  it('keeps the send-time deadline through slow preparation and passes it into capture before any observation work', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const delayed = deferred<any>(), api = window.desktopAPI!, localAgent = vi.mocked(api.localAgent), nativeOperate = localAgent.getMockImplementation()!
    localAgent.mockImplementation(input => input.operation === 'workspace' ? delayed.promise : nativeOperate(input))
    mount(); await submitPreparation('同步这页')
    await act(async () => { await vi.advanceTimersByTimeAsync(DEFAULT_GENERATION_TASK_DURATION_MS - 100) })
    h.capture.mockImplementationOnce(() => new Promise(() => {}))
    delayed.resolve({ workspace: { version: 1, projectId: 'chat-unit', normalizedPath: 'c:/chat.h5lesson' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(h.capture).toHaveBeenLastCalledWith(expect.objectContaining({ execution: { version: 1, startedAt: 1000, deadlineAt: 1000 + DEFAULT_GENERATION_TASK_DURATION_MS } }))
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(screen.getByText(/本次处理超时，尚未完成/)).toBeTruthy()
    expect(h.starts).toHaveLength(0)
  })

  it('allows a new send after Stop while the old capture is still pending', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const delayed = deferred<any>()
    h.capture.mockImplementationOnce(() => delayed.promise)
    mount(); await submitPreparation('旧任务')
    const oldInput = h.capture.mock.calls[0]![0]
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(h.invalidate).toHaveBeenCalledTimes(2)
    await submitPreparation('新任务')
    expect(h.starts).toHaveLength(1)
    expect(h.starts[0].instruction).toBe('新任务')
    delayed.resolve({ ...oldInput, requestId: 'late-old-request', destinations: [] })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(h.starts).toHaveLength(1)
    expect(h.starts[0].instruction).toBe('新任务')
  })

  it('gives a stale task correction a new visible budget before refreshing the observation', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    h.terminal = { busy: true, phase: 'running', error: undefined }
    mount(); await submitPreparation('先讨论这个标题')
    const original = h.starts[0].execution
    await act(async () => { await vi.advanceTimersByTimeAsync(DEFAULT_GENERATION_TASK_DURATION_MS + 1) })
    h.capture.mockImplementationOnce(() => new Promise(() => {}))
    await submitPreparation('以现在的内容继续')
    const refreshed = h.capture.mock.calls.at(-1)![0].execution
    expect(h.capture.mock.calls.at(-1)![0]).toMatchObject({ scope: 'page', target: { anchorId: 'send-time-target' } })
    expect(refreshed.startedAt).toBe(original.deadlineAt + 1)
    expect(refreshed.deadlineAt).toBe(refreshed.startedAt + DEFAULT_GENERATION_TASK_DURATION_MS)
    expect(screen.getByText(/本任务剩余约 20 分钟/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  })
})


describe('readable chat recovery and continuous history', () => {
  it.each(['为什么停止？', '为什么停止了？', '现在怎么样？'])('keeps a status inquiry read-only without replaying the unresolved editing goal: %s', async text => {
    mount(); await send('将标题放大', 1); await send(text, 2)
    expect(h.starts[1].intent).toBe('discuss')
    expect(h.starts[1].instruction).toBe(text)
    expect(h.recovery).not.toHaveBeenCalled()
  })
  it('restores the frozen goal only on explicit continue and persists the actual user wording', async () => {
    h.terminal = { phase: 'failed', error: '图片读取失败' }
    mount(); await send('将小狗图片设为本页背景', 1); await send('继续', 2)
    expect(h.recovery).toHaveBeenCalledWith(h.starts[0], '继续', expect.objectContaining({ deadlineAt: expect.any(Number) }))
    expect(h.starts[1].instruction).toContain('将小狗图片设为本页背景')
    expect(h.startCalls[1].userMessage).toBe('继续')
  })
  it('shows tool progress during execution and clears running messages when the task ends', async () => {
    mount()
    const tool = { version: 1, adapter: 'claude', sessionId: 'session', kind: 'tool-call', time: 0, sequence: 1, payload: { name: 'Read' } }
    await act(async () => { h.onView({ busy: true, phase: 'running', notice: '', events: [tool] }) })
    expect(screen.getByLabelText('任务活动').textContent).toContain('正在读取任务所需内容')
    await act(async () => { h.onView({ busy: false, phase: 'completed', notice: '', events: [tool] }) })
    expect(screen.queryByLabelText('任务活动')).toBeNull()
  })
  it('merges automatic native runs without losing earlier paragraphs or forcibly scrolling a reader', async () => {
    const mounted = mount()
    const scroll = mounted.container.querySelector('.chat-scroll')! as HTMLDivElement
    Object.defineProperties(scroll, { scrollHeight: { configurable: true, value: 1200 }, clientHeight: { configurable: true, value: 300 } })
    scroll.scrollTop = 200
    fireEvent.scroll(scroll)
    const base = { version: 1, adapter: 'codex', sessionId: 'session', kind: 'text', time: 0 }
    const one = { ...base, sequence: 1, payload: { text: '先核对背景目标。', messageId: 'run1:one', phase: 'progress' } }
    const two = { ...base, sequence: 2, payload: { text: '收到失败原因，继续处理。', messageId: 'run2:one', phase: 'progress' } }
    await act(async () => { h.onView({ busy: true, phase: 'running', notice: '', events: [one] }) })
    await act(async () => { h.onView({ busy: true, phase: 'running', notice: '', events: [two] }) })
    expect(screen.getByText('先核对背景目标。')).toBeTruthy()
    expect(screen.getByText('收到失败原因，继续处理。')).toBeTruthy()
    expect(scroll.scrollTop).toBe(200)
    expect(screen.queryByText(/诊断详情|原生事件/)).toBeNull()
  })
})


describe('native conversation records across user turns', () => {
  const nativeRecord = (id: string) => ({ id, adapter: 'codex', externalSessionId: 'same-native-thread', workingDirectoryId: 'same-working-directory',
    status: 'failed', events: [], task: { taskId: 'task-1', epoch: 0, turnId: 'native-turn', status: 'failed' } })
  const textEvent = (sessionId: string, sequence: number, text: string, user = false) => ({ version: 1, adapter: 'codex', sessionId,
    time: sessionId === 'edit-local' ? sequence : 10 + sequence, sequence, kind: user ? 'user-message' : 'text', payload: { text, messageId: `run:${sequence}`, phase: 'body' } })
  it('keeps the original editing goal and all public messages through failure, status inquiry, then explicit continue', async () => {
    h.terminal = { sessionId: 'edit-local', record: nativeRecord('edit-local'), events: [textEvent('edit-local', 1, '将标题放大', true), textEvent('edit-local', 2, '本阶段未能完成。')] }
    mount(); await send('将标题放大', 1)
    const original = h.starts[0]
    h.terminal = { sessionId: 'status-local', record: nativeRecord('status-local'), phase: 'completed', error: undefined,
      events: [textEvent('status-local', 1, '为什么停止？', true), textEvent('status-local', 2, '因为图片读取未完成。')] }
    await send('为什么停止？', 2)
    expect(h.starts[1].intent).toBe('discuss')
    expect(screen.getByText('本阶段未能完成。')).toBeTruthy()
    expect(screen.getByText('因为图片读取未完成。')).toBeTruthy()
    expect(screen.getAllByRole('region', { name: '用户消息' })).toHaveLength(2)
    h.terminal = { sessionId: 'continue-local', record: nativeRecord('continue-local'), phase: 'completed', error: undefined }
    await send('继续', 3)
    expect(h.recovery).toHaveBeenCalledWith(original, '继续', expect.any(Object))
    expect(h.starts[2].instruction).toContain('将标题放大')
    expect(h.starts[2].intent).toBe('edit')
  })
  it('records a busy status question without stopping, replacing the goal or discarding a checked preview', async () => {
    h.terminal = { busy: true, phase: 'awaiting-apply', error: undefined }
    mount(); await send('添加讲解', 1)
    fireEvent.change(screen.getByLabelText('发送给创作助手'), { target: { value: '现在怎么样？' } })
    fireEvent.submit(screen.getByLabelText('发送给创作助手').closest('form')!)
    await waitFor(() => expect(h.input).toHaveBeenCalledWith(expect.objectContaining({ kind: 'supplement', text: '现在怎么样？' }), { preservePreview: true }))
    expect(h.stop).not.toHaveBeenCalled()
    expect(h.remember).not.toHaveBeenCalled()
    expect(h.starts).toHaveLength(1)
    expect(screen.getByText(/当前状态：等待应用/)).toBeTruthy()
  })
  it('reopens every record in the same native conversation read-only in timestamp order', async () => {
    const a = { ...nativeRecord('edit-local'), generationRequest: { instruction: '将标题放大', intent: 'edit', execution: { startedAt: 0 } } }
    const b = { ...nativeRecord('status-local'), generationRequest: { instruction: '为什么停止？', intent: 'discuss', execution: { startedAt: 10 } } }
    const localAgent = vi.mocked(window.desktopAPI!.localAgent), original = localAgent.getMockImplementation()!
    localAgent.mockImplementation(async input => input.operation === 'list' ? { enabled: true, records: [b, a] } as any
      : input.operation === 'read' ? { enabled: true, records: [{ ...(input.sessionId === a.id ? a : b), events: input.sessionId === a.id
        ? [textEvent(a.id, 1, '将标题放大', true), textEvent(a.id, 2, '正在检查标题。')]
        : [textEvent(b.id, 1, '为什么停止？', true), textEvent(b.id, 2, '连接暂时中断。')] }] } as any : original(input))
    const mounted = mount()
    await waitFor(() => expect(screen.getByLabelText('会话').querySelectorAll('option')).toHaveLength(3))
    fireEvent.change(screen.getByLabelText('会话'), { target: { value: b.id } })
    await waitFor(() => expect(screen.getByText('连接暂时中断。')).toBeTruthy())
    expect([...mounted.container.querySelectorAll('[data-message-id]')].map(node => node.getAttribute('data-message-id'))).toEqual([
      'edit-local:run:1', 'edit-local:run:2', 'status-local:run:1', 'status-local:run:2',
    ])
    expect(h.starts).toHaveLength(0)
    expect(h.input).not.toHaveBeenCalled()
  })
})
