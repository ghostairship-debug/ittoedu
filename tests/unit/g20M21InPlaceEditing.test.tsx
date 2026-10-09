import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AssetMeta } from '@/shared/contracts/media-v1'
import { imageDataSchema } from '../../src/components/image'
import { videoDataSchema } from '../../src/components/media'
import { CourseEditorActionsContext, type CourseEditorActions } from '../../src/renderer/documents/CourseEditorActionsContext'
import { CourseEditorChromeContext } from '../../src/renderer/documents/CourseEditorChromeContext'
import type { MenuCommand } from '../../src/renderer/editing/commands/CommandMenu'
import { singleObjectCommands, type ObjectCommandPorts } from '../../src/renderer/editing/commands/objectCommands'
import { OBJECT_EDIT_EVENT, requestObjectContextMenu } from '../../src/renderer/editing/commands/objectContextMenu'
import { hiddenObjectCommands, hiddenObjectName } from '../../src/renderer/editing/commands/hiddenObjectCommands'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { NativeSelectionContext } from '../../src/renderer/workbench/NativeSelectionContext'
import { insertCourseMedia, replaceCourseMediaAtTarget } from '../../src/renderer/media/commitCourseMediaAuthoring'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'
const store = () => useEditorStore.getState(), previousDesktop = window.desktopAPI
const previousCreate = URL.createObjectURL, previousRevoke = URL.revokeObjectURL
beforeEach(() => { URL.createObjectURL = vi.fn(() => 'blob:crop-source'); URL.revokeObjectURL = vi.fn() })
afterEach(() => { cleanup(); store().courseBridge.dispose(); Object.defineProperty(window, 'desktopAPI', { configurable: true, value: previousDesktop }); URL.createObjectURL = previousCreate; URL.revokeObjectURL = previousRevoke })
function ports(): ObjectCommandPorts { return { copy: vi.fn(), paste: vi.fn(), duplicate: vi.fn(), remove: vi.fn(), canReorder: () => true, reorder: vi.fn() } }
const state = (overrides: Partial<Parameters<typeof singleObjectCommands>[0]> = {}) => ({ locked: false, visible: true, setLocked: vi.fn(), setVisible: vi.fn(), ...overrides })
const reasons = (items: readonly MenuCommand[]) => Object.fromEntries(items.map(item => [item.id, item.disabledReason ?? null]))
const image: AssetMeta = { id: 'crop-image', filename: 'photo.png', mimeType: 'image/png', kind: 'image', path: 'assets/photo.png', byteLength: 4, width: 1920, height: 1080 }
const video = (id: string): AssetMeta => ({ id, filename: `${id}.mp4`, mimeType: 'video/mp4', kind: 'video', path: `assets/${id}.mp4`, byteLength: 3, width: 640, height: 360, duration: 3 })
const addMedia = (meta: AssetMeta, bytes: Uint8Array, x?: number, y?: number) => insertCourseMedia(store().courseKernel, store().courseKernel.captureTarget(), [{ meta, bytes }], { x, y, width: 640, height: 360 })
async function openWith(add: () => unknown, kind: 'slide' | 'spatial' = 'slide') {
  const host = await createCourseDocumentHost(); await store().connectCourseDocuments(host.api)
  await store().createCourseDocument(kind); store().setEditingScope('scene')
  await add(); await store().courseBridge.drain()
  const documentId = store().courseView.activeDocumentId!, id = store().courseView.selectedInstanceId!
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { documents: host.api } })
  return { host, documentId, id, session: host.registry.get(documentId) }
}
function CurrentSelection({ documentId, actions = { replaceImage: vi.fn(), replaceVideo: vi.fn() } }: { documentId: string; actions?: CourseEditorActions }) {
  const view = useEditorStore(current => current.courseView)
  const bounds = (id: string) => { const frame = view.editingProject?.instances[id]?.frame; return frame ? { left: 100 + frame.transform[4] / 2, top: 100 + frame.transform[5] / 2, width: frame.width / 2, height: frame.height / 2 } : null }
  return <CourseEditorActionsContext.Provider value={actions}><CourseEditorChromeContext.Provider value={{ documentId, mode: 'light', setMode() {} }}>
    <main data-testid="workspace"><NativeSelectionContext documentId={documentId} revision={view.snapshot?.revision ?? 0} locationId={view.surfaceId} itemIds={view.selectedInstanceIds} enabled bounds={bounds} /></main>
  </CourseEditorChromeContext.Provider></CourseEditorActionsContext.Provider>
}
const instance = (id: string) => store().courseView.project!.instances[id]

