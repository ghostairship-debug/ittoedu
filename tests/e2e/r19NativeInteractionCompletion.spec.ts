import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium, expect, test } from '@playwright/test'
import { createServer } from 'vite'

test('U03-real-player-navigation checks completion, wrong destination and cancellation in Chromium', async () => {
  test.setTimeout(90_000)
  const output = resolve('output/u03-real-player-navigation', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(output, { recursive: true })
  const server = await createServer({
    configFile: resolve('vite.renderer.config.ts'),
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    plugins: [{
      name: 'u03-browser-probe', enforce: 'pre',
      resolveId(id) { if (id === 'virtual:player-bundle') return '\0u03-existing-player-bundle' },
      load(id) {
        if (id === '\0u03-existing-player-bundle') return `export default ${JSON.stringify(readFileSync(
          resolve(process.env.COURSEWARE_U03_PLAYER_BUNDLE ?? 'dist-player/player.iife.js'), 'utf8'))}`
      },
      configureServer(vite) {
        vite.middlewares.use('/u03-probe', (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end('<!doctype html><html><body style="margin:0;background:#eef2f6"><div id="stage" style="position:relative;width:1280px;height:720px"></div></body></html>')
        })
      },
    }],
  })
  await server.listen()
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  try {
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing probe HTTP port')
    await page.goto(`http://127.0.0.1:${address.port}/u03-probe`)
    const facts = await page.evaluate(async () => {
      const load = (path: string) => import(path)
      const { createBlankCourseProject } = await load('/src/renderer/project/createCourseProject.ts') as typeof import('../../src/renderer/project/createCourseProject')
      const { addCourseScene } = await load('/src/renderer/course/courseLocationCommands.ts') as typeof import('../../src/renderer/course/courseLocationCommands')
      const { createTextNode } = await load('/src/renderer/project/nativeNodeFactories.ts') as typeof import('../../src/renderer/project/nativeNodeFactories')
      const { sceneNodeToCourseLayerItem } = await load('/src/shared/courseProjectModel.ts') as typeof import('../../src/shared/courseProjectModel')
      const { verifyNativeInteractions } = await load('/src/renderer/authoring/generation/nativeInteractionVerification.ts') as typeof import('../../src/renderer/authoring/generation/nativeInteractionVerification')
      const { createPublishedCourseSession } = await load('/src/player/surfaces/publishedDynamicHosts.ts') as typeof import('../../src/player/surfaces/publishedDynamicHosts')
      const { buildPublishedCourseV2Payload } = await load('/src/renderer/export/course/buildPublishedCourse.ts') as typeof import('../../src/renderer/export/course/buildPublishedCourse')
      const { MixedCourseNavigator } = await load('/src/player/surfaces/mixed/MixedCourseNavigator.ts') as typeof import('../../src/player/surfaces/mixed/MixedCourseNavigator')
      let project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
      const surfaceId = project.surfaces.find(surface => surface.type === 'slide')!.id
      for (let index = 0; index < 2; index++) {
        const result = addCourseScene(project, { surfaceId, expectedRevision: project.revision, now: new Date().toISOString() })
        if (!result.ok) throw new Error(result.reason)
        project = result.project
      }
      const slide = project.surfaces.find(surface => surface.type === 'slide')!
      const [scene, target, wrong] = slide.scenes
      scene!.layerItems.push(sceneNodeToCourseLayerItem(createTextNode({ id: 'button', text: '继续：验证真实导航', x: 240, y: 280, width: 800 }), 1))
      target!.layerItems.push(sceneNodeToCourseLayerItem(createTextNode({ id: 'destination', text: '已到达正确目的地', x: 240, y: 280, width: 800 }), 1))
      scene!.presentation = { initialStateId: 'initial', states: [
        { id: 'initial', name: '初始', layerItemOverrides: {} },
        { id: 'revealed', name: '揭示', layerItemOverrides: {} },
      ] }
      const before = structuredClone(project), teacherBefore = JSON.stringify(before)
      scene!.interactions = [{ id: 'click', enabled: true, trigger: { type: 'node.click', nodeId: 'button' }, conditions: [], actions: [
        { id: 'navigate', start: 'after-previous', delayMs: 0, action: { type: 'presentation.set', stateId: 'revealed' } },
      ] }]
      const input = () => ({ before, document: project, resources: { assetFiles: {}, componentPackages: {} }, signal: new AbortController().signal, deadlineAt: Date.now() + 10_000 })
      const state = await verifyNativeInteractions(input())
      scene!.interactions[0]!.actions[0]!.action = { type: 'scene.go', sceneId: target!.id }
      const navigation = await verifyNativeInteractions(input())
      const targetLocation = project.locations.find(location => location.kind === 'slide-scene' && location.sceneId === target!.id)!.id
      const wrongLocation = project.locations.find(location => location.kind === 'slide-scene' && location.sceneId === wrong!.id)!.id
      // Fault injection at the actual navigator boundary proves that completion
      // cannot pass just because a Promise resolves or a controller unmounts.
      const goToLocation = MixedCourseNavigator.prototype.goToLocation
      let mismatch: { message: string; evidence?: unknown } | null = null
      try {
        MixedCourseNavigator.prototype.goToLocation = function(locationId, options) {
          return goToLocation.call(this, locationId === targetLocation ? wrongLocation : locationId, options)
        }
        await verifyNativeInteractions(input())
      } catch (error) {
        mismatch = { message: String(error), evidence: (error as { nativeInteractionEvidence?: unknown }).nativeInteractionEvidence }
      } finally { MixedCourseNavigator.prototype.goToLocation = goToLocation }
      scene!.interactions[0]!.actions[0]!.delayMs = 1500
      const abort = new AbortController()
      const cancelAfterClick = () => { setTimeout(() => abort.abort(), 25) }
      document.addEventListener('click', cancelAfterClick, { once: true, capture: true })
      let cancellation: string | null = null
      try { await verifyNativeInteractions({ ...input(), signal: abort.signal }) }
      catch (error) { cancellation = String(error) }
      finally { document.removeEventListener('click', cancelAfterClick, true) }
      scene!.interactions[0]!.actions[0]!.delayMs = 0
      const payload = buildPublishedCourseV2Payload({ project, assetFiles: {}, components: {} })
      const session = createPublishedCourseSession(payload)
      await session.mount(document.getElementById('stage')!)
      const observation = session.interactionRuns.observe('click', surfaceId)
      Reflect.set(window, '__u03', { session, observation })
      return { state, navigation, mismatch, cancellation, targetLocation, wrongLocation, teacherUnchanged: JSON.stringify(before) === teacherBefore }
    })
    expect(facts.state.checked).toEqual(['click'])
    expect(facts.state.evidence?.[0]).toMatchObject({ status: 'checked', runStatus: 'navigation-terminal', start: { stateId: 'initial' }, end: { stateId: 'revealed' } })
    expect(facts.navigation.evidence?.[0]).toMatchObject({ status: 'checked', runStatus: 'navigation-terminal', end: { locationId: facts.targetLocation } })
    expect(facts.mismatch?.message).toContain(facts.wrongLocation)
    expect(facts.mismatch?.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'failed' })]))
    expect(facts.cancellation).toContain('stale')
    expect(facts.teacherUnchanged).toBe(true)
    await page.locator('#stage [data-slide-layer-item="button"]').click()
    await expect.poll(() => page.evaluate(() => {
      const probe = Reflect.get(window, '__u03') as { observation: { read(): Array<{ status: string }> } }
      return probe.observation.read()[0]?.status
    })).toBe('navigation-terminal')
    await expect(page.locator('#stage [data-slide-layer-item="destination"]')).toBeVisible()
    await page.screenshot({ path: join(output, 'correct-destination.png') })
    writeFileSync(join(output, 'facts.json'), JSON.stringify({ status: 'passed', ...facts }, null, 2))
    await page.evaluate(async () => { const probe = Reflect.get(window, '__u03') as { session: { destroy(): Promise<void> } }; await probe.session.destroy() })
  } finally {
    await browser.close()
    await server.close()
  }
})

