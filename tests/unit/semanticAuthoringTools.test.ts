import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import { createTextNode, createImageNode, createShapeNode, createFormulaNode, createTableNode, createChartNode } from '@/renderer/project/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument, LayerItem } from '@/shared/courseProjectTypes'
import type { AuthoringToolDestinationV1, AuthoringToolTargetWireV1 } from '@/shared/authoringToolContract'
import { courseAuthoringScopeFromLocation, makeLayerItemAuthoringAddress } from '@/renderer/authoring/courseAuthoringScope'
import { locateCourseLayer } from '@/renderer/course/effectiveLayerCommands'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'
import { makeFlowBlockAuthoringAddress } from '@/renderer/course/flowDocumentModel'
import { nativeAuthoringTool, nativeAuthoringToolInputSchema } from '@/renderer/authoring/tools/nativeAuthoringTool'
import { flowAuthoringTool } from '@/renderer/authoring/tools/flowAuthoringTool'
import { componentConfigureTool } from '@/renderer/authoring/tools/componentConfigureTool'
import { semanticReplacementTool, captureSelectionReplacementScopes } from '@/renderer/authoring/tools/semanticReplacementTool'
import { executeAuthoringTool, type AuthoringToolDefinition } from '@/renderer/authoring/tools/executeAuthoringTool'
import { applyEditorTransactionStep, type EditorTransactionStep } from '@/renderer/authoring/editorTransaction'
import { createGenerationCandidateCoordinator } from '@/renderer/authoring/generation/prepareGenerationCandidate'
import { generationRequestSchema, generationCandidateSchema, generationShortCandidateSchema, expandGenerationShortCandidate, generationMediaApplyWireInputSchema, describeGenerationSemanticTools, type GenerationCandidate } from '@/shared/generationContract'
import { captureGenerationSnapshot } from '@/renderer/authoring/generation/generationSnapshot'
import { readFileSync } from 'node:fs'
import { createCourseProjectArchive, openCourseProjectArchive } from '@/renderer/project/courseProjectArchive'
import { parseComponentPackageFiles } from '@/renderer/components/importComponentPackage'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course'
import { materializeCourseSlideLayerItems } from '@/shared/courseLayerComposition'
import type { HistoryResourceState } from '@/renderer/store/courseResourceState'
import { createSortComponentPackage } from '@/renderer/recipes/sort-component/package'
import { runtimeSourceTool } from '@/renderer/authoring/tools/runtimeSourceTool'
import { runtimeConfigureTool } from '@/renderer/authoring/tools/runtimeConfigureTool'
import { admitDynamicCandidate } from '@/renderer/authoring/tools/dynamicCandidateAdmission'

vi.mock('@/renderer/authoring/tools/dynamicCandidateAdmission', () => ({ admitDynamicCandidate: vi.fn(async () => []), verifyDynamicCandidateBehavior: vi.fn(async () => []) }))
vi.mock('@/renderer/project/assetManager', async importOriginal => ({ ...await importOriginal<typeof import('@/renderer/project/assetManager')>(), readImageDimensions: vi.fn(async () => ({ width: 1, height: 1 })) }))

function text(id: string, value = '原😀标题'): LayerItem { return sceneNodeToCourseLayerItem(createTextNode({ id, text: value, x: 71, y: 82, width: 345, height: 89, rotation: 17, style: { bold: true, emphasis: true, fontSize: 28 }, runs: [{ start: 1, end: 2, style: { italic: true, fontSize: 40 } }] }), 31) }
function add(project: CourseProjectDocument, item: LayerItem) {
  const surface = project.surfaces[0]!
  const items = surface.type === 'slide' ? surface.scenes[0]!.layerItems : surface.type === 'spatial-2d' ? surface.world.layerItems : surface.surfaceLayerItems.map(entry => entry.item)
  item.order = Math.max(30, ...items.map(entry => entry.order)) + 1
  if (surface.type === 'slide') surface.scenes[0]!.layerItems.push(item)
  else if (surface.type === 'spatial-2d') surface.world.layerItems.push(item)
  else surface.surfaceLayerItems.push({ item, visibility: { mode: 'include', locationIds: [project.startLocationId] }, bodyPlane: 'underlay' })
}
function target(project: CourseProjectDocument, id: string, stateId: string | null = null): AuthoringToolTargetWireV1 {
  const located = locateCourseLayer(project, id), surface = project.surfaces[0]!
  const scope = courseAuthoringScopeFromLocation({ project, locationId: project.startLocationId, stateId, ...(located ? { owner: located.source } : {}) })
  return { projectId: project.id, documentRevision: project.revision, revisionPolicy: { kind: 'exact' }, sessionGeneration: 1,
    surfaceType: surface.type, surfaceId: surface.id, locationId: scope.locationId, stateId, owner: scope.owner, ownerKey: scope.ownerKey, itemId: id,
    authoringAddress: located ? makeLayerItemAuthoringAddress({ projectId: project.id, owner: located.source, surfaceId: surface.id, sceneId: located.sceneId, kind: located.item.kind, layerItemId: id })
      : makeFlowBlockAuthoringAddress({ projectId: project.id, surfaceId: surface.id, blockId: id, carrier: 'native' }) }
}
function harness(project: CourseProjectDocument, initialResources: HistoryResourceState = { assetFiles: {}, componentPackages: {} }) {
  let state = { document: project, resources: initialResources }
  const commits: EditorTransactionStep[] = []
  const port = { readDocument: () => state.document, readResources: () => state.resources, validateDestination: () => null,
    commit(step: EditorTransactionStep) { state = applyEditorTransactionStep(state, step, 'forward'); commits.push(step); return true } }
  return { port, commits, read: () => state, async run<T>(tool: AuthoringToolDefinition<T>, input: unknown, destination: AuthoringToolDestinationV1) {
    return executeAuthoringTool({ version: 1, requestId: crypto.randomUUID(), tool: tool.name, input, destination }, tool, port)
  } }
}