it('M21 lists each common object\'s own edits once: primary items for the menu, none of them under "⋯"', () => {
  const crop = vi.fn(), setFit = vi.fn(), replaceVideo = vi.fn(), editFormula = vi.fn()
  const imageItems = singleObjectCommands(state({ replaceImage: vi.fn(), crop: { run: crop }, fit: { value: 'contain', set: setFit } }), ports(), { primary: true })
  expect(imageItems.slice(0, 5).map(item => item.label)).toEqual(['替换图片…', '裁剪', '显示方式：适应（完整显示）', '显示方式：填充（允许裁剪）', '显示方式：拉伸'])
  expect(reasons(imageItems)).toMatchObject({ 'object.crop': null, 'object.fit.contain': '已是当前显示方式', 'object.fit.cover': null, 'object.fit.stretch': null })
  imageItems.find(item => item.id === 'object.fit.cover')!.run()
  expect(setFit).toHaveBeenCalledWith('cover')
  // An image that cannot be cropped keeps the item in place, with the reason; a lock outranks it.
  expect(reasons(singleObjectCommands(state({ crop: { run: crop, disabledReason: '旋转的图片请先把旋转归零再裁剪' } }), ports(), { primary: true }))['object.crop'])
    .toBe('旋转的图片请先把旋转归零再裁剪')
  expect(reasons(singleObjectCommands(state({ locked: true, crop: { run: crop }, fit: { value: 'cover', set: setFit } }), ports(), { primary: true })))
    .toMatchObject({ 'object.crop': '对象已锁定，请先解锁', 'object.fit.contain': '对象已锁定，请先解锁', 'object.fit.cover': '对象已锁定，请先解锁' })
  expect(singleObjectCommands(state({ replaceVideo }), ports(), { primary: true })[0]).toMatchObject({ id: 'object.replace-video', label: '替换视频…' })
  expect(singleObjectCommands(state({ editFormula }), ports(), { primary: true })[0]).toMatchObject({ id: 'object.edit-formula', label: '编辑公式' })
  // They are buttons on the quick bar, so its "⋯" does not repeat them.
  const more = singleObjectCommands(state({ crop: { run: crop }, fit: { value: 'contain', set: setFit }, replaceVideo, editFormula }), ports())
  expect(more.filter(item => /crop|fit|replace-video|edit-formula/.test(item.id))).toEqual([])
})

it('M21 lists hidden objects by the start of their text or their name, with 全部显示 for several', () => {
  expect(hiddenObjectName({ kind: 'native', label: '文本 1', content: { nativeType: 'text', data: { text: '  这是一段很长很长很长很长的提示文字  ' } } })).toBe('这是一段很长很长很长很长的提示文字'.slice(0, 16))
  expect(hiddenObjectName({ kind: 'native', label: '照片', content: { nativeType: 'image', data: {} } })).toBe('照片')
  expect(hiddenObjectName({ kind: 'native', label: '', content: { nativeType: 'text', data: { text: ' ' } } })).toBe('对象')
  const show = vi.fn()
  const one = hiddenObjectCommands([{ id: 'a', name: '课题' }], show)
  expect(one.map(item => item.label)).toEqual(['显示“课题”'])
  const two = hiddenObjectCommands([{ id: 'a', name: '课题' }, { id: 'b', name: '提示' }], show)
  expect(two.map(item => item.label)).toEqual(['显示“课题”', '显示“提示”', '全部显示'])
  two[1]!.run(); two[2]!.run()
  expect(show.mock.calls).toEqual([[['b']], [['a', 'b']]])
  expect(hiddenObjectCommands([], show)).toEqual([])
})

