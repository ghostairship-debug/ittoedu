import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AssetMeta } from '@/shared/contracts/media-v1'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createBlankSpatialCourseProject } from '../../src/renderer/project/createSpatialCourseProject'
import { createSpatialWorldTargetAuthoringController } from '../../src/renderer/authoring/spatialWorldTargetAuthoring'
import { buildSpatialEditorView, captureSpatialEditorAuthoringTarget } from '../../src/renderer/course/spatialEditorView'
import { formulaAstToAccessibleText, parseFormulaLinear } from '../../src/shared/formulaLinear'
import { CourseEditorActionsContext, type CourseEditorActions } from '../../src/renderer/documents/CourseEditorActionsContext'
import { CourseEditorChromeContext } from '../../src/renderer/documents/CourseEditorChromeContext'
import type { MenuCommand } from '../../src/renderer/editing/commands/CommandMenu'
import { singleObjectCommands, type ObjectCommandPorts } from '../../src/renderer/editing/commands/objectCommands'
import { OBJECT_EDIT_EVENT, requestObjectContextMenu } from '../../src/renderer/editing/commands/objectContextMenu'
import { hiddenObjectCommands, hiddenObjectName } from '../../src/renderer/editing/commands/hiddenObjectCommands'
import { selectActiveCourseLocationId, selectSelectedNode, selectSelectedNodeId, selectSelectedNodeIds, useEditorStore } from '../../src/renderer/store/editorStore'
import { NativeSelectionContext } from '../../src/renderer/workbench/NativeSelectionContext'
import { createCourseStoreHost } from '../helpers/courseStoreHost'

const store = () => useEditorStore.getState()
const previousDesktopAPI = window.desktopAPI
const previousCreate = URL.createObjectURL, previousRevoke = URL.revokeObjectURL
beforeEach(() => {
  // jsdom has no object URLs; the crop overlay draws the image file through one.
  URL.createObjectURL = vi.fn(() => 'blob:crop-source')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: previousDesktopAPI })
  URL.createObjectURL = previousCreate
  URL.revokeObjectURL = previousRevoke
})

function ports(): ObjectCommandPorts {
  return { copy: vi.fn(), paste: vi.fn(), duplicate: vi.fn(), remove: vi.fn(), canReorder: () => true, reorder: vi.fn() }
}
const state = (overrides: Partial<Parameters<typeof singleObjectCommands>[0]> = {}) =>
  ({ locked: false, visible: true, setLocked: vi.fn(), setVisible: vi.fn(), ...overrides })
const reasons = (items: readonly MenuCommand[]) => Object.fromEntries(items.map(item => [item.id, item.disabledReason ?? null]))

const image: AssetMeta = { id: 'asset_crop_image', filename: 'photo.png', mimeType: 'image/png', kind: 'image', path: 'assets/asset_crop_image.png', byteLength: 4, width: 1920, height: 1080 }
const video = (id: string): AssetMeta => ({ id, filename: `${id}.mp4`, mimeType: 'video/mp4', kind: 'video', path: `assets/${id}.mp4`, byteLength: 3, width: 640, height: 360, duration: 3 })

async function openWith(add: () => void) {
  const host = await createCourseStoreHost()
  await host.open(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }))
  add(); await store().drainCourseDocument()
  const documentId = store().courseDocument.documentId!
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { documents: host.api } })
  return { host, documentId, id: selectSelectedNodeId(store())! }
}

/** The selection's quick bar and menus as the workbench mounts them, with the object drawn at half size. */
function CurrentSelection({ documentId, actions = { replaceImage: vi.fn(), replaceVideo: vi.fn() } }: { documentId: string; actions?: CourseEditorActions }) {
  const revision = useEditorStore(current => current.courseDocument.snapshot?.revision ?? 0)
  const itemIds = useEditorStore(selectSelectedNodeIds)
  const locationId = useEditorStore(selectActiveCourseLocationId)
  const bounds = () => {
    const node = selectSelectedNode(store())
    return node ? { left: 100 + node.x / 2, top: 100 + node.y / 2, width: node.width / 2, height: node.height / 2 } : null
  }
  return <CourseEditorActionsContext.Provider value={actions}><CourseEditorChromeContext.Provider value={{ documentId, mode: 'light', setMode() {} }}>
    <main data-testid="workspace"><NativeSelectionContext documentId={documentId} revision={revision} locationId={locationId} itemIds={itemIds} enabled bounds={bounds} /></main>
  </CourseEditorChromeContext.Provider></CourseEditorActionsContext.Provider>
}

