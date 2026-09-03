import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopAPI } from '../../src/shared/ipcTypes'
import type { RuntimeLayerItem } from '../../src/shared/courseProjectTypes'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import {
  selectActiveCourseProjectDocument,
  useEditorStore,
} from '../../src/renderer/store/editorStore'

const sizeProbe = vi.hoisted(() => ({ forceWarning: false }))

const fontProbe = vi.hoisted(() => ({ gate: null as Promise<void> | null }))

const publishSourceProbe = vi.hoisted(() => ({ forceUnavailable: false }))

const deliveryProbe = vi.hoisted(() => ({
  publishedStandalone: vi.fn(),
  publishedWebPackage: vi.fn(),
}))

const publishedPreviewProbe = vi.hoisted(() => ({
  mount: vi.fn(async (_input: unknown) => ({
    destroy: async () => undefined,
  })),
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

vi.mock('../../src/renderer/export/course/buildCoursePackages', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/renderer/export/course/buildCoursePackages')
  >()
  return {
    ...actual,
    buildPublishedCourseStandaloneHtml: (
      ...args: Parameters<typeof actual.buildPublishedCourseStandaloneHtml>
    ) => {
      deliveryProbe.publishedStandalone(...args)
      return actual.buildPublishedCourseStandaloneHtml(...args)
    },
    buildPublishedCourseWebPackageAsync: (
      ...args: Parameters<typeof actual.buildPublishedCourseWebPackageAsync>
    ) => {
      deliveryProbe.publishedWebPackage(...args)
      return actual.buildPublishedCourseWebPackageAsync(...args)
    },
  }
})

vi.mock('../../src/renderer/export/exportSize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/export/exportSize')>()
  return {
    ...actual,
    utf8ByteLength: (value: string) => sizeProbe.forceWarning
      ? actual.SINGLE_HTML_WARNING_BYTES + 1
      : actual.utf8ByteLength(value),
  }
})

vi.mock('../../src/renderer/export/bundledFontEmbedding', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/renderer/export/bundledFontEmbedding')
  >()
  return {
    ...actual,
    prepareBundledFontEmbedding: async () => {
      if (fontProbe.gate) await fontProbe.gate
      return actual.prepareBundledFontEmbedding()
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
    onPreview(): void
    onExport(
      format: 'single-html' | 'web-package',
      singleHtmlMode?: 'offline-portable' | 'online-lightweight',
    ): void
  }) => (
    <div>
      <button
        type="button"
        data-testid="preview-full-course"
        onClick={() => props.onPreview()}
      >
        PREVIEW
      </button>
      <button
        type="button"
        data-testid="export-single-html"
        onClick={() => props.onExport('single-html')}
      >
        HTML
      </button>
      <button
        type="button"
        data-testid="export-single-html-online"
        onClick={() => props.onExport('single-html', 'online-lightweight')}
      >
        ONLINE HTML
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
}))

