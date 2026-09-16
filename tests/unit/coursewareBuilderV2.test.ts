import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCoursewareBuilderV2WithOwner } from '../../src/renderer/course/coursewareBuilderV2'
import { selectActiveCourseProjectDocument, useEditorStore } from '../../src/renderer/store/editorStore'

const document = () => selectActiveCourseProjectDocument(useEditorStore.getState())!
beforeEach(() => useEditorStore.getState().createNewProject())

describe('same-window Builder canonical Store owner', () => {
  it('commits to the visible document and its one undo history, with real resources and stale scope rejection', async () => {
    const owner = useEditorStore.getState().createCoursewareBuilderOwner()
    const builder = createCoursewareBuilderV2WithOwner(owner)
    const before = structuredClone(document())
    const resources = structuredClone(useEditorStore.getState().componentPackages)
    const scope = builder.createScope({ parent: { kind: 'owner' }, insertion: { kind: 'append' } })
    const receipt = await builder.execute('native.content', { operation: 'insert', template: { nativeType: 'text', text: '同窗口真实正文' } }, { kind: 'create', scope })
    expect(receipt.status).toBe('committed')
    expect(document().revision).toBe(before.revision + 1)
    expect(JSON.stringify(document())).toContain('同窗口真实正文')
    expect(builder.finish().project).toEqual(document())
    expect(builder.finish().componentFiles).toEqual(Object.fromEntries(Object.entries(resources).map(([id, pkg]) => [id, pkg.files])))
    const committed = structuredClone(document())
    useEditorStore.getState().undo()
    expect(document()).toEqual(before)
    expect(useEditorStore.getState().componentPackages).toEqual(resources)
    useEditorStore.getState().redo()
    expect(document()).toEqual(committed)
    const oldScope = builder.createScope({ parent: { kind: 'owner' }, insertion: { kind: 'append' } })
    builder.activateScope({ locationId: before.startLocationId, owner: 'global' })
    expect(owner.readScope().owner).toBe('global')
    expect(owner.readGeneration()).toBe(useEditorStore.getState().courseAuthoringSession!.token.generation)
    const stale = await builder.execute('native.content', { operation: 'insert', template: { nativeType: 'text', text: '不得提交' } }, { kind: 'create', scope: oldScope })
    expect(stale.status).toBe('rejected')
    expect(stale.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'owner-mismatch' })]))
    expect(document()).toEqual(committed)
    useEditorStore.getState().createNewFlowProject()
    expect(() => owner.readDocument()).toThrow('工程已切换')
    expect(() => owner.activate({ locationId: before.startLocationId })).toThrow('工程已切换')
    const flowOwner = useEditorStore.getState().createCoursewareBuilderOwner()
    const flowLocation = document().startLocationId
    flowOwner.activate({ locationId: flowLocation, owner: 'global' })
    expect(flowOwner.readScope().owner).toBe('global')
    flowOwner.activate({ locationId: flowLocation, owner: 'surface' })
    expect(flowOwner.readScope()).toMatchObject({ locationId: flowLocation, owner: 'surface' })
  })
})


describe('Builder bounded geometry observation', () => {
  it('keeps raw component content separate from current-state layout and reads manifest without mutation', async () => {
    const { withDefaultComponentController } = await import('../../src/renderer/components/teacherControllerComponent')
    const { createBlankCourseProject } = await import('../../src/renderer/project/createCourseProject')
    const { courseAuthoringScopeFromLocation } = await import('../../src/renderer/authoring/courseAuthoringScope')
    const { resolveComponentEditorProperties } = await import('../../src/shared/componentProps')
    const bundle = withDefaultComponentController(createBlankCourseProject({ title: 'Geometry' }))
    const project = bundle.project
    const surface = project.surfaces[0]
    if (surface.type !== 'slide') throw new Error('Expected Slide')
    const item = structuredClone(project.globalLayerItems[0].item)
    if (item.kind !== 'component') throw new Error('Expected formal controller component')
    delete item.role
    item.layerItemId = 'local-component'
    surface.scenes[0].layerItems.push(item)
    surface.scenes[0].presentation = { initialStateId: 'geometry-state', states: [{ id: 'geometry-state', name: 'Geometry',
      layerItemOverrides: { [item.layerItemId]: { frame: { x: 42, y: 51, width: 300, height: 180 }, visible: false } } }] }
    const scope = courseAuthoringScopeFromLocation({ project, locationId: project.startLocationId, stateId: 'geometry-state' })
    const commit = vi.fn(() => true)
    const builder = createCoursewareBuilderV2WithOwner({ readDocument: () => project,
      readResources: () => ({ assetFiles: {}, componentPackages: bundle.componentPackages }),
      readScope: () => scope, readGeneration: () => 1, activate: () => {}, validateDestination: () => null, commit })
    const before = structuredClone(builder.snapshot())
    const result = builder.observe({ itemIds: [item.layerItemId], includeContent: true, limit: 1 })
    expect(result.surfaceGeometry).toEqual({ type: 'slide', canvas: surface.canvas })
    expect(result.contentMode).toBe('raw')
    expect(result.items).toEqual([item])
    expect(result.effectiveLayout).toEqual([expect.objectContaining({ itemId: item.layerItemId,
      frame: { mode: 'absolute', x: 42, y: 51, width: 300, height: 180 }, visible: false, stateOverrideApplied: true })])
    const manifest = bundle.componentPackages[item.component.packageId].manifest
    expect(result.componentDefinitions).toEqual([{ itemId: item.layerItemId, ...item.component,
      defaultSize: manifest.defaultSize, minSize: manifest.minSize,
      publicProperties: resolveComponentEditorProperties(manifest, item.props) }])
    expect(JSON.stringify(result)).not.toContain('runtimeSource')
    expect(result.effectiveLayout?.some(row => row.itemId === project.globalLayerItems[0].item.layerItemId)).toBe(false)
    result.effectiveLayout![0].frame.x = 999
    expect(builder.observe({ itemIds: [item.layerItemId], includeContent: true }).effectiveLayout![0].frame.x).toBe(42)
    expect(builder.snapshot()).toEqual(before)
    expect(commit).not.toHaveBeenCalled()
    expect(builder.observe({ offset: 100, includeContent: true }).componentDefinitions).toEqual([])
  })

  it('reports Flow and Spatial geometry without creating history or receipts', async () => {
    const { createCoursewareBuilderV2 } = await import('../../src/renderer/course/coursewareBuilderV2')
    for (const surfaceType of ['flow', 'spatial-2d'] as const) {
      const builder = createCoursewareBuilderV2({ title: 'Geometry', surfaceType })
      const before = builder.snapshot()
      const surface = before.project.surfaces[0]
      const observed = builder.observe({ includeContent: true })
      expect(observed.surfaceGeometry).toEqual(surface.type === 'flow'
        ? { type: 'flow', layout: surface.layout }
        : surface.type === 'spatial-2d' ? { type: 'spatial-2d', bounds: surface.world.bounds, camera: surface.camera } : null)
      expect(observed.receiptCount).toBe(0)
      expect(builder.snapshot()).toEqual(before)
    }
  })
})
