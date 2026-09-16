import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LessonConversationChat } from '../../src/renderer/ui/chat/LessonConversationChat'
import type { LessonConversation, LessonWorkspace } from '../../src/shared/lessonWorkspace'
import type { LocalAgentEvent, LocalAgentRecord } from '../../src/shared/localAgentContract'
const documentTasks = vi.hoisted(() => ({ callbacks: [] as Array<(message: string) => void>, stops: [] as Array<ReturnType<typeof vi.fn>> }))
vi.mock('../../src/renderer/documentFiles/documentAiTaskController', () => ({ DocumentAiTaskController: class {
  stop = vi.fn(async () => {})
  constructor(_api: unknown, _workspace: unknown, notify: (message: string) => void) { documentTasks.callbacks.push(notify); documentTasks.stops.push(this.stop) }
  async start() { documentTasks.callbacks.at(-1)!('AI 修改已保存'); return 'file-session' }
} }))

vi.mock('../../src/renderer/ui/chat/NativeAgentConfiguration', () => ({ NativeAgentConfiguration: () => null }))
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
afterEach(() => { cleanup(); documentTasks.callbacks.length = 0; documentTasks.stops.length = 0; localStorage.clear(); vi.unstubAllGlobals(); vi.useRealTimers() })
function mountApi(localAgent: ReturnType<typeof vi.fn>) { Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { localAgent } }) }
describe('lesson conversation live ownership', () => {
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
    const target = { name: 'teaching-plan.md', getEditor: () => null }
    const props = { lesson, conversation: bound, projectId: 'project', projectPath: 'c:/lesson/project.h5lesson' }
    const ui = render(<LessonConversationChat {...props} documentTarget={target} />)
    await waitFor(() => expect(screen.getByText('发送')).toBeDisabled())
    fireEvent.click(screen.getByText('编辑当前文档'))
    fireEvent.change(screen.getByLabelText('给创作助手的消息'), { target: { value: '修一处措辞' } })
    await waitFor(() => expect(screen.getByText('发送')).toBeEnabled())
    fireEvent.click(screen.getByText('发送'))
    await screen.findByText('AI 修改已保存')
    await waitFor(() => expect(screen.getByText('移除文档引用')).toBeEnabled())
    // Poll clears the accepted session's pending flag before returning to course.
    await new Promise(resolve => setTimeout(resolve, 1100))
    fireEvent.click(screen.getByText('移除文档引用'))
    ui.rerender(<LessonConversationChat {...props} />)
    await screen.findByLabelText('工程创作')
    act(() => documentTasks.callbacks[0]!('旧文件任务迟到状态'))
    expect(screen.queryByText('旧文件任务迟到状态')).toBeNull()
    expect(screen.getByLabelText('工程创作')).toBeInTheDocument()
    running = true
    await screen.findByText('停止', {}, { timeout: 2200 })
    expect(screen.queryByLabelText('工程创作')).toBeNull()
    act(() => documentTasks.callbacks[0]!('旧文件取消状态'))
    fireEvent.click(screen.getByText('停止'))
    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.objectContaining({ operation: 'lesson-cancel', sessionId: 'other-session' })))
    expect(documentTasks.stops[0]).not.toHaveBeenCalled()
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
