import { expect, it } from 'vitest'
import { extractComponentLibraryEntry, prepareComponentLibraryInsertion } from '../../src/core/components/library'
import { prepareCourseObjectPaste } from '../../src/core/course/courseObjectEdits'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { DocumentResources } from '../../src/shared/workbench/document'

const project = (id: string): CourseProjectV10 => ({ schemaVersion: 11, id, revision: 0, title: id,
  definitions: { host: { id: 'host', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } } },
  instances: { host: { id: 'host', definitionId: 'host', data: {}, childIds: [] } }, rootIds: ['host'], entry: { rootInstanceId: 'host' },
  assets: {}, global: { underlay: [], overlay: [] } })

it.each(['library', 'clipboard'] as const)('isolates declared image parameters from same-name destination assets through %s', method => {
  const source = project('source'), destination = project('destination')
  source.definitions.card = { id: 'card', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' },
    dataSchema: { type: 'object', properties: { cover: { type: 'string', format: 'image-asset' },
      cards: { type: 'array', items: { type: 'object', properties: { picture: { type: 'string', format: 'image' }, empty: { type: 'string', format: 'image-asset' } } } } } } }
  source.instances.card = { id: 'card', definitionId: 'card', data: { cover: 'missing-photo', cards: [{ picture: 'source-image', empty: '' }],
    assetId: 'source-image', text: 'missing-photo' } }
  source.instances.host.childIds = ['card']
  source.assets['source-image'] = { id: 'source-image', path: 'assets/source.png', mimeType: 'image/png' }
  const sourceResources: DocumentResources = { assets: { 'source-image': new Uint8Array([9]) }, components: {} }
  const destinationResources: DocumentResources = { assets: {}, components: {} }
  for (const id of ['missing-photo', 'source-image']) {
    destination.assets[id] = { id, path: `assets/destination-${id}.png`, mimeType: 'image/png' }
    destinationResources.assets[id] = new Uint8Array([1])
  }
  const extracted = extractComponentLibraryEntry(source, sourceResources, { id: 'card-library', title: 'Card', rootIds: ['card'] })
  const plan = method === 'library'
    ? prepareComponentLibraryInsertion(destination, extracted.entry, { container: { kind: 'instance', instanceId: 'host' }, index: 0 })
    : prepareCourseObjectPaste({ project: source, roots: ['card'], resources: sourceResources, documentId: 'source' }, {
      capturedTarget: { documentId: 'destination', project: destination, resources: destinationResources, surfaceId: null },
      container: { kind: 'instance', instanceId: 'host' }, index: 0 })
  const command = 'command' in plan ? plan.command : captureComponentOperation(destination, plan.edits)
  const mapped = 'identities' in plan ? plan.identities.assets : plan.assetIds
  const model = new CourseV10Driver().apply({ kind: 'course-v10', project: destination, resources: destinationResources }, command)
  if (model.kind !== 'course-v10') throw new Error('Expected a formal work')
  const insertedId = plan.rootIds[0], missing = mapped.get('missing-photo')!, copied = mapped.get('source-image')!
  expect(missing).toBeTruthy()
  expect(missing).not.toBe('missing-photo')
  expect(model.project.assets[missing]).toBeUndefined()
  expect(model.resources.assets[missing]).toBeUndefined()
  expect(model.project.instances[insertedId].data).toEqual({ cover: missing, cards: [{ picture: copied, empty: '' }], assetId: 'source-image', text: 'missing-photo' })
  expect(model.resources.assets[copied]).toEqual(new Uint8Array([9]))
  expect(model.resources.assets['missing-photo']).toEqual(new Uint8Array([1]))
  expect(model.resources.assets['source-image']).toEqual(new Uint8Array([1]))
  expect(extracted.diagnostics).toContainEqual({ code: 'missing-asset', message: '保留了待修复的素材引用：missing-photo' })
})
