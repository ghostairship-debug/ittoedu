import { describe, expect, it, vi } from 'vitest'
import { captureGenerationSnapshot } from '@/renderer/authoring/generation/generationSnapshot'
import { createGenerationCandidateCoordinator } from '@/renderer/authoring/generation/prepareGenerationCandidate'
import { applyEditorTransactionStep, type EditorTransactionStep } from '@/renderer/authoring/editorTransaction'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import { createShapeNode, createTextNode } from '@/core/tools/nativeNodeFactories'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'
import { locateCourseLayer } from '@/renderer/course/effectiveLayerCommands'
import { findFlowBlockRecursive } from '@/core/tools/flowDocumentModel'
import type { CourseProjectDocument, LayerItem } from '@/shared/courseProjectTypes'
import type { GenerationCandidate, GenerationRequest } from '@/shared/generationContract'
import type { HistoryResourceState } from '@/renderer/store/courseResourceState'

// Only the browser decoder is replaced. Captured targets, tools, domain
// commands, candidate transaction, resources and archive are product paths.
vi.mock('@/renderer/project/assetManager', async original => ({ ...await original<typeof import('@/renderer/project/assetManager')>(), readImageDimensions: vi.fn(async () => ({ width: 1, height: 1 })) }))
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII='
const imageSource = { base64: png, filename: 'illustration.png', mimeType: 'image/png' }
const options = { includeDefaultController: false as const, controls: 'none' as const }
const duplicateInstruction = '复制选中卡片一份放在右侧，间距24，原卡片保持。'
const reorderInstruction = '把选中蓝色卡片移到同一层中的另外两张卡片上方。'
const imageInstruction = '在选中说明之后插入一张解释判别式与抛物线交点关系的知识插图，现有说明保持。'
type Carrier = 'slide-base' | 'slide-state' | 'slide-shared' | 'flow-overlay' | 'flow-underlay' | 'spatial-world' | 'spatial-shared' | 'global'

