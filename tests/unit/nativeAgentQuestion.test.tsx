import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeAgentQuestion } from '../../src/renderer/ui/chat/NativeAgentQuestion'
import { createWorkspaceIdentity } from '../../src/main/workspaceIdentity'

afterEach(cleanup)

const workspace = createWorkspaceIdentity('question-announcement', '/lesson.h5lesson', 'linux')
const question = (questionId: string, title = '需要补充哪个年级？') => ({
  taskId: 'a40e7d4e-0045-4e77-a47d-4064947986d9',
  epoch: 0,
  workspace,
  questionId,
  turnId: `turn-${questionId}`,
  purpose: 'clarification' as const,
  questions: [{ id: 'grade', title, options: ['七年级', '八年级'], multiple: false }],
})

const permission = (questionId: string) => ({
  ...question(questionId, JSON.stringify({ command: 'rm -rf private-materials' })),
  purpose: 'permission' as const,
  questions: [{ id: 'allow', title: JSON.stringify({ command: 'rm -rf private-materials' }), options: ['Allow once', 'Reject'], multiple: false }],
})

describe('native agent question announcements', () => {
  it('announces one concise notice for the lifecycle and does not repeat on ordinary rerenders', async () => {
    const input = document.createElement('textarea')
    input.setAttribute('aria-label', '聊天输入')
    document.body.append(input)
    input.focus()
    const current = question('question-1')
    const view = render(<NativeAgentQuestion question={current} onAnswer={vi.fn()} />)
    const status = screen.getByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('创作助手有一个新问题，请在对话中查看并回答。'))
    expect(input).toHaveFocus()
    const changes: string[] = []
    const observer = new MutationObserver(() => changes.push(status.textContent ?? ''))
    observer.observe(status, { childList: true, characterData: true, subtree: true })
    view.rerender(<NativeAgentQuestion question={{ ...current, questions: [{ ...current.questions[0]!, title: '流式状态引发普通重渲染' }] }} onAnswer={vi.fn()} />)
    await new Promise(resolve => window.setTimeout(resolve, 10))
    observer.disconnect()
    expect(changes).toEqual([])
    expect(input).toHaveFocus()
    input.remove()
  })

  it('announces a new questionId even when the concise wording is unchanged without moving chat focus', async () => {
    const input = document.createElement('textarea')
    input.setAttribute('aria-label', '聊天输入')
    document.body.append(input)
    const view = render(<NativeAgentQuestion question={question('question-1')} onAnswer={vi.fn()} />)
    const status = screen.getByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('创作助手有一个新问题，请在对话中查看并回答。'))
    input.focus()
    const changes: string[] = []
    const observer = new MutationObserver(() => changes.push(status.textContent ?? ''))
    observer.observe(status, { childList: true, characterData: true, subtree: true })
    view.rerender(<NativeAgentQuestion question={question('question-2')} onAnswer={vi.fn()} />)
    await waitFor(() => expect(changes).toContain('创作助手有一个新问题，请在对话中查看并回答。'))
    observer.disconnect()
    expect(input).toHaveFocus()
    input.remove()
  })

  it('announces authorization distinctly without reading the full command into the live region', async () => {
    const input = document.createElement('textarea')
    document.body.append(input)
    input.focus()
    render(<NativeAgentQuestion question={permission('permission-1')} onAnswer={vi.fn()} />)
    const status = screen.getByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('创作助手请求授权，请在对话中查看并选择是否允许。'))
    expect(status).not.toHaveTextContent('rm -rf private-materials')
    expect(input).toHaveFocus()
    input.remove()
  })
})
