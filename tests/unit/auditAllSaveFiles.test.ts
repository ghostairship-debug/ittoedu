// @vitest-environment node
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { WorkspaceFiles } from '../../src/main/workbench/WorkspaceFiles'
import { WorkspaceFilesDesktopService } from '../../src/main/workbench/workspaceFilesDesktopService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import type { AgentFileContext } from '../../src/core/tools/AgentFileTools'
import type { RegisteredWorkspaceRoot } from '../../src/shared/workbench/workspaceFiles'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) {
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('unexpected fixture root')
  await fs.rm(root, { recursive: true, force: true })
} })
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-all-files-')); roots.push(root)
  const journal = path.join(root, 'journal'), host = new DocumentHostService(journal)
  const context: AgentFileContext = { runId: 'audit', workspaceRoot: root, permission: 'workspace' }
  return { root, journal, host, context }
}
async function entry(files: WorkspaceFiles, root: RegisteredWorkspaceRoot, name: string, directoryEntryId = root.rootEntryId) {
  const page = await files.listChildren({ workspaceId: root.workspaceId, directoryEntryId })
  const found = page.entries.find(item => item.status === 'accessible' && item.name === name)
  if (!found || found.status !== 'accessible') throw new Error(`missing ${name}`)
  return found.entryId
}

