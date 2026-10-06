// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { _electron as electron, type Page } from 'playwright'
import { expect, it } from 'vitest'

it('keeps a measured Web transport canvas transparent through mount/update while preserving local, document, program and Source paint', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-theme-canvas-'))
  const evidence = process.env.GUOLING_THEME_CANVAS_EVIDENCE ?? directory
  await fs.mkdir(evidence, { recursive: true })
  await fs.copyFile('tests/fixtures/measured-web-theme-canvas/main.cjs', path.join(directory, 'main.cjs'))
  await build({ entryPoints: ['tests/fixtures/measured-web-theme-canvas/renderer.ts'], bundle: true, platform: 'browser', format: 'iife', outfile: path.join(directory, 'renderer.js'), logLevel: 'silent' })
  await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root" style="width:1280px;height:720px"></div><script src="renderer.js"></script>')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: [path.join(directory, 'main.cjs')], env: { ...env, GUOLING_THEME_CANVAS_DIRECTORY: directory }, timeout: 30000 })
  const raw: unknown[] = []
  let page: Page | undefined, stderr = ''
  app.process().stderr?.on('data', chunk => { stderr += String(chunk) })
  try {
    page = await app.firstWindow()
    await page.waitForFunction(() => {
      const state = window as unknown as { fixtureReady?: boolean; fixtureStartupError?: string }
      return state.fixtureReady || state.fixtureStartupError
    })
    expect(await page.evaluate(() => (window as unknown as { fixtureStartupError?: string }).fixtureStartupError)).toBeUndefined()
    const read = async () => {
      const facts: Record<string, { background: string; image: string; color: string; font: string; localPaint: string | null }> = {}
      for (const id of ['plain', 'local', 'document', 'program', 'source']) {
        // Realm selection uses the actual DOM, not frame URL/name bookkeeping.
        const candidates = await Promise.all(page!.frames().filter(frame => frame !== page!.mainFrame()).map(async frame => await frame.locator(`#${id}`).count() ? frame : null))
        const actual = candidates.find(Boolean)!
        if (!actual) throw new Error(`Missing realm ${id}`)
        facts[id] = await actual.evaluate(() => {
          const body = getComputedStyle(document.body), local = document.querySelector('[data-theme-paint]')
          return { background: body.backgroundColor, image: body.backgroundImage, color: body.color, font: body.fontFamily, localPaint: local ? getComputedStyle(local).backgroundImage : null }
        })
      }
      return facts
    }
    const initial = await read(); raw.push({ phase: 'mount', facts: initial })
    expect(initial.plain).toMatchObject({ background: 'rgba(0, 0, 0, 0)', image: 'none', color: 'rgb(12, 34, 56)', font: 'serif' })
    expect(initial.plain!.localPaint).toContain('linear-gradient')
    expect(initial.local!.background).toBe('rgb(10, 20, 30)')
    for (const id of ['document', 'program', 'source']) expect(initial[id]!.background).toBe('rgb(2, 6, 23)')
    await page.evaluate(() => (window as unknown as { changeTheme(): Promise<void> }).changeTheme())
    const updated = await read(); raw.push({ phase: 'update-and-theme-notification', facts: updated })
    expect(updated.plain).toMatchObject({ background: 'rgba(0, 0, 0, 0)', image: 'none', color: 'rgb(65, 43, 21)', font: 'monospace' })
    expect(updated.local!.background).toBe('rgb(10, 20, 30)')
    for (const id of ['document', 'program', 'source']) expect(updated[id]!.background).toBe('rgb(40, 50, 60)')
    expect(await page.evaluate(() => (window as unknown as { fixtureErrors: string[] }).fixtureErrors)).toEqual([])
  } finally {
    await fs.writeFile(path.join(evidence, 'raw.json'), JSON.stringify({ raw, stderr, directory }, null, 2))
    await app.close()
  }
}, 60000)
