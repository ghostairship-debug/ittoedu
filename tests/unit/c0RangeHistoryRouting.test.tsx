import { createCourseStructureSlice } from '../../src/renderer/store/slices/courseStructureSlice'
import { createCourseLifecycleSlice } from '../../src/renderer/store/slices/courseLifecycleSlice'
import { documentHostAPI } from '../helpers/documentHostAPI'
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { TextEncoder as NodeTextEncoder } from 'node:util'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createEditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import { createCrossSurfaceCommands, type CrossSurfaceCommandPorts } from '../../src/renderer/composition/crossSurfaceCommands'
import { useEditorKeyboardRouter, type EditorKeyboardActionPorts } from '../../src/renderer/app/useEditorKeyboardRouter'
import { IMAGE_DEFINITION, createImageData, imageDataSchema } from '../../src/components/image'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'

const dispose: Array<() => Promise<void>> = []
afterEach(async () => {
  cleanup(); document.body.replaceChildren()
  for (const action of dispose.splice(0).reverse()) await action()
  vi.unstubAllGlobals()
})
const key = (target: EventTarget, value: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, composed: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

it('routes retained range focus to captured formal undo, keeping native text/IME, range arrows/delete and clipboard unchanged', async () => {
  // Main's durable journal clones bytes in the Node realm. Keep that real byte
  // constructor while jsdom supplies only the keyboard and focus surface.
  vi.stubGlobal('Uint8Array', new NodeTextEncoder().encode('').constructor)
  const directory = await mkdtemp(path.join(tmpdir(), 'guoling-c0-range-'))
  dispose.push(() => rm(directory, { recursive: true, force: true }))
  const data = JSON.parse(JSON.stringify(createImageData('old')))
  data.crop.left = 0.25
  const frame = { width: 320, height: 180, transform: [1, 0, 0, 1, 480, 270] as [number, number, number, number, number, number] }
  const asset = (id: string) => ({ id, path: `assets/${id}.png`, filename: `${id}.png`, mimeType: 'image/png' })
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'range-image', title: '图片', revision: 12,
    definitions: { [IMAGE_DEFINITION.id]: IMAGE_DEFINITION }, instances: { image: { id: 'image', definitionId: IMAGE_DEFINITION.id, data, frame } },
    surfaces: [{ id: 'slide', kind: 'slide', title: '第一页', childIds: ['image'], designSize: { width: 1280, height: 720 } }],
    global: { underlay: [], overlay: [] }, assets: { old: asset('old') } }
  const service = new DocumentHostService(path.join(directory, 'recovery'))
  const initial = await service.internalAPI.create({ kind: 'course-v10', project, resources: { assets: { old: new Uint8Array([1]) }, components: {} } }, 'image.glx')
  const unavailable = async (): Promise<never> => { throw new Error('fixture has no dialogs') }
  const api: DocumentHostAPI = { ...documentHostAPI(service), bootstrapCourse: () => service.bootstrapCourse(), saveWithDialog: unavailable, close: unavailable,
    closeWithDialog: unavailable, discardRecovery: unavailable, subscribe: listener => service.subscribeEvents(listener) }
  const bridge = new CourseV10DocumentBridge(); await bridge.connect(api)
  dispose.push(async () => bridge.dispose())
  const feedback = vi.fn(), kernel = createEditorStoreKernel({ bridge, commit: feedback })
  const commands = createCrossSurfaceCommands({ kernel, slide: {}, flow: {}, spatial: {},
    structure: createCourseStructureSlice(kernel, { readActiveLocationId: () => kernel.readView().surfaceId }),
    lifecycle: createCourseLifecycleSlice(kernel, { bridge, read: () => ({ projectPath: null, dirty: bridge.read().snapshot?.dirty ?? false }), patch() {} }), shell: { read: () => ({ canvasMode: 'edit', editingTextNodeId: null }), patch: () => {} } })
  await kernel.edit([{ type: 'asset.add', asset: asset('replacement'), bytes: new Uint8Array([2]) },
    { type: 'data.set', instanceId: 'image', path: [], value: { ...data, assetId: 'replacement', originalAssetId: 'replacement' } }])
  commands.selectNode('image')
  expect(bridge.read().snapshot).toMatchObject({ revision: 13, undoDepth: 1 })

  let history: Promise<boolean> | undefined
  const undo = vi.fn(() => { history = commands.undo() }), redo = vi.fn(() => { history = commands.redo() })
  const nudgeSelection = vi.fn(), deleteSelectedNodes = vi.fn(), pasteClipboard = vi.fn()
  renderHook(() => useEditorKeyboardRouter({ isReadOnly: () => false, undo, redo, nudgeSelection, deleteSelectedNodes, pasteClipboard,
    selectedCount: () => 1, captureDeleteSnapshot: vi.fn(), routeEditorAction: vi.fn() } as unknown as EditorKeyboardActionPorts))
  const range = document.createElement('input'); range.type = 'range'
  const canvas = document.createElement('main')
  document.body.append(range, canvas); range.focus()
  canvas.addEventListener('mousedown', event => event.preventDefault())
  canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  canvas.click()
  expect(document.activeElement).toBe(range)
  expect(key(range, 'z', { ctrlKey: true }).defaultPrevented).toBe(true)
  expect(undo).toHaveBeenCalledOnce(); expect(await history).toBe(true)
  expect(bridge.read().snapshot).toMatchObject({ documentId: initial.documentId, revision: 14, undoDepth: 0, redoDepth: 1 })
  expect(imageDataSchema.parse(kernel.readDocument().instances.image.data)).toMatchObject({ assetId: 'old', originalAssetId: 'old', crop: { left: 0.25 } })
  expect(kernel.readDocument().instances.image.frame).toEqual(frame)
  expect(document.activeElement).toBe(range)

  expect(key(range, 'ArrowRight').defaultPrevented).toBe(false)
  expect(key(range, 'Delete').defaultPrevented).toBe(false)
  expect(key(range, 'v', { ctrlKey: true }).defaultPrevented).toBe(false)
  expect(nudgeSelection).not.toHaveBeenCalled(); expect(deleteSelectedNodes).not.toHaveBeenCalled(); expect(pasteClipboard).not.toHaveBeenCalled()
  expect(key(range, 'z', { ctrlKey: true, isComposing: true }).defaultPrevented).toBe(false)
  const composing = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
  Object.defineProperty(composing, 'keyCode', { value: 229 }); range.dispatchEvent(composing)
  expect(composing.defaultPrevented).toBe(false); expect(undo).toHaveBeenCalledOnce()

  for (const input of [document.createElement('input'), document.createElement('textarea')]) {
    document.body.append(input); input.focus()
    expect(key(input, 'z', { ctrlKey: true }).defaultPrevented).toBe(false)
  }
  const host = document.createElement('div'), source = document.createElement('textarea')
  host.attachShadow({ mode: 'open' }).append(source); document.body.append(host); source.focus()
  expect(key(source, 'z', { ctrlKey: true }).defaultPrevented).toBe(false)
  expect(key(host, 'z', { ctrlKey: true }).defaultPrevented).toBe(false)
  const editable = document.createElement('div'); editable.contentEditable = 'true'; editable.tabIndex = 0
  Object.defineProperty(editable, 'isContentEditable', { value: true })
  document.body.append(editable); editable.focus()
  expect(key(editable, 'z', { ctrlKey: true }).defaultPrevented).toBe(false)
  expect(undo).toHaveBeenCalledOnce(); expect(redo).not.toHaveBeenCalled()
  expect(bridge.read().snapshot?.revision).toBe(14); expect(feedback).not.toHaveBeenCalled()
  range.focus()
  expect(key(range, 'y', { ctrlKey: true }).defaultPrevented).toBe(true)
  expect(redo).toHaveBeenCalledOnce(); expect(await history).toBe(true)
  expect(imageDataSchema.parse(kernel.readDocument().instances.image.data)).toMatchObject({ assetId: 'replacement', originalAssetId: 'replacement', crop: { left: 0.25 } })
  expect(bridge.read().snapshot).toMatchObject({ revision: 15, undoDepth: 1, redoDepth: 0 })
})
