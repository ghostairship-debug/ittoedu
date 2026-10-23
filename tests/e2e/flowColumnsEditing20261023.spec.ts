import { expect, test, type Page } from '@playwright/test'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import { setRootContainers } from '../helpers/glxWorkFixture'
import type { DocumentEvent, DocumentSnapshot } from '../../src/shared/workbench/document'

const json = (value: unknown) => JSON.parse(JSON.stringify(value))
const projectOf = (snapshot: DocumentSnapshot) => {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected course')
  return snapshot.model.project
}

async function mount(page: Page, host: DocumentHostService, documentId: string, events: DocumentEvent[], bundle: string) {
  await page.route('http://localhost/flow-columns', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>html,body,#editor{margin:0;width:100%;height:100%}</style><div id="editor"></div>' }))
  await page.goto('http://localhost/flow-columns')
  const api = host.internalAPI as any
  await page.exposeFunction('documentCall', async (name: string, args: unknown[]) => {
    const result = name === 'bootstrapCourse' ? await host.internalAPI.read(documentId)
      : name === 'readAuthoringDrafts' ? await host.readAuthoringDrafts(args[0] as string)
      : name === 'writeAuthoringDrafts' ? await host.writeAuthoringDrafts(args[0] as string, args[1] as any)
      : name === 'clearAuthoringDrafts' ? await host.clearAuthoringDrafts(args[0] as string) : await api[name](...args)
    return json({ result, events: events.splice(0) })
  })
  await page.evaluate(bundle)
  await page.evaluate(async () => {
    const listeners = new Set<(event: any) => void>()
    const api = { ...Object.fromEntries(['list', 'read', 'dispatch', 'restore', 'save', 'bootstrapCourse', 'readAuthoringDrafts', 'writeAuthoringDrafts', 'clearAuthoringDrafts'].map(name => [name, async (...args: any[]) => {
      const packet = await (window as any).documentCall(name, args)
      packet.events.forEach((event: any) => listeners.forEach(listener => listener(event)))
      return packet.result
    }])), subscribe: (listener: (event: any) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } }
    ;(window as any).harness = await (window as any).FlowColumns.mountCurrentCourseBrowserHarness(document.getElementById('editor'), api)
  })
}

test('nearby columns action, cross-column drag and range deletion use the real Flow editor and canonical tree', async ({ browser }, info) => {
  test.setTimeout(90_000)
  const directory = info.outputPath('columns'), root = resolve(__dirname, '../..')
  await mkdir(directory, { recursive: true })
  const project = createBlankCourseProjectV10('Columns'), surfaceId = project.rootIds[0]
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  for (const [id, text] of [['a', 'ABC'], ['b', 'XYZ'], ['c', 'Untouched paragraph']]) project.instances[id] = { id, definitionId: TEXT_DEFINITION.id, data: json(createTextComponentData(text)) }
  setRootContainers(project, [{ id: surfaceId, kind: 'flow', title: 'Columns', childIds: ['a', 'b', 'c'], flow: { layout: { widthMode: 'fluid', readingWidth: 860, wideContentWidth: 1100, toc: 'hidden' } } }])
  const host = new DocumentHostService(join(directory, 'recovery')), events: DocumentEvent[] = []
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'columns.glx')
  const off = host.subscribeEvents(event => events.push(event))
  const bundled = await build({ stdin: { contents: 'import "./src/renderer/styles/variables.css";import "./src/renderer/styles/globals.css";export * from "./tests/helpers/currentFlowBrowserHarness"', resolveDir: root }, bundle: true, platform: 'browser', format: 'iife', globalName: 'FlowColumns', write: false, outfile: join(directory, 'editor.js'), loader: { '.css': 'css', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' })
  const bundle = `(()=>{const style=document.createElement('style');style.textContent=${JSON.stringify(bundled.outputFiles.find(file => file.path.endsWith('.css'))!.text)};document.head.append(style)})();` + bundled.outputFiles.find(file => file.path.endsWith('.js'))!.text
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } }), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const current = async () => projectOf(await host.internalAPI.read(initial.documentId))
  const selectText = async (startId: string, start: number, endId = startId, end = start) => page.evaluate(({ startId, start, endId, end }) => {
    const text = (id: string) => { const walker = document.createTreeWalker(document.querySelector(`[data-flow-block-id="${id}"]`)!, NodeFilter.SHOW_TEXT); return walker.nextNode()! }
    const anchor = text(startId), head = text(endId), selection = document.getSelection()!
    ;(anchor.parentElement!.closest('[contenteditable="true"]') as HTMLElement).focus()
    selection.setBaseAndExtent(anchor, start, head, end)
    document.dispatchEvent(new Event('selectionchange'))
  }, { startId, start, endId, end })
  try {
    await mount(page, host, initial.documentId, events, bundle)
    await expect(page.locator('[data-flow-block-id="a"]')).toBeVisible()
    await selectText('a', 0, 'b', 3)
    await page.getByRole('button', { name: '所选段落分为两列', exact: true }).click()
    await expect.poll(async () => (await current()).instances[surfaceId].childIds?.length).toBe(2)
    const created = await current(), groupId = created.instances[surfaceId].childIds![0], [left, right] = created.instances[groupId].childIds!
    expect(created.instances[left].childIds).toEqual(['a']); expect(created.instances[right].childIds).toEqual(['b'])
    const a = page.locator('[data-flow-block-id="a"]'), b = page.locator('[data-flow-block-id="b"]')
    const aBox = await a.boundingBox(), bBox = await b.boundingBox()
    expect(bBox!.x).toBeGreaterThan(aBox!.x + aBox!.width)
    await a.click()
    await page.getByRole('button', { name: '段落操作', exact: true }).dragTo(b, { targetPosition: { x: 40, y: bBox!.height - 2 } })
    await expect.poll(async () => (await current()).instances[right].childIds).toEqual(['b', 'a'])
    await b.click()
    await page.getByRole('button', { name: '段落操作', exact: true }).dragTo(page.locator(`[data-flow-block-id="${left}"]`), { targetPosition: { x: 40, y: 10 } })
    await expect.poll(async () => (await current()).instances[left].childIds).toEqual(['b'])
    expect((await current()).instances[right].childIds).toEqual(['a'])
    await selectText('b', 1, 'a', 1)
    await page.keyboard.press('Delete')
    await expect.poll(async () => textComponentDataSchema.parse((await current()).instances.b.data).content.inlines.map(inline => inline.type === 'text' ? inline.text : '').join('')).toBe('X')
    const deleted = await current()
    expect(textComponentDataSchema.parse(deleted.instances.a.data).content.inlines).toMatchObject([{ text: 'BC' }])
    expect(deleted.instances[groupId].childIds).toEqual([left, right])
    expect(deleted.instances[left].childIds).toEqual(['b']); expect(deleted.instances[right].childIds).toEqual(['a'])
    expect(deleted.instances.c).toEqual(project.instances.c)
    await selectText('a', 0)
    await page.keyboard.press('Backspace')
    expect((await current()).instances[right].childIds).toEqual(['a'])
    await page.screenshot({ path: join(directory, 'columns-after-drag-delete.png') })
    await writeFile(join(directory, 'facts.json'), JSON.stringify({ groupId, left, right, created: created.instances, result: (await current()).instances, errors }, null, 2))
    expect(errors).toEqual([])
    expect(await page.evaluate(() => (window as any).harness.errors)).toEqual([])
  } finally { await page.evaluate(() => (window as any).harness?.dispose()).catch(() => {}); off(); await page.close() }
})
