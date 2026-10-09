// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { WorkspaceFilesDesktopService } from '../../../../src/main/workbench/workspaceFilesDesktopService'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../../../src/core/drivers/courseV10Operations'

it('public workspaceFiles defaults to disk and explicitly copies current V10 draft without saving or clearing the source dirty history', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T03-copy-version-'))
  let desktop: WorkspaceFilesDesktopService | undefined
  try {
    const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace)
    const host = new DocumentHostService(path.join(directory, 'documents'))
    const initial = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('Disk teacher title'),
      resources: { assets: {}, components: {} } }, 'lesson.h5lesson')
    const source = path.join(workspace, 'lesson.h5lesson')
    const saved = await host.saveToPath(initial.documentId, source)
    if (saved.model.kind !== 'course-v10') throw new Error('Expected V10')
    await host.internalAPI.dispatch({ documentId: saved.documentId, epoch: saved.epoch, baseRevision: saved.revision,
      actor: 'human', operationId: 'teacher-unsaved-title', mutation: { type: 'command',
        command: captureComponentOperation(saved.model.project, [{ type: 'project.title.set', title: 'Current unsaved teacher title' }]) } })
    const before = await host.internalAPI.read(saved.documentId)
    expect(before).toMatchObject({ dirty: true, undoDepth: 1 })
    desktop = new WorkspaceFilesDesktopService(host.files)
    const root = await desktop.authorizeRoot(workspace)
    const listing = await desktop.operate({ type: 'list', workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })
    const sourceEntry = listing.entries.find(entry => entry.name === 'lesson.h5lesson')
    if (!sourceEntry || sourceEntry.status !== 'accessible') throw new Error('Expected accessible course file')
    const sourceEntryId = sourceEntry.entryId
    const diskFolder = await desktop.operate({ type: 'mkdir', operationId: 'disk-folder', workspaceId: root.workspaceId, targetDirectoryId: root.rootEntryId, name: 'disk' })
    const currentFolder = await desktop.operate({ type: 'mkdir', operationId: 'current-folder', workspaceId: root.workspaceId, targetDirectoryId: root.rootEntryId, name: 'current' })
    const disk = await desktop.operate({ type: 'copy', operationId: 'default-disk', workspaceId: root.workspaceId,
      sourceEntryIds: [sourceEntryId], targetDirectoryId: diskFolder.items[0].entryId! })
    expect(disk).toMatchObject({ status: 'success', items: [{ copied: 'disk-version' }] })
    const currentRequest = { type: 'copy' as const, operationId: 'explicit-current', workspaceId: root.workspaceId,
      sourceEntryIds: [sourceEntryId], targetDirectoryId: currentFolder.items[0].entryId!, sourceVersion: 'current' as const }
    const current = await desktop.operate(currentRequest)
    expect(current).toMatchObject({ status: 'success', items: [{ copied: 'current-draft' }] })
    expect(await desktop.operate(currentRequest)).toEqual(current)
    const cold = new DocumentHostService(path.join(directory, 'cold'))
    const diskCopy = await cold.open(path.join(workspace, 'disk', 'lesson.h5lesson'))
    const currentCopy = await cold.open(path.join(workspace, 'current', 'lesson.h5lesson'))
    const sourceDisk = await cold.open(source)
    expect(diskCopy.model).toMatchObject({ kind: 'course-v10', project: { title: 'Disk teacher title' } })
    expect(currentCopy.model).toMatchObject({ kind: 'course-v10', project: { title: 'Current unsaved teacher title' } })
    expect(sourceDisk.model).toMatchObject({ kind: 'course-v10', project: { title: 'Disk teacher title' } })
    expect(await host.internalAPI.read(saved.documentId)).toMatchObject({ documentId: before.documentId, epoch: before.epoch,
      revision: before.revision, binding: before.binding, saving: before.saving, saveError: before.saveError,
      dirty: true, undoDepth: before.undoDepth, redoDepth: before.redoDepth })
    await host.internalAPI.dispatch({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision,
      operationId: 'teacher-undo', actor: 'human', mutation: { type: 'undo' } })
    expect((await host.internalAPI.read(before.documentId)).model).toMatchObject({ kind: 'course-v10', project: { title: 'Disk teacher title' } })
  } finally {
    desktop?.dispose()
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
