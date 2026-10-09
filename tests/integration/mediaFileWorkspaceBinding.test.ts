// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { MediaFilesService } from '../../src/main/workbench/mediaFiles/MediaFilesService'
import { MediaFileDraft } from '../../src/renderer/documentFiles/media/mediaFileDraft'
import type { MediaFileSnapshot } from '../../src/shared/workbench/mediaFiles'
import { OfficeFileService } from '../../src/main/workbench/office/OfficeFileService'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('fixture outside temp')
    await fs.rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'media-binding-'))
  roots.push(root)
  const directory = path.join(root, 'workspace')
  await fs.mkdir(directory)
  const host = new DocumentHostService(path.join(root, 'state'))
  const service = new MediaFilesService(host.artifacts)
  const workspace = await host.files.registerRoot(directory)
  const entries = async (directoryEntryId = workspace.rootEntryId) => (await host.files.listChildren({ workspaceId: workspace.workspaceId, directoryEntryId })).entries
  const entry = async (name: string, directoryEntryId?: string) => {
    const item = (await entries(directoryEntryId)).find(item => item.name === name && item.status === 'accessible')
    if (!item) throw new Error(`missing fixture entry ${name}`)
    return item.entryId
  }
  const open = async (filename: string) => {
    const draft = new MediaFileDraft(await service.open(await host.artifacts.bind(filename)), {
      preview: (binding, operations) => service.preview(binding, operations),
      save: (binding, operations) => service.save(binding, operations),
      reload: binding => service.open(host.artifacts.resolveBinding(binding)),
    })
    host.artifacts.subscribeBindings(({ binding }) => draft.rebind(binding))
    return draft
  }
  return { root, directory, host, service, workspace, entry, open }
}