describe('Semantic authoring retains omitted content and effective state', () => {
  it('creates and edits Flow paper overlays through canonical tools, retaining coordinates through publish, save and undo', async () => {
    const project = createBlankFlowCourseProject(), scope = target(project, 'unused')
    const { itemId: _id, authoringAddress: _address, ...base } = scope
    const test = harness(project)
    const created = await test.run(nativeAuthoringTool, { operation: 'insert', template: {
      nativeType: 'text', text: '稿纸批注', x: 24, y: 28, width: 180, height: 48, paperSpace: 'paper',
    } }, { kind: 'create', scope: { ...base, parent: { kind: 'owner' }, insertion: { kind: 'append' } } })
    expect(created.status, JSON.stringify(created.diagnostics)).toBe('committed')
    const id = created.affected[0]!.id
    expect(locateCourseLayer(test.read().document, id)!.item).toMatchObject({ paperSpace: 'paper', frame: { x: 24, y: 28, width: 180, height: 48 } })
    const before = test.read().document
    const changed = await test.run(nativeAuthoringTool, { operation: 'properties', properties: { paperSpace: 'viewport', locked: true } }, { kind: 'update', target: target(before, id) })
    expect(changed.status, JSON.stringify(changed.diagnostics)).toBe('committed')
    expect(locateCourseLayer(test.read().document, id)!.item.paperSpace).toBeUndefined()
    expect(locateCourseLayer(test.read().document, id)!.item.locked).toBe(true)
    expect(applyEditorTransactionStep(test.read(), test.commits.at(-1)!, 'inverse').document).toEqual(before)
    const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: before, assetFiles: {}, componentFiles: {} }))
    expect(reopened.project).toEqual(before)
    const published = buildPublishedCourseV2Payload({ project: before, assetFiles: {}, components: {} })
    const flow = published.surfaces.find(surface => surface.type === 'flow')!
    expect(flow.layout.widthMode).toBe('fluid')
    expect(flow.surfaceLayerItems.find(entry => entry.item.layerItemId === id)?.item.paperSpace).toBe('paper')
  })
  it('rejects Flow paperSpace on other surfaces and on the teacher controller without committing', async () => {
    for (const factory of [createBlankCourseProject, createBlankSpatialCourseProject, createBlankFlowCourseProject]) {
      const project = factory(), item = project.globalLayerItems[0]!.item, test = harness(project)
      const receipt = await test.run(nativeAuthoringTool, { operation: 'properties', properties: { paperSpace: 'paper' } }, { kind: 'update', target: target(project, item.layerItemId) })
      expect(receipt.status).toBe('failed'); expect(test.commits).toHaveLength(0)
      expect(test.read().document).toEqual(project)
    }
  })
  it.each([createBlankCourseProject, createBlankSpatialCourseProject])('edits a formal Native formula while preserving identity, style and geometry', async factory => {
    const project = factory(), node = sceneNodeToCourseLayerItem(createFormulaNode({ id: 'formula', formulaId: 'retained-formula', x: 20, y: 30, width: 500, height: 170 }), 31)
    add(project, node)
    const test = harness(project), formula = { ast: { type: 'token', value: 'y' }, accessibleText: 'y' }
    const receipt = await test.run(nativeAuthoringTool, { operation: 'edit-formula', formula }, { kind: 'update', target: target(project, node.layerItemId) })
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed')
    const after = locateCourseLayer(test.read().document, node.layerItemId)!.item
    expect(after).toMatchObject({ frame: node.frame, content: { nativeType: 'formula', data: { ...formula, formulaId: 'retained-formula' } } })
    if (node.kind !== 'native' || node.content.nativeType !== 'formula' || after.kind !== 'native' || after.content.nativeType !== 'formula') throw new Error('formula')
    expect(after.content.data.style).toEqual(node.content.data.style)
    expect(applyEditorTransactionStep(test.read(), test.commits[0]!, 'inverse').document).toEqual(project)
  })
  it('edits Flow formula content without replacing the block or formula identity', async () => {
    const project = createBlankFlowCourseProject(), surface = project.surfaces[0]!
    if (surface.type !== 'flow') throw new Error('flow')
    surface.blocks.push({ id: 'formula', type: 'formula', formulaId: 'retained', accessibleText: 'x', ast: { type: 'token', value: 'x' } })
    const test = harness(project), receipt = await test.run(flowAuthoringTool, { operation: 'edit', formula: { ast: { type: 'token', value: 'y' }, accessibleText: 'y' } }, { kind: 'update', target: target(project, 'formula') })
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed')
    const after = test.read().document.surfaces[0]!
    expect(after.type === 'flow' && after.blocks.at(-1)).toEqual({ id: 'formula', type: 'formula', formulaId: 'retained', accessibleText: 'y', ast: { type: 'token', value: 'y' } })
  })
  it.each(['slide', 'flow', 'global'] as const)('edits %s Runtime source and public fields from the actual selected item address without replacing its identity', async owner => {
    const project = owner === 'flow' ? createBlankFlowCourseProject() : createBlankCourseProject()
    const { content: _content, ...wrapper } = text('animation') as Extract<LayerItem, { kind: 'native' }>
    const item: Extract<LayerItem, { kind: 'runtime' }> = { ...wrapper, kind: 'runtime', runtime: {
      protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom',
      source: 'CoursewareRuntime.define({runtimeApiVersion:3,create(){const duration=8000;return {destroy(){}}}})',
      content: { values: { title: '保留文字' }, metadata: { title: { label: '标题', multiline: true } } },
      assets: {}, nodeBindings: {},
      staticFallback: { assetId: 'fallback', coverage: 'surface' },
    } }
    if (owner === 'global') project.globalLayerItems.push({ item, visibility: { mode: 'all', locationIds: [] } })
    else add(project, item)
    project.assets.fallback = { id: 'fallback', kind: 'image', filename: 'fallback.png', path: 'assets/fallback.png', mimeType: 'image/png', byteLength: 4, width: 1, height: 1 }
    const test = harness(project), original = structuredClone(locateCourseLayer(project, item.layerItemId)!.item)
    const destination = { kind: 'update' as const, target: target(project, item.layerItemId) }
    expect(destination.target.authoringAddress).toContain('field=item')
    const source = item.runtime.source.replace('8000', '12000')
    const receipt = await test.run(runtimeSourceTool, { source }, destination)
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed')
    const updated = locateCourseLayer(test.read().document, item.layerItemId)!.item
    expect(updated).toEqual({ ...original, runtime: { ...item.runtime, source } })
    expect(applyEditorTransactionStep(test.read(), test.commits[0]!, 'inverse').document).toEqual(project)
    for (const value of [{ field: 'content', contentKey: 'title', initialValue: '保留文字', value: '新文字' },
      { field: 'enabled', initialValue: true, value: false }] as const) {
      const result = await test.run(runtimeConfigureTool, value, { kind: 'update', target: target(test.read().document, item.layerItemId) })
      expect(result.status, JSON.stringify(result.diagnostics)).toBe('committed')
    }
    const final = locateCourseLayer(test.read().document, item.layerItemId)!.item
    expect(final).toMatchObject({ layerItemId: item.layerItemId, frame: original.frame,
      runtime: { source, enabled: false, content: { values: { title: '新文字' } } } })
    const before = test.read()
    const wrong = { ...target(before.document, item.layerItemId), itemId: 'another-runtime' }
    const rejection = await test.run(runtimeSourceTool, { source }, { kind: 'update', target: wrong })
    expect(rejection.status).toBe('failed'); expect(test.read()).toBe(before)
  })
  it('does not inject Native defaults into a partial style and rejects generic patch fields', () => {
    expect(nativeAuthoringToolInputSchema.parse({ operation: 'edit', textStyle: { fontSize: 32 } })).toEqual({ operation: 'edit', textStyle: { fontSize: 32 } })
    expect(nativeAuthoringToolInputSchema.safeParse({ operation: 'edit', patch: { text: 'x' } }).success).toBe(false)
  })
  it('changes Unicode text and font while reflowing automatic height and retaining position, style, runs and siblings', async () => {
    const project = createBlankCourseProject(); add(project, text('old')); add(project, text('sibling'))
    const original = locateCourseLayer(project, 'old')!.item, test = harness(project)
    const receipt = await test.run(nativeAuthoringTool, { operation: 'edit-text', text: '原😀标题呀', textStyle: { fontSize: 32 } }, { kind: 'update', target: target(project, 'old') })
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed')
    const edited = locateCourseLayer(test.read().document, 'old')!.item
    expect(edited.frame).toEqual({ ...original.frame, height: 48 }); expect(edited.rotation).toBe(17)
    if (edited.kind !== 'native' || edited.content.nativeType !== 'text') throw new Error('Expected text')
    expect(edited.content.data.text).toBe('原😀标题呀'); expect(edited.content.data.style).toMatchObject({ fontSize: 32, bold: true, emphasis: true })
    expect(edited.content.data.runs).toEqual([{ start: 1, end: 2, style: { italic: true } }])
    expect(locateCourseLayer(test.read().document, 'sibling')!.item).toEqual(locateCourseLayer(project, 'sibling')!.item)
    expect(applyEditorTransactionStep(test.read(), test.commits[0]!, 'inverse').document).toEqual(project)
  })
  it('uses effective Native state so a title edit retains that state’s formatting', async () => {
    const project = createBlankCourseProject(); add(project, text('old'))
    const surface = project.surfaces[0]!; if (surface.type !== 'slide') throw new Error('Expected Slide')
    surface.scenes[0]!.presentation = { initialStateId: 'state-a', states: [{ id: 'state-a', name: '强调', layerItemOverrides: { old: { nativeData: { text: '状态😀标题', style: { fontSize: 50 }, runs: [{ start: 0, end: 2, style: { color: '#ff0000' } }] } } } }] }
    const test = harness(project), receipt = await test.run(nativeAuthoringTool, { operation: 'edit', text: '状态😀标题二' }, { kind: 'update', target: target(project, 'old', 'state-a') })
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed')
    expect(locateCourseLayer(test.read().document, 'old')!.item).toEqual(locateCourseLayer(project, 'old')!.item)
    const item = projectEffectiveLayers({ project: test.read().document, locationId: project.startLocationId, stateId: 'state-a' }).unifiedRows.find(row => row.id === 'old')!.item
    if (item.kind !== 'native' || item.content.nativeType !== 'text') throw new Error('Expected text')
    expect(item.content.data).toMatchObject({ text: '状态😀标题二', style: { fontSize: 50 }, runs: [{ start: 0, end: 2, style: { color: '#ff0000' } }] })
  })
  it('changes Flow paragraph text/font without losing wrap, alignment or unrelated fields', async () => {
    const project = createBlankFlowCourseProject(), surface = project.surfaces[0]!
    if (surface.type !== 'flow') throw new Error('Expected Flow')
    const block = { id: 'paragraph', type: 'paragraph' as const, text: '保留😀文字', textAlign: 'right' as const, lineSpacing: 2, runs: [{ start: 0, end: 2, style: { bold: true } }] }
    surface.blocks.push(block)
    const test = harness(project), receipt = await test.run(flowAuthoringTool, { operation: 'edit', text: '保留😀文字增加', textStyle: { fontSize: 24 } }, { kind: 'update', target: target(project, block.id) })
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed')
    const nextSurface = test.read().document.surfaces[0]!; if (nextSurface.type !== 'flow') throw new Error('Expected Flow')
    expect(nextSurface.blocks.at(-1)).toMatchObject({ ...block, text: '保留😀文字增加', runs: [{ start: 0, end: 2, style: { bold: true, fontSize: 24 } }, { start: 2, end: 7, style: { fontSize: 24 } }] })
  })
  it('merges component parameters with the selected state and recursive API 4 copy', async () => {
    const project = createBlankCourseProject(), pkg = createSortComponentPackage(), base = text('component')
    const item: LayerItem = { ...base, kind: 'component', component: { packageId: pkg.manifest.id, version: pkg.manifest.version }, props: { speed: 1, content: { title: '旧', helper: '保留' } } }
    delete (item as unknown as { content?: unknown }).content
    add(project, item); project.componentPackages[pkg.manifest.id] = pkg.metadata
    const surface = project.surfaces[0]!; if (surface.type !== 'slide') throw new Error('Expected Slide')
    surface.scenes[0]!.presentation = { initialStateId: 'a', states: [{ id: 'a', name: '状态', layerItemOverrides: { component: { componentProps: { speed: 2, content: { title: '状态', helper: '保留状态' } } } } }] }
    const test = harness(project, { assetFiles: {}, componentPackages: { [pkg.manifest.id]: pkg } })
    const receipt = await test.run(componentConfigureTool, { props: { content: { title: '新' } } }, { kind: 'update', target: target(project, 'component', 'a') })
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed')
    const current = projectEffectiveLayers({ project: test.read().document, locationId: project.startLocationId, stateId: 'a' }).unifiedRows.find(row => row.id === 'component')!.item
    expect(current.kind === 'component' && current.props).toEqual({ speed: 2, content: { title: '新', helper: '保留状态' } })
    expect(locateCourseLayer(test.read().document, 'component')!.item).toEqual(item)
  })
})

