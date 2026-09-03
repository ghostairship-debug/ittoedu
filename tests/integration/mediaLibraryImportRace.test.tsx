import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { componentPackagesFromArchive } from '../../src/renderer/components/componentPackageStore'
import { openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import {
  selectActiveCourseProjectDocument,
  selectMediaAssetFiles,
  useEditorStore,
} from '../../src/renderer/store/editorStore'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import type {
  DesktopAPI,
  SelectedFileBatch,
  SelectedImageBatchFile,
} from '../../src/shared/ipcTypes'

vi.mock('../../src/renderer/ui/Workspace', () => ({
  Workspace: () => <div data-testid="workspace-stub" />,
}))

vi.mock('../../src/renderer/ui/ScenePanel', () => ({
  ScenePanel: () => <div data-testid="scene-panel-stub" />,
}))

vi.mock('../../src/renderer/ui/SceneStateStrip', () => ({
  SceneStateStrip: () => null,
}))

vi.mock('../../src/renderer/ui/ProjectHealthPanel', () => ({
  ProjectHealthPanel: () => null,
}))

vi.mock('../../src/renderer/ui/RightSidebar', () => ({
  RightSidebar: (props: { onImportImage?: () => void }) => (
    <button
      type="button"
      data-testid="import-image-library"
      onClick={() => props.onImportImage?.()}
    >
      图片入库
    </button>
  ),
}))

vi.mock('../../src/renderer/ui/TopToolbar', () => ({
  TopToolbar: (props: { busy: boolean }) => (
    <button type="button" data-testid="busy-state" disabled={props.busy}>
      {props.busy ? '正在处理' : '就绪'}
    </button>
  ),
}))

vi.mock('../../src/renderer/export/loadPlayerBundle', () => ({
  loadPlayerBundle: () => '/* media-library race test player bundle */',
}))

vi.mock('../../src/renderer/export/renderSceneImages', () => ({
  renderProjectSceneImages: vi.fn(async () => []),
}))

vi.mock('../../src/renderer/ui/coursePlayerTryRun', () => ({
  attachPublishedCourseStageFit: vi.fn(() => () => undefined),
  mountPublishedCourseTryRun: vi.fn(async () => ({
    destroy: async () => undefined,
  })),
}))

import App from '../../src/renderer/App'

const FIXTURE_PATH = join(
  process.cwd(),
  'tests',
  'fixtures',
  'architecture-baseline',
  'slide-heavy.h5lesson',
)

const FIRST_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02,
  0x08, 0x02, 0x00, 0x00, 0x00, 0xfd, 0xd4, 0x9a, 0x73,
])
const SECOND_BYTES = Uint8Array.from(FIRST_BYTES, (value, index) => (
  index === FIRST_BYTES.length - 1 ? value ^ 0xff : value
))

const IMAGE_BATCH: SelectedFileBatch<SelectedImageBatchFile> = {
  selectedCount: 2,
  acceptedByteLength: FIRST_BYTES.byteLength + SECOND_BYTES.byteLength,
  accepted: [
    {
      path: 'test-fixtures/arch2-library-a.png',
      name: 'arch2-library-a.png',
      mimeType: 'image/png',
      bytes: FIRST_BYTES,
      sha256: 'a'.repeat(64),
    },
    {
      path: 'test-fixtures/arch2-library-b.png',
      name: 'arch2-library-b.png',
      mimeType: 'image/png',
      bytes: SECOND_BYTES,
      sha256: 'b'.repeat(64),
    },
  ],
  rejected: [],
}

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

interface ResourceSnapshot {
  readonly project: CourseProjectDocument
  readonly files: Readonly<Record<string, readonly number[]>>
  readonly activeHistoryDepth: number
  readonly storeHistoryDepth: number
  readonly sidecarPastDepth: number
  readonly sidecarFutureDepth: number
  readonly componentPastDepth: number
  readonly componentFutureDepth: number
}

const originalCaptureMediaLibraryImportTarget =
  useEditorStore.getState().captureMediaLibraryImportTarget

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function selectedImagesApi(
  selectImages: () => Promise<SelectedFileBatch<SelectedImageBatchFile> | null>,
): DesktopAPI & { selectImages: ReturnType<typeof vi.fn> } {
  const selectImagesSpy = vi.fn(selectImages)
  return {
    openProject: vi.fn(async () => null),
    listRecentProjects: vi.fn(async () => []),
    openRecentProject: vi.fn(async () => { throw new Error('not used') }),
    confirmProjectOpen: vi.fn(async () => undefined),
    saveProject: vi.fn(async () => null),
    writeRecoveryProject: vi.fn(async () => undefined),
    readRecoveryProject: vi.fn(async () => null),
    clearRecoveryProject: vi.fn(async () => undefined),
    selectImage: vi.fn(async () => null),
    selectImages: selectImagesSpy,
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
    confirmDiscardChanges: vi.fn(async () => 'discard' as const),
    setDirtyState: vi.fn(async () => undefined),
    onRequestSave: vi.fn(() => () => undefined),
    onRequestSaveAndClose: vi.fn(() => () => undefined),
    reportDiagnostic: vi.fn(async () => undefined),
    exportDiagnostics: vi.fn(async () => null),
  }
}

function loadFixture(): void {
  const source = openCourseProjectArchive(new Uint8Array(readFileSync(FIXTURE_PATH)))
  useEditorStore.getState().loadCourseProject(
    source.project,
    null,
    source.assetFiles,
    componentPackagesFromArchive(source.project, source.componentFiles),
  )
  useEditorStore.getState().activateCourseLocation('slide-location-intro')
}

