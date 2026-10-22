import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { DocumentEvent, DocumentSnapshot } from '../../src/shared/workbench/document'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { ExecutionDocumentReference } from '../../src/shared/workbench/executionDesktop'
import { WorkspaceDocumentStatus } from '../../src/renderer/lessonWorkspace/view/WorkspaceDocumentStatus'
import { LessonWorkspaceHost } from '../../src/renderer/app/LessonWorkspaceHost'

const hostScene = vi.hoisted(() => ({
  editor: null as unknown,
  capture: null as null | ((writable: boolean, prepare?: boolean) => Promise<ExecutionDocumentReference[]>),
}))
vi.mock('../../src/renderer/lessonWorkspace/LessonWorkspaceShell', () => ({
  LessonWorkspaceShell: (props: import('../../src/renderer/lessonWorkspace/LessonWorkspaceShell').LessonWorkspaceShellProps) =>
    <>{props.children}{props.renderAssistant?.(null, { name: 'large.html', getEditor: () => hostScene.editor as import('../../src/renderer/documentFiles/LessonDocumentEditor').LessonDocumentEditorHandle, getContextualEditTarget: () => null }, false, async () => true, null)}</>,
}))
vi.mock('../../src/renderer/workbench/ExecutionAssistant', () => ({
  ExecutionAssistant: (props: { captureDocuments: NonNullable<typeof hostScene.capture> }) => { hostScene.capture = props.captureDocuments; return null },
}))
vi.mock('../../src/renderer/app/lessonDocumentPort', () => ({ createDesktopDocumentPort: () => ({}) }))
vi.mock('../../src/renderer/workbench/WorkspaceRecoveryPanel', () => ({ WorkspaceRecoveryPanel: () => null }))
vi.mock('../../src/renderer/lessonMaterials/LessonMaterialBrowser', () => ({ LessonMaterialBrowser: () => null }))

const previousDesktop = Object.getOwnPropertyDescriptor(window, 'desktopAPI')
afterEach(() => {
  cleanup(); vi.clearAllMocks(); hostScene.editor = null; hostScene.capture = null
  if (previousDesktop) Object.defineProperty(window, 'desktopAPI', previousDesktop)
  else Reflect.deleteProperty(window, 'desktopAPI')
})
function snapshot(documentId = 'large', patch: Partial<DocumentSnapshot> = {}): DocumentSnapshot {
  return { documentId, epoch: `${documentId}-epoch`, revision: 1,
    binding: { kind: 'file', path: `C:/materials/${documentId}.html`, version: 'disk', bindingVersion: 1 },
    model: { kind: 'text', source: '<p>Current HTML</p>', resources: { assets: {}, components: {} } },
    dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0, ...patch }
}

it('switches file status through live Session projections without copying HTML over IPC', () => {
  const listeners = new Set<() => void>(), events = new Set<(event: DocumentEvent) => void>()
  let current: DocumentSnapshot | undefined = snapshot()
  const session = { get committedDocument() { return current }, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } } }
  const api = { read: vi.fn(async () => snapshot()), subscribe(listener: (event: DocumentEvent) => void) { events.add(listener); return () => { events.delete(listener) } } } as unknown as DocumentHostAPI
  const view = render(<WorkspaceDocumentStatus api={api} documentId="large" session={session} />)
  expect(screen.getByRole('status')).toHaveTextContent('已保存')
  act(() => { current = snapshot('large', { dirty: true, saving: true }); listeners.forEach(listener => listener()) })
  expect(screen.getByRole('status')).toHaveTextContent('保存中')
  act(() => { current = snapshot('large', { dirty: true, saveError: 'ENOSPC' }); listeners.forEach(listener => listener()) })
  expect(screen.getByRole('status')).toHaveTextContent('保存失败')
  view.rerender(<WorkspaceDocumentStatus api={api} />)
  expect(screen.queryByRole('status')).toBeNull()
  view.rerender(<WorkspaceDocumentStatus api={api} documentId="large" session={session} />)
  expect(screen.getByRole('status')).toHaveTextContent('保存失败')
  expect(api.read).not.toHaveBeenCalled()
  act(() => { events.forEach(listener => listener({ type: 'closed', documentId: 'large', epoch: 'older-epoch' })) })
  expect(screen.getByRole('status')).toHaveTextContent('保存失败')
  act(() => { events.forEach(listener => listener({ type: 'closed', documentId: 'large', epoch: 'large-epoch' })) })
  expect(screen.queryByRole('status')).toBeNull()
  expect(listeners.size).toBe(1)
  view.unmount()
  expect(listeners.size).toBe(0)
  expect(events.size).toBe(0)
})

it('uses committed views for automatic references and fresh canonical facts for explicit preparation', async () => {
  const committed = snapshot(), latest = snapshot('large', { revision: 2 })
  const read = vi.fn(async () => latest), drain = vi.fn(async () => true)
  hostScene.editor = { session: { documentId: committed.documentId, committedDocument: committed, drain } }
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { lesson: {}, workspaceFiles: {}, lessonFiles: {}, documents: { read }, execution: {} } })
  const contents = () => <LessonWorkspaceHost projectPath={null} onOpenProject={async () => true} onNewProject={async () => true}>Course</LessonWorkspaceHost>
  const view = render(contents())
  expect(await hostScene.capture!(true, false)).toEqual([{ documentId: 'large', epoch: 'large-epoch', revision: 1, writable: [{ kind: 'document' }] }])
  view.rerender(contents())
  expect((await hostScene.capture!(false, false))[0].revision).toBe(1)
  expect(read).not.toHaveBeenCalled()
  expect(drain).not.toHaveBeenCalled()
  expect((await hostScene.capture!(true))[0].revision).toBe(2)
  expect(read).toHaveBeenCalledOnce()
  expect(drain).toHaveBeenCalledOnce()
})
