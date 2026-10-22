import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ImageResultCard } from '../../src/renderer/workbench/ImageResultCard'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentHostEvent, DocumentSnapshot, DocumentSnapshotHead } from '../../src/shared/workbench/document'
import type { ImageResultView, ImageResultsDesktopAPI } from '../../src/shared/workbench/imageResultsDesktop'

afterEach(cleanup)
const head = (snapshot: DocumentSnapshot): DocumentSnapshotHead => {
  const { model, ...facts } = snapshot
  if (model.kind !== 'course-v10') throw new Error('expected work project')
  return { ...facts, sequence: snapshot.sequence ?? 0, kind: model.kind, projectId: model.project.id }
}

it('updates image target facts without full state reads and ignores a late list or closed epoch', async () => {
  const owner = { workspaceId: 'w', conversationId: 'c', runId: 'r', jobId: 'j' }, project = createBlankCourseProjectV10('Image target')
  const original: DocumentSnapshot = { documentId: 'document', epoch: 'epoch', sequence: 0, revision: 0,
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } }, binding: { kind: 'untitled', suggestedName: 'before.glx' },
    dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  let current = { ...original, sequence: 1, binding: { kind: 'untitled' as const, suggestedName: 'after.glx' } }
  const view: ImageResultView = { ...owner, source: 'builtin', applications: [], job: { version: 1, ...owner, documentId: 'document',
    requestDigest: 'digest', stopped: false, createdAt: '2026-10-22', updatedAt: '2026-10-22', operation: 'generate', status: 'ready',
    resources: [{ resourceId: 'image', digest: 'digest', width: 32, height: 24, byteLength: 3, mimeType: 'image/png' }],
    provenance: { executor: 'guoling-direct-chatgpt-images', endpoint: 'https://chatgpt.com/backend-api/codex/images/generations', connectionId: 'connection', connectionRevision: 1,
      accountId: 'account', authKind: 'oauth', billing: { kind: 'subscription' }, references: [], querySupport: 'unavailable', charge: 'unknown', requestedImageModel: 'chosen-image' } } }
  const api: ImageResultsDesktopAPI = { read: vi.fn(async () => view), list: vi.fn(async () => [view]), subscribe: () => () => {}, preview: vi.fn(), apply: vi.fn(), edit: vi.fn(), stop: vi.fn() }
  let finishList!: (values: DocumentSnapshot[]) => void, emit: (event: DocumentHostEvent) => void = () => {}
  const read = vi.fn(async () => structuredClone(current))
  const documents = { list: () => new Promise<DocumentSnapshot[]>(done => { finishList = done }), read,
    subscribe(listener: typeof emit) { emit = listener; return () => {} } } as unknown as DocumentHostAPI
  render(<ImageResultCard api={api} owner={owner} documents={documents} />)
  await screen.findByText('图片已生成')
  act(() => emit({ type: 'state', head: head(current) }))
  await screen.findByRole('option', { name: 'after.glx' })
  fireEvent.change(screen.getByLabelText('应用到 果铃工程'), { target: { value: current.documentId } })
  const root = project.rootIds[0]
  current = { ...current, sequence: 2, revision: 1, model: { kind: 'course-v10', project: { ...project,
    revision: 1, instances: { ...project.instances, [root]: { ...project.instances[root], name: 'New container' } } }, resources: original.model.resources } }
  act(() => emit({ type: 'updated', head: head(current), baseRevision: 0, baseSequence: 1, model: { kind: 'course-v10', revision: 1,
    changes: { changes: [{ path: ['instances', root, 'name'], exists: true, value: 'New container' }], affectedTargets: [root] }, resources: { assets: {}, components: {} } } }))
  await screen.findByRole('option', { name: 'New container' })
  act(() => emit({ type: 'closed', documentId: current.documentId, epoch: 'old-epoch' }))
  expect(screen.getByRole('option', { name: 'after.glx' })).toBeInTheDocument()
  act(() => emit({ type: 'closed', documentId: current.documentId, epoch: current.epoch }))
  await waitFor(() => expect(screen.queryByRole('option', { name: 'after.glx' })).not.toBeInTheDocument())
  await act(async () => { finishList([original]); await Promise.resolve() })
  expect(screen.queryByRole('option', { name: 'before.glx' })).not.toBeInTheDocument()
  expect(read).toHaveBeenCalledTimes(1)
  expect(api.apply).not.toHaveBeenCalled()
})
