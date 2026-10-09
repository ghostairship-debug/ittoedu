import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
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
    restore: vi.fn((documentId: string, mode?: 'original' | 'unbound') => host.operate({ type: 'restore', documentId, ...(mode ? { mode } : {}) }) as Promise<DocumentSnapshot>),
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
  const project = createBlankCourseProjectV10('待恢复课件')
  const course = await original.internalAPI.create({ kind: 'course-v10', project,
    resources: { assets: {}, components: {} } }, '待恢复课件.h5lesson')
  expect(await original.internalAPI.dispatch({ documentId: course.documentId, epoch: course.epoch, baseRevision: course.revision,
    operationId: 'course-edit', actor: 'human', mutation: { type: 'command', command: captureComponentOperation(project, [{ type: 'project.title.set', title: '待恢复课件（编辑）' }]) },
  })).toMatchObject({ status: 'applied' })

  const host = restart(), api = panelApi(host), oldList = await host.internalAPI.recoverable()
  const onRestored = vi.fn().mockRejectedValueOnce(new Error('视图尚未就绪')).mockResolvedValue(undefined)
  render(<WorkspaceRecoveryPanel api={api} onRestored={onRestored} />)
  fireEvent.click(await screen.findByRole('button', { name: '恢复稿（2）' }))
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

it('discards a recovery draft with one click and leaves the user file untouched', async () => {
  const { root, original, restart } = await fixture()
  const filename = path.join(root, '教师原稿.md')
  await fs.writeFile(filename, '# 磁盘原稿')
  const opened = await original.open(filename)
  await editMarkdown(original, opened, '# 未保存修改')
  const host = restart(), api = panelApi(host), oldList = await host.internalAPI.recoverable()
  render(<WorkspaceRecoveryPanel api={api} onRestored={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '恢复稿（1）' }))
  const row = (await screen.findByText('教师原稿.md')).closest('li')!
  expect(api.discardRecovery).not.toHaveBeenCalled()
  expect(await fs.readFile(filename, 'utf8')).toBe('# 磁盘原稿')
  const lateRefresh = deferred<DocumentSnapshot[]>()
  api.recoverable.mockImplementationOnce(() => lateRefresh.promise)
  fireEvent.click(screen.getByRole('button', { name: '刷新列表' }))
  fireEvent.click(within(row).getByRole('button', { name: '丢弃恢复稿' }))
  await waitFor(() => expect(screen.queryByText('教师原稿.md')).toBeNull())
  await act(async () => { lateRefresh.resolve(oldList); await lateRefresh.promise })
  expect(screen.queryByText('教师原稿.md')).toBeNull()
  expect(api.discardRecovery).toHaveBeenCalledExactlyOnceWith(opened.documentId)
  expect(screen.queryByRole('button', { name: '恢复稿（1）' })).toBeNull()
  expect(screen.queryByRole('complementary')).toBeNull()
  expect(await host.internalAPI.recoverable()).toEqual([])
  expect(await fs.readFile(filename, 'utf8')).toBe('# 磁盘原稿')
})

