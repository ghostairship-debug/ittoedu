// @vitest-environment node
import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { ComponentSourceEditor } from '../../../../src/renderer/components/ComponentSourceEditor'
import { BufferedInput, PropertyDraftBoundary, discardPropertiesDrafts } from '../../../../src/renderer/ui/properties/PropertyControls'
import type { CourseProjectV10 } from '../../../../src/shared/contracts/component-platform'
import type { DocumentHostAPI } from '../../../../src/shared/workbench/desktop'

type TestDOM = { window: Window & typeof globalThis }
const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string, options: { url: string }) => TestDOM }

it('one normal Store save drains unblurred source JSON and numeric inputs into the real V10 file without per-panel Apply', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
  for (const name of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'MutationObserver'] as const)
    vi.stubGlobal(name, name === 'window' ? dom.window : dom.window[name])
  const { act, cleanup, fireEvent, render, within } = await import('@testing-library/react/pure')
  const { useEditorStore } = await import('../../../../src/renderer/store/editorStore')
  const { DeveloperTab } = await import('../../../../src/renderer/ui/DeveloperTab')
  const previous = useEditorStore.getState()
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T03-store-save-'))
  let documentId: string | undefined
  try {
    const host = new DocumentHostService(path.join(directory, 'documents'))
    const project: CourseProjectV10 = { schemaVersion: 10, id: 'store-source', revision: 0, title: 'Store save', definitions: {
      custom: { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'javascript', workspace: { ownerId: 'code', entry: 'main.js' } } },
    }, instances: { a: { id: 'a', name: 'A', definitionId: 'custom', data: { label: 'Original' }, frame: { width: 180, height: 90, transform: [1, 0, 0, 1, 35, 41] } } },
    surfaces: [{ id: 'page', kind: 'slide', title: 'Page', childIds: ['a'] }], global: { underlay: [], overlay: [] }, assets: {} }
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: { code: { 'main.js': new TextEncoder().encode('export const value = 42;') } } } }, 'saved.h5lesson')
    documentId = initial.documentId
    const filename = path.join(directory, 'saved.h5lesson')
    const unavailable = async (): Promise<never> => { throw new Error('No fixture dialog') }
    const api: DocumentHostAPI = { ...host.internalAPI, bootstrapCourse: async () => initial,
      readAuthoringDrafts: id => host.readAuthoringDrafts(id), writeAuthoringDrafts: (id, drafts) => host.writeAuthoringDrafts(id, drafts), clearAuthoringDrafts: id => host.clearAuthoringDrafts(id),
      saveWithDialog: id => host.saveToPath(id, filename), closeWithDialog: unavailable, discardRecovery: unavailable,
      close: async (id, discardDirty) => { await host.operate({ type: 'close', documentId: id, discardDirty }) }, subscribe: listener => host.subscribeEvents(listener) }
    await useEditorStore.getState().connectCourseDocuments(api)
    const bridge = useEditorStore.getState().courseBridge
    bridge.selectInstances(initial.documentId, ['a'], 'page')
    const instance = bridge.read().project!.instances.a
    render(<><ComponentSourceEditor bridge={bridge} documentId={initial.documentId} instance={instance}
      implementation={project.definitions.custom.implementation} scope="definition" report={() => {}} />
      <DeveloperTab />
      <PropertyDraftBoundary bindingKey={JSON.stringify([initial.documentId, initial.epoch, 'page', null, ['a'], false])} onStale={() => {}}>
        <BufferedInput label="X" value={35} type="number" onCommit={async raw => {
          await bridge.edit([{ type: 'frame.set', instanceId: 'a', frame: { width: 180, height: 90, transform: [1, 0, 0, 1, Number(raw), 41] } }], undefined, initial.documentId)
        }} />
      </PropertyDraftBoundary></>)
    const screen = within(document.body)
    fireEvent.change(screen.getByRole('textbox', { name: '组件实现源码' }), { target: { value: 'export const value = 85;' } })
    fireEvent.click(screen.getByRole('tab', { name: /对象 JSON/ }))
    fireEvent.change(screen.getByRole('textbox', { name: '所选对象 · A' }), { target: { value: JSON.stringify({ ...instance, data: { label: 'Visible JSON' } }) } })
    fireEvent.change(screen.getByLabelText('X'), { target: { value: '85' } })
    await act(async () => expect(await useEditorStore.getState().saveCourseDocument()).toMatchObject({ dirty: false, undoDepth: 3 }))
    const reopened = await new DocumentHostService(path.join(directory, 'cold')).open(filename)
    if (reopened.model.kind !== 'course-v10') throw new Error('Expected V10')
    expect(reopened.model.project.instances.a).toMatchObject({ data: { label: 'Visible JSON' }, frame: { transform: [1, 0, 0, 1, 85, 41] } })
    expect(new TextDecoder().decode(reopened.model.resources.components.code['main.js'])).toBe('export const value = 85;')
    await act(async () => { await bridge.undo(initial.documentId) })
    expect((await host.internalAPI.read(initial.documentId)).undoDepth).toBe(2)
    bridge.dispose()
  } finally {
    cleanup(); if (documentId) discardPropertiesDrafts(documentId); useEditorStore.setState(previous, true)
    dom.window.close(); vi.unstubAllGlobals()
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
