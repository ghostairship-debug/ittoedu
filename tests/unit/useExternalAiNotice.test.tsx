import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  useExternalAiNotice,
  type ExternalAiNoticeController,
  type ExternalAiNoticeInput,
} from '../../src/renderer/ui/chat/useExternalAiNotice'
import { EXTERNAL_AI_NOTICE_VERSION } from '../../src/shared/externalAiNotice'
import type { ExternalReferencesScope, LocalAgentRequest, LocalAgentResponse } from '../../src/shared/localAgentContract'

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

/** Main's list, not the renderer's: these strings are what the dialog must show. */
const AUTHORITATIVE = [
  '工程：c:/courses/lesson.h5lesson（完整可编辑内容）',
  '课例：c:/courses/lesson.h5lesson（全部教学文档全文：01-teaching-plan.md）',
]
const ADDITIONAL = '文档：lesson.md（全文作为上下文；允许修改：选区）'
const SCOPE = { version: 1, projectId: 'project-a', normalizedPath: 'c:/courses/lesson.h5lesson' } as const
const CONVERSATION: ExternalReferencesScope = {
  kind: 'conversation',
  workspace: { version: 1, kind: 'directory', normalizedDirectory: 'c:/courses', conversationId: '3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607' },
  prompt: '讲一下电阻',
}

function input(path: string = SCOPE.normalizedPath): ExternalAiNoticeInput {
  return { scope: { ...SCOPE, normalizedPath: path }, adapter: 'codex', referencesScope: structuredClone(CONVERSATION), additionalReferences: [ADDITIONAL] }
}

/** Scripts one step per call of that operation, repeating the last step. */
function sequence(...steps: (LocalAgentResponse | Error)[]): (call: number) => Promise<LocalAgentResponse> {
  return call => {
    const step = steps[Math.min(call - 1, steps.length - 1)]!
    return step instanceof Error ? Promise.reject(step) : Promise.resolve(step)
  }
}