describe('B1 media application expands one intention into one existing transaction', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII='
  const source = { base64: png, filename: 'dog.png', mimeType: 'image/png' }
  function asset(project: CourseProjectDocument, id: string) {
    const bytes = Uint8Array.from(atob(png), character => character.charCodeAt(0))
    project.assets[id] = { id, kind: 'image', filename: `${id}.png`, path: `assets/${id}.png`, mimeType: 'image/png', byteLength: bytes.length, width: 1, height: 1 }
    return bytes
  }
  function fixture(project: CourseProjectDocument, selected: AuthoringToolTargetWireV1, resources: HistoryResourceState = { assetFiles: {}, componentPackages: {} }) {
    const test = harness(project, resources), scopes = captureSelectionReplacementScopes(project, [selected])
    const destination = { kind: 'update' as const, target: selected }, workspace = { version: 1 as const, projectId: project.id, normalizedPath: 'c:/lessons/media.h5lesson' }
    const request = generationRequestSchema.parse({ version: 1, requestId: crypto.randomUUID(), workspace, documentRevision: project.revision, sessionGeneration: 1, purpose: 'local-edit', instruction: '应用小狗图片', destinations: [destination, ...scopes], context: { reference: 'selection', assets: project.assets }, allowedCarriers: ['native'] })
    const candidate: GenerationCandidate = { version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: '应用图片', steps: [{ id: 'apply', tool: 'media.apply', carrier: 'native', destination, input: { kind: 'image', source } }] }
    return { test, request, candidate, coordinator: createGenerationCandidateCoordinator({ ...test.port, readWorkspace: () => workspace, readSessionGeneration: () => 1 }) }
  }
  it('QP02 preserves the public item result after semantic replacement and applies a later edit', async () => {
    const project = createBlankCourseProject(); add(project, sceneNodeToCourseLayerItem(createShapeNode('rectangle', { id: 'shape' })))
    const f = fixture(project, target(project, 'shape'))
    f.candidate.steps.push({ id: 'position', tool: 'native.content', carrier: 'native', destination: { kind: 'created-item', stepId: 'apply', index: 0 }, input: { operation: 'properties', properties: { frame: { x: 123 } } } })
    const prepared = await f.coordinator.prepare(f.request, f.candidate)
    expect(f.coordinator.apply(prepared.previewId).status).toBe('committed')
    const surface = f.test.read().document.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('slide')
    expect(surface.scenes[0]!.layerItems).toContainEqual(expect.objectContaining({ frame: expect.objectContaining({ x: 123 }), content: expect.objectContaining({ nativeType: 'image' }) }))
    expect(f.test.commits).toHaveLength(1)
  })
  it('QP02 rejects an asset result requested as an item at the exact input path with zero live writes', async () => {
    const project = createBlankCourseProject(); add(project, sceneNodeToCourseLayerItem(createShapeNode('rectangle', { id: 'shape' })))
    const f = fixture(project, target(project, 'shape'))
    const resource = f.request.destinations.find(d => d.kind === 'create' && d.scope.owner === 'global')!
    const create = f.request.destinations.find(d => d.kind === 'create' && d.scope.owner === 'scene')!
    f.candidate.steps = [
      { id: 'asset', tool: 'asset.media.import', carrier: 'native', destination: resource, input: { kind: 'image', ...source } },
      { id: 'bad', tool: 'native.content', carrier: 'native', destination: create, input: { operation: 'insert', template: { nativeType: 'image', assetId: { $result: { stepId: 'asset', kind: 'item-id', index: 0 } } } } },
    ]
    await expect(f.coordinator.prepare(f.request, f.candidate)).rejects.toMatchObject({ failure: { stepId: 'bad', diagnostics: [expect.objectContaining({ code: 'invalid-result-reference', path: ['input', 'template', 'assetId'] })], recovery: { action: 'repair-candidate' } } })
    expect(f.test.commits).toHaveLength(0); expect(f.test.read().document).toEqual(project); expect(f.test.read().resources.assetFiles).toEqual({})
  })
  it('uses one strict discovery definition and expands only request-bound image aliases', () => {
    const project = createBlankCourseProject(); asset(project, 'image'); add(project, sceneNodeToCourseLayerItem(createShapeNode('rectangle', { id: 'shape' }), 31))
    const f = fixture(project, target(project, 'shape'))
    const short = { version: 2, requestId: f.request.requestId, summary: '换图', afterCommit: { version: 1, action: 'finish' }, steps: [{ id: 'apply', tool: 'media.apply', destination: 'd1', input: { kind: 'image', source: { $asset: 'a1' } } }] }
    expect(expandGenerationShortCandidate(short, f.request, crypto.randomUUID()).steps[0]!.input).toEqual({ kind: 'image', source: { assetId: 'image' } })
    expect(() => expandGenerationShortCandidate({ ...short, steps: [{ ...short.steps[0], input: { kind: 'image', source: { $asset: 'a2' } } }] }, f.request, crypto.randomUUID())).toThrow('当前请求资产别名')
    expect(generationShortCandidateSchema.safeParse({ ...short, steps: [{ ...short.steps[0], input: { kind: 'image', source: { $candidateFile: 'resources/a.png', unexpected: true } } }] }).success).toBe(false)
    expect(generationMediaApplyWireInputSchema.safeParse({ kind: 'image', source }).success).toBe(false)
    expect(describeGenerationSemanticTools()[0]?.name).toBe('media.apply')
  })
  it.each([createBlankCourseProject, createBlankFlowCourseProject, createBlankSpatialCourseProject])('converts a shape across supported surfaces, preserves its wrapper and undoes the image resource once', async factory => {
    const project = factory(), shape = sceneNodeToCourseLayerItem(createShapeNode('rectangle', { id: 'shape', x: 90, y: 80, width: 410, height: 230, rotation: 27 }), 31)
    shape.opacity = .6; shape.visible = false; add(project, shape); add(project, text('sibling'))
    const f = fixture(project, target(project, shape.layerItemId)), preview = await f.coordinator.prepare(f.request, f.candidate)
    expect(f.test.commits).toHaveLength(0); expect(f.test.read().document).toEqual(project)
    expect(f.coordinator.apply(preview.previewId).status).toBe('committed'); expect(f.test.commits).toHaveLength(1)
    expect(locateCourseLayer(f.test.read().document, 'shape')).toBeNull()
    const created = preview.plannedEffects.find(effect => effect.operation === 'created' && effect.ownerKey === target(project, shape.layerItemId).ownerKey)!
    expect(locateCourseLayer(f.test.read().document, created.id)?.item).toMatchObject({ frame: shape.frame, rotation: 27, opacity: .6, order: shape.order, visible: false, content: { nativeType: 'image', data: { fit: 'contain' } } })
    expect(locateCourseLayer(f.test.read().document, 'sibling')?.item).toEqual(locateCourseLayer(project, 'sibling')?.item)
    const undo = applyEditorTransactionStep(f.test.read(), f.test.commits[0]!, 'inverse')
    expect(undo.document).toEqual(project); expect(undo.resources.assetFiles).toEqual({})
    expect(applyEditorTransactionStep(undo, f.test.commits[0]!, 'forward')).toEqual(f.test.read())
    expect(courseProjectDocumentSchema.parse(f.test.read().document)).toEqual(f.test.read().document)
  })
  it('imports and changes only one shared-image instance, preserving state, crop and unrelated fields', async () => {
    const project = createBlankCourseProject(), bytes = asset(project, 'shared')
    const image = sceneNodeToCourseLayerItem(createImageNode({ id: 'image', assetId: 'shared', width: 400, height: 200 }), 31)
    if (image.kind !== 'native' || image.content.nativeType !== 'image') throw new Error('image')
    image.content.data.crop = { left: .1, top: 0, right: .05, bottom: 0 }; image.content.data.fit = 'cover'; image.content.data.flipX = true
    add(project, image); add(project, { ...structuredClone(image), layerItemId: 'sibling' })
    const surface = project.surfaces[0]!; if (surface.type !== 'slide') throw new Error('slide')
    surface.scenes[0]!.presentation = { initialStateId: 'a', states: [{ id: 'a', name: '讲解', layerItemOverrides: { image: { rotation: 35, nativeData: { cornerRadius: 20 } } } }] }
    const f = fixture(project, target(project, 'image', 'a'), { assetFiles: { shared: bytes }, componentPackages: {} })
    const preview = await f.coordinator.prepare(f.request, f.candidate)
    expect(f.coordinator.apply(preview.previewId).status).toBe('committed')
    expect(locateCourseLayer(f.test.read().document, 'image')!.item).toEqual(image)
    const current = projectEffectiveLayers({ project: f.test.read().document, locationId: project.startLocationId, stateId: 'a' }).unifiedRows.find(row => row.id === 'image')!.item
    expect(current).toMatchObject({ layerItemId: 'image', rotation: 35, content: { data: { crop: image.content.data.crop, fit: 'cover', flipX: true, cornerRadius: 20 } } })
    expect(current.kind === 'native' && current.content.nativeType === 'image' && current.content.data.assetId).not.toBe('shared')
    expect(locateCourseLayer(f.test.read().document, 'sibling')!.item).toEqual(locateCourseLayer(project, 'sibling')!.item)
    expect(f.test.commits).toHaveLength(1)
    expect(Object.keys(f.test.read().resources.assetFiles)).toHaveLength(2)
    expect(applyEditorTransactionStep(f.test.read(), f.test.commits[0]!, 'inverse')).toEqual({ document: project, resources: { assetFiles: { shared: bytes }, componentPackages: {} } })
  })
  it.each(['content', 'edit-image'])('admits the full-candidate import to selected-image %s reference and an additional import', async operation => {
    const project = createBlankCourseProject(), bytes = asset(project, 'old')
    const image = sceneNodeToCourseLayerItem(createImageNode({ id: 'image', assetId: 'old' }), 31)
    if (image.kind !== 'native' || image.content.nativeType !== 'image') throw new Error('image')
    add(project, image)
    const f = fixture(project, target(project, 'image'), { assetFiles: { old: bytes }, componentPackages: {} })
    const global = f.request.destinations.find(entry => entry.kind === 'create' && entry.scope.owner === 'global')!
    f.candidate = generationCandidateSchema.parse({ ...f.candidate, steps: [
      { id: 'import', tool: 'asset.media.import', carrier: 'native', destination: global, input: { kind: 'image', ...source } },
      { id: 'update', tool: 'native.content', carrier: 'native', destination: f.request.destinations[0]!, input: operation === 'content'
        ? { operation, content: { ...image.content, data: { ...image.content.data, assetId: { $result: { stepId: 'import', kind: 'asset-id', index: 0 } } } } }
        : { operation, image: { assetId: { $result: { stepId: 'import', kind: 'asset-id', index: 0 } } } } },
    ] })
    const preview = await f.coordinator.prepare(f.request, f.candidate)
    expect(f.coordinator.apply(preview.previewId).status).toBe('committed'); expect(f.test.commits).toHaveLength(1)
    expect(locateCourseLayer(f.test.read().document, 'image')?.item).toMatchObject({ layerItemId: 'image', frame: image.frame })
    const rejected = fixture(project, target(project, 'image'), { assetFiles: { old: bytes }, componentPackages: {} })
    rejected.candidate.steps = [...f.candidate.steps, { ...f.candidate.steps[0]!, id: 'idle' }]
    const combined = await rejected.coordinator.prepare(rejected.request, rejected.candidate)
    expect(combined.plannedEffects.length).toBeGreaterThan(1)
    expect(rejected.test.commits).toHaveLength(0)
  })
  it('updates a Flow image within a section, preserving body layout and captions', async () => {
    const project = createBlankFlowCourseProject(), bytes = asset(project, 'shared'), surface = project.surfaces[0]!
    if (surface.type !== 'flow') throw new Error('flow')
    const block = { id: 'image', type: 'media' as const, assetId: 'shared', mediaKind: 'image' as const, layout: 'wide' as const, wrap: 'left' as const, caption: '保留说明', altText: '保留替代文字' }
    surface.blocks.push({ id: 'section', type: 'section', title: '图片段落', collapsedByDefault: false, blocks: [block] })
    const f = fixture(project, target(project, 'image'), { assetFiles: { shared: bytes }, componentPackages: {} }), preview = await f.coordinator.prepare(f.request, f.candidate)
    expect(f.coordinator.apply(preview.previewId).status).toBe('committed')
    const after = f.test.read().document.surfaces[0]!
    if (after.type !== 'flow' || after.blocks.at(-1)?.type !== 'section') throw new Error('section')
    const next = after.blocks.at(-1)!; if (next.type !== 'section') throw new Error('section')
    expect(next.blocks[0]).toMatchObject({ ...block, assetId: expect.not.stringMatching(/^shared$/) })
    expect(f.test.commits).toHaveLength(1)
  })
  it('replaces the actual slide-heavy callout only in slide-state-base, with save/reopen and Published state parity', async () => {
    const opened = openCourseProjectArchive(new Uint8Array(readFileSync('tests/fixtures/architecture-baseline/slide-heavy.h5lesson')))
    const project = opened.project, surface = project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('slide')
    const beforeScene = surface.scenes.find(scene => scene.id === 'slide-scene-intro')!, original = beforeScene.layerItems.find(item => item.layerItemId === 'slide-intro-callout')!
    const componentPackages = Object.fromEntries(Object.values(opened.componentFiles).map(files => { const pkg = parseComponentPackageFiles(files); return [pkg.manifest.id, pkg] }))
    const f = fixture(project, target(project, 'slide-intro-callout', 'slide-state-base'), { assetFiles: opened.assetFiles, componentPackages })
    const preview = await f.coordinator.prepare(f.request, f.candidate)
    expect(f.coordinator.apply(preview.previewId).status).toBe('committed'); expect(f.test.commits).toHaveLength(1)
    const afterSurface = f.test.read().document.surfaces[0]!; if (afterSurface.type !== 'slide') throw new Error('slide')
    const scene = afterSurface.scenes.find(scene => scene.id === 'slide-scene-intro')!
    const image = scene.layerItems.find(item => !beforeScene.layerItems.some(old => old.layerItemId === item.layerItemId))!
    expect(image).toMatchObject({ visible: false, frame: original.frame, rotation: original.rotation, opacity: original.opacity, content: { nativeType: 'image' } })
    expect(scene.layerItems.find(item => item.layerItemId === original.layerItemId)).toEqual(original)
    for (const state of beforeScene.presentation!.states) {
      const afterState = scene.presentation!.states.find(current => current.id === state.id)!
      const visibleBefore = materializeCourseSlideLayerItems(beforeScene.layerItems, state).filter(item => item.visible)
      const visibleAfter = materializeCourseSlideLayerItems(scene.layerItems, afterState).filter(item => item.visible)
      if (state.id === 'slide-state-base') {
        expect(visibleAfter.map(item => item.layerItemId)).toEqual(visibleBefore.map(item => item.layerItemId === original.layerItemId ? image.layerItemId : item.layerItemId))
        expect(afterState.layerItemOverrides[original.layerItemId]).toMatchObject({ visible: false })
      } else {
        expect(afterState).toEqual(state)
        expect(visibleAfter).toEqual(visibleBefore)
      }
    }
    expect(scene.interactions).toEqual(beforeScene.interactions)
    expect(afterSurface.scenes.slice(1)).toEqual(surface.scenes.slice(1))
    const saved = createCourseProjectArchive({ project: f.test.read().document, assetFiles: { ...f.test.read().resources.assetFiles }, componentFiles: opened.componentFiles })
    const reopened = openCourseProjectArchive(saved)
    expect(reopened.project).toEqual(f.test.read().document)
    const published = buildPublishedCourseV2Payload({ project: reopened.project, assetFiles: reopened.assetFiles, components: componentPackages })
    const publishedSurface = published.surfaces.find(surface => surface.id === 'slide-surface')!
    if (publishedSurface.type !== 'slide') throw new Error('Published Slide')
    const publishedScene = publishedSurface.scenes.find(scene => scene.id === 'slide-scene-intro')!
    expect(publishedScene.presentation?.states.map(state => ({ id: state.id, overrides: state.layerItemOverrides, order: state.layerItemOrder })))
      .toEqual(scene.presentation?.states.map(state => ({ id: state.id, overrides: state.layerItemOverrides, order: state.layerItemOrder })))
    for (const state of scene.presentation!.states) {
      expect(materializeCourseSlideLayerItems(publishedScene.layerItems, publishedScene.presentation!.states.find(entry => entry.id === state.id)).filter(item => item.visible).map(item => item.layerItemId))
        .toEqual(materializeCourseSlideLayerItems(scene.layerItems, state).filter(item => item.visible).map(item => item.layerItemId))
    }
    const undo = applyEditorTransactionStep(f.test.read(), f.test.commits[0]!, 'inverse')
    expect(undo.document).toEqual(project); expect(undo.resources.assetFiles).toEqual(opened.assetFiles)
    expect(applyEditorTransactionStep(undo, f.test.commits[0]!, 'forward')).toEqual(f.test.read())
  })
  it('migrates state-bounded click references without changing other named-state behavior', async () => {
    const project = createBlankCourseProject(); add(project, sceneNodeToCourseLayerItem(createShapeNode('rectangle', { id: 'shape' }), 31))
    const surface = project.surfaces[0]!; if (surface.type !== 'slide') throw new Error('slide')
    surface.scenes[0]!.presentation = { initialStateId: 'a', states: [{ id: 'a', name: '当前', layerItemOverrides: { shape: { rotation: 25, opacity: .4 } } }, { id: 'b', name: '保留', layerItemOverrides: {} }] }
    surface.scenes[0]!.interactions.push({ id: 'click', enabled: true, trigger: { type: 'node.click', nodeId: 'shape' }, conditions: [{ type: 'presentation.in', stateIds: ['a', 'b'] }], actions: [{ id: 'show', delayMs: 0, start: 'after-previous', action: { type: 'node.exit', nodeId: 'shape', durationMs: 0, effect: 'none', easing: 'linear' } }] })
    const f = fixture(project, target(project, 'shape', 'a')), preview = await f.coordinator.prepare(f.request, f.candidate)
    expect(f.coordinator.apply(preview.previewId).status).toBe('committed')
    const current = f.test.read().document.surfaces[0]!; if (current.type !== 'slide') throw new Error('slide')
    const scene = current.scenes[0]!, created = scene.layerItems.find(item => item.layerItemId !== 'shape')!
    expect(created).toMatchObject({ rotation: 25, opacity: .4, visible: false })
    expect(scene.interactions[0]).toMatchObject({ id: 'click', conditions: [{ type: 'presentation.in', stateIds: ['b'] }], trigger: { nodeId: 'shape' } })
    expect(scene.interactions[1]).toMatchObject({ conditions: [{ type: 'presentation.in', stateIds: ['a'] }], trigger: { nodeId: created.layerItemId }, actions: [{ action: { nodeId: created.layerItemId } }] })
    expect(scene.interactions[1]!.id).not.toBe(scene.interactions[0]!.id)
    expect(scene.interactions[1]!.actions[0]!.id).not.toBe(scene.interactions[0]!.actions[0]!.id)
  })
  it('supports existing-image insertion and formal page background without replacing other objects', async () => {
    const project = createBlankCourseProject(), bytes = asset(project, 'existing'); add(project, text('target'))
    const f = fixture(project, target(project, 'target'), { assetFiles: { existing: bytes }, componentPackages: {} })
    f.request.context = { reference: 'page' }
    const destination = f.request.destinations.find(entry => entry.kind === 'create' && entry.scope.owner === 'scene')!
    f.candidate.steps[0] = { ...f.candidate.steps[0]!, destination, input: { kind: 'image', source: { assetId: 'existing' }, fit: 'cover' } }
    const preview = await f.coordinator.prepare(f.request, f.candidate)
    expect(f.coordinator.apply(preview.previewId).status).toBe('committed')
    expect(preview.plannedEffects).toHaveLength(1)
    expect(locateCourseLayer(f.test.read().document, preview.plannedEffects[0]!.id)?.item).toMatchObject({ content: { nativeType: 'image', data: { fit: 'cover' } } })
    const g = fixture(project, target(project, 'target'), { assetFiles: { existing: bytes }, componentPackages: {} })
    const surface = project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('slide')
    const projection = projectEffectiveLayers({ project, locationId: project.startLocationId })
    g.request = captureGenerationSnapshot({ document: project, workspace: g.request.workspace,
      sessionToken: { locationId: projection.locationId, surfaceType: projection.surfaceType, generation: 1, revision: project.revision },
      projection, selectedIds: ['target'], scope: 'page', instruction: '设置本页图片背景', purpose: 'single-page' })
    const background = g.request.destinations.find(value => value.kind === 'update' && value.target.authoringAddress.endsWith('field=background'))!
    g.candidate.requestId = g.request.requestId
    g.candidate.steps[0] = { ...g.candidate.steps[0]!, destination: background, input: { kind: 'image', source, placement: 'background' } }
    const backgroundPreview = await g.coordinator.prepare(g.request, g.candidate)
    expect(g.coordinator.apply(backgroundPreview.previewId).status).toBe('committed')
    const updated = g.test.read().document.surfaces[0]!
    expect(updated.type === 'slide' && updated.scenes[0]).toMatchObject({ backgroundMode: 'own', backgroundAssetId: expect.any(String), layerItems: surface.scenes[0]!.layerItems })
  })
  it('allows standalone imports but rejects missing snapshot targets, invalid state conversions and missing resources atomically', async () => {
    for (const mode of ['dangling', 'sibling', 'unscoped-state-reference', 'missing-asset', 'missing-bytes'] as const) {
      const project = createBlankCourseProject(); add(project, sceneNodeToCourseLayerItem(createShapeNode('rectangle', { id: 'shape' }), 31)); add(project, text('sibling'))
      const surface = project.surfaces[0]!; if (surface.type !== 'slide') throw new Error('slide')
      if (mode === 'unscoped-state-reference') {
        surface.scenes[0]!.presentation = { initialStateId: 'a', states: [{ id: 'a', name: '继承状态', layerItemOverrides: {} }] }
        surface.scenes[0]!.interactions.push({ id: 'click', enabled: true, trigger: { type: 'node.click', nodeId: 'shape' }, conditions: [], actions: [{ id: 'hide', start: 'after-previous', delayMs: 0, action: { type: 'node.exit', nodeId: 'shape', durationMs: 0, effect: 'none', easing: 'linear' } }] })
      }
      const f = fixture(project, target(project, 'shape', mode === 'unscoped-state-reference' ? 'a' : null))
      if (mode === 'dangling') f.candidate.steps = [{ id: 'unused', tool: 'asset.media.import', carrier: 'native', destination: f.request.destinations.find(entry => entry.kind === 'create' && entry.scope.owner === 'global')!, input: { ...source, kind: 'image' } }]
      if (mode === 'sibling') f.candidate.steps[0]!.destination = { kind: 'update', target: target(project, 'sibling') }
      if (mode === 'missing-asset' || mode === 'missing-bytes') {
        if (mode === 'missing-bytes') asset(project, 'missing')
        f.candidate.steps[0]!.input = { kind: 'image', source: { assetId: 'missing' } }
      }
      if (mode === 'dangling') {
        const prepared = await f.coordinator.prepare(f.request, f.candidate)
        expect(f.coordinator.apply(prepared.previewId).status).toBe('committed')
        expect(f.test.commits).toHaveLength(1); continue
      }
      await expect(f.coordinator.prepare(f.request, f.candidate)).rejects.toThrow()
      expect(f.test.commits).toHaveLength(0); expect(f.test.read().document).toEqual(project); expect(f.test.read().resources.assetFiles).toEqual({})
    }
  })
})

