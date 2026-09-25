// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createShapeNode } from '@/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { captureGenerationSnapshot } from '@/renderer/authoring/generation/generationSnapshot'
import { createGenerationCandidateCoordinator } from '@/renderer/authoring/generation/prepareGenerationCandidate'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { applyEditorTransactionStep, type EditorTransactionStep } from '@/renderer/authoring/editorTransaction'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course'
import type { HistoryResourceState } from '@/renderer/store/courseResourceState'
import { projectDocumentTool, projectDynamicTargets } from '@/renderer/authoring/tools/projectDocumentTool'
import { readGenerationFailure } from '@/shared/generationContract'

function fixture() {
  const project = createBlankCourseProject({ id: 'offline-fallback', includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces[0]!
  if (surface.type !== 'slide') throw new Error('Slide')
  surface.scenes[0]!.layerItems.push(sceneNodeToCourseLayerItem(createShapeNode('rectangle', { id: 'selected-square', style: { fillColor: '#ff0000' } }), 0))
  const second = createBlankCourseProject({ id: 'second', includeDefaultController: false, controls: 'none' })
  const other = second.surfaces[0]!
  if (other.type !== 'slide') throw new Error('Slide')
  other.scenes[0]!.layerItems.push(sceneNodeToCourseLayerItem(createShapeNode('rectangle', { id: 'other-square', style: { fillColor: '#ff0000' } }), 0))
  surface.scenes.push(other.scenes[0]!); project.locations.push(...second.locations.map(location => ({ ...location, surfaceId: surface.id })))
  let state = { document: project, resources: { assetFiles: {}, componentPackages: {} } as HistoryResourceState }
  const workspace = { version: 1 as const, projectId: project.id, normalizedPath: 'c:/fresh-machine/lesson.h5lesson' }
  const request = captureGenerationSnapshot({ document: project, workspace,
    sessionToken: { locationId: project.startLocationId, surfaceType: 'slide', revision: project.revision, generation: 1 },
    projection: projectEffectiveLayers({ project, locationId: project.startLocationId }), selectedIds: ['selected-square'], scope: 'selection',
    instruction: '把另一页的方形改成蓝色，在它中间新增独立黄色圆形，保持选中方形不变。', purpose: 'local-edit' })
  const commits: EditorTransactionStep[] = []
  const coordinator = createGenerationCandidateCoordinator({ readDocument: () => state.document, readResources: () => state.resources,
    readWorkspace: () => workspace, readSessionGeneration: () => 1,
    commit: step => { commits.push(step); state = applyEditorTransactionStep(state, step, 'forward'); return true } })
  const next = structuredClone(project), target = next.surfaces[0]!
  if (target.type !== 'slide') throw new Error('Slide')
  const square = target.scenes[1]!.layerItems[0]!
  if (square.kind !== 'native' || square.content.nativeType !== 'shape') throw new Error('Shape')
  square.content.data.style.fillColor = '#0000ff'
  target.scenes[1]!.layerItems.push(sceneNodeToCourseLayerItem(createShapeNode('ellipse', { id: 'yellow-circle', style: { fillColor: '#ffff00' }, x: 80, y: 80, width: 100, height: 100 }), 1))
  const candidate = { version: 1, requestId: request.requestId, candidateId: randomUUID(), summary: '另一页方形变蓝并新增独立黄圆',
    steps: [{ id: 'file-result', tool: 'project.document', carrier: 'native', destination: request.destinations[0], input: { artifact: { document: next } } }] }
  return { project, next, request, candidate, coordinator, commits, read: () => state,
    undo: () => { state = applyEditorTransactionStep(state, commits[0]!, 'inverse') }, redo: () => { state = applyEditorTransactionStep(state, commits[0]!, 'forward') } }
}

describe('CLI project result through the canonical transaction', () => {
  it('limited closeout preserves unrelated existing errors across rule reordering', async () => {
    const f = fixture()
    const oldRule = { id: 'old-error', enabled: true, trigger: { type: 'scene.enter' as const }, conditions: [],
      actions: [{ id: 'old-action', start: 'after-previous' as const, delayMs: 0, action: { type: 'scene.go' as const, sceneId: 'missing-old-scene' } }] }
    f.project.globalInteractions.push(oldRule)
    f.next.globalInteractions.push({ ...structuredClone(oldRule), id: 'valid-rule', actions: [{ ...oldRule.actions[0]!, id: 'valid-action', action: { type: 'scene.go', sceneId: (f.project.surfaces[0] as any).scenes[0].id } }] }, structuredClone(oldRule))
    const preview = await f.coordinator.prepare(f.request, f.candidate)
    expect((await f.coordinator.apply(preview.previewId)).status).toBe('committed')
    expect(f.commits).toHaveLength(1)
    expect(f.read().document.globalInteractions[1]).toEqual(oldRule)
  })
  it('limited closeout rejects a newly dangling reference after its target is removed', async () => {
    const f = fixture(), surface = f.project.surfaces[0]!, nextSurface = f.next.surfaces[0]!
    if (surface.type !== 'slide' || nextSurface.type !== 'slide') throw new Error('Slide')
    const targetId = surface.scenes[1]!.id
    const rule = { id: 'existing-return', enabled: true, trigger: { type: 'scene.enter' as const }, conditions: [],
      actions: [{ id: 'existing-action', start: 'after-previous' as const, delayMs: 0, action: { type: 'scene.go' as const, sceneId: targetId } }] }
    f.project.globalInteractions.push(rule); f.next.globalInteractions.push(structuredClone(rule))
    nextSurface.scenes.pop()
    f.next.locations = f.next.locations.filter(location => location.kind !== 'slide-scene' || location.sceneId !== targetId)
    const error = await f.coordinator.prepare(f.request, f.candidate).catch(error => error)
    expect(readGenerationFailure(error)?.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'interaction-scene-reference-missing' })]))
    expect(f.commits).toHaveLength(0)
    expect(f.read().document).toEqual(f.project)
  })
  it.each(['scene.go', 'location.go'] as const)('rejects an invalid global %s reference before any project.document transaction', async type => {
    const f = fixture()
    f.next.globalInteractions.push({ id: 'global-return', enabled: true,
      trigger: { type: 'node.click', nodeId: 'selected-square' }, conditions: [], actions: [{
        id: 'return-action', start: 'after-previous', delayMs: 0,
        action: type === 'scene.go' ? { type, sceneId: 'location_record_flow' } : { type, locationId: 'missing-location' },
      }],
    })
    const error = await f.coordinator.prepare(f.request, f.candidate).catch(error => error)
    expect(readGenerationFailure(error)).toMatchObject({ diagnostics: [expect.objectContaining({
      code: type === 'scene.go' ? 'interaction-scene-reference-missing' : 'interaction-location-reference-missing',
    })] })
    expect(f.commits).toHaveLength(0)
    expect(f.read()).toEqual({ document: f.project, resources: { assetFiles: {}, componentPackages: {} } })
  })
  it('QP08 rejects an old full document after a prepared native edit without overwriting either live state or resources', async () => {
    const f = fixture()
    const destination = f.request.destinations.find(value => value.kind === 'update' && value.target.itemId === 'other-square')!
    const candidate = { ...f.candidate, steps: [{ id: 'native-edit', tool: 'native.content', carrier: 'native', destination,
      input: { operation: 'edit-shape', shapeStyle: { fillColor: '#00ff00' } } }, ...f.candidate.steps] }
    const error = await f.coordinator.prepare(f.request, candidate).catch(error => error)
    expect(readGenerationFailure(error)).toMatchObject({ stepId: 'file-result',
      diagnostics: [expect.objectContaining({ code: 'artifact-baseline-conflict', path: ['input', 'artifact', 'document', 'revision'] })],
      recovery: { action: 'refresh-baseline' } })
    expect(f.commits).toHaveLength(0)
    expect(f.read()).toEqual({ document: f.project, resources: { assetFiles: {}, componentPackages: {} } })
  })
  it('admits changed dynamic instances and resource/layout dependencies without rerunning unrelated dynamic hosts for a native edit', () => {
    const f = fixture(), project = structuredClone(f.project), surface = project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('Slide')
    const { content: _content, ...wrapper } = surface.scenes[0]!.layerItems[0]! as any
    surface.scenes[0]!.layerItems.push({ ...wrapper, layerItemId: 'runtime', kind: 'runtime', runtime: { source: 'before' } })
    const nativeEdit = structuredClone(project); nativeEdit.title = 'New title'
    expect(projectDynamicTargets(nativeEdit, project, false)).toEqual([])
    expect(projectDynamicTargets(nativeEdit, project, true)[0]!.instanceIds).toEqual(['runtime'])
    const changed = structuredClone(project), nextSurface = changed.surfaces[0]!
    if (nextSurface.type !== 'slide') throw new Error('Slide')
    ;(nextSurface.scenes[0]!.layerItems.at(-1)! as any).runtime.source = 'after'
    expect(projectDynamicTargets(changed, project, false)[0]!.instanceIds).toEqual(['runtime'])
    nextSurface.canvas.width++
    expect(projectDynamicTargets(changed, project, false)).toHaveLength(1)
    const moved = structuredClone(project), movedSurface = moved.surfaces[0]!
    if (movedSurface.type !== 'slide') throw new Error('Slide')
    movedSurface.scenes[1]!.layerItems.push(movedSurface.scenes[0]!.layerItems.pop()!)
    expect(projectDynamicTargets(moved, project, false)).toMatchObject([{ locationId: project.locations[1]!.id, instanceIds: ['runtime'] }])
  })

  it('rejects a new file-authored Runtime through the actual admission port without a live transaction', async () => {
    const f = fixture(), surface = f.next.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('Slide')
    const { content: _content, ...wrapper } = surface.scenes[1]!.layerItems[0]! as any
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII='
    f.next.assets.fallback = { id: 'fallback', kind: 'image', filename: 'fallback.png', path: 'assets/fallback.png', mimeType: 'image/png', byteLength: Buffer.from(png, 'base64').length, width: 1, height: 1 }
    surface.scenes[1]!.layerItems.push({ ...wrapper, layerItemId: 'new-runtime', order: 2, kind: 'runtime', runtime: {
      protocol: 'canvas-runtime', runtimeApiVersion: 2, enabled: true, renderMode: 'dom',
      source: 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}})',
      content: { values: {} }, assets: {}, nodeBindings: {}, staticFallback: { assetId: 'fallback', coverage: 'scene' },
    } })
    Object.assign(f.candidate.steps[0]!.input.artifact, { assetFiles: { fallback: png } })
    const admission = vi.fn().mockResolvedValue({ ok: false, message: 'actual host rejected' })
    vi.stubGlobal('window', { desktopAPI: { dynamicAdmission: admission } })
    try {
      await expect(f.coordinator.prepare(f.request, f.candidate)).rejects.toThrow('actual host rejected')
      expect(admission).toHaveBeenCalledOnce()
      expect(admission.mock.calls[0]![0]).toMatchObject({ operation: 'run', payload: {
        targets: [{ locationId: f.next.locations[1]!.id, instanceIds: ['new-runtime'] }], assetFiles: { fallback: Uint8Array.from(Buffer.from(png, 'base64')) },
      } })
      expect(f.commits).toHaveLength(0); expect(f.read().document).toEqual(f.project)
    } finally { vi.unstubAllGlobals() }
  })
  it('discovers another page while keeping the first prompt focused, and commits two editable objects with save/reopen/undo/redo', async () => {
    const f = fixture()
    expect(f.request.destinations.some(d => d.kind === 'update' && d.target.itemId === 'other-square')).toBe(true)
    const preview = await f.coordinator.prepare(f.request, f.candidate)
    expect(f.commits).toHaveLength(0)
    expect((await f.coordinator.apply(preview.previewId)).status).toBe('committed')
    expect(f.commits).toHaveLength(1)
    expect((f.read().document.surfaces[0] as any).scenes[0]).toEqual((f.project.surfaces[0] as any).scenes[0])
    const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: f.read().document, assetFiles: {}, componentFiles: {} }))
    expect(reopened.project.surfaces[0]).toEqual(f.next.surfaces[0])
    expect(reopened.project.revision).toBe(f.project.revision + 1)
    expect(() => buildPublishedCourseV2Payload({ project: reopened.project, assetFiles: {}, components: {} })).not.toThrow()
    f.undo(); expect(f.read().document).toEqual(f.project)
    f.redo(); expect(f.read().document).toEqual(reopened.project)
    expect((await f.coordinator.apply(preview.previewId)).status).toBe('stale')
  })

  it.each(['foreign-id', 'stale-revision', 'broken-resource', 'unknown-field'])('rejects %s without document or resource writes', async mode => {
    const f = fixture(), document = f.candidate.steps[0]!.input.artifact.document as any
    if (mode === 'foreign-id') document.id = 'foreign'
    if (mode === 'stale-revision') document.revision++
    if (mode === 'unknown-field') document.unknownField = true
    if (mode === 'broken-resource') {
      document.surfaces[0].scenes[1].layerItems[0].content = { nativeType: 'image', data: { assetId: 'missing', fit: 'contain' } }
    }
    await expect(f.coordinator.prepare(f.request, f.candidate)).rejects.toThrow()
    expect(f.commits).toHaveLength(0); expect(f.read().document).toEqual(f.project)
  })

  it('reports the Flow background color format through the project.document candidate diagnostic', async () => {
    const f = fixture()
    const invalid = createBlankFlowCourseProject({ id: f.project.id, includeDefaultController: false, controls: 'none' })
    invalid.revision = f.project.revision
    const flow = invalid.surfaces[0]!
    if (flow.type !== 'flow') throw new Error('Flow')
    flow.backgroundColor = '#fff'
    ;(f.candidate.steps[0]!.input.artifact as any).document = invalid

    const error = await f.coordinator.prepare(f.request, f.candidate).catch(value => value)
    expect(readGenerationFailure(error)).toMatchObject({
      stepId: 'file-result',
      diagnostics: [expect.objectContaining({
        code: 'invalid-input',
        path: ['input', 'artifact', 'document', 'surfaces', '0', 'backgroundColor'],
        message: 'Flow backgroundColor must be a six-digit #RRGGBB color (for example, #f8fafc)',
      })],
    })
    expect(f.commits).toHaveLength(0)
    expect(f.read().document).toEqual(f.project)
  })

  it('reports order as local to the stored owner list through the project.document candidate diagnostic', async () => {
    const f = fixture()
    const surface = f.next.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('Slide')
    surface.scenes[0]!.layerItems.push(sceneNodeToCourseLayerItem(createShapeNode('ellipse', {
      id: 'same-owner-order', style: { fillColor: '#ffff00' }, x: 80, y: 80, width: 100, height: 100,
    }), 0))

    const error = await f.coordinator.prepare(f.request, f.candidate).catch(value => value)
    expect(readGenerationFailure(error)).toMatchObject({
      stepId: 'file-result',
      diagnostics: [expect.objectContaining({
        code: 'invalid-input',
        path: ['input', 'artifact', 'document', 'surfaces', '0', 'scenes', '0', 'layerItems', '1', 'order'],
        message: 'Layer items in this stored owner list must have strictly increasing order; 0 follows 0',
      })],
    })
    expect(f.commits).toHaveLength(0)
    expect(f.read().document).toEqual(f.project)
  })

  it('describes multi-Surface print planning and owner-local order for project.document', () => {
    expect(projectDocumentTool.description).toContain('新增第二个或更多 Surface 时，document 必须同时提供 mixedPrintPlan')
    expect(projectDocumentTool.description).toContain('每个已存储的 global/surface/scene/world 图层列表内部按 item.order 严格递增')
  })
})
