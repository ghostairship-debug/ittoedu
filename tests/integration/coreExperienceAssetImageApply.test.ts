// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { WEB_DEFINITION } from '../../src/components/web/data'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const model = (snapshot: DocumentSnapshot) => {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
  return snapshot.model
}

it('applies a current image resource to an observed Web asset file with identity, history, cold reopen and stale-byte protection', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'core-asset-image-'))
  const png = async (color: string, width = 12) => new Uint8Array(await sharp({ create: { width, height: 8, channels: 4, background: color } }).png().toBuffer())
  const original = await png('#003366'), replacement = await png('#ee9900', 20), human = await png('#338844', 20)
  const project = createBlankCourseProjectV10('Web 原位替图'), assetId = 'photo', assetPath = 'assets/photo.png', uri = 'cw-resource:photo-token'
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.assets[assetId] = { id: assetId, path: assetPath, filename: 'photo.png', mimeType: 'image/png', width: 12, height: 8, byteLength: original.byteLength }
  project.instances.web = { id: 'web', definitionId: WEB_DEFINITION.id, data: { html: `<img src="${uri}" alt="预测照片"><button>原互动</button>`,
    resourceBindings: { [uri]: assetId } }, frame: { width: 400, height: 240, transform: [1, 0, 0, 1, 30, 40] } }
  project.surfaces[0].childIds = ['web']
  const host = new DocumentHostService(path.join(root, 'recovery'))
  try {
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: { [assetId]: original }, components: {} } }, 'asset.h5lesson')
    const begin = (runId: string) => host.tools.beginRun({ runId, actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }],
      fileAccess: { permission: 'workspace', workspaceRoot: root } })
    await begin('author'); await begin('foreign')
    let id = 0
    const call = (name: string, input: unknown) => host.tools.execute('author', `call-${++id}`, { name, input })
    expect(await call('project.read', { path: assetPath })).toMatchObject({ kind: 'read', data: { type: 'asset', mimeType: 'image/png' } })
    const resource = await host.tools.provideImage('author', initial.documentId, { bytes: replacement, mimeType: 'image/png', filename: 'edited.png' })
    const foreign = await host.tools.provideImage('foreign', initial.documentId, { bytes: human, mimeType: 'image/png', filename: 'other.png' })
    expect(await call('project.apply', { path: assetPath, from: foreign })).toMatchObject({ kind: 'error' })
    const result = await call('project.apply', { path: assetPath, from: resource })
    expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read', data: { commit: 'committed', receipt: { status: 'applied' } } })
    let current = await host.internalAPI.read(initial.documentId)
    expect(current.undoDepth).toBe(1)
    expect(Object.keys(model(current).project.assets)).toEqual([assetId])
    expect(model(current).project.assets[assetId]).toMatchObject({ id: assetId, path: assetPath, width: 20, height: 8 })
    expect(model(current).project.instances.web).toEqual(project.instances.web)
    const decoded = await sharp(model(current).resources.assets[assetId]).raw().toBuffer({ resolveWithObject: true })
    expect(decoded.info.width).toBe(20); expect(Array.from(decoded.data.subarray(0, 3))).toEqual([238, 153, 0])
    const history = async (type: 'undo' | 'redo') => {
      const snapshot = await host.internalAPI.read(initial.documentId)
      return host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
        operationId: `asset-${type}`, actor: 'human', mutation: { type } })
    }
    expect(await history('undo')).toMatchObject({ status: 'applied' })
    expect((await sharp(model(await host.internalAPI.read(initial.documentId)).resources.assets[assetId]).metadata()).width).toBe(12)
    expect(await history('redo')).toMatchObject({ status: 'applied' })
    const filename = path.join(root, 'saved.h5lesson')
    await host.internalAPI.save(initial.documentId, filename)
    const reopened = model(await new DocumentHostService(path.join(root, 'cold')).internalAPI.open(filename))
    expect(reopened.project.instances.web).toEqual(project.instances.web)
    expect((await sharp(reopened.resources.assets[assetId]).stats()).channels.slice(0, 3).map(channel => channel.mean)).toEqual([238, 153, 0])
    await call('project.read', { path: assetPath })
    current = await host.internalAPI.read(initial.documentId)
    expect(await host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, actor: 'human', operationId: 'human-asset',
      mutation: { type: 'command', command: captureComponentOperation(model(current).project, [{ type: 'asset.replace',
        asset: { ...model(current).project.assets[assetId], byteLength: human.byteLength }, bytes: human, expectedBytes: model(current).resources.assets[assetId] }]) } }))
      .toMatchObject({ status: 'applied' })
    expect(await call('project.apply', { path: assetPath, from: resource })).toMatchObject({ kind: 'read', data: { commit: 'not_committed' } })
    expect((await sharp(model(await host.internalAPI.read(initial.documentId)).resources.assets[assetId]).stats()).channels.slice(0, 3).map(channel => channel.mean)).toEqual([51, 136, 68])
  } finally {
    await host.tools.stop('author'); await host.tools.stop('foreign')
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture directory')
    await fs.rm(root, { recursive: true, force: true })
  }
})