describe('Complete replacement maps formal identities and preserves wrappers', () => {
  it.each([createBlankCourseProject, createBlankFlowCourseProject, createBlankSpatialCourseProject])('retains the exact old wrapper and applicable references across surfaces', async factory => {
    const project = factory(); add(project, text('old')); add(project, text('replacement', '新对象')); add(project, text('sibling'))
    const old = locateCourseLayer(project, 'old')!.item
    old.opacity = 0.7; old.paperSpace = 'paper'; old.visible = false
    const surface = project.surfaces[0]!
    if (surface.type === 'slide') {
      surface.scenes[0]!.interactions.push({ id: 'click', enabled: true, conditions: [], trigger: { type: 'node.click', nodeId: 'old' }, actions: [{ id: 'enter', start: 'after-previous', delayMs: 0, action: { type: 'node.enter', nodeId: 'old', durationMs: 200, easing: 'linear', effect: 'fade' } }] })
      surface.scenes[0]!.presentation = { initialStateId: 'a', states: [{ id: 'a', name: '状态', layerItemOverrides: { old: { rotation: 28, nativeData: { style: { fontSize: 66 } } } }, layerItemOrder: ['old', 'sibling'] }] }
    } else if (surface.type === 'spatial-2d') {
      surface.world.paths = [{ id: 'path', name: '路径', layerItemIds: ['old', 'sibling'] }]
      surface.world.relations = [{ id: 'relation', sourceLayerItemId: 'old', targetLayerItemId: 'sibling', kind: 'arrow' }]
      surface.semanticZoom = [{ id: 'zoom', layerItemIds: ['old'], minZoom: 0, maxZoom: 2, visible: true }]
    }
    const test = harness(project), receipt = await test.run(semanticReplacementTool, { replacementItemId: 'replacement' }, { kind: 'update', target: target(project, 'old') })
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed')
    const result = locateCourseLayer(test.read().document, 'replacement')!
    expect(result.item).toMatchObject({ frame: old.frame, rotation: 17, order: 31, visible: false, opacity: 0.7, paperSpace: 'paper' })
    expect(locateCourseLayer(test.read().document, 'old')).toBeNull()
    const serialized = JSON.stringify(test.read().document)
    expect(serialized).not.toContain('"old"')
    if (surface.type === 'flow') expect(result.scoped).toMatchObject({ visibility: { mode: 'include', locationIds: [project.startLocationId] }, bodyPlane: 'underlay' })
    expect(courseProjectDocumentSchema.parse(test.read().document)).toEqual(test.read().document)
    const undone = applyEditorTransactionStep(test.read(), test.commits[0]!, 'inverse')
    expect(undone.document).toEqual(project)
    expect(applyEditorTransactionStep(undone, test.commits[0]!, 'forward')).toEqual(test.read())
  })
  it('replaces a Flow anchor while preserving the location identity and paragraph ordering', async () => {
    const project = createBlankFlowCourseProject(), surface = project.surfaces[0]!
    if (surface.type !== 'flow') throw new Error('Expected Flow')
    const old = surface.blocks[0]!; surface.blocks.push({ id: 'replacement', type: 'heading', level: 2, text: '新标题' })
    const test = harness(project), receipt = await test.run(semanticReplacementTool, { replacementItemId: 'replacement' }, { kind: 'update', target: target(project, old.id) })
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed')
    expect(test.read().document.startLocationId).toBe(project.startLocationId)
    expect(test.read().document.locations[0]).toMatchObject({ id: project.startLocationId, blockId: 'replacement' })
  })
  it('retains global location visibility, plane and references from another scene', async () => {
    const project = createBlankCourseProject(), old = text('old'), replacement = text('replacement')
    replacement.order = old.order + 1
    project.globalLayerItems.push({ item: old, plane: 'underlay', visibility: { mode: 'include', locationIds: [project.startLocationId] } }, { item: replacement, plane: 'overlay', visibility: { mode: 'all', locationIds: [] } })
    project.globalLayerItems.sort((a, b) => a.item.order - b.item.order)
    const test = harness(project), receipt = await test.run(semanticReplacementTool, { replacementItemId: 'replacement' }, { kind: 'update', target: target(project, 'old') })
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed')
    expect(test.read().document.globalLayerItems.find(entry => entry.item.layerItemId === 'replacement')).toMatchObject({ plane: 'underlay', visibility: { mode: 'include', locationIds: [project.startLocationId] }, item: { order: old.order, frame: old.frame } })
  })
  it('replaces a state-exclusive object while preserving its base visibility and sparse state formatting', async () => {
    const project = createBlankCourseProject(), old = text('old'), replacement = text('replacement')
    old.visible = false; replacement.visible = false; add(project, old); add(project, replacement)
    const surface = project.surfaces[0]!; if (surface.type !== 'slide') throw new Error('Expected Slide')
    surface.scenes[0]!.presentation = { initialStateId: 'a', states: [{ id: 'a', name: '状态 A', layerItemOverrides: { old: { visible: true, frame: { x: 99 }, nativeData: { style: { fontSize: 48 } } }, replacement: { visible: true } } }, { id: 'b', name: '状态 B', layerItemOverrides: {} }] }
    const test = harness(project), receipt = await test.run(semanticReplacementTool, { replacementItemId: 'replacement' }, { kind: 'update', target: target(project, 'old', 'a') })
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed')
    expect(locateCourseLayer(test.read().document, 'replacement')!.item.visible).toBe(false)
    const effective = projectEffectiveLayers({ project: test.read().document, locationId: project.startLocationId, stateId: 'a' }).unifiedRows.find(row => row.id === 'replacement')!.item
    expect(effective.frame.x).toBe(99); expect(effective.visible).toBe(true)
    if (effective.kind !== 'native' || effective.content.nativeType !== 'text') throw new Error('Expected text')
    expect(effective.content.data.style.fontSize).toBe(48)
    expect(projectEffectiveLayers({ project: test.read().document, locationId: project.startLocationId, stateId: 'b' }).unifiedRows.find(row => row.id === 'replacement')!.item.visible).toBe(false)
  })
  it('reports unmappable state content before committing a carrier change', async () => {
    const project = createBlankCourseProject(); add(project, text('old'))
    const item = text('replacement'), replacement: LayerItem = { ...item, kind: 'runtime', runtime: { protocol: 'canvas-runtime', runtimeApiVersion: 2, enabled: false, renderMode: 'dom', source: '', content: { values: {} }, assets: {} } }
    delete (replacement as unknown as { content?: unknown }).content; add(project, replacement)
    const surface = project.surfaces[0]!; if (surface.type !== 'slide') throw new Error('Expected Slide')
    surface.scenes[0]!.presentation = { initialStateId: 'a', states: [{ id: 'a', name: '状态', layerItemOverrides: { old: { nativeData: { text: '状态文字' } } } }] }
    const test = harness(project), receipt = await test.run(semanticReplacementTool, { replacementItemId: 'replacement' }, { kind: 'update', target: target(project, 'old') })
    expect(receipt.status).toBe('failed'); expect(receipt.diagnostics[0]?.code).toBe('replacement-unmappable'); expect(test.commits).toHaveLength(0); expect(test.read().document).toEqual(project)
  })
})