test('global Native click enumeration checks Slide to Flow and rejects a wrong destination in Chromium', async () => {
  test.setTimeout(60_000)
  const server = await createServer({
    configFile: resolve('vite.renderer.config.ts'),
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    plugins: [{
      name: 'global-native-navigation-probe',
      configureServer(vite) {
        vite.middlewares.use('/global-native-navigation-probe', (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end('<!doctype html><html><body></body></html>')
        })
      },
    }],
  })
  await server.listen()
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  try {
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing probe HTTP port')
    await page.goto(`http://127.0.0.1:${address.port}/global-native-navigation-probe`)
    const facts = await page.evaluate(async () => {
      const load = (path: string) => import(path)
      const { createBlankCourseProject } = await load('/src/renderer/project/createCourseProject.ts') as typeof import('../../src/renderer/project/createCourseProject')
      const { addCourseFlowPage } = await load('/src/renderer/course/courseLocationCommands.ts') as typeof import('../../src/renderer/course/courseLocationCommands')
      const { createTextNode } = await load('/src/renderer/project/nativeNodeFactories.ts') as typeof import('../../src/renderer/project/nativeNodeFactories')
      const { sceneNodeToCourseLayerItem } = await load('/src/shared/courseProjectModel.ts') as typeof import('../../src/shared/courseProjectModel')
      const { nativeInteractionChecks, verifyNativeInteractions } = await load('/src/renderer/authoring/generation/nativeInteractionVerification.ts') as typeof import('../../src/renderer/authoring/generation/nativeInteractionVerification')
      const { MixedCourseNavigator } = await load('/src/player/surfaces/mixed/MixedCourseNavigator.ts') as typeof import('../../src/player/surfaces/mixed/MixedCourseNavigator')

      let project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
      const firstFlow = addCourseFlowPage(project, { expectedRevision: project.revision })
      if (!firstFlow.ok) throw new Error(firstFlow.reason)
      project = firstFlow.project
      const secondFlow = addCourseFlowPage(project, { expectedRevision: project.revision })
      if (!secondFlow.ok) throw new Error(secondFlow.reason)
      project = secondFlow.project
      const slide = project.surfaces.find(surface => surface.type === 'slide')!
      const scene = slide.scenes[0]!
      scene.layerItems.push(sceneNodeToCourseLayerItem(createTextNode({
        id: 'local-native-button', text: '进入流式讲义', x: 240, y: 280, width: 800,
      }), 1))
      const before = structuredClone(project)
      project.globalInteractions = [{
        id: 'global-slide-to-flow',
        enabled: true,
        trigger: { type: 'node.click', nodeId: 'local-native-button' },
        conditions: [{ type: 'scene.in', sceneIds: [scene.id] }],
        actions: [{
          id: 'go-to-flow', start: 'after-previous', delayMs: 0,
          action: { type: 'location.go', locationId: firstFlow.activatedLocationId },
        }],
      }]
      const input = () => ({
        before,
        document: project,
        resources: { assetFiles: {}, componentPackages: {} },
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 10_000,
      })
      const enumeration = nativeInteractionChecks(before, project)
      const localButton = scene.layerItems.pop()!
      project.globalLayerItems.push({
        item: localButton,
        plane: 'overlay',
        visibility: { mode: 'all', locationIds: [] },
      })
      const success = await verifyNativeInteractions(input())

      const goToLocation = MixedCourseNavigator.prototype.goToLocation
      let mismatch: { message: string; evidence?: unknown } | null = null
      try {
        MixedCourseNavigator.prototype.goToLocation = function(locationId, options) {
          return goToLocation.call(
            this,
            locationId === firstFlow.activatedLocationId ? secondFlow.activatedLocationId : locationId,
            options,
          )
        }
        await verifyNativeInteractions(input())
      } catch (error) {
        mismatch = {
          message: String(error),
          evidence: (error as { nativeInteractionEvidence?: unknown }).nativeInteractionEvidence,
        }
      } finally {
        MixedCourseNavigator.prototype.goToLocation = goToLocation
      }
      return {
        checks: enumeration.checks.map(check => ({
          scope: check.scope,
          locationId: check.locationId,
          nodeId: check.nodeId,
          ruleId: check.rule.id,
        })),
        skipped: enumeration.skipped,
        success,
        mismatch,
        slideLocationId: project.startLocationId,
        targetFlowLocationId: firstFlow.activatedLocationId,
        wrongFlowLocationId: secondFlow.activatedLocationId,
      }
    })

    expect(facts.checks).toEqual([{
      scope: 'global',
      locationId: facts.slideLocationId,
      nodeId: 'local-native-button',
      ruleId: 'global-slide-to-flow',
    }])
    expect(facts.skipped).toEqual([])
    expect(facts.success.checked).toEqual(['global-slide-to-flow'])
    expect(facts.success.evidence).toEqual(expect.arrayContaining([expect.objectContaining({
      ruleId: 'global-slide-to-flow',
      status: 'checked',
      runStatus: 'navigation-terminal',
      start: expect.objectContaining({ locationId: facts.slideLocationId }),
      end: expect.objectContaining({ locationId: facts.targetFlowLocationId }),
    })]))
    expect(facts.mismatch?.message).toContain(facts.wrongFlowLocationId)
    expect(facts.mismatch?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'global-slide-to-flow', status: 'failed' }),
    ]))
  } finally {
    await browser.close()
    await server.close()
  }
})
