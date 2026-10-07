// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CourseEditorChromeContext } from '../../src/renderer/documents/CourseEditorChromeContext'
import { EditorPanelLayout } from '../../src/renderer/ui/EditorPanelLayout'
import { proEditorRailController } from '../../src/renderer/ui/proEditorRailController'
import { ExportMenu } from '../../src/renderer/ui/ExportMenu'

afterEach(() => { cleanup(); proEditorRailController.close(); vi.unstubAllGlobals() })

it('opens the existing light property slot, retains its draft through Escape and document switch, and offers optional settings', () => {
  const quickExport = vi.fn(), settings = vi.fn()
  const scene = (documentId: string) => <CourseEditorChromeContext.Provider value={{ documentId, mode: 'light', setMode() {} }}>
    <EditorPanelLayout className="app-main"><aside>结构</aside><main>作品</main>
      <aside><input aria-label="专业属性输入" defaultValue="原值" /><ExportMenu variant="light" busy={false} hasFlowSurface={false}
        onExport={quickExport} onExportSettings={settings} /></aside>
    </EditorPanelLayout>
  </CourseEditorChromeContext.Provider>
  const ui = render(scene('first')), draft = screen.getByLabelText('专业属性输入')
  expect(draft.closest('[hidden]')).not.toBeNull()
  act(() => proEditorRailController.open('properties'))
  expect(draft.closest('[hidden]')).toBeNull()
  fireEvent.change(draft, { target: { value: '未提交属性稿' } })
  fireEvent.keyDown(draft, { key: 'Escape' })
  expect(draft.closest('[hidden]')).not.toBeNull()
  act(() => proEditorRailController.open('properties'))
  fireEvent.click(screen.getByTestId('light-export-menu-trigger'))
  fireEvent.click(screen.getByRole('menuitem', { name: /导出设置/ }))
  expect(settings).toHaveBeenCalledOnce(); expect(quickExport).not.toHaveBeenCalled()
  ui.rerender(scene('second'))
  expect(proEditorRailController.getSnapshot().activePanel).toBeNull()
  expect(screen.getByLabelText('专业属性输入')).toBe(draft)
  expect(draft).toHaveValue('未提交属性稿')
  expect(draft.closest('[hidden]')).not.toBeNull()
})
