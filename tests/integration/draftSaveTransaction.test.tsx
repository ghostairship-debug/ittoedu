import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.min.mjs' }))
import type { DesktopAPI, SaveBinaryFileResult } from '@/shared/ipcTypes'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import type { DocumentHostAPI } from '@/shared/workbench/desktop'
import { CourseV9Driver } from '@/core/drivers/CourseV9Driver'
import { locateCourseLayer } from '@/renderer/course/effectiveLayerCommands'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import {
  selectActiveCourseProjectDocument,
  selectHasUnsavedCourseChanges,
  selectSelectedNodeId,
  useEditorStore,
  selectSlideSceneList,
} from '@/renderer/store/editorStore'
import {
  bootTriageCourseHost,
  formalCourse,
  formalProject,
  settleCourse,
  type TriageCourseHost,
} from '../helpers/triage-t7-courseHost'
import { createAppProject, waitForAppDocuments, withAppDocuments } from '../helpers/triage-t7-appHost'

vi.mock('@/renderer/ui/Workspace', () => ({
  Workspace: () => <div data-testid="workspace-stub" />,
}))

vi.mock('@/renderer/ui/ScenePanel', () => ({
  ScenePanel: () => <div data-testid="scene-panel-stub" />,
}))

vi.mock('@/renderer/ui/SceneStateStrip', () => ({ SceneStateStrip: () => null }))
vi.mock('@/renderer/ui/ProjectHealthPanel', () => ({ ProjectHealthPanel: () => null }))
vi.mock('@/renderer/ui/RightSidebar', () => ({ RightSidebar: () => null }))

vi.mock('@/renderer/ui/TopToolbar', () => ({
  TopToolbar: (props: {
    busy: boolean
    onNew(): void
    onOpen(): void
    onSave(saveAs?: boolean): void
  }) => (
    <div>
      <button
        type="button"
        data-testid="save-project"
        disabled={props.busy}
        onClick={() => props.onSave(false)}
      >
        保存
      </button>
      <button
        type="button"
        data-testid="new-project"
        disabled={props.busy}
        onClick={props.onNew}
      >
        新建
      </button>
      <button
        type="button"
        data-testid="open-project"
        disabled={props.busy}
        onClick={props.onOpen}
      >
        打开
      </button>
    </div>
  ),
}))

vi.mock('@/renderer/export/loadPlayerBundle', () => ({
  loadPlayerBundle: () => '/* draft save transaction test player */',
}))

vi.mock('@/renderer/ui/coursePlayerTryRun', () => ({
  attachPublishedCourseStageFit: vi.fn(() => () => undefined),
  mountPublishedCourseTryRun: vi.fn(async () => ({ destroy: async () => undefined })),
}))

import App from '@/renderer/App'

let host: TriageCourseHost

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

