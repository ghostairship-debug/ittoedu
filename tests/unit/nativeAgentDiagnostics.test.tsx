import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
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