describe('Runtime fallback candidate keeps the imported image and same Runtime in one transaction', () => {
  let desktopDescriptor: PropertyDescriptor | undefined
  beforeEach(() => {
    desktopDescriptor = Object.getOwnPropertyDescriptor(window, 'desktopAPI')
    // This unit tests the transaction/dependency contract. Actual decoding and
    // independent-process admission are covered by the dedicated Electron test.
    Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { dynamicAdmission: vi.fn() } })
  })
  afterEach(() => {
    if (desktopDescriptor) Object.defineProperty(window, 'desktopAPI', desktopDescriptor)
    else Reflect.deleteProperty(window, 'desktopAPI')
  })
  function fixture() {
    const project = createBlankCourseProject(), { content: _content, ...wrapper } = text('fallback-runtime') as Extract<LayerItem, { kind: 'native' }>
    const runtime: Extract<LayerItem, { kind: 'runtime' }> = { ...wrapper, kind: 'runtime', runtime: {
      protocol: 'canvas-runtime', runtimeApiVersion: 2, enabled: true, renderMode: 'dom',
      source: 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}})',
      content: { values: { title: '保留' } }, assets: {}, nodeBindings: {}, staticFallback: { assetId: 'broken', coverage: 'scene' },
    } }
    add(project, runtime)
    project.assets.broken = { id: 'broken', kind: 'image', filename: 'broken.png', path: 'assets/broken.png', mimeType: 'image/png', byteLength: 4, width: 1, height: 1 }
    const resources = { assetFiles: { broken: new Uint8Array([1, 2, 3, 4]) }, componentPackages: {} }
    const test = harness(project, resources), selected = target(project, runtime.layerItemId)
    const destination = { kind: 'update' as const, target: selected }
    const global = captureSelectionReplacementScopes(project, [selected]).find(entry => entry.kind === 'create' && entry.scope.owner === 'global')!
    const workspace = { version: 1 as const, projectId: project.id, normalizedPath: 'c:/lessons/runtime-fallback.h5lesson' }
    const request = generationRequestSchema.parse({ version: 1, requestId: crypto.randomUUID(), workspace, documentRevision: project.revision,
      sessionGeneration: 1, purpose: 'local-edit', instruction: '修复选中 Runtime 的后备图片和源码', destinations: [destination, global], context: { reference: 'selection' }, allowedCarriers: ['native', 'runtime'] })
    const candidate: GenerationCandidate = { version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: '同一 Runtime 修复', steps: [
      { id: 'fallback', tool: 'asset.media.import', carrier: 'native', destination: global,
        input: { kind: 'image', filename: 'fallback.png', mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=' } },
      { id: 'repair', tool: 'runtime.source', carrier: 'runtime', destination,
        input: { source: `${runtime.runtime.source}\n// repaired`, staticFallback: { assetId: { $result: { stepId: 'fallback', kind: 'asset-id', index: 0 } }, coverage: 'scene' } } },
    ] }
    return { project, resources, runtime, test, request, candidate,
      coordinator: createGenerationCandidateCoordinator({ ...test.port, readWorkspace: () => workspace, readSessionGeneration: () => 1 }) }
  }

  it('resolves an imported asset-id into source and fallback with one reversible resource commit', async () => {
    const f = fixture(), preview = await f.coordinator.prepare(f.request, f.candidate)
    expect(f.test.commits).toHaveLength(0); expect(f.test.read()).toEqual({ document: f.project, resources: f.resources })
    const result = f.coordinator.apply(preview.previewId)
    expect(result.status).toBe('committed'); expect(f.test.commits).toHaveLength(1)
    const updated = locateCourseLayer(f.test.read().document, f.runtime.layerItemId)!.item
    if (updated.kind !== 'runtime') throw new Error('Runtime identity was lost')
    const newId = updated.runtime.staticFallback!.assetId
    expect(newId).not.toBe('broken')
    expect(f.test.read().resources.assetFiles[newId]!.length).toBeGreaterThan(4)
    expect(updated).toEqual({ ...f.runtime, runtime: { ...f.runtime.runtime, source: `${f.runtime.runtime.source}\n// repaired`, staticFallback: { assetId: newId, coverage: 'scene' } } })
    const call = vi.mocked(admitDynamicCandidate).mock.calls.at(-1)!
    expect(locateCourseLayer(call[0], f.runtime.layerItemId)!.item).toEqual(updated)
    expect(Array.from(call[1].assetFiles[newId])).toEqual(Array.from(f.test.read().resources.assetFiles[newId]))
    const undone = applyEditorTransactionStep(f.test.read(), f.test.commits[0]!, 'inverse')
    expect(undone).toEqual({ document: f.project, resources: f.resources })
    expect(applyEditorTransactionStep(undone, f.test.commits[0]!, 'forward')).toEqual(f.test.read())
  })

  it('rejects malformed fallback or failed admission and discards late prepared repair with zero live writes', async () => {
    for (const mode of ['malformed', 'admission', 'late'] as const) {
      const f = fixture()
      if (mode === 'malformed') (f.candidate.steps[1]!.input as { staticFallback: Record<string, unknown> }).staticFallback.extra = true
      if (mode === 'admission') vi.mocked(admitDynamicCandidate).mockRejectedValueOnce(new Error('Actual fallback admission rejected'))
      if (mode === 'late') {
        const prepared = await f.coordinator.prepare(f.request, f.candidate)
        f.coordinator.discard(); expect(f.coordinator.apply(prepared.previewId).status).toBe('stale')
      } else await expect(f.coordinator.prepare(f.request, f.candidate)).rejects.toThrow()
      expect(f.test.commits).toHaveLength(0)
      expect(f.test.read()).toEqual({ document: f.project, resources: f.resources })
    }
  })

  it.each(['unused-import', 'forward-reference', 'non-media-reference'] as const)('validates Runtime dependency %s without requiring imports to be consumed', async mode => {
    const f = fixture()
    if (mode === 'unused-import') f.candidate.steps.unshift({ ...structuredClone(f.candidate.steps[0]!), id: 'unused' })
    if (mode === 'forward-reference') f.candidate.steps.reverse()
    if (mode === 'non-media-reference') {
      f.candidate.steps[0] = { ...f.candidate.steps[0]!, tool: 'native.content', input: { operation: 'insert', template: { nativeType: 'text', text: '不得附带创建' } } }
    }
    if (mode === 'unused-import') {
      const prepared = await f.coordinator.prepare(f.request, f.candidate)
      expect(f.coordinator.apply(prepared.previewId).status).toBe('committed'); expect(f.test.commits).toHaveLength(1); return
    }
    await expect(f.coordinator.prepare(f.request, f.candidate)).rejects.toThrow()
    expect(f.test.commits).toHaveLength(0)
    expect(f.test.read()).toEqual({ document: f.project, resources: f.resources })
  })
})

