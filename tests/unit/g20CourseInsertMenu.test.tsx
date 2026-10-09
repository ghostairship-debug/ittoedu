import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CourseEditorChromeContext } from '../../src/renderer/documents/CourseEditorChromeContext'
import { CourseLightToolbar, type CourseLightToolbarProps } from '../../src/renderer/documents/CourseLightToolbar'

vi.mock('../../src/renderer/ui/properties/PropertiesContextAdapter', () => ({
  usePropertiesContext: () => ({ kind: 'none' }),
}))

afterEach(cleanup)

function mount(overrides: Partial<CourseLightToolbarProps> = {}, workbench = false) {
  const actions = {
    text: vi.fn(), image: vi.fn(), video: vi.fn(), audio: vi.fn(), error: vi.fn(), setMode: vi.fn(),
  }
  const props: CourseLightToolbarProps = {
    documentId: 'document-1', isCurrentDocument: id => id === 'document-1',
    canUndo: false, canRedo: false, undo: vi.fn(), redo: vi.fn(), save: vi.fn(), saveAs: vi.fn(), onReplaceImage: vi.fn(),
    onAddText: actions.text, onAddImage: actions.image, onAddVideo: actions.video, onAddAudio: actions.audio,
    insertSurface: 'slide', editingScope: 'scene', spatialScope: null,
    mode: 'edit', reportError: actions.error,
    ...overrides,
  }
  render(<CourseEditorChromeContext.Provider value={{ documentId: 'document-1', mode: 'light', setMode: actions.setMode, ...(workbench ? { workbench: { documentStatus: <span>已保存</span> } } : {}) }}>
    <CourseLightToolbar {...props} />
  </CourseEditorChromeContext.Provider>)
  return actions
}

it('offers four compact insert actions and places Slide audio as a click-to-play button', () => {
  const actions = mount()
  fireEvent.click(screen.getByRole('button', { name: '插入' }))
  expect(screen.getByRole('button', { name: '添加文字' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '添加图片' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '添加视频' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '放置音频' })).toHaveTextContent('放置点击播放按钮')
  fireEvent.click(screen.getByRole('button', { name: '添加视频' }))
  expect(actions.video).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: '添加视频' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '插入' }))
  fireEvent.click(screen.getByRole('button', { name: '放置音频' }))
  expect(actions.audio).toHaveBeenCalledOnce()
})

it('keeps Flow global media unavailable while explaining that text goes into the current page', () => {
  const actions = mount({ insertSurface: 'flow', editingScope: 'global' })
  fireEvent.click(screen.getByRole('button', { name: '插入' }))
  expect(screen.getByRole('button', { name: '添加文字' })).toHaveTextContent('当前文档页的段落')
  expect(screen.getByRole('button', { name: '添加图片' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '添加视频' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '插入音频到正文' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '添加文字' }))
  expect(actions.text).toHaveBeenCalledOnce()
})

it('requires the Spatial world for canvas insertion and retains honest sound-library access', () => {
  const actions = mount({ insertSurface: 'spatial', spatialScope: 'surface' })
  fireEvent.click(screen.getByRole('button', { name: '插入' }))
  expect(screen.getByRole('button', { name: '添加文字' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '添加图片' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '添加视频' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '导入音频到声音库' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '导入音频到声音库' }))
  expect(actions.audio).toHaveBeenCalledOnce()
})

it('M21 inserts shapes and formulas from the workbench, saying where they go and when they cannot', () => {
  const shape = vi.fn(), formula = vi.fn()
  mount({ onAddShape: shape, onAddFormula: formula })
  fireEvent.click(screen.getByRole('button', { name: '插入' }))
  const shapes = screen.getByRole('group', { name: '形状' })
  expect([...shapes.querySelectorAll('button')].map(button => button.textContent)).toEqual(['矩形', '圆角矩形', '椭圆', '三角形', '直线', '箭头'])
  fireEvent.click(screen.getByRole('button', { name: '插入椭圆' }))
  expect(shape).toHaveBeenCalledWith('ellipse')
  expect(screen.queryByRole('group', { name: '形状' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '插入' }))
  expect(screen.getByRole('button', { name: '插入公式' })).toHaveTextContent('可编辑的数学公式')
  fireEvent.click(screen.getByRole('button', { name: '插入公式' }))
  expect(formula).toHaveBeenCalledOnce()
  cleanup()

  // In a Flow page shapes float over the paper and a formula is a block of the text, which the global layer cannot hold.
  mount({ insertSurface: 'flow', editingScope: 'global', onAddShape: shape, onAddFormula: formula })
  fireEvent.click(screen.getByRole('button', { name: '插入' }))
  expect(screen.getByRole('group', { name: '形状' })).toHaveTextContent('形状（页面浮层）')
  expect(screen.getByRole('button', { name: '插入矩形' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '插入公式' })).toBeDisabled()
  cleanup()
  mount({ insertSurface: 'spatial', spatialScope: 'surface', onAddShape: shape, onAddFormula: formula })
  fireEvent.click(screen.getByRole('button', { name: '插入' }))
  expect(screen.getByRole('button', { name: '插入矩形' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '插入矩形' })).toHaveAttribute('title', '请切换到无限画布世界层后插入对象。')
  expect(screen.getByRole('button', { name: '插入公式' })).toBeDisabled()
})

