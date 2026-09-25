import { createArchiveFixture as createCourseProjectArchive } from '../fixtures/teacherController'
import { captureGenerationFixture as captureGenerationSnapshot } from '../fixtures/generationSnapshot'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { resolveGenerationReferenceScope, type GenerationReferenceScope } from '@/renderer/authoring/generation/generationSnapshot'
import { resolveBackgroundTarget, backgroundSupportedScopes } from '@/renderer/authoring/tools/backgroundTool'
import { describeAuthoringToolDiscovery } from '@/renderer/authoring/tools/authoringToolFacade'
import { createGenerationCandidateCoordinator } from '@/renderer/authoring/generation/prepareGenerationCandidate'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { applyEditorTransactionStep, type EditorTransactionStep } from '@/renderer/authoring/editorTransaction'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import type { GenerationCandidate, GenerationRequest } from '@/shared/generationContract'
import type { HistoryResourceState } from '@/renderer/store/courseResourceState'

// Unit carrier substitutes the browser decoder only; snapshot, candidate,
// formal commands, document/resource transaction and archive are real.
vi.mock('@/renderer/project/assetManager', async original => ({ ...await original<typeof import('@/renderer/project/assetManager')>(), readImageDimensions: vi.fn(async () => ({ width: 1, height: 1 })) }))
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII='
const source = { base64: png, filename: 'dog.png', mimeType: 'image/png' }
function snapshot(document: CourseProjectDocument, scope: GenerationReferenceScope = 'page', stateId: string | null = null, locationId = document.startLocationId) {
  const projection = projectEffectiveLayers({ project: document, locationId, stateId })
  return captureGenerationSnapshot({ document, workspace: { version: 1, projectId: document.id, normalizedPath: '/background.h5lesson' },
    projection, sessionToken: { locationId, surfaceType: projection.surfaceType, revision: document.revision, generation: 7 },
    scope, selectedIds: [], instruction: '帮我在本页插入一个卡通小狗的图片作为背景', purpose: 'single-page' })
}
function backgrounds(request: GenerationRequest) {
  return request.destinations.filter(value => value.kind === 'update' && value.target.authoringAddress.endsWith('field=background'))
}
function harness(document: CourseProjectDocument, resources: HistoryResourceState = { assetFiles: {}, componentPackages: {} }) {
  let state = { document, resources }
  const commits: EditorTransactionStep[] = [], workspace = { version: 1 as const, projectId: document.id, normalizedPath: '/background.h5lesson' }
  const coordinator = createGenerationCandidateCoordinator({ readDocument: () => state.document, readResources: () => state.resources,
    readSessionGeneration: () => 7, readWorkspace: () => workspace,
    commit(step) { state = applyEditorTransactionStep(state, step, 'forward'); commits.push(step); return true } })
  return { coordinator, commits, read: () => state, async apply(request: GenerationRequest, steps: GenerationCandidate['steps']) {
    const preview = await coordinator.prepare(request, { version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: '设置背景', steps })
    expect((await coordinator.apply(preview.previewId)).status).toBe('committed')
  } }
}

