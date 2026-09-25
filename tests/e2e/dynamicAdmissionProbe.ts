import type { Page } from 'playwright'

export async function runDynamicAdmissionProbe(page: Page) {
  return page.evaluate(async () => {
    const load = (path: string): Promise<any> => import(path)
    const { createProjectFontDeliveryFixture } = await load('/tests/fixtures/projectFontDelivery.ts')
    const { createAuthoringToolFacade } = await load('/src/renderer/authoring/tools/authoringToolFacade.ts')
    const { makeAuthoringAddress } = await load('/src/shared/authoringAddress.ts')
    const { applyEditorTransactionStep } = await load('/src/renderer/authoring/editorTransaction.ts')
    const { componentPackageAddress } = await load('/src/renderer/authoring/tools/componentPackageTool.ts')
    const { withDefaultComponentController } = await load('/src/renderer/components/teacherControllerComponent.ts')
    const font = new Uint8Array(await (await fetch('/node_modules/@fontsource-variable/noto-sans-sc/files/noto-sans-sc-latin-wght-normal.woff2')).arrayBuffer())
    const fallback = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII='), c => c.charCodeAt(0))
    const sources = await createProjectFontDeliveryFixture(font, fallback)
    let document = sources.project
    let resources = { assetFiles: sources.assetFiles,
      componentPackages: { ...withDefaultComponentController(document).componentPackages, ...sources.components } }
    let commits = 0
    const facade = createAuthoringToolFacade({ readDocument: () => document,
      readResources: () => resources,
      validateDestination: () => null,
      commit: (step: any) => { const applied = applyEditorTransactionStep({ document, resources }, step, 'forward'); document = applied.document; resources = applied.resources; commits++; return true },
    })
    const surface = document.surfaces[0]
    const scene = surface.scenes[0]
    scene.layerItems.find((item: any) => item.kind === 'runtime').runtime.content.values.caption = 'before'
    const target = () => ({ projectId: document.id, documentRevision: document.revision, revisionPolicy: { kind: 'exact' },
      sessionGeneration: 1, surfaceType: 'slide', surfaceId: surface.id, locationId: document.startLocationId,
      stateId: null, owner: 'scene', ownerKey: `scene:${scene.id}`, itemId: 'runtime-font',
      authoringAddress: makeAuthoringAddress({ projectId: document.id, scope: 'scene', surfaceId: surface.id, sceneId: scene.id, carrier: 'runtime', layerItemId: 'runtime-font', field: 'runtime/source' }) })
    const run = (source: string) => facade.execute({ version: 1, requestId: 'probe', tool: 'runtime.source', destination: { kind: 'update', target: target() }, input: { source } })
    const source = scene.layerItems.find((item: any) => item.kind === 'runtime').runtime.source
    const good = await run(source.replace('RuntimeFont loaded', 'RuntimeFont admitted'))
    const afterGood = commits
    const bad = await run('CoursewareRuntime.define({runtimeApiVersion:2,create(){throw new Error("admission fault")}})')
    const missing = await run(source.replace(/font-[^']+/, 'missing-font'))
    const runComponent = (version: string, runtimeSource: string) => {
      const data = sources.components['font-demo']
      const encode = (text: string) => btoa(unescape(encodeURIComponent(text)))
      return facade.execute({ version: 1, requestId: 'component-probe', tool: 'component.package',
        destination: { kind: 'update', target: { ...target(), owner: 'global', ownerKey: 'global', itemId: 'font-demo', authoringAddress: componentPackageAddress(document.id, 'font-demo') } },
        input: { operation: 'replace', files: { 'manifest.json': encode(JSON.stringify({ ...data.manifest, version })), 'runtime.js': encode(runtimeSource) } } })
    }
    const componentGood = await runComponent('1.0.1', sources.components['font-demo'].runtimeSource.replace('ComponentFont loaded', 'ComponentFont admitted'))
    const componentBad = await runComponent('1.0.2', 'CoursewareComponent.define({id:"font-demo",runtimeApiVersion:4,create(){throw new Error("component admission fault")}})')
    const timeout = await run('CoursewareRuntime.define({runtimeApiVersion:2,create(){return {prepareCapture(){return new Promise(function(){})},destroy(){}}}})')
    const pending = run('CoursewareRuntime.define({runtimeApiVersion:2,create(){return {prepareCapture(){return new Promise(resolve=>setTimeout(resolve,120))},destroy(){}}}})')
    document = { ...document, revision: document.revision + 1 }
    const stale = await pending
    const configure = (field: string, input: any) => facade.execute({ version: 1, requestId: 'configure', tool: 'runtime.configure',
      destination: { kind: 'update', target: { ...target(), authoringAddress: target().authoringAddress.replace(encodeURIComponent('runtime/source'), encodeURIComponent(field)) } }, input })
    const disabled = await configure('runtime/enabled', { field: 'enabled', initialValue: true, value: false })
    const configured = await configure('runtime/content/values/caption', { field: 'content', contentKey: 'caption', initialValue: 'before', value: 'after' })
    const conflict = await configure('runtime/content/values/caption', { field: 'content', contentKey: 'caption', initialValue: 'before', value: 'wrong' })
    document = structuredClone(document)
    const hiddenScene = document.surfaces[0].scenes[0]
    const hiddenComponent = hiddenScene.layerItems.find((item: any) => item.kind === 'component')
    hiddenComponent.visible = false
    hiddenScene.presentation = { initialStateId: 'base-state', states: [{ id: 'base-state', name: 'Base', layerItemOverrides: {} }, { id: 'hidden-state', name: 'Hidden', layerItemOverrides: { 'component-font': { visible: false } } }] }
    document = { ...document, revision: document.revision + 1 }
    const componentConfigured = await facade.execute({ version: 1, requestId: 'component-configure', tool: 'component.configure',
      destination: { kind: 'update', target: { ...target(), stateId: 'hidden-state', itemId: 'component-font',
        authoringAddress: makeAuthoringAddress({ projectId: document.id, scope: 'scene', surfaceId: surface.id, sceneId: scene.id, carrier: 'component', layerItemId: 'component-font', field: 'item' }) } }, input: { props: { caption: 'state only' } } })
    const stateOnlyFailure = await runComponent('1.0.3', 'CoursewareComponent.define({id:"font-demo",runtimeApiVersion:4,create(ctx){if(ctx.props.caption === "state only")throw new Error("named state admission fault");return {destroy(){}}}})')
    const summary = (receipt: any) => ({ status: receipt.status, before: receipt.beforeRevision, after: receipt.afterRevision, diagnostics: receipt.diagnostics })
    const finalScene = document.surfaces[0].scenes[0]
    const finalRuntime = finalScene.layerItems.find((item: any) => item.kind === 'runtime').runtime
    const { createCoursewareBuilderV2 } = await load('/src/renderer/course/coursewareBuilderV2.ts')
    const insertedRuntimes = []
    const insertedComponents = []
    const componentPlacements = []
    const captureFailures = []
    const runtimeUpdateFailures = []
    let distantComponentPreserved = false
    for (const surfaceType of ['slide', 'flow', 'spatial-2d']) {
      const builder = createCoursewareBuilderV2({ surfaceType, title: `Runtime ${surfaceType}` })
      const initial = builder.snapshot()
      builder.activate({ locationId: initial.scope.locationId, owner: 'global' })
      const media = await builder.execute('asset.media.import', { kind: 'image', filename: 'fallback.png', mimeType: 'image/png', base64: btoa(String.fromCharCode(...fallback)) },
        { kind: 'create', scope: builder.createScope({ parent: { kind: 'owner' }, insertion: { kind: 'append' } }) })
      if (media.status !== 'committed') throw new Error(JSON.stringify(media))
      builder.activate({ locationId: initial.scope.locationId, owner: initial.scope.owner })
      const api3 = surfaceType === 'flow'
      const runtime = { protocol: api3 ? 'surface-runtime' : 'canvas-runtime', runtimeApiVersion: api3 ? 3 : 2, enabled: true, renderMode: 'dom',
        source: `CoursewareRuntime.define({${api3 ? 'protocol:"surface-runtime",' : ''}runtimeApiVersion:${api3 ? 3 : 2},create(ctx){var p=document.createElement('p');p.textContent='inserted runtime';ctx.dom.root.appendChild(p);return {destroy(){p.remove()}}}})`,
        content: { values: {} }, assets: {}, staticFallback: { assetId: media.affected[0].id, coverage: 'scene' } }
      const inserted = await builder.execute('runtime.insert', { runtime }, { kind: 'create', scope: builder.createScope({ parent: { kind: 'owner' }, insertion: { kind: 'append' } }) })
      insertedRuntimes.push({ surfaceType, ...summary(inserted) })
      if (inserted.status === 'committed') {
        const runtimeId = inserted.affected[0].id
        const faults = [
          ...(api3 ? ['updateContent', 'updateAssets', 'resize'] : ['resize']).map(method => ({ method,
            body: `var sizes=0;return {${method}(){${method === 'resize' ? 'if(++sizes>1)' : ''}throw new Error("runtime update probe failure")},destroy(){}}` })),
          ...(window.desktopAPI?.dynamicAdmission ? [
            { method: 'async', body: 'setTimeout(()=>{throw new Error("queued runtime fault")},0);return {destroy(){}}' },
            { method: 'destroy-async', body: 'return {destroy(){setTimeout(()=>{throw new Error("queued destroy fault")},0)}}' },
            { method: 'leak-dom', body: 'document.body.appendChild(document.createElement("aside"));return {destroy(){}}' },
          ] : []),
        ]
        for (const { method, body } of faults) {
          const before = builder.finish()
          const runtimeTarget = builder.snapshot().targets.content.find((entry: any) => entry.itemId === runtimeId)
          const receipt = await builder.execute('runtime.source', { source: `CoursewareRuntime.define({runtimeApiVersion:${api3 ? 3 : 2},create(){${body}}})` },
            { kind: 'update', target: { ...runtimeTarget, authoringAddress: inserted.affected[0].authoringAddress } })
          const after = builder.finish()
          runtimeUpdateFailures.push({ surfaceType, method, ...summary(receipt),
            projectUnchanged: JSON.stringify(before.project) === JSON.stringify(after.project),
            resourcesUnchanged: JSON.stringify([before.assetFiles, before.componentFiles]) === JSON.stringify([after.assetFiles, after.componentFiles]) })
        }
      }
      const encode = (value: string) => btoa(unescape(encodeURIComponent(value)))
      const component = await builder.execute('component.insert', { operation: 'candidate', staticFallbackAssetId: media.affected[0].id,
        files: { 'manifest.json': encode(JSON.stringify(sources.components['font-demo'].manifest)),
          'runtime.js': encode('CoursewareComponent.define({id:"font-demo",runtimeApiVersion:4,create(ctx){var p=document.createElement("p");p.textContent="candidate component";ctx.dom.root.appendChild(p);return {destroy(){p.remove()}}}})') } },
      { kind: 'create', scope: builder.createScope({ parent: surfaceType === 'flow' ? { kind: 'flow-body', parentBlockId: null } : { kind: 'owner' }, insertion: { kind: 'append' } }) })
      insertedComponents.push({ surfaceType, ...summary(component) })
      if (component.status === 'committed') {
        if (surfaceType !== 'flow') {
          const id = component.affected[0].id
          const target = builder.snapshot().targets.content.find((entry: any) => entry.itemId === id)
          const receipt = await builder.execute('component.configure', { properties: { frame: { x: 40, y: 80, width: 320, height: 180 }, label: 'Placed component' } }, { kind: 'update', target })
          const { resolveEffectiveLayerTarget } = await load('/src/renderer/course/effectiveLayerCommands.ts')
          const item = resolveEffectiveLayerTarget(builder.finish().project, target).item
          componentPlacements.push({ surfaceType, ...summary(receipt), frame: item.frame, label: item.label })
        }
        builder.activate({ locationId: initial.scope.locationId, owner: 'global' })
        const { parent: _parent, insertion: _insertion, ...wire } = builder.createScope({ parent: { kind: 'owner' }, insertion: { kind: 'append' } })
        const cases = [
          { phase: 'update', body: 'return {updateProps(){throw new Error("update probe failure")},destroy(){}}' },
          { phase: 'resize', body: 'var sizes=0;return {resize(){if(++sizes>1)throw new Error("resize probe failure")},destroy(){}}' },
          { phase: 'suspend', body: 'return {suspend(){throw new Error("suspend probe failure")},destroy(){}}' },
          { phase: 'resume', body: 'return {resume(){throw new Error("resume probe failure")},destroy(){}}' },
          { phase: 'prepare', body: 'return {prepareCapture(){throw new Error("capture probe failure")},destroy(){}}' },
          ...(surfaceType === 'flow' ? [
            { phase: 'reject', body: 'ctx.capture.waitUntil(Promise.reject(new Error("capture task rejected")));return {destroy(){}}' },
            { phase: 'timeout', body: 'ctx.capture.waitUntil(new Promise(function(){}));return {destroy(){}}' },
          ] : []),
        ]
        for (const entry of cases) {
          const before = builder.finish()
          const receipt = await builder.execute('component.package', { operation: 'replace', files: {
            'manifest.json': encode(JSON.stringify({ ...sources.components['font-demo'].manifest, version: '1.0.9' })),
            'runtime.js': encode(`CoursewareComponent.define({id:"font-demo",runtimeApiVersion:4,create(ctx){var p=document.createElement("p");p.textContent="lifecycle failure probe";ctx.dom.root.appendChild(p);${entry.body}}})`),
          } }, { kind: 'update', target: { ...wire, itemId: 'font-demo', authoringAddress: componentPackageAddress(before.project.id, 'font-demo') } })
          const after = builder.finish()
          captureFailures.push({ surfaceType, phase: entry.phase, ...summary(receipt),
            projectUnchanged: JSON.stringify(before.project) === JSON.stringify(after.project),
            resourcesUnchanged: JSON.stringify([before.assetFiles, before.componentFiles]) === JSON.stringify([after.assetFiles, after.componentFiles]),
          })
        }
      }
      if (surfaceType === 'spatial-2d' && component.status === 'committed') {
        const output = builder.finish()
        const world = output.project.surfaces[0]
        const item = world.world.layerItems.find((entry: any) => entry.kind === 'component')
        item.frame.x = 100000
        item.visible = false
        world.semanticZoom = [{ id: 'hide', layerItemIds: [item.layerItemId], minZoom: 0.01, maxZoom: 1000, visible: false }]
        const original = JSON.stringify(output.project)
        const { parseComponentPackageFiles } = await load('/src/core/drivers/codecs/importComponentPackage.ts')
        const { admitDynamicCandidate } = await load('/src/renderer/authoring/tools/dynamicCandidateAdmission.ts')
        const componentPackages = Object.fromEntries(Object.values(output.componentFiles).map((files: any) => {
          const data = parseComponentPackageFiles(files)
          return [data.manifest.id, data]
        }))
        await admitDynamicCandidate(output.project, { assetFiles: output.assetFiles, componentPackages },
          [{ locationId: output.project.startLocationId, instanceIds: [item.layerItemId] }])
        distantComponentPreserved = JSON.stringify(output.project) === original
      }
    }
    return { captureFailures, runtimeUpdateFailures, componentPlacements, stateOnlyFailure: summary(stateOnlyFailure), insertedRuntimes, insertedComponents, distantComponentPreserved, disabled: summary(disabled), configured: summary(configured), conflict: summary(conflict), componentConfigured: summary(componentConfigured),
      runtimeEnabled: finalRuntime.enabled, runtimeCaption: finalRuntime.content.values.caption,
      componentVisible: finalScene.layerItems.find((item: any) => item.kind === 'component').visible,
      componentBaseProps: finalScene.layerItems.find((item: any) => item.kind === 'component').props,
      componentStateProps: finalScene.presentation.states[1]?.layerItemOverrides['component-font']?.componentProps,
      good: summary(good), bad: summary(bad), missing: summary(missing), componentGood: summary(componentGood), componentBad: summary(componentBad), timeout: summary(timeout), stale: summary(stale), commits, afterGood,
      packageVersion: resources.componentPackages['font-demo'].manifest.version, leakedRoots: window.document.querySelectorAll('[aria-hidden="true"][style*="-1400px"]').length }
  })
}
