// @vitest-environment node
import { useSyncExternalStore } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { ComponentSourceEditor, captureComponentSourceSession, componentSourceSessionEdits, independentComponentSourceEdits } from '../../src/renderer/components/ComponentSourceEditor'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'

type TestDOM = { window: Window & typeof globalThis }
const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string, options: { url: string }) => TestDOM }
const disposers: Array<() => Promise<void>> = []
let dom: TestDOM, cleanupView: (() => void) | undefined
afterEach(async () => {
  cleanupView?.()
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  dom?.window.close(); vi.unstubAllGlobals()
})
const bytes = (value: string) => new TextEncoder().encode(value)
const decode = (value: Uint8Array) => new TextDecoder().decode(value)
const source = "import { value } from './helper.js'; export default { value };"
const helper = 'export const value = 42;'
function model(id: string): CourseProjectV10 {
  const frame = { width: 180, height: 90, transform: [1, .2, -.1, 1, 23, 41] as [number, number, number, number, number, number] }
  return { schemaVersion: 10, id, revision: 0, title: id, definitions: {
    custom: { id: 'custom', title: '共享组件', version: 'author-version', role: 'content',
      dataSchema: { 'x-editor': { pages: [{ id: 'main', label: '内容', propertyKeys: ['label'] }], defaultPageId: 'main' } },
      implementation: { kind: 'source', language: 'javascript', workspace: { ownerId: 'shared-files', entry: 'main.js' }, resourceBindings: { image: 'picture' } } },
  }, instances: { a: { id: 'a', definitionId: 'custom', name: 'A', data: { label: 'A' }, frame },
    b: { id: 'b', definitionId: 'custom', name: 'B', data: { label: 'B' }, frame } },
  surfaces: [{ id: 'page', kind: 'slide', title: '页面', childIds: ['a', 'b'] }], global: { underlay: [], overlay: [] },
  assets: { picture: { id: 'picture', path: 'picture.bin', mimeType: 'application/octet-stream' } } }
}
const resources = () => ({ assets: { picture: new Uint8Array([1, 2, 3]) }, components: {
  'shared-files': { 'main.js': bytes(source), 'helper.js': bytes(helper), 'opaque.bin': new Uint8Array([0, 255, 128]) },
} })
function hostAPI(host: DocumentHostService, initial: DocumentSnapshot): DocumentHostAPI {
  const unavailable = async (): Promise<never> => { throw new Error('No dialog in the source fixture') }
  return { ...host.internalAPI, bootstrapCourse: async () => initial, saveWithDialog: unavailable, closeWithDialog: unavailable, discardRecovery: unavailable,
    close: async (documentId, discardDirty) => { await host.operate({ type: 'close', documentId, discardDirty }) }, subscribe: listener => host.subscribeEvents(listener) }
}
async function fixture() {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
  for (const name of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'MutationObserver'] as const)
    vi.stubGlobal(name, name === 'window' ? dom.window : dom.window[name])
  const testing = await import('@testing-library/react/pure'); cleanupView = testing.cleanup
  const directory = await mkdtemp(path.join(tmpdir(), 'guoling-source-q0-'))
  disposers.push(() => rm(directory, { recursive: true, force: true }))
  const host = new DocumentHostService(path.join(directory, 'host'))
  const initial = await host.internalAPI.create({ kind: 'course-v10', project: model('A'), resources: resources() }, 'A.h5lesson')
  const bridge = new CourseV10DocumentBridge(); disposers.push(async () => bridge.dispose())
  await bridge.connect(hostAPI(host, initial)); bridge.selectInstances(initial.documentId, ['a'], 'page')
  return { ...testing, screen: testing.within(document.body), host, bridge, directory, initial }
}
function SourceConsumer({ bridge, scope = 'instance' }: { bridge: CourseV10DocumentBridge; scope?: 'instance' | 'definition' }) {
  const view = useSyncExternalStore(bridge.subscribe, bridge.read), instance = view.project!.instances[view.selectedInstanceId!]
  const implementation = instance && (scope === 'definition' ? view.project!.definitions[instance.definitionId].implementation
    : instance.implementationOverride ?? view.project!.definitions[instance.definitionId].implementation)
  return <ComponentSourceEditor instance={instance} implementation={implementation} scope={scope}
    bridge={bridge} documentId={view.activeDocumentId!} report={() => {}} />
}

