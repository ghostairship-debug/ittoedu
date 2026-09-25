import type { Page } from 'playwright'

/**
 * Exercises overlay-component conversion inside the real Electron renderer so
 * the shared admission path captures an actual mounted Component API 4 instance.
 */
export async function runFlowComponentConversionProbe(page: Page) {
  return page.evaluate(async () => {
    const load = (path: string): Promise<any> => import(path)
    const { createBlankFlowCourseProject } = await load('/src/renderer/project/createFlowCourseProject.ts')
    const { parseComponentPackageFiles } = await load('/src/core/drivers/codecs/importComponentPackage.ts')
    const { withDefaultComponentController } = await load('/src/renderer/components/teacherControllerComponent.ts')
    const { componentPackagesToArchiveFiles } = await load('/src/renderer/components/componentPackageStore.ts')
    const { componentPackageMeta } = await load('/src/shared/componentPackageMeta.ts')
    const { insertFlowSharedComponent, convertFlowComponentBlockToOverlay } = await load('/src/renderer/course/flowSharedAuthoringAdapters.ts')
    const {
      selectFlowEditorBlock,
      createFlowEditorHistory,
      commitFlowEditorTransactionHistory,
      flowEditorUndoResourceTransition,
      flowEditorRedoResourceTransition,
      undoFlowEditorHistory,
      redoFlowEditorHistory,
    } = await load('/src/renderer/course/flowEditorSlice.ts')
    const { buildFlowEditorView, captureFlowEditorAuthoringTarget } = await load('/src/renderer/course/flowEditorView.ts')
    const { prepareFlowOverlayComponentConversion } = await load('/src/renderer/course/flowComponentConversion.ts')
    const { createEditorTransactionStep, applyEditorTransactionStep } = await load('/src/renderer/authoring/editorTransaction.ts')
    const { applyHistoryResourceChanges } = await load('/src/renderer/store/courseResourceState.ts')
    const { createCourseProjectArchive, openCourseProjectArchive } = await load('/src/core/drivers/codecs/courseProjectArchive.ts')
    const { buildPublishedCourseV2Payload } = await load('/src/renderer/export/course/buildPublishedCourse.ts')
    const { createPublishedCourseSession } = await load('/src/player/surfaces/publishedDynamicHosts.ts')
    const { buildFlowDocxProjection } = await load('/src/renderer/export/course/flowDocxProjection.ts')

    const packageId = 'com.example.flow-conversion-probe'
    const manifest = {
      schemaVersion: 4,
      runtimeApiVersion: 4,
      renderMode: 'dom',
      supportedScopes: ['scene', 'global'],
      id: packageId,
      name: 'Flow conversion probe',
      version: '1.0.0',
      entry: 'runtime.js',
      defaultSize: { width: 360, height: 180 },
      minSize: { width: 120, height: 80 },
      preserveAspectRatio: false,
      assets: {},
      defaultProps: { label: '正文组件' },
    }
    const component = parseComponentPackageFiles({
      'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
      'runtime.js': new TextEncoder().encode(
        `CoursewareComponent.define({id:'${packageId}',runtimeApiVersion:4,create(ctx){const button=document.createElement('button');button.type='button';button.dataset.flowConversionCounter='true';let count=0;const paint=()=>{button.textContent=ctx.props.label+':'+count};button.addEventListener('click',()=>{count++;paint()});button.style.cssText='width:100%;height:100%;font:24px sans-serif;background:#dbeafe;color:#1e3a8a;border:4px solid #2563eb';paint();ctx.dom.root.append(button);return{destroy(){button.remove()}}}})`,
      ),
    })
    let project = createBlankFlowCourseProject({
      id: 'flow-component-conversion-probe',
      title: 'Flow component conversion probe',
      now: '2026-09-07T08:00:00.000Z',
    })
    project.componentPackages[packageId] = componentPackageMeta(component)
    const surface = project.surfaces.find((candidate: any) => candidate.type === 'flow')
    const location = project.locations.find((candidate: any) => candidate.kind === 'flow-block')
    if (!surface || surface.type !== 'flow' || !location || location.kind !== 'flow-block') {
      throw new Error('Flow probe fixture was not created')
    }
    const paragraph = surface.blocks.find((block: any) => block.type === 'paragraph')
    if (!paragraph) throw new Error('Flow probe paragraph is missing')

    const inserted = insertFlowSharedComponent(
      project,
      selectFlowEditorBlock(project, location.id, paragraph.id),
      {
        packageId,
        manifest,
        id: 'overlay-component-to-convert',
        props: { label: '正文组件' },
        placement: 'viewport-overlay',
      },
      { now: '2026-09-07T08:00:01.000Z' },
    )
    if (!inserted.ok || !inserted.nextDocument) {
      throw new Error(inserted.reason ?? 'Flow overlay component insertion failed')
    }
    project = inserted.nextDocument
    const resources = { assetFiles: {}, componentPackages: { ...withDefaultComponentController(project).componentPackages, [packageId]: component } }
    const view = buildFlowEditorView({ project, locationId: location.id })
    const target = captureFlowEditorAuthoringTarget({
      view,
      sessionToken: {
        locationId: location.id,
        surfaceType: 'flow',
        revision: project.revision,
        generation: 1,
      },
      target: { kind: 'overlay', layerItemId: 'overlay-component-to-convert' },
    })
    const plan = await prepareFlowOverlayComponentConversion({
      project,
      resources,
      target,
      destination: { parentBlockId: null, index: 1, wrap: 'none' },
      now: '2026-09-07T08:00:02.000Z',
    })
    const step = createEditorTransactionStep(project, plan)
    if (!step) throw new Error('Conversion did not produce an editor transaction step')
    const applied = applyEditorTransactionStep({ document: project, resources }, step, 'forward')
    const convertedId = plan.selectionHint?.itemIds?.[0]
    if (!convertedId) throw new Error('Converted body block selection is missing')

    let history = commitFlowEditorTransactionHistory(createFlowEditorHistory(project), step)
    const undoTransition = flowEditorUndoResourceTransition(history)
    if (!undoTransition) throw new Error('Conversion did not create one undoable resource transaction')
    const undoneResources = applyHistoryResourceChanges(
      applied.resources,
      undoTransition.resourceChanges,
      undoTransition.resourceDirection,
    )
    history = undoFlowEditorHistory(history)
    const undoneSurface = history.present.surfaces.find((candidate: any) => candidate.id === surface.id)
    const undoneToOverlay = undoneSurface?.type === 'flow'
      && undoneSurface.surfaceLayerItems.some((entry: any) => entry.item.layerItemId === 'overlay-component-to-convert')
      && !undoneSurface.blocks.some((block: any) => block.id === convertedId)
      && Object.keys(undoneResources.assetFiles).length === 0
    const redoTransition = flowEditorRedoResourceTransition(history)
    if (!redoTransition) throw new Error('Conversion did not create one redoable resource transaction')
    const redoneResources = applyHistoryResourceChanges(
      undoneResources,
      redoTransition.resourceChanges,
      redoTransition.resourceDirection,
    )
    history = redoFlowEditorHistory(history)
    const redoneSurface = history.present.surfaces.find((candidate: any) => candidate.id === surface.id)
    const redoneToBody = redoneSurface?.type === 'flow'
      && !redoneSurface.surfaceLayerItems.some((entry: any) => entry.item.layerItemId === 'overlay-component-to-convert')
      && redoneSurface.blocks.some((block: any) => block.id === convertedId)
      && Object.keys(redoneResources.assetFiles).length === 1

    const reversed = convertFlowComponentBlockToOverlay(
      applied.document,
      selectFlowEditorBlock(applied.document, location.id, convertedId),
      { now: '2026-09-07T08:00:02.500Z' },
    )
    const reversedItem = reversed.createdLayerItemIds?.[0]
      ? reversed.nextDocument?.surfaces
        .find((candidate: any) => candidate.id === surface.id)?.surfaceLayerItems
        .find((entry: any) => entry.item.layerItemId === reversed.createdLayerItemIds[0])?.item
      : undefined
    const reversePreserved = reversed.ok
      && reversedItem?.kind === 'component'
      && reversedItem.component.packageId === packageId
      && reversedItem.props.label === '正文组件'
      && reversedItem.staticFallbackAssetId === plan.resourceChanges.assetFileChanges?.[0]?.assetId

    const archiveBytes = createCourseProjectArchive({
      project: applied.document,
      assetFiles: applied.resources.assetFiles,
      componentFiles: componentPackagesToArchiveFiles(applied.resources.componentPackages),
    }, { mtime: '2026-09-07T08:00:03.000Z' })
    const reopened = openCourseProjectArchive(archiveBytes)
    const reopenedComponents = Object.fromEntries(Object.entries(reopened.componentFiles).map(
      ([key, files]) => [key, parseComponentPackageFiles(files)],
    ))
    const published = buildPublishedCourseV2Payload({
      project: reopened.project,
      assetFiles: reopened.assetFiles,
      components: reopenedComponents,
    })
    const reopenedSurface = reopened.project.surfaces.find((candidate: any) => candidate.id === surface.id)
    if (!reopenedSurface || reopenedSurface.type !== 'flow') throw new Error('Reopened Flow surface is missing')
    const bodyComponents = reopenedSurface.blocks.filter((block: any) => block.type === 'component')
    const originalOverlayCount = reopenedSurface.surfaceLayerItems.filter(
      (entry: any) => entry.item.layerItemId === 'overlay-component-to-convert',
    ).length
    const capturedAssetId = bodyComponents.find((block: any) => block.id === convertedId)?.staticFallbackAssetId
    const capturedBytes = capturedAssetId ? reopened.assetFiles[capturedAssetId] : undefined

    const root = document.createElement('div')
    root.id = 'flow-component-conversion-probe'
    root.style.cssText = 'position:fixed;inset:0;width:1280px;height:720px;background:white;z-index:999999'
    document.body.append(root)
    const session = createPublishedCourseSession(published, { initialLocationId: location.id })
    let publishedBefore = ''
    let publishedAfter = ''
    try {
      await session.mount(root)
      const mount = root.querySelector(`[data-flow-block-id="${convertedId}"] .published-component-mount`)
      const button = mount?.shadowRoot?.querySelector<HTMLButtonElement>('[data-flow-conversion-counter]')
      if (!button) throw new Error('Converted body component did not mount in Published Flow')
      publishedBefore = button.textContent ?? ''
      button.click()
      publishedAfter = button.textContent ?? ''
    } finally {
      await session.destroy()
      root.remove()
    }

    const projection = buildFlowDocxProjection(published, surface.id)
    const projectedBodyComponents = projection.nodes.filter((node: any) => (
      node.type === 'component' && node.blockId === convertedId
    )).length
    const projectedOriginalOverlays = [
      ...projection.documentStartItems,
      ...projection.footerItems,
      ...projection.anchoredGroups.flatMap((group: any) => group.items),
    ].filter((item: any) => item.layerItemId === 'overlay-component-to-convert').length

    return {
      archiveByteLength: archiveBytes.byteLength,
      bodyComponentCount: bodyComponents.length,
      originalOverlayCount,
      selectionItemIds: plan.selectionHint?.itemIds ?? [],
      capturedAssetId,
      capturedPngSignature: capturedBytes ? Array.from(capturedBytes.slice(0, 8)) : [],
      undoneToOverlay,
      redoneToBody,
      reversePreserved,
      publishedBefore,
      publishedAfter,
      projectedBodyComponents,
      projectedOriginalOverlays,
    }
  })
}

