import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DirectoryConversationChat, LessonConversationChat } from '../../src/renderer/ui/chat/LessonConversationChat'
import type { LessonConversation, LessonWorkspace } from '../../src/shared/lessonWorkspace'
import type { ContextualEditTarget } from '../../src/shared/document/ports'
import type { LocalAgentCapabilities, LocalAgentEvent, LocalAgentRecord } from '../../src/shared/localAgentContract'
const documentTasks = vi.hoisted(() => ({ callbacks: [] as Array<(message: string, state?: 'running' | 'preview' | 'completed' | 'stopped' | 'failed') => void>, stops: [] as Array<ReturnType<typeof vi.fn>>, starts: [] as unknown[][] }))
const notice = vi.hoisted(() => ({ ensure: vi.fn(async () => true), cancel: vi.fn(), review: vi.fn(), dialog: null }))
vi.mock('../../src/renderer/ui/chat/useExternalAiNotice', () => ({ useExternalAiNotice: () => notice }))
vi.mock('../../src/renderer/documentFiles/documentAiTaskController', () => ({ DocumentAiTaskController: class {
  stop = vi.fn(async () => {})
  constructor(_api: unknown, _workspace: unknown, notify: (message: string) => void) { documentTasks.callbacks.push(notify); documentTasks.stops.push(this.stop) }
  async start(...args: unknown[]) { documentTasks.starts.push(args); documentTasks.callbacks.at(-1)!('AI 修改已保存'); return 'file-session' }
} }))

