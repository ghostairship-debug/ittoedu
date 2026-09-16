import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeAgentQuestion } from '../../src/renderer/ui/chat/NativeAgentQuestion'
import { NativeAgentConfiguration } from '../../src/renderer/ui/chat/NativeAgentConfiguration'
import { createWorkspaceIdentity } from '../../src/main/workspaceIdentity'
import type { AiUserInput } from '../../src/shared/localAgentInteraction'

const desktop = Object.getOwnPropertyDescriptor(window, 'desktopAPI')
afterEach(() => {
  cleanup()
  if (desktop) Object.defineProperty(window, 'desktopAPI', desktop)
  else Reflect.deleteProperty(window, 'desktopAPI')
})
it('requires an explicit permission choice and sends the exact question and task identity', async () => {
  const question = { taskId: crypto.randomUUID(), epoch: 3, workspace: createWorkspaceIdentity('project', '/lesson.h5lesson', 'linux'),
    questionId: 'permission-1', turnId: 'turn-1', purpose: 'permission' as const,
    questions: [{ id: 'tool-1', title: '写入本次课例的图片文件', multiple: false, options: ['允许这次操作', '拒绝这次操作'] }] }
  const answer = vi.fn<(input: AiUserInput) => Promise<void>>().mockResolvedValue(undefined)
  render(<NativeAgentQuestion question={question} onAnswer={answer} />)
  expect(answer).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '确认选择' })).toBeDisabled()
  fireEvent.click(screen.getByLabelText('拒绝这次操作'))
  fireEvent.click(screen.getByRole('button', { name: '确认选择' }))
  await waitFor(() => expect(answer).toHaveBeenCalledTimes(1))
  expect(answer.mock.calls[0]?.[0]).toMatchObject({ kind: 'answer', taskId: question.taskId, epoch: 3, workspace: question.workspace,
    questionId: 'permission-1', turnId: 'turn-1', answers: [{ id: 'tool-1', values: ['拒绝这次操作'] }] })
})
it('keeps a rejected answer visible so the teacher can correct and resend it', async () => {
  const question = { taskId: crypto.randomUUID(), epoch: 0, workspace: createWorkspaceIdentity('project', '/lesson.h5lesson', 'linux'),
    questionId: 'question-1', turnId: 'turn-1',
    questions: [{ id: 'grade', title: '适用年级', multiple: false, options: [] }] }
  const answer = vi.fn(async () => { throw new Error('当前回答无效') })
  render(<NativeAgentQuestion question={question} onAnswer={answer} />)
  fireEvent.change(screen.getByLabelText('适用年级：填写回答'), { target: { value: '八年级' } })
  fireEvent.click(screen.getByRole('button', { name: '发送回答' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('当前回答无效')
  expect(screen.getByRole('button', { name: '发送回答' })).not.toBeDisabled()
})
it('shows a selected model as pending until a native configuration event is observed', async () => {
  const caps = { version: 1, adapter: 'claude', cliVersion: 'fixture',
    models: [
      { id: 'default', resolvedModel: null, label: '原生默认', image: 'unknown', effort: { kind: 'unsupported' } },
      { id: 'chosen', resolvedModel: 'chosen-v1', label: '选定模型', image: 'supported', effort: { kind: 'supported', values: ['low', 'high'], default: 'low' } },
    ], current: { model: 'default', resolvedModel: null, effort: null },
    input: { image: 'supported', readFile: 'supported', question: 'structured', correction: 'active-turn', cancel: 'supported' } }
  let confirmed = false
  const operate = vi.fn(async (input: { operation: string }) => ({ enabled: true, capabilities: input.operation === 'configure'
    ? { ...caps, requestedConfiguration: { model: 'chosen', effort: 'low' } }
    : confirmed ? { ...caps, current: { model: 'chosen', resolvedModel: 'chosen-v1', effort: 'low' } } : caps }))
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { localAgent: operate } })
  const view = render(<NativeAgentConfiguration adapter="claude" configurationSequence={0} />)
  await waitFor(() => expect(screen.getByLabelText('模型')).toHaveValue('default'))
  fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'chosen' } })
  await waitFor(() => expect(operate).toHaveBeenCalledWith({ operation: 'configure', adapter: 'claude', configuration: { model: 'chosen', effort: 'low' } }))
  expect(await screen.findByText(/所选配置将在下次发送/)).toBeTruthy()
  expect(screen.queryByText(/最近原生确认：chosen-v1/)).toBeNull()
  confirmed = true
  view.rerender(<NativeAgentConfiguration adapter="claude" configurationSequence={10} />)
  expect(await screen.findByText('最近原生确认：chosen-v1 · low')).toBeTruthy()
  expect(screen.queryByText(/所选配置将在下次发送/)).toBeNull()
})
