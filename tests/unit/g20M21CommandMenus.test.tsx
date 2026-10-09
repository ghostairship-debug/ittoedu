import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CourseEditorChromeContext } from '../../src/renderer/documents/CourseEditorChromeContext'
import { useContextMenu, type MenuCommand } from '../../src/renderer/editing/commands/CommandMenu'
import { multiObjectCommands, singleObjectCommands, type ObjectCommandPorts } from '../../src/renderer/editing/commands/objectCommands'
import { requestObjectContextMenu } from '../../src/renderer/editing/commands/objectContextMenu'
import { selectActiveCourseLocationId, selectSelectedNodeId, selectSelectedNodeIds, useEditorStore } from '../../src/renderer/store/editorStore'
import { NativeSelectionContext } from '../../src/renderer/workbench/NativeSelectionContext'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'

const store = () => useEditorStore.getState()
const previousDesktopAPI = window.desktopAPI
afterEach(() => {
  cleanup(); if (store().courseView.project) store().cancelTextEdit(); store().courseBridge.dispose()
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: previousDesktopAPI })
})

function ports(overrides: Partial<ObjectCommandPorts> = {}): ObjectCommandPorts {
  return { copy: vi.fn(), paste: vi.fn(), duplicate: vi.fn(), remove: vi.fn(), canReorder: () => true, reorder: vi.fn(), ...overrides }
}
const state = (overrides: Partial<Parameters<typeof singleObjectCommands>[0]> = {}) =>
  ({ locked: false, visible: true, setLocked: vi.fn(), setVisible: vi.fn(), ...overrides })
const reasons = (items: readonly MenuCommand[]) => Object.fromEntries(items.map(item => [item.id, item.disabledReason ?? null]))

it('M21 lists one object\'s commands once, keeping unavailable ones in place with the reason', () => {
  const editText = vi.fn()
  const full = singleObjectCommands(state({ editText }), ports({ canReorder: move => move !== 'front' && move !== 'forward' }), { primary: true })
  expect(full.map(item => item.label)).toEqual(['编辑文字', '复制', '粘贴', '创建副本', '删除', '上移一层', '下移一层', '置于顶层', '置于底层', '锁定', '隐藏'])
  expect(reasons(full)).toMatchObject({ 'object.order.forward': '已在最上层', 'object.order.front': '已在最上层', 'object.order.back': null, 'object.delete': null })
  // The quick bar's "⋯" is the same list without the main action, which is already a button on the bar.
  expect(singleObjectCommands(state({ editText }), ports()).map(item => item.id)).toEqual(full.slice(1).map(item => item.id))

  const locked = singleObjectCommands(state({ locked: true }), ports())
  expect(reasons(locked)).toMatchObject({ 'object.delete': '对象已锁定，请先解锁', 'object.copy': null, 'object.order.back': '对象已锁定，请先解锁', 'object.unlock': null })
  expect(locked.some(item => item.id === 'object.lock')).toBe(false)
  expect(singleObjectCommands(state({ visible: false }), ports()).some(item => item.id === 'object.show')).toBe(true)

  // An object owned elsewhere can still be copied and pasted from; everything else says why not.
  const blocked = singleObjectCommands(state({ disabledReason: '此对象属于母版' }), ports())
  expect(reasons(blocked)).toMatchObject({ 'object.copy': '此对象属于母版', 'object.paste': null, 'object.hide': '此对象属于母版' })

  const items = multiObjectCommands({ count: 2, unlocked: 2, allHidden: false, duplicate: null, remove: vi.fn(), distribute: vi.fn(), setLocked: vi.fn(), setVisible: vi.fn() }, ports())
  expect(reasons(items)).toMatchObject({ 'objects.duplicate': '所选对象不能一起复制', 'objects.delete': null, 'objects.distribute.horizontal': '至少需要 3 个未锁定对象' })
})

