import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { DesktopAPI } from '../../src/shared/ipcTypes'
import type { LessonDesktopRequest } from '../../src/shared/lessonDesktopContract'
import type { LessonWorkspace } from '../../src/shared/lessonWorkspace'
import type { DocumentTabsController } from '../../src/renderer/lessonWorkspace/controller/useDocumentTabsController'
import { useLessonWorkspaceController } from '../../src/renderer/lessonWorkspace/controller/useLessonWorkspaceController'
import { createCourseStoreHost } from '../helpers/courseStoreHost'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'
import { useEditorStore } from '../../src/renderer/store/editorStore'

// Keep App's actual composition, lifecycle and canonical course bridge. Only the
// expensive editor paint and outer shell chrome are outside this mount check.
vi.mock('../../src/renderer/app/LessonWorkspaceHost', () => ({
  LessonWorkspaceHost: ({ children, onNewProject }: { children: ReactNode; onNewProject(): Promise<boolean> }) =>
    <><button onClick={() => void onNewProject()}>新建测试课件</button>{children}</>,
}))
vi.mock('../../src/renderer/ui/Workspace', () => ({ Workspace: () => <div data-testid="course-paint" /> }))
vi.mock('../../src/renderer/ui/ScenePanel', () => ({ ScenePanel: () => null }))
vi.mock('../../src/renderer/ui/SceneStateStrip', () => ({ SceneStateStrip: () => null }))
vi.mock('../../src/renderer/ui/RightSidebar', () => ({ RightSidebar: () => null }))
vi.mock('../../src/renderer/ui/TopToolbar', () => ({ TopToolbar: () => null }))
vi.mock('../../src/renderer/export/loadPlayerBundle', () => ({ loadPlayerBundle: () => '/* not exercised by entry tests */' }))
import App from '../../src/renderer/App'

afterEach(() => { cleanup(); localStorage.clear(); Reflect.deleteProperty(window, 'desktopAPI') })

describe('G20 default workspace entry has no embedded CLI dependency', () => {
  it('mounts the actual App and creates a canonical course without probing or starting an old agent', async () => {
    const host = await createCourseStoreHost()
    const localAgent = vi.fn(async () => ({ enabled: true }))
    const lesson = vi.fn(async () => { throw new Error('File creation must not create a legacy conversation') })
    window.desktopAPI = {
      documents: host.api, localAgent, lesson,
      listRecentProjects: async () => [], setDirtyState: async () => {},
      onRequestSave: () => () => {}, onRequestSaveAndClose: () => () => {},
      loadComponentCatalog: async () => ({ sources: [], packages: [], issues: [] }),
    } as unknown as DesktopAPI
    render(<App />)
    expect(screen.getByTestId('course-paint')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '新建测试课件' }))
    await waitFor(() => expect(useEditorStore.getState().courseDocument.documents).toHaveLength(1))
    const active = useEditorStore.getState().courseDocument.documentId!
    expect(host.registry.get(active).read().model.kind).toBe('course-v9')
    expect(localAgent).not.toHaveBeenCalled()
    expect(lesson).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '创作助手' })).not.toBeInTheDocument()
  })

  it('opens a workspace and a registered course, then creates a new course without v1 conversation reads or writes', async () => {
    const host = await createCourseDocumentHost()
    await host.seedFile('/workspace/lesson/course.h5lesson', 'registered course')
    const lesson: LessonWorkspace = {
      identity: { schemaVersion: 1, lessonId: 'lesson-a', normalizedDirectory: '/workspace/lesson' },
      manifest: { schemaVersion: 1, lessonId: 'lesson-a', title: 'registered', documents: {}, coursePath: 'course.h5lesson' },
    }
    const operation = vi.fn(async (request: LessonDesktopRequest) => {
      switch (request.operation) {
        case 'recent-workspaces': return { recent: [] }
        case 'choose-workspace': return { directory: '/workspace' }
        case 'list-lessons': return { lessons: [lesson] }
        case 'list-projects': return { projects: [] }
        default: throw new Error(`Unexpected legacy operation: ${request.operation}`)
      }
    })
    const tabs = { drainAll: vi.fn(async () => true), setActiveTab: vi.fn() } as unknown as DocumentTabsController
    const { result } = renderHook(() => useLessonWorkspaceController({
      lessonOperation: operation, projectPath: null, tabs,
      onOpenProject: async path => { await host.documents.open(path); return true },
      onNewProject: async () => { await host.documents.create('slide'); return true },
    }))
    await act(async () => { await result.current.actions.openWorkspace() })
    expect(result.current.state.workspace).toBe('/workspace')
    await act(async () => { await result.current.actions.openFile({ kind: 'file', name: 'course.h5lesson', path: '/workspace/lesson/course.h5lesson' }) })
    expect(host.read().model).toMatchObject({ kind: 'course-v9', project: { title: 'registered course' } })
    expect(result.current.state.lesson).toEqual(lesson)
    expect(tabs.setActiveTab).toHaveBeenCalledWith('course')
    const opened = host.read().documentId
    await act(async () => { await result.current.actions.newStandaloneProject() })
    expect(host.read().documentId).not.toBe(opened)
    expect(host.registry.get(opened).read().model).toMatchObject({ project: { title: 'registered course' } })
    expect(operation.mock.calls.some(([request]) => request.operation.includes('conversation'))).toBe(false)
  })
})