it('starts collapsed, closes without changing drafts, and reopens from its toolbar entry', async () => {
  const { original, restart } = await fixture()
  const draft = await original.internalAPI.create({ kind: 'markdown', source: '', resources: { assets: {}, components: {} } }, '稍后恢复.md')
  await editMarkdown(original, draft, '# 未保存的内容')
  const host = restart(), api = panelApi(host)
  render(<WorkspaceRecoveryPanel api={api} onRestored={vi.fn()} />)
  const reopen = await screen.findByRole('button', { name: '恢复稿（1）' })
  expect(reopen.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByText('稍后恢复.md')).toBeNull()
  expect(api.restore).not.toHaveBeenCalled()
  expect(api.discardRecovery).not.toHaveBeenCalled()
  expect((await host.internalAPI.recoverable()).map(item => item.documentId)).toEqual([draft.documentId])

  fireEvent.click(reopen)
  expect(await screen.findByText('稍后恢复.md')).toBeTruthy()
  expect(screen.getByRole('button', { name: '恢复并打开' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  expect(screen.queryByRole('complementary')).toBeNull()
  expect(api.restore).not.toHaveBeenCalled()
  expect(api.discardRecovery).not.toHaveBeenCalled()
  fireEvent.click(reopen)
  expect(await screen.findByText('稍后恢复.md')).toBeTruthy()
})


it('offers an untitled recovery without modifying the original file or losing history', async () => {
  const { root, original, restart } = await fixture(), filename = path.join(root, '恢复来源.md')
  await fs.writeFile(filename, 'disk original')
  const source = await original.open(filename)
  await editMarkdown(original, source, 'unsaved important draft')
  const host = restart(), api = panelApi(host), navigate = vi.fn(async () => undefined)
  render(<WorkspaceRecoveryPanel api={api} onRestored={navigate} />)
  fireEvent.click(await screen.findByRole('button', { name: '恢复稿（1）' }))
  await screen.findByText('恢复来源.md')
  fireEvent.click(screen.getByRole('button', { name: '恢复为未命名稿' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(source.documentId))
  expect(api.restore).toHaveBeenCalledWith(source.documentId, 'unbound')
  expect(await host.internalAPI.read(source.documentId)).toMatchObject({ dirty: true, undoDepth: 1,
    binding: { kind: 'untitled' }, model: { source: 'unsaved important draft' } })
  expect(await fs.readFile(filename, 'utf8')).toBe('disk original')
})

it('shows no toolbar entry or panel when Main has no recovery drafts', async () => {
  const { original } = await fixture(), api = panelApi(original)
  render(<WorkspaceRecoveryPanel api={api} onRestored={vi.fn()} />)
  await waitFor(() => expect(api.recoverable).toHaveBeenCalledOnce())
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.queryByRole('complementary')).toBeNull()
  expect(api.restore).not.toHaveBeenCalled()
  expect(api.discardRecovery).not.toHaveBeenCalled()
})

it('reports discovery failure in a collapsed toolbar entry and refreshes to a genuinely empty silent state', async () => {
  const { original } = await fixture(), api = panelApi(original)
  api.recoverable.mockRejectedValueOnce(new Error('恢复日志暂时无法读取'))
  render(<WorkspaceRecoveryPanel api={api} onRestored={vi.fn()} />)
  const entry = await screen.findByRole('button', { name: '恢复稿 · 列表读取失败' })
  expect(entry.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByRole('complementary')).toBeNull()
  fireEvent.click(entry)
  expect(screen.getByRole('alert').textContent).toContain('恢复日志暂时无法读取')
  expect(screen.getByRole('button', { name: '丢弃全部恢复稿' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '刷新列表' }))
  await waitFor(() => expect(screen.queryByRole('button')).toBeNull())
  expect(screen.queryByRole('complementary')).toBeNull()
  expect(api.recoverable).toHaveBeenCalledTimes(2)
  expect(api.restore).not.toHaveBeenCalled()
  expect(api.discardRecovery).not.toHaveBeenCalled()
})

it('discards all drafts in one click, retains failed drafts, and permits retry without repeating success', async () => {
  const { root, original, restart } = await fixture()
  const firstFile = path.join(root, '第一份原稿.md'), secondFile = path.join(root, '第二份原稿.md')
  await fs.writeFile(firstFile, '# 第一份磁盘原稿')
  await fs.writeFile(secondFile, '# 第二份磁盘原稿')
  const first = await original.open(firstFile), second = await original.open(secondFile)
  await editMarkdown(original, first, '# 第一份未保存修改')
  await editMarkdown(original, second, '# 第二份未保存修改')
  const host = restart(), api = panelApi(host)
  api.discardRecovery.mockImplementationOnce(async () => { throw new Error('恢复稿暂时被占用') })
  render(<WorkspaceRecoveryPanel api={api} onRestored={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '恢复稿（2）' }))
  fireEvent.click(screen.getByRole('button', { name: '丢弃全部恢复稿' }))
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
  expect(screen.getByRole('alert').textContent).toContain('丢弃失败：恢复稿暂时被占用')
  const remaining = await host.internalAPI.recoverable()
  expect(remaining).toHaveLength(1)
  expect(remaining[0].model).toMatchObject({ source: expect.stringContaining('未保存修改') })
  const failedId = remaining[0].documentId
  expect(api.discardRecovery).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: '丢弃全部恢复稿' }))
  await waitFor(() => expect(screen.queryByRole('button')).toBeNull())
  expect(api.discardRecovery).toHaveBeenCalledTimes(3)
  expect(api.discardRecovery).toHaveBeenLastCalledWith(failedId)
  expect(await host.internalAPI.recoverable()).toEqual([])
  expect(await fs.readFile(firstFile, 'utf8')).toBe('# 第一份磁盘原稿')
  expect(await fs.readFile(secondFile, 'utf8')).toBe('# 第二份磁盘原稿')
})
