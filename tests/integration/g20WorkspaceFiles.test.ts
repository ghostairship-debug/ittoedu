// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  WorkspaceFiles,
  WorkspaceOperationCancelledError,
  type WorkspaceListItem,
  type WorkspaceMutationAction,
} from '../../src/main/workbench/WorkspaceFiles'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('fixture outside temp')
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}

function accessible(entries: WorkspaceListItem[], name: string) {
  const entry = entries.find(item => item.name === name)
  if (!entry || entry.status !== 'accessible') throw new Error(`missing accessible entry ${name}`)
  return entry
}

function systemError(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code })
}

describe('G20 S09 controlled workspace files', () => {
  it('keeps a file handle through the document writer atomic save but rejects a later external replacement', async () => {
    const root = await temporaryRoot('g20-files-save-identity-')
    const filename = path.join(root, 'note.md')
    await fs.writeFile(filename, '# Before\n')
    const host = new DocumentHostService(path.join(root, 'journal'))
    const opened = await host.open(filename)
    const workspace = await host.files.registerRoot(root)
    const page = await host.files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: workspace.rootEntryId })
    const entryId = accessible(page.entries, 'note.md').entryId
    await host.internalAPI.dispatch({ documentId: opened.documentId, epoch: opened.epoch, baseRevision: opened.revision,
      operationId: 'edit-before-save', actor: 'human',
      mutation: { type: 'command', command: { type: 'markdown.replace', source: '# Saved\n' } } })
    await host.saveToPath(opened.documentId)
    expect(await fs.readFile(filename, 'utf8')).toBe('# Saved\n')
    expect((await host.files.resolveEntry(workspace.workspaceId, entryId)).resolvedPath).toBe(filename)
    expect(accessible((await host.files.listChildren({ workspaceId: workspace.workspaceId,
      directoryEntryId: workspace.rootEntryId })).entries, 'note.md').entryId).toBe(entryId)

    await fs.rm(filename)
    await fs.writeFile(filename, '# External\n')
    await expect(host.files.resolveEntry(workspace.workspaceId, entryId)).rejects.toMatchObject({ code: 'entry-changed' })
  })

  it('moves an open Markdown directory with its relative resources and keeps the document binding', async () => {
    const root = await temporaryRoot('g20-files-directory-binding-')
    const workspace = path.join(root, 'workspace')
    const folder = path.join(workspace, 'lesson'), target = path.join(workspace, 'target')
    await fs.mkdir(path.join(folder, 'assets'), { recursive: true })
    await fs.mkdir(target)
    await fs.writeFile(path.join(folder, 'assets', 'diagram.png'), new Uint8Array([1, 2, 3]))
    const original = path.join(folder, 'plan.md'), moved = path.join(target, 'lesson', 'plan.md')
    await fs.writeFile(original, '# Plan\n\n![diagram](assets/diagram.png)\n')
    const host = new DocumentHostService(path.join(root, 'journal'))
    const opened = await host.open(original)
    await host.internalAPI.dispatch({ documentId: opened.documentId, epoch: opened.epoch, baseRevision: opened.revision,
      operationId: 'edit-before-directory-move', actor: 'human',
      mutation: { type: 'command', command: { type: 'markdown.replace', source: '# Updated\n\n![diagram](assets/diagram.png)\n' } } })
    const registered = await host.files.registerRoot(workspace)
    const page = await host.files.listChildren({ workspaceId: registered.workspaceId, directoryEntryId: registered.rootEntryId })
    const folderId = accessible(page.entries, 'lesson').entryId
    const targetId = accessible(page.entries, 'target').entryId
    const children = await host.files.listChildren({ workspaceId: registered.workspaceId, directoryEntryId: folderId })
    const documentEntryId = accessible(children.entries, 'plan.md').entryId

    const result = await host.files.move({ operationId: 'move-open-directory', workspaceId: registered.workspaceId,
      sourceEntryIds: [folderId], targetDirectoryId: targetId })
    expect(result.status).toBe('success')
    expect((await host.internalAPI.read(opened.documentId)).binding).toMatchObject({ kind: 'file', path: moved, bindingVersion: 2 })
    expect((await host.files.resolveEntry(registered.workspaceId, documentEntryId)).resolvedPath).toBe(moved)
    await host.saveToPath(opened.documentId)
    expect(await fs.readFile(moved, 'utf8')).toBe('# Updated\n\n![diagram](assets/diagram.png)\n')
    expect(await fs.readFile(path.join(target, 'lesson', 'assets', 'diagram.png'))).toEqual(Buffer.from([1, 2, 3]))
    await expect(fs.access(original)).rejects.toMatchObject({ code: 'ENOENT' })
    const reopened = await new DocumentHostService(path.join(root, 'reopen')).open(moved)
    expect(reopened.model.resources.assets['assets/diagram.png']).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('does not retarget an issued handle when an external program replaces its path', async () => {
    const root = await temporaryRoot('g20-files-external-replace-')
    const filename = path.join(root, 'note.md')
    await fs.writeFile(filename, 'original')
    const files = new WorkspaceFiles()
    const workspace = await files.registerRoot(root)
    const initial = await files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: workspace.rootEntryId })
    const oldId = accessible(initial.entries, 'note.md').entryId

    await fs.rm(filename)
    await fs.writeFile(filename, 'replacement')
    await expect(files.resolveEntry(workspace.workspaceId, oldId)).rejects.toMatchObject({ code: 'entry-changed' })
    const after = await files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: workspace.rootEntryId })
    expect(accessible(after.entries, 'note.md').entryId).not.toBe(oldId)
    await expect(files.rename({ operationId: 'stale-rename', workspaceId: workspace.workspaceId,
      sourceEntryId: oldId, name: 'renamed.md' })).resolves.toMatchObject({ status: 'failed' })
    expect(await fs.readFile(filename, 'utf8')).toBe('replacement')
  })

  it('keeps issued handles for externally renamed files and directories without merging a hard link', async () => {
    const root = await temporaryRoot('g20-files-external-rename-')
    await fs.mkdir(path.join(root, 'folder'))
    await fs.writeFile(path.join(root, 'folder', 'note.md'), 'keep')
    const files = new WorkspaceFiles()
    const workspace = await files.registerRoot(root)
    const before = await files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: workspace.rootEntryId })
    const folderId = accessible(before.entries, 'folder').entryId
    const children = await files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: folderId })
    const noteId = accessible(children.entries, 'note.md').entryId

    await fs.rename(path.join(root, 'folder'), path.join(root, 'renamed'))
    const after = await files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: workspace.rootEntryId })
    expect(accessible(after.entries, 'renamed').entryId).toBe(folderId)
    expect((await files.resolveEntry(workspace.workspaceId, noteId)).resolvedPath).toBe(path.join(root, 'renamed', 'note.md'))

    await fs.rename(path.join(root, 'renamed', 'note.md'), path.join(root, 'renamed', 'next.md'))
    const renamedChildren = await files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: folderId })
    expect(accessible(renamedChildren.entries, 'next.md').entryId).toBe(noteId)
    await fs.link(path.join(root, 'renamed', 'next.md'), path.join(root, 'renamed', 'linked.md'))
    const linkedChildren = await files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: folderId })
    expect(accessible(linkedChildren.entries, 'linked.md').entryId).not.toBe(noteId)

    await fs.writeFile(path.join(root, 'renamed', 'occupied.md'), 'old')
    const occupiedChildren = await files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: folderId })
    const occupiedId = accessible(occupiedChildren.entries, 'occupied.md').entryId
    await fs.rm(path.join(root, 'renamed', 'occupied.md'))
    await fs.rename(path.join(root, 'renamed', 'next.md'), path.join(root, 'renamed', 'occupied.md'))
    const replacedChildren = await files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: folderId })
    expect(accessible(replacedChildren.entries, 'occupied.md').entryId).toBe(noteId)
    await expect(files.resolveEntry(workspace.workspaceId, occupiedId)).rejects.toMatchObject({ code: 'unknown-entry' })
  })

  it('treats selected descendants as part of their selected folder for copy, move and trash', async () => {
    const root = await temporaryRoot('g20-files-overlap-')
    await fs.mkdir(path.join(root, 'folder'))
    await fs.mkdir(path.join(root, 'destination'))
    await fs.mkdir(path.join(root, 'second'))
    await fs.writeFile(path.join(root, 'folder', 'nested.md'), 'one')
    const recycled = path.join(root, 'recycled')
    const files = new WorkspaceFiles({ trashItem: async source => { await fs.rename(source, recycled) } })
    const workspace = await files.registerRoot(root)
    const top = await files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: workspace.rootEntryId })
    const folderId = accessible(top.entries, 'folder').entryId
    const destinationId = accessible(top.entries, 'destination').entryId
    const secondId = accessible(top.entries, 'second').entryId
    const child = await files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: folderId })
    const childId = accessible(child.entries, 'nested.md').entryId

    const copied = await files.copy({ operationId: 'copy-overlap', workspaceId: workspace.workspaceId,
      sourceEntryIds: [childId, folderId], targetDirectoryId: destinationId })
    expect(copied).toMatchObject({ status: 'success', items: [{ sourceEntryId: folderId, status: 'success' }] })
    expect(copied.items).toHaveLength(1)
    expect(await fs.readFile(path.join(root, 'destination', 'folder', 'nested.md'), 'utf8')).toBe('one')
    await expect(fs.access(path.join(root, 'destination', 'nested.md'))).rejects.toMatchObject({ code: 'ENOENT' })

    const moved = await files.move({ operationId: 'move-overlap', workspaceId: workspace.workspaceId,
      sourceEntryIds: [childId, folderId], targetDirectoryId: secondId })
    expect(moved).toMatchObject({ status: 'success', items: [{ sourceEntryId: folderId, status: 'success' }] })
    expect((await files.resolveEntry(workspace.workspaceId, childId)).resolvedPath).toBe(path.join(root, 'second', 'folder', 'nested.md'))
    await expect(fs.access(path.join(root, 'folder'))).rejects.toMatchObject({ code: 'ENOENT' })

    const trashed = await files.trash({ operationId: 'trash-overlap', workspaceId: workspace.workspaceId,
      entryIds: [childId, folderId] })
    expect(trashed).toMatchObject({ status: 'success', items: [{ sourceEntryId: folderId, status: 'success' }] })
    expect(await fs.readFile(path.join(recycled, 'nested.md'), 'utf8')).toBe('one')
  })

  it('uses main-issued handles for paged create/rename/copy and replays operation IDs without overwriting', async () => {
    const root = await temporaryRoot('g20-files-basic-')
    const actions: WorkspaceMutationAction[] = []
    let ids = 0
    const files = new WorkspaceFiles({
      createId: () => `id-${++ids}`,
      aroundMutation: async (action, perform) => { actions.push(action); return perform() },
    })
    const workspace = await files.registerRoot(root)
    expect(files.registeredRoot(workspace.workspaceId)).toEqual(workspace)

    const folder = await files.mkdir({ operationId: 'mkdir-1', workspaceId: workspace.workspaceId,
      targetDirectoryId: workspace.rootEntryId, name: '资料' })
    const folderId = folder.items[0]!.entryId!
    const created = await files.createFile({ operationId: 'create-1', workspaceId: workspace.workspaceId,
      targetDirectoryId: workspace.rootEntryId, name: '草稿.md', format: 'markdown', bytes: new TextEncoder().encode('# 中文\r\n') })
    expect(created).toMatchObject({ status: 'success', items: [{ status: 'success' }] })
    expect(await fs.readFile(path.join(root, '草稿.md'), 'utf8')).toBe('# 中文\r\n')
    expect(await files.createFile({ operationId: 'create-1', workspaceId: workspace.workspaceId,
      targetDirectoryId: workspace.rootEntryId, name: '草稿.md', format: 'markdown', bytes: new TextEncoder().encode('# 中文\r\n') })).toEqual(created)
    await expect(files.createFile({ operationId: 'create-1', workspaceId: workspace.workspaceId,
      targetDirectoryId: workspace.rootEntryId, name: '另一个.md', format: 'markdown', bytes: new Uint8Array() }))
      .rejects.toMatchObject({ code: 'operation-payload-mismatch' })

    const invalid = await files.createFile({ operationId: 'bad-name', workspaceId: workspace.workspaceId,
      targetDirectoryId: workspace.rootEntryId, name: 'CON.md', format: 'markdown', bytes: new Uint8Array() })
    expect(invalid.items[0]?.error?.code).toBe('invalid-entry-name')
    const pageOne = await files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: workspace.rootEntryId, limit: 1 })
    const pageTwo = await files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: workspace.rootEntryId,
      cursor: pageOne.nextCursor, limit: 10 })
    const all = [...pageOne.entries, ...pageTwo.entries]
    const draftId = accessible(all, '草稿.md').entryId

    const renamed = await files.rename({ operationId: 'rename-1', workspaceId: workspace.workspaceId,
      sourceEntryId: draftId, name: '定稿.md' })
    expect(renamed).toMatchObject({ status: 'success', items: [{ entryId: draftId }] })
    expect((await files.resolveEntry(workspace.workspaceId, draftId)).resolvedPath).toBe(path.join(root, '定稿.md'))
    await expect(fs.access(path.join(root, '草稿.md'))).rejects.toMatchObject({ code: 'ENOENT' })

    const copied = await files.copy({ operationId: 'copy-1', workspaceId: workspace.workspaceId,
      sourceEntryIds: [draftId], targetDirectoryId: folderId })
    expect(copied.status).toBe('success')
    expect(await fs.readFile(path.join(root, '资料', '定稿.md'), 'utf8')).toBe('# 中文\r\n')
    const conflict = await files.copy({ operationId: 'copy-conflict', workspaceId: workspace.workspaceId,
      sourceEntryIds: [draftId], targetDirectoryId: folderId })
    expect(conflict).toMatchObject({ status: 'failed', items: [{ error: { code: 'same-name-conflict' } }] })
    const explicitOverwrite = await files.copy({ operationId: 'copy-overwrite', workspaceId: workspace.workspaceId,
      sourceEntryIds: [draftId], targetDirectoryId: folderId, overwrite: true })
    expect(explicitOverwrite.items[0]?.error?.code).toBe('overwrite-not-supported')

    expect(actions.map(action => action.kind)).toEqual(['mkdir', 'create-file', 'rename', 'copy', 'copy', 'copy'])
    expect(actions.find(action => action.kind === 'rename')).toMatchObject({
      sources: [{ entryId: draftId, resolvedPath: path.join(root, '草稿.md') }],
      target: { resolvedPath: path.join(root, '定稿.md') },
      affectedPaths: [path.join(root, '草稿.md'), path.join(root, '定稿.md')],
    })
  })

  it('verifies cross-volume directory copies before deletion, reports partial deletion, and rolls back coordination failure', async () => {
    const root = await temporaryRoot('g20-files-move-')
    await fs.mkdir(path.join(root, 'target'))
    await fs.mkdir(path.join(root, 'course', 'nested'), { recursive: true })
    await fs.writeFile(path.join(root, 'course', 'nested', '内容.md'), '完整内容')
    const exdevSource = path.join(root, 'course')
    const files = new WorkspaceFiles({
      fileOperations: {
        rename: async (source, target) => {
          if (source === exdevSource) throw systemError('EXDEV')
          await fs.rename(source, target)
        },
      },
    })
    const workspace = await files.registerRoot(root)
    const top = await files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: workspace.rootEntryId })
    const courseId = accessible(top.entries, 'course').entryId
    const targetId = accessible(top.entries, 'target').entryId
    const courseChildren = await files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: courseId })
    const nestedId = accessible(courseChildren.entries, 'nested').entryId
    const nestedChildren = await files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: nestedId })
    const contentId = accessible(nestedChildren.entries, '内容.md').entryId
    const moved = await files.move({ operationId: 'move-exdev', workspaceId: workspace.workspaceId,
      sourceEntryIds: [courseId], targetDirectoryId: targetId })
    expect(moved.status).toBe('success')
    await expect(fs.access(exdevSource)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(path.join(root, 'target', 'course', 'nested', '内容.md'), 'utf8')).toBe('完整内容')
    const movedContent = path.join(root, 'target', 'course', 'nested', '内容.md')
    await fs.rm(movedContent)
    await fs.writeFile(movedContent, 'external replacement')
    await expect(files.resolveEntry(workspace.workspaceId, contentId)).rejects.toMatchObject({ code: 'entry-changed' })

    await fs.mkdir(path.join(root, 'corrupt', 'nested'), { recursive: true })
    await fs.writeFile(path.join(root, 'corrupt', 'nested', 'data.bin'), new Uint8Array([1, 2, 3]))
    const corruptService = new WorkspaceFiles({
      fileOperations: {
        rename: async (source, target) => {
          if (source === path.join(root, 'corrupt')) throw systemError('EXDEV')
          await fs.rename(source, target)
        },
        copy: async (source, target, kind) => {
          if (kind === 'directory') await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false })
          else await fs.copyFile(source, target)
          await fs.writeFile(path.join(target, 'nested', 'data.bin'), new Uint8Array([9]))
        },
      },
    })
    const corruptWorkspace = await corruptService.registerRoot(root)
    const corruptTop = await corruptService.listChildren({ workspaceId: corruptWorkspace.workspaceId, directoryEntryId: corruptWorkspace.rootEntryId })
    const corruptId = accessible(corruptTop.entries, 'corrupt').entryId
    const corruptTargetId = accessible(corruptTop.entries, 'target').entryId
    const corruptMove = await corruptService.move({ operationId: 'move-corrupt', workspaceId: corruptWorkspace.workspaceId,
      sourceEntryIds: [corruptId], targetDirectoryId: corruptTargetId })
    expect(corruptMove.items[0]?.error?.code).toBe('copy-verification-failed')
    expect(await fs.readFile(path.join(root, 'corrupt', 'nested', 'data.bin'))).toEqual(Buffer.from([1, 2, 3]))
    await expect(fs.access(path.join(root, 'target', 'corrupt'))).rejects.toMatchObject({ code: 'ENOENT' })

    await fs.writeFile(path.join(root, 'busy.md'), 'source remains')
    const busyPath = path.join(root, 'busy.md')
    const partialService = new WorkspaceFiles({
      fileOperations: {
        rename: async (source, target) => { if (source === busyPath) throw systemError('EXDEV'); await fs.rename(source, target) },
        remove: async target => { if (target === busyPath) throw systemError('EBUSY', 'file occupied'); await fs.rm(target, { recursive: true }) },
      },
    })
    const partialWorkspace = await partialService.registerRoot(root)
    const partialTop = await partialService.listChildren({ workspaceId: partialWorkspace.workspaceId, directoryEntryId: partialWorkspace.rootEntryId })
    const busyId = accessible(partialTop.entries, 'busy.md').entryId
    const partialTargetId = accessible(partialTop.entries, 'target').entryId
    const partial = await partialService.move({ operationId: 'move-partial', workspaceId: partialWorkspace.workspaceId,
      sourceEntryIds: [busyId], targetDirectoryId: partialTargetId })
    expect(partial).toMatchObject({ status: 'partial', items: [{ status: 'partial', sourcePath: busyPath,
      targetPath: path.join(root, 'target', 'busy.md'), error: { code: 'source-delete-failed' } }] })
    expect(await fs.readFile(busyPath, 'utf8')).toBe('source remains')
    expect(await fs.readFile(path.join(root, 'target', 'busy.md'), 'utf8')).toBe('source remains')

    await fs.writeFile(path.join(root, 'rollback.md'), 'binding protected')
    const rollbackService = new WorkspaceFiles({
      aroundMutation: async (action, perform) => {
        const result = await perform()
        if (action.kind === 'move') throw new Error('binding journal unavailable')
        return result
      },
    })
    const rollbackWorkspace = await rollbackService.registerRoot(root)
    const rollbackTop = await rollbackService.listChildren({ workspaceId: rollbackWorkspace.workspaceId, directoryEntryId: rollbackWorkspace.rootEntryId })
    const rollbackId = accessible(rollbackTop.entries, 'rollback.md').entryId
    const rollbackTargetId = accessible(rollbackTop.entries, 'target').entryId
    const rolledBack = await rollbackService.move({ operationId: 'move-rollback', workspaceId: rollbackWorkspace.workspaceId,
      sourceEntryIds: [rollbackId], targetDirectoryId: rollbackTargetId })
    expect(rolledBack.items[0]?.error?.code).toBe('coordination-rolled-back')
    expect(await fs.readFile(path.join(root, 'rollback.md'), 'utf8')).toBe('binding protected')
    await expect(fs.access(path.join(root, 'target', 'rollback.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports each result in a mixed cross-volume batch and keeps an occupied source', async () => {
    const root = await temporaryRoot('g20-files-batch-exdev-')
    const destination = path.join(root, 'destination')
    await fs.mkdir(destination)
    const free = path.join(root, 'free.md'), occupied = path.join(root, 'occupied.md')
    await fs.writeFile(free, 'free')
    await fs.writeFile(occupied, 'occupied')
    const files = new WorkspaceFiles({ fileOperations: {
      rename: async (source, target) => {
        if (source === free || source === occupied) throw systemError('EXDEV')
        await fs.rename(source, target)
      },
      remove: async target => {
        if (target === occupied) throw systemError('EBUSY', 'occupied source')
        await fs.rm(target, { recursive: true })
      },
    } })
    const workspace = await files.registerRoot(root)
    const page = await files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: workspace.rootEntryId })
    const freeId = accessible(page.entries, 'free.md').entryId
    const occupiedId = accessible(page.entries, 'occupied.md').entryId
    const targetId = accessible(page.entries, 'destination').entryId
    const result = await files.move({ operationId: 'mixed-exdev', workspaceId: workspace.workspaceId,
      sourceEntryIds: [freeId, occupiedId], targetDirectoryId: targetId })
    expect(result).toMatchObject({ status: 'partial', items: [
      { sourceEntryId: freeId, status: 'success' },
      { sourceEntryId: occupiedId, status: 'partial', error: { code: 'source-delete-failed' } },
    ] })
    await expect(fs.access(free)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(path.join(destination, 'free.md'), 'utf8')).toBe('free')
    expect(await fs.readFile(occupied, 'utf8')).toBe('occupied')
    expect(await fs.readFile(path.join(destination, 'occupied.md'), 'utf8')).toBe('occupied')
  })

  it('keeps issued handles valid when a verified cross-volume move rolls back', async () => {
    const root = await temporaryRoot('g20-files-exdev-rollback-')
    await fs.mkdir(path.join(root, 'target'))
    const original = path.join(root, 'note.md')
    await fs.writeFile(original, 'original')
    const files = new WorkspaceFiles({
      fileOperations: { rename: async (source, target) => {
        if (source === original) throw systemError('EXDEV')
        await fs.rename(source, target)
      } },
      aroundMutation: async (_action, perform) => { await perform(); throw new Error('binding update failed') },
    })
    const workspace = await files.registerRoot(root)
    const page = await files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: workspace.rootEntryId })
    const entryId = accessible(page.entries, 'note.md').entryId
    const targetId = accessible(page.entries, 'target').entryId
    const result = await files.move({ operationId: 'rollback-exdev', workspaceId: workspace.workspaceId,
      sourceEntryIds: [entryId], targetDirectoryId: targetId })
    expect(result.items[0]?.error?.code).toBe('coordination-rolled-back')
    expect(await fs.readFile(original, 'utf8')).toBe('original')
    await expect(fs.access(path.join(root, 'target', 'note.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await files.resolveEntry(workspace.workspaceId, entryId)).resolvedPath).toBe(original)
  })

  it('blocks junction escapes and self-descendant moves while trash/reveal preserve truthful system outcomes', async () => {
    const root = await temporaryRoot('g20-files-boundary-')
    const outside = await temporaryRoot('g20-files-outside-')
    await fs.writeFile(path.join(outside, 'secret.md'), 'outside')
    await fs.symlink(outside, path.join(root, 'escape'), 'junction')
    await fs.mkdir(path.join(root, 'parent', 'child'), { recursive: true })
    await fs.writeFile(path.join(root, 'keep.md'), 'keep')
    const revealed: string[] = []
    let trashMode: 'failed' | 'cancelled' = 'failed'
    const files = new WorkspaceFiles({
      trashItem: async () => {
        if (trashMode === 'cancelled') throw new WorkspaceOperationCancelledError('user cancelled recycle bin')
        throw systemError('EACCES', 'recycle bin unavailable')
      },
      showItemInFolder: target => { revealed.push(target) },
    })
    const workspace = await files.registerRoot(root)
    const top = await files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: workspace.rootEntryId })
    expect(top.entries).toContainEqual({ status: 'blocked', name: 'escape', reason: 'outside-workspace' })
    const keepId = accessible(top.entries, 'keep.md').entryId
    const parentId = accessible(top.entries, 'parent').entryId
    const parentChildren = await files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId: parentId })
    const childId = accessible(parentChildren.entries, 'child').entryId

    const descendant = await files.move({ operationId: 'move-descendant', workspaceId: workspace.workspaceId,
      sourceEntryIds: [parentId], targetDirectoryId: childId })
    expect(descendant.items[0]?.error?.code).toBe('target-inside-source')
    expect((await fs.stat(path.join(root, 'parent', 'child'))).isDirectory()).toBe(true)

    const failedTrash = await files.trash({ operationId: 'trash-failed', workspaceId: workspace.workspaceId, entryIds: [keepId] })
    expect(failedTrash).toMatchObject({ status: 'failed', items: [{ error: { code: 'EACCES' } }] })
    expect(await fs.readFile(path.join(root, 'keep.md'), 'utf8')).toBe('keep')
    trashMode = 'cancelled'
    const cancelledTrash = await files.trash({ operationId: 'trash-cancelled', workspaceId: workspace.workspaceId, entryIds: [keepId] })
    expect(cancelledTrash.status).toBe('cancelled')
    expect(await fs.readFile(path.join(root, 'keep.md'), 'utf8')).toBe('keep')

    const reveal = await files.reveal({ operationId: 'reveal-1', workspaceId: workspace.workspaceId, entryId: keepId })
    expect(reveal.status).toBe('success')
    expect(await files.reveal({ operationId: 'reveal-1', workspaceId: workspace.workspaceId, entryId: keepId })).toEqual(reveal)
    expect(revealed).toEqual([path.join(root, 'keep.md')])
  })
})