function layer(id: string, order: number): LayerItem {
  return sceneNodeToCourseLayerItem(createShapeNode('rectangle', { id, x: 40 + order * 10, y: 90, width: 160, height: 80, rotation: 15 }), order)
}
function fixture(carrier: Carrier) {
  const document = carrier.startsWith('flow') ? createBlankFlowCourseProject(options)
    : carrier.startsWith('spatial') ? createBlankSpatialCourseProject(options) : createBlankCourseProject(options)
  const surface = document.surfaces[0]!, stateId = carrier === 'slide-state' ? 'active' : null
  const items = [layer('a', 10), layer('b', 20), layer('c', 30)]
  if (carrier === 'global') document.globalLayerItems.push(...items.map(item => ({ item, plane: 'overlay' as const, visibility: { mode: 'all' as const, locationIds: [] } })))
  else if (carrier === 'slide-base' || carrier === 'slide-state') {
    if (surface.type !== 'slide') throw new Error('Slide')
    surface.scenes[0]!.layerItems.push(...items)
    if (stateId) surface.scenes[0]!.presentation = { initialStateId: stateId, states: [
      { id: stateId, name: '当前状态', layerItemOrder: ['b', 'a', 'c'], layerItemOverrides: { a: { frame: { x: 55, width: 190 }, opacity: .6 } } },
      { id: 'other', name: '其他状态', layerItemOverrides: { a: { frame: { x: 200 } } } },
    ] }
  } else if (carrier === 'spatial-world') {
    if (surface.type !== 'spatial-2d') throw new Error('Spatial')
    surface.world.layerItems.push(...items)
  } else if (surface.type === 'flow') {
    const bodyPlane = carrier === 'flow-underlay' ? 'underlay' as const : 'overlay' as const
    surface.surfaceLayerItems.push(...items.map(item => ({ item, bodyPlane, visibility: { mode: 'all' as const, locationIds: [] } })))
    surface.surfaceLayerItems.push({ item: layer('opposite-plane', 25), bodyPlane: bodyPlane === 'underlay' ? 'overlay' : 'underlay', visibility: { mode: 'all', locationIds: [] } })
  } else surface.surfaceLayerItems.push(...items.map(item => ({ item, visibility: { mode: 'all' as const, locationIds: [] } })))
  document.globalLayerItems.push({ item: layer('global-guard', 100), plane: 'underlay', visibility: { mode: 'all', locationIds: [] } })
  return { document, stateId }
}
function snapshot(document: CourseProjectDocument, selectedIds: string[], instruction: string, stateId: string | null = null) {
  const projection = projectEffectiveLayers({ project: document, locationId: document.startLocationId, stateId })
  return captureGenerationSnapshot({ document, projection, workspace: { version: 1, projectId: document.id, normalizedPath: '/g1.h5lesson' },
    sessionToken: { locationId: document.startLocationId, surfaceType: projection.surfaceType, revision: document.revision, generation: 7 },
    selectedIds, scope: 'selection', instruction, purpose: 'local-edit' })
}
function update(request: GenerationRequest, id: string) {
  const target = request.destinations.find(destination => destination.kind === 'update' && destination.target.itemId === id)
  if (!target || target.kind !== 'update') throw new Error(`Missing captured ${id}`)
  return target
}
function harness(document: CourseProjectDocument) {
  const before = { document, resources: { assetFiles: {}, componentPackages: {} } as HistoryResourceState }
  let state = before
  const commits: EditorTransactionStep[] = []
  const coordinator = createGenerationCandidateCoordinator({ readDocument: () => state.document, readResources: () => state.resources,
    readWorkspace: () => ({ version: 1, projectId: document.id, normalizedPath: '/g1.h5lesson' }), readSessionGeneration: () => 7,
    commit(step) { state = applyEditorTransactionStep(state, step, 'forward'); commits.push(step); return true } })
  return { coordinator, commits, read: () => state, candidate(request: GenerationRequest, steps: GenerationCandidate['steps']): GenerationCandidate {
    return { version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: '完成选区操作', steps }
  }, async apply(request: GenerationRequest, steps: GenerationCandidate['steps']) {
    const preview = await coordinator.prepare(request, this.candidate(request, steps))
    expect(commits).toHaveLength(0)
    expect((await coordinator.apply(preview.previewId)).status).toBe('committed')
    expect(commits).toHaveLength(1)
    const undo = applyEditorTransactionStep(state, commits[0]!, 'inverse')
    expect(undo).toEqual(before)
    expect(applyEditorTransactionStep(undo, commits[0]!, 'forward')).toEqual(state)
    const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: state.document, assetFiles: state.resources.assetFiles, componentFiles: {} }))
    expect(reopened.project).toEqual(state.document); expect(reopened.assetFiles).toEqual(state.resources.assetFiles)
  } }
}
function rows(document: CourseProjectDocument, stateId: string | null = null) {
  return projectEffectiveLayers({ project: document, locationId: document.startLocationId, stateId }).unifiedRows
}
function semanticRows(document: CourseProjectDocument, stateId: string | null = null, exclude = '') {
  return rows(document, stateId).filter(row => row.id !== exclude && row.effectiveVisible).map(row => ({
    id: row.id, owner: row.ownerKey, group: row.reorderGroupKey, item: { ...row.item, order: 0 },
  }))
}
const carriers: Carrier[] = ['slide-base', 'slide-state', 'slide-shared', 'flow-overlay', 'flow-underlay', 'spatial-world', 'spatial-shared', 'global']

