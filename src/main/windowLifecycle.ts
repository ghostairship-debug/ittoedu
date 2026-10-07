import type { BrowserWindow, MessageBoxOptions } from 'electron'
import type { ExternalCloseAction } from '../shared/workbench/external'
import type { ExecutionEventPendingState } from './workbench/execution/ExecutionEventStore'

export interface CloseActivity {
  /** Built-in AI tasks that are queued, running or stopping. */
  builtinTasks: number
  /** External AI sessions that have made calls, with the calls still in progress. */
  external: readonly { clientName: string; pendingCalls: number }[]
  /** Display/diagnostic recording is independent of document commit durability. */
  recording?: ExecutionEventPendingState
}
type LifecycleWindow = Pick<BrowserWindow, 'isDestroyed' | 'isMinimized' | 'restore' | 'show' | 'hide' | 'focus' | 'close'>
export interface TrayHandle { destroy(): void; setToolTip?(text: string): void }
export interface WindowLifecyclePorts {
  window(): LifecycleWindow | null
  closeAction(): Promise<ExternalCloseAction>
  remember(action: Exclude<ExternalCloseAction, 'ask'>): Promise<unknown>
  activity(): Promise<CloseActivity>
  prompt(window: LifecycleWindow, options: MessageBoxOptions): Promise<{ response: number; checkboxChecked: boolean }>
  /** Creates the tray icon with "显示果铃" / "退出"; clicking the icon shows the window. */
  createTray(actions: { show(): void; quit(): void }): TrayHandle
}

export function closePromptOptions(activity: CloseActivity): MessageBoxOptions {
  const external = activity.external.filter(session => session.pendingCalls > 0)
  const busy = activity.builtinTasks > 0 || external.length > 0
  const detail: string[] = []
  if (activity.builtinTasks) detail.push(`内置 AI 正在运行 ${activity.builtinTasks} 个任务。`)
  if (external.length) detail.push(`外部 AI 正在处理调用的会话 ${external.length} 个：${external
    .map(session => session.pendingCalls ? `${session.clientName}（正在处理 ${session.pendingCalls} 个调用）` : session.clientName).join('、')}。`)
  if (activity.recording) {
    const pending = activity.recording.pendingEvents + activity.recording.pendingTiming
    if (pending) detail.push(`还有 ${pending} 条运行记录正在写入；退出时会等待这些记录处理完成。`)
    if (activity.recording.lastFailure) detail.push(`运行记录曾出现写入失败：${activity.recording.lastFailure.message}。已应用的修改仍按文档结果保留，记录失败不会重新执行操作。`)
  }
  detail.push(busy ? '隐藏到托盘则继续运行；退出会中止内置任务并断开外部连接。'
    : '隐藏到托盘后果铃在后台继续运行，外部 AI 仍可连接；点击托盘图标可恢复窗口。')
  return { type: busy ? 'warning' : 'question', title: '关闭果铃', message: busy ? '果铃还有任务正在进行' : '隐藏到系统托盘，还是退出果铃？',
    detail: detail.join('\n'), buttons: ['隐藏到托盘', '退出', '取消'], defaultId: 0, cancelId: 2, noLink: true,
    checkboxLabel: '记住我的选择', checkboxChecked: false }
}

/** Close button → hide to tray / quit / cancel. Quit continues into the existing document close protection unchanged. */
export class WindowLifecycle {
  private quitRequested = false
  private tray?: TrayHandle
  constructor(private readonly ports: WindowLifecyclePorts) {}
  /** The next close goes straight to the existing close protection (tray "退出", app quit, OS session end). */
  requestQuit(): void { this.quitRequested = true }
  async beforeClose(): Promise<'continue' | 'handled'> {
    if (this.quitRequested) { this.quitRequested = false; return 'continue' }
    const window = this.ports.window()
    if (!window || window.isDestroyed()) return 'continue'
    let action: ExternalCloseAction | 'cancel' = await this.ports.closeAction()
    // A remembered "quit" still warns while work is in progress.
    const activity = action === 'tray' ? undefined : await this.ports.activity()
    if (action === 'ask' || action === 'quit' && activity && (activity.builtinTasks > 0 || activity.external.some(session => session.pendingCalls > 0))) {
      const result = await this.ports.prompt(window, closePromptOptions(activity!))
      action = result.response === 0 ? 'tray' : result.response === 1 ? 'quit' : 'cancel'
      if (action !== 'cancel' && result.checkboxChecked) await this.ports.remember(action)
    }
    if (action === 'tray') { this.hide(window); return 'handled' }
    return action === 'quit' ? 'continue' : 'handled'
  }
  private hide(window: LifecycleWindow): void {
    this.tray ??= this.ports.createTray({ show: () => this.show(), quit: () => this.quit() })
    window.hide()
  }
  show(): void {
    const window = this.ports.window()
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
  /** Tray "退出": bring the window back for any save prompt, then run the normal close. */
  quit(): void {
    const window = this.ports.window()
    if (!window || window.isDestroyed()) return
    this.requestQuit()
    this.show()
    window.close()
  }
  dispose(): void { this.tray?.destroy(); this.tray = undefined }
  /** Keep an existing native lifecycle surface visible after the editor window closes. */
  recordingState(state: ExecutionEventPendingState): void {
    const pending = state.pendingEvents + state.pendingTiming
    try {
      if (pending || state.lastFailure) this.tray ??= this.ports.createTray({ show: () => this.show(), quit: () => this.quit() })
      this.tray?.setToolTip?.(pending ? `果铃 · 正在保全 ${pending} 条运行记录`
        : state.lastFailure ? '果铃 · 运行记录存在保存诊断' : '果铃')
    } catch (cause) { console.error('退出记录状态未能显示：', cause) }
  }
}
