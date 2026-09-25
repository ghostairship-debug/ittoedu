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

it('offers four compact insert actions and labels Slide audio as a sound-library import', () => {
  const actions = mount()
  fireEvent.click(screen.getByRole('button', { name: '插入' }))
  expect(screen.getByRole('button', { name: '添加文字' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '添加图片' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '添加视频' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '导入音频到声音库' })).toHaveTextContent('供互动播放')
  fireEvent.click(screen.getByRole('button', { name: '添加视频' }))
  expect(actions.video).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: '添加视频' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '插入' }))
  fireEvent.click(screen.getByRole('button', { name: '导入音频到声音库' }))
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
    const saveAs = vi.fn()
    mount({ saveAs, canRedo: true }, true)
    act(() => report?.())
    expect(screen.queryByRole('button', { name: '另存为' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '更多工具' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '另存为' }))
    expect(saveAs).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '更多工具' }))
    expect(screen.getByRole('menuitem', { name: '重做' })).toBeEnabled()
  } finally { width.mockRestore(); vi.unstubAllGlobals() }
})