const selectedImage = () => {
  const node = selectSelectedNode(store())
  if (node?.type !== 'image') throw new Error('an image is selected')
  return node
}

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

it('M21 on the infinite canvas a hidden object comes back by selecting it and patching the whole item', async () => {
  const host = await createCourseStoreHost()
  await host.open(createBlankSpatialCourseProject({ now: '2026-09-26T09:00:00.000Z' }))
  store().addFormulaNode(); await store().drainCourseDocument()
  const id = selectSelectedNodeId(store())!
  store().updateNodes([{ nodeId: id, patch: { visible: false } }]); await store().drainCourseDocument()
  store().selectNode(null); await store().drainCourseDocument()
  const session = store().spatialSession!, token = store().courseAuthoringSession!.token
  const view = buildSpatialEditorView({ project: session.history.present, locationId: session.selection.locationId, sessionCamera: session.sessionCamera })
  const target = (input: Parameters<typeof captureSpatialEditorAuthoringTarget>[0]['target']) => captureSpatialEditorAuthoringTarget({ view, sessionToken: token, target: input })
  const item = target({ kind: 'layer', layerItemId: id, field: 'item' })
  const show = () => store().runSpatialAuthoringIntent(item, { kind: 'patch-layers', updates: [{ target: item, patch: { visible: true } }], expectedSelectionIds: [id], expectedContentEdit: null })
  // Layer patches apply to the selection only, so the canvas selects the objects first.
  expect(show()).toMatchObject({ ok: false })
  expect(store().runSpatialAuthoringIntent(target({ kind: 'world', field: 'world' }), { kind: 'select-layers', layerItemIds: [id], expectedContentEdit: null })).toMatchObject({ ok: true })
  expect(show()).toMatchObject({ ok: true, historyEntry: true })
  await store().drainCourseDocument()
  expect(selectSelectedNode(store())).toMatchObject({ id, visible: true })
})

it('M21 an image switches how it fills its frame from the quick bar, and crops in place as one step', async () => {
  const { documentId } = await openWith(() => store().addImageNode(image, new Uint8Array([1, 2, 3, 4]), 40, 60))
  render(<CurrentSelection documentId={documentId} />)
  const bar = await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
  expect(within(bar).getByRole('button', { name: '替换图片' })).toBeTruthy()
  const before = selectedImage()
  expect(before).toMatchObject({ x: 40, y: 60, width: 640, height: 360, fit: 'contain' })

  fireEvent.click(within(bar).getByRole('button', { name: '显示方式' }))
  const fitMenu = screen.getByRole('menu', { name: '显示方式' })
  expect(within(fitMenu).getByRole('menuitemradio', { name: '适应（完整显示）' }).getAttribute('aria-checked')).toBe('true')
  await act(async () => { fireEvent.click(within(fitMenu).getByRole('menuitemradio', { name: '填充（允许裁剪）' })); await store().drainCourseDocument() })
  expect(selectedImage()).toMatchObject({ fit: 'cover' })
  expect(screen.queryByRole('menu', { name: '显示方式' })).toBeNull()

  // 取消 (and Esc) leave the image as it was.
  fireEvent.click(within(bar).getByRole('button', { name: '裁剪' }))
  expect(screen.getByRole('dialog', { name: '裁剪图片' })).toBeTruthy()
  // The quick bar steps aside while the crop runs.
  expect(bar.closest('[data-selection-quick-bar]')?.getAttribute('data-suspended')).toBe('true')
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: '裁剪图片' })).toBeNull()
  expect(selectedImage()).toMatchObject({ x: 40, y: 60, width: 640, height: 360 })

  // Dragging the right edge 30 px in on screen (half size) keeps 580 of the 640 units, where they were seen.
  fireEvent.click(within(bar).getByRole('button', { name: '裁剪' }))
  const right = screen.getByRole('slider', { name: '裁剪右边' })
  right.setPointerCapture = vi.fn(); right.hasPointerCapture = () => true; right.releasePointerCapture = vi.fn()
  fireEvent.pointerDown(right, { pointerId: 1, clientX: 440, clientY: 200 })
  fireEvent.pointerMove(right, { pointerId: 1, clientX: 410, clientY: 200 })
  fireEvent.pointerUp(right, { pointerId: 1, clientX: 410, clientY: 200 })
  expect(screen.getByTestId('image-crop-box').style.width).toBe('290px')
  const revision = store().courseDocument.snapshot?.revision ?? 0
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '完成' })); await store().drainCourseDocument() })
  expect(screen.queryByRole('dialog', { name: '裁剪图片' })).toBeNull()
  expect(selectedImage()).toMatchObject({ x: 40, y: 60, width: 580, height: 360, crop: { left: 0, top: 0, right: 0.0938, bottom: 0 } })
  expect(store().courseDocument.snapshot?.revision).toBe(revision + 1)

  // One undo brings back both the frame and the crop.
  store().undo()
  await vi.waitFor(() => expect(selectedImage()).toMatchObject({ width: 640, crop: { right: 0 } }))
})

