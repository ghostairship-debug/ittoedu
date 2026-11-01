/** Opt-in follow-through for the existing GLX/remix consumer. No provider is constructed. */
import { _electron as electron, chromium, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { build } from 'esbuild'
import { promises as fs } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform'
import { buildCompiledSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'

const root = resolve(__dirname, '../..')
const output = resolve(root, 'output/ai-productivity-execution-20261030/template-e0')
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const transferable = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? [...item] : item))
type Probe = { instanceId: string; text: string; frame: { width: number; height: number; transform?: number[] }; publicCapacity: string }
type Case = Probe & { variant: 'normal' | 'overflow'; file: string; offline: string; label: string; probeRole: 'body';
  glxSha256: string; surfaceCount: number; titleProbe: Probe }
async function writeJson(filename: string, value: unknown) {
  await fs.mkdir(dirname(filename), { recursive: true })
  await fs.writeFile(filename, JSON.stringify(value, null, 2), 'utf8')
}

async function compileBundle(directory: string) {
  // These are the same production publisher/renderers used by the retained P3 offline consumer.
  const bundle = await build({ stdin: { contents: [
    'import "./src/renderer/styles/variables.css";',
    'import "./src/renderer/styles/globals.css";',
    'export {compileCoursePlayback} from "./src/core/publish/componentPlatform/compileCoursePlayback";',
    'export {renderCompiledBuiltin} from "./src/renderer/export/componentPlatform/renderCompiledBuiltin";',
  ].join('\n'), resolveDir: root }, bundle: true, platform: 'browser', format: 'iife', globalName: 'TemplateE0Export',
  outfile: join(directory, 'compile.js'), write: false,
  loader: { '.css': 'css', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' })
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))?.text
  if (!script) throw new Error('Production compilation bundle did not contain JavaScript')
  return { script, css: bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '' }
}

async function exportOffline(page: Page, item: Case, directory: string, player: string) {
  const host = new DocumentHostService(join(directory, `export-${item.variant}-documents`))
  const cold = await host.open(item.file)
  if (cold.model.kind !== 'course-v10') throw new Error('Unexpected saved document kind')
  const published = await buildPublishedCourseV3({ project: cold.model.project, assetBytes: cold.model.resources.assets,
    componentFiles: cold.model.resources.components }, { compilation: host.compilation })
  await writeJson(join(directory, `${item.variant}-publish-diagnostics.json`), published.diagnostics)
  expect(published.diagnostics.filter(item => item.code === 'source-not-compiled' || item.code === 'source-compile-failed')).toEqual([])
  const compiled = await page.evaluate(async payload => {
    const api = (window as any).TemplateE0Export
    return api.compileCoursePlayback(payload, { document,
      renderBuiltin: (instance: unknown, key: string, project: unknown) => api.renderCompiledBuiltin(instance, key, project, document) })
  }, transferable(published.payload))
  await writeJson(join(directory, `${item.variant}-compile-diagnostics.json`), compiled.diagnostics)
  expect(compiled.diagnostics).toEqual([])
  const html = buildCompiledSingleHtml(compiled, player), filename = join(directory, `${item.variant}-offline.html`)
  await fs.writeFile(filename, html, 'utf8')
  return { producer: 'buildPublishedCourseV3 → compileCoursePlayback/renderCompiledBuiltin → buildCompiledSingleHtml',
    file: filename, sha256: hash(await fs.readFile(filename)), publishedDiagnostics: published.diagnostics,
    compiledDiagnostics: compiled.diagnostics, savedRevision: cold.revision }
}

async function nextVisiblePage(page: Page) {
  // Use the actual Player's public interaction. No assignment to project or Player state.
  for (const name of [/^下一页$/, /^下一场景$/, /^Next(?: page)?$/i]) {
    const buttons = page.getByRole('button', { name })
    for (let i = 0; i < await buttons.count(); i++) {
      const button = buttons.nth(i)
      if (await button.isVisible() && await button.isEnabled()) { await button.click(); return 'visible-next-button' }
    }
  }
  await page.keyboard.press('ArrowRight')
  return 'ArrowRight'
}

async function reachObject(page: Page, item: Case) {
  const selector = `[data-compiled-node="${item.instanceId}"]`
  const steps: string[] = []
  for (let index = 0; index <= item.surfaceCount; index++) {
    for (const frame of page.frames()) {
      if (frame.isDetached()) continue
      if (frame !== page.mainFrame()) {
        const handle = await frame.frameElement().catch(() => null)
        if (!handle) continue
        const visible = await handle.isVisible(); await handle.dispose()
        if (!visible) continue
      }
      const target = frame.locator(selector).first()
      if (await target.isVisible().catch(() => false)) {
        const box = await target.boundingBox(), viewport = page.viewportSize()
        if (box && viewport && box.x < viewport.width && box.y < viewport.height && box.x + box.width > 0 && box.y + box.height > 0)
          return { target, steps }
      }
    }
    if (index < item.surfaceCount) {
      steps.push(await nextVisiblePage(page))
      await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
    }
  }
  throw new Error(`The actual offline Player could not navigate to ${item.label}; inspect preserved DOM and screenshots`)
}

async function measureText(page: Page, item: Case, geometry: 'range' | 'painted-ink' = 'range') {
  const { target, steps } = await reachObject(page, item)
  return { ...await target.evaluate(async (element, probe) => {
    await document.fonts.ready
    await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))
    const owner = element as HTMLElement, box = owner.getBoundingClientRect()
    const scale = box.width / probe.frame.width
    // Compare text with the persisted fixed frame, never with its own expanding text bbox.
    const limit = { left: box.left, top: box.top, right: box.left + probe.frame.width * scale,
      bottom: box.top + probe.frame.height * scale, width: probe.frame.width * scale, height: probe.frame.height * scale }
    const walker = document.createTreeWalker(owner, NodeFilter.SHOW_TEXT)
    const rects: Array<{ left: number; top: number; right: number; bottom: number; width: number; height: number }> = []
    const inkRects: Array<{ left: number; top: number; right: number; bottom: number }> = []
    const inkIssues: string[] = [], metricDeltas: number[] = []
    const fontCalibrations: Record<string, unknown>[] = []
    const canvas = document.createElement('canvas'), inkContext = canvas.getContext('2d')
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    const fonts: number[] = [], tags: string[] = [], text: string[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || !node.parentElement) continue
      const style = getComputedStyle(node.parentElement)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue
      const range = document.createRange(); range.selectNodeContents(node)
      const visibleRects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)
      if (!visibleRects.length) continue
      text.push(node.textContent); tags.push(node.parentElement.tagName)
      const font = Number.parseFloat(style.fontSize); if (Number.isFinite(font)) fonts.push(font)
      for (const rect of visibleRects) rects.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        width: rect.width, height: rect.height })
      if (probe.geometry === 'painted-ink') {
        // Range rectangles enclose a font box, not the painted glyphs. Calibrate
        // the actual loaded font before deriving its alphabetic baseline; do
        // not turn a fixed extra tolerance into a purported fit check.
        if (!inkContext || style.writingMode !== 'horizontal-tb' || style.direction !== 'ltr'
          || !['normal', '0px'].includes(style.letterSpacing)) { inkIssues.push('Unsupported font geometry'); continue }
        inkContext.font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
        inkContext.textAlign = 'left'; inkContext.textBaseline = 'alphabetic'; inkContext.direction = 'ltr'
        for (const segment of segmenter.segment(node.textContent)) {
          if (!segment.segment.trim()) continue
          const glyphRange = document.createRange()
          glyphRange.setStart(node, segment.index); glyphRange.setEnd(node, segment.index + segment.segment.length)
          const glyphBoxes = Array.from(glyphRange.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)
          if (glyphBoxes.length !== 1) { inkIssues.push('A grapheme did not have one physical text box'); continue }
          const glyphBox = glyphBoxes[0]!, metrics = inkContext.measureText(segment.segment)
          const fontHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent
          const delta = Math.abs(glyphBox.height - fontHeight * scale); metricDeltas.push(delta)
          if (fontCalibrations.length < 8) fontCalibrations.push({ text: segment.segment, canvasFont: inkContext.font,
            cssFont: style.font, cssLineHeight: style.lineHeight, scale, domFontBoxHeight: glyphBox.height,
            fontBoundingBoxAscent: metrics.fontBoundingBoxAscent, fontBoundingBoxDescent: metrics.fontBoundingBoxDescent,
            actualBoundingBoxAscent: metrics.actualBoundingBoxAscent, actualBoundingBoxDescent: metrics.actualBoundingBoxDescent,
            actualBoundingBoxLeft: metrics.actualBoundingBoxLeft, actualBoundingBoxRight: metrics.actualBoundingBoxRight, delta })
          if (![fontHeight, metrics.actualBoundingBoxAscent, metrics.actualBoundingBoxDescent,
            metrics.actualBoundingBoxLeft, metrics.actualBoundingBoxRight].every(Number.isFinite)
            || fontHeight <= 0 || delta > 2) { inkIssues.push('Canvas font metrics did not match the DOM font box'); continue }
          const baseline = glyphBox.top + metrics.fontBoundingBoxAscent * scale
          inkRects.push({ left: glyphBox.left - metrics.actualBoundingBoxLeft * scale,
            right: glyphBox.left + metrics.actualBoundingBoxRight * scale,
            top: baseline - metrics.actualBoundingBoxAscent * scale,
            bottom: baseline + metrics.actualBoundingBoxDescent * scale })
        }
      }
    }
    const normalized = (value: string) => value.replace(/\s/g, '')
    const renderedText = text.join(''), fullTextPresent = normalized(renderedText).includes(normalized(probe.text))
    const overflow = rects.length ? Math.max(0, ...rects.flatMap(rect => [limit.left - rect.left, limit.top - rect.top,
      rect.right - limit.right, rect.bottom - limit.bottom])) : null
    const sideAndBottomOverflow = rects.length ? Math.max(0, ...rects.flatMap(rect => [limit.left - rect.left,
      rect.right - limit.right, rect.bottom - limit.bottom])) : null
    const inkOverflow = inkRects.length ? Math.max(0, ...inkRects.flatMap(rect => [limit.left - rect.left,
      limit.top - rect.top, rect.right - limit.right, rect.bottom - limit.bottom])) : null
    const geometryFits = probe.geometry === 'range' ? overflow !== null && overflow <= 2
      : !inkIssues.length && inkOverflow !== null && inkOverflow <= 2 && sideAndBottomOverflow !== null && sideAndBottomOverflow <= 2
    const scrollOverflow = Math.max(0, owner.scrollWidth - owner.clientWidth, owner.scrollHeight - owner.clientHeight)
    const actualFrameHeightDelta = Math.abs(box.height - limit.height)
    return { attributes: Object.fromEntries(Array.from(owner.attributes).map(attribute => [attribute.name, attribute.value])),
      actualBox: { x: box.x, y: box.y, width: box.width, height: box.height }, fixedFrameLimit: limit,
      scale, actualFrameHeightDelta, fontSizes: [...new Set(fonts)], renderedTags: [...new Set(tags)],
      expectedTextLength: probe.text.length, renderedTextLength: renderedText.length,
      renderedTextSample: renderedText.slice(0, 200), fullTextPresent, rectCount: rects.length,
      firstRects: rects.slice(0, 8), lastRects: rects.slice(-8), geometry: probe.geometry,
      rangeOverflowPx: overflow, rangeSideAndBottomOverflowPx: sideAndBottomOverflow, scrollOverflow,
      paintedInk: { method: 'actual loaded font TextMetrics, baseline calibrated against each DOM grapheme Range font box',
        rects: inkRects.slice(0, 20), totalRects: inkRects.length, overflowPx: inkOverflow,
        fontMetricRangeMaxDeltaPx: metricDeltas.length ? Math.max(...metricDeltas) : null, fontCalibrations, issues: inkIssues },
      fits: rects.length > 0 && fullTextPresent && geometryFits && actualFrameHeightDelta <= 2 }
  }, { text: item.text, frame: item.frame, geometry }), navigation: steps }
}

