import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { createServer } from 'vite'

test('Published student exact navigation reaches all three surfaces and preserves guarded course state', async ({ page }) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(10_000)
  const server = await createServer({
    configFile: resolve('vite.renderer.config.ts'),
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: { ignored: ['**/output/**'] } },
  })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Missing Vite address')
  const origin = `http://127.0.0.1:${address.port}`
  await page.route(`${origin}/`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0"></body></html>' }))
  try {
    await page.goto(origin)
    const ids = await page.evaluate(async () => {
      const load = (path: string): Promise<any> => import(path)
      const { createBlankCourseProject } = await load('/src/renderer/project/createCourseProject.ts')
      const { addCourseFlowPage, addCourseSpatialPage } = await load('/src/renderer/course/courseLocationCommands.ts')
      const { buildPublishedCourseV2Payload } = await load('/src/renderer/export/course/buildPublishedCourse.ts')
      const { createPublishedCourseSession } = await load('/src/player/surfaces/publishedDynamicHosts.ts')
      const { createTextNode } = await load('/src/renderer/project/nativeNodeFactories.ts')
      const { sceneNodeToCourseLayerItem } = await load('/src/shared/courseProjectModel.ts')
      let project = createBlankCourseProject({ title: '精确跨表面导航', includeDefaultController: false, controls: 'none' })
      project = addCourseFlowPage(project, {}).project
      project = addCourseSpatialPage(project, {}).project
      const locations = Object.fromEntries(project.locations.map((location: any) => [location.kind, location.id]))
      const ids = { slide: locations['slide-scene'], flow: locations['flow-block'], spatial: locations['spatial-camera'], named: 'slide-revealed-location' }
      project.locations.push({ ...project.locations.find((location: any) => location.id === ids.slide), id: ids.named, stateId: 'revealed' })
      project.courseState = [
        { key: 'unlocked', valueType: 'boolean', defaultValue: false },
        { key: 'answer', valueType: 'number', defaultValue: 0 },
      ]
      project.navigationGuards = [{
        id: 'flow-locked', effect: 'block', toLocationIds: [ids.flow], match: 'all',
        conditions: [{ type: 'compare', key: 'unlocked', operator: 'eq', value: false }], message: '先完成预测',
      }]
      const runtimeItem = (id: string) => ({
        kind: 'runtime', layerItemId: id, label: id,
        frame: { mode: 'absolute', x: 20, y: 20, width: 640, height: 280 },
        order: 100, visible: true, locked: false, rotation: 0, opacity: 1,
        hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
        runtime: {
          protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom',
          content: { values: {} }, assets: {},
          source: `CoursewareRuntime.define({ protocol:'surface-runtime', runtimeApiVersion:3, create(ctx) {
            var id=${JSON.stringify(id)}, targets=${JSON.stringify(ids)};
            var probes=window.__exactContexts||(window.__exactContexts={});
            (probes[id]||(probes[id]=[])).push(ctx);
            Object.keys(targets).concat(['missing','unlock']).forEach(function(key) {
              var button=document.createElement('button');
              button.textContent=id+' '+key; button.dataset.exactButton=id+'-'+key;
              Object.assign(button.style,{display:'block',font:'24px sans-serif',margin:'8px'});
              button.onclick=function(){
                if(key==='unlock'){ctx.courseState.set('unlocked',true);ctx.courseState.set('answer',42);return;}
                button.dataset.accepted=String(ctx.actions.goToLocation(targets[key]||'missing-location'));
              };
              ctx.dom.root.append(button);
            });
            return {destroy(){ctx.dom.root.replaceChildren();}};
          }});`,
        },
      })
      for (const surface of project.surfaces) {
        if (surface.type === 'slide') {
          surface.scenes[0].layerItems.push(runtimeItem('slide'))
          surface.scenes[0].presentation.states.push({ id: 'revealed', name: '已揭示', layerItemOverrides: {} })
          for (const [index, target] of (['flow', 'spatial', 'named'] as const).entries()) {
            const nodeId = `native-${target}`
            const native = sceneNodeToCourseLayerItem(createTextNode({ id: nodeId, text: `前往 ${target}`, x: 750, y: 150 + index * 100 }))
            native.order = 101 + index
            surface.scenes[0].layerItems.push(native)
            surface.scenes[0].interactions.push({ id: `exact-${target}`, enabled: true,
              trigger: { type: 'node.click', nodeId }, conditions: [], actions: [{
                id: `jump-${target}`, start: 'after-previous', delayMs: 0,
                action: { type: 'location.go', locationId: ids[target] },
              }],
            })
          }
        } else if (surface.type === 'flow') {
          surface.surfaceLayerItems.push({ item: runtimeItem('flow'), visibility: { mode: 'all', locationIds: [] } })
        } else {
          const native = sceneNodeToCourseLayerItem(createTextNode({ id: 'spatial-return', text: '返回 Slide', x: 100, y: 100 }))
          surface.world.layerItems.push(native)
          project.globalInteractions.push({ id: 'spatial-return', enabled: true,
            trigger: { type: 'node.click', nodeId: native.layerItemId }, conditions: [], actions: [{
              id: 'return-slide', start: 'after-previous', delayMs: 0,
              action: { type: 'location.go', locationId: ids.slide },
            }],
          })
        }
      }
      const payload = buildPublishedCourseV2Payload({ project, assetFiles: {}, components: {} })
      const container = document.createElement('div')
      Object.assign(container.style, { width: '1200px', height: '720px' })
      document.body.append(container)
      const session = createPublishedCourseSession(payload, { services: { reportDiagnostic: (diagnostic: any) => console.warn('exact-location-diagnostic', diagnostic) } })
      ;(window as any).__exactSession = session
      ;(window as any).__exactObservation = session.interactionRuns.observe('exact-flow', project.surfaces.find((surface: any) => surface.type === 'slide').id)
      ;(window as any).__exactNamedObservation = session.interactionRuns.observe('exact-named', project.surfaces.find((surface: any) => surface.type === 'slide').id)
      await session.mount(container)
      return ids
    })
    const state = () => page.evaluate(() => (window as any).__exactSession.readObservationState())
    const settled = async (locationId: string) => expect.poll(async () => {
      const current = await state()
      return current.ready ? current.locationId : ''
    }).toBe(locationId)
    const button = (id: string) => page.locator(`[data-exact-button="${id}"]`)
    await settled(ids.slide)
    await button('slide-flow').click()
    await expect(button('slide-flow')).toHaveAttribute('data-accepted', 'false')
    await button('slide-missing').click()
    await expect(button('slide-missing')).toHaveAttribute('data-accepted', 'false')
    await button('slide-slide').click()
    await expect(button('slide-slide')).toHaveAttribute('data-accepted', 'false')
    expect((await state()).publicState.courseState).toEqual({ unlocked: false, answer: 0 })
    await button('slide-unlock').click()
    await page.locator('[data-slide-layer-item="native-flow"]').click()
    await settled(ids.flow)
    await expect.poll(() => page.evaluate(() => (window as any).__exactObservation.read().at(-1)?.status)).toBe('navigation-terminal')
    const retired = await page.evaluate((target: string) => {
      const ctx = (window as any).__exactContexts.slide[0]
      ctx.courseState.set('answer', -1)
      return ctx.actions.goToLocation(target) === true
    }, ids.spatial)
    expect(retired).toBe(false)
    await settled(ids.flow)
    await button('flow-named').click()
    await settled(ids.named)
    expect((await state()).stateId).toBe('revealed')
    const beforeSameNamedLocation = await state()
    await button('slide-named').click()
    await expect(button('slide-named')).toHaveAttribute('data-accepted', 'false')
    await page.locator('[data-slide-layer-item="native-named"]').click()
    await expect.poll(() => page.evaluate(() => (window as any).__exactNamedObservation.read().at(-1)?.status)).toBe('failed')
    expect(await state()).toEqual(beforeSameNamedLocation)
    await page.locator('[data-slide-layer-item="native-spatial"]').click()
    await settled(ids.spatial)
    await page.locator('[data-layer-item-id="spatial-return"]').click()
    await settled(ids.slide)
    expect((await state()).stateId).toBe('state_initial')
    expect((await state()).publicState.courseState).toEqual({ unlocked: true, answer: 42 })
    await page.evaluate(async () => { await (window as any).__exactSession.destroy() })
    expect(await page.evaluate((target: string) => (window as any).__exactContexts.slide.at(-1).actions.goToLocation(target) === true, ids.flow)).toBe(false)
  } finally {
    await server.close()
  }
})
