import { _electron as electron, chromium, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(__dirname, '../..')
const base = path.join(root, 'output/coffee-host-layout-repair-20261021/run-112329')
const directory = path.join(base, process.env.COFFEE_LAYOUT_RUN ?? `green-${Date.now()}`)
const workspace = path.join(directory, 'workspace')
const programId = '8bc2720a-0b46-439a-98c1-dc505b1cb456'
const groupId = '25abbae2-ce63-46cb-b01c-f5d9c21be846'
const natural = '让果实，陪着种子一起干燥。'
const revised = '让果实，继续陪着种子一起干燥。'
const continued = '让果实，在同一会话里陪着种子干燥。'

function environment() {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !/(?:API_KEY|TOKEN|SECRET|CREDENTIAL)/i.test(entry[0])))
  delete env.ELECTRON_RUN_AS_NODE
  return { ...env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', COURSEWARE_E2E_BACKGROUND: '0' }
}
async function launch(profile: string) {
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`], env: environment() })
  const page = await app.firstWindow(); page.setDefaultTimeout(15_000)
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(1600, 1100); window.show(); window.focus() })
  await expect(page.getByLabel('切换工作空间', { exact: true })).toBeVisible()
  return { app, page }
}
async function close(app: ElectronApplication) {
  await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
  await app.close().catch(() => undefined)
}
async function open(app: ElectronApplication, page: Page, filename: string) {
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, workspace)
  await page.getByLabel('切换工作空间', { exact: true }).click()
  await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
  await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: filename, exact: true }).dblclick()
  const frame = page.locator('.course-editor-frame:visible'); await expect(frame).toBeVisible()
  if (await frame.getAttribute('data-editor-mode') !== 'deep') await frame.getByRole('button', { name: '在编辑器中打开', exact: true }).click()
  await expect(frame).toHaveAttribute('data-editor-mode', 'deep')
  const id = await frame.getAttribute('data-document-id'); if (!id) throw new Error('No DocumentSession in editor')
  return id
}
async function snapshot(app: ElectronApplication, documentId: string) {
  return app.evaluate(async ({ app }, documentId) => {
    const { createRequire } = process.getBuiltinModule('node:module'), r = createRequire(`${app.getAppPath()}/package.json`)
    const s = await r('./dist-electron/main/workbench/documentHost.js').documentHost().internalAPI.read(documentId)
    return { documentId: s.documentId, revision: s.revision, dirty: s.dirty, undoDepth: s.undoDepth, model: s.model }
  }, documentId)
}
async function edit(app: ElectronApplication, documentId: string, kind: 'content' | 'frame' | 'move' | 'moveBack' | 'undo' | 'redo', previous?: string, next?: string, targetId = programId) {
  return app.evaluate(async ({ app }, serialized) => {
    const input = JSON.parse(serialized), { createRequire } = process.getBuiltinModule('node:module'), r = createRequire(`${app.getAppPath()}/package.json`)
    const host = r('./dist-electron/main/workbench/documentHost.js').documentHost(), s = await host.internalAPI.read(input.documentId)
    const project = s.model.project, instance = project.instances[input.programId], serial = `coffee-${input.kind}-${Date.now()}`
    if (input.kind === 'content') {
      const { componentProjectFiles } = r('./dist-electron/core/projectFiles/componentPlatform/index.js')
      const file = componentProjectFiles(project, s.model.resources).find((file: any) => file.kind === 'html' && file.target?.instanceId === input.programId)
      await host.tools.beginRun({ runId: serial, actor: 'human', documents: [{ documentId: s.documentId, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: input.workspace } })
      await host.tools.loadToolFamilies(serial, ['content'])
      await host.tools.execute(serial, `${serial}-read`, { name: 'project.read', input: { path: file.path } })
      const result = await host.tools.execute(serial, `${serial}-apply`, { name: 'project.apply', input: { path: file.path,
        edits: [{ old: `"title":"${input.previous}"`, new: `"title":"${input.next}"` }] } })
      await host.tools.stop(serial)
      return { result, revision: (await host.internalAPI.read(s.documentId)).revision, file: file.path }
    }
    const edits = input.kind === 'frame' ? [{ type: 'frame.set', instanceId: input.programId, frame: { ...instance.frame, height: instance.frame.height + 10 } }]
      : [{ type: 'instance.move', instanceId: input.groupId, container: { kind: 'instance', instanceId: input.kind === 'moveBack' ? 'e66f6c20-3292-4bb7-a1ca-cb6e07c45c7e' : project.rootIds[0] }, index: input.kind === 'moveBack' ? 0 : 1, frame: project.instances[input.groupId].frame }]
    const mutation = input.kind === 'undo' || input.kind === 'redo' ? { type: input.kind } : { type: 'command', command: r('./dist-electron/core/drivers/courseV10Operations.js').captureComponentOperation(project, edits) }
    const result = await host.internalAPI.dispatch({ documentId: s.documentId, epoch: s.epoch, baseRevision: s.revision, operationId: serial, actor: 'human', mutation })
    return { result, revision: (await host.internalAPI.read(s.documentId)).revision }
  }, JSON.stringify({ documentId, kind, previous, next, workspace, programId: targetId, groupId }))
}
async function lab(page: Page): Promise<Locator> {
  let found: Locator | undefined
  await expect.poll(async () => {
    for (const frame of page.frames()) {
      const value = frame.locator('[data-process-lab]')
      if (await value.count()) { found = value; return true }
    }
    return false
  }).toBe(true)
  return found!
}
async function input(page: Page, title: string) {
  const compiled = page.locator(`[data-compiled-node="${programId}"]`)
  if (await compiled.count()) await compiled.scrollIntoViewIfNeeded()
  const target = await lab(page), button = target.locator('[data-method="honey"]')
  await button.scrollIntoViewIfNeeded()
  await button.evaluate(element => element.addEventListener('click', event => { (element as HTMLElement).dataset.lastTrusted = String(event.isTrusted) }, { once: true }))
  await trustedClick(page, button)
  await expect(target).toHaveAttribute('data-method', 'honey')
  await expect(button).toHaveAttribute('data-last-trusted', 'true')
  const naturalButton = target.locator('[data-method="natural"]')
  await trustedClick(page, naturalButton)
  await expect(target.locator('[data-method-title]')).toHaveText(title)
  await expect.poll(() => target.locator('.specimen-image[data-active="true"]').evaluate(node => { const image = node as HTMLImageElement; return image.complete && image.naturalWidth > 0 })).toBe(true)
  // A duplicated listener would toggle twice and leave this panel closed.
  const detail = target.locator('[data-detail]')
  await expect(target.locator('[data-detail-panel]')).toHaveAttribute('data-open', 'false')
  await trustedClick(page, detail)
  await expect(target.locator('[data-detail-panel]')).toHaveAttribute('data-open', 'true')
  await trustedClick(page, detail)
  await expect(target.locator('[data-detail-panel]')).toHaveAttribute('data-open', 'false')
  return target.evaluate(element => ({ method: (element as HTMLElement).dataset.method, viewport: { width: innerWidth, height: innerHeight },
    bounds: element.getBoundingClientRect().toJSON(), title: element.querySelector('[data-method-title]')!.textContent,
    image: (() => { const image = element.querySelector('.specimen-image[data-active="true"]') as HTMLImageElement; return { decoded: image.complete && image.naturalWidth > 0, width: image.naturalWidth, height: image.naturalHeight } })(),
    controls: [...element.querySelectorAll('[data-method]')].map(node => ({ text: node.textContent, box: node.getBoundingClientRect().toJSON() })) }))
}
async function trustedClick(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded()
  let point = await target.evaluate(element => { const box = element.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 } })
  let frame = await (await target.elementHandle())!.ownerFrame()
  while (frame?.parentFrame()) {
    const element = await frame.frameElement()
    const local = await element.evaluate(node => { const iframe = node as HTMLIFrameElement; return { rect: iframe.getBoundingClientRect().toJSON(), width: iframe.offsetWidth, height: iframe.offsetHeight, left: iframe.clientLeft, top: iframe.clientTop } })
    const painted = frame.parentFrame() === page.mainFrame() ? await element.boundingBox() : local.rect
    if (!painted) throw new Error('Input frame has no painted box')
    point = { x: painted.x + (local.left + point.x) * painted.width / local.width, y: painted.y + (local.top + point.y) * painted.height / local.height }
    frame = frame.parentFrame()
  }
  await page.mouse.click(point.x, point.y)
}
async function mounted(page: Page) {
  await expect(page.getByText('编辑器界面发生错误', { exact: true })).toHaveCount(0)
  const shell = page.locator(`[data-flow-block-id="${programId}"]`)
  await expect(shell).toHaveCount(1)
  await shell.scrollIntoViewIfNeeded()
  await expect(shell.locator(`[data-component-runtime-root="${programId}"]`)).toHaveCount(1)
  await expect(shell.locator('iframe')).toHaveCount(1)
  return shell.evaluate(element => ({ connected: element.isConnected, box: element.getBoundingClientRect().toJSON(),
    iframe: element.querySelector('iframe')!.getBoundingClientRect().toJSON(), runtimeRoots: element.querySelectorAll('[data-component-runtime-root]').length,
    flowHeight: getComputedStyle(element.querySelector('[data-component-runtime-root]')!).height }))
}
async function exportHtml(app: ElectronApplication, documentId: string) {
  return app.evaluate(async ({ app }, serialized) => {
    const input = JSON.parse(serialized), { createRequire } = process.getBuiltinModule('node:module'), r = createRequire(`${app.getAppPath()}/package.json`)
    const host = r('./dist-electron/main/workbench/documentHost.js').documentHost(), runId = `coffee-export-${Date.now()}`
    await host.tools.beginRun({ runId, actor: 'human', documents: [{ documentId: input.documentId, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: input.workspace } })
    await host.tools.loadToolFamilies(runId, ['build'])
    const opened = await host.tools.completeOpenedDocument(runId, { documentId: input.documentId, writable: true }, { selection: 'preserve' })
    const result = await host.tools.execute(runId, 'offline', { name: 'document.export', input: { target: opened.target, format: 'html-offline', destination: 'coffee-offline.html' } })
    await host.tools.stop(runId); return result
  }, JSON.stringify({ documentId, workspace }))
}

test('Flow object refresh preserves mounted programs through editing, history, group move, cold open and offline delivery', async ({}, info) => {
  test.setTimeout(300_000)
  await mkdir(workspace, { recursive: true })
  const source = path.join(root, 'docs/creative-production/works/coffee-journey/design/v05/native/coffee-journey-v05-pre-layout.glx')
  await copyFile(source, path.join(workspace, 'coffee-fixture.glx'))
  const facts: Record<string, any> = { directory, source,
    scope: process.env.COFFEE_LAYOUT_REEXPORT_SOURCE ? 'Final build formal re-export and offline dimensions/input/V01; unchanged live editing and cold-open evidence reused'
      : process.env.COFFEE_LAYOUT_FROZEN_HTML ? 'Existing formal offline file dimensions/input/V01 only; unchanged live editing and cold-open evidence reused'
      : 'Preserved pre-layout project copy: live edit, history, save/cold open, formal offline dimensions/input/V01; no model requests or authored recognition CSS added' }, errors: string[] = []
  let warm: Awaited<ReturnType<typeof launch>> | undefined, cold: Awaited<ReturnType<typeof launch>> | undefined
  try {
    if (!process.env.COFFEE_LAYOUT_FROZEN_HTML && !process.env.COFFEE_LAYOUT_REEXPORT_SOURCE) {
    warm = await launch(path.join(directory, 'warm-profile')); warm.page.on('pageerror', error => errors.push(`warm: ${error.message}`))
    const id = await open(warm.app, warm.page, 'coffee-fixture.glx')
    const before = await snapshot(warm.app, id), program = before.model.project.instances[programId]
    expect(program.implementationOverride).toEqual({ kind: 'builtin', key: 'guoling.html-program' })
    expect(program.data.html).not.toContain('data-guoling-local-viewport')
    expect(program.data.html).not.toMatch(/min-height\s*:\s*100%/i)
    const rootCss = [...String(program.data.html).matchAll(/(?:^|})\s*([^{}]+)\{([^{}]*)\}/g)].filter(match => /(?:^|[\s,])(?:html|body)(?:\b|[.#[:])/.test(match[1])).map(match => ({ selector: match[1].trim(), declarations: match[2] }))
    facts.input = { revision: before.revision, frame: program.frame, override: program.implementationOverride, definition: before.model.project.definitions[program.definitionId].implementation,
      rootCss, recognitionMinHeight100: /min-height\s*:\s*100%/i.test(program.data.html) }
    facts.initial = await mounted(warm.page)
    facts.localEdit = await edit(warm.app, id, 'content', natural, revised)
    expect(facts.localEdit.result.kind).not.toBe('error')
    facts.frameRefresh = await edit(warm.app, id, 'frame'); expect(facts.frameRefresh.result.status).toBe('applied')
    facts.afterRefresh = await mounted(warm.page)
    await warm.page.getByRole('group', { name: '画布模式', exact: true }).getByRole('button', { name: '试运行', exact: true }).click()
    facts.warmInput = await input(warm.page, revised)
    expect(facts.warmInput.viewport.height / facts.warmInput.viewport.width).toBeCloseTo(810 / 1120, 1)
    await warm.page.screenshot({ path: path.join(directory, 'warm-refresh-and-input.png') })
    await warm.page.getByRole('group', { name: '画布模式', exact: true }).getByRole('button', { name: '编辑', exact: true }).click()
    facts.continued = await edit(warm.app, id, 'content', revised, continued); expect(facts.continued.result.kind).not.toBe('error')
    facts.undo = await edit(warm.app, id, 'undo'); expect(facts.undo.result.status).toBe('applied')
    await mounted(warm.page)
    facts.redo = await edit(warm.app, id, 'redo'); expect(facts.redo.result.status).toBe('applied')
    facts.groupMove = await edit(warm.app, id, 'move'); expect(facts.groupMove.result.status).toBe('applied')
    facts.afterGroupMove = await mounted(warm.page)
    const moved = await snapshot(warm.app, id)
    expect(moved.model.project.instances[moved.model.project.rootIds[0]].childIds).toContain(groupId)
    expect(moved.model.project.instances[groupId].frame).toEqual(before.model.project.instances[groupId].frame)
    facts.groupUndo = await edit(warm.app, id, 'undo'); expect(facts.groupUndo.result.status).toBe('applied')
    await mounted(warm.page)
    facts.groupRedo = await edit(warm.app, id, 'redo'); expect(facts.groupRedo.result.status).toBe('applied')
    await mounted(warm.page)
    await warm.page.getByRole('group', { name: '画布模式', exact: true }).getByRole('button', { name: '试运行', exact: true }).click()
    facts.afterHistoryInput = await input(warm.page, continued)
    await warm.page.screenshot({ path: path.join(directory, 'warm-history-group-input.png') })
    await warm.page.getByRole('group', { name: '画布模式', exact: true }).getByRole('button', { name: '编辑', exact: true }).click()
    const saved = path.join(workspace, 'coffee-saved.glx')
    await warm.app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, saved)
    await warm.page.getByRole('button', { name: '另存为', exact: true }).click()
    await expect.poll(async () => (await snapshot(warm!.app, id)).dirty).toBe(false)
    facts.saved = { path: saved, revision: (await snapshot(warm.app, id)).revision }
    await close(warm.app); warm = undefined

    cold = await launch(path.join(directory, 'cold-profile')); cold.page.on('pageerror', error => errors.push(`cold: ${error.message}`))
    const coldId = await open(cold.app, cold.page, 'coffee-saved.glx')
    facts.coldDocument = await snapshot(cold.app, coldId)
    expect(facts.coldDocument).toMatchObject({ dirty: false, undoDepth: 0 })
    delete facts.coldDocument.model
    facts.coldMounted = await mounted(cold.page)
    await cold.page.getByRole('group', { name: '画布模式', exact: true }).getByRole('button', { name: '试运行', exact: true }).click()
    facts.coldInput = await input(cold.page, continued)
    await cold.page.screenshot({ path: path.join(directory, 'cold-input.png') })
    facts.export = await exportHtml(cold.app, coldId)
    expect(facts.export).toMatchObject({ kind: 'read', data: { status: 'written', format: 'html-offline' } })
    await close(cold.app); cold = undefined
    } else if (process.env.COFFEE_LAYOUT_REEXPORT_SOURCE) {
      await copyFile(process.env.COFFEE_LAYOUT_REEXPORT_SOURCE, path.join(workspace, 'coffee-reexport.glx'))
      cold = await launch(path.join(directory, 'export-profile')); cold.page.on('pageerror', error => errors.push(`export: ${error.message}`))
      const id = await open(cold.app, cold.page, 'coffee-reexport.glx')
      facts.export = await exportHtml(cold.app, id)
      expect(facts.export).toMatchObject({ kind: 'read', data: { status: 'written', format: 'html-offline' } })
      await close(cold.app); cold = undefined
      facts.reused = { source: process.env.COFFEE_LAYOUT_REEXPORT_SOURCE, evidence: 'Unchanged successful warm edit/history/group move, save and new-profile cold-open properties in source run facts.json; only changed final export/player consumer repeated' }
    } else facts.reused = { html: process.env.COFFEE_LAYOUT_FROZEN_HTML, evidence: 'Unchanged successful warm edit/history/group move, save and new-profile cold-open properties in the source run facts.json' }
    const html = process.env.COFFEE_LAYOUT_FROZEN_HTML ?? path.join(workspace, 'coffee-offline.html')
    const browser = await chromium.launch({ headless: true })
    let offlinePage: Page | undefined
    try {
      const context = await browser.newContext({ offline: true, viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), requests: string[] = []
      offlinePage = page
      page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
      page.on('pageerror', error => errors.push(`offline: ${error.message}`))
      await page.goto(pathToFileURL(html).href); await page.evaluate(async () => { await Reflect.get(window, 'coursePlayerReady') })
      facts.offlineInput = await input(page, continued)
      expect(facts.offlineInput.viewport.height / facts.offlineInput.viewport.width).toBeCloseTo(810 / 1120, 1)
      await page.screenshot({ path: path.join(directory, 'offline-desktop-input.png') })
      const size = () => page.evaluate(({ groupId, programId }) => {
        const paragraph = document.querySelector('[data-compiled-node="4b5a2e50-5d1e-4cc7-b551-c6697702fcc6"] [data-text-component-content]')!
        const group = document.querySelector(`[data-compiled-node="${groupId}"]`)!, program = document.querySelector(`[data-compiled-node="${programId}"]`)!
        const text = group.querySelector('[data-text-component-content]') ?? group
        const nodeBox = (element: Element | null) => element && ({ box: element.getBoundingClientRect().toJSON(), width: getComputedStyle(element).width, height: getComputedStyle(element).height, transform: getComputedStyle(element).transform })
        const scales = (element: Element) => { const values = []; for (let node: Element | null = element; node; node = node.parentElement) { const style = getComputedStyle(node); if (style.transform !== 'none') values.push({ tag: node.tagName, id: node.id, className: node.className, transform: style.transform }) } return values }
        const glyph = (element: Element) => { const leaf = [...element.querySelectorAll('span')].find(node => node.childNodes[0]?.nodeType === Node.TEXT_NODE); if (!leaf) return null; const range = document.createRange(); range.setStart(leaf.firstChild!, 0); range.setEnd(leaf.firstChild!, 1); return range.getBoundingClientRect().toJSON() }
        return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
          paragraph: { box: paragraph.getBoundingClientRect().toJSON(), font: getComputedStyle(paragraph).fontSize, transform: getComputedStyle(paragraph).transform, ancestors: scales(paragraph), glyph: glyph(paragraph) },
          group: { box: group.getBoundingClientRect().toJSON(), text: text.getBoundingClientRect().toJSON(), font: getComputedStyle(text).fontSize, transform: getComputedStyle(group).transform, ancestors: scales(text), glyph: glyph(text),
            stage: nodeBox(group.querySelector(':scope > [data-compiled-stage]')), content: nodeBox(group.querySelector(`[data-compiled-runtime-root="${groupId}"]`)), children: nodeBox(group.querySelector(':scope > [data-compiled-stage] > [data-compiled-children]')) },
          program: { box: program.getBoundingClientRect().toJSON(), iframe: program.querySelector('iframe')?.getBoundingClientRect().toJSON() } }
      }, { groupId, programId })
      facts.desktopScale = await size()
      await page.locator(`[data-compiled-node="${groupId}"]`).scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(directory, 'offline-desktop-fixed-group.png') })
      await page.setViewportSize({ width: 390, height: 844 })
      facts.narrowScale = await size()
      await page.locator(`[data-compiled-node="${groupId}"]`).scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(directory, 'offline-390-fixed-group.png') })
      expect(facts.narrowScale.paragraph.font).toBe(facts.desktopScale.paragraph.font)
      expect(Math.abs(facts.narrowScale.paragraph.glyph.height - facts.desktopScale.paragraph.glyph.height)).toBeLessThan(1)
      expect(facts.narrowScale.paragraph.box.width).toBeLessThan(facts.desktopScale.paragraph.box.width)
      expect(facts.narrowScale.paragraph.box.height).toBeGreaterThan(facts.desktopScale.paragraph.box.height)
      expect(facts.narrowScale.group.box.width).toBeLessThan(facts.desktopScale.group.box.width)
      expect(facts.narrowScale.group.children.box.width).toBeLessThanOrEqual(facts.narrowScale.group.box.width + 1)
      facts.narrowInput = await input(page, continued)
      await page.screenshot({ path: path.join(directory, 'offline-390-program.png') })
      const paragraph = page.locator('[data-compiled-node="4b5a2e50-5d1e-4cc7-b551-c6697702fcc6"] [data-text-component-content]'); await paragraph.scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(directory, 'offline-390-flow-paragraph.png') })
      facts.network = requests; expect(requests).toEqual([])
    } finally { await offlinePage?.screenshot({ path: path.join(directory, 'offline-final.png') }).catch(() => undefined); await browser.close() }
    expect(errors).toEqual([])
    facts.status = 'passed-targeted'
  } finally {
    facts.errors = errors
    await writeFile(path.join(directory, 'facts.json'), JSON.stringify(facts, null, 2))
    if (warm) { await warm.page.screenshot({ path: path.join(directory, 'warm-failure.png') }).catch(() => undefined); await close(warm.app) }
    if (cold) { await cold.page.screenshot({ path: path.join(directory, 'cold-failure.png') }).catch(() => undefined); await close(cold.app) }
    await info.attach('Coffee host/layout facts', { path: path.join(directory, 'facts.json'), contentType: 'application/json' })
  }
})

test('a moved native group remains painted and editable in the same Flow session', async ({}, info) => {
  test.setTimeout(120_000)
  await mkdir(workspace, { recursive: true })
  const source = process.env.COFFEE_LAYOUT_STRUCTURE_SOURCE ?? path.join(root, 'docs/creative-production/works/coffee-journey/design/v05/native/coffee-journey-v05-pre-layout.glx')
  await copyFile(source, path.join(workspace, 'coffee-structure.glx'))
  const view = await launch(path.join(directory, 'structure-profile')), facts: Record<string, any> = {}, errors: string[] = []
  view.page.on('pageerror', error => errors.push(error.message))
  const groupPaint = async (placement: 'flow' | 'slide') => {
    await expect(view.page.getByText('编辑器界面发生错误', { exact: true })).toHaveCount(0)
    const shell = placement === 'flow' ? view.page.locator(`[data-flow-block-id="${groupId}"]`) : view.page.locator('[data-flow-block-id="e66f6c20-3292-4bb7-a1ca-cb6e07c45c7e"]')
    await expect(shell).toHaveCount(1); await shell.scrollIntoViewIfNeeded()
    await shell.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }))
    const observe = () => shell.evaluate((element, groupId) => ({ connected: element.isConnected, flowBlockId: (element as HTMLElement).dataset.flowBlockId,
      text: element.textContent?.slice(-500), box: element.getBoundingClientRect().toJSON(), groupNodes: element.querySelectorAll(`[data-component-instance="${groupId}"]`).length,
      html: element.outerHTML.slice(0, 5000), roots: element.querySelectorAll('[data-component-runtime-root]').length,
      ancestors: (() => { const values = []; for (let node: HTMLElement | null = element.parentElement; node; node = node.parentElement) values.push({ tag: node.tagName, className: node.className, box: node.getBoundingClientRect().toJSON(), scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, overflow: getComputedStyle(node).overflow }); return values })(),
      nativeNodes: [...element.querySelectorAll('[data-component-instance],[data-component-object]')].map(node => ({ id: (node as HTMLElement).dataset.componentInstance ?? (node as HTMLElement).dataset.componentObject, box: node.getBoundingClientRect().toJSON() })),
      nativeTextRoots: element.querySelectorAll('[data-text-component-content]').length }), groupId)
    try { await expect(shell).toContainText('一杯咖啡') } catch (error) {
      facts.failedPaint = await observe()
      await view.page.screenshot({ path: path.join(directory, `structure-${placement}-failure.png`) })
      throw error
    }
    return observe()
  }
  try {
    const id = await open(view.app, view.page, 'coffee-structure.glx')
    const before = await snapshot(view.app, id)
    const expectedTitle = before.model.project.instances[programId].data.html.includes(continued) ? continued : natural
    if (!before.model.project.instances[before.model.project.rootIds[0]].childIds.includes(groupId)) {
      facts.originalSlide = await groupPaint('slide')
      facts.firstIntoFlow = await edit(view.app, id, 'move'); expect(facts.firstIntoFlow.result.status).toBe('applied')
    }
    facts.initial = await groupPaint('flow')
    facts.intoSlide = await edit(view.app, id, 'moveBack'); expect(facts.intoSlide.result.status).toBe('applied')
    facts.slidePaint = await groupPaint('slide')
    facts.intoFlow = await edit(view.app, id, 'move'); expect(facts.intoFlow.result.status).toBe('applied')
    facts.flowPaint = await groupPaint('flow')
    await view.page.screenshot({ path: path.join(directory, 'structure-flow-native-children.png') })
    facts.authorEditAfterMove = await edit(view.app, id, 'frame', undefined, undefined, groupId); expect(facts.authorEditAfterMove.result.status).toBe('applied')
    facts.editedPaint = await groupPaint('flow')
    facts.undo = await edit(view.app, id, 'undo'); expect(facts.undo.result.status).toBe('applied')
    facts.undoPaint = await groupPaint('flow')
    facts.redo = await edit(view.app, id, 'redo'); expect(facts.redo.result.status).toBe('applied')
    facts.redoPaint = await groupPaint('flow')
    await view.page.screenshot({ path: path.join(directory, 'structure-after-author-edit-undo-redo.png') })
    await mounted(view.page)
    await view.page.getByRole('group', { name: '画布模式', exact: true }).getByRole('button', { name: '试运行', exact: true }).click()
    facts.programInput = await input(view.page, expectedTitle)
    await view.page.screenshot({ path: path.join(directory, 'structure-continued-program-input.png') })
    expect(errors).toEqual([]); facts.status = 'passed-targeted'
  } finally {
    facts.errors = errors
    await writeFile(path.join(directory, 'structure-facts.json'), JSON.stringify(facts, null, 2))
    await view.page.screenshot({ path: path.join(directory, 'structure-final.png') }).catch(() => undefined)
    await close(view.app)
    await info.attach('Native group structure facts', { path: path.join(directory, 'structure-facts.json'), contentType: 'application/json' })
  }
})