describe('D10 / I05 formal background entry from captured destinations', () => {
  it('keeps the selected focus for page-background requests without treating focus as a write boundary', () => {
    for (const instruction of ['帮我在本页插入一个卡通小狗的图片作为背景', '把当前页面背景改成蓝色', 'Set the background of this page']) {
      expect(resolveGenerationReferenceScope({ instruction, scope: 'selection' })).toBe('selection')
      expect(resolveGenerationReferenceScope({ instruction, scope: 'selection', scopeExplicit: true })).toBe('selection')
    }
    expect(resolveGenerationReferenceScope({ instruction: '把选中的图片背景改成蓝色', scope: 'selection' })).toBe('selection')
    expect(resolveGenerationReferenceScope({ instruction: '把本页选中的图片背景改成蓝色', scope: 'selection' })).toBe('selection')
    expect(resolveGenerationReferenceScope({ instruction: '修改背景', scope: 'selection' })).toBe('selection')
    expect(resolveGenerationReferenceScope({ instruction: '设置本页背景', scope: 'course', scopeExplicit: true })).toBe('course')
  })

  it.each([createBlankCourseProject, createBlankFlowCourseProject, createBlankSpatialCourseProject])('captures legal page backgrounds and imports an image in one reversible transaction (%#)', async factory => {
    const document = factory(), request = snapshot(document), targets = backgrounds(request), test = harness(document)
    expect(targets.length).toBeGreaterThan(1)
    const target = targets[0]!, before = resolveBackgroundTarget(document, target)
    expect(before.target.owner).toBe(document.surfaces[0]!.type === 'slide' ? 'scene' : 'surface')
    const tools = (request.context as any).capabilities.toolIds
    expect(tools).toEqual(expect.arrayContaining(['media.apply', 'owner.background', 'asset.media.import']))
    await test.apply(request, [{ id: 'background', tool: 'media.apply', carrier: 'native', destination: target,
      input: { kind: 'image', source, placement: 'background' } }])
    expect(test.commits).toHaveLength(1)
    const after = resolveBackgroundTarget(test.read().document, backgrounds(snapshot(test.read().document))[0]!)
    expect(after.fields.backgroundColor).toBe(before.fields.backgroundColor)
    expect(after.effective.assetId).toEqual(expect.any(String))
    expect(test.read().resources.assetFiles[after.effective.assetId!]).toEqual(Uint8Array.from(atob(png), value => value.charCodeAt(0)))
    const undo = applyEditorTransactionStep(test.read(), test.commits[0]!, 'inverse')
    expect(undo).toEqual({ document, resources: { assetFiles: {}, componentPackages: {} } })
    expect(applyEditorTransactionStep(undo, test.commits[0]!, 'forward')).toEqual(test.read())
    const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: test.read().document, assetFiles: test.read().resources.assetFiles, componentFiles: {} }))
    expect(reopened.project).toEqual(test.read().document)
    expect(reopened.assetFiles).toEqual(test.read().resources.assetFiles)
  })

  it('exposes Course, Surface, Scene and named-state backgrounds with their real inheritance', async () => {
    const document = createBlankCourseProject(), surface = document.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('Slide')
    document.backgroundColor = '#112233'
    surface.backgroundMode = 'inherit'
    const scene = surface.scenes[0]!
    scene.backgroundMode = 'inherit'
    scene.presentation = { initialStateId: 'named', states: [{ id: 'named', name: '状态', layerItemOverrides: {} }] }
    const request = snapshot(document, 'course', 'named'), targets = backgrounds(request)
    expect(targets).toHaveLength(4)
    expect(targets.map(target => resolveBackgroundTarget(document, target).effective.color)).toEqual(Array(4).fill('#112233'))
    expect(targets.map(target => resolveBackgroundTarget(document, target).supportsMode)).toEqual([false, true, true, false])
    expect(describeAuthoringToolDiscovery().find(tool => tool.name === 'owner.background')!.supportedScopes).toEqual([...backgroundSupportedScopes])
    const test = harness(document), page = backgrounds(snapshot(document, 'page', 'named'))[0]!
    await test.apply(snapshot(document, 'page', 'named'), [{ id: 'background', tool: 'media.apply', carrier: 'native', destination: page,
      input: { kind: 'image', source, placement: 'background' } }])
    const afterSurface = test.read().document.surfaces[0]!
    if (afterSurface.type !== 'slide') throw new Error('Slide')
    expect(afterSurface.scenes[0]!.backgroundMode).toBe('inherit')
    expect(afterSurface.scenes[0]!.presentation!.states[0]!).not.toHaveProperty('backgroundMode')
    expect(afterSurface.scenes[0]!.presentation!.states[0]!.backgroundAssetId).toEqual(expect.any(String))
    expect(afterSurface.scenes[0]!.backgroundAssetId).toBe(scene.backgroundAssetId)
  })

  it('updates color, inherit/own and removes only the image using each supported formal owner', async () => {
    for (const factory of [createBlankCourseProject, createBlankFlowCourseProject, createBlankSpatialCourseProject]) {
      const document = factory()
      for (const index of backgrounds(snapshot(document, 'course')).keys()) {
        const test = harness(document)
        const request = snapshot(document, 'course'), target = backgrounds(request)[index]!
        await test.apply(request, [{ id: 'color', tool: 'owner.background', carrier: 'native', destination: target,
          input: { backgroundColor: '#345678', ...(resolveBackgroundTarget(document, target).supportsMode ? { backgroundMode: 'own' } : {}) } }])
        const colored = test.read().document, current = backgrounds(snapshot(colored, 'course'))[index]!
        const resolved = resolveBackgroundTarget(colored, current)
        expect(resolved.fields.backgroundColor).toBe('#345678')
        if (resolved.supportsMode) {
          await test.apply(snapshot(colored, 'course'), [{ id: 'inherit', tool: 'owner.background', carrier: 'native', destination: current, input: { backgroundMode: 'inherit' } }])
          const inherited = test.read().document
          await test.apply(snapshot(inherited, 'course'), [{ id: 'own', tool: 'owner.background', carrier: 'native', destination: backgrounds(snapshot(inherited, 'course'))[index]!, input: { backgroundMode: 'own' } }])
        }
        const imageDocument = test.read().document, imageRequest = snapshot(imageDocument, 'course')
        await test.apply(imageRequest, [{ id: 'image', tool: 'media.apply', carrier: 'native', destination: backgrounds(imageRequest)[index]!, input: { kind: 'image', source, placement: 'background' } }])
        const removal = snapshot(test.read().document, 'course')
        await test.apply(removal, [{ id: 'remove', tool: 'owner.background', carrier: 'native', destination: backgrounds(removal)[index]!, input: { backgroundAssetId: null } }])
        expect(resolveBackgroundTarget(test.read().document, backgrounds(snapshot(test.read().document, 'course'))[index]!).fields).toMatchObject({ backgroundColor: '#345678', backgroundAssetId: null })
      }
    }
  })

  it('retains explicit state overrides equal to hidden scene fields and deduplicates against the actual inherited background', async () => {
    const document = createBlankCourseProject(), surface = document.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('Slide')
    const scene = surface.scenes[0]!, bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0))
    for (const id of ['course-image', 'hidden-image']) document.assets[id] = { id, kind: 'image', filename: `${id}.png`, path: `assets/${id}.png`, mimeType: 'image/png', byteLength: bytes.length, width: 1, height: 1 }
    document.backgroundColor = '#112233'; document.backgroundAssetId = 'course-image'
    surface.backgroundMode = 'inherit'
    scene.backgroundMode = 'inherit'; scene.backgroundColor = '#778899'; scene.backgroundAssetId = 'hidden-image'
    scene.presentation = { initialStateId: 'named', states: [{ id: 'named', name: '命名状态', layerItemOverrides: {} }] }
    const test = harness(document, { assetFiles: { 'course-image': bytes, 'hidden-image': bytes }, componentPackages: {} })
    const request = snapshot(document, 'page', 'named'), destination = backgrounds(request)[0]!
    // Both saved/hidden and currently visible images are discoverable without another inventory read.
    await test.apply(request, [{ id: 'color', tool: 'owner.background', carrier: 'native', destination, input: { backgroundColor: '#778899' } }])
    let current = snapshot(test.read().document, 'page', 'named')
    expect(resolveBackgroundTarget(test.read().document, backgrounds(current)[0]!).effective).toMatchObject({ color: '#778899', assetId: 'course-image' })
    await test.apply(current, [{ id: 'image', tool: 'media.apply', carrier: 'native', destination: backgrounds(current)[0]!, input: { kind: 'image', source: { assetId: 'hidden-image' }, placement: 'background' } }])
    current = snapshot(test.read().document, 'page', 'named')
    expect(resolveBackgroundTarget(test.read().document, backgrounds(current)[0]!).effective).toMatchObject({ color: '#778899', assetId: 'hidden-image' })
    await test.apply(current, [{ id: 'inherit-color', tool: 'owner.background', carrier: 'native', destination: backgrounds(current)[0]!, input: { backgroundColor: '#112233' } }])
    current = snapshot(test.read().document, 'page', 'named')
    expect(resolveBackgroundTarget(test.read().document, backgrounds(current)[0]!).fields).toMatchObject({ backgroundColor: undefined, backgroundAssetId: 'hidden-image' })
    expect(resolveBackgroundTarget(test.read().document, backgrounds(current)[0]!).effective).toMatchObject({ color: '#112233', assetId: 'hidden-image' })
  })

  it('applies the original mixed-spatial Flow page using formal fallback after a rejected shortcut, preserving other content and resources', async () => {
    const opened = openCourseProjectArchive(new Uint8Array(readFileSync('tests/fixtures/architecture-baseline/mixed-spatial.h5lesson')))
    const document = opened.project, location = document.locations.find(location => location.kind === 'flow-block')!
    expect(location).toBeDefined()
    const request = snapshot(document, 'page', null, location.id), target = backgrounds(request)[0]!
    const test = harness(document, { assetFiles: opened.assetFiles, componentPackages: {} })
    const failure: GenerationCandidate = { version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: '设置背景', steps: [
      { id: 'failed', tool: 'media.apply', carrier: 'native', destination: target, input: { kind: 'image', source, placement: 'background', fit: 'cover' } },
    ] }
    await expect(test.coordinator.prepare(request, failure)).rejects.toThrow('不支持 cover/stretch')
    expect(test.commits).toHaveLength(0)
    expect(test.read().document).toBe(document)
    const resourceTarget = request.destinations.find(value => value.kind === 'create' && value.scope.owner === 'global' && value.scope.parent.kind === 'owner')!
    await test.apply(request, [
      { id: 'import', tool: 'asset.media.import', carrier: 'native', destination: resourceTarget, input: { kind: 'image', ...source } },
      { id: 'background', tool: 'owner.background', carrier: 'native', destination: target, input: { backgroundAssetId: { $result: { stepId: 'import', kind: 'asset-id', index: 0 } }, backgroundMode: 'own' } },
    ])
    expect(test.commits).toHaveLength(1)
    expect(test.read().document.globalLayerItems).toEqual(document.globalLayerItems)
    expect(test.read().document.locations).toEqual(document.locations)
    const originalSurface = document.surfaces.find(surface => surface.id === location.surfaceId)!, updatedSurface = test.read().document.surfaces.find(surface => surface.id === location.surfaceId)!
    expect(updatedSurface).toEqual({ ...originalSurface, backgroundAssetId: expect.any(String) })
    expect(test.read().document.surfaces.filter(surface => surface.id !== location.surfaceId)).toEqual(document.surfaces.filter(surface => surface.id !== location.surfaceId))
    const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: test.read().document, assetFiles: test.read().resources.assetFiles, componentFiles: opened.componentFiles }))
    expect(reopened.project).toEqual(test.read().document)
  })

  it('allows page backgrounds from selected focus while rejecting forged owner identities', async () => {
    const document = createBlankFlowCourseProject(), surface = document.surfaces[0]!
    if (surface.type !== 'flow') throw new Error('Flow')
    surface.blocks.push({ id: 'text', type: 'paragraph', content: { inlines: [{ type: 'text', text: '选中段落' }] } })
    const projection = projectEffectiveLayers({ project: document, locationId: document.startLocationId })
    const request = captureGenerationSnapshot({ document, workspace: { version: 1, projectId: document.id, normalizedPath: '/background.h5lesson' }, projection,
      sessionToken: { locationId: document.startLocationId, surfaceType: 'flow', revision: document.revision, generation: 7 },
      scope: 'selection', selectedIds: ['text'], instruction: '修改背景', purpose: 'local-edit' })
    expect(backgrounds(request).length).toBeGreaterThan(0)
    const target = backgrounds(snapshot(document))[0]!
    const test = harness(document)
    const preview = await test.coordinator.prepare(request, { version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: '修改背景', steps: [
      { id: 'background', tool: 'owner.background', carrier: 'native', destination: target, input: { backgroundColor: '#345678' } },
    ] })
    expect((await test.coordinator.apply(preview.previewId)).status).toBe('committed')
    const paragraph = request.destinations.find(value => value.kind === 'update')!
    expect(() => resolveBackgroundTarget(document, paragraph)).toThrow('背景目标 owner 身份不匹配')
    expect(test.commits).toHaveLength(1)
  })
})


