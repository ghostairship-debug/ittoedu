import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RightSidebar } from '@/renderer/ui/RightSidebar'
import { useEditorStore } from '@/renderer/store/editorStore'
import { proEditorRailController } from '@/renderer/ui/proEditorRailController'

vi.mock('@/renderer/ui/ElementsTab', () => ({
  ElementsTab: () => <input aria-label="元素面板草稿" defaultValue="初稿" />,
}))
vi.mock('@/renderer/ui/ComponentsTab', () => ({ ComponentsTab: ({ onExtractSelection, onDeleteCatalogComponent }: {
  onExtractSelection?: (title: string) => Promise<void>; onDeleteCatalogComponent?: (entry: any) => Promise<void>
}) => <div>组件面板<button onClick={() => void onExtractSelection?.('提炼课件')}>提炼所选</button>
  <button onClick={() => void onDeleteCatalogComponent?.({ id: 'selected-package' })}>删除所选库组件</button></div> }))
vi.mock('@/renderer/ui/NodesTab', () => ({ NodesTab: () => <p>图层面板</p> }))
vi.mock('@/renderer/ui/PropertiesTab', () => ({ PropertiesTab: () => <p>属性面板</p> }))
vi.mock('@/renderer/ui/AutomationTab', () => ({ AutomationTab: () => <p>互动面板</p> }))
vi.mock('@/renderer/ui/DeveloperTab', () => ({ DeveloperTab: () => <p>开发面板</p> }))

beforeEach(() => {
  proEditorRailController.close()
  useEditorStore.getState().setActiveTab('elements')
})
afterEach(() => {
  cleanup()
  proEditorRailController.close()
})

it('passes the existing extraction and catalog deletion ports through the editor rail', () => {
  const extract = vi.fn(async () => {}), remove = vi.fn(async () => {})
  render(<RightSidebar onAddImage={() => {}} onReplaceImage={() => {}} onAddVideo={() => {}}
    onImportAudio={() => {}} onImportVideo={() => {}} onExtractSelection={extract} onDeleteCatalogComponent={remove} />)
  fireEvent.click(screen.getByRole('tab', { name: '组件' }))
  fireEvent.click(screen.getByRole('button', { name: '提炼所选' }))
  fireEvent.click(screen.getByRole('button', { name: '删除所选库组件' }))
  expect(extract).toHaveBeenCalledExactlyOnceWith('提炼课件')
  expect(remove).toHaveBeenCalledExactlyOnceWith({ id: 'selected-package' })
})

it('keeps the editor canvas space until a tool is requested and retains the mounted draft when collapsed', () => {
  render(<RightSidebar onAddImage={() => {}} onReplaceImage={() => {}} onAddVideo={() => {}}
    onImportAudio={() => {}} onImportVideo={() => {}} />)
  const rail = screen.getByRole('tab', { name: '元素' })
  const panel = document.getElementById('pro-editor-tool-panel')!
  expect(rail).toHaveAttribute('aria-expanded', 'false')
  expect(panel).toHaveAttribute('hidden')
  fireEvent.click(rail)
  expect(rail).toHaveAttribute('aria-expanded', 'true')
  expect(panel).not.toHaveAttribute('hidden')
  const draft = screen.getByRole('textbox', { name: '元素面板草稿' })
  fireEvent.change(draft, { target: { value: '未提交输入' } })
  fireEvent.click(rail)
  expect(panel).toHaveAttribute('hidden')
  fireEvent.click(rail)
  expect(screen.getByRole('textbox', { name: '元素面板草稿' })).toBe(draft)
  expect(draft).toHaveValue('未提交输入')
})

it('uses one panel decision for tools, AI and workspace drawers', () => {
  render(<RightSidebar onAddImage={() => {}} onReplaceImage={() => {}} onAddVideo={() => {}}
    onImportAudio={() => {}} onImportVideo={() => {}} />)
  fireEvent.click(screen.getByRole('tab', { name: '图层' }))
  expect(proEditorRailController.getSnapshot().activePanel).toBe('layers')
  fireEvent.click(screen.getByRole('button', { name: 'AI 助手' }))
  expect(proEditorRailController.getSnapshot().activePanel).toBe('ai')
  expect(document.getElementById('pro-editor-tool-panel')).toHaveAttribute('hidden')
  fireEvent.click(screen.getByRole('button', { name: '资源管理器' }))
  expect(proEditorRailController.getSnapshot().activePanel).toBe('resources')
  fireEvent.click(screen.getByRole('button', { name: '会话列表' }))
  expect(proEditorRailController.getSnapshot().activePanel).toBe('conversations')
  fireEvent.click(screen.getByRole('button', { name: '会话列表' }))
  expect(proEditorRailController.getSnapshot().activePanel).toBeNull()
})
