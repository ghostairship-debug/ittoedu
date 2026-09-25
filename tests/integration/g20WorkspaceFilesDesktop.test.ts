// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WorkspaceFiles } from '../../src/main/workbench/WorkspaceFiles'
import { WorkspaceFilesDesktopService } from '../../src/main/workbench/workspaceFilesDesktopService'
import { ConversationStore } from '../../src/main/workbench/conversations/ConversationStore'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) { if (!root.startsWith(os.tmpdir())) throw new Error('Invalid temp root'); await fs.rm(root, { recursive: true, force: true }) } })
it('authorizes only confirmed roots and routes strict handle-based requests through the real file owner', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-file-desktop-')); roots.push(directory)
  const service = new WorkspaceFilesDesktopService(new WorkspaceFiles())
  await expect(service.operate({ type: 'root', directory })).rejects.toThrow('授权')
  const root = await service.authorizeRoot(directory)
  expect(await service.operate({ type: 'root', directory })).toEqual(root)
  const request = { type: 'create-markdown' as const, workspaceId: root.workspaceId, operationId: 'create', targetDirectoryId: root.rootEntryId, name: 'note.md' }
  const created = await service.operate(request)
  expect(created.status).toBe('success')
  expect(await service.operate(request)).toEqual(created)
  const listing = await service.operate({ type: 'list', workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })
  expect(listing.entries).toHaveLength(1)
  const entryId = created.items[0]!.entryId!
  const renamed = await service.operate({ type: 'rename', workspaceId: root.workspaceId, operationId: 'rename', sourceEntryId: entryId, name: 'new.md' })
  expect(renamed.status).toBe('success')
  expect((await service.operate({ type: 'resolve', workspaceId: root.workspaceId, entryId })).resolvedPath).toBe(path.join(directory, 'new.md'))
  expect(await fs.readFile(path.join(directory, 'new.md'), 'utf8')).toBe('# note\n\n')
  await expect(service.operate({ ...request, operationId: 'forged', directory: os.tmpdir() } as never)).rejects.toThrow()
  await expect(service.operate({ ...request, operationId: 'overwrite', overwrite: true } as never)).rejects.toThrow()
  await expect(service.operate({ type: 'list', workspaceId: 'unknown', directoryEntryId: root.rootEntryId })).rejects.toThrow('授权')
})
it('returns per-item failures and preserves originals when the system trash rejects an authorized request', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-file-trash-')); roots.push(directory)
  await fs.writeFile(path.join(directory, 'keep.md'), 'keep')
  const service = new WorkspaceFilesDesktopService(new WorkspaceFiles({ trashItem: async () => { throw new Error('trash unavailable') } }))
  const root = await service.authorizeRoot(directory), page = await service.operate({ type: 'list', workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })
  const item = page.entries[0]!; if (item.status !== 'accessible') throw new Error('Missing fixture')
  const result = await service.operate({ type: 'trash', workspaceId: root.workspaceId, operationId: 'trash', entryIds: [item.entryId, 'missing-handle'] })
  expect(result.status).toBe('failed')
  expect(result.items).toHaveLength(2)
  expect(result.items[0]!.error?.message).toBe('trash unavailable')
  expect(result.items[1]!.error?.code).toBe('unknown-entry')
  expect(await fs.readFile(path.join(directory, 'keep.md'), 'utf8')).toBe('keep')
})
it('moves conversation homes only after successful in-app file operations and marks deleted homes without deleting conversations', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-file-home-')); roots.push(directory)
  const source = path.join(directory, 'source'), destination = path.join(directory, 'destination')
  await fs.mkdir(source); await fs.mkdir(destination)
  const store = new ConversationStore({ directory: path.join(directory, 'metadata') })
  const service = new WorkspaceFilesDesktopService(new WorkspaceFiles({ trashItem: filename => fs.rm(filename, { recursive: true }) }),
    async input => { await store.relocateHomes({ workspaceId: input.workspaceId, changes: input.changes }) })
  const sourceRoot = await service.authorizeRoot(source), targetRoot = await service.authorizeRoot(destination)
  await store.registerWorkspace({ workspaceId: sourceRoot.workspaceId, rootPath: sourceRoot.resolvedPath, managed: false, authorization: 'user-selected' })
  await store.registerWorkspace({ workspaceId: targetRoot.workspaceId, rootPath: targetRoot.resolvedPath, managed: false, authorization: 'user-selected' })
  const notified: string[] = []
  service.subscribe(event => notified.push(event.workspaceId))
  const folder = await service.operate({ type: 'mkdir', workspaceId: sourceRoot.workspaceId, operationId: 'folder', targetDirectoryId: sourceRoot.rootEntryId, name: 'unit' })
  const folderId = folder.items[0]!.entryId!
  const file = await service.operate({ type: 'create-markdown', workspaceId: sourceRoot.workspaceId, operationId: 'file', targetDirectoryId: folderId, name: 'note.md' })
  const conversation = await store.createConversation({ workspaceId: sourceRoot.workspaceId, home: { kind: 'file', path: 'unit/note.md' } })
  const renamed = await service.operate({ type: 'rename', workspaceId: sourceRoot.workspaceId, operationId: 'rename', sourceEntryId: folderId, name: 'chapter' })
  expect(renamed.status).toBe('success')
  expect((await store.readConversation({ workspaceId: sourceRoot.workspaceId, conversationId: conversation.conversationId }))?.home?.path).toBe('chapter/note.md')
  expect(notified).toContain(sourceRoot.workspaceId)
  const moved = await service.operate({ type: 'move', workspaceId: sourceRoot.workspaceId, operationId: 'move', sourceEntryIds: [file.items[0]!.entryId!],
    targetWorkspaceId: targetRoot.workspaceId, targetDirectoryId: targetRoot.rootEntryId })
  expect(moved.status).toBe('success')
  expect(await store.readConversation({ workspaceId: targetRoot.workspaceId, conversationId: conversation.conversationId })).toBeNull()
  expect((await store.readConversation({ workspaceId: sourceRoot.workspaceId, conversationId: conversation.conversationId }))?.home)
    .toMatchObject({ kind: 'file', path: 'note.md', workspaceId: targetRoot.workspaceId })
  expect(notified).toContain(targetRoot.workspaceId)
  const removed = await service.operate({ type: 'trash', workspaceId: targetRoot.workspaceId, operationId: 'trash', entryIds: [file.items[0]!.entryId!] })
  expect(removed.status).toBe('success')
  expect((await store.readConversation({ workspaceId: sourceRoot.workspaceId, conversationId: conversation.conversationId }))?.home)
    .toMatchObject({ kind: 'file', path: 'note.md', workspaceId: targetRoot.workspaceId, missing: true })
})
