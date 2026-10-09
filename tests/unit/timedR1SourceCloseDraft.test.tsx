// @vitest-environment node
import { useSyncExternalStore } from 'react'
import { createRequire } from 'node:module'
import { afterEach, expect, it, vi } from 'vitest'
import * as sourceEditor from '../../src/renderer/components/ComponentSourceEditor'
import { useCourseProjectLifecycle, type CourseProjectLifecyclePorts } from '../../src/renderer/app/useCourseProjectLifecycle'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { prepareDocumentWindowClose } from '../../src/main/workbench/documentCloseCoordinator'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { DocumentEvent } from '../../src/shared/workbench/document'
import { authoringDraftRecoverySchema, type AuthoringDraftRecovery, type DocumentHostAPI } from '../../src/shared/workbench/desktop'

type TestDOM = { window: Window & typeof globalThis }
const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string, options: { url: string }) => TestDOM }
let dom: TestDOM, cleanup: (() => void) | undefined, bridge: CourseV10DocumentBridge | undefined
afterEach(async () => {
  cleanup?.(); bridge?.dispose()
  // React's native scheduler has queued Immediate callbacks even after unmount.
  // Let those finish against this fixture's window before restoring Node globals.
  await new Promise<void>(resolve => setImmediate(resolve))
  dom?.window.close(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
function Source({ bridge }: { bridge: CourseV10DocumentBridge }) {
  const view = useSyncExternalStore(bridge.subscribe, bridge.read)
  if (!view.project || !view.activeDocumentId) return null
  const instance = view.project.instances.source
  return <sourceEditor.ComponentSourceEditor bridge={bridge} instance={instance}
    implementation={view.project!.definitions.custom.implementation} documentId={view.activeDocumentId!} report={() => {}} />
}

it('retains unapplied source on native close and deferred composition until explicit discard', async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
  for (const name of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'MutationObserver'] as const)
    vi.stubGlobal(name, name === 'window' ? dom.window : dom.window[name])
  const testing = await import('@testing-library/react/pure'); cleanup = testing.cleanup
  const screen = testing.within(document.body), reports: string[] = []
  let sequence = 0
  const registry = new DocumentRegistry({ drivers: [new CourseV10Driver()], createId: () => `source-close-${++sequence}`,
    bindingKey: binding => binding.path, persistence: { async append() {}, async save(input) {
      if (input.binding.kind !== 'file') throw new Error('Saved binding required')
      return input.binding
    } } })
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'original-project', revision: 0, title: 'Original source work',
    definitions: { custom: { id: 'custom', title: 'Source', role: 'content', implementation: {
      kind: 'source', language: 'javascript', source: 'export default { value: 1 };' } } },
    instances: { source: { id: 'source', name: 'Original object', definitionId: 'custom', data: {},
      frame: { width: 160, height: 90, transform: [1, 0, 0, 1, 0, 0] } } },
    surfaces: [{ id: 'page', kind: 'slide', title: 'Page', childIds: ['source'] }],
    global: { underlay: [], overlay: [] }, assets: {} }
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'original.h5lesson', true)
  const listeners = new Set<(event: DocumentEvent) => void>()
  session.subscribe(event => { for (const listener of listeners) listener(event) })
  const unavailable = async (): Promise<never> => { throw new Error('Outside source-close fixture') }
  const nativeClose = vi.fn(async (id: string) => { await registry.close(id); return true })
  bridge = new CourseV10DocumentBridge()
  const guard = (ids?: readonly string[]) => {
    const issue = sourceEditor.componentSourceCloseIssue(bridge!, ids)
    if (!issue) return true
    reports.push(issue.message); return false
  }
  const authoringDrafts = new Map<string, AuthoringDraftRecovery>()
  const api: DocumentHostAPI = { bootstrapCourse: async () => session.read(), list: async () => registry.list(),
    read: async id => registry.get(id).read(), dispatch: operation => registry.get(operation.documentId).execute(operation),
    readAuthoringDrafts: async id => { registry.get(id); return structuredClone(authoringDrafts.get(id) ?? null) },
    writeAuthoringDrafts: async (id, drafts) => { registry.get(id); authoringDrafts.set(id, structuredClone(authoringDraftRecoverySchema.parse(drafts))) },
    clearAuthoringDrafts: async id => { registry.get(id); authoringDrafts.delete(id) },
    lookup: async (id, operationId) => registry.get(id).lookupOperation(operationId),
    create: unavailable, open: unavailable, save: unavailable, saveWithDialog: unavailable,
    close: async id => { await registry.close(id); authoringDrafts.delete(id) },
    // The App's closeWithDialog wrapper runs after the Bridge/Store drains.
    closeWithDialog: async id => guard([id]) && await nativeClose(id),
    observeFile: unavailable, reconcileFile: unavailable, recoverable: unavailable, restore: unavailable, discardRecovery: unavailable,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } } }
  await bridge.connect(api); bridge.selectInstances(session.documentId, ['source'], 'page')
  const before = session.read(), save = vi.fn(async () => null)
  let preserve!: () => Promise<boolean>
  const ports: CourseProjectLifecyclePorts = {
    documents: { ready: async () => {}, snapshot: () => bridge!.read().snapshot,
      create: unavailable, open: unavailable, save, drain: async () => (await bridge!.drain())[0] },
    captureIdentity: () => ({ documentId: before.documentId, epoch: before.epoch, projectId: project.id, revision: 0 }),
    hasUnsavedChanges: () => session.read().dirty, projectPath: () => null,
    runBusy: async work => work(), commitStatus: () => {}, reportError: message => reports.push(message),
    desktopAvailable: () => true, openProjectFile: unavailable, openRecentProjectFile: unavailable,
    confirmProjectOpen: unavailable, listRecentProjects: async () => [], setWindowDirtyState: async () => {},
    prepareBeforeClose: () => guard(), preserveBeforeClose: async (_mode, ids) => { await bridge!.drain(ids); return true },
    subscribeSaveAndCloseRequest: () => () => {},
    subscribePreserveAndCloseRequest: handler => { preserve = handler; return () => {} },
  }
  testing.renderHook(() => useCourseProjectLifecycle(ports, { dirty: false, projectTitle: project.title, projectPath: null,
    documentTrigger: null, sidecarTrigger: null, componentPackagesTrigger: null,
    slideDraftTrigger: null, spatialDraftTrigger: null, flowDraftTrigger: null, textEditTrigger: null }))
  let editor = testing.render(<Source bridge={bridge} />)
  const closeWindow = () => prepareDocumentWindowClose({ list: () => registry.list(), drain: async () => {},
    rendererDirty: async () => false, confirm: () => 'preserve', prepareRenderer: () => preserve(), save })
  const value = 'export default { value: 99 };'
  testing.fireEvent.change(screen.getByRole('textbox', { name: '组件实现源码' }), { target: { value } })
  editor.unmount()
  expect(await closeWindow()).toBe(false)
  expect(session.read()).toEqual(before)
  editor = testing.render(<Source bridge={bridge} />)
  expect(screen.getByRole('textbox', { name: '组件实现源码' })).toHaveProperty('value', value)
  expect(reports.at(-1)).toMatch(/original.*Original.*待修输入.*原输入与原目标已保留/)
  testing.fireEvent.click(screen.getByRole('button', { name: '放弃草稿' }))
  expect(await closeWindow()).toBe(true)

  const entered = deferred(), release = deferred(), drain = bridge.drain.bind(bridge)
  const heldDrain = vi.spyOn(bridge, 'drain').mockImplementationOnce(async ids => { entered.resolve(); await release.promise; return drain(ids) })
  const closing = closeWindow()
  await entered.promise
  const area = screen.getByRole('textbox', { name: '组件实现源码' })
  testing.fireEvent.compositionStart(area)
  testing.fireEvent.compositionEnd(area)
  release.resolve()
  expect(await closing).toBe(false)
  expect(session.read()).toEqual(before)
  await testing.waitFor(() => expect(screen.getByRole('button', { name: '放弃草稿' })).not.toBeDisabled())
  // No text changed during composition: completing it must not create a permanent close barrier.
  expect(await closeWindow()).toBe(true)
  heldDrain.mockRestore()

  const tabEntered = deferred(), tabRelease = deferred()
  vi.spyOn(bridge, 'drain').mockImplementationOnce(async ids => { tabEntered.resolve(); await tabRelease.promise; return drain(ids) })
  // App checks first; Store.closeCourseDocument awaits drainActive (Bridge.drain)
  // before Bridge.close performs its own projection drain and calls closeWithDialog.
  const closingTab = (async () => {
    if (!guard([session.documentId])) return false
    await bridge!.drain([session.documentId])
    return bridge!.close(session.documentId)
  })()
  await tabEntered.promise
  testing.fireEvent.change(area, { target: { value } })
  tabRelease.resolve()
  expect(await closingTab).toBe(false)
  expect(nativeClose).not.toHaveBeenCalled()
  expect(bridge.read().documents).toHaveLength(1)
  expect(area).toHaveProperty('value', value)
  expect(session.read()).toEqual(before)
  testing.fireEvent.click(screen.getByRole('button', { name: '放弃草稿' }))
  expect(await bridge.close(session.documentId)).toBe(true)
  expect(nativeClose).toHaveBeenCalledOnce()
  expect(save).not.toHaveBeenCalled()
  expect(registry.list()).toEqual([])
})
