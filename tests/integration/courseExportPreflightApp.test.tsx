import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopAPI } from '../../src/shared/ipcTypes'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { useEditorStore } from '../../src/renderer/store/editorStore'

const legacyPreflight = vi.hoisted(() => ({
  called: vi.fn<(...args: unknown[]) => void>(),
}))

vi.mock('../../src/renderer/export/exportPreflight', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/export/exportPreflight')>()
  return {
    ...actual,
    collectExportPreflight: (...args: Parameters<typeof actual.collectExportPreflight>) => {
      legacyPreflight.called(...args)
      return actual.collectExportPreflight(...args)
    },
  }
})

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
  RightSidebar: () => null,
}))

vi.mock('../../src/renderer/ui/TopToolbar', () => ({
  TopToolbar: (props: {
    onExport(format: 'single-html' | 'web-package'): void
  }) => (
    <div>
      <button
        type="button"
        data-testid="export-single-html"
        onClick={() => props.onExport('single-html')}
      >
        HTML
      </button>
      <button
        type="button"
        data-testid="export-web-package"
        onClick={() => props.onExport('web-package')}
      >
        WEB
      </button>
    </div>
  ),
}))

vi.mock('../../src/renderer/export/loadPlayerBundle', () => ({
  loadPlayerBundle: () => '/* ARCH-4 V9 preflight player bundle */',
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

const NOW = '2026-08-24T00:00:00.000Z'

type AppDesktopApi = DesktopAPI & {
  exportBinary: ReturnType<typeof vi.fn>
  exportHtml: ReturnType<typeof vi.fn>
  exportWebPackage: ReturnType<typeof vi.fn>
}

function appApi(): AppDesktopApi {
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
    openPreview: vi.fn(async () => undefined),
    confirmDiscardChanges: vi.fn(async () => 'discard' as const),
    setDirtyState: vi.fn(async () => undefined),
    onRequestSave: vi.fn(() => () => undefined),
    onRequestSaveAndClose: vi.fn(() => () => undefined),
    reportDiagnostic: vi.fn(async () => undefined),
    exportDiagnostics: vi.fn(async () => null),
  }
}

function loadCourseWithMissingBackgroundBytes() {
  const project = createBlankCourseProject({
    now: NOW,
    includeDefaultController: false,
    controls: 'none',
  })
  project.assets.hero = {
    id: 'hero',
    filename: 'hero.png',
    mimeType: 'image/png',
    kind: 'image',
    path: 'assets/hero.png',
    byteLength: 4,
    width: 100,
    height: 100,
  }
  const slide = project.surfaces.find((surface) => surface.type === 'slide')
  if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
  slide.scenes[0]!.backgroundAssetId = 'hero'
  useEditorStore.getState().loadCourseProject(project, null, {}, {})
  useEditorStore.getState().activateCourseLocation(project.startLocationId)
  return project
}

function savedReport(api: AppDesktopApi) {
  const input = api.exportBinary.mock.calls[0]?.[0]
  if (!input) throw new Error('expected saved preflight report')
  return JSON.parse(new TextDecoder().decode(input.bytes)) as {
    reportVersion: number
    projectId: string
    schemaVersion: number
    target: string
    items: Array<{ code: string; severity: string }>
    summary: { canExport: boolean }
  }
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  legacyPreflight.called.mockClear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as Partial<Window>).desktopAPI
  useEditorStore.getState().clearV9SlideCandidateBackend()
})

describe('ARCH-4 V9 HTML/Web export preflight', () => {
  it.each([
    ['single-html', '单 HTML', 'export-single-html'],
    ['web-package', '网页包', 'export-web-package'],
  ] as const)('uses only V9 preflight for %s and saves schema 9', async (
    target,
    label,
    button,
  ) => {
    const project = loadCourseWithMissingBackgroundBytes()
    const api = appApi()
    window.desktopAPI = api
    render(<App />)

    fireEvent.click(screen.getByTestId(button))

    expect(await screen.findByRole('alertdialog', {
      name: `${label} 导出预检`,
    })).toBeVisible()
    expect(screen.getByText('asset-bytes-missing')).toBeVisible()
    expect(screen.getByText(/hero\.png/)).toBeVisible()
    expect(screen.queryByRole('button', { name: '继续导出' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '去修复' })).toBeVisible()
    expect(legacyPreflight.called).not.toHaveBeenCalled()
    expect(api.exportHtml).not.toHaveBeenCalled()
    expect(api.exportWebPackage).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /保存报告/ }))
    await waitFor(() => expect(api.exportBinary).toHaveBeenCalledOnce())

    const report = savedReport(api)
    expect(report).toMatchObject({
      reportVersion: 1,
      projectId: project.id,
      schemaVersion: 9,
      target,
      summary: { canExport: false },
    })
    expect(report.items).toContainEqual(expect.objectContaining({
      code: 'asset-bytes-missing',
      severity: 'error',
    }))
  })
})
