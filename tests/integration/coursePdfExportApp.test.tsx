import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopAPI } from '../../src/shared/ipcTypes'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import {
  addCourseFlowPage,
  addCourseSpatialPage,
} from '../../src/renderer/course/courseLocationCommands'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { createBlankFlowCourseProject } from '../../src/renderer/project/createFlowCourseProject'
import { useEditorStore } from '../../src/renderer/store/editorStore'

const printArtifacts = vi.hoisted(() => ({
  calls: vi.fn<(...args: unknown[]) => void>(),
  omitPdfHtml: false,
}))

const publishSourceProbe = vi.hoisted(() => ({ forceUnavailable: false }))

const sceneRenderers = vi.hoisted(() => ({
  legacy: vi.fn(),
}))

const v2PrintCapture = vi.hoisted(() => ({
  create: vi.fn(),
  capturePage: vi.fn(),
  destroy: vi.fn(),
}))

vi.mock('../../src/renderer/store/editorStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/store/editorStore')>()
  return {
    ...actual,
    selectActiveCourseProjectDocument: (
      state: Parameters<typeof actual.selectActiveCourseProjectDocument>[0],
    ) => publishSourceProbe.forceUnavailable
      ? null
      : actual.selectActiveCourseProjectDocument(state),
  }
})

vi.mock(
  '../../src/renderer/export/course/buildCoursePrintArtifacts',
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import('../../src/renderer/export/course/buildCoursePrintArtifacts')
    >()
    return {
      ...actual,
      buildCoursePrintArtifacts: async (
        ...args: Parameters<typeof actual.buildCoursePrintArtifacts>
      ) => {
        printArtifacts.calls(...args)
        const result = await actual.buildCoursePrintArtifacts(...args)
        return printArtifacts.omitPdfHtml
          ? {
              ...result,
              files: result.files.filter((file) => file.kind !== 'pdf-html'),
            }
          : result
      },
    }
  },
)

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
  TopToolbar: (props: { onExport(format: 'pdf'): void }) => (
    <button
      type="button"
      data-testid="export-pdf"
      onClick={() => props.onExport('pdf')}
    >
      PDF
    </button>
  ),
}))

vi.mock('../../src/renderer/export/loadPlayerBundle', () => ({
  loadPlayerBundle: () => '/* ARCH-4 PDF integration player bundle */',
}))

vi.mock('../../src/renderer/export/renderSceneImages', () => ({
  renderProjectSceneImages: sceneRenderers.legacy,
}))

vi.mock('../../src/renderer/export/playerCapture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/export/playerCapture')>()
  return {
    ...actual,
    createPublishedCourseV2PrintCaptureSession: v2PrintCapture.create,
  }
})

vi.mock('../../src/renderer/ui/coursePlayerTryRun', () => ({
  attachPublishedCourseStageFit: vi.fn(() => () => undefined),
  mountPublishedCourseTryRun: vi.fn(async () => ({
    destroy: async () => undefined,
  })),
}))

import App from '../../src/renderer/App'

const NOW = '2026-08-24T00:00:00.000Z'
const TEST_IMAGE = 'data:image/png;base64,AA=='
const SPATIAL_TEST_IMAGE = 'data:image/png;base64,AQ=='
const EXPECTED_COMPLETENESS_ERROR =
  'PDF 导出不完整：Published Course V2 未生成覆盖当前课程全部表面的 PDF 打印内容。\n' +
  '请检查导出预检与混合打印计划后重试；本次不会回退到旧版 V8 Slide 快照。'
const EXPECTED_UNAVAILABLE_ERROR =
  'PDF 导出不可用：当前编辑会话没有可发布的 Course Project V9 文档。\n' +
  '请新建或重新打开受支持的课程工程后再试。'

type AppDesktopApi = DesktopAPI & {
  exportPdf: ReturnType<typeof vi.fn>
}

function surfaceCapture(content: string, width: number, height: number) {
  return {
    format: 'data-url' as const,
    content,
    width,
    height,
    warnings: [],
  }
}

function captureForRequest(request: { width?: number; height?: number }) {
  const isSpatial = request.width === 1120 && request.height === 760
  return surfaceCapture(
    isSpatial ? SPATIAL_TEST_IMAGE : TEST_IMAGE,
    request.width ?? 1280,
    request.height ?? 720,
  )
}