interface DesktopHarness {
  readonly api: DesktopAPI
  readonly saveProject: ReturnType<typeof vi.fn>
  readonly clearRecoveryProject: ReturnType<typeof vi.fn>
  readonly confirmDiscardChanges: ReturnType<typeof vi.fn>
  closeHandler(): (() => Promise<boolean>) | null
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

/**
 * The App writes archives through the document host now, so the legacy
 * `desktopAPI.saveProject` entry point must stay unused by the renderer.
 */
function desktopHarness(): DesktopHarness {
  let closeHandler: (() => Promise<boolean>) | null = null
  const saveProject = vi.fn(async () => ({ path: 'unused.h5lesson' }) as SaveBinaryFileResult)
  const clearRecoveryProject = vi.fn(async () => undefined)
  const confirmDiscardChanges = vi.fn(async () => 'discard' as const)
  const api: DesktopAPI = {
    legacyPpt: vi.fn(async () => null),
    materials: vi.fn(async () => []),
    openProject: vi.fn(async () => null),
    listRecentProjects: vi.fn(async () => []),
    openRecentProject: vi.fn(async () => { throw new Error('not used') }),
    confirmProjectOpen: vi.fn(async () => undefined),
    saveProject,
    writeRecoveryProject: vi.fn(async () => undefined),
    readRecoveryProject: vi.fn(async () => null),
    clearRecoveryProject,
    selectImage: vi.fn(async () => null),
    selectImages: vi.fn(async () => null),
    selectAudio: vi.fn(async () => null),
    selectAudios: vi.fn(async () => null),
    selectVideo: vi.fn(async () => null),
    selectVideos: vi.fn(async () => null),
    selectComponentPackage: vi.fn(async () => null),
    selectComponentPackages: vi.fn(async () => null),
    loadComponentCatalog: vi.fn(async () => ({ sources: [], packages: [], issues: [] })),
    selectComponentCatalogSource: vi.fn(async () => null),
    setComponentCatalogSourceTrust: vi.fn(async () => ({ sources: [], packages: [], issues: [] })),
    readComponentCatalogPackage: vi.fn(async () => { throw new Error('not used') }),
    exportHtml: vi.fn(async () => null),
    exportWebPackage: vi.fn(async () => null),
    peekProjectArchive: vi.fn(async () => null),
    exportBinary: vi.fn(async () => null),
    exportPdf: vi.fn(async () => null),
    setPreviewNetworkPolicy: vi.fn(async () => undefined),
    releasePreviewNetworkPolicy: vi.fn(async () => undefined),
    confirmDiscardChanges,
    setDirtyState: vi.fn(async () => undefined),
    onRequestSave: vi.fn(() => () => undefined),
    onRequestSaveAndClose: vi.fn((handler) => {
      closeHandler = handler
      return () => { closeHandler = null }
    }),
    reportDiagnostic: vi.fn(async () => undefined),
    exportDiagnostics: vi.fn(async () => null),
  }
  return { api, saveProject, clearRecoveryProject, confirmDiscardChanges, closeHandler: () => closeHandler }
}

interface HostWrite {
  readonly documentId: string
  /** The formal model main serializes into the archive. */
  readonly project: CourseProjectDocument
  /** The real archive encoding of that model, built by the same driver main uses. */
  readonly archive: Uint8Array
}

/**
 * DocumentSession is the only formal writer, so the 1.x `desktopAPI.saveProject`
 * probe is re-anchored on the document host: `saveWithDialog` is where main
 * serializes the archive. `gate` holds that write open to model a slow disk.
 */
function captureHostWrites(
  target: TriageCourseHost,
  options: { gate?: Promise<void>; failWith?: string } = {},
): { readonly calls: HostWrite[]; readonly saveWithDialog: ReturnType<typeof vi.fn> } {
  const calls: HostWrite[] = []
  const real = target.api.saveWithDialog.bind(target.api)
  const saveWithDialog = vi.fn(async (...args: Parameters<DocumentHostAPI['saveWithDialog']>) => {
    const [documentId, saveAs, suggestedDirectory] = args
    const snapshot = target.registry.get(documentId).read()
    if (snapshot.model.kind !== 'course-v9') throw new Error('expected a course document session')
    calls.push({
      documentId,
      project: snapshot.model.project,
      archive: new CourseV9Driver().serialize(snapshot.model),
    })
    if (options.gate) await options.gate
    if (options.failWith) throw new Error(options.failWith)
    return real(documentId, saveAs, suggestedDirectory)
  })
  target.api.saveWithDialog = saveWithDialog
  return { calls, saveWithDialog }
}

function activeDocument(): CourseProjectDocument {
  const document = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!document) throw new Error('expected active Course Project V9 document')
  return document
}

function textOf(document: CourseProjectDocument, layerItemId: string): string {
  const item = locateCourseLayer(document, layerItemId)?.item
  if (!item || item.kind !== 'native' || item.content.nativeType !== 'text') {
    throw new Error('expected native text layer')
  }
  return item.content.data.text
}

/** Type into the projected text layer while its draft is still renderer-only. */
function editActiveSlideDraft(layerItemId: string, text: string): void {
  const node = selectSlideSceneList(useEditorStore.getState())
    .flatMap((scene) => scene.nodes)
    .find((candidate) => candidate.id === layerItemId)
  if (!node || node.type !== 'text') throw new Error('expected projected text node')
  useEditorStore.getState().beginTextEdit(layerItemId, 'canvas')
  useEditorStore.getState().updateTextEditDraft(
    layerItemId,
    text,
    node.runs ?? [],
    node.height,
    node.width,
  )
}

