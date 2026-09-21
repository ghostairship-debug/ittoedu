import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeAgentDiagnostics } from '../../src/renderer/ui/chat/NativeAgentDiagnostics'
import type { LocalAgentProbe, LocalAgentResponse } from '../../src/shared/localAgentContract'

const desktop = Object.getOwnPropertyDescriptor(window, 'desktopAPI')

afterEach(() => {
  cleanup()
  if (desktop) Object.defineProperty(window, 'desktopAPI', desktop)
  else Reflect.deleteProperty(window, 'desktopAPI')
})

function install(operate: (input: { operation: 'probe'; adapter: LocalAgentProbe['adapter'] }) => Promise<LocalAgentResponse>) {
  const localAgent = vi.fn(operate)
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { localAgent } })
  return localAgent
}

function response(adapter: LocalAgentProbe['adapter'], status: LocalAgentProbe['status'], version = '1.0.0'): LocalAgentResponse {
  return { enabled: true, probe: { adapter, status, version, message: status } }
}

it('recovers from missing to ready after a manual refresh', async () => {
  const operate = install(async input => operate.mock.calls.length === 1
    ? response(input.adapter, 'missing')
    : response(input.adapter, 'ready', '2.0.0'))
  render(<NativeAgentDiagnostics adapter="codex" />)

  expect(await screen.findByText(/Codex：未安装/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '刷新 Codex CLI 诊断' }))
  expect(operate).toHaveBeenLastCalledWith({ operation: 'probe', adapter: 'codex' })
  expect(await screen.findByText(/Codex：已就绪。版本 2\.0\.0/)).toBeTruthy()
  expect(screen.getByText(/状态：已就绪/)).toBeTruthy()
})

it('keeps a late probe from the previous adapter out of the current diagnosis', async () => {
  let resolveOld!: (value: LocalAgentResponse) => void
  const oldProbe = new Promise<LocalAgentResponse>(resolve => { resolveOld = resolve })
  const operate = install(async input => input.adapter === 'opencode' ? oldProbe : response('claude', 'ready', '2.1.0'))
  const view = render(<NativeAgentDiagnostics adapter="opencode" />)
  view.rerender(<NativeAgentDiagnostics adapter="claude" />)

  expect(await screen.findByText(/Claude：已就绪。版本 2\.1\.0/)).toBeTruthy()
  await act(async () => { resolveOld(response('opencode', 'missing')) })
  expect(screen.queryByText(/OpenCode：未安装/)).toBeNull()
  expect(screen.getByText(/状态：已就绪/)).toBeTruthy()
})

it('retains a failed diagnosis and allows a successful retry', async () => {
  const operate = install(async () => {
    if (operate.mock.calls.length === 1) throw new Error('CLI 探测暂时失败')
    return response('claude', 'unknown-auth', '1.2.3')
  })
  render(<NativeAgentDiagnostics adapter="claude" />)

  expect(await screen.findByRole('alert')).toHaveTextContent('CLI 探测暂时失败')
  fireEvent.click(screen.getByRole('button', { name: '刷新 Claude CLI 诊断' }))
  await waitFor(() => expect(screen.getByText(/Claude：认证状态未知。版本 1\.2\.3/)).toBeTruthy())
  expect(screen.getByText(/状态：认证状态未知/)).toBeTruthy()
  expect(screen.getByText(/不等同于已认证/)).toBeTruthy()
})

/** 元素自身或任一祖先构成 live region 时，屏幕阅读器会播报它的文本变化。 */
const liveAncestor = (node: Element) =>
  node.closest('[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]')
const politeRegions = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[aria-live="polite"]')]

describe('CLI 诊断的播报只经过一个 polite live region', () => {
  it('可见状态行不参与播报，避免和状态段落重复念同一个状态词', async () => {
    install(async input => response(input.adapter, 'ready', '2.0.0'))
    const view = render(<NativeAgentDiagnostics adapter="claude" />)

    const statusLine = await screen.findByText(/Claude：已就绪/)
    expect(statusLine).toHaveAttribute('aria-live', 'off')
    expect(liveAncestor(statusLine)).toBeNull()
    // 版本行只是可见的诊断细节，同样不额外占用一个播报通道。
    expect(liveAncestor(screen.getByText(/版本：2\.0\.0/))).toBeNull()

    const regions = politeRegions(view.container)
    expect(regions).toHaveLength(1)
    expect(regions[0]).toHaveTextContent('状态：已就绪')
    expect(regions[0]).toHaveTextContent('已通过 CLI 版本和可用性探测')
    // 唯一被播报的段落里状态词只出现一次：没有第二条 polite 通道重复念它。
    expect(regions[0].textContent!.match(/已就绪/g)).toHaveLength(1)
  })

  it('检测进行中没有任何 polite 播报通道，结果到达后才出现唯一一个', async () => {
    let resolveProbe!: (value: LocalAgentResponse) => void
    const pending = new Promise<LocalAgentResponse>(resolve => { resolveProbe = resolve })
    install(async () => pending)
    const view = render(<NativeAgentDiagnostics adapter="codex" />)

    expect(screen.getByText(/Codex：正在检查/)).toHaveAttribute('aria-live', 'off')
    expect(politeRegions(view.container)).toHaveLength(0)

    await act(async () => { resolveProbe(response('codex', 'ready', '2.0.0')) })
    expect(politeRegions(view.container)).toHaveLength(1)
    expect(politeRegions(view.container)[0]).toHaveTextContent('状态：已就绪')
  })

  it('探测失败时只留下 alert，不再有 polite 状态段落重复播报', async () => {
    install(async () => { throw new Error('CLI 探测暂时失败') })
    const view = render(<NativeAgentDiagnostics adapter="opencode" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('CLI 探测暂时失败')
    expect(politeRegions(view.container)).toHaveLength(0)
    expect(screen.getByText(/OpenCode：诊断失败/)).toHaveAttribute('aria-live', 'off')
  })
})
