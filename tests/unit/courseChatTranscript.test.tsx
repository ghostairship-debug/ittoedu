import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { localAgentMessages, localAgentText, visibleLocalAgentText } from '../../src/shared/localAgentText'
import { projectV2RecordToV1 } from '../../src/shared/localAgentProjection'
import { localAgentRecordV2Schema, type LocalAgentEventV2 } from '../../src/shared/localAgentTaskContract'
import { CourseChatTranscript } from '../../src/renderer/ui/chat/CourseChatTranscript'
import type { LocalAgentEvent } from '../../src/shared/localAgentContract'

const sessionId = '11111111-1111-4111-8111-111111111111'
const runId = '22222222-2222-4222-8222-222222222222'
const taskId = '33333333-3333-4333-8333-333333333333'
const workspace = { version: 1 as const, projectId: 'public-chat', normalizedPath: 'c:/public-chat.h5lesson' }
function event(sequence: number, itemId: string, text: string, phase?: string, delta = false): LocalAgentEvent {
  return { version: 1, adapter: 'codex', sessionId, sequence, time: sequence,
    kind: 'text', payload: { messageId: `${runId}:${itemId}`, text, ...(phase ? { phase } : {}), ...(delta ? { delta: true } : {}) } }
}
afterEach(cleanup)
describe('readable native message transcript', () => {
  it('reconciles incremental and final native snapshots while retaining distinct messages, repairs and legacy text', () => {
    const events = [event(1, 'a', '先核对', 'progress', true), event(2, 'a', '当前页面。', 'progress', true),
      event(3, 'a', '先核对当前页面。', 'progress'), event(4, 'b', '图片已经准备好。'),
      event(5, 'c', '首次设置失败，继续检查背景目标。', 'public-summary'), event(6, 'd', '已完成剩余处理。', 'final')]
    const messages = localAgentMessages([...events, ...events])
    expect(messages.map(message => [message.phase, message.text])).toEqual([
      ['progress', '先核对当前页面。'], ['body', '图片已经准备好。'], ['public-summary', '首次设置失败，继续检查背景目标。'], ['final', '已完成剩余处理。'],
    ])
    const mounted = render(<CourseChatTranscript events={events} />)
    expect([...mounted.container.querySelectorAll('[data-message-id]')].map(node => node.getAttribute('data-message-id'))).toEqual(messages.map(message => message.id))
    for (const message of messages) expect(screen.getAllByText(message.text)).toHaveLength(1)
    const process = mounted.container.querySelector('details')!
    process.open = false
    mounted.rerender(<CourseChatTranscript events={[...events, event(7, 'd', '已完成剩余处理。请核对页面。', 'final')]} />)
    expect(process.open).toBe(false)
    expect(screen.getByRole('region', { name: '助手消息' })).toContainElement(screen.getByText('图片已经准备好。'))
  })

  it('extracts proposal summaries without displaying the candidate or asserting a host commit', () => {
    const candidate = '<courseware-candidate-v1>{"version":2,"requestId":"private-request","summary":"准备将卡通小狗设为背景。","steps":[]}</courseware-candidate-v1>'
    const events = [event(1, 'candidate', candidate, 'candidate')]
    const mounted = render(<CourseChatTranscript events={events} />)
    expect(screen.getByRole('region', { name: '待应用说明' })).toHaveTextContent('准备将卡通小狗设为背景。')
    expect(mounted.container).toHaveTextContent('以实际应用结果为准')
    expect(mounted.container.textContent).not.toMatch(/private-request|requestId|steps|已应用课件/)
    expect(localAgentText(events, { includeCandidates: true })).toBe(candidate)
    expect(visibleLocalAgentText('正在准备。<courseware-candi')).toBe('正在准备。')
    expect(visibleLocalAgentText('正在准备。<courseware-candidate-v1>{"requestId":')).toBe('正在准备。')
  })

  it('round trips user corrections and answers in the same V2 record without inventing automatic continuation turns', () => {
    const identity = { version: 2 as const, workspace, taskId, epoch: 0, sessionId, runId, nativeTurnId: 'native-turn' }
    const events: LocalAgentEventV2[] = [
      { ...identity, sequence: 1, time: 1, kind: 'user-message', itemId: 'initial', purpose: 'initial', text: '添加小狗背景' },
      { ...identity, sequence: 2, time: 2, kind: 'text', itemId: 'reply', phase: 'progress', operation: 'replace', text: '正在准备图片。' },
      { ...identity, sequence: 3, time: 3, kind: 'user-message', itemId: 'correction', purpose: 'correct', text: '保留正文颜色' },
      { ...identity, sequence: 4, time: 4, kind: 'turn-ended', status: 'completed', failure: null },
      { ...identity, runId: '44444444-4444-4444-8444-444444444444', sequence: 5, time: 5, kind: 'text', itemId: 'reply', operation: 'replace', text: '已收到失败说明，将尝试另一种方法。' },
      { ...identity, sequence: 6, time: 6, kind: 'turn-ended', status: 'completed', failure: null },
      { ...identity, sequence: 7, time: 7, kind: 'user-message', itemId: 'answer', purpose: 'answer', text: '同意使用浅色背景' },
    ]
    const record = localAgentRecordV2Schema.parse(JSON.parse(JSON.stringify({ version: 2, id: sessionId, adapter: 'codex', workspace,
      externalSessionId: 'native-thread', workingDirectoryId: sessionId, tasks: [{ version: 1, taskId, epoch: 0, workspace, sessionId, adapter: 'codex', goal: '添加小狗背景', intent: 'discuss', applyPolicy: 'preview', readScope: { kind: 'course' }, writeDestinations: [], status: 'completed', observationId: null, committedResultIds: [] }], observations: [], hostResults: [], events })))
    const display = projectV2RecordToV1(record)
    expect(display.status).toBe('completed')
    const messages = localAgentMessages(display.events)
    expect(messages.map(message => message.text)).toEqual(['添加小狗背景', '正在准备图片。', '保留正文颜色', '已收到失败说明，将尝试另一种方法。', '同意使用浅色背景'])
    expect(messages.filter(message => message.role === 'user')).toHaveLength(3)
    render(<CourseChatTranscript events={display.events} legacyInstruction="内部续轮不应成为用户发言" />)
    expect(screen.queryByText('内部续轮不应成为用户发言')).toBeNull()
    expect(screen.getAllByRole('region', { name: '用户消息' })).toHaveLength(3)
  })

  it('retains ordinary code, JSON, tables and user text while rendering actual API errors readably', () => {
    const events = [event(1, 'code', '```json\n{"example": true}\n```\n\n| 名称 | 值 |\n| --- | --- |\n| 电压 | 6V |'),
      event(2, 'error', 'API Error: 503 no active accounts available (request id: private-request)')]
    const mounted = render(<CourseChatTranscript events={events} />)
    expect(mounted.container.querySelector('code')?.textContent).toBe('{"example": true}')
    expect(screen.getByRole('cell', { name: '6V' })).toBeTruthy()
    expect(mounted.container.textContent).not.toContain('private-request')
    expect(mounted.container).toHaveTextContent('当前服务暂时不可用')
  })
})
