// @vitest-environment node
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { beforeAll, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { parseDocumentMarkdown } from '../../src/shared/document/markdown'

let bundle: Awaited<ReturnType<typeof build>>
beforeAll(async () => {
  bundle = await build({ entryPoints: [path.resolve('tests/helpers/sharedDocumentShortcutBrowserHarness.tsx')], bundle: true, format: 'iife', platform: 'browser', globalName: 'SharedShortcutFixture', target: 'es2022', write: false, outfile: 'harness.js', loader: { '.css': 'css', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' }, logLevel: 'silent' })
})

it('uses the shared document format owner for actual BIU keys and retains Markdown source redo aliases and saved styles', async () => {
  const output = path.resolve('output/html-shortcuts-20261025')
  await fs.mkdir(output, { recursive: true })
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shared-shortcuts-'))
  const filename = path.join(directory, 'keys.md')
  await fs.writeFile(filename, 'Format current field')
  const host = new DocumentHostService(path.join(directory, 'journal')), initial = await host.open(filename)
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  page.setDefaultTimeout(3000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.route('http://localhost/shared-shortcuts', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><div id="editor"></div>' }))
    await page.exposeFunction('sharedShortcutCommit', async (source: string, historyGroup?: string) => {
      const current = await host.internalAPI.read(initial.documentId)
      await host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: randomUUID(), actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source } }, historyGroup })
      return host.internalAPI.read(initial.documentId)
    })
    await page.exposeFunction('sharedShortcutHistory', async (direction: 'undo' | 'redo') => {
      const current = await host.internalAPI.read(initial.documentId)
      await host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: randomUUID(), actor: 'human', mutation: { type: direction } })
      return host.internalAPI.read(initial.documentId)
    })
    await page.goto('http://localhost/shared-shortcuts')
    for (const css of bundle.outputFiles!.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: css.text })
    await page.addScriptTag({ content: bundle.outputFiles!.find(file => file.path.endsWith('.js'))!.text })
    const mountInput: unknown = initial
    await page.evaluate(initial => { (window as any).sharedShortcutFacts = (window as any).SharedShortcutFixture.mountSharedDocumentShortcuts(document.getElementById('editor'), initial) }, mountInput)
    const input = page.getByRole('textbox', { name: '正文编辑', exact: true })
    await input.waitFor()
    await input.click()
    await page.keyboard.press('Control+A')
    for (const [key, flag] of [['B', 'bold'], ['I', 'italic'], ['U', 'underline']] as const) {
      await page.keyboard.press(`Control+${key}`)
      await expect.poll(async () => {
        const snapshot = await host.internalAPI.read(initial.documentId)
        return snapshot.model.kind === 'markdown' && snapshot.model.source.includes(`cw:${flag}=true`)
      }).toBe(true)
    }
    expect(await input.locator('b,i,u,strong,em').count()).toBe(0)
    expect(await input.textContent()).toBe('Format current field')
    // The toolbar toggles exactly the same formal mark as the keyboard.
    await page.getByRole('button', { name: '粗体', exact: true }).click()
    await expect.poll(async () => {
      const snapshot = await host.internalAPI.read(initial.documentId)
      return snapshot.model.kind === 'markdown' && snapshot.model.source.includes('cw:bold=false')
    }).toBe(true)
    await page.keyboard.press('Control+B')
    await expect.poll(async () => {
      const snapshot = await host.internalAPI.read(initial.documentId)
      return snapshot.model.kind === 'markdown' && snapshot.model.source.includes('cw:bold=true')
    }).toBe(true)
    await host.internalAPI.save(initial.documentId)
    const cold = await new DocumentHostService(path.join(directory, 'cold-journal')).open(filename)
    if (cold.model.kind !== 'markdown') throw new Error('Expected Markdown')
    const parsed = parseDocumentMarkdown(cold.model.source, { target: 'file', createId: () => randomUUID() })
    if (parsed.status !== 'valid') throw new Error('Saved format must parse')
    const paragraph = parsed.document.content.blocks[0]
    if (paragraph.type !== 'paragraph') throw new Error('Expected paragraph')
    expect(paragraph.content.inlines).toEqual([{ type: 'text', text: 'Format current field', style: { bold: true, italic: true, underline: true } }])
    await page.getByRole('button', { name: '源码', exact: true }).click()
    const source = page.getByRole('textbox', { name: '正文源文编辑', exact: true })
    await source.waitFor(); await source.click()
    await page.keyboard.press('Control+Z')
    await expect.poll(() => page.evaluate(() => (window as any).sharedShortcutFacts.history.at(-1))).toBe('undo')
    await page.keyboard.press('Control+Y')
    await expect.poll(() => page.evaluate(() => (window as any).sharedShortcutFacts.history.at(-1))).toBe('redo')
    await page.keyboard.press('Control+Z')
    await expect.poll(() => page.evaluate(() => (window as any).sharedShortcutFacts.history.at(-1))).toBe('undo')
    await page.keyboard.press('Control+Shift+Z')
    await expect.poll(() => page.evaluate(() => (window as any).sharedShortcutFacts.history.at(-1))).toBe('redo')
    expect(errors).toEqual([])
    await fs.writeFile(path.join(output, 'shared-document-keys-facts.json'), JSON.stringify({ carrier: 'real Chromium + SharedDocumentEditor + Main DocumentSession + disk cold reopen', coldSource: cold.model.source, facts: await page.evaluate(() => (window as any).sharedShortcutFacts), errors }, null, 2))
  } finally {
    await fs.writeFile(path.join(output, 'shared-document-keys-diagnostic.json'), JSON.stringify({ errors, facts: await page.evaluate(() => (window as any).sharedShortcutFacts).catch(() => undefined), body: await page.locator('body').innerHTML().catch(() => '') }, null, 2))
    await browser.close(); await fs.rm(directory, { recursive: true, force: true })
  }
}, 30_000)
