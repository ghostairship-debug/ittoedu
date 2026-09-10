// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { captureGenerationSnapshot, type GenerationReferenceScope } from '@/renderer/authoring/generation/generationSnapshot'
import { generationCapabilityContext } from '@/renderer/authoring/generation/generationCapabilities'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createImageNode, createTextNode } from '@/renderer/project/nativeNodeFactories'
import { createSortComponentPackage } from '@/renderer/recipes/sort-component/package'
import { parseComponentPackageFiles } from '@/renderer/components/importComponentPackage'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import type { ComponentLayerItem, CourseProjectDocument } from '@/shared/courseProjectTypes'

function snapshot(document: CourseProjectDocument, selectedIds: string[], scope: GenerationReferenceScope = 'page', componentPackages = {}, stateId: string | null = null) {
  const projection = projectEffectiveLayers({ project: document, locationId: document.startLocationId, stateId })
  return captureGenerationSnapshot({ document, workspace: { version: 1, projectId: document.id, normalizedPath: '/focus.h5lesson' },
    sessionToken: { locationId: document.startLocationId, surfaceType: projection.surfaceType, revision: document.revision, generation: 1 },
    projection, selectedIds, scope, instruction: '调整所选对象', purpose: 'local-edit', componentPackages })
}

describe('selection focus in whole-page generation snapshots', () => {
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
    expect(context.capabilities.deferred.map((value: any) => `${value.id}:${value.operation}`)).toContain('native.content:edit')
    expect(context.pages.map((page: any) => page.location.id)).toEqual(document.locations.map(location => location.id))
    expect(context.pages[0].items.map((row: any) => row.item.layerItemId)).toEqual(['first-text', 'focus-image'])
    expect(context.pages[1].items[0].item.content.data.text).toBe('其他页')
    expect(focused.destinations).toEqual(noFocus.destinations)
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
      { block: { type: 'paragraph', text: '正文' }, selected: false },
      { block: { type: 'media', mediaKind: 'image', assetId: 'red' }, selected: true },
    ] }], 'local-edit')
    expect(flow.cards[0]!.entry.id).toBe('asset.image.transform')
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
    expect((local.context as any).componentSources[0].editTargets.instance.map((value: any) => value.target.itemId)).toEqual(['selected'])
    surface.scenes[0]!.presentation = { initialStateId: 'named', states: [{ id: 'named', name: '命名状态', layerItemOverrides: {} }] }
    const named = snapshot(document, ['selected'], 'selection', { [pkg.manifest.id]: pkg }, 'named')
    expect((named.context as any).componentSources[0].editTargets.instance[0]).toMatchObject({
      target: { stateId: 'named' }, sourcePatch: { status: 'unavailable', reason: 'named-state-package-rebind-unsupported' },
    })
  })
})
