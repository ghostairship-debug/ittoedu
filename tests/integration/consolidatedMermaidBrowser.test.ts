// @vitest-environment node
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'

let server: ViteDevServer, browser: Browser, url: string
beforeAll(async () => {
  server = await createServer({ configFile: false, appType: 'custom', root: process.cwd(), cacheDir: path.resolve('output/.vite-mermaid-browser'),
    optimizeDeps: { noDiscovery: true, include: ['mermaid', 'prosemirror-model', 'prosemirror-state', 'prosemirror-view', 'prosemirror-tables', 'prosemirror-keymap', 'prosemirror-commands', 'prosemirror-schema-list', 'nanoid', 'marked'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'error' })
  server.middlewares.use('/__mermaid-editor', (_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><html><body><div id="editor"></div><script type="module">
      import { parseDocumentMarkdown, serializeDocumentMarkdown } from '/src/shared/document/markdown.ts';
      import { createLayoutEditor } from '/src/renderer/document/editorSession.ts';
      let current, editor;
      window.mountSource = source => {
        editor?.destroy(); document.querySelector('#editor').replaceChildren();
        const parsed = parseDocumentMarkdown(source, { target: 'file', createId: () => crypto.randomUUID() });
        if(parsed.status !== 'valid') throw Error('Invalid saved source');
        current = parsed.document;
        editor = createLayoutEditor(document.querySelector('#editor'), { document: current, revision: '1', change: next => { current = next; return true }, diagnostic: message => { window.diagnostic = message }, undo(){}, redo(){} });
        window.saveSource = () => serializeDocumentMarkdown(current, 'file');
        window.codeBlocks = () => current.content.blocks.filter(block => block.type === 'code').map(block => ({language:block.language, code:block.code}));
      };
      window.mountSource('前文\\n'); window.fixtureReady = true;
    </script></body></html>`)
  })
  await server.listen()
  const address = server.httpServer!.address(); if (!address || typeof address === 'string') throw Error('Missing fixture port')
  url = `http://127.0.0.1:${address.port}/__mermaid-editor`
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
}, 30_000)
afterAll(async () => { await browser?.close(); await server?.close() })

describe('real Mermaid library and formal rich-editor clipboard structure', () => {
  it('renders comment-first syntax after real clipboard paste and cold source reopen, and diagnoses invalid syntax', async () => {
    const page = await browser.newPage(); await page.goto(url); await page.waitForFunction(() => Reflect.get(window, 'fixtureReady'))
    const source = '```mermaid\n%% comment before diagram\nsequenceDiagram\n Alice->>Bob: 你好\n```'
    await page.locator('.ProseMirror').evaluate((element, source) => {
      const data = new DataTransfer(); data.setData('text/plain', source)
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
    }, source)
    await expect.poll(() => page.locator('.mermaid-preview').getAttribute('data-state')).toBe('ready')
    expect(await page.locator('.mermaid-preview svg').count()).toBe(1)
    const blocks = await page.evaluate(() => Reflect.get(window, 'codeBlocks')())
    expect(blocks).toEqual([{ language: 'mermaid', code: '%% comment before diagram\nsequenceDiagram\n Alice->>Bob: 你好' }])
    const saved = await page.evaluate(() => Reflect.get(window, 'saveSource')()) as string
    expect(saved).toContain('```mermaid'); await page.close()
    const cold = await browser.newPage(); await cold.goto(url); await cold.waitForFunction(() => Reflect.get(window, 'fixtureReady'))
    await cold.evaluate(source => Reflect.get(window, 'mountSource')(source), saved)
    await expect.poll(() => cold.locator('.mermaid-preview').getAttribute('data-state')).toBe('ready')
    expect(await cold.evaluate(() => Reflect.get(window, 'codeBlocks')())).toEqual(blocks)
    await cold.evaluate(() => Reflect.get(window, 'mountSource')('```mermaid\nunknownInvalidDiagram\n```'))
    await expect.poll(() => cold.locator('.mermaid-preview').getAttribute('data-state')).toBe('error')
    expect(await cold.locator('pre').textContent()).toContain('unknownInvalidDiagram')
    await cold.close()
  }, 45_000)
})
