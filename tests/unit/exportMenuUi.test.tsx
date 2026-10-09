import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecentProjectEntry } from '@/shared/ipcTypes'
import { useEditorStore } from '@/renderer/store/editorStore'
import { utf8ByteLength } from '@/renderer/export/exportSize'
import type { SingleHtmlExportMode } from '@/renderer/export/course/coursePackagePreflight'
import { ExportSizeWarningDialog } from '@/renderer/ui/ExportSizeWarningDialog'
import { TopToolbar, type ExportFormat } from '@/renderer/ui/TopToolbar'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'

afterEach(() => { cleanup(); useEditorStore.getState().courseBridge.dispose() })

let host: Awaited<ReturnType<typeof createCourseDocumentHost>>

beforeEach(async () => {
  localStorage.clear()
  host = await createCourseDocumentHost()
  await useEditorStore.getState().connectCourseDocuments(host.api)
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
  it('renames the project inline and keeps the change undoable', async () => {
    renderToolbar(vi.fn())
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    const title = screen.getByRole('textbox', { name: '名称' })
    fireEvent.change(title, { target: { value: '雨中的苏轼' } })
    const before = useEditorStore.getState().courseView.snapshot!
    await act(async () => { fireEvent.blur(title); await useEditorStore.getState().drainCourseDocument() })
    expect(useEditorStore.getState().courseView.snapshot!.undoDepth).toBe(before.undoDepth + 1)
    expect(useEditorStore.getState().courseView.project!.title).toBe('雨中的苏轼')
    expect(useEditorStore.getState().dirty).toBe(true)
    await act(async () => { useEditorStore.getState().undo(); await useEditorStore.getState().drainCourseDocument() })
    expect(useEditorStore.getState().courseView.project!.title).toBe('initial')
  })

  it('keeps Save As, project health, and recent projects directly visible', () => {
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

    expect(screen.queryByTitle('更多工程操作')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '另存为' }))
    expect(onSave).toHaveBeenCalledWith(true)

    fireEvent.click(screen.getByRole('button', {
      name: '工程检查：未发现问题',
    }))
    expect(onOpenHealth).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByTitle('打开最近工程'))
    fireEvent.click(screen.getByRole('button', { name: /雨中的苏轼/ }))
    expect(onOpenRecent).toHaveBeenCalledWith('C:\\lessons\\rain.h5lesson')
    expect(screen.queryByRole('button', { name: '导入可信的 .h5component 组件' })).not.toBeInTheDocument()
  })

  it('offers each export and gates DOCX on Flow while respecting dismissal and busy', async () => {
    const onExport = vi.fn<(
      format: ExportFormat,
      singleHtmlMode?: SingleHtmlExportMode,
    ) => void>()
    renderToolbar(onExport)

    fireEvent.click(screen.getByLabelText('导出'))
    expect(screen.getByRole('menuitem', { name: /离线便携单 HTML/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /在线单 HTML/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /网页包/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /PowerPoint（PPTX）/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^PDF/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /DOCX 讲义/ })).toBeDisabled()
    await act(async () => { await useEditorStore.getState().editComponents([{ type: 'surface.insert', index: 1, surface: { id: 'flow', kind: 'flow', title: '讲义', childIds: [] } }]) })

    fireEvent.click(screen.getByRole('menuitem', { name: /离线便携单 HTML/ }))
    expect(onExport).toHaveBeenLastCalledWith('single-html', 'offline-portable')

    fireEvent.click(screen.getByLabelText('导出'))
    fireEvent.click(screen.getByRole('menuitem', { name: /在线单 HTML/ }))
    expect(onExport).toHaveBeenLastCalledWith('single-html', 'online-lightweight')

    fireEvent.click(screen.getByLabelText('导出'))
    fireEvent.click(screen.getByRole('menuitem', { name: /网页包/ }))
    expect(onExport).toHaveBeenCalledWith('web-package')
    for (const [label, format] of [[/PowerPoint（PPTX）/, 'pptx'], [/^PDF/, 'pdf'], [/DOCX 讲义/, 'docx']] as const) {
      fireEvent.click(screen.getByLabelText('导出')); fireEvent.click(screen.getByRole('menuitem', { name: label })); expect(onExport).toHaveBeenLastCalledWith(format)
    }
    const menu = screen.getByTestId('export-menu-trigger').closest('details')!
    fireEvent.click(screen.getByLabelText('导出'))
    expect(menu.open).toBe(true)
    fireEvent.pointerDown(document.body)
    expect(menu.open).toBe(false)
    fireEvent.click(screen.getByLabelText('导出'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(menu.open).toBe(false)
    cleanup()
    renderToolbar(vi.fn(), true)
    const trigger = screen.getByLabelText('导出')
    fireEvent.click(trigger)
    expect(trigger.closest('details')).not.toHaveAttribute('open')
  })
})

describe('single HTML size warning', () => {
  it('measures the real UTF-8 size without relying on JavaScript string length', () => {
    expect(utf8ByteLength('HTML课件😀')).toBe(
      new TextEncoder().encode('HTML课件😀').byteLength,
    )

    const onPackage = vi.fn()
    const onContinue = vi.fn()
    render(
      <ExportSizeWarningDialog
        open
        byteLength={72 * 1024 * 1024}
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

  it('allows single HTML beyond the former saving limit', () => {
    const onContinue = vi.fn()
    render(
      <ExportSizeWarningDialog
        open
        byteLength={300 * 1024 * 1024}
        onCancel={() => undefined}
        onExportWebPackage={() => undefined}
        onContinueSingleHtml={onContinue}
      />,
    )

    expect(screen.getByText(/300\.0 MB/)).toBeInTheDocument()
    expect(screen.queryByText(/保存上限/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /仍导出单 HTML/ }))
    expect(onContinue).toHaveBeenCalledOnce()
  })
})
