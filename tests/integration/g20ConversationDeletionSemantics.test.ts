// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(root, { recursive: true, force: true })
  }
})
async function missing(filename: string): Promise<boolean> {
  try { await fs.stat(filename); return false }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error }
}
async function eventuallyMissing(filename: string) {
  const deadline = Date.now() + 1500
  while (!(await missing(filename)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  expect(await missing(filename), filename).toBe(true)
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-conversation-delete-')); roots.push(root)
  const workspaceRoot = path.join(root, 'user-workspace'), serviceRoot = path.join(root, 'app-state')
  await fs.mkdir(workspaceRoot)
  const aPath = path.join(workspaceRoot, 'a.md'), bPath = path.join(workspaceRoot, 'b.md')
  await fs.writeFile(aPath, '# A\n'); await fs.writeFile(bPath, '# B\n')
  const documents = new DocumentHostService(path.join(root, 'document-state'), { trashItem: filename => fs.rm(filename) })
  const a = await documents.open(aPath), b = await documents.open(bPath)
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: {
    isEncryptionAvailable: async () => true,
    encryptString: async value => Buffer.from(value),
    decryptString: async bytes => Buffer.from(bytes).toString(),
  } })
  const desktop = new ExecutionDesktopService({ directory: serviceRoot, documents, settings,
    authorizeWorkspaceRoot: async selected => ({ resolvedPath: selected }) })
  const space = await desktop.operate({ type: 'workspace', root: workspaceRoot }) as { workspace: { workspaceId: string } }
  const sharedBytes = Buffer.from('shared snapshot bytes'), uniqueBytes = Buffer.from('first conversation only')
  const shared = await desktop.attachments.receiveBytes({ name: 'shared.txt', bytes: sharedBytes, source: { kind: 'paste' } })
  const duplicate = await desktop.attachments.receiveBytes({ name: 'same-blob.txt', bytes: sharedBytes, source: { kind: 'drop' } })
  const unique = await desktop.attachments.receiveBytes({ name: 'unique.txt', bytes: uniqueBytes, source: { kind: 'drop' } })
  const draftOnly = await desktop.attachments.receiveBytes({ name: 'draft.txt', bytes: Buffer.from('draft only'), source: { kind: 'paste' } })
  const messageOnly = await desktop.attachments.receiveBytes({ name: 'message.txt', bytes: Buffer.from('message only'), source: { kind: 'paste' } })
  const create = async () => desktop.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as Promise<ConversationRecord>
  let first = await create(), second = await create()
  // Seed durable conversation references while leaving model execution out of this deletion test.
  first = await desktop.conversations.updateConversation({ workspaceId: first.workspaceId, conversationId: first.conversationId,
    expectedRevision: first.revision, patch: { attachmentIds: [unique.id, shared.id],
      inputAttachments: [{ attachmentId: draftOnly.id, representationId: 'original-text' }, { attachmentId: shared.id, representationId: 'original-text' }],
      messages: [{ messageId: 'first-message', role: 'user', text: '附件已发送', createdAt: Date.now(), attachmentIds: [messageOnly.id] }],
      frozenContextRefs: [
        { contextRefId: 'first-a', documentId: a.documentId, revision: a.revision, epoch: a.epoch },
        { contextRefId: 'first-b', documentId: b.documentId, revision: b.revision, epoch: b.epoch },
      ] } })
  second = await desktop.conversations.updateConversation({ workspaceId: second.workspaceId, conversationId: second.conversationId,
    expectedRevision: second.revision, patch: { attachmentIds: [shared.id, duplicate.id],
      inputAttachments: [{ attachmentId: shared.id, representationId: 'original-text' }],
      frozenContextRefs: [{ contextRefId: 'second-b', documentId: b.documentId, revision: b.revision, epoch: b.epoch }] } })
  const filesRoot = await documents.files.registerRoot(workspaceRoot)
  return { root, workspaceRoot, serviceRoot, desktop, documents, settings, first, second, a, b, aPath, bPath, shared, duplicate, unique,
    draftOnly, messageOnly, sharedBytes, filesRoot }
}

