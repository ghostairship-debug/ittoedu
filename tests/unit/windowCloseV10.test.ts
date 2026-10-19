// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { prepareDocumentWindowClose, type DocumentClosePorts } from '../../src/main/workbench/documentCloseCoordinator'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture path')
    await fs.rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'window-close-v10-')); roots.push(root)
  const host = new DocumentHostService(path.join(root, 'journal'))
  const course = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10(), resources: { assets: {}, components: {} } }, 'course.h5lesson')
  await host.writeAuthoringDrafts(course.documentId, {
    advanced: [{ kind: 'json', documentId: course.documentId, epoch: course.epoch, projectId: course.model.kind === 'course-v10' ? course.model.project.id : '', key: 'unfinished', payload: '{' }],
    properties: [{ bindingKey: JSON.stringify([course.documentId, course.epoch, 'property']), kind: 'number', label: '宽度', raw: '-', composing: false }],
  })
  for (const name of ['notes.txt', 'lesson.md', 'page.html']) {
    const filename = path.join(root, name)
    await fs.writeFile(filename, `original ${name}`)
    const snapshot = await host.open(filename)
    await host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: `edit-${name}`, baseRevision: snapshot.revision, actor: 'human',
      mutation: { type: 'command', command: { type: 'markdown.replace', source: `changed ${name}` } } })
  }
  const order: string[] = []
  const ports: DocumentClosePorts = {
    list: () => host.registry.list(), drain: async () => { for (const snapshot of host.registry.list()) await host.registry.get(snapshot.documentId).drain() },
    rendererDirty: async () => true, confirm: () => 'discard',
    prepareRenderer: vi.fn(async mode => { order.push(mode); return true }),
    save: vi.fn(id => host.saveToPath(id)),
    withWriteBarrier: (ids, work) => host.tools.withWriteTaskBarrier(ids, work),
    stopWriters: async () => { order.push('stop') },
    discard: async snapshots => {
      order.push('discard-main')
      for (const snapshot of snapshots) {
        const current = await host.registry.get(snapshot.documentId).drain()
        await host.operate({ type: 'close', documentId: snapshot.documentId, discardDirty: true, expected: { epoch: snapshot.epoch, revision: current.revision } })
      }
      return true
    },
  }
  return { root, host, course, ports, order }
}

