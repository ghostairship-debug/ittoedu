import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CourseAdvancedChrome, CourseEditorChromeContext, CourseEditorFrame, type CourseEditorMode } from '@/renderer/documents/CourseEditorChromeContext'
import { CourseLightToolbar } from '@/renderer/documents/CourseLightToolbar'
import { TopToolbar } from '@/renderer/ui/TopToolbar'
import { selectCanRedoActiveSurface, selectCanUndoActiveSurface, useEditorStore } from '@/renderer/store/editorStore'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'

vi.mock('@/renderer/ui/properties/PropertiesContextAdapter', () => ({ usePropertiesContext: () => ({ kind: 'none' }) }))

const store = () => useEditorStore.getState()
afterEach(() => { cleanup(); store().cancelTextEdit(); store().courseBridge.dispose() })

async function fixture(busy = false) {
  const host = await createCourseDocumentHost()
  await store().connectCourseDocuments(host.api)
  store().setEditingScope('scene'); store().setCanvasMode('edit')
  const documentId = store().courseView.activeDocumentId!
  const calls = { save: vi.fn(), saveAs: vi.fn(), preview: vi.fn(), import: vi.fn(), export: vi.fn(),
    new: vi.fn(), open: vi.fn(), recent: vi.fn(), health: vi.fn(), materials: vi.fn(), properties: vi.fn(), agentUndo: vi.fn() }
  function View() {
    const [mode, setMode] = useState<CourseEditorMode>('light')
    useEditorStore(state => state.courseView.snapshot)
    const tools = (toolbarMode: CourseEditorMode) => <CourseLightToolbar toolbarMode={toolbarMode}
      documentId={documentId} isCurrentDocument={id => id === store().courseView.activeDocumentId}
      canUndo={selectCanUndoActiveSurface(store())} canRedo={selectCanRedoActiveSurface(store())}
      undo={() => store().undo()} redo={() => store().redo()} save={calls.save} saveAs={calls.saveAs}
      canUndoLatestAgent undoLatestAgent={calls.agentUndo} onReplaceImage={() => {}}
      onAddText={() => { void store().addTextNode() }} onAddImage={() => {}} onAddVideo={() => {}} onAddAudio={() => {}}
      onAddShape={shape => store().addShapeNode(shape)} onAddFormula={() => store().addFormulaNode()}
      onImportPptx={calls.import} onImportFlow={calls.import} onImportHtml={calls.import}
      onPreview={calls.preview} onExport={calls.export} onToggleProperties={calls.properties}
      insertSurface="slide" editingScope="scene" spatialScope={null} mode="edit" busy={busy} reportError={() => {}} />
    return <CourseEditorChromeContext.Provider value={{ documentId, mode, setMode, workbench: { documentStatus: <span>已保存</span> } }}>
      <CourseEditorFrame lightTools={tools('light')}>
        <CourseAdvancedChrome><TopToolbar commonTools={tools('deep')} busy={busy}
          onNew={calls.new} onOpen={calls.open} recentProjects={[{ path: 'lesson.h5lesson', name: '课程', lastOpenedAt: 1 }]}
          onOpenRecent={calls.recent} onSave={() => { throw new Error('duplicate save route') }} healthSummary={null}
          onOpenHealth={calls.health} onOpenMaterials={calls.materials} onPreview={() => { throw new Error('duplicate preview route') }}
          onExport={() => { throw new Error('duplicate export route') }} /></CourseAdvancedChrome>
        <input aria-label="正在编辑的内容" defaultValue="未完成文字" />
        <footer>状态</footer>
      </CourseEditorFrame>
    </CourseEditorChromeContext.Provider>
  }
  render(<View />)
  return { host, documentId, calls }
}

