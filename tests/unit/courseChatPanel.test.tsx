import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CourseChatPanel } from '@/renderer/ui/chat/CourseChatPanel'
import { GenerationCandidatePreparationError, MAX_GENERATION_TASK_DURATION_MS } from '@/shared/generationContract'
import type { DynamicBehaviorObservation } from '@/shared/dynamicBehaviorObservation'

// Exercise the real form/send branching with controller and observation unit ports.
// No native CLI, screenshot, live project commit or acceptance is claimed here.
const h = vi.hoisted(() => ({ view: {} as any, onView: undefined as any, capture: vi.fn(), starts: [] as any[], startCalls: [] as any[],
  cumulative: '', terminal: {} as any, current: true, input: vi.fn(), remember: vi.fn(), invalidate: vi.fn(), stop: vi.fn(), store: {} as any,
  controllerPorts: undefined as any, captureNext: vi.fn(), bridges: [] as any[], controllers: [] as any[] }))
vi.mock('@/renderer/store/editorStore', () => ({
  useEditorStore: Object.assign((selector: any) => selector(h.store), { getState: () => h.store }),
  selectActiveCourseProjectDocument: () => null,
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
  isCurrent: () => !bridge.disposed && h.current, dispose() { bridge.disposed = true }, invalidate: h.invalidate, fileCurrent() {}, captureNext: h.captureNext,
  instructionWithUserInput: (text: string) => `${h.cumulative}\n\n用户最新输入（优先于此前要求）：${text}`,
  rememberUserInput: (text: string) => { h.remember(text); h.cumulative += `\n${text}` },
  refreshFromUser: async (text: string, intent: string, execution: unknown) => bridge.capture({ instruction: `${h.cumulative}\n${text}`, intent, execution }),
  }
  h.bridges.push(bridge)
  return bridge
} }))
vi.mock('@/renderer/authoring/generation/generationTaskController', () => ({ GenerationTaskController: class {
  constructor(ports: any) { h.onView = ports.onView; h.controllerPorts = ports; h.controllers.push(ports) }
  get current() { return h.view }
  async start(request: any, adapter: any, resumeId?: string) {
    h.starts.push(request)
    h.startCalls.push({ request, adapter, resumeId })
    h.view = { busy: false, phase: 'failed', error: 'stale：工程或任务已改变，未应用的修改已丢弃', notice: '', events: [],
      request, sessionId: 'native-session', record: { id: 'native-session', adapter: 'claude', status: 'completed', events: [],
        task: { taskId: 'task-1', epoch: 1, turnId: 'turn-1' } }, ...h.terminal }
    h.current = false; h.onView(h.view)
  }
  async input(input: any) { return h.input(input) }
  async stop() { await h.stop() }
} }))
beforeEach(() => {
  vi.clearAllMocks(); h.starts = []; h.startCalls = []; h.cumulative = ''; h.terminal = {}; h.current = true; h.store = {}; h.view = {}; h.controllerPorts = undefined; h.bridges = []; h.controllers = []
  h.input.mockResolvedValue({ status: 'accepted' })
  h.stop.mockResolvedValue(undefined)
  h.captureNext.mockResolvedValue(undefined)
  h.capture.mockImplementation(async (input: any) => { h.cumulative = input.instruction; return { ...input, requestId: `request-${h.starts.length}`, destinations: [] } })
  window.desktopAPI = { localAgent: vi.fn(async (input: any) => input.operation === 'workspace'
    ? { enabled: true, workspace: { version: 1, projectId: 'chat-unit', normalizedPath: 'c:/chat.h5lesson' } }
    : input.operation === 'read' ? { records: [{ id: 'native-session', externalSessionId: 'confirmed-native' }] } : { records: [] }),
  materials: vi.fn(async () => []), loadComponentCatalog: vi.fn(async () => ({ packages: [] })) } as any
})
afterEach(() => { cleanup(); vi.useRealTimers() })
async function send(text: string, count: number) {
  fireEvent.change(screen.getByLabelText('发送给创作助手'), { target: { value: text } })
  fireEvent.submit(screen.getByLabelText('发送给创作助手').closest('form')!)
  await waitFor(() => expect(h.starts).toHaveLength(count))
}
function mount() { render(<CourseChatPanel projectId="chat-unit" projectPath="C:/chat.h5lesson" onClose={() => {}} />) }
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

describe('chat observation owner lifecycle', () => {
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
  it.each([
    ['plan', '我想让这个标题在课堂投影时更醒目、容易看清，文字内容保持不变。请结合当前页面给出调整方案，先不要修改。', 'plan'],
    ['plan', '不要修改，只和我讨论配色', 'discuss'],
    ['edit', '不要修改，只说明当前标题的情况', 'discuss'],
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
    await act(async () => { await vi.advanceTimersByTimeAsync(MAX_GENERATION_TASK_DURATION_MS) })
    expect(screen.getByText(/20分钟执行期限已到/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '停止' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled()
    expect(h.starts).toHaveLength(startCount)
    delayed.resolve(stage === 'workspace' ? { workspace: { version: 1, projectId: 'chat-unit', normalizedPath: 'c:/chat.h5lesson' } }
      : stage === 'materials' ? [material] : stage === 'catalog' ? { packages: [] } : stage === 'resume' ? { records: [{ externalSessionId: 'confirmed-native' }] }
        : { ...h.capture.mock.calls.at(-1)![0], requestId: 'late-request', destinations: [] })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(h.starts).toHaveLength(startCount)
  })

  it('keeps the send-time deadline through slow preparation and passes it into capture before any observation work', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const delayed = deferred<any>(), api = window.desktopAPI!, localAgent = vi.mocked(api.localAgent), nativeOperate = localAgent.getMockImplementation()!
    localAgent.mockImplementation(input => input.operation === 'workspace' ? delayed.promise : nativeOperate(input))
    mount(); await submitPreparation('同步这页')
    await act(async () => { await vi.advanceTimersByTimeAsync(MAX_GENERATION_TASK_DURATION_MS - 100) })
    h.capture.mockImplementationOnce(() => new Promise(() => {}))
    delayed.resolve({ workspace: { version: 1, projectId: 'chat-unit', normalizedPath: 'c:/chat.h5lesson' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(h.capture).toHaveBeenLastCalledWith(expect.objectContaining({ execution: { version: 1, startedAt: 1000, deadlineAt: 1000 + MAX_GENERATION_TASK_DURATION_MS } }))
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(screen.getByText(/20分钟执行期限已到/)).toBeTruthy()
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
    await act(async () => { await vi.advanceTimersByTimeAsync(MAX_GENERATION_TASK_DURATION_MS + 1) })
    h.capture.mockImplementationOnce(() => new Promise(() => {}))
    await submitPreparation('以现在的内容继续')
    const refreshed = h.capture.mock.calls.at(-1)![0].execution
    expect(refreshed.startedAt).toBe(original.deadlineAt + 1)
    expect(refreshed.deadlineAt).toBe(refreshed.startedAt + MAX_GENERATION_TASK_DURATION_MS)
    expect(screen.getByText(/本任务剩余约 20 分钟/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  })
})
