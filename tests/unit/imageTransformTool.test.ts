// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import { createImageNode } from '@/renderer/project/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { imageTransformTool } from '@/renderer/authoring/tools/imageTransformTool'
import { executeAuthoringTool } from '@/renderer/authoring/tools/executeAuthoringTool'
import { resolveAuthoringToolScope } from '@/renderer/authoring/tools/authoringToolScope'
import { applyEditorTransactionStep, type EditorTransactionState, type EditorTransactionStep } from '@/renderer/authoring/editorTransaction'
import { createResourceAwareAuthoringHistory, commitEditorTransactionToAuthoringHistory } from '@/renderer/authoring/resourceAwareAuthoringHistory'
import { courseAuthoringScopeFromLocation, makeLayerItemAuthoringAddress } from '@/renderer/authoring/courseAuthoringScope'
import { findFlowBlockRecursive, makeFlowBlockAuthoringAddress } from '@/renderer/course/flowDocumentModel'
import { resolveEffectiveLayerTarget } from '@/renderer/course/effectiveLayerCommands'
import { encodeImageTransformPng } from '@/renderer/project/imageTransform'
import { createCourseProjectArchive, openCourseProjectArchive } from '@/renderer/project/courseProjectArchive'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course'
import type { AuthoringToolDestinationV1 } from '@/shared/authoringToolContract'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'

function setup(kind: 'slide' | 'flow' | 'flow-overlay' | 'spatial-2d' = 'slide', original = {
  bytes: encodeImageTransformPng({ width: 2, height: 1, data: Uint8Array.from([255, 0, 0, 128, 0, 0, 0, 255]) }), width: 2, height: 1,
}) {
  const project = kind === 'slide' ? createBlankCourseProject() : kind === 'spatial-2d' ? createBlankSpatialCourseProject() : createBlankFlowCourseProject()
  const surface = project.surfaces[0]!, location = project.locations[0]!
  const source = original.bytes
  project.assets.original = { id: 'original', kind: 'image', filename: '原始示意图.png', mimeType: 'image/png',
    path: 'assets/original.png', byteLength: source.length, width: original.width, height: original.height }
  const owner = surface.type === 'slide' ? 'scene' : surface.type === 'spatial-2d' ? 'world' : 'surface'
  const scope = courseAuthoringScopeFromLocation({ project, locationId: location.id, stateId: null, owner })
  const makeImage = (id: string, order: number) => sceneNodeToCourseLayerItem(createImageNode({ id, name: id,
    assetId: 'original', x: order * 100, y: 30, width: 90, height: 60, opacity: 0.8, rotation: 12 }), order)
  if (surface.type === 'slide') surface.scenes[0]!.layerItems.push(makeImage('selected-image', 1), makeImage('shared-image', 2))
  else if (surface.type === 'spatial-2d') surface.world.layerItems.push(makeImage('selected-image', 1), makeImage('shared-image', 2))
  else if (kind === 'flow') surface.blocks.push(...['selected-image', 'shared-image'].map(id => ({ id, type: 'media' as const,
    assetId: 'original', mediaKind: 'image' as const, layout: 'content-width' as const, caption: `保留说明 ${id}` })))
  else surface.surfaceLayerItems.push(...['selected-image', 'shared-image'].map((id, index) => ({ item: makeImage(id, index + 1),
    visibility: { mode: 'all' as const, locationIds: [] } })))
  const address = (id: string) => kind === 'flow' ? makeFlowBlockAuthoringAddress({ projectId: project.id, surfaceId: surface.id, blockId: id })
    : makeLayerItemAuthoringAddress({ projectId: project.id, owner, surfaceId: surface.id, sceneId: scope.sceneId, kind: 'native', layerItemId: id })
  const destination: AuthoringToolDestinationV1 = { kind: 'update', target: { projectId: project.id, documentRevision: project.revision,
    revisionPolicy: { kind: 'exact' }, sessionGeneration: 2, surfaceType: surface.type, surfaceId: surface.id,
    locationId: location.id, stateId: null, owner, ownerKey: scope.ownerKey, itemId: 'selected-image', authoringAddress: address('selected-image') } }
  let state: EditorTransactionState = { document: courseProjectDocumentSchema.parse(project), resources: { assetFiles: { original: source }, componentPackages: {} } }
  let step: EditorTransactionStep | undefined, history = createResourceAwareAuthoringHistory(state.document)
  const signal = new AbortController()
  const port = { signal: signal.signal, readDocument: () => state.document, readResources: () => state.resources,
    validateDestination: (value: AuthoringToolDestinationV1) => { resolveAuthoringToolScope(state.document, value); return null },
    commit: vi.fn((next: EditorTransactionStep) => { step = next; state = applyEditorTransactionStep(state, next, 'forward');
      history = commitEditorTransactionToAuthoringHistory(history, next); return true }) }
  const item = (document: CourseProjectDocument, id: string) => {
    if (kind === 'flow') {
      const current = document.surfaces[0]!
      if (current.type !== 'flow') throw new Error('Flow fixture required')
      return findFlowBlockRecursive(current.blocks, id)!.block
    }
    return resolveEffectiveLayerTarget(document, { authoringAddress: address(id), locationId: location.id, stateId: null }).item
  }
  const imageId = (document: CourseProjectDocument, id: string) => {
    const value = item(document, id)
    return 'assetId' in value ? value.assetId : 'kind' in value && value.kind === 'native' && value.content.nativeType === 'image' ? value.content.data.assetId : undefined
  }
  const request = { version: 1, requestId: 'recolor-selected-instance', tool: imageTransformTool.name, destination,
    input: { sourceAssetId: 'original', operations: [{ kind: 'replace-color', sourceColor: '#ff0000' }] } }
  return { request, port, signal, item, imageId, get state() { return state }, get history() { return history },
    undo() { state = applyEditorTransactionStep(state, step!, 'inverse') }, redo() { state = applyEditorTransactionStep(state, step!, 'forward') },
    advance() { state = { ...state, document: { ...state.document, revision: state.document.revision + 1 } } } }
}

