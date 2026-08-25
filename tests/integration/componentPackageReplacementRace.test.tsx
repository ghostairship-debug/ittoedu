import { createHash, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AvailableComponentCatalogPackage,
  ComponentCatalogPackageFile,
  ComponentCatalogSnapshot,
} from '../../src/shared/componentCatalog'
import type { ComponentManifest, ComponentPackageData } from '../../src/shared/componentTypes'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import type { DesktopAPI, OpenBinaryFileResult } from '../../src/shared/ipcTypes'
import { componentPackagesFromArchive } from '../../src/renderer/components/componentPackageStore'
import { importComponentPackage } from '../../src/renderer/components/importComponentPackage'
import { openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import {
  selectActiveCourseProjectDocument,
  useEditorStore,
  type ComponentPackageReplacementCommitResult,
  type ComponentPackageReplacementTarget,
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
  RightSidebar: (props: {
    onReplaceComponent?: (packageId: string) => void
    onUpdateCatalogComponent?: (entry: AvailableComponentCatalogPackage) => void
  }) => (
    <div>
      <button
        type="button"
        data-testid="replace-component-manually"
        onClick={() => props.onReplaceComponent?.(PACKAGE_ID)}
      >
        手动替换组件
      </button>
      <button
        type="button"
        data-testid="update-component-from-catalog"
        onClick={() => props.onUpdateCatalogComponent?.(CATALOG_ENTRY)}
      >
        目录更新组件
      </button>
    </div>
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
  loadPlayerBundle: () => '/* component replacement race test player bundle */',
}))

vi.mock('../../src/renderer/export/renderSceneImages', () => ({
  renderProjectSceneImages: vi.fn(async () => []),
  renderProjectSceneImagesWithRuntime: vi.fn(async () => []),
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
const PACKAGE_ID = 'com.example.arch2-race'
const INITIAL_VERSION = '4.0.0'
const REPLACEMENT_VERSION = '4.1.0'
const INITIAL_PROVENANCE_SHA256 = '1'.repeat(64)

function manifest(version: string): ComponentManifest {
  return {
    schemaVersion: 4,
    runtimeApiVersion: 4,
    id: PACKAGE_ID,
    name: 'ARCH-2 替换竞态组件',
    version,
    description: '用于 App 组件包替换竞态的合法 Component API 4 包',
    entry: 'runtime.js',
    defaultSize: { width: 320, height: 180 },
    minSize: { width: 160, height: 90 },
    preserveAspectRatio: false,
    assets: {},
    defaultProps: { label: `v${version}` },
    supportedScopes: ['scene', 'global'],
    renderMode: 'dom',
  }
}

function packageBytes(version: string): Uint8Array {
  const componentManifest = manifest(version)
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(componentManifest)),
    'runtime.js': strToU8(
      `window.CoursewareComponent.define({
        id: ${JSON.stringify(PACKAGE_ID)},
        runtimeApiVersion: 4,
        create: function () { return { destroy: function () {} } }
      })`,
    ),
  })
}

const INITIAL_BYTES = packageBytes(INITIAL_VERSION)
const REPLACEMENT_BYTES = packageBytes(REPLACEMENT_VERSION)
const REPLACEMENT_SHA256 = createHash('sha256')
  .update(REPLACEMENT_BYTES)
  .digest('hex')

const CATALOG_ENTRY: AvailableComponentCatalogPackage = {
  packageId: PACKAGE_ID,
  version: REPLACEMENT_VERSION,
  name: 'ARCH-2 替换竞态组件',
  description: '目录中的 4.1 更新包',
  subject: [],
  schoolStage: [],
  tags: ['arch-2', 'race'],
  packagePath: 'packages/arch2-race.h5component',
  thumbnailPath: 'thumbnails/arch2-race.svg',
  sha256: REPLACEMENT_SHA256,
  componentSchemaVersion: 4,
  runtimeApiVersion: 4,
  renderMode: 'dom',
  supportedScopes: ['scene', 'global'],
  quality: 'experimental',
  maintainer: 'architecture-tests',
  verifiedCases: [],
  sourceId: 'source:arch2-race',
  sourceLabel: 'ARCH-2 测试目录',
  sourceTrust: 'built-in',
}

