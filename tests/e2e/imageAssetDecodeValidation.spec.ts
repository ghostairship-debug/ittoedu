import { chromium, expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { run } from './imageAssetDecodeValidationProbe'

test('real Chromium rejects damaged image pixels before import or dynamic fallback admission', async ({}, testInfo) => {
  const bad = await readFile(resolve('tests/fixtures/image-validation/malformed-pixel-data.png'))
  const bundled = await build({ entryPoints: [resolve('tests/e2e/imageAssetDecodeValidationProbe.ts')], bundle: true,
    write: false, platform: 'browser', format: 'iife', globalName: 'ImageValidationProbe', logLevel: 'silent',
    alias: { '@': resolve('src') } })
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    const page = await browser.newPage()
    await page.addScriptTag({ content: bundled.outputFiles[0]!.text })
    const result = await page.evaluate(async base64 => {
      return (window as unknown as { ImageValidationProbe: { run: typeof run } }).ImageValidationProbe.run(base64)
    }, bad.toString('base64'))
    const evidence = { checkedAt: new Date().toISOString(), browser: browser.version(), source: 'actual product modules bundled from source; no provider or CLI call', ...result }
    const output = resolve('output/r18-image-validation-fix/image-decode-validation.json')
    await mkdir(resolve('output/r18-image-validation-fix'), { recursive: true })
    await writeFile(output, JSON.stringify(evidence, null, 2))
    await testInfo.attach('complete-image-decode', { path: output, contentType: 'application/json' })
    expect(result.badBytes).toBe(1100)
    expect(result.permissiveDimensions).toEqual({ width: 220, height: 220 })
    expect(result.badError).toContain('无法完整解码')
    expect(result.importResult).toMatchObject({ status: 'failed', commits: 0, beforeRevision: 0, afterRevision: 0, assetsAfter: 0 })
    expect(result.fallbackError).toContain('不能完整解码')
    expect(result.accepted.map(item => item.name)).toEqual(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'svg-explicit', 'svg-viewbox'])
    expect(result.accepted.every(item => item.width > 0 && item.height > 0)).toBe(true)
  } finally { await browser.close() }
})
