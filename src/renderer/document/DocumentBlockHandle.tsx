import { useState } from 'react'
import { ContextMenu, type MenuCommand } from '../editing/commands/CommandMenu'

export const DOCUMENT_BLOCK_DRAG_MIME = 'application/x-guoling-document-block'

export interface DocumentBlockHandleProps {
  blockId: string | null
  rect: { left: number; top: number; height: number } | null
  commands: readonly MenuCommand[]
  disabledReason?: string | null
  onDragStart?(blockId: string): void
}

/** The host supplies the active caret block, its visible rect and already-bound commands. */
export function DocumentBlockHandle({ blockId, rect, commands, disabledReason, onDragStart }: DocumentBlockHandleProps) {
  const [menu, setMenu] = useState<'insert' | 'block' | null>(null)
  if (!blockId || !rect) return null
  const insert = commands.filter(command => command.group === '插入')
  const blocked = commands.map(command => ({ ...command, disabledReason: disabledReason ?? command.disabledReason }))
  const items = menu === 'insert' ? blocked.filter(command => command.group === '插入') : blocked
  const at = { x: Math.max(4, rect.left - 36), y: rect.top + rect.height / 2 }
  return <div className="document-block-handle" data-block-id={blockId} style={{ position: 'fixed', left: at.x, top: rect.top, zIndex: 20 }}>
    <button type="button" aria-label="插入段落" disabled={Boolean(disabledReason) || !insert.length}
      onMouseDown={event => event.preventDefault()} onClick={() => setMenu(value => value === 'insert' ? null : 'insert')}>+</button>
    <button type="button" aria-label="段落操作" draggable={!disabledReason}
      aria-description={disabledReason ?? '拖动以排序段落'} title={disabledReason ?? '拖动以排序段落'}
      onClick={() => setMenu(value => value === 'block' ? null : 'block')}
      onDragStart={event => {
        if (disabledReason) { event.preventDefault(); return }
        event.dataTransfer.setData(DOCUMENT_BLOCK_DRAG_MIME, blockId)
        event.dataTransfer.effectAllowed = 'move'
        setMenu(null)
        onDragStart?.(blockId)
      }}>⋮⋮</button>
    {menu && <ContextMenu at={at} label={menu === 'insert' ? '插入段落' : '段落操作'} items={items} onClose={() => setMenu(null)} />}
  </div>
}

/** Used by the editor's drop port; the command owner commits the returned move once. */
export function documentBlockDragId(transfer: Pick<DataTransfer, 'getData'>): string | null {
  const id = transfer.getData(DOCUMENT_BLOCK_DRAG_MIME)
  return id || null
}
