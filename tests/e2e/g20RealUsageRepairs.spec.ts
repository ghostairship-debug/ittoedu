import { _electron as electron, expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')

test('real-usage repairs: non-default Runtime hits, reachable card composer, independent HTML preview', async () => {
  test.setTimeout(180_000)
  const base = path.join(root, 'output/g20/repairs-20260929')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(path.join(base, 'run-'))
  await mkdir(path.join(directory, 'profile'))
  await build({ entryPoints: [path.join(__dirname, 'helpers/g20RepairMain.ts')], outfile: path.join(directory, 'main.cjs'),
    bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
  await build({ entryPoints: [path.join(__dirname, 'helpers/g20RepairRenderer.ts')], outfile: path.join(directory, 'renderer.js'),
    bundle: true, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"test"' } })
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"></head><body><script src="renderer.js"></script></body></html>')
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: [path.join(directory, 'main.cjs')], env: { ...env, G20_REPAIR_DIR: directory, G20_REPAIR_ROOT: root } })
  const evidence: Record<string, unknown> = { directory }
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => !!Reflect.get(window, 'repairFixture'), undefined, { timeout: 5000 }).catch(async error => {
      throw new Error(String(error) + JSON.stringify(await app.evaluate(() => Reflect.get(globalThis, 'repairRendererErrors'))))
    })
    const runtimeEvidence = []
    for (const input of [{ live: false, scale: .6, partial: false }, { live: true, scale: 1, partial: true }]) {
      const pairs = await page.evaluate(input => Reflect.get(window, 'repairFixture').runtime(input), input)
      for (const pair of pairs) {
        for (const key of ['x', 'y', 'width', 'height']) expect(Math.abs(pair.actual[key] - pair.hit[key])).toBeLessThan(1)
        await page.mouse.click(pair.actual.x + pair.actual.width / 2, pair.actual.y + pair.actual.height / 2)
        await expect(page.locator('body')).toHaveAttribute('data-hit', pair.kind)
      }
      runtimeEvidence.push({ input, pairs })
      await page.screenshot({ path: path.join(directory, `runtime-${input.live ? 'live' : 'authoring'}.png`) })
    }
    evidence.runtime = runtimeEvidence
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1200, 850))
    const drafts: string[] = await app.evaluate(() => Reflect.get(globalThis, 'repairDraftPages')())
    expect(drafts).toHaveLength(6)
    const persisted = await app.evaluate(() => Reflect.get(globalThis, 'repairDraftPersistence'))
    expect(persisted).toMatchObject({ dirty: false, revision: 1, locations: 6, runtimePages: 6, readFromArchive: true })
    expect(persisted.fileBytes).toBeGreaterThan(0) // Content and interactions, not ZIP size, establish a complete fixture.
    evidence.draftPersistence = persisted
    const draftEvidence = []
    for (const [index, html] of drafts.entries()) {
      const geometry = await page.evaluate(html => Reflect.get(window, 'repairFixture').draftPage(html), html)
      expect(geometry.sections).toBe(1); expect(geometry.diagrams).toBe(1)
      expect(geometry.height).toBeLessThanOrEqual(geometry.viewport)
      const frame = page.frameLocator('iframe')
      await expect(frame.locator('[data-result]')).toHaveText(`Ready ${index + 1}`)
      await frame.getByRole('textbox', { name: 'Answer', exact: true }).fill(`answer ${index + 1}`)
      await frame.getByRole('button', { name: 'Show result' }).click()
      await expect(frame.locator('[data-result] strong')).toHaveText(`Verified ${index + 1}: answer ${index + 1}`)
      await page.screenshot({ path: path.join(directory, `draft-${index + 1}.png`) })
      draftEvidence.push({ page: index + 1, ...geometry, actualClick: true })
    }
    evidence.draft = draftEvidence

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(600, 440))
    for (const kind of ['element', 'text'] as const) {
      await page.evaluate(kind => Reflect.get(window, 'repairFixture').card(kind), kind)
      if (kind === 'element') await page.getByRole('button', { name: 'AI 修改', exact: true }).click()
      const card = page.locator('.element-ai-card'), send = card.getByRole('button', { name: '发送', exact: true })
      await expect(card).toBeVisible()
      await card.getByRole('textbox', { name: 'AI 修改要求' }).fill('Draft stays reachable')
      const measure = () => send.evaluate(button => {
        const rect = button.getBoundingClientRect(), body = document.querySelector('.element-ai-card__body')!
        return { left: rect.left, right: rect.right, viewportWidth: innerWidth, top: rect.top, bottom: rect.bottom, viewport: innerHeight, scrolls: body.scrollHeight > body.clientHeight,
          hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === button }
      })
      const before = await measure()
      expect(before.top).toBeGreaterThanOrEqual(0); expect(before.bottom).toBeLessThanOrEqual(before.viewport)
      expect(before.hit).toBe(true); expect(before.scrolls).toBe(true)
      expect(before.left).toBeGreaterThanOrEqual(0); expect(before.right).toBeLessThanOrEqual(before.viewportWidth)
      await card.locator('.element-ai-card__body').evaluate(body => { body.scrollTop = body.scrollHeight })
      const after = await measure(); expect(after.top).toBeCloseTo(before.top, 1); expect(after.hit).toBe(true)
      await page.screenshot({ path: path.join(directory, `card-${kind}.png`) })
      evidence[kind] = { before, after }
    }
    const preview = await app.evaluate(async () => Reflect.get(globalThis, 'repairPreviewScenario')())
    expect(preview.source).toBe('isolated-html-preview')
    expect(preview.first.join(' ')).toContain('Current canonical source')
    expect(preview.revised.join(' ')).toContain('Revised source')
    expect(preview.pixelsChanged).toBe(true); expect(preview.bytes).toBeGreaterThan(1000)
    expect(preview.width).toBeGreaterThanOrEqual(1200); expect(preview.height).toBeGreaterThanOrEqual(700)
    for (const key of ['repeatGeneration', 'staleRejected', 'cancelled', 'diskUnchanged', 'windowsRestored', 'earlierImageRetained']) expect(preview[key], key).toBe(true)
    expect(preview.deniedRequests).toBe(0)
    evidence.preview = preview
  } finally { await writeFile(path.join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2)); await app.close() }
  console.log(`Repair evidence: ${directory}`)
})