it('edits a shared definition and preserves its full metadata, instances, bytes and independent reopen', async () => {
  const h = await fixture(), before = h.bridge.captureTarget()
  const editor = h.render(<SourceConsumer bridge={h.bridge} scope="definition" />)
  h.fireEvent.change(h.screen.getByRole('combobox', { name: '组件源码文件' }), { target: { value: 'helper.js' } })
  const changed = 'export const value = 75;'
  h.fireEvent.change(h.screen.getByRole('textbox', { name: '组件实现源码' }), { target: { value: changed } })
  h.fireEvent.click(h.screen.getByRole('button', { name: '保存实现' }))
  await h.waitFor(() => expect(h.screen.getByText('实现已应用到课件。')).toBeInTheDocument())
  const after = h.bridge.captureTarget()
  expect(after.project.definitions).toEqual(before.project.definitions)
  expect(after.project.instances).toEqual(before.project.instances)
  expect(after.resources.assets).toEqual(before.resources.assets)
  expect(after.resources.components['shared-files']['opaque.bin']).toEqual(before.resources.components['shared-files']['opaque.bin'])
  expect(after.project.revision).toBe(before.project.revision + 1)
  editor.unmount()
  const independent = independentComponentSourceEdits(h.bridge, h.initial.documentId, 'a')
  await h.bridge.editCaptured(h.bridge.capture(independent.edits, independent.target))
  const privateEditor = h.render(<SourceConsumer bridge={h.bridge} />)
  h.fireEvent.change(h.screen.getByRole('combobox', { name: '组件源码文件' }), { target: { value: 'helper.js' } })
  h.fireEvent.change(h.screen.getByRole('textbox', { name: '组件实现源码' }), { target: { value: 'export const value = 100;' } })
  h.fireEvent.click(h.screen.getByRole('button', { name: '保存实现' }))
  await h.waitFor(() => expect(h.screen.getByText('实现已应用到课件。')).toBeInTheDocument())
  const privateTarget = h.bridge.captureTarget(), privateImplementation = privateTarget.project.instances.a.implementationOverride
  if (privateImplementation?.kind !== 'source' || !privateImplementation.workspace) throw new Error('Expected an independent workspace')
  expect(privateImplementation.workspace.ownerId).not.toBe('shared-files')
  expect(decode(privateTarget.resources.components[privateImplementation.workspace.ownerId]['helper.js'])).toBe('export const value = 100;')
  expect(decode(privateTarget.resources.components['shared-files']['helper.js'])).toBe(changed)
  expect(privateTarget.project.instances.b).toEqual(before.project.instances.b)
  h.fireEvent.click(h.screen.getByRole('button', { name: '恢复默认实现' }))
  await h.waitFor(() => expect(h.screen.getByText('已恢复默认实现。')).toBeInTheDocument())
  expect(h.bridge.read().project!.instances).toEqual(before.project.instances)
  expect(h.bridge.captureTarget().resources.components[privateImplementation.workspace.ownerId]['opaque.bin']).toEqual(before.resources.components['shared-files']['opaque.bin'])
  const filename = path.join(h.directory, 'shared.h5lesson')
  await h.host.operate({ type: 'save', documentId: h.initial.documentId, path: filename })
  privateEditor.unmount(); h.bridge.dispose(); await h.host.operate({ type: 'close', documentId: h.initial.documentId })
  const nextHost = new DocumentHostService(path.join(h.directory, 'fresh-host'))
  const reopened = await nextHost.open(filename)
  expect(reopened.model.kind).toBe('course-v10')
  if (reopened.model.kind !== 'course-v10') throw new Error('Unexpected reopened model')
  expect(reopened.model.project.instances).toEqual(before.project.instances)
  expect(reopened.model.project.definitions).toEqual(before.project.definitions)
  expect(decode(reopened.model.resources.components['shared-files']['helper.js'])).toBe(changed)
})

