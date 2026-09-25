import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { WorkspaceRecoveryPanel } from '../../src/renderer/workbench/WorkspaceRecoveryPanel'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'

const roots: string[] = []
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
afterEach(async () => {
  cleanup()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test root')
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-recovery-panel-'))
  roots.push(root)
  const journal = path.join(root, 'recovery')
  return { root, original: new DocumentHostService(journal), restart: () => new DocumentHostService(journal) }
}

function panelApi(host: DocumentHostService) {
  return {
    recoverable: vi.fn(() => host.internalAPI.recoverable()),
    restore: vi.fn((documentId: string) => host.internalAPI.restore(documentId)),
    discardRecovery: vi.fn(async (documentId: string) => { await host.operate({ type: 'discard-recovery', documentId }) }),
    subscribe: vi.fn(() => () => undefined),
  } satisfies Pick<DocumentHostAPI, 'recoverable' | 'restore' | 'discardRecovery' | 'subscribe'>
}

async function editMarkdown(host: DocumentHostService, snapshot: DocumentSnapshot, source: string) {
  expect(await host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
    operationId: `edit-${snapshot.documentId}`, actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source } },
  })).toMatchObject({ status: 'applied' })
}

it('lists every Main recovery draft and retries navigation without restoring a second time', async () => {
  const { original, restart } = await fixture()
  const markdown = await original.internalAPI.create({ kind: 'markdown', source: '', resources: { assets: {}, components: {} } }, '未命名文档.md')
  await editMarkdown(original, markdown, '# 崩溃前的正文')
  const course = await original.internalAPI.create({ kind: 'course-v9', project: createBlankCourseProject({ title: '待恢复课件', includeDefaultController: false, controls: 'none' }),
    resources: { assets: {}, components: {} } }, '待恢复课件.h5lesson')
  if (course.model.kind !== 'course-v9') throw new Error('course fixture')
  expect(await original.internalAPI.dispatch({ documentId: course.documentId, epoch: course.epoch, baseRevision: course.revision,
    operationId: 'course-edit', actor: 'human', mutation: { type: 'command', command: { type: 'course.replace', project: { ...course.model.project, title: '待恢复课件（编辑）' } } },
  })).toMatchObject({ status: 'applied' })

  const host = restart(), api = panelApi(host), oldList = await host.internalAPI.recoverable()
  const onRestored = vi.fn().mockRejectedValueOnce(new Error('视图尚未就绪')).mockResolvedValue(undefined)
  render(<WorkspaceRecoveryPanel api={api} onRestored={onRestored} />)
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
  expect(screen.getByText('未命名文档.md')).toBeTruthy()
  expect(screen.getByText('待恢复课件（编辑）.h5lesson')).toBeTruthy()
  const row = screen.getByText('未命名文档.md').closest('li')!
  fireEvent.click(within(row).getByRole('button', { name: '恢复并打开' }))
  await waitFor(() => expect(within(row).getByRole('button', { name: '打开已恢复稿' })).toBeTruthy())
  expect(within(row).getByRole('alert').textContent).toContain('视图尚未就绪')
  expect(api.restore).toHaveBeenCalledExactlyOnceWith(markdown.documentId)
  const restored = await host.internalAPI.read(markdown.documentId)
  expect(restored).toMatchObject({ dirty: true, undoDepth: 1, model: { source: '# 崩溃前的正文' } })
  const lateRefresh = deferred<DocumentSnapshot[]>()
  api.recoverable.mockImplementationOnce(() => lateRefresh.promise)
  fireEvent.click(screen.getByRole('button', { name: '刷新列表' }))
  fireEvent.click(within(row).getByRole('button', { name: '打开已恢复稿' }))
  await waitFor(() => expect(screen.queryByText('未命名文档.md')).toBeNull())
  await act(async () => { lateRefresh.resolve(oldList); await lateRefresh.promise })
  expect(screen.queryByText('未命名文档.md')).toBeNull()
  expect(api.restore).toHaveBeenCalledTimes(1)
  expect(onRestored).toHaveBeenCalledTimes(2)
  expect(screen.getByText('待恢复课件（编辑）.h5lesson')).toBeTruthy()
})

it('requires explicit discard confirmation and leaves the user file untouched', async () => {
  const { root, original, restart } = await fixture()
  const filename = path.join(root, '教师原稿.md')
  await fs.writeFile(filename, '# 磁盘原稿')
  const opened = await original.open(filename)
  await editMarkdown(original, opened, '# 未保存修改')
  const host = restart(), api = panelApi(host), oldList = await host.internalAPI.recoverable()
  render(<WorkspaceRecoveryPanel api={api} onRestored={vi.fn()} />)
  const row = (await screen.findByText('教师原稿.md')).closest('li')!
  fireEvent.click(within(row).getByRole('button', { name: '丢弃恢复稿' }))
  expect(api.discardRecovery).not.toHaveBeenCalled()
  expect(await fs.readFile(filename, 'utf8')).toBe('# 磁盘原稿')
  fireEvent.click(within(row).getByRole('button', { name: '取消' }))
  expect(api.discardRecovery).not.toHaveBeenCalled()
  const lateRefresh = deferred<DocumentSnapshot[]>()
  api.recoverable.mockImplementationOnce(() => lateRefresh.promise)
  fireEvent.click(screen.getByRole('button', { name: '刷新列表' }))
  fireEvent.click(within(row).getByRole('button', { name: '丢弃恢复稿' }))
  fireEvent.click(within(row).getByRole('button', { name: '确认丢弃恢复稿' }))
  await waitFor(() => expect(screen.queryByText('教师原稿.md')).toBeNull())
  await act(async () => { lateRefresh.resolve(oldList); await lateRefresh.promise })
  expect(screen.queryByText('教师原稿.md')).toBeNull()
  expect(api.discardRecovery).toHaveBeenCalledExactlyOnceWith(opened.documentId)
  expect(await host.internalAPI.recoverable()).toEqual([])
  expect(await fs.readFile(filename, 'utf8')).toBe('# 磁盘原稿')
})

it('defers recovery without changing drafts and reopens the list from its compact entry', async () => {
  const { original, restart } = await fixture()
  const draft = await original.internalAPI.create({ kind: 'markdown', source: '', resources: { assets: {}, components: {} } }, '稍后恢复.md')
  await editMarkdown(original, draft, '# 未保存的内容')
  const host = restart(), api = panelApi(host)
  render(<WorkspaceRecoveryPanel api={api} onRestored={vi.fn()} />)
  await screen.findByText('稍后恢复.md')

  fireEvent.click(screen.getByRole('button', { name: '稍后处理' }))
  const reopen = screen.getByRole('button', { name: '恢复稿（1）' })
  expect(reopen.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByText('稍后恢复.md')).toBeNull()
  expect(api.restore).not.toHaveBeenCalled()
  expect(api.discardRecovery).not.toHaveBeenCalled()
  expect((await host.internalAPI.recoverable()).map(item => item.documentId)).toEqual([draft.documentId])

  fireEvent.click(reopen)
  expect(await screen.findByText('稍后恢复.md')).toBeTruthy()
  expect(screen.getByRole('button', { name: '恢复并打开' })).toBeTruthy()
})
