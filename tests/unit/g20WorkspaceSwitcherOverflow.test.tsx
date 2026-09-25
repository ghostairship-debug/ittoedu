import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceChrome } from '../../src/renderer/lessonWorkspace/view/WorkspaceChrome'
import { DEFAULT_PREFS, type WorkbenchLayoutController } from '../../src/renderer/lessonWorkspace/view/useWorkbenchLayoutPrefs'
import type { LessonWorkspaceViewProps } from '../../src/renderer/lessonWorkspace/view/lessonWorkspaceViewTypes'

afterEach(cleanup)

describe('workspace switcher with long recent history', () => {
  it('keeps folder selection and creation in a separate accessible action area', () => {
    const openWorkspace = vi.fn(async () => {})
    const run = vi.fn(async (action: () => Promise<void>) => action())
    const props = {
      state: { workspace: '/workspace/current', recent: Array.from({ length: 30 }, (_, index) => `/workspace/recent-${index}`) },
      actions: { run, openWorkspace, setMobilePane: vi.fn() },
    } as unknown as LessonWorkspaceViewProps
    const layout = { prefs: DEFAULT_PREFS } as WorkbenchLayoutController
    render(<WorkspaceChrome props={props} layout={layout} exitEditor={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('切换工作空间'))
    const recent = screen.getByRole('group', { name: '最近使用的工作空间' })
    expect(recent.querySelectorAll('button')).toHaveLength(30)
    const choose = screen.getByRole('button', { name: '选择其他工作空间文件夹…' })
    const create = screen.getByRole('button', { name: '新建工作空间' })
    expect(recent.contains(choose)).toBe(false)
    expect(recent.contains(create)).toBe(false)
    expect(choose.parentElement).toBe(create.parentElement)

    fireEvent.click(choose)
    expect(openWorkspace).toHaveBeenCalledWith()
    fireEvent.click(screen.getByLabelText('切换工作空间'))
    fireEvent.click(screen.getByRole('button', { name: '新建工作空间' }))
    expect(openWorkspace).toHaveBeenCalledWith(undefined, true)
  })
})