it('retains source drafts and selected file when the source panel unmounts without applying', async () => {
  const h = await fixture(), revision = h.bridge.read().project!.revision
  const editor = h.render(<SourceConsumer bridge={h.bridge} />)
  h.fireEvent.change(h.screen.getByRole('combobox', { name: '组件源码文件' }), { target: { value: 'helper.js' } })
  h.fireEvent.change(h.screen.getByRole('textbox', { name: '组件实现源码' }), { target: { value: 'export const value = 99;' } })
  editor.unmount(); h.render(<SourceConsumer bridge={h.bridge} />)
  expect((h.screen.getByRole('combobox', { name: '组件源码文件' }) as HTMLSelectElement).value).toBe('helper.js')
  expect((h.screen.getByRole('textbox', { name: '组件实现源码' }) as HTMLTextAreaElement).value).toBe('export const value = 99;')
  expect(h.bridge.read().project!.revision).toBe(revision)
  expect(decode(h.bridge.captureTarget().resources.components['shared-files']['helper.js'])).toBe(helper)
})

it('keeps a locked source read-only and leaves textarea undo to its native input owner', async () => {
  const h = await fixture()
  await h.bridge.edit([{ type: 'instance.patch', instanceId: 'a', patch: { locked: true } }])
  const editor = h.render(<SourceConsumer bridge={h.bridge} />)
  expect(h.screen.getByRole('textbox', { name: '组件实现源码' })).toHaveProperty('readOnly', true)
  expect(h.screen.getByRole('button', { name: '保存实现' })).toBeDisabled()
  editor.unmount(); await h.bridge.edit([{ type: 'instance.patch', instanceId: 'a', patch: { locked: false } }])
  h.render(<SourceConsumer bridge={h.bridge} />)
  const area = h.screen.getByRole('textbox', { name: '组件实现源码' })
  h.fireEvent.change(area, { target: { value: source + '\n// local draft' } })
  const undo = new dom.window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
  area.dispatchEvent(undo)
  expect(undo.defaultPrevented).toBe(false)
})

it('waits for ACK and keeps a rejected shared draft on its original document across a late selection switch', async () => {
  const h = await fixture()
  const other = await h.host.internalAPI.create({ kind: 'course-v10', project: model('B'), resources: resources() }, 'B.h5lesson')
  const before = h.bridge.captureTarget(), editor = h.render(<SourceConsumer bridge={h.bridge} scope="definition" />)
  h.fireEvent.change(h.screen.getByRole('combobox', { name: '组件源码文件' }), { target: { value: 'helper.js' } })
  const changed = 'export const value = 88;'
  h.fireEvent.change(h.screen.getByRole('textbox', { name: '组件实现源码' }), { target: { value: changed } })
  let reject!: (reason: Error) => void
  const pending = new Promise<never>((_resolve, fail) => { reject = fail })
  const apply = vi.spyOn(h.bridge, 'editCaptured').mockImplementationOnce(() => pending)
  h.fireEvent.click(h.screen.getByRole('button', { name: '保存实现' }))
  expect(h.screen.getByRole('button', { name: '保存实现' })).toBeDisabled()
  expect(decode(h.bridge.captureTarget().resources.components['shared-files']['helper.js'])).toBe(helper)
  await h.act(async () => { await h.bridge.activate(other.documentId); h.bridge.selectInstances(other.documentId, ['b'], 'page') })
  await h.act(async () => { reject(new Error('ACK rejected')) })
  await h.waitFor(() => expect(h.screen.getByText(/未应用：ACK rejected；源码草稿已保留/)).toBeInTheDocument())
  expect((h.screen.getByRole('textbox', { name: '组件实现源码' }) as HTMLTextAreaElement).value).toBe(changed)
  expect(apply.mock.calls[0][0]).toMatchObject({ documentId: before.documentId, epoch: before.epoch })
  expect(apply.mock.calls[0][0].edits.map(edit => edit.type)).toEqual(['component.files.set', 'definition.set'])
  apply.mockRestore()
  const freshOpaque = new Uint8Array([5, 6, 7])
  await h.act(async () => { await h.bridge.edit([{ type: 'component.files.set', ownerId: 'shared-files', expectedFiles: before.resources.components['shared-files'],
    files: { ...before.resources.components['shared-files'], 'opaque.bin': freshOpaque } }], undefined, h.initial.documentId) })
  h.fireEvent.click(h.screen.getByRole('button', { name: '载入当前基线并保留草稿' }))
  expect((h.screen.getByRole('textbox', { name: '组件实现源码' }) as HTMLTextAreaElement).value).toBe(changed)
  h.fireEvent.click(h.screen.getByRole('button', { name: '保存实现' }))
  await h.waitFor(() => expect(decode(h.bridge.read().views.find(view => view.documentId === h.initial.documentId)!.model.resources.components['shared-files']['helper.js'])).toBe(changed))
  await h.bridge.drain([h.initial.documentId])
  expect(h.bridge.read().activeDocumentId).toBe(other.documentId)
  expect(decode(h.bridge.captureTarget().resources.components['shared-files']['helper.js'])).toBe(helper)
  expect(h.bridge.read().views.find(view => view.documentId === h.initial.documentId)!.model.resources.components['shared-files']['opaque.bin']).toEqual(freshOpaque)
  editor.unmount()
})

