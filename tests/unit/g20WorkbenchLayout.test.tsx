import { useEffect, useState } from 'react'
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFS, STORAGE_KEY, parseLayoutPrefs, resolveWorkbenchWidths, useWorkbenchLayoutPrefs, type WorkbenchLayoutController } from '../../src/renderer/lessonWorkspace/view/useWorkbenchLayoutPrefs'
import { WorkspaceDocumentTabs } from '../../src/renderer/lessonWorkspace/view/WorkspaceDocumentTabs'
import type { LessonWorkspaceViewProps } from '../../src/renderer/lessonWorkspace/view/lessonWorkspaceViewTypes'
import { WorkspaceGrid } from '../../src/renderer/lessonWorkspace/view/WorkspaceGrid'

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('2.0 stable workspace layout', () => {
 it('uses v2 defaults and validates each damaged preference without affecting files', () => {
   expect(parseLayoutPrefs('{')).toEqual(DEFAULT_PREFS)
   expect(parseLayoutPrefs(JSON.stringify({ navWidth: 99999, chatWidth: -20, navCollapsed: 'false', chatClosed: true, contentClosed: 'yes' }))).toEqual({ ...DEFAULT_PREFS, navWidth: 440, chatWidth: 280, chatClosed: true })
   localStorage.setItem('guoling-workbench-layout-v1', JSON.stringify({ contentClosed: true }))
   let current!: WorkbenchLayoutController
   function Harness() { current = useWorkbenchLayoutPrefs(); return null }
   render(<Harness />)
   expect(current.prefs.contentClosed).toBe(false)
   expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(DEFAULT_PREFS)
 })
 it('releases closed tracks, clamps restored sizes, and persists only after a drag completes', () => {
   const full = resolveWorkbenchWidths({ ...DEFAULT_PREFS, navWidth: 440, chatWidth: 640 }, 860)
   expect(full.nav + full.chat + 10).toBeLessThanOrEqual(540)
   expect(resolveWorkbenchWidths({ ...DEFAULT_PREFS, navCollapsed: true, chatClosed: true }, 1200)).toMatchObject({ nav: 0, chat: 0, navSplitter: false, chatSplitter: false, content: true })
   let current!: WorkbenchLayoutController
   function Harness() { current = useWorkbenchLayoutPrefs(); return null }
   render(<Harness />)
   const persist = vi.spyOn(Storage.prototype, 'setItem')
   act(() => current.beginResize())
   act(() => current.setNavWidth(280))
   act(() => current.setNavWidth(310))
   expect(persist).not.toHaveBeenCalled()
   act(() => current.endResize())
   expect(persist).toHaveBeenCalledTimes(1)
   expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).navWidth).toBe(310)
 })
 it('retains editor and assistant instances and input while collapsing, resizing and entering deep edit', () => {
   let resize: ResizeObserverCallback = () => {}
   vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resize = callback } observe() {} disconnect() {} })
   const mounts = { editor: vi.fn(), assistant: vi.fn() }
   function Stateful({ id }: { id: keyof typeof mounts }) {
     useEffect(() => { mounts[id]() }, [id])
     return <input aria-label={id} defaultValue="" />
   }
   let current!: WorkbenchLayoutController
   let focus!: (value: boolean) => void
   function Harness() {
     current = useWorkbenchLayoutPrefs()
     const [deep, setDeep] = useState(false); focus = setDeep
     const [pane, setPane] = useState<'navigation' | 'chat' | 'workbench'>('workbench')
     return <WorkspaceGrid layout={current} editorFocus={deep} mobilePane={pane} selectPane={setPane}
       resources={<div>Resources</div>} content={<Stateful id="editor" />} assistant={<Stateful id="assistant" />} />
   }
   const { container } = render(<Harness />)
   const editor = screen.getByLabelText('editor'); const assistant = screen.getByLabelText('assistant')
   fireEvent.change(editor, { target: { value: 'unsaved content' } })
   fireEvent.change(assistant, { target: { value: 'ongoing task prompt' } })
   act(() => { current.toggleNav(); current.toggleChatClosed(); current.toggleContentClosed() })
   expect(container.querySelector('.workspace-grid')?.getAttribute('data-chat-closed')).toBe('true')
   expect(container.querySelectorAll('.workspace-grid-splitter:not([hidden])')).toHaveLength(0)
   act(() => resize([{ contentRect: { width: 650 } }] as ResizeObserverEntry[], {} as ResizeObserver))
   act(() => focus(true))
   act(() => focus(false))
   act(() => { current.toggleNav(); current.toggleChatClosed(); current.toggleContentClosed() })
   expect(screen.getByLabelText('editor')).toBe(editor)
   expect(screen.getByLabelText('assistant')).toBe(assistant)
   expect(editor).toHaveValue('unsaved content')
   expect(assistant).toHaveValue('ongoing task prompt')
   expect(mounts.editor).toHaveBeenCalledTimes(1)
   expect(mounts.assistant).toHaveBeenCalledTimes(1)
 })
 it('renders only actual document tabs and uses document identity to select and close them', () => {
   const setActiveTab = vi.fn(); const closeTab = vi.fn(async () => true)
   const props = {
     state: { lesson: null, busy: false },
     actions: { run: async (action: () => Promise<void>) => action(), setMobilePane: vi.fn() },
     tabs: { tabs: [], activeTab: '', setActiveTab, closeTab },
   } as unknown as LessonWorkspaceViewProps
   function Harness({ current }: { current: LessonWorkspaceViewProps }) {
     const layout = useWorkbenchLayoutPrefs()
     return <WorkspaceDocumentTabs props={current} layout={layout} />
   }
   const result = render(<Harness current={props} />)
   expect(screen.queryAllByRole('tab')).toHaveLength(0)
   const tab = { id: 'course-2', documentId: 'course-2', kind: 'course' as const, path: '', name: '未命名课件', dirty: true, lesson: null }
   result.rerender(<Harness current={{ ...props, tabs: { ...props.tabs, tabs: [tab] } }} />)
   fireEvent.click(screen.getByRole('tab', { name: /未命名课件/ }))
   expect(setActiveTab).toHaveBeenCalledWith('course-2')
   fireEvent.click(screen.getByRole('button', { name: '关闭 未命名课件' }))
   expect(closeTab).toHaveBeenCalledWith(tab)
 })

})
