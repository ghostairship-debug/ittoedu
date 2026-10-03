// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { locateCourseLayer } from '../../src/core/drivers/course/layerProperties'
import { createImageNode } from '../../src/core/tools/nativeNodeFactories'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import { findCompositionNode } from '../../src/shared/composition/content'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import type { CompositionLayerItem } from '../../src/shared/courseProjectTypes'
import type { DocumentModel, DocumentPersistence, DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'
import { compositionFragmentFixture } from '../helpers/compositionFragmentFixture'

type CourseModel = Extract<DocumentModel, { kind: 'course-v9' }>
type ContentTarget = { target: string; kind: 'text' | 'style' | 'image'; label: string }

function composition(model: DocumentModel): CompositionLayerItem {
  if (model.kind !== 'course-v9') throw new Error('Course model required')
  const item = locateCourseLayer(model.project, 'quality-composition')?.item
  if (item?.kind !== 'composition') throw new Error('Composition required')
  return item
}

function imageAssetId(model: DocumentModel, nodeId: string): string {
  const item = composition(model), node = findCompositionNode(item.content.root, nodeId)
  if (node?.kind === 'native' && node.content.nativeType === 'image') return node.content.data.assetId
  if (node?.kind !== 'element') throw new Error('Image element required')
  const key = /^cw-resource:(.+)$/.exec(node.attributes.src)?.[1]
  const assetId = key && item.content.assets[key]?.assetId
  if (!assetId) throw new Error('Image resource binding required')
  return assetId
}

async function discover(gateway: DocumentToolGateway, target: string): Promise<ContentTarget[]> {
  const result = await gateway.execute('images', randomUUID(), { name: 'content.targets', input: { target } })
  if (result.kind !== 'read') throw new Error('Image discovery failed')
  return (result.data as { targets: ContentTarget[] }).targets
}

function imageTarget(targets: ContentTarget[], native = false): ContentTarget {
  const found = targets.find(target => target.kind === 'image' && (native
    ? target.label.startsWith('原生图片') : target.label.includes('资源闭包示例')))
  if (!found) throw new Error('Expected image target missing')
  return found
}

function affected(result: ToolResult): string {
  if (result.kind !== 'document-operation' || !result.affected[0]) throw new Error('Fresh handle required')
  return result.affected[0]
}

function operation(snapshot: DocumentSnapshot, mutation: Parameters<ReturnType<DocumentRegistry['get']>['execute']>[0]['mutation']) {
  return { documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: randomUUID(), actor: 'human' as const,
    baseRevision: snapshot.revision, mutation }
}

it('replaces bound composition HTML and Native images through short handles with one history each, preserves shared images, saves real bytes and respects final CAS', async () => {
  const source = compositionFragmentFixture(), right = findCompositionNode(source.item.content.root, 'right')
  const picture = findCompositionNode(source.item.content.root, 'picture')
  if (right?.kind !== 'element' || picture?.kind !== 'element') throw new Error('Fixture containers required')
  picture.attributes.style = 'object-fit:cover;border-radius:9px;'
  right.children.push({ ...structuredClone(picture), id: 'shared-picture', attributes: { ...picture.attributes, alt: '未选共享图片' } })
  const native = sceneNodeToCourseLayerItem(createImageNode({ assetId: 'source-photo', fit: 'cover', cornerRadius: 13, flipX: true }), 0)
  if (native.kind !== 'native' || native.content.nativeType !== 'image') throw new Error('Native image fixture required')
  right.children.push({ kind: 'native', id: 'native-picture', content: native.content })
  right.children.push({ kind: 'element', id: 'unbound-picture', tagName: 'img', attributes: { src: 'https://example.com/photo.png', alt: '源文图片' }, children: [] })
  const model: CourseModel = { kind: 'course-v9', project: source.project, resources: { assets: source.assetFiles, components: {} } }
  const target: ToolTarget = { kind: 'course-object', locationId: source.project.locations[0]!.id, itemId: source.item.layerItemId }
  const driver = new CourseV9Driver()
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
  const session = await registry.create(model, 'images.h5lesson')
  const before = session.read()
  await gateway.beginRun({ runId: 'images', actor: 'agent', documents: [{ documentId: session.documentId, writable: [target] }] })
  const object = await gateway.issueTarget('images', session.documentId, target)
  const targets = await discover(gateway, object)
  expect(targets.filter(target => target.kind === 'image')).toHaveLength(3)
  for (const target of targets) for (const key of ['nodeId', 'itemId', 'assetId', 'epoch', 'revision']) expect(target).not.toHaveProperty(key)
  const selected = imageTarget(targets)
  const bytes = new Uint8Array(await sharp({ create: { width: 12, height: 8, channels: 4, background: '#135b9c' } }).png().toBuffer())
  const resource = await gateway.provideImage('images', session.documentId, { bytes, mimeType: 'image/png', filename: 'replacement.png' })
  expect(session.read()).toEqual(before)
  const commits: string[] = []
  const unsubscribe = session.subscribeCommits(commit => {
    if (commit.operation.actor === 'agent' && commit.operation.mutation.type === 'command') commits.push(commit.operation.mutation.command.type)
  })
  let root: string | undefined
  try {
    expect(await gateway.execute('images', 'invalid-image', { name: 'content.update', input: { target: selected.target, resource: 'not-a-resource' } }))
      .toMatchObject({ kind: 'error', code: 'invalid-resource' })
    expect(session.read()).toEqual(before)
    const written = await gateway.execute('images', 'replace-html-image', { name: 'content.update', input: { target: selected.target, resource } })
    expect(written).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const afterHtml = session.read(), assetId = imageAssetId(afterHtml.model, 'picture')
    expect(assetId).not.toBe('source-photo')
    expect(afterHtml.undoDepth).toBe(before.undoDepth + 1)
    expect(commits).toEqual(['course.replace'])
    expect(imageAssetId(afterHtml.model, 'shared-picture')).toBe('source-photo')
    expect(imageAssetId(afterHtml.model, 'native-picture')).toBe('source-photo')
    expect(composition(afterHtml.model).content.assets.photo).toEqual({ assetId: 'source-photo' })
    const changedPicture = findCompositionNode(composition(afterHtml.model).content.root, 'picture')
    expect(changedPicture?.kind === 'element' ? { ...changedPicture.attributes, src: picture.attributes.src } : null).toEqual(picture.attributes)
    expect(afterHtml.model.resources.assets['source-photo']).toEqual(before.model.resources.assets['source-photo'])
    expect(afterHtml.model.resources.assets[assetId]).toEqual(bytes)

    const nextTargets = await discover(gateway, affected(written))
    const nextNative = imageTarget(nextTargets, true)
    const nativeWritten = await gateway.execute('images', 'replace-native-image', { name: 'content.update', input: { target: nextNative.target, resource } })
    expect(nativeWritten).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const after = session.read()
    expect(after.undoDepth).toBe(before.undoDepth + 2)
    expect(commits).toEqual(['course.replace', 'course.replace'])
    expect(findCompositionNode(composition(after.model).content.root, 'native-picture')).toEqual({ kind: 'native', id: 'native-picture',
      content: { ...native.content, data: { ...native.content.data, assetId } } })
    for (const nodeId of ['shared-picture', 'counter', 'chart', 'css', 'paragraph-text', 'unbound-picture'])
      expect(findCompositionNode(composition(after.model).content.root, nodeId)).toEqual(findCompositionNode(composition(before.model).content.root, nodeId))
    expect(await session.execute(operation(after, { type: 'undo' }))).toMatchObject({ status: 'applied' })
    expect(imageAssetId(session.read().model, 'native-picture')).toBe('source-photo')
    expect(imageAssetId(session.read().model, 'picture')).toBe(assetId)
    expect(await session.execute(operation(session.read(), { type: 'redo' }))).toMatchObject({ status: 'applied' })
    expect(imageAssetId(session.read().model, 'native-picture')).toBe(assetId)

    root = await fs.mkdtemp(path.join(os.tmpdir(), 'composition-image-gateway-'))
    const filename = path.join(root, 'images.h5lesson')
    await registry.save(session.documentId, { kind: 'file', path: filename, version: null, bindingVersion: 0 })
    const reopened = driver.load(new Uint8Array(await fs.readFile(filename)))
    expect(composition(reopened)).toEqual(composition(session.read().model))
    expect(reopened.resources).toEqual(session.read().model.resources)
    expect(session.read().dirty).toBe(false)

    const freshObject = await gateway.issueTarget('images', session.documentId, target)
    const freshImage = imageTarget(await discover(gateway, freshObject))
    const rejectedBytes = new Uint8Array(await sharp({ create: { width: 7, height: 5, channels: 4, background: '#a64a32' } }).png().toBuffer())
    const racingResource = await gateway.provideImage('images', session.documentId, { bytes: rejectedBytes, mimeType: 'image/png', filename: 'racing.png' })
    const beforeRace = session.read(), execute = session.execute.bind(session)
    const spy = vi.spyOn(session, 'execute').mockImplementationOnce(async request => {
      expect(request).toMatchObject({ actor: 'agent', baseRevision: beforeRace.revision, mutation: { type: 'command', command: { type: 'course.replace' } } })
      expect(await execute(operation(beforeRace, { type: 'command', command: { type: 'composition.edit', layerItemId: 'quality-composition',
        edit: { type: 'style', nodeId: 'left', patch: { padding: '29px' } } } }))).toMatchObject({ status: 'applied' })
      return execute(request)
    })
    expect(await gateway.execute('images', 'racing-image', { name: 'content.update', input: { target: freshImage.target, resource: racingResource } }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'conflict', code: 'stale-revision' } })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(session.read().model.resources).toEqual(beforeRace.model.resources)
    expect(imageAssetId(session.read().model, 'picture')).toBe(assetId)
    expect(session.read().undoDepth).toBe(beforeRace.undoDepth + 1)
    expect(session.read().undoHead?.actor).toBe('human')
    spy.mockRestore()
  } finally {
    unsubscribe()
    vi.restoreAllMocks()
    if (root) {
      const relative = path.relative(os.tmpdir(), root)
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe fixture directory')
      await fs.rm(root, { recursive: true, force: true })
    }
  }
})
