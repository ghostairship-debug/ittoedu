import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ConfirmProjectOpenInput,
  DesktopAPI,
  OpenProjectFileResult,
  RecentProjectEntry,
} from '@/shared/ipcTypes'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createCourseProjectArchive } from '@/renderer/project/courseProjectArchive'
import {
  selectActiveCourseProjectDocument,
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
    onOpen(): void
    recentProjects: RecentProjectEntry[]
    onOpenRecent(path: string): void
  }) => (
    <div>
      <button
        type="button"
        data-testid="open-project"
        disabled={props.busy}
        onClick={props.onOpen}
      >
        打开
      </button>
      {props.recentProjects[0] ? (
        <button
          type="button"
          data-testid="open-recent-project"
          disabled={props.busy}
          onClick={() => props.onOpenRecent(props.recentProjects[0]!.path)}
        >
          打开最近工程
        </button>
      ) : null}
    </div>
  ),
}))

vi.mock('@/renderer/export/loadPlayerBundle', () => ({
  loadPlayerBundle: () => '/* recent project confirmation test player */',
}))

vi.mock('@/renderer/ui/coursePlayerTryRun', () => ({
  attachPublishedCourseStageFit: vi.fn(() => () => undefined),
  mountPublishedCourseTryRun: vi.fn(async () => ({ destroy: async () => undefined })),
}))

import App from '@/renderer/App'

const NOW = '2026-08-28T00:00:00.000Z'

interface DesktopHarness {
  api: DesktopAPI
  openProject: ReturnType<typeof vi.fn>
  openRecentProject: ReturnType<typeof vi.fn>
  confirmProjectOpen: ReturnType<typeof vi.fn>
  clearRecoveryProject: ReturnType<typeof vi.fn>
  listRecentProjects: ReturnType<typeof vi.fn>
}

interface DesktopHarnessOptions {
  selected?: OpenProjectFileResult | null
  recent?: RecentProjectEntry[]
  recentResult?: OpenProjectFileResult
  confirm?: (input: ConfirmProjectOpenInput) => Promise<void>
}

function desktopHarness(options: DesktopHarnessOptions = {}): DesktopHarness {
  const openProject = vi.fn(async () => options.selected ?? null)
  const openRecentProject = vi.fn(async () => {
    if (!options.recentResult) throw new Error('recent project result not configured')
    return options.recentResult
  })
  const confirmProjectOpen = vi.fn(
    options.confirm ?? (async () => undefined),
  )
  const clearRecoveryProject = vi.fn(async () => undefined)
  const listRecentProjects = vi.fn(async () => options.recent ?? [])
  const api: DesktopAPI = {
    openProject,
    listRecentProjects,
    openRecentProject,
    confirmProjectOpen,
    saveProject: vi.fn(async () => null),
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
    setComponentCatalogSourceTrust: vi.fn(async () => ({
      sources: [],
      packages: [],
      issues: [],
    })),
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
  return {
    api,
    openProject,
    openRecentProject,
    confirmProjectOpen,
    clearRecoveryProject,
    listRecentProjects,
  }
}

function projectFile(
  path: string,
  bytes: Uint8Array,
  confirmationId: string,
): OpenProjectFileResult {
  return {
    path,
    name: path.split(/[\\/]/u).at(-1) ?? path,
    bytes,
    confirmationId,
  }
}

function blankProject(id: string, title: string) {
  return createBlankCourseProject({ id, title, now: NOW })
}

function validArchive(id: string, title: string): Uint8Array {
  return createCourseProjectArchive({
    project: blankProject(id, title),
    assetFiles: {},
    componentFiles: {},
  }, { mtime: NOW })
}

function schemaInvalidArchive(): Uint8Array {
  return zipSync({
    'project.json': strToU8(JSON.stringify({
      ...blankProject('schema-invalid', '字段无效'),
      title: 42,
    })),
  })
}

function missingAssetArchive(): Uint8Array {
  const project = blankProject('missing-asset', '缺失素材')
  const bytes = new Uint8Array([137, 80, 78, 71])
  project.assets.diagram = {
    id: 'diagram',
    filename: 'diagram.png',
    mimeType: 'image/png',
    kind: 'image',
    path: 'assets/diagram.bin',
    byteLength: bytes.byteLength,
    width: 1,
    height: 1,
  }
  const files = unzipSync(createCourseProjectArchive({
    project,
    assetFiles: { diagram: bytes },
    componentFiles: {},
  }, { mtime: NOW }))
  delete files['assets/diagram.bin']
  return zipSync(files)
}

function unsupportedArchive(): Uint8Array {
  return zipSync({
    'project.json': strToU8(JSON.stringify({
      ...blankProject('unsupported', '不支持的版本'),
      schemaVersion: 10,
    })),
  })
}

function activeCourseId(): string | null {
  return selectActiveCourseProjectDocument(useEditorStore.getState())?.id ?? null
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  useEditorStore.getState().createNewProject()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as Partial<Window>).desktopAPI
  useEditorStore.getState().createNewProject()
})