/**
 * A saved baseline plus one renderer-only text draft. 2.0 has no renderer-side
 * project loader, so the App must already be connected to the real document host.
 */
async function createActiveSlideDraft(text: string): Promise<string> {
  await createAppProject('slide')
  useEditorStore.getState().addTextNode()
  await settleCourse()
  const layerItemId = selectSelectedNodeId(useEditorStore.getState())
  if (!layerItemId) throw new Error('expected selected text layer')
  // 1.x acknowledged a renderer-built baseline snapshot. Only the main-owned
  // session can clear dirty now, so the baseline must be a real host save.
  const baseline = await useEditorStore.getState().saveCourseDocument()
  if (!baseline || baseline.binding.kind !== 'file' || baseline.dirty) {
    throw new Error('expected a saved baseline')
  }
  editActiveSlideDraft(layerItemId, text)
  return layerItemId
}

beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  host = await bootTriageCourseHost()
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as Partial<Window>).desktopAPI
  // Settle the finished test so no late activation can land on the next host.
  await useEditorStore.getState().drainAllCourseDocuments().catch(() => undefined)
})

describe('App draft save transaction', () => {
  it('commits the focused draft before building archive bytes', async () => {
    const harness = desktopHarness()
    window.desktopAPI = withAppDocuments(harness.api, host)
    render(<App />)
    await waitForAppDocuments()

    const layerItemId = await createActiveSlideDraft('不失焦保存内容')
    const writes = captureHostWrites(host)
    fireEvent.click(screen.getByTestId('save-project'))
    await waitFor(() => expect(writes.saveWithDialog).toHaveBeenCalledOnce())

    // Main serializes the formal session, and that model already carries the
    // committed draft: the archive decoded here is what a reopen would load.
    const written = writes.calls[0]!
    expect(textOf(openCourseProjectArchive(written.archive).project, layerItemId)).toBe('不失焦保存内容')
    expect(textOf(written.project, layerItemId)).toBe('不失焦保存内容')
    await waitFor(() => expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(false))
    expect(formalCourse(host).dirty).toBe(false)
    // The renderer must not build archive bytes itself any more, and the legacy
    // recovery package belongs to main (`src/main/projectPersistence.ts:373`).
    expect(harness.saveProject).not.toHaveBeenCalled()
    expect(harness.clearRecoveryProject).not.toHaveBeenCalled()
  })

  it('keeps a newer draft dirty while an older archive write is pending', async () => {
    const harness = desktopHarness()
    window.desktopAPI = withAppDocuments(harness.api, host)
    render(<App />)
    await waitForAppDocuments()

    const layerItemId = await createActiveSlideDraft('写盘版本 A')
    const release = deferred<void>()
    const writes = captureHostWrites(host, { gate: release.promise })
    fireEvent.click(screen.getByTestId('save-project'))
    await waitFor(() => expect(writes.saveWithDialog).toHaveBeenCalledOnce())

    // The first version is already committed; the newer draft is typed while main
    // is still writing, so it can only live in the renderer view.
    editActiveSlideDraft(layerItemId, '写盘期间版本 B')
    await act(async () => {
      release.resolve()
      await release.promise
    })
    await waitFor(() => expect(screen.getByTestId('save-project')).not.toBeDisabled())

    expect(textOf(openCourseProjectArchive(writes.calls[0]!.archive).project, layerItemId)).toBe('写盘版本 A')
    expect(textOf(activeDocument(), layerItemId)).toBe('写盘版本 A')
    expect(useEditorStore.getState().v9ContentEdit).not.toBeNull()
    expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(true)
    expect(useEditorStore.getState().statusMessage).toBe('已保存启动保存时的版本；后续修改尚未保存')
    expect(harness.saveProject).not.toHaveBeenCalled()
    expect(harness.clearRecoveryProject).not.toHaveBeenCalled()
  })

  it('returns false to close-before-save when a newer draft appears during close preparation', async () => {
    const harness = desktopHarness()
    // The App copies `documents` into a view wrapper, so a read gate has to exist
    // before render; it stays inert until the close flow is armed below.
    let armed = false
    let reads = 0
    let blocked = 0
    let settled = false
    const release = deferred<void>()
    const realRead = host.api.read.bind(host.api)
    host.api.read = vi.fn(async (documentId: string) => {
      if (armed && ++reads > 2) { blocked += 1; await release.promise }
      return realRead(documentId)
    })
    window.desktopAPI = withAppDocuments(harness.api, host)
    render(<App />)
    await waitForAppDocuments()
    const layerItemId = await createActiveSlideDraft('关闭写盘版本 A')
    const writes = captureHostWrites(host)

    // Main writes the archive only after the renderer reports readiness, so the
    // 1.x "write is pending" window is now close preparation itself. `drainAll`
    // captures its prepared-draft baseline and then awaits the authoritative read
    // of the projection drain; hold exactly that read open (reads 1 and 2 are the
    // operation ACK and the `drainCourseDocument` read) and type inside the window.
    armed = true
    const closeHandler = harness.closeHandler()
    if (!closeHandler) throw new Error('expected a registered close handler')
    const closeResult = closeHandler()
    void closeResult.then(() => { settled = true })
    await waitFor(() => expect(blocked).toBe(1))
    expect(settled).toBe(false)
    editActiveSlideDraft(layerItemId, '关闭期间版本 B')
    release.resolve()

    await expect(closeResult).resolves.toBe(false)
    expect(useEditorStore.getState().errorMessage).toMatch(/关闭准备期间又有新的输入或文档切换/)
    expect(useEditorStore.getState().v9ContentEdit).not.toBeNull()
    expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(true)
    expect(textOf(formalProject(host), layerItemId)).toBe('关闭写盘版本 A')
    expect(writes.saveWithDialog).not.toHaveBeenCalled()
  })

  it('keeps the committed draft dirty and recoverable when the disk write fails', async () => {
    const harness = desktopHarness()
    window.desktopAPI = withAppDocuments(harness.api, host)
    render(<App />)
    await waitForAppDocuments()

    const layerItemId = await createActiveSlideDraft('写盘失败仍保留')
    const writes = captureHostWrites(host, { failWith: 'disk full' })
    fireEvent.click(screen.getByTestId('save-project'))
    await waitFor(() => expect(writes.saveWithDialog).toHaveBeenCalledOnce())
    await waitFor(() => expect(useEditorStore.getState().errorMessage).toMatch(/disk full/))

    expect(textOf(activeDocument(), layerItemId)).toBe('写盘失败仍保留')
    expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(true)
    expect(formalCourse(host).dirty).toBe(true)
    expect(harness.saveProject).not.toHaveBeenCalled()
    expect(harness.clearRecoveryProject).not.toHaveBeenCalled()
  })

  it('retains the previous main-owned document with its active draft when New switches projects', async () => {
    const harness = desktopHarness()
    harness.confirmDiscardChanges.mockResolvedValue('cancel')
    window.desktopAPI = withAppDocuments(harness.api, host)
    render(<App />)
    await waitForAppDocuments()

    const layerItemId = await createActiveSlideDraft('取消新建后仍在')
    const previous = formalCourse(host).documentId

    fireEvent.click(screen.getByTestId('new-project'))
    await waitFor(() => expect(useEditorStore.getState().courseDocument.documentId).not.toBe(previous))

    // 2.0 keeps every main-owned session, so New discards nothing and never asks
    // (`tests/unit/useCourseProjectLifecycle.test.tsx:61`); the admitted draft
    // stays with the document the user was editing.
    expect(harness.confirmDiscardChanges).not.toHaveBeenCalled()
    expect(textOf(formalProject(host, previous), layerItemId)).toBe('取消新建后仍在')
    expect(formalCourse(host, previous).dirty).toBe(true)
    expect(useEditorStore.getState().v9ContentEdit).toBeNull()
    expect(locateCourseLayer(activeDocument(), layerItemId)).toBeNull()
    expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(true)
  })
})