describe('G1 exact selected layer operations use existing domain commands', () => {
  it.each(carriers)('D07 reorders %s only inside its real owner/plane and round-trips one transaction', async carrier => {
    const { document, stateId } = fixture(carrier), request = snapshot(document, ['a', 'b', 'c'], reorderInstruction, stateId), h = harness(document)
    expect(request.selectionActions?.filter(action => action.operation === 'reorder')).toHaveLength(3)
    expect((request.context as any).capabilities.toolIds).toContain('layer.edit')
    await h.apply(request, [{ id: 'reorder', tool: 'layer.edit', carrier: 'native', destination: update(request, 'a'), input: { operation: 'reorder', position: { kind: 'after', siblingId: 'c' } } }])
    const after = h.read().document, row = rows(after, stateId).find(row => row.id === 'a')!
    expect(rows(after, stateId).filter(candidate => candidate.reorderGroupKey === row.reorderGroupKey).map(row => row.id)).toEqual(['b', 'c', 'a'])
    expect(semanticRows(after, stateId).sort((a, b) => a.id.localeCompare(b.id))).toEqual(semanticRows(document, stateId).sort((a, b) => a.id.localeCompare(b.id)))
    if (stateId) {
      expect(semanticRows(after, null)).toEqual(semanticRows(document, null))
      expect(semanticRows(after, 'other')).toEqual(semanticRows(document, 'other'))
    }
  })
  it.each(carriers)('D08 duplicates %s once, preserves the source and other presentations, and saves/undoes the result', async carrier => {
    const { document, stateId } = fixture(carrier), request = snapshot(document, ['a'], duplicateInstruction, stateId), h = harness(document)
    const original = rows(document, stateId).find(row => row.id === 'a')!.item
    await h.apply(request, [{ id: 'duplicate', tool: 'layer.edit', carrier: 'native', destination: update(request, 'a'), input: { operation: 'duplicate', placement: { side: 'right', gap: 24 } } }])
    const after = h.read().document, existing = new Set(rows(document, stateId).map(row => row.id))
    const copies = rows(after, stateId).filter(row => !existing.has(row.id))
    expect(copies).toHaveLength(1)
    const copy = copies[0]!
    expect(copy.reorderGroupKey).toBe(rows(after, stateId).find(row => row.id === 'a')!.reorderGroupKey)
    expect(copy.item).toMatchObject({ frame: { x: original.frame.x + original.frame.width + 24, y: original.frame.y, width: original.frame.width, height: original.frame.height }, rotation: original.rotation, opacity: original.opacity })
    expect(copy.item.kind === 'native' && original.kind === 'native' ? copy.item.content : null).toEqual(original.kind === 'native' ? original.content : null)
    expect(locateCourseLayer(after, 'a')!.item).toEqual(locateCourseLayer(document, 'a')!.item)
    expect(semanticRows(after, stateId, copy.id)).toEqual(semanticRows(document, stateId))
    if (stateId) {
      expect(semanticRows(after, null)).toEqual(semanticRows(document, null))
      expect(semanticRows(after, 'other')).toEqual(semanticRows(document, 'other'))
      expect(rows(after, null).find(row => row.id === copy.id)!.effectiveVisible).toBe(false)
    }
  })
})

function imageFixture(carrier: 'slide-base' | 'slide-state' | 'flow-body' | 'spatial-world') {
  const document = carrier === 'flow-body' ? createBlankFlowCourseProject(options) : carrier === 'spatial-world' ? createBlankSpatialCourseProject(options) : createBlankCourseProject(options)
  const surface = document.surfaces[0]!, stateId = carrier === 'slide-state' ? 'active' : null
  if (surface.type === 'flow') surface.blocks.push({ id: 'section', type: 'section', title: { inlines: [{ type: 'text', text: '说明与插图' }] }, collapsedByDefault: false, blocks: [
    { id: 'anchor', type: 'paragraph', content: { inlines: [{ type: 'text', text: '选中说明保留，a≠0。' }] } }, { id: 'tail', type: 'paragraph', content: { inlines: [{ type: 'text', text: '原后文保留。' }] } },
  ] })
  else {
    const item = sceneNodeToCourseLayerItem(createTextNode({ id: 'anchor', text: '选中说明保留，a≠0。', x: 40, y: 70, width: 320, height: 80 }), 10)
    if (surface.type === 'slide') {
      surface.scenes[0]!.layerItems.push(item)
      if (stateId) surface.scenes[0]!.presentation = { initialStateId: stateId, states: [{ id: stateId, name: '当前', layerItemOverrides: {} }, { id: 'other', name: '其他', layerItemOverrides: {} }] }
    } else surface.world.layerItems.push(item)
  }
  return { document, stateId }
}

