// @vitest-environment node
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { HtmlSourceEditService } from '../../src/main/workbench/htmlPreview/HtmlSourceEditService'
import { readHtmlAuthoringRecords } from '../../src/shared/html/htmlAuthoringRecords'
import type { HtmlPreviewRequest } from '../../src/shared/workbench/htmlPreview'

it('cuts and pastes the same selected HTML field through real keys and Main, retains formal undo/redo, and saves a cold-rebindable empty duplicate', async () => {
  const output = path.resolve('output/html-shortcuts-20261025')
  await fs.mkdir(output, { recursive: true })
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'html-shortcuts-'))
  const filename = path.join(directory, 'keys.html'), source = '<html><head><style>body{margin:0}p{margin:20px;font:24px/40px sans-serif}</style></head><body><div><p>A</p><p>A</p></div></body></html>'
  await fs.writeFile(filename, source)
  const host = new DocumentHostService(path.join(directory, 'journal')), initial = await host.open(filename)
  if (initial.binding.kind !== 'file') throw new Error('Expected file')
  const lease = { leaseId: 'shortcuts', loadId: 'shortcuts', documentId: initial.documentId, epoch: initial.epoch,
    revision: initial.revision, bindingVersion: initial.binding.bindingVersion, url: 'http://localhost/html-frame' }
  const owner = { initial, filename, lease }
  const service = new HtmlSourceEditService({ readDocument: id => host.internalAPI.read(id), execute: operation => host.internalAPI.dispatch(operation), withFileAccess: work => host.fileCoordinator.withFileAccess(work) })
  const requests: HtmlPreviewRequest[] = []
  const bundle = await build({ entryPoints: [path.resolve('tests/helpers/htmlShortcutBrowserHarness.tsx')], bundle: true, format: 'iife', platform: 'browser', globalName: 'HtmlShortcutFixture', target: 'es2022', write: false, outfile: 'harness.js', loader: { '.css': 'css' }, logLevel: 'silent' })
  const agent = await build({ entryPoints: [path.resolve('src/player/htmlPreview/htmlPreviewAgent.ts')], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent' })
  const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1000, height: 700 } }), page = await context.newPage()
  const errors: string[] = []
  let stage = 'mount'
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.route('http://localhost/shortcuts', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><style>html,body,#editor{margin:0;width:100%;height:100%}.html-preview-pane{height:100%}.html-preview-pane__body{height:550px}.html-preview-pane iframe{width:100%;height:100%}.canvas-plain-text-editor__inline{white-space:pre-wrap;user-select:text}</style><div id="editor"></div>' }))
    await page.route(lease.url, async route => {
      const current = await host.internalAPI.read(owner.initial.documentId)
      if (current.model.kind !== 'text') throw new Error('Expected current source')
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `${current.model.source}<script>${agent.outputFiles[0]!.text.replace(/<\/script/gi, '<\\/script')}</script>` })
    })
    await page.exposeFunction('htmlShortcutCall', async (request: HtmlPreviewRequest) => {
      requests.push(request)
      const snapshot = await host.internalAPI.read(owner.initial.documentId)
      const editContext = { lease: owner.lease, tabId: 'shortcut-tab', snapshot, bindingPath: owner.filename, rootRealPath: directory, entryRealPath: owner.filename }
      const response = request.type === 'html-preview.resolve-target' ? await service.resolveTarget(request, editContext)
        : request.type === 'html-preview.edit' ? await service.edit(request, editContext) : undefined
      return { response, snapshot: await host.internalAPI.read(owner.initial.documentId) }
    })
    await page.exposeFunction('htmlShortcutHistory', async (direction: 'undo' | 'redo') => {
      const current = await host.internalAPI.read(owner.initial.documentId)
      await host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: randomUUID(), actor: 'human', mutation: { type: direction } })
      return host.internalAPI.read(owner.initial.documentId)
    })
    await page.goto('http://localhost/shortcuts')
    await page.evaluate(() => { (window as any).previewMessages = []; addEventListener('message', event => { if (event.data?.protocol === 1) (window as any).previewMessages.push(event.data) }) })
    for (const css of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: css.text })
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text })
    const mountInput: { initial: unknown; lease: unknown } = { initial, lease }
    await page.evaluate(({ initial, lease }) => { (window as any).htmlShortcutFacts = (window as any).HtmlShortcutFixture.mountHtmlShortcutHarness(document.getElementById('editor'), initial, lease) }, mountInput)
    const edit = page.getByRole('button', { name: '编辑', exact: true })
    await expect.poll(() => edit.isEnabled()).toBe(true)
    await edit.click()
    await page.getByRole('button', { name: '完成编辑', exact: true }).waitFor()
    const frame = page.frameLocator('iframe[title="HTML 预览"]'), first = frame.locator('p').first(), second = frame.locator('p').nth(1)
    await first.click()
    await page.getByLabel('HTML 对象选框').waitFor()
    expect(await page.evaluate(() => document.activeElement?.className)).toBe('html-preview-pane')
    expect(requests.filter((request): request is Extract<HtmlPreviewRequest, { type: 'html-preview.resolve-target' }> => request.type === 'html-preview.resolve-target').flatMap(request => request.targets).some(target => target.rawText === 'A' && target.bindingStatus === 'unresolved')).toBe(true)
    stage = 'copy-cut'
    await page.keyboard.press('Control+C')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('A')
    await page.keyboard.press('Control+X')
    await expect.poll(async () => (await host.internalAPI.read(initial.documentId)).undoDepth).toBe(1)
    await expect.poll(() => first.textContent()).toBe('')
    expect(await second.textContent()).toBe('A')
    await page.evaluate(() => navigator.clipboard.writeText('Pasted <literal>\nline'))
    const pasted = await page.evaluate(() => navigator.clipboard.readText())
    expect(pasted.replace(/\r\n?/g, '\n')).toBe('Pasted <literal>\nline')
    await page.keyboard.press('Control+V')
    await expect.poll(async () => (await host.internalAPI.read(initial.documentId)).undoDepth).toBe(2)
    await expect.poll(() => first.textContent()).toBe(pasted)
    stage = 'undo-redo'
    await page.keyboard.press('Control+Z')
    await expect.poll(() => first.textContent()).toBe('')
    await page.keyboard.press('Control+Y')
    await expect.poll(() => first.textContent()).toBe(pasted)
    await first.click()
    await page.getByLabel('HTML 对象选框').waitFor()
    stage = 'select-all-input'
    await page.keyboard.press('Control+A')
    const input = page.getByRole('textbox', { name: '编辑此处文字' })
    await input.waitFor()
    // The source field can display white-space:normal. Range contents prove
    // that select-all includes the literal CR/LF even when glyph copy collapses it.
    expect(await page.evaluate(() => getSelection()?.getRangeAt(0).cloneContents().textContent)).toBe(pasted)
    await page.keyboard.press('Control+X')
    expect(await input.textContent()).toBe('')
    await page.keyboard.press('Escape')
    stage = 'save-cold'
    await expect.poll(async () => (await host.internalAPI.read(initial.documentId)).undoDepth).toBe(3)
    await host.internalAPI.save(initial.documentId)
    const cold = await new DocumentHostService(path.join(directory, 'cold-journal')).open(filename)
    if (cold.model.kind !== 'text') throw new Error('Expected source')
    const records = readHtmlAuthoringRecords(cold.model.source)
    expect(Object.values(records).filter(record => record.overrides.text === '')).toHaveLength(1)
    await page.route('http://localhost/cold', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: cold.model.kind === 'text' ? cold.model.source : '' }))
    await page.goto('http://localhost/cold')
    await expect.poll(() => page.locator('p').first().textContent()).toBe('')
    expect(await page.locator('p').nth(1).textContent()).toBe('A')
    stage = 'nested-selected-clipboard'
    const nestedFile = path.join(directory, 'nested.html'), child = '<html><body><p id="target">Nested current</p><p>Keep nested</p></body></html>'
    await fs.writeFile(nestedFile, `<html><head></head><body><iframe id="lesson" style="width:800px;height:450px" srcdoc="${child.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe></body></html>`)
    const nested = await host.open(nestedFile)
    if (nested.binding.kind !== 'file') throw new Error('Expected nested file')
    owner.initial = nested; owner.filename = nestedFile; owner.lease = { ...lease, documentId: nested.documentId, epoch: nested.epoch,
      leaseId: 'nested-shortcuts', loadId: 'nested-shortcuts', bindingVersion: nested.binding.bindingVersion }
    await page.goto('http://localhost/shortcuts')
    for (const css of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: css.text })
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text })
    const nestedMountInput: { initial: unknown; lease: unknown } = { initial: nested, lease: owner.lease }
    await page.evaluate(({ initial, lease }) => { (window as any).htmlShortcutFacts = (window as any).HtmlShortcutFixture.mountHtmlShortcutHarness(document.getElementById('editor'), initial, lease) }, nestedMountInput)
    await expect.poll(() => page.getByRole('button', { name: '编辑', exact: true }).isEnabled()).toBe(true)
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await page.getByRole('button', { name: '完成编辑', exact: true }).waitFor()
    const inner = page.frameLocator('iframe[title="HTML 预览"]').frameLocator('iframe#lesson')
    await inner.locator('#target').click()
    await page.getByLabel('HTML 对象选框').waitFor()
    await page.keyboard.press('Control+X')
    await expect.poll(() => inner.locator('#target').textContent()).toBe('')
    await page.evaluate(() => navigator.clipboard.writeText('Nested changed'))
    await page.keyboard.press('Control+V')
    await expect.poll(() => inner.locator('#target').textContent()).toBe('Nested changed')
    expect(await inner.locator('p').nth(1).textContent()).toBe('Keep nested')
    expect((await host.internalAPI.read(nested.documentId)).undoDepth).toBe(2)
    stage = 'nested-format-shortcuts'
    await page.keyboard.press('Control+B')
    await expect.poll(() => inner.locator('#target').evaluate(element => getComputedStyle(element).fontWeight)).toBe('700')
    await inner.locator('#target').dblclick()
    await page.getByRole('textbox', { name: '编辑此处文字' }).waitFor()
    await page.keyboard.press('Control+I')
    await expect.poll(() => inner.locator('#target').evaluate(element => getComputedStyle(element).fontStyle)).toBe('italic')
    await page.keyboard.press('Control+U')
    await expect.poll(() => inner.locator('#target').evaluate(element => getComputedStyle(element).textDecorationLine)).toContain('underline')
    expect(await inner.locator('#target b,#target i,#target u,#target strong,#target em').count()).toBe(0)
    expect(await inner.locator('#target').textContent()).toBe('Nested changed')
    expect(await inner.locator('p').nth(1).evaluate(element => getComputedStyle(element).fontWeight)).toBe('400')
    stage = 'selected-delete-escape'
    await page.keyboard.press('Delete')
    await expect.poll(() => inner.locator('#target').textContent()).toBe('')
    await page.keyboard.press('Control+Z')
    await expect.poll(() => inner.locator('#target').textContent()).toBe('Nested changed')
    await inner.locator('#target').click()
    await page.getByLabel('HTML 对象选框').waitFor()
    await page.keyboard.press('Backspace')
    await expect.poll(() => inner.locator('#target').textContent()).toBe('')
    await page.keyboard.press('Control+Z')
    await expect.poll(() => inner.locator('#target').textContent()).toBe('Nested changed')
    await inner.locator('#target').click()
    await page.getByLabel('HTML 对象选框').waitFor()
    await page.keyboard.press('Escape')
    expect(await page.getByLabel('HTML 对象选框').count()).toBe(0)
    expect(await page.getByRole('button', { name: '完成编辑', exact: true }).isVisible()).toBe(true)
    await fs.writeFile(path.join(output, 'html-selected-keys-facts.json'), JSON.stringify({ carrier: 'real Chromium keys + HtmlPreviewPane + actual Agent + Main DocumentHostService/HtmlSourceEditService', duplicateColdClear: true, neighbor: 'A', initialBinding: 'unresolved', coldUndoDepth: cold.undoDepth, nestedParentOwnedClipboard: true, formatting: { selectedBold: true, inlineItalic: true, underline: true, nativeRichMarkup: false }, requests: requests.map(request => request.type) }, null, 2))
  } finally {
    const current = await host.internalAPI.read(initial.documentId)
    await fs.writeFile(path.join(output, 'html-selected-diagnostics.json'), JSON.stringify({ stage, errors, current: { revision: current.revision, undoDepth: current.undoDepth, records: current.model.kind === 'text' ? readHtmlAuthoringRecords(current.model.source) : {} }, messages: await page.evaluate(() => (window as any).previewMessages).catch(() => undefined), body: await page.locator('body').innerText().catch(() => '') }, null, 2))
    await browser.close(); await fs.rm(directory, { recursive: true, force: true })
  }
}, 30_000)
