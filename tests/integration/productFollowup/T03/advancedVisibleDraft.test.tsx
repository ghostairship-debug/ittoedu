// @vitest-environment node
import { useSyncExternalStore } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ComponentSourceEditor } from '../../../../src/renderer/components/ComponentSourceEditor'
import { CourseV10DocumentBridge } from '../../../../src/renderer/documents/CourseV10DocumentBridge'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { courseDraftLifecycle } from '../../../../src/renderer/authoring/courseDraftLifecycle'
import type { CourseProjectV10 } from '../../../../src/shared/contracts/component-platform'
import type { DocumentSnapshot } from '../../../../src/shared/workbench/document'
import type { DocumentHostAPI } from '../../../../src/shared/workbench/desktop'

type TestDOM = { window: Window & typeof globalThis }
const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string, options: { url: string }) => TestDOM }
const disposers: Array<() => Promise<void>> = []
let dom: TestDOM, cleanupView: (() => void) | undefined
afterEach(async () => { cleanupView?.(); for (const dispose of disposers.splice(0).reverse()) await dispose(); dom?.window.close(); vi.unstubAllGlobals() })
const bytes = (value: string) => new TextEncoder().encode(value)
const decode = (value: Uint8Array) => new TextDecoder().decode(value)
const original = 'export const value = 42;'
function project(): CourseProjectV10 {
  return { schemaVersion: 10, id: 'T03-project', revision: 0, title: 'Teacher draft', definitions: {
    custom: { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'javascript', workspace: { ownerId: 'code', entry: 'main.js' } } },
  }, instances: { a: { id: 'a', definitionId: 'custom', name: 'A', data: { label: 'A' }, frame: { width: 180, height: 90, transform: [1, 0, 0, 1, 23, 41] } },
    b: { id: 'b', definitionId: 'custom', name: 'B', data: { label: 'B' } } },
  surfaces: [{ id: 'page', kind: 'slide', title: 'Page', childIds: ['a', 'b'] }], global: { underlay: [], overlay: [] }, assets: {} }
}
function api(host: DocumentHostService, initial: DocumentSnapshot): DocumentHostAPI {
  const unavailable = async (): Promise<never> => { throw new Error('No fixture dialog') }
  return { ...host.internalAPI, bootstrapCourse: async () => initial, saveWithDialog: unavailable, closeWithDialog: unavailable, discardRecovery: unavailable,
    close: async (documentId, discardDirty) => { await host.operate({ type: 'close', documentId, discardDirty }) }, subscribe: listener => host.subscribeEvents(listener) }
}
async function fixture() {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
  for (const name of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'MutationObserver'] as const)
    vi.stubGlobal(name, name === 'window' ? dom.window : dom.window[name])
  const testing = await import('@testing-library/react/pure'); cleanupView = testing.cleanup
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T03-visible-'))
  disposers.push(async () => { if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup'); await fs.rm(directory, { recursive: true, force: true }) })
  const host = new DocumentHostService(path.join(directory, 'host'))
  const initial = await host.internalAPI.create({ kind: 'course-v10', project: project(), resources: { assets: {}, components: { code: { 'main.js': bytes(original) } } } }, 'lesson.h5lesson')
  const bridge = new CourseV10DocumentBridge(); disposers.push(async () => bridge.dispose())
  await bridge.connect(api(host, initial)); bridge.selectInstances(initial.documentId, ['a'], 'page')
  return { ...testing, screen: testing.within(document.body), host, bridge, directory, initial }
}
function Source({ bridge }: { bridge: CourseV10DocumentBridge }) {
  const view = useSyncExternalStore(bridge.subscribe, bridge.read), instance = view.project!.instances[view.selectedInstanceId!]
  return <ComponentSourceEditor instance={instance} implementation={view.project!.definitions[instance.definitionId].implementation} scope="definition"
    bridge={bridge} documentId={view.activeDocumentId!} report={() => {}} />
}

it('prepares unmounted source and object JSON visible inputs through the real V10 owner without Apply then saves and cold reopens', async () => {
  const h = await fixture()
  const editor = h.render(<Source bridge={h.bridge} />)
  h.fireEvent.change(h.screen.getByRole('textbox', { name: '组件实现源码' }), { target: { value: 'export const value = 85;' } })
  editor.unmount()
  const { useEditorStore } = await import('../../../../src/renderer/store/editorStore')
  const { createEditorStoreKernel } = await import('../../../../src/renderer/store/editorStoreKernel')
  const { DeveloperTab } = await import('../../../../src/renderer/ui/DeveloperTab')
  const previous = useEditorStore.getState()
  const kernel = createEditorStoreKernel({ bridge: h.bridge, commit: patch => useEditorStore.setState(patch) })
  useEditorStore.setState({ courseView: h.bridge.read(), courseBridge: h.bridge, courseKernel: kernel, editingScope: 'scene' })
  const unsubscribe = h.bridge.subscribe(() => useEditorStore.setState({ courseView: h.bridge.read() }))
  disposers.push(async () => { unsubscribe(); useEditorStore.setState(previous, true) })
  const developer = h.render(<DeveloperTab />)
  h.fireEvent.click(h.screen.getByRole('tab', { name: /对象 JSON/ }))
  h.fireEvent.change(h.screen.getByRole('textbox', { name: '所选对象 · A' }), { target: { value: JSON.stringify({ ...h.bridge.read().project!.instances.a, data: { label: 'Visible teacher edit' } }) } })
  developer.unmount()
  h.bridge.selectInstances(h.initial.documentId, ['b'], 'page')
  await h.act(async () => expect(await courseDraftLifecycle(h.bridge).prepare(h.initial.documentId)).toMatchObject({ ready: true, issues: [] }))
  const after = await h.host.internalAPI.read(h.initial.documentId)
  expect(after.undoDepth).toBe(2)
  expect(after.model.kind).toBe('course-v10')
  if (after.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(after.model.project.instances.a.data).toEqual({ label: 'Visible teacher edit' })
  expect(after.model.project.instances.b.data).toEqual({ label: 'B' })
  expect(decode(after.model.resources.components.code['main.js'])).toBe('export const value = 85;')
  const revision = after.revision
  await courseDraftLifecycle(h.bridge).prepare(h.initial.documentId)
  expect((await h.host.internalAPI.read(h.initial.documentId)).revision).toBe(revision)
  const filename = path.join(h.directory, 'lesson.h5lesson'); await h.host.saveToPath(h.initial.documentId, filename)
  const cold = await new DocumentHostService(path.join(h.directory, 'cold')).open(filename)
  if (cold.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(cold.model.project.instances.a.data).toEqual({ label: 'Visible teacher edit' })
  expect(decode(cold.model.resources.components.code['main.js'])).toBe('export const value = 85;')
  await h.bridge.undo(h.initial.documentId)
  expect((await h.host.internalAPI.read(h.initial.documentId)).undoDepth).toBe(1)
})

it('preserves an incomplete source as raw recovery input on a fresh Bridge without submitting or executing it', async () => {
  const h = await fixture(), editor = h.render(<Source bridge={h.bridge} />)
  const area = h.screen.getByRole('textbox', { name: '组件实现源码' })
  h.fireEvent.compositionStart(area); h.fireEvent.change(area, { target: { value: 'export const value =' } })
  expect(await courseDraftLifecycle(h.bridge).prepare(h.initial.documentId)).toMatchObject({ ready: false })
  const recovered = JSON.parse(JSON.stringify(courseDraftLifecycle(h.bridge).preserve(h.initial.documentId)))
  expect(recovered).toHaveLength(1)
  editor.unmount()
  const coldHost = new DocumentHostService(path.join(h.directory, 'cold-raw'))
  const coldDoc = await coldHost.internalAPI.create(h.initial.model, 'lesson.h5lesson')
  const coldBridge = new CourseV10DocumentBridge(); disposers.push(async () => coldBridge.dispose())
  await coldBridge.connect(api(coldHost, coldDoc)); coldBridge.selectInstances(coldDoc.documentId, ['a'], 'page')
  expect(courseDraftLifecycle(coldBridge).restore(coldDoc.documentId, recovered)).toMatchObject({ restored: 1, issues: [] })
  h.render(<Source bridge={coldBridge} />)
  expect(h.screen.getByRole('textbox', { name: '组件实现源码' })).toHaveValue('export const value =')
  expect((await coldHost.internalAPI.read(coldDoc.documentId)).undoDepth).toBe(0)
  expect((await coldHost.internalAPI.read(coldDoc.documentId)).revision).toBe(coldDoc.revision)
  expect(await courseDraftLifecycle(coldBridge).prepare(coldDoc.documentId)).toMatchObject({ ready: false })
})
