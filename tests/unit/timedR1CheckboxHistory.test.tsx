import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { TextEncoder as NodeTextEncoder } from 'node:util'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createEditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import { createCrossSurfaceCommands } from '../../src/renderer/composition/crossSurfaceCommands'
import { createCourseLifecycleSlice } from '../../src/renderer/store/slices/courseLifecycleSlice'
import { createCourseStructureSlice } from '../../src/renderer/store/slices/courseStructureSlice'
import { useEditorKeyboardRouter } from '../../src/renderer/app/useEditorKeyboardRouter'
import { ComponentPropertiesEditor } from '../../src/renderer/ui/ComponentPropertiesEditor'
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

it('undoes and redoes one ACKed checkbox property while preserving its focus and other input ownership', async () => {
  // Match Main's durable resource byte realm; jsdom supplies keyboard/focus.
  vi.stubGlobal('Uint8Array', new NodeTextEncoder().encode('').constructor)
  const directory = await mkdtemp(path.join(tmpdir(), 'guoling-r1-checkbox-'))
  dispose.push(() => rm(directory, { recursive: true, force: true }))
  const frame = { width: 320, height: 180, transform: [1, 0, 0, 1, 480, 270] as [number, number, number, number, number, number] }
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'checkbox-image', title: '图片', revision: 0,
    definitions: { [IMAGE_DEFINITION.id]: IMAGE_DEFINITION }, instances: { image: { id: 'image', definitionId: IMAGE_DEFINITION.id,
      data: JSON.parse(JSON.stringify(createImageData('image-asset'))), frame } },
    surfaces: [{ id: 'slide', kind: 'slide', title: '第一页', childIds: ['image'], designSize: { width: 1280, height: 720 } }],
    global: { underlay: [], overlay: [] }, assets: { 'image-asset': { id: 'image-asset', path: 'assets/image.png', filename: 'image.png', mimeType: 'image/png' } } }
  const service = new DocumentHostService(path.join(directory, 'recovery'))
  const initial = await service.internalAPI.create({ kind: 'course-v10', project, resources: { assets: { 'image-asset': new Uint8Array([1]) }, components: {} } }, '图片')
  const unavailable = async (): Promise<never> => { throw new Error('fixture has no dialogs') }
  const api: DocumentHostAPI = { ...service.internalAPI, bootstrapCourse: () => service.bootstrapCourse(), saveWithDialog: unavailable, close: unavailable,
    closeWithDialog: unavailable, discardRecovery: unavailable, subscribe: listener => service.subscribeEvents(listener) }
  const bridge = new CourseV10DocumentBridge(); await bridge.connect(api)
  dispose.push(async () => bridge.dispose())
  const feedback = vi.fn(), kernel = createEditorStoreKernel({ bridge, commit: feedback })
  const commands = createCrossSurfaceCommands({ kernel, slide: {}, flow: {}, spatial: {},
    structure: createCourseStructureSlice(kernel, { readActiveLocationId: () => bridge.read().surfaceId }),
    lifecycle: createCourseLifecycleSlice(kernel, { bridge, read: () => ({ projectPath: null, dirty: false }), patch: () => {} }),
    shell: { read: () => ({ canvasMode: 'edit', editingTextNodeId: null }), patch: () => {} } })
  commands.selectNode('image')
  let propertyAck: ReturnType<typeof kernel.editCaptured> | undefined, history: Promise<boolean> | undefined
  const undo = vi.fn(() => { history = commands.undo() }), redo = vi.fn(() => { history = commands.redo() })
  const nudgeSelection = vi.fn(), deleteSelectedNodes = vi.fn()
  function Properties() {
    const view = useSyncExternalStore(bridge.subscribe, bridge.read)
    useEditorKeyboardRouter({ isReadOnly: () => false, undo, redo, nudgeSelection, deleteSelectedNodes, selectedCount: () => 1,
      captureDeleteSnapshot: vi.fn(), routeEditorAction: vi.fn(), copySelection: vi.fn(), pasteClipboard: vi.fn(),
      duplicateSelection: vi.fn(), selectAll: vi.fn(), clearSelection: vi.fn(), saveProject: vi.fn(), newProject: vi.fn(), openProject: vi.fn() })
    return <ComponentPropertiesEditor definition={view.project!.definitions[IMAGE_DEFINITION.id]} node={view.project!.instances.image} onChange={value => {
      const target = kernel.captureTarget()
      propertyAck = kernel.editCaptured(kernel.capture([{ type: 'data.set', instanceId: 'image', path: [], value }], target))
    }} />
  }
  render(<Properties />)
  const checkbox = screen.getByRole('checkbox', { name: 'preserveAspectRatio' }) as HTMLInputElement
  checkbox.focus(); expect(checkbox.checked).toBe(true)
  fireEvent.click(checkbox)
  await act(async () => { await propertyAck })
  expect(checkbox.checked).toBe(false); expect(document.activeElement).toBe(checkbox)
  expect(bridge.read().snapshot).toMatchObject({ documentId: initial.documentId, revision: 1, undoDepth: 1, redoDepth: 0 })
  expect(imageDataSchema.parse(kernel.readDocument().instances.image.data).preserveAspectRatio).toBe(false)

  await act(async () => {
    expect(key(checkbox, 'z', { ctrlKey: true }).defaultPrevented).toBe(true)
    expect(await history).toBe(true)
  })
  expect(undo).toHaveBeenCalledOnce(); expect(checkbox.checked).toBe(true)
  expect(document.activeElement).toBe(checkbox)
  expect(bridge.read().snapshot).toMatchObject({ documentId: initial.documentId, revision: 2, undoDepth: 0, redoDepth: 1 })
  await act(async () => {
    expect(key(checkbox, 'y', { ctrlKey: true }).defaultPrevented).toBe(true)
    expect(await history).toBe(true)
  })
  expect(redo).toHaveBeenCalledOnce(); expect(checkbox.checked).toBe(false)
  expect(document.activeElement).toBe(checkbox)
  expect(bridge.read().snapshot).toMatchObject({ revision: 3, undoDepth: 1, redoDepth: 0 })
  expect(kernel.readDocument().instances.image.frame).toEqual(frame)
  for (const value of [' ', 'ArrowRight', 'Delete']) expect(key(checkbox, value).defaultPrevented).toBe(false)
  expect(nudgeSelection).not.toHaveBeenCalled(); expect(deleteSelectedNodes).not.toHaveBeenCalled()
  expect(key(checkbox, 'z', { ctrlKey: true, isComposing: true }).defaultPrevented).toBe(false)
  const composing = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
  Object.defineProperty(composing, 'keyCode', { value: 229 }); checkbox.dispatchEvent(composing)
  expect(composing.defaultPrevented).toBe(false)
  for (const input of [document.createElement('input'), document.createElement('textarea')]) {
    document.body.append(input); input.focus()
    expect(key(input, 'z', { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(key(input, 'y', { ctrlKey: true }).defaultPrevented).toBe(false)
  }
  expect(undo).toHaveBeenCalledOnce(); expect(redo).toHaveBeenCalledOnce()
  expect(bridge.read().snapshot?.revision).toBe(3); expect(feedback).not.toHaveBeenCalled()
})
