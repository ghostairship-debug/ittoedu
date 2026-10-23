// @vitest-environment node
import { createTestProjectFromLegacy } from '../../../helpers/glxWorkFixture'
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
  return createTestProjectFromLegacy({ schemaVersion: 10, id: 'T03-project', revision: 0, title: 'Teacher draft', definitions: {
    custom: { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'javascript', workspace: { ownerId: 'code', entry: 'main.js' } } },
  }, instances: { a: { id: 'a', definitionId: 'custom', name: 'A', data: { label: 'A' }, frame: { width: 180, height: 90, transform: [1, 0, 0, 1, 23, 41] } },
    b: { id: 'b', definitionId: 'custom', name: 'B', data: { label: 'B' } } },
  surfaces: [{ id: 'page', kind: 'slide', title: 'Page', childIds: ['a', 'b'] }], global: { underlay: [], overlay: [] }, assets: {} })
}
function api(host: DocumentHostService, initial: DocumentSnapshot): DocumentHostAPI {
  const unavailable = async (): Promise<never> => { throw new Error('No fixture dialog') }
  return { ...host.internalAPI, bootstrapCourse: async () => initial, saveWithDialog: unavailable, closeWithDialog: unavailable, discardRecovery: unavailable,
    readAuthoringDrafts: id => host.readAuthoringDrafts(id), writeAuthoringDrafts: (id, drafts) => host.writeAuthoringDrafts(id, drafts), clearAuthoringDrafts: id => host.clearAuthoringDrafts(id),
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

it('durably preserves unmounted source and JSON, then explicitly applies recovered input through the real owner before save and cold reopen', async () => {
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
  const parked = await h.host.internalAPI.read(h.initial.documentId)
  expect(parked.undoDepth).toBe(0)
  expect(parked.revision).toBe(h.initial.revision)
  expect(parked.model.kind).toBe('course-v10')
  if (parked.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(parked.model.project.instances.a.data).toEqual({ label: 'A' })
  expect(parked.model.project.instances.b.data).toEqual({ label: 'B' })
  expect(decode(parked.model.resources.components.code['main.js'])).toBe(original)
  const raw = JSON.parse(JSON.stringify(courseDraftLifecycle(h.bridge).preserve(h.initial.documentId)))
  expect(raw).toHaveLength(2)
  await h.host.writeAuthoringDrafts(h.initial.documentId, { advanced: raw, properties: [] })
  unsubscribe(); h.bridge.dispose()
  const recoveredHost = new DocumentHostService(path.join(h.directory, 'host'))
  const recoveredDoc = await recoveredHost.internalAPI.restore(h.initial.documentId)
  const persisted = await recoveredHost.readAuthoringDrafts(recoveredDoc.documentId)
  expect(persisted?.advanced).toEqual(raw)
  const recoveredBridge = new CourseV10DocumentBridge(); disposers.push(async () => recoveredBridge.dispose())
  await recoveredBridge.connect(api(recoveredHost, recoveredDoc)); recoveredBridge.selectInstances(recoveredDoc.documentId, ['a'], 'page')
  const recoveredKernel = createEditorStoreKernel({ bridge: recoveredBridge, commit: patch => useEditorStore.setState(patch) })
  useEditorStore.setState({ courseView: recoveredBridge.read(), courseBridge: recoveredBridge, courseKernel: recoveredKernel, editingScope: 'scene' })
  const stopRecovered = recoveredBridge.subscribe(() => useEditorStore.setState({ courseView: recoveredBridge.read() }))
  disposers.push(async () => { stopRecovered() })
  h.render(<Source bridge={recoveredBridge} />)
  h.render(<DeveloperTab />); h.fireEvent.click(h.screen.getByRole('tab', { name: /对象 JSON/ }))
  const lifecycle = courseDraftLifecycle(recoveredBridge)
  await h.act(async () => expect(lifecycle.restore(recoveredDoc.documentId, persisted!.advanced)).toMatchObject({ restored: 2, issues: [] }))
  expect(h.screen.getByRole('textbox', { name: '组件实现源码' })).toHaveValue('export const value = 85;')
  expect(JSON.parse((h.screen.getByRole('textbox', { name: '所选对象 · A' }) as HTMLTextAreaElement).value).data).toEqual({ label: 'Visible teacher edit' })
  expect(await lifecycle.prepare(recoveredDoc.documentId)).toMatchObject({ ready: true, issues: [] })
  expect(await recoveredHost.internalAPI.read(recoveredDoc.documentId)).toMatchObject({ revision: recoveredDoc.revision, undoDepth: 0 })
  await recoveredHost.claimAuthoringDrafts(recoveredDoc.documentId, recoveredDoc.epoch,
    persisted!.recoveryRecords!.filter(record => record.kind === 'advanced').map(({ id, digest }) => ({ id, digest })))
  await h.act(async () => h.fireEvent.click(h.screen.getByRole('button', { name: '保存实现' })))
  await h.waitFor(() => expect(lifecycle.preserve(recoveredDoc.documentId).filter(record => record.kind === 'source')).toEqual([]))
  await h.act(async () => h.fireEvent.click(h.screen.getByRole('button', { name: '校验并应用' })))
  await h.waitFor(() => expect(lifecycle.preserve(recoveredDoc.documentId)).toEqual([]))
  await recoveredHost.writeAuthoringDrafts(recoveredDoc.documentId, { advanced: [], properties: [] })
  expect(await recoveredHost.readAuthoringDrafts(recoveredDoc.documentId)).toBeNull()
  const after = await recoveredHost.internalAPI.read(recoveredDoc.documentId)
  expect(after.undoDepth).toBe(2)
  expect(after.model.kind).toBe('course-v10')
  if (after.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(after.model.project.instances.a.data).toEqual({ label: 'Visible teacher edit' })
  expect(after.model.project.instances.b.data).toEqual({ label: 'B' })
  expect(decode(after.model.resources.components.code['main.js'])).toBe('export const value = 85;')
  const revision = after.revision
  await lifecycle.prepare(recoveredDoc.documentId)
  expect((await recoveredHost.internalAPI.read(recoveredDoc.documentId)).revision).toBe(revision)
  const filename = path.join(h.directory, 'lesson.h5lesson'); await recoveredHost.saveToPath(recoveredDoc.documentId, filename)
  const cold = await new DocumentHostService(path.join(h.directory, 'cold')).open(filename)
  if (cold.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(cold.model.project.instances.a.data).toEqual({ label: 'Visible teacher edit' })
  expect(decode(cold.model.resources.components.code['main.js'])).toBe('export const value = 85;')
  await recoveredBridge.undo(recoveredDoc.documentId)
  expect((await recoveredHost.internalAPI.read(recoveredDoc.documentId)).undoDepth).toBe(1)
})

it('preserves unfinished IME source as raw recovery input on a fresh Bridge until the user resumes input', async () => {
  const h = await fixture(), editor = h.render(<Source bridge={h.bridge} />)
  const area = h.screen.getByRole('textbox', { name: '组件实现源码' })
  h.fireEvent.compositionStart(area); h.fireEvent.change(area, { target: { value: 'export const value =' } })
  expect(await courseDraftLifecycle(h.bridge).prepare(h.initial.documentId)).toMatchObject({ ready: false })
  const recovered = JSON.parse(JSON.stringify(courseDraftLifecycle(h.bridge).preserve(h.initial.documentId)))
  expect(recovered).toHaveLength(1)
  expect(recovered[0]).toMatchObject({ kind: 'source', payload: { composing: true } })
  await h.host.writeAuthoringDrafts(h.initial.documentId, { advanced: recovered, properties: [] })
  editor.unmount()
  const coldHost = new DocumentHostService(path.join(h.directory, 'host'))
  const coldDoc = await coldHost.internalAPI.restore(h.initial.documentId)
  const persisted = await coldHost.readAuthoringDrafts(coldDoc.documentId)
  expect(persisted?.advanced).toEqual(recovered)
  const coldBridge = new CourseV10DocumentBridge(); disposers.push(async () => coldBridge.dispose())
  await coldBridge.connect(api(coldHost, coldDoc)); coldBridge.selectInstances(coldDoc.documentId, ['a'], 'page')
  expect(courseDraftLifecycle(coldBridge).restore(coldDoc.documentId, persisted!.advanced)).toMatchObject({ restored: 1, issues: [] })
  h.render(<Source bridge={coldBridge} />)
  expect(h.screen.getByRole('textbox', { name: '组件实现源码' })).toHaveValue('export const value =')
  expect((await coldHost.internalAPI.read(coldDoc.documentId)).undoDepth).toBe(0)
  expect((await coldHost.internalAPI.read(coldDoc.documentId)).revision).toBe(coldDoc.revision)
  expect(decode((await coldHost.internalAPI.read(coldDoc.documentId)).model.resources.components.code['main.js'])).toBe(original)
  expect(await courseDraftLifecycle(coldBridge).prepare(coldDoc.documentId)).toMatchObject({ ready: true })
  expect(courseDraftLifecycle(coldBridge).preserve(coldDoc.documentId)).toHaveLength(1)
  expect((await coldHost.internalAPI.read(coldDoc.documentId)).revision).toBe(coldDoc.revision)
})

it('ordinary active source preparation saves its exact string without imposing a runtime syntax gate', async () => {
  const h = await fixture()
  const editor = h.render(<Source bridge={h.bridge} />)
  const raw = 'export const value ='
  h.fireEvent.change(h.screen.getByRole('textbox', { name: '组件实现源码' }), { target: { value: raw } })
  await h.act(async () => expect(await courseDraftLifecycle(h.bridge).prepare(h.initial.documentId)).toMatchObject({ ready: true }))
  editor.unmount()
  const current = await h.host.internalAPI.read(h.initial.documentId)
  expect(current.undoDepth).toBe(1)
  expect(decode(current.model.resources.components.code['main.js'])).toBe(raw)
  const filename = path.join(h.directory, 'source-string.h5lesson')
  await h.host.saveToPath(h.initial.documentId, filename)
  const reopened = await new DocumentHostService(path.join(h.directory, 'syntax-cold')).open(filename)
  expect(decode(reopened.model.resources.components.code['main.js'])).toBe(raw)
  // Running this string belongs to the runtime preparation consumer; this save proof makes no runtime-success claim.
})

it.each(['source', 'json'] as const)('a %s recovery arriving after its clean panel is mounted shows original pending input without History', async kind => {
  const h = await fixture()
  const { useEditorStore } = await import('../../../../src/renderer/store/editorStore')
  const { createEditorStoreKernel } = await import('../../../../src/renderer/store/editorStoreKernel')
  const { DeveloperTab } = await import('../../../../src/renderer/ui/DeveloperTab')
  const previous = useEditorStore.getState()
  disposers.push(async () => { useEditorStore.setState(previous, true) })
  const mount = (bridge: CourseV10DocumentBridge) => {
    if (kind === 'source') return h.render(<Source bridge={bridge} />)
    const kernel = createEditorStoreKernel({ bridge, commit: patch => useEditorStore.setState(patch) })
    useEditorStore.setState({ courseView: bridge.read(), courseBridge: bridge, courseKernel: kernel, editingScope: 'scene' })
    const unsubscribe = bridge.subscribe(() => useEditorStore.setState({ courseView: bridge.read() }))
    disposers.push(async () => { unsubscribe() })
    const view = h.render(<DeveloperTab />)
    h.fireEvent.click(h.screen.getByRole('tab', { name: /对象 JSON/ }))
    return view
  }
  const label = kind === 'source' ? '组件实现源码' : '所选对象 · A'
  const raw = kind === 'source' ? 'export const value = 99;'
    : JSON.stringify({ ...h.bridge.read().project!.instances.a, data: { label: 'Recovered pending JSON' } })
  const originalView = mount(h.bridge)
  h.fireEvent.compositionStart(h.screen.getByRole('textbox', { name: label }))
  h.fireEvent.change(h.screen.getByRole('textbox', { name: label }), { target: { value: raw } })
  const records = JSON.parse(JSON.stringify(courseDraftLifecycle(h.bridge).preserve(h.initial.documentId)))
  expect(records).toEqual([expect.objectContaining({ kind, payload: expect.objectContaining({ composing: true }) })])
  originalView.unmount()
  const restoredHost = new DocumentHostService(path.join(h.directory, `late-${kind}`))
  const restoredDoc = await restoredHost.internalAPI.create(h.initial.model, 'lesson.h5lesson')
  const restoredBridge = new CourseV10DocumentBridge(); disposers.push(async () => restoredBridge.dispose())
  await restoredBridge.connect(api(restoredHost, restoredDoc)); restoredBridge.selectInstances(restoredDoc.documentId, ['a'], 'page')
  mount(restoredBridge)
  expect((h.screen.getByRole('textbox', { name: label }) as HTMLTextAreaElement).value).not.toBe(raw)
  await h.act(async () => expect(courseDraftLifecycle(restoredBridge).restore(restoredDoc.documentId, records)).toMatchObject({ restored: 1, issues: [] }))
  await h.waitFor(() => expect(h.screen.getByRole('textbox', { name: label })).toHaveValue(raw))
  expect(await restoredHost.internalAPI.read(restoredDoc.documentId)).toMatchObject({ revision: restoredDoc.revision, undoDepth: 0 })
  expect(await courseDraftLifecycle(restoredBridge).prepare(restoredDoc.documentId)).toMatchObject({ ready: true })
  expect(courseDraftLifecycle(restoredBridge).preserve(restoredDoc.documentId)).toHaveLength(1)
  expect(await restoredHost.internalAPI.read(restoredDoc.documentId)).toMatchObject({ revision: restoredDoc.revision, undoDepth: 0 })
})

it('unchanged Developer JSON creates no History and incomplete JSON restores verbatim without automatic application', async () => {
  const h = await fixture()
  const { useEditorStore } = await import('../../../../src/renderer/store/editorStore')
  const { createEditorStoreKernel } = await import('../../../../src/renderer/store/editorStoreKernel')
  const { DeveloperTab } = await import('../../../../src/renderer/ui/DeveloperTab')
  const previous = useEditorStore.getState()
  const install = (bridge: CourseV10DocumentBridge) => {
    const kernel = createEditorStoreKernel({ bridge, commit: patch => useEditorStore.setState(patch) })
    useEditorStore.setState({ courseView: bridge.read(), courseBridge: bridge, courseKernel: kernel, editingScope: 'scene' })
    const unsubscribe = bridge.subscribe(() => useEditorStore.setState({ courseView: bridge.read() }))
    disposers.push(async () => { unsubscribe() })
  }
  disposers.push(async () => { useEditorStore.setState(previous, true) })
  install(h.bridge)
  const first = h.render(<DeveloperTab />)
  h.fireEvent.click(h.screen.getByRole('tab', { name: /对象 JSON/ }))
  const originalJson = (h.screen.getByRole('textbox', { name: '所选对象 · A' }) as HTMLTextAreaElement).value
  h.fireEvent.change(h.screen.getByRole('textbox', { name: '所选对象 · A' }), { target: { value: ` ${originalJson}\n` } })
  await h.act(async () => expect(await courseDraftLifecycle(h.bridge).prepare(h.initial.documentId)).toMatchObject({ ready: true }))
  expect(await h.host.internalAPI.read(h.initial.documentId)).toMatchObject({ revision: h.initial.revision, undoDepth: 0 })
  const raw = '{"id":"a","data":'
  h.fireEvent.change(h.screen.getByRole('textbox', { name: '所选对象 · A' }), { target: { value: raw } })
  expect(await courseDraftLifecycle(h.bridge).prepare(h.initial.documentId)).toMatchObject({ ready: false })
  const recovered = JSON.parse(JSON.stringify(courseDraftLifecycle(h.bridge).preserve(h.initial.documentId)))
  expect(recovered).toHaveLength(1)
  await h.host.writeAuthoringDrafts(h.initial.documentId, { advanced: recovered, properties: [] })
  first.unmount()
  const coldHost = new DocumentHostService(path.join(h.directory, 'host'))
  const coldDoc = await coldHost.internalAPI.restore(h.initial.documentId)
  const persisted = await coldHost.readAuthoringDrafts(coldDoc.documentId)
  expect(persisted?.advanced).toEqual(recovered)
  const coldBridge = new CourseV10DocumentBridge(); disposers.push(async () => coldBridge.dispose())
  await coldBridge.connect(api(coldHost, coldDoc)); coldBridge.selectInstances(coldDoc.documentId, ['a'], 'page')
  expect(courseDraftLifecycle(coldBridge).restore(coldDoc.documentId, persisted!.advanced)).toMatchObject({ restored: 1, issues: [] })
  install(coldBridge)
  h.render(<DeveloperTab />); h.fireEvent.click(h.screen.getByRole('tab', { name: /对象 JSON/ }))
  expect(h.screen.getByRole('textbox', { name: '所选对象 · A' })).toHaveValue(raw)
  expect(await coldHost.internalAPI.read(coldDoc.documentId)).toMatchObject({ revision: coldDoc.revision, undoDepth: 0 })
  expect(await courseDraftLifecycle(coldBridge).prepare(coldDoc.documentId)).toMatchObject({ ready: true })
  expect(courseDraftLifecycle(coldBridge).preserve(coldDoc.documentId)).toHaveLength(1)
})
