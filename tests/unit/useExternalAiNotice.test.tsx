import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  useExternalAiNotice,
  type ExternalAiNoticeController,
  type ExternalAiNoticeInput,
} from '../../src/renderer/ui/chat/useExternalAiNotice'
import { EXTERNAL_AI_NOTICE_VERSION } from '../../src/shared/externalAiNotice'
import type { LocalAgentRequest, LocalAgentResponse } from '../../src/shared/localAgentContract'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
}

const pendingResponse: LocalAgentResponse = {
  enabled: true,
  externalNotice: { version: EXTERNAL_AI_NOTICE_VERSION, confirmed: false },
}
const confirmedResponse: LocalAgentResponse = {
  enabled: true,
  externalNotice: { version: EXTERNAL_AI_NOTICE_VERSION, confirmed: true, confirmedAt: 123 },
}

function input(path = 'c:/courses/lesson.h5lesson'): ExternalAiNoticeInput {
  return {
    scope: { version: 1, projectId: 'project-a', normalizedPath: path },
    adapter: 'codex',
    references: ['电路教案.docx', '第 3 页 · 电阻 R1'],
  }
}

function mount(localAgent: (request: LocalAgentRequest) => Promise<LocalAgentResponse>, strict = false) {
  let controller!: ExternalAiNoticeController
  function Harness() {
    controller = useExternalAiNotice({ localAgent })
    return controller.dialog
  }
  const content = <><button data-testid="launcher">发送</button><Harness /></>
  const view = render(strict ? <StrictMode>{content}</StrictMode> : content)
  return { view, get controller() { return controller } }
}