const CATALOG: ComponentCatalogSnapshot = {
  sources: [{
    sourceId: CATALOG_ENTRY.sourceId,
    label: CATALOG_ENTRY.sourceLabel,
    trust: CATALOG_ENTRY.sourceTrust,
    packageCount: 1,
  }],
  packages: [CATALOG_ENTRY],
  issues: [],
}

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

interface ReplacementWriteSnapshot {
  readonly project: CourseProjectDocument
  readonly componentPackages: Readonly<Record<string, ComponentPackageData>>
  readonly activeHistory: unknown
  readonly storeHistory: unknown
  readonly sidecarPast: unknown
  readonly sidecarFuture: unknown
  readonly componentPast: unknown
  readonly componentFuture: unknown
}

type CaptureSpy = ReturnType<typeof vi.fn<
  (packageId: string) => ComponentPackageReplacementTarget | null
>>
type ReplaceSpy = ReturnType<typeof vi.fn<
  (
    target: ComponentPackageReplacementTarget,
    packageData: ComponentPackageData,
  ) => ComponentPackageReplacementCommitResult
>>

const originalCaptureTarget =
  useEditorStore.getState().captureComponentPackageReplacementTarget
const originalReplaceAtTarget =
  useEditorStore.getState().replaceComponentPackageAtTarget

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function replacementFile(): OpenBinaryFileResult {
  return {
    path: 'test-fixtures/arch2-race-4.1.0.h5component',
    name: 'arch2-race-4.1.0.h5component',
    bytes: Uint8Array.from(REPLACEMENT_BYTES),
  }
}

function catalogFile(): ComponentCatalogPackageFile {
  return {
    sourceId: CATALOG_ENTRY.sourceId,
    sourceLabel: CATALOG_ENTRY.sourceLabel,
    sourceTrust: CATALOG_ENTRY.sourceTrust,
    packageId: PACKAGE_ID,
    version: REPLACEMENT_VERSION,
    sha256: REPLACEMENT_SHA256,
    name: 'arch2-race-4.1.0.h5component',
    bytes: Uint8Array.from(REPLACEMENT_BYTES),
  }
}

