import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { EditorPanelLayout } from '@/renderer/ui/EditorPanelLayout'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('keeps panel owners mounted while hiding focusable controls and restores the wide layout', () => {
  let width = 620
  let resize = () => {}
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width } as DOMRect))
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe() {} disconnect() {} })
  render(<div className="lesson-course-tab"><EditorPanelLayout className="app-main">
    <aside><input aria-label="结构草稿" defaultValue="保留" /></aside>
    <main>画布</main><aside><button>素材操作</button></aside>
  </EditorPanelLayout></div>)
  const draft = screen.getByLabelText('结构草稿')
  expect(draft.closest('[hidden]')).not.toBeNull()
  const structure = screen.getByRole('button', { name: '页面与图层' })
  fireEvent.click(structure)
  expect(draft.closest('[hidden]')).toBeNull()
  fireEvent.change(draft, { target: { value: '未提交输入' } })
  fireEvent.click(screen.getByRole('button', { name: '属性与素材' }))
  expect(draft.closest('[hidden]')).not.toBeNull()
  fireEvent.keyDown(screen.getByRole('button', { name: '素材操作' }), { key: 'Escape' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '属性与素材' }))
  act(() => { width = 1200; resize() })
  expect(screen.queryByRole('button', { name: '页面与图层' })).toBeNull()
  expect(screen.getByLabelText('结构草稿')).toBe(draft)
  expect(draft).toHaveValue('未提交输入')
  expect(draft.closest('[hidden]')).toBeNull()
})
it('preserves the standalone editor panels without embedded controls', () => {
  render(<EditorPanelLayout><aside>结构</aside><main>画布</main><aside>属性</aside></EditorPanelLayout>)
  expect(screen.queryByRole('button', { name: '页面与图层' })).toBeNull()
  expect(screen.getByText('结构').closest('[hidden]')).toBeNull()
  expect(screen.getByText('属性').closest('[hidden]')).toBeNull()
})