describe('V10 mixed window close', () => {
  it('discards formal recovery after suspension while preserving unresolved raw input', async () => {
    const f = await fixture()
    expect(await prepareDocumentWindowClose(f.ports)).toBe(true)
    expect(f.order).toEqual(['discard', 'stop', 'discard-main'])
    expect(f.ports.save).not.toHaveBeenCalled()
    expect(f.host.registry.list()).toEqual([])
    const candidates = await f.host.internalAPI.recoverable()
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ documentId: f.course.documentId, rawInputOnly: true, recoverable: false, undoDepth: 0, model: { kind: 'text' } })
    const material = await f.host.internalAPI.restore(f.course.documentId)
    expect(material.documentId).not.toBe(f.course.documentId)
    expect(material.model).toMatchObject({ kind: 'text', source: expect.stringContaining(`原文档：${f.course.documentId}`) })
    expect(material.undoDepth).toBe(0)
    const rawFiles = await fs.readdir(path.join(f.root, 'journal', 'authoring-drafts'))
    expect(rawFiles).toHaveLength(1)
    const raw = JSON.parse(await fs.readFile(path.join(f.root, 'journal', 'authoring-drafts', rawFiles[0]!), 'utf8'))
    expect(raw.documentId).toBe(f.course.documentId)
    expect(raw.records.map((record: {kind: string}) => record.kind).sort()).toEqual(['advanced', 'properties'])
    for (const name of ['notes.txt', 'lesson.md', 'page.html']) expect(await fs.readFile(path.join(f.root, name), 'utf8')).toBe(`original ${name}`)
  })
  it('cancel leaves sessions and raw drafts intact without preparing or stopping writers', async () => {
    const f = await fixture()
    f.ports.confirm = () => 'cancel'
    expect(await prepareDocumentWindowClose(f.ports)).toBe(false)
    expect(f.order).toEqual([])
    expect(f.host.registry.list()).toHaveLength(4)
    expect(await f.host.readAuthoringDrafts(f.course.documentId)).toMatchObject({ advanced: [{ payload: '{' }], properties: [{ raw: '-' }] })
  })
  it('save uses only the save preparation branch and aborts when raw input is not ready', async () => {
    const f = await fixture()
    f.ports.confirm = () => 'save'
    f.ports.prepareRenderer = vi.fn(async mode => { f.order.push(mode); return false })
    expect(await prepareDocumentWindowClose(f.ports)).toBe(false)
    expect(f.order).toEqual(['stop', 'save'])
    expect(f.ports.save).not.toHaveBeenCalled()
    expect(f.host.registry.list()).toHaveLength(4)
  })
  it('normal reopen gets a new identity and disk History while pending raw remains independently claimable', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'window-close-raw-text-')); roots.push(root)
    const host = new DocumentHostService(path.join(root, 'journal')), filename = path.join(root, 'saved.txt')
    await fs.writeFile(filename, 'saved original')
    const opened = await host.open(filename)
    await host.internalAPI.dispatch({ documentId: opened.documentId, epoch: opened.epoch, baseRevision: opened.revision, operationId: 'discarded-edit', actor: 'human',
      mutation: { type: 'command', command: { type: 'markdown.replace', source: 'discarded formal' } } })
    await host.writeAuthoringDrafts(opened.documentId, { sourceConflicts: [{ documentId: opened.documentId, epoch: opened.epoch,
      source: 'raw source', diskVersion: 'old-disk', hunks: [{ id: 'conflict-1-2', text: 'unfinished raw' }] }] })
    await host.operate({ type: 'close', documentId: opened.documentId, discardDirty: true })
    const cold = new DocumentHostService(path.join(root, 'journal'))
    expect(await cold.internalAPI.recoverable()).toEqual([expect.objectContaining({ documentId: opened.documentId, rawInputOnly: true, model: expect.objectContaining({ source: 'saved original' }) })])
    const reopened = await cold.open(filename)
    expect(reopened.documentId).not.toBe(opened.documentId)
    expect(reopened).toMatchObject({ revision: 0, undoDepth: 0, redoDepth: 0, model: { source: 'saved original' } })
    const raw = (await cold.readAuthoringDrafts(reopened.documentId))!
    expect(raw.sourceConflicts?.[0]?.hunks[0]?.text).toBe('unfinished raw')
    await cold.claimAuthoringDrafts(reopened.documentId, reopened.epoch, raw.recoveryRecords!)
    await cold.writeAuthoringDrafts(reopened.documentId, { sourceConflicts: [] }, reopened.epoch)
    expect(await cold.readAuthoringDrafts(reopened.documentId)).toBeNull()
  })
  it('trash updates a closed raw-only owner without moving its raw file, and its original text remains openable', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'window-close-raw-trash-')); roots.push(root)
    const journal = path.join(root, 'journal'), host = new DocumentHostService(journal, { trashItem: filename => fs.unlink(filename) })
    const filename = path.join(root, 'saved.txt'); await fs.writeFile(filename, 'saved original')
    const opened = await host.open(filename)
    await host.writeAuthoringDrafts(opened.documentId, { sourceConflicts: [{ documentId: opened.documentId, epoch: opened.epoch,
      source: 'raw original source', diskVersion: 'disk', hunks: [{ id: 'old-hunk', text: 'unapplied raw' }] }] })
    await host.operate({ type: 'close', documentId: opened.documentId })
    const rawDirectory = path.join(journal, 'authoring-drafts'), before = await fs.readdir(rawDirectory)
    const authorized = await host.files.registerRoot(root)
    const page = await host.files.listChildren({ workspaceId: authorized.workspaceId, directoryEntryId: authorized.rootEntryId })
    const entry = page.entries.find(item => item.status === 'accessible' && item.name === 'saved.txt')!
    if (entry.status !== 'accessible') throw new Error('Missing fixture file')
    expect((await host.files.trash({ workspaceId: authorized.workspaceId, operationId: 'trash-raw-only-fixture', entryIds: [entry.entryId] })).status).toBe('success')
    expect(await fs.readdir(rawDirectory)).toEqual(before)
    const envelope = JSON.parse(await fs.readFile(path.join(rawDirectory, before[0]!), 'utf8'))
    expect(envelope.binding).toEqual({ kind: 'untitled', suggestedName: 'saved.txt' })
    const restored = await host.internalAPI.restore(opened.documentId)
    expect(restored.documentId).not.toBe(opened.documentId)
    expect(restored.model).toMatchObject({ kind: 'text', source: expect.stringContaining('unapplied raw') })
    expect(restored.undoDepth).toBe(0)
  })
})
