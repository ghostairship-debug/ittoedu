import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest'
import type { DesktopAPI, PreserveAndCloseResult } from '@/shared/ipcTypes'
import type { CourseProjectV10 } from '@/shared/contracts/component-platform/project'
import { createBlankCourseProjectV10 } from '@/core/course/createCourseProjectV10'
import { textComponentDataSchema } from '@/components/text/data'
import { TextComponentEditor } from '@/components/text/editor'
import { selectHasUnsavedCourseChanges, useEditorStore } from '@/renderer/store/editorStore'
import * as sessions from '@/renderer/document/editorSession'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.min.mjs' }))
// Keep the real professional text editor and App save/close wiring; drawing and navigation are irrelevant to persistence.
vi.mock('@/renderer/ui/Workspace', () => ({ Workspace: function DraftWorkspace() {
  const draft = useEditorStore(state => state.slideContentEdit)
  return draft ? <TextComponentEditor data={textComponentDataSchema.parse(draft.data)} revision={`${draft.target.epoch}:${draft.instanceId}`}
    onChange={data => useEditorStore.getState().updateSlideDataDraft(data)}
    onCompositionChange={active => useEditorStore.getState().setSlideTextEditComposing(active)}
    onUndo={() => useEditorStore.getState().undo()} onRedo={() => useEditorStore.getState().redo()} /> : <div />
} }))
vi.mock('@/renderer/ui/ScenePanel', () => ({ ScenePanel: () => <div /> }))
vi.mock('@/renderer/ui/SceneStateStrip', () => ({ SceneStateStrip: () => null }))
vi.mock('@/renderer/ui/ProjectHealthPanel', () => ({ ProjectHealthPanel: () => null }))
vi.mock('@/renderer/ui/RightSidebar', () => ({ RightSidebar: () => null }))
vi.mock('@/renderer/ui/TopToolbar', () => ({ TopToolbar: (props: { busy: boolean; onNew(): void; onSave(saveAs?: boolean): void }) => <div>
  <button data-testid="save-project" disabled={props.busy} onClick={() => props.onSave(false)}>保存</button>
  <button data-testid="new-project" disabled={props.busy} onClick={props.onNew}>新建</button>
</div> }))
vi.mock('@/renderer/export/loadPlayerBundle', () => ({ loadPlayerBundle: () => '/* persistence fixture */' }))
vi.mock('@/renderer/ui/coursePlayerTryRun', () => ({ attachPublishedCourseStageFit: vi.fn(() => () => {}), mountPublishedCourseTryRun: vi.fn(async () => ({ destroy: async () => {} })) }))
import App from '@/renderer/App'

let host: Awaited<ReturnType<typeof createV10StoreHost>>
let factory: MockInstance<typeof sessions.createLayoutEditor>
let closeHandler: ((documentIds?: readonly string[]) => Promise<PreserveAndCloseResult>) | undefined
const releases: (() => void)[] = []

function desktopHarness(): DesktopAPI {
  const unused = async (): Promise<never> => { throw new Error('Unused desktop dialog') }
  return { documents: host.api, legacyPpt: async () => null, materials: async () => [], openProject: async () => null,
    compileComponent: unused, listRecentProjects: async () => [], openRecentProject: unused, confirmProjectOpen: async () => {},
    saveProject: vi.fn(async () => null), writeRecoveryProject: vi.fn(async () => {}), readRecoveryProject: async () => null, clearRecoveryProject: vi.fn(async () => {}),
    selectImage: async () => null, selectImages: async () => null, selectAudio: async () => null, selectAudios: async () => null,
    selectVideo: async () => null, selectVideos: async () => null, selectComponentPackage: async () => null, selectComponentPackages: async () => null,
    loadComponentCatalog: async () => ({ sources: [], packages: [], issues: [] }), selectComponentCatalogSource: async () => null,
    setComponentCatalogSourceTrust: unused, readComponentCatalogPackage: unused, installComponentLibraryEntry: unused, deleteComponentCatalogPackage: unused,
    exportHtml: async () => null, exportWebPackage: async () => null, peekProjectArchive: async () => null, exportBinary: async () => null, exportPdf: async () => null,
    setPreviewNetworkPolicy: async () => {}, releasePreviewNetworkPolicy: async () => {}, setDirtyState: async () => {}, onRequestSave: () => () => {},
    onRequestSaveAndClose: handler => { closeHandler = handler; return () => { closeHandler = undefined } },
    reportDiagnostic: async () => {}, exportDiagnostics: async () => null }
}

beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
  if (useEditorStore.getState().courseView.project) useEditorStore.getState().cancelTextEdit()
  useEditorStore.getState().courseBridge.dispose()
  useEditorStore.getState().setError(null)
  host = await createV10StoreHost(createBlankCourseProjectV10('保存事务'), { assets: {}, components: {} }, false)
  factory = vi.spyOn(sessions, 'createLayoutEditor')
  window.desktopAPI = desktopHarness()
})
afterEach(async () => {
  for (const release of releases.splice(0)) release()
  cleanup()
  await useEditorStore.getState().drainAllCourseDocuments().catch(() => {})
  if (useEditorStore.getState().courseView.project) useEditorStore.getState().cancelTextEdit()
  useEditorStore.getState().courseBridge.dispose(); host.bridge.dispose()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (window as Partial<Window>).desktopAPI
})

