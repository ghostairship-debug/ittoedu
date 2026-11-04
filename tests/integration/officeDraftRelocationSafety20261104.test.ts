// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { FileArtifactHistory } from '../../src/main/workbench/FileArtifactHistory'
import { FileArtifactService } from '../../src/main/workbench/FileArtifactService'
import { OfficeFileService } from '../../src/main/workbench/office/OfficeFileService'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'

const body = (bytes: Uint8Array) => {
  const content = inspectOfficeContent(bytes, 'docx')
  if (content.format !== 'docx') throw new Error('Expected DOCX')
  return content.paragraphs[0].text
}
async function rename(host: DocumentHostService, workspace: string) {
  const root = await host.files.registerRoot(workspace)
  const list = await host.files.listChildren({ workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })
  const source = list.entries.find(item => item.name === 'source.docx' && item.status === 'accessible')
  if (!source || source.status !== 'accessible') throw new Error('Missing source')
  return host.files.rename({ operationId: 'recovery-safety', workspaceId: root.workspaceId, sourceEntryId: source.entryId, name: 'target.docx' })
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-relocation-safety-'))
  const workspace = path.join(root, 'workspace'), owner = path.join(root, 'owner')
  await fs.mkdir(workspace)
  const source = path.join(workspace, 'source.docx'), target = path.join(workspace, 'target.docx')
  const original = (await applyOfficeContent(undefined, { format: 'docx', operation: 'create', blocks: [{ type: 'paragraph', text: 'original' }] })).bytes
  await fs.writeFile(source, original)
  return { root, workspace, owner, source, target, original }
}
it('blocks a move to a vacant path with another file’s recovery draft', async () => {
  const f = await fixture()
  try {
    const history = new FileArtifactHistory(path.join(f.owner, 'artifact-history'))
    await history.persistOfficeDraft(f.target, { baseVersion: 'prior', original: f.original, bytes: f.original, offset: 0, branchOffset: 0, past: [], future: [] })
    const host = new DocumentHostService(f.owner)
    const result = await rename(host, f.workspace).catch(error => ({ status: 'failed', error }))
    expect(result.status).not.toBe('success')
    expect(await fs.readFile(f.source)).toEqual(Buffer.from(f.original))
    expect(await history.readOfficeDraft(f.target)).toBeDefined()
    await expect(fs.stat(f.target)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await fs.rm(f.root, { recursive: true, force: true }) }
}, 20_000)

it('repairs a cold draft relocation after callback failures without moving the file again', async () => {
  const f = await fixture()
  try {
    const warmHost = new DocumentHostService(f.owner), office = new OfficeFileService(warmHost)
    const open = await office.bindWorking(f.source, true)
    await office.edit(open, { format: 'docx', operation: 'edit', edits: [{ type: 'paragraph', index: 0, text: 'unsaved' }] })
    await warmHost.artifacts.preserveOfficeDrafts()
    await warmHost.artifacts.releaseOfficeDrafts(false, true)
    const original = FileArtifactHistory.prototype.relocateMatching
    let failures = 2
    const spy = vi.spyOn(FileArtifactHistory.prototype, 'relocateMatching').mockImplementation(function (this: FileArtifactHistory, ...args) {
      if (failures-- > 0) return Promise.reject(new Error('injected history failure'))
      return original.apply(this, args)
    })
    try {
      const host = new DocumentHostService(f.owner)
      const result = await rename(host, f.workspace)
      expect(result.status).toBe('partial')
      expect(await fs.readFile(f.target)).toEqual(Buffer.from(f.original))
      await expect(fs.stat(f.source)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { spy.mockRestore() }
    const host = new DocumentHostService(f.owner), cold = new OfficeFileService(host)
    const binding = await cold.bindWorking(f.target, true)
    expect(body(await cold.readWorking(binding))).toBe('unsaved')
    expect(await fs.readFile(f.target)).toEqual(Buffer.from(f.original))
  } finally { await fs.rm(f.root, { recursive: true, force: true }) }
}, 20_000)

it('does not overwrite a newer target draft when a partially completed relocation is retried', async () => {
  const f = await fixture()
  try {
    const history = new FileArtifactHistory(path.join(f.owner, 'artifact-history'))
    const first = { baseVersion: 'first', original: f.original, bytes: f.original, offset: 0, branchOffset: 0, past: [], future: [] }
    await history.persistOfficeDraft(f.source, first)
    const failure = vi.spyOn(history, 'removeOfficeDraft').mockRejectedValueOnce(new Error('injected cleanup failure'))
    await expect(history.relocate(f.source, f.target)).rejects.toThrow('injected cleanup failure')
    failure.mockRestore()
    await history.persistOfficeDraft(f.target, { ...first, baseVersion: 'newer' })
    await expect(history.relocate(f.source, f.target)).rejects.toThrow('两份恢复稿均已保留')
    expect((await history.readOfficeDraft(f.source))?.baseVersion).toBe('first')
    expect((await history.readOfficeDraft(f.target))?.baseVersion).toBe('newer')
  } finally { await fs.rm(f.root, { recursive: true, force: true }) }
}, 20_000)

it('finishes cleanup when a retry finds the identical already-published recovery draft', async () => {
  const f = await fixture()
  try {
    const history = new FileArtifactHistory(path.join(f.owner, 'artifact-history'))
    await history.persistOfficeDraft(f.source, { baseVersion: 'first', original: f.original, bytes: f.original,
      offset: 0, branchOffset: 0, past: [], future: [] })
    const failure = vi.spyOn(history, 'removeOfficeDraft').mockRejectedValueOnce(new Error('injected cleanup failure'))
    await expect(history.relocate(f.source, f.target)).rejects.toThrow('injected cleanup failure')
    failure.mockRestore()
    await history.relocate(f.source, f.target)
    expect(await history.readOfficeDraft(f.source)).toBeUndefined()
    expect((await history.readOfficeDraft(f.target))?.baseVersion).toBe('first')
  } finally { await fs.rm(f.root, { recursive: true, force: true }) }
}, 20_000)

it('repairs a verified cross-volume copy after the relocation listener fails', async () => {
  const f = await fixture()
  try {
    const destination = path.join(f.workspace, 'folder'), target = path.join(destination, 'source.docx')
    await fs.mkdir(destination)
    const warm = new DocumentHostService(f.owner), office = new OfficeFileService(warm)
    const binding = await office.bindWorking(f.source, true)
    await office.edit(binding, { format: 'docx', operation: 'edit', edits: [{ type: 'paragraph', index: 0, text: 'cross-volume draft' }] })
    await warm.artifacts.preserveOfficeDrafts()
    await warm.artifacts.releaseOfficeDrafts(false, true)
    const original = FileArtifactHistory.prototype.relocateMatching
    let failures = 2
    const spy = vi.spyOn(FileArtifactHistory.prototype, 'relocateMatching').mockImplementation(function (this: FileArtifactHistory, ...args) {
      if (failures-- > 0) return Promise.reject(new Error('injected callback failure'))
      return original.apply(this, args)
    })
    try {
      const host = new DocumentHostService(f.owner, { fileOperations: { async rename(from, to) {
        if (from === f.source) throw Object.assign(new Error('cross-volume'), { code: 'EXDEV' })
        await fs.rename(from, to)
      } } })
      const root = await host.files.registerRoot(f.workspace)
      const list = await host.files.listChildren({ workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })
      const source = list.entries.find(entry => entry.name === 'source.docx' && entry.status === 'accessible')
      const folder = list.entries.find(entry => entry.name === 'folder' && entry.status === 'accessible')
      if (!source || source.status !== 'accessible' || !folder || folder.status !== 'accessible') throw new Error('Missing entries')
      const moved = await host.files.move({ operationId: 'exdev-recovery', workspaceId: root.workspaceId,
        sourceEntryIds: [source.entryId], targetDirectoryId: folder.entryId })
      expect(moved.status).toBe('partial')
      await expect(fs.stat(f.source)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await fs.readFile(target)).toEqual(Buffer.from(f.original))
    } finally { spy.mockRestore() }
    const cold = new OfficeFileService(new DocumentHostService(f.owner))
    expect(body(await cold.readWorking(await cold.bindWorking(target, true)))).toBe('cross-volume draft')
    expect(await fs.readFile(target)).toEqual(Buffer.from(f.original))
  } finally { await fs.rm(f.root, { recursive: true, force: true }) }
}, 20_000)

it('constructs with an older host stub without relocation preflight support', () => {
  const host = { fileCoordinator: { subscribeRelocations: () => () => {} } } as unknown as DocumentHostService
  expect(() => new FileArtifactService(host)).not.toThrow()
})
