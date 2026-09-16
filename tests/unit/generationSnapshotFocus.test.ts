import { captureGenerationFixture as captureGenerationSnapshot } from '../fixtures/generationSnapshot'
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { type GenerationReferenceScope } from '@/renderer/authoring/generation/generationSnapshot'
import { generationCapabilityContext } from '@/renderer/authoring/generation/generationCapabilities'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createImageNode, createTextNode } from '@/renderer/project/nativeNodeFactories'
import { createSortComponentPackage } from '@/renderer/recipes/sort-component/package'
import { parseComponentPackageFiles } from '@/renderer/components/importComponentPackage'
import { withDefaultComponentController } from '@/renderer/components/teacherControllerComponent'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import type { ComponentLayerItem, CourseProjectDocument } from '@/shared/courseProjectTypes'
import { addCourseFlowPage } from '@/renderer/course/courseLocationCommands'
import { generationNavigationContext } from '@/renderer/authoring/generation/generationNavigationContext'
import { generationInitialRequestForPrompt } from '../../src/main/localAgent/profile'

function snapshot(document: CourseProjectDocument, selectedIds: string[], scope: GenerationReferenceScope = 'page', componentPackages = {}, stateId: string | null = null) {
  const projection = projectEffectiveLayers({ project: document, locationId: document.startLocationId, stateId })
  return captureGenerationSnapshot({ document, workspace: { version: 1, projectId: document.id, normalizedPath: '/focus.h5lesson' },
    sessionToken: { locationId: document.startLocationId, surfaceType: projection.surfaceType, revision: document.revision, generation: 1 },
    projection, selectedIds, scope, instruction: '调整所选对象', purpose: 'local-edit', componentPackages })
}