it('exposes shared and independent source scopes in Developer and preserves definition metadata drafts across panel switches', async () => {
  const h = await fixture()
  const { useEditorStore } = await import('../../src/renderer/store/editorStore')
  const { createEditorStoreKernel } = await import('../../src/renderer/store/editorStoreKernel')
  const { DeveloperTab } = await import('../../src/renderer/ui/DeveloperTab')
  const previous = useEditorStore.getState()
  const kernel = createEditorStoreKernel({ bridge: h.bridge, commit: patch => useEditorStore.setState(patch) })
  useEditorStore.setState({ courseView: h.bridge.read(), courseBridge: h.bridge, courseKernel: kernel, editingScope: 'scene' })
  const unsubscribe = h.bridge.subscribe(() => useEditorStore.setState({ courseView: h.bridge.read() }))
  disposers.push(async () => { unsubscribe(); useEditorStore.setState(previous, true) })
  let editor = h.render(<DeveloperTab />)
  h.fireEvent.click(h.screen.getByRole('tab', { name: /组件代码/ }))
  expect(h.screen.getByRole('tab', { name: '共享定义源码' })).toHaveAttribute('aria-selected', 'true')
  h.fireEvent.change(h.screen.getByRole('combobox', { name: '组件源码文件' }), { target: { value: 'helper.js' } })
  const area = h.screen.getByRole('textbox', { name: '组件实现源码' })
  h.fireEvent.compositionStart(area)
  h.fireEvent.change(area, { target: { value: 'export const value = 60;' } })
  expect(h.screen.getByRole('button', { name: '保存实现' })).toBeDisabled()
  h.fireEvent.compositionEnd(area)
  await h.waitFor(() => expect(h.screen.getByRole('button', { name: '保存实现' })).not.toBeDisabled())
  h.fireEvent.click(h.screen.getByRole('button', { name: '保存实现' }))
  await h.waitFor(() => expect(h.bridge.read().project!.revision).toBe(h.initial.revision + 1))
  h.fireEvent.click(h.screen.getByRole('button', { name: '为当前实例创建独立副本' }))
  await h.waitFor(() => expect(h.screen.getByRole('tab', { name: '当前实例源码' })).toHaveAttribute('aria-selected', 'true'))
  h.fireEvent.change(h.screen.getByRole('combobox', { name: '组件源码文件' }), { target: { value: 'helper.js' } })
  h.fireEvent.change(h.screen.getByRole('textbox', { name: '组件实现源码' }), { target: { value: 'export const value = 90;' } })
  h.fireEvent.click(h.screen.getByRole('button', { name: '保存实现' }))
  await h.waitFor(() => expect(h.bridge.read().project!.revision).toBe(h.initial.revision + 3))
  expect(decode(h.bridge.captureTarget().resources.components['shared-files']['helper.js'])).toBe('export const value = 60;')
  h.fireEvent.click(h.screen.getByRole('tab', { name: '共享定义源码' }))
  expect((h.screen.getByRole('textbox', { name: '组件实现源码' }) as HTMLTextAreaElement).value).toBe('export const value = 60;')
  const metadata = h.bridge.read().project!.definitions.custom
  const edited = { ...metadata, dataSchema: { ...metadata.dataSchema,
    'x-editor': { ...metadata.dataSchema!['x-editor'] as object, variants: [{ id: 'blue', label: '蓝色', data: { label: '示例' } }] } } }
  const raw = JSON.stringify(edited, null, 2), revision = h.bridge.read().project!.revision
  h.fireEvent.change(h.screen.getByRole('textbox', { name: '共享定义与编辑元数据' }), { target: { value: raw } })
  editor.unmount(); editor = h.render(<DeveloperTab />)
  h.fireEvent.click(h.screen.getByRole('tab', { name: /组件代码/ }))
  expect((h.screen.getByRole('textbox', { name: '共享定义与编辑元数据' }) as HTMLTextAreaElement).value).toBe(raw)
  expect(h.bridge.read().project!.revision).toBe(revision)
  h.fireEvent.click(h.screen.getByRole('button', { name: '校验并应用' }))
  await h.waitFor(() => expect(h.bridge.read().project!.definitions.custom.dataSchema).toEqual(edited.dataSchema))
  await h.bridge.drain()
  expect(h.bridge.read().project!.instances.b.implementationOverride).toBeUndefined()
  expect(h.bridge.read().project!.instances.a.data).toEqual({ label: 'A' })
  editor.unmount()
})