it('M21 an image switches how it fills its frame from the quick bar, and crops in place as one step', async () => {
  const { documentId, id, session } = await openWith(() => addMedia(image, new Uint8Array([1, 2, 3, 4]), 40, 60))
  render(<CurrentSelection documentId={documentId} />)
  const bar = await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
  expect(within(bar).getByRole('button', { name: '替换图片' })).toBeTruthy()
  const before = structuredClone(instance(id)), originalData = imageDataSchema.parse(before.data)
  expect(before.frame).toMatchObject({ width: 640, height: 360, transform: [1, 0, 0, 1, 40, 60] }); expect(originalData.fit).toBe('contain')

  fireEvent.click(within(bar).getByRole('button', { name: '显示方式' }))
  const fitMenu = screen.getByRole('menu', { name: '显示方式' })
  expect(within(fitMenu).getByRole('menuitemradio', { name: '适应（完整显示）' }).getAttribute('aria-checked')).toBe('true')
  await act(async () => { fireEvent.click(within(fitMenu).getByRole('menuitemradio', { name: '填充（允许裁剪）' })); await store().drainCourseDocument() })
  expect(imageDataSchema.parse(instance(id).data).fit).toBe('cover')
  expect(screen.queryByRole('menu', { name: '显示方式' })).toBeNull()

  // 取消 (and Esc) leave the image as it was.
  fireEvent.click(within(bar).getByRole('button', { name: '裁剪' }))
  expect(screen.getByRole('dialog', { name: '裁剪图片' })).toBeTruthy()
  // The quick bar steps aside while the crop runs.
  expect(bar.closest('[data-selection-quick-bar]')?.getAttribute('data-suspended')).toBe('true')
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: '裁剪图片' })).toBeNull()
  expect(instance(id).frame).toEqual(before.frame)

  // Dragging the right edge 30 px in on screen (half size) keeps 580 of the 640 units, where they were seen.
  fireEvent.click(within(bar).getByRole('button', { name: '裁剪' }))
  const right = screen.getByRole('slider', { name: '裁剪右边' })
  right.setPointerCapture = vi.fn(); right.hasPointerCapture = () => true; right.releasePointerCapture = vi.fn()
  fireEvent.pointerDown(right, { pointerId: 1, clientX: 440, clientY: 200 })
  fireEvent.pointerMove(right, { pointerId: 1, clientX: 410, clientY: 200 })
  fireEvent.pointerUp(right, { pointerId: 1, clientX: 410, clientY: 200 })
  expect(screen.getByTestId('image-crop-box').style.width).toBe('290px')
  const undoDepth = session.read().undoDepth
  const revision = store().courseView.snapshot?.revision ?? 0
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '完成' })); await store().drainCourseDocument() })
  expect(screen.queryByRole('dialog', { name: '裁剪图片' })).toBeNull()
  expect(instance(id).frame).toMatchObject({ width: 580, height: 360, transform: [1, 0, 0, 1, 40, 60] }); expect(imageDataSchema.parse(instance(id).data).crop).toEqual({ left: 0, top: 0, right: 0.0938, bottom: 0 })
  expect(store().courseView.snapshot?.revision).toBe(revision + 1)

  expect(session.read().undoDepth).toBe(undoDepth + 1)
  // One undo brings back both the frame and the crop.
  store().undo()
  await store().courseBridge.drain(); expect(instance(id).frame).toEqual(before.frame); expect(imageDataSchema.parse(instance(id).data).crop.right).toBe(0)
})

