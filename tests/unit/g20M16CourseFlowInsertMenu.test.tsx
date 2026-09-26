import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CourseEditorChromeContext } from '@/renderer/documents/CourseEditorChromeContext'
import { CourseLightToolbar, type CourseLightToolbarProps } from '@/renderer/documents/CourseLightToolbar'
import type { FlowInsertCommand } from '@/renderer/ui/flow/flowInsertCommands'

vi.mock('@/renderer/ui/properties/PropertiesContextAdapter', () => ({ usePropertiesContext: () => ({ kind: 'none' }) }))
afterEach(cleanup)

function mount(overrides: Partial<CourseLightToolbarProps> = {}) {
  const onInsert = vi.fn<(command: FlowInsertCommand) => void>()
  const oldText = vi.fn(), error = vi.fn()
  const props: CourseLightToolbarProps = {
    documentId: 'flow-document', isCurrentDocument: id => id === 'flow-document',
    canUndo: false, canRedo: false, undo: vi.fn(), redo: vi.fn(), save: vi.fn(), saveAs: vi.fn(), onReplaceImage: vi.fn(),
    onAddText: oldText, onAddImage: vi.fn(), onAddVideo: vi.fn(), onAddAudio: vi.fn(),
    insertSurface: 'flow', editingScope: 'scene', spatialScope: null, mode: 'edit', reportError: error,
    flowInsertMenu: { onInsert }, ...overrides,
  }
  render(<CourseEditorChromeContext.Provider value={{ documentId: 'flow-document', mode: 'light', setMode: vi.fn() }}>
    <CourseLightToolbar {...props} />
  </CourseEditorChromeContext.Provider>)
  return { onInsert, oldText, error }
}

describe('M16 Flow workbench insertion menu', () => {
  it('replaces the Flow page list with both carrier groups and forwards exact commands', () => {
    const { onInsert, oldText } = mount()
    fireEvent.click(screen.getByRole('button', { name: '插入' }))
    const body = screen.getByRole('region', { name: '插入到正文' })
    const paper = screen.getByRole('region', { name: '放到纸面上' })
    expect(within(body).getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      '标题', '列表', '表格', '公式', '分隔线', '提示框', '折叠节', '图片', '视频', '音频', '组件',
    ])
    expect(within(paper).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['文本框', '图片', '形状', '组件'])
    expect(screen.queryByText('Runtime')).toBeNull()
    expect(screen.queryByRole('button', { name: '添加文字' })).toBeNull()
    fireEvent.click(within(body).getByRole('menuitem', { name: '图片' }))
    expect(onInsert).toHaveBeenCalledWith({ destination: 'document', kind: 'image', label: '图片' })
    expect(screen.queryByRole('menu', { name: 'Flow 插入菜单' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '插入' }))
    fireEvent.click(within(screen.getByRole('region', { name: '放到纸面上' })).getByRole('menuitem', { name: '图片' }))
    expect(onInsert).toHaveBeenLastCalledWith({ destination: 'paper', kind: 'image', label: '图片' })
    expect(onInsert).toHaveBeenCalledTimes(2)
    expect(oldText).not.toHaveBeenCalled()
  })

  it('blocks disabled and stale Flow requests through the toolbar guard', () => {
    const blockedInsert = vi.fn()
    mount({ flowInsertMenu: { onInsert: blockedInsert, disabledReason: '请完成正文输入' } })
    fireEvent.click(screen.getByRole('button', { name: '插入' }))
    expect(screen.getByRole('status')).toHaveTextContent('请完成正文输入')
    fireEvent.click(screen.getByRole('menuitem', { name: '文本框' }))
    expect(blockedInsert).not.toHaveBeenCalled()
    cleanup()

    const stale = mount({ isCurrentDocument: () => false })
    fireEvent.click(screen.getByRole('button', { name: '插入' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '文本框' }))
    expect(stale.onInsert).not.toHaveBeenCalled()
    expect(stale.error).toHaveBeenCalledWith('文档已切换，请在当前文件重新选择操作。')
    cleanup()

    const run = mount({ mode: 'run' })
    expect(screen.getByRole('button', { name: '插入' })).toBeDisabled()
    expect(screen.queryByRole('menu', { name: 'Flow 插入菜单' })).toBeNull()
    expect(run.onInsert).not.toHaveBeenCalled()
  })

  it('keeps Flow global and Slide or Spatial legacy insertion paths', () => {
    const global = mount({ editingScope: 'global' })
    fireEvent.click(screen.getByRole('button', { name: '插入' }))
    expect(screen.queryByRole('menu', { name: 'Flow 插入菜单' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '添加文字' }))
    expect(global.oldText).toHaveBeenCalledOnce()
    expect(global.onInsert).not.toHaveBeenCalled()
    cleanup()

    const slide = mount({ insertSurface: 'slide' })
    fireEvent.click(screen.getByRole('button', { name: '插入' }))
    fireEvent.click(screen.getByRole('button', { name: '添加文字' }))
    expect(slide.oldText).toHaveBeenCalledOnce()
    expect(slide.onInsert).not.toHaveBeenCalled()
    cleanup()

    const spatial = mount({ insertSurface: 'spatial', spatialScope: 'world' })
    fireEvent.click(screen.getByRole('button', { name: '插入' }))
    fireEvent.click(screen.getByRole('button', { name: '添加文字' }))
    expect(spatial.oldText).toHaveBeenCalledOnce()
    expect(spatial.onInsert).not.toHaveBeenCalled()
  })
})
