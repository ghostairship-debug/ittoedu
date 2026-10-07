import { expect, test, type FrameLocator, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { CourseV10Driver } from '../../../../src/core/drivers/CourseV10Driver'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../../../src/components/text/adapters'
import { createTextComponentData } from '../../../../src/components/text/data'
import { closeSelectionApp, launchSelectionApp, openSelectionFile, readSelectionDocument } from '../../helpers/g20SelectionHarness'
import { chooseM23Workspace, openM23Html } from '../../helpers/g20M23Harness'

async function pixel(png: Buffer, xRatio: number, yRatio: number) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const x = Math.min(info.width - 1, Math.floor(info.width * xRatio)), y = Math.min(info.height - 1, Math.floor(info.height * yRatio))
  const offset = (y * info.width + x) * info.channels
  return [...data.subarray(offset, offset + 3)]
}
function near(actual: number[], expected: number[]) { actual.forEach((value, index) => expect(Math.abs(value - expected[index])).toBeLessThanOrEqual(8)) }
async function outerGeometry(iframe: Locator) {
  return { playwrightBox: await iframe.boundingBox(), dom: await iframe.evaluate(element => {
    const ancestors = []
    for (let node: HTMLElement | null = element as HTMLElement; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      ancestors.push({ tag: node.tagName, className: node.className, rect: node.getBoundingClientRect().toJSON(),
        clientWidth: node.clientWidth, clientHeight: node.clientHeight, offsetWidth: node.offsetWidth, offsetHeight: node.offsetHeight,
        clientLeft: node.clientLeft, clientTop: node.clientTop, scrollLeft: node.scrollLeft, scrollTop: node.scrollTop,
        transform: style.transform, transformOrigin: style.transformOrigin, zoom: style.zoom, width: style.width, height: style.height,
        overflowX: style.overflowX, overflowY: style.overflowY, borderLeftWidth: style.borderLeftWidth, borderTopWidth: style.borderTopWidth })
    }
    return { window: { innerWidth, innerHeight, scrollX, scrollY, devicePixelRatio }, ancestors }
  }) }
}
function frameRectToScreen(outerFacts: Awaited<ReturnType<typeof outerGeometry>>, inner: { x: number; y: number; width: number; height: number }) {
  const outer = outerFacts.dom.ancestors[0]!
  const scaleX = outer.rect.width / outer.offsetWidth, scaleY = outer.rect.height / outer.offsetHeight
  return { scaleX, scaleY, screen: { x: outer.rect.x + (outer.clientLeft + inner.x) * scaleX,
    y: outer.rect.y + (outer.clientTop + inner.y) * scaleY, width: inner.width * scaleX, height: inner.height * scaleY } }
}
async function painted(page: Page, frame: FrameLocator, iframe: Locator, directory: string, label: string) {
  const geometry: Record<string, unknown> = { label, samples: {} }
  const saveGeometry = () => writeFileSync(join(directory, `${label}-capture-geometry.json`), JSON.stringify(geometry, null, 2))
  const capture = async (selector: string, name: string) => {
    const target = frame.locator(selector)
    await iframe.scrollIntoViewIfNeeded()
    await target.scrollIntoViewIfNeeded()
    const measure = async () => ({ playwrightBox: await target.boundingBox(), outer: await outerGeometry(iframe), inner: await target.evaluate(element => ({
      rect: element.getBoundingClientRect().toJSON(), window: { innerWidth, innerHeight, scrollX, scrollY, devicePixelRatio },
      document: { scrollLeft: document.documentElement.scrollLeft, scrollTop: document.documentElement.scrollTop,
        clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight },
      body: { scrollLeft: document.body.scrollLeft, scrollTop: document.body.scrollTop, clientWidth: document.body.clientWidth, clientHeight: document.body.clientHeight } })) })
    const before = await measure(), sample: Record<string, unknown> = { selector, before }
    ;(geometry.samples as Record<string, unknown>)[name] = sample; saveGeometry()
    // Child-frame DOM rectangles already include child scrolling. Map them through the actual
    // iframe border/content box and parent transforms into the same top-page viewport pixels.
    // Playwright's child element screenshot omits this scale for a transformed OOP iframe.
    const { scaleX, scaleY, screen } = frameRectToScreen(before.outer, before.inner.rect)
    const viewportPng = await page.screenshot({ scale: 'css' }), viewportImage = await sharp(viewportPng).metadata()
    const pixelX = viewportImage.width! / before.outer.dom.window.innerWidth, pixelY = viewportImage.height! / before.outer.dom.window.innerHeight
    const left = Math.floor(screen.x * pixelX), top = Math.floor(screen.y * pixelY)
    const clip = { left, top, width: Math.ceil((screen.x + screen.width) * pixelX) - left, height: Math.ceil((screen.y + screen.height) * pixelY) - top }
    expect(left, 'Paint target must be visible in its actual screen viewport').toBeGreaterThanOrEqual(0)
    expect(top, 'Paint target must be visible in its actual screen viewport').toBeGreaterThanOrEqual(0)
    expect(left + clip.width).toBeLessThanOrEqual(viewportImage.width!)
    expect(top + clip.height).toBeLessThanOrEqual(viewportImage.height!)
    sample.screenMapping = { scaleX, scaleY, screen, clip, viewport: { width: viewportImage.width, height: viewportImage.height } }; saveGeometry()
    const png = await sharp(viewportPng).extract(clip).png().toBuffer()
    writeFileSync(join(directory, `${label}-${name}.png`), png)
    const metadata = await sharp(png).metadata()
    sample.png = { width: metadata.width, height: metadata.height, format: metadata.format }
    sample.after = await measure(); saveGeometry()
    return png
  }
  const atomic = await capture('.atomic', 'atomic')
  const blue = await capture('.atomic span', 'blue')
  const clipped = await capture('.clipped', 'clipped')
  const number = await capture('.number', 'number')
  const rgba = await capture('.rgba', 'rgba')
  const numberPixels = await sharp(number).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let redGlyphPixels = 0
  for (let index = 0; index < numberPixels.data.length; index += numberPixels.info.channels)
    if (numberPixels.data[index] > 120 && numberPixels.data[index + 1] < 90 && numberPixels.data[index + 2] < 90) redGlyphPixels++
  const rgbaPixels = await sharp(rgba).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let alphaGlyphPixels = 0
  for (let index = 0; index < rgbaPixels.data.length; index += rgbaPixels.info.channels)
    if ([137, 154, 171].every((value, channel) => Math.abs(rgbaPixels.data[index + channel] - value) <= 8)) alphaGlyphPixels++
  return { red: await pixel(atomic, .04, .9), blue: await pixel(blue, .9, .85), clipCorner: await pixel(clipped, .02, .02), clipInside: await pixel(clipped, .5, .7),
    pseudoContent: await frame.locator('.number').evaluate(element => getComputedStyle(element, '::before').content),
    rgbaColor: await frame.locator('.rgba').evaluate(element => getComputedStyle(element).color), redGlyphPixels, alphaGlyphPixels }
}

