// @vitest-environment node
import { expect, it } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { IMAGE_DEFINITION, createImageData } from '../../src/components/image'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'
import { CourseV10DocumentBridge, type CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import { prepareDocumentClipboard } from '../../src/renderer/document/documentClipboard'
import { createFlowDocumentResourcePort, captureFlowPreparedDocumentResources, prepareFlowDocumentResourceTransaction, type FlowPreparedDocumentResources } from '../../src/renderer/document/flowDocumentResources'

const json = (value: unknown) => JSON.parse(JSON.stringify(value))
it('copies a staged Flow object again with private files and asset bytes in one saved undoable operation', async () => {
  const source: CourseProjectV10 = { schemaVersion: 10, id: 'source', revision: 0, title: '源正文',
    definitions: { [IMAGE_DEFINITION.id]: IMAGE_DEFINITION, custom: { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'javascript', workspace: { ownerId: 'files', entry: 'main.js' } } } },
    instances: { image: { id: 'image', definitionId: IMAGE_DEFINITION.id, data: json(createImageData('logo')) }, custom: { id: 'custom', definitionId: 'custom', data: { message: '保留原内容' } } },
    surfaces: [{ id: 'flow', kind: 'flow', title: '正文', childIds: ['image', 'custom'] }], global: { underlay: [], overlay: [] }, assets: { logo: { id: 'logo', path: 'assets/logo.svg', filename: 'logo.svg', mimeType: 'image/svg+xml' } } }
  const sourceResources = { assets: { logo: new TextEncoder().encode('<svg>source</svg>') }, components: { files: { 'main.js': new TextEncoder().encode("import './part.js'"), 'part.js': new TextEncoder().encode('export default 1') } } }
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'target', revision: 0, title: '目标', definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION }, instances: { body: { id: 'body', definitionId: TEXT_DEFINITION.id, data: json(createTextComponentData('原正文')) } }, surfaces: [{ id: 'flow', kind: 'flow', title: '正文', childIds: ['body'] }], global: { underlay: [], overlay: [] }, assets: structuredClone(source.assets) }
  const resources = { assets: { logo: new TextEncoder().encode('<svg>target</svg>') }, components: {} }
  const target: CapturedCourseTarget = { documentId: 'doc', epoch: 'epoch', project, editingProject: project, resources, surfaceId: 'flow', activeStateId: null, instanceId: 'body', instanceIds: ['body'] }
  const pending: FlowPreparedDocumentResources[] = []
  const port = createFlowDocumentResourcePort({ target, source: { documentId: 'other', project: source, resources: sourceResources, roots: ['image', 'custom'] }, pending: () => pending, onPrepared: value => pending.push(value) })
  const first = await prepareDocumentClipboard(projectFlowDocument(source, 'flow'), { assets: [], components: [] }, port)
  const staged = captureFlowPreparedDocumentResources(target, pending)
  const local = createFlowDocumentResourcePort({ target, source: { documentId: 'doc', project: staged.project, resources: staged.resources, roots: first.document.content.blocks.map(block => block.id) }, pending: () => pending, onPrepared: value => pending.push(value) })
  const second = await prepareDocumentClipboard(first.document, first.document.resources, local)
  const blocks = [...projectFlowDocument(project, 'flow').content.blocks, ...first.document.content.blocks, ...second.document.content.blocks]
  const planned = prepareFlowDocumentResourceTransaction(target, 'flow', blocks, pending)
  expect(planned.target.activeStateId).toBeNull()
  const driver = new CourseV10Driver()
  const session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', model: { kind: 'course-v10', project, resources }, binding: { kind: 'untitled', suggestedName: 'copy.h5lesson' } }, driver, { async append() {}, async save() { throw new Error('uses actual Driver below') } })
  const { documentId: _documentId, epoch: _epoch, ...command } = new CourseV10DocumentBridge().capture(planned.edits, planned.target)
  expect(await session.execute({ documentId: 'doc', epoch: 'epoch', operationId: 'paste', baseRevision: 0, actor: 'human', mutation: { type: 'command', command } })).toMatchObject({ status: 'applied' })
  const snapshot = session.read(), model = snapshot.model
  if (model.kind !== 'course-v10') throw new Error('expected V10')
  const firstImage = model.project.instances[first.document.content.blocks[0].id], secondImage = model.project.instances[second.document.content.blocks[0].id]
  expect(firstImage.id).not.toBe(secondImage.id)
  expect(firstImage.data).toEqual(secondImage.data)
  expect(model.resources.assets[(firstImage.data as { assetId: string }).assetId]).toEqual(sourceResources.assets.logo)
  expect(model.resources.assets.logo).toEqual(resources.assets.logo)
  const firstCustom = model.project.instances[first.document.content.blocks[1].id], secondCustom = model.project.instances[second.document.content.blocks[1].id]
  expect(firstCustom.id).not.toBe(secondCustom.id)
  const firstImplementation = model.project.definitions[firstCustom.definitionId].implementation, secondImplementation = model.project.definitions[secondCustom.definitionId].implementation
  if (firstImplementation.kind !== 'source' || secondImplementation.kind !== 'source' || !firstImplementation.workspace || !secondImplementation.workspace) throw new Error('missing private workspace')
  expect(firstImplementation.workspace.ownerId).not.toBe(secondImplementation.workspace.ownerId)
  expect(model.resources.components[firstImplementation.workspace.ownerId]).toEqual(sourceResources.components.files)
  expect(model.resources.components[secondImplementation.workspace.ownerId]).toEqual(sourceResources.components.files)
  expect(snapshot.undoDepth).toBe(1)
  expect(driver.load(driver.serialize(model))).toEqual(model)
  expect(await session.execute({ documentId: 'doc', epoch: 'epoch', operationId: 'undo', baseRevision: snapshot.revision, actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  const undone = session.read().model
  expect(undone.kind === 'course-v10' && undone.project.instances).toEqual(project.instances)
  expect(undone.kind === 'course-v10' && undone.resources).toEqual(resources)
})
