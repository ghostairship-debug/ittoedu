// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { deserialize } from 'node:v8'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test root')
    await fs.rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-bindings-'))
  roots.push(root)
  const workspace = path.join(root, 'workspace'), recovery = path.join(root, 'recovery')
  await fs.mkdir(workspace)
  return { root, workspace, recovery }
}
async function edit(host: DocumentHostService, snapshot: DocumentSnapshot, source: string) {
  return host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: 'manual-content', actor: 'human', baseRevision: snapshot.revision,
    mutation: { type: 'command', command: { type: 'markdown.replace', source } } })
}

it('hides only an in-flight document save file before paging and never leaves a temporary tree row after rename', async () => {
  const { workspace, recovery } = await fixture()
  const target = path.join(workspace, 'lesson.h5lesson')
  const temporary = path.join(workspace, '.lesson.h5lesson.f4adfb2a-c45d-4fa9-a3ec-f6f477f976ca.tmp')
  await fs.writeFile(target, 'old')
  await fs.writeFile(temporary, 'new')
  await fs.writeFile(path.join(workspace, 'notes.tmp'), 'user file')
  await fs.writeFile(path.join(workspace, '.lesson.h5lesson.not-a-uuid.tmp'), 'user file')
  const files = new DocumentHostService(recovery).files
  const root = await files.registerRoot(workspace)
  const names = async () => {
    const result: string[] = []
    let cursor: string | undefined
    do {
      const page = await files.listChildren({ workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId, limit: 1, cursor })
      result.push(...page.entries.map(entry => entry.name))
      cursor = page.nextCursor
    } while (cursor)
    return result
  }
  const duringSave = await names()
  expect(duringSave).toEqual(expect.arrayContaining(['lesson.h5lesson', 'notes.tmp', '.lesson.h5lesson.not-a-uuid.tmp']))
  expect(duringSave).toHaveLength(3)
  await fs.rename(temporary, target)
  const afterSave = await names()
  expect(afterSave).toEqual(duringSave)
  expect(await fs.readFile(target, 'utf8')).toBe('new')
})

it('S09 moving one Markdown asks for resources, preserves shared originals, and keeps the live writer at its new path', async () => {
  const { workspace, recovery } = await fixture()
  const sourcePath = path.join(workspace, 'a.md'), targetDirectory = path.join(workspace, 'target')
  await fs.mkdir(path.join(workspace, 'assets')); await fs.mkdir(targetDirectory)
  await fs.writeFile(path.join(workspace, 'assets/image.png'), new Uint8Array([1, 2, 3]))
  await fs.writeFile(sourcePath, '# A\n![image](assets/image.png)\n')
  const host = new DocumentHostService(recovery), opened = await host.open(sourcePath)
  await edit(host, opened, '# A dirty\n![image](assets/image.png)\n')
  const root = await host.files.registerRoot(workspace)
  const entries = (await host.files.listChildren({ workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })).entries
  const source = entries.find(entry => entry.status === 'accessible' && entry.name === 'a.md')!
  const target = entries.find(entry => entry.status === 'accessible' && entry.name === 'target')!
  if (source.status !== 'accessible' || target.status !== 'accessible') throw new Error('fixture')
  const input = { workspaceId: root.workspaceId, sourceEntryIds: [source.entryId], targetDirectoryId: target.entryId }
  expect(await host.files.move({ ...input, operationId: 'needs-choice' })).toMatchObject({ status: 'failed', items: [{ error: { code: 'resource-choice-required' } }] })
  expect(await host.files.move({ ...input, operationId: 'cancelled', resourcePolicy: 'cancel' })).toMatchObject({ status: 'cancelled' })
  expect(await fs.readdir(targetDirectory)).toEqual([])
  expect(await host.files.move({ ...input, operationId: 'confirmed', resourcePolicy: 'copy' })).toMatchObject({ status: 'success' })
  expect(await host.internalAPI.read(opened.documentId)).toMatchObject({ dirty: true, undoDepth: 1, binding: { path: path.join(targetDirectory, 'a.md') } })
  await host.saveToPath(opened.documentId)
  expect(await fs.readFile(path.join(targetDirectory, 'a.md'), 'utf8')).toContain('A dirty')
  expect(await fs.readFile(path.join(workspace, 'assets/image.png'))).toEqual(Buffer.from([1, 2, 3]))
  expect((await new DocumentHostService(path.join(recovery, 'reopen')).open(path.join(targetDirectory, 'a.md'))).model.resources.assets['assets/image.png']).toEqual(new Uint8Array([1, 2, 3]))
  expect(await host.files.copy({ workspaceId: root.workspaceId, sourceEntryIds: [source.entryId], targetDirectoryId: root.rootEntryId, operationId: 'copy-back', resourcePolicy: 'copy' })).toMatchObject({ status: 'success' })
  expect((await host.open(sourcePath)).documentId).not.toBe(opened.documentId)
})