test('one real HTML import keeps painted pseudo clip and alpha semantics in Player and local Flow editing preserves the imported program and human layout', async ({}, info) => {
  const root = resolve(__dirname, '../../../..'), output = join(root, 'output/content-revision/t08-paint')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const sourceFile = join(workspace, 'paint-and-flow.html')
  writeFileSync(sourceFile, readFileSync(join(__dirname, 'fixtures/paint-and-flow.html')))
  const project = createBlankCourseProjectV10('绘制样本')
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: createTextComponentData('局部原说明') }
  project.instances.human = { id: 'human', definitionId: TEXT_DEFINITION.id, data: createTextComponentData('人工浮层保持位置'),
    frame: { width: 220, height: 60, transform: [1, 0, 0, 1, 430, 180] }, style: { opacity: .6 }, flowPlacement: { space: 'paper', plane: 'overlay' } }
  project.surfaces = [{ id: 'flow', title: '讲义', kind: 'flow', childIds: ['body', 'human'] }]
  const name = '绘制对照.h5lesson'
  writeFileSync(join(workspace, name), new CourseV10Driver().serialize({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }))
  let app: ElectronApplication | undefined
  const facts: Record<string, unknown> = { scope: 'one actual UI import / Electron measurement / formal V10 / real Player pixel and interaction specimen; no model supplier claim', directory }
  try {
    app = await launchSelectionApp(directory); const page = await app.firstWindow()
    await chooseM23Workspace(app, page, workspace)
    await openM23Html(page, 'paint-and-flow.html')
    const source = page.frameLocator('iframe[title="HTML 预览"]')
    const sourceIframe = page.locator('iframe[title="HTML 预览"]')
    facts.sourcePaint = await painted(page, source, sourceIframe, directory, 'source')
    const sourcePng = await sourceIframe.screenshot({ scale: 'css', path: join(directory, 'source-outer.png') })
    facts.sourceOuter = { geometry: await outerGeometry(sourceIframe), png: await sharp(sourcePng).metadata() }
    await info.attach('Original source paint', { body: sourcePng, contentType: 'image/png' })
    const opened = await openSelectionFile(page, workspace, name)
    const editor = page.locator('.course-editor-frame:visible')
    await editor.locator('.course-light-tools').getByRole('button', { name: '插入', exact: true }).click()
    await editor.getByRole('button', { name: '导入 HTML 页面', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '导入 HTML 页面', exact: true })
    await dialog.getByLabel('导入目标页面', { exact: true }).selectOption({ label: '流式讲义 · 讲义' })
    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }) }, sourceFile)
    await dialog.getByRole('button', { name: '导入', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const imported = await readSelectionDocument(page, opened.documentId)
    if (imported.model.kind !== 'course-v10') throw new Error('V10 required')
    expect(imported.model.project.instances.body).toEqual(project.instances.body)
    expect(imported.model.project.instances.human).toEqual(project.instances.human)
    const program = Object.values(imported.model.project.instances).find(instance => {
      const data = instance.data
      return data !== null && typeof data === 'object' && !Array.isArray(data) && typeof data.html === 'string' && data.html.includes('点击查看核心互动')
    })
    expect(program, JSON.stringify(imported.model.project.instances)).toBeTruthy()
    const paragraph = editor.locator('.ProseMirror p').filter({ hasText: '局部原说明' })
    await paragraph.click({ clickCount: 3 }); await page.keyboard.press('Home'); await page.keyboard.press('Shift+End'); await page.keyboard.insertText('局部修订说明')
    await expect.poll(async () => (await readSelectionDocument(page, opened.documentId)).model).toMatchObject({ project: { instances: { body: { data: { content: { inlines: [{ type: 'text', text: '局部修订说明' }] } } } } } })
    const edited = await readSelectionDocument(page, opened.documentId)
    if (edited.model.kind !== 'course-v10') throw new Error('V10 required')
    expect(edited.model.project.instances[program!.id]).toEqual(program)
    expect(edited.model.project.instances.human).toEqual(project.instances.human)
    await editor.locator('.course-light-tools').getByRole('button', { name: '整课预览', exact: true }).click()
    const host = page.getByTestId('course-preview-host'), overlay = page.getByTestId('course-preview-overlay')
    await expect(overlay).toBeVisible()
    const frames = host.locator('iframe'); await expect(frames).toHaveCount(1)
    const player = host.frameLocator('iframe')
    await expect(player.locator('#answer summary')).toBeVisible()
    const sourceFacts = facts.sourcePaint as Awaited<ReturnType<typeof painted>>, playerFacts = await painted(page, player, frames, directory, 'player')
    facts.playerPaint = playerFacts
    const playerPng = await frames.screenshot({ scale: 'css', path: join(directory, 'player-outer.png') })
    facts.playerOuter = { geometry: await outerGeometry(frames), png: await sharp(playerPng).metadata() }
    await info.attach('Imported actual Player paint before pixel assertions', { body: playerPng, contentType: 'image/png' })
    const playerHostPng = await host.screenshot({ scale: 'css', path: join(directory, 'player-whole-host.png') })
    await info.attach('Whole Player host before pixel assertions', { body: playerHostPng, contentType: 'image/png' })
    near(sourceFacts.red, [247, 127, 127]); near(playerFacts.red, sourceFacts.red)
    near(sourceFacts.blue, [127, 127, 247]); near(playerFacts.blue, sourceFacts.blue)
    near(sourceFacts.clipCorner, [255, 255, 255]); near(playerFacts.clipCorner, sourceFacts.clipCorner)
    near(sourceFacts.clipInside, [164, 48, 181]); near(playerFacts.clipInside, sourceFacts.clipInside)
    expect(sourceFacts.redGlyphPixels).toBeGreaterThan(5); expect(playerFacts.redGlyphPixels).toBeGreaterThan(5)
    expect(playerFacts.pseudoContent).toEqual(sourceFacts.pseudoContent)
    expect(playerFacts.rgbaColor).toBe('rgba(18, 52, 86, 0.5)')
    expect(sourceFacts.alphaGlyphPixels).toBeGreaterThan(5); expect(playerFacts.alphaGlyphPixels).toBeGreaterThan(5)
    const clickSummary = async (step: string) => {
      const summary = player.locator('#answer summary')
      await frames.scrollIntoViewIfNeeded(); await summary.scrollIntoViewIfNeeded()
      const outer = await outerGeometry(frames), inner = await summary.evaluate(element => ({ rect: element.getBoundingClientRect().toJSON(),
        scrollX, scrollY, innerWidth, innerHeight }))
      const mapped = frameRectToScreen(outer, inner.rect), point = { x: mapped.screen.x + mapped.screen.width / 2, y: mapped.screen.y + mapped.screen.height / 2 }
      facts[`interaction-${step}`] = { outer, inner, mapped, point }
      writeFileSync(join(directory, 'interaction-geometry.json'), JSON.stringify(facts, null, 2))
      await page.mouse.click(point.x, point.y)
    }
    await clickSummary('open')
    await expect(player.locator('#answer p')).toBeVisible()
    await clickSummary('close')
    await expect(player.locator('#answer p')).toBeHidden()
    facts.interaction = { openedAndClosed: true }; facts.localFlowPreserved = { programId: program!.id, humanFrame: edited.model.project.instances.human.frame }
    await overlay.getByRole('button', { name: '关闭预览', exact: true }).click()
    await editor.locator('.course-light-tools').getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, opened.documentId)).dirty).toBe(false)
  } finally {
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(facts, null, 2) + '\n')
    await info.attach('One source to Player paint facts', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
    if (app) await closeSelectionApp(app)
  }
})