function activeProject() {
  const project = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!project) throw new Error('Expected an active Course Project V9')
  return project
}

function byteMap(files: Readonly<Record<string, Uint8Array>>) {
  return Object.fromEntries(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([assetId, bytes]) => [assetId, [...bytes]]),
  )
}

function resourceSnapshot(): ResourceSnapshot {
  const state = useEditorStore.getState()
  if (state.slideBackend?.kind !== 'slide-authoring') {
    throw new Error('Expected an active Slide authoring backend')
  }
  return {
    project: structuredClone(activeProject()),
    files: byteMap(selectMediaAssetFiles(state)),
    activeHistoryDepth: state.slideBackend.getSession().history.past.length,
    storeHistoryDepth: state.history.past.length,
    sidecarPastDepth: state.courseAssetSidecarPast.length,
    sidecarFutureDepth: state.courseAssetSidecarFuture.length,
    componentPastDepth: state.courseComponentPackagesPast.length,
    componentFutureDepth: state.courseComponentPackagesFuture.length,
  }
}

async function beginLibraryImport(
  result: Deferred<SelectedFileBatch<SelectedImageBatchFile> | null>,
) {
  const captureTarget = vi.fn(() => originalCaptureMediaLibraryImportTarget())
  useEditorStore.setState({ captureMediaLibraryImportTarget: captureTarget })
  const api = selectedImagesApi(() => result.promise)
  window.desktopAPI = api
  render(<App />)
  await waitFor(() => expect(screen.getByTestId('import-image-library')).toBeVisible())
  fireEvent.click(screen.getByTestId('import-image-library'))
  await waitFor(() => expect(api.selectImages).toHaveBeenCalledOnce())
  return { api, captureTarget }
}

async function resolveDialog<T>(result: Deferred<T>, value: T): Promise<void> {
  await act(async () => {
    result.resolve(value)
    await Promise.resolve()
  })
}

beforeEach(() => {
  useEditorStore.setState({
    captureMediaLibraryImportTarget: originalCaptureMediaLibraryImportTarget,
  })
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  vi.stubGlobal('Image', class {
    naturalWidth = 2
    naturalHeight = 2
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) {
      queueMicrotask(() => this.onload?.())
    }
  })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:arch2-media-library')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  loadFixture()
})

afterEach(() => {
  cleanup()
  useEditorStore.setState({
    captureMediaLibraryImportTarget: originalCaptureMediaLibraryImportTarget,
  })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as Partial<Window>).desktopAPI
  useEditorStore.getState().clearV9SlideCandidateBackend()
})

describe('ARCH-2 App media-library import race', () => {
  it('captures the explicit library target before the dialog and rejects a stale revision without resource writes', async () => {
    const projectBeforeDialog = activeProject()
    const result = deferred<SelectedFileBatch<SelectedImageBatchFile> | null>()
    const { api, captureTarget } = await beginLibraryImport(result)

    expect(captureTarget).toHaveBeenCalledOnce()
    expect(captureTarget.mock.invocationCallOrder[0])
      .toBeLessThan(api.selectImages.mock.invocationCallOrder[0]!)
    expect(captureTarget.mock.results[0]?.value).toEqual({
      projectId: projectBeforeDialog.id,
      documentRevision: projectBeforeDialog.revision,
    })
    expect(screen.getByTestId('busy-state')).toBeDisabled()

    useEditorStore.getState().renameProject('ARCH-2 media import intervening edit')
    expect(activeProject().revision).toBe(projectBeforeDialog.revision + 1)
    const afterRename = resourceSnapshot()

    await resolveDialog(result, IMAGE_BATCH)
    await waitFor(() => expect(screen.getByTestId('busy-state')).not.toBeDisabled())
    await waitFor(() => {
      expect(useEditorStore.getState().errorMessage).toMatch(/已取消|过期/)
      expect(useEditorStore.getState().errorMessage).toMatch(/重新选择|再试/)
    })

    expect(resourceSnapshot()).toEqual(afterRename)
  })

  it('commits a normal two-image library batch as one history frame without full sidecar snapshots', async () => {
    const before = resourceSnapshot()
    const result = deferred<SelectedFileBatch<SelectedImageBatchFile> | null>()
    await beginLibraryImport(result)
    await resolveDialog(result, IMAGE_BATCH)
    await waitFor(() => expect(screen.getByTestId('busy-state')).not.toBeDisabled())

    const after = resourceSnapshot()
    expect(after.project.revision).toBe(before.project.revision + 1)
    expect(after.activeHistoryDepth).toBe(before.activeHistoryDepth + 1)
    expect(after.storeHistoryDepth).toBe(before.storeHistoryDepth + 1)
    expect(after.sidecarPastDepth).toBe(before.sidecarPastDepth)
    expect(after.sidecarFutureDepth).toBe(before.sidecarFutureDepth)
    expect(after.componentPastDepth).toBe(before.componentPastDepth)
    expect(after.componentFutureDepth).toBe(before.componentFutureDepth)

    const addedAssetIds = Object.keys(after.project.assets)
      .filter((assetId) => !Object.hasOwn(before.project.assets, assetId))
    expect(addedAssetIds).toHaveLength(2)
    const addedByFilename = Object.fromEntries(addedAssetIds.map((assetId) => [
      after.project.assets[assetId]!.filename,
      after.files[assetId],
    ]))
    expect(addedByFilename).toEqual({
      'arch2-library-a.png': [...FIRST_BYTES],
      'arch2-library-b.png': [...SECOND_BYTES],
    })
  })
})