it('S09 directory movement follows all open bindings and relative images, preserves draft/History and saves only at the new paths', async () => {
  const { workspace, recovery } = await fixture()
  const folder = path.join(workspace, 'original')
  await fs.mkdir(path.join(folder, 'assets'), { recursive: true })
  await fs.writeFile(path.join(folder, 'assets/image.png'), new Uint8Array([1, 2, 3]))
  await fs.writeFile(path.join(folder, 'a.md'), '# A\n![image](assets/image.png)\n')
  await fs.writeFile(path.join(folder, 'b.md'), '# B\n')
  const host = new DocumentHostService(recovery)
  const a = await host.open(path.join(folder, 'a.md')), b = await host.open(path.join(folder, 'b.md'))
  await edit(host, a, '# A dirty\n![image](assets/image.png)\n')
  const registered = await host.files.registerRoot(workspace)
  const children = await host.files.listChildren({ workspaceId: registered.workspaceId, directoryEntryId: registered.rootEntryId })
  const source = children.entries.find(entry => entry.status === 'accessible' && entry.name === 'original')!
  if (source.status !== 'accessible') throw new Error('fixture')
  expect(await host.files.rename({ operationId: 'move-folder', workspaceId: registered.workspaceId, sourceEntryId: source.entryId, name: 'renamed' })).toMatchObject({ status: 'success' })
  const renamed = path.join(workspace, 'renamed')
  expect(await host.internalAPI.read(a.documentId)).toMatchObject({ documentId: a.documentId, revision: 1, dirty: true, undoDepth: 1, binding: { path: path.join(renamed, 'a.md'), bindingVersion: 2 } })
  expect(await host.internalAPI.read(b.documentId)).toMatchObject({ dirty: false, binding: { path: path.join(renamed, 'b.md') } })
  expect((await host.open(path.join(renamed, 'a.md'))).documentId).toBe(a.documentId)
  await host.saveToPath(a.documentId)
  expect(await fs.readFile(path.join(renamed, 'a.md'), 'utf8')).toContain('A dirty')
  await expect(fs.stat(folder)).rejects.toMatchObject({ code: 'ENOENT' })
  const restart = new DocumentHostService(path.join(recovery, 'reopen-check'))
  const reopened = await restart.open(path.join(renamed, 'a.md'))
  expect(reopened.model.resources.assets['assets/image.png']).toEqual(new Uint8Array([1, 2, 3]))
  const current = await host.internalAPI.read(a.documentId)
  await host.internalAPI.dispatch({ documentId: a.documentId, epoch: current.epoch, operationId: 'undo-after-move', actor: 'human', baseRevision: current.revision, mutation: { type: 'undo' } })
  expect(await host.internalAPI.read(a.documentId)).toMatchObject({ model: { source: '# A\n![image](assets/image.png)\n' }, binding: { path: path.join(renamed, 'a.md') } })
})

