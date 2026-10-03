// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { OfficeFileService } from '../../src/main/workbench/office/OfficeFileService'
import { applyOfficeContent, inspectOfficeContent, type OfficeContentRequest, type OfficeFormat } from '../../src/main/workbench/office/OfficeContentService'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('fixture outside temp')
    await fs.rm(resolved, { recursive: true, force: true })
  }
})
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'unified-office-owner-')); roots.push(directory)
  const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace)
  const host = new DocumentHostService(path.join(directory, 'owner'))
  const root = await host.files.registerRoot(workspace)
  const office = new OfficeFileService(host)
  return { host, office, workspace, root, destination: (format: OfficeFormat, operationId = `create-${format}`) => ({
    operationId, workspaceId: root.workspaceId, targetDirectoryId: root.rootEntryId, name: `lesson.${format}`,
  }) }
}
const createRequests: Record<OfficeFormat, Extract<OfficeContentRequest, { operation: 'create' }>> = {
  docx: { format: 'docx', operation: 'create', blocks: [{ type: 'paragraph', text: 'Before' }, { type: 'paragraph', text: 'Keep this paragraph' }] },
  xlsx: { format: 'xlsx', operation: 'create', sheets: [{ name: 'Data', rows: [[2, { formula: 'A1*3' }, 'Keep this cell']] }] },
  pptx: { format: 'pptx', operation: 'create', slides: [{ title: 'Before', body: ['Keep this body'] }, { title: 'Keep this slide' }] },
}
const editRequests: Record<OfficeFormat, Extract<OfficeContentRequest, { operation: 'edit' }>> = {
  docx: { format: 'docx', operation: 'edit', edits: [{ type: 'paragraph', index: 0, text: 'After' }] },
  xlsx: { format: 'xlsx', operation: 'edit', edits: [{ sheet: 'Data', cell: 'A1', value: 4 }] },
  pptx: { format: 'pptx', operation: 'edit', edits: [{ slide: 0, shape: 'title', text: 'After' }] },
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

describe('Office files share the existing physical owner', () => {
  it.each(['docx', 'xlsx', 'pptx'] as const)('creates, edits and reopens saved %s bytes with a new binding', async format => {
    const f = await fixture()
    const created = await f.office.create(f.destination(format), createRequests[format])
    expect(created.status).toBe('saved')
    expect(path.basename(created.binding.path)).toBe(`lesson.${format}`)
    const edited = await f.office.edit(created.binding, editRequests[format])
    expect(edited.status).toBe('saved')
    expect(edited.binding.bindingVersion).toBe(created.binding.bindingVersion + 1)
    expect(edited.binding.fileVersion).not.toBe(created.binding.fileVersion)
    const reopened = await f.office.inspect(edited.binding, format)
    expect(reopened.inspection).toEqual(inspectOfficeContent(await fs.readFile(edited.binding.path), format))
    const inspection = reopened.inspection
    if (inspection.format === 'docx') expect(inspection.paragraphs.map(paragraph => paragraph.text)).toEqual(['After', 'Keep this paragraph'])
    if (inspection.format === 'xlsx') {
      expect(inspection.sheets[0].cells).toEqual(expect.arrayContaining([
        { cell: 'A1', value: 4 }, { cell: 'B1', value: 12, formula: 'A1*3' }, { cell: 'C1', value: 'Keep this cell' },
      ]))
      expect(edited.calculation?.status).toBe('complete')
    }
    if (inspection.format === 'pptx') {
      expect(inspection.slides[0].shapes.find(shape => shape.name === 'title')?.text).toBe('After')
      expect(inspection.slides[1].shapes.find(shape => shape.name === 'title')?.text).toBe('Keep this slide')
    }
    await expect(f.office.edit(created.binding, editRequests[format])).rejects.toThrow('文件绑定已失效')
    expect(await fs.readdir(f.workspace)).toEqual([`lesson.${format}`])
  })

  it('preserves an external disk edit instead of overwriting it with a stale Office binding', async () => {
    const f = await fixture()
    const created = await f.office.create(f.destination('docx'), createRequests.docx)
    const external = await applyOfficeContent(undefined, { format: 'docx', operation: 'create', blocks: [{ type: 'paragraph', text: 'External owner content' }] })
    await fs.writeFile(created.binding.path, external.bytes)
    await expect(f.office.edit(created.binding, editRequests.docx)).rejects.toThrow('磁盘文件已改变')
    const current = await f.host.artifacts.bind(created.binding.path)
    const inspection = (await f.office.inspect(current, 'docx')).inspection
    if (inspection.format !== 'docx') throw new Error('wrong format')
    expect(inspection.paragraphs[0].text).toBe('External owner content')
    expect(await fs.readdir(f.workspace)).toEqual(['lesson.docx'])
  })

  it.each(['signal', 'assertActive'] as const)('stops a queued replacement at the final owner boundary using %s', async stopKind => {
    const f = await fixture()
    const created = await f.office.create(f.destination('docx'), createRequests.docx)
    const blockerEntered = deferred(), releaseBlocker = deferred(), replacementQueued = deferred()
    let blocker!: Promise<void>
    const read = f.host.artifacts.read.bind(f.host.artifacts)
    vi.spyOn(f.host.artifacts, 'read').mockImplementationOnce(async (...args) => {
      const bytes = await read(...args)
      blocker = f.host.fileCoordinator.withFileOperation(async () => { blockerEntered.resolve(); await releaseBlocker.promise })
      await blockerEntered.promise
      return bytes
    })
    const replace = f.host.artifacts.replace.bind(f.host.artifacts)
    vi.spyOn(f.host.artifacts, 'replace').mockImplementation((...args) => { replacementQueued.resolve(); return replace(...args) })
    const abort = new AbortController()
    let stopped = false
    const pending = f.office.edit(created.binding, editRequests.docx, { signal: abort.signal, assertActive: () => { if (stopped) throw new Error('任务已停止') } })
    // Attach the rejection observer before releasing the queued file operation.
    const rejected = expect(pending).rejects.toThrow(stopKind === 'signal' ? 'aborted' : '任务已停止')
    await replacementQueued.promise
    if (stopKind === 'signal') abort.abort()
    else stopped = true
    releaseBlocker.resolve(); await blocker; await rejected
    const inspection = (await f.office.inspect(created.binding, 'docx')).inspection
    if (inspection.format !== 'docx') throw new Error('wrong format')
    expect(inspection.paragraphs[0].text).toBe('Before')
    expect(await fs.readdir(f.workspace)).toEqual(['lesson.docx'])
  })

  it('stops a queued new-file publication before the physical rename and removes its staged file', async () => {
    const f = await fixture()
    const blockerEntered = deferred(), releaseBlocker = deferred(), creationQueued = deferred()
    const blocker = f.host.fileCoordinator.withFileOperation(async () => { blockerEntered.resolve(); await releaseBlocker.promise })
    await blockerEntered.promise
    const create = f.host.files.createFile.bind(f.host.files)
    vi.spyOn(f.host.files, 'createFile').mockImplementation((...args) => { creationQueued.resolve(); return create(...args) })
    let stopped = false
    const pending = f.office.create(f.destination('docx'), createRequests.docx, { assertActive: () => { if (stopped) throw new Error('任务已停止') } })
    const rejected = expect(pending).rejects.toThrow('任务已停止')
    await creationQueued.promise; stopped = true; releaseBlocker.resolve(); await blocker; await rejected
    expect(await fs.readdir(f.workspace)).toEqual([])
  })
})
