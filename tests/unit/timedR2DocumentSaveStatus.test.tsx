import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { WorkspaceDocumentStatus } from '../../src/renderer/lessonWorkspace/view/WorkspaceDocumentStatus'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentBinding, DocumentPersistence, DocumentSnapshot } from '../../src/shared/workbench/document'

afterEach(cleanup)
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

it('renders official untitled/file binding and preserves dirty, saving and failed status priority', async () => {
  const file: Extract<DocumentBinding, { kind: 'file' }> = { kind: 'file', path: 'D:/fixture/课件.h5lesson', version: 'v1', bindingVersion: 1 }
  const firstWrite = deferred<typeof file>()
  let write: DocumentPersistence['save'] = async () => firstWrite.promise
  const persistence: DocumentPersistence = { append: async () => {}, save: input => write(input) }
  // This is a real clean blank Session snapshot. Its suggested filename does not bind it to a file.
  const session = await DocumentSession.create({ documentId: 'status-course', epoch: 'status-epoch',
    model: { kind: 'course-v10', project: createBlankCourseProjectV10('新建工程'), resources: { assets: {}, components: {} } },
    binding: { kind: 'untitled', suggestedName: '未命名课件.h5lesson' }, saved: true }, new CourseV10Driver(), persistence)
  const initial = session.read()
  expect(initial).toMatchObject({ binding: { kind: 'untitled' }, dirty: false, saving: false, undoDepth: 0 })
  // Only transport is adapted. All read and changed-event snapshots come from the real Session.
  const api = { read: async (documentId: string) => {
    if (documentId !== session.documentId) throw new Error('Wrong document')
    return session.read()
  }, subscribe: session.subscribe.bind(session) } as DocumentHostAPI
  render(<WorkspaceDocumentStatus api={api} documentId={session.documentId} />)
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('尚未保存'))
  expect(screen.getByRole('status')).toHaveAttribute('data-save-state', 'untitled')
  expect(session.read()).toEqual(initial)

  let firstSave!: Promise<DocumentSnapshot>
  act(() => { firstSave = session.save(file) })
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('保存中'))
  expect(screen.getByRole('status')).toHaveAttribute('data-save-state', 'saving')
  expect(session.read()).toMatchObject({ binding: { kind: 'untitled' }, dirty: false, saving: true })
  await act(async () => { firstWrite.resolve(file); await firstSave })
  expect(screen.getByRole('status')).toHaveTextContent('已保存')
  expect(screen.getByRole('status')).toHaveAttribute('data-save-state', 'saved')
  expect(session.read()).toMatchObject({ binding: file, dirty: false, saving: false, undoDepth: 0 })

  const saved = session.read()
  if (saved.model.kind !== 'course-v10') throw new Error('Expected V10')
  const command = captureComponentOperation(saved.model.project, [{ type: 'project.title.set', title: '人工续编辑' }])
  await act(async () => { await session.execute({ documentId: saved.documentId, epoch: saved.epoch, baseRevision: saved.revision,
    actor: 'human', operationId: 'change-title', mutation: { type: 'command',
      command } }) })
  expect(screen.getByRole('status')).toHaveTextContent('未保存')
  expect(screen.getByRole('status')).toHaveAttribute('data-save-state', 'dirty')
  const dirty = session.read()
  expect(dirty).toMatchObject({ dirty: true, undoDepth: 1 })

  const failedWrite = deferred<typeof file>()
  write = async () => failedWrite.promise
  let failedSave!: Promise<DocumentSnapshot>
  act(() => { failedSave = session.save() })
  const rejected = expect(failedSave).rejects.toThrow('EACCES')
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('保存中'))
  expect(screen.getByRole('status')).toHaveAttribute('data-save-state', 'saving')
  await act(async () => { failedWrite.reject(new Error('EACCES denied')); await rejected })
  expect(screen.getByRole('status')).toHaveTextContent('保存失败')
  expect(screen.getByRole('status')).toHaveTextContent('当前稿仍保留，可重试或另存')
  expect(screen.getByRole('status')).toHaveAttribute('data-save-state', 'failed')
  expect(session.read()).toMatchObject({ dirty: true, saving: false, undoDepth: 1, revision: dirty.revision })

  write = async () => ({ ...file, version: 'v2' })
  await act(async () => { await session.save() })
  expect(screen.getByRole('status')).toHaveTextContent('已保存')
  expect(screen.getByRole('status')).toHaveAttribute('data-save-state', 'saved')
  expect(screen.getByRole('status')).not.toHaveTextContent('保存失败')
  expect(session.read()).toMatchObject({ dirty: false, saving: false, saveError: null, undoDepth: 1, revision: dirty.revision })
})
