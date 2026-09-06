import { describe, expect, it } from 'vitest'
import { runtimeConfigureTool } from '@/renderer/authoring/tools/runtimeConfigureTool'
import { courseNavigationAddress } from '@/renderer/authoring/tools/courseNavigationTool'
import { createSortComponentPackage } from '@/renderer/recipes/sort-component/package'
import { recipeDefaults } from '@/renderer/recipes/recipeCatalog'
import { recipeTool } from '@/renderer/authoring/tools/recipeTool'
import { componentInsertTool } from '@/renderer/authoring/tools/componentInsertTool'
import type { HistoryResourceState } from '@/renderer/store/courseResourceState'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import { courseAuthoringScopeFromLocation } from '@/renderer/authoring/courseAuthoringScope'
import { executeAuthoringTool, type AuthoringToolDefinition } from '@/renderer/authoring/tools/executeAuthoringTool'
import { nativeAuthoringTool } from '@/renderer/authoring/tools/nativeAuthoringTool'
import { materialCitationTool } from '@/renderer/authoring/tools/materialCitationTool'
import { flowAuthoringTool } from '@/renderer/authoring/tools/flowAuthoringTool'
import { slideStructureAddress } from '@/renderer/authoring/tools/slideStructureTool'
import { makeAuthoringAddress } from '@/shared/authoringAddress'
import { applyEditorTransactionStep, type EditorTransactionStep } from '@/renderer/authoring/editorTransaction'
import { createResourceAwareAuthoringHistory, commitEditorTransactionToAuthoringHistory } from '@/renderer/authoring/resourceAwareAuthoringHistory'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import type { AuthoringToolCreateScopeV1, AuthoringToolDestinationV1, AuthoringToolReceiptV1 } from '@/shared/authoringToolContract'
import { useEditorStore, selectActiveCourseProjectDocument, selectSelectedNodeId } from '@/renderer/store/editorStore'

function harness(project: CourseProjectDocument, resources: HistoryResourceState = { assetFiles: {}, componentPackages: {} }) {
  let history = createResourceAwareAuthoringHistory(project)
  const steps: EditorTransactionStep[] = []
  const scope = (): AuthoringToolCreateScopeV1 => {
    const document = history.present
    const scope = courseAuthoringScopeFromLocation({ project: document, locationId: document.startLocationId })
    const surfaceType = document.surfaces.find((surface) => surface.id === scope.surfaceId)!.type
    return { projectId: document.id, documentRevision: document.revision, revisionPolicy: { kind: 'exact' }, sessionGeneration: 1,
      surfaceType, surfaceId: scope.surfaceId, locationId: scope.locationId, stateId: scope.stateId, owner: scope.owner, ownerKey: scope.ownerKey,
      parent: surfaceType === 'flow' ? { kind: 'flow-body', parentBlockId: null } : { kind: 'owner' }, insertion: { kind: 'append' } }
  }
  return {
    scope,
    document: () => history.present,
    steps,
    target(receipt: AuthoringToolReceiptV1): AuthoringToolDestinationV1 {
      const { parent: _parent, insertion: _insertion, ...target } = scope()
      const affected = receipt.affected[0]!
      return { kind: 'update', target: { ...target, itemId: affected.id, authoringAddress: affected.authoringAddress! } }
    },
    async run<T>(definition: AuthoringToolDefinition<T>, input: unknown, destination: AuthoringToolDestinationV1 = { kind: 'create', scope: scope() }) {
      return executeAuthoringTool({ version: 1, requestId: `request-${steps.length}`, tool: definition.name, destination, input }, definition, {
        readDocument: () => history.present,
        readResources: () => resources,
        validateDestination: (destination) => (destination.kind === 'update' ? destination.target : destination.scope).sessionGeneration === 1
          ? null : { code: 'session-stale', message: 'Session changed', path: ['sessionGeneration'] },
        commit(step) { history = commitEditorTransactionToAuthoringHistory(history, step); steps.push(step); return true },
      })
    },
  }
}

