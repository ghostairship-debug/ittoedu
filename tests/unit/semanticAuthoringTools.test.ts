import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import { createTextNode } from '@/renderer/project/nativeNodeFactories'
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
import { generationRequestSchema, type GenerationCandidate } from '@/shared/generationContract'
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
    const receipt = await test.run(nativeAuthoringTool, { operation: 'edit', text: '原😀标题呀', textStyle: { fontSize: 32 } }, { kind: 'update', target: target(project, 'old') })
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
      { id: 'repair', tool: 'runtime.source', carrier: 'runtime', destination, lowerCarrierReason: '修复当前 Runtime 的源码与后备，不替换实例',
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

  it.each(['unused-import', 'forward-reference', 'non-media-reference'] as const)('rejects %s in a selected Runtime fallback dependency with zero live writes', async mode => {
    const f = fixture()
    if (mode === 'unused-import') f.candidate.steps.unshift({ ...structuredClone(f.candidate.steps[0]!), id: 'unused' })
    if (mode === 'forward-reference') f.candidate.steps.reverse()
    if (mode === 'non-media-reference') {
      f.candidate.steps[0] = { ...f.candidate.steps[0]!, tool: 'native.content', input: { operation: 'insert', template: { nativeType: 'text', text: '不得附带创建' } } }
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
  it('rejects guessed identities, dangling creations and failed last steps with zero live writes', async () => {
    for (const mode of ['guess', 'dangling', 'failed-final'] as const) {
      const f = fixture()
      if (mode === 'guess') f.candidate.steps[1]!.input = { replacementItemId: 'old' }
      if (mode === 'dangling') f.candidate.steps.pop()
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
      { id: 'component', tool: 'component.insert', carrier: 'existing-component', lowerCarrierReason: '需要已有组件提供拖拽分类互动', destination: scopes.find(entry => entry.kind === 'create' && entry.scope.parent.kind === 'flow-body')!, input: { operation: 'existing', packageId: pkg.manifest.id, staticFallbackAssetId: 'fallback' } },
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