it('M21 a formula\'s 编辑公式 asks the workspace for its editor, from the quick bar and the right-click menu', async () => {
  const { documentId, id } = await openWith(() => store().addFormulaNode())
  render(<CurrentSelection documentId={documentId} />)
  const bar = await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
  const root = screen.getByTestId('workspace')
  const asked: string[] = []
  const open = (event: Event) => { asked.push((event as CustomEvent<{ itemId: string }>).detail.itemId); event.preventDefault() }
  root.addEventListener(OBJECT_EDIT_EVENT, open)
  fireEvent.click(within(bar).getByRole('button', { name: '编辑公式' }))
  expect(asked).toEqual([id])
  act(() => { requestObjectContextMenu(root, { x: 300, y: 260, itemIds: [id] }) })
  const menu = screen.getByRole('menu', { name: '对象操作' })
  expect(within(menu).getAllByRole('menuitem')[0]!.getAttribute('aria-label')).toBe('编辑公式')
  fireEvent.click(within(menu).getByRole('menuitem', { name: '编辑公式' }))
  expect(asked).toEqual([id, id])
  root.removeEventListener(OBJECT_EDIT_EVENT, open)
})

it('M21 on the infinite canvas 编辑公式 opens the formula editor by id and its change commits; crop and video replacement stay Slide tools', async () => {
  const host = await createCourseStoreHost()
  await host.open(createBlankSpatialCourseProject({ now: '2026-09-26T09:00:00.000Z' }))
  store().addFormulaNode(); await store().drainCourseDocument()
  const documentId = store().courseDocument.documentId!
  const formulaId = selectSelectedNodeId(store())!
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { documents: host.api } })
  render(<CurrentSelection documentId={documentId} />)
  let bar = await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
  // With no canvas to answer the request, the bar says so instead of doing nothing.
  fireEvent.click(within(bar).getByRole('button', { name: '编辑公式' }))
  expect(screen.getByRole('alert').textContent).toBe('公式编辑器现在打不开，请双击公式再试。')
  cleanup()

  // The canvas answers it as a double-click does: the formula's content edit opens, and its change commits.
  const session = store().spatialSession!, token = store().courseAuthoringSession!.token
  const view = buildSpatialEditorView({ project: session.history.present, locationId: session.selection.locationId, sessionCamera: session.sessionCamera })
  const target = (input: Parameters<typeof captureSpatialEditorAuthoringTarget>[0]['target']) => captureSpatialEditorAuthoringTarget({ view, sessionToken: token, target: input })
  const controller = createSpatialWorldTargetAuthoringController({
    readSnapshot: () => ({ view, selectionIds: [formulaId], scope: session.scope, contentEdit: store().spatialContentEdit,
      worldTarget: target({ kind: 'world', field: 'world' }), layerTargets: new Map([[formulaId, target({ kind: 'layer', layerItemId: formulaId, field: 'frame' })]]) }),
    commands: { run: (at, intent) => store().runSpatialAuthoringIntent(at, intent) },
  })
  expect(controller.beginContentEdit('someone-else')).toBeNull()
  expect(controller.beginContentEdit(formulaId)).toMatchObject({ ok: true })
  const edit = store().spatialContentEdit
  if (edit?.kind !== 'formula' || !edit.courseTarget) throw new Error('a formula content edit bound to its target')
  const ast = parseFormulaLinear('a/b')
  expect(store().runSpatialAuthoringIntent(edit.courseTarget, { kind: 'commit-formula-content-edit', expectedEdit: edit, expectedContentEdit: edit, ast, accessibleText: formulaAstToAccessibleText(ast) }))
    .toMatchObject({ ok: true })
  await store().drainCourseDocument()
  expect(selectSelectedNode(store())).toMatchObject({ id: formulaId, type: 'formula', ast })

  store().addImageNode(image, new Uint8Array([1, 2, 3, 4])); await store().drainCourseDocument()
  render(<CurrentSelection documentId={documentId} />)
  bar = await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
  expect(within(bar).getByRole('button', { name: '显示方式' })).toBeTruthy()
  expect(within(bar).queryByRole('button', { name: '裁剪' })).toBeNull()
  cleanup()
  store().addVideoNode(video('asset_world_video'), new Uint8Array([1, 2, 3])); await store().drainCourseDocument()
  render(<CurrentSelection documentId={documentId} />)
  bar = await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
  expect(within(bar).queryByRole('button', { name: '替换视频' })).toBeNull()
  expect(store().replaceSelectedVideo(video('asset_other_video'), new Uint8Array([4, 5, 6]))).toEqual({ ok: false, reason: '请先选中当前演示页中的视频' })
})

