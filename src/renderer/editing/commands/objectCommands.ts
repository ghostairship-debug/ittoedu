import type { LayerOrderMove } from '../quickbar/layerOrder'
import type { MenuCommand } from './CommandMenu'

/** Store operations on the current selection; the same ones the keyboard shortcuts run. */
export interface ObjectCommandPorts {
  copy(): void
  paste(): void
  duplicate(): void
  remove(): void
  canReorder(move: LayerOrderMove): boolean
  reorder(move: LayerOrderMove): void
}

export interface SingleObjectState {
  locked: boolean
  visible: boolean
  /** Why this object cannot be edited here; copying and pasting stay available. */
  disabledReason?: string | null
  setLocked(locked: boolean): void
  setVisible(visible: boolean): void
  editText?: () => void
  replaceImage?: () => void
}

export interface MultiObjectState {
  count: number
  unlocked: number
  allHidden: boolean
  duplicate?: (() => void) | null
  remove?: (() => void) | null
  distribute(axis: 'horizontal' | 'vertical'): void
  setLocked(locked: boolean): void
  setVisible(visible: boolean): void
}

const ORDER: ReadonlyArray<readonly [LayerOrderMove, string]> = [
  ['forward', '上移一层'], ['backward', '下移一层'], ['front', '置于顶层'], ['back', '置于底层'],
]

/**
 * Everything one selected object offers. The right-click menu shows the whole list (`primary` adds the type's
 * main action, already a button on the quick bar); the quick bar's "⋯" shows the rest under the same names.
 */
export function singleObjectCommands(state: SingleObjectState, ports: ObjectCommandPorts, options: { primary?: boolean } = {}): MenuCommand[] {
  const blocked = state.disabledReason ?? null
  const editable = blocked ?? (state.locked ? '对象已锁定，请先解锁' : null)
  const commands: MenuCommand[] = []
  if (options.primary && state.editText) commands.push({ id: 'object.edit-text', label: '编辑文字', group: 'primary', run: state.editText, disabledReason: editable })
  if (options.primary && state.replaceImage) commands.push({ id: 'object.replace-image', label: '替换图片…', group: 'primary', run: state.replaceImage, disabledReason: editable })
  commands.push(
    { id: 'object.copy', label: '复制', shortcut: 'Ctrl+C', group: 'clipboard', run: ports.copy, disabledReason: blocked },
    { id: 'object.paste', label: '粘贴', shortcut: 'Ctrl+V', group: 'clipboard', run: ports.paste },
    { id: 'object.duplicate', label: '创建副本', shortcut: 'Ctrl+D', group: 'clipboard', run: ports.duplicate, disabledReason: blocked },
    { id: 'object.delete', label: '删除', shortcut: 'Delete', group: 'clipboard', danger: true, run: ports.remove, disabledReason: editable },
    ...ORDER.map(([move, label]): MenuCommand => ({
      id: `object.order.${move}`, label, group: 'order', run: () => ports.reorder(move),
      disabledReason: editable ?? (ports.canReorder(move) ? null : move === 'forward' || move === 'front' ? '已在最上层' : '已在最下层'),
    })),
    state.locked
      ? { id: 'object.unlock', label: '解锁', group: 'state', run: () => state.setLocked(false), disabledReason: blocked }
      : { id: 'object.lock', label: '锁定', group: 'state', run: () => state.setLocked(true), disabledReason: blocked },
    state.visible
      ? { id: 'object.hide', label: '隐藏', group: 'state', run: () => state.setVisible(false), disabledReason: blocked }
      : { id: 'object.show', label: '显示', group: 'state', run: () => state.setVisible(true), disabledReason: blocked },
  )
  return commands
}

/** Everything a multi-selection offers; the right-click menu and the quick bar's "⋯" use this one list. */
export function multiObjectCommands(state: MultiObjectState, ports: Pick<ObjectCommandPorts, 'copy' | 'paste'>): MenuCommand[] {
  const tooFew = (needed: number) => state.unlocked >= needed ? null : `至少需要 ${needed} 个未锁定对象`
  return [
    { id: 'objects.copy', label: '复制', shortcut: 'Ctrl+C', group: 'clipboard', run: ports.copy },
    { id: 'objects.paste', label: '粘贴', shortcut: 'Ctrl+V', group: 'clipboard', run: ports.paste },
    { id: 'objects.duplicate', label: '创建副本', shortcut: 'Ctrl+D', group: 'clipboard', run: () => state.duplicate?.(),
      disabledReason: state.duplicate ? null : '所选对象不能一起复制' },
    { id: 'objects.delete', label: '删除所选', shortcut: 'Delete', group: 'clipboard', danger: true, run: () => state.remove?.(),
      disabledReason: state.remove ? null : '所选对象不能一起删除' },
    { id: 'objects.distribute.horizontal', label: '横向等距分布', group: 'layout', run: () => state.distribute('horizontal'), disabledReason: tooFew(3) },
    { id: 'objects.distribute.vertical', label: '纵向等距分布', group: 'layout', run: () => state.distribute('vertical'), disabledReason: tooFew(3) },
    { id: 'objects.lock', label: '全部锁定', group: 'state', run: () => state.setLocked(true) },
    { id: 'objects.unlock', label: '全部解锁', group: 'state', run: () => state.setLocked(false) },
    { id: 'objects.show', label: '全部显示', group: 'state', run: () => state.setVisible(true) },
    { id: 'objects.hide', label: '全部隐藏', group: 'state', run: () => state.setVisible(false) },
  ]
}