it('M21 keeps one fixed toolbar row with 另存为 and a single editor entry at the end', () => {
  const saveAs = vi.fn(), undoLatestAgent = vi.fn()
  const actions = mount({ saveAs, canUndoLatestAgent: true, undoLatestAgent }, true)
  const toolbar = screen.getByLabelText('常用工具')
  const labels = [...toolbar.querySelectorAll(':scope > .course-light-tools__row button')].map(button => button.getAttribute('aria-label') ?? button.textContent)
  expect(labels).toEqual(['保存', '另存为', '撤销', '重做', '插入', '更多工具', '在编辑器中打开'])
  fireEvent.click(screen.getByRole('button', { name: '另存为' }))
  expect(saveAs).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: '更多工具' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '撤销最近 AI 修改' }))
  expect(undoLatestAgent).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: '深度编辑' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '在编辑器中打开' }))
  expect(actions.setMode).toHaveBeenCalledWith('deep')
})

it('M21 moves optional commands into "⋯" on a narrow workbench instead of wrapping', () => {
  let report: (() => void) | undefined
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { report = callback } observe() {} disconnect() {} })
  const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(420)
  try {
    const saveAs = vi.fn(), onPreview = vi.fn()
    mount({ saveAs, canRedo: true, onPreview, onExport: vi.fn(), hasFlowSurface: false }, true)
    act(() => report?.())
    expect(screen.queryByRole('button', { name: '另存为' })).toBeNull()
    expect(screen.queryByRole('button', { name: '整课预览' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '更多工具' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '另存为' }))
    expect(saveAs).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '更多工具' }))
    expect(screen.getByRole('menuitem', { name: '重做' })).toBeEnabled()
    fireEvent.click(screen.getByRole('menuitem', { name: '整课预览' }))
    expect(onPreview).toHaveBeenCalledOnce()
  } finally { width.mockRestore(); vi.unstubAllGlobals() }
})

it('M21 puts 整课预览 and 导出 in the top bar, before the editor entry, with the editor’s export formats', () => {
  const onPreview = vi.fn(), onExport = vi.fn()
  mount({ onPreview, onExport, hasFlowSurface: false }, true)
  const row = screen.getByLabelText('常用工具')
  const order = [...row.querySelectorAll('button, summary')].map(element => element.getAttribute('aria-label') ?? element.textContent?.trim())
  expect(order.indexOf('整课预览')).toBeGreaterThan(order.indexOf('插入'))
  expect(order.indexOf('导出')).toBe(order.indexOf('整课预览') + 1)
  expect(order.indexOf('在编辑器中打开')).toBeGreaterThan(order.indexOf('导出'))
  fireEvent.click(screen.getByRole('button', { name: '整课预览' }))
  expect(onPreview).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByTestId('light-export-menu-trigger'))
  const formats = screen.getByRole('menu', { name: '选择导出格式' })
  expect([...formats.querySelectorAll('[role="menuitem"] strong')].map(element => element.textContent)).toEqual(
    ['离线便携单 HTML', '在线单 HTML', '网页包', 'PowerPoint（PPTX）', 'PDF', 'DOCX 讲义'])
  expect(screen.getByTestId('light-export-docx')).toBeDisabled()
  fireEvent.click(screen.getByTestId('light-export-single-html'))
  expect(onExport).toHaveBeenCalledWith('single-html', 'offline-portable')
  // No project check in the workbench.
  expect(screen.queryByRole('button', { name: /工程检查/ })).toBeNull()
})