async function closeApp(app: ElectronApplication) {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  await app.close().catch(() => undefined)
}
async function verifyColdElectron(item: Case, directory: string, errors: string[]) {
  const profile = join(directory, 'independent-electron-profile')
  await fs.mkdir(profile, { recursive: true })
  const disk = await new CourseV10Driver().load(await fs.readFile(item.file))
  if (disk.kind !== 'course-v10') throw new Error('Unexpected disk document kind')
  const app = await electron.launch({ cwd: root, args: ['.', '--user-data-dir=' + profile],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', COURSEWARE_E2E_BACKGROUND: '0' } })
  let page: Page | undefined
  try {
    page = await app.firstWindow(); page.setDefaultTimeout(12000)
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ BrowserWindow, dialog }, workspace) => {
      const window = BrowserWindow.getAllWindows()[0]; window?.setContentSize(1700, 1100); window?.show(); window?.focus()
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] })
    }, dirname(item.file))
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: basename(item.file), exact: true }).dblclick()
    const editor = page.locator('.course-editor-frame:visible'); await expect(editor).toBeVisible()
    if (await editor.getAttribute('data-editor-mode') !== 'deep')
      await editor.getByRole('button', { name: '在编辑器中打开', exact: true }).click()
    const id = await editor.getAttribute('data-document-id'); if (!id) throw new Error('No cold document identity')
    const cold = await page.evaluate(id => window.desktopAPI.documents!.read(id), id)
    if (cold.model.kind !== 'course-v10') throw new Error('Unexpected cold model kind')
    expect(cold.model.project).toEqual(disk.project); expect(cold.dirty).toBe(false)
    // Opening the actual saved artifact is a cold-open assertion; no GUI-edit claim is made here.
    await page.screenshot({ path: join(directory, 'independent-electron-cold.png') })
    return { freshProcessAndProfile: true, projectMatchesDisk: true, dirty: cold.dirty, revision: cold.revision,
      deepEditorOpened: true, manualUiEditPerformed: false }
  } catch (error) {
    if (page) {
      await page.screenshot({ path: join(directory, 'cold-failure.png') }).catch(() => undefined)
      await fs.writeFile(join(directory, 'cold-failure-dom.txt'), await page.locator('body').innerText().catch(() => ''), 'utf8')
    }
    throw error
  } finally { await closeApp(app) }
}

