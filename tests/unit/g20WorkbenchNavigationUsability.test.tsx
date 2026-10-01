import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceChrome } from '../../src/renderer/lessonWorkspace/view/WorkspaceChrome'
import { useWorkbenchLayoutPrefs } from '../../src/renderer/lessonWorkspace/view/useWorkbenchLayoutPrefs'
import type { LessonWorkspaceViewProps } from '../../src/renderer/lessonWorkspace/view/lessonWorkspaceViewTypes'

type Pane = LessonWorkspaceViewProps['state']['mobilePane']
const entries: readonly [string, Pane][] = [
  ['AI 助手', 'chat'],
  ['资源管理器', 'navigation'],
  ['会话列表', 'navigation'],
  ['内容', 'workbench'],
]

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

function renderChrome(width: number) {
  vi.stubGlobal('innerWidth', width)
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: width <= 860,
    media: query,
    onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })))
  const selectPane = vi.fn<(pane: Pane) => void>()
  function Harness() {
    const layout = useWorkbenchLayoutPrefs()
    const [mobilePane, setMobilePane] = useState<Pane>('workbench')
    const props = {
      state: { workspace: '/workspace', recent: [], mobilePane },
      actions: { setMobilePane: (pane: Pane) => { selectPane(pane); setMobilePane(pane) } },
    } as unknown as LessonWorkspaceViewProps
    return <WorkspaceChrome props={props} layout={layout} exitEditor={() => {}} />
  }
  render(<Harness />)
  return selectPane
}

describe('workspace top navigation at narrow and wide window sizes', () => {
  it.each(entries)('800px: %s stays expanded and selects its region', (label, pane) => {
    const selectPane = renderChrome(800)
    const entry = screen.getByRole('button', { name: label })
    expect(entry).toHaveAttribute('aria-pressed', pane === 'workbench' ? 'true' : 'false')

    fireEvent.click(entry)
    expect(selectPane).toHaveBeenLastCalledWith(pane)
    expect(entry).toHaveAttribute('aria-pressed', 'true')

    // A navigation entry must not leave its selected region hidden on a second click.
    fireEvent.click(entry)
    expect(entry).toHaveAttribute('aria-pressed', 'true')
  })

  it('1200px: the assistant stays directly accessible and the layout menu contains the other regions', () => {
    const selectPane = renderChrome(1200)
    const entry = screen.getByRole('button', { name: 'AI 助手' })
    fireEvent.click(entry)
    expect(selectPane).toHaveBeenLastCalledWith('chat')
    expect(entry).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(entry)
    expect(entry).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: '资源管理器' })).toBeNull()
    expect(screen.queryByRole('button', { name: '会话列表' })).toBeNull()
    expect(screen.queryByRole('button', { name: '内容' })).toBeNull()
    fireEvent.click(screen.getByText('布局', { exact: true }))
    expect(screen.getByRole('button', { name: '收起资源管理器' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收起会话列表' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收起内容区' })).toBeInTheDocument()
  })
})
