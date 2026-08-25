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

vi.mock('../../src/renderer/ui/coursePlayerTryRun', () => ({
  attachPublishedCourseStageFit: vi.fn(() => () => undefined),
  mountPublishedCourseTryRun: vi.fn(async () => ({
    destroy: async () => undefined,
  })),
}))

import App from '../../src/renderer/App'

const NOW = '2026-08-24T00:00:00.000Z'
const TEST_IMAGE = 'data:image/png;base64,AA=='
const EXPECTED_COMPLETENESS_ERROR =
  'PDF 导出不完整：未生成覆盖当前课程全部表面的 PDF 打印内容。\n' +
  '请检查混合打印计划后重试；为避免遗漏 Flow 或 Spatial 内容，本次未回退到旧版 Slide 快照。'
const EXPECTED_UNAVAILABLE_ERROR =
  'PDF 导出不可用：当前编辑会话没有可发布的 Course Project V9 文档。\n' +
  '请新建或重新打开受支持的课程工程后再试。'

type AppDesktopApi = DesktopAPI & {
  exportPdf: ReturnType<typeof vi.fn>
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
    const published = printArtifacts.calls.mock.calls[0]?.[0] as {
      courseId: string
      sourceSchemaVersion: number
      surfaces: Array<{ type: string }>
    }
    expect(published).toMatchObject({
      courseId: project.id,
      sourceSchemaVersion: 9,
    })
    expect(published.surfaces.map((surface) => surface.type)).toEqual([
      'slide',
      'flow',
      'spatial-2d',
    ])
    const html = api.exportPdf.mock.calls[0]?.[0].html as string
    expect(html).toContain('course-slide-print-page')
    expect(html).toContain('flow-print-document')
    expect(html).toContain('course-spatial-print-page')
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
    expect(printArtifacts.calls).not.toHaveBeenCalled()
    expect(sceneRenderers.legacy).not.toHaveBeenCalled()
    expect(api.exportPdf).not.toHaveBeenCalled()
  })

  it('retains the existing raster fallback for a pure-Slide course', async () => {
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
    expect(sceneRenderers.legacy).toHaveBeenCalledOnce()
    expect(sceneRenderers.legacy.mock.calls[0]?.[2]).toBe(1.5)
    expect(api.exportPdf.mock.calls[0]?.[0].html).toContain(TEST_IMAGE)
  })
})
