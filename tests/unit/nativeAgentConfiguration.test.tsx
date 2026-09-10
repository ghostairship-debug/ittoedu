import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeAgentConfiguration } from '../../src/renderer/ui/chat/NativeAgentConfiguration'
import type { LocalAgentCapabilities, LocalAgentRequest, LocalAgentResponse } from '../../src/shared/localAgentContract'

const desktop = Object.getOwnPropertyDescriptor(window, 'desktopAPI')
const workspace = { projectId: 'course', projectPath: 'C:/lessons/circuit.h5lesson' }
afterEach(() => {
  cleanup()
  if (desktop) Object.defineProperty(window, 'desktopAPI', desktop)
  else Reflect.deleteProperty(window, 'desktopAPI')
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function capabilities(count = 2, adapter: LocalAgentCapabilities['adapter'] = 'opencode'): LocalAgentCapabilities {
  const models: LocalAgentCapabilities['models'] = Array.from({ length: count }, (_, index) => ({
    id: `provider/native-${count - index}`, label: `原生模型 ${count - index}`, resolvedModel: null, image: 'unknown',
    effort: { kind: 'supported', values: ['low', 'high'], default: 'low' },
  }))
  return { version: 1, adapter, cliVersion: 'fixture', models,
    current: { model: models[0]?.id ?? null, resolvedModel: null, effort: models.length ? 'high' : null },
    input: { image: 'unknown', readFile: 'supported', question: 'text', correction: 'turn-boundary', cancel: 'supported' } }
}
function install(operate: (input: LocalAgentRequest) => Promise<LocalAgentResponse>) {
  const localAgent = vi.fn(operate)
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { localAgent } })
  return localAgent
}

it('shows directory loading and preserves all native model IDs and order without refreshing on rerender', async () => {
  const pending = deferred<LocalAgentResponse>()
  const operate = install(() => pending.promise)
  const view = render(<NativeAgentConfiguration adapter="opencode" configurationSequence={0} {...workspace} />)
  expect(screen.getByText('正在读取原生模型目录…')).toBeTruthy()
  expect(screen.getByLabelText('模型')).toBeDisabled()
  expect(screen.getByRole('button', { name: '刷新模型目录' })).toBeDisabled()
  expect(operate).toHaveBeenCalledWith({ operation: 'capabilities', adapter: 'opencode', ...workspace })
  const caps = capabilities(329)
  await act(async () => { pending.resolve({ enabled: true, capabilities: caps }) })
  const select = screen.getByLabelText<HTMLSelectElement>('模型')
  expect(select).not.toBeDisabled()
  expect(within(select).getAllByRole<HTMLOptionElement>('option').slice(1).map(option => option.value)).toEqual(caps.models.map(model => model.id))
  expect(select).toHaveValue(caps.current.model)
  expect(screen.getByText('已读取 329 个原生模型。')).toBeTruthy()
  view.rerender(<NativeAgentConfiguration adapter="opencode" configurationSequence={0} {...workspace} />)
  expect(operate).toHaveBeenCalledTimes(1)
  view.rerender(<NativeAgentConfiguration adapter="opencode" configurationSequence={1} {...workspace} />)
  await waitFor(() => expect(operate).toHaveBeenCalledTimes(2))
  expect(operate.mock.calls[1]?.[0]).toEqual({ operation: 'capabilities', adapter: 'opencode', ...workspace })
})