vi.mock('../../src/renderer/ui/chat/CourseChatTranscript', () => ({ CourseChatTranscript: ({ events }: { events: LocalAgentEvent[] }) => <div>{events.map(event => <p key={`${event.sessionId}:${event.sequence}`}>{typeof event.payload === 'string' ? event.payload : ''}</p>)}</div> }))
vi.mock('../../src/renderer/ui/chat/CourseChatPanel', () => ({ CourseChatPanel: ({ initialHistory }: { initialHistory: LocalAgentEvent[] }) => <div aria-label="工程创作">{initialHistory.map(event => <p key={`${event.sessionId}:${event.sequence}`}>{typeof event.payload === 'string' ? event.payload : ''}</p>)}</div> }))
const lessonId = '10000000-0000-4000-8000-000000000001', conversationId = '10000000-0000-4000-8000-000000000002', taskId = '10000000-0000-4000-8000-000000000003'
const workspace = { version: 1 as const, kind: 'lesson' as const, lessonId, normalizedDirectory: 'c:/lesson', conversationId }
const lesson: LessonWorkspace = { identity: { schemaVersion: 1, lessonId, normalizedDirectory: 'c:/lesson' }, manifest: { schemaVersion: 1, lessonId, title: '课例', documents: {} } }
const conversation: LessonConversation = { schemaVersion: 1, conversationId, lesson: lesson.identity, title: '对话', createdAt: 1, updatedAt: 1, sessionIds: [], epoch: 0 }
const event = (id: string, sequence: number, text: string, payload?: LocalAgentEvent['payload']): LocalAgentEvent => ({ version: 1, sessionId: id, sequence, time: sequence, kind: 'text', adapter: 'codex', payload: payload ?? text })
function record(id: string, time: number, status = 'completed'): LocalAgentRecord {
  return { id, adapter: 'codex', workspace, externalSessionId: `native-${id}`, status, events: [], task: { taskId, epoch: 0, startedAt: time, status, turnId: 'turn' } } as unknown as LocalAgentRecord
}
function capabilities(serviceTier: 'default' | 'fast'): LocalAgentCapabilities {
  return {
    version: 1, adapter: 'codex', cliVersion: 'test',
    models: [{ id: 'gpt-5.6-luna', resolvedModel: 'gpt-5.6-luna', label: 'Luna', image: 'supported',
      effort: { kind: 'supported', values: ['max'], default: 'max' },
      serviceTiers: [{ id: 'default', name: '标准速度', description: '' }, { id: 'fast', name: 'Fast', description: '' }] }],
    current: { model: 'gpt-5.6-luna', resolvedModel: 'gpt-5.6-luna', effort: 'max', serviceTier },
    currentSource: 'native-session',
    input: { image: 'supported', readFile: 'supported', question: 'structured', correction: 'active-turn', cancel: 'supported' },
  }
}
function configurationEvent(id: string, sequence: number, time: number, serviceTier: 'default' | 'fast'): LocalAgentEvent {
  return { ...event(id, sequence, ''), time, kind: 'session', payload: { status: 'configuration', capabilities: capabilities(serviceTier) } }
}
afterEach(() => { cleanup(); notice.ensure.mockReset().mockResolvedValue(true); documentTasks.callbacks.length = 0; documentTasks.stops.length = 0; documentTasks.starts.length = 0; localStorage.clear(); vi.unstubAllGlobals(); vi.useRealTimers() })
function mountApi(localAgent: ReturnType<typeof vi.fn>) { Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { localAgent } }) }
describe('lesson conversation live ownership', () => {
  it.each(['running', 'failed', 'cancelled'])('does not attribute a previous native confirmation to the newest %s session', async status => {
    const previous = record('previous', 10)
    const current = { ...record('current', 20, status), externalSessionId: previous.externalSessionId }
    const api = vi.fn(async request => {
      if (request.operation === 'capabilities') return { capabilities: capabilities('default') }
      if (request.operation === 'lesson-list') return { records: [previous, current] }
      if (request.operation === 'lesson-read') return { records: [{ ...(request.sessionId === previous.id ? previous : current),
        events: request.sessionId === previous.id ? [configurationEvent(previous.id, 1, 10, 'default')] : [] }] }
      return {}
    })
    mountApi(api)
    render(<DirectoryConversationChat root="c:/lesson" conversation={conversation} />)
    fireEvent.change(screen.getByLabelText('给创作助手的消息'), { target: { value: '下一条消息' } })
    await waitFor(() => expect(screen.getByText(status === 'running' ? '发送输入' : '发送')).toBeEnabled())
    expect(screen.queryByText(/^当前任务原生确认：/)).toBeNull()
    expect(screen.getByText(/^最近原生确认：/)).toHaveTextContent('标准速度')
  })
  it('waits for the resumed session confirmation before displaying its Fast configuration', async () => {
    vi.useFakeTimers()
    const previous = record('previous', 10)
    let current: LocalAgentRecord | undefined
    let currentEvents: LocalAgentEvent[] = []
    let resume!: (result: { sessionId: string }) => void
    const api = vi.fn(async request => {
      if (request.operation === 'capabilities') return { capabilities: capabilities('fast') }
      if (request.operation === 'lesson-list') return { records: current ? [previous, current] : [previous] }
      if (request.operation === 'lesson-read') return { records: [{ ...(request.sessionId === previous.id ? previous : current!),
        events: (request.sessionId === previous.id ? [configurationEvent(previous.id, 1, 10, 'default')] : currentEvents).filter(item => item.sequence > request.after) }] }
      if (request.operation === 'lesson-resume') return new Promise<{ sessionId: string }>(resolve => { resume = resolve })
      return {}
    })
    mountApi(api)
    await act(async () => { render(<DirectoryConversationChat root="c:/lesson" conversation={conversation} />) })
    expect(screen.getByText(/^当前任务原生确认：/)).toHaveTextContent('标准速度')
    await act(async () => {
      fireEvent.change(screen.getByLabelText('给创作助手的消息'), { target: { value: '继续讨论' } })
      fireEvent.click(screen.getByText('发送'))
    })
    expect(api).toHaveBeenCalledWith(expect.objectContaining({ operation: 'lesson-resume', sessionId: previous.id }))
    expect(screen.queryByText(/^当前任务原生确认：/)).toBeNull()
    await act(async () => resume({ sessionId: 'current' }))
    // The reply precedes the next history poll: the old session must stay unconfirmed here too.
    expect(screen.queryByText(/^当前任务原生确认：/)).toBeNull()
    current = { ...record('current', 20, 'running'), externalSessionId: previous.externalSessionId }
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.queryByText(/^当前任务原生确认：/)).toBeNull()
    currentEvents = [configurationEvent(current.id, 1, 20, 'fast')]
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByText(/^当前任务原生确认：/)).toHaveTextContent('gpt-5.6-luna · max · Fast')
    current = { ...current, status: 'completed' }
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByText(/^当前任务原生确认：/)).toHaveTextContent('Fast')
  })
  it('does not restore a previous confirmation when a new native start fails before returning a session', async () => {
    const previous = record('previous', 10)
    const api = vi.fn(async request => {
      if (request.operation === 'capabilities') return { capabilities: capabilities('fast') }
      if (request.operation === 'lesson-list') return { records: [previous] }
      if (request.operation === 'lesson-read') return { records: [{ ...previous, events: [configurationEvent(previous.id, 1, 10, 'default')] }] }
      if (request.operation === 'lesson-resume') throw new Error('启动失败')
      return {}
    })
    mountApi(api)
    render(<DirectoryConversationChat root="c:/lesson" conversation={conversation} />)
    await screen.findByText(/^当前任务原生确认：/)
    fireEvent.change(screen.getByLabelText('给创作助手的消息'), { target: { value: '继续讨论' } })
    fireEvent.click(screen.getByText('发送'))
    await screen.findByText('与创作助手的连接中断，尚未确认完成。请检查所选 CLI 后重试或继续。')
    expect(screen.queryByText(/^当前任务原生确认：/)).toBeNull()
    expect(screen.getByLabelText('给创作助手的消息')).toHaveValue('继续讨论')
  })
  it('stops a pending notice without launching a document task when its confirmation arrives late', async () => {
    let confirm!: (allowed: boolean) => void
    notice.ensure.mockImplementationOnce(() => new Promise<boolean>(resolve => { confirm = resolve }))
    mountApi(vi.fn(async () => ({ records: [] })))
    const session = { ref: { kind: 'file' as const, path: '/ws/notes.md' }, epoch: 1, getSnapshot: () => ({ source: '原稿', disk: { version: { contentVersion: 'v1', attachments: [] } } }) }
    Object.assign(window.desktopAPI!, { lessonDocumentAi: vi.fn() })
    render(<LessonConversationChat lesson={lesson} conversation={conversation} projectId="project" projectPath={null} documentTarget={{ name: 'notes.md', getEditor: () => ({ session, flush: async () => true }) as never }} />)
    fireEvent.click(await screen.findByText('编辑当前文档'))
    fireEvent.click(screen.getByText('选择全文'))
    fireEvent.change(screen.getByLabelText('给创作助手的消息'), { target: { value: '修一处措辞' } })
    await waitFor(() => expect(screen.getByText('发送')).toBeEnabled())
    fireEvent.click(screen.getByText('发送'))
    fireEvent.click(await screen.findByText('停止'))
    await act(async () => confirm(true))
    expect(documentTasks.starts).toHaveLength(0)
    expect(screen.getByLabelText('给创作助手的消息')).toHaveValue('修一处措辞')
  })
  it('cancels a late native start after Stop and preserves the unsent draft', async () => {
    let start!: (value: { sessionId: string }) => void
    const api = vi.fn(request => request.operation === 'lesson-start'
      ? new Promise(resolve => { start = resolve }) : Promise.resolve({ records: [] }))
    mountApi(api)
    render(<LessonConversationChat lesson={lesson} conversation={conversation} projectId="project" projectPath={null} />)
    fireEvent.change(screen.getByLabelText('给创作助手的消息'), { target: { value: '讨论主题' } })
    await waitFor(() => expect(screen.getByText('发送')).toBeEnabled())
    fireEvent.click(screen.getByText('发送'))
    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.objectContaining({ operation: 'lesson-start' })))
    fireEvent.click(screen.getByText('停止'))
    await act(async () => start({ sessionId: 'late-session' }))
    expect(api).toHaveBeenCalledWith(expect.objectContaining({ operation: 'lesson-cancel', sessionId: 'late-session' }))
    expect(screen.getByLabelText('给创作助手的消息')).toHaveValue('讨论主题')
  })
  it('releases finished FileAI status when unpinning and keeps late callbacks out of the next running task', async () => {
    let running = false
    const api = vi.fn(async request => {
      const records = [record('file-session', 1), ...(running ? [record('other-session', 2, 'running')] : [])]
      if (request.operation === 'lesson-list') return { records }
      if (request.operation === 'lesson-read') return { records: [records.find(item => item.id === request.sessionId)!] }
      if (request.operation === 'lesson-cancel') { running = false; return {} }
      return {}
    })
    Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { localAgent: api, lessonDocumentAi: vi.fn() } })
    const bound = { ...conversation, projectTarget: { version: 1 as const, projectId: 'project', normalizedPath: 'c:/lesson/project.h5lesson' } }
    const session = { ref: { kind: 'file' as const, path: '/ws/notes.md' }, epoch: 1, getSnapshot: () => ({ source: '原稿', disk: { version: { contentVersion: 'v1', attachments: [] } } }) }
    const target = { name: 'teaching-plan.md', getEditor: () => ({ session, flush: async () => true }) as never }
    const props = { lesson, conversation: bound, projectId: 'project', projectPath: 'c:/lesson/project.h5lesson' }
    const ui = render(<LessonConversationChat {...props} documentTarget={target} />)
    await waitFor(() => expect(screen.getByText('发送')).toBeDisabled())
    fireEvent.click(screen.getByText('编辑当前文档'))
    fireEvent.click(screen.getByText('选择全文'))
    fireEvent.change(screen.getByLabelText('给创作助手的消息'), { target: { value: '修一处措辞' } })
    await waitFor(() => expect(screen.getByText('发送')).toBeEnabled())
    fireEvent.click(screen.getByText('发送'))
    await screen.findByText('AI 修改已保存')
    await waitFor(() => expect(screen.getByText('移除文档引用')).toBeEnabled())
    // A structured terminal state releases the pending send immediately.
    act(() => documentTasks.callbacks[0]!('AI 改动等待应用', 'preview'))
    expect(screen.queryByText('停止')).toBeNull()
    fireEvent.click(screen.getByText('移除文档引用'))
    ui.rerender(<LessonConversationChat {...props} />)
    await screen.findByLabelText('工程创作')
    act(() => documentTasks.callbacks[0]!('旧文件任务迟到状态'))
    expect(screen.queryByText('旧文件任务迟到状态')).toBeNull()
    expect(screen.getByLabelText('工程创作')).toBeInTheDocument()
    expect(documentTasks.starts[0]?.[4]).toMatchObject({ scope: 'document', ranges: [{ from: 0, to: 2 }], baseVersion: { contentVersion: 'v1' } })
    running = true
    await screen.findByText('停止', {}, { timeout: 2200 })
    expect(screen.queryByLabelText('工程创作')).toBeNull()
    act(() => documentTasks.callbacks[0]!('旧文件取消状态'))
    fireEvent.click(screen.getByText('停止'))
    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.objectContaining({ operation: 'lesson-cancel', sessionId: 'other-session' })))
    expect(documentTasks.stops[0]).toHaveBeenCalledTimes(1) // Unpin cancelled only its own preview.
  })
  it('requires an explicit whole-document choice when no contextual selection is available', async () => {
    const api = vi.fn(async request => request.operation === 'lesson-list' ? { records: [] } : request.operation === 'lesson-read' ? { records: [] } : {})
    mountApi(api)
    const session = { ref: { kind: 'file' as const, path: '/ws/notes.md' }, epoch: 1, getSnapshot: () => ({ source: '# 标题\n正文', disk: { version: { contentVersion: 'v2', attachments: [] } } }) }
    render(<LessonConversationChat lesson={lesson} conversation={conversation} projectId="project" projectPath="c:/lesson/project.h5lesson" documentTarget={{ name: 'notes.md', getEditor: () => ({ session, flush: async () => true }) as never }} />)
    await screen.findByText('编辑当前文档')
    fireEvent.click(screen.getByText('编辑当前文档'))
    expect(screen.getByText('（尚未选择范围）')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('给创作助手的消息'), { target: { value: '改标题' } })
    expect(screen.getByText('发送')).toBeDisabled()
    fireEvent.click(screen.getByText('选择全文'))
    expect(screen.getByText('（全文）')).toBeInTheDocument()
    expect(screen.getByText('发送')).toBeEnabled()
  })
  it('freezes and forwards the current contextual selection and rejects a stale range', async () => {
    const api = vi.fn(async request => request.operation === 'lesson-list' ? { records: [] } : request.operation === 'lesson-read' ? { records: [] } : {})
    mountApi(api)
    let source = '原文内容'
    const session = { ref: { kind: 'file' as const, path: '/ws/notes.md' }, epoch: 1, getSnapshot: () => ({ source, disk: { version: { contentVersion: 'v3', attachments: [] } } }) }
    const target = { name: 'notes.md', getEditor: () => ({ session, flush: async () => true }) as never,
      getContextualEditTarget: (): ContextualEditTarget => ({ ref: session.ref, epoch: 1, scope: 'selection', mode: 'source', selection: null, source: '原文内容', label: '第 1 段', revision: '原文内容', baseVersion: { contentVersion: 'v3', attachments: [] }, ranges: [{ from: 0, to: 2, before: '原文' }] }) }
    render(<LessonConversationChat lesson={lesson} conversation={conversation} projectId="project" projectPath="c:/lesson/project.h5lesson" documentTarget={target} />)
    await screen.findByText('编辑当前文档')
    fireEvent.click(screen.getByText('编辑当前文档'))
    expect(screen.getByText('（第 1 段）')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('给创作助手的消息'), { target: { value: '改这段' } })
    expect(screen.getByText('发送')).toBeEnabled()
    source = '外部改动'
    fireEvent.click(screen.getByText('发送'))
    await screen.findByText('当前文档已改变，请重新选择内容后再发送。')
    expect(documentTasks.starts).toHaveLength(0)
  })
  it('preserves rejected supplementary text and question errors across first save, then hands off complete history', async () => {
    let status = 'running'
    const question = { taskId, epoch: 0, workspace, questionId: 'question', turnId: 'turn', questions: [{ id: 'q', title: '选择课型', options: ['新授'], multiple: false }] }
    const history = [event('active', 1, '任务正在进行'), event('active', 2, '', { status: 'question', question })]
    const api = vi.fn(async request => {
      if (request.operation === 'lesson-list') return { records: [record('active', 20, status)] }
      if (request.operation === 'lesson-read') return { records: [{ ...record('active', 20, status), events: history.filter(item => item.sequence > request.after) }] }
      if (request.operation === 'lesson-input') return { inputDelivery: { status: 'rejected', reason: '本轮输入已经关闭' } }
      if (request.operation === 'lesson-cancel') { status = 'cancelled'; history.push(event('active', 3, '任务已停止')); return {} }
      return {}
    })
    mountApi(api)
    const ui = render(<LessonConversationChat lesson={lesson} conversation={conversation} projectId="project" projectPath={null} />)
    await screen.findByText('任务正在进行')
    ui.rerender(<LessonConversationChat lesson={lesson} conversation={{ ...conversation, projectTarget: { version: 1, projectId: 'project', normalizedPath: 'c:/lesson/project.h5lesson' } }} projectId="project" projectPath="c:/lesson/project.h5lesson" />)
    expect(screen.queryByLabelText('工程创作')).toBeNull()
    fireEvent.change(screen.getByLabelText('给创作助手的消息'), { target: { value: '请补充实验' } })
    fireEvent.click(screen.getByText('发送输入'))
    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.objectContaining({ operation: 'lesson-input', input: expect.objectContaining({ kind: 'correct' }) })))
    await screen.findByText('本轮输入已经关闭')
    expect(screen.getByLabelText('给创作助手的消息')).toHaveValue('请补充实验')
    fireEvent.click(screen.getByLabelText('新授')); fireEvent.click(screen.getByText('发送回答'))
    await waitFor(() => expect(screen.getAllByText('本轮输入已经关闭')).toHaveLength(2))
    fireEvent.change(screen.getByLabelText('给创作助手的消息'), { target: { value: '' } })
    fireEvent.click(screen.getByText('停止'))
    await screen.findByLabelText('工程创作', {}, { timeout: 2200 })
    expect(screen.getByText('任务正在进行')).toBeInTheDocument(); expect(screen.getByText('任务已停止')).toBeInTheDocument()
    expect(api.mock.calls.some(([request]) => request.operation === 'lesson-cancel' && request.sessionId === 'active')).toBe(true)
  })
  it('resumes newest native turn by actual event time rather than UUID directory order', async () => {
    const api = vi.fn(async request => request.operation === 'lesson-list' ? { records: [record('new', 30), record('old', 10)] }
      : request.operation === 'lesson-read' ? { records: [{ ...record(request.sessionId, 0), events: [{ ...event(request.sessionId, 1, '历史'), time: request.sessionId === 'new' ? 30 : 10 }] }] } : { sessionId: 'next' })
    mountApi(api)
    render(<LessonConversationChat lesson={lesson} conversation={conversation} projectId="project" projectPath={null} />)
    await waitFor(() => expect(api.mock.calls.filter(([r]) => r.operation === 'lesson-read')).toHaveLength(2))
    fireEvent.change(screen.getByLabelText('给创作助手的消息'), { target: { value: '继续' } })
    fireEvent.click(screen.getByText('发送'))
    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.objectContaining({ operation: 'lesson-resume', sessionId: 'new' })))
  })
  it('polls only new event sequences and keeps prior events visible', async () => {
    vi.useFakeTimers()
    const api = vi.fn(async request => request.operation === 'lesson-list' ? { records: [record('active', 10, 'running')] }
      : { records: [{ ...record('active', 10, 'running'), events: request.after === 0 ? [event('active', 1, '第一条')] : [event('active', 2, '第二条')] }] })
    mountApi(api)
    await act(async () => { render(<LessonConversationChat lesson={lesson} conversation={conversation} projectId="project" projectPath={null} />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(api).toHaveBeenCalledWith(expect.objectContaining({ operation: 'lesson-read', after: 1 }))
    expect(screen.getByText('第一条')).toBeInTheDocument(); expect(screen.getByText('第二条')).toBeInTheDocument()
  })
})