it('keeps a private override independent when it currently references the same source owner as a shared definition', async () => {
  const h = await fixture()
  await h.bridge.edit([{ type: 'implementation.set', instanceId: 'b', implementation: h.bridge.read().project!.definitions.custom.implementation }])
  const session = captureComponentSourceSession(h.bridge, h.initial.documentId, 'a', 'definition')
  const changed = 'export const value = 77;'
  const edits = componentSourceSessionEdits(session, { workspace: true, entry: 'main.js', selected: 'helper.js', language: 'javascript', files: {
    'main.js': { bytes: bytes(source), text: source }, 'helper.js': { bytes: bytes(changed), text: changed },
    'opaque.bin': { bytes: new Uint8Array([0, 255, 128]), text: null },
  } })
  await h.bridge.editCaptured(h.bridge.capture(edits, session.target))
  const target = h.bridge.captureTarget(), implementation = target.project.definitions.custom.implementation
  if (implementation.kind !== 'source' || !implementation.workspace) throw new Error('Expected a source workspace')
  expect(implementation.workspace.ownerId).not.toBe('shared-files')
  expect(decode(target.resources.components[implementation.workspace.ownerId]['helper.js'])).toBe(changed)
  expect(decode(target.resources.components['shared-files']['helper.js'])).toBe(helper)
  expect(target.project.instances.b.implementationOverride).toEqual(session.target.project.instances.b.implementationOverride)
})

it('finishes an in-flight ACK in the remounted source panel without a second apply', async () => {
  const h = await fixture()
  let editor = h.render(<SourceConsumer bridge={h.bridge} scope="definition" />)
  h.fireEvent.change(h.screen.getByRole('combobox', { name: '组件源码文件' }), { target: { value: 'helper.js' } })
  h.fireEvent.change(h.screen.getByRole('textbox', { name: '组件实现源码' }), { target: { value: 'export const value = 101;' } })
  const original = h.bridge.editCaptured.bind(h.bridge)
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  const apply = vi.spyOn(h.bridge, 'editCaptured').mockImplementationOnce(async command => { await pending; return original(command) })
  h.fireEvent.click(h.screen.getByRole('button', { name: '保存实现' }))
  editor.unmount(); editor = h.render(<SourceConsumer bridge={h.bridge} scope="definition" />)
  expect(h.screen.getByRole('button', { name: '保存实现' })).toBeDisabled()
  await h.act(async () => { finish(); await h.bridge.drain() })
  await h.waitFor(() => expect(h.screen.getByRole('button', { name: '保存实现' })).not.toBeDisabled())
  expect(apply).toHaveBeenCalledTimes(1)
  expect(h.bridge.read().project!.revision).toBe(h.initial.revision + 1)
  expect((h.screen.getByRole('combobox', { name: '组件源码文件' }) as HTMLSelectElement).value).toBe('helper.js')
  expect((h.screen.getByRole('textbox', { name: '组件实现源码' }) as HTMLTextAreaElement).value).toBe('export const value = 101;')
  editor.unmount()
})