describe('G1 I03 uses one exact image creation after the selected explanation', () => {
  it.each(['slide-base', 'slide-state', 'flow-body', 'spatial-world'] as const)('inserts an actual resource on %s without replacing the explanation, with archive/Undo/Redo', async carrier => {
    const { document, stateId } = imageFixture(carrier), request = snapshot(document, ['anchor'], imageInstruction, stateId), h = harness(document)
    const action = request.selectionActions?.find(action => action.operation === 'insert-image-after')
    if (!action || action.operation !== 'insert-image-after') throw new Error('Missing captured insertion')
    expect(request.destinations).toContainEqual(action.destination)
    await h.apply(request, [{ id: 'illustration', tool: 'media.apply', carrier: 'native', destination: action.destination, input: { kind: 'image', source: imageSource, preserveResolution: true } }])
    const after = h.read().document, surface = after.surfaces[0]!
    expect(Object.values(h.read().resources.assetFiles)).toEqual([Uint8Array.from(atob(png), c => c.charCodeAt(0))])
    if (surface.type === 'flow') {
      const section = surface.blocks.find(block => block.id === 'section')!
      if (section.type !== 'section') throw new Error('Section')
      expect(section.blocks.map(block => block.type)).toEqual(['paragraph', 'media', 'paragraph'])
      expect(section.blocks[0]).toEqual({ id: 'anchor', type: 'paragraph', content: { inlines: [{ type: 'text', text: '选中说明保留，a≠0。' }] } })
      expect(section.blocks[1]).toMatchObject({ mediaKind: 'image', assetId: expect.any(String) })
      expect(action.destination.scope.parent).toEqual({ kind: 'flow-body', parentBlockId: 'section' })
    } else {
      const anchor = rows(document, stateId).find(row => row.id === 'anchor')!, images = rows(after, stateId).filter(row => row.item.kind === 'native' && row.item.content.nativeType === 'image')
      expect(images).toHaveLength(1)
      expect(images[0]!.item.frame).toMatchObject({ x: anchor.frame.x, y: anchor.frame.y + anchor.frame.height + 24, width: anchor.frame.width })
      expect(locateCourseLayer(after, 'anchor')!.item).toEqual(locateCourseLayer(document, 'anchor')!.item)
      if (stateId) expect(semanticRows(after, null)).toEqual(semanticRows(document, null))
    }
  })

  it('T04 appends a complete editable example to the selected paragraph without needing a creation grant', async () => {
    const { document } = imageFixture('flow-body'), instruction = '在选中说明后补充一个Δ=0的完整例子。'
    const request = snapshot(document, ['anchor'], instruction), h = harness(document)
    expect(request).not.toHaveProperty('selectionActions')
    const text = '选中说明保留，a≠0。\nx²−2x+1=0：a=1，b=-2，c=1；Δ=4−4=0，x=1。'
    await h.apply(request, [{ id: 'example', tool: 'flow.content', carrier: 'native', destination: update(request, 'anchor'), input: { operation: 'edit', content: { inlines: [{ type: 'text', text }] } } }])
    const surface = h.read().document.surfaces[0]!
    if (surface.type !== 'flow') throw new Error('Flow')
    expect(findFlowBlockRecursive(surface.blocks, 'anchor')!.block).toMatchObject({ id: 'anchor', type: 'paragraph', content: { inlines: [{ type: 'text', text }] } })
    expect(findFlowBlockRecursive(surface.blocks, 'tail')!.block).toEqual({ id: 'tail', type: 'paragraph', content: { inlines: [{ type: 'text', text: '原后文保留。' }] } })
  })
})