describe('App project-open confirmation sequencing', () => {
  it.each([
    ['schema-invalid', schemaInvalidArchive, /project\.json 校验失败/u],
    ['missing-asset', missingAssetArchive, /缺少素材/u],
    ['unsupported', unsupportedArchive, /版本不支持|格式版本为 10/u],
  ])('%s 普通打开失败时不确认或应用候选工程', async (
    label,
    buildArchive,
    expectedError,
  ) => {
    const baselineId = activeCourseId()
    const harness = desktopHarness({
      selected: projectFile(
        `C:\\fixtures\\${label}.h5lesson`,
        buildArchive(),
        '00000000-0000-4000-8000-000000000001',
      ),
    })
    window.desktopAPI = harness.api
    render(<App />)

    fireEvent.click(screen.getByTestId('open-project'))
    await waitFor(() => {
      expect(useEditorStore.getState().errorMessage).toMatch(expectedError)
    })

    expect(activeCourseId()).toBe(baselineId)
    expect(useEditorStore.getState().projectPath).toBeNull()
    expect(harness.confirmProjectOpen).not.toHaveBeenCalled()
    expect(harness.clearRecoveryProject).not.toHaveBeenCalled()
  })

  it('合法工程先完整应用到 Store，再确认、清恢复和刷新最近列表', async () => {
    const path = 'C:\\fixtures\\valid.h5lesson'
    const confirmationId = '00000000-0000-4000-8000-000000000002'
    let courseIdAtConfirmation: string | null = null
    let pathAtConfirmation: string | null = null
    const harness = desktopHarness({
      selected: projectFile(path, validArchive('opened-valid', '合法打开'), confirmationId),
      confirm: async () => {
        courseIdAtConfirmation = activeCourseId()
        pathAtConfirmation = useEditorStore.getState().projectPath
      },
    })
    window.desktopAPI = harness.api
    render(<App />)
    await waitFor(() => expect(harness.listRecentProjects).toHaveBeenCalled())
    harness.listRecentProjects.mockClear()

    fireEvent.click(screen.getByTestId('open-project'))
    await waitFor(() => expect(harness.confirmProjectOpen).toHaveBeenCalledOnce())
    await waitFor(() => expect(harness.listRecentProjects).toHaveBeenCalledOnce())

    expect(harness.confirmProjectOpen).toHaveBeenCalledWith({ confirmationId })
    expect(courseIdAtConfirmation).toBe('opened-valid')
    expect(pathAtConfirmation).toBe(path)
    expect(activeCourseId()).toBe('opened-valid')
    expect(useEditorStore.getState().projectPath).toBe(path)
    expect(harness.clearRecoveryProject).toHaveBeenCalledOnce()
    expect(harness.confirmProjectOpen.mock.invocationCallOrder[0]).toBeLessThan(
      harness.clearRecoveryProject.mock.invocationCallOrder[0]!,
    )
    expect(harness.clearRecoveryProject.mock.invocationCallOrder[0]).toBeLessThan(
      harness.listRecentProjects.mock.invocationCallOrder[0]!,
    )
    expect(useEditorStore.getState().errorMessage).toBeNull()
  })

  it('最近列表确认回执失败不把已应用的合法工程报成打开失败', async () => {
    const path = 'C:\\fixtures\\ack-failure.h5lesson'
    const harness = desktopHarness({
      selected: projectFile(
        path,
        validArchive('ack-failure-opened', '回执失败仍已打开'),
        '00000000-0000-4000-8000-000000000003',
      ),
      confirm: async () => { throw new Error('recent persistence unavailable') },
    })
    window.desktopAPI = harness.api
    render(<App />)
    await waitFor(() => expect(harness.listRecentProjects).toHaveBeenCalled())
    harness.listRecentProjects.mockClear()

    fireEvent.click(screen.getByTestId('open-project'))
    await waitFor(() => expect(harness.clearRecoveryProject).toHaveBeenCalledOnce())
    await waitFor(() => expect(harness.listRecentProjects).toHaveBeenCalledOnce())

    expect(activeCourseId()).toBe('ack-failure-opened')
    expect(useEditorStore.getState().projectPath).toBe(path)
    expect(useEditorStore.getState().errorMessage).toBeNull()
  })

  it('失败的 recent reopen 不确认或提升旧记录', async () => {
    const path = 'C:\\fixtures\\invalid-recent.h5lesson'
    const recent = [{ path, name: 'invalid-recent.h5lesson', lastOpenedAt: 123 }]
    const baselineId = activeCourseId()
    const harness = desktopHarness({
      recent,
      recentResult: projectFile(
        path,
        missingAssetArchive(),
        '00000000-0000-4000-8000-000000000004',
      ),
    })
    window.desktopAPI = harness.api
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('open-recent-project')).toBeTruthy())

    fireEvent.click(screen.getByTestId('open-recent-project'))
    await waitFor(() => {
      expect(useEditorStore.getState().errorMessage).toMatch(/缺少素材/u)
    })

    expect(harness.openRecentProject).toHaveBeenCalledWith({ path })
    expect(activeCourseId()).toBe(baselineId)
    expect(harness.confirmProjectOpen).not.toHaveBeenCalled()
    expect(harness.clearRecoveryProject).not.toHaveBeenCalled()
    expect(harness.listRecentProjects).toHaveBeenCalledOnce()
  })

  it('合法 recent reopen 完整应用后只确认对应打开候选', async () => {
    const path = 'C:\\fixtures\\valid-recent.h5lesson'
    const confirmationId = '00000000-0000-4000-8000-000000000005'
    const recent = [{ path, name: 'valid-recent.h5lesson', lastOpenedAt: 456 }]
    let courseIdAtConfirmation: string | null = null
    let pathAtConfirmation: string | null = null
    const harness = desktopHarness({
      recent,
      recentResult: projectFile(
        path,
        validArchive('opened-recent', '合法最近工程'),
        confirmationId,
      ),
      confirm: async () => {
        courseIdAtConfirmation = activeCourseId()
        pathAtConfirmation = useEditorStore.getState().projectPath
      },
    })
    window.desktopAPI = harness.api
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('open-recent-project')).toBeTruthy())
    harness.listRecentProjects.mockClear()

    fireEvent.click(screen.getByTestId('open-recent-project'))
    await waitFor(() => expect(harness.confirmProjectOpen).toHaveBeenCalledOnce())
    await waitFor(() => expect(harness.listRecentProjects).toHaveBeenCalledOnce())

    expect(harness.openRecentProject).toHaveBeenCalledWith({ path })
    expect(harness.confirmProjectOpen).toHaveBeenCalledWith({ confirmationId })
    expect(courseIdAtConfirmation).toBe('opened-recent')
    expect(pathAtConfirmation).toBe(path)
    expect(activeCourseId()).toBe('opened-recent')
    expect(useEditorStore.getState().projectPath).toBe(path)
    expect(harness.clearRecoveryProject).toHaveBeenCalledOnce()
    expect(useEditorStore.getState().errorMessage).toBeNull()
  })
})