function appApi(): AppDesktopApi {
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
    exportPdf: vi.fn(async () => ({ path: 'C:\\exports\\course.pdf' })),
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

function requireProject(
  result: ReturnType<typeof addCourseFlowPage> | ReturnType<typeof addCourseSpatialPage>,
): CourseProjectDocument {
  if (!result.ok) throw new Error(result.reason)
  return result.project
}

function mixedCourseProject(): CourseProjectDocument {
  let project = createBlankCourseProject({
    now: NOW,
    includeDefaultController: false,
    controls: 'none',
  })
  project = requireProject(addCourseFlowPage(project, {
    now: NOW,
    expectedRevision: project.revision,
    title: '阅读任务',
  }))
  project = requireProject(addCourseSpatialPage(project, {
    now: NOW,
    expectedRevision: project.revision,
    title: '概念地图',
  }))
  return project
}

function loadCourse(project: CourseProjectDocument): void {
  useEditorStore.getState().loadCourseProject(project, null, {}, {})
  useEditorStore.getState().activateCourseLocation(project.startLocationId)
}

async function continuePdfExport(): Promise<void> {
  fireEvent.click(screen.getByTestId('export-pdf'))
  const dialog = await screen.findByRole('alertdialog', {
    name: 'PDF 导出预检',
  })
  fireEvent.click(within(dialog).getByRole('button', { name: '继续导出' }))
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  printArtifacts.calls.mockClear()
  printArtifacts.omitPdfHtml = false
  publishSourceProbe.forceUnavailable = false
  sceneRenderers.legacy.mockReset().mockResolvedValue([TEST_IMAGE])
  v2PrintCapture.capturePage.mockReset().mockImplementation(captureForRequest)
  v2PrintCapture.destroy.mockReset().mockResolvedValue(undefined)
  v2PrintCapture.create.mockReset().mockResolvedValue({
    capturePage: v2PrintCapture.capturePage,
    destroy: v2PrintCapture.destroy,
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as Partial<Window>).desktopAPI
  useEditorStore.getState().clearV9SlideCandidateBackend()
})

describe('ARCH-4 V9 PDF export completeness', () => {
  it('exports complete Published PDF HTML for a Mixed course without V8 raster', async () => {
    const project = mixedCourseProject()
    loadCourse(project)
    const api = appApi()
    window.desktopAPI = api
    render(<App />)

    await continuePdfExport()

    await waitFor(() => expect(api.exportPdf).toHaveBeenCalledOnce())
    const sources = printArtifacts.calls.mock.calls[0]?.[0] as {
      project: { id: string; schemaVersion: number; surfaces: Array<{ type: string }> }
      assetFiles: unknown
      components: unknown
    }
    expect(sources.project).toMatchObject({
      id: project.id,
      schemaVersion: 9,
    })
    expect(sources.project.surfaces.map((surface) => surface.type)).toEqual([
      'slide',
      'flow',
      'spatial-2d',
    ])
    expect(printArtifacts.calls.mock.calls[0]?.[1]).toBeUndefined()
    expect(v2PrintCapture.create).toHaveBeenCalledOnce()
    expect(v2PrintCapture.create).toHaveBeenCalledWith(expect.objectContaining({
      includeGlobalLayerItems: false,
    }))
    expect(v2PrintCapture.capturePage).toHaveBeenCalledTimes(2)
    expect(v2PrintCapture.capturePage.mock.calls.map((call) => call[0])).toEqual([
      expect.objectContaining({ width: 1280, height: 720 }),
      expect.objectContaining({ width: 1120, height: 760 }),
    ])
    const html = api.exportPdf.mock.calls[0]?.[0].html as string
    expect(html).toContain('course-slide-print-page')
    expect(html).toContain('data-published-v2-capture="true"')
    expect(html).toContain(TEST_IMAGE)
    expect(html).toContain(SPATIAL_TEST_IMAGE)
    expect(html).toContain('data-capture-width="1280" data-capture-height="720"')
    expect(html).toContain('data-capture-width="1120" data-capture-height="760"')
    expect(html).toContain('object-fit:contain')
    expect(html).toContain('flow-print-document')
    expect(html).toContain('course-spatial-print-page')
    expect([
      ...html.matchAll(/<section class="page ([^"]+)"/g),
    ].map((match) => match[1])).toEqual([
      'course-visual-print-page course-slide-print-page',
      'flow-print-document',
      'course-visual-print-page course-spatial-print-page',
    ])
    expect(sceneRenderers.legacy).not.toHaveBeenCalled()
  })

  it('fails closed when a non-pure-Slide course has no complete PDF artifact', async () => {
    const project = createBlankFlowCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    loadCourse(project)
    printArtifacts.omitPdfHtml = true
    const api = appApi()
    window.desktopAPI = api
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<App />)

    await continuePdfExport()

    await waitFor(() => {
      expect(useEditorStore.getState().errorMessage).toBe(EXPECTED_COMPLETENESS_ERROR)
    })
    expect(sceneRenderers.legacy).not.toHaveBeenCalled()
    expect(api.exportPdf).not.toHaveBeenCalled()
  })

  it('fails closed when the V9 publish source disappears after preflight', async () => {
    const project = createBlankCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    loadCourse(project)
    const api = appApi()
    window.desktopAPI = api
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<App />)

    fireEvent.click(screen.getByTestId('export-pdf'))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'PDF 导出预检',
    })
    publishSourceProbe.forceUnavailable = true
    fireEvent.click(within(dialog).getByRole('button', { name: '继续导出' }))

    await waitFor(() => {
      expect(useEditorStore.getState().errorMessage).toBe(EXPECTED_UNAVAILABLE_ERROR)
    })
    expect(useEditorStore.getState().statusMessage).not.toBe('正在渲染 PDF 页面…')
    expect(printArtifacts.calls).not.toHaveBeenCalled()
    expect(sceneRenderers.legacy).not.toHaveBeenCalled()
    expect(api.exportPdf).not.toHaveBeenCalled()
  })

  it('captures a pure-Slide course through the inert Published host without V8 raster', async () => {
    const project = createBlankCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    loadCourse(project)
    const api = appApi()
    window.desktopAPI = api
    render(<App />)

    await continuePdfExport()

    await waitFor(() => expect(api.exportPdf).toHaveBeenCalledOnce())
    expect(printArtifacts.calls.mock.calls[0]?.[1]).toBeUndefined()
    expect(v2PrintCapture.create).toHaveBeenCalledOnce()
    expect(v2PrintCapture.capturePage).toHaveBeenCalledOnce()
    expect(v2PrintCapture.destroy).toHaveBeenCalledOnce()
    expect(sceneRenderers.legacy).not.toHaveBeenCalled()
    expect(api.exportPdf.mock.calls[0]?.[0].html).toContain(TEST_IMAGE)
  })

  it('shows a Spatial Published capture cause and writes no partial PDF', async () => {
    const project = mixedCourseProject()
    loadCourse(project)
    v2PrintCapture.capturePage.mockImplementation((request: {
      width?: number
      height?: number
    }) => {
      if (request.width === 1120 && request.height === 760) {
        throw new Error('spatial snapshot decoder failed')
      }
      return captureForRequest(request)
    })
    const api = appApi()
    window.desktopAPI = api
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<App />)

    await continuePdfExport()

    await waitFor(() => {
      expect(useEditorStore.getState().errorMessage).toContain('spatial snapshot decoder failed')
    })
    expect(v2PrintCapture.capturePage).toHaveBeenCalledTimes(2)
    expect(api.exportPdf).not.toHaveBeenCalled()
    expect(v2PrintCapture.destroy).toHaveBeenCalledOnce()
    expect(sceneRenderers.legacy).not.toHaveBeenCalled()
  })

  it('fails closed for sessionless PDF without V8 Project preflight', async () => {
    const project = createBlankCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    loadCourse(project)
    publishSourceProbe.forceUnavailable = true
    const api = appApi()
    window.desktopAPI = api
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<App />)

    fireEvent.click(screen.getByTestId('export-pdf'))

    await waitFor(() => {
      expect(useEditorStore.getState().errorMessage).toBe(EXPECTED_UNAVAILABLE_ERROR)
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(printArtifacts.calls).not.toHaveBeenCalled()
    expect(v2PrintCapture.create).not.toHaveBeenCalled()
    expect(sceneRenderers.legacy).not.toHaveBeenCalled()
    expect(api.exportPdf).not.toHaveBeenCalled()
  })
})