describe('Product commands behind versioned Surface tools', () => {
  it('can disable an existing broken Runtime without executing it and can Undo the single transaction', async () => {
    const project = createBlankCourseProject()
    const surface = project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('Expected Slide')
    const scene = surface.scenes[0]!
    scene.layerItems.push({ kind: 'runtime', layerItemId: 'broken-runtime', label: 'Broken', order: 1, visible: true, locked: false,
      opacity: 1, rotation: 0, hitPolicy: 'auto', playbackInitialVisibility: 'inherit', frame: { mode: 'absolute', x: 0, y: 0, width: 640, height: 360 },
      runtime: { protocol: 'canvas-runtime', runtimeApiVersion: 2, enabled: true, renderMode: 'dom', source: 'throw new Error("broken existing source")', content: { values: {} }, assets: {} } })
    const test = harness(project)
    const { parent: _parent, insertion: _insertion, ...wire } = test.scope()
    const result = await test.run(runtimeConfigureTool, { field: 'enabled', initialValue: true, value: false }, { kind: 'update', target: {
      ...wire, itemId: 'broken-runtime', authoringAddress: makeAuthoringAddress({ projectId: project.id, scope: 'scene', surfaceId: surface.id, sceneId: scene.id, carrier: 'runtime', layerItemId: 'broken-runtime', field: 'runtime/enabled' }),
    } })
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('committed')
    expect(test.steps).toHaveLength(1)
    expect(JSON.stringify(test.document())).toContain('"enabled":false')
    expect(applyEditorTransactionStep({ document: test.document(), resources: { assetFiles: {}, componentPackages: {} } }, test.steps[0]!, 'inverse').document).toEqual(project)
  })
  it.each([createBlankCourseProject, createBlankFlowCourseProject, createBlankSpatialCourseProject])('inserts an existing Component using canonical commands with portable fallback', async factory => {
    const project = factory()
    const pkg = createSortComponentPackage()
    project.componentPackages[pkg.manifest.id] = pkg.metadata
    project.assets['fallback'] = { id: 'fallback', kind: 'image', filename: 'fallback.png', path: 'assets/fallback.png', mimeType: 'image/png', byteLength: 1, width: 1, height: 1 }
    const resources = { assetFiles: { fallback: new Uint8Array([1]) }, componentPackages: { [pkg.manifest.id]: pkg } }
    const test = harness(project, resources)
    const result = await test.run(componentInsertTool, { operation: 'existing', packageId: pkg.manifest.id, staticFallbackAssetId: 'fallback' })
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('committed')
    expect(result.affected).toHaveLength(1)
    expect(test.steps).toHaveLength(1)
    const payload = buildPublishedCourseV2Payload({ project: test.document(), assetFiles: resources.assetFiles, components: resources.componentPackages })
    expect(JSON.stringify(payload)).toContain(result.affected[0]!.id)
    expect(JSON.stringify(test.document())).toContain('"staticFallbackAssetId":"fallback"')
    expect(applyEditorTransactionStep({ document: test.document(), resources }, test.steps[0]!, 'inverse').document).toEqual(project)
    if (project.surfaces[0]!.type === 'flow') expect(result.selection?.flowCarrier).toBe('block')
  })
  it('applies an interactive Recipe as one tool transaction with its package resources', async () => {
    const test = harness(createBlankCourseProject())
    const scope = test.scope()
    scope.parent = { kind: 'course-locations' }
    scope.insertion = { kind: 'after', siblingId: scope.locationId }
    const result = await test.run(recipeTool, { recipeId: 'classify-sort-v1', slots: { ...recipeDefaults('classify-sort-v1'), mode: 'sort' } }, { kind: 'create', scope })
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('committed')
    expect(result.selection?.locationId).toBe(result.affected[0]!.id)
    expect(test.steps).toHaveLength(1)
    expect(test.steps[0]!.resourceChanges.componentPackageChanges).toHaveLength(1)
  })
  it('atomically changes Surface through course tools and undoes the complete navigation history', async () => {
    useEditorStore.getState().createNewProject()
    const original = selectActiveCourseProjectDocument(useEditorStore.getState())!
    async function run(input: unknown, itemId?: string) {
      useEditorStore.getState().setEditingScope('global')
      const state = useEditorStore.getState()
      const document = selectActiveCourseProjectDocument(state)!
      const session = state.courseAuthoringSession!
      const current = courseAuthoringScopeFromLocation({ project: document, locationId: session.token.locationId, owner: 'global' })
      const target = { projectId: document.id, documentRevision: document.revision, revisionPolicy: { kind: 'exact' as const },
        sessionGeneration: session.token.generation, surfaceType: session.token.surfaceType, surfaceId: current.surfaceId,
        locationId: current.locationId, stateId: current.stateId, owner: current.owner, ownerKey: current.ownerKey }
      return state.runAuthoringTool({ version: 1, requestId: `navigation-${document.revision}`, tool: 'course.navigation', input,
        destination: itemId ? { kind: 'update', target: { ...target, itemId, authoringAddress: courseNavigationAddress(document.id, itemId) } }
          : { kind: 'create', scope: { ...target, parent: { kind: 'course-locations' }, insertion: { kind: 'append' } } } })
    }
    const flow = await run({ operation: 'add-surface', surfaceType: 'flow', title: '知识讲义' })
    expect(flow.status, JSON.stringify(flow.diagnostics)).toBe('committed')
    expect(useEditorStore.getState().courseAuthoringSession!.token.surfaceType).toBe('flow')
    expect(useEditorStore.getState().flowSession!.selection.locationId).toBe(flow.affected[0]!.id)
    const spatial = await run({ operation: 'add-surface', surfaceType: 'spatial-2d' })
    expect(spatial.status, JSON.stringify(spatial.diagnostics)).toBe('committed')
    expect(useEditorStore.getState().courseAuthoringSession!.token.surfaceType).toBe('spatial-2d')
    const deleted = await run({ operation: 'delete-location' }, spatial.affected[0]!.id)
    expect(deleted.status, JSON.stringify(deleted.diagnostics)).toBe('committed')
    const current = selectActiveCourseProjectDocument(useEditorStore.getState())!
    expect(current.locations.some((entry) => entry.id === useEditorStore.getState().courseAuthoringSession!.token.locationId)).toBe(true)
    for (let i = 0; i < 3; i++) useEditorStore.getState().undo()
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())).toEqual(original)
    expect(useEditorStore.getState().courseAuthoringSession!.token.surfaceType).toBe('slide')
    for (let i = 0; i < 3; i++) useEditorStore.getState().redo()
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())).toEqual(current)
  })
  it.each(['slide', 'flow'] as const)('inserts portable material text and source atomically on %s and rejects stale citations', async surfaceType => {
    const project = surfaceType === 'slide' ? createBlankCourseProject() : createBlankFlowCourseProject()
    const test = harness(project)
    const material = { version: 1, id: 'a5077e47-bacb-4e90-8022-3169dac5d783', createdAt: 1,
      workspace: { version: 1, projectId: project.id, normalizedPath: 'c:/lessons/example.h5lesson' },
      title: '分数的含义', text: '分母表示平均分的份数。', source: { kind: 'text', locator: '教材第 12 页' } }
    const staleScope = test.scope()
    const receipt = await test.run(materialCitationTool, material)
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed')
    expect(test.steps).toHaveLength(1)
    const reopened = JSON.parse(JSON.stringify(test.document()))
    const serialized = JSON.stringify(reopened)
    expect(serialized).toContain('分母表示平均分的份数。')
    expect(serialized).toContain('教材第 12 页')
    expect(serialized).not.toContain('normalizedPath')
    expect(serialized).not.toContain(material.id)
    const published = JSON.stringify(buildPublishedCourseV2Payload({ project: reopened, assetFiles: {}, components: {} }))
    expect(published).toContain('教材第 12 页')
    expect((await test.run(materialCitationTool, material, { kind: 'create', scope: staleScope })).status).toBe('stale')
    expect(test.steps).toHaveLength(1)
    expect(applyEditorTransactionStep({ document: test.document(), resources: { assetFiles: {}, componentPackages: {} } }, test.steps[0]!, 'inverse').document).toEqual(project)
  })
  it('creates and deletes a Flow global Native overlay without selecting a body block', async () => {
    useEditorStore.getState().createNewFlowProject()
    useEditorStore.getState().setEditingScope('global')
    const original = selectActiveCourseProjectDocument(useEditorStore.getState())!
    const scope = { ...harness(original).scope(), owner: 'global' as const, ownerKey: 'global', parent: { kind: 'owner' as const },
      sessionGeneration: useEditorStore.getState().courseAuthoringSession!.token.generation }
    const inserted = await useEditorStore.getState().runAuthoringTool({ version: 1, requestId: 'flow-overlay', tool: 'native.content',
      destination: { kind: 'create', scope }, input: { operation: 'insert', template: { nativeType: 'text', text: '全局提示', x: 24, y: 48 } } })
    expect(inserted.status, JSON.stringify(inserted.diagnostics)).toBe('committed')
    expect(useEditorStore.getState().flowSession!.selection.selectedOverlayIds).toEqual([inserted.affected[0]!.id])
    expect(useEditorStore.getState().flowSession!.selection.selectedBlockIds).toEqual([])
    const document = selectActiveCourseProjectDocument(useEditorStore.getState())!
    expect(document.globalLayerItems.find((entry) => entry.item.layerItemId === inserted.affected[0]!.id)!.item.frame).toMatchObject({ x: 24, y: 48 })
    const { parent: _parent, insertion: _insertion, ...target } = scope
    const deleted = await useEditorStore.getState().runAuthoringTool({ version: 1, requestId: 'flow-delete-overlay', tool: 'native.content',
      destination: { kind: 'update', target: { ...target, documentRevision: document.revision, itemId: inserted.affected[0]!.id, authoringAddress: inserted.affected[0]!.authoringAddress } }, input: { operation: 'delete' } })
    expect(deleted.status).toBe('committed')
    expect(useEditorStore.getState().flowSession!.selection.authoringScope).toBe('global')
    useEditorStore.getState().undo()
    useEditorStore.getState().undo()
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())).toEqual(original)
  })
  it('shares course state/guard/playback and background commands, preserving owner and renamed references', async () => {
    useEditorStore.getState().createNewProject()
    useEditorStore.getState().setEditingScope('global')
    const original = selectActiveCourseProjectDocument(useEditorStore.getState())!
    async function run(tool: string, input: unknown, options: { field?: string; prior?: AuthoringToolReceiptV1; owner?: 'scene' | 'global' } = {}) {
      const state = useEditorStore.getState()
      const document = selectActiveCourseProjectDocument(state)!
      const scope = harness(document).scope()
      scope.owner = options.owner ?? 'global'
      scope.ownerKey = scope.owner === 'global' ? 'global' : scope.ownerKey
      scope.sessionGeneration = state.courseAuthoringSession!.token.generation
      const { parent: _parent, insertion: _insertion, ...target } = scope
      const location = document.locations[0]!
      const id = options.prior?.affected[0]?.id ?? (scope.owner === 'global' ? document.id : location.kind === 'slide-scene' ? location.sceneId : '')
      const address = options.prior?.affected[0]?.authoringAddress ?? makeAuthoringAddress({ projectId: document.id, scope: scope.owner,
        surfaceId: scope.owner === 'scene' ? scope.surfaceId : undefined,
        sceneId: scope.owner === 'scene' && location.kind === 'slide-scene' ? location.sceneId : undefined, carrier: 'native', layerItemId: id, field: options.field ?? 'courseState' })
      return state.runAuthoringTool({ version: 1, requestId: 'course-tool', tool, input,
        destination: options.field || options.prior ? { kind: 'update', target: { ...target, itemId: id, authoringAddress: address } } : { kind: 'create', scope } })
    }
    const score = await run('course.settings', { operation: 'add-state', declaration: { key: 'score', valueType: 'number', defaultValue: 0 } })
    expect(score.status, JSON.stringify(score.diagnostics)).toBe('committed')
    const guard = await run('course.settings', { operation: 'add-guard', guard: { effect: 'block', toLocationIds: [original.startLocationId], match: 'all', conditions: [{ type: 'compare', key: 'score', operator: 'lt', value: 1 }], message: '先完成练习' } })
    expect(guard.status, JSON.stringify(guard.diagnostics)).toBe('committed')
    const renamed = await run('course.settings', { operation: 'update-state', declaration: { key: 'mastery', valueType: 'number', defaultValue: 0 } }, { prior: score })
    expect(renamed.status).toBe('committed')
    expect(renamed.affected[0]!.id).toBe('mastery')
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.navigationGuards[0]!.conditions[0]).toMatchObject({ key: 'mastery' })
    expect((await run('course.settings', { operation: 'delete-state' }, { prior: renamed })).status).toBe('failed')
    expect((await run('course.settings', { operation: 'network', network: { connectOrigins: ['https://example.org/path'] } }, { field: 'network' })).status).toBe('rejected')
    const network = await run('course.settings', { operation: 'network', network: { connectOrigins: ['https://example.org'] } }, { field: 'network' })
    expect(network.status).toBe('committed')
    const background = await run('owner.background', { backgroundColor: '#234567' }, { field: 'background' })
    expect(background.status).toBe('committed')
    const before = selectActiveCourseProjectDocument(useEditorStore.getState())!
    expect((await run('owner.background', { backgroundColor: '#123456' }, { field: 'background', owner: 'scene' })).status).toBe('rejected')
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())).toBe(before)
    const playback = await run('course.settings', { operation: 'playback', playback: { ...before.playback, keyboardNavigation: !before.playback.keyboardNavigation } }, { field: 'playback' })
    expect(playback.status).toBe('committed')
    useEditorStore.getState().setEditingScope('scene')
    const interaction = await run('slide.interaction', { operation: 'insert', rule: { enabled: true, trigger: { type: 'scene.enter' }, conditions: [],
      actions: [{ id: 'set-mastery', start: 'after-previous', delayMs: 0, action: { type: 'course-state.set', key: 'mastery', value: 1 } }] } }, { owner: 'scene' })
    expect(interaction.status, JSON.stringify(interaction.diagnostics)).toBe('committed')
    const published = buildPublishedCourseV2Payload({ project: before, assetFiles: {}, components: {} })
    expect(JSON.stringify(published)).toContain('mastery')
    expect(JSON.stringify(published)).toContain('#234567')
    for (let index = 0; index < 7; index++) useEditorStore.getState().undo()
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())).toEqual(original)
  })
  it('commits Spatial graph references and camera poses through the live history, rejecting dangling endpoints', async () => {
    useEditorStore.getState().createNewSpatialProject()
    const original = selectActiveCourseProjectDocument(useEditorStore.getState())!
    async function run(tool: string, input: Record<string, unknown>, prior?: AuthoringToolReceiptV1) {
      const state = useEditorStore.getState()
      const document = selectActiveCourseProjectDocument(state)!
      const scope = harness(document).scope()
      scope.locationId = state.spatialSession!.selection.locationId
      scope.sessionGeneration = state.courseAuthoringSession!.token.generation
      if (input.operation === 'add-camera') scope.parent = { kind: 'course-locations' }
      const { parent: _parent, insertion: _insertion, ...target } = scope
      return state.runAuthoringTool({ version: 1, requestId: 'spatial-tool', tool, input,
        destination: prior ? { kind: 'update', target: { ...target, itemId: prior.affected[0]!.id, authoringAddress: prior.affected[0]!.authoringAddress } } : { kind: 'create', scope } })
    }
    const a = await run('native.content', { operation: 'insert', template: { nativeType: 'text', text: '起点' } })
    const b = await run('native.content', { operation: 'insert', template: { nativeType: 'text', text: '终点' } })
    const path = await run('spatial.structure', { operation: 'add-path', path: { name: '观察路径', layerItemIds: [a.affected[0]!.id, b.affected[0]!.id] } })
    expect(path.status, JSON.stringify(path.diagnostics)).toBe('committed')
    expect(useEditorStore.getState().spatialGraphSelection).toEqual({ kind: 'path', id: path.affected[0]!.id })
    const relation = await run('spatial.structure', { operation: 'add-relation', relation: { sourceLayerItemId: a.affected[0]!.id, targetLayerItemId: b.affected[0]!.id, kind: 'arrow' } })
    expect(relation.status, JSON.stringify(relation.diagnostics)).toBe('committed')
    const before = selectActiveCourseProjectDocument(useEditorStore.getState())
    expect((await run('spatial.structure', { operation: 'update-relation', relation: { targetLayerItemId: 'missing' } }, relation)).status).toBe('failed')
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())).toBe(before)
    const camera = await run('spatial.structure', { operation: 'add-camera', pose: { x: 150, y: 260, zoom: 2 }, name: '放大观察' })
    expect(camera.status, JSON.stringify(camera.diagnostics)).toBe('committed')
    expect(useEditorStore.getState().courseAuthoringSession!.token.locationId).toBe(camera.selection!.locationId)
    expect(useEditorStore.getState().spatialSession!.sessionCamera).toMatchObject({ x: 150, y: 260, zoom: 2 })
    expect((await run('spatial.structure', { operation: 'delete-camera' }, camera)).status).toBe('committed')
    const saved = useEditorStore.getState().prepareCourseProjectPersistence()
    if (!saved.ok) throw new Error(saved.reason)
    expect(JSON.stringify(saved.snapshot.project)).toContain('观察路径')
    for (let index = 0; index < 6; index++) useEditorStore.getState().undo()
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())).toEqual(original)
  })
  it('commits page/state navigation atomically and recovers valid targets through delete and Undo', async () => {
    useEditorStore.getState().createNewProject()
    const original = selectActiveCourseProjectDocument(useEditorStore.getState())!
    const calls: string[] = []
    const unsubscribe = useEditorStore.subscribe((state) => {
      const document = selectActiveCourseProjectDocument(state)
      const locationId = state.courseAuthoringSession?.token.locationId
      if (document && locationId && !document.locations.some((entry) => entry.id === locationId)) calls.push(locationId)
    })
    async function run(operation: string, name?: string) {
      const state = useEditorStore.getState()
      const document = selectActiveCourseProjectDocument(state)!
      const snapshot = state.slideCandidateSnapshot!
      const { parent: _parent, insertion: _insertion, ...base } = harness(document).scope()
      const scope = { ...base, ...courseAuthoringScopeFromLocation({ project: document, locationId: snapshot.locationId, owner: 'scene', stateId: snapshot.selection.stateId }),
        sessionGeneration: state.courseAuthoringSession!.token.generation, documentRevision: document.revision }
      // Keep the public strict wire fields only.
      const { sceneId: _sceneId, ...wire } = scope
      const isState = operation.endsWith('state')
      const location = document.locations.find((entry) => entry.id === snapshot.locationId)!
      if (location.kind !== 'slide-scene') throw new Error('Expected Slide')
      const destination = operation.startsWith('add-')
        ? { kind: 'create', scope: { ...wire, parent: { kind: isState ? 'owner' : 'course-locations' }, insertion: { kind: 'append' } } }
        : { kind: 'update', target: { ...wire, itemId: isState ? snapshot.selection.stateId : location.sceneId,
          authoringAddress: slideStructureAddress(document.id, location.surfaceId, location.sceneId, isState ? snapshot.selection.stateId : null) } }
      const receipt = await state.runAuthoringTool({ version: 1, requestId: operation, tool: 'slide.structure', destination, input: { operation, ...(name ? { name } : {}) } })
      expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed')
      expect(useEditorStore.getState().courseAuthoringSession?.token.locationId).toBe(receipt.selection?.locationId)
      return receipt
    }
    try {
      const added = await run('add-page', '工具新页')
      expect(added.selection?.locationId).not.toBe(original.locations[0]!.id)
      const state = await run('add-state', '先观察')
      expect(state.selection?.stateId).toBe(state.affected[0]!.id)
      await run('add-state', '后解释')
      await run('delete-state')
      await run('delete-page')
      expect(useEditorStore.getState().prepareCourseProjectPersistence().ok).toBe(true)
      for (let index = 0; index < 5; index++) useEditorStore.getState().undo()
      expect(selectActiveCourseProjectDocument(useEditorStore.getState())).toEqual(original)
      expect(calls).toEqual([])
    } finally { unsubscribe() }
  })
  it.each(['slide', 'flow', 'spatial-2d'] as const)('%s live tool updates the real selection, persistence snapshot and existing Undo history', async (surfaceType) => {
    const state = useEditorStore.getState()
    if (surfaceType === 'slide') state.createNewProject()
    else if (surfaceType === 'flow') state.createNewFlowProject()
    else state.createNewSpatialProject()
    const original = selectActiveCourseProjectDocument(useEditorStore.getState())!
    const scope = harness(original).scope()
    scope.sessionGeneration = useEditorStore.getState().courseAuthoringSession!.token.generation
    const request = { version: 1, requestId: 'live-tool', tool: surfaceType === 'flow' ? 'flow.content' : 'native.content', destination: { kind: 'create', scope },
      input: surfaceType === 'flow' ? { operation: 'insert', block: { type: 'paragraph', text: '工具写入' } } : { operation: 'insert', template: { nativeType: 'text', text: '工具写入' } } }
    const receipt = await useEditorStore.getState().runAuthoringTool(request)
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed')
    const selected = surfaceType === 'flow' ? useEditorStore.getState().flowSession?.selection.selectedBlockId : selectSelectedNodeId(useEditorStore.getState())
    expect(selected).toBe(receipt.affected[0]!.id)
    const saved = useEditorStore.getState().prepareCourseProjectPersistence()
    if (!saved.ok) throw new Error(saved.reason)
    expect(JSON.stringify(saved.snapshot.project)).toContain('工具写入')
    expect((await useEditorStore.getState().runAuthoringTool(request)).status).toBe('stale')
    useEditorStore.getState().undo()
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())).toEqual(original)
  })

  it.each([['Slide', createBlankCourseProject], ['Spatial', createBlankSpatialCourseProject]] as const)('%s creates and edits native Table in one reversible transaction per call', async (_name, factory) => {
    const test = harness(factory())
    const inserted = await test.run(nativeAuthoringTool, { operation: 'insert', template: { nativeType: 'table' } })
    expect(inserted.status).toBe('committed')
    const destination = test.target(inserted)
    const surface = test.document().surfaces[0]!
    const item = surface.type === 'slide' ? surface.scenes[0]!.layerItems.find((item) => item.layerItemId === inserted.affected[0]!.id)
      : surface.type === 'spatial-2d' ? surface.world.layerItems.find((item) => item.layerItemId === inserted.affected[0]!.id) : undefined
    if (item?.kind !== 'native' || item.content.nativeType !== 'table') throw new Error('Missing table')
    const content = structuredClone(item.content)
    content.data.rows[0]!.cells[0]!.text = '工具编辑'
    const updated = await test.run(nativeAuthoringTool, { operation: 'content', content }, destination)
    expect(updated.status, JSON.stringify(updated.diagnostics)).toBe('committed')
    expect(test.steps).toHaveLength(2)
    expect((await test.run(nativeAuthoringTool, { operation: 'delete' }, destination)).status).toBe('stale')
    expect(test.steps).toHaveLength(2)
    const reversed = applyEditorTransactionStep({ document: test.document(), resources: { assetFiles: {}, componentPackages: {} } }, test.steps[1]!, 'inverse')
    expect(JSON.stringify(reversed.document)).not.toContain('工具编辑')
    expect(JSON.stringify(buildPublishedCourseV2Payload({ project: test.document(), assetFiles: {}, components: {} }))).toContain('工具编辑')
  })

  it('addresses a Flow table stably after preceding insertion and uses shared structural edits', async () => {
    const test = harness(createBlankFlowCourseProject())
    const table = await test.run(flowAuthoringTool, { operation: 'insert', block: { type: 'table', columns: [{ id: 'a', header: '甲' }], rows: [{ id: 'r', cells: { a: '首格' } }] } })
    expect(table.status).toBe('committed')
    const before = test.scope()
    before.insertion = { kind: 'before', siblingId: table.affected[0]!.id }
    expect((await test.run(flowAuthoringTool, { operation: 'insert', block: { type: 'paragraph', text: '前置段落' } }, { kind: 'create', scope: before })).status).toBe('committed')
    expect((await test.run(flowAuthoringTool, { operation: 'table-structure', change: { kind: 'insert-row' } }, test.target(table))).status).toBe('committed')
    const surface = test.document().surfaces[0]!
    if (surface.type !== 'flow') throw new Error('Expected Flow')
    const block = surface.blocks.find((block) => block.id === table.affected[0]!.id)
    expect(block?.type === 'table' && block.rows.length).toBe(2)
    const wrong = test.target(table)
    if (wrong.kind !== 'update') throw new Error('Expected target')
    wrong.target.authoringAddress += '-wrong'
    expect((await test.run(flowAuthoringTool, { operation: 'delete' }, wrong)).status).toBe('failed')
    expect(test.steps).toHaveLength(3)
  })
})