it('routes a formula editor request on Slide and Spatial and restores a hidden Spatial object through its current quick bar', async () => {
  for (const kind of ['slide', 'spatial'] as const) {
    const { documentId, id, session } = await openWith(() => store().addFormulaNode(), kind)
    render(<CurrentSelection documentId={documentId} />)
    let bar = await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
    fireEvent.click(within(bar).getByRole('button', { name: '编辑公式' }))
    expect(screen.getByRole('alert')).toHaveTextContent('公式编辑器现在打不开，请双击公式再试。')
    const root = screen.getByTestId('workspace'), requested: string[] = [], before = session.read()
    const open = (event: Event) => { requested.push((event as CustomEvent<{ itemId: string }>).detail.itemId); event.preventDefault() }
    root.addEventListener(OBJECT_EDIT_EVENT, open)
    fireEvent.click(within(bar).getByRole('button', { name: '编辑公式' }))
    act(() => { requestObjectContextMenu(root, { x: 300, y: 260, itemIds: [id] }) })
    fireEvent.click(within(screen.getByRole('menu', { name: '对象操作' })).getByRole('menuitem', { name: '编辑公式' }))
    expect(requested).toEqual([id, id]); expect(session.read()).toEqual(before)
    root.removeEventListener(OBJECT_EDIT_EVENT, open)
    if (kind === 'spatial') {
      await act(async () => { await store().updateNodes([{ nodeId: id, patch: { visible: false } }]); await store().courseBridge.drain() })
      expect(instance(id).visible).toBe(false)
      const hidden = session.read()
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '显示' })); await store().courseBridge.drain() })
      expect(instance(id).visible).toBe(true); expect(session.read().undoDepth).toBe(hidden.undoDepth + 1)
      await act(async () => { await addMedia(image, new Uint8Array([1, 2, 3, 4])); await store().courseBridge.drain() })
      bar = await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
      expect(within(bar).getByRole('button', { name: '显示方式' })).toBeInTheDocument(); expect(within(bar).queryByRole('button', { name: '裁剪' })).toBeNull()
      await act(async () => { await addMedia(video('world-video'), new Uint8Array([1, 2, 3])); await store().courseBridge.drain() })
      bar = await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
      expect(within(bar).queryByRole('button', { name: '替换视频' })).toBeNull()
    }
    cleanup(); store().courseBridge.dispose()
  }
})

it('uses both video replacement entry points, preserves its frame and settings, and rejects a missing captured selection without writes', async () => {
  const { host, documentId, id, session } = await openWith(() => addMedia(video('old-video'), new Uint8Array([1, 2, 3]), 80, 90))
  const actions = { replaceImage: vi.fn(), replaceVideo: vi.fn() }
  render(<CurrentSelection documentId={documentId} actions={actions} />)
  const bar = await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
  fireEvent.click(within(bar).getByRole('button', { name: '替换视频' }))
  act(() => { requestObjectContextMenu(screen.getByTestId('workspace'), { x: 300, y: 260, itemIds: [id] }) })
  fireEvent.click(within(screen.getByRole('menu', { name: '对象操作' })).getByRole('menuitem', { name: '替换视频…' }))
  expect(actions.replaceVideo).toHaveBeenCalledTimes(2)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '循环播放' })); await store().courseBridge.drain() })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '静音' })); await store().courseBridge.drain() })
  const before = structuredClone(instance(id)), depth = session.read().undoDepth
  await act(async () => { await replaceCourseMediaAtTarget(store().courseKernel, store().courseKernel.captureTarget(), { meta: video('new-video'), bytes: new Uint8Array([4, 5, 6]) }) })
  expect(videoDataSchema.parse(instance(id).data)).toMatchObject({ assetId: 'new-video', loop: true, muted: true })
  expect(instance(id).frame).toEqual(before.frame); expect(session.read().undoDepth).toBe(depth + 1)
  const saved = session.read(), reopened = host.driver.load(host.driver.serialize(saved.model))
  if (saved.model.kind !== 'course-v10' || reopened.kind !== 'course-v10') throw new Error('Expected V10 archive')
  expect(reopened.project).toEqual(saved.model.project)
  expect(Object.fromEntries(Object.entries(reopened.resources.assets).map(([id, value]) => [id, Array.from(value)]))).toEqual(Object.fromEntries(Object.entries(saved.model.resources.assets).map(([id, value]) => [id, Array.from(value)])))
  await act(async () => { await store().courseBridge.undo(documentId) })
  expect(instance(id)).toEqual(before)
  act(() => store().selectNode(null))
  const unselected = session.read()
  await expect(replaceCourseMediaAtTarget(store().courseKernel, store().courseKernel.captureTarget(), { meta: video('third-video'), bytes: new Uint8Array([7, 8, 9]) })).rejects.toThrow('请选择同类型的原媒体进行替换')
  expect(session.read()).toEqual(unselected)
})
