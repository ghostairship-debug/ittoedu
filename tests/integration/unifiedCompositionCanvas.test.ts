// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildSync } from 'esbuild'
import { chromium, type Locator } from 'playwright'
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { HTML_PROGRAM_DEFINITION } from '../../src/components/web/data'
import type { ComponentAuthorRecord } from '../../src/shared/contracts/component-platform'
import type { DocumentOperation } from '../../src/shared/workbench/document'

async function center(locator: Locator) { const box = await locator.boundingBox(); if (!box) throw Error('Visible canvas control required'); return { x: box.x + box.width / 2, y: box.y + box.height / 2 } }
it('F05 edits actual current Slide author spots through one Web runtime and canonical history without a dialog or program reset', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'composition-canvas-')), browser = await chromium.launch({ headless: true })
  try {
    const driver = new CourseV10Driver(), registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
      persistence: { async append() {}, async save(input) { if (input.binding.kind !== 'file') throw Error('File required'); await fs.writeFile(input.binding.path, input.bytes); return { ...input.binding, version: `revision-${input.revision}` } } } })
    const project = createBlankCourseProjectV10('Canvas content'); project.global = { underlay: [], overlay: [] }; project.instances = {}; project.definitions = { [HTML_PROGRAM_DEFINITION.id]: HTML_PROGRAM_DEFINITION }
    project.surfaces = [{ id: 'slide', kind: 'slide', title: '内容编辑', childIds: ['canvas-content'], designSize: { width: 1000, height: 620 } }]
    const html = '<!doctype html><html><head><style>body{margin:0;position:relative;height:620px;background:white;font:18px sans-serif}#free{position:absolute;left:100px;top:240px;width:240px;height:100px;margin:0;background:#fff1cc;box-sizing:border-box}main{display:flex;gap:16px;padding:30px}section{flex:0 0 180px;height:100px;background:#e9f2ff}#counter{position:absolute;left:100px;top:420px}</style></head><body><p id="free" data-cw-author-key="free">Editable content</p><main><section>Card a</section><section>Card b</section><section>Card c</section></main><button id="counter">count:0</button><script>window.counterCreates=(window.counterCreates||0)+1;let count=0;document.getElementById("counter").onclick=()=>document.getElementById("counter").textContent="count:"+(++count)</script></body></html>'
    const record: ComponentAuthorRecord = { kind: 'text', binding: { kind: 'dom', path: [{ tag: 'body', index: 1 }, { tag: 'p', index: 0, attributes: { id: 'free', 'data-cw-author-key': 'free' } }], textIndex: 0, baseline: 'Editable content' }, overrides: {} }
    project.instances['canvas-content'] = { id: 'canvas-content', definitionId: HTML_PROGRAM_DEFINITION.id, data: { html, authoringRecords: JSON.parse(JSON.stringify({ free: record })) }, frame: { width: 1000, height: 620, transform: [1, 0, 0, 1, 0, 0] } }
    const initial = { kind: 'course-v10' as const, project, resources: { assets: {}, components: {} } }, session = await registry.create(initial, 'canvas.glx')
    const commits: DocumentOperation[] = []; session.subscribeCommits(commit => commits.push(commit.operation))
    const bundle = buildSync({ stdin: { contents: "export * from './tests/helpers/currentCourseBrowserHarness'", resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', globalName: 'CurrentCourse', platform: 'browser',
      loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' }, define: { 'process.env.NODE_ENV': '"test"' } }).outputFiles[0].text
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } }), pageErrors: string[] = []; page.setDefaultTimeout(10_000); page.on('pageerror', error => pageErrors.push(error.message))
    await page.route('http://localhost/composition-canvas', route => route.fulfill({ contentType: 'text/html', body: '<main id="host" style="width:920px;height:700px;display:grid;position:relative"></main>' }))
    await page.goto('http://localhost/composition-canvas')
    await page.exposeFunction('courseRead', () => session.read())
    await page.exposeFunction('courseDispatch', (operation: DocumentOperation) => session.execute(operation))
    await page.exposeFunction('courseLookup', (id: string) => session.lookupOperation(id))
    await page.addStyleTag({ content: (await fs.readFile('src/renderer/styles/globals.css', 'utf8')).replace("@import './variables.css';", await fs.readFile('src/renderer/styles/variables.css', 'utf8')) })
    await page.addScriptTag({ content: bundle })
    await page.evaluate(async () => {
      const w = window as any, api = { bootstrapCourse: w.courseRead, read: w.courseRead, dispatch: w.courseDispatch, lookup: (_documentId: string, id: string) => w.courseLookup(id), subscribe: () => () => {} }
      w.desktopAPI = { documents: api }
      w.__courseHarness = await w.CurrentCourse.mountCurrentCourseBrowserHarness(document.getElementById('host'), api)
    })
    const ready = async () => {
      await expect.poll(() => page.locator('[data-author-spot]').count()).toBeGreaterThan(0)
      await expect.poll(() => page.evaluate(() => (window as any).CurrentCourse.useEditorStore.getState().courseView.pending)).toBe(0)
    }
    await ready()
    const frame = page.frames().find(value => value !== page.mainFrame() && value.url() !== 'about:blank') ?? page.frames().find(value => value !== page.mainFrame())
    if (!frame) throw Error('Real Web content realm required')
    await expect.poll(() => frame.locator('#free').count()).toBe(1)
    const iframe = page.locator('iframe').first()
    await frame.evaluate(() => { const w = window as any; w.keptButton = document.getElementById('counter'); w.keptButton.onclick(); w.keptFrameBody = document.body })
    const camera = await page.locator('.canvas-stage-stack').getAttribute('style')
    expect(await page.locator('iframe').count()).toBe(1); expect(await page.getByRole('dialog').count()).toBe(0)
    const scale = (await page.locator('.canvas-stage-stack').boundingBox())!.width / 1000
    expect(scale).toBeGreaterThan(0); expect(scale).toBeLessThan(1)
    const freeTarget = page.locator('[data-author-spot="canvas-content:free:{}"]')
    await freeTarget.waitFor({ state: 'visible' })
    const geometry = () => frame.locator('#free').evaluate(element => { const rect = element.getBoundingClientRect(); return { x: Math.round(rect.x * 1000) / 1000, y: Math.round(rect.y * 1000) / 1000, width: Math.round(rect.width * 1000) / 1000, height: Math.round(rect.height * 1000) / 1000 } })
    const first = session.read(), start = await center(freeTarget)
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 80 * scale, start.y + 40 * scale, { steps: 5 })
    expect(session.read().revision).toBe(first.revision); expect(session.read().undoDepth).toBe(first.undoDepth)
    await page.mouse.up(); await ready(); await expect.poll(() => session.read().revision).toBe(first.revision + 1)
    expect(session.read().undoDepth).toBe(first.undoDepth + 1); expect(await geometry()).toMatchObject({ x: 180, y: 280, width: 240, height: 100 })
    const resize = page.locator('[data-internal-selection] [data-handle="se"]'), resizeStart = await center(resize), second = session.read()
    await page.mouse.move(resizeStart.x, resizeStart.y); await page.mouse.down(); await page.mouse.move(resizeStart.x + 60 * scale, resizeStart.y + 30 * scale, { steps: 5 })
    expect(session.read().revision).toBe(second.revision)
    await page.mouse.up(); await ready(); await expect.poll(() => session.read().revision).toBe(second.revision + 1)
    expect(session.read().undoDepth).toBe(second.undoDepth + 1); expect(await geometry()).toMatchObject({ x: 180, y: 280, width: 300, height: 130 })
    const third = session.read(), cancelStart = await center(freeTarget)
    await page.mouse.move(cancelStart.x, cancelStart.y); await page.mouse.down(); await page.mouse.move(cancelStart.x + 50, cancelStart.y + 20); await page.keyboard.press('Escape'); await page.mouse.up(); await ready()
    expect(session.read().revision).toBe(third.revision); expect(session.read().undoDepth).toBe(third.undoDepth); expect(commits).toHaveLength(2)
    expect((session.read().model as typeof initial).project.instances['canvas-content'].frame).toEqual(project.instances['canvas-content'].frame)
    expect((session.read().model as typeof initial).project.instances['canvas-content'].data).toMatchObject({ html })
    expect(await frame.evaluate(() => { const w = window as any; return { creates: w.counterCreates, sameButton: w.keptButton === document.getElementById('counter'), sameBody: w.keptFrameBody === document.body, count: document.getElementById('counter')!.textContent } })).toEqual({ creates: 1, sameButton: true, sameBody: true, count: 'count:1' })
    expect(await page.locator('.canvas-stage-stack').getAttribute('style')).toBe(camera); expect(await page.locator('iframe').count()).toBe(1); expect(pageErrors).toEqual([])
    expect(await page.evaluate(() => (window as any).__courseHarness.errors)).toEqual([])
    const filename = path.join(directory, 'canvas.glx'); await registry.save(session.documentId, { kind: 'file', path: filename, version: null, bindingVersion: 0 })
    const reopened = driver.load(new Uint8Array(await fs.readFile(filename))); expect(reopened).toEqual(session.read().model)
    await page.evaluate(async () => { await (window as any).CurrentCourse.useEditorStore.getState().undo() }); await ready()
    await expect.poll(geometry).toEqual({ x: 180, y: 280, width: 240, height: 100 })
    await page.evaluate(async () => (window as any).__courseHarness.dispose())
  } finally { await browser.close(); await fs.rm(directory, { recursive: true, force: true }) }
}, 45_000)