/** Installs a valid-fallback component into the live editor Store. */
export async function installFlowComponentConversionUiFixture(page: Page) {
  return page.evaluate(async () => {
    const load = (path: string): Promise<any> => import(path)
    const { createBlankFlowCourseProject } = await load('/src/renderer/project/createFlowCourseProject.ts')
    const { parseComponentPackageFiles } = await load('/src/core/drivers/codecs/importComponentPackage.ts')
    const { withDefaultComponentController } = await load('/src/renderer/components/teacherControllerComponent.ts')
    const { componentPackagesToArchiveFiles } = await load('/src/renderer/components/componentPackageStore.ts')
    const { componentPackageMeta } = await load('/src/shared/componentPackageMeta.ts')
    const { insertFlowSharedComponent } = await load('/src/renderer/course/flowSharedAuthoringAdapters.ts')
    const { selectFlowEditorBlock, selectFlowOverlay } = await load('/src/renderer/course/flowEditorSlice.ts')
    const { courseProjectDocumentSchema } = await load('/src/shared/courseProjectSchema.ts')
    const { useEditorStore } = await load('/src/renderer/store/editorStore.ts')

    const packageId = 'com.example.flow-conversion-ui-probe'
    const manifest = {
      schemaVersion: 4,
      runtimeApiVersion: 4,
      renderMode: 'dom',
      supportedScopes: ['scene', 'global'],
      id: packageId,
      name: 'Flow UI conversion probe',
      version: '1.0.0',
      entry: 'runtime.js',
      defaultSize: { width: 480, height: 280 },
      minSize: { width: 120, height: 80 },
      preserveAspectRatio: false,
      assets: {},
      defaultProps: { label: 'UI 正文组件' },
    }
    const component = parseComponentPackageFiles({
      'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
      'runtime.js': new TextEncoder().encode(
        `CoursewareComponent.define({id:'${packageId}',runtimeApiVersion:4,create(ctx){const el=document.createElement('div');el.textContent=ctx.props.label;el.style.cssText='width:100%;height:100%;display:grid;place-items:center;background:#dcfce7;color:#14532d;font:24px sans-serif';ctx.dom.root.append(el);return{destroy(){el.remove()}}}})`,
      ),
    })
    const fallback = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZAAAAABJRU5ErkJggg=='),
      (char) => char.charCodeAt(0),
    )
    let project = createBlankFlowCourseProject({
      id: 'flow-component-conversion-ui-probe',
      title: 'Flow component conversion UI probe',
      now: '2026-09-07T08:10:00.000Z',
    })
    project.componentPackages[packageId] = componentPackageMeta(component)
    project.assets['ui-existing-fallback'] = {
      id: 'ui-existing-fallback',
      filename: 'ui-existing-fallback.png',
      path: 'assets/ui-existing-fallback.png',
      kind: 'image',
      mimeType: 'image/png',
      byteLength: fallback.byteLength,
      width: 1,
      height: 1,
    }
    const surface = project.surfaces.find((candidate: any) => candidate.type === 'flow')
    const location = project.locations.find((candidate: any) => candidate.kind === 'flow-block')
    if (!surface || surface.type !== 'flow' || !location || location.kind !== 'flow-block') {
      throw new Error('Flow UI fixture was not created')
    }
    const paragraph = surface.blocks.find((block: any) => block.type === 'paragraph')
    if (!paragraph) throw new Error('Flow UI fixture paragraph is missing')
    surface.blocks.push({
      id: 'ui-nested-destination',
      type: 'section',
      title: { inlines: [{ type: 'text', text: '嵌套目标' }] },
      collapsedByDefault: false,
      blocks: [{ id: 'ui-nested-existing', type: 'paragraph', content: { inlines: [{ type: 'text', text: '已有正文' }] } }],
    })
    project = courseProjectDocumentSchema.parse(project)
    const inserted = insertFlowSharedComponent(
      project,
      selectFlowEditorBlock(project, location.id, paragraph.id),
      {
        packageId,
        manifest,
        id: 'ui-overlay-component',
        props: { label: 'UI 正文组件' },
        staticFallbackAssetId: 'ui-existing-fallback',
        placement: 'viewport-overlay',
      },
      { now: '2026-09-07T08:10:01.000Z' },
    )
    if (!inserted.ok || !inserted.nextDocument) {
      throw new Error(inserted.reason ?? 'Flow UI overlay insertion failed')
    }
    project = inserted.nextDocument
    useEditorStore.getState().loadCourseProject(
      project,
      null,
      { 'ui-existing-fallback': fallback },
      { ...withDefaultComponentController(project).componentPackages, [packageId]: component },
    )
    useEditorStore.getState().applyFlowSelection(
      selectFlowOverlay(project, location.id, ['ui-overlay-component']),
    )
    return {
      baseRevision: project.revision,
      locationId: location.id,
      surfaceId: surface.id,
      destinationId: 'ui-nested-destination',
      overlayId: 'ui-overlay-component',
    }
  })
}

