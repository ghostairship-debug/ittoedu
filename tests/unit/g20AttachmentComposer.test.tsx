import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { randomUUID } from 'node:crypto'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AttachmentComposer } from '../../src/renderer/workbench/attachments/AttachmentComposer'
import { AttachmentService } from '../../src/main/workbench/attachments/AttachmentService'
import { WorkspaceFiles } from '../../src/main/workbench/WorkspaceFiles'
import { WorkspaceFilesDesktopService } from '../../src/main/workbench/workspaceFilesDesktopService'
import type { AttachmentsDesktopAPI } from '../../src/shared/workbench/attachmentsDesktop'
import type { InputAttachmentReference } from '../../src/shared/workbench/attachments'

const roots: string[] = [], disposers: (() => void)[] = []
beforeEach(() => { vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:fixture'), revokeObjectURL: vi.fn() })) })
afterEach(async () => { cleanup(); disposers.splice(0).forEach(dispose => dispose()); vi.unstubAllGlobals(); vi.restoreAllMocks(); for (const root of roots.splice(0)) { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture root'); await fs.rm(root, { force: true, recursive: true }) } })
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-composer-')); roots.push(root)
  const grants = new Map<string, string>()
  const store = new AttachmentService({ directory: path.join(root, 'managed'), resolveAuthorizedPath: async id => { const filename = grants.get(id); if (!filename) throw new Error('not authorized'); return { path: filename, kind: 'workspace' } } })
  const files = new WorkspaceFilesDesktopService(new WorkspaceFiles()); disposers.push(() => files.dispose()); await files.authorizeRoot(root)
  const api: AttachmentsDesktopAPI = {
    select: async () => [], clipboardFiles: vi.fn(async () => []),
    workspaceFiles: async input => Promise.all(input.entryIds.map(async entryId => { const entry = await files.operate({ type: 'resolve', workspaceId: input.workspaceId, entryId }); const authorizationId = randomUUID(); grants.set(authorizationId, entry.resolvedPath); return { authorizationId, name: path.basename(entry.resolvedPath) } })),
    release: async ids => { ids.forEach(id => grants.delete(id)) }, receiveGranted: input => store.receivePath(input),
    receive: input => store.receiveBytes({ name: input.name, bytes: input.bytes, source: { kind: input.source }, declaredMediaType: input.mediaType }),
    snapshot: id => store.readSnapshot(id), extract: input => store.extract(input.attachmentId, { pages: input.pages }),
    readRepresentation: (id, representation) => store.readRepresentation(id, representation), cancel: vi.fn(async () => {}),
  }
  return { root, api, files, store }
}
function Harness({ api, directory, changed }: { api: AttachmentsDesktopAPI; directory?: string; changed(value: InputAttachmentReference[]): void }) {
  const [value, setValue] = useState<InputAttachmentReference[]>([]), [busy, setBusy] = useState(false)
  return <><textarea aria-label="正文" /><AttachmentComposer api={api} workspaceDirectory={directory} value={value} onChange={next => { setValue(next); changed(next) }} onBusyChange={setBusy}><textarea aria-label="聊天" data-attachment-paste-target /></AttachmentComposer><button disabled={busy || !value.length}>发送附件</button></>
}
it('keeps screenshot bytes path-free, deduplicates mixed HTML paste, and leaves ordinary text/body paste native', async () => {
  const f = await fixture(); let refs: InputAttachmentReference[] = []
  render(<Harness api={f.api} changed={value => { refs = value }} />)
  const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ff9900' } }).png().toBuffer()
  const image = new File([png], '截图.png', { type: 'image/png' })
  fireEvent.paste(screen.getByLabelText('聊天'), { clipboardData: { files: [image], items: [{ kind: 'file', getAsFile: () => image }], getData: () => '<img src="duplicate">' } })
  await waitFor(() => expect(refs).toHaveLength(1))
  const snapshot = await f.store.readSnapshot(refs[0].attachmentId)
  expect(snapshot.source).toEqual({ kind: 'paste', readOnly: true }); expect(snapshot.representations[0]).toMatchObject({ kind: 'image', width: 1, height: 1 })
  expect(Buffer.from((await f.store.readRepresentation(snapshot.id, refs[0].representationId)).bytes)).toEqual(png)
  await waitFor(() => expect(screen.getByRole('button', { name: '发送附件' })).not.toBeDisabled())
  expect(fireEvent.paste(screen.getByLabelText('聊天'), { clipboardData: { files: [], items: [], getData: () => '普通文本' } })).toBe(true)
  expect(fireEvent.paste(screen.getByLabelText('正文'), { clipboardData: { files: [image], items: [], getData: () => '' } })).toBe(true)
  expect(f.api.clipboardFiles).not.toHaveBeenCalled(); expect(refs).toHaveLength(1)
})
it('preserves successful same-name snapshots across a retry and cancelled late result, and references real workspace files through the same intake', async () => {
  const f = await fixture(); let refs: InputAttachmentReference[] = [], failed = false, release!: () => void
  const original = f.api.receive
  f.api.receive = async input => {
    if (input.name === 'retry.txt' && !failed) { failed = true; throw new Error('暂时读取失败') }
    if (input.name === 'slow.txt') await new Promise<void>(resolve => { release = resolve })
    return original(input)
  }
  const prior = window.desktopAPI; Object.defineProperty(window, 'desktopAPI', { value: { ...prior, workspaceFiles: f.files.operate }, configurable: true }); disposers.push(() => Object.defineProperty(window, 'desktopAPI', { value: prior, configurable: true }))
  await fs.writeFile(path.join(f.root, 'reference.md'), 'frozen reference')
  render(<Harness api={f.api} directory={f.root} changed={value => { refs = value }} />)
  fireEvent.drop(screen.getByLabelText('聊天'), { dataTransfer: { files: [new File(['A'], 'same.txt'), new File(['B'], 'same.txt'), new File(['retry'], 'retry.txt'), new File(['late'], 'slow.txt')], getData: () => '' } })
  await waitFor(() => expect(refs).toHaveLength(2))
  const first = await f.store.readSnapshot(refs[0].attachmentId), second = await f.store.readSnapshot(refs[1].attachmentId)
  expect(first.name).toBe(second.name); expect(first.digest).not.toBe(second.digest)
  expect(screen.getByRole('button', { name: '发送附件' })).toBeDisabled()
  const failure = await screen.findByLabelText('附件准备：retry.txt')
  await waitFor(() => expect(within(failure).getByRole('button', { name: '重试' })).not.toBeDisabled())
  fireEvent.click(within(failure).getByRole('button', { name: '重试' })); await waitFor(() => expect(refs).toHaveLength(3))
  const slow = screen.getByLabelText('附件准备：slow.txt'); fireEvent.click(within(slow).getByRole('button', { name: '取消处理' }))
  await act(async () => { release() })
  expect(refs).toHaveLength(3); expect(f.api.cancel).toHaveBeenCalled()
  fireEvent.click(within(screen.getByLabelText('附件准备：slow.txt')).getByRole('button', { name: '移除失败项' }))
  fireEvent.click(screen.getByRole('button', { name: '@ 引用空间文件' }))
  const reference = await screen.findByRole('button', { name: '引用：reference.md' }); await waitFor(() => expect(reference).not.toBeDisabled()); fireEvent.click(reference)
  await waitFor(() => expect(refs).toHaveLength(4))
  const snapshot = await f.store.readSnapshot(refs[3].attachmentId); expect(snapshot.source.kind).toBe('workspace')
  await fs.writeFile(path.join(f.root, 'reference.md'), 'changed original')
  expect(new TextDecoder().decode((await f.store.readRepresentation(snapshot.id, refs[3].representationId)).bytes)).toBe('frozen reference')
  const root = await f.files.operate({ type: 'root', directory: f.root }), listing = await f.files.operate({ type: 'list', workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })
  const entry = listing.entries.find(item => item.status === 'accessible' && item.name === 'reference.md')! as { entryId: string }
  fireEvent.drop(screen.getByLabelText('聊天'), { dataTransfer: { files: [], getData: () => JSON.stringify({ workspaceId: root.workspaceId, ids: [entry.entryId] }) } })
  await waitFor(() => expect(refs).toHaveLength(5))
  expect((await f.store.readSnapshot(refs[4].attachmentId)).digest).not.toBe(snapshot.digest)
})