it('QP03 creates a page then imports its background and reuses that semantic asset result in one transaction', async () => {
  const document = createBlankCourseProject(), request = snapshot(document), test = harness(document)
  const create = request.destinations.find(d => d.kind === 'create' && d.scope.parent.kind === 'course-locations' && d.scope.owner === 'scene')!
  expect(create).toBeTruthy()
  await test.apply(request, [
    { id: 'page', tool: 'slide.structure', carrier: 'native', destination: create, input: { operation: 'add-page', name: '新页面' } },
    { id: 'background', tool: 'media.apply', carrier: 'native', destination: { kind: 'created-background', stepId: 'page' }, input: { kind: 'image', source, placement: 'background' } },
    { id: 'image', tool: 'media.apply', carrier: 'native', destination: { kind: 'created-scope', stepId: 'page', parent: { kind: 'owner' }, insertion: { kind: 'append' } }, input: { kind: 'image', source: { assetId: { $result: { stepId: 'background', kind: 'asset-id', index: 0 } } } } },
  ])
  expect(test.commits).toHaveLength(1)
  const next = test.read().document.surfaces[0]!
  if (next.type !== 'slide') throw new Error('slide')
  const page = next.scenes.find(s => s.name === '新页面')!
  expect(page.backgroundAssetId).toBeTruthy()
  expect(page.layerItems.filter(item => item.kind === 'native' && item.content.nativeType === 'image' && item.content.data.assetId === page.backgroundAssetId)).toHaveLength(1)
  expect(Object.keys(test.read().resources.assetFiles)).toHaveLength(1)
  expect(applyEditorTransactionStep(test.read(), test.commits[0]!, 'inverse').document).toEqual(document)
  expect(openCourseProjectArchive(createCourseProjectArchive({ project: test.read().document, assetFiles: test.read().resources.assetFiles, componentFiles: {} })).project).toEqual(test.read().document)
})


it.each(['slide', 'flow', 'spatial-2d'] as const)('QP03 derives the actual new %s Surface background and media dependency scope', async surfaceType => {
  const document = createBlankCourseProject(), request = snapshot(document), test = harness(document)
  const create = request.destinations.find(d => d.kind === 'create' && d.scope.owner === 'global' && d.scope.parent.kind === 'course-locations' && d.scope.insertion.kind === 'append')!
  await test.apply(request, [
    { id: 'surface', tool: 'course.navigation', carrier: 'native', destination: create, input: { operation: 'add-surface', surfaceType, title: '新表面' } },
    { id: 'background', tool: 'media.apply', carrier: 'native', destination: { kind: 'created-background', stepId: 'surface' }, input: { kind: 'image', source, placement: 'background' } },
  ])
  expect(test.commits).toHaveLength(1)
  const surface = test.read().document.surfaces.find(s => !document.surfaces.some(prior => prior.id === s.id))!
  expect(surface.type).toBe(surfaceType)
  expect(surface.type === 'slide' ? surface.scenes[0]!.backgroundAssetId : surface.backgroundAssetId).toEqual(expect.any(String))
})
