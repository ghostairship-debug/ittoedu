import { jsonValueSchema } from '../../../../src/shared/contracts/component-platform/schema'
import { expect, test, type FrameLocator, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync, type ChildProcess } from 'node:child_process'
import sharp from 'sharp'
import { CourseV10Driver } from '../../../../src/core/drivers/CourseV10Driver'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../../../src/components/text/adapters'
import { createTextComponentData } from '../../../../src/components/text/data'
import { WEB_DEFINITION } from '../../../../src/components/web/data'
import { launchSelectionApp, openSelectionFile, readSelectionDocument } from '../../helpers/g20SelectionHarness'
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
        pointerEvents: style.pointerEvents, visibility: style.visibility, zIndex: style.zIndex,
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
    saveGeometry()
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
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: jsonValueSchema.parse(createTextComponentData('局部原说明')) }
  project.instances.human = { id: 'human', definitionId: TEXT_DEFINITION.id, data: jsonValueSchema.parse(createTextComponentData('人工浮层保持位置')),
    frame: { width: 220, height: 60, transform: [1, 0, 0, 1, 430, 180] }, style: { opacity: .6 }, flowPlacement: { space: 'paper', plane: 'overlay' } }
  project.instances['nested-group'] = { id: 'nested-group', definitionId: 'group', data: {}, childIds: ['nested-control'],
    frame: { width: 500, height: 220, transform: [1, 0, 0, 1, 120, 100] } }
  project.instances['nested-control'] = { id: 'nested-control', definitionId: WEB_DEFINITION.id,
    frame: { width: 360, height: 120, transform: [1, 0, 0, 1, 35, 40] },
    data: { html: '<details id="nested-answer"><summary>真实嵌套子对象互动</summary><p>子对象仍能接收真实鼠标点击。</p></details>' } }
  project.surfaces = [{ id: 'flow', title: '讲义', kind: 'flow', childIds: ['body', 'human'] },
    { id: 'nested-slide', title: '嵌套交互', kind: 'slide', childIds: ['nested-group'], designSize: { width: 1000, height: 650 } }]
  const name = '绘制对照.h5lesson'
  writeFileSync(join(workspace, name), new CourseV10Driver().serialize({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }))
  let app: ElectronApplication | undefined, ownedProcess: ChildProcess | undefined
  const profileArgument = `--user-data-dir=${join(directory, 'profile')}`
  const facts: Record<string, unknown> = { scope: 'one actual UI import / Electron measurement / formal V10 / real Player pixel and interaction specimen; no model supplier claim', directory }
  try {
    app = await launchSelectionApp(directory); ownedProcess = app.process(); const page = await app.firstWindow()
    await chooseM23Workspace(app, page, workspace)
    await openM23Html(page, 'paint-and-flow.html')
    const source = page.frameLocator('iframe[title="HTML 预览"]')
    const sourceIframe = page.locator('iframe[title="HTML 预览"]')
    facts.sourcePaint = await painted(page, source, sourceIframe, directory, 'source')
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
    const frames = host.locator(`[data-component-object="${program!.id}"] iframe`); await expect(frames).toHaveCount(1)
    const player = frames.contentFrame()
    await expect(player.locator('#answer summary')).toBeVisible()
    const sourceFacts = facts.sourcePaint as Awaited<ReturnType<typeof painted>>, playerFacts = await painted(page, player, frames, directory, 'player')
    facts.playerPaint = playerFacts
    near(sourceFacts.red, [247, 127, 127]); near(playerFacts.red, sourceFacts.red)
    near(sourceFacts.blue, [127, 127, 247]); near(playerFacts.blue, sourceFacts.blue)
    near(sourceFacts.clipCorner, [255, 255, 255]); near(playerFacts.clipCorner, sourceFacts.clipCorner)
    near(sourceFacts.clipInside, [164, 48, 181]); near(playerFacts.clipInside, sourceFacts.clipInside)
    expect(sourceFacts.redGlyphPixels).toBeGreaterThan(5); expect(playerFacts.redGlyphPixels).toBeGreaterThan(5)
    expect(playerFacts.pseudoContent).toEqual(sourceFacts.pseudoContent)
    expect(playerFacts.rgbaColor).toBe('rgba(18, 52, 86, 0.5)')
    expect(sourceFacts.alphaGlyphPixels).toBeGreaterThan(5); expect(playerFacts.alphaGlyphPixels).toBeGreaterThan(5)
    const installPointerEvidence = () => {
      const view = window as typeof window & { __t08PointerEvidence?: unknown[] }
      view.__t08PointerEvidence = []
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'toggle']) {
        for (const capture of [true, false]) document.addEventListener(type, event => {
          if (view.__t08PointerEvidence!.length >= 40) return
          const pointer = event as MouseEvent, target = event.target instanceof Element ? event.target : null
          view.__t08PointerEvidence!.push({ type: event.type, phase: capture ? 'capture' : 'bubble', trusted: event.isTrusted,
            defaultPrevented: event.defaultPrevented, clientX: pointer.clientX, clientY: pointer.clientY,
            path: event.composedPath().filter(node => node instanceof Element).slice(0, 5)
              .map(node => ({ tag: (node as Element).tagName, id: (node as Element).id, className: (node as Element).getAttribute('class') })),
            targetText: target?.textContent?.slice(0, 120), answerOpen: (document.querySelector('#answer') as HTMLDetailsElement | null)?.open })
        }, { capture, passive: true })
      }
    }
    await page.evaluate(installPointerEvidence)
    await player.locator('#answer summary').evaluate(installPointerEvidence)
    const clickSummary = async (step: string, targetFrame: FrameLocator = player, targetIframe: Locator = frames, selector = '#answer summary') => {
      const summary = targetFrame.locator(selector)
      await targetIframe.scrollIntoViewIfNeeded(); await summary.scrollIntoViewIfNeeded()
      const outer = await outerGeometry(targetIframe), inner = await summary.evaluate(element => ({ rect: element.getBoundingClientRect().toJSON(),
        scrollX, scrollY, innerWidth, innerHeight }))
      const mapped = frameRectToScreen(outer, inner.rect), point = { x: mapped.screen.x + mapped.screen.width / 2, y: mapped.screen.y + mapped.screen.height / 2 }
      const topHits = await page.evaluate(point => document.elementsFromPoint(point.x, point.y).slice(0, 8).map(element => ({
        tag: element.tagName, id: element.id, className: element.getAttribute('class'), title: element.getAttribute('title'),
        rect: element.getBoundingClientRect().toJSON(), pointerEvents: getComputedStyle(element).pointerEvents,
        zIndex: getComputedStyle(element).zIndex, text: element.textContent?.slice(0, 120) })), point)
      const childHits = await summary.evaluate(element => {
        const rect = element.getBoundingClientRect(), hits = document.elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        return { summaryHit: hits[0] === element || !!hits[0] && element.contains(hits[0]),
          hits: hits.slice(0, 8).map(hit => ({ tag: hit.tagName, id: hit.id, className: hit.getAttribute('class'),
            rect: hit.getBoundingClientRect().toJSON(), pointerEvents: getComputedStyle(hit).pointerEvents,
            zIndex: getComputedStyle(hit).zIndex, text: hit.textContent?.slice(0, 120) })),
          open: (element.parentElement as HTMLDetailsElement).open }
      })
      const interaction: Record<string, unknown> = { outer, inner, mapped, point, topHits, childHits }
      facts[`interaction-${step}`] = interaction
      writeFileSync(join(directory, 'interaction-geometry.json'), JSON.stringify(facts, null, 2))
      await page.mouse.click(point.x, point.y)
      interaction.after = await summary.evaluate(element => ({ rect: element.getBoundingClientRect().toJSON(), scrollX, scrollY,
        open: (element.parentElement as HTMLDetailsElement).open, activeTag: document.activeElement?.tagName,
        events: (window as typeof window & { __t08PointerEvidence?: unknown[] }).__t08PointerEvidence }))
      interaction.topEvents = await page.evaluate(() => (window as typeof window & { __t08PointerEvidence?: unknown[] }).__t08PointerEvidence)
      writeFileSync(join(directory, 'interaction-geometry.json'), JSON.stringify(facts, null, 2))
    }
    await clickSummary('open')
    await expect(player.locator('#answer p')).toBeVisible()
    await clickSummary('close')
    await expect(player.locator('#answer p')).toBeHidden()
    facts.interaction = { openedAndClosed: true }; facts.localFlowPreserved = { programId: program!.id, humanFrame: edited.model.project.instances.human.frame }
    await overlay.getByTestId('course-preview-next').click()
    const nestedIframe = host.locator('[data-component-object="nested-group"] [data-component-object="nested-control"] iframe')
    await expect(nestedIframe).toHaveCount(1)
    const nested = nestedIframe.contentFrame()
    await expect(nested.locator('#nested-answer summary')).toBeVisible()
    await expect(nested.locator('#nested-answer p')).toBeHidden()
    await nested.locator('#nested-answer summary').evaluate(installPointerEvidence)
    await clickSummary('nested-child', nested, nestedIframe, '#nested-answer summary')
    await expect(nested.locator('#nested-answer p')).toBeVisible()
    await page.screenshot({ path: join(directory, 'nested-child-open.png'), scale: 'css' })
    facts.nestedChildInteraction = { realGroupChildOpened: true }
    const afterInteraction = await readSelectionDocument(page, opened.documentId)
    expect(afterInteraction).toMatchObject({ revision: edited.revision, undoDepth: edited.undoDepth })
    expect(afterInteraction.model).toEqual(edited.model)
    facts.noSyntheticHistory = { revision: afterInteraction.revision, undoDepth: afterInteraction.undoDepth, modelUnchanged: true }
    await overlay.getByRole('button', { name: '关闭预览', exact: true }).click()
    await editor.locator('.course-light-tools').getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, opened.documentId)).dirty).toBe(false)
    facts.saved = { dirty: false }
  } finally {
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(facts, null, 2) + '\n')
    await info.attach('One source to Player paint facts', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
    // This fixture tests Player behavior, not natural process exit. Never await an evaluation
    // that destroys its own target; clean only the process tree launched with this exact profile.
    const profileMatches = ownedProcess?.spawnargs.some(argument => argument === profileArgument || argument.includes(`"${profileArgument}"`)) === true
    writeFileSync(join(directory, 'cleanup-process.json'), JSON.stringify({ pid: ownedProcess?.pid, profileArgument, profileMatches,
      spawnfile: ownedProcess?.spawnfile, spawnargs: ownedProcess?.spawnargs }, null, 2))
    if (ownedProcess?.pid && ownedProcess.exitCode === null && ownedProcess.signalCode === null && profileMatches) {
      try {
        if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(ownedProcess.pid), '/T', '/F'], { stdio: 'pipe', windowsHide: true })
        else ownedProcess.kill()
      } catch (error) { writeFileSync(join(directory, 'cleanup-error.txt'), String(error)) }
    }
    await app?.close().catch(() => undefined)
  }
})