it('deleting a conversation preserves both user documents; trashing a referenced file preserves the other conversation and its attachment', async () => {
  const { desktop, documents, first, second, a, aPath, bPath, shared, sharedBytes, filesRoot } = await fixture()
  await desktop.operate({ type: 'delete-conversation', workspaceId: first.workspaceId, conversationId: first.conversationId,
    expectedRevision: first.revision })
  expect(await desktop.operate({ type: 'conversation', workspaceId: first.workspaceId, conversationId: first.conversationId })).toBeNull()
  await expect(desktop.operate({ type: 'draft', workspaceId: first.workspaceId, conversationId: first.conversationId,
    expectedRevision: first.revision, text: '迟到引用', documents: [], attachments: [] })).rejects.toThrow()
  expect(await fs.readFile(aPath, 'utf8')).toBe('# A\n')
  expect(await fs.readFile(bPath, 'utf8')).toBe('# B\n')
  expect((await documents.internalAPI.read(a.documentId)).binding).toMatchObject({ kind: 'file', path: aPath })

  const listed = await documents.files.listChildren({ workspaceId: filesRoot.workspaceId, directoryEntryId: filesRoot.rootEntryId })
  const bEntry = listed.entries.find(entry => entry.status === 'accessible' && entry.name === 'b.md')
  if (!bEntry || bEntry.status !== 'accessible') throw new Error('Missing real file entry')
  expect(await documents.files.trash({ operationId: 'trash-b', workspaceId: filesRoot.workspaceId, entryIds: [bEntry.entryId] })).toMatchObject({ status: 'success' })
  expect(await missing(bPath)).toBe(true)
  expect(await fs.readFile(aPath, 'utf8')).toBe('# A\n')
  expect(await desktop.operate({ type: 'conversation', workspaceId: second.workspaceId, conversationId: second.conversationId })).toEqual(second)
  expect(Buffer.from((await desktop.attachments.readRepresentation(shared.id, 'original-text')).bytes)).toEqual(sharedBytes)
})

it('releases only unreferenced managed attachment snapshots and blobs after the last owning conversation is deleted', async () => {
  const { serviceRoot, desktop, first, second, shared, duplicate, unique, draftOnly, messageOnly, sharedBytes } = await fixture()
  const attachmentsRoot = path.join(serviceRoot, 'attachments')
  const uniqueSnapshot = path.join(attachmentsRoot, 'snapshots', `${unique.id}.json`)
  const uniqueBlob = path.join(attachmentsRoot, 'blobs', unique.digest)
  const sharedSnapshot = path.join(attachmentsRoot, 'snapshots', `${shared.id}.json`)
  const sharedBlob = path.join(attachmentsRoot, 'blobs', shared.digest)
  const duplicateSnapshot = path.join(attachmentsRoot, 'snapshots', `${duplicate.id}.json`)
  expect(duplicate.digest).toBe(shared.digest)
  expect(await missing(uniqueBlob)).toBe(false)
  expect(await missing(sharedBlob)).toBe(false)

  await desktop.operate({ type: 'delete-conversation', workspaceId: first.workspaceId, conversationId: first.conversationId,
    expectedRevision: first.revision })
  await eventuallyMissing(uniqueSnapshot)
  await eventuallyMissing(uniqueBlob)
  for (const removed of [draftOnly, messageOnly]) {
    await eventuallyMissing(path.join(attachmentsRoot, 'snapshots', `${removed.id}.json`))
    await eventuallyMissing(path.join(attachmentsRoot, 'blobs', removed.digest))
  }
  expect(Buffer.from((await desktop.attachments.readRepresentation(shared.id, 'original-text')).bytes)).toEqual(sharedBytes)
  expect(Buffer.from((await desktop.attachments.readRepresentation(duplicate.id, 'original-text')).bytes)).toEqual(sharedBytes)
  await desktop.operate({ type: 'delete-conversation', workspaceId: second.workspaceId, conversationId: second.conversationId,
    expectedRevision: second.revision })
  await eventuallyMissing(sharedSnapshot)
  await eventuallyMissing(duplicateSnapshot)
  await eventuallyMissing(sharedBlob)
})

it('reconciles durable release intent after interruption and keeps an owner that survived a failed deletion', async () => {
  const { workspaceRoot, serviceRoot, desktop, documents, settings, first, unique } = await fixture()
  const intent = { version: 1 as const, workspaceId: first.workspaceId, conversationId: first.conversationId, attachmentIds: [unique.id] }
  await desktop.attachments.prepareConversationRelease(intent)
  const restart = () => new ExecutionDesktopService({ directory: serviceRoot, documents, settings,
    authorizeWorkspaceRoot: async selected => ({ resolvedPath: selected }) })
  const stillOwned = restart()
  await stillOwned.operate({ type: 'workspace', root: workspaceRoot })
  expect(await stillOwned.operate({ type: 'conversation', workspaceId: first.workspaceId, conversationId: first.conversationId })).toEqual(first)
  expect((await stillOwned.attachments.readRepresentation(unique.id, 'original-text')).snapshot.id).toBe(unique.id)

  await stillOwned.conversations.deleteConversation({ workspaceId: first.workspaceId, conversationId: first.conversationId,
    expectedRevision: first.revision, ports: { stopBuiltinRuns: async () => undefined, revokeExternalPorts: async () => undefined,
      prepareResourceRelease: async () => stillOwned.attachments.prepareConversationRelease(intent) } })
  const afterCrash = restart()
  await afterCrash.operate({ type: 'workspace', root: workspaceRoot })
  await eventuallyMissing(path.join(serviceRoot, 'attachments', 'snapshots', `${unique.id}.json`))
  await eventuallyMissing(path.join(serviceRoot, 'attachments', 'blobs', unique.digest))
})
