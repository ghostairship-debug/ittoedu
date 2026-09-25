import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CourseEditorChromeContext } from '../../src/renderer/documents/CourseEditorChromeContext'
import { CourseLightToolbar, type CourseLightToolbarProps } from '../../src/renderer/documents/CourseLightToolbar'

vi.mock('../../src/renderer/ui/properties/PropertiesContextAdapter', () => ({
  usePropertiesContext: () => ({ kind: 'none' }),
}))

afterEach(cleanup)

function mount(overrides: Partial<CourseLightToolbarProps> = {}) {
  const actions = {
    text: vi.fn(), image: vi.fn(), video: vi.fn(), audio: vi.fn(), error: vi.fn(),
  }
  const props: CourseLightToolbarProps = {
    documentId: 'document-1', isCurrentDocument: id => id === 'document-1',
    canUndo: false, canRedo: false, undo: vi.fn(), redo: vi.fn(), save: vi.fn(), onReplaceImage: vi.fn(),
    onAddText: actions.text, onAddImage: actions.image, onAddVideo: actions.video, onAddAudio: actions.audio,
    insertSurface: 'slide', editingScope: 'scene', spatialScope: null,
    mode: 'edit', reportError: actions.error,
    ...overrides,
  }
  render(<CourseEditorChromeContext.Provider value={{ documentId: 'document-1', mode: 'light', setMode: vi.fn() }}>
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
