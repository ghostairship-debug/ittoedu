import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { ImageResultCard } from '../../src/renderer/workbench/ImageResultCard'
import type { ImageResultEvent, ImageResultView, ImageResultsDesktopAPI } from '../../src/shared/workbench/imageResultsDesktop'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { workbenchSelection } from '../../src/renderer/workbench/SelectionContextController'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('S14 image result updates preserve edit focus and previews never start image generation or application', async () => {
  const owner = { workspaceId: 'workspace', conversationId: 'conversation', runId: 'run', jobId: 'job' }
  let view: ImageResultView = { ...owner, source: 'external-mcp', applications: [], job: {
    version: 1, jobId: 'job', runId: 'run', documentId: 'document', requestDigest: 'digest', stopped: false, createdAt: '2026-09-23T00:00:00Z', updatedAt: '2026-09-23T00:00:00Z', operation: 'generate', status: 'ready',
    resources: [{ resourceId: 'image', digest: 'digest', width: 32, height: 24, byteLength: 3, mimeType: 'image/png' }],
    provenance: { executor: 'guoling-direct-chatgpt-images', endpoint: 'https://chatgpt.com/backend-api/codex/images/generations', connectionId: 'connection', connectionRevision: 1, accountId: 'account', authKind: 'oauth', billing: { kind: 'subscription' }, references: [], querySupport: 'unavailable', charge: 'unknown', requestedImageModel: 'chosen-image' },
  } }
  let emit: (event: ImageResultEvent) => void = () => {}
  const api: ImageResultsDesktopAPI = { read: vi.fn(async () => view), list: vi.fn(async () => [view]), subscribe: listener => { emit = listener; return () => {} },
    preview: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png', width: 32, height: 24 })),
    apply: vi.fn(), edit: vi.fn(), stop: vi.fn(), }
  const documents = { list: async () => [], subscribe: () => () => {} } as unknown as DocumentHostAPI
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  render(<ImageResultCard api={api} owner={owner} documents={documents} />)
  expect(await screen.findByText('已生成，尚未应用')).toBeVisible()
  expect(screen.getByText(/实际图片模型：供应商未报告/)).toBeVisible()
  const prompt = screen.getByLabelText('继续编辑图片'); fireEvent.change(prompt, { target: { value: '保留这段未发送要求' } }); prompt.focus()
  view = { ...view, job: { ...view.job, status: 'unapplied', stopped: true } }
  act(() => emit(view)); await screen.findByText('已生成，停止后尚未应用')
  expect(document.activeElement).toBe(prompt); expect(prompt).toHaveValue('保留这段未发送要求')
  fireEvent.click(screen.getByRole('button', { name: '预览图片' }))
  expect(await screen.findByAltText('生成的图片预览')).toHaveAttribute('src', 'blob:preview')
  await waitFor(() => expect(api.preview).toHaveBeenCalledExactlyOnceWith({ ...owner, resourceId: 'image' }))
  expect(api.apply).not.toHaveBeenCalled(); expect(api.edit).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '插入图片' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '替换选中图片' })).toBeDisabled()
})

it('lets the user inspect and change the insertion frame while replacement stays independent', async () => {
  const owner = { workspaceId: 'workspace', conversationId: 'conversation', runId: 'run', jobId: 'job' }
  const model = new CourseV9Driver().load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/slide-native.h5lesson')))
  if (model.kind !== 'course-v9') throw new Error('fixture must be a course')
  const location = model.project.locations.find(value => value.kind === 'slide-scene')!
  const snapshot: DocumentSnapshot = { documentId: 'document', epoch: 'epoch', revision: 0, binding: { kind: 'untitled', suggestedName: '图片测试.h5lesson' },
    model, dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  const view: ImageResultView = { ...owner, source: 'builtin', applications: [], job: {
    version: 1, ...owner, documentId: 'document', requestDigest: 'digest', stopped: false, createdAt: '2026-09-23T00:00:00Z', updatedAt: '2026-09-23T00:00:00Z',
    operation: 'generate', status: 'ready', resources: [{ resourceId: 'image', digest: 'digest', width: 1536, height: 1024, byteLength: 3, mimeType: 'image/png' }],
    provenance: { executor: 'guoling-direct-chatgpt-images', endpoint: 'https://chatgpt.com/backend-api/codex/images/generations', connectionId: 'connection', connectionRevision: 1,
      accountId: 'account', authKind: 'oauth', billing: { kind: 'subscription' }, references: [], querySupport: 'unavailable', charge: 'unknown', requestedImageModel: 'chosen-image' },
  } }
  const api: ImageResultsDesktopAPI = { read: vi.fn(async () => view), list: vi.fn(async () => [view]), subscribe: () => () => {}, preview: vi.fn(), edit: vi.fn(), stop: vi.fn(),
    apply: vi.fn(async input => ({ status: 'applied' as const, documentId: input.target.documentId, operationId: input.actionId, beforeRevision: 0, revision: 1, persistence: 'recoverable' as const })) }
  const documents = { list: async () => [snapshot], subscribe: () => () => {} } as unknown as DocumentHostAPI
  const unregister = workbenchSelection.setFallback(async () => snapshot)
  try {
    render(<ImageResultCard api={api} owner={owner} documents={documents} />)
    await screen.findByRole('button', { name: '插入图片' })
    fireEvent.change(screen.getByLabelText('应用到课件'), { target: { value: snapshot.documentId } })
    fireEvent.change(screen.getByLabelText('插入位置'), { target: { value: location.id } })
    const details = screen.getByText(/画布位置与尺寸：/).closest('details')!
    await waitFor(() => expect(details.querySelector('summary')).toHaveTextContent('X 752 · Y 352 · 480×320'))
    expect(screen.getByRole('button', { name: '插入图片' })).toBeEnabled()
    fireEvent.click(details.querySelector('summary')!)
    fireEvent.change(screen.getByLabelText('X', { exact: true }), { target: { value: '730' } })
    fireEvent.change(screen.getByLabelText('Y', { exact: true }), { target: { value: '355' } })
    fireEvent.change(screen.getByLabelText('宽', { exact: true }), { target: { value: '0' } })
    expect(screen.getByRole('button', { name: '插入图片' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('宽', { exact: true }), { target: { value: '400' } })
    fireEvent.change(screen.getByLabelText('高', { exact: true }), { target: { value: '280' } })
    fireEvent.click(screen.getByRole('button', { name: '插入图片' }))
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith(expect.objectContaining({ frame: { x: 730, y: 355, width: 400, height: 280 } })))
  } finally { unregister() }
})
