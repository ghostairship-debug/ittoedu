import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CourseChatTranscript } from '../../src/renderer/ui/chat/CourseChatTranscript'
import type { LocalAgentEvent } from '../../src/shared/localAgentContract'

const sessionId = '11111111-1111-4111-8111-111111111111'
const runId = '22222222-2222-4222-8222-222222222222'

/** 一条原生文本事件：delta=true 是流式追加分片，delta=false 是整条替换快照。 */
function text(sequence: number, itemId: string, body: string, delta: boolean, kind: LocalAgentEvent['kind'] = 'text'): LocalAgentEvent {
  return { version: 1, adapter: 'codex', sessionId, sequence, time: sequence, kind,
    payload: { messageId: `${runId}:${itemId}`, text: body, phase: 'body', ...(delta ? { delta: true } : {}) } }
}
const chunk = (sequence: number, itemId: string, body: string) => text(sequence, itemId, body, true)
const settled = (sequence: number, itemId: string, body: string) => text(sequence, itemId, body, false)
const user = (sequence: number, itemId: string, body: string) => text(sequence, itemId, body, false, 'user-message')
/** 原生回合收尾（src/shared/localAgentProjection.ts:52-58 把 turn-ended 投成这些 V1 kind）。 */
const turnEnded = (sequence: number, kind: 'completed' | 'failed' | 'cancelled'): LocalAgentEvent =>
  ({ version: 1, adapter: 'codex', sessionId, sequence, time: sequence, kind, payload: {} })
/** 历史回合的收尾：localAgentProjection.ts:94-101 把「非最后一个原生事件」的 turn-ended 降级成
 * 普通 `session` 事件并保留 `status: 'turn-ended'`，它同样结束自己那个回合的正文流。 */
const historicalTurnEnded = (sequence: number, status: 'turn-ended' = 'turn-ended'): LocalAgentEvent =>
  ({ version: 1, adapter: 'codex', sessionId, sequence, time: sequence, kind: 'session', payload: { status } })

const region = () => screen.getByRole('log', { name: '对话记录' })
const messageNodes = (container: HTMLElement) => [...container.querySelectorAll('[data-message-id]')]
const reply = (container: HTMLElement, itemId: string) => container.querySelector(`[data-message-id$=":${itemId}"]`)

