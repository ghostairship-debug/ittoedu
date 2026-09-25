// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { workspaceTrashFlow, type WorkspaceTrashPorts } from '../../src/main/workbench/workspaceTrashFlow'

it('cancel leaves a running writer and file intact; confirmed trash stops it and preserves unsaved History without recreating the old path', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-trash-flow-'))
  try {
    const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace)
    const filename = path.join(workspace, 'draft.md'), recycled = path.join(directory, 'recycled.md')
    await fs.writeFile(filename, '# original\n')
    const host = new DocumentHostService(path.join(directory, 'state'), { trashItem: file => fs.rename(file, recycled) })
    const doc = await host.open(filename)
    await host.internalAPI.dispatch({ documentId: doc.documentId, epoch: doc.epoch, baseRevision: doc.revision, operationId: 'human', actor: 'human',
      mutation: { type: 'command', command: { type: 'markdown.replace', source: '# unsaved\n' } } })
    await host.tools.beginRun({ runId: 'writing', actor: 'agent', documents: [{ documentId: doc.documentId, writable: [{ kind: 'document' }] }] })
    const target = await host.tools.issueTarget('writing', doc.documentId, { kind: 'document' })
    const root = await host.files.registerRoot(workspace)
    const source = (await host.files.listChildren({ workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })).entries.find(entry => entry.status === 'accessible' && entry.name === 'draft.md')!
    if (source.status !== 'accessible') throw new Error('source')
    let confirmation = false, stops = 0, sawDirty = false
    const ports: WorkspaceTrashPorts = {
      entries: async () => [await host.files.resolveEntry(root.workspaceId, source.entryId)], documents: async () => host.registry.list(),
      hasWriters: async () => stops === 0,
      confirm: async input => { sawDirty = input.documents.some(value => value.dirty); return confirmation },
      withBarrier: (ids, action) => host.tools.withWriteTaskBarrier(ids, action),
      stopWriters: async () => { await host.tools.stop('writing'); stops++ },
      trash: () => host.files.trash({ operationId: 'delete', workspaceId: root.workspaceId, entryIds: [source.entryId] }),
    }
    expect(await workspaceTrashFlow('delete', ports)).toMatchObject({ status: 'cancelled' })
    expect(stops).toBe(0); expect(sawDirty).toBe(true)
    expect(await fs.readFile(filename, 'utf8')).toBe('# original\n')
    confirmation = true
    expect(await workspaceTrashFlow('delete', ports)).toMatchObject({ status: 'success' })
    expect(stops).toBe(1)
    expect(await host.tools.execute('writing', 'late', { name: 'text.replace', input: { target, content: 'LATE' } })).toMatchObject({ kind: 'error', code: 'run-stopped' })
    expect(await host.internalAPI.read(doc.documentId)).toMatchObject({ dirty: true, undoDepth: 1, binding: { kind: 'untitled' }, model: { source: '# unsaved\n' } })
    await expect(host.saveToPath(doc.documentId)).rejects.toThrow()
    await expect(fs.stat(filename)).rejects.toMatchObject({ code: 'ENOENT' })
    const fresh = path.join(workspace, 'saved-again.md'); await host.saveToPath(doc.documentId, fresh)
    expect(await fs.readFile(fresh, 'utf8')).toBe('# unsaved\n')
    expect(await fs.readFile(recycled, 'utf8')).toBe('# original\n')
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
