import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopAPI, SelectedImageResult } from '../../src/shared/ipcTypes'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { componentPackagesFromArchive } from '../../src/renderer/components/componentPackageStore'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
  type CourseProjectArchiveData,
} from '../../src/renderer/project/courseProjectArchive'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'
import { buildPublishedCourseStandaloneHtml } from '../../src/renderer/export/course/buildCoursePackages'
import {
  selectActiveCourseLocationId,
  selectActiveCourseProjectDocument,
  selectMediaAssetFiles,
  selectSelectedNodeId,
  useEditorStore,
} from '../../src/renderer/store/editorStore'

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
  RightSidebar: (props: { onReplaceImage?: () => void }) => (
    <button
      type="button"
      data-testid="replace-image"
      onClick={() => props.onReplaceImage?.()}
    >
      替换图片
    </button>
  ),
}))

vi.mock('../../src/renderer/ui/TopToolbar', () => ({
  TopToolbar: (props: {
    busy: boolean
    onNew: () => void
    onOpen: () => void
  }) => (
    <div data-testid="toolbar-stub">
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

vi.mock('../../src/renderer/export/loadPlayerBundle', () => ({
  loadPlayerBundle: () => '/* VS-01 test player bundle */',
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
const LOCATION_A = 'slide-location-intro'
const LOCATION_B = 'slide-location-summary'
const IMAGE_A = 'slide-intro-hero'
const IMAGE_B = 'slide-summary-hero'
const FIXED_TIME = '2026-08-24T00:00:00.000Z'

const REPLACEMENT_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02,
  0x08, 0x02, 0x00, 0x00, 0x00, 0xfd, 0xd4, 0x9a, 0x73,
])

const REPLACEMENT_FILE: SelectedImageResult = {
  path: 'test-fixtures/replacement.png',
  name: 'replacement.png',
  mimeType: 'image/png',
  bytes: REPLACEMENT_BYTES,
}

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

interface ReplacementSnapshot {
  readonly projectId: string
  readonly revision: number
  readonly locationId: string | null
  readonly selectedNodeId: string | null
  readonly imageAAssetId: string
  readonly imageBAssetId: string
  readonly assetIds: readonly string[]
  readonly fileIds: readonly string[]
  readonly historyDepth: number
  readonly sidecarPastDepth: number
  readonly errorMessage: string | null
}

interface RaceDiagnostic {
  readonly targetAtDialogOpen: typeof IMAGE_A
  readonly selectionAtDialogResolve: typeof IMAGE_B
  readonly before: ReplacementSnapshot
  readonly after: ReplacementSnapshot
  readonly mutatedItemIds: readonly string[]
  readonly historyDelta: number
}

const futureStaleContract = Object.freeze([
  { scenario: 'project changed', expectedCode: 'project-mismatch' },
  { scenario: 'location/generation changed', expectedCode: 'session-stale' },
  { scenario: 'owner changed', expectedCode: 'owner-mismatch' },
  { scenario: 'item deleted', expectedCode: 'item-missing' },
  { scenario: 'document revision changed', expectedCode: 'revision-conflict' },
])

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function selectedImageApi(
  selectImage: () => Promise<SelectedImageResult | null>,
): DesktopAPI & { selectImage: ReturnType<typeof vi.fn> } {
  const selectImageSpy = vi.fn(selectImage)
  return {
    openProject: vi.fn(async () => null),
    listRecentProjects: vi.fn(async () => []),
    openRecentProject: vi.fn(async () => { throw new Error('not used') }),
    confirmProjectOpen: vi.fn(async () => undefined),
    saveProject: vi.fn(async () => null),
    writeRecoveryProject: vi.fn(async () => undefined),
    readRecoveryProject: vi.fn(async () => null),
    clearRecoveryProject: vi.fn(async () => undefined),
    selectImage: selectImageSpy,
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
    confirmDiscardChanges: vi.fn(async () => 'discard' as const),
    setDirtyState: vi.fn(async () => undefined),
    onRequestSave: vi.fn(() => () => undefined),
    onRequestSaveAndClose: vi.fn(() => () => undefined),
    reportDiagnostic: vi.fn(async () => undefined),
    exportDiagnostics: vi.fn(async () => null),
  }
}

function fixtureArchive(): CourseProjectArchiveData {
  const source = openCourseProjectArchive(new Uint8Array(readFileSync(FIXTURE_PATH)))
  const project = structuredClone(source.project)
  const intro = project.locations.find((location) => location.id === LOCATION_A)
  if (!intro || intro.kind !== 'slide-scene') throw new Error('missing intro location')
  delete intro.stateId
  return {
    project: courseProjectDocumentSchema.parse(project),
    assetFiles: source.assetFiles,
    componentFiles: source.componentFiles,
  }
}

function loadFixture(): CourseProjectArchiveData {
  const archive = fixtureArchive()
  useEditorStore.getState().loadCourseProject(
    archive.project,
    null,
    archive.assetFiles,
    componentPackagesFromArchive(archive.project, archive.componentFiles),
  )
  useEditorStore.getState().activateCourseLocation(LOCATION_A)
  useEditorStore.getState().selectNode(IMAGE_A)
  return archive
}

function imageAssetId(project: CourseProjectDocument, itemId: string): string {
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    for (const scene of surface.scenes) {
      const item = scene.layerItems.find((candidate) => candidate.layerItemId === itemId)
      if (
        item?.kind === 'native' &&
        item.content.nativeType === 'image'
      ) {
        return item.content.data.assetId
      }
    }
  }
  throw new Error(`missing image layer ${itemId}`)
}

function snapshot(): ReplacementSnapshot {
  const state = useEditorStore.getState()
  const project = selectActiveCourseProjectDocument(state)
  if (!project) throw new Error('missing active Course Project V9')
  return {
    projectId: project.id,
    revision: project.revision,
    locationId: selectActiveCourseLocationId(state),
    selectedNodeId: selectSelectedNodeId(state),
    imageAAssetId: imageAssetId(project, IMAGE_A),
    imageBAssetId: imageAssetId(project, IMAGE_B),
    assetIds: Object.keys(project.assets).sort(),
    fileIds: Object.keys(selectMediaAssetFiles(state)).sort(),
    historyDepth: state.slideBackend?.getSession().history.past.length ?? 0,
    sidecarPastDepth: state.courseAssetSidecarPast.length,
    errorMessage: state.errorMessage,
  }
}

function mutatedItems(
  before: ReplacementSnapshot,
  after: ReplacementSnapshot,
): string[] {
  return [
    ...(before.imageAAssetId === after.imageAAssetId ? [] : [IMAGE_A]),
    ...(before.imageBAssetId === after.imageBAssetId ? [] : [IMAGE_B]),
  ]
}

async function renderAppWithDialog(
  result: Deferred<SelectedImageResult | null>,
) {
  const api = selectedImageApi(() => result.promise)
  window.desktopAPI = api
  render(<App />)
  await waitFor(() => expect(screen.getByTestId('replace-image')).toBeVisible())
  return api
}

async function beginReplacement(
  result: Deferred<SelectedImageResult | null>,
) {
  const api = await renderAppWithDialog(result)
  fireEvent.click(screen.getByTestId('replace-image'))
  await waitFor(() => expect(api.selectImage).toHaveBeenCalledOnce())
  return api
}

async function resolveDialog<T>(result: Deferred<T>, value: T): Promise<void> {
  await act(async () => {
    result.resolve(value)
    await Promise.resolve()
  })
}

async function runCrossLocationRace(): Promise<RaceDiagnostic> {
  loadFixture()
  const before = snapshot()
  const result = deferred<SelectedImageResult | null>()
  await beginReplacement(result)
  useEditorStore.getState().activateCourseLocation(LOCATION_B)
  useEditorStore.getState().selectNode(IMAGE_B)
  await resolveDialog(result, REPLACEMENT_FILE)
  await waitFor(() => expect(screen.getByTestId('new-project')).not.toBeDisabled())
  const after = snapshot()
  return {
    targetAtDialogOpen: IMAGE_A,
    selectionAtDialogResolve: IMAGE_B,
    before,
    after,
    mutatedItemIds: mutatedItems(before, after),
    historyDelta: after.historyDepth - before.historyDepth,
  }
}

beforeEach(() => {
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
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:vs-01-image')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  loadFixture()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as Partial<Window>).desktopAPI
  useEditorStore.getState().clearV9SlideCandidateBackend()
})

describe('ARCH-1 VS-01 image replacement characterization', () => {
  it('keeps the normal same-target replacement to one history step and round-trips current save/publish/HTML endpoints', async () => {
    const source = fixtureArchive()
    const before = snapshot()
    const result = deferred<SelectedImageResult | null>()
    await beginReplacement(result)
    await resolveDialog(result, REPLACEMENT_FILE)

    await waitFor(() => expect(snapshot().imageAAssetId).not.toBe(before.imageAAssetId))
    const after = snapshot()
    const replacementAssetId = after.imageAAssetId
    expect(after.imageBAssetId).toBe(before.imageBAssetId)
    expect(after.historyDepth).toBe(before.historyDepth + 1)
    expect(after.revision).toBe(before.revision + 1)
    expect(after.assetIds).toContain(replacementAssetId)
    expect(after.fileIds).toContain(replacementAssetId)
    expect(selectMediaAssetFiles(useEditorStore.getState())[replacementAssetId])
      .toEqual(REPLACEMENT_BYTES)

    useEditorStore.getState().undo()
    expect(snapshot().imageAAssetId).toBe(before.imageAAssetId)
    expect(snapshot().assetIds).not.toContain(replacementAssetId)
    expect(snapshot().fileIds).not.toContain(replacementAssetId)
    useEditorStore.getState().redo()
    expect(snapshot().imageAAssetId).toBe(replacementAssetId)
    expect(selectMediaAssetFiles(useEditorStore.getState())[replacementAssetId])
      .toEqual(REPLACEMENT_BYTES)

    const state = useEditorStore.getState()
    const project = selectActiveCourseProjectDocument(state)
    if (!project) throw new Error('missing project after redo')
    const archiveBytes = createCourseProjectArchive({
      project,
      assetFiles: selectMediaAssetFiles(state),
      componentFiles: source.componentFiles,
    }, { mtime: FIXED_TIME })
    const reopened = openCourseProjectArchive(archiveBytes)
    expect(imageAssetId(reopened.project, IMAGE_A)).toBe(replacementAssetId)
    expect(reopened.assetFiles[replacementAssetId]).toEqual(REPLACEMENT_BYTES)

    const published = buildPublishedCourseV2Payload({
      project: reopened.project,
      assetFiles: reopened.assetFiles,
      components: componentPackagesFromArchive(reopened.project, reopened.componentFiles),
    })
    expect(published.assets[replacementAssetId]?.url).toMatch(/^data:image\/png;base64,/)
    const html = buildPublishedCourseStandaloneHtml({
      project: reopened.project,
      assetFiles: reopened.assetFiles,
      components: componentPackagesFromArchive(reopened.project, reopened.componentFiles),
    }, '/* VS-01 read-only Player endpoint */')
    expect(html).toContain(published.assets[replacementAssetId]!.url)
  })

  it('treats a cancelled dialog as a no-op with no history, metadata, or bytes', async () => {
    const before = snapshot()
    const result = deferred<SelectedImageResult | null>()
    await beginReplacement(result)
    await resolveDialog(result, null)
    await waitFor(() => expect(screen.getByTestId('new-project')).not.toBeDisabled())
    expect(snapshot()).toEqual(before)
  })

  it('captures the current cross-location before/after diagnostic without declaring the wrong write desirable', async () => {
    const observation = await runCrossLocationRace()
    expect(observation.targetAtDialogOpen).toBe(IMAGE_A)
    expect(observation.selectionAtDialogResolve).toBe(IMAGE_B)
    expect(observation.before).toBeDefined()
    expect(observation.after).toBeDefined()
    expect(Array.isArray(observation.mutatedItemIds)).toBe(true)
    console.info('VS-01 current cross-location diagnostic', JSON.stringify(observation))
  })

  it('rejects a stale cross-location callback and leaves both A and B unchanged', async () => {
    const observation = await runCrossLocationRace()
    expect(observation.after.errorMessage).toMatch(/过期|重新选择/)
    expect(observation.after.imageAAssetId).toBe(observation.before.imageAAssetId)
    expect(observation.after.imageBAssetId).toBe(observation.before.imageBAssetId)
    expect(observation.historyDelta).toBe(0)
    expect(observation.after.assetIds).toEqual(observation.before.assetIds)
    expect(observation.after.fileIds).toEqual(observation.before.fileIds)
  })

  it('records that project New/Open is UI-unreachable while the image dialog keeps App busy', async () => {
    const projectId = snapshot().projectId
    const result = deferred<SelectedImageResult | null>()
    await beginReplacement(result)
    await waitFor(() => expect(screen.getByTestId('new-project')).toBeDisabled())
    expect(screen.getByTestId('open-project')).toBeDisabled()
    fireEvent.click(screen.getByTestId('new-project'))
    expect(snapshot().projectId).toBe(projectId)
    await resolveDialog(result, null)
    await waitFor(() => expect(screen.getByTestId('new-project')).not.toBeDisabled())
  })

  it('records the future stale-result matrix without claiming those guards exist today', () => {
    expect(futureStaleContract).toEqual([
      { scenario: 'project changed', expectedCode: 'project-mismatch' },
      { scenario: 'location/generation changed', expectedCode: 'session-stale' },
      { scenario: 'owner changed', expectedCode: 'owner-mismatch' },
      { scenario: 'item deleted', expectedCode: 'item-missing' },
      { scenario: 'document revision changed', expectedCode: 'revision-conflict' },
    ])
  })
})
