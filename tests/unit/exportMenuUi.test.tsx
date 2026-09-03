import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecentProjectEntry } from '@/shared/ipcTypes'
import { useEditorStore, selectActiveCourseProjectDocument } from '@/renderer/store/editorStore'
import { utf8ByteLength } from '@/renderer/export/exportSize'
import { buildPublishedCourseStandaloneHtml } from '@/renderer/export/course/buildCoursePackages'
import type { SingleHtmlExportMode } from '@/renderer/export/course/coursePackagePreflight'
import { ExportSizeWarningDialog } from '@/renderer/ui/ExportSizeWarningDialog'
import { TopToolbar, type ExportFormat } from '@/renderer/ui/TopToolbar'

afterEach(cleanup)

beforeEach(() => {
  localStorage.clear()
  useEditorStore.getState().createNewProject()
  useEditorStore.setState({ editorMode: 'simple' })
})

function renderToolbar(
  onExport: (format: ExportFormat, singleHtmlMode?: SingleHtmlExportMode) => void,
  busy = false,
  onOpenHealth = vi.fn(),
  options: {
    onSave?: (saveAs?: boolean) => void
    recentProjects?: RecentProjectEntry[]
    onOpenRecent?: (path: string) => void
  } = {},
) {
  render(
    <TopToolbar
      busy={busy}
      onNew={() => undefined}
      onOpen={() => undefined}
      recentProjects={options.recentProjects ?? []}
      onOpenRecent={options.onOpenRecent ?? (() => undefined)}
      onSave={options.onSave ?? (() => undefined)}
      healthSummary={{ error: 0, warning: 0, info: 0, total: 0, canExport: true }}
      onOpenHealth={onOpenHealth}
      onPreview={() => undefined}
      onExport={onExport}
    />,
  )
}