describe('useExternalAiNotice', () => {
  it('remains mounted and completes ensure after a real StrictMode effect replay', async () => {
    const localAgent = vi.fn<(request: LocalAgentRequest) => Promise<LocalAgentResponse>>()
      .mockResolvedValueOnce(pendingResponse)
      .mockResolvedValueOnce(confirmedResponse)
    const mounted = mount(localAgent, true)
    let allowed!: Promise<boolean>
    act(() => { allowed = mounted.controller.ensure(input()) })
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeVisible()
    expect(dialog.parentElement?.parentElement).toBe(document.body)
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }))
    await expect(allowed).resolves.toBe(true)
  })

  it('public cancel resolves the old request false and permits a new scope while the stale read finishes late', async () => {
    const oldStatus = deferred<LocalAgentResponse>()
    const localAgent = vi.fn<(request: LocalAgentRequest) => Promise<LocalAgentResponse>>()
      .mockReturnValueOnce(oldStatus.promise)
      .mockResolvedValueOnce(pendingResponse)
      .mockResolvedValueOnce(confirmedResponse)
    const mounted = mount(localAgent)
    let oldAllowed!: Promise<boolean>
    act(() => { oldAllowed = mounted.controller.ensure(input()) })
    act(() => mounted.controller.cancel())
    await expect(oldAllowed).resolves.toBe(false)

    let newAllowed!: Promise<boolean>
    act(() => { newAllowed = mounted.controller.ensure(input('c:/courses/save-as.h5lesson')) })
    expect(await screen.findByRole('dialog')).toBeVisible()
    oldStatus.resolve(confirmedResponse)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('dialog')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }))
    await expect(newAllowed).resolves.toBe(true)
    expect(localAgent).toHaveBeenNthCalledWith(2, {
      operation: 'external-notice',
      scope: { version: 1, projectId: 'project-a', normalizedPath: 'c:/courses/save-as.h5lesson' },
    })
  })

  it('locks the actual references and scope, then continues only after local confirmation succeeds', async () => {
    const localAgent = vi.fn<(request: LocalAgentRequest) => Promise<LocalAgentResponse>>()
      .mockResolvedValueOnce(pendingResponse)
      .mockResolvedValueOnce(confirmedResponse)
    const mounted = mount(localAgent)
    const task = input()
    let allowed!: Promise<boolean>
    act(() => { allowed = mounted.controller.ensure(task) })
    task.references[0] = '被调用方后来改掉的引用'
    if ('normalizedPath' in task.scope) task.scope.normalizedPath = 'c:/courses/stale-copy.h5lesson'

    expect(await screen.findByRole('dialog', { name: '发送前了解外部处理范围' })).toBeVisible()
    expect(screen.getByText('电路教案.docx')).toBeVisible()
    expect(screen.queryByText('被调用方后来改掉的引用')).toBeNull()
    expect(screen.getByRole('dialog')).toHaveTextContent('当前文档全文会作为上下文提供给 CLI')
    expect(screen.getByRole('dialog')).not.toHaveTextContent('baseline.md')
    expect(screen.getByRole('dialog')).toHaveTextContent('选区只限定本次允许修改的范围')
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }))

    await expect(allowed).resolves.toBe(true)
    expect(localAgent).toHaveBeenNthCalledWith(1, {
      operation: 'external-notice',
      scope: { version: 1, projectId: 'project-a', normalizedPath: 'c:/courses/lesson.h5lesson' },
    })
    expect(localAgent).toHaveBeenNthCalledWith(2, {
      operation: 'external-notice',
      scope: { version: 1, projectId: 'project-a', normalizedPath: 'c:/courses/lesson.h5lesson' },
      confirm: true,
    })
  })

  it('cancels a second task while one notice is pending and Escape restores focus with zero confirmation', async () => {
    const localAgent = vi.fn<(request: LocalAgentRequest) => Promise<LocalAgentResponse>>().mockResolvedValue(pendingResponse)
    const mounted = mount(localAgent)
    const launcher = screen.getByTestId('launcher')
    launcher.focus()
    let first!: Promise<boolean>
    act(() => { first = mounted.controller.ensure(input()) })
    expect(await screen.findByRole('dialog')).toBeVisible()
    await waitFor(() => expect(screen.getByRole('button', { name: '取消发送' })).toHaveFocus())

    await expect(mounted.controller.ensure(input('c:/courses/save-as.h5lesson'))).resolves.toBe(false)
    fireEvent.keyDown(window, { key: 'Escape' })
    await expect(first).resolves.toBe(false)
    await waitFor(() => expect(launcher).toHaveFocus())
    expect(localAgent).toHaveBeenCalledTimes(1)
  })

  it('returns false on unmount and ignores a late status for the stale scope', async () => {
    const status = deferred<LocalAgentResponse>()
    const localAgent = vi.fn<(request: LocalAgentRequest) => Promise<LocalAgentResponse>>().mockReturnValue(status.promise)
    const mounted = mount(localAgent)
    let allowed!: Promise<boolean>
    act(() => { allowed = mounted.controller.ensure(input()) })
    mounted.view.unmount()
    await expect(allowed).resolves.toBe(false)
    status.resolve(confirmedResponse)
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lets a failed local write be retried without resolving the send early', async () => {
    const localAgent = vi.fn<(request: LocalAgentRequest) => Promise<LocalAgentResponse>>()
      .mockResolvedValueOnce(pendingResponse)
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(confirmedResponse)
    const mounted = mount(localAgent)
    let allowed!: Promise<boolean>
    act(() => { allowed = mounted.controller.ensure(input()) })
    expect(await screen.findByRole('dialog')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('本地确认没有保存')
    expect(screen.getByRole('dialog')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '重试确认并继续' }))
    await expect(allowed).resolves.toBe(true)
    expect(localAgent).toHaveBeenCalledTimes(3)
  })

  it('skips the dialog for a matching confirmation and exposes a non-sending review entry', async () => {
    const localAgent = vi.fn<(request: LocalAgentRequest) => Promise<LocalAgentResponse>>().mockResolvedValue(confirmedResponse)
    const mounted = mount(localAgent)
    await expect(mounted.controller.ensure(input())).resolves.toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()

    act(() => mounted.controller.review({ ...input(), adapter: 'opencode' }))
    expect(screen.getByRole('dialog', { name: '查看外部处理说明' })).toHaveTextContent('OpenCode CLI')
    expect(localAgent).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