describe('Audit existing file owners', () => {
  it('R83 clears compilation only after the final canonical document has closed', async () => {
    const f = await fixture(), clear = vi.spyOn(f.host.compilation, 'clear')
    const first = await f.host.operate({ type: 'create', model: { kind: 'text', source: 'first', resources: { assets: {}, components: {} } }, suggestedName: 'first.txt' }) as any
    const second = await f.host.operate({ type: 'create', model: { kind: 'text', source: 'second', resources: { assets: {}, components: {} } }, suggestedName: 'second.txt' }) as any
    await f.host.operate({ type: 'close', documentId: first.documentId, discardDirty: true }); expect(clear).not.toHaveBeenCalled()
    await f.host.operate({ type: 'close', documentId: second.documentId, discardDirty: true }); expect(clear).toHaveBeenCalledTimes(1)
    expect(await f.host.operate({ type: 'list' })).toEqual([])
  })
  it('CA008 changes the physical filename case through the normal owner', async () => {
    const f = await fixture(); await fs.writeFile(path.join(f.root, 'Course.txt'), 'text')
    const root = await f.host.files.registerRoot(f.root), sourceEntryId = await entry(f.host.files, root, 'Course.txt')
    const result = await f.host.files.rename({ workspaceId: root.workspaceId, sourceEntryId, operationId: 'case', name: 'course.txt' })
    expect(result.status).toBe('success'); expect(await fs.readdir(f.root)).toContain('course.txt'); expect(await fs.readdir(f.root)).not.toContain('Course.txt')
  })

  it('CA052 explicit reauthorization issues a usable root after directory replacement', async () => {
    const f = await fixture(), directory = path.join(f.root, 'workspace'); await fs.mkdir(directory)
    const first = await f.host.files.registerRoot(directory)
    await fs.rename(directory, path.join(f.root, 'old')); await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'new.txt'), 'new')
    await expect(f.host.files.resolveEntry(first.workspaceId, first.rootEntryId)).rejects.toMatchObject({ code: 'entry-changed' })
    const second = await f.host.files.registerRoot(directory)
    expect(second.rootEntryId).not.toBe(first.rootEntryId)
    expect((await f.host.files.listChildren({ workspaceId: second.workspaceId, directoryEntryId: second.rootEntryId })).entries).toMatchObject([{ name: 'new.txt' }])
  })

  it('CA114 the agent submits parent and child as one owner batch', async () => {
    const f = await fixture(); await fs.mkdir(path.join(f.root, 'unit')); await fs.mkdir(path.join(f.root, 'destination'))
    await fs.writeFile(path.join(f.root, 'unit', 'note.txt'), 'content')
    const result = await f.host.agentFiles.execute(f.context, 'file.move', { sources: ['unit/note.txt', 'unit'], destination: 'destination' }, 'parent-child')
    expect((result.data as any).operation.status).toBe('success')
    expect(await fs.readFile(path.join(f.root, 'destination', 'unit', 'note.txt'), 'utf8')).toBe('content')
    await expect(fs.stat(path.join(f.root, 'destination', 'note.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('CA102 the agent passes the existing Markdown resource copy choice', async () => {
    const f = await fixture(); await fs.mkdir(path.join(f.root, 'unit')); await fs.mkdir(path.join(f.root, 'destination'))
    await fs.writeFile(path.join(f.root, 'unit', 'note.md'), '![image](pic.png)'); await fs.writeFile(path.join(f.root, 'unit', 'pic.png'), Buffer.from([2]))
    const result = await f.host.agentFiles.execute(f.context, 'file.move', { sources: ['unit/note.md'], destination: 'destination', resourcePolicy: 'copy' }, 'markdown-choice')
    expect((result.data as any).operation.status).toBe('success')
    expect(await fs.readFile(path.join(f.root, 'destination', 'pic.png'))).toEqual(Buffer.from([2]))
  })

  it('CA051 current directory copy replaces only its private old resources and includes new package images', async () => {
    const f = await fixture(), unit = path.join(f.root, 'unit'), destination = path.join(f.root, 'destination')
    await fs.mkdir(unit); await fs.mkdir(destination); await fs.mkdir(path.join(unit, 'resources'))
    await fs.writeFile(path.join(unit, 'pic.png'), Buffer.from([1])); await fs.writeFile(path.join(unit, 'resources', 'old.png'), Buffer.from([3]))
    const source = '![image](pic.png)\n```cw-object-v1\n' + JSON.stringify({ resources: { components: [{ source: { kind: 'relative', path: 'resources' } }] } }) + '\n```'
    const filename = path.join(unit, 'note.md'); await fs.writeFile(filename, source)
    const snapshot = await f.host.open(filename)
    const resources = { ...snapshot.model.resources, assets: { ...snapshot.model.resources.assets, 'pic.png': new Uint8Array([2]), 'resources/new.png': new Uint8Array([4]) } }
    const result = await f.host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId: 'new-picture', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: source + '\n![new](resources/new.png)', resources } } })
    expect(result.status).toBe('applied')
    const root = await f.host.files.registerRoot(f.root)
    const copied = await f.host.files.copy({ workspaceId: root.workspaceId, operationId: 'current-directory', sourceEntryIds: [await entry(f.host.files, root, 'unit')], targetDirectoryId: await entry(f.host.files, root, 'destination'), sourceVersion: 'current', resourcePolicy: 'copy' })
    expect(copied.status).toBe('success')
    expect(await fs.readFile(path.join(destination, 'unit', 'pic.png'))).toEqual(Buffer.from([2]))
    expect(await fs.readFile(path.join(destination, 'unit', 'resources', 'new.png'))).toEqual(Buffer.from([4]))
    const cold = await new DocumentHostService(path.join(f.root, 'cold')).open(path.join(destination, 'unit', 'note.md'))
    expect(cold.model.resources.components.resources['new.png']).toEqual(new Uint8Array([4]))
    expect(await fs.readFile(path.join(unit, 'pic.png'))).toEqual(Buffer.from([1]))
  })

  it('CA115 retries the original conversation relocation without replaying its physical rename', async () => {
    const f = await fixture(); await fs.writeFile(path.join(f.root, 'old.txt'), 'data')
    let fails = true
    const relocate = vi.fn(async (_input: { changes: unknown[] }) => { if (fails) { fails = false; throw new Error('metadata IO failed') } })
    const physical = vi.fn((source: string, target: string) => fs.rename(source, target))
    const files = new WorkspaceFiles({ fileOperations: { rename: physical } }), service = new WorkspaceFilesDesktopService(files, relocate)
    const root = await service.authorizeRoot(f.root), sourceEntryId = await entry(files, root, 'old.txt')
    expect((await service.operate({ type: 'rename', workspaceId: root.workspaceId, operationId: 'first', sourceEntryId, name: 'new.txt' })).status).toBe('partial')
    expect((await service.operate({ type: 'rename', workspaceId: root.workspaceId, operationId: 'retry', sourceEntryId, name: 'new.txt' })).status).toBe('success')
    expect(physical).toHaveBeenCalledOnce()
    expect(relocate.mock.calls[1]?.[0]).toMatchObject({ changes: [{ from: 'old.txt', to: 'new.txt' }] })
  })

  it('CA115 identical trash retry reports the completed original after repairing metadata', async () => {
    const f = await fixture(); await fs.writeFile(path.join(f.root, 'trash.txt'), 'data')
    let fails = true
    const relocate = vi.fn(async (_input: { changes: unknown[] }) => { if (fails) { fails = false; throw new Error('metadata failed') } })
    const trash = vi.fn((filename: string) => fs.unlink(filename)), files = new WorkspaceFiles({ trashItem: trash }), service = new WorkspaceFilesDesktopService(files, relocate)
    const root = await service.authorizeRoot(f.root), entryId = await entry(files, root, 'trash.txt')
    expect((await service.operate({ type: 'trash', workspaceId: root.workspaceId, operationId: 'first-trash', entryIds: [entryId] })).status).toBe('partial')
    const retried = await service.operate({ type: 'trash', workspaceId: root.workspaceId, operationId: 'retry-trash', entryIds: [entryId] })
    expect(retried.status).toBe('success'); expect(retried.operationId).toBe('retry-trash')
    expect(trash).toHaveBeenCalledOnce(); expect(relocate).toHaveBeenCalledTimes(2)
  })

  it('CA004 a cold saved course rename carries its existing raw input record', async () => {
    const f = await fixture(), project = createBlankCourseProjectV10()
    const created = await f.host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'A.glx')
    const saved = await f.host.saveToPath(created.documentId, path.join(f.root, 'A.glx'))
    await f.host.writeAuthoringDrafts(saved.documentId, { advanced: [{ kind: 'json', documentId: saved.documentId, epoch: saved.epoch, projectId: project.id, key: 'network', payload: '{raw' }], properties: [] })
    const cold = new DocumentHostService(f.journal), root = await cold.files.registerRoot(f.root)
    const renamed = await cold.files.rename({ workspaceId: root.workspaceId, operationId: 'cold-rename', sourceEntryId: await entry(cold.files, root, 'A.glx'), name: 'B.glx' })
    expect(renamed.status).toBe('success')
    const opened = await cold.open(path.join(f.root, 'B.glx'))
    expect((await cold.readAuthoringDrafts(opened.documentId))?.advanced[0]?.payload).toBe('{raw')
  })

  it('CA004 cold Save As reconciliation migrates raw input before reopening the published file', async () => {
    const f = await fixture(), project = createBlankCourseProjectV10()
    const created = await f.host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'A.glx')
    const saved = await f.host.saveToPath(created.documentId, path.join(f.root, 'A.glx'))
    await f.host.writeAuthoringDrafts(saved.documentId, { advanced: [{ kind: 'json', documentId: saved.documentId, epoch: saved.epoch, projectId: project.id, key: 'network', payload: '{raw-window' }], properties: [] })
    const journal = (f.host as any).journal, save = journal.save.bind(journal)
    vi.spyOn(journal, 'save').mockImplementation(async input => { await save(input); throw new Error('cut before ACK') })
    await expect(f.host.saveToPath(saved.documentId, path.join(f.root, 'B.glx'))).rejects.toThrow('cut before ACK')
    const cold = new DocumentHostService(f.journal); await cold.internalAPI.recoverable()
    const reopened = await cold.open(path.join(f.root, 'B.glx'))
    expect((await cold.readAuthoringDrafts(reopened.documentId))?.advanced[0]?.payload).toBe('{raw-window')
  })

  it('cold save proof never pairs an old publication version with content changed during baseline reading', async () => {
    const f = await fixture(), filename = path.join(f.root, 'proof.txt'); await fs.writeFile(filename, 'base')
    const opened = await f.host.open(filename)
    await f.host.internalAPI.dispatch({ documentId: opened.documentId, epoch: opened.epoch, operationId: 'proof-edit', baseRevision: opened.revision, actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: 'captured' } } })
    const journal = (f.host as any).journal, save = journal.save.bind(journal)
    vi.spyOn(journal, 'save').mockImplementation(async input => { await save(input); throw new Error('cut ACK') })
    await expect(f.host.saveToPath(opened.documentId)).rejects.toThrow('cut ACK')
    const cold = new DocumentHostService(f.journal), read = fs.readFile.bind(fs)
    let reads = 0
    vi.spyOn(fs, 'readFile').mockImplementation(async (...args: any[]) => {
      const bytes = await (read as any)(...args)
      if (String(args[0]) === filename && ++reads === 2) await fs.writeFile(filename, 'external after read')
      return bytes
    })
    const items = await cold.internalAPI.recoverable()
    expect(items.find(item => item.documentId === opened.documentId)).toMatchObject({ dirty: true, model: { source: 'captured' } })
    expect((await (cold as any).journal.inspect(opened.documentId)).savedModel).toMatchObject({ source: 'base' })
    expect(await read(filename, 'utf8')).toBe('external after read')
  })

  it('CA115 binding intent survives until saved-binding listeners complete, and cold repair repeats only metadata', async () => {
    const f = await fixture(), source = path.join(f.root, 'old.txt'); await fs.writeFile(source, 'saved')
    await f.host.open(source)
    let entered!: () => void, release!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve }), held = new Promise<void>(resolve => { release = resolve })
    f.host.fileCoordinator.subscribeRelocations(async () => { entered(); await held })
    const root = await f.host.files.registerRoot(f.root), sourceEntryId = await entry(f.host.files, root, 'old.txt')
    const moving = f.host.files.rename({ workspaceId: root.workspaceId, operationId: 'listener-cut', sourceEntryId, name: 'new.txt' })
    await waiting
    expect((await fs.readdir(path.join(f.journal, 'binding-intents'))).filter(name => name.endsWith('.json'))).toHaveLength(1)
    const cold = new DocumentHostService(f.journal), listener = vi.fn(async (_action: unknown) => {})
    cold.fileCoordinator.subscribeRelocations(listener)
    await cold.internalAPI.recoverable()
    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0]![0]).toMatchObject({ sources: [{ resolvedPath: source }], target: { resolvedPath: path.join(f.root, 'new.txt') } })
    expect(await fs.readFile(path.join(f.root, 'new.txt'), 'utf8')).toBe('saved')
    release(); expect((await moving).status).toBe('success')
  })

  it('CA337 cold move repair binds the dirty draft to the original, even when its old path is recreated', async () => {
    const f = await fixture(), source = path.join(f.root, 'source.txt'), target = path.join(f.root, 'target.txt'); await fs.writeFile(source, 'original')
    const opened = await f.host.open(source)
    await f.host.internalAPI.dispatch({ documentId: opened.documentId, epoch: opened.epoch, baseRevision: opened.revision, operationId: 'dirty', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: 'draft original' } } })
    if (opened.binding.kind !== 'file') throw new Error('fixture binding')
    const stat = await fs.lstat(source, { bigint: true }), operationId = 'cut-after-physical'
    const directory = path.join(f.journal, 'binding-intents'); await fs.mkdir(directory)
    await fs.writeFile(path.join(directory, createHash('sha256').update(`${operationId}\0${source}`).digest('hex') + '.json'), JSON.stringify({ schemaVersion: 1, operationId, source, target, kind: 'rename', entries: [{ documentId: opened.documentId, before: opened.binding, after: { ...opened.binding, path: target, bindingVersion: 2 }, fileIdentity: `${stat.dev}:${stat.ino}:${stat.birthtimeNs}` }] }))
    await fs.rename(source, target); await fs.writeFile(source, 'legitimate new file')
    const cold = new DocumentHostService(f.journal), recoverable = await cold.internalAPI.recoverable()
    expect(recoverable.find(item => item.documentId === opened.documentId)?.binding).toMatchObject({ path: target })
    expect(await fs.readFile(source, 'utf8')).toBe('legitimate new file')
    expect(await fs.readFile(target, 'utf8')).toBe('original')
  })

  it('CA372 unavailable journal is visible and explicit saved opening retains the damaged original', async () => {
    const f = await fixture(), filename = path.join(f.root, 'healthy.txt'); await fs.writeFile(filename, 'healthy saved text')
    const opened = await f.host.open(filename), record = path.join(f.journal, createHash('sha256').update(opened.documentId).digest('hex') + '.journal')
    const bytes = await fs.readFile(record); bytes[bytes.length - 9] ^= 1; await fs.writeFile(record, bytes)
    const cold = new DocumentHostService(f.journal), items = await cold.internalAPI.recoverable()
    expect(items.find(item => item.documentId === opened.documentId)).toMatchObject({ recoverable: false, dirty: false, recoveryUnavailable: expect.any(String), model: { source: 'healthy saved text' } })
    await expect(cold.open(filename)).rejects.toThrow('恢复记录')
    const saved = await cold.operate({ type: 'restore', documentId: opened.documentId, mode: 'saved' }) as any
    expect(saved.model.source).toBe('healthy saved text')
    expect((await fs.readdir(path.join(f.journal, 'unavailable'))).length).toBe(1)
    expect(await fs.readFile(filename, 'utf8')).toBe('healthy saved text')
  })
})