describe('selection focus in whole-page generation snapshots', () => {
  it('provides current navigation targets for unchanged buttons across every presentation state', () => {
    const initial = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    const result = addCourseFlowPage(initial, { expectedRevision: initial.revision, now: '2026-09-16T12:00:00.000Z' })
    if (!result.ok) throw new Error(result.reason)
    const project = result.project
    const slide = project.surfaces.find(surface => surface.type === 'slide')!
    const scene = slide.scenes[0]!
    scene.presentation = { initialStateId: 'predict', states: [
      { id: 'predict', name: '先预测', layerItemOverrides: {} },
      { id: 'closed', name: '闭合开关', layerItemOverrides: {} },
      { id: 'observed', name: '观察解释', layerItemOverrides: {} },
    ] }
    scene.layerItems.push(sceneNodeToCourseLayerItem(createTextNode({ id: 'record-button', text: '进入记录' }), 0))
    scene.interactions = [{ id: 'record-rule', name: '进入记录', enabled: true,
      trigger: { type: 'node.click', nodeId: 'record-button' }, conditions: [],
      actions: [{ id: 'record-action', start: 'after-previous', delayMs: 0, action: { type: 'step.next' } }] }]
    const baseline = structuredClone(project)
    const flowId = project.locations.find(location => location.kind === 'flow-block')!.id
    const navigation = (snapshot(project, ['record-button'], 'selection').context as any).navigation
    expect(navigation.current.nextStep).toMatchObject({ locationId: project.startLocationId, stateId: 'closed', surfaceType: 'slide' })
    expect(navigation.current.nextScene).toMatchObject({ locationId: flowId, stateId: null, surfaceType: 'flow' })
    expect(navigation.states.map((state: any) => state.nextStep.locationId)).toEqual([project.startLocationId, project.startLocationId, flowId])
    expect(navigation.states.every((state: any) => state.nextScene.locationId === flowId)).toBe(true)
    expect(navigation.rules[0]).toMatchObject({ ruleId: 'record-rule', actions: [{ action: { type: 'step.next' } }] })
    const wire = generationInitialRequestForPrompt(snapshot(project, ['record-button'], 'selection'))
    expect((wire.context as any).navigation.current).toEqual(navigation.current)
    expect((wire.context as any).navigation.states).toBeUndefined()
    expect(wire.requestDetails.fields).toContain('context.navigation')
    const afterOperation = generationNavigationContext(project, project.startLocationId, 'closed')
    expect(afterOperation.current.nextStep?.stateId).toBe('observed')
    expect(afterOperation.current.previousStep?.stateId).toBe('predict')
    expect(generationNavigationContext(project, flowId, null).current.previousStep).toMatchObject({ locationId: project.startLocationId, stateId: 'observed' })
    expect(generationNavigationContext(project, flowId, null).current.previousScene).toMatchObject({ locationId: project.startLocationId, stateId: 'predict' })
    expect(generationNavigationContext(project, flowId, null).current.nextScene).toBeNull()
    expect(project).toEqual(baseline)
  })

  it('describes one global source target once across twenty locations', () => {
    const { project, componentPackages } = withDefaultComponentController(createBlankCourseProject())
    const surface = project.surfaces[0]
    if (surface.type !== 'slide') throw new Error('Slide required')
    const scene = surface.scenes[0], location = project.locations[0]
    surface.scenes = Array.from({ length: 20 }, (_, index) => ({ ...structuredClone(scene), id: `scene-${index}` }))
    project.locations = surface.scenes.map(scene => ({ ...location, id: scene.id, sceneId: scene.id }))
    project.startLocationId = project.locations[0].id
    const id = project.globalLayerItems[0].item.layerItemId
    const request = snapshot(project, [id], 'selection', componentPackages)
    expect((request.context as any).componentSources[0].editTargets.instance).toHaveLength(1)
  })
  it('observes a newly inserted Flow component without expanding feedback to its existing shared package source', () => {
    const document = createBlankFlowCourseProject(), pkg = createSortComponentPackage()
    document.componentPackages[pkg.manifest.id] = pkg.metadata
    const before = snapshot(document, [], 'page', { [pkg.manifest.id]: pkg })
    const flow = document.surfaces.find(surface => surface.type === 'flow')!
    flow.blocks.push({ type: 'component', id: 'created-sort', component: { packageId: pkg.manifest.id, version: pkg.manifest.version }, props: {}, staticFallbackAssetId: 'fallback' })
    flow.blocks.push({ type: 'heading', id: 'created-heading', level: 2, content: { inlines: [{ type: 'text', text: '观察步骤' }] } })
    document.locations.push({ id: 'created-heading', label: '观察步骤', kind: 'flow-block', blockId: 'created-heading', surfaceId: flow.id })
    document.revision++
    const projection = projectEffectiveLayers({ project: document, locationId: document.startLocationId })
    const next = captureGenerationSnapshot({ document, workspace: before.workspace, projection, selectedIds: ['created-sort'], scope: 'page',
      sessionToken: { locationId: document.startLocationId, surfaceType: 'flow', revision: document.revision, generation: 2 },
      additionalLocationIds: ['created-heading'],
      sharedComponentSourceAddresses: before.destinations.flatMap(destination => destination.kind === 'update' ? [destination.target.authoringAddress] : []),
      instruction: before.instruction, purpose: before.purpose, componentPackages: { [pkg.manifest.id]: pkg } })
    const source = (next.context as any).componentSources.find((source: { packageId: string }) => source.packageId === pkg.manifest.id)
    expect(source.editTargets.shared).toEqual({ status: 'unavailable', reason: 'outside-original-task-scope' })
    expect(source.editTargets.instance[0].target.itemId).toBe('created-sort')
    expect(next.destinations.some(destination => destination.kind === 'update' && destination.target.itemId === pkg.manifest.id)).toBe(false)
    expect(next.destinations.some(destination => destination.kind === 'update' && destination.target.itemId === 'created-sort')).toBe(true)
    expect(source.files['runtime.js']).toBeDefined()
    const stable = (destination: typeof before.destinations[number]) => {
      const { documentRevision: _revision, sessionGeneration: _generation, revisionPolicy: _policy, ...identity } = destination.kind === 'update' ? destination.target : destination.scope
      return JSON.stringify({ kind: destination.kind, ...identity })
    }
    const allowed = new Set(before.destinations.map(stable))
    expect(next.destinations.every(destination => allowed.has(stable(destination)) || destination.kind === 'update' && ['created-heading', 'created-sort'].includes(destination.target.itemId))).toBe(true)
  })

  it('includes Flow layout and coordinate semantics while retaining missing-mode reading compatibility', () => {
    const project = createBlankFlowCourseProject()
    const surface = project.surfaces.find(surface => surface.type === 'flow')!
    const current = snapshot(project, []).context as any
    expect(current.pages[0].layout.widthMode).toBe('fluid')
    expect(current.pages[0].coordinates.paper).toContain('does not reserve space')
    delete surface.layout.widthMode
    expect((snapshot(project, []).context as any).pages[0].layout.widthMode).toBe('reading')
    expect(surface.layout.widthMode).toBeUndefined()
  })
  it('expands the selected image transform before earlier text without narrowing page/course relationships or frozen targets', () => {
    const document = createBlankCourseProject({ includeDefaultController: false, controls: 'none' }), second = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    const firstSurface = document.surfaces[0]!, secondSurface = second.surfaces[0]!
    if (firstSurface.type !== 'slide' || secondSurface.type !== 'slide') throw new Error('Slide required')
    firstSurface.scenes[0]!.layerItems.push(sceneNodeToCourseLayerItem(createTextNode({ id: 'first-text', text: '先排的正文' }), 0),
      sceneNodeToCourseLayerItem(createImageNode({ id: 'focus-image', assetId: 'red' }), 1))
    secondSurface.scenes[0]!.layerItems.push(sceneNodeToCourseLayerItem(createTextNode({ id: 'other-page', text: '其他页' }), 0))
    document.surfaces.push(...second.surfaces); document.locations.push(...second.locations)
    const noFocus = snapshot(document, [], 'course'), focused = snapshot(document, ['focus-image'], 'course')
    const context = focused.context as any
    expect(context.capabilities.cards[0].entry.id).toBe('asset.image.transform')
    expect(context.capabilities.cards[0].content.inputSchema).toBeDefined()
    expect(context.capabilities.deferred.map((value: any) => `${value.id}:${value.operation}`)).toContain('native.content:edit-text')
    expect(context.pages.map((page: any) => page.location.id)).toEqual(document.locations.map(location => location.id))
    expect(context.pages[0].items.map((row: any) => row.item.layerItemId)).toEqual(['first-text', 'focus-image'])
    expect(context.pages[1].items[0].item.content.data.text).toBe('其他页')
    expect(new Set(focused.destinations.map(d => JSON.stringify(d)))).toEqual(new Set(noFocus.destinations.map(d => JSON.stringify(d))))
    expect(context.pages[0].items.map((row: any) => row.selected)).toEqual([false, true])
  })

  it('uses text focus and Flow image focus before unrelated earlier siblings', () => {
    const page = { surfaceType: 'slide', items: [
      { item: { kind: 'native', content: { nativeType: 'image' } }, selected: false },
      { item: { kind: 'native', content: { nativeType: 'text' } }, selected: true },
    ] }
    const context = generationCapabilityContext([page], 'local-edit')
    expect(context.cards[0]!.entry.id).toBe('native.content')
    expect(JSON.stringify(context.cards[0])).toContain('textStyle')
    const flow = generationCapabilityContext([{ surfaceType: 'flow', blocks: [
      { block: { type: 'paragraph', content: { inlines: [{ type: 'text', text: '正文' }] } }, selected: false },
      { block: { type: 'media', mediaKind: 'image', assetId: 'red' }, selected: true },
    ] }], 'local-edit')
    expect(flow.cards[0]!.entry.id).toBe('asset.image.transform')
  })

  it('recommends formal Slide create entries for allowed extension carriers, never navigation or illegal carrier targets', () => {
    const document = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    const request = snapshot(document, [], 'page')
    const recommendations = (request.context as any).capabilities.createRecommendations
    const find = (carrier: string) => recommendations.find((entry: any) => entry.query.surface === 'slide'
      && entry.query.owner === 'scene' && entry.query.carrier === carrier)
    expect(find('generated-component').entries.map((entry: any) => entry.id)).toEqual(['component.insert'])
    expect(find('runtime').entries.map((entry: any) => entry.id)).toEqual(['runtime.insert'])
    expect(recommendations.some((entry: any) => entry.destinationIndexes.some((index: number) => {
      const destination = request.destinations[index]
      return destination.kind === 'create' && destination.scope.parent.kind === 'course-locations'
    }))).toBe(false)

    const world = structuredClone(request.destinations.find(destination => destination.kind === 'create' && destination.scope.parent.kind === 'owner')!)
    if (world.kind !== 'create') throw new Error('Create destination required')
    world.scope.surfaceType = 'spatial-2d'; world.scope.owner = 'world'
    const rejected = generationCapabilityContext([], 'whole-course', undefined, '', { destinations: [world], allowedCarriers: ['runtime'] })
    expect(rejected.createRecommendations).toEqual([])
    expect(generationCapabilityContext([], 'local-edit', undefined, '', {
      destinations: request.destinations.filter(destination => destination.kind !== 'create'),
      allowedCarriers: request.allowedCarriers,
    }).createRecommendations).toEqual([])
    expect(generationCapabilityContext([], 'local-edit', undefined, '', {
      destinations: request.destinations, allowedCarriers: ['native'],
    }).createRecommendations).toEqual([])
  })

  it('offers exact local source targets and an explicitly shared target without forcing complete-file shared revision', () => {
    const document = createBlankCourseProject({ includeDefaultController: false, controls: 'none' }), original = createSortComponentPackage()
    const pkg = parseComponentPackageFiles(original.files), surface = document.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('Slide required')
    document.componentPackages[pkg.manifest.id] = pkg.metadata
    const instance = (id: string, order: number, locked = false): ComponentLayerItem => ({ kind: 'component', layerItemId: id, label: id,
      order, frame: { mode: 'absolute', x: 50, y: 60, width: 400, height: 300 }, visible: true, locked, rotation: 0, opacity: 1,
      hitPolicy: 'auto', playbackInitialVisibility: 'inherit', component: { packageId: pkg.manifest.id, version: pkg.manifest.version }, props: {} })
    surface.scenes[0]!.layerItems.push(instance('selected', 0), instance('other', 1), instance('locked', 2, true))
    const request = snapshot(document, ['selected'], 'page', { [pkg.manifest.id]: pkg }), source = (request.context as any).componentSources[0]
    expect(source.editTargets.instance.map((value: any) => [value.target.itemId, value.selected, value.sourcePatch.status])).toEqual([
      ['selected', true, 'available'], ['other', false, 'available'], ['locked', false, 'unavailable'],
    ])
    expect(source.editTargets.instance[2].sourcePatch.reason).toBe('instance-locked')
    for (const instance of source.editTargets.instance) expect(request.destinations).toContainEqual({ kind: 'update', target: instance.target })
    expect(source.editTargets.shared).toEqual({ target: source.target, affects: 'all-package-instances', requiresExplicitSharedScope: true })
    expect(source.target).toMatchObject({ owner: 'global', itemId: pkg.manifest.id, documentRevision: document.revision })
    expect(source).not.toHaveProperty('sharedEdit')
    expect(source.editInstruction).toContain('operation patch')
    expect(source.editInstruction).toContain('changedFiles')
    expect(source.editInstruction).toContain('mode:instance')
    expect(source.editInstruction).not.toContain('Return complete files including unchanged files')
    const local = snapshot(document, ['selected'], 'selection', { [pkg.manifest.id]: pkg })
    expect((local.context as any).componentSources[0].editTargets.instance.map((value: any) => value.target.itemId)).toEqual(['selected', 'other', 'locked'])
    surface.scenes[0]!.presentation = { initialStateId: 'named', states: [{ id: 'named', name: '命名状态', layerItemOverrides: {} }] }
    const named = snapshot(document, ['selected'], 'selection', { [pkg.manifest.id]: pkg }, 'named')
    expect((named.context as any).componentSources[0].editTargets.instance[0]).toMatchObject({
      target: { stateId: 'named' }, sourcePatch: { status: 'unavailable', reason: 'named-state-package-rebind-unsupported' },
    })
  })
})