export async function readFlowComponentConversionUiState(
  page: Page,
  fixture: {
    surfaceId: string
    destinationId: string
    overlayId: string
  },
) {
  return page.evaluate(async (input) => {
    const load = (path: string): Promise<any> => import(path)
    const { useEditorStore } = await load('/src/renderer/store/editorStore.ts')
    const state = useEditorStore.getState()
    const document = state.flowSession?.history.present
    const surface = document?.surfaces.find((candidate: any) => candidate.id === input.surfaceId)
    const destination = surface?.type === 'flow'
      ? surface.blocks.find((block: any) => block.id === input.destinationId)
      : undefined
    const children = destination?.type === 'section' ? destination.blocks : []
    const converted = children.find((block: any) => block.type === 'component')
    return {
      revision: document?.revision ?? -1,
      selectedBlockId: state.flowSession?.selection.selectedBlockId ?? null,
      selectedOverlayIds: state.flowSession?.selection.selectedOverlayIds ?? [],
      destinationChildIds: children.map((block: any) => block.id),
      destinationChildTypes: children.map((block: any) => block.type),
      convertedBlockId: converted?.id ?? null,
      overlayExists: surface?.type === 'flow' && surface.surfaceLayerItems.some(
        (entry: any) => entry.item.layerItemId === input.overlayId,
      ),
      capturedProjectAssetCount: document
        ? Object.keys(document.assets).filter((id) => id.startsWith('component-capture-')).length
        : -1,
      capturedResourceCount: Object.keys(state.assetFiles).filter(
        (id) => id.startsWith('component-capture-'),
      ).length,
    }
  }, fixture)
}