function harness(options: {
  notice?: (call: number) => Promise<LocalAgentResponse>
  references?: (call: number) => Promise<LocalAgentResponse>
} = {}) {
  const calls: LocalAgentRequest[] = []
  const localAgent = vi.fn(async (request: LocalAgentRequest): Promise<LocalAgentResponse> => {
    calls.push(request)
    const count = calls.filter(item => item.operation === request.operation).length
    if (request.operation === 'external-references') {
      return options.references ? options.references(count) : { enabled: true, externalReferences: [...AUTHORITATIVE] }
    }
    if (request.operation === 'external-notice') return options.notice ? options.notice(count) : pendingResponse
    throw new Error(`unexpected operation: ${request.operation}`)
  })
  return {
    localAgent,
    calls,
    noticeCalls: () => calls.filter(item => item.operation === 'external-notice'),
    referenceCalls: () => calls.filter(item => item.operation === 'external-references'),
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
    const scripted = harness({ notice: sequence(pendingResponse, confirmedResponse) })
    const mounted = mount(scripted.localAgent, true)
    let allowed!: Promise<boolean>
    act(() => { allowed = mounted.controller.ensure(input()) })
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeVisible()
    expect(dialog.parentElement?.parentElement).toBe(document.body)
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }))
    await expect(allowed).resolves.toBe(true)
    expect(scripted.noticeCalls()).toHaveLength(2)
  })

  it('public cancel resolves the old request false and permits a new scope while the stale read finishes late', async () => {
    const oldStatus = deferred<LocalAgentResponse>()
    const scripted = harness({ notice: call => call === 1 ? oldStatus.promise : Promise.resolve(call === 2 ? pendingResponse : confirmedResponse) })
    const mounted = mount(scripted.localAgent)
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
    expect(scripted.noticeCalls()[1]).toEqual({
      operation: 'external-notice',
      scope: { version: 1, projectId: 'project-a', normalizedPath: 'c:/courses/save-as.h5lesson' },
      adapter: 'codex',
    })
  })

  it('shows the list Main computes, appends renderer-only facts, and freezes both against later caller mutation', async () => {
    const scripted = harness({ notice: sequence(pendingResponse, confirmedResponse) })
    const mounted = mount(scripted.localAgent)
    const extra = [ADDITIONAL]
    const task = input()
    task.additionalReferences = extra
    let allowed!: Promise<boolean>
    act(() => { allowed = mounted.controller.ensure(task) })
    extra[0] = '被调用方后来改掉的引用'
    if ('normalizedPath' in task.scope) task.scope.normalizedPath = 'c:/courses/stale-copy.h5lesson'
    if (task.referencesScope?.kind === 'conversation') task.referencesScope.prompt = '被调用方后来改掉的提示'

    const dialog = await screen.findByRole('dialog', { name: '发送前了解外部处理范围' })
    expect(screen.getByText(AUTHORITATIVE[0]!)).toBeVisible()
    expect(screen.getByText(AUTHORITATIVE[1]!)).toBeVisible()
    expect(screen.getByText(ADDITIONAL)).toBeVisible()
    expect(screen.queryByText('被调用方后来改掉的引用')).toBeNull()
    expect(dialog).toHaveTextContent('当前文档全文会作为上下文提供给 CLI')
    expect(dialog).not.toHaveTextContent('baseline.md')
    expect(dialog).toHaveTextContent('选区只限定本次允许修改的范围')
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }))

    await expect(allowed).resolves.toBe(true)
    expect(scripted.referenceCalls()[0]).toEqual({ operation: 'external-references', scope: CONVERSATION })
    expect(scripted.noticeCalls()[0]).toEqual({ operation: 'external-notice', scope: SCOPE, adapter: 'codex' })
    expect(scripted.noticeCalls()[1]).toEqual({ operation: 'external-notice', scope: SCOPE, adapter: 'codex', confirm: true })
  })

  it('reads and records the confirmation per CLI, so a second CLI is not covered by the first', async () => {
    const scripted = harness({ notice: () => Promise.resolve(confirmedResponse) })
    const mounted = mount(scripted.localAgent)
    await expect(mounted.controller.ensure(input())).resolves.toBe(true)
    await expect(mounted.controller.ensure({ ...input(), adapter: 'claude' })).resolves.toBe(true)
    expect(scripted.noticeCalls()).toHaveLength(2)
    expect(scripted.noticeCalls()[0]).toMatchObject({ adapter: 'codex' })
    expect(scripted.noticeCalls()[1]).toMatchObject({ adapter: 'claude' })
  })

  it('refuses to confirm and never records a confirmation when Main returns no reference list', async () => {
    const scripted = harness({ notice: sequence(pendingResponse, confirmedResponse), references: () => Promise.resolve({ enabled: true }) })
    const mounted = mount(scripted.localAgent)
    let allowed!: Promise<boolean>
    act(() => { allowed = mounted.controller.ensure(input()) })
    expect(await screen.findByRole('dialog')).toHaveTextContent('尚未读到本轮引用清单')

    fireEvent.click(screen.getByRole('button', { name: '重试确认并继续' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('没有读到本轮显式引用清单'))
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(scripted.noticeCalls().some(call => 'confirm' in call)).toBe(false)
    expect(scripted.noticeCalls()).toHaveLength(1)
  })

  // Main's list is frozen before the harness appends its task-context resources (harness.ts:313,
  // :374, :378, :381-382 add pending-host-results.json / host-result.json /
  // observation/host-feedback.json / repair/component-changes-<requestId>/…). The dialog must
  // therefore present the list as the explicit references, never as everything that is sent.
  it('never presents the reference list as everything that is sent', async () => {
    const scripted = harness()
    const mounted = mount(scripted.localAgent)
    act(() => mounted.controller.review({ scope: SCOPE, adapter: 'codex' }))
    const dialog = await screen.findByRole('dialog', { name: '查看外部处理说明' })
    expect(screen.getByRole('region', { name: '本轮显式引用' })).toBeVisible()
    expect(dialog).not.toHaveTextContent('本轮实际引用')
    expect(dialog).toHaveTextContent('这份清单只列显式引用')
    expect(dialog).toHaveTextContent('自动把上一阶段的宿主结果、组件修复输入等任务上下文文件放进 CLI 的工作目录')
  })

  it('does not claim an empty list when no reference target is frozen yet', async () => {
    const scripted = harness()
    const mounted = mount(scripted.localAgent)
    act(() => mounted.controller.review({ scope: SCOPE, adapter: 'codex' }))
    const dialog = await screen.findByRole('dialog', { name: '查看外部处理说明' })
    expect(dialog).toHaveTextContent('本轮尚未冻结引用目标')
    expect(dialog).not.toHaveTextContent('本轮没有显式引用')
    expect(scripted.referenceCalls()).toHaveLength(0)
  })

  it('cancels a second task while one notice is pending and Escape restores focus with zero confirmation', async () => {
    const scripted = harness()
    const mounted = mount(scripted.localAgent)
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
    expect(scripted.noticeCalls()).toHaveLength(1)
    expect(scripted.referenceCalls()).toHaveLength(1)
    expect(scripted.noticeCalls().some(call => 'confirm' in call)).toBe(false)
  })

  it('returns false on unmount and ignores a late status for the stale scope', async () => {
    const status = deferred<LocalAgentResponse>()
    const scripted = harness({ notice: () => status.promise })
    const mounted = mount(scripted.localAgent)
    let allowed!: Promise<boolean>
    act(() => { allowed = mounted.controller.ensure(input()) })
    mounted.view.unmount()
    await expect(allowed).resolves.toBe(false)
    status.resolve(confirmedResponse)
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lets a failed local write be retried without resolving the send early', async () => {
    const scripted = harness({ notice: sequence(pendingResponse, new Error('storage unavailable'), confirmedResponse) })
    const mounted = mount(scripted.localAgent)
    let allowed!: Promise<boolean>
    act(() => { allowed = mounted.controller.ensure(input()) })
    expect(await screen.findByRole('dialog')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('本地确认没有保存')
    expect(screen.getByRole('dialog')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '重试确认并继续' }))
    await expect(allowed).resolves.toBe(true)
    expect(scripted.noticeCalls()).toHaveLength(3)
    expect(scripted.referenceCalls()).toHaveLength(3)
  })

  it('skips the dialog for a matching confirmation and exposes a non-sending review entry', async () => {
    const scripted = harness({ notice: () => Promise.resolve(confirmedResponse) })
    const mounted = mount(scripted.localAgent)
    await expect(mounted.controller.ensure(input())).resolves.toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(scripted.referenceCalls()).toHaveLength(0)

    act(() => mounted.controller.review({ ...input(), adapter: 'opencode' }))
    expect(screen.getByRole('dialog', { name: '查看外部处理说明' })).toHaveTextContent('OpenCode CLI')
    expect(await screen.findByText(AUTHORITATIVE[0]!)).toBeVisible()
    expect(scripted.noticeCalls()).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
