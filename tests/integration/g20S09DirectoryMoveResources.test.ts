// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'

const output = path.resolve(__dirname, '../../output/g20/s09/directory-move-resources')
const evidenceFile = path.join(output, 'evidence.json')

it('S09-T02 moves an open Markdown directory and its managed relative image without moving the external original', async () => {
  await fs.mkdir(output, { recursive: true })
  await fs.rm(evidenceFile, { force: true })
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-s09-directory-move-'))
  try {
    const workspace = path.join(fixture, 'workspace'), recovery = path.join(fixture, 'recovery')
    const originalFolder = path.join(workspace, 'lesson'), destination = path.join(workspace, 'archive')
    const movedFolder = path.join(destination, 'lesson')
    const originalAsset = path.join(fixture, 'teacher-original.png')
    const assetBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64')
    await fs.mkdir(path.join(originalFolder, 'assets'), { recursive: true })
    await fs.mkdir(destination)
    await fs.writeFile(originalAsset, assetBytes)
    await fs.copyFile(originalAsset, path.join(originalFolder, 'assets', 'image.png'))
    const beforeSource = '# Lesson\n![image](assets/image.png)\n'
    const editedSource = '# Edited lesson\n![image](assets/image.png)\n'
    await fs.writeFile(path.join(originalFolder, 'lesson.md'), beforeSource)
    await fs.writeFile(path.join(originalFolder, 'notes.md'), '# Notes\n')

    const host = new DocumentHostService(recovery)
    const lesson = await host.open(path.join(originalFolder, 'lesson.md'))
    const notes = await host.open(path.join(originalFolder, 'notes.md'))
    await host.internalAPI.dispatch({ documentId: lesson.documentId, epoch: lesson.epoch, operationId: 'teacher-edit-before-move',
      actor: 'human', baseRevision: lesson.revision, mutation: { type: 'command', command: { type: 'markdown.replace', source: editedSource } } })
    const registered = await host.files.registerRoot(workspace)
    const listed = await host.files.listChildren({ workspaceId: registered.workspaceId, directoryEntryId: registered.rootEntryId })
    const entry = (name: string) => {
      const found = listed.entries.find(item => item.status === 'accessible' && item.name === name)
      if (!found || found.status !== 'accessible') throw new Error(`Missing fixture entry: ${name}`)
      return found.entryId
    }
    const moved = await host.files.move({ operationId: 'move-open-lesson-directory', workspaceId: registered.workspaceId,
      sourceEntryIds: [entry('lesson')], targetDirectoryId: entry('archive') })
    expect(moved).toMatchObject({ status: 'success', items: [{ status: 'success' }] })
    await expect(fs.stat(originalFolder)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(path.join(movedFolder, 'assets', 'image.png'))).toEqual(assetBytes)
    expect(await fs.readFile(originalAsset)).toEqual(assetBytes)
    expect(await host.internalAPI.read(lesson.documentId)).toMatchObject({ documentId: lesson.documentId,
      revision: 1, undoDepth: 1, dirty: true, binding: { path: path.join(movedFolder, 'lesson.md'), bindingVersion: 2 },
      model: { source: editedSource } })
    expect(await host.internalAPI.read(notes.documentId)).toMatchObject({ documentId: notes.documentId,
      binding: { path: path.join(movedFolder, 'notes.md'), bindingVersion: 2 } })
    expect((await host.open(path.join(movedFolder, 'lesson.md'))).documentId).toBe(lesson.documentId)
    await host.saveToPath(lesson.documentId)
    expect(await fs.readFile(path.join(movedFolder, 'lesson.md'), 'utf8')).toBe(editedSource)
    await expect(fs.stat(path.join(originalFolder, 'lesson.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    const reopened = await new DocumentHostService(path.join(fixture, 'reopen')).open(path.join(movedFolder, 'lesson.md'))
    expect(reopened.model).toMatchObject({ kind: 'markdown', source: editedSource })
    expect(reopened.model.resources.assets['assets/image.png']).toEqual(new Uint8Array(assetBytes))
    expect(await fs.readFile(originalAsset)).toEqual(assetBytes)

    await fs.writeFile(evidenceFile, JSON.stringify({
      caseId: 'S09-T02-DIRECTORY-MOVE-RESOURCES', result: 'passed', capturedAt: new Date().toISOString(),
      testLayer: 'DocumentHostService integration',
      operation: { kind: 'move', sourceDirectory: 'lesson/', targetDirectory: 'archive/lesson/', receipt: moved.status },
      observed: { openDocumentIdsRetained: true, bothBindingsMoved: true, dirtyRevisionAndHistoryRetained: true,
        relativeAssetReadAfterReopen: true, externalOriginalUntouched: true, sourceDirectoryAbsent: true,
        saveOnlyAtNewPath: true },
    }, null, 2), 'utf8')
  } finally {
    if (!path.resolve(fixture).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe S09 fixture cleanup')
    await fs.rm(fixture, { recursive: true, force: true })
  }
}, 30_000)