function componentApi(options: {
  selectComponentPackage?: () => Promise<OpenBinaryFileResult | null>
  readComponentCatalogPackage?: () => Promise<ComponentCatalogPackageFile>
} = {}): DesktopAPI & {
  selectComponentPackage: ReturnType<typeof vi.fn>
  readComponentCatalogPackage: ReturnType<typeof vi.fn>
} {
  const selectComponentPackage = vi.fn(
    options.selectComponentPackage ?? (async () => null),
  )
  const readComponentCatalogPackage = vi.fn(
    options.readComponentCatalogPackage
      ?? (async () => { throw new Error('not used') }),
  )
  return {
    openProject: vi.fn(async () => null),
    listRecentProjects: vi.fn(async () => []),
    openRecentProject: vi.fn(async () => { throw new Error('not used') }),
    saveProject: vi.fn(async () => null),
    writeRecoveryProject: vi.fn(async () => undefined),
    readRecoveryProject: vi.fn(async () => null),
    clearRecoveryProject: vi.fn(async () => undefined),
    selectImage: vi.fn(async () => null),
    selectImages: vi.fn(async () => null),
    selectAudio: vi.fn(async () => null),
    selectAudios: vi.fn(async () => null),
    selectVideo: vi.fn(async () => null),
    selectVideos: vi.fn(async () => null),
    selectComponentPackage,
    selectComponentPackages: vi.fn(async () => null),
    loadComponentCatalog: vi.fn(async () => CATALOG),
    selectComponentCatalogSource: vi.fn(async () => null),
    setComponentCatalogSourceTrust: vi.fn(async () => CATALOG),
    readComponentCatalogPackage,
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

function loadFixtureWithComponent(): void {
  const source = openCourseProjectArchive(new Uint8Array(readFileSync(FIXTURE_PATH)))
  useEditorStore.getState().loadCourseProject(
    source.project,
    null,
    source.assetFiles,
    componentPackagesFromArchive(source.project, source.componentFiles),
  )
  useEditorStore.getState().activateCourseLocation('slide-location-intro')
  const initialPackage = importComponentPackage(INITIAL_BYTES, {
    provenance: {
      sha256: INITIAL_PROVENANCE_SHA256,
      importedAt: '2026-08-24T00:00:00.000Z',
      sourceLabel: 'ARCH-2 初始包',
    },
  })
  useEditorStore.getState().importComponentPackage(initialPackage)
  useEditorStore.getState().addExternalComponentNode(PACKAGE_ID)
}

function activeProject(): CourseProjectDocument {
  const project = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!project) throw new Error('Expected an active Course Project V9')
  return project
}

function writeSnapshot(): ReplacementWriteSnapshot {
  const state = useEditorStore.getState()
  if (state.slideBackend?.kind !== 'slide-authoring') {
    throw new Error('Expected an active Slide authoring backend')
  }
  return structuredClone({
    project: activeProject(),
    componentPackages: state.componentPackages,
    activeHistory: state.slideBackend.getSession().history,
    storeHistory: state.history,
    sidecarPast: state.slideCandidateSidecarPast,
    sidecarFuture: state.slideCandidateSidecarFuture,
    componentPast: state.slideCandidateComponentPackagesPast,
    componentFuture: state.slideCandidateComponentPackagesFuture,
  })
}

function installTargetSpies(): {
  captureTarget: CaptureSpy
  replaceAtTarget: ReplaceSpy
} {
  const captureTarget: CaptureSpy = vi.fn((packageId: string) => (
    originalCaptureTarget(packageId)
  ))
  const replaceAtTarget: ReplaceSpy = vi.fn((target, packageData) => (
    originalReplaceAtTarget(target, packageData)
  ))
  useEditorStore.setState({
    captureComponentPackageReplacementTarget: captureTarget,
    replaceComponentPackageAtTarget: replaceAtTarget,
  })
  return { captureTarget, replaceAtTarget }
}

async function renderWithApi(api: DesktopAPI): Promise<void> {
  window.desktopAPI = api
  render(<App />)
  await waitFor(() => {
    expect(screen.getByTestId('replace-component-manually')).toBeVisible()
    expect(screen.getByTestId('update-component-from-catalog')).toBeVisible()
  })
}

async function resolveDeferred<T>(result: Deferred<T>, value: T): Promise<void> {
  await act(async () => {
    result.resolve(value)
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:arch2-component-race')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  loadFixtureWithComponent()
})

afterEach(() => {
  cleanup()
  useEditorStore.setState({
    captureComponentPackageReplacementTarget: originalCaptureTarget,
    replaceComponentPackageAtTarget: originalReplaceAtTarget,
  })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as Partial<Window>).desktopAPI
  useEditorStore.getState().clearV9SlideCandidateBackend()
})

describe('ARCH-2 App component-package replacement race', () => {
  it('captures the manual target before file selection and rejects the confirmed stale package without writes', async () => {
    const selection = deferred<OpenBinaryFileResult | null>()
    const api = componentApi({ selectComponentPackage: () => selection.promise })
    const { captureTarget, replaceAtTarget } = installTargetSpies()
    await renderWithApi(api)

    const beforeDialog = activeProject()
    fireEvent.click(screen.getByTestId('replace-component-manually'))
    await waitFor(() => expect(api.selectComponentPackage).toHaveBeenCalledOnce())

    expect(captureTarget).toHaveBeenCalledOnce()
    expect(captureTarget.mock.invocationCallOrder[0])
      .toBeLessThan(api.selectComponentPackage.mock.invocationCallOrder[0]!)
    expect(captureTarget.mock.results[0]?.value).toEqual({
      projectId: beforeDialog.id,
      documentRevision: beforeDialog.revision,
      packageId: PACKAGE_ID,
    })
    expect(screen.getByTestId('busy-state')).toBeDisabled()

    useEditorStore.getState().renameProject('ARCH-2 manual replacement intervening edit')
    const afterRename = writeSnapshot()
    await resolveDeferred(selection, replacementFile())
    await waitFor(() => expect(screen.getByRole('button', { name: '确认替换' })).toBeVisible())
    fireEvent.click(screen.getByRole('button', { name: '确认替换' }))

    await waitFor(() => {
      expect(useEditorStore.getState().errorMessage).toMatch(/revision.*失效/)
      expect(useEditorStore.getState().errorMessage).toMatch(/重新开始替换/)
    })
    expect(replaceAtTarget).toHaveBeenCalledOnce()
    expect(writeSnapshot()).toEqual(afterRename)
  })

  it('captures the catalog target before its deferred read and rejects a stale 4.1 package without writes', async () => {
    const catalogRead = deferred<ComponentCatalogPackageFile>()
    const api = componentApi({
      readComponentCatalogPackage: () => catalogRead.promise,
    })
    const { captureTarget, replaceAtTarget } = installTargetSpies()
    await renderWithApi(api)

    const beforeRead = activeProject()
    fireEvent.click(screen.getByTestId('update-component-from-catalog'))
    await waitFor(() => expect(screen.getByRole('button', { name: '确认更新' })).toBeVisible())
    fireEvent.click(screen.getByRole('button', { name: '确认更新' }))
    await waitFor(() => expect(api.readComponentCatalogPackage).toHaveBeenCalledOnce())

    expect(captureTarget).toHaveBeenCalledOnce()
    expect(captureTarget.mock.invocationCallOrder[0])
      .toBeLessThan(api.readComponentCatalogPackage.mock.invocationCallOrder[0]!)
    expect(captureTarget.mock.results[0]?.value).toEqual({
      projectId: beforeRead.id,
      documentRevision: beforeRead.revision,
      packageId: PACKAGE_ID,
    })
    expect(screen.getByTestId('busy-state')).toBeDisabled()

    useEditorStore.getState().renameProject('ARCH-2 catalog update intervening edit')
    const afterRename = writeSnapshot()
    await resolveDeferred(catalogRead, catalogFile())

    await waitFor(() => {
      expect(useEditorStore.getState().errorMessage).toMatch(/revision.*失效/)
      expect(useEditorStore.getState().errorMessage).toMatch(/刷新组件目录后重试/)
    })
    expect(replaceAtTarget).toHaveBeenCalledOnce()
    expect(writeSnapshot()).toEqual(afterRename)
  })

  it('routes a normal manual 4.1 replacement through replaceComponentPackageAtTarget once', async () => {
    const api = componentApi({
      selectComponentPackage: async () => replacementFile(),
    })
    const { captureTarget, replaceAtTarget } = installTargetSpies()
    await renderWithApi(api)
    const before = writeSnapshot()

    fireEvent.click(screen.getByTestId('replace-component-manually'))
    await waitFor(() => expect(screen.getByRole('button', { name: '确认替换' })).toBeVisible())
    fireEvent.click(screen.getByRole('button', { name: '确认替换' }))

    await waitFor(() => {
      expect(activeProject().componentPackages[PACKAGE_ID]?.version)
        .toBe(REPLACEMENT_VERSION)
    })
    const after = writeSnapshot()
    expect(captureTarget).toHaveBeenCalledOnce()
    expect(replaceAtTarget).toHaveBeenCalledOnce()
    expect(replaceAtTarget.mock.calls[0]?.[0]).toEqual(captureTarget.mock.results[0]?.value)
    expect(after.project.revision).toBe(before.project.revision + 1)
    expect(after.componentPackages[PACKAGE_ID]?.manifest.version)
      .toBe(REPLACEMENT_VERSION)
    expect(after.sidecarPast).toEqual(before.sidecarPast)
    expect(after.sidecarFuture).toEqual(before.sidecarFuture)
    expect(after.componentPast).toEqual(before.componentPast)
    expect(after.componentFuture).toEqual(before.componentFuture)
  })
})