describe('Replacement candidate keeps create and delete in one existing history step', () => {
  function fixture() {
    const project = createBlankCourseProject(); add(project, text('old'))
    const test = harness(project), selected = target(project, 'old'), scopes = captureSelectionReplacementScopes(project, [selected])
    const destination = { kind: 'update' as const, target: selected }, create = scopes.find(entry => entry.kind === 'create' && entry.scope.owner === selected.owner)!
    const workspace = { version: 1 as const, projectId: project.id, normalizedPath: 'c:/lessons/replacement.h5lesson' }
    const request = generationRequestSchema.parse({ version: 1, requestId: crypto.randomUUID(), workspace, documentRevision: project.revision, sessionGeneration: 1, purpose: 'local-edit', instruction: '替换选中标题', destinations: [destination, ...scopes], context: { reference: 'selection' }, allowedCarriers: ['native'] })
    const candidate: GenerationCandidate = { version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: '替换标题', steps: [
      { id: 'new', tool: 'native.content', carrier: 'native', destination: create, input: { operation: 'insert', template: { nativeType: 'text', text: '替换后标题' } } },
      { id: 'replace', tool: 'selection.replace', carrier: 'native', destination, input: { replacementItemId: { $result: { stepId: 'new', kind: 'item-id', index: 0 } } } },
    ] }
    const coordinator = createGenerationCandidateCoordinator({ ...test.port, readWorkspace: () => workspace, readSessionGeneration: () => 1 })
    return { project, test, request, candidate, coordinator }
  }
  it('privately creates, replaces and commits once, then undoes/redoes both', async () => {
    const f = fixture(), preview = await f.coordinator.prepare(f.request, f.candidate)
    expect(f.test.commits).toHaveLength(0); expect(f.test.read().document).toEqual(f.project)
    expect(f.coordinator.apply(preview.previewId).status).toBe('committed'); expect(f.test.commits).toHaveLength(1)
    expect(locateCourseLayer(f.test.read().document, 'old')).toBeNull()
    expect(applyEditorTransactionStep(f.test.read(), f.test.commits[0]!, 'inverse').document).toEqual(f.project)
  })
  it('allows creation alone but rejects guessed replacement identities and failed final steps atomically', async () => {
    for (const mode of ['guess', 'dangling', 'failed-final'] as const) {
      const f = fixture()
      if (mode === 'guess') f.candidate.steps[1]!.input = { replacementItemId: 'old' }
      if (mode === 'dangling') {
        f.candidate.steps.pop()
        const prepared = await f.coordinator.prepare(f.request, f.candidate)
        expect(f.coordinator.apply(prepared.previewId).status).toBe('committed'); expect(f.test.commits).toHaveLength(1); continue
      }
      if (mode === 'failed-final') f.candidate.steps[1]!.input = { replacementItemId: { $result: { stepId: 'new', kind: 'item-id', index: 4 } } }
      await expect(f.coordinator.prepare(f.request, f.candidate)).rejects.toThrow()
      expect(f.test.commits).toHaveLength(0); expect(f.test.read().document).toEqual(f.project)
    }
  })
  it.each(['discuss', 'plan'] as const)('keeps %s intent read-only even when a valid candidate is supplied', async intent => {
    const f = fixture()
    await expect(f.coordinator.prepare({ ...f.request, intent }, f.candidate)).rejects.toThrow('只读')
    expect(f.test.commits).toHaveLength(0)
  })
  it('folds an imported image and full carrier replacement into one resource-aware Undo/Redo', async () => {
    const f = fixture(), global = f.request.destinations.find(entry => entry.kind === 'create' && entry.scope.owner === 'global')!
    const imageBytes = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII='
    f.candidate.steps.unshift({ id: 'asset', tool: 'asset.media.import', carrier: 'native', destination: global, input: { kind: 'image', filename: 'replacement.png', mimeType: 'image/png', base64: imageBytes } })
    f.candidate.steps[1]!.input = { operation: 'insert', template: { nativeType: 'image', assetId: { $result: { stepId: 'asset', kind: 'asset-id', index: 0 } } } }
    const preview = await f.coordinator.prepare(f.request, f.candidate)
    expect(f.test.commits).toHaveLength(0); expect(Object.keys(f.test.read().resources.assetFiles)).toHaveLength(0)
    expect(f.coordinator.apply(preview.previewId).status).toBe('committed'); expect(f.test.commits).toHaveLength(1)
    expect(Object.keys(f.test.read().resources.assetFiles)).toHaveLength(1)
    const created = f.test.commits[0]!.nextDocument.surfaces[0]!
    if (created.type !== 'slide') throw new Error('Expected Slide')
    expect(created.scenes[0]!.layerItems[0]).toMatchObject({ frame: locateCourseLayer(f.project, 'old')!.item.frame, content: { nativeType: 'image' } })
    const undone = applyEditorTransactionStep(f.test.read(), f.test.commits[0]!, 'inverse')
    expect(undone.document).toEqual(f.project); expect(undone.resources.assetFiles).toEqual({})
    expect(applyEditorTransactionStep(undone, f.test.commits[0]!, 'forward')).toEqual(f.test.read())
  })
  it('replaces a paragraph inside a Flow section with a component in that exact parent and one transaction', async () => {
    const project = createBlankFlowCourseProject(), surface = project.surfaces[0]!, pkg = createSortComponentPackage()
    if (surface.type !== 'flow') throw new Error('Expected Flow')
    surface.blocks.push({ id: 'section', type: 'section', title: '嵌套内容', collapsedByDefault: false, blocks: [{ id: 'nested', type: 'paragraph', text: '替换此段落' }] })
    project.componentPackages[pkg.manifest.id] = pkg.metadata
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII='), character => character.charCodeAt(0))
    project.assets.fallback = { id: 'fallback', kind: 'image', filename: 'fallback.png', path: 'assets/fallback.png', mimeType: 'image/png', byteLength: bytes.length, width: 1, height: 1 }
    const test = harness(project, { assetFiles: { fallback: bytes }, componentPackages: { [pkg.manifest.id]: pkg } }), selected = target(project, 'nested')
    const scopes = captureSelectionReplacementScopes(project, [selected]), update = { kind: 'update' as const, target: selected }
    const workspace = { version: 1 as const, projectId: project.id, normalizedPath: 'c:/lessons/nested.h5lesson' }
    const request = generationRequestSchema.parse({ version: 1, requestId: crypto.randomUUID(), workspace, documentRevision: project.revision, sessionGeneration: 1, purpose: 'local-edit', instruction: '把选中段落替换为互动组件', destinations: [update, ...scopes], context: { reference: 'selection' }, allowedCarriers: ['native', 'existing-component'] })
    const candidate: GenerationCandidate = { version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: '替换嵌套正文', steps: [
      { id: 'component', tool: 'component.insert', carrier: 'existing-component', destination: scopes.find(entry => entry.kind === 'create' && entry.scope.parent.kind === 'flow-body')!, input: { operation: 'existing', packageId: pkg.manifest.id, staticFallbackAssetId: 'fallback' } },
      { id: 'replace', tool: 'selection.replace', carrier: 'native', destination: update, input: { replacementItemId: { $result: { stepId: 'component', kind: 'item-id', index: 0 } } } },
    ] }
    const coordinator = createGenerationCandidateCoordinator({ ...test.port, readWorkspace: () => workspace, readSessionGeneration: () => 1 })
    const preview = await coordinator.prepare(request, candidate); expect(test.commits).toHaveLength(0)
    expect(coordinator.apply(preview.previewId).status).toBe('committed'); expect(test.commits).toHaveLength(1)
    const current = test.read().document.surfaces[0]!; if (current.type !== 'flow') throw new Error('Expected Flow')
    const section = current.blocks.find(block => block.id === 'section')!; if (section.type !== 'section') throw new Error('Expected section')
    expect(section.blocks).toHaveLength(1); expect(section.blocks[0]?.type).toBe('component'); expect(section.blocks[0]?.id).not.toBe('nested')
    expect(applyEditorTransactionStep(test.read(), test.commits[0]!, 'inverse').document).toEqual(project)
  })
})


