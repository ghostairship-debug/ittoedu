// @vitest-environment node
import { beforeAll, afterAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

let browser: Browser, harness: string
const output = resolve('output/html-shortcuts-20261025')
beforeAll(async () => {
  await mkdir(output, { recursive: true })
  const started = Date.now()
  const bundle = await build({ entryPoints: [resolve('tests/helpers/plainTextShortcutBrowserHarness.tsx')], bundle: true,
    platform: 'browser', format: 'iife', globalName: 'ShortcutFixture', target: 'es2022', write: false })
  harness = bundle.outputFiles[0]!.text
  await writeFile(resolve(output, 'setup.json'), JSON.stringify({ buildMs: Date.now() - started, bytes: harness.length }))
  browser = await chromium.launch({ headless: true })
})
afterAll(async () => { await browser?.close() })
async function mount(): Promise<Page> {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  await page.route('http://localhost/shortcuts', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>.canvas-plain-text-editor{position:absolute}.canvas-plain-text-editor__inline{white-space:pre-wrap;user-select:text;min-width:300px;min-height:80px}</style><div id="editor"></div>' }))
  await page.goto('http://localhost/shortcuts')
  await page.addScriptTag({ content: harness })
  await page.evaluate(() => { (window as any).shortcutFacts = (window as any).ShortcutFixture.mountPlainTextShortcutHarness(document.getElementById('editor')) })
  return page
}
const value = (page: Page) => page.getByRole('textbox', { name: 'Shared inline text' }).textContent()

it('keeps native cut, copy, paste and select-all inside the shared inline input rather than the object router', async () => {
  const page = await mount()
  try {
    await page.keyboard.press('Control+A')
    expect(await page.evaluate(() => getSelection()?.toString())).toBe('alpha beta')
    await page.keyboard.press('Control+C')
    expect(await value(page)).toBe('alpha beta')
    await page.keyboard.press('Control+X')
    expect(await value(page)).toBe('')
    await page.keyboard.press('Control+V')
    expect(await value(page)).toBe('alpha beta')
    expect(await page.evaluate(() => (window as any).shortcutFacts.objectActions)).toEqual([])
    await writeFile(resolve(output, 'inline-native-facts.json'), JSON.stringify(await page.evaluate(() => (window as any).shortcutFacts), null, 2))
  } finally { await page.context().close() }
})

it('undoes and redoes a plain-text paste and a literal newline without leaving the input owner', async () => {
  const page = await mount()
  try {
    await page.evaluate(() => navigator.clipboard.writeText('replacement'))
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Control+V')
    expect(await value(page)).toBe('replacement')
    await page.keyboard.press('Control+Z')
    expect(await value(page)).toBe('alpha beta')
    await page.keyboard.press('Control+Y')
    expect(await value(page)).toBe('replacement')
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    expect(await value(page)).toBe('replacement\n')
    await page.keyboard.press('Control+Z')
    expect(await value(page)).toBe('replacement')
    await page.keyboard.press('Control+Shift+Z')
    expect(await value(page)).toBe('replacement\n')
    expect(await page.evaluate(() => (window as any).shortcutFacts.objectActions)).toEqual([])
  } finally { await page.context().close() }
})

it('pastes multiline literal markup as text with a native undo step', async () => {
  const page = await mount()
  try {
    await page.evaluate(() => navigator.clipboard.writeText('<img src=x onerror="window.injected=true"> &\nnext'))
    await page.keyboard.press('Control+A'); await page.keyboard.press('Control+V')
    expect(await value(page)).toBe('<img src=x onerror="window.injected=true"> &\nnext')
    expect(await page.getByRole('textbox', { name: 'Shared inline text' }).locator('img,script,b,i,u').count()).toBe(0)
    await page.keyboard.press('Control+Z')
    expect(await value(page)).toBe('alpha beta')
    expect(await page.evaluate(() => (window as any).injected)).toBeUndefined()
  } finally { await page.context().close() }
})
