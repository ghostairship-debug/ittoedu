// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { imageDataSchema } from '../../src/components/image/data'
import { webDataSchema } from '../../src/components/web/data'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import type { DocumentModel, DocumentPersistence, DocumentSnapshot } from '../../src/shared/workbench/document'
import { currentCompositionGatewayFixture } from '../helpers/currentCompositionGatewayFixture'

function course(model: DocumentModel) {
  if (model.kind !== 'course-v10') throw new Error('Current component model required')
  return model
}
function operation(snapshot: DocumentSnapshot, mutation: Parameters<ReturnType<DocumentRegistry['get']>['execute']>[0]['mutation']) {
  return { documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: randomUUID(), actor: 'human' as const,
    baseRevision: snapshot.revision, mutation }
}

it('replaces selected Web and professional images through current short handles with one history each, preserves shared bytes, reopens and respects final field CAS', async () => {
  const source = currentCompositionGatewayFixture(), driver = new CourseV10Driver()
  const persistence: DocumentPersistence = {
    async append() {},
    async save(input) {
      if (input.binding.kind !== 'file') throw new Error('File binding required')
      await fs.writeFile(input.binding.path, input.bytes)
      return { ...input.binding, version: 'saved-' + input.revision }
    },
  }
  const registry = new DocumentRegistry({ drivers: [driver], persistence, createId: randomUUID, bindingKey: binding => binding.path })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID, { prepareImage: prepareImageResource })
  const session = await registry.create(source.model, 'images.glx'), before = session.read()
  await gateway.beginRun({ runId: 'images', actor: 'agent', documents: [{ documentId: session.documentId, writable: [source.target] }] })
  const selected = await gateway.issueTarget('images', session.documentId, source.imageTarget)
  const nativeTarget = source.instanceTarget('native-picture')
  const bytes = new Uint8Array(await sharp({ create: { width: 12, height: 8, channels: 4, background: '#135b9c' } }).png().toBuffer())
  const resource = await gateway.provideImage('images', session.documentId, { bytes, mimeType: 'image/png', filename: 'replacement.png' })
  expect(session.read()).toEqual(before)
  const commits: string[] = []
  const unsubscribe = session.subscribeCommits(commit => {
    if (commit.operation.actor === 'agent' && commit.operation.mutation.type === 'command') commits.push(commit.operation.mutation.command.type)
  })
  let root: string | undefined
  try {
    const native = await gateway.issueTarget('images', session.documentId, nativeTarget)
    const rejected = await gateway.execute('images', 'invalid-image', { name: 'media.apply', input: { target: native, resource: 'not-a-resource' } })
    expect(rejected, JSON.stringify(rejected)).toMatchObject({ kind: 'error', code: 'invalid-operation', message: '所选媒体来源不可读取' })
    expect(session.read()).toEqual(before)
    // Web source and binding stay immutable; its exact author field owns the closed image URL.
    const url = `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
    const written = await gateway.execute('images', 'replace-web-image', { name: 'text.replace', input: { target: selected, content: url } })
    expect(written, JSON.stringify(written)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const afterWeb = course(session.read().model), web = webDataSchema.parse(afterWeb.project.instances.picture.data)
    expect(web.authoringRecords!.picture).toEqual({ ...source.imageRecord, overrides: { ...source.imageRecord.overrides, src: url } })
    expect(web.html).toBe(webDataSchema.parse(source.project.instances.picture.data).html)
    expect(web.css).toBe(webDataSchema.parse(source.project.instances.picture.data).css)
    expect(web.resourceBindings).toEqual({ photo: 'source-photo' })
    expect(session.read().undoDepth).toBe(before.undoDepth + 1)
    expect(commits).toEqual(['component-platform.apply'])
    expect(afterWeb.project.instances['shared-picture']).toEqual(source.project.instances['shared-picture'])
    expect(afterWeb.project.instances['native-picture']).toEqual(source.project.instances['native-picture'])
    expect(afterWeb.resources).toEqual(before.model.resources)
    expect(Buffer.from(web.authoringRecords!.picture.overrides.src!.split(',')[1], 'base64')).toEqual(Buffer.from(bytes))

    const nativeWritten = await gateway.execute('images', 'replace-native-image', { name: 'media.apply',
      input: { target: await gateway.issueTarget('images', session.documentId, nativeTarget), resource } })
    expect(nativeWritten, JSON.stringify(nativeWritten)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const after = session.read(), model = course(after.model), data = imageDataSchema.parse(model.project.instances['native-picture'].data)
    const assetId: string = data.assetId
    expect(assetId).not.toBe('source-photo')
    expect(data).toEqual({ ...imageDataSchema.parse(source.project.instances['native-picture'].data), originalAssetId: assetId, assetId })
    expect(model.project.instances['native-picture'].frame).toEqual(source.project.instances['native-picture'].frame)
    expect(model.resources.assets[assetId]).toEqual(bytes)
    expect(model.resources.assets['source-photo']).toEqual(source.resources.assets['source-photo'])
    expect(after.undoDepth).toBe(before.undoDepth + 2)
    expect(commits).toEqual(['component-platform.apply', 'component-platform.apply'])
    for (const id of ['shared-picture', 'interaction', 'chart', 'paragraph', 'heading', 'left', 'right'])
      expect(model.project.instances[id]).toEqual(source.project.instances[id])
    expect(model.resources.components).toEqual(source.resources.components)
    expect(await session.execute(operation(after, { type: 'undo' }))).toMatchObject({ status: 'applied' })
    expect(course(session.read().model).project.instances['native-picture']).toEqual(source.project.instances['native-picture'])
    expect(webDataSchema.parse(course(session.read().model).project.instances.picture.data).authoringRecords!.picture.overrides.src).toBe(url)
    expect(await session.execute(operation(session.read(), { type: 'redo' }))).toMatchObject({ status: 'applied' })
    expect(imageDataSchema.parse(course(session.read().model).project.instances['native-picture'].data).assetId).toBe(assetId)

    root = await fs.mkdtemp(path.join(os.tmpdir(), 'component-image-gateway-'))
    const filename = path.join(root, 'images.glx')
    await registry.save(session.documentId, { kind: 'file', path: filename, version: null, bindingVersion: 0 })
    expect(driver.load(new Uint8Array(await fs.readFile(filename)))).toEqual(session.read().model)
    expect(session.read().dirty).toBe(false)

    const freshImage = await gateway.issueTarget('images', session.documentId, nativeTarget)
    const rejectedBytes = new Uint8Array(await sharp({ create: { width: 7, height: 5, channels: 4, background: '#a64a32' } }).png().toBuffer())
    const racingResource = await gateway.provideImage('images', session.documentId, { bytes: rejectedBytes, mimeType: 'image/png', filename: 'racing.png' })
    const beforeRace = session.read(), execute = session.execute.bind(session)
    const spy = vi.spyOn(session, 'execute').mockImplementationOnce(async request => {
      expect(request).toMatchObject({ actor: 'agent', baseRevision: beforeRace.revision, mutation: { type: 'command', command: { type: 'component-platform.apply' } } })
      expect(await execute(operation(beforeRace, { type: 'command', command: captureComponentOperation(course(beforeRace.model).project,
        [{ type: 'data.set', instanceId: 'native-picture', path: ['assetId'], value: 'source-photo' }]) }))).toMatchObject({ status: 'applied' })
      return execute(request)
    })
    expect(await gateway.execute('images', 'racing-image', { name: 'media.apply', input: { target: freshImage, resource: racingResource } }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'conflict' } })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(session.read().model.resources).toEqual(beforeRace.model.resources)
    expect(imageDataSchema.parse(course(session.read().model).project.instances['native-picture'].data).assetId).toBe('source-photo')
    expect(session.read().undoDepth).toBe(beforeRace.undoDepth + 1)
    expect(session.read().undoHead?.actor).toBe('human')
    spy.mockRestore()
  } finally {
    unsubscribe(); vi.restoreAllMocks()
    if (root) {
      const relative = path.relative(os.tmpdir(), root)
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe fixture directory')
      await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
    }
  }
})