it('S09 an interrupted physical rename repairs a cold recovery binding without replaying content or touching the old path', async () => {
  const { workspace, recovery } = await fixture()
  const original = path.join(workspace, 'before.md'), moved = path.join(workspace, 'after.md')
  await fs.writeFile(original, 'disk')
  const host = new DocumentHostService(recovery, { fileOperations: { async rename(from, to) {
    await fs.rename(from, to)
    throw new Error('Injected process-loss boundary after rename, before binding ACK')
  } } })
  const snapshot = await host.open(original)
  await edit(host, snapshot, 'recoverable draft')
  const root = await host.files.registerRoot(workspace)
  const listed = await host.files.listChildren({ workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })
  const source = listed.entries[0]
  if (source.status !== 'accessible') throw new Error('fixture')
  expect(await host.files.rename({ operationId: 'rename-interrupted', workspaceId: root.workspaceId, sourceEntryId: source.entryId, name: 'after.md' })).toMatchObject({ status: 'failed' })
  const restarted = new DocumentHostService(recovery)
  const recoverable = await restarted.operate({ type: 'recoverable' }) as DocumentSnapshot[]
  expect(recoverable).toMatchObject([{ documentId: snapshot.documentId, revision: 1, undoDepth: 1, binding: { path: moved } }])
  await restarted.operate({ type: 'restore', documentId: snapshot.documentId })
  await restarted.saveToPath(snapshot.documentId)
  expect(await fs.readFile(moved, 'utf8')).toBe('recoverable draft')
  await expect(fs.stat(original)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('S09 successful trash detaches an open draft into an untitled session while failed trash leaves the source and binding', async () => {
  const { workspace, recovery } = await fixture()
  const original = path.join(workspace, 'draft.md'), trash = path.join(workspace, 'fixture-trash.md')
  await fs.writeFile(original, 'disk')
  let unavailable = true
  const host = new DocumentHostService(recovery, { async trashItem(filename) { if (unavailable) throw new Error('recycle bin unavailable'); await fs.rename(filename, trash) } })
  const snapshot = await host.open(original)
  await edit(host, snapshot, 'current draft')
  const root = await host.files.registerRoot(workspace)
  const listed = await host.files.listChildren({ workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })
  const source = listed.entries[0]
  if (source.status !== 'accessible') throw new Error('fixture')
  expect(await host.files.trash({ operationId: 'trash-fails', workspaceId: root.workspaceId, entryIds: [source.entryId] })).toMatchObject({ status: 'failed' })
  expect(await fs.readFile(original, 'utf8')).toBe('disk')
  expect(await host.internalAPI.read(snapshot.documentId)).toMatchObject({ binding: { path: original } })
  unavailable = false
  expect(await host.files.trash({ operationId: 'trash-succeeds', workspaceId: root.workspaceId, entryIds: [source.entryId] })).toMatchObject({ status: 'success' })
  expect(await host.internalAPI.read(snapshot.documentId)).toMatchObject({ documentId: snapshot.documentId, dirty: true, undoDepth: 1, model: { source: 'current draft' }, binding: { kind: 'untitled', suggestedName: 'draft.md' } })
  await expect(host.saveToPath(snapshot.documentId)).rejects.toThrow('选择保存路径')
  expect(await fs.readFile(trash, 'utf8')).toBe('disk')
})

it('binding journal failure rolls the directory and every live binding back before a later Save As can start', async () => {
  const { workspace, recovery } = await fixture()
  const original = path.join(workspace, 'source'), target = path.join(workspace, 'target')
  await fs.mkdir(original)
  await fs.writeFile(path.join(original, 'a.md'), 'A')
  await fs.writeFile(path.join(original, 'b.md'), 'B')
  const host = new DocumentHostService(recovery)
  const a = await host.open(path.join(original, 'a.md')), b = await host.open(path.join(original, 'b.md'))
  await edit(host, a, 'A changed')
  const root = await host.files.registerRoot(workspace)
  const listed = await host.files.listChildren({ workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })
  const source = listed.entries[0]
  if (source.status !== 'accessible') throw new Error('fixture')
  const originalOpen = fs.open.bind(fs)
  let movedWrites = 0
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await originalOpen(...args)
    if (String(args[0]).endsWith('.journal') && args[1] === 'a+') {
      const originalWrite = handle.writeFile.bind(handle)
      handle.writeFile = async (data, options) => {
        const bytes = Buffer.from(data as Uint8Array)
        const state = deserialize(bytes.subarray(48, -8)) as { binding: { kind: string; path?: string } }
        if (state.binding.kind === 'file' && state.binding.path?.startsWith(target + path.sep) && ++movedWrites === 2) throw new Error('injected second binding write failure')
        return originalWrite(data, options)
      }
    }
    return handle
  })
  expect(await host.files.rename({ operationId: 'rollback-bindings', workspaceId: root.workspaceId, sourceEntryId: source.entryId, name: 'target' })).toMatchObject({ status: 'failed' })
  expect(movedWrites).toBe(2)
  expect(await host.internalAPI.read(a.documentId)).toMatchObject({ binding: { path: path.join(original, 'a.md') }, dirty: true, model: { source: 'A changed' } })
  expect(await host.internalAPI.read(b.documentId)).toMatchObject({ binding: { path: path.join(original, 'b.md') } })
  const third = path.join(workspace, 'third.md')
  await host.saveToPath(a.documentId, third)
  await host.fileCoordinator.repairBindings()
  expect(await host.internalAPI.read(a.documentId)).toMatchObject({ binding: { path: third }, dirty: false })
  expect(await fs.readFile(path.join(original, 'a.md'), 'utf8')).toBe('A')
  expect(await fs.readFile(third, 'utf8')).toBe('A changed')
})

it('a first save requested during directory movement cannot bind a file at a path that just moved', async () => {
  const { workspace, recovery } = await fixture()
  const original = path.join(workspace, 'source'), target = path.join(workspace, 'target')
  await fs.mkdir(original)
  let entered!: () => void, release!: () => void
  const atMove = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  const host = new DocumentHostService(recovery, { fileOperations: { async rename(from, to) { entered(); await gate; await fs.rename(from, to) } } })
  const root = await host.files.registerRoot(workspace)
  const listed = await host.files.listChildren({ workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })
  const source = listed.entries[0]
  if (source.status !== 'accessible') throw new Error('fixture')
  const draft = await host.internalAPI.create({ kind: 'markdown', source: 'unsaved', resources: { assets: {}, components: {} } }, 'new.md')
  const moving = host.files.rename({ operationId: 'move-empty-directory', workspaceId: root.workspaceId, sourceEntryId: source.entryId, name: 'target' })
  await atMove
  const saving = host.saveToPath(draft.documentId, path.join(original, 'new.md'))
  const rejected = expect(saving).rejects.toMatchObject({ code: 'ENOENT' })
  release()
  expect(await moving).toMatchObject({ status: 'success' })
  await rejected
  expect(await host.internalAPI.read(draft.documentId)).toMatchObject({ dirty: true, binding: { kind: 'untitled' }, model: { source: 'unsaved' } })
  await expect(fs.stat(path.join(target, 'new.md'))).rejects.toMatchObject({ code: 'ENOENT' })
})