it('M21 right-click menu: unavailable items show why and do nothing; others run once and close the menu', () => {
  const run = vi.fn(), blocked = vi.fn()
  function Harness() {
    const menu = useContextMenu()
    return <>
      <button type="button" onContextMenu={event => { event.preventDefault(); menu.open({ x: 40, y: 40 }, '测试菜单', [
        { id: 'a', label: '可以', shortcut: 'Ctrl+K', run },
        { id: 'b', label: '不可以', group: 'other', run: blocked, disabledReason: '现在不行' },
      ]) }}>目标</button>
      {menu.element}
    </>
  }
  render(<Harness />)
  fireEvent.contextMenu(screen.getByRole('button', { name: '目标' }))
  const menu = screen.getByRole('menu', { name: '测试菜单' })
  const unavailable = within(menu).getByRole('menuitem', { name: '不可以' })
  expect(unavailable.getAttribute('aria-disabled')).toBe('true')
  expect(within(menu).getByText('现在不行')).toBeTruthy()
  fireEvent.click(unavailable)
  expect(blocked).not.toHaveBeenCalled()
  // Arrow keys move between the items, disabled ones included so their reason can be read.
  expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: '可以' }))
  fireEvent.keyDown(menu, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(unavailable)
  fireEvent.click(within(menu).getByRole('menuitem', { name: '可以' }))
  expect(run).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.contextMenu(screen.getByRole('button', { name: '目标' }))
  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
})

it('M21 the selection owner answers a right-click with the same commands as its quick bar', async () => {
  const host = await createCourseDocumentHost()
  await store().connectCourseDocuments(host.api); store().setEditingScope('scene')
  store().addTextNode(); await store().drainCourseDocument()
  const documentId = store().courseView.activeDocumentId!
  const first = selectSelectedNodeId(store())!
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { documents: host.api } })
  const item = () => {
    const model = host.registry.get(documentId).read().model
    if (model.kind !== 'course-v10') throw new Error('course fixture')
    return model.project.instances[first]
  }
  function CurrentSelection() {
    const revision = useEditorStore(state => state.courseView.snapshot?.revision ?? 0)
    const itemIds = useEditorStore(selectSelectedNodeIds)
    const locationId = useEditorStore(selectActiveCourseLocationId)
    return <CourseEditorChromeContext.Provider value={{ documentId, mode: 'light', setMode() {} }}>
      <main data-testid="workspace"><NativeSelectionContext documentId={documentId} revision={revision} locationId={locationId} itemIds={itemIds} enabled bounds={() => ({ left: 200, top: 200, width: 120, height: 40 })} /></main>
    </CourseEditorChromeContext.Provider>
  }
  render(<CurrentSelection />)
  await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
  const root = screen.getByTestId('workspace')
  // A request for objects that are not the selection opens nothing.
  expect(requestObjectContextMenu(root, { x: 10, y: 10, itemIds: ['someone-else'] })).toBe(false)
  expect(screen.queryByRole('menu', { name: '对象操作' })).toBeNull()

  let handled = false
  const extra = vi.fn()
  act(() => { handled = requestObjectContextMenu(root, { x: 300, y: 260, itemIds: [first], extra: [{ id: 'spot', label: '编辑此处文字', group: 'spot', run: extra }] }) })
  expect(handled).toBe(true)
  const menu = screen.getByRole('menu', { name: '对象操作' })
  expect(within(menu).getAllByRole('menuitem').map(element => element.getAttribute('aria-label'))).toEqual(
    ['编辑此处文字', '编辑文字', '复制', '粘贴', '创建副本', '删除', '上移一层', '下移一层', '置于顶层', '置于底层', '锁定', '隐藏'])
  await act(async () => { fireEvent.click(within(menu).getByRole('menuitem', { name: '锁定' })); await store().drainCourseDocument() })
  expect(item()?.locked).toBe(true)
  expect(screen.queryByRole('menu', { name: '对象操作' })).toBeNull()
  // Now locked: the menu offers 解锁 in place and says why deleting waits.
  act(() => { requestObjectContextMenu(root, { x: 300, y: 260, itemIds: [first] }) })
  const lockedMenu = screen.getByRole('menu', { name: '对象操作' })
  expect(within(lockedMenu).getByRole('menuitem', { name: '删除' }).getAttribute('aria-disabled')).toBe('true')
  await act(async () => { fireEvent.click(within(lockedMenu).getByRole('menuitem', { name: '解锁' })); await store().drainCourseDocument() })
  expect(item()?.locked).toBe(false)
  expect(extra).not.toHaveBeenCalled()
  await act(async () => { await store().addRectangleNode(); await store().courseBridge.drain() })
  const shape = selectSelectedNodeId(store())!
  await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
  act(() => { requestObjectContextMenu(screen.getByTestId('workspace'), { x: 300, y: 260, itemIds: [shape] }) })
  const labels = within(screen.getByRole('menu', { name: '对象操作' })).getAllByRole('menuitem').map(element => element.getAttribute('aria-label'))
  expect(labels[0]).toBe('复制')
  expect(labels).not.toContain('编辑文字')
})