it.each([createBlankCourseProject, createBlankFlowCourseProject, createBlankSpatialCourseProject])('QP01 creates a styled independent shape centered on the current effective anchor (%#)', async factory => {
  const project = factory(), anchor = sceneNodeToCourseLayerItem(createShapeNode('rectangle', { id: 'anchor', x: 40, y: 50, width: 200, height: 160, opacity: 0.7 }))
  add(project, anchor)
  const test = harness(project)
  const updated = await test.run(nativeAuthoringTool, { operation: 'edit-shape', shapeStyle: { fillColor: '#0000ff' }, properties: { frame: { width: 300 } } }, { kind: 'update', target: target(project, 'anchor') })
  expect(updated.status, JSON.stringify(updated.diagnostics)).toBe('committed')
  const { itemId, authoringAddress, ...scope } = target(test.read().document, 'anchor')
  const inserted = await test.run(nativeAuthoringTool, { operation: 'insert', template: { nativeType: 'shape', shapeType: 'ellipse', width: 80, height: 80, style: { fillColor: '#ffff00', borderWidth: 0 }, placement: { kind: 'center', anchorItemId: 'anchor' } } }, { kind: 'create', scope: { ...scope, parent: { kind: 'owner' }, insertion: { kind: 'append' } } })
  expect(inserted.status, JSON.stringify(inserted.diagnostics)).toBe('committed')
  const result = locateCourseLayer(test.read().document, inserted.affected[0]!.id)!.item
  expect(result).toMatchObject({ frame: { x: 150, y: 90, width: 80, height: 80 }, content: { nativeType: 'shape', data: { style: { fillColor: '#ffff00', borderWidth: 0 } } } })
  expect(locateCourseLayer(test.read().document, 'anchor')!.item.opacity).toBe(0.7)
  expect(result.layerItemId).not.toBe('anchor')
})