function textOf(project: CourseProjectV10, id: string): string {
  return textComponentDataSchema.parse(project.instances[id].data).content.inlines.map(inline => inline.type === 'text' ? inline.text : '').join('')
}
function formalProject(documentId = host.first.documentId): CourseProjectV10 {
  const model = host.registry.get(documentId).read().model
  if (model.kind !== 'course-v10') throw new Error('Expected V10')
  return model.project
}
function savedProject(): CourseProjectV10 {
  const bytes = host.disk.get('saved.glx')
  if (!bytes) throw new Error('Expected a saved archive')
  const model = host.driver.load(bytes)
  if (model.kind !== 'course-v10') throw new Error('Expected V10 archive')
  return model.project
}
async function mountApp() {
  render(<App />)
  await waitFor(() => expect(useEditorStore.getState().courseView.activeDocumentId).toBe(host.first.documentId))
  await act(async () => { await useEditorStore.getState().addTextNode() })
  const id = useEditorStore.getState().courseView.selectedInstanceId!
  await act(async () => { await useEditorStore.getState().saveCourseDocument() })
  return id
}
async function typeDraft(id: string, value: string) {
  await act(async () => { useEditorStore.getState().beginTextEdit(id, 'canvas') })
  const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof sessions.createLayoutEditor>
  await act(async () => {
    editor.view.focus()
    editor.view.dispatch(editor.view.state.tr.insertText(value, 1, editor.view.state.doc.content.size - 1))
  })
  expect(document.activeElement).toBe(editor.view.dom)
  expect(useEditorStore.getState().slideContentEdit?.instanceId).toBe(id)
}

it('saves the focused draft, retains newer input during the write, then saves that input on the next request', async () => {
  const id = await mountApp(), gate = deferred()
  releases.push(gate.resolve)
  await typeDraft(id, '写盘版本 A')
  host.controls.save = () => gate.promise
  const calls = vi.spyOn(host.api, 'save')
  fireEvent.click(screen.getByTestId('save-project'))
  await waitFor(() => expect(calls).toHaveBeenCalledOnce())
  expect(textOf(formalProject(), id)).toBe('写盘版本 A')
  await typeDraft(id, '写盘期间版本 B')
  await act(async () => { gate.resolve(); await gate.promise })
  await waitFor(() => expect(screen.getByTestId('save-project')).not.toBeDisabled())
  expect(textOf(savedProject(), id)).toBe('写盘版本 A')
  expect(textOf(formalProject(), id)).toBe('写盘版本 A')
  expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(true)
  expect(useEditorStore.getState().statusMessage).toBe('已保存启动保存时的版本；后续修改尚未保存')
  fireEvent.click(screen.getByTestId('save-project'))
  await waitFor(() => expect(calls).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(false))
  expect(textOf(savedProject(), id)).toBe('写盘期间版本 B')
  expect(useEditorStore.getState().slideContentEdit).toBeNull()
  expect(window.desktopAPI.saveProject).not.toHaveBeenCalled(); expect(window.desktopAPI.clearRecoveryProject).not.toHaveBeenCalled()
})

it('refuses closing when newer focused input appears during preparation and preserves both versions on the original document', async () => {
  let armed = false, reads = 0
  const gate = deferred(); releases.push(gate.resolve)
  const read = host.api.read
  host.api.read = vi.fn(async documentId => { if (armed && ++reads === 2) await gate.promise; return read(documentId) })
  const id = await mountApp()
  await typeDraft(id, '关闭版本 A')
  const save = vi.spyOn(host.api, 'save')
  armed = true
  const pending = closeHandler!([host.first.documentId])
  await waitFor(() => expect(reads).toBe(2))
  await typeDraft(id, '关闭期间版本 B')
  gate.resolve()
  await expect(pending).resolves.toMatchObject({ ready: false })
  expect(useEditorStore.getState().errorMessage).toMatch(/保全期间又有新输入/)
  expect(textOf(formalProject(), id)).toBe('关闭版本 A')
  expect(useEditorStore.getState().slideContentEdit).toMatchObject({ instanceId: id, target: { documentId: host.first.documentId } })
  expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(true)
  expect(host.registry.list().map(snapshot => snapshot.documentId)).toContain(host.first.documentId)
  expect(save).not.toHaveBeenCalled()
})

it('keeps a failed save recoverable, retries it, and admits the original draft before New switches documents', async () => {
  const id = await mountApp()
  const previousArchive = host.disk.get('saved.glx')!.slice()
  await typeDraft(id, '写盘失败仍保留')
  host.controls.save = async () => { throw new Error('disk full') }
  fireEvent.click(screen.getByTestId('save-project'))
  await waitFor(() => expect(useEditorStore.getState().errorMessage).toMatch(/disk full/))
  expect(textOf(formalProject(), id)).toBe('写盘失败仍保留')
  expect(host.first.read().dirty).toBe(true)
  const recovery = (await host.api.recoverable()).find(snapshot => snapshot.documentId === host.first.documentId)
  if (recovery?.model.kind !== 'course-v10') throw new Error('Expected recoverable V10 document')
  expect(recovery.dirty).toBe(true); expect(textOf(recovery.model.project, id)).toBe('写盘失败仍保留')
  expect(host.disk.get('saved.glx')).toEqual(previousArchive)
  host.controls.save = undefined
  fireEvent.click(screen.getByTestId('save-project'))
  await waitFor(() => expect(host.first.read().dirty).toBe(false))
  expect(textOf(savedProject(), id)).toBe('写盘失败仍保留')
  await typeDraft(id, '新建前原文保留')
  fireEvent.click(screen.getByTestId('new-project'))
  await waitFor(() => expect(useEditorStore.getState().courseView.activeDocumentId).not.toBe(host.first.documentId))
  expect(textOf(formalProject(), id)).toBe('新建前原文保留'); expect(host.first.read().dirty).toBe(true)
  expect(useEditorStore.getState().courseView.project!.instances[id]).toBeUndefined()
  expect(useEditorStore.getState().slideContentEdit).toBeNull()
  expect(window.desktopAPI.clearRecoveryProject).not.toHaveBeenCalled()
})