afterEach(cleanup)
describe('对话记录转写区的 live region 播报策略', () => {
  it('把转写区声明为 polite 的 log 区域，只播报新增消息，且区域自身不可聚焦', () => {
    render(<CourseChatTranscript events={[user(1, 'u1', '添加小狗背景'), settled(2, 'a', '图片已经准备好。')]} />)
    expect(region()).toHaveAttribute('aria-live', 'polite')
    expect(region()).toHaveAttribute('aria-relevant', 'additions')
    expect(region()).toHaveAttribute('aria-atomic', 'false')
    expect(region()).not.toHaveAttribute('tabindex')
    expect(region().tabIndex).toBe(-1)
    expect(region()).toHaveAttribute('aria-busy', 'false')
    // 消息本身是 live region 的子节点，新增一条消息就是一次 additions。
    expect(messageNodes(region())).toHaveLength(2)
  })

  it('流式追加期间不逐分片新增播报节点：区域只置为 aria-busy，收尾后恢复', () => {
    const events = [user(1, 'u1', '添加小狗背景'), chunk(2, 'a', '正在')]
    const view = render(<CourseChatTranscript events={events} />)
    expect(region()).toHaveAttribute('aria-busy', 'true')
    const node = reply(view.container, 'a')!
    expect(node).toHaveTextContent('正在')
    expect(messageNodes(view.container)).toHaveLength(2)

    // 追加 5 个分片：既没有新增节点，也没有重建既有节点，因此 live region 不会
    // 产生 5 次 additions —— 不逐 token 播报。
    for (const piece of ['准备', '图片', '。', '请稍候', '。']) {
      events.push(chunk(events.length + 1, 'a', piece))
      view.rerender(<CourseChatTranscript events={[...events]} />)
      expect(reply(view.container, 'a')).toBe(node)
      expect(messageNodes(view.container)).toHaveLength(2)
      expect(region()).toHaveAttribute('aria-busy', 'true')
    }
    expect(node).toHaveTextContent('正在准备图片。请稍候。')

    // 收尾快照仍是同一个节点（原地改文本），busy 归零后这条消息才被播报一次。
    events.push(settled(events.length + 1, 'a', '正在准备图片。请稍候。'))
    view.rerender(<CourseChatTranscript events={[...events]} />)
    expect(region()).toHaveAttribute('aria-busy', 'false')
    expect(reply(view.container, 'a')).toBe(node)
    expect(messageNodes(view.container)).toHaveLength(2)

    // 下一条消息才是新的一次 additions：既有消息保持同一节点，不会被重播。
    events.push(settled(events.length + 1, 'b', '图片已经准备好。'))
    view.rerender(<CourseChatTranscript events={[...events]} />)
    expect(messageNodes(view.container)).toHaveLength(3)
    expect(reply(view.container, 'a')).toBe(node)
    expect(region()).toHaveAttribute('aria-busy', 'false')
  })

  it('原生回合收尾事件结束 aria-busy，避免流式状态永久挂起而不播报', () => {
    const events = [user(1, 'u1', '添加小狗背景'), chunk(2, 'a', '正在准备')]
    const view = render(<CourseChatTranscript events={events} />)
    expect(region()).toHaveAttribute('aria-busy', 'true')
    // 取消的回合可能只有追加分片、没有替换快照，收尾事件必须让区域恢复可播报。
    view.rerender(<CourseChatTranscript events={[...events, turnEnded(3, 'cancelled')]} />)
    expect(region()).toHaveAttribute('aria-busy', 'false')
    expect(region()).toHaveTextContent('正在准备')
    // 最后一条是用户消息（非文本事件）时同样不处于流式追加中。
    view.rerender(<CourseChatTranscript events={[...events, turnEnded(3, 'completed'), user(4, 'u2', '再快一点')]} />)
    expect(region()).toHaveAttribute('aria-busy', 'false')
  })

  it('正文分片与工具事件交错时保持 aria-busy，不中途回落', () => {
    // 复现评审实测：正文仍在追加期间夹入 tool-call／tool-result／usage，只看最后一个事件的
    // 实现会让 busy 回落，随后到达的分片就在「非 busy」状态下进入区域。
    const interleaved = (sequence: number, kind: 'tool-call' | 'tool-result' | 'usage'): LocalAgentEvent =>
      ({ version: 1, adapter: 'codex', sessionId, sequence, time: sequence, kind,
        payload: kind === 'usage'
          ? { input_tokens: 12, output_tokens: 3 }
          : { id: `tool-${sequence}`, name: 'read_file', status: kind === 'tool-call' ? 'started' : 'ok' } })
    const events: LocalAgentEvent[] = [user(1, 'u1', '读一下这个文件'), chunk(2, 'a', '正在')]
    const view = render(<CourseChatTranscript events={events} />)
    expect(region()).toHaveAttribute('aria-busy', 'true')
    const node = reply(view.container, 'a')!
    expect(messageNodes(view.container)).toHaveLength(2)

    for (const kind of ['tool-call', 'tool-result', 'usage'] as const) {
      events.push(interleaved(events.length + 1, kind))
      view.rerender(<CourseChatTranscript events={[...events]} />)
      expect(region(), `夹入 ${kind} 之后`).toHaveAttribute('aria-busy', 'true')
      // 工具事件不产生消息节点，因此也没有额外的 additions 播报。
      expect(messageNodes(view.container)).toHaveLength(2)
    }

    // 非正文事件之后到达的分片仍受 busy 保护，不产生新的 additions。
    events.push(chunk(events.length + 1, 'a', '准备'))
    view.rerender(<CourseChatTranscript events={[...events]} />)
    expect(region()).toHaveAttribute('aria-busy', 'true')
    expect(reply(view.container, 'a')).toBe(node)
    expect(messageNodes(view.container)).toHaveLength(2)

    // 定稿快照到达后才恢复播报，且仍是同一个节点。
    events.push(settled(events.length + 1, 'a', '正在准备'))
    view.rerender(<CourseChatTranscript events={[...events]} />)
    expect(region()).toHaveAttribute('aria-busy', 'false')
    expect(reply(view.container, 'a')).toBe(node)
  })

  it('一个会话收尾不影响另一个仍在追加的会话', () => {
    const other = '33333333-3333-4333-8333-333333333333'
    const foreign = (sequence: number, kind: 'text' | 'completed'): LocalAgentEvent =>
      ({ version: 1, adapter: 'claude', sessionId: other, sequence, time: sequence, kind,
        payload: kind === 'text'
          ? { messageId: `${runId}:b`, text: '另一个会话仍在写', phase: 'body', delta: true }
          : {} })
    const events = [user(1, 'u1', '并行两个 CLI'), chunk(2, 'a', '正在'), foreign(3, 'text'), turnEnded(4, 'completed')]
    render(<CourseChatTranscript events={events} />)
    // 本会话已收尾，但另一会话仍在追加：区域必须保持 busy，否则它的分片会被立即播报。
    expect(region()).toHaveAttribute('aria-busy', 'true')
  })

  it('失败与取消同样结束追加状态，不再把已结束的回合当作仍在流式', () => {
    // 取消与失败都可能只发过分片、没有整条替换快照，所以三种收尾都必须清除 busy。
    for (const kind of ['failed', 'cancelled'] as const) {
      const events = [user(1, 'u1', '添加小狗背景'), chunk(2, 'a', '正在'), turnEnded(3, kind)]
      const view = render(<CourseChatTranscript events={events} />)
      expect(region()).toHaveAttribute('aria-busy', 'false')
      cleanup()
      expect(view.container.isConnected).toBe(false)
    }
  })

  it('历史回合的收尾事件也结束它自己的追加状态，busy 不会挂到下一个回合', () => {
    // 只有分片、没有整条替换快照的历史回合，其收尾被投成 kind='session'（status='turn-ended'）。
    // 若不认这种收尾，反向扫描会越过回合末尾找到更早的分片，把 busy 一直挂在 true。
    const events = [user(1, 'u1', '第一轮'), chunk(2, 'a', '正在'), historicalTurnEnded(3), user(4, 'u2', '第二轮')]
    render(<CourseChatTranscript events={events} />)
    expect(region()).toHaveAttribute('aria-busy', 'false')
  })

  it('历史回合收尾之后的新分片仍受 busy 保护', () => {
    const events = [user(1, 'u1', '第一轮'), chunk(2, 'a', '正在'), historicalTurnEnded(3), user(4, 'u2', '第二轮'), chunk(5, 'b', '继续')]
    const view = render(<CourseChatTranscript events={events} />)
    expect(region()).toHaveAttribute('aria-busy', 'true')
    expect(reply(view.container, 'b')).toHaveTextContent('继续')
  })

  it('新消息与流式更新都不抢焦点，输入框和转写区内的焦点都留在原处', () => {
    const events = [user(1, 'u1', '添加小狗背景'), settled(2, 'a', '图片已经准备好。')]
    const view = render(<div><input aria-label="对话输入" /><CourseChatTranscript events={events} /></div>)
    const input = screen.getByLabelText('对话输入')
    input.focus()
    expect(document.activeElement).toBe(input)

    view.rerender(<div><input aria-label="对话输入" /><CourseChatTranscript events={[...events, chunk(3, 'b', '正在')]} /></div>)
    expect(document.activeElement).toBe(input)
    view.rerender(<div><input aria-label="对话输入" /><CourseChatTranscript events={[...events, settled(3, 'b', '正在准备第二张。'), user(4, 'u2', '再快一点')]} /></div>)
    expect(document.activeElement).toBe(input)
    expect(document.activeElement).not.toBe(region())

    // 焦点本来就在转写区内的消息上时（SafeChatMessage 是可聚焦的），更新同样不移动焦点。
    const message = view.container.querySelector<HTMLElement>('.chat-message')!
    message.focus()
    expect(document.activeElement).toBe(message)
    view.rerender(<div><input aria-label="对话输入" /><CourseChatTranscript events={[...events, settled(3, 'b', '正在准备第二张。'), user(4, 'u2', '再快一点'), chunk(5, 'c', '收到，')]} /></div>)
    expect(document.activeElement).toBe(message)
  })
})