it('QP05 diagnoses content with a create target before any command and retains repairable path', async () => {
  const project = createBlankCourseProject(), test = harness(project)
  const { itemId, authoringAddress, ...scope } = target(project, 'unused')
  const item = sceneNodeToCourseLayerItem(createShapeNode('rectangle'))
  if (item.kind !== 'native') throw new Error('native')
  const content = item.content
  const result = await test.run(nativeAuthoringTool, { operation: 'content', content }, { kind: 'create', scope: { ...scope, parent: { kind: 'owner' }, insertion: { kind: 'append' } } })
  expect(result.status).toBe('rejected')
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'operation-target-mismatch', path: ['destination', 'kind'] }))
  expect(test.commits).toHaveLength(0)
})


it.each(['formula', 'table', 'chart'] as const)('QP01 complete %s creation applies supplied content instead of keeping a default placeholder', async nativeType => {
  const project = createBlankCourseProject(), test = harness(project)
  const { itemId, authoringAddress, ...scope } = target(project, 'unused')
  const source = nativeType === 'table' ? createTableNode() : nativeType === 'chart' ? createChartNode() : null
  const data = source ? sceneNodeToCourseLayerItem(source) : null
  const fields = nativeType === 'formula' ? { ast: { type: 'token', value: 'y' }, accessibleText: 'y', style: { fontSize: 48 } }
    : data?.kind === 'native' && data.content.nativeType === 'table' ? { ...data.content.data, rows: data.content.data.rows.map((row, i) => ({ ...row, cells: row.cells.map((cell, j) => ({ ...cell, text: `${i}-${j}` })) })) }
    : data?.kind === 'native' && data.content.nativeType === 'chart' ? { ...data.content.data, title: '真实内容', series: data.content.data.series.map(series => ({ ...series, points: series.points.map((point, i) => ({ ...point, value: i + 10 })) })) } : {}
  const result = await test.run(nativeAuthoringTool, { operation: 'insert', template: { nativeType, ...fields } }, { kind: 'create', scope: { ...scope, parent: { kind: 'owner' }, insertion: { kind: 'append' } } })
  expect(result.status, JSON.stringify(result.diagnostics)).toBe('committed')
  const actual = locateCourseLayer(test.read().document, result.affected[0]!.id)!.item
  expect(actual).toMatchObject({ content: { nativeType, data: fields } })
})

it('QP01 composes narrow edit and styled insert in one reversible transaction on a named state', async () => {
  const document = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  add(document, sceneNodeToCourseLayerItem(createShapeNode('rectangle', { id: 'square', x: 20, y: 30, width: 240, height: 240 })))
  const surface = document.surfaces[0]!; if (surface.type !== 'slide') throw new Error('slide')
  surface.scenes[0]!.presentation = { initialStateId: 'a', states: [{ id: 'a', name: '当前', layerItemOverrides: {} }, { id: 'b', name: '其他', layerItemOverrides: {} }] }
  const test = harness(document), workspace = { version: 1 as const, projectId: document.id, normalizedPath: '/mechanism.h5lesson' }
  const request = captureGenerationSnapshot({ document, workspace, projection: projectEffectiveLayers({ project: document, locationId: document.startLocationId, stateId: 'a' }),
    sessionToken: { locationId: document.startLocationId, surfaceType: 'slide', revision: document.revision, generation: 1 }, selectedIds: ['square'], scope: 'selection', instruction: '修改并新增独立图形', purpose: 'local-edit' })
  const update = request.destinations.find(d => d.kind === 'update' && d.target.itemId === 'square' && d.target.stateId === 'a')!
  const create = request.destinations.find(d => d.kind === 'create' && d.scope.owner === 'scene' && d.scope.stateId === 'a' && d.scope.parent.kind === 'owner' && d.scope.insertion.kind === 'append')!
  const coordinator = createGenerationCandidateCoordinator({ ...test.port, readWorkspace: () => workspace, readSessionGeneration: () => 1 })
  const prepared = await coordinator.prepare(request, { version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: '修改并新增', steps: [
    { id: 'edit', tool: 'native.content', carrier: 'native', destination: update, input: { operation: 'edit-shape', shapeStyle: { fillColor: '#00ff00' } } },
    { id: 'insert', tool: 'native.content', carrier: 'native', destination: create, input: { operation: 'insert', template: { nativeType: 'shape', shapeType: 'ellipse', width: 120, height: 120, style: { fillColor: '#ffff00' }, placement: { kind: 'center', anchorItemId: 'square' } } } },
  ] })
  expect(test.commits).toHaveLength(0)
  expect(coordinator.apply(prepared.previewId).status).toBe('committed')
  expect(test.commits).toHaveLength(1)
  const current = projectEffectiveLayers({ project: test.read().document, locationId: document.startLocationId, stateId: 'a' }).unifiedRows
  expect(current.find(row => row.id === 'square')!.item).toMatchObject({ content: { data: { style: { fillColor: '#00ff00' } } } })
  expect(current.filter(row => row.id !== 'square').map(row => row.item)).toContainEqual(expect.objectContaining({ frame: expect.objectContaining({ x: 80, y: 90, width: 120, height: 120 }) }))
  expect(applyEditorTransactionStep(test.read(), test.commits[0]!, 'inverse').document).toEqual(document)
})
