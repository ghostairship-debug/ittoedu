import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium, expect, test } from '@playwright/test'
import { createServer } from 'vite'
import sharp from 'sharp'

async function picture(label: string, background: string, accent: string): Promise<string> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
    <rect width="320" height="180" rx="18" fill="${background}"/>
    <circle cx="80" cy="74" r="38" fill="${accent}" opacity=".9"/>
    <path d="M20 156 112 72l54 48 42-38 92 74Z" fill="#fff" opacity=".78"/>
    <text x="286" y="42" text-anchor="end" font-family="Arial" font-size="28" font-weight="700" fill="#fff">${label}</text>
  </svg>`
  return (await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64')
}

test('U06-real-layout commits rebased grouped layout and renders three readable image-description columns', async () => {
  test.setTimeout(90_000)
  const output = resolve('output/u06-real-layout', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(output, { recursive: true })
  const encodedImages = await Promise.all([
    picture('A', '#2563eb', '#facc15'),
    picture('B', '#059669', '#f97316'),
    picture('C', '#7c3aed', '#38bdf8'),
  ])
  const server = await createServer({
    configFile: resolve('vite.renderer.config.ts'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**'] } },
    plugins: [{
      name: 'u06-browser-probe', enforce: 'pre',
      resolveId(id) { if (id === 'virtual:player-bundle') return '\0u06-existing-player-bundle' },
      load(id) {
        if (id === '\0u06-existing-player-bundle') return `export default ${JSON.stringify(readFileSync(
          resolve(process.env.COURSEWARE_U06_PLAYER_BUNDLE ?? 'dist-player/player.iife.js'), 'utf8'))}`
      },
      configureServer(vite) {
        vite.middlewares.use('/u06-probe', (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end('<!doctype html><html><body style="margin:0;background:#e5e7eb"><div id="stage" style="position:relative;width:1280px;height:720px;background:#fff;overflow:hidden"></div></body></html>')
        })
      },
    }],
  })
  await server.listen()
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  try {
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing U06 probe HTTP port')
    await page.goto(`http://127.0.0.1:${address.port}/u06-probe`)
    const preparation = await page.evaluate(async (imageBase64) => {
      const load = (path: string) => import(/* @vite-ignore */ path)
      const { createBlankCourseProject } = await load('/src/renderer/project/createCourseProject.ts') as typeof import('../../src/renderer/project/createCourseProject')
      const { createImageNode, createTextNode } = await load('/src/renderer/project/nativeNodeFactories.ts') as typeof import('../../src/renderer/project/nativeNodeFactories')
      const { sceneNodeToCourseLayerItem } = await load('/src/shared/courseProjectModel.ts') as typeof import('../../src/shared/courseProjectModel')
      const { courseProjectDocumentSchema } = await load('/src/shared/courseProjectSchema.ts') as typeof import('../../src/shared/courseProjectSchema')
      const { projectEffectiveLayers } = await load('/src/renderer/course/effectiveLayerProjection.ts') as typeof import('../../src/renderer/course/effectiveLayerProjection')
      const { captureGenerationSnapshot } = await load('/src/renderer/authoring/generation/generationSnapshot.ts') as typeof import('../../src/renderer/authoring/generation/generationSnapshot')
      const { createGenerationCandidateCoordinator } = await load('/src/renderer/authoring/generation/prepareGenerationCandidate.ts') as typeof import('../../src/renderer/authoring/generation/prepareGenerationCandidate')
      const { applyEditorTransactionStep } = await load('/src/renderer/authoring/editorTransaction.ts') as typeof import('../../src/renderer/authoring/editorTransaction')
      const { buildPublishedCourseV2Payload } = await load('/src/renderer/export/course/buildPublishedCourse.ts') as typeof import('../../src/renderer/export/course/buildPublishedCourse')
      const { createPublishedCourseSession } = await load('/src/player/surfaces/publishedDynamicHosts.ts') as typeof import('../../src/player/surfaces/publishedDynamicHosts')

      const project = createBlankCourseProject({
        id: 'u06-real-layout',
        now: '2026-09-17T00:00:00.000Z',
        includeDefaultController: false,
        controls: 'none',
        idFactory: () => 'scene',
      })
      const slide = project.surfaces[0]
      if (!slide || slide.type !== 'slide') throw new Error('Expected Slide project')
      const scene = slide.scenes[0]!
      const imageIds = ['u06-image-a', 'u06-image-b', 'u06-image-c']
      const descriptionIds = ['u06-description-a', 'u06-description-b', 'u06-description-c']
      const assetIds = ['u06-asset-a', 'u06-asset-b', 'u06-asset-c']
      const imageFrames = [
        { x: 80, y: 90, width: 260, height: 146 },
        { x: 560, y: 125, width: 280, height: 158 },
        { x: 920, y: 70, width: 280, height: 158 },
      ]
      const descriptionFrames = [
        { x: 80, y: 320, width: 280, height: 112 },
        { x: 560, y: 360, width: 280, height: 112 },
        { x: 920, y: 300, width: 280, height: 112 },
      ]
      assetIds.forEach((assetId, index) => {
        project.assets[assetId] = {
          id: assetId,
          filename: `${assetId}.png`,
          mimeType: 'image/png',
          kind: 'image',
          path: `assets/${assetId}.png`,
          byteLength: atob(imageBase64[index]!).length,
          width: 320,
          height: 180,
        }
        scene.layerItems.push(sceneNodeToCourseLayerItem(createImageNode({
          id: imageIds[index]!,
          name: `景观图 ${index + 1}`,
          assetId,
          ...imageFrames[index]!,
          preserveAspectRatio: true,
          fit: 'contain',
        }), index * 2 + 1))
        scene.layerItems.push(sceneNodeToCourseLayerItem(createTextNode({
          id: descriptionIds[index]!,
          name: `说明 ${index + 1}`,
          text: index === 0 ? '待完善的第一列说明' : index === 1 ? '森林涵养水源并为生物提供栖息地。' : '湿地调蓄洪水，也维持丰富的生物多样性。',
          ...descriptionFrames[index]!,
          style: { fontSize: 24, color: '#172033', overflow: 'fixed', lineSpacing: 1.35, padding: 10 },
        }), index * 2 + 2))
      })
      const assetFiles = Object.fromEntries(assetIds.map((id, index) => {
        const binary = atob(imageBase64[index]!)
        return [id, Uint8Array.from(binary, character => character.charCodeAt(0))]
      }))
      const resources = { assetFiles, componentPackages: {} }
      const workspace = { version: 1 as const, projectId: project.id, normalizedPath: 'c:/u06-real-layout.h5lesson' }
      const sessionToken = { locationId: project.startLocationId, surfaceType: 'slide' as const, revision: project.revision, generation: 6 }
      const selectedIds = [...imageIds, ...descriptionIds]
      const request = captureGenerationSnapshot({
        document: project,
        workspace,
        sessionToken,
        projection: projectEffectiveLayers({ project, locationId: project.startLocationId, stateId: 'state_initial' }),
        selectedIds,
        scope: 'page',
        instruction: '先完善第一列说明和图片比例，再将三张图及三段说明分别顶端对齐、水平等距分布为三列。',
        purpose: 'local-edit',
        intent: 'edit',
        applyPolicy: 'preview',
        expectedResult: 'auto',
        materials: [],
        catalogPackages: [],
        componentPackages: {},
      })
      const update = (id: string) => {
        const destination = request.destinations.find((entry) => entry.kind === 'update' && entry.target.itemId === id)
        if (!destination || destination.kind !== 'update') throw new Error(`Missing frozen target ${id}`)
        return destination
      }
      const imageTargets = imageIds.map(id => update(id).target)
      const descriptionTargets = descriptionIds.map(id => update(id).target)
      const candidate = {
        version: 1 as const,
        requestId: request.requestId,
        candidateId: crypto.randomUUID(),
        summary: '三张图及说明排成可读三列',
        steps: [
          { id: 'text', tool: 'native.content', carrier: 'native' as const, destination: update(descriptionIds[0]!),
            input: { operation: 'edit-text', text: '山地汇聚降水并塑造河流，为下游生态系统提供水源。' } },
          { id: 'image-properties', tool: 'native.content', carrier: 'native' as const, destination: update(imageIds[0]!),
            input: { operation: 'properties', properties: { frame: { width: 280, height: 158 } } } },
          { id: 'align-images', tool: 'layer.edit', carrier: 'native' as const, destination: update(imageIds[0]!),
            input: { operation: 'align', targets: imageTargets, mode: 'top', primaryTarget: imageTargets[0] } },
          { id: 'distribute-images', tool: 'layer.edit', carrier: 'native' as const, destination: update(imageIds[0]!),
            input: { operation: 'distribute', targets: imageTargets, axis: 'horizontal' } },
          { id: 'align-descriptions', tool: 'layer.edit', carrier: 'native' as const, destination: update(descriptionIds[0]!),
            input: { operation: 'align', targets: descriptionTargets, mode: 'top', primaryTarget: descriptionTargets[0] } },
          { id: 'distribute-descriptions', tool: 'layer.edit', carrier: 'native' as const, destination: update(descriptionIds[0]!),
            input: { operation: 'distribute', targets: descriptionTargets, axis: 'horizontal' } },
        ],
      }
      let state: import('../../src/renderer/authoring/editorTransaction').EditorTransactionState = { document: project, resources }
      let liveCommits = 0
      const coordinator = createGenerationCandidateCoordinator({
        readDocument: () => state.document,
        readResources: () => state.resources,
        readWorkspace: () => workspace,
        readSessionGeneration: () => sessionToken.generation,
        commit(step) {
          state = applyEditorTransactionStep(state, step, 'forward')
          liveCommits++
          return true
        },
      })
      const prepared = await coordinator.prepare(request, candidate)
      const applied = coordinator.apply(prepared.previewId)
      if (applied.status !== 'committed') throw new Error(`Candidate did not commit: ${applied.status}`)
      const reopened = courseProjectDocumentSchema.parse(JSON.parse(JSON.stringify(state.document)))
      const view = projectEffectiveLayers({ project: reopened, locationId: reopened.startLocationId, stateId: 'state_initial' })
      const frames = Object.fromEntries(selectedIds.map(id => [id, view.unifiedRows.find(row => row.id === id)!.frame]))
      const payload = buildPublishedCourseV2Payload({ project: reopened, assetFiles: state.resources.assetFiles, components: {} })
      const session = createPublishedCourseSession(payload)
      await session.mount(document.getElementById('stage')!)
      Reflect.set(window, '__u06', { session })
      return {
        requestRevision: request.documentRevision,
        embeddedTargetRevisions: [...imageTargets, ...descriptionTargets].map(target => target.documentRevision),
        preparedRevision: prepared.afterRevision,
        committedRevision: state.document.revision,
        receiptStatus: applied.receipt.status,
        liveCommits,
        frames,
        ids: { imageIds, descriptionIds },
      }
    }, encodedImages)

    expect(preparation.requestRevision).toBe(0)
    expect(new Set(preparation.embeddedTargetRevisions)).toEqual(new Set([0]))
    expect(preparation.preparedRevision).toBe(1)
    expect(preparation.committedRevision).toBe(1)
    expect(preparation.receiptStatus).toBe('committed')
    expect(preparation.liveCommits).toBe(1)

    const imageSelector = preparation.ids.imageIds.map(id => `#stage [data-slide-layer-item="${id}"]`).join(',')
    const descriptionSelector = preparation.ids.descriptionIds.map(id => `#stage [data-slide-layer-item="${id}"]`).join(',')
    await expect(page.locator(imageSelector)).toHaveCount(3)
    await expect(page.locator(descriptionSelector)).toHaveCount(3)
    await expect.poll(() => page.locator(`${imageSelector} canvas`).count()).toBe(3)

    const visual = await page.evaluate(({ imageIds, descriptionIds }) => {
      const stage = document.getElementById('stage')!.getBoundingClientRect()
      const measure = (id: string) => {
        const node = document.querySelector(`[data-slide-layer-item="${id}"]`) as HTMLElement
        const rect = node.getBoundingClientRect()
        return {
          left: rect.left - stage.left,
          top: rect.top - stage.top,
          right: rect.right - stage.left,
          bottom: rect.bottom - stage.top,
          width: rect.width,
          height: rect.height,
          centerX: rect.left - stage.left + rect.width / 2,
          text: node.textContent?.trim() ?? '',
          scrollWidth: node.scrollWidth,
          scrollHeight: node.scrollHeight,
          clientWidth: node.clientWidth,
          clientHeight: node.clientHeight,
          fontSize: Number.parseFloat(getComputedStyle(node).fontSize),
        }
      }
      return {
        stage: { width: stage.width, height: stage.height },
        images: imageIds.map(measure),
        descriptions: descriptionIds.map(measure),
      }
    }, preparation.ids)

    const near = (values: number[], tolerance = 1) => Math.max(...values) - Math.min(...values) <= tolerance
    expect(visual.stage).toEqual({ width: 1280, height: 720 })
    expect(near(visual.images.map(item => item.top))).toBe(true)
    expect(near(visual.descriptions.map(item => item.top))).toBe(true)
    expect(near(visual.images.map(item => item.width / item.height), 0.01)).toBe(true)
    expect(visual.images[0]!.width / visual.images[0]!.height).toBeCloseTo(280 / 158, 2)
    for (let index = 0; index < 3; index++) {
      const image = visual.images[index]!
      const description = visual.descriptions[index]!
      expect(Math.abs(image.centerX - description.centerX)).toBeLessThanOrEqual(1)
      expect(image.left).toBeGreaterThanOrEqual(0)
      expect(description.left).toBeGreaterThanOrEqual(0)
      expect(image.right).toBeLessThanOrEqual(1280)
      expect(description.right).toBeLessThanOrEqual(1280)
      expect(image.bottom).toBeLessThan(description.top)
      expect(description.bottom).toBeLessThanOrEqual(720)
      expect(description.text.length).toBeGreaterThan(12)
      expect(description.fontSize).toBeGreaterThanOrEqual(20)
      expect(description.scrollWidth).toBeLessThanOrEqual(description.clientWidth + 1)
      expect(description.scrollHeight).toBeLessThanOrEqual(description.clientHeight + 1)
      if (index > 0) {
        expect(visual.images[index - 1]!.right).toBeLessThan(image.left)
        expect(visual.descriptions[index - 1]!.right).toBeLessThan(description.left)
      }
    }
    const imageGaps = visual.images.slice(1).map((item, index) => item.left - visual.images[index]!.right)
    const descriptionGaps = visual.descriptions.slice(1).map((item, index) => item.left - visual.descriptions[index]!.right)
    expect(near(imageGaps)).toBe(true)
    expect(near(descriptionGaps)).toBe(true)

    await page.locator('#stage').screenshot({ path: join(output, 'player-three-columns.png') })
    writeFileSync(join(output, 'facts.json'), JSON.stringify({ preparation, visual }, null, 2))
    await page.evaluate(async () => {
      const probe = Reflect.get(window, '__u06') as { session: { destroy(): Promise<void> } }
      await probe.session.destroy()
    })
  } catch (error) {
    writeFileSync(join(output, 'failure.txt'), String(error))
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
    throw error
  } finally {
    await browser.close()
    await server.close()
  }
})
