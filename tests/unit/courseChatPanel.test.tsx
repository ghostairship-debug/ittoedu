import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CourseChatPanel } from '@/renderer/ui/chat/CourseChatPanel'

// Exercise the real form/send branching with controller and observation unit ports.
// No native CLI, screenshot, live project commit or acceptance is claimed here.
const h = vi.hoisted(() => ({ view: {} as any, onView: undefined as any, capture: vi.fn(), starts: [] as any[], startCalls: [] as any[],
  cumulative: '', terminal: {} as any, current: true, input: vi.fn(), remember: vi.fn(), store: {} as any }))
vi.mock('@/renderer/store/editorStore', () => ({
  useEditorStore: Object.assign((selector: any) => selector(h.store), { getState: () => h.store }),
  selectActiveCourseProjectDocument: () => null,
}))
vi.mock('@/renderer/ui/chat/courseChatObservation', () => ({ createCourseChatObservation: () => ({
  capture: h.capture, isCurrent: () => h.current, dispose() {}, fileCurrent() {}, captureNext() {},
  instructionWithUserInput: (text: string) => `${h.cumulative}\n\n用户最新输入（优先于此前要求）：${text}`,
  rememberUserInput: (text: string) => { h.remember(text); h.cumulative += `\n${text}` },
  refreshFromUser: async (text: string, intent: string) => h.capture({ instruction: `${h.cumulative}\n${text}`, intent }),
}) }))
vi.mock('@/renderer/authoring/generation/generationTaskController', () => ({ GenerationTaskController: class {
  constructor(ports: any) { h.onView = ports.onView }
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
  async stop() {}
} }))
beforeEach(() => {
  vi.clearAllMocks(); h.starts = []; h.startCalls = []; h.cumulative = ''; h.terminal = {}; h.current = true; h.store = {}; h.view = {}
  h.input.mockResolvedValue({ status: 'accepted' })
  h.capture.mockImplementation(async (input: any) => { h.cumulative = input.instruction; return { ...input, requestId: `request-${h.starts.length}`, destinations: [] } })
  window.desktopAPI = { localAgent: vi.fn(async (input: any) => input.operation === 'workspace'
    ? { enabled: true, workspace: { version: 1, projectId: 'chat-unit', normalizedPath: 'c:/chat.h5lesson' } }
    : input.operation === 'read' ? { records: [{ id: 'native-session', externalSessionId: 'confirmed-native' }] } : { records: [] }),
  materials: vi.fn(async () => []), loadComponentCatalog: vi.fn(async () => ({ packages: [] })) } as any
})
afterEach(cleanup)
async function send(text: string, count: number) {
  fireEvent.change(screen.getByLabelText('发送给创作助手'), { target: { value: text } })
  fireEvent.submit(screen.getByLabelText('发送给创作助手').closest('form')!)
  await waitFor(() => expect(h.starts).toHaveLength(count))
}
function mount() { render(<CourseChatPanel projectId="chat-unit" projectPath="C:/chat.h5lesson" onClose={() => {}} />) }

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
