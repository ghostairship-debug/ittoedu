// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { prepareDocumentWindowClose } from '../../../../src/main/workbench/documentCloseCoordinator'
import { CourseV10DocumentBridge } from '../../../../src/renderer/documents/CourseV10DocumentBridge'
import { createEditorStoreKernel } from '../../../../src/renderer/store/editorStoreKernel'
import { createInitialSlideOwnedState, createSlideAuthoringSlice } from '../../../../src/renderer/store/slices/slideAuthoringSlice'
import { courseDraftLifecycle } from '../../../../src/renderer/authoring/courseDraftLifecycle'
import { CanvasPlainTextEditor } from '../../../../src/renderer/ui/CanvasPlainTextEditor'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import type { ComponentAuthorSpot } from '../../../../src/shared/contracts/component-platform'
import type { DocumentHostAPI } from '../../../../src/shared/workbench/desktop'
import type { DocumentSnapshot } from '../../../../src/shared/workbench/document'

it('real Canvas IME input survives normal preserve close and cold Main recovery without auto commit until a real continued input', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
  for (const name of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'MutationObserver'] as const)
    vi.stubGlobal(name, name === 'window' ? dom.window : dom.window[name])
  const { render, fireEvent, within, act, cleanup } = await import('@testing-library/react/pure')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T03-slide-ime-'))
  const bridges: CourseV10DocumentBridge[] = []
  try {
    const hostDirectory = path.join(directory, 'documents'), host = new DocumentHostService(hostDirectory)
    const project = createBlankCourseProjectV10('Canvas draft')
    project.definitions.custom = { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export const value = 1;' } }
    const frame = { width: 180, height: 80, transform: [1, .2, 0, 1, 50, 40] as [number, number, number, number, number, number] }
    project.instances.text = { id: 'text', name: 'Original target', definitionId: 'custom', data: { label: 'Teacher original' }, frame }
    project.instances.neighbor = { id: 'neighbor', definitionId: 'custom', data: { label: 'Keep neighbor' }, frame: { ...frame, transform: [1, 0, 0, 1, 300, 40] } }
    project.surfaces[0].childIds = ['text', 'neighbor']
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'canvas.h5lesson')
    const api = (owner: DocumentHostService, snapshot: DocumentSnapshot): DocumentHostAPI => ({ ...owner.internalAPI,
      bootstrapCourse: async () => snapshot, saveWithDialog: async id => owner.saveToPath(id, path.join(directory, 'canvas.h5lesson')),
      readAuthoringDrafts: id => owner.readAuthoringDrafts(id), writeAuthoringDrafts: (id, records) => owner.writeAuthoringDrafts(id, records), clearAuthoringDrafts: id => owner.clearAuthoringDrafts(id),
      closeWithDialog: async () => { throw new Error('No native dialog in this carrier') }, discardRecovery: async () => { throw new Error('No discard') },
      close: async (id, discardDirty) => { await owner.operate({ type: 'close', documentId: id, discardDirty }) }, subscribe: listener => owner.subscribeEvents(listener) })
    const setup = async (owner: DocumentHostService, snapshot: DocumentSnapshot) => {
      const bridge = new CourseV10DocumentBridge(); bridges.push(bridge); await bridge.connect(api(owner, snapshot))
      bridge.selectInstances(snapshot.documentId, ['text'], project.surfaces[0].id)
      const kernel = createEditorStoreKernel({ bridge, commit() {} })
      let owned = createInitialSlideOwnedState(), changed: (() => void) | undefined
      const slice = createSlideAuthoringSlice(kernel, { read: () => owned, patch: patch => { owned = { ...owned, ...patch }; changed?.() } })
      function Editor() {
        const [, update] = useState(0); changed = () => update(value => value + 1)
        return <CanvasPlainTextEditor label="Canvas input" multiline bounds={{ x: 0, y: 0, width: 180, height: 80 }} value={owned.slideContentEdit?.spotText ?? ''}
          onDraftChange={(raw, composing) => slice.updateSlideSpotDraft(raw, composing)} onCommit={raw => { slice.updateSlideSpotDraft(raw, false) }} onCancel={slice.cancelTextEdit} />
      }
      return { bridge, slice, read: () => owned, Editor }
    }
    const live = await setup(host, initial)
    const spot: ComponentAuthorSpot = { id: 'label-spot', instanceId: 'text', mountGeneration: 1, kind: 'text', dataPath: ['label'],
      initialValue: 'Teacher original', localBounds: { width: 180, height: 80, transform: [1, 0, 0, 1, 0, 0] } }
    expect(live.slice.beginSlideSpotEdit(spot)).not.toBeNull()
    render(<live.Editor />)
    const input = within(document.body).getByRole('textbox', { name: 'Canvas input' })
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '尚未完成的拼音稿' } })
    fireEvent.blur(input, { relatedTarget: document.body })
    expect(live.read().slideContentEdit).toMatchObject({ instanceId: 'text', composing: true, spotText: '尚未完成的拼音稿' })
    expect(await live.slice.commitDraftForPersistence(initial.documentId)).toMatchObject({ ok: false })
    const lifecycle = courseDraftLifecycle(live.bridge)
    expect(await lifecycle.prepare(initial.documentId)).toMatchObject({ ready: false })
    let confirms = 0
    expect(await prepareDocumentWindowClose({ list: () => host.registry.list(), drain: async () => { await host.registry.get(initial.documentId).drain() },
      rendererDirty: async () => lifecycle.hasDirty(initial.documentId), confirm: () => { confirms++; return 'preserve' },
      prepareRenderer: async mode => {
        if (mode === 'save') return (await lifecycle.prepare(initial.documentId)).ready
        await host.writeAuthoringDrafts(initial.documentId, { advanced: lifecycle.preserve(initial.documentId), properties: [] }); return true
      }, save: id => host.saveToPath(id, path.join(directory, 'canvas.h5lesson')) })).toBe(true)
    expect(confirms).toBe(1)
    expect(await host.internalAPI.read(initial.documentId)).toMatchObject({ revision: initial.revision, undoDepth: 0 })
    cleanup(); live.bridge.dispose()
    const coldHost = new DocumentHostService(hostDirectory), coldDoc = await coldHost.internalAPI.restore(initial.documentId)
    const records = await coldHost.readAuthoringDrafts(coldDoc.documentId)
    if (!records) throw new Error('Missing durable raw input')
    const cold = await setup(coldHost, coldDoc)
    expect(courseDraftLifecycle(cold.bridge).restore(coldDoc.documentId, records.advanced)).toMatchObject({ restored: 1, issues: [] })
    cold.bridge.selectInstances(coldDoc.documentId, ['neighbor'], project.surfaces[0].id)
    render(<cold.Editor />)
    const recoveredInput = within(document.body).getByRole('textbox', { name: 'Canvas input' })
    expect(recoveredInput).toHaveValue('尚未完成的拼音稿')
    await act(async () => { fireEvent.blur(recoveredInput, { relatedTarget: document.body }); cold.slice.updateSlideSpotDraft('尚未完成的拼音稿', false) })
    expect(await cold.slice.commitDraftForPersistence(coldDoc.documentId)).toMatchObject({ ok: false })
    expect(await coldHost.internalAPI.read(coldDoc.documentId)).toMatchObject({ revision: coldDoc.revision, undoDepth: 0 })
    await act(async () => { fireEvent.change(recoveredInput, { target: { value: '已经继续输入的文字' } }); await cold.slice.commitSlideContentEdit() })
    const edited = await coldHost.internalAPI.read(coldDoc.documentId)
    expect(edited).toMatchObject({ undoDepth: 1, model: { project: { instances: { text: { data: { label: '已经继续输入的文字' }, frame }, neighbor: project.instances.neighbor } } } })
    const filename = path.join(directory, 'canvas.h5lesson'); await coldHost.saveToPath(coldDoc.documentId, filename)
    expect((await new DocumentHostService(path.join(directory, 'reopened')).open(filename)).model).toEqual(edited.model)
  } finally {
    cleanup(); for (const bridge of bridges) bridge.dispose(); dom.window.close(); vi.unstubAllGlobals()
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
