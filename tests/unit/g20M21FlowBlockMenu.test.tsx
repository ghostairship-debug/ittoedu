import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SharedDocumentEditor } from '@/renderer/document'
import { flowBlockCommands, flowBlockMenuCommands } from '@/renderer/ui/flow/FlowBlockQuickActions'
import type { DocumentContent } from '@/shared/document/content'
import type { ComponentInstance } from '@/shared/contracts/component-platform'

afterEach(() => { cleanup(); vi.useRealTimers() })

const content = { blocks: [
  { id: 'intro', type: 'paragraph', content: { inlines: [{ type: 'text', text: '引言' }] } },
  { id: 'figure', type: 'media', assetId: 'picture', mediaKind: 'image', altText: '示意图', caption: { inlines: [{ type: 'text', text: '图注' }] }, layout: 'wide', wrap: 'none' },
] } satisfies DocumentContent

const instance: ComponentInstance = { id: 'figure', definitionId: 'guoling.image', data: { assetId: 'picture' } }

function commands() {
  return { moveSelectedBlock: vi.fn(), deleteSelectedBlocks: vi.fn() }
}

it('M21 defines a Flow document object\'s commands once: the right-click menu has them all, the bar\'s "⋯" the rest', () => {
  const ports = commands(), replace = vi.fn()
  const items = flowBlockCommands({ instance, mediaKind: 'image' }, ports, replace)
  expect(items.map(item => item.label)).toEqual(['替换图片…', '上移', '下移', '删除'])
  expect(flowBlockCommands({ instance: { ...instance, definitionId: 'guoling.table' } }, ports, replace).map(item => item.label)).toEqual(['上移', '下移', '删除'])
  items[0]!.run(); expect(replace).toHaveBeenCalledWith('image')
  // The bar shows 替换/上移/下移 as buttons, so its "⋯" keeps the rest.
  expect(flowBlockMenuCommands({ instance, mediaKind: 'image' }, ports, replace).map(item => item.label)).toEqual(['删除'])
})

it('M21 opens the owner\'s menu for a right-clicked document picture', async () => {
  vi.useFakeTimers()
  const ports = commands(), replace = vi.fn()
  const objectMenu = vi.fn((blockId: string) => blockId === 'figure' ? flowBlockCommands({ instance, mediaKind: 'image' }, ports, replace) : [])
  render(<SharedDocumentEditor document={{ content, resources: { assets: [{ assetId: 'picture', source: { kind: 'project' } }], components: [] } }} revision="1" target="flow"
    renderObject={(_block, container) => { container.textContent = '图片' }} objectMenu={objectMenu}
    onChange={() => true} onDraft={() => {}} onUndo={() => {}} onRedo={() => {}} />)
  const host = document.querySelector<HTMLElement>('figure[data-document-id="figure"] > div:first-child')!
  fireEvent.contextMenu(host, { clientX: 200, clientY: 150 })
  await act(async () => { vi.runAllTimers() })
  expect(objectMenu).toHaveBeenCalledWith('figure')
  const menu = screen.getByRole('menu', { name: '对象操作' })
  expect(within(menu).getAllByRole('menuitem').map(item => item.getAttribute('aria-label'))).toEqual(['替换图片…', '上移', '下移', '删除'])
  fireEvent.click(within(menu).getByRole('menuitem', { name: '下移' }))
  expect(ports.moveSelectedBlock).toHaveBeenCalledWith('down')
})
