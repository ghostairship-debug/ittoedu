import { afterEach, expect, it, vi } from 'vitest'
import { WindowLifecycle, closePromptOptions, type CloseActivity, type WindowLifecyclePorts } from '../../src/main/windowLifecycle'
import { prepareDocumentWindowClose, setBeforeWindowClose } from '../../src/main/workbench/documentCloseCoordinator'
import type { ExternalCloseAction } from '../../src/shared/workbench/external'

afterEach(() => setBeforeWindowClose(undefined))
function fixture(options: { action?: ExternalCloseAction; activity?: CloseActivity; answer?: { response: number; checkboxChecked: boolean } } = {}) {
  let action = options.action ?? 'ask'
  const window = { visible: true, minimized: false, closed: 0,
    isDestroyed: () => false, isMinimized: () => window.minimized, restore: vi.fn(() => { window.minimized = false }),
    show: vi.fn(() => { window.visible = true }), hide: vi.fn(() => { window.visible = false }), focus: vi.fn(), close: vi.fn(() => { window.closed++ }) }
  const tray = { actions: undefined as undefined | { show(): void; quit(): void }, destroy: vi.fn() }
  const ports: WindowLifecyclePorts = {
    window: () => window as never,
    closeAction: async () => action,
    remember: vi.fn(async (next: Exclude<ExternalCloseAction, 'ask'>) => { action = next }),
    activity: vi.fn(async () => options.activity ?? { builtinTasks: 0, external: [] }),
    prompt: vi.fn(async () => options.answer ?? { response: 2, checkboxChecked: false }),
    createTray: vi.fn(actions => { tray.actions = actions; return tray }),
  }
  return { lifecycle: new WindowLifecycle(ports), ports, window, tray, action: () => action }
}

it('asks before closing, hides to the tray, and remembers the choice only when asked to', async () => {
  const f = fixture({ answer: { response: 0, checkboxChecked: true } })
  expect(await f.lifecycle.beforeClose()).toBe('handled')
  expect(f.ports.prompt).toHaveBeenCalledOnce()
  const options = vi.mocked(f.ports.prompt).mock.calls[0]![1]
  expect(options).toMatchObject({ buttons: ['隐藏到托盘', '退出', '取消'], cancelId: 2, checkboxLabel: '记住我的选择' })
  expect(options.detail).toContain('外部 AI 仍可连接')
  expect(f.window.hide).toHaveBeenCalledOnce()
  expect(f.ports.createTray).toHaveBeenCalledOnce()
  expect(f.action()).toBe('tray')
  // Remembered: the next close hides without asking, and the tray icon is reused.
  f.window.visible = true
  expect(await f.lifecycle.beforeClose()).toBe('handled')
  expect(f.ports.prompt).toHaveBeenCalledOnce()
  expect(f.ports.createTray).toHaveBeenCalledOnce()
  expect(f.window.visible).toBe(false)
  f.window.minimized = true
  f.tray.actions!.show()
  expect(f.window).toMatchObject({ visible: true, minimized: false })
  expect(f.window.focus).toHaveBeenCalled()
})

it('warns about running built-in tasks and external calls; quit continues into the existing protection without remembering', async () => {
  const activity = { builtinTasks: 2, external: [{ clientName: 'Claude Code', pendingCalls: 1 }, { clientName: 'Codex', pendingCalls: 0 }] }
  const f = fixture({ activity, answer: { response: 1, checkboxChecked: false } })
  expect(await f.lifecycle.beforeClose()).toBe('continue')
  const options = vi.mocked(f.ports.prompt).mock.calls[0]![1]
  expect(options).toMatchObject({ type: 'warning', message: '果铃还有任务正在进行' })
  expect(options.detail).toBe(['内置 AI 正在运行 2 个任务。', '外部 AI 正在处理调用的会话 1 个：Claude Code（正在处理 1 个调用）。',
    '隐藏到托盘则继续运行；退出会中止内置任务并断开外部连接。'].join('\n'))
  expect(f.ports.remember).not.toHaveBeenCalled()
  expect(f.window.hide).not.toHaveBeenCalled()
})

it('keeps the window on cancel, and a remembered quit still warns while work is in progress', async () => {
  const idle = fixture({ action: 'quit' })
  expect(await idle.lifecycle.beforeClose()).toBe('continue')
  expect(idle.ports.prompt).not.toHaveBeenCalled()
  const busy = fixture({ action: 'quit', activity: { builtinTasks: 1, external: [] }, answer: { response: 2, checkboxChecked: true } })
  expect(await busy.lifecycle.beforeClose()).toBe('handled')
  expect(busy.ports.prompt).toHaveBeenCalledOnce()
  expect(busy.ports.remember).not.toHaveBeenCalled()
  expect(busy.window.visible).toBe(true)
  expect(closePromptOptions({ builtinTasks: 0, external: [] })).toMatchObject({ type: 'question', defaultId: 0 })
})

it('tray quit shows the window and runs the normal close once; the existing save protection still decides', async () => {
  const f = fixture({ answer: { response: 0, checkboxChecked: false } })
  await f.lifecycle.beforeClose()
  expect(f.window.visible).toBe(false)
  f.tray.actions!.quit()
  expect(f.window.visible).toBe(true)
  expect(f.window.close).toHaveBeenCalledOnce()
  setBeforeWindowClose(() => f.lifecycle.beforeClose())
  const confirm = vi.fn(async () => 'cancel' as const)
  const ports = { list: () => [{ documentId: 'dirty', dirty: true }] as never, drain: async () => {}, rendererDirty: async () => false,
    confirm, prepareRenderer: async () => true, save: vi.fn() }
  // Quit consumes the request and reaches the unchanged close dialog, which the user cancels.
  expect(await prepareDocumentWindowClose(ports)).toBe(false)
  expect(confirm).toHaveBeenCalledOnce()
  expect(f.ports.prompt).toHaveBeenCalledOnce()
  // The next close button press asks again instead of quitting silently.
  const rendererDirty = vi.fn(async () => false)
  expect(await prepareDocumentWindowClose({ ...ports, rendererDirty })).toBe(false)
  expect(f.ports.prompt).toHaveBeenCalledTimes(2)
  expect(rendererDirty).not.toHaveBeenCalled()
  expect(f.window.visible).toBe(false)
})
