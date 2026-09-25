import { attachMarkdownRendererHost } from '../helpers/markdownRendererHost'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { LessonWorkspaceHost } from '../../src/renderer/app/LessonWorkspaceHost'
import { LessonWorkspaceShell, type LessonWorkspaceShellHandle } from '../../src/renderer/lessonWorkspace/LessonWorkspaceShell'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import type { DesktopAPI } from '../../src/shared/ipcTypes'
import type { LessonDesktopRequest } from '../../src/shared/lessonDesktopContract'

beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }) })
afterEach(() => { cleanup(); localStorage.clear(); Reflect.deleteProperty(window, 'desktopAPI'); vi.unstubAllGlobals() })

function fixture() {
  const disk = new Map([['/workspace/a.md', 'A source'], ['/workspace/b.md', 'B source']])
  const port: RecoverableDocumentFilePort = {
    openDocument: async ref => {
      const filename = ref.kind === 'file' ? ref.path : `${ref.lessonDirectory}/${ref.relativePath}`
      const source = disk.get(filename)
      if (source === undefined) throw new Error('ENOENT')
      return { ref, source, version: { contentVersion: source, attachments: [] }, diagnostics: [] }
    },
    watchDocument: () => () => {}, saveDocument: vi.fn(),
    
  }
  const canonical = attachMarkdownRendererHost(port)
  const operation = vi.fn(async (request: LessonDesktopRequest) => {
    switch (request.operation) {
      case 'recent-workspaces': return { recent: [] }
      case 'choose-workspace': return { directory: '/workspace' }
      case 'list-lessons': return { lessons: [] }
      case 'list-projects': return { projects: [] }
      case 'list-directory': return { entries: [...disk.keys()].map(path => ({ kind: 'file' as const, path, name: path.split('/').pop()! })) }
      default: throw new Error(`Retired operation reached: ${request.operation}`)
    }
  })
  return { disk, port, canonical, operation }
}

describe('2.0 workspace shell', () => {
  it('shows an unavailable unified assistant without a CLI fallback and still creates a real untitled document', async () => {
    const h = fixture()
    const localAgent = vi.fn(), legacyDocumentAi = vi.fn(), lessonAuthoring = vi.fn()
    window.desktopAPI = {
      lesson: h.operation, lessonFiles: h.port, documents: h.canonical.documents,
      workspaceFiles: vi.fn(), localAgent, lessonDocumentAi: legacyDocumentAi, lessonAuthoring,
    } as unknown as DesktopAPI
    render(<LessonWorkspaceHost projectPath={null} onOpenProject={async () => true} onNewProject={async () => true}><div data-testid="course">课程宿主</div></LessonWorkspaceHost>)
    expect(screen.getByRole('alert')).toHaveTextContent('创作助手服务不可用')
    expect(screen.getByTestId('course')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Markdown 文档名'), { target: { value: '未命名教学稿' } })
    fireEvent.click(screen.getByRole('button', { name: '创建文档' }))
    await screen.findByRole('tab', { name: /未命名教学稿.md/ })
    const documents = await h.canonical.documents.list()
    expect(documents).toHaveLength(1)
    expect(documents[0]).toMatchObject({ binding: { kind: 'untitled' }, model: { kind: 'markdown', source: '' } })
    expect(localAgent).not.toHaveBeenCalled()
    expect(legacyDocumentAi).not.toHaveBeenCalled()
    expect(lessonAuthoring).not.toHaveBeenCalled()
    expect(h.operation.mock.calls.some(([request]) => request.operation.includes('conversation'))).toBe(false)
  })

  it('blocks close on a disk conflict and preserves the canonical draft and mounted editor without saving over the file', async () => {
    const h = fixture(), baseline = await h.canonical.documents.open('/workspace/a.md')
    await h.canonical.documents.dispatch({ documentId: baseline.documentId, epoch: baseline.epoch, baseRevision: baseline.revision,
      operationId: 'teacher', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: 'teacher draft' } } })
    h.disk.set('/workspace/a.md', 'external edit')
    const handle = createRef<LessonWorkspaceShellHandle>()
    render(<LessonWorkspaceShell ref={handle} lessonOperation={h.operation} documentPort={h.port} projectPath={null}
      onOpenProject={async () => true} onNewProject={async () => true} renderAssistant={() => <p>统一助手</p>}>课程宿主</LessonWorkspaceShell>)
    await act(async () => { await handle.current!.openFile('/workspace/a.md') })
    await screen.findByRole('button', { name: '此处保留当前稿' })
    const editor = document.querySelector('.ProseMirror')
    await act(async () => { expect(await handle.current!.closeAll()).toBe(false) })
    expect(screen.getByRole('tab', { name: /a.md/ })).toBeInTheDocument()
    await act(async () => { expect(await handle.current!.preserveAll()).toBe(true) })
    expect(document.querySelector('.ProseMirror')).toBe(editor)
    expect(await h.canonical.documents.read(baseline.documentId)).toMatchObject({ dirty: true, undoDepth: 1, model: { source: 'teacher draft' } })
    expect(h.port.saveDocument).not.toHaveBeenCalled()
    expect(h.disk.get('/workspace/a.md')).toBe('external edit')
  })

  it('focuses a retained background document through the host event without replacing its editor or History', async () => {
    const h = fixture(), handle = createRef<LessonWorkspaceShellHandle>()
    let focus!: (id: string) => void
    window.desktopAPI = {
      lesson: h.operation, lessonFiles: h.port, documents: h.canonical.documents, workspaceFiles: vi.fn(),
      onRequestFocusDocument: (listener: (id: string) => void) => { focus = listener; return () => {} }, reportDiagnostic: vi.fn(),
    } as unknown as DesktopAPI
    render(<LessonWorkspaceHost ref={handle} projectPath={null} onOpenProject={async () => true} onNewProject={async () => true}>课程宿主</LessonWorkspaceHost>)
    await act(async () => { await handle.current!.openFile('/workspace/a.md') })
    await screen.findByText('A source')
    const first = (await h.canonical.documents.list())[0]!, editor = document.querySelector('.ProseMirror')
    await act(async () => {
      await h.canonical.documents.dispatch({ documentId: first.documentId, epoch: first.epoch, baseRevision: first.revision,
        operationId: 'change-a', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: 'retained teacher draft' } } })
      await handle.current!.openFile('/workspace/b.md')
    })
    await waitFor(() => expect(screen.getByRole('tab', { name: /b.md/ })).toHaveAttribute('aria-selected', 'true'))
    await act(async () => { focus(first.documentId) })
    await waitFor(() => expect(screen.getByRole('tab', { name: /a.md/ })).toHaveAttribute('aria-selected', 'true'))
    expect(document.querySelector('.ProseMirror')).toBe(editor)
    expect(await h.canonical.documents.read(first.documentId)).toMatchObject({ undoDepth: 1, model: { source: 'retained teacher draft' } })
    expect(h.port.saveDocument).not.toHaveBeenCalled()
  })
})