it('distinguishes a native empty directory from a missing directory response', async () => {
  const operate = install(async () => ({ enabled: true, capabilities: capabilities(0) }))
  render(<NativeAgentConfiguration adapter="opencode" configurationSequence={0} />)
  expect(await screen.findByText('原生 CLI 返回的模型目录为空。请检查 CLI 配置后刷新。')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByLabelText('模型')).toBeDisabled()
  expect(screen.getByRole('button', { name: '刷新模型目录' })).not.toBeDisabled()
  operate.mockResolvedValueOnce({ enabled: true })
  fireEvent.click(screen.getByRole('button', { name: '刷新模型目录' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('未取得原生模型目录。')
  expect(screen.queryByText('原生 CLI 返回的模型目录为空。请检查 CLI 配置后刷新。')).toBeNull()
})

it('refreshes a failed directory in the same workspace and makes the recovered native choices usable', async () => {
  const refreshed = deferred<LocalAgentResponse>()
  const operate = install(async () => { throw new Error('原生目录解析失败') })
  render(<NativeAgentConfiguration adapter="opencode" configurationSequence={0} {...workspace} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('原生目录解析失败')
  expect(screen.getByText('模型目录读取失败，请刷新重试。')).toBeTruthy()
  operate.mockImplementationOnce(() => refreshed.promise)
  fireEvent.click(screen.getByRole('button', { name: '刷新模型目录' }))
  expect(operate).toHaveBeenLastCalledWith({ operation: 'capabilities', adapter: 'opencode', ...workspace, refresh: true })
  expect(screen.getByText('正在刷新原生模型目录…')).toBeTruthy()
  expect(screen.getByRole('button', { name: '刷新中…' })).toBeDisabled()
  expect(screen.getByLabelText('模型')).toBeDisabled()
  await act(async () => { refreshed.resolve({ enabled: true, capabilities: capabilities() }) })
  expect(screen.getByLabelText('模型')).not.toBeDisabled()
  expect(screen.getByLabelText('强度')).toHaveValue('high')
  expect(screen.queryByRole('alert')).toBeNull()
})

it('keeps failed refresh data visibly stale and disabled until another refresh succeeds', async () => {
  const caps = capabilities()
  const operate = install(async () => ({ enabled: true, capabilities: caps }))
  render(<NativeAgentConfiguration adapter="opencode" configurationSequence={0} />)
  await waitFor(() => expect(screen.getByLabelText('模型')).not.toBeDisabled())
  operate.mockRejectedValueOnce(new Error('原生目录查询超时'))
  fireEvent.click(screen.getByRole('button', { name: '刷新模型目录' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('原生目录查询超时')
  expect(screen.getByText('模型目录读取失败，当前显示上次读取的目录，暂不可选择。')).toBeTruthy()
  expect(screen.getByLabelText('模型')).toHaveValue(caps.current.model)
  expect(screen.getByLabelText('模型')).toBeDisabled()
  expect(screen.getByLabelText('强度')).toBeDisabled()
  expect(screen.getByText('上次确认：provider/native-2 · high')).toBeTruthy()
  expect(screen.queryByText(/^已生效：/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '刷新模型目录' }))
  await waitFor(() => expect(screen.getByLabelText('模型')).not.toBeDisabled())
  expect(screen.getByText('已生效：provider/native-2 · high')).toBeTruthy()
})

it('keeps confirmed model and effort visible beside the next-turn request using the same workspace', async () => {
  const caps = capabilities()
  const operate = install(async request => ({ enabled: true, capabilities: request.operation === 'configure'
    ? { ...caps, requestedConfiguration: request.configuration } : caps }))
  render(<NativeAgentConfiguration adapter="opencode" configurationSequence={0} {...workspace} />)
  await waitFor(() => expect(screen.getByLabelText('模型')).not.toBeDisabled())
  fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'provider/native-1' } })
  await waitFor(() => expect(screen.getByLabelText('模型')).toHaveValue('provider/native-1'))
  expect(operate).toHaveBeenLastCalledWith({ operation: 'configure', adapter: 'opencode', ...workspace,
    configuration: { model: 'provider/native-1', effort: 'low' } })
  expect(screen.getByText('已生效：provider/native-2 · high')).toBeTruthy()
  expect(screen.getByText(/待应用：provider\/native-1 · low/)).toHaveTextContent('所选配置将在下次发送或继续时应用')
  expect(screen.getByLabelText('强度')).toHaveValue('low')
  expect(screen.queryByText('已生效：provider/native-1 · low')).toBeNull()
})

it.each([
  ['directory', 'workspace'], ['configuration', 'workspace'], ['directory', 'adapter'], ['configuration', 'adapter'],
] as const)('ignores late %s responses after changing only the %s', async (operation, changed) => {
  const previous = deferred<LocalAgentResponse>()
  const oldCaps = capabilities()
  const nextAdapter = changed === 'adapter' ? 'claude' : 'opencode'
  const nextWorkspace = changed === 'workspace' ? { projectId: 'course-copy', projectPath: 'C:/lessons/circuit-copy.h5lesson' } : workspace
  const newCaps = capabilities(1, nextAdapter)
  const operate = install(async request => ('adapter' in request && request.adapter === 'claude')
    || ('projectPath' in request && request.projectPath !== workspace.projectPath)
    ? { enabled: true, capabilities: newCaps }
    : operation === 'directory' || request.operation === 'configure' ? previous.promise : { enabled: true, capabilities: oldCaps })
  const view = render(<NativeAgentConfiguration adapter="opencode" configurationSequence={0} {...workspace} />)
  if (operation === 'configuration') {
    await waitFor(() => expect(screen.getByLabelText('模型')).not.toBeDisabled())
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'provider/native-1' } })
  }
  view.rerender(<NativeAgentConfiguration adapter={nextAdapter} configurationSequence={0} {...nextWorkspace} />)
  await waitFor(() => expect(screen.getByLabelText('模型')).toHaveValue(newCaps.current.model))
  await act(async () => { previous.resolve({ enabled: true, capabilities: oldCaps }) })
  expect(screen.getByLabelText('模型')).toHaveValue(newCaps.current.model)
  expect(screen.getByText('已读取 1 个原生模型。')).toBeTruthy()
  expect(screen.queryByText('已读取 2 个原生模型。')).toBeNull()
  expect(operate).toHaveBeenLastCalledWith({ operation: 'capabilities', adapter: nextAdapter, ...nextWorkspace })
})

it.each(['success', 'failure'] as const)('waits for configuration %s before reading an intervening native update', async outcome => {
  const caps = capabilities()
  const saved = deferred<LocalAgentResponse>()
  let latest = caps
  const operate = install(async request => request.operation === 'configure' ? saved.promise : { enabled: true, capabilities: latest })
  const view = render(<NativeAgentConfiguration adapter="opencode" configurationSequence={0} />)
  await waitFor(() => expect(screen.getByLabelText('模型')).not.toBeDisabled())
  fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'provider/native-1' } })
  expect(screen.getByLabelText('模型')).toBeDisabled()
  view.rerender(<NativeAgentConfiguration adapter="opencode" configurationSequence={1} />)
  expect(operate).toHaveBeenCalledTimes(2)
  expect(screen.getByLabelText('模型')).toBeDisabled()
  await act(async () => {
    if (outcome === 'success') {
      latest = { ...caps, requestedConfiguration: { model: 'provider/native-1', effort: 'low' } }
      saved.resolve({ enabled: true, capabilities: latest })
    } else saved.reject(new Error('原生 CLI 拒绝当前配置'))
  })
  await waitFor(() => expect(operate).toHaveBeenCalledTimes(3))
  expect(screen.getByLabelText('模型')).not.toBeDisabled()
  if (outcome === 'success') {
    expect(screen.getByText(/待应用：provider\/native-1 · low/)).toBeTruthy()
    expect(screen.getByLabelText('模型')).toHaveValue('provider/native-1')
  } else {
    expect(screen.getByRole('alert')).toHaveTextContent('原生 CLI 拒绝当前配置')
    expect(screen.getByLabelText('模型')).toHaveValue(caps.current.model)
  }
})
