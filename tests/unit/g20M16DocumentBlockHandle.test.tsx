import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DocumentBlockHandle, DOCUMENT_BLOCK_DRAG_MIME, documentBlockDragId } from '@/renderer/document/DocumentBlockHandle'
import type { MenuCommand } from '@/renderer/editing/commands/CommandMenu'

afterEach(cleanup)
const run = vi.fn()
const commands: MenuCommand[] = [
  { id: 'insert-paragraph', label: '下方插入正文', group: '插入', run },
  { id: 'delete', label: '删除段落', group: '段落', run },
]

it('shows only for the caret block and shares insertion commands with the full handle menu', () => {
  const view = render(<DocumentBlockHandle blockId={null} rect={null} commands={commands} />)
  expect(screen.queryByRole('button', { name: '段落操作' })).toBeNull()
  view.rerender(<DocumentBlockHandle blockId="p" rect={{ left: 100, top: 80, height: 25 }} commands={commands} />)
  fireEvent.click(screen.getByRole('button', { name: '插入段落' }))
  expect(within(screen.getByRole('menu', { name: '插入段落' })).getAllByRole('menuitem').map(item => item.getAttribute('aria-label'))).toEqual(['下方插入正文'])
  fireEvent.click(screen.getByRole('menuitem', { name: '下方插入正文' }))
  expect(run).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: '段落操作' }))
  expect(within(screen.getByRole('menu', { name: '段落操作' })).getAllByRole('menuitem')).toHaveLength(2)
})

it('exports a narrow drag identity and honors disabled state', () => {
  const setData = vi.fn(), onDragStart = vi.fn()
  const view = render(<DocumentBlockHandle blockId="p" rect={{ left: 100, top: 80, height: 25 }} commands={commands} onDragStart={onDragStart} />)
  fireEvent.dragStart(screen.getByRole('button', { name: '段落操作' }), { dataTransfer: { setData, effectAllowed: '' } })
  expect(setData).toHaveBeenCalledWith(DOCUMENT_BLOCK_DRAG_MIME, 'p')
  expect(onDragStart).toHaveBeenCalledWith('p')
  expect(documentBlockDragId({ getData: () => 'p' })).toBe('p')
  view.rerender(<DocumentBlockHandle blockId="p" rect={{ left: 100, top: 80, height: 25 }} commands={commands} disabledReason="只读" />)
  expect(screen.getByRole('button', { name: '段落操作' }).getAttribute('draggable')).toBe('false')
})