it('uses the same authoring and delivery callbacks in both positions, retaining the document, draft, History and project tools', async () => {
  const h = await fixture(), before = h.host.registry.get(h.documentId).read()
  fireEvent.change(screen.getByLabelText('正在编辑的内容'), { target: { value: '仍在输入' } })
  for (const position of ['light', 'deep'] as const) {
    if (position === 'deep') fireEvent.click(screen.getByRole('button', { name: '在编辑器中打开' }))
    const toolbar = screen.getByRole('button', { name: '保存' }).closest('.course-light-tools') as HTMLElement
    const tools = within(toolbar)
    expect(toolbar).toHaveAttribute('data-toolbar-mode', position)
    expect(screen.getAllByRole('button', { name: '保存' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    fireEvent.click(screen.getByRole('button', { name: '另存为' }))
    fireEvent.click(screen.getByRole('button', { name: '整课预览' }))
    fireEvent.click(tools.getByLabelText('导入'))
    fireEvent.click(within(tools.getByLabelText('导入').closest('details')!).getByRole('menuitem', { name: /PowerPoint（PPTX）/ }))
    fireEvent.click(tools.getByLabelText('导出'))
    fireEvent.click(screen.getByTestId(position === 'light' ? 'light-export-single-html' : 'export-single-html'))
    fireEvent.click(screen.getByRole('button', { name: '属性' }))
    fireEvent.click(screen.getByRole('button', { name: '更多工具' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '撤销最近 AI 修改' }))
  }
  for (const name of ['save', 'saveAs', 'preview', 'import', 'export', 'properties', 'agentUndo'] as const) expect(h.calls[name]).toHaveBeenCalledTimes(2)
  expect(h.calls.export).toHaveBeenLastCalledWith('single-html', 'offline-portable')
  expect(screen.queryByRole('button', { name: '在编辑器中打开' })).toBeNull()
  expect(screen.getByLabelText('果铃')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '新建 果铃工程（Ctrl+N）' }))
  fireEvent.click(screen.getByRole('button', { name: '打开工程（Ctrl+O）' }))
  fireEvent.click(screen.getByLabelText('最近工程'))
  fireEvent.click(screen.getByRole('button', { name: /课程/ }))
  fireEvent.click(screen.getByRole('button', { name: '打开工程检查' }))
  fireEvent.click(screen.getByLabelText('创作工具'))
  fireEvent.click(screen.getByRole('menuitem', { name: /教学材料库/ }))
  for (const name of ['new', 'open', 'recent', 'health', 'materials'] as const) expect(h.calls[name]).toHaveBeenCalledOnce()
  expect(h.host.registry.get(h.documentId).read()).toEqual(before)

  fireEvent.click(screen.getByRole('button', { name: '插入' }))
  expect(screen.getByRole('button', { name: '插入公式' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '插入椭圆' })).toBeEnabled()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '添加文字' })); await store().courseBridge.drain() })
  expect(h.host.registry.get(h.documentId).read().undoDepth).toBe(before.undoDepth + 1)
  const selection = store().courseView.selectedInstanceIds
  expect(selection).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '返回工作台' }))
  expect(screen.getByLabelText('正在编辑的内容')).toHaveValue('仍在输入')
  expect(store().courseView.selectedInstanceIds).toEqual(selection)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '撤销' })); await store().courseBridge.drain() })
  expect(h.host.registry.get(h.documentId).read().undoDepth).toBe(before.undoDepth)
})

it('keeps one navigation host per position and distinct insert IDs while preserving busy restrictions in the full editor', async () => {
  await fixture(true)
  fireEvent.click(screen.getByRole('button', { name: '在编辑器中打开' }))
  expect(document.querySelectorAll('.course-navigation-toolbar-host[data-toolbar-mode="light"]')).toHaveLength(1)
  expect(document.querySelectorAll('.course-navigation-toolbar-host[data-toolbar-mode="deep"]')).toHaveLength(1)
  expect(screen.getByRole('button', { name: '插入' })).toHaveAttribute('aria-controls', 'course-deep-insert-menu')
  for (const name of ['保存', '另存为', '撤销', '重做', '插入', '整课预览']) expect(screen.getByRole('button', { name })).toBeDisabled()
  const tools = within(screen.getByRole('button', { name: '保存' }).closest('.course-light-tools') as HTMLElement)
  expect(tools.getByLabelText('导入')).toHaveAttribute('aria-disabled', 'true')
  expect(tools.getByLabelText('导出')).toHaveAttribute('aria-disabled', 'true')
})
