import type { MenuCommand } from '../../editing/commands/CommandMenu'

export type ExplorerCreateType = 'create-markdown' | 'create-course' | 'create-text' | 'mkdir'

export interface ExplorerCommandPorts {
  create(type: ExplorerCreateType): void
  newFromPptx(): void
  importPptx(): void
  rename(): void
  copy(): void
  cut(): void
  paste(): void
  copyTo(): void
  moveTo(): void
  trash(): void
  copyPath(): void
  reveal(): void
}

/** The explorer's 新建 items, shared by its 新建 menu and its right-click menu (M21). */
export function explorerNewCommands(blocked: string | null, ports: Pick<ExplorerCommandPorts, 'create' | 'newFromPptx'>): MenuCommand[] {
  return [
    { id: 'file.new-markdown', label: '新建 Markdown 文档', group: 'new', run: () => ports.create('create-markdown'), disabledReason: blocked },
    { id: 'file.new-course', label: '新建 H5 演示', group: 'new', run: () => ports.create('create-course'), disabledReason: blocked },
    { id: 'file.new-course-from-pptx', label: '从 PPT 新建 H5 演示', group: 'new', run: ports.newFromPptx, disabledReason: blocked },
    { id: 'file.new-text', label: '新建文本文档', group: 'new', run: () => ports.create('create-text'), disabledReason: blocked },
    { id: 'file.new-folder', label: '新建文件夹', group: 'new', run: () => ports.create('mkdir'), disabledReason: blocked },
  ]
}

/**
 * The right-click menu of the explorer: what the selection offers, with the reason an item cannot run now.
 * `blocked` is set while the workspace is not ready or another file operation runs.
 */
export function explorerContextCommands(state: { blocked: string | null; selected: number; pptx: boolean; clipboard: number }, ports: ExplorerCommandPorts): MenuCommand[] {
  const busy = state.blocked
  const any = state.selected ? null : '请先选择文件或文件夹'
  const one = state.selected === 1 ? null : '请只选择一项'
  return [
    ...(state.pptx ? [{ id: 'file.import-pptx', label: '导入为 H5 演示', group: 'open', run: ports.importPptx, disabledReason: busy }] : []),
    ...explorerNewCommands(busy, ports),
    { id: 'file.rename', label: '重命名', shortcut: 'F2', group: 'edit', run: ports.rename, disabledReason: busy ?? one },
    { id: 'file.copy', label: '复制', shortcut: 'Ctrl+C', group: 'edit', run: ports.copy, disabledReason: busy ?? any },
    { id: 'file.cut', label: '剪切', shortcut: 'Ctrl+X', group: 'edit', run: ports.cut, disabledReason: busy ?? any },
    { id: 'file.paste', label: '粘贴', shortcut: 'Ctrl+V', group: 'edit', run: ports.paste, disabledReason: busy ?? (state.clipboard ? null : '还没有复制或剪切的文件') },
    { id: 'file.copy-to', label: '复制到…', group: 'move', run: ports.copyTo, disabledReason: busy ?? any },
    { id: 'file.move-to', label: '移动到…', group: 'move', run: ports.moveTo, disabledReason: busy ?? any },
    { id: 'file.trash', label: '移到回收站', shortcut: 'Delete', group: 'move', danger: true, run: ports.trash, disabledReason: busy ?? any },
    { id: 'file.copy-path', label: '复制路径', group: 'path', run: ports.copyPath, disabledReason: any },
    { id: 'file.reveal', label: '在系统中定位', group: 'path', run: ports.reveal, disabledReason: busy ?? one },
  ]
}
