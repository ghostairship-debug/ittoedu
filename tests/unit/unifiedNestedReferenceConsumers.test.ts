// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createRectangleNode } from '../../src/core/tools/nativeNodeFactories'
import { findCompositionNode } from '../../src/shared/composition/content'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { collectCourseProjectControllerMediaHealth, collectCourseProjectRuntimeHealth } from '../../src/shared/courseProjectHealth'
import type { CompositionLayerItem } from '../../src/shared/courseProjectTypes'
import type { DocumentModel, DocumentPersistence, DocumentSnapshot } from '../../src/shared/workbench/document'
import { compositionFragmentFixture } from '../helpers/compositionFragmentFixture'

function counter(item: CompositionLayerItem) {
  const value = findCompositionNode(item.content.root, 'counter')
  if (value?.kind !== 'runtime') throw new Error('Expected nested Runtime')
  return value
}

function composition(model: DocumentModel) {
  if (model.kind !== 'course-v9') throw new Error('Expected course')
  const item = model.project.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!.layerItems.find(item => item.kind === 'composition')
  if (item?.kind !== 'composition') throw new Error('Expected composition')
  return item
}

function operation(snapshot: DocumentSnapshot, mutation: { type: 'undo' | 'redo' }) {
  return { documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
    operationId: randomUUID(), actor: 'human' as const, mutation }
}

it('deletes a bound layer through the canonical Gateway, repairs nested Runtime bindings, and retains undo and saved bytes', async () => {
  const source = compositionFragmentFixture(), slide = source.project.surfaces.find(surface => surface.type === 'slide')!
  const target = sceneNodeToCourseLayerItem(createRectangleNode({ id: 'deleted-target' }), 1)
  const retained = sceneNodeToCourseLayerItem(createRectangleNode({ id: 'retained-target' }), 2)
  slide.scenes[0]!.layerItems.push(target, retained)
  counter(source.item).runtime.nodeBindings = { deleted: target.layerItemId, retained: retained.layerItemId }
  const parent = findCompositionNode(source.item.content.root, 'interaction')!
  if (parent.kind !== 'element') throw new Error('Expected interaction container')
  const second = structuredClone(counter(source.item)); second.id = 'second-counter'
  second.runtime.nodeBindings = { only: target.layerItemId }; parent.children.push(second)
  const model: Extract<DocumentModel, { kind: 'course-v9' }> = { kind: 'course-v9', project: source.project,
    resources: { assets: source.assetFiles, components: {} } }
  let saved: Uint8Array | undefined
  const persistence: DocumentPersistence = { async append() {}, async save(input) {
    saved = input.bytes; if (input.binding.kind !== 'file') throw new Error('Expected file binding')
    return { ...input.binding, version: 'saved' }
  } }
  const driver = new CourseV9Driver()
  const registry = new DocumentRegistry({ drivers: [driver], persistence, createId: randomUUID, bindingKey: binding => binding.path })
  const session = await registry.create(model, 'nested-references.h5lesson')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  await gateway.beginRun({ runId: 'delete', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const handle = await gateway.issueTarget('delete', session.documentId, { kind: 'course-object', locationId: source.project.startLocationId,
    itemId: target.layerItemId })
  expect(await gateway.execute('delete', 'remove-bound-target', { name: 'layer.delete', input: { target: handle } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(session.read().undoDepth).toBe(1)
  expect(counter(composition(session.read().model)).runtime.nodeBindings).toEqual({ retained: retained.layerItemId })
  expect(findCompositionNode(composition(session.read().model).content.root, 'second-counter')).not.toHaveProperty('runtime.nodeBindings')
  expect(await session.execute(operation(session.read(), { type: 'undo' }))).toMatchObject({ status: 'applied' })
  expect(counter(composition(session.read().model)).runtime.nodeBindings).toEqual({ deleted: target.layerItemId, retained: retained.layerItemId })
  expect(await session.execute(operation(session.read(), { type: 'redo' }))).toMatchObject({ status: 'applied' })
  await registry.save(session.documentId, { kind: 'file', path: 'nested-references.h5lesson', version: null, bindingVersion: 0 })
  const reopened = driver.load(saved!)
  expect(counter(composition(reopened)).runtime.nodeBindings).toEqual({ retained: retained.layerItemId })
  expect(findCompositionNode(composition(reopened).content.root, 'second-counter')).not.toHaveProperty('runtime.nodeBindings')
  expect(reopened.resources).toEqual(model.resources)
})

it('reports missing bindings and fallbacks at the nested Runtime source with the existing diagnostic levels', () => {
  const source = compositionFragmentFixture()
  counter(source.item).runtime.nodeBindings = { missing: 'missing-layer', valid: source.item.layerItemId }
  const findings = collectCourseProjectRuntimeHealth(source.project, { assetFiles: source.assetFiles, componentFiles: {} })
  expect(findings.map(finding => ({ code: finding.code, severity: finding.severity }))).toEqual([
    { code: 'runtime-node-reference-missing', severity: 'error' },
    { code: 'runtime-static-fallback-missing', severity: 'warning' },
  ])
  expect(findings.every(finding => finding.layerItemId === source.item.layerItemId)).toBe(true)
  expect(findings[0]!.path.slice(-3)).toEqual(['runtime', 'nodeBindings', 'missing'])
  expect(findings[1]!.path.slice(-2)).toEqual(['runtime', 'staticFallback'])
})

it('keeps unused assets informational and accounts only for mounted enabled nested Runtime consumers', () => {
  const source = compositionFragmentFixture()
  source.project.assets['unlisted-asset'] = { ...source.project.assets['source-photo']!, id: 'unlisted-asset', path: 'assets/unlisted.png' }
  const assetFiles = { ...source.assetFiles, 'unlisted-asset': source.assetFiles['source-photo'] }
  const unused = (project = source.project) => collectCourseProjectControllerMediaHealth(project, { assetFiles, componentFiles: {} })
    .filter(finding => finding.code === 'asset-unused' && finding.path.at(-1) === 'unlisted-asset')
  expect(unused()).toEqual([])
  for (const mode of ['disabled', 'state-hidden', 'out-of-scope']) {
    const project = structuredClone(source.project), slide = project.surfaces.find(surface => surface.type === 'slide')!
    const item = slide.scenes[0]!.layerItems[0] as CompositionLayerItem
    if (mode === 'disabled') counter(item).runtime.enabled = false
    else if (mode === 'state-hidden') slide.scenes[0]!.presentation!.states.forEach(state => {
      state.layerItemOverrides[item.layerItemId] = { visible: false }
    })
    else {
      slide.scenes[0]!.layerItems = []
      project.globalLayerItems.push({ item, visibility: { mode: 'exclude', locationIds: [project.startLocationId] } })
    }
    expect(unused(project), mode).toEqual([expect.objectContaining({ severity: 'info', code: 'asset-unused' })])
  }
})