describe('image transform single-instance resource transaction', () => {
  it.each(['slide', 'flow', 'flow-overlay', 'spatial-2d'] as const)('rejects the retained corrupt baseline PNG on %s without replacing either shared image', async kind => {
    const bytes = new Uint8Array(readFileSync(new URL('../fixtures/image-validation/architecture-baseline-corrupt-idat.png', import.meta.url)))
    const h = setup(kind, { bytes, width: 1, height: 1 }), before = structuredClone(h.state)
    const receipt = await executeAuthoringTool(h.request, imageTransformTool, h.port)
    expect(receipt).toMatchObject({ status: 'failed', beforeRevision: before.document.revision, afterRevision: before.document.revision,
      affected: [], resources: { assetIds: [], packageIds: [] },
      diagnostics: [{ code: 'image-source-decode-failed', path: ['input', 'sourceAssetId'] }] })
    expect(receipt.diagnostics[0]!.message).toContain('original')
    expect(receipt.diagnostics[0]!.message).toContain('IDAT')
    expect(h.port.commit).not.toHaveBeenCalled()
    expect(h.state).toEqual(before)
    expect(h.history.past).toHaveLength(0)
    expect(h.imageId(h.state.document, 'selected-image')).toBe('original')
    expect(h.imageId(h.state.document, 'shared-image')).toBe('original')
  })

  it.each(['slide', 'flow', 'flow-overlay', 'spatial-2d'] as const)('recolors one %s instance, preserves sharing and authoring data, and survives undo/redo/save/reopen/Published', async kind => {
    const h = setup(kind), before = structuredClone(h.state), untouched = structuredClone(h.item(h.state.document, 'shared-image'))
    const receipt = await executeAuthoringTool(h.request, imageTransformTool, h.port)
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed')
    expect(h.port.commit).toHaveBeenCalledTimes(1)
    expect(h.history.past).toHaveLength(1)
    expect(h.state.document.revision).toBe(before.document.revision + 1)
    const id = h.imageId(h.state.document, 'selected-image')!
    expect(id).not.toBe('original')
    expect(h.imageId(h.state.document, 'shared-image')).toBe('original')
    expect(h.item(h.state.document, 'shared-image')).toEqual(untouched)
    expect(JSON.stringify(h.item(h.state.document, 'selected-image')).replaceAll(id, 'original')).toBe(JSON.stringify(h.item(before.document, 'selected-image')))
    expect(h.state.document.assets.original).toEqual(before.document.assets.original)
    expect(h.state.resources.assetFiles.original).toEqual(before.resources.assetFiles.original)
    expect([...await sharp(h.state.resources.assetFiles[id]!).raw().toBuffer()]).toEqual([34, 197, 94, 128, 0, 0, 0, 255])
    h.undo(); expect(h.state).toEqual(before)
    h.redo(); expect(h.imageId(h.state.document, 'selected-image')).toBe(id)
    const archive = createCourseProjectArchive({ project: h.state.document, assetFiles: { ...h.state.resources.assetFiles }, componentFiles: {} })
    const reopened = openCourseProjectArchive(archive)
    expect(h.imageId(reopened.project, 'selected-image')).toBe(id)
    expect(h.imageId(reopened.project, 'shared-image')).toBe('original')
    expect([...await sharp(reopened.assetFiles[id]!).raw().toBuffer()]).toEqual([34, 197, 94, 128, 0, 0, 0, 255])
    const published = buildPublishedCourseV2Payload({ project: reopened.project, assetFiles: reopened.assetFiles, components: {} })
    const dataUrl = published.assets[id]!.url
    expect([...await sharp(Buffer.from(dataUrl.split(',')[1]!, 'base64')).raw().toBuffer()]).toEqual([34, 197, 94, 128, 0, 0, 0, 255])
    expect(published.assets.original).toBeDefined()
  })

  it.each(['bad-source', 'wrong-reference', 'empty-mask', 'asset-write', 'stale', 'stop'] as const)('leaves document and resources unchanged on %s', async reason => {
    const h = setup()
    const before = structuredClone(h.state)
    let definition = imageTransformTool
    if (reason === 'bad-source') h.port.readResources = () => ({ componentPackages: {}, assetFiles: { original: new Uint8Array(h.state.document.assets.original!.byteLength) } })
    if (reason === 'wrong-reference') h.request.input.sourceAssetId = 'not-the-selected-original'
    if (reason === 'empty-mask') Object.assign(h.request.input.operations[0]!, { mask: { width: 2, height: 1, bits: '00' } })
    if (reason === 'asset-write') h.port.commit.mockImplementation(() => { throw new Error('asset transaction unavailable') })
    if (reason === 'stop') h.signal.abort()
    if (reason === 'stale') definition = { ...imageTransformTool, async plan(input) {
      const result = await imageTransformTool.plan(input); h.advance(); return result
    } }
    const receipt = await executeAuthoringTool(h.request, definition, h.port)
    expect(receipt.status).toBe(reason === 'stop' || reason === 'stale' ? 'stale' : reason === 'empty-mask' ? 'rejected' : 'failed')
    expect(h.state.resources).toEqual(before.resources)
    expect({ ...h.state.document, revision: before.document.revision }).toEqual(before.document)
    expect(h.history.past).toHaveLength(0)
    if (reason !== 'asset-write') expect(h.port.commit).not.toHaveBeenCalled()
  })
})
