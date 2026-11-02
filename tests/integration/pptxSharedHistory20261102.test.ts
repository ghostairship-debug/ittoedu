// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { FileArtifactHistory } from '../../src/main/workbench/FileArtifactHistory'
import { OfficeFileService } from '../../src/main/workbench/office/OfficeFileService'
import { applyOfficeContent } from '../../src/main/workbench/office/OfficeContentService'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pptx-common-history-')); roots.push(directory)
  const workspace = path.join(directory, 'workspace'), ownerDirectory = path.join(directory, 'owner')
  await fs.mkdir(workspace)
  const host = new DocumentHostService(ownerDirectory), office = new OfficeFileService(host)
  const root = await host.files.registerRoot(workspace)
  const created = await office.create({ workspaceId: root.workspaceId, targetDirectoryId: root.rootEntryId, name: 'shared.pptx', operationId: 'create-shared' }, {
    format: 'pptx', operation: 'create', slides: [{ title: 'Before', body: ['Keep this human content'] }, { title: 'Unrelated page' }],
  })
  return { host, office, ownerDirectory, created }
}

describe('PPT human and AI changes share the physical owner and durable history', () => {
  it('retains human text through AI geometry editing, then cold-restores the shared undo/redo chain', async () => {
    const f = await fixture()
    const human = await f.office.edit(f.created.binding, { format: 'pptx', operation: 'edit', edits: [{ slide: 0, shape: 'title', text: 'Human title' }] }, {
      actor: 'human', historyLabel: '修改标题', operationId: 'human-title',
    })
    if (human.inspection.format !== 'pptx') throw new Error('wrong format')
    const body = human.inspection.slides[0].shapes.find(object => object.name === 'body')!
    const ai = await new OfficeFileService(f.host).edit(human.binding, { format: 'pptx', operation: 'edit', edits: [{
      slide: 0, shapeId: body.shapeId, part: human.inspection.slides[0].part, partVersion: human.inspection.slides[0].partVersion, type: 'transform', x: 80,
    }] }, { actor: 'ai', historyLabel: '调整正文位置', operationId: 'ai-position' })
    const beforeCold = await f.office.history(ai.binding)
    expect(beforeCold.undoDepth).toBe(2)
    expect(beforeCold.entries.map(entry => [entry.id, entry.actor])).toEqual([['human-title', 'human'], ['ai-position', 'ai']])
    await expect(f.office.edit(human.binding, { format: 'pptx', operation: 'edit', edits: [{ slide: 0, shape: 'title', text: 'Stale overwrite' }] })).rejects.toThrow('文件绑定已失效')

    const coldHost = new DocumentHostService(f.ownerDirectory), cold = new OfficeFileService(coldHost)
    const binding = await coldHost.artifacts.bind(ai.binding.path)
    expect(await cold.history(binding)).toEqual(beforeCold)
    const undone = await cold.moveHistory(binding, 'undo')
    if (undone.inspection.format !== 'pptx') throw new Error('wrong format')
    expect(undone.inspection.slides[0].shapes.find(object => object.name === 'title')?.text).toBe('Human title')
    expect(undone.inspection.slides[0].shapes.find(object => object.name === 'body')?.frame).toEqual(body.frame)
    expect((await cold.history(undone.binding)).redoDepth).toBe(1)
    const redone = await cold.moveHistory(undone.binding, 'redo')
    if (redone.inspection.format !== 'pptx') throw new Error('wrong format')
    expect(redone.inspection.slides[0].shapes.find(object => object.name === 'body')?.frame?.x).toBe(80)
    expect(redone.inspection.slides[0].shapes.find(object => object.name === 'title')?.text).toBe('Human title')
    expect(redone.inspection.slides[1].shapes.find(object => object.name === 'title')?.text).toBe('Unrelated page')
  })

  it('recovers an accepted write with a lost history acknowledgement instead of replaying it', async () => {
    const f = await fixture()
    const changes: Array<{ binding: { fileVersion: string } }> = []
    const unsubscribe = f.host.artifacts.subscribeBindings(event => changes.push(event))
    vi.spyOn(FileArtifactHistory.prototype, 'confirm').mockRejectedValueOnce(new Error('simulated interrupted acknowledgement'))
    await expect(f.office.edit(f.created.binding, { format: 'pptx', operation: 'edit', edits: [{ slide: 0, shape: 'title', text: 'Saved once' }] }, {
      actor: 'human', operationId: 'saved-once',
    })).rejects.toThrow('文件已写入')
    unsubscribe()
    expect(changes).toHaveLength(1)
    expect(changes[0].binding.fileVersion).not.toBe(f.created.binding.fileVersion)
    const coldHost = new DocumentHostService(f.ownerDirectory), cold = new OfficeFileService(coldHost)
    const binding = await coldHost.artifacts.bind(f.created.binding.path)
    const history = await cold.history(binding)
    expect(history.undoDepth).toBe(1)
    expect(history.entries[0].id).toBe('saved-once')
    const current = await cold.inspect(binding, 'pptx')
    if (current.inspection.format !== 'pptx') throw new Error('wrong format')
    expect(current.inspection.slides[0].shapes.find(object => object.name === 'title')?.text).toBe('Saved once')
  })

  it('keeps the old binding/history when a prepared change is stopped before commit, and refuses to undo over an external edit', async () => {
    const f = await fixture(), original = await fs.readFile(f.created.binding.path)
    await expect(f.host.artifacts.replace(f.created.binding, Uint8Array.from([1, 2, 3]), undefined, () => { throw new Error('stopped at commit') }, {
      actor: 'human', label: 'Should not publish',
    })).rejects.toThrow('stopped at commit')
    expect(await f.host.artifacts.read(f.created.binding)).toEqual(Uint8Array.from(original))
    expect((await f.office.history(f.created.binding)).undoDepth).toBe(0)
    const edited = await f.office.edit(f.created.binding, { format: 'pptx', operation: 'edit', edits: [{ slide: 0, shape: 'title', text: 'Internal edit' }] })
    const external = await applyOfficeContent(await fs.readFile(edited.binding.path), { format: 'pptx', operation: 'edit', edits: [{ slide: 0, shape: 'title', text: 'External edit' }] })
    await fs.writeFile(edited.binding.path, external.bytes)
    await expect(f.office.moveHistory(edited.binding, 'undo')).rejects.toThrow('磁盘文件已改变')
    const current = await f.host.artifacts.bind(edited.binding.path)
    expect((await f.office.history(current)).undoDepth).toBe(0)
    await expect(f.office.moveHistory(current, 'undo')).rejects.toThrow('外部修改')
    expect(await fs.readFile(current.path)).toEqual(Buffer.from(external.bytes))
  })

  it('clears only a preparation rejected by physical CAS, allowing the external version to start a new branch', async () => {
    const f = await fixture()
    const external = await applyOfficeContent(await fs.readFile(f.created.binding.path), { format: 'pptx', operation: 'edit', edits: [{ slide: 0, shape: 'title', text: 'External C' }] })
    const prepare = FileArtifactHistory.prototype.prepareWrite
    vi.spyOn(FileArtifactHistory.prototype, 'prepareWrite').mockImplementationOnce(async function (this: FileArtifactHistory, ...args) {
      const token = await prepare.apply(this, args)
      await fs.writeFile(f.created.binding.path, external.bytes)
      return token
    })
    await expect(f.office.edit(f.created.binding, { format: 'pptx', operation: 'edit', edits: [{ slide: 0, shape: 'title', text: 'Rejected B' }] })).rejects.toThrow('磁盘文件已改变')
    const current = await f.host.artifacts.bind(f.created.binding.path)
    expect((await f.office.history(current)).undoDepth).toBe(0)
    const continued = await f.office.edit(current, { format: 'pptx', operation: 'edit', edits: [{ slide: 0, shape: 'title', text: 'New D' }] })
    expect((await f.office.history(continued.binding)).undoDepth).toBe(1)
    const undone = await f.office.moveHistory(continued.binding, 'undo')
    if (undone.inspection.format !== 'pptx') throw new Error('wrong format')
    expect(undone.inspection.slides[0].shapes.find(shape => shape.name === 'title')?.text).toBe('External C')
  })

  it('preserves cold unopened document history when its physical path is relocated', async () => {
    const f = await fixture()
    const saved = await f.office.edit(f.created.binding, { format: 'pptx', operation: 'edit', edits: [{ slide: 0, shape: 'title', text: 'Saved with history' }] })
    const destination = path.join(path.dirname(saved.binding.path), 'renamed.pptx')
    await fs.rename(saved.binding.path, destination)
    // Same callback used by the file owner, invoked before any new-process bind of this PPTX.
    const history = new FileArtifactHistory(path.join(f.ownerDirectory, 'artifact-history'))
    await history.relocateMatching(filename => filename === saved.binding.path ? destination : undefined)
    const coldHost = new DocumentHostService(f.ownerDirectory), office = new OfficeFileService(coldHost)
    const binding = await coldHost.artifacts.bind(destination)
    expect((await office.history(binding)).undoDepth).toBe(1)
    const undone = await office.moveHistory(binding, 'undo')
    if (undone.inspection.format !== 'pptx') throw new Error('wrong format')
    expect(undone.inspection.slides[0].shapes.find(shape => shape.name === 'title')?.text).toBe('Before')
  })

  it('archives an earlier destination history and survives interruption after publishing a relocated history', async () => {
    const f = await fixture()
    const destination = path.join(path.dirname(f.created.binding.path), 'previous.pptx')
    const historyDirectory = path.join(f.ownerDirectory, 'artifact-history')
    const history = new FileArtifactHistory(historyDirectory)
    const oldBefore = Buffer.from('old destination before'), oldAfter = Buffer.from('old destination after')
    await history.prepareWrite(destination, oldBefore, oldAfter, { actor: 'human', label: 'Prior destination', operationId: 'prior-destination' })
    await history.confirm(destination, oldAfter)
    const source = await f.office.edit(f.created.binding, { format: 'pptx', operation: 'edit', edits: [{ slide: 0, shape: 'title', text: 'Source edit' }] }, {
      actor: 'human', operationId: 'source-edit',
    })
    const records = await fs.readdir(historyDirectory)
    const sourceRecord = (await Promise.all(records.filter(name => name.endsWith('.json')).map(async name => ({ name,
      value: JSON.parse(await fs.readFile(path.join(historyDirectory, name), 'utf8')) })))).find(item => item.value.path === source.binding.path)!
    const rename = fs.rename.bind(fs)
    const archiveFault = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to).includes('.json.branch-')) throw new Error('archive unavailable')
      return rename(from, to)
    })
    await expect(history.relocate(source.binding.path, destination)).rejects.toThrow('archive unavailable')
    archiveFault.mockRestore()
    expect((await history.snapshot(destination, oldAfter)).entries[0].id).toBe('prior-destination')
    expect((await history.snapshot(source.binding.path, await fs.readFile(source.binding.path))).undoDepth).toBe(1)
    const remove = fs.rm.bind(fs)
    const fault = vi.spyOn(fs, 'rm').mockImplementation(async (filename, options) => {
      if (String(filename) === path.join(historyDirectory, sourceRecord.name)) throw new Error('interrupted before source removal')
      return remove(filename, options)
    })
    await expect(history.relocate(source.binding.path, destination)).rejects.toThrow('interrupted before source removal')
    fault.mockRestore()
    expect((await history.snapshot(source.binding.path, await fs.readFile(source.binding.path))).undoDepth).toBe(1)
    await history.relocate(source.binding.path, destination)
    const archives = (await fs.readdir(historyDirectory)).filter(name => name.includes('.json.branch-'))
    const preserved = await Promise.all(archives.map(name => fs.readFile(path.join(historyDirectory, name), 'utf8')))
    expect(preserved.some(value => JSON.parse(value).past.some((entry: { id: string }) => entry.id === 'prior-destination'))).toBe(true)
    expect((await history.snapshot(destination, await fs.readFile(source.binding.path))).entries[0].id).toBe('source-edit')
  })

  it('also cancels an undo preparation when another writer wins the final physical CAS', async () => {
    const f = await fixture()
    const edited = await f.office.edit(f.created.binding, { format: 'pptx', operation: 'edit', edits: [{ slide: 0, shape: 'title', text: 'Internal B' }] })
    const external = await applyOfficeContent(await fs.readFile(edited.binding.path), { format: 'pptx', operation: 'edit', edits: [{ slide: 0, shape: 'title', text: 'External C' }] })
    const prepare = FileArtifactHistory.prototype.prepareMove
    vi.spyOn(FileArtifactHistory.prototype, 'prepareMove').mockImplementationOnce(async function (this: FileArtifactHistory, ...args) {
      const pending = await prepare.apply(this, args)
      await fs.writeFile(edited.binding.path, external.bytes)
      return pending
    })
    await expect(f.office.moveHistory(edited.binding, 'undo')).rejects.toThrow('磁盘文件已改变')
    const current = await f.host.artifacts.bind(edited.binding.path)
    expect((await f.office.history(current)).undoDepth).toBe(0)
    const continued = await f.office.edit(current, { format: 'pptx', operation: 'edit', edits: [{ slide: 0, shape: 'title', text: 'Continued D' }] })
    expect((await f.office.history(continued.binding)).undoDepth).toBe(1)
  })
})
