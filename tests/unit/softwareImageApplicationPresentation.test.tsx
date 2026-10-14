import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import { emptyExecutionProjection, foldExecutionEvents, type ExecutionEvent } from '../../src/shared/workbench/executionEvents'
import type { ImageResultEvent, ImageResultView, ImageResultsDesktopAPI } from '../../src/shared/workbench/imageResultsDesktop'

afterEach(cleanup)

it('shows an automatic application after its commit even when image ready arrived first, without polling unrelated text', async () => {
  const owner = { workspaceId: 'workspace', conversationId: 'conversation', runId: 'run', jobId: 'job' }
  const candidate: ImageResultView = { ...owner, source: 'builtin', applications: [], job: {
    version: 1, jobId: 'job', runId: 'run', documentId: 'document', requestDigest: 'digest', stopped: false,
    createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z', operation: 'generate', status: 'ready', resources: [],
    provenance: { executor: 'guoling-direct-chatgpt-images', endpoint: 'https://chatgpt.com/backend-api/codex/images/generations',
      connectionId: 'connection', connectionRevision: 1, accountId: 'account', authKind: 'oauth', billing: { kind: 'subscription' },
      references: [], querySupport: 'unavailable', charge: 'unknown', requestedImageModel: 'selected-image' },
  } }
  const applied: ImageResultView = { ...candidate, applications: [{ actionId: 'application', documentId: 'document', result: {
    status: 'applied', operationId: 'application', documentId: 'document', beforeRevision: 0, revision: 1, persistence: 'recoverable',
  } }] }
  let emit: (event: ImageResultEvent) => void = () => {}, releaseOldRead: (value: ImageResultView) => void = () => {}
  let reads = 0
  const api: ImageResultsDesktopAPI = { list: vi.fn(async () => [candidate]),
    read: vi.fn(() => ++reads === 2 ? new Promise<ImageResultView>(resolve => { releaseOldRead = resolve }) : Promise.resolve(reads >= 3 ? applied : candidate)),
    subscribe: listener => { emit = listener; return () => {} }, preview: vi.fn(), apply: vi.fn(), edit: vi.fn(), stop: vi.fn(),
  }
  const event = (sequence: number, type: ExecutionEvent['type'], itemId: string, data: ExecutionEvent['data']): ExecutionEvent => ({
    eventId: `event${sequence}`, conversationId: owner.conversationId, runId: owner.runId, taskId: 'task', itemId,
    sequence, time: sequence, source: 'builtin', type, update: 'snapshot', data,
  })
  let projection = foldExecutionEvents(emptyExecutionProjection(owner.conversationId), [event(1, 'image', 'image', { jobId: owner.jobId, status: 'ready', label: '生成图片' })])
  const { container, rerender } = render(<ExecutionTimeline projection={projection} imageResults={api} workspaceId={owner.workspaceId} />)
  const details = container.querySelector<HTMLDetailsElement>('.execution-timeline__card--image>details')!
  act(() => { details.open = true; fireEvent(details, new Event('toggle')) })
  await screen.findByText('图片已生成')
  act(() => emit(candidate))
  await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
  expect(screen.queryByText('已有正式应用记录')).toBeNull()
  projection = foldExecutionEvents(projection, [event(2, 'document.commit', 'apply:commit', {
    operationId: 'application', documentId: 'document', revision: 1, applicationStatus: 'applied', status: 'applied',
  })])
  rerender(<ExecutionTimeline projection={projection} imageResults={api} workspaceId={owner.workspaceId} />)
  await screen.findByText('已有正式应用记录')
  expect(screen.getByText(/已应用 1 次/)).toBeVisible()
  await act(async () => releaseOldRead(candidate))
  expect(screen.getByText('已有正式应用记录')).toBeVisible()
  projection = foldExecutionEvents(projection, [event(3, 'text', 'explanation', { text: '图片已应用，继续整理内容。' })])
  rerender(<ExecutionTimeline projection={projection} imageResults={api} workspaceId={owner.workspaceId} />)
  await act(async () => {})
  expect(api.read).toHaveBeenCalledTimes(3)
  expect(api.apply).not.toHaveBeenCalled()
})
