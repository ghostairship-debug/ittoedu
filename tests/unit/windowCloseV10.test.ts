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
  const discardFlowRecovery = vi.fn(async () => undefined)
  const host = new DocumentHostService(path.join(root, 'journal'), {}, { discardFlowRecovery })
  const course = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10(), resources: { assets: {}, components: {} } }, 'course.h5lesson')
  await host.writeAuthoringDrafts(course.documentId, {
    advanced: [{ kind: 'json', documentId: course.documentId, epoch: course.epoch, projectId: course.model.kind === 'course-v10' ? course.model.project.id : '', key: 'unfinished', payload: '{' }],
    properties: [{ bindingKey: JSON.stringify([course.documentId, course.epoch, 'property']), kind: 'number', label: '宽度', raw: '-', composing: false }],
  })
  for (const name of ['notes.txt', 'lesson.md', 'page.html']) {
    const filename = path.join(root, name)
    await fs.writeFile(filename, `original ${name}`)
    const snapshot = await host.open(filename)
    await host.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: `edit-${name}`, baseRevision: snapshot.revision, actor: 'human',
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
  return { root, host, course, ports, order, discardFlowRecovery }
}

describe('V10 mixed window close', () => {
  it('discards only after input suspension, without saving originals or leaving owned recovery', async () => {
    const f = await fixture()
    expect(await prepareDocumentWindowClose(f.ports)).toBe(true)
    expect(f.order).toEqual(['discard', 'stop', 'discard-main'])
    expect(f.ports.save).not.toHaveBeenCalled()
    expect(f.host.registry.list()).toEqual([])
    expect(await f.host.internalAPI.recoverable()).toEqual([])
    expect(await fs.readdir(path.join(f.root, 'journal', 'authoring-drafts'))).toEqual([])
    expect(f.discardFlowRecovery).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ epoch: f.course.epoch }))
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
})
