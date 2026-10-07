// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { createDocumentJournal } from '../../../../src/main/workbench/documentJournal'
import { captureComponentOperation } from '../../../../src/core/drivers/courseV10Operations'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import type { ComponentEdit } from '../../../../src/shared/contracts/component-platform/operations'
import type { DocumentSnapshot } from '../../../../src/shared/workbench/document'

it('V10 text history retains one owned unchanged resource representation and preserves asset replace undo redo through restart save reopen', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T10-resource-'))
  try {
    const recovery = path.join(directory, 'recovery'), host = new DocumentHostService(recovery)
    const project = createBlankCourseProjectV10('Resource ownership')
    project.definitions.text = { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'text' } }
    project.instances.title = { id: 'title', definitionId: 'text', data: { text: 'Original' } }
    project.surfaces[0].childIds.push('title')
    project.assets.raw = { id: 'raw', path: 'assets/original.bin', mimeType: 'application/octet-stream' }
    const input = new Uint8Array(128 * 1024).fill(7)
    let current = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: { raw: input }, components: {} } }, 'lesson.h5lesson')
    const originalRevision = current.revision
    input.fill(99)
    const formalBytes = new Uint8Array(128 * 1024).fill(7)
    expect((await host.internalAPI.read(current.documentId)).model.resources.assets.raw).toEqual(formalBytes)
    const dispatch = async (owner: DocumentHostService, snapshot: DocumentSnapshot, operationId: string, edits: ComponentEdit[]) => {
      if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
      expect(await owner.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId,
        actor: 'human', mutation: { type: 'command', command: captureComponentOperation(snapshot.model.project, edits) } })).toMatchObject({ status: 'applied' })
      return owner.internalAPI.read(snapshot.documentId)
    }
    for (let n = 0; n < 3; n++) current = await dispatch(host, current, `text-${n}`, [{ type: 'data.set', instanceId: 'title', path: ['text'], value: `Edit ${n}` }])
    const recovered = await createDocumentJournal({ directory: recovery }).recover(current.documentId)
    expect(recovered!.past).toHaveLength(3)
    const allBytes = [recovered!.model, ...recovered!.past.flatMap(entry => [entry.before, entry.after])].map(model => model.resources.assets.raw)
    expect(allBytes.every(value => value === allBytes[0])).toBe(true)
    // Public read snapshots cannot mutate the formal state, even though the owned durable representation is shared.
    current.model.resources.assets.raw.fill(23)
    expect((await host.internalAPI.read(current.documentId)).model.resources.assets.raw).toEqual(formalBytes)
    current = await host.internalAPI.read(current.documentId)
    if (current.model.kind !== 'course-v10') throw new Error('Expected V10')
    const replaced = await dispatch(host, current, 'replace-asset', [{ type: 'asset.replace', asset: current.model.project.assets.raw,
      expectedBytes: formalBytes, bytes: new Uint8Array([5, 4, 3]) }])
    const history = async (owner: DocumentHostService, snapshot: DocumentSnapshot, kind: 'undo' | 'redo') => {
      expect(await owner.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
        operationId: `${kind}-${snapshot.revision}`, actor: 'human', mutation: { type: kind } })).toMatchObject({ status: 'applied' })
      return owner.internalAPI.read(snapshot.documentId)
    }
    current = await history(host, replaced, 'undo')
    expect(current.model.resources.assets.raw).toEqual(formalBytes)
    const restarted = new DocumentHostService(recovery)
    current = await restarted.internalAPI.restore(current.documentId)
    current = await history(restarted, current, 'redo')
    expect(current.model.resources.assets.raw).toEqual(new Uint8Array([5, 4, 3]))
    const filename = path.join(directory, 'lesson.h5lesson'); await restarted.saveToPath(current.documentId, filename)
    const cold = await new DocumentHostService(path.join(directory, 'fresh')).open(filename)
    expect(cold.model.resources.assets.raw).toEqual(new Uint8Array([5, 4, 3]))
    expect(cold.model).toMatchObject({ kind: 'course-v10', project: { instances: { title: { data: { text: 'Edit 2' } } } } })
    expect(current.revision).toBeGreaterThan(originalRevision)
  } finally {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
