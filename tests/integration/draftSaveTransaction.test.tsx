import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopAPI, SaveBinaryFileResult } from '@/shared/ipcTypes'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import { locateCourseLayer } from '@/renderer/course/effectiveLayerCommands'
import { openCourseProjectArchive } from '@/renderer/project/courseProjectArchive'
import {
  selectActiveCourseProjectDocument,
  selectHasUnsavedCourseChanges,
  useEditorStore,
} from '@/renderer/store/editorStore'

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

function desktopHarness(
  save: (input: { path?: string; suggestedName: string; bytes: Uint8Array }) =>
    Promise<SaveBinaryFileResult | null> = async () => ({ path: 'saved.h5lesson' }),
): DesktopHarness {
  let closeHandler: (() => Promise<boolean>) | null = null
  const saveProject = vi.fn(save)
  const clearRecoveryProject = vi.fn(async () => undefined)
  const confirmDiscardChanges = vi.fn(async () => 'discard' as const)
  const api: DesktopAPI = {
    openProject: vi.fn(async () => null),
    listRecentProjects: vi.fn(async () => []),
    openRecentProject: vi.fn(async () => { throw new Error('not used') }),
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

function createActiveSlideDraft(text: string): string {
  const store = useEditorStore.getState()
  store.createNewProject()
  store.addTextNode()
  const layerItemId = useEditorStore.getState().selectedNodeId
  if (!layerItemId) throw new Error('expected selected text layer')
  const baseline = useEditorStore.getState().prepareCourseProjectPersistence()
  if (!baseline.ok) throw new Error(baseline.reason)
  useEditorStore
    .getState()
    .acknowledgeCourseProjectSaved('baseline.h5lesson', baseline.token)
  const node = useEditorStore.getState().project.scenes
    .flatMap((scene) => scene.nodes)
    .find((candidate) => candidate.id === layerItemId)
  if (!node || node.type !== 'text') throw new Error('expected projected text node')
  useEditorStore.getState().beginTextEdit(layerItemId, 'canvas')
  useEditorStore.getState().updateTextEditDraft(
    layerItemId,
    text,
    node.runs,
    node.height,
    node.width,
  )
  return layerItemId
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  useEditorStore.getState().createNewProject()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as Partial<Window>).desktopAPI
  useEditorStore.getState().createNewProject()
})

describe('App draft save transaction', () => {
  it('commits the focused draft before building archive bytes', async () => {
    const layerItemId = createActiveSlideDraft('不失焦保存内容')
    const harness = desktopHarness()
    window.desktopAPI = harness.api
    render(<App />)

    fireEvent.click(screen.getByTestId('save-project'))
    await waitFor(() => expect(harness.saveProject).toHaveBeenCalledOnce())
    const input = harness.saveProject.mock.calls[0]?.[0]
    const saved = openCourseProjectArchive(input.bytes)
    expect(textOf(saved.project, layerItemId)).toBe('不失焦保存内容')
    await waitFor(() => expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(false))
    expect(harness.clearRecoveryProject).toHaveBeenCalledOnce()
  })

  it('keeps a newer draft dirty while an older archive write is pending', async () => {
    const layerItemId = createActiveSlideDraft('写盘版本 A')
    const pending = deferred<SaveBinaryFileResult | null>()
    const harness = desktopHarness(() => pending.promise)
    window.desktopAPI = harness.api
    render(<App />)

    fireEvent.click(screen.getByTestId('save-project'))
    await waitFor(() => expect(harness.saveProject).toHaveBeenCalledOnce())
    const input = harness.saveProject.mock.calls[0]?.[0]

    const node = useEditorStore.getState().project.scenes
      .flatMap((scene) => scene.nodes)
      .find((candidate) => candidate.id === layerItemId)
    if (!node || node.type !== 'text') throw new Error('expected projected text node')
    useEditorStore.getState().beginTextEdit(layerItemId, 'canvas')
    useEditorStore.getState().updateTextEditDraft(
      layerItemId,
      '写盘期间版本 B',
      node.runs,
      node.height,
      node.width,
    )

    await act(async () => {
      pending.resolve({ path: 'pending-save.h5lesson' })
      await pending.promise
    })
    await waitFor(() => expect(screen.getByTestId('save-project')).not.toBeDisabled())

    expect(textOf(openCourseProjectArchive(input.bytes).project, layerItemId)).toBe('写盘版本 A')
    expect(textOf(activeDocument(), layerItemId)).toBe('写盘版本 A')
    expect(useEditorStore.getState().v9ContentEdit).not.toBeNull()
    expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(true)
    expect(harness.clearRecoveryProject).not.toHaveBeenCalled()
  })

  it('returns false to close-before-save when a newer draft appears during the write', async () => {
    const layerItemId = createActiveSlideDraft('关闭写盘版本 A')
    const pending = deferred<SaveBinaryFileResult | null>()
    const harness = desktopHarness(() => pending.promise)
    window.desktopAPI = harness.api
    render(<App />)
    await waitFor(() => expect(harness.closeHandler()).not.toBeNull())

    const closeResult = harness.closeHandler()!()
    await waitFor(() => expect(harness.saveProject).toHaveBeenCalledOnce())
    const node = useEditorStore.getState().project.scenes
      .flatMap((scene) => scene.nodes)
      .find((candidate) => candidate.id === layerItemId)
    if (!node || node.type !== 'text') throw new Error('expected projected text node')
    useEditorStore.getState().beginTextEdit(layerItemId, 'canvas')
    useEditorStore.getState().updateTextEditDraft(
      layerItemId,
      '关闭期间版本 B',
      node.runs,
      node.height,
      node.width,
    )
    pending.resolve({ path: 'close-pending.h5lesson' })

    await expect(closeResult).resolves.toBe(false)
    expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(true)
  })

  it('keeps the committed draft dirty and recoverable when the disk write fails', async () => {
    const layerItemId = createActiveSlideDraft('写盘失败仍保留')
    const harness = desktopHarness(async () => { throw new Error('disk full') })
    window.desktopAPI = harness.api
    render(<App />)

    fireEvent.click(screen.getByTestId('save-project'))
    await waitFor(() => expect(harness.saveProject).toHaveBeenCalledOnce())
    await waitFor(() => expect(useEditorStore.getState().errorMessage).toMatch(/disk full/))

    expect(textOf(activeDocument(), layerItemId)).toBe('写盘失败仍保留')
    expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(true)
    expect(harness.clearRecoveryProject).not.toHaveBeenCalled()
  })

  it('asks before New when only an active draft is dirty and preserves it on cancel', async () => {
    const layerItemId = createActiveSlideDraft('取消新建后仍在')
    const harness = desktopHarness()
    harness.confirmDiscardChanges.mockResolvedValue('cancel')
    window.desktopAPI = harness.api
    render(<App />)

    fireEvent.click(screen.getByTestId('new-project'))
    await waitFor(() => expect(harness.confirmDiscardChanges).toHaveBeenCalledOnce())
    expect(useEditorStore.getState().v9ContentEdit).not.toBeNull()
    expect(textOf(activeDocument(), layerItemId)).not.toBe('取消新建后仍在')
    expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(true)
  })
})