describe('unified export menu', () => {
  it('renames the project inline and keeps the change undoable', () => {
    renderToolbar(vi.fn())
    fireEvent.click(screen.getByRole('button', { name: '重命名课件' }))
    const title = screen.getByRole('textbox', { name: '课件名称' })
    fireEvent.change(title, { target: { value: '雨中的苏轼' } })
    fireEvent.blur(title)
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.title).toBe('雨中的苏轼')
    expect(useEditorStore.getState().dirty).toBe(true)
    useEditorStore.getState().undo()
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.title).toBe('未命名课件')
  })

  it('moves Save As, project health, and recent projects into More in simple mode', () => {
    const onOpenHealth = vi.fn()
    const onSave = vi.fn()
    const onOpenRecent = vi.fn()
    renderToolbar(vi.fn(), false, onOpenHealth, {
      onSave,
      onOpenRecent,
      recentProjects: [{
        path: 'C:\\lessons\\rain.h5lesson',
        name: '雨中的苏轼',
        lastOpenedAt: 1,
      }],
    })

    expect(screen.queryByRole('button', { name: '另存为' })).not.toBeInTheDocument()
    expect(screen.queryByTitle('打开最近工程')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', {
      name: '工程检查：未发现问题',
    })).not.toBeInTheDocument()

    fireEvent.click(screen.getByTitle('更多工程操作'))
    fireEvent.click(screen.getByRole('menuitem', { name: /另存为/ }))
    expect(onSave).toHaveBeenCalledWith(true)

    fireEvent.click(screen.getByTitle('更多工程操作'))
    fireEvent.click(screen.getByRole('menuitem', {
      name: '工程检查：未发现问题',
    }))
    expect(onOpenHealth).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByTitle('更多工程操作'))
    fireEvent.click(screen.getByRole('button', { name: /雨中的苏轼/ }))
    expect(onOpenRecent).toHaveBeenCalledWith('C:\\lessons\\rain.h5lesson')
  })

  it('keeps advanced project controls directly visible in professional mode', () => {
    act(() => useEditorStore.getState().setEditorMode('professional'))
    renderToolbar(vi.fn())

    expect(screen.queryByTitle('更多工程操作')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '另存为' })).toBeInTheDocument()
    expect(screen.getByTitle('打开最近工程')).toBeInTheDocument()
    expect(screen.getByRole('button', {
      name: '工程检查：未发现问题',
    })).toBeInTheDocument()
    expect(screen.queryByRole('button', {
      name: '导入可信的 .h5component 组件',
    })).not.toBeInTheDocument()
  })

  it('changes editor density without replacing or mutating the Project document', () => {
    const projectBefore = selectActiveCourseProjectDocument(useEditorStore.getState())!
    renderToolbar(vi.fn())

    fireEvent.click(screen.getByRole('button', { name: '专业' }))
    expect(useEditorStore.getState().editorMode).toBe('professional')
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!).toBe(projectBefore)

    fireEvent.click(screen.getByRole('button', { name: '简洁' }))
    expect(useEditorStore.getState().editorMode).toBe('simple')
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!).toBe(projectBefore)
  })

  it('offers both explicit single HTML modes, web package, PPTX, PDF, and DOCX', () => {
    const onExport = vi.fn<(
      format: ExportFormat,
      singleHtmlMode?: SingleHtmlExportMode,
    ) => void>()
    renderToolbar(onExport)

    fireEvent.click(screen.getByLabelText('导出课件'))
    expect(screen.getByRole('menuitem', { name: /离线便携单 HTML/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /在线轻量单 HTML/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /网页包/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /PowerPoint（PPTX）/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^PDF/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /DOCX 讲义/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: /离线便携单 HTML/ }))
    expect(onExport).toHaveBeenLastCalledWith('single-html', 'offline-portable')

    fireEvent.click(screen.getByLabelText('导出课件'))
    fireEvent.click(screen.getByRole('menuitem', { name: /在线轻量单 HTML/ }))
    expect(onExport).toHaveBeenLastCalledWith('single-html', 'online-lightweight')

    fireEvent.click(screen.getByLabelText('导出课件'))
    fireEvent.click(screen.getByRole('menuitem', { name: /网页包/ }))
    expect(onExport).toHaveBeenCalledWith('web-package')
  })

  it('routes V9 course HTML through the Published Course V2 producer', () => {
    const document = selectActiveCourseProjectDocument(useEditorStore.getState())
    expect(document?.schemaVersion).toBe(9)
    const html = buildPublishedCourseStandaloneHtml({
      project: document!,
      assetFiles: {},
      components: {},
    }, '(function(){})();')
    expect(html).toContain('window.__H5_COURSE_PAYLOAD__=')
    expect(html).not.toContain('.course-nav')
    expect(html).not.toContain('class="course-nav"')
  })

  it('does not open while the editor is busy', () => {
    renderToolbar(vi.fn(), true)
    const trigger = screen.getByLabelText('导出课件')
    fireEvent.click(trigger)
    expect(trigger.closest('details')).not.toHaveAttribute('open')
  })
})

describe('single HTML size warning', () => {
  it('measures the real UTF-8 size without relying on JavaScript string length', () => {
    expect(utf8ByteLength('HTML课件😀')).toBe(
      new TextEncoder().encode('HTML课件😀').byteLength,
    )
  })

  it('recommends the web package but still allows a warning-sized HTML', () => {
    const onPackage = vi.fn()
    const onContinue = vi.fn()
    render(
      <ExportSizeWarningDialog
        open
        byteLength={72 * 1024 * 1024}
        hardLimitBytes={256 * 1024 * 1024}
        onCancel={() => undefined}
        onExportWebPackage={onPackage}
        onContinueSingleHtml={onContinue}
      />,
    )

    expect(screen.getByText(/72\.0 MB/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /导出网页包/ }))
    expect(onPackage).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: /仍导出单 HTML/ }))
    expect(onContinue).toHaveBeenCalledOnce()
  })

  it('blocks single HTML when it exceeds the hard saving limit', () => {
    render(
      <ExportSizeWarningDialog
        open
        byteLength={300 * 1024 * 1024}
        hardLimitBytes={256 * 1024 * 1024}
        onCancel={() => undefined}
        onExportWebPackage={() => undefined}
        onContinueSingleHtml={() => undefined}
      />,
    )

    expect(screen.getByText(/超过单 HTML/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /仍导出单 HTML/ })).not.toBeInTheDocument()
  })
})
