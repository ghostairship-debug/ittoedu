import type { MenuCommand } from '../../editing/commands/CommandMenu'

export interface DocumentTabPorts {
  close(): void
  closeOthers(): void
  closeRight(): void
  closeAll(): void
  copyPath(): void
  reveal(): void
  openExternal(): void
}

const UNSAVED = '尚未保存到文件'

/** The operations of one open file tab: its right-click menu (M21). */
export function documentTabCommands(tab: { index: number; count: number; saved: boolean }, ports: DocumentTabPorts): MenuCommand[] {
  const file = tab.saved ? null : UNSAVED
  return [
    { id: 'tab.close', label: '关闭', group: 'close', run: ports.close },
    { id: 'tab.close-others', label: '关闭其他', group: 'close', run: ports.closeOthers, disabledReason: tab.count < 2 ? '没有其他标签' : null },
    { id: 'tab.close-right', label: '关闭右侧', group: 'close', run: ports.closeRight, disabledReason: tab.index >= tab.count - 1 ? '右侧没有标签' : null },
    { id: 'tab.close-all', label: '全部关闭', group: 'close', run: ports.closeAll },
    { id: 'tab.copy-path', label: '复制路径', group: 'file', run: ports.copyPath, disabledReason: file },
    { id: 'tab.reveal', label: '在资源管理器中显示', group: 'file', run: ports.reveal, disabledReason: file },
    { id: 'tab.open-external', label: '用系统应用打开', group: 'file', run: ports.openExternal, disabledReason: file },
  ]
}