it('rebinds a renamed open PNG, preserves unsaved undo/redo and saves only the new location', async () => {
  const h = await fixture()
  const original = path.join(h.directory, 'picture.png'), target = path.join(h.directory, 'renamed.png')
  const bytes = await sharp({ create: { width: 30, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer()
  await fs.writeFile(original, bytes)
  const draft = await h.open(original)
  await draft.apply({ type: 'image.rotate', degrees: 90 }); await draft.undo()
  const result = await h.host.files.rename({ operationId: 'rename-open-image', workspaceId: h.workspace.workspaceId,
    sourceEntryId: await h.entry('picture.png'), name: 'renamed.png' })
  expect(result.status).toBe('success')
  expect(draft.read()).toMatchObject({ base: { binding: { path: target, bindingVersion: 2 } }, operations: [], redo: [{ type: 'image.rotate' }] })
  await fs.writeFile(original, 'unrelated new file at old path')
  await draft.redo()
  expect(draft.read().preview.content).toMatchObject({ width: 10, height: 30 })
  const saved = await draft.save()
  expect(saved?.binding.path).toBe(target)
  expect(draft.read().operations).toHaveLength(0)
  expect(await fs.readFile(original, 'utf8')).toBe('unrelated new file at old path')
  expect(await sharp(await fs.readFile(target)).metadata()).toMatchObject({ width: 10, height: 30, format: 'png' })
  expect(h.host.registry.list()).toHaveLength(0)
})

it('rebinds an open PDF inside a moved directory and retains its unsaved edit for save and reload', async () => {
  const h = await fixture()
  await fs.mkdir(path.join(h.directory, 'lesson')); await fs.mkdir(path.join(h.directory, 'destination'))
  const original = path.join(h.directory, 'lesson', 'notes.pdf'), target = path.join(h.directory, 'destination', 'lesson', 'notes.pdf')
  const pdf = await PDFDocument.create(); pdf.addPage([120, 80]); await fs.writeFile(original, await pdf.save())
  const draft = await h.open(original)
  await draft.apply({ type: 'pdf.rotate-page', page: 0, degrees: 90 })
  const result = await h.host.files.move({ operationId: 'move-open-pdf', workspaceId: h.workspace.workspaceId,
    sourceEntryIds: [await h.entry('lesson')], targetDirectoryId: await h.entry('destination') })
  expect(result.status).toBe('success')
  expect(draft.captureCopyDraft()).toMatchObject({ binding: { path: target, bindingVersion: 2 }, operations: [{ type: 'pdf.rotate-page' }] })
  expect((await PDFDocument.load(await fs.readFile(target))).getPage(0).getRotation().angle).toBe(0)
  expect((await draft.save())?.binding.path).toBe(target)
  expect((await PDFDocument.load(await fs.readFile(target))).getPage(0).getRotation().angle).toBe(90)
  expect((await draft.reload())?.binding.path).toBe(target)
  await expect(fs.access(original)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('copies a pending media gesture as current bytes inside the file lock without saving or waiting for its preview', async () => {
  const h = await fixture()
  const source = path.join(h.directory, 'picture.png'), destination = path.join(h.directory, 'copy')
  await fs.mkdir(destination)
  await fs.writeFile(source, await sharp({ create: { width: 30, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer())
  const snapshot = await h.service.open(await h.host.artifacts.bind(source))
  let complete!: (snapshot: MediaFileSnapshot) => void
  const draft = new MediaFileDraft(snapshot, {
    preview: () => new Promise(resolve => { complete = resolve }),
    save: (binding, operations) => h.service.save(binding, operations), reload: binding => h.service.open(binding),
  })
  const preview = draft.apply({ type: 'image.rotate', degrees: 90 })
  expect(draft.read().busy).toBe('preview')
  h.host.setMediaCopyPreparer(async (filename, kind) => {
    expect(filename).toBe(source); expect(kind).toBe('file')
    return [draft.captureCopyDraft()]
  })
  const copied = await h.host.files.copy({ operationId: 'copy-pending-media', workspaceId: h.workspace.workspaceId,
    sourceEntryIds: [await h.entry('picture.png')], targetDirectoryId: await h.entry('copy'), sourceVersion: 'current' })
  expect(copied.status).toBe('success')
  expect(copied.items[0].copied).toBe('current-draft')
  expect(await sharp(await fs.readFile(path.join(destination, 'picture.png'))).metadata()).toMatchObject({ width: 10, height: 30 })
  expect(await sharp(await fs.readFile(source)).metadata()).toMatchObject({ width: 30, height: 10 })
  expect(draft.read()).toMatchObject({ busy: 'preview', operations: [{ type: 'image.rotate' }] })
  await draft.undo()
  complete(await h.service.preview(snapshot.binding, [{ type: 'image.rotate', degrees: 90 }]))
  await preview
  expect(draft.read().preview.content).toMatchObject({ width: 30, height: 10 })
  expect(draft.read().redo).toHaveLength(1)
  await fs.writeFile(source, await sharp({ create: { width: 15, height: 15, channels: 3, background: '#000000' } }).png().toBuffer())
  await h.host.artifacts.bind(source)
  await expect(h.host.files.copy({ operationId: 'copy-stale-media', workspaceId: h.workspace.workspaceId,
    sourceEntryIds: [await h.entry('picture.png')], targetDirectoryId: await h.entry('copy'), sourceVersion: 'current' })).resolves.toMatchObject({
      status: 'failed', items: [{ error: { code: 'file-operation-failed', message: expect.stringContaining('文件绑定已失效') } }] })
  expect(await sharp(await fs.readFile(path.join(destination, 'picture.png'))).metadata()).toMatchObject({ width: 10, height: 30 })
})

it('rejects a cached Office binding after relocation even when its old path is reopened with identical bytes', async () => {
  const h = await fixture()
  const office = new OfficeFileService(h.host)
  const created = await office.create({ operationId: 'create-office', workspaceId: h.workspace.workspaceId,
    targetDirectoryId: h.workspace.rootEntryId, name: 'A.docx' }, {
    format: 'docx', operation: 'create', blocks: [{ type: 'paragraph', text: 'Original office content' }],
  })
  const cached = (await office.inspect(created.binding, 'docx')).binding
  const original = created.binding.path, bytes = await fs.readFile(original)
  const outside = path.join(h.root, 'other-task'); await fs.mkdir(outside)
  const target = await h.host.files.registerRoot(outside)
  const moved = await h.host.files.move({ operationId: 'move-office-to-other-task', workspaceId: h.workspace.workspaceId,
    sourceEntryIds: [await h.entry('A.docx')], targetWorkspaceId: target.workspaceId, targetDirectoryId: target.rootEntryId })
  expect(moved.status).toBe('success')
  await fs.writeFile(original, bytes)
  const recreated = await h.host.artifacts.bind(original)
  expect(recreated.bindingVersion).not.toBe(cached.bindingVersion)
  await expect(office.edit(cached, { format: 'docx', operation: 'edit', edits: [{ type: 'paragraph', index: 0, text: 'Wrong target' }] })).rejects.toThrow('文件绑定已失效')
  await expect(h.host.artifacts.replace(cached, new Uint8Array([1]))).rejects.toThrow('文件绑定已失效')
  expect((await office.inspect(recreated, 'docx')).inspection).toMatchObject({ format: 'docx', paragraphs: [{ text: 'Original office content' }] })
  const movedBinding = h.host.artifacts.resolveBinding(created.binding)
  expect(movedBinding.path).toBe(path.join(outside, 'A.docx'))
  expect((await office.inspect(movedBinding, 'docx')).inspection).toMatchObject({ format: 'docx', paragraphs: [{ text: 'Original office content' }] })
})