vi.mock('../../src/renderer/ui/coursePlayerTryRun', () => ({
  attachPublishedCourseStageFit: vi.fn(() => () => undefined),
  mountPublishedCourseTryRun: publishedPreviewProbe.mount,
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

function loadBlankCourse() {
  const project = createBlankCourseProject({
    now: NOW,
    includeDefaultController: false,
    controls: 'none',
  })
  useEditorStore.getState().loadCourseProject(project, null, {}, {})
  useEditorStore.getState().activateCourseLocation(project.startLocationId)
  return project
}

function loadCourseWithRemoteBackground(
  remoteUrl = 'https://cdn.example.com/course/hero.png?v=2',
) {
  const project = createBlankCourseProject({
    now: NOW,
    includeDefaultController: false,
    controls: 'none',
  })
  const bytes = new Uint8Array([1, 2, 3, 4])
  project.assets.hero = {
    id: 'hero',
    filename: 'hero.png',
    mimeType: 'image/png',
    kind: 'image',
    path: 'assets/hero.png',
    byteLength: bytes.byteLength,
    width: 100,
    height: 100,
    remote: { url: remoteUrl },
  }
  project.network = { connectOrigins: ['https://api.example.com'] }
  const slide = project.surfaces.find((surface) => surface.type === 'slide')
  if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
  slide.scenes[0]!.backgroundAssetId = 'hero'
  useEditorStore.getState().loadCourseProject(project, null, { hero: bytes }, {})
  useEditorStore.getState().activateCourseLocation(project.startLocationId)
  return project
}

function loadCourseWithNetworkRuntime(
  source: string,
  connectOrigins: string[] = [],
) {
  const project = createBlankCourseProject({
    now: NOW,
    includeDefaultController: false,
    controls: 'none',
  })
  project.network = { connectOrigins }
  const slide = project.surfaces.find((surface) => surface.type === 'slide')
  if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
  const runtime: RuntimeLayerItem = {
    kind: 'runtime',
    layerItemId: 'online-network-runtime',
    label: '在线网络 Runtime',
    frame: { mode: 'absolute', x: 20, y: 20, width: 320, height: 180 },
    order: 0,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    runtime: {
      protocol: 'canvas-runtime',
      runtimeApiVersion: 2,
      enabled: true,
      renderMode: 'dom',
      source,
      content: { values: {} },
      assets: {},
    },
  }
  slide.scenes[0]!.layerItems.push(runtime)
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
  sizeProbe.forceWarning = false
  fontProbe.gate = null
  publishSourceProbe.forceUnavailable = false
  deliveryProbe.publishedStandalone.mockClear()
  deliveryProbe.publishedWebPackage.mockClear()
  publishedPreviewProbe.mount.mockClear()
  publishedPreviewProbe.mount.mockImplementation(async (_input: unknown) => ({
    destroy: async () => undefined,
  }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as Partial<Window>).desktopAPI
  useEditorStore.getState().clearV9SlideCandidateBackend()
})

describe('ARCH-4 V9 HTML/Web export preflight', () => {
  it('App and delivery modules do not import leftover V8 HTML/Web producers', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
    const app = readFileSync(join(root, 'src/renderer/App.tsx'), 'utf8')
    const delivery = readFileSync(join(root, 'src/renderer/app/useCourseDelivery.ts'), 'utf8')
    for (const source of [app, delivery]) {
      expect(source).not.toMatch(/buildStandaloneHtml/)
      expect(source).not.toMatch(/from ['"][^'"]*\/buildWebPackage['"]/)
      expect(source).not.toMatch(/\bcollectExportPreflight\b/)
    }
  })

  it('opens full preview through the renderer Published V2 session', async () => {
    const project = loadBlankCourse()
    const api = appApi()
    window.desktopAPI = api
    render(<App />)

    fireEvent.click(screen.getByTestId('preview-full-course'))

    expect(await screen.findByRole('dialog', { name: '整课预览' })).toBeVisible()
    await waitFor(() => expect(publishedPreviewProbe.mount).toHaveBeenCalledOnce())
    expect(publishedPreviewProbe.mount.mock.calls[0]?.[0]).toMatchObject({
      project: {
        id: project.id,
        schemaVersion: 9,
      },
    })
  })

  it.each([
    ['preview-full-course', '整课预览不可用'],
    ['export-single-html', '单 HTML 导出不可用'],
    ['export-web-package', '网页包导出不可用'],
  ] as const)('reports source-null as unavailable for %s without a Legacy fallback', async (
    button,
    title,
  ) => {
    loadBlankCourse()
    publishSourceProbe.forceUnavailable = true
    const api = appApi()
    window.desktopAPI = api
    render(<App />)

    fireEvent.click(screen.getByTestId(button))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(title)
    expect(alert).toHaveTextContent('当前编辑会话没有可发布的 Course Project V9 文档')
    expect(screen.queryByTestId('course-preview-overlay')).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(publishedPreviewProbe.mount).not.toHaveBeenCalled()
    expect(api.exportHtml).not.toHaveBeenCalled()
    expect(api.exportWebPackage).not.toHaveBeenCalled()
  })

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

  it.each([
    ['export-single-html', '单 HTML 导出不可用'],
    ['export-web-package', '网页包导出不可用'],
  ] as const)('fails explicitly when V9 sources disappear after %s preflight', async (
    button,
    title,
  ) => {
    loadBlankCourse()
    const api = appApi()
    window.desktopAPI = api
    render(<App />)

    fireEvent.click(screen.getByTestId(button))
    expect(await screen.findByRole('alertdialog')).toBeVisible()

    publishSourceProbe.forceUnavailable = true
    fireEvent.click(screen.getByRole('button', { name: '继续导出' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(title)
    expect(api.exportHtml).not.toHaveBeenCalled()
    expect(api.exportWebPackage).not.toHaveBeenCalled()
  })

  it('keeps online-lightweight mode through preflight and the large HTML confirmation', async () => {
    loadCourseWithRemoteBackground()
    const api = appApi()
    window.desktopAPI = api
    sizeProbe.forceWarning = true
    render(<App />)

    fireEvent.click(screen.getByTestId('export-single-html-online'))

    expect(await screen.findByRole('alertdialog', {
      name: '单 HTML 导出预检',
    })).toBeVisible()
    expect(screen.getByText('online-remote-asset')).toBeVisible()
    expect(screen.getByText(/https:\/\/cdn\.example\.com\/course\/hero\.png\?v=2/))
      .toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '继续导出' }))

    expect(await screen.findByRole('alertdialog', {
      name: '单 HTML 文件较大',
    })).toBeVisible()
    expect(api.exportHtml).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /仍导出单 HTML/ }))

    await waitFor(() => expect(api.exportHtml).toHaveBeenCalledOnce())
    expect(deliveryProbe.publishedStandalone).toHaveBeenCalledOnce()
    const html = api.exportHtml.mock.calls[0]?.[0]?.html as string | undefined
    expect(html).toContain('img-src data: blob: https://cdn.example.com')
    expect(html).toContain('connect-src data: blob: https://api.example.com')
    expect(html).toContain('https:\\x2F\\x2Fcdn.example.com/course/hero.png?v=2')
    expect(html).not.toContain('data:image/png;base64')
  })

  it('exports a Web package only through the Published V2 producer', async () => {
    loadBlankCourse()
    const api = appApi()
    window.desktopAPI = api
    render(<App />)

    fireEvent.click(screen.getByTestId('export-web-package'))

    expect(await screen.findByRole('alertdialog', {
      name: '网页包 导出预检',
    })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '继续导出' }))

    await waitFor(() => expect(api.exportWebPackage).toHaveBeenCalledOnce())
    expect(deliveryProbe.publishedWebPackage).toHaveBeenCalledOnce()
  })

  it('blocks a wildcard online remote URL before exportHtml is called', async () => {
    loadCourseWithRemoteBackground('https://*/course/hero.png')
    const api = appApi()
    window.desktopAPI = api
    render(<App />)

    fireEvent.click(screen.getByTestId('export-single-html-online'))

    expect(await screen.findByRole('alertdialog', {
      name: '单 HTML 导出预检',
    })).toBeVisible()
    expect(screen.getByText('online-remote-url-invalid')).toBeVisible()
    expect(screen.getByText(/wildcard.*https:\/\/\*\/course\/hero\.png/)).toBeVisible()
    expect(screen.queryByRole('button', { name: '继续导出' }))
      .not.toBeInTheDocument()
    expect(api.exportHtml).not.toHaveBeenCalled()
  })

  it('blocks online HTML when an actual Runtime origin is undeclared', async () => {
    loadCourseWithNetworkRuntime(`fetch('https://api.undeclared.example.com/v1')`)
    const api = appApi()
    window.desktopAPI = api
    render(<App />)

    fireEvent.click(screen.getByTestId('export-single-html-online'))

    expect(await screen.findByRole('alertdialog', {
      name: '单 HTML 导出预检',
    })).toBeVisible()
    expect(screen.getByText('online-connect-origin-undeclared')).toBeVisible()
    expect(screen.getByText(/https:\/\/api\.undeclared\.example\.com/u)).toBeVisible()
    expect(screen.queryByRole('button', { name: '继续导出' })).not.toBeInTheDocument()
    expect(api.exportHtml).not.toHaveBeenCalled()
  })

  it('allows an explicit continue for a dynamic Runtime origin warning', async () => {
    loadCourseWithNetworkRuntime(`fetch(resolveApiEndpoint())`)
    const api = appApi()
    window.desktopAPI = api
    render(<App />)

    fireEvent.click(screen.getByTestId('export-single-html-online'))

    expect(await screen.findByRole('alertdialog', {
      name: '单 HTML 导出预检',
    })).toBeVisible()
    expect(screen.getByText('online-connect-origin-unresolved')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '继续导出' }))

    await waitFor(() => expect(api.exportHtml).toHaveBeenCalledOnce())
    expect(deliveryProbe.publishedStandalone).toHaveBeenCalledOnce()
  })

  it('re-runs preflight for the web package when a large single HTML is redirected', async () => {
    loadBlankCourse()
    const api = appApi()
    window.desktopAPI = api
    sizeProbe.forceWarning = true
    render(<App />)

    fireEvent.click(screen.getByTestId('export-single-html'))
    expect(await screen.findByRole('alertdialog', {
      name: '单 HTML 导出预检',
    })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '继续导出' }))
    expect(await screen.findByRole('alertdialog', {
      name: '单 HTML 文件较大',
    })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '导出网页包（推荐）' }))

    expect(await screen.findByRole('alertdialog', {
      name: '网页包 导出预检',
    })).toBeVisible()
    expect(api.exportWebPackage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '继续导出' }))
    await waitFor(() => expect(api.exportWebPackage).toHaveBeenCalledOnce())
  })

  it('exports the snapshot that passed preflight even if the document changes before emit', async () => {
    loadBlankCourse()
    const original = selectActiveCourseProjectDocument(useEditorStore.getState())?.title
    if (!original) throw new Error('expected an active course title')
    let releaseFonts!: () => void
    fontProbe.gate = new Promise<void>((resolve) => { releaseFonts = resolve })
    const api = appApi()
    window.desktopAPI = api
    render(<App />)

    fireEvent.click(screen.getByTestId('export-single-html'))
    expect(await screen.findByRole('alertdialog', {
      name: '单 HTML 导出预检',
    })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '继续导出' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    act(() => {
      useEditorStore.getState().renameProject('预检后改名')
    })
    releaseFonts()

    await waitFor(() => expect(api.exportHtml).toHaveBeenCalledOnce())
    const exported = deliveryProbe.publishedStandalone.mock.calls[0]?.[0] as
      | { project: { title: string } }
      | undefined
    expect(exported?.project.title).toBe(original)
  })

  it('refuses to locate a preflight finding after the document changed', async () => {
    loadCourseWithRemoteBackground()
    const api = appApi()
    window.desktopAPI = api
    render(<App />)

    fireEvent.click(screen.getByTestId('export-single-html-online'))
    expect(await screen.findByRole('alertdialog', {
      name: '单 HTML 导出预检',
    })).toBeVisible()
    expect(screen.getByText('online-remote-asset')).toBeVisible()
    act(() => {
      useEditorStore.getState().renameProject('定位前改名')
    })
    fireEvent.click(screen.getAllByRole('button', { name: '定位' })[0]!)

    expect(screen.queryByText(/已定位导出预检问题/)).toBeNull()
    expect(await screen.findByText(/导出预检结果已过期/)).toBeVisible()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})