test('E0 consumes a real reference through remix, preserves editing, detects content capacity and cold-opens offline', async () => {
  test.skip(!process.env.GUOLING_TEMPLATE_E0_VERIFY, 'Explicit no-model E0 verification only')
  test.setTimeout(240000)
  const requested = process.env.GUOLING_TEMPLATE_E0_VERIFY!
  const manifest = requested === '1' ? join(output, 'latest-node.json') : resolve(requested)
  const node = JSON.parse(await fs.readFile(manifest, 'utf8'))
  expect(node.status).toBe('passed'); expect(node.modelRequests).toBe(0)
  expect(hash(await fs.readFile(node.source))).toBe(node.sourceSha256)
  const directory = await fs.mkdtemp(join(node.directory, 'visual-'))
  const errors: string[] = [], external: string[] = []
  const facts: any = { status: 'running', startedAt: new Date().toISOString(), manifest, directory,
    modelRequests: 0, scope: 'Bounded engineering E0; not an art-quality certification, speed benchmark, or generic template platform.', cases: [] }
  const browser = await chromium.launch()
  let current: Page | undefined
  try {
    facts.stage = 'prepare-real-browser-producer'
    const context = await browser.newContext({ offline: true, viewport: { width: 1440, height: 900 } })
    await context.addInitScript(() => { try {
      const worker = navigator.serviceWorker
      if (worker) worker.register = async () => { throw new DOMException('Offline verification', 'NotAllowedError') }
    } catch (error) { if ((error as Error).name !== 'SecurityError') throw error } })
    const compiler = await context.newPage(), bundle = await compileBundle(directory)
    compiler.on('pageerror', error => errors.push(error.message))
    await compiler.addStyleTag({ content: bundle.css }); await compiler.addScriptTag({ content: bundle.script })
    const player = await fs.readFile(join(root, 'dist-player/compiled-player.iife.js'), 'utf8')
    let normalFonts: number[] | undefined
    for (const item of node.cases as Case[]) {
      facts.stage = `export-${item.variant}`
      expect(item.probeRole, 'Do not silently reuse a previous title-only manifest for the body-capacity E0').toBe('body')
      expect(hash(await fs.readFile(item.file))).toBe(item.glxSha256)
      const exported = await exportOffline(compiler, item, directory, player)
      current = await context.newPage()
      current.on('pageerror', error => errors.push(error.message))
      current.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()) })
      facts.stage = `offline-load-${item.variant}`
      await current.goto(pathToFileURL(exported.file).href)
      await current.evaluate(async () => { const ready = (window as any).coursePlayerReady; if (ready) await ready })
      facts.stage = `actual-body-fit-${item.variant}`
      const measured = await measureText(current, item)
      if (item.variant === 'normal') normalFonts = measured.fontSizes
      const retainedFontSize = item.variant === 'normal' || !!normalFonts?.length && measured.fontSizes.length > 0
        && Math.min(...measured.fontSizes) >= Math.min(...normalFonts) - 0.1
      const acceptableFit = measured.fits && retainedFontSize
      const titleMeasured = await measureText(current, { ...item, ...item.titleProbe }, 'painted-ink')
      const outcome = { variant: item.variant, probeRole: item.probeRole, publicCapacity: item.publicCapacity, exported,
        measured, titleMeasured, retainedFontSize, acceptableFit,
        actualRemixAcceptedOversize: item.variant === 'overflow' }
      facts.cases.push(outcome)
      await writeJson(join(directory, `${item.variant}-fit.json`), outcome)
      await current.screenshot({ path: join(directory, `${item.variant}-offline.png`) })
      expect(measured.rectCount, 'Text must be measured from actual rendered glyphs').toBeGreaterThan(0)
      expect(titleMeasured.fits, 'The bounded title must still fit while the body probes capacity').toBe(true)
      if (item.variant === 'normal') expect(acceptableFit, 'Normal content must fit the retained fixed frame').toBe(true)
      else expect(acceptableFit, 'The deliberately huge content must not be certified by truncation or shrinking the retained font').toBe(false)
      expect(await current.evaluate(() => Boolean((window as any).__coursePlaybackFailed))).toBe(false)
      await current.close(); current = undefined
    }
    const normal = (node.cases as Case[]).find(item => item.variant === 'normal')
    if (!normal) throw new Error('Missing normal consumer case')
    facts.stage = 'independent-electron-cold-open'
    facts.coldElectron = await verifyColdElectron(normal, directory, errors)
    expect(errors).toEqual([]); expect(external).toEqual([])
    expect(hash(await fs.readFile(node.source))).toBe(node.sourceSha256)
    Object.assign(facts, { status: 'passed', stage: 'complete', completedAt: new Date().toISOString(), sourceUnchanged: true,
      normalContentFits: true, oversizedContentDetectedByConsumer: true, nativeCapacityIsNotFitValidation: true,
      actualBodyCapacityProbed: true,
      formalDeepEditsAndHistory: true, noRereadBetweenAcknowledgedEdits: true, errors, external })
    await writeJson(join(directory, 'visual-result.json'), facts); await writeJson(join(output, 'latest.json'), facts)
  } catch (error) {
    Object.assign(facts, { status: 'failed', completedAt: new Date().toISOString(), error: error instanceof Error ? error.stack : String(error), errors, external })
    if (current) {
      await current.screenshot({ path: join(directory, 'failure.png') }).catch(() => undefined)
      await fs.writeFile(join(directory, 'failure-dom.txt'), await current.locator('body').innerText().catch(() => ''), 'utf8')
    }
    await writeJson(join(directory, 'visual-failure.json'), facts); await writeJson(join(output, 'latest-visual-failure.json'), facts)
    throw error
  } finally { await browser.close() }
})