it('M21 replacing the selected video keeps its frame and settings, and says why when nothing is selected', async () => {
  const { documentId, id } = await openWith(() => store().addVideoNode(video('asset_old_video'), new Uint8Array([1, 2, 3]), 80, 90))
  // The quick bar's 替换 and the menu's 替换视频… both hand over to the App's picker.
  const actions = { replaceImage: vi.fn(), replaceVideo: vi.fn() }
  render(<CurrentSelection documentId={documentId} actions={actions} />)
  const bar = await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
  fireEvent.click(within(bar).getByRole('button', { name: '替换视频' }))
  act(() => { requestObjectContextMenu(screen.getByTestId('workspace'), { x: 300, y: 260, itemIds: [id] }) })
  fireEvent.click(within(screen.getByRole('menu', { name: '对象操作' })).getByRole('menuitem', { name: '替换视频…' }))
  expect(actions.replaceVideo).toHaveBeenCalledTimes(2)
  cleanup()

  const before = selectSelectedNode(store())
  if (before?.type !== 'video') throw new Error('a video is selected')
  store().updateNodes([{ nodeId: id, patch: { loop: true, muted: true } }]); await store().drainCourseDocument()

  expect(store().replaceSelectedVideo(video('asset_new_video'), new Uint8Array([4, 5, 6]))).toEqual({ ok: true })
  await store().drainCourseDocument()
  const after = selectSelectedNode(store())
  expect(after).toMatchObject({ id, type: 'video', assetId: 'asset_new_video', x: before.x, y: before.y, width: before.width, height: before.height, loop: true, muted: true })

  store().selectNode(null); await store().drainCourseDocument()
  expect(store().replaceSelectedVideo(video('asset_third_video'), new Uint8Array([7, 8, 9]))).toEqual({ ok: false, reason: '请先选中当前演示页中的视频' })
})
