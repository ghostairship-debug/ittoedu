import { expect, test } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { createCourseProjectV10Archive, openCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { courseGeometryEdits } from '../../src/core/course/courseGeometryEdits'
import { flowPlacementEdits } from '../../src/core/course/courseFlowEdits'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { IMAGE_DEFINITION, createImageData } from '../../src/components/image'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { textComponentDataSchema } from '../../src/components/text/data'
import { jsonValueSchema, type ComponentEdit } from '../../src/shared/contracts/component-platform'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { buildComponentSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'

// API 5 uses the same component lifecycle on each surface; surface-specific
// Runtime/API 2 carriers no longer define a supported publishing contract.
test('V10 publishes one isolated interactive component across Slide, Flow and Spatial with real pointer and keyboard navigation offline', async ({ browser }, info) => {
  let project = createBlankCourseProjectV10('三表面离线互动')
  project.definitions.counter = { id: 'counter', role: 'content', implementation: {
    kind: 'source', language: 'javascript', source: `export default {mount({root,instance}) {
      let count = 0;
      const button = document.createElement('button');
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 30;
      const label = document.createElement('p'); label.textContent = instance.data.label;
      const isolation = document.createElement('p'); isolation.id = 'isolation';
      isolation.textContent = [typeof window.desktopAPI, typeof window.require, typeof window.process].join(',');
      const paint = () => {button.textContent = '增加 ' + count; const context = canvas.getContext('2d');
        context.fillStyle = count ? '#00aa00' : '#aa0000'; context.fillRect(0, 0, 160, 30)};
      button.addEventListener('click', () => {count++; paint()});
      root.append(label, button, canvas, isolation); paint();
      return {update(next) {label.textContent = next.data.label}, dispose() {root.replaceChildren()}};
    }}`,
  } }
  project.surfaces = ['slide', 'flow', 'spatial'].map(kind => ({ id: kind, kind: kind as 'slide' | 'flow' | 'spatial', title: kind,
    childIds: [kind + '-counter'], ...(kind === 'flow' ? {} : { designSize: { width: 800, height: 450 } }), ...(kind === 'spatial' ? { spatial: { home: { x: 190, y: 130, zoom: 1 }, frames: [] } } : {}) }))
  for (const kind of ['slide', 'flow', 'spatial']) project.instances[kind + '-counter'] = {
    id: kind + '-counter', definitionId: 'counter', data: { label: kind + ' 实时互动' },
    frame: { width: 280, height: 180, transform: [1, 0, 0, 1, 50, 40] },
  }
  project.instances['flow-counter'].flowPlacement = { space: 'viewport', plane: 'overlay' }
  project.surfaces[0].designSize = { width: 1280, height: 720 }
  project.definitions[IMAGE_DEFINITION.id] = IMAGE_DEFINITION; project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  const imageIds = ['layout-image-a', 'layout-image-b', 'layout-image-c'], textIds = ['layout-text-a', 'layout-text-b', 'layout-text-c']
  const descriptions = ['山地汇聚降水并塑造河流，为下游生态系统提供水源。', '森林涵养水源并为生物提供栖息地。', '湿地调蓄洪水，也维持丰富的生物多样性。']
  const assets: Record<string, Uint8Array> = {}
  for (const [index, color] of ['#2563eb', '#059669', '#7c3aed'].entries()) {
    const assetId = `layout-asset-${index}`
    const bytes = new Uint8Array(await sharp({ create: { width: 320, height: 180, channels: 4, background: color } }).png().toBuffer())
    assets[assetId] = bytes
    project.assets[assetId] = { id: assetId, filename: `${assetId}.png`, path: `assets/${assetId}.png`, mimeType: 'image/png', kind: 'image', byteLength: bytes.length, width: 320, height: 180 }
    project.instances[imageIds[index]] = { id: imageIds[index], definitionId: IMAGE_DEFINITION.id, data: createImageData(assetId, `景观图 ${index + 1}`),
      frame: { width: 280, height: 157.5, transform: [1, 0, 0, 1, [80, 570, 920][index], [250, 280, 240][index]] } }
    project.instances[textIds[index]] = { id: textIds[index], definitionId: TEXT_DEFINITION.id,
      data: jsonValueSchema.parse(textComponentDataSchema.parse({ content: { inlines: [{ type: 'text', text: descriptions[index] }] },
        appearance: { fontSize: 24, color: '#172033', lineHeight: 1.35, padding: 10 }, sizing: { mode: 'fixed', minHeight: 120, overflow: 'visible' } })),
      frame: { width: 280, height: 120, transform: [1, 0, 0, 1, [80, 550, 920][index], [450, 480, 450][index]] } }
    project.surfaces[0].childIds.push(imageIds[index], textIds[index])
  }
  // Stage the current affine alignment/distribution algorithm as one formal operation.
  const edits: ComponentEdit[] = [], initial = structuredClone(project)
  let staged = project
  for (const ids of [imageIds, textIds]) for (const intent of [{ kind: 'align', alignment: 'top' }, { kind: 'distribute', axis: 'horizontal' }] as const) {
    const next = courseGeometryEdits(staged, ids, intent)
    edits.push(...next); staged = applyComponentOperation(staged, captureComponentOperation(staged, next))
  }
  const session = await DocumentSession.create({ documentId: 'published-layout', epoch: 'epoch', binding: { kind: 'untitled', suggestedName: 'layout.h5lesson' },
    model: { kind: 'course-v10', project, resources: { assets, components: {} } } }, new CourseV10Driver(), { append: async () => {}, save: async () => { throw new Error('Archive bytes are verified directly') } })
  expect(await session.execute({ documentId: session.documentId, epoch: 'epoch', baseRevision: 0, operationId: crypto.randomUUID(), actor: 'human',
    mutation: { type: 'command', command: captureComponentOperation(project, edits) } })).toMatchObject({ status: 'applied' })
  expect(session.read().undoDepth).toBe(1); expect(project).toEqual(initial)
  let model = session.read().model
  if (model.kind !== 'course-v10') throw new Error('V10 required')
  const layout = structuredClone(model.project)
  const placement = flowPlacementEdits(layout, 'flow-counter', { kind: 'document', surfaceId: 'flow', index: 0, wrap: 'none' })
  expect(await session.execute({ documentId: session.documentId, epoch: 'epoch', baseRevision: session.read().revision,
    operationId: crypto.randomUUID(), actor: 'human', mutation: { type: 'command', command: captureComponentOperation(layout, placement) } }))
    .toMatchObject({ status: 'applied' })
  expect(session.read().undoDepth).toBe(2)
  model = session.read().model
  if (model.kind !== 'course-v10') throw new Error('V10 required')
  expect(model.project.instances['flow-counter']).toEqual({ ...initial.instances['flow-counter'], flowPlacement: undefined,
    flowLayout: { width: 'content-width', wrap: 'none' } })
  expect(model.project.definitions.counter).toEqual(initial.definitions.counter)
  expect(model.project.surfaces.find(surface => surface.id === 'flow')!.childIds).toEqual(['flow-counter'])
  const body = structuredClone(model.project)
  for (const history of ['undo', 'redo'] as const) {
    expect(await session.execute({ documentId: session.documentId, epoch: 'epoch', baseRevision: session.read().revision,
      operationId: crypto.randomUUID(), actor: 'human', mutation: { type: history } })).toMatchObject({ status: 'applied' })
    model = session.read().model
    if (model.kind !== 'course-v10') throw new Error('V10 required')
    expect(model.project).toEqual({ ...(history === 'undo' ? layout : body), revision: model.project.revision })
    expect(session.read().undoDepth).toBe(history === 'undo' ? 1 : 2)
    expect(session.read().redoDepth).toBe(history === 'undo' ? 1 : 0)
    expect(Object.keys(model.resources.assets).sort()).toEqual(Object.keys(assets).sort())
    for (const [id, bytes] of Object.entries(assets)) expect(Array.from(model.resources.assets[id])).toEqual(Array.from(bytes))
  }
  const reopened = openCourseProjectV10Archive(createCourseProjectV10Archive({ project: model.project, resources: model.resources }))
  expect(reopened.project).toEqual(JSON.parse(JSON.stringify(model.project)))
  for (const [id, bytes] of Object.entries(assets)) expect(Array.from(reopened.resources.assets[id])).toEqual(Array.from(bytes))
  project = reopened.project
  const before = structuredClone(project)
  const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const published = await buildPublishedCourseV3({ project, assetBytes: reopened.resources.assets }, { compilation })
  expect(published.diagnostics).toEqual([])
  expect(published.offlineComplete).toBe(true)
  expect(project).toEqual(before)
  const output = info.outputPath('published.html'); mkdirSync(info.outputDir, { recursive: true })
  writeFileSync(output, buildComponentSingleHtml(published.payload, readFileSync(resolve('dist-player/player.iife.js'), 'utf8')))
  const context = await browser.newContext({ offline: true, viewport: { width: 1000, height: 720 } })
  const page = await context.newPage(), errors: string[] = [], network: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (/^(https?|wss?):/i.test(request.url())) network.push(request.url()) })
  try {
    await page.setContent(readFileSync(output, 'utf8'))
    for (const [index, id] of imageIds.entries()) {
      const owner = page.locator(`[data-component-object="${id}"]`)
      await expect(owner.getByRole('img', { name: `景观图 ${index + 1}`, exact: true })).toBeVisible()
      await expect.poll(() => owner.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(320)
    }
    const geometry = await page.evaluate(({ imageIds, textIds }) => {
      const measure = (id: string) => {
        const node = document.querySelector(`[data-component-object="${id}"]`) as HTMLElement
        const rect = node.getBoundingClientRect()
        const text = node.querySelector('[data-text-component-content]') ?? node
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, centerX: rect.x + rect.width / 2,
          text: node.textContent?.trim(), scrollWidth: text.scrollWidth, clientWidth: text.clientWidth,
          scrollHeight: text.scrollHeight, clientHeight: text.clientHeight, fontSize: parseFloat(getComputedStyle(text).fontSize) * rect.width / node.offsetWidth }
      }
      return { images: imageIds.map(measure), texts: textIds.map(measure) }
    }, { imageIds, textIds })
    await info.attach('three-column-browser-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' })
    const spread = (values: number[]) => Math.max(...values) - Math.min(...values)
    expect(spread(geometry.images.map(item => item.y))).toBeLessThanOrEqual(1)
    expect(spread(geometry.texts.map(item => item.y))).toBeLessThanOrEqual(1)
    for (const row of [geometry.images, geometry.texts]) {
      const gaps = [row[1].x - row[0].x - row[0].width, row[2].x - row[1].x - row[1].width]
      expect(Math.min(...gaps)).toBeGreaterThan(0); expect(spread(gaps)).toBeLessThanOrEqual(1)
    }
    for (let index = 0; index < 3; index++) {
      const image = geometry.images[index], text = geometry.texts[index]
      expect(image.width / image.height).toBeCloseTo(16 / 9, 2)
      expect(Math.abs(image.centerX - text.centerX)).toBeLessThanOrEqual(1)
      expect(image.y + image.height).toBeLessThan(text.y)
      expect(text.text).toBe(descriptions[index])
      expect(text.fontSize).toBeGreaterThanOrEqual(18)
      await expect(page.locator(`[data-component-object="${textIds[index]}"] [data-text-overflow]`)).toHaveAttribute('data-text-overflow', 'false')
      expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth + 1)
      expect(text.scrollHeight).toBeLessThanOrEqual(text.clientHeight + 1)
    }
    for (const kind of ['slide', 'flow', 'spatial']) {
      const owner = page.locator(`[data-component-${kind === 'spatial' ? 'instance-id' : 'object'}="${kind}-counter"]`)
      const frame = owner.locator('iframe').contentFrame()
      await expect(frame.getByText(kind + ' 实时互动', { exact: true })).toBeVisible()
      await expect(frame.locator('#isolation')).toHaveText('undefined,undefined,undefined')
      const button = frame.getByRole('button', { name: '增加 0', exact: true })
      // Use the browser's measured iframe transform for a physical pointer:
      // Playwright's frame locator coordinates omit inherited CSS zoom.
      const outer = await owner.locator('iframe').evaluate(element => {
        const frame = element as HTMLIFrameElement
        return { rect: frame.getBoundingClientRect().toJSON(), width: frame.offsetWidth, height: frame.offsetHeight,
          left: frame.clientLeft, top: frame.clientTop }
      })
      const inner = await button.evaluate(element => element.getBoundingClientRect().toJSON())
      const point = { x: outer.rect.x + (outer.left + inner.x + inner.width / 2) * outer.rect.width / outer.width,
        y: outer.rect.y + (outer.top + inner.y + inner.height / 2) * outer.rect.height / outer.height }
      await info.attach(kind + '-pointer-geometry', { body: JSON.stringify({ outer, inner, point }), contentType: 'application/json' })
      await page.mouse.click(point.x, point.y)
      await expect(frame.getByRole('button', { name: '增加 1', exact: true })).toBeVisible()
      const pixel = await frame.locator('canvas').evaluate((canvas: HTMLCanvasElement) => Array.from(canvas.getContext('2d')!.getImageData(5, 5, 1, 1).data))
      expect(pixel).toEqual([0, 170, 0, 255])
      if (kind === 'flow') {
        const controller = page.getByRole('navigation', { name: '教师控制台', exact: true })
        await controller.getByRole('button', { name: '展开教师控制器', exact: true }).click()
        for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
          await page.setViewportSize(viewport)
          await expect(frame.getByRole('button', { name: '增加 1', exact: true })).toBeVisible()
          await expect(controller.getByRole('button', { name: '缩放', exact: true })).toBeVisible()
          const bounds = (await controller.boundingBox())!
          expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0)
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1)
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1)
        }
        await controller.getByRole('button', { name: '收起教师控制器', exact: true }).click()
        await expect(frame.getByRole('button', { name: '增加 1', exact: true })).toBeVisible()
      }
      if (kind !== 'spatial') {
        await page.locator('#course-root').click({ position: { x: 5, y: 5 } })
        await page.keyboard.press('ArrowRight')
        await expect(owner).toBeHidden()
      }
    }
    await page.locator('#course-root').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('ArrowLeft')
    const returned = page.locator('[data-component-object="flow-counter"] iframe').contentFrame()
    await expect(returned.getByRole('button', { name: '增加 1', exact: true })).toBeVisible()
    await page.evaluate(async () => { await (window as unknown as { coursePlayer: { dispose(): Promise<void> } }).coursePlayer.dispose() })
    await expect(page.locator('#course-root iframe')).toHaveCount(0)
    const cold = await context.newPage()
    cold.on('pageerror', error => errors.push(error.message))
    await cold.setContent(readFileSync(output, 'utf8'))
    await expect(cold.locator('[data-component-object="slide-counter"] iframe').contentFrame().getByRole('button', { name: '增加 0', exact: true })).toBeVisible()
    expect(errors).toEqual([]); expect(network).toEqual([])
    await expect(page.getByRole('alert')).toBeEmpty()
  } finally { await context.close() }
})