describe('Open creation with canonical ordering and atomic failure checks', () => {
  it('allows repeated duplication without a focus grant but rejects wrong-plane ordering and failed final steps atomically', async () => {
    for (const mode of ['no-grant', 'twice', 'cross-plane', 'last-fails'] as const) {
      const { document } = fixture('global'), request = snapshot(document, ['a', 'global-guard'], mode === 'cross-plane' ? reorderInstruction : duplicateInstruction), h = harness(document)
      if (mode === 'no-grant') delete request.selectionActions
      const step: GenerationCandidate['steps'][number] = { id: 'action', tool: 'layer.edit', carrier: 'native', destination: update(request, 'a'), input: mode === 'cross-plane'
        ? { operation: 'reorder', position: { kind: 'after', siblingId: 'global-guard' } } : { operation: 'duplicate', placement: { side: 'right', gap: 24 } } }
      const steps = mode === 'twice' ? [step, { ...step, id: 'again' }] : mode === 'last-fails' ? [step, { ...step, id: 'bad', tool: 'native.content', input: { operation: 'unavailable' } }] : [step]
      if (mode === 'no-grant' || mode === 'twice') {
        await h.apply(request, steps); expect(h.commits).toHaveLength(1); continue
      }
      const reason = mode === 'cross-plane' ? /同 owner\/plane/ : /unavailable|Invalid|无效|校验|字段|操作|input/
      await expect(h.coordinator.prepare(request, h.candidate(request, steps))).rejects.toThrow(reason)
      expect(h.commits).toHaveLength(0); expect(h.read().document).toBe(document); expect(h.read().resources.assetFiles).toEqual({})
    }
  })
  it('allows additional objects, images, imports and anchor edits while rejecting an invalid Flow parent atomically', async () => {
    for (const mode of ['object', 'parent', 'twice', 'unused-import', 'anchor-changed'] as const) {
      const { document } = imageFixture('flow-body'), request = snapshot(document, ['anchor'], imageInstruction), h = harness(document)
      const action = request.selectionActions!.find(action => action.operation === 'insert-image-after')!
      if (action.operation !== 'insert-image-after') throw new Error('Image action')
      if (mode === 'parent') {
        const original = JSON.stringify(action.destination)
        action.destination.scope.parent = { kind: 'flow-body', parentBlockId: null }
        request.destinations = request.destinations.map(destination => JSON.stringify(destination) === original ? action.destination : destination)
      }
      const step: GenerationCandidate['steps'][number] = { id: 'image', tool: mode === 'object' ? 'flow.content' : 'media.apply', carrier: 'native', destination: action.destination, input: mode === 'object'
        ? { operation: 'insert', block: { type: 'paragraph', content: { inlines: [{ type: 'text', text: '未授权新段落' }] } } } : { kind: 'image', source: imageSource, preserveResolution: true } }
      const steps: GenerationCandidate['steps'] = [step]
      if (mode === 'twice') steps.push({ ...step, id: 'second' })
      if (mode === 'anchor-changed') steps.push({ id: 'edit-source', tool: 'flow.content', carrier: 'native', destination: update(request, 'anchor'), input: { operation: 'edit', content: { inlines: [{ type: 'text', text: '不应覆盖原说明' }] } } })
      if (mode === 'unused-import') steps.push({ id: 'unused', tool: 'asset.media.import', carrier: 'native', destination: request.destinations.find(value => value.kind === 'create' && value.scope.owner === 'global')!, input: { kind: 'image', ...imageSource } })
      if (mode !== 'parent') {
        await h.apply(request, steps); expect(h.commits).toHaveLength(1); continue
      }
      await expect(h.coordinator.prepare(request, h.candidate(request, steps))).rejects.toThrow(/父|容器|锚点|相邻对象|parent/)
      expect(h.commits).toHaveLength(0); expect(h.read().document).toBe(document); expect(h.read().resources.assetFiles).toEqual({})
    }
  })
  it('keeps ordinary text/image request discovery unchanged and does not guess an insertion among multiple selected anchors', () => {
    const { document } = imageFixture('slide-base')
    for (const instruction of ['把选中文字改为新标题', '把选中图片换成小狗', '不要复制选中说明', '不要在选中说明后插入图片']) {
      const request = snapshot(document, ['anchor'], instruction)
      expect(request).not.toHaveProperty('selectionActions')
      expect((request.context as any).capabilities.toolIds).not.toContain('layer.edit')
    }
    const surface = document.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('Slide')
    surface.scenes[0]!.layerItems.push(sceneNodeToCourseLayerItem(createTextNode({ id: 'second', text: '第二说明' }), 20))
    expect(snapshot(document, ['anchor', 'second'], imageInstruction)).not.toHaveProperty('selectionActions')
  })
})
