import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import type { ExecutionTimelineEntryPage, ExecutionTimelineGroupRequest, ExecutionTimelineWindowControl } from '../../src/shared/workbench/executionTimelineWindow'

const roots: string[] = [], services: ExecutionDesktopService[] = []
afterEach(async () => {
  cleanup()
  for (const service of services.splice(0)) { await service.shutdown(); await service.events.flushMaintenance() }
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture')
    await fs.rm(root, { recursive: true, force: true })
  }
})
it('continues and returns within real tool/file group pages through the strict Desktop request contract', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-group-page-')); roots.push(root)
  const workspaceRoot = path.join(root, 'workspace'); await fs.mkdir(workspaceRoot)
  const service = new ExecutionDesktopService({ directory: path.join(root, 'desktop'), documents: new DocumentHostService(path.join(root, 'journals')),
    settings: new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: { isEncryptionAvailable: () => true,
      encryptString: text => Buffer.from(text), decryptString: value => Buffer.from(value).toString() } }),
    authorizeWorkspaceRoot: async value => ({ resolvedPath: await fs.realpath(value) }) }); services.push(service)
  const space = await service.operate({ type: 'workspace', root: workspaceRoot }) as { workspace: { workspaceId: string } }
  const conversation = await service.conversations.createConversation({ workspaceId: space.workspace.workspaceId })
  const input = { workspaceId: conversation.workspaceId, conversationId: conversation.conversationId, userHistoryRevision: conversation.revision, consumerId: 'group-ui' }
  const client = { id: 'group-window', isCurrent: () => true }
  service.events.retain(conversation.conversationId, 'run:fixture')
  await service.events.batchAppend(Array.from({ length: 230 }, (_, index) => ({ eventId: `event-${index}`, conversationId: conversation.conversationId,
    taskId: 'task', runId: 'run', itemId: `file-${index}`, time: index, source: 'builtin' as const, type: 'tool' as const, update: 'snapshot' as const,
    data: { toolName: 'file.save', status: 'completed', saveStatus: 'saved' as const, documentName: `结果${index}.md`, label: `保存${index}` } })))
  const initial = await service.operate({ type: 'timeline-window', ...input }, client) as ExecutionTimelineEntryPage
  const requests: ExecutionTimelineGroupRequest[] = []
  function Host() {
    const [page, setPage] = useState(initial)
    const control: ExecutionTimelineWindowControl = { page,
      readPage: async request => { const next = await service.operate({ type: 'timeline-window', ...input, ...request }, client) as ExecutionTimelineEntryPage; setPage(next); return next },
      readGroup: async request => { requests.push(request); return service.operate({ type: 'timeline-group', ...input, ...request }, client) as ReturnType<ExecutionTimelineWindowControl['readGroup']> },
      readBody: async request => service.operate({ type: 'timeline-body', ...input, ...request }, client) as ReturnType<ExecutionTimelineWindowControl['readBody']>,
    }
    return <div className="execution-assistant__history"><ExecutionTimeline window={control} onOpenSavedFile={vi.fn()} /></div>
  }
  const view = render(<Host />)
  const details = view.container.querySelector('details')!
  act(() => { details.open = true; fireEvent(details, new Event('toggle')) })
  expect(view.container.querySelectorAll('.execution-timeline__card')).toHaveLength(100)
  fireEvent.click(screen.getByRole('button', { name: /读取组内后续记录/ }))
  await waitFor(() => expect(requests.at(-1)).toMatchObject({ itemStart: 100, itemLimit: 100 }))
  await screen.findByText('保存100')
  expect(view.container.querySelectorAll('.execution-timeline__card')).toHaveLength(100)
  fireEvent.click(screen.getByRole('button', { name: '读取组内更早记录' }))
  await screen.findByText('保存0')
  expect(requests.at(-1)).toMatchObject({ itemStart: 0, itemLimit: 100 })
  fireEvent.click(screen.getByRole('button', { name: /读取后续已保存文件/ }))
  const files = within(view.container.querySelector('.execution-timeline__group-files')! as HTMLElement)
  await files.findByRole('button', { name: '打开文件：结果100.md' })
  expect(requests.at(-1)).toMatchObject({ fileStart: 100, fileLimit: 100 })
  expect(files.queryByRole('button', { name: '打开文件：结果0.md' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '读取更早已保存文件' }))
  await files.findByRole('button', { name: '打开文件：结果0.md' })
  expect(requests.at(-1)).toMatchObject({ fileStart: 0, fileLimit: 100 })
  expect(screen.queryByRole('alert')).toBeNull()
})
